/**
 * RecentWorkspacesService — the persisted most-recently-used workspace list
 * behind `workspace:listRecent` (TASK_2026_721, plan component 2, D4).
 *
 * Host-neutral: it sits on the existing `IStateStorage` and
 * `IFileSystemProvider.exists` ports, which every host binds, so no new port
 * is needed.
 *
 * - `record(path)` puts the path first, dedupes on `normalizeWorkspaceRoot`
 *   (separator and drive-letter variants are one workspace) and caps the
 *   list at {@link RECENT_WORKSPACES_MAX}. Writes run one at a time on an
 *   internal promise chain, so two quick switches cannot overwrite each other.
 * - `list()` drops stored entries that fail the schema, checks every path in
 *   parallel with a per-path timeout, and hides the paths reported missing.
 *   It never deletes them from storage: `exists` also reports `false` for an
 *   unreadable or offline drive, and that folder must come back when the
 *   drive does. A truly deleted folder ages out through the cap as new
 *   workspaces are recorded. A check that times out or throws keeps its entry.
 * - `record()` ignores paths that are not absolute.
 *
 * Absolute paths are logged at debug level only.
 */
import { isAbsolute } from 'node:path';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  normalizeWorkspaceRoot,
} from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  IStateStorage,
} from '@ptah-extension/platform-core';
import {
  RECENT_WORKSPACES_MAX,
  RecentWorkspaceSchema,
  type RecentWorkspace,
} from '@ptah-extension/shared';

const LOG_PREFIX = '[RecentWorkspacesService]';
const MAX_PATH_LENGTH = 4096;
const MAX_NAME_LENGTH = 255;

type ExistsOutcome = 'present' | 'missing' | 'unknown';

@injectable()
export class RecentWorkspacesService {
  /** Global (per-user) state key of the MRU array. */
  static readonly STORAGE_KEY = 'ptah.recentWorkspaces';

  /** Per-path budget for `exists`; the checks run in parallel. */
  static readonly EXISTS_TIMEOUT_MS = 1_500;

  /** Tail of the serialised write queue. Never left rejected. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.STATE_STORAGE)
    private readonly storage: IStateStorage,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fileSystem: IFileSystemProvider,
  ) {}

  /** Move `workspacePath` to the front of the list (newest first). */
  record(workspacePath: string): Promise<void> {
    return this.enqueue(() => this.recordNow(workspacePath));
  }

  /** The remembered workspaces not reported missing, newest first. */
  async list(): Promise<RecentWorkspace[]> {
    const stored = this.readStored();
    if (stored.length === 0) {
      return [];
    }

    const outcomes = await Promise.all(
      stored.map((entry) => this.checkExists(entry.path)),
    );
    return stored.filter((_, i) => outcomes[i] !== 'missing');
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.writeChain.then(task);
    // degradation-audit: reported — the caller receives this rejection through
    // `run`; the chain itself must stay resolved so later writes still run.
    this.writeChain = run.catch(() => undefined);
    return run;
  }

  private async recordNow(workspacePath: string): Promise<void> {
    if (
      workspacePath.length > MAX_PATH_LENGTH ||
      !isAbsolute(workspacePath)
    ) {
      this.logger.debug(`${LOG_PREFIX} ignoring an unusable path`, {
        length: workspacePath.length,
      });
      return;
    }
    const key = normalizeWorkspaceRoot(workspacePath);
    const entry: RecentWorkspace = {
      path: workspacePath,
      name: workspaceName(workspacePath),
      lastOpenedAt: Date.now(),
    };
    const rest = this.readStored().filter(
      (stored) => normalizeWorkspaceRoot(stored.path) !== key,
    );
    const next = [entry, ...rest].slice(0, RECENT_WORKSPACES_MAX);
    await this.storage.update(RecentWorkspacesService.STORAGE_KEY, next);
    this.logger.debug(`${LOG_PREFIX} recorded`, {
      path: workspacePath,
      count: next.length,
    });
  }

  /**
   * Stored entries that pass the schema, newest first, deduped and capped.
   * Unreadable or non-array data yields `[]` with a warning.
   */
  private readStored(): RecentWorkspace[] {
    let raw: unknown;
    try {
      raw = this.storage.get<unknown>(RecentWorkspacesService.STORAGE_KEY);
    } catch (error: unknown) {
      // degradation-audit: reported — logged below; an unreadable list is
      // shown as "no recent workspaces" (plan component 2 failure behaviour).
      this.logger.warn(`${LOG_PREFIX} could not read the stored list`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
    if (raw === undefined || raw === null) {
      return [];
    }
    if (!Array.isArray(raw)) {
      this.logger.warn(`${LOG_PREFIX} stored list is not an array; ignoring`, {
        type: typeof raw,
      });
      return [];
    }

    const valid: RecentWorkspace[] = [];
    for (const item of raw) {
      const parsed = RecentWorkspaceSchema.safeParse(item);
      if (parsed.success) {
        valid.push(parsed.data);
      }
    }
    if (valid.length !== raw.length) {
      this.logger.warn(`${LOG_PREFIX} dropped invalid stored entries`, {
        dropped: raw.length - valid.length,
      });
    }

    // Array.prototype.sort is stable, so equal timestamps keep stored order.
    valid.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    const seen = new Set<string>();
    const unique: RecentWorkspace[] = [];
    for (const entry of valid) {
      const key = normalizeWorkspaceRoot(entry.path);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(entry);
      }
    }
    return unique.slice(0, RECENT_WORKSPACES_MAX);
  }

  private async checkExists(workspacePath: string): Promise<ExistsOutcome> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<ExistsOutcome>((resolve) => {
      timer = setTimeout(
        () => resolve('unknown'),
        RecentWorkspacesService.EXISTS_TIMEOUT_MS,
      );
    });
    // Started inside a `then` so a synchronous throw from the adapter is a
    // rejection here, not an exception out of `list()`.
    const check = Promise.resolve()
      .then(() => this.fileSystem.exists(workspacePath))
      .then((exists): ExistsOutcome => (exists ? 'present' : 'missing'));
    try {
      return await Promise.race([check, timeout]);
    } catch (error: unknown) {
      // degradation-audit: reported — logged below; a failed check keeps the
      // entry rather than deleting a workspace that may still exist.
      this.logger.debug(`${LOG_PREFIX} exists check failed; keeping entry`, {
        path: workspacePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return 'unknown';
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Last path segment, ignoring trailing separators; the path for a root. */
function workspaceName(workspacePath: string): string {
  const trimmed = workspacePath.replace(/[/\\]+$/, '');
  const segment = trimmed.split(/[/\\]/).pop() ?? '';
  const name = segment.length > 0 ? segment : workspacePath;
  return name.slice(0, MAX_NAME_LENGTH);
}
