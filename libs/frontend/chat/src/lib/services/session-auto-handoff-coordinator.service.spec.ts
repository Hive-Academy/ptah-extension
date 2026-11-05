import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LoggingService } from '@ptah-extension/core';
import { QueuedFollowUpStore, TabManagerService, TabWorkspacePartitionService } from '@ptah-extension/chat-state';
import type { TabState } from '@ptah-extension/chat-types';
import { SessionId, type SessionBudgetState } from '@ptah-extension/shared';
import { MessageDispatchService } from './chat-store/message-dispatch.service';
import { SessionAutoHandoffService } from './session-auto-handoff.service';
import { SessionAutoHandoffCoordinatorService } from './session-auto-handoff-coordinator.service';
import { SessionHandoffSkillService, type HandoffSkillProbe } from './session-handoff-skill.service';

const TAB = 'tab-1';
const SESSION = '11111111-1111-4111-8111-111111111111';
const OTHER_SESSION = SessionId.from('22222222-2222-4222-8222-222222222222');
const COMMAND = '/session-handoff This session has used 50.0M tokens.';
const BUDGET: SessionBudgetState = {
  sessionId: SESSION, stage: 'limit', unit: 'tokens', measure: 'tokens',
  used: 50_000_000, limit: 50_000_000, percent: 100, lowerBound: false,
  revision: 12, compactions: 0, autoHandoff: true, closeSourceAfterAutoHandoff: false,
};
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function makeTab(id: string, overrides: Partial<TabState> = {}): TabState {
  return {
    id, title: id, status: 'loaded', messages: [], streamingState: null,
    currentMessageId: null, claudeSessionId: SESSION, sessionBudget: { ...BUDGET },
    ...overrides,
  } as unknown as TabState;
}

