import 'reflect-metadata';

import {
  InternalQueryConcurrencyGate,
  backgroundLimit,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_MAX_CONCURRENT_PER_LANE,
  GOVERNED_BACKGROUND_LANES,
  MEMORY_CURATOR_QUERY_LANE,
  SKILL_SYNTHESIS_QUERY_LANE,
  USER_ACTION_QUERY_LANE,
} from './internal-query-concurrency-gate';
import { InternalQueryQueueTimeoutError } from '../errors/internal-query-queue-timeout.error';
import type {
  BackgroundWorkSignal,
  BackgroundWorkState,
} from '@ptah-extension/vscode-core';

describe('InternalQueryConcurrencyGate', () => {
  /** One-lane acquire at the classic single-slot setting. */
  function acquire(
    gate: InternalQueryConcurrencyGate,
    opts: {
      limit?: number;
      perLaneLimit?: number;
      lane?: string;
      signal?: AbortSignal;
      queueTimeoutMs?: number;
    } = {},
  ): Promise<() => void> {
    return gate.acquire({
      limit: opts.limit ?? 1,
      perLaneLimit: opts.perLaneLimit ?? 1,
      lane: opts.lane ?? 'default',
      signal: opts.signal,
      queueTimeoutMs: opts.queueTimeoutMs,
    });
  }

  it('hands slots out in FIFO order', async () => {
    const gate = new InternalQueryConcurrencyGate();
    const order: number[] = [];

    const release = await acquire(gate);
    const second = acquire(gate).then((r) => {
      order.push(2);
      return r;
    });
    const third = acquire(gate).then((r) => {
      order.push(3);
      return r;
    });

    expect(gate.queued).toBe(2);
    release();
    (await second)();
    (await third)();

    expect(order).toEqual([2, 3]);
    expect(gate.queued).toBe(0);
    expect(gate.inFlight).toBe(0);
  });

  it('treats release as idempotent', async () => {
    const gate = new InternalQueryConcurrencyGate();
    const release = await acquire(gate);

    release();
    release();

    expect(gate.inFlight).toBe(0);
  });

  describe('per-lane ceilings', () => {
    it('admits two lanes at once but only one call per lane', async () => {
      const gate = new InternalQueryConcurrencyGate();

      await acquire(gate, { limit: 2, lane: 'a' });
      await acquire(gate, { limit: 2, lane: 'b' });
      const queued = acquire(gate, { limit: 2, lane: 'a' });

      expect(gate.inFlight).toBe(2);
      expect(gate.inFlightForLane('a')).toBe(1);
      expect(gate.inFlightForLane('b')).toBe(1);
      expect(gate.queued).toBe(1);

      void queued;
    });

    /**
     * The reason `drain` scans instead of waking the head. With a strict FIFO
     * pop, the lane-`a` waiter at the front — inadmissible, because lane `a` is
     * already at its ceiling — would block the lane-`b` waiter behind it, which
     * is the cross-pipeline coupling the lanes exist to remove.
     */
    it('a lane-blocked waiter does not block an admissible one behind it', async () => {
      const gate = new InternalQueryConcurrencyGate();
      const woken: string[] = [];

      const releaseA = await acquire(gate, { limit: 2, lane: 'a' });
      const releaseB = await acquire(gate, { limit: 2, lane: 'b' });

      const queuedA = acquire(gate, { limit: 2, lane: 'a' }).then((r) => {
        woken.push('a');
        return r;
      });
      const queuedB = acquire(gate, { limit: 2, lane: 'b' }).then((r) => {
        woken.push('b');
        return r;
      });

      // Free lane b's slot. Only the lane-b waiter is admissible.
      releaseB();
      (await queuedB)();

      expect(woken).toEqual(['b']);

      releaseA();
      (await queuedA)();
      expect(woken).toEqual(['b', 'a']);
      expect(gate.inFlight).toBe(0);
    });

    it('keeps FIFO order within one lane', async () => {
      const gate = new InternalQueryConcurrencyGate();
      const order: number[] = [];

      let release = await acquire(gate, { limit: 2, lane: 'a' });
      const first = acquire(gate, { limit: 2, lane: 'a' }).then((r) => {
        order.push(1);
        return r;
      });
      const second = acquire(gate, { limit: 2, lane: 'a' }).then((r) => {
        order.push(2);
        return r;
      });

      release();
      release = await first;
      release();
      (await second)();

      expect(order).toEqual([1, 2]);
    });

    it('forgets a lane once its last holder releases', async () => {
      const gate = new InternalQueryConcurrencyGate();
      const release = await acquire(gate, { lane: 'transient' });

      expect(gate.inFlightForLane('transient')).toBe(1);
      release();
      // The map is keyed by caller-supplied strings; an entry that outlived its
      // last holder would be an unbounded leak on a host with dynamic lanes.
      expect(gate.inFlightForLane('transient')).toBe(0);
    });

    it('falls back to the defaults for a nonsensical limit', async () => {
      const gate = new InternalQueryConcurrencyGate();

      await gate.acquire({ limit: 0, perLaneLimit: -1, lane: 'a' });
      await gate.acquire({ limit: 0, perLaneLimit: -1, lane: 'b' });
      await gate.acquire({ limit: 0, perLaneLimit: -1, lane: 'c' });
      const queued = gate.acquire({ limit: 0, perLaneLimit: -1, lane: 'd' });

      expect(gate.inFlight).toBe(DEFAULT_MAX_CONCURRENT);
      expect(gate.inFlightForLane('a')).toBe(DEFAULT_MAX_CONCURRENT_PER_LANE);
      expect(gate.queued).toBe(1);

      void queued;
    });
  });

  describe('background slot cap (FU-16b-c)', () => {
    it('admits both background families and a user action at the defaults', async () => {
      const gate = new InternalQueryConcurrencyGate();
      const releaseCurator = await acquire(gate, {
        limit: 3,
        lane: MEMORY_CURATOR_QUERY_LANE,
      });
      const releaseSkills = await acquire(gate, {
        limit: 3,
        lane: SKILL_SYNTHESIS_QUERY_LANE,
      });
      const releaseUser = await acquire(gate, {
        limit: 3,
        lane: USER_ACTION_QUERY_LANE,
      });

      expect(gate.inFlight).toBe(3);
      expect(gate.inFlightInBackground).toBe(2);
      expect(gate.queued).toBe(0);
      releaseCurator();
      releaseSkills();
      releaseUser();
    });

    it('skips a capped background waiter to admit a user action behind it', async () => {
      const gate = new InternalQueryConcurrencyGate();
      const releaseFirst = await gate.acquire({
        limit: 3,
        perLaneLimit: 2,
        lane: MEMORY_CURATOR_QUERY_LANE,
      });
      const releaseSecond = await gate.acquire({
        limit: 3,
        perLaneLimit: 2,
        lane: MEMORY_CURATOR_QUERY_LANE,
      });
      const capped = gate.acquire({
        limit: 3,
        perLaneLimit: 2,
        lane: SKILL_SYNTHESIS_QUERY_LANE,
      });
      const releaseUser = await gate.acquire({
        limit: 3,
        perLaneLimit: 2,
        lane: USER_ACTION_QUERY_LANE,
      });

      expect(gate.inFlight).toBe(3);
      expect(gate.queued).toBe(1);
      releaseFirst();
      const releaseCapped = await capped;
      releaseSecond();
      releaseUser();
      releaseCapped();
    });

    it('keeps background capped when foreground frees and admits it when background frees', async () => {
      const gate = new InternalQueryConcurrencyGate();
      const releaseCurator = await gate.acquire({
        limit: 3,
        perLaneLimit: 2,
        lane: MEMORY_CURATOR_QUERY_LANE,
      });
      const releaseSkills = await gate.acquire({
        limit: 3,
        perLaneLimit: 2,
        lane: SKILL_SYNTHESIS_QUERY_LANE,
      });
      const releaseDefault = await gate.acquire({
        limit: 3,
        perLaneLimit: 2,
        lane: 'default',
      });
      let admitted = false;
      const capped = gate
        .acquire({
          limit: 3,
          perLaneLimit: 2,
          lane: MEMORY_CURATOR_QUERY_LANE,
        })
        .then((release) => {
          admitted = true;
          return release;
        });

      releaseDefault();
      await Promise.resolve();
      expect(admitted).toBe(false);
      expect(gate.queued).toBe(1);
      releaseCurator();
      const releaseCapped = await capped;
      expect(admitted).toBe(true);
      releaseSkills();
      releaseCapped();
    });

    it('allows background to use the only slot when the limit is one', async () => {
      const gate = new InternalQueryConcurrencyGate();
      const releaseBackground = await acquire(gate, {
        limit: 1,
        lane: MEMORY_CURATOR_QUERY_LANE,
      });
      const foreground = acquire(gate, { limit: 1, lane: 'default' });

      expect(gate.inFlightInBackground).toBe(1);
      expect(gate.queued).toBe(1);
      releaseBackground();
      (await foreground)();
    });

    it.each([
      [1, 1],
      [2, 1],
      [3, 2],
      [5, 4],
    ])('derives backgroundLimit(%i) as %i', (limit, expected) => {
      expect(backgroundLimit(limit)).toBe(expected);
    });

    it('does not count a governor-held background waiter as in flight', async () => {
      const governor: BackgroundWorkSignal = {
        isClear: () => false,
        onChange: () => () => undefined,
      };
      const gate = new InternalQueryConcurrencyGate({ governor });
      const abortController = new AbortController();
      const held = gate.acquire({
        limit: 3,
        perLaneLimit: 1,
        lane: MEMORY_CURATOR_QUERY_LANE,
        signal: abortController.signal,
      });

      expect(gate.queued).toBe(1);
      expect(gate.inFlightInBackground).toBe(0);
      abortController.abort();
      await expect(held).rejects.toMatchObject({ name: 'AbortError' });
    });
  });

  it('rejects a queued waiter with InternalQueryQueueTimeoutError after the ceiling', async () => {
    const gate = new InternalQueryConcurrencyGate();
    const release = await acquire(gate);
    const queued = acquire(gate, { queueTimeoutMs: 20 });

    await expect(queued).rejects.toThrow(InternalQueryQueueTimeoutError);
    await expect(queued).rejects.toMatchObject({ queueTimeoutMs: 20 });

    // The departed waiter is gone from the queue, and the slot is still held
    // by the first caller until it releases.
    expect(gate.queued).toBe(0);
    expect(gate.inFlight).toBe(1);

    release();
    expect(gate.inFlight).toBe(0);
  });
});

