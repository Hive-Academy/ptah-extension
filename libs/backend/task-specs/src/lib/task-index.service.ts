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
import {
  CARRIER_FILE,
  SPECS_README_FILE,
  renderSpecsReadme,
  roundJudgeFile,
  type DocFile,
  type ExcludedTaskFolder,
  type TaskSpecDetail,
  type TaskSpecSummary,
} from '@ptah-extension/shared';
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
  /**
   * Every skipped folder BY NAME with its typed reason. `excludedCount` stays
   * alongside it as the authoritative total, so a store that lost its rows can
   * still report the magnitude honestly rather than claiming zero.
   */
  excluded: ExcludedTaskFolder[];
  excludedCount: number;
  specsDirExists: boolean;
}

/** Per-workspace watcher + debounce state. */
interface WorkspaceState {
  started: boolean;
  /**
   * The in-flight first start, if any. Concurrent callers JOIN it instead of
   * returning early: since TASK_2026_179 step 11 the host calls `ensureStarted`
   * at activation, so an RPC can now arrive while the very first scan is still
   * running. Returning early there would hand that RPC an empty index.
   */
  startPromise: Promise<boolean> | null;
  watcher: IFileWatcher | null;
  subscriptions: IDisposable[];
  specsDirExists: boolean;
  pending: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

const DEBOUNCE_MS = 300;
const REGISTRY_FILE = 'registry.md';
const SPECS_GLOB = '**/.ptah/specs/**';

/**
 * Files this service itself generates at the ROOT of `.ptah/specs/`.
 *
 * Watcher events for these are dropped — they are our own writes, and a
 * self-triggered rebuild loop is the whole hazard here (`ensureStarted` writes
 * `README.md` into the very directory it watches). Suppression is path-based
 * rather than a timing window on purpose: a window is racy under a slow or
 * coalescing watcher, whereas these paths are NEVER a task folder, so dropping
 * them is unconditionally correct.
 */
const GENERATED_ROOT_FILES: readonly string[] = [
  REGISTRY_FILE,
  SPECS_README_FILE,
];

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
   * Lazy start: first call for a workspace performs a full (silent) reindex,
   * creates the watcher and writes the specs README. Idempotent — later calls
   * are cheap no-ops, and concurrent first calls collapse into exactly ONE
   * rebuild and ONE README write (R4).
   *
   * Two callers race in practice: the host at activation and `tasks:*` RPCs.
   * `started` is latched SYNCHRONOUSLY before the first `await`, so the second
   * caller can never begin a rebuild of its own; it awaits the first instead.
   */
  async ensureStarted(workspaceRoot: string): Promise<void> {
    const root = normalizeWorkspaceRoot(workspaceRoot);
    const existing = this.states.get(root);
    if (existing?.started) {
      // Join a still-warming first call rather than returning an empty index.
      if (existing.startPromise) await existing.startPromise;
      return;
    }

    const state: WorkspaceState = existing ?? {
      started: false,
      startPromise: null,
      watcher: null,
      subscriptions: [],
      specsDirExists: false,
      pending: new Set<string>(),
      timer: null,
    };
    state.started = true;
    this.states.set(root, state);

    const start = this.performStart(root, state);
    state.startPromise = start;
    try {
      const indexWritten = await start;
      if (!indexWritten) {
        // The README landed but the derived index did not — most often a store
        // whose SQLite connection is not open yet. Un-latch so the next caller
        // performs a real warm-up instead of inheriting an empty index for the
        // rest of the session.
        //
        // TASK_2026_306 defect E gave that "next caller" a trigger rather than
        // leaving it to chance: `startTaskSpecsIndex` re-warms on the
        // connection's `onDidOpen`. This latch is still what makes that second
        // call do real work, and it remains the only recovery for hosts and
        // paths with no open signal — do not remove it as redundant.
        state.started = false;
      }
    } catch (error: unknown) {
      state.started = false;
      throw error;
    } finally {
      state.startPromise = null;
    }
  }

  /**
   * The actual first-start work. Returns whether the derived index was written;
   * the README write is independent and happens either way, because a host that
   * cannot index yet still needs the contract doc on disk.
   */
  private async performStart(
    root: string,
    state: WorkspaceState,
  ): Promise<boolean> {
    this.startWatcher(root, state);
    // Initial index is silent — the caller (RPC handler) returns the data
    // itself, so an extra push would be redundant noise.
    const { indexWritten } = await this.rebuild(root, [], 'reindex', false);
    await this.ensureSpecsReadme(root, state);
    return indexWritten;
  }

