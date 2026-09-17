/**
 * `LaneRunnerService` and the network back-off — TASK_2026_437 C14 (f).
 *
 * The stream shape is the 2026-09-14 incident: the subprocess retried against
 * a proxy answering HTTP 500, then closed the request with an error message
 * and an `is_error` result. Before this change that run reached the
 * structured-output ladder as "the endpoint ignored `outputFormat`" and was
 * dispatched a SECOND time into the same dead endpoint.
 */
import 'reflect-metadata';
import { LaneRunnerService } from './lane-runner.service';
import { isTransportLaneFailure } from './lane.types';
import { ProviderNetworkBackoffs } from './provider-network-backoffs';
import {
  assistantText,
  makeBudgetStub,
  makeLogger,
  makeQueryStub,
  makeResolverStub,
  resolvedLane,
  resultMessage,
  type StreamMessage,
} from './lane-runner.test-support';

const INCIDENT: StreamMessage[] = [
  {
    type: 'system',
    subtype: 'api_retry',
    error_status: 500,
    error: 'server_error',
  },
  {
    type: 'assistant',
    error: 'server_error',
    message: {
      content: [{ type: 'text', text: 'API Error: 500 {"score": 9}' }],
    },
  },
  resultMessage({ subtype: 'success', is_error: true, api_error_status: 500 }),
];

const ANSWER: StreamMessage[] = [
  assistantText('{"verdict":"ok"}'),
  resultMessage({ subtype: 'success', result: '{"verdict":"ok"}' }),
];