/**
 * TASK_2026_437 C14, INV-7 — gate admission against a fake governor signal.
 * Jest fake timers drive every ceiling, so no case depends on real time.
 */
describe('InternalQueryConcurrencyGate — background-work governor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function createSignal(initiallyClear: boolean) {
    let state: BackgroundWorkState = initiallyClear
      ? 'clear'
      : 'foreground-busy';
    const listeners = new Set<(state: BackgroundWorkState) => void>();
    const signal: BackgroundWorkSignal = {
      isClear: () => state === 'clear',
      onChange: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    const emit = (next: BackgroundWorkState): void => {
      state = next;
      for (const listener of [...listeners]) listener(next);
    };
    return {
      signal,
      listeners,
      set(clear: boolean) {
        emit(clear ? 'clear' : 'foreground-busy');
      },
      dispose() {
        emit('disposed');
      },
    };
  }

  /** Let already-queued promise callbacks run (fake timers own setImmediate). */
  const flush = (): Promise<void> => jest.advanceTimersByTimeAsync(0);

  function acquire(
    gate: InternalQueryConcurrencyGate,
    lane: string,
    opts: {
      signal?: AbortSignal;
      queueTimeoutMs?: number;
      limit?: number;
    } = {},
  ): Promise<() => void> {
    return gate.acquire({
      limit: opts.limit ?? 2,
      perLaneLimit: 1,
      lane,
      signal: opts.signal,
      queueTimeoutMs: opts.queueTimeoutMs,
    });
  }

  it('holds a background lane with free slots while not clear, and never holds default', async () => {
    const governor = createSignal(false);
    const gate = new InternalQueryConcurrencyGate({
      governor: governor.signal,
    });

    const held = acquire(gate, 'memory-curator');
    expect(gate.queued).toBe(1);
    expect(gate.inFlight).toBe(0);

    const releaseDefault = await acquire(gate, 'default');
    expect(gate.inFlight).toBe(1);
    expect(gate.isGoverned('default')).toBe(false);
    expect(gate.isGoverned('memory-curator')).toBe(true);

    governor.set(true);
    (await held)();
    releaseDefault();
    expect(gate.inFlight).toBe(0);
  });

  /**
   * Batch 16b: the governor holds an explicit allow-list. `default` (wizard,
   * harness, cron), `user-action` (RPC clicks) and any lane nobody listed are
   * admitted on slots alone, even while the governor is busy.
   */
  it('governs exactly the allow-listed background lanes', async () => {
    expect([...GOVERNED_BACKGROUND_LANES].sort()).toEqual(
      [MEMORY_CURATOR_QUERY_LANE, SKILL_SYNTHESIS_QUERY_LANE].sort(),
    );
    const governor = createSignal(false);
    const gate = new InternalQueryConcurrencyGate({
      governor: governor.signal,
    });

    for (const lane of GOVERNED_BACKGROUND_LANES) {
      expect(gate.isGoverned(lane)).toBe(true);
    }
    for (const lane of ['default', USER_ACTION_QUERY_LANE, 'brand-new-lane']) {
      expect(gate.isGoverned(lane)).toBe(false);
    }

    // Admitted at once while the governor holds background work.
    const releases = await Promise.all([
      acquire(gate, USER_ACTION_QUERY_LANE, { limit: 3 }),
      acquire(gate, 'brand-new-lane', { limit: 3 }),
      acquire(gate, 'default', { limit: 3 }),
    ]);
    expect(gate.inFlight).toBe(3);
    for (const release of releases) release();
  });

  it('gives a user action its own slot beside a wizard call on default', async () => {
    const gate = new InternalQueryConcurrencyGate({
      governor: createSignal(true).signal,
    });

    const wizard = await acquire(gate, 'default');
    // Per-lane limit 1 on `default` would have queued this before Batch 16b.
    const click = await acquire(gate, USER_ACTION_QUERY_LANE);

    expect(gate.inFlight).toBe(2);
    expect(gate.queued).toBe(0);
    wizard();
    click();
  });

  it('keeps FIFO order between two queued user-action callers', async () => {
    const gate = new InternalQueryConcurrencyGate({
      governor: createSignal(false).signal,
    });
    const order: string[] = [];

    const holder = await acquire(gate, USER_ACTION_QUERY_LANE);
    const first = acquire(gate, USER_ACTION_QUERY_LANE).then((r) => {
      order.push('first');
      return r;
    });
    const second = acquire(gate, USER_ACTION_QUERY_LANE).then((r) => {
      order.push('second');
      return r;
    });
    expect(gate.queued).toBe(2);

    holder();
    (await first)();
    (await second)();

    expect(order).toEqual(['first', 'second']);
    expect(gate.inFlight).toBe(0);
  });

  it('governs nothing without a governor', () => {
    const gate = new InternalQueryConcurrencyGate();
    expect(gate.isGoverned(MEMORY_CURATOR_QUERY_LANE)).toBe(false);
  });

  it('drains held waiters in FIFO order when the governor clears', async () => {
    const governor = createSignal(false);
    const gate = new InternalQueryConcurrencyGate({
      governor: governor.signal,
    });
    const order: string[] = [];

    const first = acquire(gate, 'memory-curator').then((r) => {
      order.push('memory-curator');
      return r;
    });
    const second = acquire(gate, 'skill-synthesis').then((r) => {
      order.push('skill-synthesis');
      return r;
    });

    governor.set(true);
    (await first)();
    (await second)();
    expect(order).toEqual(['memory-curator', 'skill-synthesis']);
    expect(gate.queued).toBe(0);
  });

  it('admits a held waiter at the deferral ceiling (R-P7)', async () => {
    const governor = createSignal(false);
    const onDeferralCeiling = jest.fn();
    const gate = new InternalQueryConcurrencyGate({
      governor: governor.signal,
      maxDeferMs: 1_000,
      onDeferralCeiling,
    });

    const admitted = jest.fn();
    void acquire(gate, 'skill-synthesis').then(admitted);
    await jest.advanceTimersByTimeAsync(999);
    expect(admitted).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(admitted).toHaveBeenCalledTimes(1);
    expect(gate.inFlight).toBe(1);
    expect(onDeferralCeiling).toHaveBeenCalledWith('skill-synthesis', 1_000);
  });

  it('reports the ceiling once per lane per deferral episode', async () => {
    const governor = createSignal(false);
    const onDeferralCeiling = jest.fn();
    const gate = new InternalQueryConcurrencyGate({
      governor: governor.signal,
      maxDeferMs: 1_000,
      onDeferralCeiling,
    });

    // Slot-blocked backlog: one holder, three waiters on one lane, one on another.
    const holder = await acquire(gate, 'default', { limit: 1 });
    for (let i = 0; i < 3; i++) {
      void acquire(gate, 'memory-curator', { limit: 1 }).catch(() => undefined);
    }
    void acquire(gate, 'skill-synthesis', { limit: 1 }).catch(() => undefined);
    await jest.advanceTimersByTimeAsync(1_000);

    expect(onDeferralCeiling.mock.calls).toEqual([
      ['memory-curator', 1_000],
      ['skill-synthesis', 1_000],
    ]);

    // A clear ends the episode; the next hold reports again.
    governor.set(true);
    governor.set(false);
    void acquire(gate, 'memory-curator', { limit: 1 }).catch(() => undefined);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(onDeferralCeiling).toHaveBeenCalledTimes(3);
    holder();
  });

  it('re-reads the governor at drain time: a slot-blocked waiter is held again when the foreground starts', async () => {
    const governor = createSignal(true);
    const gate = new InternalQueryConcurrencyGate({
      governor: governor.signal,
    });

    const holder = await acquire(gate, 'memory-curator');
    const woken = jest.fn();
    const queued = acquire(gate, 'memory-curator').then((r) => {
      woken();
      return r;
    });

    governor.set(false);
    holder();
    await flush();
    expect(woken).not.toHaveBeenCalled();
    expect(gate.queued).toBe(1);

    governor.set(true);
    (await queued)();
    expect(woken).toHaveBeenCalledTimes(1);
  });

  it('does not run the queue timeout while the governor holds the waiter', async () => {
    const governor = createSignal(false);
    const gate = new InternalQueryConcurrencyGate({
      governor: governor.signal,
    });

    const held = acquire(gate, 'memory-curator', { queueTimeoutMs: 100 });
    await jest.advanceTimersByTimeAsync(5_000);
    expect(gate.queued).toBe(1);

    governor.set(true);
    (await held)();
  });

  it('starts the queue timeout once the governor admits a slot-blocked waiter', async () => {
    const governor = createSignal(false);
    const gate = new InternalQueryConcurrencyGate({
      governor: governor.signal,
    });
    const releaseDefault = await acquire(gate, 'default', { limit: 1 });

    const blocked = acquire(gate, 'memory-curator', {
      queueTimeoutMs: 100,
      limit: 1,
    });
    const rejected = expect(blocked).rejects.toThrow(
      InternalQueryQueueTimeoutError,
    );
    await jest.advanceTimersByTimeAsync(5_000);
    expect(gate.queued).toBe(1);

    governor.set(true);
    await jest.advanceTimersByTimeAsync(100);
    await rejected;
    expect(gate.queued).toBe(0);
    releaseDefault();
  });

  it('removes a held waiter on abort and clears its deferral timer', async () => {
    const governor = createSignal(false);
    const onDeferralCeiling = jest.fn();
    const gate = new InternalQueryConcurrencyGate({
      governor: governor.signal,
      maxDeferMs: 1_000,
      onDeferralCeiling,
    });
    const controller = new AbortController();

    const held = acquire(gate, 'memory-curator', { signal: controller.signal });
    controller.abort();

    await expect(held).rejects.toMatchObject({ name: 'AbortError' });
    expect(gate.queued).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(onDeferralCeiling).not.toHaveBeenCalled();
    governor.set(true);
    expect(gate.inFlight).toBe(0);
  });

  describe('governor disposed (host shutdown)', () => {
    it('rejects every queued background call with AbortError and leaves default alone', async () => {
      const governor = createSignal(false);
      const gate = new InternalQueryConcurrencyGate({
        governor: governor.signal,
      });
      const holder = await acquire(gate, 'default', { limit: 1 });

      const background = acquire(gate, 'memory-curator', { limit: 1 });
      const backgroundRejected = expect(background).rejects.toMatchObject({
        name: 'AbortError',
      });
      const userCall = acquire(gate, 'default', { limit: 1 });
      expect(gate.queued).toBe(2);

      governor.dispose();
      await backgroundRejected;
      expect(gate.queued).toBe(1);
      expect(gate.inFlight).toBe(1);

      // Releasing the slot must go to the default-lane caller, not the
      // cancelled background one.
      holder();
      (await userCall)();
      expect(gate.inFlight).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('rejects a later background acquire at once, even with free slots', async () => {
      const governor = createSignal(true);
      const gate = new InternalQueryConcurrencyGate({
        governor: governor.signal,
      });

      governor.dispose();

      await expect(acquire(gate, 'skill-synthesis')).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(gate.inFlight).toBe(0);
      (await acquire(gate, 'default'))();
    });
  });
});
