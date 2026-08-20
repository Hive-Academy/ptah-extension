/**
 * Create / edit / delete of the `.md` files behind user- and project-tier
 * output styles.
 *
 * Upsert by design: create and edit share ONE path, so renaming an active
 * style is a single server-side operation instead of a client-orchestrated
 * delete-then-create that can half-fail (Req 4.4).
 *
 * Identity is the frontmatter `name`, never the filename (E1). That is why an
 * edit LOCATES its file by parsing the tier directory rather than by
 * recomputing a slug from the old name: a hand-authored `foo.md` holding
 * `name: Bar` must be edited in place, not orphaned beside a fresh `bar.md`.
 * The slug decides only where a NEW file is stored.
 *
 * E8 concurrent-edit guard: the caller captures `mtime` + byte length when the
 * style is opened and echoes both back on save. `mtime` alone is not enough —
 * the shared FS contract suite (`run-file-system-contract.ts`) asserts only
 * `type` and `size` on `stat`, so `mtime` is not guaranteed across adapters and
 * byte length is the belt-and-braces half of the check.
 *
 * All I/O is through `IFileSystemProvider`; there is no `node:fs` import.
 * `node:path` is pure string computation, which is not I/O and therefore not
 * port-mediated.
 *
 * Nothing here throws past its boundary — every failure is a typed
 * `OutputStyleOperationError` whose message is display-ready and whose `path`
 * is workspace- or `~`-relative, never an absolute host path (Req 7.6).
 */
import * as path from 'path';
import { inject, injectable } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  FileType,
  type FileStat,
  type IFileSystemProvider,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  OutputStyleOperationError,
  WritableOutputStyleTier,
} from '@ptah-extension/shared';
import {
  outputStyleDirectoryFor,
  toDisplayPath,
} from './output-style-discovery.service';
import {
  parseOutputStyleFile,
  serializeOutputStyleFile,
} from './output-style-frontmatter';
import { slugifyStyleName, styleFileName } from './output-style-slug';

/** Where one style file lives, in both the host form and the display form. */
export interface OutputStyleFileLocation {
  /** Basename with extension. */
  readonly fileName: string;
  /** Absolute host path. Never surfaced to a user. */
  readonly absolutePath: string;
  /** `~`-relative (user tier) or workspace-relative (project tier). Safe to display. */
  readonly displayPath: string;
}

/** The `stat` half of the E8 guard, captured when a style is opened for editing. */
export interface OutputStyleGuardStamp {
  readonly mtime: number;
  readonly byteLength: number;
}

/** Tier + workspace scoping, shared by every operation on this service. */
export interface OutputStyleFileTarget {
  readonly tier: WritableOutputStyleTier;
  /** Overrides the workspace provider. Absent → the provider's primary root. */
  readonly workspaceRoot?: string;
}

export interface SaveOutputStyleParams extends OutputStyleFileTarget {
  /** The new frontmatter `name`. Blank or whitespace-only is rejected (Req 3.5). */
  readonly name: string;
  readonly description: string;
  readonly keepCodingInstructions: boolean;
  /** Markdown body, written verbatim (Req 4.3). */
  readonly body: string;
  /** The `name` this style had before the edit. Absent means "create". */
  readonly originalName?: string;
  /** `mtime` captured when the style was opened (E8). */
  readonly expectedMtime?: number;
  /** Byte length captured when the style was opened (E8). */
  readonly expectedByteLength?: number;
  /** Required to write over a DIFFERENT existing file in the target tier (Req 3.4). */
  readonly overwrite?: boolean;
}

export interface DeleteOutputStyleParams extends OutputStyleFileTarget {
  /** The frontmatter `name`, never a filename (E1). */
  readonly name: string;
}

export type StatOutputStyleParams = DeleteOutputStyleParams;

export type SaveOutputStyleResult =
  | {
      readonly ok: true;
      readonly location: OutputStyleFileLocation;
      /** Set when the save changed the style's `name`, so the caller can rebind the selection (Req 4.4). */
      readonly renamedFrom?: string;
    }
  | { readonly ok: false; readonly error: OutputStyleOperationError };

export type DeleteOutputStyleResult =
  | { readonly ok: true; readonly location: OutputStyleFileLocation }
  | { readonly ok: false; readonly error: OutputStyleOperationError };

export type StatOutputStyleResult =
  | {
      readonly ok: true;
      readonly location: OutputStyleFileLocation;
      readonly stamp: OutputStyleGuardStamp;
    }
  | { readonly ok: false; readonly error: OutputStyleOperationError };

type DirectoryResult =
  | { readonly ok: true; readonly directory: string }
  | { readonly ok: false; readonly error: OutputStyleOperationError };

