/**
 * Tier discovery for output styles.
 *
 * Reproduces the SDK's own merge order so Ptah's list agrees with what a
 * session will actually resolve, then states the outcome as DATA rather than
 * leaving the frontend to re-derive it:
 *
 *   entries written over  [ built-ins, user files, project files ]
 *   last write wins  →    project beats user, and ANY file style shadows a
 *                         same-named built-in.
 *
 * Losers are still listed, flagged `shadowed`, so a name collision shows up as
 * an explained pair of rows instead of two identical-looking ones (E4).
 *
 * Invalid files are LISTED, never omitted (Req 7.1) — a style that silently
 * vanished because of a typo is the failure mode this surface exists to fix.
 *
 * A missing `output-styles` directory is a normal state, not an error
 * (Req 1.5). Nothing in here throws past its boundary.
 *
 * All I/O goes through `IFileSystemProvider`; there is no `node:fs` import.
 * `node:path` is used for pure string computation only, which is not I/O and
 * therefore not port-mediated.
 *
 * Plugin-tier discovery is deliberately absent. The `'plugin'` tier is modelled
 * in the contracts so the renderer and the activation predicate stay total, but
 * nothing enumerates it yet.
 */
import * as path from 'path';
import { homedir } from 'os';
import { inject, injectable } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  FileType,
  type IFileSystemProvider,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  ActiveOutputStyleState,
  InvalidOutputStyle,
  OutputStyleEntry,
  OutputStyleTier,
} from '@ptah-extension/shared';
import { BUILT_IN_OUTPUT_STYLES } from './built-in-output-styles';
import { parseOutputStyleFile } from './output-style-frontmatter';

/** The directory, relative to a tier root, that both file tiers live in. */
export const OUTPUT_STYLES_DIR_SEGMENTS = ['.claude', 'output-styles'] as const;

/** The two tiers that are backed by files on disk, in SDK merge order. */
export const FILE_OUTPUT_STYLE_TIERS = ['user', 'project'] as const;
export type FileOutputStyleTier = (typeof FILE_OUTPUT_STYLE_TIERS)[number];

export interface DiscoverOutputStylesOptions {
  /** Overrides the workspace provider. Absent → the provider's primary root. */
  readonly workspaceRoot?: string;
  /**
   * Ptah's persisted selection, so discovery can resolve which tier won it and
   * whether it still resolves at all (E5). Supplied by the caller because the
   * selection lives in Ptah's own settings store, not on disk beside the
   * styles.
   */
  readonly activeName?: string | null;
}

/** Exactly the payload of `outputStyle:list`. */
export interface OutputStyleDiscoveryResult {
  readonly styles: readonly OutputStyleEntry[];
  readonly invalid: readonly InvalidOutputStyle[];
  readonly active: ActiveOutputStyleState;
}

/**
 * The user's home directory.
 *
 * `$HOME` / `$USERPROFILE` are consulted first so a test (or a sandboxed host)
 * can redirect the user tier without touching the real profile — the same
 * idiom the CLI adapters in `cli-agent-runtime` use. There is no home-directory
 * port to route this through.
 */
export function resolveHomeDirectory(): string {
  return process.env['HOME'] || process.env['USERPROFILE'] || homedir();
}

/** `~/.claude/output-styles`. */
export function userOutputStyleDirectory(): string {
  return path.join(resolveHomeDirectory(), ...OUTPUT_STYLES_DIR_SEGMENTS);
}

/** `<workspaceRoot>/.claude/output-styles`. */
export function projectOutputStyleDirectory(workspaceRoot: string): string {
  return path.join(workspaceRoot, ...OUTPUT_STYLES_DIR_SEGMENTS);
}

/**
 * The directory for a file-backed tier, or `undefined` when it cannot exist —
 * which for the project tier means "no workspace is open".
 */
export function outputStyleDirectoryFor(
  tier: FileOutputStyleTier,
  workspaceRoot: string | undefined,
): string | undefined {
  if (tier === 'user') return userOutputStyleDirectory();
  return workspaceRoot === undefined
    ? undefined
    : projectOutputStyleDirectory(workspaceRoot);
}

/**
 * A path safe to show a user: `~`-relative for the user tier, workspace-relative
 * for the project tier. Never an absolute host path (Req 7.6).
 */
export function toDisplayPath(
  tier: FileOutputStyleTier,
  fileName: string,
): string {
  const prefix = tier === 'user' ? '~/' : '';
  return `${prefix}${OUTPUT_STYLES_DIR_SEGMENTS.join('/')}/${fileName}`;
}

