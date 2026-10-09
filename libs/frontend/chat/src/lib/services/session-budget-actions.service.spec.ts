import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  AppStateManager,
  ClaudeRpcService,
  RpcResult,
} from '@ptah-extension/core';
import type {
  SessionBudgetState,
  SessionHandoverState,
} from '@ptah-extension/shared';
import { ActionBannerService } from './action-banner.service';
import { ChatStore } from './chat.store';
import { SessionBudgetActionsService } from './session-budget-actions.service';

function rpcFail<T>(error: string): RpcResult<T> {
  return new RpcResult<T>(false, undefined, error);
}

function rpcOk<T>(data: T): RpcResult<T> {
  return new RpcResult<T>(true, data);
}

const SESSION = '11111111-1111-4111-8111-111111111111';
const BUDGET: SessionBudgetState = {
  sessionId: SESSION,
  stage: 'limit',
  unit: 'tokens',
  measure: 'tokens',
  used: 50_100_000,
  limit: 50_000_000,
  percent: 100.2,
  lowerBound: false,
  revision: 9,
  compactions: 0,
  extensions: 0,
  blocked: true,
};

const HANDOVER: SessionHandoverState = {
  operationId: 'handover-1',
  sourceSessionId: SESSION,
  reason: 'budget-limit',
  phase: 'armed',
  revision: 1,
  heldInputCount: 0,
};

