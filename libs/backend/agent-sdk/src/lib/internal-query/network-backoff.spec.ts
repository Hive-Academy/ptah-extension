/**
 * The network back-off — TASK_2026_437 C14 (f).
 *
 * 30 s doubling to a 15-minute ceiling, ±20 % jitter clamped to the ceiling,
 * reset by the first answered call, one log line per level change.
 */
import {
  NetworkBackoff,
  NETWORK_BACKOFF_CEILING_LEVEL,
  NETWORK_BACKOFF_INITIAL_MS,
  NETWORK_BACKOFF_MAX_MS,
} from './network-backoff';

function harness(random = 0.5) {
  let now = 1_000_000;
  const info = jest.fn();
  const backoff = new NetworkBackoff({
    logger: { info },
    logPrefix: '[test]',
    now: () => now,
    random: () => random,
  });
  return {
    backoff,
    info,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** Fail, record the window, then wait it out so the next failure is a probe. */
function failAndExpire(h: ReturnType<typeof harness>): number {
  h.backoff.recordFailure('dns');
  const window = h.backoff.remainingMs();
  h.advance(window);
  return window;
}

describe('NetworkBackoff', () => {
  it('holds nothing before the first failure', () => {
    const h = harness();
    expect(h.backoff.remainingMs()).toBe(0);
    expect(h.backoff.currentLevel).toBe(0);
  });

  it('starts at 30 s, doubles, and caps at 15 min (no jitter at the midpoint)', () => {
    const h = harness(0.5);
    const windows = Array.from({ length: 8 }, () => failAndExpire(h));
    expect(windows).toEqual([
      30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000, 900_000,
    ]);
    expect(NETWORK_BACKOFF_INITIAL_MS).toBe(30_000);
    expect(NETWORK_BACKOFF_MAX_MS).toBe(900_000);
    expect(NETWORK_BACKOFF_CEILING_LEVEL).toBe(6);
    expect(h.backoff.currentLevel).toBe(NETWORK_BACKOFF_CEILING_LEVEL);
  });

  it('writes one log line per level change, none for failures at the ceiling', () => {
    const h = harness();
    for (let i = 0; i < 9; i++) failAndExpire(h);
    const raised = h.info.mock.calls.filter((call) =>
      String(call[0]).includes('backs off'),
    );
    expect(raised).toHaveLength(6);
    expect(raised.map((call) => call[1].level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(raised[0]).toEqual([
      '[test] provider unreachable; background LLM work backs off',
      { level: 1, windowMs: 30_000, signal: 'dns' },
    ]);
  });

  it('does not raise the level for a failure inside an open window', () => {
    const h = harness();
    h.backoff.recordFailure('connection');
    h.advance(10_000);
    h.backoff.recordFailure('connection');
    h.backoff.recordFailure('http-5xx');
    expect(h.backoff.currentLevel).toBe(1);
    expect(h.backoff.remainingMs()).toBe(20_000);
    expect(h.info).toHaveBeenCalledTimes(1);
  });

  it('applies ±20 % jitter and never exceeds the ceiling', () => {
    const low = harness(0);
    low.backoff.recordFailure('timeout');
    expect(low.backoff.remainingMs()).toBe(24_000);

    const high = harness(0.999999);
    high.backoff.recordFailure('timeout');
    expect(high.backoff.remainingMs()).toBe(36_000);

    const capped = harness(0.999999);
    for (let i = 0; i < 7; i++) failAndExpire(capped);
    capped.backoff.recordFailure('timeout');
    expect(capped.backoff.remainingMs()).toBe(NETWORK_BACKOFF_MAX_MS);
  });

  it('resets on the first success and logs the reset once', () => {
    const h = harness();
    failAndExpire(h);
    h.backoff.recordFailure('dns');
    expect(h.backoff.currentLevel).toBe(2);

    h.backoff.recordSuccess();
    h.backoff.recordSuccess();
    expect(h.backoff.currentLevel).toBe(0);
    expect(h.backoff.remainingMs()).toBe(0);
    const cleared = h.info.mock.calls.filter((call) =>
      String(call[0]).includes('cleared'),
    );
    expect(cleared).toEqual([
      [
        '[test] provider reachable again; network back-off cleared',
        { previousLevel: 2 },
      ],
    ]);

    h.backoff.recordFailure('dns');
    expect(h.backoff.remainingMs()).toBe(30_000);
  });

  it('says nothing for a success with no back-off in effect', () => {
    const h = harness();
    h.backoff.recordSuccess();
    expect(h.info).not.toHaveBeenCalled();
  });

  it('omits the signal from the line when the caller has none', () => {
    const h = harness();
    h.backoff.recordFailure();
    expect(h.info).toHaveBeenCalledWith(
      '[test] provider unreachable; background LLM work backs off',
      { level: 1, windowMs: 30_000 },
    );
  });
});