  /**
   * Write `.ptah/specs/README.md` when its content differs from what we render.
   *
   * This is the data-plane doc: the ONLY channel that states the carrier
   * contract to a user whose `.claude/` clone has diverged from the shipped
   * orchestration skill. It is deliberately NOT a migration — nothing under a
   * `TASK_*` folder is read, touched or rewritten here (automatic migration
   * inside `ensureStarted` is explicitly rejected by the design).
   *
   * Only written when `.ptah/specs/` already exists: a workspace that has never
   * used tasks should not have the tree materialized under it just by opening.
   *
   * Never throws — a read-only or otherwise unwritable workspace must degrade
   * to "no README", not to a failed activation.
   */
  private async ensureSpecsReadme(
    root: string,
    state: WorkspaceState,
  ): Promise<void> {
    if (!state.specsDirExists) return;
    const readmePath = path.join(root, '.ptah', 'specs', SPECS_README_FILE);
    try {
      const rendered = renderSpecsReadme();
      // Content comparison IS the hash comparison, minus the collision risk.
      // `renderSpecsReadme` is deterministic, so a matching file means there is
      // genuinely nothing to do and we must not rewrite it — an unconditional
      // write would touch the file on every activation.
      let current: string | null = null;
      if (await this.fs.exists(readmePath)) {
        current = await this.fs.readFile(readmePath);
      }
      if (current === rendered) return;
      await this.fs.writeFile(readmePath, rendered);
      this.logger.info('[task-specs] wrote .ptah/specs/README.md');
    } catch (error: unknown) {
      this.logger.warn('[task-specs] failed to write specs README', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
      excluded: meta?.excluded ?? [],
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

  /**
   * Read ONE workflow document out of a task folder (`tasks:getArtifact`).
   *
   * `file` is a {@link DocFile} — a member of the contract's closed document
   * set, already narrowed at the Zod boundary. It is joined onto the folder
   * path, so accepting a free string here would turn this into an
   * arbitrary-file read primitive; the type is the guard, and it is why this
   * method takes `DocFile` rather than `string`.
   *
   * A missing document returns `null`, not an error. Most tasks carry three or
   * four of the fifteen recognised documents, and one that has not been planned
   * yet has no `implementation-plan.md` to read — that is the ordinary case.
   */
  async readArtifact(
    workspaceRoot: string,
    folderName: string,
    file: DocFile,
  ): Promise<string | null> {
    const root = normalizeWorkspaceRoot(workspaceRoot);
    const target = path.join(root, '.ptah', 'specs', folderName, file);
    try {
      if (!(await this.fs.exists(target))) return null;
      return await this.fs.readFile(target);
    } catch (error: unknown) {
      this.logger.warn('[task-specs] readArtifact failed', {
        folderName,
        file,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Read ONE Crucible judge report out of a task folder
   * (`tasks:getRoundJudge`).
   *
   * `round` is a NUMBER and the filename is composed HERE, from the shared
   * contract's {@link roundJudgeFile}. That is the security boundary: a number
   * cannot carry a separator or a `..`, so no caller input reaches the join as
   * a path fragment. `readArtifact` gets the same guarantee from the `DocFile`
   * enum; `round-N-judge.md` cannot be a `DocFile` (`N` is a parameter), so it
   * gets it from the shape of the parameter instead. Neither method screens a
   * string, because neither method accepts one.
   *
   * A missing report returns `null`, not an error. An unjudged round is the
   * ORDINARY state of a Crucible in progress — round 2 has no report while
   * round 1 is still being revised — and reporting that as a fault would make
   * every live run look broken.
   */
  async readRoundJudge(
    workspaceRoot: string,
    folderName: string,
    round: number,
  ): Promise<string | null> {
    const root = normalizeWorkspaceRoot(workspaceRoot);
    const file = roundJudgeFile(round);
    const target = path.join(root, '.ptah', 'specs', folderName, file);
    try {
      if (!(await this.fs.exists(target))) return null;
      return await this.fs.readFile(target);
    } catch (error: unknown) {
      this.logger.warn('[task-specs] readRoundJudge failed', {
        folderName,
        round,
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
    // Our own generated files at the specs root (registry.md, README.md).
    if (GENERATED_ROOT_FILES.includes(folderName)) return null;
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
   *
   * The scan is unconditional; only the WRITE is skipped when the store reports
   * it cannot accept one yet. `indexWritten` in the result says which happened,
   * and it is what `ensureStarted` latches on.
   */
  private async rebuild(
    root: string,
    folderNames: string[],
    reason: TaskIndexChangeEvent['reason'],
    emit: boolean,
  ): Promise<{
    indexedCount: number;
    excludedCount: number;
    indexWritten: boolean;
  }> {
    const scan = await this.scanner.scan(root);
    const summaries: TaskSpecSummary[] = scan.tasks.map(
      ({ body: _body, ...summary }) => summary,
    );
    let indexWritten = true;
    if (!this.store.isReady()) {
      // The one PREDICTABLE offline case, and the whole reason `isReady()`
      // exists (TASK_2026_306 task 4.4). Both Electron and the CLI register the
      // store in the same DI pass as the activation warm-up but call
      // `openAndMigrate` hundreds of log lines later, so this first warm-up runs
      // against a connection that is certain to reject the write. Attempting it
      // anyway produced `Persistence is offline` as a WARN on every clean boot —
      // an expected outcome in the channel reserved for unexpected ones, which
      // is how a reader learns to ignore the channel.
      //
      // ONLY the write is skipped. The scan above already ran, so
      // `state.specsDirExists` below is set from it and `ensureSpecsReadme` still
      // writes the contract doc — which is why this guard costs nothing on a host
      // where `openAndMigrate` genuinely never succeeds. `indexWritten: false`
      // still un-latches `ensureStarted`, so the `onDidOpen` re-warm in
      // `di/start-index.ts` performs the real rebuild moments later.
      indexWritten = false;
      this.logger.debug(
        '[task-specs] index rebuild write skipped — store not ready yet',
      );
    } else {
      try {
        this.store.replaceWorkspace(root, summaries, scan.excluded);
      } catch (error: unknown) {
        indexWritten = false;
        // WARN, not ERROR: this is recoverable, not a defect. `ensureStarted`
        // treats it as "not started" and a later call performs a real rebuild.
        //
        // Reaching here means a store that reported itself READY failed anyway —
        // a closed connection, a full disk, a corrupt page. That is unpredicted
        // and belongs in this channel. The guard above removed the one predicted
        // failure from it; it did not remove the channel.
        this.logger.warn('[task-specs] index rebuild write failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const state = this.states.get(root);
    if (state) state.specsDirExists = scan.specsDirExists;
    if (emit) {
      this.fireChange({ workspaceRoot: root, folderNames, reason });
    }
    return {
      indexedCount: summaries.length,
      excludedCount: scan.excluded.length,
      indexWritten,
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