describe('SessionBudgetActionsService (TASK_2026_597 N7)', () => {
  function setup(budget: SessionBudgetState | null = BUDGET) {
    const rpcCallMock = jest.fn();
    const showErrorMock = jest.fn();
    const createTabMock = jest.fn().mockReturnValue('tab-new');
    const sendOrQueueMessageMock = jest
      .fn()
      .mockResolvedValue({ success: true });
    const requestCanvasTabMock = jest.fn();
    const requestComposerPrefillMock = jest.fn();
    const clearSessionBudgetMock = jest.fn();
    const layoutModeSig = signal<'single' | 'grid'>('single');
    const tab = signal<{ sessionBudget: SessionBudgetState | null }>({
      sessionBudget: budget,
    });
    const tabId = signal<string | null>('tab-abc');
    const handoverTab = { queuedContent: ' queued follow-up ' };
    const clearQueuedContentAndOptionsMock = jest.fn();

    TestBed.configureTestingModule({
      providers: [
        SessionBudgetActionsService,
        { provide: ClaudeRpcService, useValue: { call: rpcCallMock } },
        {
          provide: ActionBannerService,
          useValue: { showError: showErrorMock },
        },
        {
          provide: TabManagerService,
          useValue: {
            createTab: createTabMock,
            clearSessionBudget: clearSessionBudgetMock,
            activeWorkspacePath: '/ws',
            findTabByIdAcrossWorkspaces: jest.fn(() => ({ tab: handoverTab })),
            clearQueuedContentAndOptions: clearQueuedContentAndOptionsMock,
          },
        },
        {
          provide: AppStateManager,
          useValue: {
            layoutMode: layoutModeSig.asReadonly(),
            requestCanvasTab: requestCanvasTabMock,
            requestComposerPrefill: requestComposerPrefillMock,
          },
        },
        {
          provide: ChatStore,
          useValue: { sendOrQueueMessage: sendOrQueueMessageMock },
        },
      ],
    });
    const service = TestBed.inject(SessionBudgetActionsService);
    service.connect({
      activeTab: tab,
      tabId,
      sessionId: signal(SESSION),
    });
    return {
      service,
      tab,
      tabId,
      layoutModeSig,
      rpcCallMock,
      showErrorMock,
      createTabMock,
      sendOrQueueMessageMock,
      requestCanvasTabMock,
      requestComposerPrefillMock,
      handoverTab,
      clearQueuedContentAndOptionsMock,
      clearSessionBudgetMock,
    };
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('passes the tab budget through', () => {
    const { service } = setup();
    expect(service.budget()).toBe(BUDGET);
  });

  it.each(['dismiss', 'extend', 'restore-window'] as const)(
    '%s calls session:budgetAction with the budget session id',
    async (action) => {
      const h = setup();
      h.rpcCallMock.mockResolvedValue(rpcOk({ success: true }));

      await h.service.runStateAction(action);

      expect(h.rpcCallMock).toHaveBeenCalledWith('session:budgetAction', {
        sessionId: SESSION,
        action,
      });
      expect(h.service.busy()).toBe(false);
    },
  );

  it('shows the returned state until a newer snapshot arrives', async () => {
    const h = setup();
    const extended = { ...BUDGET, stage: 'normal' as const, extensions: 1 };
    h.rpcCallMock.mockResolvedValue(rpcOk({ success: true, state: extended }));

    await h.service.runStateAction('extend');

    expect(h.service.budget()).toBe(extended);
  });

  it('keeps the tab budget when it is newer than the action state', async () => {
    const h = setup({ ...BUDGET, revision: 12 });
    h.rpcCallMock.mockResolvedValue(
      rpcOk({ success: true, state: { ...BUDGET, revision: 11 } }),
    );

    await h.service.runStateAction('dismiss');

    expect(h.service.budget()?.revision).toBe(12);
  });

  // TASK_2026_614 F.1 M6: revision-less states and clearing.
  it('the action state wins while the tab holds the revision-less budget it acted on', async () => {
    const h = setup({ ...BUDGET, revision: null });
    const extended = { ...BUDGET, revision: null, stage: 'normal' as const };
    h.rpcCallMock.mockResolvedValue(rpcOk({ success: true, state: extended }));

    await h.service.runStateAction('extend');

    expect(h.service.budget()).toBe(extended);
  });

  it('a later snapshot without a revision replaces the action state', async () => {
    const h = setup({ ...BUDGET, revision: null });
    h.rpcCallMock.mockResolvedValue(
      rpcOk({
        success: true,
        state: { ...BUDGET, revision: null, stage: 'normal' },
      }),
    );
    await h.service.runStateAction('extend');

    const next = { ...BUDGET, revision: null, stage: 'handoff' as const };
    h.tab.set({ sessionBudget: next });

    expect(h.service.budget()).toBe(next);
  });

  it('a tab switch clears the action state and the preview', async () => {
    const h = setup();
    const extended = { ...BUDGET, stage: 'normal' as const };
    h.rpcCallMock.mockResolvedValue(
      rpcOk({
        success: true,
        state: extended,
        handoff: { content: '# Handoff', path: null, seed: 'seed' },
      }),
    );
    await h.service.runStateAction('extend');
    await h.service.loadPreview();
    expect(h.service.budget()).toBe(extended);
    expect(h.service.previewText()).toBe('# Handoff');

    h.tabId.set('tab-other');

    expect(h.service.budget()).toBe(BUDGET);
    expect(h.service.previewText()).toBeNull();
  });

  // TASK_2026_614 F.6: a failed preview is an error, and a retry clears it.
  it('a failed preview is reported as failed, then a retry loads it', async () => {
    const h = setup();
    h.rpcCallMock.mockResolvedValueOnce(rpcFail('timeout'));

    await h.service.loadPreview();

    expect(h.service.previewText()).toBeNull();
    expect(h.service.previewFailed()).toBe(true);

    h.rpcCallMock.mockResolvedValueOnce(
      rpcOk({
        success: true,
        handoff: { content: '# Handoff', path: null, seed: 'seed' },
      }),
    );
    await h.service.loadPreview();

    expect(h.service.previewFailed()).toBe(false);
    expect(h.service.previewText()).toBe('# Handoff');
  });

  it('reports an unavailable host and a failed action', async () => {
    const h = setup();
    h.rpcCallMock.mockResolvedValueOnce(
      rpcOk({ success: false, error: 'unavailable' }),
    );
    await h.service.runStateAction('dismiss');
    expect(h.showErrorMock).toHaveBeenLastCalledWith(
      'Session budget actions are not available in this window.',
      'tab-abc',
    );

    h.rpcCallMock.mockResolvedValueOnce(rpcFail('timeout'));
    await h.service.runStateAction('extend');
    expect(h.showErrorMock).toHaveBeenLastCalledWith(
      'Budget action failed: timeout',
      'tab-abc',
    );
  });

  it('quietly clears a stale restored budget when the host has no state', async () => {
    const h = setup();
    h.rpcCallMock.mockResolvedValueOnce(
      rpcOk({
        success: false,
        error: 'No budget state for this session',
        errorCode: 'NO_SESSION_BUDGET_STATE',
      }),
    );

    await h.service.runStateAction('dismiss');

    expect(h.clearSessionBudgetMock).toHaveBeenCalledWith('tab-abc', SESSION);
    expect(h.showErrorMock).not.toHaveBeenCalled();
  });

  it('reports a rejected budget action without leaving the action busy', async () => {
    const h = setup();
    h.rpcCallMock.mockRejectedValueOnce(new Error('connection lost'));

    await h.service.runStateAction('extend');

    expect(h.showErrorMock).toHaveBeenLastCalledWith(
      'Budget action failed: connection lost',
      'tab-abc',
    );
    expect(h.service.busy()).toBe(false);
  });

  it('preview loads the handoff text for this session', async () => {
    const h = setup();
    h.rpcCallMock.mockResolvedValue(
      rpcOk({
        success: true,
        handoff: { content: '# Handoff', path: null, seed: 'seed' },
      }),
    );

    await h.service.loadPreview();

    expect(h.rpcCallMock).toHaveBeenCalledWith('session:budgetAction', {
      sessionId: SESSION,
      action: 'preview-handoff',
    });
    expect(h.service.previewText()).toBe('# Handoff');
  });

  it('continue starts one backend-owned handover and transfers queued input', async () => {
    const h = setup();
    h.rpcCallMock.mockResolvedValue(
      rpcOk({ accepted: true, state: HANDOVER }),
    );

    await h.service.continueInNewSession();

    expect(h.rpcCallMock).toHaveBeenCalledWith('session:beginHandover', {
      sourceSessionId: SESSION,
      sourceTabId: 'tab-abc',
      queuedInput: 'queued follow-up',
    });
    expect(h.createTabMock).not.toHaveBeenCalled();
    expect(h.sendOrQueueMessageMock).not.toHaveBeenCalled();
    expect(h.clearQueuedContentAndOptionsMock).toHaveBeenCalledWith('tab-abc');
  });

  it('preserves newer queued content after beginning a handover', async () => {
    const h = setup();
    let resolve!: (value: RpcResult<unknown>) => void;
    h.rpcCallMock.mockReturnValue(new Promise<RpcResult<unknown>>((done) => (resolve = done)));

    const request = h.service.continueInNewSession();
    h.handoverTab.queuedContent = 'newer draft';
    resolve(rpcOk({ accepted: true, state: HANDOVER }));
    await request;

    expect(h.clearQueuedContentAndOptionsMock).not.toHaveBeenCalled();
  });

  it('makes repeated Continue clicks single-flight', async () => {
    const h = setup();
    let resolve!: (value: RpcResult<unknown>) => void;
    h.rpcCallMock.mockReturnValue(
      new Promise<RpcResult<unknown>>((done) => (resolve = done)),
    );

    const first = h.service.continueInNewSession();
    const second = h.service.continueInNewSession();
    resolve(rpcOk({ accepted: true, state: HANDOVER }));
    await Promise.all([first, second]);

    expect(h.rpcCallMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the source tab when beginning handover fails', async () => {
    const h = setup();
    h.rpcCallMock.mockResolvedValue(rpcOk({ success: false, error: 'nope' }));

    await h.service.continueInNewSession();

    expect(h.createTabMock).not.toHaveBeenCalled();
    expect(h.sendOrQueueMessageMock).not.toHaveBeenCalled();
  });

  it('cancels an active handover to keep working', async () => {
    const h = setup();
    h.rpcCallMock.mockResolvedValueOnce(rpcOk({ accepted: true, state: HANDOVER }));
    await h.service.continueInNewSession();
    h.rpcCallMock.mockResolvedValueOnce(
      rpcOk({ cancelled: true, state: { ...HANDOVER, phase: 'cancelled', revision: 2 } }),
    );
    await h.service.cancelHandover();

    expect(h.rpcCallMock).toHaveBeenLastCalledWith('session:cancelHandover', {
      operationId: HANDOVER.operationId,
      sourceSessionId: SESSION,
    });
  });

  it('rotate previews the handoff and only prefills the new tab composer', async () => {
    const h = setup();
    h.rpcCallMock.mockResolvedValue(
      rpcOk({
        success: true,
        handoff: { content: '# H', path: null, seed: 'ROTATE SEED' },
      }),
    );

    await h.service.rotateSession();

    expect(h.rpcCallMock).toHaveBeenCalledWith('session:budgetAction', {
      sessionId: SESSION,
      action: 'preview-handoff',
    });
    expect(h.createTabMock).toHaveBeenCalledTimes(1);
    expect(h.requestComposerPrefillMock).toHaveBeenCalledWith(
      'ROTATE SEED',
      null,
    );
    expect(h.sendOrQueueMessageMock).not.toHaveBeenCalled();
  });

  it('rotate in grid layout targets the new tab composer', async () => {
    const h = setup();
    h.layoutModeSig.set('grid');
    h.rpcCallMock.mockResolvedValue(
      rpcOk({
        success: true,
        handoff: { content: 'c', path: null, seed: 'S' },
      }),
    );

    await h.service.rotateSession();

    expect(h.requestCanvasTabMock).toHaveBeenCalledWith('tab-new', '/ws');
    expect(h.requestComposerPrefillMock).toHaveBeenCalledWith('S', 'tab-new');
  });

  it('rotate opens no tab when the handoff has no seed', async () => {
    const h = setup();
    h.rpcCallMock.mockResolvedValue(rpcOk({ success: true }));

    await h.service.rotateSession();

    expect(h.createTabMock).not.toHaveBeenCalled();
    expect(h.requestComposerPrefillMock).not.toHaveBeenCalled();
    expect(h.showErrorMock).toHaveBeenLastCalledWith(
      'The handoff is not ready yet. Please try again.',
      'tab-abc',
    );
  });

  it('does nothing without a budget', async () => {
    const h = setup(null);
    await h.service.runStateAction('dismiss');
    expect(h.rpcCallMock).not.toHaveBeenCalled();
  });

  it('compact sends /compact on the composer path for this tab', async () => {
    const h = setup();
    await h.service.compact();
    expect(h.sendOrQueueMessageMock).toHaveBeenCalledWith('/compact', {
      tabId: 'tab-abc',
    });
    expect(h.rpcCallMock).not.toHaveBeenCalled();
  });

  it('compact reports a failed send and stays quiet at the budget limit', async () => {
    const h = setup();
    h.sendOrQueueMessageMock.mockResolvedValueOnce({
      success: false,
      error: 'nope',
    });
    await h.service.compact();
    expect(h.showErrorMock).toHaveBeenCalledWith('nope', 'tab-abc');

    h.sendOrQueueMessageMock.mockResolvedValueOnce({
      success: false,
      errorCode: 'SESSION_BUDGET_REACHED',
    });
    await h.service.compact();
    expect(h.showErrorMock).toHaveBeenCalledTimes(1);
  });

  it('records a usage point when used changes and skips a repeat', () => {
    const h = setup({ ...BUDGET, used: 10, percent: 10 });
    TestBed.flushEffects();
    expect(h.service.usage().map((sample) => sample.used)).toEqual([10]);

    h.tab.set({ sessionBudget: { ...BUDGET, used: 10, percent: 11 } });
    TestBed.flushEffects();
    expect(h.service.usage()).toHaveLength(1);

    h.tab.set({ sessionBudget: { ...BUDGET, used: 20, percent: 20 } });
    TestBed.flushEffects();
    expect(h.service.usage().map((sample) => sample.used)).toEqual([10, 20]);
  });

  it('resets the series on a session change and when the budget clears', () => {
    const h = setup({ ...BUDGET, used: 10, percent: 10 });
    TestBed.flushEffects();

    h.tab.set({
      sessionBudget: {
        ...BUDGET,
        sessionId: '22222222-2222-4222-8222-222222222222',
        used: 4,
        percent: 1,
      },
    });
    TestBed.flushEffects();
    expect(h.service.usage().map((sample) => sample.used)).toEqual([4]);

    h.tab.set({ sessionBudget: null });
    TestBed.flushEffects();
    expect(h.service.usage()).toEqual([]);
  });

  it('keeps at most 60 usage samples', () => {
    const h = setup({ ...BUDGET, used: 1, percent: 1 });
    TestBed.flushEffects();
    for (let used = 2; used <= 80; used++) {
      h.tab.set({ sessionBudget: { ...BUDGET, used, percent: used } });
      TestBed.flushEffects();
    }
    const series = h.service.usage();
    expect(series).toHaveLength(60);
    expect(series[0]?.used).toBe(21);
    expect(series[59]?.used).toBe(80);
  });
});
