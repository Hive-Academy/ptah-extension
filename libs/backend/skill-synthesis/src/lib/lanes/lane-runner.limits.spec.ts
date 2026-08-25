/**
 * P1-8 — the two limits that make a lane bounded: `timeoutMs` and
 * `maxInputChars`.
 *
 * ## Why these are asserted together
 *
 * They are the two module constants B1.5 turned into lane configuration —
 * `JUDGE_TIMEOUT_MS` / `SYNTHESIS_TIMEOUT_MS` and the `8000` / `3000` prompt
 * slices. Before lanes, every stage shared one hardcoded wall clock and one
 * hardcoded slice, so a fast judge and a slow archaeologist were tuned against
 * the same number and neither fitted. The assertions below are what stop those
 * numbers drifting back into the services.
 *
 * ## The timeout assertion is about OUR timer, not the fake's
 *
 * `makeHangingQueryStub` yields nothing until its `abortController` fires. That
 * matters: against a stub that eventually yields on its own, this spec would
 * pass just as happily on a runner that never armed a timer at all. The stream
 * settling IS the proof that the runner aborted it.
 *
 * `flushMicrotasks` before every `advanceTimersByTime` is load-bearing for the
 * same reason it is in the sibling specs: `advanceTimersByTime` only fires
 * timers that are ALREADY armed, and the runner arms its timeout two `await`s
 * into `run()`. Advancing too early leaves the run pending forever, which
 * surfaces as a Jest timeout rather than as a readable assertion failure.
 */
import 'reflect-metadata';
import {
  LANE_TRUNCATION_MARKER,
  LaneRunnerService,
  timeoutBackoffMs,
} from './lane-runner.service';
import {
  flushMicrotasks,
  makeBudgetStub,
  makeHangingQueryStub,
  makeLogger,
  makeQueryStub,
  makeQueueStub,
  makeResolverStub,
  resolvedLane,
  resultMessage,
} from './lane-runner.test-support';

const TIMEOUT_MS = 15_000;

describe('P1-8 — a hung stream is aborted at exactly cfg.timeoutMs', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /** Non-blocking "has it settled yet?" — a bare `await` here would deadlock. */
  function settled<T>(promise: Promise<T>): {
    done: () => boolean;
    value: () => T | undefined;
  } {
    let out: T | undefined;
    let done = false;
    void promise.then((v) => {
      out = v;
      done = true;
    });
    return { done: () => done, value: () => out };
  }

  it('is still running one millisecond BEFORE the deadline', async () => {
    const query = makeHangingQueryStub();
    const runner = new LaneRunnerService(
      makeLogger(),
      makeResolverStub(
        resolvedLane('judge', { config: { timeoutMs: TIMEOUT_MS } }),
      ).service,
      makeBudgetStub().store,
      query.query,
    );

    const state = settled(runner.run({ laneId: 'judge', prompt: 'x' }));
    await flushMicrotasks();

    jest.advanceTimersByTime(TIMEOUT_MS - 1);
    await flushMicrotasks();

    // Firing early would cut off endpoints that are merely slow, and the lane
    // would look broken rather than under-provisioned.
    expect(state.done()).toBe(false);
    expect(query.aborted).toBe(0);
  });

  it('fails with kind `timeout` the millisecond the deadline lands', async () => {
    const query = makeHangingQueryStub();
    const runner = new LaneRunnerService(
      makeLogger(),
      makeResolverStub(
        resolvedLane('judge', { config: { timeoutMs: TIMEOUT_MS } }),
      ).service,
      makeBudgetStub().store,
      query.query,
    );

    const state = settled(
      runner.run({ laneId: 'judge', prompt: 'x', attempt: 0 }),
    );
    await flushMicrotasks();

    jest.advanceTimersByTime(TIMEOUT_MS);
    await flushMicrotasks();

    expect(state.done()).toBe(true);
    const out = state.value();
    expect(out?.status).toBe('failed');
    if (out?.status !== 'failed') return;
    expect(out.failure.kind).toBe('timeout');
    expect(out.failure.retryAfterMs).toBe(timeoutBackoffMs(0));

    // `abort()` AND `close()`, in that order: closing without aborting leaves
    // the endpoint generating tokens nobody will ever read.
    expect(query.aborted).toBe(1);
    expect(query.closed).toBe(1);
    // The bound holds through the timeout path too — no silent retry.
    expect(query.execute).toHaveBeenCalledTimes(1);
  });

  it('honours the lane s own timeout rather than a shared constant', async () => {
    // The whole point of moving `timeoutMs` onto the lane: a short lane must
    // NOT still be alive at the long lane's deadline.
    const shortLane = makeHangingQueryStub();
    const shortRun = settled(
      new LaneRunnerService(
        makeLogger(),
        makeResolverStub(
          resolvedLane('judge', { config: { timeoutMs: 5_000 } }),
        ).service,
        makeBudgetStub().store,
        shortLane.query,
      ).run({ laneId: 'judge', prompt: 'x' }),
    );

    const longLane = makeHangingQueryStub();
    const longRun = settled(
      new LaneRunnerService(
        makeLogger(),
        makeResolverStub(
          resolvedLane('archaeologist', { config: { timeoutMs: 120_000 } }),
        ).service,
        makeBudgetStub().store,
        longLane.query,
      ).run({ laneId: 'archaeologist', prompt: 'x' }),
    );

    await flushMicrotasks();
    jest.advanceTimersByTime(5_000);
    await flushMicrotasks();

    expect(shortRun.done()).toBe(true);
    expect(longRun.done()).toBe(false);

    jest.advanceTimersByTime(115_000);
    await flushMicrotasks();
    expect(longRun.done()).toBe(true);
  });

  it('requeues the row behind the exponential backoff on timeout', async () => {
    // The transport-failure write: the row goes back to `queued` behind
    // `2^attempt x 60s`, NOT to a terminal status.
    const queue = makeQueueStub();
    const query = makeHangingQueryStub();
    const startedAt = Date.now();
    const state = settled(
      new LaneRunnerService(
        makeLogger(),
        makeResolverStub(
          resolvedLane('synthesis', { config: { timeoutMs: TIMEOUT_MS } }),
        ).service,
        makeBudgetStub().store,
        query.query,
        queue.store,
      ).run({
        laneId: 'synthesis',
        prompt: 'x',
        attempt: 3,
        queueItemId: 'row-9',
      }),
    );

    await flushMicrotasks();
    jest.advanceTimersByTime(TIMEOUT_MS);
    await flushMicrotasks();

    expect(state.done()).toBe(true);
    expect(queue.requeue).toHaveBeenCalledTimes(1);
    const [id, notBefore, reason] = queue.requeue.mock.calls[0] as [
      string,
      number,
      string,
    ];
    expect(id).toBe('row-9');
    expect(notBefore).toBe(startedAt + TIMEOUT_MS + timeoutBackoffMs(3));
    expect(reason).toContain('synthesis');
  });
});

