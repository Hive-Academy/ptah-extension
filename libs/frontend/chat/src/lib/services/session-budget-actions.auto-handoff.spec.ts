/** Banner projection and cancellation of a queued automatic hand-off. */
import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { QueuedFollowUpStore } from '@ptah-extension/chat-state';
import type { SessionBudgetState } from '@ptah-extension/shared';
import { ActionBannerService } from './action-banner.service';
import { ChatStore } from './chat.store';
import { FollowUpQueueService } from './chat-store/follow-up-queue.service';
import { SessionAutoHandoffService } from './session-auto-handoff.service';
import { SessionBudgetActionsService } from './session-budget-actions.service';
import { SessionHandoffSkillService } from './session-handoff-skill.service';

const TAB = 'tab-1';
const SESSION = '11111111-1111-4111-8111-111111111111';
const COMMAND = '/session-handoff This session has used 50.0M tokens.';
const BUDGET: SessionBudgetState = {
  sessionId: SESSION, stage: 'limit', unit: 'tokens', measure: 'tokens',
  used: 50_000_000, limit: 50_000_000, percent: 100, lowerBound: false,
  revision: 12, compactions: 0, autoHandoff: true,
  closeSourceAfterAutoHandoff: false,
};

describe('SessionBudgetActionsService automatic hand-off', () => {
  let service: SessionBudgetActionsService;
  let autoHandoff: SessionAutoHandoffService;
  let store: QueuedFollowUpStore;
  let withdraw: jest.Mock;
  const ref = { clientMessageId: 'auto-1', tabId: TAB, sessionId: SESSION };

  const connect = (target: SessionBudgetActionsService) => target.connect({
    activeTab: signal({ sessionBudget: BUDGET, status: 'streaming' as const }),
    tabId: signal<string | null>(TAB), sessionId: signal<string | null>(SESSION),
    bannerVisible: signal(true),
  });
  const queue = (id = ref.clientMessageId, content = COMMAND) => {
    store.add({ clientMessageId: id, tabId: TAB, sessionId: SESSION,
      content, isCommand: content.startsWith('/'), phase: 'held' });
    return { clientMessageId: id, tabId: TAB, sessionId: SESSION };
  };
  const seed = () => {
    expect(autoHandoff.claim(SESSION)).toBe(true);
    autoHandoff.recordQueued(SESSION, queue());
  };

  beforeEach(() => {
    withdraw = jest.fn().mockImplementation(async (queued) =>
      store.settle(queued.clientMessageId, 'withdrawn') !== null);
    TestBed.configureTestingModule({ providers: [
      SessionBudgetActionsService, SessionAutoHandoffService, QueuedFollowUpStore,
      { provide: FollowUpQueueService, useValue: { withdraw } },
      { provide: ChatStore, useValue: { sendOrQueueMessage: jest.fn() } },
      { provide: SessionHandoffSkillService, useValue: { probe: jest.fn() } },
      { provide: ActionBannerService, useValue: { showError: jest.fn() } },
    ] });
    service = TestBed.inject(SessionBudgetActionsService);
    autoHandoff = TestBed.inject(SessionAutoHandoffService);
    store = TestBed.inject(QueuedFollowUpStore);
    connect(service);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('projects one pending hand-off in every view and clears on delivery', () => {
    const second = Injector.create({ providers: [SessionBudgetActionsService],
      parent: TestBed.inject(Injector) }).get(SessionBudgetActionsService);
    connect(second);
    seed();
    expect(store.forView(TAB, SESSION).map((entry) => entry.content)).toEqual([COMMAND]);
    expect(service.autoHandoffQueued()).toBe(true);
    expect(second.autoHandoffQueued()).toBe(true);
    expect(service.wrapUpSent()).toBe(true);
    store.settle(ref.clientMessageId, 'delivered');
    expect(service.autoHandoffQueued()).toBe(false);
    expect(second.autoHandoffQueued()).toBe(false);
    expect(service.wrapUpSent()).toBe(true);
    expect(autoHandoff.claim(SESSION)).toBe(false);
  });

  it('keeps wrap-up disabled after a direct automatic hand-off', () => {
    expect(autoHandoff.claim(SESSION)).toBe(true);
    autoHandoff.recordQueued(SESSION, null);
    expect(service.autoHandoffQueued()).toBe(false);
    expect(service.wrapUpSent()).toBe(true);
  });

  it('Cancel withdraws only the automatic item without restoring it', async () => {
    seed();
    const user = queue('user-1', COMMAND);
    await service.cancelAutoHandoff();
    expect(withdraw).toHaveBeenCalledWith(ref, { restore: false });
    expect(store.get(ref.clientMessageId)).toBeNull();
    expect(store.get(user.clientMessageId)?.content).toBe(COMMAND);
    expect(service.autoHandoffQueued()).toBe(false);
    expect(service.wrapUpSent()).toBe(false);
    expect(autoHandoff.entry(SESSION)?.state).toBe('cancelled');
    expect(autoHandoff.claim(SESSION)).toBe(false);
  });

  it('Cancel keeps unrelated queued text and shows no error', async () => {
    seed();
    queue('text-1', 'also check tests');
    await service.cancelAutoHandoff();
    expect(store.forView(TAB, SESSION).map((entry) => entry.content)).toEqual(['also check tests']);
    expect(TestBed.inject(ActionBannerService).showError).not.toHaveBeenCalled();
  });

  it('reverts Cancel when a turn has already claimed the item', async () => {
    seed();
    withdraw.mockResolvedValueOnce(false);
    await service.cancelAutoHandoff();
    expect(autoHandoff.entry(SESSION)?.state).toBe('fired');
    expect(service.autoHandoffQueued()).toBe(true);
    expect(service.wrapUpSent()).toBe(true);
  });

  // The callers (coordinator, source closer) gate the automatic trigger on
  // isManuallyWrappedUp; claim() itself only tracks the fired entry.
  it('a manual wrap-up marks the session until its failure clears the mark', () => {
    autoHandoff.markManualWrapUp(SESSION);
    expect(autoHandoff.isManuallyWrappedUp(SESSION)).toBe(true);
    autoHandoff.clearManualWrapUp(SESSION);
    expect(autoHandoff.isManuallyWrappedUp(SESSION)).toBe(false);
    expect(autoHandoff.claim(SESSION)).toBe(true);
  });
});
