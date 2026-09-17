/**
 * Replay admission specs (TASK_2026_453 C2).
 *
 * These pin the global FIFO slot without weakening the existing claim,
 * chunking or live-event-fence contract in the main replayer spec.
 */

import { TestBed } from '@angular/core/testing';
import { AppStateManager } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  HistoryMessageBuilder,
  SessionManager,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import type { FlatStreamEventUnion, SessionId } from '@ptah-extension/shared';
import { SessionHistoryReplayer } from './session-history-replayer.service';

const TAB_A = 'tab-a';
const TAB_B = 'tab-b';
const TAB_C = 'tab-c';
const SESSION_A = '11111111-1111-4111-8111-111111111111' as SessionId;
const SESSION_B = '22222222-2222-4222-8222-222222222222' as SessionId;
const SESSION_C = '33333333-3333-4333-8333-333333333333' as SessionId;

describe('SessionHistoryReplayer replay admission', () => {
  const originalMessageChannel = globalThis.MessageChannel;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  let macrotasks: Array<() => void>;
  let animationFrames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let failNextMacrotaskPost: boolean;
  let log: string[];
  let tabs: Array<{ id: string; claudeSessionId: string | null }>;
  let streamingHandler: {
    processStreamEvent: jest.Mock;
    finalizeSessionHistory: jest.Mock;
    clearPendingUpdates: jest.Mock;
  };
  let setStatus: jest.Mock;
  let replayer: SessionHistoryReplayer;
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    macrotasks = [];
    animationFrames = new Map();
    nextFrameId = 1;
    failNextMacrotaskPost = false;
    log = [];
    tabs = [
      { id: TAB_A, claudeSessionId: SESSION_A },
      { id: TAB_B, claudeSessionId: SESSION_B },
      { id: TAB_C, claudeSessionId: SESSION_C },
    ];

    class ControlledMessageChannel {
      readonly port1: { onmessage: (() => void) | null; close: () => void } = {
        onmessage: null,
        close: () => undefined,
      };
      readonly port2 = {
        postMessage: () => {
          if (failNextMacrotaskPost) {
            failNextMacrotaskPost = false;
            throw new Error('handoff post failed');
          }
          macrotasks.push(() => this.port1.onmessage?.());
        },
        close: () => undefined,
      };
    }
    globalThis.MessageChannel =
      ControlledMessageChannel as unknown as typeof MessageChannel;
    globalThis.requestAnimationFrame = jest.fn(
      (callback: FrameRequestCallback): number => {
        const id = nextFrameId++;
        animationFrames.set(id, callback);
        return id;
      },
    );
    globalThis.cancelAnimationFrame = jest.fn((id: number) => {
      animationFrames.delete(id);
    });

    streamingHandler = {
      processStreamEvent: jest.fn((event: { id: string }, tabId: string) => {
        log.push(`event:${tabId}:${event.id}`);
      }),
      finalizeSessionHistory: jest.fn((tabId: string) => {
        log.push(`finalize:${tabId}`);
      }),
      clearPendingUpdates: jest.fn(),
    };
    setStatus = jest.fn();
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        AppStateManager,
        SessionHistoryReplayer,
        { provide: HistoryMessageBuilder, useValue: {} },
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: jest.fn((tabId: string) => {
              const tab = tabs.find((candidate) => candidate.id === tabId);
              return tab ? { tab, workspacePath: 'D:/repo' } : null;
            }),
          },
        },
        { provide: StreamingHandlerService, useValue: streamingHandler },
        { provide: SessionManager, useValue: { setStatus } },
      ],
    });
    replayer = TestBed.inject(SessionHistoryReplayer);
  });

  afterEach(() => {
    globalThis.MessageChannel = originalMessageChannel;
    restoreAnimationFrame(
      'requestAnimationFrame',
      originalRequestAnimationFrame,
    );
    restoreAnimationFrame('cancelAnimationFrame', originalCancelAnimationFrame);
    consoleWarn.mockRestore();
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  function restoreAnimationFrame(
    key: 'requestAnimationFrame' | 'cancelAnimationFrame',
    value: typeof requestAnimationFrame | typeof cancelAnimationFrame,
  ): void {
    if (value === undefined) {
      Reflect.deleteProperty(globalThis, key);
    } else {
      Object.assign(globalThis, { [key]: value });
    }
  }

  function events(
    count: number,
    sessionId: SessionId,
    prefix: string,
  ): FlatStreamEventUnion[] {
    return Array.from(
      { length: count },
      (_, index) =>
        ({
          id: `${prefix}${index}`,
          eventType: 'text_delta',
          timestamp: index,
          sessionId,
        }) as unknown as FlatStreamEventUnion,
    );
  }

  async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  async function runNextMacrotask(): Promise<void> {
    const task = macrotasks.shift();
    expect(task).toBeDefined();
    task?.();
    await flushMicrotasks();
  }

  async function runNextFrame(): Promise<void> {
    const entry = animationFrames.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    expect(entry).toBeDefined();
    entry?.[1](0);
    await flushMicrotasks();
  }

  async function finishChunkedReplay(): Promise<void> {
    await runNextMacrotask();
    await runNextMacrotask();
  }

  async function finishHandoffWithFrame(): Promise<void> {
    await runNextMacrotask();
    await runNextFrame();
  }

  it('runs three chunked replays strictly FIFO and preserves waiting-session fence order', async () => {
    const claimA = replayer.claim(TAB_A, SESSION_A);
    const claimB = replayer.claim(TAB_B, SESSION_B);
    const claimC = replayer.claim(TAB_C, SESSION_C);
    const replayA = replayer.replay(
      events(251, SESSION_A, 'a'),
      claimA,
      SESSION_A,
      [],
    );
    const replayB = replayer.replay(
      events(251, SESSION_B, 'b'),
      claimB,
      SESSION_B,
      [],
    );
    const replayC = replayer.replay(
      events(251, SESSION_C, 'c'),
      claimC,
      SESSION_C,
      [],
    );
    expect(replayer.replayingTabIds()).toEqual(new Set([TAB_A, TAB_B, TAB_C]));
    expect(replayer.isReplaying(TAB_B)).toBe(true);
    const liveB = jest.fn(() => log.push('live:b'));
    expect(
      replayer.deferLiveEvent(
        { id: 'live-b', sessionId: SESSION_B } as FlatStreamEventUnion,
        TAB_B,
        SESSION_B,
        liveB,
      ),
    ).toBe(true);

    expect(log.filter((entry) => entry.startsWith('event:'))).toHaveLength(250);
    expect(log.some((entry) => entry.startsWith(`event:${TAB_B}`))).toBe(false);

    await finishChunkedReplay();
    expect(log).toContain(`finalize:${TAB_A}`);
    expect(log).not.toContain('live:b');

    await finishHandoffWithFrame();
    await expect(replayA).resolves.toBe('replayed');
    expect(log.some((entry) => entry.startsWith(`event:${TAB_B}`))).toBe(true);
    expect(log.some((entry) => entry.startsWith(`event:${TAB_C}`))).toBe(false);

    await finishChunkedReplay();
    expect(log.slice(-2)).toEqual([`finalize:${TAB_B}`, 'live:b']);
    expect(liveB).toHaveBeenCalledTimes(1);

    await finishHandoffWithFrame();
    await expect(replayB).resolves.toBe('replayed');
    await finishChunkedReplay();
    await expect(replayC).resolves.toBe('replayed');
    expect(replayer.replayingTabIds()).toEqual(new Set());

    expect(log.filter((entry) => entry.startsWith('finalize:'))).toEqual([
      `finalize:${TAB_A}`,
      `finalize:${TAB_B}`,
      `finalize:${TAB_C}`,
    ]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('drains the real canvas queue into real replay admission without orphan-timeout false negatives', async () => {
    const appState = TestBed.inject(AppStateManager);
    const settlementOrder: string[] = [];
    const pending = [SESSION_A, SESSION_B, SESSION_C].map((sessionId) =>
      appState.requestCanvasSession(sessionId).then((result) => {
        settlementOrder.push(sessionId);
        return result;
      }),
    );
    const requests = appState.takeCanvasSessionRequests();
    const tabsAndSessions = [
      [TAB_A, SESSION_A],
      [TAB_B, SESSION_B],
      [TAB_C, SESSION_C],
    ] as const;
    const replays = requests.map((request, index) => {
      const [tabId, sessionId] = tabsAndSessions[index];
      const replay = replayer.replay(
        events(251, sessionId, `queue-${index}-`),
        replayer.claim(tabId, sessionId),
        sessionId,
        [],
      );
      const bridge = replay.then(
        (outcome) => request.resolve?.(outcome === 'replayed'),
        (error: unknown) => {
          request.resolve?.(false);
          throw error;
        },
      );
      return { replay, bridge };
    });

    jest.advanceTimersByTime(5000);
    await flushMicrotasks();
    expect(settlementOrder).toEqual([]);

    await finishChunkedReplay();
    await expect(replays[0].replay).resolves.toBe('replayed');
    await finishHandoffWithFrame();
    await finishChunkedReplay();
    await expect(replays[1].replay).resolves.toBe('replayed');
    await finishHandoffWithFrame();
    await finishChunkedReplay();
    await expect(replays[2].replay).resolves.toBe('replayed');
    await Promise.all(replays.map(({ bridge }) => bridge));

    await expect(Promise.all(pending)).resolves.toEqual([true, true, true]);
    expect(settlementOrder).toEqual([SESSION_A, SESSION_B, SESSION_C]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps an uncontended one-chunk replay synchronous', async () => {
    const claim = replayer.claim(TAB_A, SESSION_A);
    let promiseSettled = false;

    const replay = replayer.replay(
      events(250, SESSION_A, 'a'),
      claim,
      SESSION_A,
      [],
    );
    void replay.then(() => {
      promiseSettled = true;
    });

    expect(streamingHandler.processStreamEvent).toHaveBeenCalledTimes(250);
    expect(streamingHandler.finalizeSessionHistory).toHaveBeenCalledWith(
      TAB_A,
      [],
    );
    expect(promiseSettled).toBe(false);
    expect(macrotasks).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
    await expect(replay).resolves.toBe('replayed');
  });

  it.each(['superseded', 'closed'] as const)(
    'releases a %s waiter immediately so the next replay can run',
    async (outcome) => {
      const claimA = replayer.claim(TAB_A, SESSION_A);
      const claimB = replayer.claim(TAB_B, SESSION_B);
      const claimC = replayer.claim(TAB_C, SESSION_C);
      const replayA = replayer.replay(
        events(251, SESSION_A, 'a'),
        claimA,
        SESSION_A,
        [],
      );
      const replayB = replayer.replay(
        events(1, SESSION_B, 'b'),
        claimB,
        SESSION_B,
        [],
      );
      const replayC = replayer.replay(
        events(1, SESSION_C, 'c'),
        claimC,
        SESSION_C,
        [],
      );

      if (outcome === 'superseded') {
        replayer.claim(TAB_B, SESSION_B);
      } else {
        tabs = tabs.filter((tab) => tab.id !== TAB_B);
      }

      await finishChunkedReplay();
      await finishHandoffWithFrame();
      await expect(replayA).resolves.toBe('replayed');
      if (outcome === 'closed') {
        expect(streamingHandler.clearPendingUpdates).toHaveBeenCalledWith(
          TAB_B,
        );
        expect(setStatus).toHaveBeenCalledWith('loaded');
      }

      await finishHandoffWithFrame();
      await expect(replayB).resolves.toBe('superseded');
      expect(replayer.isReplaying(TAB_B)).toBe(false);
      await expect(replayC).resolves.toBe('replayed');
      expect(log).toContain(`finalize:${TAB_C}`);
    },
  );

  it('releases the slot when the active replay throws', async () => {
    const claimA = replayer.claim(TAB_A, SESSION_A);
    const claimB = replayer.claim(TAB_B, SESSION_B);
    const replayA = replayer.replay(
      events(251, SESSION_A, 'a'),
      claimA,
      SESSION_A,
      [],
    );
    const replayB = replayer.replay(
      events(1, SESSION_B, 'b'),
      claimB,
      SESSION_B,
      [],
    );
    streamingHandler.processStreamEvent.mockImplementation(
      (event: { id: string }, tabId: string) => {
        if (event.id === 'a250') throw new Error('replay failed');
        log.push(`event:${tabId}:${event.id}`);
      },
    );

    await runNextMacrotask();
    expect(
      replayer.deferLiveEvent(
        { id: 'still-fenced', sessionId: SESSION_A } as FlatStreamEventUnion,
        TAB_A,
        SESSION_A,
        jest.fn(),
      ),
    ).toBe(true);
    await finishHandoffWithFrame();
    await expect(replayA).rejects.toThrow('replay failed');
    expect(replayer.isReplaying(TAB_A)).toBe(false);
    await expect(replayB).resolves.toBe('replayed');
  });

  it("does not let an older replay's finally clear a newer replay flag for the same tab", async () => {
    const olderClaim = replayer.claim(TAB_A, SESSION_A);
    const olderReplay = replayer.replay(
      events(251, SESSION_A, 'old'),
      olderClaim,
      SESSION_A,
      [],
    );
    const newerClaim = replayer.claim(TAB_A, SESSION_A);
    const newerReplay = replayer.replay(
      events(1, SESSION_A, 'new'),
      newerClaim,
      SESSION_A,
      [],
    );

    expect(replayer.isReplaying(TAB_A)).toBe(true);
    await runNextMacrotask();
    await expect(olderReplay).resolves.toBe('superseded');
    expect(replayer.isReplaying(TAB_A)).toBe(true);

    await finishHandoffWithFrame();
    await expect(newerReplay).resolves.toBe('replayed');
    expect(replayer.isReplaying(TAB_A)).toBe(false);
  });

  it('keeps the finished replay successful and reports a failed handoff on its waiter', async () => {
    const claimA = replayer.claim(TAB_A, SESSION_A);
    const claimB = replayer.claim(TAB_B, SESSION_B);
    const claimC = replayer.claim(TAB_C, SESSION_C);
    const replayA = replayer.replay(
      events(251, SESSION_A, 'a'),
      claimA,
      SESSION_A,
      [],
    );
    const replayB = replayer.replay(
      events(1, SESSION_B, 'b'),
      claimB,
      SESSION_B,
      [],
    );
    const replayC = replayer.replay(
      events(1, SESSION_C, 'c'),
      claimC,
      SESSION_C,
      [],
    );
    const replayBFailure = expect(replayB).rejects.toThrow(
      `Replay admission handoff failed for tab ${TAB_B}`,
    );

    await runNextMacrotask();
    failNextMacrotaskPost = true;
    await runNextMacrotask();
    await flushMicrotasks();

    await expect(replayA).resolves.toBe('replayed');
    await replayBFailure;
    expect(replayer.isReplaying(TAB_B)).toBe(false);
    expect(log).toContain(`finalize:${TAB_A}`);
    expect(log).not.toContain(`finalize:${TAB_B}`);
    expect(streamingHandler.clearPendingUpdates).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();

    await finishHandoffWithFrame();
    await expect(replayC).resolves.toBe('replayed');
    expect(log).toContain(`finalize:${TAB_C}`);
  });

  it('warns once after a replay waits longer than 10 seconds', async () => {
    const claimA = replayer.claim(TAB_A, SESSION_A);
    const claimB = replayer.claim(TAB_B, SESSION_B);
    const replayA = replayer.replay(
      events(251, SESSION_A, 'a'),
      claimA,
      SESSION_A,
      [],
    );
    const replayB = replayer.replay(
      events(1, SESSION_B, 'b'),
      claimB,
      SESSION_B,
      [],
    );

    jest.advanceTimersByTime(10_001);
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('admission wait exceeded 10 seconds'),
      { tabId: TAB_B, queueLength: 1 },
    );

    await finishChunkedReplay();
    await finishHandoffWithFrame();
    await expect(replayA).resolves.toBe('replayed');
    await expect(replayB).resolves.toBe('replayed');
    jest.advanceTimersByTime(20_000);
    expect(consoleWarn).toHaveBeenCalledTimes(1);
  });

  it('uses the 50 ms timer when requestAnimationFrame never fires', async () => {
    Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    const claimA = replayer.claim(TAB_A, SESSION_A);
    const claimB = replayer.claim(TAB_B, SESSION_B);
    const replayA = replayer.replay(
      events(251, SESSION_A, 'a'),
      claimA,
      SESSION_A,
      [],
    );
    const replayB = replayer.replay(
      events(1, SESSION_B, 'b'),
      claimB,
      SESSION_B,
      [],
    );

    await finishChunkedReplay();
    await runNextMacrotask();
    jest.advanceTimersByTime(49);
    await flushMicrotasks();
    expect(log).not.toContain(`finalize:${TAB_B}`);
    jest.advanceTimersByTime(1);
    await flushMicrotasks();

    await expect(replayA).resolves.toBe('replayed');
    await expect(replayB).resolves.toBe('replayed');
    expect(log).toContain(`finalize:${TAB_B}`);
    expect(jest.getTimerCount()).toBe(0);
  });
});