describe('P1-8 — maxInputChars clips the prompt and flags the truncation', () => {
  const HUGE = 'x'.repeat(50_000);

  function run(maxInputChars: number, prompt: string) {
    const query = makeQueryStub([[resultMessage({ result: 'ok' })]]);
    const runner = new LaneRunnerService(
      makeLogger(),
      makeResolverStub(
        resolvedLane('archaeologist', { config: { maxInputChars } }),
      ).service,
      makeBudgetStub().store,
      query.query,
    );
    return { query, out: runner.run({ laneId: 'archaeologist', prompt }) };
  }

  it('sends at most maxInputChars plus the marker, and sets truncated', async () => {
    const { query, out } = run(6_000, HUGE);
    const result = await out;

    const sent = query.calls[0].prompt as string;
    expect(sent.length).toBeLessThanOrEqual(
      6_000 + LANE_TRUNCATION_MARKER.length,
    );
    expect(sent.length).toBe(6_000 + LANE_TRUNCATION_MARKER.length);

    // The marker is not decoration: without it the model cannot tell a
    // deliberate excerpt from a corrupt transcript, and neither can a human
    // reading the queue row afterwards.
    expect(sent.endsWith(LANE_TRUNCATION_MARKER)).toBe(true);
    expect(sent.startsWith('x'.repeat(6_000))).toBe(true);

    // This is what the caller writes to the queue row's `payload.truncated`.
    expect(result.status === 'ok' && result.run.truncated).toBe(true);
  });

  it('leaves a prompt inside the budget completely untouched', async () => {
    const small = 'y'.repeat(6_000);
    const { query, out } = run(6_000, small);
    const result = await out;

    // Exactly at the limit is NOT truncation — an off-by-one here would append
    // the marker to every full-budget prompt and cost a character of real input.
    expect(query.calls[0].prompt).toBe(small);
    expect(query.calls[0].prompt).not.toContain(LANE_TRUNCATION_MARKER);
    expect(result.status === 'ok' && result.run.truncated).toBe(false);
  });

  it('applies each lane s own budget, not one shared slice', async () => {
    const wide = run(20_000, HUGE);
    await wide.out;
    const narrow = run(3_000, HUGE);
    await narrow.out;

    expect((wide.query.calls[0].prompt as string).length).toBe(
      20_000 + LANE_TRUNCATION_MARKER.length,
    );
    expect((narrow.query.calls[0].prompt as string).length).toBe(
      3_000 + LANE_TRUNCATION_MARKER.length,
    );
  });
});
