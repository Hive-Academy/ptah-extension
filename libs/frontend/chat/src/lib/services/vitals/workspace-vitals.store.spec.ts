import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  SetupStatusStore,
  type SetupNextAction,
} from '@ptah-extension/chat-ui';
import {
  AppStateManager,
  ClaudeRpcService,
  LoggingService,
  PlanLimitsStore,
  PluginCatalogService,
  RpcResult,
  VSCodeService,
} from '@ptah-extension/core';
import type {
  IndexingGetStatusResult,
  IndexingProgressEvent,
  IndexingStatusWire,
} from '@ptah-extension/shared';
import { WorkspaceIndexingService } from '@ptah-extension/workspace-indexing';
import { RecentSessionsStore } from '../session-list/recent-sessions.store';
import {
  fact,
  fakePlanLimits,
  fakeUsageCache,
  summary,
  type FakePlanLimits,
  type FakeUsageCache,
} from './testing/vitals-fixtures';
import { UsageVitalsCache } from './usage-vitals.cache';
import {
  VITALS_EMPTY,
  VITALS_ERROR,
  VITALS_LOADING,
  VITALS_RPC_TIMEOUT_MS,
  vitalsReady,
} from './vitals-load';
import { WorkspaceVitalsStore } from './workspace-vitals.store';

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function indexingStatus(
  state: IndexingStatusWire['state'],
  fileCount?: number,
): IndexingStatusWire {
  return {
    state,
    workspaceFingerprint: 'fp',
    gitHeadSha: null,
    currentGitHeadSha: null,
    lastIndexedAt: null,
    symbolsEnabled: true,
    memoryEnabled: true,
    symbolsCursor: null,
    disclosureAcknowledgedAt: null,
    lastDismissedStaleSha: null,
    errorMessage: null,
    ...(fileCount === undefined ? {} : { fileCount }),
  };
}

function progress(
  overrides: Partial<IndexingProgressEvent>,
): IndexingProgressEvent {
  return {
    pipeline: 'symbols',
    percent: 40,
    currentLabel: 'src/a.ts',
    elapsedMs: 10,
    totalKnown: true,
    ...overrides,
  };
}

