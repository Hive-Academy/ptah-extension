import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { SessionStatus } from '@ptah-extension/chat-types';
import type { SessionBudgetState } from '@ptah-extension/shared';
import { ActionBannerService } from './action-banner.service';
import { ChatStore } from './chat.store';
import {
  SESSION_WRAP_UP_PROMPT,
  SessionBudgetActionsService,
  buildWrapUpPrompt,
} from './session-budget-actions.service';

const SESSION = '11111111-1111-4111-8111-111111111111';
const BUDGET: SessionBudgetState = {
  sessionId: SESSION,
  stage: 'handoff',
  unit: 'tokens',
  measure: 'tokens',
  used: 41_200_000,
  limit: 50_000_000,
  percent: 82.4,
  lowerBound: false,
  revision: 9,
  compactions: 0,
};

describe('SessionBudgetActionsService', () => {
  function setup(budget: SessionBudgetState | null = BUDGET) {
    const sendOrQueueMessageMock = jest
      .fn()
      .mockResolvedValue({ success: true });
    const showErrorMock = jest.fn();
    const tab = signal<{
      sessionBudget: SessionBudgetState | null;
      status?: SessionStatus;
      liveBudgetStage?: 'handoff' | 'limit' | null;
    }>({ sessionBudget: budget, status: 'loaded' });
    const tabId = signal<string | null>('tab-abc');

    TestBed.configureTestingModule({
      providers: [
        SessionBudgetActionsService,
        { provide: ActionBannerService, useValue: { showError: showErrorMock } },
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
      sessionId: signal<string | null>(SESSION),
    });
    return { service, tab, tabId, sendOrQueueMessageMock, showErrorMock };
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  describe('display stage', () => {
    it('is the authoritative stage while idle', () => {
      const { service } = setup();
      expect(service.displayStage()).toBe('handoff');
    });

    it('takes the higher live stage only while the turn streams', () => {
      const { service, tab } = setup({ ...BUDGET, stage: 'tighten' });
      tab.set({
        sessionBudget: { ...BUDGET, stage: 'tighten' },
        status: 'streaming',
        liveBudgetStage: 'limit',
      });
      expect(service.displayStage()).toBe('limit');

      tab.update((current) => ({ ...current, status: 'loaded' }));
      expect(service.displayStage()).toBe('tighten');
    });

    it('is null without a budget', () => {
      const { service } = setup(null);
      expect(service.displayStage()).toBeNull();
    });
  });

  describe('dismiss', () => {
    it('records the shown stage for the session; a new stage is not dismissed', () => {
      const { service, tab } = setup();
      service.dismiss();
      expect(service.dismissedStage()).toBe('handoff');

      tab.set({ sessionBudget: { ...BUDGET, stage: 'limit' }, status: 'loaded' });
      expect(service.dismissedStage()).toBe('handoff');
      expect(service.displayStage()).toBe('limit');
    });

    it('is per session', () => {
      const { service, tab } = setup();
      service.dismiss();
      tab.set({
        sessionBudget: { ...BUDGET, sessionId: 'other-session' },
        status: 'loaded',
      });
      expect(service.dismissedStage()).toBeNull();
    });
  });

  describe('sendWrapUp', () => {
    it('sends the wrap-up prompt through the composer send path, once', async () => {
      const { service, sendOrQueueMessageMock } = setup();

      await service.sendWrapUp();
      await service.sendWrapUp();

      expect(sendOrQueueMessageMock).toHaveBeenCalledTimes(1);
      expect(sendOrQueueMessageMock).toHaveBeenCalledWith(
        buildWrapUpPrompt(BUDGET),
        { tabId: 'tab-abc' },
      );
      expect(service.wrapUpSent()).toBe(true);
    });

    it('fills in the formatted usage figure', () => {
      const prompt = buildWrapUpPrompt(BUDGET);
      expect(prompt.startsWith('This session has used 41.2M tokens.')).toBe(
        true,
      );
      expect(prompt).toContain('`HANDOFF.md`');
      expect(prompt).not.toContain('{used}');
      expect(SESSION_WRAP_UP_PROMPT).toContain('{used}');
    });

    it('reads a cost budget as an amount', () => {
      const prompt = buildWrapUpPrompt({
        ...BUDGET,
        unit: 'cost',
        measure: 'cost',
        used: 8.96,
        limit: 10,
      });
      expect(prompt.startsWith('This session has used $8.96 worth of tokens.')).toBe(
        true,
      );
    });

    it('re-enables the button when the send is not accepted', async () => {
      const { service, sendOrQueueMessageMock, showErrorMock } = setup();
      sendOrQueueMessageMock.mockResolvedValueOnce({
        success: false,
        error: 'not sent',
      });

      await service.sendWrapUp();

      expect(service.wrapUpSent()).toBe(false);
      // The send path already reports its own failure in the transcript.
      expect(showErrorMock).not.toHaveBeenCalled();
    });

    it('re-enables the button and reports a thrown send', async () => {
      const { service, sendOrQueueMessageMock, showErrorMock } = setup();
      sendOrQueueMessageMock.mockRejectedValueOnce(new Error('boom'));

      await service.sendWrapUp();

      expect(service.wrapUpSent()).toBe(false);
      expect(showErrorMock).toHaveBeenCalledWith(
        'Could not send the wrap-up request: boom',
        'tab-abc',
      );
    });

    it('sends nothing without a tab or a budget', async () => {
      const { service, tabId, sendOrQueueMessageMock } = setup();
      tabId.set(null);
      await service.sendWrapUp();
      expect(sendOrQueueMessageMock).not.toHaveBeenCalled();
    });
  });
});
