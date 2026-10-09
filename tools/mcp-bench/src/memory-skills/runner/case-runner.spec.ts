import { runCaseWithSafetyCap, SAFETY_CAP_ERROR } from './case-runner';

const never = (signal: AbortSignal): Promise<never> =>
  new Promise((_done, fail) => {
    // Rejects only after the abort, like a cancellable call would.
    signal.addEventListener('abort', () => fail(new Error('aborted')));
  });

describe('runCaseWithSafetyCap (design 4.4, R11)', () => {
  it('returns the value and the runtime of a case that finishes', async () => {
    const run = await runCaseWithSafetyCap(async () => 42, { capMs: 1_000 });
    expect(run).toMatchObject({ outcome: 'completed', value: 42, attempts: 1 });
    expect(run.latencyMs).toBeGreaterThanOrEqual(0);
    expect(run.attemptMs).toHaveLength(1);
  });

  it('retries a capped case once and keeps the retry result', async () => {
    let calls = 0;
    const signals: AbortSignal[] = [];
    const run = await runCaseWithSafetyCap(
      (signal) => {
        calls += 1;
        signals.push(signal);
        return calls === 1 ? never(signal) : Promise.resolve('ok');
      },
      { capMs: 20 },
    );
    expect(run).toMatchObject({
      outcome: 'completed',
      value: 'ok',
      attempts: 2,
    });
    expect(run.attemptMs).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[0].reason).toBe(SAFETY_CAP_ERROR);
    expect(signals[1].aborted).toBe(false);
  });

  it('reports safety-cap after the second cap, with both runtimes', async () => {
    let calls = 0;
    const run = await runCaseWithSafetyCap(
      (signal) => {
        calls += 1;
        return never(signal);
      },
      { capMs: 15 },
    );
    expect(calls).toBe(2);
    expect(run.outcome).toBe(SAFETY_CAP_ERROR);
    expect(run.attempts).toBe(2);
    expect(run.attemptMs).toHaveLength(2);
    expect(run.latencyMs).toBeGreaterThanOrEqual(10);
  });

  it('propagates a case error without a retry', async () => {
    let calls = 0;
    await expect(
      runCaseWithSafetyCap(
        async () => {
          calls += 1;
          throw new Error('cassette-miss: k1');
        },
        { capMs: 1_000 },
      ),
    ).rejects.toThrow('cassette-miss: k1');
    expect(calls).toBe(1);
  });

  it('turns a synchronous throw into a rejection', async () => {
    await expect(
      runCaseWithSafetyCap(
        () => {
          throw new Error('sync');
        },
        { capMs: 1_000 },
      ),
    ).rejects.toThrow('sync');
  });

  it('refuses a non-positive cap', async () => {
    await expect(
      runCaseWithSafetyCap(async () => 1, { capMs: 0 }),
    ).rejects.toThrow(RangeError);
  });
});