describe('SessionAutoHandoffCoordinatorService', () => {
  let active: WritableSignal<TabState[]>;
  let background: TabState[];
  let revision: WritableSignal<number>;
  let permission: WritableSignal<boolean>;
  let store: QueuedFollowUpStore;
  let handoff: SessionAutoHandoffService;
  let send: jest.Mock;
  let probe: jest.Mock;
  let now: number;
  let probeGate: Promise<void> | null;
  let nextId: number;
  const tab = (id: string) => [...active(), ...background].find((t) => t.id === id) as TabState;
  const patch = (id: string, update: Partial<TabState>) => {
    active.update((tabs) => tabs.map((t) => t.id === id ? { ...t, ...update } : t));
    background = background.map((t) => t.id === id ? { ...t, ...update } : t);
    revision.update((n) => n + 1);
  };
  const run = async () => { TestBed.tick(); await settle(); await settle(); };
  const start = (tabs: TabState[] = [], parked: TabState[] = []) => {
    active.set(tabs); background = parked; revision.update((n) => n + 1);
  };
  const queued = () => store.forTab(TAB)[0];
  const holdProbe = () => {
    let release!: () => void;
    probeGate = new Promise<void>((resolve) => { release = resolve; });
    return release;
  };

  beforeEach(() => {
    active = signal<TabState[]>([]);
    background = [];
    revision = signal(0);
    permission = signal(false);
    now = 1_000_000;
    nextId = 0;
    probeGate = null;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    probe = jest.fn(async (): Promise<HandoffSkillProbe> => {
      if (probeGate) await probeGate;
      return 'available';
    });
    send = jest.fn(async (content: string, options: { tabId: string }) => {
      if (tab(options.tabId).status !== 'streaming') return { success: true };
      const clientMessageId = `queued-${++nextId}`;
      store.add({
        clientMessageId, tabId: options.tabId, sessionId: SESSION,
        content, isCommand: true, phase: 'held',
      });
      return { success: true, queued: { clientMessageId, tabId: options.tabId, sessionId: SESSION } };
    });
    TestBed.configureTestingModule({ providers: [
      SessionAutoHandoffCoordinatorService, SessionAutoHandoffService, QueuedFollowUpStore,
      { provide: TabManagerService, useValue: {
        tabs: () => active(),
        backgroundTabsRevision: () => revision(),
        findTabByIdAcrossWorkspaces: (id: string) => {
          const found = [...active(), ...background].find((t) => t.id === id);
          return found ? { tab: found, workspacePath: '/ws' } : null;
        },
      } },
      { provide: TabWorkspacePartitionService, useValue: {
        findBackgroundTabs: (predicate: (t: TabState) => boolean) => background.filter(predicate),
      } },
      { provide: MessageDispatchService, useValue: {
        sendOrQueueMessage: send, hasPendingPermissionForTab: () => permission(),
      } },
      { provide: SessionHandoffSkillService, useValue: { probe: () => probe() } },
      { provide: LoggingService, useValue: { info: jest.fn(), warn: jest.fn() } },
    ] });
    store = TestBed.inject(QueuedFollowUpStore);
    handoff = TestBed.inject(SessionAutoHandoffService);
    TestBed.inject(SessionAutoHandoffCoordinatorService);
  });
  afterEach(() => { TestBed.resetTestingModule(); jest.restoreAllMocks(); });

  it('fires once for a hidden tab at its limit', async () => {
    start([makeTab('shown', { claudeSessionId: OTHER_SESSION, sessionBudget: null }), makeTab(TAB)]);
    await run();
    expect(send).toHaveBeenCalledWith(COMMAND, { tabId: TAB });
    patch(TAB, { sessionBudget: { ...BUDGET, revision: 13 } });
    await run();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('fires for a background workspace partition', async () => {
    start([makeTab('shown', { claudeSessionId: OTHER_SESSION, sessionBudget: null })], [makeTab(TAB)]);
    await run();
    expect(send).toHaveBeenCalledWith(COMMAND, { tabId: TAB });
  });

  it('holds the slash hand-off behind a running turn until delivery', async () => {
    start([makeTab(TAB, {
      status: 'streaming',
      sessionBudget: { ...BUDGET, stage: 'handoff', percent: 82 },
      liveBudgetStage: 'limit',
    })]);
    await run();
    expect(queued()?.content).toBe(COMMAND);
    expect(queued()?.phase).toBe('held');
    expect(handoff.entry(SESSION)?.queued?.clientMessageId).toBe(queued()?.clientMessageId);
    store.settle(queued().clientMessageId, 'delivered');
    await run();
    expect(handoff.entry(SESSION)?.state).toBe('fired');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each(['withdrawn', 'failed'] as const)(
    'releases a queued claim on %s and retries after the gate',
    async (outcome) => {
      start([makeTab(TAB, { status: 'streaming' })]);
      await run();
      store.settle(queued().clientMessageId, outcome);
      expect(handoff.entry(SESSION)).toBeNull();
      now += 5_001;
      patch(TAB, { sessionBudget: { ...BUDGET, revision: 13 } });
      await run();
      expect(send).toHaveBeenCalledTimes(2);
    },
  );

  it('keeps a cancelled claim after withdrawal', async () => {
    start([makeTab(TAB, { status: 'streaming' })]);
    await run();
    handoff.cancel(SESSION);
    store.settle(queued().clientMessageId, 'withdrawn');
    now += 5_001;
    patch(TAB, { sessionBudget: { ...BUDGET, revision: 13 } });
    await run();
    expect(handoff.entry(SESSION)?.state).toBe('cancelled');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('waits for resume and pending permission, then fires', async () => {
    permission.set(true);
    start([makeTab(TAB, { status: 'resuming' })]);
    await run();
    expect(send).not.toHaveBeenCalled();
    patch(TAB, { status: 'loaded' });
    await run();
    expect(send).not.toHaveBeenCalled();
    permission.set(false);
    await run();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['setting off', { ...BUDGET, autoHandoff: false }],
    ['below limit', { ...BUDGET, stage: 'handoff' as const, percent: 82 }],
  ])('does not fire with %s', async (_label, budget) => {
    start([makeTab(TAB, { sessionBudget: budget })]);
    await run();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not retry a confirmed missing skill', async () => {
    probe.mockResolvedValue('missing');
    start([makeTab(TAB)]);
    await run();
    patch(TAB, { sessionBudget: { ...BUDGET, revision: 13 } });
    await run();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('retries a transient probe failure after its gate', async () => {
    probe.mockResolvedValueOnce('transient');
    start([makeTab(TAB)]);
    await run();
    now += 5_001;
    patch(TAB, { sessionBudget: { ...BUDGET, revision: 13 } });
    await run();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('releases a failed send claim and retries after its gate', async () => {
    send.mockResolvedValueOnce({ success: false, error: 'offline' });
    start([makeTab(TAB)]);
    await run();
    expect(handoff.entry(SESSION)).toBeNull();
    now += 5_001;
    patch(TAB, { sessionBudget: { ...BUDGET, revision: 13 } });
    await run();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not send into a replaced session after an in-flight probe', async () => {
    const release = holdProbe();
    start([makeTab(TAB)]);
    await run();
    patch(TAB, { claudeSessionId: OTHER_SESSION });
    release();
    await run();
    expect(send).not.toHaveBeenCalled();
    expect(handoff.entry(SESSION)).toBeNull();
  });

  it('still sends if another tab becomes visible during the probe', async () => {
    const release = holdProbe();
    const other = makeTab('shown', { claudeSessionId: OTHER_SESSION, sessionBudget: null });
    start([other, makeTab(TAB)]);
    await run();
    active.set([makeTab(TAB), other]);
    release();
    await run();
    expect(send).toHaveBeenCalledWith(COMMAND, { tabId: TAB });
  });

  it('does not add a second hand-off after manual wrap-up', async () => {
    handoff.markManualWrapUp(SESSION);
    start([makeTab(TAB)]);
    await run();
    expect(send).not.toHaveBeenCalled();
  });
});
