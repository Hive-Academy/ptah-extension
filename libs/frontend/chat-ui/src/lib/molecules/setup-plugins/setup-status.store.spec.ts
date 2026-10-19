import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService, PluginCatalogService, VSCodeService, WorkspaceScopeService } from '@ptah-extension/core';
import { GenerationWorkflowLauncherService } from '../../services/generation-workflow-launcher.service';
import { SetupStatusStore } from './setup-status.store';

describe('SetupStatusStore', () => {
  const scopeKey = signal('first');
  const loaded = signal(false);
  const enabled = signal(false);
  const catalogError = signal<string | null>(null);
  const catalog = { isLoaded: loaded, hasEnabledPlugins: enabled, error: catalogError, ensureLoaded: jest.fn(() => { loaded(); return Promise.resolve(); }), refresh: jest.fn().mockResolvedValue(undefined) };
  const status = { isConfigured: false, agentCount: 0, ruleCount: 0, lastUpdated: null, hasClaudeConfig: false };
  const rpc = { call: jest.fn().mockResolvedValue({ isSuccess: () => true, data: status }) };
  const tabs = { activeWorkspacePath: '/workspace' as string | null };
  const launcher = { open: jest.fn().mockResolvedValue({ outcome: 'landed' }) };
  let store: SetupStatusStore;

  beforeEach(() => {
    jest.clearAllMocks(); scopeKey.set('first'); loaded.set(false); enabled.set(false); catalogError.set(null);
    tabs.activeWorkspacePath = '/workspace';
    rpc.call.mockResolvedValue({ isSuccess: () => true, data: status });
    launcher.open.mockResolvedValue({ outcome: 'landed' });
    TestBed.configureTestingModule({ providers: [
      SetupStatusStore,
      { provide: WorkspaceScopeService, useValue: { scopeKey } },
      { provide: PluginCatalogService, useValue: catalog },
      { provide: ClaudeRpcService, useValue: rpc },
      { provide: TabManagerService, useValue: tabs },
      { provide: VSCodeService, useValue: { config: () => ({ workspaceRoot: '/workspace', isVSCode: true }) } },
      { provide: GenerationWorkflowLauncherService, useValue: launcher },
    ] });
    store = TestBed.inject(SetupStatusStore);
  });

  it('counts only confirmed skills and agents', async () => {
    TestBed.flushEffects();
    expect(store.readyCount()).toBeNull();
    await store.refresh(); loaded.set(true); enabled.set(true);
    expect(store.readyCount()).toBe(1);
    rpc.call.mockResolvedValue({ isSuccess: () => true, data: { ...status, isConfigured: true, agentCount: 2 } });
    await store.refresh();
    expect(store.readyCount()).toBe(2); expect(store.allReady()).toBe(true);
  });

  it('rejects a previous workspace response after switching', async () => {
    TestBed.flushEffects();
    await store.refresh();
    let resolve: (value: { isSuccess: () => boolean; data: typeof status }) => void = () => undefined;
    rpc.call.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const oldRead = store.refresh();
    scopeKey.set('second'); TestBed.flushEffects();
    resolve({ isSuccess: () => true, data: { ...status, isConfigured: true } });
    await oldRead;
    expect(store.status()?.isConfigured).not.toBe(true);
  });

  it('offers safe failure and retry', async () => {
    TestBed.flushEffects();
    await store.refresh();
    rpc.call.mockResolvedValue({ isSuccess: () => false, error: 'secret', errorCode: 'FAIL' });
    await store.refresh();
    expect(store.error()).toContain('Could not check'); expect(store.error()).not.toContain('secret');
    await store.retry(); expect(catalog.refresh).toHaveBeenCalled();
  });

  it('preserves wizard, folder, and independent generation actions', async () => {
    TestBed.flushEffects();
    await store.openFolder();
    expect(rpc.call).toHaveBeenCalledWith('command:execute', { command: 'workbench.action.files.openFolder' }, { timeout: 10000 });
    await store.launchWizard();
    expect(rpc.call).toHaveBeenCalledWith('setup-wizard:launch', {}, { timeout: 5000 });
    await store.launchGeneration('setup-agent-generation');
    expect(launcher.open).toHaveBeenCalledWith({ workspacePath: '/workspace', workflow: 'setup-agent-generation', origin: 'independent-start' });
    launcher.open.mockResolvedValue({ outcome: 'failed' });
    await store.launchGeneration('setup-project-prompt');
    expect(store.launchError()).toContain('Could not open generation');
  });

  it('does not track catalog state in the scope effect or duplicate status reads on retry', async () => {
    TestBed.flushEffects();
    await store.refresh();
    const initialCalls = rpc.call.mock.calls.filter(([method]) => method === 'setup-status:get-status').length;
    loaded.set(true); TestBed.flushEffects();
    expect(rpc.call.mock.calls.filter(([method]) => method === 'setup-status:get-status')).toHaveLength(initialCalls);
    await store.retry(); TestBed.flushEffects();
    expect(rpc.call.mock.calls.filter(([method]) => method === 'setup-status:get-status')).toHaveLength(initialCalls + 1);
  });

  it('keeps confirmed readiness while refreshing and accepts host status after setup', async () => {
    TestBed.flushEffects();
    await store.refresh(); loaded.set(true); enabled.set(true);
    let resolve: (value: { isSuccess: () => boolean; data: typeof status }) => void = () => undefined;
    rpc.call.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = store.refresh();
    expect(store.isLoading()).toBe(true);
    expect(store.agentsReady()).toBe(false);
    expect(store.readyCount()).toBe(1);
    resolve({ isSuccess: () => true, data: { ...status, isConfigured: true, agentCount: 1 } });
    await pending;
    expect(store.readyCount()).toBe(2);
  });

  it('dedupes simultaneous remount refreshes', async () => {
    TestBed.flushEffects(); await store.refresh();
    let resolve: (value: { isSuccess: () => boolean; data: typeof status }) => void = () => undefined;
    rpc.call.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = store.refresh(); const second = store.refresh();
    expect(rpc.call.mock.calls.filter(([method]) => method === 'setup-status:get-status')).toHaveLength(2);
    resolve({ isSuccess: () => true, data: status });
    await Promise.all([first, second]);
  });

  it('keeps folder failure separate from status failure and clears it on success', async () => {
    TestBed.flushEffects(); await store.refresh();
    rpc.call.mockResolvedValueOnce({ isSuccess: () => false });
    await store.openFolder();
    expect(store.folderError()).toContain('Could not open a folder');
    expect(store.error()).toBeNull();
    await store.openFolder();
    expect(store.folderError()).toBeNull();
  });

  it('keeps a failed launch alert through its immediate refresh and clears it on a later successful read', async () => {
    TestBed.flushEffects(); await store.refresh();
    rpc.call.mockResolvedValueOnce({ isSuccess: () => false });
    await store.launchWizard();
    expect(store.launchError()).toContain('Could not launch setup');
    await store.refresh();
    expect(store.launchError()).toBeNull();
  });

  it('shows no-workspace state without stale status', async () => {
    TestBed.flushEffects(); await store.refresh();
    rpc.call.mockResolvedValueOnce({ isSuccess: () => false, errorCode: 'WORKSPACE_NOT_OPEN' });
    await store.refresh();
    expect(store.workspaceNotOpen()).toBe(true);
    expect(store.agentsReady()).toBeNull();
  });

  it('does not let an old failure clear the new scope request', async () => {
    TestBed.flushEffects(); await store.refresh();
    let rejectOld: (reason?: Error) => void = () => undefined;
    let resolveNew: (value: { isSuccess: () => boolean; data: typeof status }) => void = () => undefined;
    rpc.call.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }));
    const oldRead = store.refresh();
    rpc.call.mockImplementationOnce(() => new Promise(done => { resolveNew = done; }));
    scopeKey.set('second'); TestBed.flushEffects();
    rejectOld(new Error('secret')); await oldRead;
    expect(store.isLoading()).toBe(true);
    expect(store.error()).toBeNull();
    resolveNew({ isSuccess: () => true, data: status });
    await store.refresh();
    expect(store.isLoading()).toBe(false);
  });
});
