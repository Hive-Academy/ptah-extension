/**
 * SessionHistoryReplayer specs (TASK_2026_437 C15).
 *
 * - chunks of 250 with a MessageChannel yield after each chunk (2,000 → 8)
 * - one synchronous pass for a history of one chunk or less
 * - stops on a newer claim, a closed tab, or a tab rebound to another session
 * - `yieldToMacrotask` semantics: a failed post rejects like a throwing chunk;
 *   without `MessageChannel` the microtask yield keeps order and claim checks
 * - live-event fence: open from claim (the chat:resume round trip) to
 *   finalization or release; a live event arriving meanwhile is applied after
 *   finalization in arrival order; matched by tab or session (canvas
 *   fan-out); events before the claim and after release pass straight
 *   through; bound, supersession, a resume without replay, failure, closed
 *   and rebound tabs deliver exactly once
 *
 * The integration with `SessionLoaderService.switchSession` (failure branch,
 * claim taken per resume, the real streaming pipeline) is covered in
 * `session-loader.service.spec.ts`.
 */

import { TestBed } from '@angular/core/testing';
import {
  SessionManager,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { FlatStreamEventUnion, SessionId } from '@ptah-extension/shared';
import {
  SessionHistoryReplayer,
  type ReplayClaim,
} from './session-history-replayer.service';

const SESSION = 'session-replayer' as SessionId;
const OTHER_SESSION = 'session-other' as SessionId;
const TAB = 'tab-replayer';

describe('SessionHistoryReplayer', () => {
  const originalMessageChannel = globalThis.MessageChannel;
  let yields: number;
  let holdYields: boolean;
  let heldDeliveries: Array<() => void>;
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
  /** 1-based post that throws, or `null` for none. */
  let failPostAt: number | null;
  const postFailure = new Error('postMessage failed');

  beforeEach(() => {
    yields = 0;
    failPostAt = null;
    holdYields = false;
    heldDeliveries = [];
    log = [];
    tabs = [{ id: TAB, claudeSessionId: SESSION }];
    // jsdom has no MessageChannel. This one counts yields and can hold a
    // delivery so a spec can act between two chunks.
    class ControlledMessageChannel {
      readonly port1: { onmessage: (() => void) | null; close: () => void } = {
        onmessage: null,
        close: () => undefined,
      };
      readonly port2 = {
        postMessage: () => {
          yields++;
          if (failPostAt === yields) throw postFailure;
          const deliver = () => this.port1.onmessage?.();
          if (holdYields) {
            heldDeliveries.push(deliver);
          } else {
            void Promise.resolve().then(deliver);
          }
        },
        close: () => undefined,
      };
    }
    globalThis.MessageChannel =
      ControlledMessageChannel as unknown as typeof MessageChannel;

    streamingHandler = {
      processStreamEvent: jest.fn((event: { id: string }) => {
        log.push(`history:${event.id}`);
      }),
      finalizeSessionHistory: jest.fn(() => {
        log.push('finalize');
      }),
      clearPendingUpdates: jest.fn(),
    };
    setStatus = jest.fn();
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        SessionHistoryReplayer,
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
    consoleWarn.mockRestore();
    TestBed.resetTestingModule();
  });

  function historyEvents(count: number, prefix = 'e'): FlatStreamEventUnion[] {
    return Array.from(
      { length: count },
      (_, index) =>
        ({
          id: `${prefix}${index}`,
          eventType: 'text_delta',
          timestamp: index,
          sessionId: SESSION,
        }) as unknown as FlatStreamEventUnion,
    );
  }

  const liveEvent = { id: 'live', sessionId: SESSION } as FlatStreamEventUnion;

  async function until(condition: () => boolean): Promise<void> {
    for (let turn = 0; turn < 200 && !condition(); turn++) {
      await Promise.resolve();
    }
    expect(condition()).toBe(true);
  }

  function releaseHeld(): void {
    heldDeliveries.splice(0).forEach((deliver) => deliver());
  }

  describe('chunked replay', () => {
    it('replays 2,000 events in chunks of 250 with one yield after each chunk, then finalizes', async () => {
      const yieldsAtEvent: number[] = [];
      streamingHandler.processStreamEvent.mockImplementation(() => {
        yieldsAtEvent.push(yields);
      });
      const claim = replayer.claim(TAB, SESSION);

      await expect(
        replayer.replay(historyEvents(2000), claim, SESSION, undefined),
      ).resolves.toBe('replayed');

      expect(yields).toBe(8);
      expect(
        yieldsAtEvent.every(
          (count, index) => count === Math.floor(index / 250),
        ),
      ).toBe(true);
      expect(
        streamingHandler.processStreamEvent.mock.calls.map(
          ([event, tabId, sessionId, options]) => [
            (event as { id: string }).id,
            tabId,
            sessionId,
            options,
          ],
        ),
      ).toEqual(
        historyEvents(2000).map((event) => [
          event.id,
          TAB,
          SESSION,
          { isReplay: true, fanOut: false },
        ]),
      );
      expect(streamingHandler.finalizeSessionHistory).toHaveBeenCalledWith(
        TAB,
        undefined,
      );
    });

    it('replays a history of one chunk or less in one synchronous pass', async () => {
      const claim = replayer.claim(TAB, SESSION);

      const pending = replayer.replay(historyEvents(250), claim, SESSION, []);

      // Everything ran before the first await resolved.
      expect(streamingHandler.processStreamEvent).toHaveBeenCalledTimes(250);
      expect(streamingHandler.finalizeSessionHistory).toHaveBeenCalledWith(
        TAB,
        [],
      );
      await expect(pending).resolves.toBe('replayed');
      expect(yields).toBe(0);
    });

    it('stops when a newer claim takes the tab, without releasing the newer claim', async () => {
      holdYields = true;
      const older = replayer.claim(TAB, SESSION);
      const pending = replayer.replay(historyEvents(1000), older, SESSION, []);
      await until(() => yields === 1);

      const newer = replayer.claim(TAB, SESSION);
      expect(streamingHandler.clearPendingUpdates).toHaveBeenCalledWith(TAB);
      releaseHeld();

      await expect(pending).resolves.toBe('superseded');
      replayer.release(older);
      expect(replayer.isCurrent(newer)).toBe(true);
      expect(replayer.isCurrent(older)).toBe(false);
      expect(streamingHandler.processStreamEvent).toHaveBeenCalledTimes(250);
      expect(streamingHandler.finalizeSessionHistory).not.toHaveBeenCalled();
    });

    it('stops when the tab closes between chunks and drops its queued flush', async () => {
      holdYields = true;
      const claim = replayer.claim(TAB, SESSION);
      const pending = replayer.replay(historyEvents(1000), claim, SESSION, []);
      await until(() => yields === 1);

      tabs = [];
      releaseHeld();

      await expect(pending).resolves.toBe('superseded');
      expect(streamingHandler.processStreamEvent).toHaveBeenCalledTimes(250);
      expect(streamingHandler.clearPendingUpdates).toHaveBeenCalledWith(TAB);
      expect(streamingHandler.finalizeSessionHistory).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenLastCalledWith('loaded');
    });

    it('stops when the tab is rebound to another session between chunks, leaving the new owner queue alone', async () => {
      holdYields = true;
      const claim = replayer.claim(TAB, SESSION);
      const pending = replayer.replay(historyEvents(1000), claim, SESSION, []);
      await until(() => yields === 1);

      tabs = [{ id: TAB, claudeSessionId: OTHER_SESSION }];
      releaseHeld();

      await expect(pending).resolves.toBe('superseded');
      expect(replayer.isCurrent(claim)).toBe(true);
      expect(streamingHandler.processStreamEvent).toHaveBeenCalledTimes(250);
      expect(streamingHandler.clearPendingUpdates).not.toHaveBeenCalled();
      expect(streamingHandler.finalizeSessionHistory).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenLastCalledWith('loaded');
    });
  });

  // `yieldToMacrotask` (`@ptah-extension/core`) rejects when the post throws
  // and resolves on a microtask on a host without `MessageChannel`.
  describe('yield semantics', () => {
    it('rejects like a throwing chunk when a yield post fails, keeping the fence until release', async () => {
      failPostAt = 2;
      const claim = replayer.claim(TAB, SESSION);
      const pending = replayer.replay(historyEvents(1000), claim, SESSION, []);
      await until(() => yields === 1);
      const delivered: string[] = [];
      expect(
        replayer.deferLiveEvent(liveEvent, TAB, SESSION, () =>
          delivered.push('live'),
        ),
      ).toBe(true);

      await expect(pending).rejects.toBe(postFailure);
      expect(streamingHandler.processStreamEvent).toHaveBeenCalledTimes(500);
      expect(streamingHandler.finalizeSessionHistory).not.toHaveBeenCalled();
      expect(delivered).toEqual([]);
      expect(replayer.isCurrent(claim)).toBe(true);

      replayer.release(claim);
      expect(delivered).toEqual(['live']);
      expect(replayer.isCurrent(claim)).toBe(false);
    });

    it('replays in order with every claim check on a host without MessageChannel', async () => {
      Reflect.deleteProperty(globalThis, 'MessageChannel');
      expect(typeof MessageChannel).toBe('undefined');
      const claim = replayer.claim(TAB, SESSION);

      await expect(
        replayer.replay(historyEvents(600), claim, SESSION, undefined),
      ).resolves.toBe('replayed');

      expect(
        streamingHandler.processStreamEvent.mock.calls.map(
          ([event]) => (event as { id: string }).id,
        ),
      ).toEqual(historyEvents(600).map((event) => event.id));
      expect(log[log.length - 1]).toBe('finalize');
      // One tab lookup per chunk proves the checks still ran between chunks.
      const tabManager = TestBed.inject(TabManagerService);
      expect(tabManager.findTabByIdAcrossWorkspaces).toHaveBeenCalledTimes(3);
      expect(replayer.deferLiveEvent(liveEvent, TAB, SESSION, jest.fn())).toBe(
        false,
      );
    });

    it('stops on a microtask yield when a newer claim took the tab during the chunk', async () => {
      Reflect.deleteProperty(globalThis, 'MessageChannel');
      const older = replayer.claim(TAB, SESSION);
      let newer: ReplayClaim | null = null;
      streamingHandler.processStreamEvent.mockImplementation(
        (event: { id: string }) => {
          if (event.id === 'e100') newer = replayer.claim(TAB, SESSION);
        },
      );

      await expect(
        replayer.replay(historyEvents(600), older, SESSION, []),
      ).resolves.toBe('superseded');

      expect(streamingHandler.processStreamEvent).toHaveBeenCalledTimes(250);
      expect(replayer.isCurrent(newer)).toBe(true);
    });
  });

  describe('live-event fence', () => {
    const live = (name: string) => () => {
      log.push(`live:${name}`);
    };

    it('applies a live event that arrives between chunks after the last chunk and finalization, in arrival order', async () => {
      holdYields = true;
      const claim = replayer.claim(TAB, SESSION);
      const pending = replayer.replay(historyEvents(600), claim, SESSION, []);
      await until(() => yields === 1);

      expect(replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('1'))).toBe(
        true,
      );
      expect(replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('2'))).toBe(
        true,
      );
      expect(log).not.toContain('live:1');

      holdYields = false;
      releaseHeld();
      await expect(pending).resolves.toBe('replayed');

      expect(log.slice(-3)).toEqual(['finalize', 'live:1', 'live:2']);
      expect(log.indexOf('live:1')).toBe(log.indexOf('finalize') + 1);
      expect(log.filter((entry) => entry.startsWith('history:'))).toHaveLength(
        600,
      );
    });

    it('fences from claim — the chat:resume round trip — until finalization, and not before the claim or after release', async () => {
      expect(replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('0'))).toBe(
        false,
      );

      const claim = replayer.claim(TAB, SESSION);
      // The RPC is still pending: no replay has started yet.
      expect(replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('1'))).toBe(
        true,
      );
      await replayer.replay(historyEvents(600), claim, SESSION, []);
      replayer.release(claim);

      expect(replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('3'))).toBe(
        false,
      );
      expect(log.slice(-2)).toEqual(['finalize', 'live:1']);
      expect(log).not.toContain('live:0');
      expect(log).not.toContain('live:3');
    });

    it('delivers an event fenced during the round trip right after a synchronous replay finalizes', async () => {
      const claim = replayer.claim(TAB, SESSION);
      replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('x'));

      await expect(
        replayer.replay(historyEvents(250), claim, SESSION, []),
      ).resolves.toBe('replayed');

      expect(yields).toBe(0);
      expect(log.slice(-2)).toEqual(['finalize', 'live:x']);
      replayer.release(claim);
      expect(log.filter((entry) => entry === 'live:x')).toHaveLength(1);
    });

    it('delivers the round-trip buffer once on release when the resume ends without a replay', () => {
      // RPC failure, empty events, timeout, stale snapshot, or a throw between
      // claim and replay: the caller never calls `replay`, only `release`.
      const claim = replayer.claim(TAB, SESSION);
      replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('a'));
      replayer.deferLiveEvent(liveEvent, undefined, undefined, live('b'));
      expect(log).toEqual([]);

      replayer.release(claim);
      replayer.release(claim);

      expect(log).toEqual(['live:a', 'live:b']);
      expect(replayer.isCurrent(claim)).toBe(false);
      expect(replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('c'))).toBe(
        false,
      );
    });

    it('matches an event by its replaying tab or by its session, so a sibling tile event cannot fan out between chunks', async () => {
      holdYields = true;
      const claim = replayer.claim(TAB, SESSION);
      const pending = replayer.replay(historyEvents(600), claim, SESSION, []);
      await until(() => yields === 1);
      const otherSessionEvent = {
        id: 'other',
        sessionId: OTHER_SESSION,
      } as FlatStreamEventUnion;

      // No tab id: matched by the event's own session.
      expect(
        replayer.deferLiveEvent(liveEvent, undefined, undefined, live('s')),
      ).toBe(true);
      // A sibling tile of the same session: the tab path would fan it out
      // into the replaying tab, so it waits too.
      expect(
        replayer.deferLiveEvent(liveEvent, 'sibling-tab', SESSION, live('t')),
      ).toBe(true);
      // Addressed to the replaying tab, whatever session it names.
      expect(
        replayer.deferLiveEvent(otherSessionEvent, TAB, undefined, live('r')),
      ).toBe(true);
      // Another session on another tab has nothing to interleave with.
      expect(
        replayer.deferLiveEvent(
          otherSessionEvent,
          'sibling-tab',
          OTHER_SESSION,
          live('o'),
        ),
      ).toBe(false);
      expect(
        replayer.deferLiveEvent(
          otherSessionEvent,
          undefined,
          undefined,
          live('n'),
        ),
      ).toBe(false);

      holdYields = false;
      releaseHeld();
      await pending;
      expect(log.slice(-4)).toEqual(['finalize', 'live:s', 'live:t', 'live:r']);
    });

    it('holds the session buffer until the last of two tabs replaying that session finishes', async () => {
      const SIBLING = 'tab-sibling';
      tabs = [
        { id: TAB, claudeSessionId: SESSION },
        { id: SIBLING, claudeSessionId: SESSION },
      ];
      holdYields = true;
      const first = replayer.claim(TAB, SESSION);
      const firstReplay = replayer.replay(
        historyEvents(300, 'a'),
        first,
        SESSION,
        [],
      );
      await until(() => yields === 1);
      const second = replayer.claim(SIBLING, SESSION);
      const secondReplay = replayer.replay(
        historyEvents(600, 'b'),
        second,
        SESSION,
        [],
      );
      await until(() => yields === 2);
      replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('1'));
      replayer.deferLiveEvent(liveEvent, SIBLING, SESSION, live('2'));

      // The first tab finishes; the sibling is still held between chunks.
      holdYields = false;
      heldDeliveries.shift()?.();
      await expect(firstReplay).resolves.toBe('replayed');
      replayer.release(first);
      expect(log.filter((entry) => entry.startsWith('live:'))).toEqual([]);
      expect(replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('3'))).toBe(
        true,
      );

      releaseHeld();
      await expect(secondReplay).resolves.toBe('replayed');
      replayer.release(second);
      expect(log.slice(-4)).toEqual(['finalize', 'live:1', 'live:2', 'live:3']);
    });

    // Two tiles resume one session; tab A fails, tab B does not. The fence is
    // reference-counted per claim, so A's failure must not open it for B.
    describe.each(['a chunk throws', 'chat:resume fails before any replay'])(
      'two tabs resuming one session when tab A fails (%s)',
      (failure) => {
        const SIBLING = 'tab-sibling';
        const liveEntries = (): string[] =>
          log.filter((entry) => entry.startsWith('live:'));

        beforeEach(() => {
          tabs = [
            { id: TAB, claudeSessionId: SESSION },
            { id: SIBLING, claudeSessionId: SESSION },
          ];
          holdYields = true;
        });

        /** Starts tab A's resume; the returned function makes it fail and releases it. */
        async function startTabA(): Promise<() => Promise<void>> {
          const claimA = replayer.claim(TAB, SESSION);
          if (failure === 'chat:resume fails before any replay') {
            return async () => replayer.release(claimA);
          }
          streamingHandler.processStreamEvent.mockImplementation(
            (event: { id: string }) => {
              if (event.id === 'a300') throw new Error('chunk exploded');
              log.push(`history:${event.id}`);
            },
          );
          const replayA = replayer.replay(
            historyEvents(600, 'a'),
            claimA,
            SESSION,
            [],
          );
          await until(() => heldDeliveries.length === 1);
          return async () => {
            // A's yield is the first one held: its second chunk throws.
            heldDeliveries.shift()?.();
            await expect(replayA).rejects.toThrow('chunk exploded');
            replayer.release(claimA);
          };
        }

        it('keeps the fence held for tab B mid-replay, then delivers once in order after B finalizes', async () => {
          const failTabA = await startTabA();
          const claimB = replayer.claim(SIBLING, SESSION);
          const replayB = replayer.replay(
            historyEvents(600, 'b'),
            claimB,
            SESSION,
            [],
          );
          await until(() => yields === (failure === 'a chunk throws' ? 2 : 1));
          replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('before'));

          await failTabA();
          expect(liveEntries()).toEqual([]);
          expect(
            replayer.deferLiveEvent(liveEvent, SIBLING, SESSION, live('after')),
          ).toBe(true);

          holdYields = false;
          releaseHeld();
          await expect(replayB).resolves.toBe('replayed');
          expect(log.slice(-3)).toEqual([
            'finalize',
            'live:before',
            'live:after',
          ]);
          replayer.release(claimB);
          expect(liveEntries()).toEqual(['live:before', 'live:after']);
        });

        it('delivers once, when tab A fails, if tab B already finished', async () => {
          const failTabA = await startTabA();
          const claimB = replayer.claim(SIBLING, SESSION);
          replayer.deferLiveEvent(liveEvent, SIBLING, SESSION, live('1'));
          await expect(
            replayer.replay(historyEvents(250, 'b'), claimB, SESSION, []),
          ).resolves.toBe('replayed');
          replayer.release(claimB);
          expect(liveEntries()).toEqual([]);
          expect(
            replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('2')),
          ).toBe(true);

          await failTabA();
          expect(liveEntries()).toEqual(['live:1', 'live:2']);
          expect(
            replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('3')),
          ).toBe(false);
          expect(liveEntries()).toEqual(['live:1', 'live:2']);
        });
      },
    );

    it('keeps the buffer closed while a newer claim of the same session awaits its RPC, and delivers it once on that release', async () => {
      holdYields = true;
      const older = replayer.claim(TAB, SESSION);
      const pending = replayer.replay(historyEvents(600), older, SESSION, []);
      await until(() => yields === 1);
      replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('kept'));

      // A newer resume of the same session claims the tab; its RPC is still
      // in flight, so it has not replayed — but it holds the fence.
      const newer = replayer.claim(TAB, SESSION);
      releaseHeld();
      await expect(pending).resolves.toBe('superseded');
      replayer.release(older);
      replayer.release(older);
      expect(log).not.toContain('live:kept');
      expect(
        replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('more')),
      ).toBe(true);

      // The newer resume fails without replaying.
      replayer.release(newer);
      replayer.release(newer);
      expect(log.filter((entry) => entry.startsWith('live:'))).toEqual([
        'live:kept',
        'live:more',
      ]);
    });

    it('hands the buffer to the normal path once when a newer claim of another session takes the tab', async () => {
      holdYields = true;
      const older = replayer.claim(TAB, SESSION);
      const pending = replayer.replay(historyEvents(600), older, SESSION, []);
      await until(() => yields === 1);
      replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('kept'));

      const newer = replayer.claim(TAB, OTHER_SESSION);
      // Nothing of the old session holds its fence any more.
      expect(log.filter((entry) => entry.startsWith('live:'))).toEqual([
        'live:kept',
      ]);

      releaseHeld();
      await expect(pending).resolves.toBe('superseded');
      replayer.release(older);
      expect(log.filter((entry) => entry.startsWith('live:'))).toEqual([
        'live:kept',
      ]);
      expect(replayer.isCurrent(newer)).toBe(true);
      replayer.release(newer);
    });

    it('delivers the buffer to the normal path on release after a failed replay', async () => {
      holdYields = true;
      const claim = replayer.claim(TAB, SESSION);
      streamingHandler.processStreamEvent.mockImplementation(
        (event: { id: string }) => {
          if (event.id === 'e300') throw new Error('chunk exploded');
        },
      );
      const pending = replayer.replay(historyEvents(600), claim, SESSION, []);
      await until(() => yields === 1);
      replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('kept'));

      holdYields = false;
      releaseHeld();
      await expect(pending).rejects.toThrow('chunk exploded');
      expect(log).not.toContain('live:kept');

      replayer.release(claim);
      expect(log).toEqual(['live:kept']);
      replayer.release(claim);
      expect(log).toEqual(['live:kept']);
    });

    it.each([
      ['closed', () => []],
      ['rebound', () => [{ id: TAB, claudeSessionId: OTHER_SESSION }]],
    ] as const)(
      'hands the buffer to the normal path on release when the tab %s during the replay',
      async (_label, nextTabs) => {
        holdYields = true;
        const claim = replayer.claim(TAB, SESSION);
        const pending = replayer.replay(historyEvents(600), claim, SESSION, []);
        await until(() => yields === 1);
        replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('routed'));

        tabs = [...nextTabs()];
        releaseHeld();
        await expect(pending).resolves.toBe('superseded');
        expect(log.filter((entry) => entry.startsWith('live:'))).toEqual([]);

        replayer.release(claim);
        // The fence changes when a live event applies, never whether: the
        // normal path routes it exactly as it would have without the fence.
        expect(log.filter((entry) => entry.startsWith('live:'))).toEqual([
          'live:routed',
        ]);
      },
    );

    it('hands a superseded replay buffer to the newer replay fence when that is already open', async () => {
      holdYields = true;
      const older = replayer.claim(TAB, SESSION);
      const olderReplay = replayer.replay(
        historyEvents(600, 'old'),
        older,
        SESSION,
        [],
      );
      await until(() => yields === 1);
      replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('early'));

      const newer = replayer.claim(TAB, SESSION);
      const newerReplay = replayer.replay(
        historyEvents(600, 'new'),
        newer,
        SESSION,
        [],
      );
      await until(() => yields === 2);
      replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('late'));

      holdYields = false;
      releaseHeld();
      await expect(olderReplay).resolves.toBe('superseded');
      replayer.release(older);
      expect(log.filter((entry) => entry.startsWith('live:'))).toEqual([]);

      await expect(newerReplay).resolves.toBe('replayed');
      expect(log.slice(-3)).toEqual(['finalize', 'live:early', 'live:late']);
    });

    it('warns at the bound, delivers the buffer at once and lets later events through', async () => {
      holdYields = true;
      const claim = replayer.claim(TAB, SESSION);
      const pending = replayer.replay(historyEvents(600), claim, SESSION, []);
      await until(() => yields === 1);

      const limit = SessionHistoryReplayer.LIVE_EVENT_FENCE_LIMIT;
      for (let index = 0; index < limit; index++) {
        expect(
          replayer.deferLiveEvent(liveEvent, TAB, SESSION, live(`${index}`)),
        ).toBe(true);
      }
      expect(
        replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('over')),
      ).toBe(false);

      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('fence bound reached'),
        expect.objectContaining({ buffered: limit, limit }),
      );
      const delivered = log.filter((entry) => entry.startsWith('live:'));
      expect(delivered).toHaveLength(limit);
      expect(delivered[0]).toBe('live:0');
      expect(delivered[limit - 1]).toBe(`live:${limit - 1}`);
      expect(
        replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('after')),
      ).toBe(false);

      holdYields = false;
      releaseHeld();
      await expect(pending).resolves.toBe('replayed');
    });
  });
});