function harness(scripts: StreamMessage[][]) {
  let now = 1_800_000_000_000;
  const logger = makeLogger();
  const backoffs = new ProviderNetworkBackoffs({
    logger,
    logPrefix: '[skill-synthesis]',
    now: () => now,
    random: () => 0.5,
  });
  // Every lane here inherits (`provider: ''`), so it rides the active provider.
  const backoff = backoffs.for('');
  const query = makeQueryStub(scripts);
  const runner = new LaneRunnerService(
    logger,
    makeResolverStub(resolvedLane('archaeologist')).service,
    makeBudgetStub().store,
    query.query,
    null,
    null,
    backoffs,
  );
  return {
    runner,
    query,
    backoff,
    backoffs,
    logger,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const SCHEMA = { type: 'object' };

describe('LaneRunnerService — network-class failures (C14 f)', () => {
  it('fails the incident shape as network-unreachable, with ONE execution and no ladder re-run', async () => {
    const h = harness([INCIDENT, ANSWER]);

    const result = await h.runner.run({
      laneId: 'archaeologist',
      prompt: 'p',
      outputSchema: SCHEMA,
    });

    expect(result).toEqual({
      status: 'failed',
      failure: {
        kind: 'network-unreachable',
        reason: 'Lane archaeologist: provider unreachable (http-5xx)',
        retryAfterMs: 30_000,
      },
    });
    expect(h.query.execute).toHaveBeenCalledTimes(1);
    expect(isTransportLaneFailure('network-unreachable')).toBe(true);
    expect(h.backoff.currentLevel).toBe(1);
  });

  it('classifies a thrown socket error as network-unreachable instead of throwing', async () => {
    const h = harness([]);
    h.query.execute.mockRejectedValueOnce(
      new Error('fetch failed', {
        cause: Object.assign(new Error('connect ECONNREFUSED'), {
          code: 'ECONNREFUSED',
        }),
      }),
    );

    const result = await h.runner.run({ laneId: 'judge', prompt: 'p' });

    expect(result).toMatchObject({
      status: 'failed',
      failure: { kind: 'network-unreachable', retryAfterMs: 30_000 },
    });
  });

  it('still throws a non-network defect to the drain', async () => {
    const h = harness([]);
    h.query.execute.mockRejectedValueOnce(new Error('400 invalid request'));
    await expect(
      h.runner.run({ laneId: 'judge', prompt: 'p' }),
    ).rejects.toThrow('400 invalid request');
    expect(h.backoff.currentLevel).toBe(0);
  });

  it('holds a BACKGROUND run while the window is open, without dispatching it', async () => {
    const h = harness([INCIDENT, ANSWER]);
    await h.runner.run({ laneId: 'judge', prompt: 'p' });
    h.advance(10_000);

    const held = await h.runner.run({ laneId: 'judge', prompt: 'p' });

    expect(held).toEqual({
      status: 'failed',
      failure: {
        kind: 'network-unreachable',
        reason:
          'Lane judge: provider unreachable, waiting out the network back-off',
        retryAfterMs: 20_000,
      },
    });
    expect(h.query.execute).toHaveBeenCalledTimes(1);
  });

  it('never holds a user-initiated run, and its answer clears the back-off', async () => {
    const h = harness([INCIDENT, ANSWER, ANSWER]);
    await h.runner.run({ laneId: 'judge', prompt: 'p' });

    const manual = await h.runner.run({
      laneId: 'judge',
      prompt: 'p',
      userInitiated: true,
    });
    const background = await h.runner.run({ laneId: 'judge', prompt: 'p' });

    expect(manual.status).toBe('ok');
    expect(background.status).toBe('ok');
    expect(h.query.execute).toHaveBeenCalledTimes(3);
    expect(h.backoff.currentLevel).toBe(0);
  });

  it('dispatches the probe after the window and raises the level when it fails too', async () => {
    const h = harness([INCIDENT, INCIDENT]);
    await h.runner.run({ laneId: 'judge', prompt: 'p' });
    h.advance(30_000);

    const probe = await h.runner.run({ laneId: 'judge', prompt: 'p' });

    expect(h.query.execute).toHaveBeenCalledTimes(2);
    expect(probe).toMatchObject({
      failure: { kind: 'network-unreachable', retryAfterMs: 60_000 },
    });
    const raised = h.logger.info.mock.calls.filter((call) =>
      String(call[0]).includes('backs off'),
    );
    expect(raised.map((call) => call[1].level)).toEqual([1, 2]);
  });

  it('neither raises nor clears the back-off for a run that ended on an auth error', async () => {
    const h = harness([
      INCIDENT,
      [
        { type: 'assistant', error: 'authentication_failed' },
        resultMessage({
          subtype: 'success',
          is_error: true,
          api_error_status: 401,
        }),
      ],
    ]);
    await h.runner.run({ laneId: 'judge', prompt: 'p' });
    h.advance(30_000);

    await h.runner.run({ laneId: 'judge', prompt: 'p' });

    expect(h.query.execute).toHaveBeenCalledTimes(2);
    expect(h.backoff.currentLevel).toBe(1);
    expect(h.backoff.remainingMs()).toBe(0);
  });

  it('runs exactly as before with no back-off injected', async () => {
    const query = makeQueryStub([INCIDENT]);
    const runner = new LaneRunnerService(
      makeLogger(),
      makeResolverStub(resolvedLane('judge')).service,
      makeBudgetStub().store,
      query.query,
    );

    const result = await runner.run({ laneId: 'judge', prompt: 'p' });

    expect(result).toMatchObject({
      failure: { kind: 'network-unreachable', retryAfterMs: 30_000 },
    });
  });
});

describe('LaneRunnerService — the back-off is kept per provider (C14 f)', () => {
  function twoProviderHarness(scripts: StreamMessage[][]) {
    let now = 1_800_000_000_000;
    const backoffs = new ProviderNetworkBackoffs({
      logger: makeLogger(),
      logPrefix: '[skill-synthesis]',
      now: () => now,
      random: () => 0.5,
    });
    const query = makeQueryStub(scripts);
    const runnerFor = (provider: string) =>
      new LaneRunnerService(
        makeLogger(),
        makeResolverStub(resolvedLane('judge', { config: { provider } }))
          .service,
        makeBudgetStub().store,
        query.query,
        null,
        null,
        backoffs,
      );
    return {
      down: runnerFor('provider-down'),
      healthy: runnerFor('provider-healthy'),
      query,
      backoffs,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it("a success on a healthy provider does not clear a down provider's window", async () => {
    const h = twoProviderHarness([INCIDENT, ANSWER]);

    await h.down.run({ laneId: 'judge', prompt: 'p' });
    const healthy = await h.healthy.run({ laneId: 'judge', prompt: 'p' });
    const heldAgain = await h.down.run({ laneId: 'judge', prompt: 'p' });

    expect(healthy.status).toBe('ok');
    expect(heldAgain).toMatchObject({
      status: 'failed',
      failure: { kind: 'network-unreachable', retryAfterMs: 30_000 },
    });
    expect(h.query.execute).toHaveBeenCalledTimes(2);
    expect(h.backoffs.remainingMs('provider-down')).toBe(30_000);
    expect(h.backoffs.remainingMs('provider-healthy')).toBe(0);
  });

  it('a down provider does not hold a lane on another provider', async () => {
    const h = twoProviderHarness([INCIDENT, ANSWER]);

    await h.down.run({ laneId: 'judge', prompt: 'p' });
    const healthy = await h.healthy.run({ laneId: 'judge', prompt: 'p' });

    expect(healthy.status).toBe('ok');
    expect(h.query.execute).toHaveBeenCalledTimes(2);
  });

  it('keys by the trimmed provider id, with blank meaning the active provider', () => {
    expect(ProviderNetworkBackoffs.keyFor('  p1 ')).toBe('p1');
    expect(ProviderNetworkBackoffs.keyFor(undefined)).toBe('');
    const backoffs = new ProviderNetworkBackoffs({
      logger: makeLogger(),
      logPrefix: '[t]',
    });
    expect(backoffs.for(' p1')).toBe(backoffs.for('p1'));
    expect(backoffs.allDeferring([])).toBe(false);
  });
});
