/**
 * Merge-preserving read-modify-write of `.claude/settings*.json` (R2, §4.3).
 *
 * This file is **not** how a style activates inside Ptah. Activation rides the
 * flag tier (`Options.settings`), which cannot fail because it involves no I/O.
 * This writer exists for one narrower purpose: OPT-IN CLI PARITY, so a style
 * chosen in Ptah is also seen by a `claude` process the user starts themselves.
 * It is default OFF, and a failure here must never roll back or block a
 * selection (§4.1).
 *
 * `.claude/settings.json` is CO-OWNED. Ptah is a guest in it, and that single
 * fact drives every decision below:
 *
 *  - Malformed pre-existing JSON ABORTS. This is a deliberate divergence from
 *    `PtahFileSettingsManager.loadSync`, which resets a corrupt file to `{}`.
 *    That behaviour is correct for `~/.ptah/settings.json`, which Ptah owns.
 *    It would be destructive here, so a broken file is reported and left alone
 *    — `writeFile` is never reached.
 *  - The merge is a spread, so every unrelated key survives byte-identical and
 *    pre-existing key order is preserved.
 *  - A backup is written before the real write and removed after it, because
 *    `IFileSystemProvider` has no `rename` (13 members, none of them
 *    `rename`/`move`), so a true tmp+rename atomic write is not expressible
 *    through the port and dropping to `node:fs` is forbidden by NFR. The
 *    backup is the truncation insurance that costs us.
 *  - A pre-write re-read that differs from the snapshot aborts as a conflict.
 *    This NARROWS the loss window; it does not close it. Closing it needs a
 *    real compare-and-swap, which the port does not have. Same honest posture
 *    as `TaskWriterService.applyFrontmatterPatch`, which this follows.
 *
 * Req 7.6: no absolute host path and no raw exception text reaches a returned
 * message. Every path in an error is `~`- or workspace-relative.
 */
import * as path from 'path';
import { inject, injectable } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  type IFileSystemProvider,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  OutputStyleOperationError,
  OutputStyleParityOutcome,
  SettingsTier,
} from '@ptah-extension/shared';
import { DEFAULT_OUTPUT_STYLE_NAME } from './built-in-output-styles';
import {
  OUTPUT_STYLES_DIR_SEGMENTS,
  resolveHomeDirectory,
} from './output-style-discovery.service';
import { sanitizeDiagnostic } from './sanitize-diagnostic';

/**
 * `.claude`. Taken from the discovery constant rather than re-spelled, so the
 * directory name exists in exactly one place in this lib.
 */
const CLAUDE_DIR_SEGMENT = OUTPUT_STYLES_DIR_SEGMENTS[0];

/** Which file each tier maps to (E2). */
const SETTINGS_FILE_NAMES: Readonly<Record<SettingsTier, string>> =
  Object.freeze({
    /** `~/.claude/settings.json` — all projects. */
    user: 'settings.json',
    /** `<workspaceRoot>/.claude/settings.json` — committable, the default. */
    project: 'settings.json',
    /** `<workspaceRoot>/.claude/settings.local.json` — gitignored. */
    local: 'settings.local.json',
  });

/**
 * Suffix of the pre-write insurance copy. Precedent: `JsonMcpFacet` in
 * `@ptah-extension/harness-sync`, which takes the same backup before editing a
 * config file the user also hand-edits.
 */
const BACKUP_SUFFIX = '.ptah-bak';

/** The one key this writer is allowed to touch. */
const OUTPUT_STYLE_KEY = 'outputStyle';

/**
 * Longest fragment of a foreign diagnostic we will quote back.
 *
 * Shorter than `output-style-frontmatter.ts`'s cap on purpose: this one is
 * parenthesised inside a longer sentence rather than being the message itself.
 */
const MAX_DETAIL_LENGTH = 100;

export interface SetOutputStyleParityParams {
  readonly tier: SettingsTier;
  /** The style `name` to record, or `null` / `'default'` to clear the key (Req 2.4). */
  readonly styleName: string | null;
  /** Overrides the workspace provider. Absent → the provider's primary root. */
  readonly workspaceRoot?: string;
}

