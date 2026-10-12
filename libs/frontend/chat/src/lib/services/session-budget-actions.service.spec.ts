import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { SessionStatus } from '@ptah-extension/chat-types';
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
import { SessionHandoverClientService } from './session-handover-client.service';

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
    const tab = signal<{
      sessionBudget: SessionBudgetState | null;
      status?: SessionStatus;
      liveBudgetStage?: 'handoff' | 'limit' | null;
    }>({
      sessionBudget: budget,
    });
    const tabId = signal<string | null>('tab-abc');
    const handoverTab = { queuedContent: ' queued follow-up ' };
    const clearQueuedContentAndOptionsMock = jest.fn();
    const showWarningMock = jest.fn();
    const showInfoMock = jest.fn();
    const switchTabMock = jest.fn();
    const findTabMock = jest.fn(
      (_id: string): { tab: typeof handoverTab } | null => ({ tab: handoverTab }),
    );

    TestBed.configureTestingModule({
      providers: [
        SessionBudgetActionsService,
        { provide: ClaudeRpcService, useValue: { call: rpcCallMock } },
        {
          provide: ActionBannerService,
          useValue: {
            showError: showErrorMock,
            showWarning: showWarningMock,
            showInfo: showInfoMock,
          },
        },
        {
          provide: TabManagerService,
          useValue: {
            createTab: createTabMock,
            clearSessionBudget: clearSessionBudgetMock,
            activeWorkspacePath: '/ws',
            findTabByIdAcrossWorkspaces: findTabMock,
            clearQueuedContentAndOptions: clearQueuedContentAndOptionsMock,
            switchTab: switchTabMock,
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
      showWarningMock,
      showInfoMock,
      switchTabMock,
      findTabMock,
    };
  }

  /** A handover that failed because the coordinator found no source. */
  function recordSourceUnavailableFailure(): void {
    TestBed.inject(SessionHandoverClientService).record(SESSION, {
      ...HANDOVER,
      phase: 'failed',
      revision: 2,
      error: 'source session unavailable',
    });
  }

  const NO_STATE = {
    success: false,
    error: 'No budget state for this session',
    errorCode: 'NO_SESSION_BUDGET_STATE',
  };
  const NO_HANDOFF_NOTICE =
    'The previous session has ended and no handoff could be built for it. This new session starts without its context.';

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
      rpcOk({ accepted: true, state: HANDOVER, draftCaptured: true }),
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
    resolve(rpcOk({ accepted: true, state: HANDOVER, draftCaptured: true }));
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

  // TASK_2026_627 Component 9: a gone source can never be handed over.
  it('falls back to a new tab with the seed when the source is unavailable', async () => {
    const h = setup();
    h.rpcCallMock
      .mockResolvedValueOnce(rpcOk({ accepted: false, error: 'source-unavailable' }))
      .mockResolvedValueOnce(
        rpcOk({
          success: true,
          handoff: { content: '# H', path: null, seed: 'FALLBACK SEED' },
        }),
      );

    await h.service.continueInNewSession();

    expect(h.rpcCallMock).toHaveBeenNthCalledWith(2, 'session:budgetAction', {
      sessionId: SESSION,
      action: 'preview-handoff',
    });
    expect(h.createTabMock).toHaveBeenCalledTimes(1);
    expect(h.requestComposerPrefillMock).toHaveBeenCalledWith('FALLBACK SEED', null);
    expect(h.showErrorMock).not.toHaveBeenCalled();
    expect(h.clearQueuedContentAndOptionsMock).not.toHaveBeenCalled();
    expect(h.service.busy()).toBe(false);
  });

  it('still reports an unavailable host without opening a tab', async () => {
    const h = setup();
    h.rpcCallMock.mockResolvedValue(rpcOk({ accepted: false, error: 'unavailable' }));

    await h.service.continueInNewSession();

    expect(h.rpcCallMock).toHaveBeenCalledTimes(1);
    expect(h.createTabMock).not.toHaveBeenCalled();
    expect(h.showErrorMock).toHaveBeenCalledWith(
      'Session handover is not available in this window.',
      'tab-abc',
    );
  });

  it('Retry after a "source session unavailable" failure opens a new tab with the seed', async () => {
    const h = setup();
    TestBed.inject(SessionHandoverClientService).record(SESSION, {
      ...HANDOVER,
      phase: 'failed',
      revision: 2,
      error: 'source session unavailable',
    });
    h.rpcCallMock.mockResolvedValue(
      rpcOk({
        success: true,
        handoff: { content: '# H', path: null, seed: 'RETRY SEED' },
      }),
    );

    await h.service.continueInNewSession();

    expect(h.rpcCallMock).not.toHaveBeenCalledWith(
      'session:beginHandover',
      expect.anything(),
    );
    expect(h.createTabMock).toHaveBeenCalledTimes(1);
    expect(h.requestComposerPrefillMock).toHaveBeenCalledWith('RETRY SEED', null);
  });

  it('Retry after any other failure begins a new handover', async () => {
    const h = setup();
    TestBed.inject(SessionHandoverClientService).record(SESSION, {
      ...HANDOVER,
      phase: 'failed',
      revision: 2,
      error: 'handover unavailable',
    });
    h.rpcCallMock.mockResolvedValue(
      rpcOk({ accepted: true, state: { ...HANDOVER, revision: 3 } }),
    );

    await h.service.continueInNewSession();

    expect(h.rpcCallMock).toHaveBeenCalledWith(
      'session:beginHandover',
      expect.objectContaining({ sourceSessionId: SESSION }),
    );
    expect(h.createTabMock).not.toHaveBeenCalled();
  });

  // 627 6F S1: the session ended, so the host released its budget entry and
  // the webview may already have cleared the card.
  it('Retry for an ended source with no budget card still asks the host and opens a seeded tab', async () => {
    const h = setup(null);
    recordSourceUnavailableFailure();
    h.rpcCallMock.mockResolvedValue(
      rpcOk({
        success: true,
        handoff: { content: '# H', path: `/h/${SESSION}.md`, seed: 'FILE SEED' },
      }),
    );

    await h.service.continueInNewSession();

    expect(h.rpcCallMock).toHaveBeenCalledWith('session:budgetAction', {
      sessionId: SESSION,
      action: 'preview-handoff',
    });
    expect(h.createTabMock).toHaveBeenCalledTimes(1);
    expect(h.requestComposerPrefillMock).toHaveBeenCalledWith('FILE SEED', null);
    expect(h.showWarningMock).not.toHaveBeenCalled();
    expect(h.service.busy()).toBe(false);
  });

  it('an ended source with no handoff still opens a new tab, with a visible notice', async () => {
    const h = setup();
    h.rpcCallMock
      .mockResolvedValueOnce(rpcOk({ accepted: false, error: 'source-unavailable' }))
      .mockResolvedValueOnce(rpcOk(NO_STATE));

    await h.service.continueInNewSession();

    expect(h.createTabMock).toHaveBeenCalledTimes(1);
    expect(h.requestComposerPrefillMock).not.toHaveBeenCalled();
    expect(h.showWarningMock).toHaveBeenCalledWith(NO_HANDOFF_NOTICE, 'tab-new');
    // The host no longer tracks the session: its stale card is cleared.
    expect(h.clearSessionBudgetMock).toHaveBeenCalledWith('tab-abc', SESSION);
    expect(h.service.busy()).toBe(false);
  });

  it('an ended source whose preview call throws still opens a new tab, with the notice', async () => {
    const h = setup();
    recordSourceUnavailableFailure();
    h.rpcCallMock.mockRejectedValue(new Error('transport closed'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await h.service.continueInNewSession();

    expect(h.createTabMock).toHaveBeenCalledTimes(1);
    expect(h.showWarningMock).toHaveBeenCalledWith(NO_HANDOFF_NOTICE, 'tab-new');
    expect(warn).toHaveBeenCalled();
    expect(h.service.busy()).toBe(false);
    warn.mockRestore();
  });

  // 627 6F M1: one tab per gone source, however often Retry is pressed.
  it('a second Retry after the fallback switches to the tab it opened', async () => {
    const h = setup();
    recordSourceUnavailableFailure();
    h.rpcCallMock.mockResolvedValue(
      rpcOk({ success: true, handoff: { content: '# H', path: null, seed: 'SEED' } }),
    );

    await h.service.continueInNewSession();
    await h.service.continueInNewSession();

    expect(h.createTabMock).toHaveBeenCalledTimes(1);
    expect(h.requestComposerPrefillMock).toHaveBeenCalledTimes(1);
    expect(h.rpcCallMock).toHaveBeenCalledTimes(1);
    expect(h.switchTabMock).toHaveBeenCalledWith('tab-new');
  });

  it('a second Continue after a refused begin switches to the tab it opened', async () => {
    const h = setup();
    h.rpcCallMock.mockImplementation(async (method: string) =>
      method === 'session:beginHandover'
        ? rpcOk({ accepted: false, error: 'source-unavailable' })
        : rpcOk({ success: true, handoff: { content: '# H', path: null, seed: 'SEED' } }),
    );

    await h.service.continueInNewSession();
    await h.service.continueInNewSession();

    expect(h.createTabMock).toHaveBeenCalledTimes(1);
    expect(h.switchTabMock).toHaveBeenCalledWith('tab-new');
  });

  it('opens a fresh tab when the one opened for the gone source was closed', async () => {
    const h = setup();
    recordSourceUnavailableFailure();
    h.rpcCallMock.mockResolvedValue(
      rpcOk({ success: true, handoff: { content: '# H', path: null, seed: 'SEED' } }),
    );

    await h.service.continueInNewSession();
    h.findTabMock.mockImplementation((id: string) =>
      id === 'tab-new' ? null : { tab: h.handoverTab },
    );
    h.createTabMock.mockReturnValue('tab-newer');
    await h.service.continueInNewSession();

    expect(h.createTabMock).toHaveBeenCalledTimes(2);
    expect(h.switchTabMock).not.toHaveBeenCalled();
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

  // TASK_2026_627 Batch 15 (F1): display stage, wrap-up, continue now, Approve.
  describe('user-authorized handover (TASK_2026_627)', () => {
    const HANDOFF_BUDGET: SessionBudgetState = {
      ...BUDGET,
      stage: 'handoff',
      used: 40_000_000,
      percent: 80,
      blocked: false,
    };
    const WRAP_UP_UNAVAILABLE = {
      success: false,
      error: 'No turn is running',
      errorCode: 'WRAP_UP_UNAVAILABLE',
    };

    function streaming(
      h: ReturnType<typeof setup>,
      liveBudgetStage: 'handoff' | 'limit' | null = null,
      sessionBudget: SessionBudgetState | null = h.tab().sessionBudget,
    ): void {
      h.tab.set({ sessionBudget, status: 'streaming', liveBudgetStage });
    }

    describe('displayStage (S21)', () => {
      it('is the higher of the authoritative and the live stage while streaming', () => {
        const h = setup({ ...HANDOFF_BUDGET, stage: 'normal' });
        streaming(h, 'handoff');
        expect(h.service.liveStage()).toBe('handoff');
        expect(h.service.displayStage()).toBe('handoff');

        streaming(h, 'limit');
        expect(h.service.displayStage()).toBe('limit');
      });

      it('never lowers the authoritative stage', () => {
        const h = setup(BUDGET);
        streaming(h, 'handoff');
        expect(h.service.displayStage()).toBe('limit');
      });

      it.each(['loaded', 'awaiting-background', 'resuming'] as const)(
        'ignores the live stage on a %s tab',
        (status) => {
          const h = setup({ ...HANDOFF_BUDGET, stage: 'tighten' });
          h.tab.set({
            sessionBudget: h.tab().sessionBudget,
            status,
            liveBudgetStage: 'limit',
          });
          expect(h.service.liveStage()).toBeNull();
          expect(h.service.displayStage()).toBe('tighten');
        },
      );

      it('is null, and ignores the live stage, without a budget', () => {
        const h = setup(null);
        streaming(h, 'limit', null);
        expect(h.service.liveStage()).toBeNull();
        expect(h.service.displayStage()).toBeNull();
      });
    });

    describe('requestWrapUp (S13)', () => {
      it('sends request-wrap-up once per stage while a turn runs', async () => {
        const h = setup(HANDOFF_BUDGET);
        streaming(h);
        h.rpcCallMock.mockResolvedValue(rpcOk({ success: true }));

        await h.service.requestWrapUp();
        await h.service.requestWrapUp();

        expect(h.rpcCallMock).toHaveBeenCalledTimes(1);
        expect(h.rpcCallMock).toHaveBeenCalledWith('session:budgetAction', {
          sessionId: SESSION,
          action: 'request-wrap-up',
        });
        expect(h.service.wrapUpRequested()).toBe(true);

        // A higher (live) stage is a new key: one more request is allowed.
        streaming(h, 'limit');
        expect(h.service.wrapUpRequested()).toBe(false);
        await h.service.requestWrapUp();
        expect(h.rpcCallMock).toHaveBeenCalledTimes(2);
      });

      it('resets when the tab leaves streaming, for the next turn', async () => {
        const h = setup(HANDOFF_BUDGET);
        streaming(h);
        h.rpcCallMock.mockResolvedValue(rpcOk({ success: true }));
        await h.service.requestWrapUp();
        expect(h.service.wrapUpRequested()).toBe(true);

        h.tab.set({ sessionBudget: HANDOFF_BUDGET, status: 'loaded' });
        expect(h.service.wrapUpRequested()).toBe(false);
        streaming(h);
        expect(h.service.wrapUpRequested()).toBe(false);

        await h.service.requestWrapUp();
        expect(h.rpcCallMock).toHaveBeenCalledTimes(2);
      });

      it('does nothing while idle or below the handoff stage', async () => {
        const idle = setup(HANDOFF_BUDGET);
        idle.tab.set({ sessionBudget: HANDOFF_BUDGET, status: 'loaded' });
        await idle.service.requestWrapUp();
        expect(idle.rpcCallMock).not.toHaveBeenCalled();
        TestBed.resetTestingModule();

        const low = setup({ ...HANDOFF_BUDGET, stage: 'tighten' });
        streaming(low);
        await low.service.requestWrapUp();
        expect(low.rpcCallMock).not.toHaveBeenCalled();
      });

      it('shows the host refusal as a notice, not an error', async () => {
        const h = setup(HANDOFF_BUDGET);
        streaming(h);
        h.rpcCallMock.mockResolvedValue(rpcOk(WRAP_UP_UNAVAILABLE));

        await h.service.requestWrapUp();

        expect(h.showInfoMock).toHaveBeenCalledWith(
          'The agent is not working on a turn right now.',
          'tab-abc',
        );
        expect(h.showErrorMock).not.toHaveBeenCalled();
        expect(h.service.busy()).toBe(false);
      });

      it('re-enables the button after a failed request', async () => {
        const h = setup(HANDOFF_BUDGET);
        streaming(h);
        h.rpcCallMock.mockRejectedValueOnce(new Error('transport down'));

        await h.service.requestWrapUp();

        expect(h.service.wrapUpRequested()).toBe(false);
        expect(h.showErrorMock).toHaveBeenCalledWith(
          'Budget action failed: transport down',
          'tab-abc',
        );
      });
    });

    it('continueNowAnyway begins with continueNow and the queued input', async () => {
      const h = setup(HANDOFF_BUDGET);
      h.rpcCallMock.mockResolvedValue(
        rpcOk({
          accepted: true,
          state: { ...HANDOVER, phase: 'starting-successor' },
          draftCaptured: true,
        }),
      );

      await h.service.continueNowAnyway();

      expect(h.rpcCallMock).toHaveBeenCalledWith('session:beginHandover', {
        sourceSessionId: SESSION,
        sourceTabId: 'tab-abc',
        queuedInput: 'queued follow-up',
        continueNow: true,
      });
      expect(h.sendOrQueueMessageMock).not.toHaveBeenCalled();
      expect(h.clearQueuedContentAndOptionsMock).toHaveBeenCalledWith('tab-abc');
    });

    it('continueInNewSession never sends continueNow', async () => {
      const h = setup(HANDOFF_BUDGET);
      h.rpcCallMock.mockResolvedValue(rpcOk({ accepted: true, state: HANDOVER }));

      await h.service.continueInNewSession();

      expect(h.rpcCallMock.mock.calls[0]?.[1]).not.toHaveProperty('continueNow');
    });

    describe('queued message carried with the handover (R5)', () => {
      it('is flagged from the accepted begin until the handover ends', async () => {
        const h = setup(HANDOFF_BUDGET);
        h.rpcCallMock.mockResolvedValue(
          rpcOk({
            accepted: true,
            state: { ...HANDOVER, phase: 'waiting-for-turn-end' },
            draftCaptured: true,
          }),
        );

        await h.service.continueInNewSession();
        expect(h.service.queuedMessageCarried()).toBe(true);

        TestBed.inject(SessionHandoverClientService).record(SESSION, {
          ...HANDOVER,
          phase: 'cancelled',
          revision: 2,
        });
        expect(h.service.queuedMessageCarried()).toBe(false);
      });

      it('is not flagged when the composer had no queued message', async () => {
        const h = setup(HANDOFF_BUDGET);
        h.handoverTab.queuedContent = '   ';
        h.rpcCallMock.mockResolvedValue(
          rpcOk({
            accepted: true,
            state: { ...HANDOVER, phase: 'waiting-for-turn-end' },
          }),
        );

        await h.service.continueInNewSession();

        expect(h.service.queuedMessageCarried()).toBe(false);
        expect(h.rpcCallMock.mock.calls[0]?.[1]).not.toHaveProperty('queuedInput');
      });

      it('keeps the composer text when an accepted begin did not capture it (closing)', async () => {
        const h = setup(HANDOFF_BUDGET);
        h.rpcCallMock.mockResolvedValue(
          rpcOk({
            accepted: true,
            state: { ...HANDOVER, phase: 'closing', revision: 4 },
          }),
        );

        await h.service.continueInNewSession();

        expect(h.rpcCallMock.mock.calls[0]?.[1]).toHaveProperty(
          'queuedInput',
          'queued follow-up',
        );
        expect(h.clearQueuedContentAndOptionsMock).not.toHaveBeenCalled();
        expect(h.handoverTab.queuedContent).toBe(' queued follow-up ');
        expect(h.service.queuedMessageCarried()).toBe(false);
      });

      it('is not flagged for a refused begin', async () => {
        const h = setup(HANDOFF_BUDGET);
        h.rpcCallMock.mockResolvedValue(
          rpcOk({ accepted: false, error: 'unavailable' }),
        );

        await h.service.continueInNewSession();

        expect(h.service.queuedMessageCarried()).toBe(false);
        expect(h.clearQueuedContentAndOptionsMock).not.toHaveBeenCalled();
      });
    });

    describe("an agent's successor request (S18)", () => {
      const AGENT_REQUEST: SessionHandoverState = {
        ...HANDOVER,
        reason: 'successor',
        phase: 'awaiting-confirmation',
        requestedBy: 'agent',
      };

      it('Approve goes through the user begin path', async () => {
        const h = setup(HANDOFF_BUDGET);
        const client = TestBed.inject(SessionHandoverClientService);
        client.record(SESSION, AGENT_REQUEST);
        h.rpcCallMock.mockResolvedValue(
          rpcOk({
            accepted: true,
            state: { ...HANDOVER, reason: 'successor', phase: 'writing-handoff', revision: 2 },
          }),
        );

        await h.service.continueInNewSession();

        expect(h.rpcCallMock).toHaveBeenCalledWith('session:beginHandover', {
          sourceSessionId: SESSION,
          sourceTabId: 'tab-abc',
          queuedInput: 'queued follow-up',
        });
        expect(client.stateFor(SESSION)?.phase).toBe('writing-handoff');
      });

      it('Cancel cancels the parked request', async () => {
        const h = setup(HANDOFF_BUDGET);
        TestBed.inject(SessionHandoverClientService).record(SESSION, AGENT_REQUEST);
        h.rpcCallMock.mockResolvedValue(
          rpcOk({
            cancelled: true,
            state: { ...AGENT_REQUEST, phase: 'cancelled', revision: 2, requestedBy: undefined },
          }),
        );

        await h.service.cancelHandover();

        expect(h.rpcCallMock).toHaveBeenCalledWith('session:cancelHandover', {
          operationId: HANDOVER.operationId,
          sourceSessionId: SESSION,
        });
      });
    });

    // R-P7: a dropped broadcast must not lose the returned draft.
    it('cancelHandover records the returned state, so its draft can be peeked', async () => {
      const h = setup(HANDOFF_BUDGET);
      const client = TestBed.inject(SessionHandoverClientService);
      client.record(SESSION, { ...HANDOVER, phase: 'waiting-for-turn-end' });
      h.rpcCallMock.mockResolvedValue(
        rpcOk({
          cancelled: true,
          state: {
            ...HANDOVER,
            phase: 'cancelled',
            revision: 2,
            draftText: 'my unsent message',
          },
        }),
      );

      await h.service.cancelHandover();

      expect(client.peekDraft(SESSION)).toEqual({
        operationId: HANDOVER.operationId,
        text: 'my unsent message',
      });
      expect(h.sendOrQueueMessageMock).not.toHaveBeenCalled();
    });
  });
});
