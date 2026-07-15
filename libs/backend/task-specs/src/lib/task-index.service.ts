/**
 * TaskIndexService — lazy start, file watcher, debounced reindex, and the
 * `onDidChangeIndex` event that drives the `tasks:changed` push.
 *
 * Responsibilities (R3.2–R3.5, R4.5, NFR-2, D3):
 *  - `ensureStarted(root)`: lazy full reindex + a single `createFileWatcher`
 *    (the EXISTING `IFileSystemProvider` port — no new platform port). Keyed
 *    per normalized workspace root; idempotent.
 *  - Watcher events are filtered to `<root>/.ptah/specs/`, ignoring
 *    `registry.md` (self-write) and `.archive/` + dot-folders, coalesced into a
 *    pending set behind a 300ms debounce so a burst of N writes in one folder
 *    yields ONE reindex + ONE event (NFR-2).
 *  - `reindex(root)` / every flush does a full scan → `replaceWorkspace`
 *    (DELETE + re-INSERT in one transaction) so the derived index is always
 *    equivalent to a fresh rebuild by construction (R3.2). The affected folder
 *    names ride on the event purely to decorate the push payload.
 *  - Write-order invariant (R3.5): `TaskWriterService` mutates `task.md` FIRST,
 *    then calls `applyFolderChange` (this class, via `ITaskIndexNotifier`),
 *    which reparses from disk — the DB is never written except from a parse of
 *    the file just written.
 */
import { inject, injectable } from 'tsyringe';
import * as path from 'path';
import {
  PLATFORM_TOKENS,
  createEvent,
  type IFileSystemProvider,
  type IFileWatcher,
  type IEvent,
  type IDisposable,
} from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type { TaskSpecDetail, TaskSpecSummary } from '@ptah-extension/shared';
import { normalizeWorkspaceRoot } from './normalize-workspace-root';
import { parseTaskFile } from './task-frontmatter';
import { TaskScannerService } from './task-scanner.service';
import { TASK_SPECS_TOKENS } from './di/tokens';
import type { ITaskIndexStore } from './task-index.store';
import type { ITaskIndexNotifier } from './task-index.port';

/** Fired whenever the derived index changes. Drives the `tasks:changed` push. */
export interface TaskIndexChangeEvent {
  /** normalized workspace root. */
  workspaceRoot: string;
  /** folders touched by this change (empty for a full reindex). */
  folderNames: string[];
  reason: 'watcher' | 'write' | 'reindex';
}

/** Result of an explicit `reindex()` call (the `tasks:reindex` RPC). */
export interface ReindexResult {
  indexedCount: number;
  excludedCount: number;
  durationMs: number;
}

/** Board/list payload assembled from the derived index. */
export interface IndexListResult {
  tasks: TaskSpecSummary[];
  excludedCount: number;
  specsDirExists: boolean;
}

/** Per-workspace watcher + debounce state. */
interface WorkspaceState {
  started: boolean;
  watcher: IFileWatcher | null;
  subscriptions: IDisposable[];
  specsDirExists: boolean;
  pending: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

const DEBOUNCE_MS = 300;
const CARRIER_FILE = 'task.md';
const REGISTRY_FILE = 'registry.md';
const SPECS_GLOB = '**/.ptah/specs/**';

@injectable()
export class TaskIndexService implements ITaskIndexNotifier {
  private readonly states = new Map<string, WorkspaceState>();
  private readonly _onDidChangeIndex: IEvent<TaskIndexChangeEvent>;
  private readonly fireChange: (e: TaskIndexChangeEvent) => void;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(TASK_SPECS_TOKENS.TASK_SCANNER)
    private readonly scanner: TaskScannerService,
    @inject(TASK_SPECS_TOKENS.TASK_INDEX_STORE)
    private readonly store: ITaskIndexStore,
  ) {
    const [event, fire] = createEvent<TaskIndexChangeEvent>();
    this._onDidChangeIndex = event;
    this.fireChange = fire;
  }

