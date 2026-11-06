/**
 * AutoHandoffSourceCloserService (TASK_2026_863): the automatic hand-off may
 * close its SOURCE tab once the new session is adopted — only for an
 * automatic claim, only with `sessionBudget.closeSourceAfterAutoHandoff` on,
 * only when the tab is idle and clean, and only ONCE.
 *
 * Real closer and real SessionAutoHandoffService (the claim store). The tab
 * manager, the partition, the permission dispatch and the logger are fakes;
 * `closeTabAcrossWorkspaces` is the facade the closer delegates to and is
 * asserted on, not executed (its own spec covers the cross-partition close).
 */

import { TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { LoggingService } from '@ptah-extension/core';
import {
  QueuedFollowUpStore,
  TabManagerService,
  TabWorkspacePartitionService,
} from '@ptah-extension/chat-state';
import type { TabState } from '@ptah-extension/chat-types';
import type { SessionHandoffOpenedPayload } from '@ptah-extension/shared';
import { MessageDispatchService } from './chat-store/message-dispatch.service';
import { AutoHandoffSourceCloserService } from './auto-handoff-source-closer.service';
import { SessionAutoHandoffService } from './session-auto-handoff.service';

const TAB = 'tab-1';
const NEW_TAB = 'tab-2';
const SESSION = '11111111-1111-4111-8111-111111111111';
const LOG_CONTEXT = '[SessionAutoHandoff]';
const CLOSE_BUDGET = {
  sessionId: SESSION,
  stage: 'limit',
  unit: 'tokens',
  measure: 'tokens',
  used: 50_000_000,
  limit: 50_000_000,
  percent: 100,
  lowerBound: false,
  revision: 12,
  compactions: 0,
  autoHandoff: true,
  closeSourceAfterAutoHandoff: true,
} as const;

/** Flush the effect's queueMicrotask continuation. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('AutoHandoffSourceCloserService', () => {
  let activeTabs: WritableSignal<TabState[]>;
  let backgroundTabs: TabState[];
  let backgroundRevision: WritableSignal<number>;
  let closeTabAcrossWorkspaces: jest.Mock;
  let hasPendingPermission: jest.Mock;
  let info: jest.Mock;
  let warn: jest.Mock;
  let autoHandoff: SessionAutoHandoffService;
  let followUps: QueuedFollowUpStore;
  let closer: AutoHandoffSourceCloserService;

  function makeTab(
    id: string,
    overrides: Record<string, unknown> = {},
  ): TabState {
    return {
      id,
      title: 'Session',
      // The source runs its own hand-off turn while it streams.
      status: 'streaming',
      messages: [],
      streamingState: null,
      currentMessageId: null,
      claudeSessionId: SESSION,
      isDirty: false,
      pendingBackgroundTasks: [],
      commandCenterOrigin: null,
      sessionBudget: { ...CLOSE_BUDGET },
      ...overrides,
    } as unknown as TabState;
  }

  const allTabs = () => [...activeTabs(), ...backgroundTabs];
  const tab = () => allTabs().find((t) => t.id === TAB) as TabState;
  const isBackground = (id: string) =>
    !activeTabs().some((t) => t.id === id) &&
    backgroundTabs.some((t) => t.id === id);

  function patch(id: string, update: Record<string, unknown>): void {
    if (activeTabs().some((t) => t.id === id)) {
      activeTabs.update((all) =>
        all.map((t) => (t.id === id ? { ...t, ...update } : t)),
      );
      return;
    }
    const index = backgroundTabs.findIndex((t) => t.id === id);
    if (index === -1) return;
    backgroundTabs[index] = { ...backgroundTabs[index], ...update };
    backgroundRevision.update((revision) => revision + 1);
  }

  function mount(
    states: 'active' | 'background',
    tabState: TabState | null = makeTab(TAB),
  ): void {
    if (tabState === null) return;
    if (states === 'active') activeTabs.set([tabState]);
    else {
      backgroundTabs = [tabState];
      backgroundRevision.update((revision) => revision + 1);
    }
  }

  function descriptor(
    overrides: Partial<SessionHandoffOpenedPayload> = {},
  ): SessionHandoffOpenedPayload {
    return {
      tabId: NEW_TAB,
      fromTabId: TAB,
      fromSessionId: SESSION,
      workspaceRoot: '/ws',
      cwd: '/ws',
      label: 'Continue',
      displayPrompt: 'read HANDOFF.md',
      startedAt: 7,
      ...overrides,
    };
  }

  /** Tick the effect, then let its queueMicrotask settle run. */
  async function run(): Promise<void> {
    TestBed.tick();
    await flush();
  }

  /** Arm the close the way adoption does: an automatic claim, then adoption. */
  function arm(overrides: Partial<SessionHandoffOpenedPayload> = {}): void {
    expect(autoHandoff.claim(SESSION)).toBe(true);
    closer.onHandoffAdopted(descriptor(overrides));
  }

  beforeEach(() => {
    activeTabs = signal<TabState[]>([]);
    backgroundTabs = [];
    backgroundRevision = signal(0);
    closeTabAcrossWorkspaces = jest.fn(() => true);
    hasPendingPermission = jest.fn(() => false);
    info = jest.fn();
    warn = jest.fn();

    TestBed.configureTestingModule({
      providers: [
        AutoHandoffSourceCloserService,
        QueuedFollowUpStore,
        {
          provide: TabManagerService,
          useValue: {
            tabs: () => activeTabs(),
            backgroundTabsRevision: () => backgroundRevision(),
            findTabByIdAcrossWorkspaces: (id: string) => {
              const found = allTabs().find((t) => t.id === id);
              return found
                ? { tab: found, workspacePath: isBackground(id) ? '/ws/other' : '/ws' }
                : null;
            },
            closeTabAcrossWorkspaces,
          },
        },
        {
          provide: TabWorkspacePartitionService,
          useValue: {
            findTabBySessionIdAcrossWorkspaces: (sessionId: string) => {
              const found = allTabs().find(
                (t) => t.claudeSessionId === sessionId,
              );
              return found
                ? { tab: found, workspacePath: isBackground(found.id) ? '/ws/other' : '/ws' }
                : null;
            },
          },
        },
        {
          provide: MessageDispatchService,
          useValue: { hasPendingPermissionForTab: hasPendingPermission },
        },
        { provide: LoggingService, useValue: { info, warn } },
      ],
    });
    autoHandoff = TestBed.inject(SessionAutoHandoffService);
    followUps = TestBed.inject(QueuedFollowUpStore);
    closer = TestBed.inject(AutoHandoffSourceCloserService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('arming', () => {
    it('ignores an adoption without a source session id', async () => {
      mount('active');
      closer.onHandoffAdopted(descriptor({ fromSessionId: null }));

      await run();
      expect(closeTabAcrossWorkspaces).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
    });

    it('never closes for a hand-off without an automatic claim', async () => {
      mount('active');
      closer.onHandoffAdopted(descriptor());

      await run();
      patch(TAB, { status: 'loaded' });
      await run();
      expect(closeTabAcrossWorkspaces).not.toHaveBeenCalled();
    });

    it('never closes for a cancelled automatic hand-off', async () => {
      mount('active');
      expect(autoHandoff.claim(SESSION)).toBe(true);
      autoHandoff.cancel(SESSION);

      closer.onHandoffAdopted(descriptor());
      await run();
      patch(TAB, { status: 'loaded' });
      await run();

      expect(closeTabAcrossWorkspaces).not.toHaveBeenCalled();
    });

    it('does not arm when the close-source setting is off', async () => {
      mount('active', makeTab(TAB, {
        sessionBudget: { ...CLOSE_BUDGET, closeSourceAfterAutoHandoff: false },
      }));
      arm();
      await run();
      patch(TAB, { status: 'loaded' });
      await run();

      expect(closeTabAcrossWorkspaces).not.toHaveBeenCalled();
    });

    it('does not arm when the budget does not name the source session', async () => {
      mount('active', makeTab(TAB, {
        sessionBudget: { ...CLOSE_BUDGET, sessionId: 'other-session' },
      }));
      arm();
      await run();
      patch(TAB, { status: 'loaded' });
      await run();

      expect(closeTabAcrossWorkspaces).not.toHaveBeenCalled();
    });

    it('does not arm a session the user wrapped up by hand', async () => {
      mount('active');
      expect(autoHandoff.claim(SESSION)).toBe(true);
      autoHandoff.markManualWrapUp(SESSION);

      closer.onHandoffAdopted(descriptor());
      await run();
      patch(TAB, { status: 'loaded' });
      await run();

      expect(closeTabAcrossWorkspaces).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
    });

    it('logs and does nothing when the source is not mounted', async () => {
      mount('active', null);
      arm();

      expect(info).toHaveBeenCalledWith(
        LOG_CONTEXT,
        expect.stringContaining('not mounted in this panel'),
        expect.objectContaining({ sessionId: SESSION }),
      );
      await run();
      expect(closeTabAcrossWorkspaces).not.toHaveBeenCalled();
    });

    it('locates the source by session id when fromTabId names another tab', async () => {
      mount('active');
      arm({ fromTabId: 'a-tab-that-was-closed' });

      patch(TAB, { status: 'loaded' });
      await run();

      expect(closeTabAcrossWorkspaces).toHaveBeenCalledWith(TAB, SESSION);
    });
  });

  describe('the close', () => {
    it('waits for the hand-off turn to end, then closes once', async () => {
      mount('active');
      arm();
      patch(TAB, { status: 'resuming' });
      await run();
      expect(closeTabAcrossWorkspaces).not.toHaveBeenCalled();

      patch(TAB, { status: 'loaded' });
      await run();
      expect(closeTabAcrossWorkspaces).toHaveBeenCalledTimes(1);
      expect(closeTabAcrossWorkspaces).toHaveBeenCalledWith(TAB, SESSION);

      // One evaluation only: further updates never close it again.
      patch(TAB, { sessionBudget: { ...CLOSE_BUDGET, revision: 13 } });
      await run();
      expect(closeTabAcrossWorkspaces).toHaveBeenCalledTimes(1);
    });

    it('closes right away when the source is already idle at adoption', async () => {
      mount('active', makeTab(TAB, { status: 'loaded' }));
      arm();
      await run();

      expect(closeTabAcrossWorkspaces).toHaveBeenCalledTimes(1);
      expect(info).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    it('closes a source parked in a background workspace partition', async () => {
      mount('background', makeTab(TAB, { status: 'loaded' }));
      arm();
      await run();

      expect(closeTabAcrossWorkspaces).toHaveBeenCalledWith(TAB, SESSION);
    });

    it('warns when the close is refused, and never retries it', async () => {
      mount('active', makeTab(TAB, { status: 'loaded' }));
      closeTabAcrossWorkspaces.mockReturnValue(false);
      arm();
      await run();

      expect(warn).toHaveBeenCalledWith(
        LOG_CONTEXT,
        expect.stringContaining('was refused'),
        expect.objectContaining({ tabId: TAB, sessionId: SESSION }),
      );

      closeTabAcrossWorkspaces.mockReturnValue(true);
      await run();
      expect(closeTabAcrossWorkspaces).toHaveBeenCalledTimes(1);
    });

    it('keeps a source that was rebound to another session', async () => {
      mount('active');
      arm();
      patch(TAB, { claudeSessionId: 'other-session', status: 'loaded' });
      await run();

      expect(closeTabAcrossWorkspaces).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(
        LOG_CONTEXT,
        expect.stringContaining('rebound'),
        expect.objectContaining({ tabId: TAB, sessionId: SESSION }),
      );
    });
  });

  describe('blockers keep the source open, once', () => {
    it.each<[string, () => void, string]>([
      ['unsent input', () => patch(TAB, { isDirty: true }), 'unsent input'],
      [
        'a queued message',
        () => followUps.add({
          clientMessageId: 'queued-1',
          tabId: TAB,
          sessionId: SESSION,
          content: '/next turn',
          isCommand: true,
          phase: 'queued',
        }),
        'queued message',
      ],
      [
        'background work in flight',
        () => patch(TAB, { pendingBackgroundTasks: [{}] }),
        'background work',
      ],
      [
        'an open permission prompt',
        () => hasPendingPermission.mockReturnValue(true),
        'permission prompt',
      ],
      [
        'a Command Center tab',
        () => patch(TAB, { commandCenterOrigin: 'command-center' }),
        'Command Center tab',
      ],
      [
        'a sleeping source',
        () => patch(TAB, { status: 'sleeping' }),
        "its state is 'sleeping'",
      ],
      [
        'the setting turned off meanwhile',
        () =>
          patch(TAB, {
            sessionBudget: { ...CLOSE_BUDGET, closeSourceAfterAutoHandoff: false },
          }),
        'setting was turned off',
      ],
      [
        'a budget that no longer names the session',
        () =>
          patch(TAB, {
            sessionBudget: { ...CLOSE_BUDGET, sessionId: 'other-session' },
          }),
        'no longer names the handed-off session',
      ],
      [
        'a released claim',
        () => autoHandoff.release(SESSION),
        'claim was released',
      ],
      [
        'a manual wrap-up meanwhile',
        () => autoHandoff.markManualWrapUp(SESSION),
        'wrapped up by hand',
      ],
    ])('keeps the source open for %s', async (_label, block, reason) => {
      mount('active', makeTab(TAB, { status: 'loaded' }));
      arm();
      block();
      await run();

      expect(closeTabAcrossWorkspaces).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(
        LOG_CONTEXT,
        expect.stringContaining(reason),
        expect.objectContaining({ tabId: TAB, sessionId: SESSION }),
      );

      // One evaluation only: clearing the blocker later never closes it.
      patch(TAB, {
        status: 'loaded',
        isDirty: false,
        pendingBackgroundTasks: [],
        commandCenterOrigin: null,
        sessionBudget: { ...CLOSE_BUDGET },
      });
      followUps.settle('queued-1', 'delivered');
      hasPendingPermission.mockReturnValue(false);
      autoHandoff.release(SESSION);
      autoHandoff.claim(SESSION);
      autoHandoff.clearManualWrapUp(SESSION);
      await run();
      expect(closeTabAcrossWorkspaces).not.toHaveBeenCalled();
    });

    it('keeps a cancelled source open and logs why once', async () => {
      mount('active', makeTab(TAB, { status: 'loaded' }));
      arm();
      autoHandoff.cancel(SESSION);
      await run();

      expect(closeTabAcrossWorkspaces).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(
        LOG_CONTEXT,
        expect.stringContaining('cancelled the automatic hand-off'),
        expect.objectContaining({ tabId: TAB, sessionId: SESSION }),
      );
    });
  });
});