interface SettingsTarget {
  readonly absolutePath: string;
  /** `~`- or workspace-relative. The only form that may appear in a message. */
  readonly displayPath: string;
}

type TargetResult =
  | { readonly ok: true; readonly target: SettingsTarget }
  | { readonly ok: false; readonly error: OutputStyleOperationError };

type ParsedSettings =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Steps 4 and 5 of §4.3. An empty file is an empty object; anything else must
 * parse AND must be a plain object.
 */
function parseSettings(raw: string, displayPath: string): ParsedSettings {
  if (raw.trim().length === 0) return { ok: true, value: {} };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error: unknown) {
    // `JSON.parse` does not normally embed a path in its `SyntaxError`, but the
    // message is not ours and its shape is not a contract, so it is sanitised
    // rather than trusted (Req 7.6).
    const detail = sanitizeDiagnostic(errorMessage(error), MAX_DETAIL_LENGTH);
    return {
      ok: false,
      message:
        detail.length > 0
          ? `${displayPath} is not valid JSON (${detail}).`
          : `${displayPath} is not valid JSON.`,
    };
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      message: `${displayPath} does not contain a JSON object.`,
    };
  }

  return { ok: true, value: value as Record<string, unknown> };
}

@injectable()
export class ClaudeSettingsWriter {
  constructor(
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
  ) {}

  /**
   * §4.3 steps 1–11, in order. Returns rather than throws: the caller reports
   * the outcome beside an activation that has already succeeded.
   */
  async setOutputStyle(
    params: SetOutputStyleParityParams,
  ): Promise<OutputStyleParityOutcome> {
    // 1. Resolve the target.
    const resolved = this.resolveTarget(params.tier, params.workspaceRoot);
    if (!resolved.ok) {
      return { written: false, tier: params.tier, error: resolved.error };
    }
    const { absolutePath, displayPath } = resolved.target;
    const backupPath = `${absolutePath}${BACKUP_SUFFIX}`;
    const backupDisplayPath = `${displayPath}${BACKUP_SUFFIX}`;

    // 2. Does it already exist?
    let existed: boolean;
    try {
      existed = await this.fs.exists(absolutePath);
    } catch (error: unknown) {
      return this.writeFailure(
        params.tier,
        `${displayPath} could not be inspected. Nothing was changed.`,
        displayPath,
        error,
      );
    }

    // 3. Snapshot.
    let raw = '';
    if (existed) {
      try {
        raw = await this.fs.readFile(absolutePath);
      } catch (error: unknown) {
        return this.writeFailure(
          params.tier,
          `${displayPath} could not be read. Nothing was changed.`,
          displayPath,
          error,
        );
      }
    }

    // 4 + 5. Parse, or ABORT without ever reaching writeFile.
    const parsed = parseSettings(raw, displayPath);
    if (!parsed.ok) {
      this.logger.warn('[output-styles] parity write refused — unusable file', {
        tier: params.tier,
      });
      return {
        written: false,
        tier: params.tier,
        error: {
          code: 'SETTINGS_MALFORMED',
          message: `${parsed.message} Ptah did not change it — fix the file by hand, or choose a different one.`,
          path: displayPath,
        },
      };
    }

    // 6. Merge. Spread first so every unrelated key and its position survive.
    const next: Record<string, unknown> = { ...parsed.value };
    const styleName = params.styleName;
    if (styleName === null || styleName === DEFAULT_OUTPUT_STYLE_NAME) {
      delete next[OUTPUT_STYLE_KEY];
    } else {
      next[OUTPUT_STYLE_KEY] = styleName;
    }

    // 7. Backup, before anything is at risk.
    const backupWritten = await this.writeBackup(
      existed && raw.length > 0,
      backupPath,
      raw,
    );

    // 8. Pre-write re-read.
    if (existed) {
      let current: string;
      try {
        current = await this.fs.readFile(absolutePath);
      } catch (error: unknown) {
        await this.discardBackup(backupPath, backupWritten);
        return this.writeFailure(
          params.tier,
          `${displayPath} could not be re-read. Nothing was changed.`,
          displayPath,
          error,
        );
      }

      if (current !== raw) {
        // No write happened, so the backup has no insurance value left.
        await this.discardBackup(backupPath, backupWritten);
        this.logger.warn('[output-styles] parity write refused — conflict', {
          tier: params.tier,
        });
        return {
          written: false,
          tier: params.tier,
          error: {
            code: 'SETTINGS_CONFLICT',
            message: `${displayPath} changed on disk while Ptah was updating it. Nothing was written and your chosen style is unaffected — try again.`,
            path: displayPath,
          },
        };
      }
    }

    // 9. Write. 2-space JSON plus a trailing newline, matching what the CLI
    //    itself emits. `writeFile` creates parent directories (Req 2.3).
    try {
      await this.fs.writeFile(
        absolutePath,
        `${JSON.stringify(next, null, 2)}\n`,
      );
    } catch (error: unknown) {
      // 10 (failure half). The backup is deliberately RETAINED and named.
      this.logger.error(
        '[output-styles] parity write failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        written: false,
        tier: params.tier,
        error: {
          code: 'WRITE_FAILED',
          message: backupWritten
            ? `${displayPath} could not be written. Its previous contents were kept at ${backupDisplayPath}.`
            : `${displayPath} could not be written. Nothing was changed.`,
          path: displayPath,
        },
      };
    }

    // 10 (success half).
    await this.discardBackup(backupPath, backupWritten);

    // 11.
    return { written: true, writtenPath: displayPath, tier: params.tier };
  }

