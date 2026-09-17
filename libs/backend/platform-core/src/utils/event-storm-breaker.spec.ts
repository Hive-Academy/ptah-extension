/**
 * `EventStormBreaker` — TASK_2026_437 INV-6: an event storm degrades to "one
 * refresh later", never to per-event work. Driven entirely by a fake clock.
 */

import {
  EVENT_STORM_BREAKER_DEFAULTS,
  EVENT_STORM_BREAKER_ENV,
  EventStormBreaker,
  readEventStormBreakerOptionsFromEnv,
  type StormRecordResult,
} from './event-storm-breaker';

/** Records `count` events evenly spread over [start, start + spanMs). Returns every result. */
function burst(
  breaker: EventStormBreaker,
  start: number,
  count: number,
  spanMs = 0,
): StormRecordResult[] {
  const results: StormRecordResult[] = [];
  for (let i = 0; i < count; i++) {
    results.push(breaker.record(start + Math.floor((i * spanMs) / count)));
  }
  return results;
}

describe('EventStormBreaker', () => {
  it('stays normal below the threshold', () => {
    const breaker = new EventStormBreaker();
    const results = burst(breaker, 0, 499);
    expect(results.every((r) => r === 'normal')).toBe(true);
    expect(breaker.isStorming).toBe(false);
    expect(breaker.poll(10)).toBe('idle');
  });

  it('enters on the threshold event, then reports storming for every later event', () => {
    const breaker = new EventStormBreaker();
    const results = burst(breaker, 0, 10_000, 900);

    expect(results.slice(0, 499).every((r) => r === 'normal')).toBe(true);
    expect(results[499]).toBe('entered');
    expect(results.slice(500).every((r) => r === 'storming')).toBe(true);
    expect(results.filter((r) => r === 'entered')).toHaveLength(1);

    const stats = breaker.stats();
    expect(stats.storming).toBe(true);
    expect(stats.stormEvents).toBe(9_501);
    expect(stats.stormsEntered).toBe(1);
  });

  it('sustains while events keep arriving and exits exactly once after quiet', () => {
    const breaker = new EventStormBreaker();
    burst(breaker, 0, 600, 500);
    const lastEventAt = 499;

    expect(breaker.poll(1_000)).toBe('storming');
    expect(breaker.poll(lastEventAt + 1_999)).toBe('storming');
    expect(breaker.poll(lastEventAt + 2_000)).toBe('exited');
    // A stray timer after the exit must not cause a second refresh.
    expect(breaker.poll(lastEventAt + 2_001)).toBe('idle');
    expect(breaker.poll(lastEventAt + 60_000)).toBe('idle');

    const stats = breaker.stats();
    expect(stats.storming).toBe(false);
    expect(stats.lastExitReason).toBe('quiet');
    // Entered on event 500, spread to t = floor(499 * 500 / 600) = 415.
    expect(stats.stormStartedAt).toBe(415);
    expect(stats.lastStormDurationMs).toBe(lastEventAt + 2_000 - 415);
    expect(stats.forcedExits).toBe(0);
  });

  it('an event during the quiet wait pushes the exit back', () => {
    const breaker = new EventStormBreaker();
    burst(breaker, 0, 500);
    expect(breaker.poll(1_500)).toBe('storming');
    expect(breaker.record(1_500)).toBe('storming');
    expect(breaker.poll(2_000)).toBe('storming');
    expect(breaker.poll(3_499)).toBe('storming');
    expect(breaker.poll(3_500)).toBe('exited');
  });

  it('forces one refresh at maxStormMs for a storm that never ends, then re-arms', () => {
    const breaker = new EventStormBreaker();
    let now = 0;
    const exits: number[] = [];
    const entries: number[] = [];

    // 1,000 events per second for 65 s, polled every 100 ms.
    for (; now < 65_000; now++) {
      if (breaker.record(now) === 'entered') entries.push(now);
      if (now % 100 === 0 && breaker.poll(now) === 'exited') exits.push(now);
    }

    // Enters once the sliding window holds 500 events, forced out every 30 s.
    expect(entries[0]).toBe(499);
    // Storm started at 499 → forced at the first poll ≥ 30 499, i.e. 30 500.
    expect(exits).toEqual([30_500, 60_600]);
    // Re-armed: the very next event after each forced exit re-enters.
    expect(entries).toEqual([499, 30_501, 60_601]);
    expect(breaker.stats().forcedExits).toBe(2);
    expect(breaker.stats().lastExitReason).toBe('max-duration');
    expect(breaker.stats().stormsEntered).toBe(3);
  });

  it('re-enters a new storm after a quiet exit', () => {
    const breaker = new EventStormBreaker();
    burst(breaker, 0, 500);
    expect(breaker.poll(2_000)).toBe('exited');

    // Counters restart after a quiet exit: a small trickle stays normal.
    expect(burst(breaker, 5_000, 10).every((r) => r === 'normal')).toBe(true);

    const second = burst(breaker, 10_000, 500);
    expect(second[499]).toBe('entered');
    expect(breaker.stats().stormsEntered).toBe(2);
  });

  it('never enters for a steady rate below the threshold', () => {
    const breaker = new EventStormBreaker();
    // 400 events per second for 10 s.
    for (let second = 0; second < 10; second++) {
      const results = burst(breaker, second * 1_000, 400, 1_000);
      expect(results.every((r) => r === 'normal')).toBe(true);
    }
  });

  it('catches a burst straddling a window boundary (sliding, not fixed, window)', () => {
    const breaker = new EventStormBreaker();
    // Align the window at t = 0, then 300 events in the last 100 ms of window 1
    // and 300 in the first 100 ms of window 2 — no fixed window holds 500.
    expect(breaker.record(0)).toBe('normal');
    const tail = burst(breaker, 900, 300, 100);
    const head = burst(breaker, 1_000, 300, 100);
    expect(tail.every((r) => r === 'normal')).toBe(true);
    expect(head).toContain('entered');
  });

  it('forgets the previous window once more than one window has passed', () => {
    const breaker = new EventStormBreaker();
    burst(breaker, 0, 499);
    const later = burst(breaker, 2_500, 499);
    expect(later.every((r) => r === 'normal')).toBe(true);
  });

  it('treats a clock that steps backwards as no elapsed time', () => {
    const breaker = new EventStormBreaker();
    burst(breaker, 10_000, 300);
    const results = burst(breaker, 9_000, 200);
    expect(results[199]).toBe('entered');
    expect(breaker.poll(9_500)).toBe('storming');
    expect(breaker.poll(12_000)).toBe('exited');
  });

  it('honours custom thresholds', () => {
    const breaker = new EventStormBreaker({
      enterEventsPerWindow: 10,
      windowMs: 100,
      quietMs: 50,
      maxStormMs: 200,
    });
    expect(burst(breaker, 0, 10)[9]).toBe('entered');
    expect(breaker.poll(49)).toBe('storming');
    expect(breaker.poll(50)).toBe('exited');
  });

  it.each([
    ['NaN', Number.NaN],
    ['zero', 0],
    ['negative', -1],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('clamps an invalid config (%s) to the defaults', (_label, bad) => {
    const breaker = new EventStormBreaker({
      enterEventsPerWindow: bad,
      windowMs: bad,
      quietMs: bad,
      maxStormMs: bad,
    });
    const results = burst(breaker, 0, 500);
    expect(results[498]).toBe('normal');
    expect(results[499]).toBe('entered');
    expect(breaker.poll(1_999)).toBe('storming');
    expect(breaker.poll(2_000)).toBe('exited');
  });

  it('rejects a fractional event threshold below one', () => {
    const breaker = new EventStormBreaker({ enterEventsPerWindow: 0.5 });
    expect(burst(breaker, 0, 499).every((r) => r === 'normal')).toBe(true);
  });

  it('reports the delay until the next possible exit', () => {
    const breaker = new EventStormBreaker();
    expect(breaker.msUntilNextPoll(0)).toBeUndefined();
    burst(breaker, 0, 500);
    expect(breaker.msUntilNextPoll(0)).toBe(2_000);
    breaker.record(29_000);
    // Forced deadline (30 000) is earlier than quiet (31 000).
    expect(breaker.msUntilNextPoll(29_000)).toBe(1_000);
    expect(breaker.msUntilNextPoll(40_000)).toBe(0);
  });

  it('exposes the documented defaults', () => {
    expect(EVENT_STORM_BREAKER_DEFAULTS).toEqual({
      enterEventsPerWindow: 500,
      windowMs: 1_000,
      quietMs: 2_000,
      maxStormMs: 30_000,
    });
  });
});

describe('readEventStormBreakerOptionsFromEnv', () => {
  it('reads numeric overrides and omits unset, empty or non-numeric ones', () => {
    const options = readEventStormBreakerOptionsFromEnv({
      [EVENT_STORM_BREAKER_ENV.enterEventsPerWindow]: '2000',
      [EVENT_STORM_BREAKER_ENV.windowMs]: '',
      [EVENT_STORM_BREAKER_ENV.quietMs]: 'soon',
      [EVENT_STORM_BREAKER_ENV.maxStormMs]: ' 60000 ',
    });
    expect(options).toEqual({ enterEventsPerWindow: 2000, maxStormMs: 60000 });
  });

  it('returns no overrides for an empty environment', () => {
    expect(readEventStormBreakerOptionsFromEnv({})).toEqual({});
  });

  it('uses the PTAH_WATCH_STORM_* names', () => {
    expect(Object.values(EVENT_STORM_BREAKER_ENV)).toEqual([
      'PTAH_WATCH_STORM_ENTER_EVENTS',
      'PTAH_WATCH_STORM_WINDOW_MS',
      'PTAH_WATCH_STORM_QUIET_MS',
      'PTAH_WATCH_STORM_MAX_MS',
    ]);
  });
});
