import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  AppStateManager,
  ClaudeRpcService,
  RpcResult,
} from '@ptah-extension/core';
import type { SessionBudgetState } from '@ptah-extension/shared';
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
    const layoutModeSig = signal<'single' | 'grid'>('single');
    const tab = signal<{ sessionBudget: SessionBudgetState | null }>({
      sessionBudget: budget,
    });
    const tabId = signal<string | null>('tab-abc');

    TestBed.configureTestingModule({
      providers: [
        SessionBudgetActionsService,
        { provide: ClaudeRpcService, useValue: { call: rpcCallMock } },
        { provide: ActionBannerService, useValue: { showError: showErrorMock } },
        {
          provide: TabManagerService,
          useValue: { createTab: createTabMock, activeWorkspacePath: '/ws' },
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

  it('continue writes the handoff and starts a new tab with only the seed', async () => {
    const h = setup();
    h.rpcCallMock.mockResolvedValue(
      rpcOk({
        success: true,
        handoff: { content: '# Handoff', path: '/h.md', seed: 'SEED TEXT' },
      }),
    );

    await h.service.continueInNewSession();

    expect(h.rpcCallMock).toHaveBeenCalledWith('session:budgetAction', {
      sessionId: SESSION,
      action: 'write-handoff',
    });
    expect(h.createTabMock).toHaveBeenCalledTimes(1);
    expect(h.sendOrQueueMessageMock).toHaveBeenCalledWith('SEED TEXT', {
      tabId: 'tab-new',
    });
    expect(h.requestCanvasTabMock).not.toHaveBeenCalled();
  });

  it('continue in grid layout asks the canvas to adopt the new tab', async () => {
    const h = setup();
    h.layoutModeSig.set('grid');
    h.rpcCallMock.mockResolvedValue(
      rpcOk({
        success: true,
        handoff: { content: 'c', path: null, seed: 'SEED' },
      }),
    );

    await h.service.continueInNewSession();

    expect(h.requestCanvasTabMock).toHaveBeenCalledWith('tab-new', '/ws');
  });

  it('continue opens no tab when the action fails', async () => {
    const h = setup();
    h.rpcCallMock.mockResolvedValue(rpcOk({ success: false, error: 'nope' }));

    await h.service.continueInNewSession();

    expect(h.createTabMock).not.toHaveBeenCalled();
    expect(h.sendOrQueueMessageMock).not.toHaveBeenCalled();
  });

  it('continue reports a new session that could not start', async () => {
    const h = setup();
    h.rpcCallMock.mockResolvedValue(
      rpcOk({
        success: true,
        handoff: { content: 'c', path: null, seed: 'SEED' },
      }),
    );
    h.sendOrQueueMessageMock.mockResolvedValue({
      success: false,
      error: 'busy',
    });

    await h.service.continueInNewSession();

    expect(h.showErrorMock).toHaveBeenLastCalledWith(
      'Could not start the new session: busy',
      'tab-new',
    );
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
});