describe('WorkspaceVitalsStore', () => {
  let usage: FakeUsageCache;
  let plan: FakePlanLimits;
  let path: WritableSignal<string | null>;
  let isElectron: boolean;
  let git: {
    activeWorkspacePath: WritableSignal<string | null>;
    branchName: WritableSignal<string>;
    changedFileCount: WritableSignal<number>;
    isGitRepo: WritableSignal<boolean>;
    isLoading: WritableSignal<boolean>;
    isStale: WritableSignal<boolean>;
    statusUnavailable: WritableSignal<'timeout' | 'error' | null>;
  };
  let setup: {
    skillsReady: WritableSignal<boolean | null>;
    scanReady: WritableSignal<boolean | null>;
    agentsReady: WritableSignal<boolean | null>;
    allReady: WritableSignal<boolean>;
    nextAction: WritableSignal<SetupNextAction | null>;
    scanProjectType: WritableSignal<string | null>;
    error: WritableSignal<string | null>;
    scanError: WritableSignal<string | null>;
    workspaceNotOpen: WritableSignal<boolean>;
    refresh: jest.Mock;
    retry: jest.Mock;
    launchWizard: jest.Mock;
    launchGeneration: jest.Mock;
  };
  let catalogError: WritableSignal<string | null>;
  let openMarketplace: jest.Mock;
  /** `indexing:getStatus` answers by workspace; `'fail'` answers with a failure. */
  let indexingByPath: Map<string, IndexingStatusWire | 'fail'>;
  let call: jest.Mock;
  let indexing: {
    progress: WritableSignal<IndexingProgressEvent | null>;
    completedAt: WritableSignal<number | null>;
  };
  let recent: {
    confirmed: WritableSignal<boolean>;
    workspacePath: WritableSignal<string | null>;
    total: WritableSignal<number | null>;
  };
  let logger: { error: jest.Mock };

  async function create(): Promise<WorkspaceVitalsStore> {
    const gitUi = await import('@ptah-extension/git-ui/services');
    TestBed.configureTestingModule({
      providers: [
        WorkspaceVitalsStore,
        { provide: gitUi.GitStatusService, useValue: git },
        { provide: UsageVitalsCache, useValue: usage },
        { provide: PlanLimitsStore, useValue: plan },
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: VSCodeService, useValue: { isElectron } },
        { provide: SetupStatusStore, useValue: setup },
        { provide: PluginCatalogService, useValue: { error: catalogError } },
        { provide: AppStateManager, useValue: { openMarketplace } },
        { provide: WorkspaceIndexingService, useValue: indexing },
        { provide: RecentSessionsStore, useValue: recent },
        { provide: LoggingService, useValue: logger },
      ],
    });
    const store = TestBed.inject(WorkspaceVitalsStore);
    store.bind({ workspacePath: () => path() });
    await settle();
    return store;
  }

  async function settle(): Promise<void> {
    TestBed.flushEffects();
    await flush();
  }

  /** Changes the host's indexing answer and lets a completed run reread it. */
  async function answerIndexing(
    workspace: string,
    answer: IndexingStatusWire | 'fail',
  ): Promise<void> {
    indexingByPath.set(workspace, answer);
    indexing.completedAt.set((indexing.completedAt() ?? 0) + 1);
    await settle();
  }

  beforeEach(() => {
    usage = fakeUsageCache();
    plan = fakePlanLimits();
    path = signal<string | null>('/work/ptah');
    isElectron = true;
    git = {
      activeWorkspacePath: signal<string | null>('/work/ptah'),
      branchName: signal('main'),
      changedFileCount: signal(14),
      isGitRepo: signal(true),
      isLoading: signal(false),
      isStale: signal(false),
      statusUnavailable: signal<'timeout' | 'error' | null>(null),
    };
    setup = {
      skillsReady: signal<boolean | null>(true),
      scanReady: signal<boolean | null>(true),
      agentsReady: signal<boolean | null>(false),
      allReady: signal(false),
      nextAction: signal<SetupNextAction | null>('generate-agents'),
      scanProjectType: signal<string | null>('Angular monorepo'),
      error: signal<string | null>(null),
      scanError: signal<string | null>(null),
      workspaceNotOpen: signal(false),
      refresh: jest.fn(async () => undefined),
      retry: jest.fn(async () => undefined),
      launchWizard: jest.fn(async () => undefined),
      launchGeneration: jest.fn(async () => undefined),
    };
    catalogError = signal<string | null>(null);
    openMarketplace = jest.fn();
    indexingByPath = new Map();
    call = jest.fn(
      async (
        _method: string,
        params: { workspaceRoot: string },
      ): Promise<RpcResult<IndexingGetStatusResult>> => {
        const answer = indexingByPath.get(params.workspaceRoot) ?? 'fail';
        return answer === 'fail'
          ? new RpcResult<IndexingGetStatusResult>(false, undefined, 'absent')
          : new RpcResult(true, { status: answer });
      },
    );
    indexing = {
      progress: signal<IndexingProgressEvent | null>(null),
      completedAt: signal<number | null>(null),
    };
    recent = {
      confirmed: signal(false),
      workspacePath: signal<string | null>(null),
      total: signal<number | null>(null),
    };
    logger = { error: jest.fn() };
  });

  afterEach(() => TestBed.resetTestingModule());

  it('reads only the bound workspace and rereads it on a switch', async () => {
    path.set(null);
    const store = await create();
    expect(usage.summary).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
    expect(store.activity90()).toEqual(VITALS_LOADING);

    path.set('/work/ptah');
    await settle();
    expect(usage.summary).toHaveBeenCalledWith('/work/ptah', 90);
    expect(call).toHaveBeenCalledWith(
      'indexing:getStatus',
      { workspaceRoot: '/work/ptah' },
      { timeout: VITALS_RPC_TIMEOUT_MS },
    );
    expect(setup.refresh).toHaveBeenCalledTimes(1);

    path.set('/work/other');
    await settle();
    expect(usage.summary).toHaveBeenLastCalledWith('/work/other', 90);
    expect(call).toHaveBeenLastCalledWith(
      'indexing:getStatus',
      { workspaceRoot: '/work/other' },
      { timeout: VITALS_RPC_TIMEOUT_MS },
    );
    expect(usage.summary.mock.calls.every(([scope]) => scope !== null)).toBe(
      true,
    );
  });

  it('re-reads the workspace usage on each clock tick, so a failure is retried', async () => {
    const store = await create();
    usage.entry('/work/ptah', 90).set(VITALS_ERROR);
    expect(store.activity90()).toEqual(VITALS_ERROR);
    const reads = usage.summary.mock.calls.length;
    plan.now.set(plan.now() + 30_000);
    await settle();
    expect(usage.summary.mock.calls.length).toBe(reads + 1);
    expect(usage.summary).toHaveBeenLastCalledWith('/work/ptah', 90);
  });

  it('maps the workspace grid and totals', async () => {
    const store = await create();
    usage
      .entry('/work/ptah', 90)
      .set(vitalsReady(summary([fact('2026-10-20')], { sessionCount: 9 })));
    const activity = store.activity90();
    expect(activity.status).toBe('ready');
    if (activity.status !== 'ready') return;
    expect(activity.value.sessionCount).toBe(9);
  });

  it('throws on a second bind', async () => {
    const store = await create();
    expect(() => store.bind({ workspacePath: () => '/x' })).toThrow(
      /called twice/,
    );
    expect(store.workspacePath()).toBe('/work/ptah');
  });

  describe('git', () => {
    it('reads branch and changed files once the service shows this workspace', async () => {
      const store = await create();
      expect(store.git()).toEqual(
        vitalsReady({ branch: 'main', changedFileCount: 14 }),
      );
      expect(store.loadSteps()[0]).toEqual({
        id: 'git',
        label: 'Git status',
        state: 'done',
        detail: '14 changed',
      });
      git.changedFileCount.set(0);
      expect(store.loadSteps()[0].detail).toBe('No changes');
    });

    it('is loading while the service still shows another workspace or none (Electron)', async () => {
      git.activeWorkspacePath.set('/work/other');
      const store = await create();
      expect(store.git()).toEqual(VITALS_LOADING);
      expect(store.loadSteps()[0]).toEqual({
        id: 'git',
        label: 'Git status',
        state: 'active',
      });
      git.activeWorkspacePath.set(null);
      expect(store.git()).toEqual(VITALS_LOADING);
      git.activeWorkspacePath.set('/work/ptah');
      expect(store.git().status).toBe('ready');
    });

    it('is empty on a host that never selects a git workspace', async () => {
      isElectron = false;
      git.activeWorkspacePath.set(null);
      const store = await create();
      expect(store.git()).toEqual(VITALS_EMPTY);
      expect(store.isLoaded()).toBe(false);
      usage.entry('/work/ptah', 90).set(vitalsReady(summary([])));
      expect(store.isLoaded()).toBe(true);
    });

    it('is active while the first read is in flight', async () => {
      git.isGitRepo.set(false);
      git.isLoading.set(true);
      const store = await create();
      expect(store.git()).toEqual(VITALS_LOADING);
    });

    it('has no git step for a folder that is not a repository', async () => {
      git.isGitRepo.set(false);
      const store = await create();
      expect(store.git()).toEqual(VITALS_EMPTY);
      expect(store.loadSteps().map((step) => step.id)).toEqual(['usage']);
    });

    it('fails without earlier data and keeps earlier data through a failed read', async () => {
      git.isGitRepo.set(false);
      git.statusUnavailable.set('error');
      const store = await create();
      expect(store.git()).toEqual(VITALS_ERROR);
      expect(store.loadSteps()[0]).toEqual({
        id: 'git',
        label: 'Git status',
        state: 'failed',
        detail: 'Unavailable',
      });
      git.isGitRepo.set(true);
      git.isStale.set(true);
      expect(store.git()).toEqual(
        vitalsReady({ branch: 'main', changedFileCount: 14 }),
      );
    });
  });

  it('reports isLoaded once git and usage have settled, whatever the outcome', async () => {
    git.isLoading.set(true);
    git.isGitRepo.set(false);
    const store = await create();
    expect(store.isLoaded()).toBe(false);
    git.isLoading.set(false);
    expect(store.isLoaded()).toBe(false);
    usage.entry('/work/ptah', 90).set(VITALS_ERROR);
    expect(store.isLoaded()).toBe(true);
    const last = () => store.loadSteps()[store.loadSteps().length - 1];
    expect(last()).toEqual({
      id: 'usage',
      label: 'Usage history',
      state: 'failed',
    });
    usage.entry('/work/ptah', 90).set(vitalsReady(summary([])));
    expect(last().state).toBe('done');
  });

  describe('indexing', () => {
    const scanOf = (store: WorkspaceVitalsStore) =>
      store.loadSteps().find((step) => step.id === 'scan');

    it('shows the scan step only while this workspace is indexing', async () => {
      const store = await create();
      expect(scanOf(store)).toBeUndefined();
      await answerIndexing('/work/ptah', indexingStatus('indexed', 412));
      expect(scanOf(store)).toBeUndefined();
      await answerIndexing('/work/ptah', indexingStatus('indexing'));
      expect(scanOf(store)).toEqual({
        id: 'scan',
        label: 'Scanning files',
        state: 'active',
      });
      expect(store.loadSteps().map((step) => step.id)).toEqual([
        'git',
        'scan',
        'usage',
      ]);
    });

    it('never shows another workspace’s file count or scan after a switch', async () => {
      indexingByPath.set('/work/ptah', indexingStatus('indexing', 412));
      const store = await create();
      expect(store.fileCount()).toEqual(vitalsReady(412));
      expect(scanOf(store)).toBeDefined();

      // The next workspace's read is still in flight: nothing is shown.
      let answer: (value: RpcResult<IndexingGetStatusResult>) => void = () =>
        undefined;
      call.mockImplementationOnce(
        () =>
          new Promise<RpcResult<IndexingGetStatusResult>>((done) => {
            answer = done;
          }),
      );
      path.set('/work/other');
      await settle();
      expect(store.fileCount()).toEqual(VITALS_LOADING);
      expect(scanOf(store)).toBeUndefined();
      expect(store.scanCaption()).toBe('Angular monorepo');

      // It fails (no indexing there): an error, not the old figures.
      answer(new RpcResult<IndexingGetStatusResult>(false, undefined, 'x'));
      await flush();
      expect(store.fileCount()).toEqual(VITALS_ERROR);
      expect(scanOf(store)).toBeUndefined();
    });

    it('drops a late answer for the workspace left behind', async () => {
      let answerOld: (value: RpcResult<IndexingGetStatusResult>) => void = () =>
        undefined;
      call.mockImplementationOnce(
        () =>
          new Promise<RpcResult<IndexingGetStatusResult>>((done) => {
            answerOld = done;
          }),
      );
      indexingByPath.set('/work/other', indexingStatus('indexed', 7));
      const store = await create();
      path.set('/work/other');
      await settle();
      answerOld(
        new RpcResult(true, { status: indexingStatus('indexed', 412) }),
      );
      await flush();
      expect(store.fileCount()).toEqual(vitalsReady(7));
    });

    it('keeps a good answer of the same workspace through a failed reread', async () => {
      indexingByPath.set('/work/ptah', indexingStatus('indexed', 412));
      const store = await create();
      await answerIndexing('/work/ptah', 'fail');
      expect(store.fileCount()).toEqual(vitalsReady(412));
    });

    it('rereads when a run starts reporting progress', async () => {
      indexingByPath.set('/work/ptah', indexingStatus('indexed', 3));
      const store = await create();
      indexingByPath.set('/work/ptah', indexingStatus('indexing', 3));
      indexing.progress.set(progress({ processed: 120, total: 500 }));
      await settle();
      expect(scanOf(store)).toEqual({
        id: 'scan',
        label: 'Scanning files',
        state: 'active',
        done: 120,
        total: 500,
      });
    });

    it('treats the final Done event without counts as complete', async () => {
      indexingByPath.set('/work/ptah', indexingStatus('indexing'));
      indexing.progress.set(progress({ percent: 60 }));
      const store = await create();
      expect(scanOf(store)).toEqual({
        id: 'scan',
        label: 'Scanning files',
        state: 'active',
      });
      indexing.progress.set(progress({ percent: 100, currentLabel: 'Done' }));
      expect(scanOf(store)).toEqual({
        id: 'scan',
        label: 'Scanning files',
        state: 'done',
      });
    });
  });

  describe('scan caption', () => {
    it('joins a known file count and the project type', async () => {
      indexingByPath.set('/work/ptah', indexingStatus('indexed', 412));
      const store = await create();
      expect(store.scanCaption()).toBe(
        `${(412).toLocaleString()} files · Angular monorepo`,
      );
      await answerIndexing('/work/ptah', indexingStatus('indexed', 1));
      expect(store.scanCaption()).toBe('1 file · Angular monorepo');
    });

    it('shows the project type only when the count is unknown or zero', async () => {
      indexingByPath.set('/work/ptah', indexingStatus('indexed'));
      const store = await create();
      expect(store.fileCount()).toEqual(VITALS_EMPTY);
      expect(store.scanCaption()).toBe('Angular monorepo');
      await answerIndexing('/work/ptah', indexingStatus('never-indexed', 0));
      expect(store.fileCount()).toEqual(VITALS_EMPTY);
      setup.scanProjectType.set(null);
      expect(store.scanCaption()).toBeNull();
    });
  });

  describe('readiness', () => {
    it('lists the three checks with the next action', async () => {
      const store = await create();
      expect(store.readiness()).toEqual({
        checks: [
          { id: 'skills', label: 'Skills', ready: true },
          { id: 'scan', label: 'Project scan', ready: true },
          { id: 'agents', label: 'Agents', ready: false },
        ],
        action: { id: 'generate-agents', label: 'Generate agents' },
        allReady: false,
        unavailable: false,
      });
      setup.nextAction.set(null);
      expect(store.readiness().action).toBeNull();
    });

    it('is unavailable when a check failed or the host has no open folder', async () => {
      const store = await create();
      setup.scanError.set('x');
      expect(store.readiness().unavailable).toBe(true);
      setup.scanError.set(null);
      catalogError.set('x');
      expect(store.readiness().unavailable).toBe(true);
      catalogError.set(null);
      setup.error.set('x');
      expect(store.readiness().unavailable).toBe(true);
      setup.error.set(null);
      setup.workspaceNotOpen.set(true);
      setup.agentsReady.set(null);
      expect(store.readiness().unavailable).toBe(true);
      await store.retryReadiness();
      expect(setup.retry).toHaveBeenCalled();
    });

    it('runs each action and ignores unknown ids', async () => {
      const store = await create();
      await store.runReadinessAction('open-library');
      expect(openMarketplace).toHaveBeenCalledWith({
        page: 'skills',
        source: 'ptah-plugins',
      });
      await store.runReadinessAction('run-setup');
      expect(setup.launchWizard).toHaveBeenCalled();
      await store.runReadinessAction('generate-agents');
      expect(setup.launchGeneration).toHaveBeenCalledWith(
        'setup-agent-generation',
      );
      await store.runReadinessAction('toString');
      expect(openMarketplace).toHaveBeenCalledTimes(1);
    });
  });

  it('shows the previous-session total only for this workspace once confirmed', async () => {
    const store = await create();
    recent.total.set(7);
    expect(store.previousSessionCount()).toBeNull();
    recent.workspacePath.set('/work/other');
    recent.confirmed.set(true);
    expect(store.previousSessionCount()).toBeNull();
    recent.workspacePath.set('/work/ptah');
    expect(store.previousSessionCount()).toBe(7);
  });
});