function isMarkdownFile(entry: { name: string; type: FileType }): boolean {
  return entry.type === FileType.File && /\.md$/i.test(entry.name);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@injectable()
export class OutputStyleDiscoveryService {
  constructor(
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
  ) {}

  /**
   * The workspace root this discovery run is scoped to. `getWorkspaceRoot()` is
   * SYNCHRONOUS and may be `undefined` — no workspace open is a supported
   * state, and it simply means the project tier does not exist.
   */
  resolveWorkspaceRoot(explicit?: string): string | undefined {
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

  async discover(
    options: DiscoverOutputStylesOptions = {},
  ): Promise<OutputStyleDiscoveryResult> {
    const workspaceRoot = this.resolveWorkspaceRoot(options.workspaceRoot);

    // Built-ins are seeded FIRST, exactly as the binary does, so anything found
    // on disk with the same name lands after them and wins.
    const ordered: OutputStyleEntry[] = [...BUILT_IN_OUTPUT_STYLES];
    const invalid: InvalidOutputStyle[] = [];

    for (const tier of FILE_OUTPUT_STYLE_TIERS) {
      const directory = outputStyleDirectoryFor(tier, workspaceRoot);
      if (directory === undefined) continue;
      const scanned = await this.scanTier(tier, directory);
      ordered.push(...scanned.styles);
      invalid.push(...scanned.invalid);
    }

    const styles = this.flagShadowed(ordered);
    const winners = new Map<string, OutputStyleEntry>();
    for (const style of styles) {
      if (!style.shadowed) winners.set(style.name, style);
    }

    return {
      styles,
      invalid,
      active: this.resolveActive(options.activeName ?? null, winners),
    };
  }

  /**
   * Read one tier's directory. A missing directory, an unreadable directory and
   * an unreadable file are all normal outcomes here — the first two produce an
   * empty tier, the third produces a listed `READ_FAILED` row.
   */
  private async scanTier(
    tier: FileOutputStyleTier,
    directory: string,
  ): Promise<{
    styles: OutputStyleEntry[];
    invalid: InvalidOutputStyle[];
  }> {
    const styles: OutputStyleEntry[] = [];
    const invalid: InvalidOutputStyle[] = [];

    let fileNames: string[];
    try {
      if (!(await this.fs.exists(directory))) return { styles, invalid };
      const entries = await this.fs.readDirectory(directory);
      fileNames = entries
        .filter(isMarkdownFile)
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
    } catch (error: unknown) {
      // Req 1.5: an absent or unreadable styles directory is not an error the
      // user needs to see. It is logged and the tier is simply empty.
      this.logger.debug('[output-styles] tier directory not readable', {
        tier,
        error: errorMessage(error),
      });
      return { styles, invalid };
    }

    for (const fileName of fileNames) {
      const absolute = path.join(directory, fileName);
      const relativePath = toDisplayPath(tier, fileName);

      let content: string;
      try {
        content = await this.fs.readFile(absolute);
      } catch (error: unknown) {
        this.logger.warn('[output-styles] style file unreadable', {
          tier,
          fileName,
          error: errorMessage(error),
        });
        invalid.push({
          fileName,
          relativePath,
          tier,
          error: {
            code: 'READ_FAILED',
            message: `"${fileName}" could not be read.`,
          },
          openable: false,
        });
        continue;
      }

      const parsed = parseOutputStyleFile(content, fileName);
      if (!parsed.ok) {
        invalid.push({
          fileName,
          relativePath,
          tier,
          error: parsed.error,
          // Req 7.5: both file tiers are Ptah-writable, so an invalid file in
          // either can be opened in the editor sub-view and fixed.
          openable: true,
        });
        continue;
      }

      styles.push({
        name: parsed.style.name,
        tier,
        description: parsed.style.description,
        keepCodingInstructions: parsed.style.keepCodingInstructions,
        editable: true,
        deletable: true,
        body: parsed.style.body,
        fileName,
        relativePath,
        shadowed: false,
      });
    }

    return { styles, invalid };
  }

  /**
   * Mark every entry that a later one outranks. `ordered` is already in SDK
   * merge order, so "later" is literally "wins" — walking backwards and taking
   * the first sighting of each name gives the winners in one pass.
   */
  private flagShadowed(
    ordered: readonly OutputStyleEntry[],
  ): OutputStyleEntry[] {
    const seen = new Set<string>();
    const flagged: OutputStyleEntry[] = new Array(ordered.length);

    for (let i = ordered.length - 1; i >= 0; i--) {
      const entry = ordered[i];
      const shadowed = seen.has(entry.name);
      seen.add(entry.name);
      flagged[i] = { ...entry, shadowed };
    }

    return flagged;
  }

  private resolveActive(
    activeName: string | null,
    winners: ReadonlyMap<string, OutputStyleEntry>,
  ): ActiveOutputStyleState {
    if (activeName === null || activeName.length === 0) {
      return { name: null, tier: null, missing: false };
    }

    const winner = winners.get(activeName);
    if (winner === undefined) {
      // E5: the selection survived but the file behind it did not. The UI names
      // the orphan rather than showing a phantom healthy style.
      return { name: activeName, tier: null, missing: true };
    }

    const tier: OutputStyleTier = winner.tier;
    return { name: activeName, tier, missing: false };
  }
}
