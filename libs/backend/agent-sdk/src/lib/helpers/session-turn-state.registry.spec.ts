/**
 * SessionTurnStateRegistry — reducer table (TASK_2026_360 §2.1).
 *
 * Every transition in the plan, the revision invariant, and the three rules
 * the frontend depends on: `applySnapshot` never touches 'generating', `rekey`
 * merges a colliding real-id entry so no revision is ever reused across the
 * alias boundary (review F2), and the revision is monotonic per SESSION ID
 * across `clear` — including the bound on the floor map that makes it so
 * (TASK_2026_371 D1).
 */
import 'reflect-metadata';
import type {
  SdkBackgroundTaskSummary,
  SdkSessionCronSummary,
} from '@ptah-extension/shared';
import { isTurnStateEvent } from '@ptah-extension/shared';
import {
  REVISION_FLOOR_MAP_LIMIT,
  SessionTurnStateRegistry,
  toTurnStateEvent,
} from './session-turn-state.registry';

const SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TAB = '11111111-2222-4333-8444-555555555555';

const task = (id: string): SdkBackgroundTaskSummary => ({
  id,
  type: 'subagent',
  status: 'running',
  description: `task ${id}`,
});
const cron = (id: string): SdkSessionCronSummary => ({
  id,
  schedule: '*/5 * * * *',
  recurring: true,
  prompt: 'wake',
});

