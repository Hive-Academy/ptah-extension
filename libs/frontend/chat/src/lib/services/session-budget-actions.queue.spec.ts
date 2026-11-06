/** Manual wrap-up tracks its queued follow-up by identity and outcome. */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { QueuedFollowUpStore } from '@ptah-extension/chat-state';
import type { SessionBudgetState } from '@ptah-extension/shared';
import { ActionBannerService } from './action-banner.service';
import { ChatStore } from './chat.store';
import { FollowUpQueueService } from './chat-store/follow-up-queue.service';
import { SessionAutoHandoffService } from './session-auto-handoff.service';
import { SessionBudgetActionsService } from './session-budget-actions.service';
import { SessionHandoffSkillService } from './session-handoff-skill.service';
import { SESSION_HANDOFF_COMMAND } from './session-handoff-prompts';

const TAB = 'tab-1';
const SESSION = '11111111-1111-4111-8111-111111111111';
const COMMAND = '/session-handoff This session has used 41.2M tokens.';
const BUDGET: SessionBudgetState = {
  sessionId: SESSION, stage: 'handoff', unit: 'tokens', measure: 'tokens',
  used: 41_200_000, limit: 50_000_000, percent: 82.4, lowerBound: false,
  revision: 9, compactions: 0, autoHandoff: false,
  closeSourceAfterAutoHandoff: false,
};

describe('SessionBudgetActionsService manual wrap-up', () => {
  let service: SessionBudgetActionsService;
  let autoHandoff: SessionAutoHandoffService;
  let store: QueuedFollowUpStore;
  let send: jest.Mock;
  let showError: jest.Mock;
  let nextId: number;

  beforeEach(() => {
    nextId = 0;
    showError = jest.fn();
    TestBed.configureTestingModule({ providers: [
      SessionBudgetActionsService, SessionAutoHandoffService, QueuedFollowUpStore,
      { provide: FollowUpQueueService, useValue: {} },
      { provide: SessionHandoffSkillService, useValue: { probe: jest.fn().mockResolvedValue('available') } },
      { provide: ActionBannerService, useValue: { showError } },
      { provide: ChatStore, useValue: { sendOrQueueMessage: (...args: unknown[]) => send(...args) } },
    ] });
    store = TestBed.inject(QueuedFollowUpStore);
    send = jest.fn().mockImplementation(async (content: string) => {
      const clientMessageId = `queued-${++nextId}`;
      store.add({ clientMessageId, tabId: TAB, sessionId: SESSION,
        content, isCommand: content.startsWith('/'), phase: 'held' });
      return { success: true, queued: { clientMessageId, tabId: TAB, sessionId: SESSION } };
    });
    service = TestBed.inject(SessionBudgetActionsService);
    autoHandoff = TestBed.inject(SessionAutoHandoffService);
    service.connect({
      activeTab: signal({ sessionBudget: BUDGET, status: 'streaming' as const }),
      tabId: signal<string | null>(TAB), sessionId: signal<string | null>(SESSION),
      bannerVisible: signal(true),
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('queues the slash command separately behind existing text and marks the session', async () => {
    store.add({ clientMessageId: 'text-1', tabId: TAB, sessionId: SESSION,
      content: 'Please check tests', isCommand: false, phase: 'queued' });
    await service.sendWrapUp();
    expect(send).toHaveBeenCalledWith(COMMAND, { tabId: TAB });
    expect(store.forView(TAB, SESSION).map((entry) => entry.content)).toEqual([
      'Please check tests', COMMAND,
    ]);
    expect(store.forView(TAB, SESSION)[1].isCommand).toBe(true);
    expect(service.wrapUpSent()).toBe(true);
    expect(autoHandoff.isManuallyWrappedUp(SESSION)).toBe(true);
    expect(showError).not.toHaveBeenCalled();
  });

  it('keeps a delivered queued wrap-up marked without another send', async () => {
    await service.sendWrapUp();
    store.settle('queued-1', 'delivered');
    expect(store.forView(TAB, SESSION)).toEqual([]);
    expect(service.wrapUpSent()).toBe(true);
    await service.sendWrapUp();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each(['withdrawn', 'failed'] as const)(
    're-enables the button when the queued wrap-up is %s', async (outcome) => {
      await service.sendWrapUp();
      store.settle('queued-1', outcome);
      expect(service.wrapUpSent()).toBe(false);
      expect(autoHandoff.isManuallyWrappedUp(SESSION)).toBe(false);
      expect(showError).toHaveBeenCalledWith(
        expect.stringContaining('wrap-up request was not sent'), TAB,
      );
    },
  );

  it('clears the mark after a failed send so the automatic trigger may claim', async () => {
    send.mockResolvedValueOnce({ success: false, error: 'offline' });
    await service.sendWrapUp();
    expect(service.wrapUpSent()).toBe(false);
    expect(autoHandoff.isManuallyWrappedUp(SESSION)).toBe(false);
    expect(autoHandoff.claim(SESSION)).toBe(true);
  });

  it('keeps a directly sent wrap-up marked', async () => {
    send.mockResolvedValueOnce({ success: true });
    await service.sendWrapUp();
    expect(store.forView(TAB, SESSION)).toEqual([]);
    expect(service.wrapUpSent()).toBe(true);
    expect(autoHandoff.isManuallyWrappedUp(SESSION)).toBe(true);
  });

  it('does not send into a different tab after the skill probe resolves', async () => {
    let finishProbe!: (value: 'available') => void;
    jest.spyOn(TestBed.inject(SessionHandoffSkillService), 'probe').mockImplementationOnce(
      () => new Promise((resolve) => { finishProbe = resolve; }),
    );
    const shownTabId = signal<string | null>(TAB);
    service.connect({ activeTab: signal({ sessionBudget: BUDGET, status: 'streaming' as const }),
      tabId: shownTabId, sessionId: signal<string | null>(SESSION), bannerVisible: signal(true) });
    const pending = service.sendWrapUp();
    shownTabId.set('another-tab');
    finishProbe('available');
    await pending;
    expect(send).not.toHaveBeenCalled();
    expect(service.wrapUpSent()).toBe(false);
    expect(autoHandoff.isManuallyWrappedUp(SESSION)).toBe(false);
  });

  it('uses the inline prompt when the skill is unavailable', async () => {
    jest.spyOn(TestBed.inject(SessionHandoffSkillService), 'probe').mockResolvedValueOnce('missing');
    await service.sendWrapUp();
    expect(send).toHaveBeenCalledWith(
      expect.not.stringContaining(SESSION_HANDOFF_COMMAND), { tabId: TAB },
    );
    expect(store.forView(TAB, SESSION)).toHaveLength(1);
  });
});