function failure(
  code: OutputStyleOperationError['code'],
  message: string,
  displayPath?: string,
): { readonly ok: false; readonly error: OutputStyleOperationError } {
  return {
    ok: false,
    error:
      displayPath === undefined
        ? { code, message }
        : { code, message, path: displayPath },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMarkdownFile(entry: { name: string; type: FileType }): boolean {
  return entry.type === FileType.File && /\.md$/i.test(entry.name);
}

@injectable()
export class OutputStyleFileWriter {
  constructor(
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
  ) {}

  /**
   * Create or update one style file.
   *
   * Order of operations is deliberate: the new file is written BEFORE the old
   * one is removed on a rename, so an interrupted save leaves two files rather
   * than none.
   */
  async save(params: SaveOutputStyleParams): Promise<SaveOutputStyleResult> {
    const name = params.name.trim();
    if (name.length === 0) {
      return failure('INVALID_NAME', 'A style name is required.');
    }

    const slug = slugifyStyleName(name);
    if (!slug.ok) return { ok: false, error: slug.error };

    const directory = this.resolveDirectory(params.tier, params.workspaceRoot);
    if (!directory.ok) return directory;

    const fileName = styleFileName(slug.slug);
    const slugged: OutputStyleFileLocation = {
      fileName,
      absolutePath: path.join(directory.directory, fileName),
      displayPath: toDisplayPath(params.tier, fileName),
    };

    const originalName = params.originalName?.trim() ?? '';
    const isEdit = originalName.length > 0;

    let existing: OutputStyleFileLocation | undefined;
    if (isEdit) {
      existing = await this.locate(
        params.tier,
        directory.directory,
        originalName,
      );
      if (existing === undefined) {
        return failure(
          'NOT_FOUND',
          `"${originalName}" no longer exists in this tier, so there was nothing to update.`,
        );
      }

      const stale = await this.isStale(existing.absolutePath, params);
      if (stale) {
        return failure(
          'STALE_FILE',
          `"${existing.fileName}" changed on disk after it was opened. Nothing was written — reload the style and apply your edit again.`,
          existing.displayPath,
        );
      }
    }

    // An edit that does not change the `name` writes back to the file it came
    // from, whatever that file happens to be called. Re-slugging every save
    // would quietly rename a hand-authored `legacy.md` to `house-style.md` on
    // an unrelated description tweak — the filename is storage, and storage
    // does not get to move because identity was re-serialised (E1).
    const renamed = isEdit && originalName !== name;
    const target: OutputStyleFileLocation =
      existing !== undefined && !renamed ? existing : slugged;

    const collides = await this.collides(target, existing);
    if (collides && params.overwrite !== true) {
      return failure(
        'FILE_EXISTS',
        `"${target.fileName}" already exists in this tier. Choose a different name, or confirm the overwrite.`,
        target.displayPath,
      );
    }

    const content = serializeOutputStyleFile({
      name,
      description: params.description,
      keepCodingInstructions: params.keepCodingInstructions,
      body: params.body,
    });

    try {
      await this.fs.writeFile(target.absolutePath, content);
    } catch (error: unknown) {
      this.logger.error(
        '[output-styles] style file write failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      return failure(
        'WRITE_FAILED',
        `"${target.fileName}" could not be written. Nothing was changed.`,
        target.displayPath,
      );
    }

    // A rename moved the content to a new basename; the old file is now a
    // duplicate of the same style and must go, or discovery lists both.
    if (
      existing !== undefined &&
      existing.absolutePath !== target.absolutePath
    ) {
      try {
        await this.fs.delete(existing.absolutePath);
      } catch (error: unknown) {
        // The new file is already on disk, so the save SUCCEEDED. A leftover
        // old file is a listing nuisance, not a data loss, and failing the
        // whole operation here would be a worse answer than logging it.
        this.logger.warn('[output-styles] stale style file not removed', {
          fileName: existing.fileName,
          error: errorMessage(error),
        });
      }
    }

    return {
      ok: true,
      location: target,
      renamedFrom: renamed ? originalName : undefined,
    };
  }

  /** Remove one style file, located by its frontmatter `name` (Req 4.5). */
  async delete(
    params: DeleteOutputStyleParams,
  ): Promise<DeleteOutputStyleResult> {
    const name = params.name.trim();
    if (name.length === 0) {
      return failure('INVALID_NAME', 'A style name is required.');
    }

    const directory = this.resolveDirectory(params.tier, params.workspaceRoot);
    if (!directory.ok) return directory;

    const existing = await this.locate(params.tier, directory.directory, name);
    if (existing === undefined) {
      return failure(
        'NOT_FOUND',
        `"${name}" was not found in this tier, so there was nothing to delete.`,
      );
    }

    try {
      await this.fs.delete(existing.absolutePath);
    } catch (error: unknown) {
      this.logger.error(
        '[output-styles] style file delete failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      return failure(
        'DELETE_FAILED',
        `"${existing.fileName}" could not be deleted.`,
        existing.displayPath,
      );
    }

    return { ok: true, location: existing };
  }

  /**
   * Capture the E8 guard stamp for a style. This is the "on read" half — the
   * caller echoes both values back on `save`, which re-checks them.
   */
  async stat(params: StatOutputStyleParams): Promise<StatOutputStyleResult> {
    const name = params.name.trim();
    if (name.length === 0) {
      return failure('INVALID_NAME', 'A style name is required.');
    }

    const directory = this.resolveDirectory(params.tier, params.workspaceRoot);
    if (!directory.ok) return directory;

    const existing = await this.locate(params.tier, directory.directory, name);
    if (existing === undefined) {
      return failure('NOT_FOUND', `"${name}" was not found in this tier.`);
    }

    let stat: FileStat;
    try {
      stat = await this.fs.stat(existing.absolutePath);
    } catch (error: unknown) {
      this.logger.warn('[output-styles] style file stat failed', {
        fileName: existing.fileName,
        error: errorMessage(error),
      });
      return failure(
        'NOT_FOUND',
        `"${existing.fileName}" could not be inspected.`,
        existing.displayPath,
      );
    }

    return {
      ok: true,
      location: existing,
      stamp: { mtime: stat.mtime, byteLength: stat.size },
    };
  }

  /**
   * The directory a tier writes into. The project tier is the only one that
   * can be absent, and only because `getWorkspaceRoot()` is synchronous and may
   * legitimately return `undefined` when no folder is open.
   */
  private resolveDirectory(
    tier: WritableOutputStyleTier,
    explicitRoot: string | undefined,
  ): DirectoryResult {
    const workspaceRoot = this.resolveWorkspaceRoot(explicitRoot);
    const directory = outputStyleDirectoryFor(tier, workspaceRoot);
    if (directory === undefined) {
      return failure(
        'NO_WORKSPACE',
        'Open a folder before saving a project style — a project style is stored inside the project.',
      );
    }
    return { ok: true, directory };
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
   * Find the file in `directory` whose parsed frontmatter `name` matches.
   *
   * A scan rather than a slug round-trip, because the filename is storage and
   * the `name` is identity (E1) — the two are only incidentally related for
   * files Ptah itself wrote.
   */
  private async locate(
    tier: WritableOutputStyleTier,
    directory: string,
    name: string,
  ): Promise<OutputStyleFileLocation | undefined> {
    let fileNames: string[];
    try {
      if (!(await this.fs.exists(directory))) return undefined;
      fileNames = (await this.fs.readDirectory(directory))
        .filter(isMarkdownFile)
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
    } catch (error: unknown) {
      this.logger.debug('[output-styles] tier directory not readable', {
        tier,
        error: errorMessage(error),
      });
      return undefined;
    }

    for (const fileName of fileNames) {
      const absolutePath = path.join(directory, fileName);
      let content: string;
      try {
        content = await this.fs.readFile(absolutePath);
      } catch (error: unknown) {
        this.logger.warn(
          '[output-styles] style file unreadable during locate',
          {
            tier,
            fileName,
            error: errorMessage(error),
          },
        );
        continue;
      }

      const parsed = parseOutputStyleFile(content, fileName);
      if (parsed.ok && parsed.style.name === name) {
        return {
          fileName,
          absolutePath,
          displayPath: toDisplayPath(tier, fileName),
        };
      }
    }

    return undefined;
  }

  /**
   * E8. `size` is authoritative because the FS contract suite guarantees it on
   * every adapter; `mtime` is an ADDITIONAL signal and is only compared when
   * the adapter actually supplied one (a zero means "no signal", not "epoch").
   */
  private async isStale(
    absolutePath: string,
    params: SaveOutputStyleParams,
  ): Promise<boolean> {
    if (
      params.expectedMtime === undefined &&
      params.expectedByteLength === undefined
    ) {
      return false;
    }

    let stat: FileStat;
    try {
      stat = await this.fs.stat(absolutePath);
    } catch (error: unknown) {
      // The file was located a moment ago and cannot be stat'ed now — treat
      // that as changed rather than as safe.
      this.logger.warn('[output-styles] stale check could not stat the file', {
        error: errorMessage(error),
      });
      return true;
    }

    if (
      params.expectedByteLength !== undefined &&
      stat.size !== params.expectedByteLength
    ) {
      return true;
    }
    return (
      params.expectedMtime !== undefined &&
      stat.mtime > 0 &&
      stat.mtime !== params.expectedMtime
    );
  }

  /**
   * True when the target basename is already taken by a DIFFERENT file. Writing
   * back over the file this save is editing is not a collision.
   */
  private async collides(
    target: OutputStyleFileLocation,
    existing: OutputStyleFileLocation | undefined,
  ): Promise<boolean> {
    if (
      existing !== undefined &&
      existing.absolutePath === target.absolutePath
    ) {
      return false;
    }
    try {
      return await this.fs.exists(target.absolutePath);
    } catch (error: unknown) {
      this.logger.warn('[output-styles] collision check failed', {
        fileName: target.fileName,
        error: errorMessage(error),
      });
      // Unknown existence is treated as "occupied": refusing a save is
      // recoverable, silently overwriting somebody's file is not.
      return true;
    }
  }
}