describe('SessionTurnStateRegistry', () => {
  let registry: SessionTurnStateRegistry;

  beforeEach(() => {
    registry = new SessionTurnStateRegistry();
  });

  describe('markGenerating', () => {
    it('returns a generating state on the first call of a turn', () => {
      const state = registry.markGenerating(SESSION);
      expect(state).toMatchObject({
        phase: 'generating',
        revision: 1,
        backgroundTasks: [],
        sessionCrons: [],
        terminalReason: null,
      });
      expect(registry.get(SESSION)).toBe(state);
    });

    it('returns null on every later call until the turn settles', () => {
      registry.markGenerating(SESSION);
      expect(registry.markGenerating(SESSION)).toBeNull();
      expect(registry.markGenerating(SESSION)).toBeNull();
      expect(registry.get(SESSION)?.revision).toBe(1);
    });

    it('re-arms after settleTurn so the next turn emits generating again', () => {
      registry.markGenerating(SESSION);
      registry.settleTurn(SESSION);
      const next = registry.markGenerating(SESSION);
      expect(next?.phase).toBe('generating');
      expect(next?.revision).toBe(3);
    });

    it('does not discard a Stop snapshot that arrived before the consumer pulled message_start', () => {
      registry.recordStop(SESSION, {
        backgroundTasks: [task('t1')],
        sessionCrons: [],
        terminalReason: 'completed',
      });
      registry.markGenerating(SESSION);
      expect(registry.settleTurn(SESSION).phase).toBe('awaiting-background');
    });
  });

  describe('recordStop / recordFailure', () => {
    it('never change the phase or the revision', () => {
      const generating = registry.markGenerating(SESSION);
      registry.recordStop(SESSION, {
        backgroundTasks: [task('t1')],
        sessionCrons: [cron('c1')],
        terminalReason: 'completed',
      });
      registry.recordFailure(SESSION, {
        error: 'server_error',
        terminalReason: 'model_error',
      });
      expect(registry.get(SESSION)).toBe(generating);
      expect(registry.get(SESSION)?.phase).toBe('generating');
    });
  });

  describe('settleTurn', () => {
    it.each([
      ['idle', [], [], undefined],
      ['awaiting-background', [task('t1')], [], undefined],
      ['awaiting-background', [task('t1')], [cron('c1')], undefined],
      ['sleeping', [], [cron('c1')], undefined],
      ['failed', [task('t1')], [cron('c1')], 'rate_limit'],
    ] as const)(
      'derives %s from the snapshots',
      (phase, tasks, crons, failure) => {
        registry.markGenerating(SESSION);
        registry.recordStop(SESSION, {
          backgroundTasks: tasks,
          sessionCrons: crons,
          terminalReason: 'completed',
        });
        if (failure) {
          registry.recordFailure(SESSION, {
            error: failure,
            terminalReason: 'model_error',
          });
        }
        const state = registry.settleTurn(SESSION);
        expect(state.phase).toBe(phase);
        expect(state.backgroundTasks).toEqual(tasks);
        expect(state.sessionCrons).toEqual(crons);
        if (failure) {
          expect(state.error).toBe(failure);
          expect(state.terminalReason).toBe('model_error');
        } else {
          expect(state.error).toBeUndefined();
          expect(state.terminalReason).toBe('completed');
        }
      },
    );

    it('settles to idle with a null terminal reason when no Stop was recorded', () => {
      registry.markGenerating(SESSION);
      const state = registry.settleTurn(SESSION);
      expect(state).toMatchObject({ phase: 'idle', terminalReason: null });
    });

    it('consumes both snapshots — a second settle is a plain idle', () => {
      registry.recordStop(SESSION, {
        backgroundTasks: [task('t1')],
        sessionCrons: [],
        terminalReason: 'completed',
      });
      registry.recordFailure(SESSION, {
        error: 'unknown',
        terminalReason: null,
      });
      expect(registry.settleTurn(SESSION).phase).toBe('failed');
      expect(registry.settleTurn(SESSION)).toMatchObject({
        phase: 'idle',
        backgroundTasks: [],
        terminalReason: null,
      });
    });
  });

  describe('applySnapshot', () => {
    it('returns null for a session the registry has never seen', () => {
      expect(registry.applySnapshot(SESSION, [])).toBeNull();
      expect(registry.get(SESSION)).toBeUndefined();
    });

    it('never touches generating', () => {
      const generating = registry.markGenerating(SESSION);
      expect(registry.applySnapshot(SESSION, [task('t1')])).toBeNull();
      expect(registry.applySnapshot(SESSION, [])).toBeNull();
      expect(registry.get(SESSION)).toBe(generating);
    });

    it('replaces the background tasks while awaiting-background', () => {
      registry.markGenerating(SESSION);
      registry.recordStop(SESSION, {
        backgroundTasks: [task('t1'), task('t2')],
        sessionCrons: [],
        terminalReason: 'completed',
      });
      registry.settleTurn(SESSION);
      const next = registry.applySnapshot(SESSION, [task('t2')]);
      expect(next).toMatchObject({
        phase: 'awaiting-background',
        backgroundTasks: [task('t2')],
        terminalReason: 'completed',
      });
    });

    it('drops awaiting-background to idle when the last task settles and no crons remain', () => {
      registry.markGenerating(SESSION);
      registry.recordStop(SESSION, {
        backgroundTasks: [task('t1')],
        sessionCrons: [],
        terminalReason: 'completed',
      });
      registry.settleTurn(SESSION);
      expect(registry.applySnapshot(SESSION, [])?.phase).toBe('idle');
    });

    it('drops awaiting-background to sleeping when crons remain', () => {
      registry.markGenerating(SESSION);
      registry.recordStop(SESSION, {
        backgroundTasks: [task('t1')],
        sessionCrons: [cron('c1')],
        terminalReason: 'completed',
      });
      registry.settleTurn(SESSION);
      const next = registry.applySnapshot(SESSION, []);
      expect(next?.phase).toBe('sleeping');
      expect(next?.sessionCrons).toEqual([cron('c1')]);
    });

    it('raises idle to awaiting-background when tasks appear', () => {
      registry.markGenerating(SESSION);
      registry.settleTurn(SESSION);
      expect(registry.applySnapshot(SESSION, [task('t1')])?.phase).toBe(
        'awaiting-background',
      );
    });

    it('never resurrects failed', () => {
      registry.markGenerating(SESSION);
      registry.recordFailure(SESSION, {
        error: 'billing_error',
        terminalReason: null,
      });
      registry.settleTurn(SESSION);
      const next = registry.applySnapshot(SESSION, [task('t1')]);
      expect(next?.phase).toBe('failed');
      expect(next?.error).toBe('billing_error');
    });
  });

  describe('forceIdle', () => {
    it('drops every snapshot and re-arms generating', () => {
      registry.markGenerating(SESSION);
      registry.recordStop(SESSION, {
        backgroundTasks: [task('t1')],
        sessionCrons: [cron('c1')],
        terminalReason: 'completed',
      });
      const idle = registry.forceIdle(SESSION, 'aborted_streaming');
      expect(idle).toMatchObject({
        phase: 'idle',
        backgroundTasks: [],
        sessionCrons: [],
        terminalReason: 'aborted_streaming',
      });
      expect(registry.markGenerating(SESSION)?.phase).toBe('generating');
      expect(registry.settleTurn(SESSION).phase).toBe('idle');
    });

    it('defaults the terminal reason to null', () => {
      expect(registry.forceIdle(SESSION).terminalReason).toBeNull();
    });
  });

  describe('revision', () => {
    it('is monotonic per session and fresh on every returned state', () => {
      const revisions = [
        registry.markGenerating(SESSION)?.revision,
        registry.settleTurn(SESSION).revision,
        registry.applySnapshot(SESSION, [task('t1')])?.revision,
        registry.forceIdle(SESSION).revision,
        registry.markGenerating(SESSION)?.revision,
      ];
      expect(revisions).toEqual([1, 2, 3, 4, 5]);
    });

    it('is independent between sessions', () => {
      registry.markGenerating(SESSION);
      registry.settleTurn(SESSION);
      expect(registry.markGenerating('other')?.revision).toBe(1);
    });
  });

  describe('rekey', () => {
    it('moves the record from the placeholder to the real id', () => {
      const state = registry.markGenerating(TAB);
      registry.rekey(TAB, SESSION);
      expect(registry.get(TAB)).toBeUndefined();
      expect(registry.get(SESSION)).toBe(state);
      // The turn continues under the real id: no second 'generating'.
      expect(registry.markGenerating(SESSION)).toBeNull();
    });

    it('keeps the canonical state when both ids are generating at the same revision', () => {
      const real = registry.markGenerating(SESSION);
      registry.markGenerating(TAB);
      registry.rekey(TAB, SESSION);
      expect(registry.get(SESSION)).toEqual(real);
      expect(registry.get(TAB)).toBeUndefined();
      expect(registry.markGenerating(SESSION)).toBeNull();
    });

    describe('collision — a hook created the real-id entry first (review F2)', () => {
      it('carries the placeholder generating over an idle@0 canonical record and settles above every emitted revision', () => {
        // Stream: T generating@1 (the tab applied revision 1 under the alias).
        expect(registry.markGenerating(TAB)?.revision).toBe(1);
        // Stop hook resolved the real id first: S exists at idle@0 + snapshot.
        registry.recordStop(SESSION, {
          backgroundTasks: [task('bg-1')],
          sessionCrons: [],
          terminalReason: 'completed',
        });
        expect(registry.get(SESSION)).toMatchObject({
          phase: 'idle',
          revision: 0,
        });

        registry.rekey(TAB, SESSION);

        expect(registry.get(TAB)).toBeUndefined();
        expect(registry.get(SESSION)).toMatchObject({
          phase: 'generating',
          revision: 1,
        });

        const settled = registry.settleTurn(SESSION);
        expect(settled.phase).toBe('awaiting-background');
        expect(settled.backgroundTasks).toEqual([task('bg-1')]);
        expect(settled.terminalReason).toBe('completed');
        expect(settled.revision).toBeGreaterThan(1);
      });

      it('keeps the canonical generating state and takes the placeholder snapshot', () => {
        const real = registry.markGenerating(SESSION);
        registry.recordStop(TAB, {
          backgroundTasks: [],
          sessionCrons: [cron('c-1')],
          terminalReason: 'completed',
        });

        registry.rekey(TAB, SESSION);

        expect(registry.get(SESSION)).toEqual(real);
        expect(registry.get(SESSION)?.phase).toBe('generating');
        const settled = registry.settleTurn(SESSION);
        expect(settled.phase).toBe('sleeping');
        expect(settled.sessionCrons).toEqual([cron('c-1')]);
        expect(settled.revision).toBeGreaterThan(real?.revision ?? 0);
      });

      it('prefers the canonical snapshot and failure over the placeholder ones', () => {
        registry.recordStop(TAB, {
          backgroundTasks: [task('placeholder')],
          sessionCrons: [],
          terminalReason: null,
        });
        registry.recordFailure(TAB, {
          error: 'unknown',
          terminalReason: null,
        });
        registry.recordStop(SESSION, {
          backgroundTasks: [task('canonical')],
          sessionCrons: [],
          terminalReason: 'completed',
        });
        registry.recordFailure(SESSION, {
          error: 'rate_limit',
          terminalReason: 'max_turns',
        });

        registry.rekey(TAB, SESSION);

        const settled = registry.settleTurn(SESSION);
        expect(settled.phase).toBe('failed');
        expect(settled.error).toBe('rate_limit');
        expect(settled.terminalReason).toBe('max_turns');
        expect(settled.backgroundTasks).toEqual([task('canonical')]);
      });

      it('never emits a second generating after a merge that carried the dedupe flag', () => {
        registry.markGenerating(TAB);
        registry.recordStop(SESSION, {
          backgroundTasks: [],
          sessionCrons: [],
          terminalReason: null,
        });
        registry.rekey(TAB, SESSION);
        expect(registry.markGenerating(SESSION)).toBeNull();
        // The dedupe re-arms only at the turn boundary.
        registry.settleTurn(SESSION);
        expect(registry.markGenerating(SESSION)?.phase).toBe('generating');
      });
    });

    describe('revision monotonicity across rekey', () => {
      it('continues the placeholder counter when the real id has no record', () => {
        expect(registry.markGenerating(TAB)?.revision).toBe(1);
        registry.rekey(TAB, SESSION);
        expect(registry.get(SESSION)?.revision).toBe(1);
        expect(registry.settleTurn(SESSION).revision).toBe(2);
      });

      it('raises the baseline to the canonical counter when it is ahead', () => {
        registry.forceIdle(SESSION);
        registry.forceIdle(SESSION);
        expect(registry.forceIdle(SESSION).revision).toBe(3);
        expect(registry.markGenerating(TAB)?.revision).toBe(1);

        registry.rekey(TAB, SESSION);

        expect(registry.get(SESSION)).toMatchObject({
          phase: 'generating',
          revision: 3,
        });
        expect(registry.settleTurn(SESSION).revision).toBe(4);
      });

      it('does not resurrect a lower baseline under the real id after a clear', () => {
        // A previous query for SESSION emitted up to 4 and its loop exit
        // cleared the record. The resumed query streams under the tabId until
        // the SDK reports the id, so the merge must land above 4, not at 1.
        registry.markGenerating(SESSION);
        registry.settleTurn(SESSION);
        registry.markGenerating(SESSION);
        expect(registry.settleTurn(SESSION).revision).toBe(4);
        registry.clear(SESSION);

        expect(registry.markGenerating(TAB)?.revision).toBe(1);
        registry.rekey(TAB, SESSION);

        expect(registry.get(SESSION)).toMatchObject({
          phase: 'generating',
          revision: 4,
        });
        expect(registry.settleTurn(SESSION).revision).toBe(5);
      });

      it('does not resurrect a lower baseline under the placeholder id after a clear', () => {
        // The alias emitted 1 and 2 before its record was cleared; a hook then
        // created the real-id entry. The floor moves with the alias, so the
        // canonical record cannot re-issue 1.
        registry.markGenerating(TAB);
        expect(registry.settleTurn(TAB).revision).toBe(2);
        registry.clear(TAB);
        registry.recordStop(SESSION, {
          backgroundTasks: [],
          sessionCrons: [],
          terminalReason: null,
        });

        registry.rekey(TAB, SESSION);

        expect(registry.get(TAB)).toBeUndefined();
        expect(registry.markGenerating(SESSION)?.revision).toBe(3);
        // The dead alias keeps no floor of its own.
        expect(registry.markGenerating(TAB)?.revision).toBe(1);
      });

      it('raises the baseline to the placeholder counter when it is ahead', () => {
        registry.markGenerating(TAB);
        registry.settleTurn(TAB);
        expect(registry.markGenerating(TAB)?.revision).toBe(3);
        registry.recordStop(SESSION, {
          backgroundTasks: [],
          sessionCrons: [],
          terminalReason: null,
        });

        registry.rekey(TAB, SESSION);

        expect(registry.get(SESSION)?.revision).toBe(3);
        expect(registry.settleTurn(SESSION).revision).toBe(4);
      });
    });

    it('is a no-op for blank ids, equal ids, or an unknown placeholder', () => {
      registry.markGenerating(SESSION);
      registry.rekey('', SESSION);
      registry.rekey(SESSION, '');
      registry.rekey(SESSION, SESSION);
      registry.rekey('unknown', 'other');
      expect(registry.get(SESSION)?.phase).toBe('generating');
      expect(registry.get('other')).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('forgets the session', () => {
      registry.markGenerating(SESSION);
      registry.clear(SESSION);
      expect(registry.get(SESSION)).toBeUndefined();
    });

    // TASK_2026_371 D1. `ChatStreamBroadcaster` clears on every clean loop
    // exit, and `chat:continue` auto-resumes under the SAME session id — so a
    // counter that restarted here lost `revision > last` in the webview's
    // per-session guard, the terminal `idle` was dropped before any side
    // effect, and the tab kept its spinner and Stop button forever while the
    // backend was idle.
    it('does not restart the counter, so a resumed turn can still idle the tab', () => {
      const before = registry.markGenerating(SESSION)?.revision ?? 0;
      registry.clear(SESSION);

      expect(registry.markGenerating(SESSION)?.revision).toBeGreaterThan(
        before,
      );
    });

    it('keeps revisions strictly increasing across a settle, a clear and a second turn', () => {
      const revisions = [
        registry.markGenerating(SESSION)?.revision,
        registry.settleTurn(SESSION).revision,
      ];
      registry.clear(SESSION);
      revisions.push(
        registry.markGenerating(SESSION)?.revision,
        registry.settleTurn(SESSION).revision,
      );
      registry.clear(SESSION);
      revisions.push(registry.markGenerating(SESSION)?.revision);

      expect(revisions).toEqual([1, 2, 3, 4, 5]);
    });

    it('leaves the floor per session — clearing one does not move another', () => {
      registry.markGenerating(SESSION);
      registry.clear(SESSION);
      expect(registry.markGenerating('other')?.revision).toBe(1);
    });

    it('bounds the floor map, evicting the least recently written entry', () => {
      // One commit each for LIMIT + 1 distinct sessions, oldest first. The
      // last insertion evicts the first session's floor and nothing else.
      const total = REVISION_FLOOR_MAP_LIMIT + 1;
      for (let i = 0; i < total; i++) {
        registry.markGenerating(`session-${i}`);
        registry.clear(`session-${i}`);
      }

      // Assert the SURVIVOR first: every read below writes a floor of its own,
      // which evicts the next entry in turn.
      expect(registry.markGenerating(`session-${total - 1}`)?.revision).toBe(2);
      expect(registry.markGenerating('session-0')?.revision).toBe(1);
    });

    // TASK_2026_371 F3. The case above writes each session exactly once, so
    // insertion order and write recency are identical and it passes even under
    // plain first-inserted-first-out. The two cases below pin the rule the
    // name claims: the `delete`-then-`set` re-insertion in `noteFloor`.
    it('evicts the least recently WRITTEN entry, not the first inserted', () => {
      // Stop one short of the limit. The second commit below MUST land while
      // the map is NOT full: on a full map a first-inserted-first-out
      // `noteFloor` would evict the key it is about to re-insert and append it
      // again, which imitates write-recency ordering for that one key and
      // hides the difference this case exists to show.
      for (let i = 0; i < REVISION_FLOOR_MAP_LIMIT - 1; i++) {
        registry.markGenerating(`session-${i}`);
        registry.clear(`session-${i}`);
      }

      // A second turn on session-0: the most recently WRITTEN key, still the
      // FIRST inserted one. Its floor is now 2.
      registry.markGenerating('session-0');
      registry.clear('session-0');

      // Fill the last slot, then overflow by one.
      registry.markGenerating(`session-${REVISION_FLOOR_MAP_LIMIT - 1}`);
      registry.clear(`session-${REVISION_FLOOR_MAP_LIMIT - 1}`);
      registry.markGenerating(`session-${REVISION_FLOOR_MAP_LIMIT}`);
      registry.clear(`session-${REVISION_FLOOR_MAP_LIMIT}`);

      // Ordering trap: every `markGenerating` READ writes a floor of its own
      // and can itself evict, so assert the VICTIM first. Reading an evicted
      // key inserts it fresh and evicts the next entry in turn, but session-0
      // sits near the recent end and survives that.
      // session-1 is the least recently written key, so it is the victim: no
      // floor left, so the counter restarts at 1.
      expect(registry.markGenerating('session-1')?.revision).toBe(1);
      // session-0 survived with its floor of 2, so the next commit is 3.
      // First-inserted-first-out would have evicted session-0 instead and this
      // would read 1, with session-1 reading 2.
      expect(registry.markGenerating('session-0')?.revision).toBe(3);
    });

    it('a commit on an EXISTING key in a full map evicts nothing', () => {
      // Exactly LIMIT distinct keys, so the map is full.
      for (let i = 0; i < REVISION_FLOOR_MAP_LIMIT; i++) {
        registry.markGenerating(`session-${i}`);
        registry.clear(`session-${i}`);
      }

      // An update, not an insertion. `noteFloor` shrinks the map before it
      // tests the limit, so this path can never evict.
      registry.markGenerating('session-0');
      registry.clear('session-0');

      // Ordering trap: each read below writes a floor of its own. Every key is
      // still present, so every read is an update and evicts nothing, which is
      // what makes the whole sweep safe to run in one pass. session-0
      // committed twice (floor 2), every other session once (floor 1).
      expect(registry.markGenerating('session-0')?.revision).toBe(3);
      for (let i = 1; i < REVISION_FLOOR_MAP_LIMIT; i++) {
        expect(registry.markGenerating(`session-${i}`)?.revision).toBe(2);
        registry.clear(`session-${i}`);
      }
    });
  });

  describe('toTurnStateEvent', () => {
    it('wraps the state as a turn_state flat event with a stable messageId', () => {
      const state = registry.forceIdle(SESSION, 'completed');
      const event = toTurnStateEvent(SESSION, state);
      expect(isTurnStateEvent(event)).toBe(true);
      expect(event).toMatchObject({
        eventType: 'turn_state',
        sessionId: SESSION,
        source: 'complete',
        messageId: `turn-state-${SESSION}`,
        phase: 'idle',
        revision: state.revision,
        terminalReason: 'completed',
        timestamp: state.timestamp,
      });
      expect(event.id).toMatch(/^evt_/);
      expect('error' in event).toBe(false);
    });

    it('carries the error for a failed state', () => {
      registry.recordFailure(SESSION, {
        error: 'rate_limit',
        terminalReason: null,
      });
      const event = toTurnStateEvent(SESSION, registry.settleTurn(SESSION));
      expect(event.phase).toBe('failed');
      expect(event.error).toBe('rate_limit');
    });
  });
});
