import {
  Injectable,
  Injector,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import {
  SetupStatusStore,
  type ReadinessAction,
  type ReadinessCheck,
  type SetupNextAction,
  type StagedStep,
} from '@ptah-extension/chat-ui';
import {
  AppStateManager,
  ClaudeRpcService,
  LoggingService,
  PluginCatalogService,
  VSCodeService,
} from '@ptah-extension/core';
import { WorkspaceIndexingService } from '@ptah-extension/workspace-indexing';
import type {
  IndexingProgressEvent,
  IndexingStatusWire,
} from '@ptah-extension/shared';
import { RecentSessionsStore } from '../session-list/recent-sessions.store';
import {
  injectVitalsTick,
  injectWorkspaceUsage,
  toActivityVitals,
  usageDayWindows,
  type ActivityVitals,
} from './usage-vitals.view';
import {
  VITALS_EMPTY,
  VITALS_ERROR,
  VITALS_LOADING,
  VITALS_RPC_TIMEOUT_MS,
  vitalsReady,
  type VitalsLoad,
} from './vitals-load';

/** What the canvas hero hands the store: the workspace it shows. */
export interface WorkspaceVitalsHost {
  readonly workspacePath: () => string | null;
}

/** Branch and working-tree size of the open workspace. */
export interface GitVitals {
  readonly branch: string;
  readonly changedFileCount: number;
}

/** The readiness ring's inputs and whether the checks could be read at all. */
export interface WorkspaceReadiness {
  readonly checks: readonly ReadinessCheck[];
  readonly action: ReadinessAction | null;
  readonly allReady: boolean;
  /**
   * The checks cannot be answered: a read failed, or the host reports no open
   * folder. The screen hides the ring and offers Retry.
   */
  readonly unavailable: boolean;
}

/**
 * `GitStatusService` comes from `@ptah-extension/git-ui/services` by dynamic
 * import (as in `WorkspaceCoordinatorService`): this lib loads git-ui lazily
 * elsewhere, so a static import is forbidden by the module-boundary rule. The
 * type is taken from the module itself, so the signals keep their real types.
 */
type GitStatusService = InstanceType<
  typeof import('@ptah-extension/git-ui/services').GitStatusService
>;
type GitStatusView = Pick<
  GitStatusService,
  | 'activeWorkspacePath'
  | 'branchName'
  | 'changedFileCount'
  | 'isGitRepo'
  | 'isLoading'
  | 'isStale'
  | 'statusUnavailable'
>;

/** One `indexing:getStatus` answer, filed under the workspace it was asked for. */
interface IndexingRead {
  readonly path: string;
  readonly load: VitalsLoad<IndexingStatusWire>;
}

const ACTION_LABELS: Readonly<Record<SetupNextAction, string>> = {
  'open-library': 'Open Library',
  'run-setup': 'Run setup',
  'generate-agents': 'Generate agents',
};

function isSetupNextAction(id: string): id is SetupNextAction {
  return Object.prototype.hasOwnProperty.call(ACTION_LABELS, id);
}

function isSettled(load: VitalsLoad<unknown>): boolean {
  return load.status !== 'loading';
}

/** A known, positive indexed-file count; `fileCount` 0 means no symbols yet. */
function knownFileCount(fileCount: unknown): number | null {
  return typeof fileCount === 'number' &&
    Number.isFinite(fileCount) &&
    fileCount > 0
    ? Math.floor(fileCount)
    : null;
}

/** The indexing status in an answer, narrowed field by field; `null` when malformed. */
function indexingStatusOf(data: unknown): IndexingStatusWire | null {
  if (typeof data !== 'object' || data === null || !('status' in data)) {
    return null;
  }
  const { status } = data;
  return typeof status === 'object' &&
    status !== null &&
    'state' in status &&
    typeof status.state === 'string'
    ? (status as IndexingStatusWire)
    : null;
}

/**
 * The Scanning-files step of a run in progress. `processed` counts files with
 * no symbols too, so it is shown only against `total`, never against the
 * indexed file count. The final `Done` event carries no counts: a run at
 * 100 % with no counts is complete. Without counts below 100 % the step is
 * indeterminate.
 */
function scanStep(progress: IndexingProgressEvent | null): StagedStep {
  const base = { id: 'scan', label: 'Scanning files' } as const;
  const processed = progress?.processed;
  const total = progress?.total;
  if (
    typeof processed === 'number' &&
    typeof total === 'number' &&
    Number.isFinite(processed) &&
    Number.isFinite(total) &&
    total > 0
  ) {
    return {
      ...base,
      state: 'active',
      done: Math.min(Math.max(0, processed), total),
      total,
    };
  }
  if (progress !== null && progress.percent >= 100) {
    return { ...base, state: 'done' };
  }
  return { ...base, state: 'active' };
}

/**
 * View model of the canvas zero-sessions hero. Provide it on the component and
 * call {@link bind} once with the workspace the hero shows; until then every
 * source reads `loading` and nothing is fetched.
 *
 * Sources: `GitStatusService` (branch, changed files), the usage cache (the
 * workspace's 90 days, re-read on the shared clock tick), `SetupStatusStore`
 * (readiness), `indexing:getStatus` for this workspace plus the indexing
 * service's progress pushes (file count, scan step) and `RecentSessionsStore`
 * (the session total; the canvas board loads it). Every source is checked
 * against the bound workspace, so another workspace's figures never show.
 */
@Injectable()
export class WorkspaceVitalsStore {
  private readonly injector = inject(Injector);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly logger = inject(LoggingService);
  private readonly isElectron = inject(VSCodeService).isElectron;
  private readonly setup = inject(SetupStatusStore);
  private readonly catalog = inject(PluginCatalogService);
  private readonly appState = inject(AppStateManager);
  private readonly indexing = inject(WorkspaceIndexingService);
  private readonly recentSessions = inject(RecentSessionsStore);
  private readonly tick = injectVitalsTick();
  private readonly windows = usageDayWindows(this.tick);

  private readonly host = signal<WorkspaceVitalsHost | null>(null);
  private readonly gitStatus = signal<GitStatusView | null>(null);
  private readonly gitUnavailable = signal(false);
  private readonly indexingRead = signal<IndexingRead | null>(null);
  private indexingRequest = 0;

  /** The workspace shown; `null` until {@link bind}. */
  readonly workspacePath = computed(() => this.host()?.workspacePath() ?? null);

  private readonly usage90 = injectWorkspaceUsage(
    this.workspacePath,
    90,
    this.tick,
  );

  /** True while an indexing run is reporting progress (a run started or ended). */
  private readonly indexingRunActive = computed(
    () => this.indexing.progress() !== null,
  );

  /**
   * This workspace's indexing status. `loading` until an answer for the bound
   * workspace arrives; an answer for another workspace is never shown.
   */
  private readonly indexingStatus = computed<VitalsLoad<IndexingStatusWire>>(
    () => {
      const read = this.indexingRead();
      return read !== null && read.path === this.workspacePath()
        ? read.load
        : VITALS_LOADING;
    },
  );

  /**
   * Branch and changed files of the bound workspace.
   * - `loading` until `GitStatusService` shows this workspace (the coordinator
   *   switches it) and while its first read is in flight.
   * - `empty` when the folder is not a repository, or on a host that never
   *   selects a git workspace (VS Code); the branch is hidden.
   * - A failed read with earlier data keeps that data; without it, `error`.
   */
  readonly git: Signal<VitalsLoad<GitVitals>> = computed(() => {
    if (this.gitUnavailable()) return VITALS_ERROR;
    const git = this.gitStatus();
    const path = this.workspacePath();
    if (git === null || path === null) return VITALS_LOADING;
    const active = git.activeWorkspacePath();
    if (active === null) return this.isElectron ? VITALS_LOADING : VITALS_EMPTY;
    if (active !== path) return VITALS_LOADING;
    if (git.statusUnavailable() !== null && !git.isStale()) {
      return git.isLoading() ? VITALS_LOADING : VITALS_ERROR;
    }
    if (git.isGitRepo()) {
      return vitalsReady({
        branch: git.branchName(),
        changedFileCount: git.changedFileCount(),
      });
    }
    return git.isLoading() ? VITALS_LOADING : VITALS_EMPTY;
  });

  /** The workspace's 91-day grid and its totals (sessions, tokens, spend). */
  readonly activity90: Signal<VitalsLoad<ActivityVitals>> = computed(() =>
    toActivityVitals(this.usage90(), this.windows.activity()),
  );

  /**
   * Indexed files for the scan caption. `empty` when nothing has symbols yet
   * (`fileCount` 0, also "never indexed") or the host did not count them;
   * `error` when the status could not be read (and on hosts without
   * indexing).
   */
  readonly fileCount: Signal<VitalsLoad<number>> = computed(() => {
    const status = this.indexingStatus();
    if (status.status !== 'ready') return status;
    const count = knownFileCount(status.value.fileCount);
    return count === null ? VITALS_EMPTY : vitalsReady(count);
  });

  /** The scan caption, e.g. "412 files · Angular monorepo"; `null` when neither part is known. */
  readonly scanCaption = computed<string | null>(() => {
    const files = this.fileCount();
    const parts = [
      files.status === 'ready'
        ? `${files.value.toLocaleString()} ${files.value === 1 ? 'file' : 'files'}`
        : null,
      this.setup.scanProjectType(),
    ].filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(' · ') : null;
  });

  readonly readiness: Signal<WorkspaceReadiness> = computed(() => {
    const next = this.setup.nextAction();
    return {
      checks: [
        { id: 'skills', label: 'Skills', ready: this.setup.skillsReady() },
        { id: 'scan', label: 'Project scan', ready: this.setup.scanReady() },
        { id: 'agents', label: 'Agents', ready: this.setup.agentsReady() },
      ],
      action: next === null ? null : { id: next, label: ACTION_LABELS[next] },
      allReady: this.setup.allReady(),
      // The skills check reads the plugin catalog directly
      // (`SetupStatusStore.skillsReady`), so its failure is the catalog's
      // error, not one the setup store republishes.
      unavailable:
        this.setup.error() !== null ||
        this.setup.scanError() !== null ||
        this.setup.workspaceNotOpen() ||
        this.catalog.error() !== null,
    };
  });

  /** Sessions of this workspace; `null` until the list is confirmed for it. */
  readonly previousSessionCount = computed<number | null>(() => {
    const path = this.workspacePath();
    return path !== null &&
      this.recentSessions.confirmed() &&
      this.recentSessions.workspacePath() === path
      ? this.recentSessions.total()
      : null;
  });

  /**
   * Git status, then Scanning files (only while this workspace's status says
   * a run is in progress), then Usage history. A folder that is not a
   * repository has no git step.
   */
  readonly loadSteps: Signal<readonly StagedStep[]> = computed(() => {
    const steps: StagedStep[] = [];
    const git = this.git();
    if (git.status !== 'empty') {
      steps.push({
        id: 'git',
        label: 'Git status',
        ...this.gitStepState(git),
      });
    }
    const indexing = this.indexingStatus();
    if (indexing.status === 'ready' && indexing.value.state === 'indexing') {
      steps.push(scanStep(this.indexing.progress()));
    }
    const usage = this.usage90();
    steps.push({
      id: 'usage',
      label: 'Usage history',
      state:
        usage.status === 'loading'
          ? 'active'
          : usage.status === 'error'
            ? 'failed'
            : 'done',
    });
    return steps;
  });

  /** The git and usage steps have settled (ready, empty or error). */
  readonly isLoaded = computed(
    () => isSettled(this.git()) && isSettled(this.usage90()),
  );

  constructor() {
    void this.resolveGitStatus();
    effect(() => {
      const path = this.workspacePath();
      if (path !== null) untracked(() => void this.setup.refresh());
    });
    // Reread this workspace's indexing status when the workspace changes, a
    // run starts reporting progress, or a run completes.
    effect(() => {
      const path = this.workspacePath();
      this.indexingRunActive();
      this.indexing.completedAt();
      if (path !== null) untracked(() => void this.loadIndexing(path));
    });
  }

  /**
   * Points the store at the hero's workspace. Call exactly once, in the host's
   * constructor; a second call is a wiring error and throws.
   */
  bind(host: WorkspaceVitalsHost): void {
    if (untracked(this.host) !== null) {
      throw new Error('WorkspaceVitalsStore.bind() was called twice.');
    }
    this.host.set(host);
  }

  /** Runs the readiness ring's action (`ReadinessAction.id`); unknown ids are ignored. */
  async runReadinessAction(id: string): Promise<void> {
    if (!isSetupNextAction(id)) return;
    switch (id) {
      case 'open-library':
        this.appState.openMarketplace({
          page: 'skills',
          source: 'ptah-plugins',
        });
        return;
      case 'run-setup':
        await this.setup.launchWizard();
        return;
      case 'generate-agents':
        await this.setup.launchGeneration('setup-agent-generation');
        return;
    }
  }

  /** Retries every readiness check (the "Readiness unavailable" Retry). */
  retryReadiness(): Promise<void> {
    return this.setup.retry();
  }

  private gitStepState(
    git: VitalsLoad<GitVitals>,
  ): Pick<StagedStep, 'state' | 'detail'> {
    switch (git.status) {
      case 'ready': {
        const count = git.value.changedFileCount;
        return {
          state: 'done',
          detail: count === 0 ? 'No changes' : `${count} changed`,
        };
      }
      case 'error':
        return { state: 'failed', detail: 'Unavailable' };
      default:
        return { state: 'active' };
    }
  }

  private async resolveGitStatus(): Promise<void> {
    try {
      const git = await import('@ptah-extension/git-ui/services');
      const service: GitStatusView = this.injector.get(git.GitStatusService);
      this.gitStatus.set(service);
    } catch (error: unknown) {
      this.logger.error(
        'WorkspaceVitalsStore',
        'Git status service failed to load',
        { errorType: error instanceof Error ? error.name : 'unknown' },
      );
      this.gitUnavailable.set(true);
    }
  }

  /**
   * Reads `indexing:getStatus` for `path` and files the answer under it. A
   * superseded read is dropped. A failure keeps an earlier good answer for the
   * same workspace (stale beats unknown) and is otherwise `error`; hosts
   * without indexing (VS Code) always end there, and the caption then has the
   * project type only.
   */
  private async loadIndexing(path: string): Promise<void> {
    const id = ++this.indexingRequest;
    let status: IndexingStatusWire | null = null;
    try {
      const result = await this.rpc.call(
        'indexing:getStatus',
        { workspaceRoot: path },
        { timeout: VITALS_RPC_TIMEOUT_MS },
      );
      // A failed answer is expected on hosts without indexing, so it is not
      // logged; it becomes the `error` state below.
      if (result.isSuccess()) status = indexingStatusOf(result.data);
    } catch (error: unknown) {
      this.logger.error(
        'WorkspaceVitalsStore',
        'Indexing status read rejected',
        {
          errorType: error instanceof Error ? error.name : 'unknown',
        },
      );
    }
    if (id !== this.indexingRequest) return;
    if (status !== null) {
      this.indexingRead.set({ path, load: vitalsReady(status) });
      return;
    }
    const previous = this.indexingRead();
    if (previous?.path === path && previous.load.status === 'ready') return;
    this.indexingRead.set({ path, load: VITALS_ERROR });
  }
}