  /** Subscribe to derived-index changes (the RPC handler broadcasts these). */
  get onDidChangeIndex(): IEvent<TaskIndexChangeEvent> {
    return this._onDidChangeIndex;
  }

  /**
   * Lazy start: first call for a workspace performs a full (silent) reindex and
   * creates the watcher. Idempotent — later calls are cheap no-ops. No app
   * activation-file changes; the CLI never pays for a watcher it doesn't use.
   */
  async ensureStarted(workspaceRoot: string): Promise<void> {
    const root = normalizeWorkspaceRoot(workspaceRoot);
    const existing = this.states.get(root);
    if (existing?.started) return;

    const state: WorkspaceState = existing ?? {
      started: false,
      watcher: null,
      subscriptions: [],
      specsDirExists: false,
      pending: new Set<string>(),
      timer: null,
    };
    state.started = true;
    this.states.set(root, state);

    this.startWatcher(root, state);
    // Initial index is silent — the caller (RPC handler) returns the data
    // itself, so an extra push would be redundant noise.
    await this.rebuild(root, [], 'reindex', false);
  }

  /**
   * Explicit full reindex (`tasks:reindex`). Emits `reason: 'reindex'` so open
   * boards refresh.
   */
  async reindex(workspaceRoot: string): Promise<ReindexResult> {
    const root = normalizeWorkspaceRoot(workspaceRoot);
    const t0 = Date.now();
    await this.ensureStarted(root);
    const { indexedCount, excludedCount } = await this.rebuild(
      root,
      [],
      'reindex',
      true,
    );
    return { indexedCount, excludedCount, durationMs: Date.now() - t0 };
  }

  /**
   * Write-order hook (R3.5, `ITaskIndexNotifier`). Called by
   * `TaskWriterService` AFTER the `task.md` mutation. Reparses from disk and
   * emits `reason: 'write'` for the touched folder.
   */
  async applyFolderChange(
    workspaceRoot: string,
    folderName: string,
  ): Promise<void> {
    const root = normalizeWorkspaceRoot(workspaceRoot);
    await this.ensureStarted(root);
    await this.rebuild(root, [folderName], 'write', true);
  }

