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
  HistoryMessageBuilder,
  SessionManager,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import { LoggingService } from '@ptah-extension/core';
import type { FlatStreamEventUnion, SessionId } from '@ptah-extension/shared';
import {
  SessionHistoryReplayer,
  type ReplayClaim,
} from './session-history-replayer.service';
import { PersistedContentFilter } from './persisted-content-filter';

const SESSION = 'session-replayer' as SessionId;
const OTHER_SESSION = 'session-other' as SessionId;
const TAB = 'tab-replayer';

describe('SessionHistoryReplayer', () => {
  const originalMessageChannel = globalThis.MessageChannel;
  let yields: number;
  let holdYields: boolean;
  let heldDeliveries: Array<() => void>;
  let log: string[];
  let tabs: Array<{ id: string; claudeSessionId: string | null; messages?: unknown[] }>;
  let streamingHandler: {
    processStreamEvent: jest.Mock;
    finalizeSessionHistory: jest.Mock;
    clearPendingUpdates: jest.Mock;
  };
  let setStatus: jest.Mock;
  let setMessages: jest.Mock;
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
    setMessages = jest.fn((tabId: string, messages: unknown[]) => {
      const tab = tabs.find((candidate) => candidate.id === tabId);
      if (tab) tab.messages = messages;
    });
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        SessionHistoryReplayer,
        { provide: HistoryMessageBuilder, useValue: {} },
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: jest.fn((tabId: string) => {
              const tab = tabs.find((candidate) => candidate.id === tabId);
              return tab ? { tab, workspacePath: 'D:/repo' } : null;
            }),
            setMessages,
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
      replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('1'));
      replayer.deferLiveEvent(liveEvent, SIBLING, SESSION, live('2'));

      // Admission keeps the sibling waiting until the first tab finalizes.
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
          await until(() => yields === 1);
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

        it('delivers once after tab A fails and the surviving tab finishes', async () => {
          const failTabA = await startTabA();
          const claimB = replayer.claim(SIBLING, SESSION);
          replayer.deferLiveEvent(liveEvent, SIBLING, SESSION, live('1'));
          const replayB = replayer.replay(
            historyEvents(250, 'b'),
            claimB,
            SESSION,
            [],
          );

          await failTabA();
          expect(liveEntries()).toEqual(
            failure === 'a chunk throws' ? [] : ['live:1'],
          );
          holdYields = false;
          releaseHeld();
          await expect(replayB).resolves.toBe('replayed');
          replayer.release(claimB);
          expect(liveEntries()).toEqual(['live:1']);
          expect(
            replayer.deferLiveEvent(liveEvent, TAB, SESSION, live('2')),
          ).toBe(false);
          expect(liveEntries()).toEqual(['live:1']);
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
  describe('snapshot seed and persisted delivery', () => {
    const e = (id: string, eventType: string, extra: Record<string, unknown> = {}): FlatStreamEventUnion =>
      ({ id, eventType, sessionId: SESSION, messageId: 'M', source: 'stream', ...extra }) as unknown as FlatStreamEventUnion;
    const owned = (id: string, eventType: string, extra: Record<string, unknown> = {}): FlatStreamEventUnion =>
      e(id, eventType, { source: 'complete', messageId: 'history-id', ...extra });
    const route = (event: FlatStreamEventUnion, received: string[]) => jest.fn((excluded?: ReadonlySet<string>) => {
      if (!excluded?.has(TAB)) received.push(event.id);
    });

    it('runs a claim seed after finalization and before buffered events exactly once', async () => {
      const seedEvent = e('seed', 'text_delta', { delta: 'tail', blockIndex: 1 });
      const apply = jest.fn(() => log.push('seed'));
      const claim = replayer.claim(TAB, SESSION, { events: [seedEvent], apply });
      replayer.deferLiveEvent(e('later', 'text_delta'), TAB, SESSION, () => log.push('later'));

      await replayer.replay([], claim, SESSION, undefined);
      replayer.release(claim);

      expect(log).toEqual(['finalize', 'seed', 'later']);
      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply).toHaveBeenCalledWith([seedEvent]);
    });

    it('hands remaining buffered entries to a claim opened during delivery', () => {
      const first = replayer.claim(TAB, SESSION);
      let next: ReplayClaim | undefined;
      const d1 = jest.fn(() => { next = replayer.claim(TAB, SESSION); });
      const d2 = jest.fn();
      const event = e('live', 'text_delta');
      replayer.deferLiveEvent(event, TAB, SESSION, d1);
      replayer.deferLiveEvent(event, TAB, SESSION, d2);

      replayer.release(first);
      expect(d1).toHaveBeenCalledTimes(1);
      expect(d2).not.toHaveBeenCalled();
      expect(next).toBeDefined();
      replayer.release(next ?? null);
      expect(d2).toHaveBeenCalledTimes(1);
    });

    it('keeps a reservation across another claim and records overflow for joined holders', () => {
      const first = replayer.claim(TAB, SESSION);
      const reservation = replayer.reserveFence(SESSION);
      const delivered = jest.fn();
      for (let i = 0; i < SessionHistoryReplayer.LIVE_EVENT_FENCE_LIMIT; i++) {
        replayer.deferLiveEvent(e(`e${i}`, 'text_delta'), TAB, SESSION, delivered);
      }
      replayer.deferLiveEvent(e('overflow', 'text_delta'), TAB, SESSION, delivered);
      expect(replayer.overflowedDuring(first)).toBe(true);
      expect(replayer.overflowedDuring(reservation)).toBe(true);
      const joined = replayer.claim(TAB, SESSION);
      expect(replayer.overflowedDuring(joined)).toBe(true);
      replayer.releaseReservation(reservation);
      replayer.releaseReservation(reservation);
      expect(replayer.overflowedDuring(reservation)).toBe(false);
      replayer.release(first);
      replayer.release(joined);
    });

    it('filters a persisted block after close and retires at the terminal', async () => {
      const claim = replayer.claim(TAB, SESSION);
      const history = e('h', 'text_delta', { messageId: 'uuid', delta: 'Hello', source: 'complete', blockIndex: 0 });
      replayer.setPersistedFilterInputs(claim, {
        ownerByEvent: new Map([[history, 'M']]), syntheticResults: null, prefixMark: null,
      });
      await replayer.replay([history], claim, SESSION, undefined);
      const start = jest.fn();
      const delta = jest.fn();
      expect(replayer.deferLiveEvent(e('start', 'message_start', { role: 'assistant' }), TAB, SESSION, start)).toBe(true);
      expect(replayer.deferLiveEvent(e('delta', 'text_delta', { delta: 'Hello', blockIndex: 0 }), TAB, SESSION, delta)).toBe(true);
      expect(start).toHaveBeenCalledWith(new Set([TAB]));
      expect(delta).toHaveBeenCalledWith(new Set([TAB]));
      const terminal = jest.fn();
      replayer.deferLiveEvent(e('terminal', 'turn_state', { phase: 'idle' }), TAB, SESSION, terminal);
      expect(terminal).toHaveBeenCalledWith();
      expect(replayer.deferLiveEvent(e('after', 'text_delta', { delta: 'later', blockIndex: 1 }), TAB, SESSION, jest.fn())).toBe(false);
    });

    it('keeps retired rule T for changed and repeated history tool results', async () => {
      const tool = owned('tool', 'tool_start', { messageId: 'X', toolCallId: 'toolu_T' });
      const stored = owned('stored', 'tool_result', {
        messageId: 'X', toolCallId: 'toolu_T', output: 'old', isError: false,
      });
      tabs[0].messages = [{ id: 'X', role: 'assistant', timestamp: 1, streamingState: {
        id: 'toolu_T', type: 'tool', status: 'complete', content: null, children: [], isCollapsed: false,
        toolCallId: 'toolu_T', toolOutput: 'old', isError: false,
      } }];
      const claim = replayer.claim(TAB, SESSION);
      replayer.setPersistedFilterInputs(claim, {
        ownerByEvent: new Map([[tool, 'X']]), syntheticResults: new Set(), prefixMark: null,
      });
      await replayer.replay([tool, stored], claim, SESSION, undefined);
      const delivered = jest.fn();
      replayer.deferLiveEvent(e('terminal', 'turn_state', { phase: 'idle' }), TAB, SESSION, delivered);
      const result = e('new-result', 'tool_result', {
        messageId: 'X', toolCallId: 'toolu_T', output: 'new', isError: false,
      });
      expect(replayer.deferLiveEvent(result, TAB, SESSION, delivered)).toBe(true);
      expect(delivered).toHaveBeenLastCalledWith();
      expect(tabs[0].messages?.[0]).toMatchObject({ streamingState: { toolOutput: 'new' } });
      const patches = setMessages.mock.calls.length;
      expect(replayer.deferLiveEvent({ ...result, id: 'repeat' }, TAB, SESSION, delivered)).toBe(true);
      expect(delivered).toHaveBeenLastCalledWith();
      expect(setMessages).toHaveBeenCalledTimes(patches);
    });

    it('warns and leaves a seeded subagent live when its history owner is missing', async () => {
      const loggerWarn = jest.spyOn(TestBed.inject(LoggingService), 'warn');
      const start = e('agent', 'agent_start', { messageId: 'child', parentToolUseId: 'toolu_T' });
      const apply = jest.fn();
      const claim = replayer.claim(TAB, SESSION, { events: [start], apply });
      const tool = owned('tool', 'tool_start', { messageId: 'missing', toolCallId: 'toolu_T' });
      replayer.setPersistedFilterInputs(claim, {
        ownerByEvent: new Map([[tool, 'missing']]), prefixMark: null,
      });
      await replayer.replay([tool], claim, SESSION, undefined);
      expect(loggerWarn).toHaveBeenCalledWith('SessionHistoryReplayer',
        'seeded subagent history owner not found', { parentToolUseId: 'toolu_T' });
      expect(apply).toHaveBeenCalledWith([start]);
      expect(setMessages).not.toHaveBeenCalled();
    });

    it('preserves arrival across claims and filters only pre-snapshot seed copies', async () => {
      const first = replayer.claim(TAB, SESSION);
      const p1 = jest.fn();
      const p2 = jest.fn();
      replayer.deferLiveEvent(e('p1', 'text_delta', { messageId: 'X', blockIndex: 1, delta: 'abc' }), TAB, SESSION, p1);
      replayer.deferLiveEvent(e('p2', 'text_delta', { messageId: 'X', blockIndex: 0, delta: 'old' }), TAB, SESSION, p2);
      const mark = replayer.liveArrivalMark();
      const seed = e('seed', 'text_delta', { messageId: 'X', blockIndex: 1, delta: 'abcdef' });
      const apply = jest.fn();
      const second = replayer.claim(TAB, SESSION, {
        events: [seed], apply, liveSeedBlocks: { X: 0 },
      });
      replayer.setPersistedFilterInputs(second, { ownerByEvent: null, prefixMark: mark });
      const q1 = jest.fn();
      replayer.deferLiveEvent(e('q1', 'text_delta', { messageId: 'X', blockIndex: 1, delta: 'g' }), TAB, SESSION, q1);
      replayer.release(first);
      await replayer.replay([], second, SESSION, undefined);
      expect(apply).toHaveBeenCalledWith([seed]);
      expect(p1).toHaveBeenCalledWith(new Set([TAB]));
      expect(p2).toHaveBeenCalledWith();
      expect(q1).toHaveBeenCalledWith();
      replayer.release(second);
    });

    it('filters seed content against the replayed owned history block', async () => {
      const history = e('h', 'text_delta', { messageId: 'uuid', delta: 'Hello', source: 'complete', blockIndex: 0 });
      const seedStart = e('start', 'message_start', { messageId: 'M', role: 'assistant' });
      const seedText = e('text', 'text_delta', { messageId: 'M', delta: 'Hello', blockIndex: 0 });
      const apply = jest.fn();
      const claim = replayer.claim(TAB, SESSION, {
        events: [seedStart, seedText], apply, liveSeedBlocks: { M: 0 },
      });
      replayer.setPersistedFilterInputs(claim, { ownerByEvent: new Map([[history, 'M']]), prefixMark: null });
      await replayer.replay([history], claim, SESSION, undefined);
      expect(apply).toHaveBeenCalledWith([]);
      replayer.release(claim);
    });

    it('R-B2c keeps pre-snapshot arrival through a reservation and a succeeding claim', async () => {
      const first = replayer.claim(TAB, SESSION);
      const reservation = replayer.reserveFence(SESSION);
      const old = e('old', 'text_delta', { messageId: 'X', blockIndex: 1, delta: 'abc' });
      const oldDelivery = jest.fn();
      replayer.deferLiveEvent(old, TAB, SESSION, oldDelivery);
      const mark = replayer.liveArrivalMark();
      const seed = e('seed', 'text_delta', { messageId: 'X', blockIndex: 1, delta: 'abcdef' });
      const apply = jest.fn();
      const second = replayer.claim(TAB, SESSION, { events: [seed], apply, liveSeedBlocks: { X: 0 } });
      replayer.setPersistedFilterInputs(second, { ownerByEvent: null, prefixMark: mark });
      replayer.release(first);
      await replayer.replay([], second, SESSION, undefined);
      expect(oldDelivery).not.toHaveBeenCalled();
      replayer.releaseReservation(reservation);
      expect(apply).toHaveBeenCalledWith([seed]);
      expect(oldDelivery).toHaveBeenCalledWith(new Set([TAB]));
      replayer.release(second);
    });

    it('R-B3b releases an after-close prefix before a mismatched complete block', async () => {
      const history = owned('h', 'text_delta', { delta: 'n1', blockIndex: 0 });
      const claim = replayer.claim(TAB, SESSION);
      replayer.setPersistedFilterInputs(claim, { ownerByEvent: new Map([[history, 'N']]), prefixMark: null });
      await replayer.replay([history], claim, SESSION, undefined);
      const received: string[] = [];
      const start = e('start', 'message_start', { messageId: 'N', role: 'assistant' });
      const prefix = e('prefix', 'text_delta', { messageId: 'N', blockIndex: 0, delta: 'n1' });
      const head = e('head', 'message_start', { messageId: 'N', source: 'complete', role: 'assistant' });
      const changed = e('changed', 'text_delta', { messageId: 'N', source: 'complete', blockIndex: 0, delta: 'n1 edited' });
      for (const event of [start, prefix, head, changed]) {
        expect(replayer.deferLiveEvent(event, TAB, SESSION, route(event, received))).toBe(true);
      }
      expect(received).toEqual(['changed']);
      const releases = streamingHandler.processStreamEvent.mock.calls.slice(1).map(([event]) => event as FlatStreamEventUnion);
      expect(releases.map((event) => event.id)).toEqual(['start', expect.stringMatching(/^prefix-persisted-rebuild-/), 'head']);
      expect((releases[1] as unknown as { delta: string }).delta).toBe('n1');
      const later = e('later', 'text_delta', { messageId: 'N', blockIndex: 1, delta: 'new' });
      expect(replayer.deferLiveEvent(later, TAB, SESSION, route(later, received))).toBe(true);
      expect(received).toEqual(['changed', 'later']);
    });

    it.each(['tool', 'text'] as const)('R-B3d releases an unseen message on early %s mismatch', async (kind) => {
      const text = owned('h-text', 'text_delta', { delta: 'n1', blockIndex: 0 });
      const tool = owned('h-tool', 'tool_start', { toolCallId: 'toolu_9' });
      const claim = replayer.claim(TAB, SESSION);
      replayer.setPersistedFilterInputs(claim, { ownerByEvent: new Map([[text, 'N'], [tool, 'N']]), prefixMark: null });
      await replayer.replay([text, tool], claim, SESSION, undefined);
      const start = e('start', 'message_start', { messageId: 'N', role: 'assistant' });
      const mismatch = kind === 'tool'
        ? e('mismatch', 'tool_start', { messageId: 'N', toolCallId: 'toolu_7' })
        : e('mismatch', 'text_delta', { messageId: 'N', blockIndex: 0, delta: 'zz' });
      const received: string[] = [];
      replayer.deferLiveEvent(start, TAB, SESSION, route(start, received));
      expect(received).toEqual([]);
      replayer.deferLiveEvent(mismatch, TAB, SESSION, route(mismatch, received));
      expect(streamingHandler.processStreamEvent.mock.calls.slice(2).map(([event]) => event.id)).toEqual(['start']);
      expect(received).toEqual(['mismatch']);
      const later = e('later', 'text_delta', { messageId: 'N', blockIndex: 1, delta: 'later' });
      replayer.deferLiveEvent(later, TAB, SESSION, route(later, received));
      expect(received).toEqual(['mismatch', 'later']);
    });

    it('R-B6 drops a complete batch with three persisted records', async () => {
      const history = [
        owned('thinking', 'thinking_delta', { delta: 't', blockIndex: 0 }),
        owned('text', 'text_delta', { delta: 'a', blockIndex: 1 }),
        owned('tool', 'tool_start', { toolCallId: 'toolu_1' }),
      ];
      const claim = replayer.claim(TAB, SESSION, { events: [], apply: jest.fn(), liveSeedBlocks: { X: 0 } });
      replayer.setPersistedFilterInputs(claim, { ownerByEvent: new Map(history.map((event) => [event, 'X'])), prefixMark: null });
      await replayer.replay(history, claim, SESSION, undefined);
      const batch = [
        e('head', 'message_start', { messageId: 'X', source: 'complete', role: 'assistant' }),
        e('thinking', 'thinking_delta', { messageId: 'X', source: 'complete', delta: 't', blockIndex: 0 }),
        e('text', 'text_delta', { messageId: 'X', source: 'complete', delta: 'a', blockIndex: 1 }),
        e('tool', 'tool_start', { messageId: 'X', source: 'complete', toolCallId: 'toolu_1' }),
        e('tail', 'message_complete', { messageId: 'X', source: 'complete' }),
      ];
      const received: string[] = [];
      const deliveries = batch.map((event) => route(event, received));
      batch.forEach((event, index) => replayer.deferLiveEvent(event, TAB, SESSION, deliveries[index]));
      expect(received).toEqual([]);
      deliveries.forEach((deliver) => expect(deliver).toHaveBeenCalledWith(new Set([TAB])));
    });

    it('R-B6 keeps a new second block and releases the held batch head', async () => {
      const history = owned('thinking', 'thinking_delta', { delta: 't', blockIndex: 0 });
      const claim = replayer.claim(TAB, SESSION, { events: [], apply: jest.fn(), liveSeedBlocks: { X: 0 } });
      replayer.setPersistedFilterInputs(claim, { ownerByEvent: new Map([[history, 'X']]), prefixMark: null });
      await replayer.replay([history], claim, SESSION, undefined);
      const received: string[] = [];
      const head = e('head', 'message_start', { messageId: 'X', source: 'complete', role: 'assistant' });
      const old = e('old', 'thinking_delta', { messageId: 'X', source: 'complete', delta: 't', blockIndex: 0 });
      const next = e('next', 'text_delta', { messageId: 'X', source: 'complete', delta: 'b', blockIndex: 1 });
      const tail = e('tail', 'message_complete', { messageId: 'X', source: 'complete' });
      for (const event of [head, old, next, tail]) replayer.deferLiveEvent(event, TAB, SESSION, route(event, received));
      expect(streamingHandler.processStreamEvent.mock.calls.slice(1).map(([event]) => event.id)).toEqual(['head']);
      expect(received).toEqual(['next', 'tail']);
    });

    it('R-B6 releases a changed first complete block and keeps later events', async () => {
      const history = owned('h', 'text_delta', { delta: 'a', blockIndex: 0 });
      const claim = replayer.claim(TAB, SESSION, { events: [], apply: jest.fn(), liveSeedBlocks: { X: 0 } });
      replayer.setPersistedFilterInputs(claim, { ownerByEvent: new Map([[history, 'X']]), prefixMark: null });
      await replayer.replay([history], claim, SESSION, undefined);
      const received: string[] = [];
      const head = e('head', 'message_start', { messageId: 'X', source: 'complete', role: 'assistant' });
      const changed = e('changed', 'text_delta', { messageId: 'X', source: 'complete', blockIndex: 0, delta: 'a2' });
      const later = e('later', 'text_delta', { messageId: 'X', blockIndex: 1, delta: 'later' });
      for (const event of [head, changed, later]) replayer.deferLiveEvent(event, TAB, SESSION, route(event, received));
      expect(streamingHandler.processStreamEvent.mock.calls.slice(1).map(([event]) => event.id)).toEqual(['head']);
      expect(received).toEqual(['changed', 'later']);
    });

    it('R-B7 patches a synthetic Task result and retains the real live result', async () => {
      const tool = owned('history-tool', 'tool_start', { messageId: 'X', toolCallId: 'toolu_T', toolName: 'Task' });
      const synthetic = owned('synthetic', 'tool_result', { messageId: 'X', toolCallId: 'toolu_T', output: '[Agent completed]', isError: false });
      tabs[0].messages = [{ id: 'X', role: 'assistant', timestamp: 1, streamingState: {
        id: 'toolu_T', type: 'tool', status: 'complete', content: null, children: [], isCollapsed: false,
        toolCallId: 'toolu_T', toolOutput: '[Agent completed]', isError: false,
      } }];
      const claim = replayer.claim(TAB, SESSION);
      replayer.setPersistedFilterInputs(claim, {
        ownerByEvent: new Map([[tool, 'X']]), syntheticResults: new Set([synthetic]), prefixMark: null,
      });
      await replayer.replay([tool, synthetic], claim, SESSION, undefined);
      const received: string[] = [];
      const real = e('real', 'tool_result', { messageId: 'X', source: 'complete', toolCallId: 'toolu_T', output: 'real failure text', isError: true });
      const deliver = route(real, received);
      expect(replayer.deferLiveEvent(real, TAB, SESSION, deliver)).toBe(true);
      expect(deliver).toHaveBeenCalledWith();
      expect(received).toEqual(['real']);
      expect(setMessages).toHaveBeenCalledTimes(1);
      expect(tabs[0].messages?.[0]).toMatchObject({ streamingState: {
        toolOutput: 'real failure text', isError: true, status: 'complete',
      } });
      const duplicate = route(real, received);
      replayer.deferLiveEvent(real, TAB, SESSION, duplicate);
      expect(duplicate).toHaveBeenCalledWith(new Set([TAB]));
      expect(received).toEqual(['real']);
    });

    it.each([
      { name: 'identical persisted result', persisted: true, historyResult: true, output: 'old', excluded: true, patched: false },
      { name: 'changed persisted result', persisted: true, historyResult: true, output: 'new', excluded: false, patched: true },
      { name: 'absent synthetic index', persisted: false, historyResult: true, output: 'old', excluded: false, patched: false },
      { name: 'missing history result', persisted: false, historyResult: false, output: 'new', excluded: false, patched: true },
    ])('R-B7 handles $name through replayer', async ({ persisted, historyResult, output, excluded, patched }) => {
      const tool = owned('history-tool', 'tool_start', { messageId: 'X', toolCallId: 'toolu_T' });
      const stored = owned('history-result', 'tool_result', { messageId: 'X', toolCallId: 'toolu_T', output: 'old', isError: false });
      tabs[0].messages = [{ id: 'X', role: 'assistant', timestamp: 1, streamingState: {
        id: 'toolu_T', type: 'tool', status: 'complete', content: null, children: [], isCollapsed: false,
        toolCallId: 'toolu_T', toolOutput: 'old', isError: false,
      } }];
      const claim = replayer.claim(TAB, SESSION);
      replayer.setPersistedFilterInputs(claim, {
        ownerByEvent: new Map([[tool, 'X']]), syntheticResults: persisted ? new Set() : null, prefixMark: null,
      });
      await replayer.replay(historyResult ? [tool, stored] : [tool], claim, SESSION, undefined);
      const real = e('real', 'tool_result', { messageId: 'X', source: 'complete', toolCallId: 'toolu_T', output, isError: false });
      const delivery = jest.fn();
      expect(replayer.deferLiveEvent(real, TAB, SESSION, delivery)).toBe(true);
      if (excluded) expect(delivery).toHaveBeenCalledWith(new Set([TAB]));
      else expect(delivery).toHaveBeenCalledWith();
      expect(setMessages).toHaveBeenCalledTimes(patched ? 1 : 0);
      if (patched) expect(tabs[0].messages?.[0]).toMatchObject({ streamingState: { toolOutput: output } });
    });

    it('R-B1s filters a seeded in-flight block and keeps the next live block', async () => {
      const history = [
        owned('h0', 'text_delta', { delta: 'a', blockIndex: 0 }),
        owned('h1', 'text_delta', { delta: 'partial done', blockIndex: 1 }),
      ];
      const seed = [
        e('seed-start', 'message_start', { messageId: 'X', role: 'assistant' }),
        e('seed-prefix', 'text_delta', { messageId: 'X', blockIndex: 1, delta: 'par' }),
      ];
      const apply = jest.fn();
      const claim = replayer.claim(TAB, SESSION, { events: seed, apply, liveSeedBlocks: { X: 1 } });
      const mark = replayer.liveArrivalMark();
      const batch = [
        e('head', 'message_start', { messageId: 'X', source: 'complete', role: 'assistant' }),
        e('complete', 'text_delta', { messageId: 'X', source: 'complete', blockIndex: 1, delta: 'partial done' }),
        e('tail', 'message_complete', { messageId: 'X', source: 'complete' }),
      ];
      const received: string[] = [];
      const deliveries = batch.map((event) => route(event, received));
      batch.forEach((event, index) => replayer.deferLiveEvent(event, TAB, SESSION, deliveries[index]));
      const next = e('next', 'text_delta', { messageId: 'X', blockIndex: 2, delta: 'next' });
      const nextDelivery = route(next, received);
      replayer.deferLiveEvent(next, TAB, SESSION, nextDelivery);
      replayer.setPersistedFilterInputs(claim, { ownerByEvent: new Map(history.map((event) => [event, 'X'])), prefixMark: mark });
      await replayer.replay(history, claim, SESSION, undefined);
      expect(apply).toHaveBeenCalledWith([]);
      deliveries.forEach((deliver) => expect(deliver).toHaveBeenCalledWith(new Set([TAB])));
      expect(nextDelivery).toHaveBeenCalledWith();
      expect(received).toEqual(['next']);
      expect(streamingHandler.processStreamEvent.mock.calls.slice(2).map(([event]) => event.id)).toEqual(['seed-start']);
    });

    it('R-B1s applies an older-host seed without block counts unchanged', async () => {
      const history = owned('h', 'text_delta', { delta: 'partial done', blockIndex: 1 });
      const seed = [e('start', 'message_start', { messageId: 'X', role: 'assistant' }),
        e('prefix', 'text_delta', { messageId: 'X', blockIndex: 1, delta: 'par' })];
      const apply = jest.fn();
      const claim = replayer.claim(TAB, SESSION, { events: seed, apply });
      replayer.setPersistedFilterInputs(claim, { ownerByEvent: new Map([[history, 'X']]), prefixMark: null });
      await replayer.replay([history], claim, SESSION, undefined);
      expect(apply).toHaveBeenCalledWith(seed);
    });

    it('R-B1s releases a seeded prefix when the persisted block mismatches', async () => {
      const history = [owned('h0', 'text_delta', { delta: 'a', blockIndex: 0 }),
        owned('h1', 'text_delta', { delta: 'partial DONE', blockIndex: 1 })];
      const seed = [e('start', 'message_start', { messageId: 'X', role: 'assistant' }),
        e('prefix', 'text_delta', { messageId: 'X', blockIndex: 1, delta: 'par' })];
      const apply = jest.fn();
      const claim = replayer.claim(TAB, SESSION, { events: seed, apply, liveSeedBlocks: { X: 1 } });
      replayer.setPersistedFilterInputs(claim, { ownerByEvent: new Map(history.map((event) => [event, 'X'])), prefixMark: null });
      await replayer.replay(history, claim, SESSION, undefined);
      expect(apply).toHaveBeenCalledWith([]);
      const changed = e('changed', 'text_delta', { messageId: 'X', source: 'complete', blockIndex: 1, delta: 'partial done' });
      const deliver = jest.fn();
      replayer.deferLiveEvent(changed, TAB, SESSION, deliver);
      expect(deliver).toHaveBeenCalledWith();
      const releases = streamingHandler.processStreamEvent.mock.calls.slice(2).map(([event]) => event as FlatStreamEventUnion);
      expect(releases.map((event) => event.id)).toEqual(['start', expect.stringMatching(/^prefix-persisted-rebuild-/)]);
      expect((releases[1] as unknown as { delta: string }).delta).toBe('par');
    });

    it('R-B1s P2 removes a pre-snapshot complete copy while keeping the next block position', async () => {
      const history = [owned('h0', 'text_delta', { delta: 'a', blockIndex: 0 }),
        owned('h1', 'text_delta', { delta: 'partial done', blockIndex: 1 })];
      const claim = replayer.claim(TAB, SESSION, { events: [], apply: jest.fn(), liveSeedBlocks: { X: 1 } });
      const copy = e('copy', 'text_delta', { messageId: 'X', source: 'complete', blockIndex: 0, delta: 'a' });
      const delivery = jest.fn();
      replayer.deferLiveEvent(copy, TAB, SESSION, delivery);
      const mark = replayer.liveArrivalMark();
      replayer.setPersistedFilterInputs(claim, { ownerByEvent: new Map(history.map((event) => [event, 'X'])), prefixMark: mark });
      await replayer.replay(history, claim, SESSION, undefined);
      expect(delivery).toHaveBeenCalledWith(new Set([TAB]));
      const anchor = e('anchor', 'message_start', { messageId: 'X', role: 'assistant' });
      const prefix = e('prefix', 'text_delta', { messageId: 'X', blockIndex: 1, delta: 'par' });
      const anchorDelivery = jest.fn();
      const prefixDelivery = jest.fn();
      replayer.deferLiveEvent(anchor, TAB, SESSION, anchorDelivery);
      replayer.deferLiveEvent(prefix, TAB, SESSION, prefixDelivery);
      expect(anchorDelivery).toHaveBeenCalledWith(new Set([TAB]));
      expect(prefixDelivery).toHaveBeenCalledWith(new Set([TAB]));
    });

    it.each([
      { caseName: 'a: completed before snapshot', history: ['a', 'partial done'], k: 2,
        preText: 'partial', preComplete: true, postText: 'next', postAnchor: true,
        expectedLive: ['post-text'], expectedReleases: ['pre-start', 'post-start'] },
      { caseName: 'b: in flight then persisted', history: ['a', 'partial done'], k: 1,
        preText: 'par', preComplete: false, postText: 'tial', postAnchor: true,
        expectedLive: [], expectedReleases: [] },
      { caseName: 'c: in flight and not persisted', history: ['a'], k: 1,
        preText: 'par', preComplete: false, postText: 'tial', postAnchor: false,
        expectedLive: ['pre-text', 'post-text', 'complete-head', 'complete-text', 'complete-tail'], expectedReleases: ['pre-start'] },
      { caseName: 'd: aborted in-flight block', history: ['part one'], k: 1,
        preText: 'par', preComplete: false, postText: null, postAnchor: false,
        expectedLive: [], expectedReleases: ['pre-start', 'pre-text-persisted-rebuild-'] },
      { caseName: 'e: mismatch inside P3', history: ['a', 'partial done'], k: 1,
        preText: 'par', preComplete: false, postText: 'tX', postAnchor: false,
        expectedLive: ['post-text'], expectedReleases: ['pre-start', 'pre-text-persisted-rebuild-'] },
    ])('R-B1s Revision 3 $caseName through a truncated seed context', async (scenario) => {
      const history = scenario.history.map((delta, index) => owned(`h${index}`, 'text_delta', { delta, blockIndex: index }));
      const apply = jest.fn();
      const claim = replayer.claim(TAB, SESSION, { events: [], apply, liveSeedBlocks: { X: scenario.k } });
      const received: string[] = [];
      const deliveries = new Map<string, jest.Mock>();
      const send = (event: FlatStreamEventUnion) => {
        const deliver = route(event, received);
        deliveries.set(event.id, deliver);
        if (!replayer.deferLiveEvent(event, TAB, SESSION, deliver)) deliver();
      };
      send(e('pre-start', 'message_start', { messageId: 'X', role: 'assistant' }));
      send(e('pre-text', 'text_delta', { messageId: 'X', blockIndex: 1, delta: scenario.preText }));
      if (scenario.preComplete) {
        send(e('pre-head', 'message_start', { messageId: 'X', source: 'complete', role: 'assistant' }));
        send(e('pre-complete', 'text_delta', { messageId: 'X', source: 'complete', blockIndex: 1, delta: 'partial done' }));
        send(e('pre-tail', 'message_complete', { messageId: 'X', source: 'complete' }));
      }
      const mark = replayer.liveArrivalMark();
      replayer.setPersistedFilterInputs(claim, { ownerByEvent: new Map(history.map((event) => [event, 'X'])), prefixMark: mark });
      await replayer.replay(history, claim, SESSION, undefined);
      expect(apply).toHaveBeenCalledWith([]);
      if (scenario.postAnchor) send(e('post-start', 'message_start', { messageId: 'X', role: 'assistant' }));
      if (scenario.postText) {
        send(e('post-text', 'text_delta', { messageId: 'X', blockIndex: scenario.caseName.startsWith('a:') ? 2 : 1, delta: scenario.postText }));
      }
      if (scenario.caseName.startsWith('b:') || scenario.caseName.startsWith('c:')) {
        send(e('complete-head', 'message_start', { messageId: 'X', source: 'complete', role: 'assistant' }));
        send(e('complete-text', 'text_delta', { messageId: 'X', source: 'complete', blockIndex: 1, delta: 'partial done' }));
        send(e('complete-tail', 'message_complete', { messageId: 'X', source: 'complete' }));
      }
      const terminal = e('terminal', 'turn_state', { phase: 'idle' });
      send(terminal);
      expect(deliveries.get('terminal')).toHaveBeenCalledWith();
      const released = streamingHandler.processStreamEvent.mock.calls.slice(history.length)
        .map(([event]) => (event as FlatStreamEventUnion).id);
      expect(released).toHaveLength(scenario.expectedReleases.length);
      scenario.expectedReleases.forEach((id, index) => expect(released[index]).toContain(id));
      expect(received.filter((id) => id !== 'terminal')).toEqual(scenario.expectedLive);
      if (scenario.preComplete) {
        for (const id of ['pre-head', 'pre-complete', 'pre-tail']) {
          expect(deliveries.get(id)).toHaveBeenCalledWith(new Set([TAB]));
        }
      }
      expect(streamingHandler.processStreamEvent.mock.calls.slice(0, history.length).map(([event]) => event.id))
        .toEqual(history.map((event) => event.id));
    });
    it('closes the fence and delivers buffered events when filter registration throws', () => {
      const apply = jest.fn();
      const claim = replayer.claim(TAB, SESSION, {
        events: [null as unknown as FlatStreamEventUnion], apply,
      });
      replayer.setPersistedFilterInputs(claim, { ownerByEvent: null, prefixMark: 0 });
      const deliver = jest.fn();
      replayer.deferLiveEvent(e('live', 'text_delta'), TAB, SESSION, deliver);
      expect(() => replayer.release(claim)).not.toThrow();
      expect(apply).toHaveBeenCalledWith([null]);
      expect(deliver).toHaveBeenCalledTimes(1);
      expect(replayer.deferLiveEvent(e('after', 'text_delta'), TAB, SESSION, jest.fn())).toBe(false);
    });

    it('fails open when a filter throws while deciding a seed event', async () => {
      const history = owned('history', 'text_delta', { delta: 'old', blockIndex: 0 });
      const seed = e('seed', 'text_delta', { delta: 'new', blockIndex: 0 });
      const apply = jest.fn();
      const claim = replayer.claim(TAB, SESSION, { events: [seed], liveSeedBlocks: { M: 0 }, apply });
      replayer.setPersistedFilterInputs(claim, { ownerByEvent: new Map([[history, 'M']]), prefixMark: 0 });
      const decide = jest.spyOn(PersistedContentFilter.prototype, 'decide').mockImplementation(() => { throw new Error('filter'); });
      try {
        await replayer.replay([history], claim, SESSION, undefined);
        expect(apply).toHaveBeenCalledWith([seed]);
        expect(consoleWarn).toHaveBeenCalled();
      } finally {
        decide.mockRestore();
      }
    });

    it('fails open for buffered and after-close filter errors', async () => {
      const history = owned('history', 'text_delta', { delta: 'old', blockIndex: 0 });
      const claim = replayer.claim(TAB, SESSION);
      replayer.setPersistedFilterInputs(claim, { ownerByEvent: new Map([[history, 'M']]), prefixMark: null });
      const buffered = jest.fn();
      replayer.deferLiveEvent(e('buffered', 'text_delta'), TAB, SESSION, buffered);
      const decide = jest.spyOn(PersistedContentFilter.prototype, 'decide').mockImplementation(() => { throw new Error('filter'); });
      try {
        await replayer.replay([history], claim, SESSION, undefined);
        expect(buffered).toHaveBeenCalledWith();
        const second = replayer.claim(TAB, SESSION);
        replayer.setPersistedFilterInputs(second, { ownerByEvent: new Map([[history, 'M']]), prefixMark: null });
        await replayer.replay([history], second, SESSION, undefined);
        const after = jest.fn();
        expect(replayer.deferLiveEvent(e('after', 'text_delta'), TAB, SESSION, after)).toBe(true);
        expect(after).toHaveBeenCalledWith();
      } finally {
        decide.mockRestore();
      }
    });

    it('retires an idle empty-seed filter at fence close', async () => {
      const claim = replayer.claim(TAB, SESSION, { events: [], apply: jest.fn() });
      replayer.setPersistedFilterInputs(claim, { ownerByEvent: null, prefixMark: 0 });
      await replayer.replay([], claim, SESSION, undefined);
      const deliver = jest.fn();
      expect(replayer.deferLiveEvent(e('next', 'text_delta'), TAB, SESSION, deliver)).toBe(false);
    });

    it('accepts an unchanged matching history tool node as reconciled', async () => {
      const tool = owned('tool', 'tool_start', { toolCallId: 'toolu_T' });
      const synthetic = owned('synthetic', 'tool_result', { toolCallId: 'toolu_T', output: 'same', isError: false });
      tabs[0].messages = [{ id: 'M', role: 'assistant', timestamp: 1, streamingState: {
        id: 'toolu_T', type: 'tool', status: 'complete', content: null, children: [], isCollapsed: false,
        toolCallId: 'toolu_T', toolOutput: 'same', isError: false,
      } }];
      const claim = replayer.claim(TAB, SESSION);
      replayer.setPersistedFilterInputs(claim, {
        ownerByEvent: new Map([[tool, 'M']]), syntheticResults: new Set([synthetic]), prefixMark: null,
      });
      await replayer.replay([tool, synthetic], claim, SESSION, undefined);
      const real = e('real', 'tool_result', { toolCallId: 'toolu_T', output: 'same', isError: false });
      const first = jest.fn();
      const second = jest.fn();
      replayer.deferLiveEvent(real, TAB, SESSION, first);
      replayer.deferLiveEvent(real, TAB, SESSION, second);
      expect(first).toHaveBeenCalledWith();
      expect(second).toHaveBeenCalledWith(new Set([TAB]));
      expect(consoleWarn).not.toHaveBeenCalledWith('[SessionHistoryReplayer] history tool result could not be reconciled');
    });

    it('uses the held session key when an overflow drains a mismatched event', async () => {
      const history = owned('history', 'text_delta', { delta: 'old', blockIndex: 0 });
      const claim = replayer.claim(TAB, SESSION);
      replayer.setPersistedFilterInputs(claim, { ownerByEvent: new Map([[history, 'M']]), prefixMark: null });
      await replayer.replay([history], claim, SESSION, undefined);
      const next = replayer.reserveFence(SESSION);
      const start = e('start', 'message_start', { role: 'assistant', sessionId: OTHER_SESSION });
      const deliver = jest.fn();
      replayer.deferLiveEvent(start, TAB, SESSION, deliver);
      for (let i = 1; i < SessionHistoryReplayer.LIVE_EVENT_FENCE_LIMIT; i++) {
        replayer.deferLiveEvent(e(`f${i}`, 'agent_progress'), TAB, SESSION, jest.fn());
      }
      replayer.deferLiveEvent(e('overflow', 'agent_progress'), TAB, SESSION, jest.fn());
      expect(deliver).toHaveBeenCalledWith(new Set([TAB]));
      replayer.releaseReservation(next);
    });
  });
});
