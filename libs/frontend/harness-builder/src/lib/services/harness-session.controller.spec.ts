import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ChatStore } from '@ptah-extension/chat';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService, LoggingService } from '@ptah-extension/core';
import { HarnessBuilderRecordsService } from './harness-builder-records.service';
import { HarnessRpcService } from './harness-rpc.service';
import { HarnessSessionController } from './harness-session.controller';

const root = '/workspace/a';
const intake = { what: 'Scheduler', audience: 'b2b' as const, stack: 'recommend' as const };
type TestTab = {
  id: string;
  workflow?: 'harness-new-project' | 'harness-configure';
  status: 'fresh' | 'loaded' | 'streaming' | 'switching';
  claudeSessionId: string | null;
  messages: Array<{ id: string; role: 'user' | 'assistant'; rawContent: string }>;
};

describe('HarnessSessionController', () => {
  let controller: HarnessSessionController;
  let tabsSignal: ReturnType<typeof signal<TestTab[]>>;
  let send: jest.Mock;
  let abort: jest.Mock;
  let getProposal: jest.Mock;
  let records: HarnessBuilderRecordsService;
  let startNewProject: jest.Mock;
  let workflowPrompt: jest.Mock;
  let tabs: {
    createTab: jest.Mock;
    setWorkflow: jest.Mock;
    registerVisibleTab: jest.Mock;
    unregisterVisibleTab: jest.Mock;
    closeTab: jest.Mock;
  };

  beforeEach(() => {
    localStorage.clear();
    tabsSignal = signal<TestTab[]>([]);
    send = jest.fn().mockResolvedValue({ success: true });
    abort = jest.fn().mockResolvedValue({ success: true, data: { success: true } });
    getProposal = jest.fn().mockResolvedValue({ proposal: { version: 1 } });
    startNewProject = jest.fn().mockResolvedValue({ success: true, seedPrompt: 'seed', plugins: { enabledBundled: [], missingExternal: [], availableSkillIds: [] } });
    workflowPrompt = jest.fn().mockResolvedValue({ prompt: 'team seed' });
    tabs = {
      createTab: jest.fn(() => {
        tabsSignal.update((items) => [...items, { id: 'tab-1', status: 'fresh', claudeSessionId: null, messages: [] }]);
        return 'tab-1';
      }),
      setWorkflow: jest.fn((_id: string, kind: TestTab['workflow']) => {
        tabsSignal.update((items) => items.map((item) => ({ ...item, workflow: kind })));
      }),
      registerVisibleTab: jest.fn(),
      unregisterVisibleTab: jest.fn(),
      closeTab: jest.fn(async (id: string) => {
        tabsSignal.update((items) => items.filter((item) => item.id !== id));
      }),
    };
    TestBed.configureTestingModule({ providers: [
      HarnessSessionController, HarnessBuilderRecordsService,
      { provide: TabManagerService, useValue: {
        ...tabs,
        tabs: tabsSignal,
        activeWorkspacePath: root,
        setFirstMessagePreamble: jest.fn(),
        setMessages: jest.fn((id: string, messages: TestTab['messages']) => {
          tabsSignal.update((items) => items.map((item) => item.id === id ? { ...item, messages } : item));
        }),
        findTabByIdAcrossWorkspaces: (id: string) => {
          const tab = tabsSignal().find((item) => item.id === id);
          return tab ? { tab, workspacePath: root } : null;
        },
      } },
      { provide: ChatStore, useValue: { sendOrQueueMessage: send } },
      { provide: ClaudeRpcService, useValue: { call: abort } },
      { provide: HarnessRpcService, useValue: {
        startNewProject,
        workflowPrompt,
        getProposal,
      } },
      { provide: LoggingService, useValue: { error: jest.fn(), warn: jest.fn() } },
    ] });
    controller = TestBed.inject(HarnessSessionController);
    records = TestBed.inject(HarnessBuilderRecordsService);
  });

  it.each([
    ['new-project', { mode: 'new-project' as const, workspaceRoot: root, intake }],
    ['configure-harness', { mode: 'configure-harness' as const, workspaceRoot: root, intent: 'Build a team' }],
  ])('starts %s and sends without a mounted transcript', async (mode, request) => {
    const session = controller.session(mode as 'new-project' | 'configure-harness');
    expect(await session.start(request)).toEqual({ kind: 'started', tabId: 'tab-1' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(tabs.registerVisibleTab).not.toHaveBeenCalled();
    expect(records.readSession(root, 'tab-1')?.sendAttempt.ackedAt).toBeDefined();
  });

  it('reuses the same tab and intake hash without sending again', async () => {
    const session = controller.session('new-project');
    const request = { mode: 'new-project' as const, workspaceRoot: root, intake };
    await session.start(request);
    expect(await session.start(request)).toEqual({ kind: 'reused', tabId: 'tab-1' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('persists the resolved SDK session ID for proposal restore', async () => {
    const session = controller.session('new-project');
    await session.start({ mode: 'new-project', workspaceRoot: root, intake });
    tabsSignal.update((items) => items.map((item) => ({
      ...item, claudeSessionId: '11111111-1111-4111-8111-111111111111',
    })));
    TestBed.flushEffects();
    expect(session.record()?.sessionId).toBe('11111111-1111-4111-8111-111111111111');
    expect(records.readSession(root, 'tab-1')?.sessionId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('reports a cross-mode conflict before creating or sending', async () => {
    await controller.session('new-project').start({ mode: 'new-project', workspaceRoot: root, intake });
    expect(await controller.session('configure-harness').start({ mode: 'configure-harness', workspaceRoot: root, intent: 'Team' }))
      .toEqual({ kind: 'conflict', otherMode: 'new-project', otherTabId: 'tab-1' });
    expect(tabs.createTab).toHaveBeenCalledTimes(1);
  });

  it('does not count a saved team draft as an active cross-mode session', async () => {
    tabsSignal.set([{ id: 'draft', workflow: 'harness-configure', status: 'loaded', claudeSessionId: null, messages: [] }]);
    expect(records.writeDraft(root, 'configure-harness', 'draft')).toBe(true);
    expect(await controller.session('new-project').start({ mode: 'new-project', workspaceRoot: root, intake }))
      .toEqual({ kind: 'started', tabId: 'tab-1' });
    expect(tabs.createTab).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent starts before tab creation', async () => {
    let release!: (value: { prompt: string }) => void;
    workflowPrompt.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const session = controller.session('configure-harness');
    const request = { mode: 'configure-harness' as const, workspaceRoot: root, intent: 'Build a team' };
    const first = session.start(request);
    const second = session.start(request);
    release({ prompt: 'team seed' });
    expect(await first).toEqual({ kind: 'started', tabId: 'tab-1' });
    expect(await second).toEqual({ kind: 'reused', tabId: 'tab-1' });
    expect(tabs.createTab).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent cross-mode starts in the same workspace', async () => {
    let release!: (value: { prompt: string }) => void;
    workflowPrompt.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const first = controller.session('configure-harness').start({ mode: 'configure-harness', workspaceRoot: root, intent: 'Build a team' });
    const second = controller.session('new-project').start({ mode: 'new-project', workspaceRoot: root, intake });
    release({ prompt: 'team seed' });
    expect((await first).kind).toBe('started');
    expect(await second).toEqual({ kind: 'conflict', otherMode: 'configure-harness', otherTabId: 'tab-1' });
    expect(tabs.createTab).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('clears a stale record before a pre-tab start failure and on missing or wrong-mode restore', async () => {
    const session = controller.session('new-project');
    await session.start({ mode: 'new-project', workspaceRoot: root, intake });
    await tabs.closeTab('tab-1');
    startNewProject.mockRejectedValueOnce(new Error('provider detail'));
    expect((await session.start({ mode: 'new-project', workspaceRoot: root, intake })).kind).toBe('failed');
    expect(session.record()).toBeNull();
    tabsSignal.set([{ id: 'tab-1', workflow: 'harness-new-project', status: 'loaded', claudeSessionId: null, messages: [] }]);
    expect(await session.restore('tab-1')).toBe('ready');
    expect(await session.restore('absent')).toBe('missing');
    expect(session.record()).toBeNull();
    await session.restore('tab-1');
    tabsSignal.update((items) => items.map((item) => ({ ...item, workflow: 'harness-configure' as const })));
    expect(await session.restore('tab-1')).toBe('wrong-mode');
    expect(session.record()).toBeNull();
  });

  it('fails after the ten second readiness timeout and exposes Retry send', async () => {
    jest.useFakeTimers();
    try {
      tabs.createTab.mockImplementationOnce(() => 'tab-1');
      const session = controller.session('new-project');
      const started = session.start({ mode: 'new-project', workspaceRoot: root, intake });
      await jest.advanceTimersByTimeAsync(10_100);
      expect((await started).kind).toBe('failed');
      expect(session.phase()).toBe('failed');
      expect(session.error()).toContain('Retry send');
      expect(send).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
  });

  it('reconciles an accepted first turn before Retry and does not duplicate it', async () => {
    send.mockResolvedValueOnce({ success: false });
    const session = controller.session('new-project');
    await session.start({ mode: 'new-project', workspaceRoot: root, intake });
    tabsSignal.update((items) => items.map((item) => ({ ...item, claudeSessionId: '11111111-1111-4111-8111-111111111111' })));
    expect(await session.retrySend()).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(session.record()?.sendAttempt.ackedAt).toBeDefined();
  });

  it('marks an optimistic bubble failed when send throws, then Retry sends again', async () => {
    send.mockImplementationOnce(async (content: string) => {
      tabsSignal.update((items) => items.map((item) => ({ ...item, messages: [{ id: 'optimistic', role: 'user' as const, rawContent: content }] })));
      throw new Error('provider detail');
    });
    const session = controller.session('new-project');
    expect((await session.start({ mode: 'new-project', workspaceRoot: root, intake })).kind).toBe('failed');
    expect(session.phase()).toBe('failed');
    expect(await session.retrySend()).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(tabsSignal()[0].messages).toEqual([]);
    expect((controller as unknown as { failedBubbles: Map<string, string> }).failedBubbles.size).toBe(0);
  });

  it('clears failed bubble tracking when its tab is closed', async () => {
    send.mockImplementationOnce(async (content: string) => {
      tabsSignal.update((items) => items.map((item) => ({ ...item, messages: [{ id: 'optimistic', role: 'user' as const, rawContent: content }] })));
      throw new Error('send failed');
    });
    const session = controller.session('new-project');
    await session.start({ mode: 'new-project', workspaceRoot: root, intake });
    expect((controller as unknown as { failedBubbles: Map<string, string> }).failedBubbles.size).toBe(1);
    await tabs.closeTab('tab-1');
    TestBed.flushEffects();
    expect(session.record()).toBeNull();
    expect((controller as unknown as { failedBubbles: Map<string, string> }).failedBubbles.size).toBe(0);
  });

  it('returns uncertain on abort failure and leaves the draft and tab intact', async () => {
    const session = controller.session('new-project');
    await session.start({ mode: 'new-project', workspaceRoot: root, intake });
    tabsSignal.update((items) => items.map((item) => ({ ...item, claudeSessionId: '11111111-1111-4111-8111-111111111111' })));
    abort.mockRejectedValueOnce(new Error('provider detail'));
    expect(await controller.leave('new-project', 'discard')).toBe('uncertain');
    expect(tabs.closeTab).not.toHaveBeenCalled();
    expect(records.readSession(root, 'tab-1')).not.toBeNull();
    expect(session.error()).not.toContain('provider detail');
  });

  it('keeps a busy tab when the SDK session ID has not arrived yet', async () => {
    await controller.session('new-project').start({ mode: 'new-project', workspaceRoot: root, intake });
    expect(await controller.leave('new-project', 'discard')).toBe('uncertain');
    expect(await controller.leave('new-project', 'discard')).toBe('uncertain');
    expect(abort).not.toHaveBeenCalled();
    expect(tabs.closeTab).not.toHaveBeenCalled();
    expect(records.readSession(root, 'tab-1')).not.toBeNull();
  });

  it('does not abort a loaded finished session', async () => {
    const session = controller.session('new-project');
    await session.start({ mode: 'new-project', workspaceRoot: root, intake });
    tabsSignal.update((items) => items.map((item) => ({ ...item, status: 'loaded' as const, claudeSessionId: '11111111-1111-4111-8111-111111111111' })));
    expect(await session.stop()).toBe('stopped');
    expect(abort).not.toHaveBeenCalled();
  });

  it('still aborts a streaming tab after a prior completed phase', async () => {
    const session = controller.session('new-project');
    await session.start({ mode: 'new-project', workspaceRoot: root, intake });
    tabsSignal.update((items) => items.map((item) => ({ ...item, claudeSessionId: '11111111-1111-4111-8111-111111111111' })));
    TestBed.flushEffects();
    expect(await session.restore('tab-1')).toBe('ready');
    expect(session.phase()).toBe('done');
    tabsSignal.update((items) => items.map((item) => ({ ...item, status: 'streaming' as const })));
    expect(await session.stop()).toBe('stopped');
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('discards a stopped session with its tab and record', async () => {
    const session = controller.session('new-project');
    await session.start({ mode: 'new-project', workspaceRoot: root, intake });
    tabsSignal.update((items) => items.map((item) => ({ ...item, status: 'loaded' as const })));
    expect(await controller.leave('new-project', 'discard')).toBe('left');
    expect(tabs.closeTab).toHaveBeenCalledWith('tab-1');
    expect(records.readSession(root, 'tab-1')).toBeNull();
  });

  it('surfaces an apply receipt write failure and persists offset timestamps', async () => {
    const session = controller.session('new-project');
    await session.start({ mode: 'new-project', workspaceRoot: root, intake });
    const receipt = { revisionId: 'r1', appliedPaths: ['src/app.ts'], warnings: [], appliedAt: '2026-10-31T20:00:00+02:00' };
    session.recordApply(receipt);
    expect(records.readSession(root, 'tab-1')?.applyReceipt?.appliedAt).toBe(receipt.appliedAt);
    jest.spyOn(records, 'writeSession').mockReturnValueOnce(false);
    session.recordApply({ ...receipt, revisionId: 'r2' });
    expect(session.error()).toContain('could not be saved');
    expect(session.record()?.appliedRevisionId).toBe('r1');
  });

  it('restores ready, draft, missing, workspace mismatch, wrong mode and unavailable proposal', async () => {
    const session = controller.session('new-project');
    expect(await session.restore('absent')).toBe('missing');
    expect(records.writeDraft(root, 'new-project', 'draft')).toBe(true);
    expect(await session.restore('draft')).toBe('restore-draft');
    tabsSignal.set([{ id: 'foreign', workflow: 'harness-new-project', status: 'fresh', claudeSessionId: null, messages: [] }]);
    const manager = TestBed.inject(TabManagerService);
    const original = manager.findTabByIdAcrossWorkspaces.bind(manager);
    jest.spyOn(manager, 'findTabByIdAcrossWorkspaces').mockImplementation((id) => id === 'foreign' ? { tab: tabsSignal()[0], workspacePath: '/elsewhere' } as ReturnType<typeof manager.findTabByIdAcrossWorkspaces> : original(id));
    expect(await session.restore('foreign')).toBe('workspace-mismatch');
    jest.restoreAllMocks();
    tabsSignal.set([{ id: 'tab-1', workflow: 'harness-configure', status: 'fresh', claudeSessionId: null, messages: [] }]);
    expect(await session.restore('tab-1')).toBe('wrong-mode');
    tabsSignal.update((items) => items.map((item) => ({ ...item, workflow: 'harness-new-project' as const })));
    expect(records.writeSession({ version: 1, tabId: 'tab-1', mode: 'new-project', workspacePath: root, intake, intakeHash: 'a', sendAttempt: { count: 0 } })).toBe(true);
    expect(await session.restore('tab-1')).toBe('ready');
    expect(records.writeSession({ ...session.record()!, sessionId: '11111111-1111-4111-8111-111111111111' })).toBe(true);
    getProposal.mockResolvedValueOnce({ proposal: null });
    expect(await session.restore('tab-1')).toBe('proposal-unavailable');
  });
});