  /** Read the derived index for a workspace (list/board RPCs). */
  async list(
    workspaceRoot: string,
    filters?: Parameters<ITaskIndexStore['listByWorkspace']>[1],
  ): Promise<IndexListResult> {
    const root = normalizeWorkspaceRoot(workspaceRoot);
    await this.ensureStarted(root);
    let tasks: TaskSpecSummary[] = [];
    try {
      tasks = this.store.listByWorkspace(root, filters);
    } catch (error: unknown) {
      this.logger.error(
        '[task-specs] index list failed',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    const meta = this.safeGetMeta(root);
    const state = this.states.get(root);
    return {
      tasks,
      excludedCount: meta?.excludedCount ?? 0,
      specsDirExists: state?.specsDirExists ?? false,
    };
  }

  /**
   * Read a single task's full detail (`tasks:get`). Reads the folder directly
   * (the index only stores summaries) — body + folder artifacts.
   */
  async getDetail(
    workspaceRoot: string,
    folderName: string,
  ): Promise<TaskSpecDetail | null> {
    const root = normalizeWorkspaceRoot(workspaceRoot);
    const folderDir = path.join(root, '.ptah', 'specs', folderName);
    const carrier = path.join(folderDir, CARRIER_FILE);
    try {
      if (!(await this.fs.exists(carrier))) return null;
      const raw = await this.fs.readFile(carrier);
      const parsed = parseTaskFile(folderName, raw);
      if (parsed.kind !== 'task') return null;
      const artifacts = await this.listArtifacts(folderDir);
      return { ...parsed.task, body: parsed.body, artifacts };
    } catch (error: unknown) {
      this.logger.warn('[task-specs] getDetail failed', {
        folderName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** Tear down all watchers + pending timers (container disposal). */
  dispose(): void {
    for (const state of this.states.values()) {
      if (state.timer) clearTimeout(state.timer);
      for (const sub of state.subscriptions) sub.dispose();
      state.watcher?.dispose();
    }
    this.states.clear();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private startWatcher(root: string, state: WorkspaceState): void {
    if (state.watcher) return;
    try {
      const watcher = this.fs.createFileWatcher(SPECS_GLOB);
      state.watcher = watcher;
      state.subscriptions.push(
        watcher.onDidChange((p) => this.onWatchEvent(root, p)),
        watcher.onDidCreate((p) => this.onWatchEvent(root, p)),
        watcher.onDidDelete((p) => this.onWatchEvent(root, p)),
      );
    } catch (error: unknown) {
      // A host without a real watcher (or a failure) degrades to
      // reindex-on-RPC — the index is still correct, just not live.
      this.logger.warn('[task-specs] watcher unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private onWatchEvent(root: string, rawPath: string): void {
    const folderName = this.extractFolder(root, rawPath);
    if (!folderName) return;
    const state = this.states.get(root);
    if (!state) return;
    state.pending.add(folderName);
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      void this.flush(root);
    }, DEBOUNCE_MS);
  }

  /**
   * Map a raw watcher path to the affected task folder name, or null when the
   * event is outside `<root>/.ptah/specs/`, is the generated `registry.md`, or
   * targets `.archive/` / a dot-folder.
   */
  private extractFolder(root: string, rawPath: string): string | null {
    const norm = rawPath.replace(/\\/g, '/');
    const prefix = `${root.replace(/\\/g, '/')}/.ptah/specs/`;
    if (norm.toLowerCase().indexOf(prefix.toLowerCase()) !== 0) return null;
    const rest = norm.slice(prefix.length);
    if (rest.length === 0) return null;
    const folderName = rest.split('/')[0];
    if (!folderName) return null;
    if (folderName === REGISTRY_FILE) return null; // generated file at specs root
    if (folderName.startsWith('.')) return null; // .archive/ + dot-dirs
    return folderName;
  }

  private async flush(root: string): Promise<void> {
    const state = this.states.get(root);
    if (!state) return;
    state.timer = null;
    const folderNames = [...state.pending];
    state.pending.clear();
    await this.rebuild(root, folderNames, 'watcher', true);
  }

  /**
   * Full scan → single-transaction `replaceWorkspace`. Guarantees the derived
   * index equals a fresh rebuild (R3.2). `emit` gates the push so the silent
   * warm-up during `ensureStarted` doesn't broadcast.
   */
  private async rebuild(
    root: string,
    folderNames: string[],
    reason: TaskIndexChangeEvent['reason'],
    emit: boolean,
  ): Promise<{ indexedCount: number; excludedCount: number }> {
    const scan = await this.scanner.scan(root);
    const summaries: TaskSpecSummary[] = scan.tasks.map(
      ({ body: _body, ...summary }) => summary,
    );
    try {
      this.store.replaceWorkspace(root, summaries, scan.excluded.length);
    } catch (error: unknown) {
      this.logger.error(
        '[task-specs] index rebuild write failed',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    const state = this.states.get(root);
    if (state) state.specsDirExists = scan.specsDirExists;
    if (emit) {
      this.fireChange({ workspaceRoot: root, folderNames, reason });
    }
    return {
      indexedCount: summaries.length,
      excludedCount: scan.excluded.length,
    };
  }

  private safeGetMeta(root: string): ReturnType<ITaskIndexStore['getMeta']> {
    try {
      return this.store.getMeta(root);
    } catch (error: unknown) {
      this.logger.warn('[task-specs] index getMeta failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async listArtifacts(folderDir: string): Promise<string[]> {
    try {
      const entries = await this.fs.readDirectory(folderDir);
      return entries.map((e) => e.name).sort();
    } catch {
      return [];
    }
  }
}