  private resolveTarget(
    tier: SettingsTier,
    explicitRoot: string | undefined,
  ): TargetResult {
    const fileName = SETTINGS_FILE_NAMES[tier];

    if (tier === 'user') {
      return {
        ok: true,
        target: {
          absolutePath: path.join(
            resolveHomeDirectory(),
            CLAUDE_DIR_SEGMENT,
            fileName,
          ),
          displayPath: `~/${CLAUDE_DIR_SEGMENT}/${fileName}`,
        },
      };
    }

    const workspaceRoot = this.resolveWorkspaceRoot(explicitRoot);
    if (workspaceRoot === undefined) {
      return {
        ok: false,
        error: {
          code: 'NO_WORKSPACE',
          message:
            'Open a folder first — this setting is stored inside the project.',
        },
      };
    }

    return {
      ok: true,
      target: {
        absolutePath: path.join(workspaceRoot, CLAUDE_DIR_SEGMENT, fileName),
        displayPath: `${CLAUDE_DIR_SEGMENT}/${fileName}`,
      },
    };
  }

  private resolveWorkspaceRoot(explicit?: string): string | undefined {
    if (explicit !== undefined && explicit.trim().length > 0) return explicit;
    try {
      return this.workspace.getWorkspaceRoot();
    } catch (error: unknown) {
      this.logger.warn('[output-styles] workspace root lookup failed', {
        error: errorMessage(error),
      });
      return undefined;
    }
  }

  /**
   * Best-effort. A backup that cannot be written is logged rather than fatal:
   * it is insurance, and if the directory is unwritable the real write below
   * fails anyway and reports properly.
   */
  private async writeBackup(
    wanted: boolean,
    backupPath: string,
    raw: string,
  ): Promise<boolean> {
    if (!wanted) return false;
    try {
      await this.fs.writeFile(backupPath, raw);
      return true;
    } catch (error: unknown) {
      this.logger.warn('[output-styles] settings backup could not be written', {
        error: errorMessage(error),
      });
      return false;
    }
  }

  /** Best-effort removal. A leftover backup is untidy, never harmful. */
  private async discardBackup(
    backupPath: string,
    backupWritten: boolean,
  ): Promise<void> {
    if (!backupWritten) return;
    try {
      await this.fs.delete(backupPath);
    } catch (error: unknown) {
      this.logger.debug('[output-styles] settings backup not removed', {
        error: errorMessage(error),
      });
    }
  }

  private writeFailure(
    tier: SettingsTier,
    message: string,
    displayPath: string,
    error: unknown,
  ): OutputStyleParityOutcome {
    this.logger.warn('[output-styles] parity write aborted', {
      tier,
      error: errorMessage(error),
    });
    return {
      written: false,
      tier,
      error: { code: 'WRITE_FAILED', message, path: displayPath },
    };
  }
}
