import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  ClaudeRpcService,
  ElectronLayoutService,
  PluginCatalogService,
  VSCodeService,
  WorkspaceScopeService,
} from '@ptah-extension/core';
import { GenerationWorkflowLauncherService } from '../../services/generation-workflow-launcher.service';
import { SetupStatusStore } from './setup-status.store';

describe('SetupStatusStore', () => {
  const scopeKey = signal('first');
  const loaded = signal(false);
  const enabled = signal(false);
  const catalogError = signal<string | null>(null);
  const catalog = {
    isLoaded: loaded,
    hasEnabledPlugins: enabled,
    error: catalogError,
    ensureLoaded: jest.fn(() => {
      loaded();
      return Promise.resolve();
    }),
    refresh: jest.fn().mockResolvedValue(undefined),
  };
  const status = {
    isConfigured: false,
    agentCount: 0,
    ruleCount: 0,
    lastUpdated: null,
    hasClaudeConfig: false,
  };
  const analysis = {
    filename: 'a',
    savedAt: '2026-10-01T00:00:00.000Z',
    projectType: ' Angular monorepo ',
    phaseCount: 4,
    model: 'm',
    durationMs: 1,
  };
  let analyses: unknown[] = [analysis];
  let statusData: typeof status = status;
  const reply = (method: string) =>
    Promise.resolve({
      isSuccess: () => true,
      data: method === 'wizard:list-analyses' ? { analyses } : statusData,
    });
  const rpc = {
    call: jest.fn<Promise<unknown>, [string, ...unknown[]]>(reply),
  };
  const tabs = { activeWorkspacePath: '/workspace' as string | null };
  const launcher = { open: jest.fn().mockResolvedValue({ outcome: 'landed' }) };
  let store: SetupStatusStore;
  let electron = false;
  const addFolder = jest.fn().mockResolvedValue('cancelled');

  beforeEach(() => {
    electron = false;
    jest.clearAllMocks();
    scopeKey.set('first');
    loaded.set(false);
    enabled.set(false);
    catalogError.set(null);
    tabs.activeWorkspacePath = '/workspace';
    analyses = [analysis];
    statusData = status;
    rpc.call.mockImplementation(reply);
    launcher.open.mockResolvedValue({ outcome: 'landed' });
    TestBed.configureTestingModule({
      providers: [
        SetupStatusStore,
        { provide: WorkspaceScopeService, useValue: { scopeKey } },
        { provide: PluginCatalogService, useValue: catalog },
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: ElectronLayoutService, useValue: { addFolder } },
        { provide: TabManagerService, useValue: tabs },
        {
          provide: VSCodeService,
          useValue: {
            config: () => ({ workspaceRoot: '/workspace', isVSCode: !electron, isElectron: electron }),
          },
        },
        { provide: GenerationWorkflowLauncherService, useValue: launcher },
      ],
    });
    store = TestBed.inject(SetupStatusStore);
  });

  it('counts only confirmed skills, scan and agents over three', async () => {
    TestBed.flushEffects();
    expect(store.readyCount()).toBeNull();
    await store.refresh();
    loaded.set(true);
    enabled.set(true);
    expect(store.readyCount()).toBe(2);
    expect(store.allReady()).toBe(false);
    statusData = { ...status, isConfigured: true, agentCount: 2 };
    await store.refresh();
    expect(store.readyCount()).toBe(3);
    expect(store.allReady()).toBe(true);
    expect(store.nextAction()).toBeNull();
  });

  it('reads the scan check from saved analyses with the newest project type', async () => {
    TestBed.flushEffects();
    await store.refresh();
    expect(rpc.call).toHaveBeenCalledWith(
      'wizard:list-analyses',
      {},
      { timeout: 10000 },
    );
    expect(store.scanReady()).toBe(true);
    expect(store.scanProjectType()).toBe('Angular monorepo');
    analyses = [];
    await store.refresh();
    expect(store.scanReady()).toBe(false);
    expect(store.scanProjectType()).toBeNull();
  });

  it('keeps the scan check unknown until the first answer and after a failed first read', async () => {
    let resolveScan: (value: {
      isSuccess: () => boolean;
      data: unknown;
    }) => void = () => undefined;
    rpc.call.mockImplementation((method: string) =>
      method === 'wizard:list-analyses'
        ? new Promise((done) => {
            resolveScan = done;
          })
        : reply(method),
    );
    TestBed.flushEffects();
    loaded.set(true);
    enabled.set(true);
    expect(store.scanReady()).toBeNull();
    expect(store.readyCount()).toBeNull();
    resolveScan({ isSuccess: () => false, data: undefined });
    await store.refresh();
    expect(store.scanReady()).toBeNull();
    expect(store.scanError()).toContain('Could not check the project scan');
    expect(store.readyCount()).toBeNull();
    expect(store.nextAction()).toBeNull();
  });

  it('keeps the last scan answer through a failed or malformed reread', async () => {
    TestBed.flushEffects();
    await store.refresh();
    expect(store.scanReady()).toBe(true);
    rpc.call.mockImplementation((method: string) =>
      method === 'wizard:list-analyses'
        ? Promise.resolve({ isSuccess: () => true, data: { analyses: 'nope' } })
        : reply(method),
    );
    await store.refresh();
    expect(store.scanReady()).toBe(true);
    expect(store.scanError()).not.toBeNull();
    rpc.call.mockImplementation(reply);
    await store.refresh();
    expect(store.scanError()).toBeNull();
  });

  it('drops the scan answer of a previous workspace', async () => {
    TestBed.flushEffects();
    await store.refresh();
    expect(store.scanReady()).toBe(true);
    let resolveOld: (value: {
      isSuccess: () => boolean;
      data: unknown;
    }) => void = () => undefined;
    rpc.call.mockImplementation((method: string) =>
      method === 'wizard:list-analyses'
        ? new Promise((done) => {
            resolveOld = done;
          })
        : reply(method),
    );
    const oldRead = store.refresh();
    rpc.call.mockImplementation(reply);
    analyses = [];
    scopeKey.set('second');
    TestBed.flushEffects();
    expect(store.scanReady()).toBeNull();
    resolveOld({ isSuccess: () => true, data: { analyses: [analysis] } });
    await oldRead;
    await store.refresh();
    expect(store.scanReady()).toBe(false);
  });

  it('maps the next action: first run, then Skills, Scan, Agents in order', async () => {
    // Settle the mount read first, so each row below starts its own read.
    TestBed.flushEffects();
    await store.refresh();
    loaded.set(true);
    const matrix: [boolean, boolean, boolean, string | null][] = [
      [false, false, false, 'run-setup'],
      [false, true, false, 'open-library'],
      [false, true, true, 'open-library'],
      [false, false, true, 'open-library'],
      [true, false, false, 'run-setup'],
      [true, false, true, 'run-setup'],
      [true, true, false, 'generate-agents'],
      [true, true, true, null],
    ];
    for (const [skills, scan, agents, expected] of matrix) {
      enabled.set(skills);
      analyses = scan ? [analysis] : [];
      statusData = { ...status, isConfigured: agents };
      await store.refresh();
      expect([skills, scan, agents, store.nextAction()]).toEqual([
        skills,
        scan,
        agents,
        expected,
      ]);
      expect(store.readyCount()).toBe(
        [skills, scan, agents].filter(Boolean).length,
      );
    }
  });

  it('has no next action while any check is unknown', async () => {
    TestBed.flushEffects();
    await store.refresh();
    expect(store.skillsReady()).toBeNull();
    expect(store.nextAction()).toBeNull();
    loaded.set(true);
    catalogError.set('down');
    expect(store.nextAction()).toBeNull();
  });

  it('rejects a previous workspace response after switching', async () => {
    TestBed.flushEffects();
    await store.refresh();
    let resolve: (value: {
      isSuccess: () => boolean;
      data: typeof status;
    }) => void = () => undefined;
    rpc.call.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const oldRead = store.refresh();
    scopeKey.set('second');
    TestBed.flushEffects();
    resolve({ isSuccess: () => true, data: { ...status, isConfigured: true } });
    await oldRead;
    expect(store.status()?.isConfigured).not.toBe(true);
  });

  it('offers safe failure and retry', async () => {
    TestBed.flushEffects();
    await store.refresh();
    rpc.call.mockResolvedValue({
      isSuccess: () => false,
      error: 'secret',
      errorCode: 'FAIL',
    });
    await store.refresh();
    expect(store.error()).toContain('Could not check');
    expect(store.error()).not.toContain('secret');
    await store.retry();
    expect(catalog.refresh).toHaveBeenCalled();
  });

  it('preserves wizard, folder, and independent generation actions', async () => {
    TestBed.flushEffects();
    await store.openFolder();
    expect(rpc.call).toHaveBeenCalledWith(
      'command:execute',
      { command: 'workbench.action.files.openFolder' },
      { timeout: 10000 },
    );
    await store.launchWizard();
    expect(rpc.call).toHaveBeenCalledWith(
      'setup-wizard:launch',
      {},
      { timeout: 5000 },
    );
    await store.launchGeneration('setup-agent-generation');
    expect(launcher.open).toHaveBeenCalledWith({
      workspacePath: '/workspace',
      workflow: 'setup-agent-generation',
      origin: 'independent-start',
    });
    launcher.open.mockResolvedValue({ outcome: 'failed' });
    await store.launchGeneration('setup-project-prompt');
    expect(store.launchError()).toContain('Could not open generation');
  });

  it('uses the Electron folder picker instead of a VS Code command', async () => {
    electron = true;
    await store.openFolder();
    expect(addFolder).toHaveBeenCalledTimes(1);
    expect(rpc.call).not.toHaveBeenCalledWith('command:execute', expect.anything(), expect.anything());
  });

  it('reports an Electron picker failure without exposing its raw error', async () => {
    electron = true;
    addFolder.mockResolvedValueOnce('failed');
    await store.openFolder();
    expect(store.folderError()).toBe('Could not open a folder. Please try again.');
    expect(rpc.call).not.toHaveBeenCalledWith('command:execute', expect.anything(), expect.anything());
  });

  it('does not track catalog state in the scope effect or duplicate status reads on retry', async () => {
    TestBed.flushEffects();
    await store.refresh();
    const initialCalls = rpc.call.mock.calls.filter(
      ([method]) => method === 'setup-status:get-status',
    ).length;
    loaded.set(true);
    TestBed.flushEffects();
    expect(
      rpc.call.mock.calls.filter(
        ([method]) => method === 'setup-status:get-status',
      ),
    ).toHaveLength(initialCalls);
    await store.retry();
    TestBed.flushEffects();
    expect(
      rpc.call.mock.calls.filter(
        ([method]) => method === 'setup-status:get-status',
      ),
    ).toHaveLength(initialCalls + 1);
  });

  it('keeps confirmed readiness while refreshing and accepts host status after setup', async () => {
    TestBed.flushEffects();
    await store.refresh();
    loaded.set(true);
    enabled.set(true);
    let resolve: (value: {
      isSuccess: () => boolean;
      data: typeof status;
    }) => void = () => undefined;
    rpc.call.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = store.refresh();
    expect(store.isLoading()).toBe(true);
    expect(store.agentsReady()).toBe(false);
    expect(store.readyCount()).toBe(2);
    resolve({
      isSuccess: () => true,
      data: { ...status, isConfigured: true, agentCount: 1 },
    });
    await pending;
    expect(store.readyCount()).toBe(3);
  });

  it('dedupes simultaneous remount refreshes', async () => {
    TestBed.flushEffects();
    await store.refresh();
    let resolve: (value: {
      isSuccess: () => boolean;
      data: typeof status;
    }) => void = () => undefined;
    rpc.call.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const first = store.refresh();
    const second = store.refresh();
    expect(
      rpc.call.mock.calls.filter(
        ([method]) => method === 'setup-status:get-status',
      ),
    ).toHaveLength(2);
    resolve({ isSuccess: () => true, data: status });
    await Promise.all([first, second]);
  });

  it('keeps folder failure separate from status failure and clears it on success', async () => {
    TestBed.flushEffects();
    await store.refresh();
    rpc.call.mockResolvedValueOnce({ isSuccess: () => false });
    await store.openFolder();
    expect(store.folderError()).toContain('Could not open a folder');
    expect(store.error()).toBeNull();
    await store.openFolder();
    expect(store.folderError()).toBeNull();
  });

  it('keeps a failed launch alert through its immediate refresh and clears it on a later successful read', async () => {
    TestBed.flushEffects();
    await store.refresh();
    rpc.call.mockResolvedValueOnce({ isSuccess: () => false });
    await store.launchWizard();
    expect(store.launchError()).toContain('Could not launch setup');
    await store.refresh();
    expect(store.launchError()).toBeNull();
  });

  it('shows no-workspace state without stale status', async () => {
    TestBed.flushEffects();
    await store.refresh();
    rpc.call.mockResolvedValueOnce({
      isSuccess: () => false,
      errorCode: 'WORKSPACE_NOT_OPEN',
    });
    await store.refresh();
    expect(store.workspaceNotOpen()).toBe(true);
    expect(store.agentsReady()).toBeNull();
  });

  it('does not let an old failure clear the new scope request', async () => {
    TestBed.flushEffects();
    await store.refresh();
    let rejectOld: (reason?: Error) => void = () => undefined;
    let resolveNew: (value: {
      isSuccess: () => boolean;
      data: typeof status;
    }) => void = () => undefined;
    rpc.call.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        }),
    );
    const oldRead = store.refresh();
    rpc.call.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolveNew = done;
        }),
    );
    scopeKey.set('second');
    TestBed.flushEffects();
    rejectOld(new Error('secret'));
    await oldRead;
    expect(store.isLoading()).toBe(true);
    expect(store.error()).toBeNull();
    resolveNew({ isSuccess: () => true, data: status });
    await store.refresh();
    expect(store.isLoading()).toBe(false);
  });
});
