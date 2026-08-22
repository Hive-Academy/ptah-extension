/**
 * LaneRunnerService — the contract every stage in this library runs against.
 *
 * The three sibling specs each own one risk (`env-immutability` = R1/R2,
 * `parse-fallback` = P1-6, `limits` = P1-8). This one owns everything else: the
 * failure-mode mapping, the tool-use capability guard, budget accounting, and
 * the bound on how many times a single `run()` may call the LLM.
 */
import 'reflect-metadata';
import {
  LANE_DEGRADED_RETRY_MS,
  LANE_MAX_EXECUTIONS_PER_RUN,
  LaneRunnerService,
  timeoutBackoffMs,
} from './lane-runner.service';
import {
  LANE_AUTH_RETRY_MS,
  LANE_QUOTA_RETRY_MS,
  SKILL_LANE_IDS,
} from './lane.types';
import type { IInternalQuery } from '../internal-query.interface';
import {
  assistantText,
  makeBudgetStub,
  makeFailingResolverStub,
  makeHangingQueryStub,
  makeLogger,
  makeQueryStub,
  makeQueueStub,
  makeResolverStub,
  makeThrowingResolverStub,
  resolvedLane,
  resultMessage,
} from './lane-runner.test-support';

describe('LaneRunnerService — auth-unresolvable stalls (Q2)', () => {
  it('forwards the resolver failure verbatim and never calls the LLM', async () => {
    const query = makeQueryStub([]);
    const resolver = makeFailingResolverStub({
      ok: false,
      failure: {
        kind: 'auth-unresolvable',
        reason: 'Lane judge: endpoint unreachable',
        retryAfterMs: LANE_AUTH_RETRY_MS,
      },
    });
    const runner = new LaneRunnerService(
      makeLogger(),
      resolver.service,
      makeBudgetStub().store,
      query.query,
    );

    const out = await runner.run({ laneId: 'judge', prompt: 'hi' });

    expect(out.status).toBe('failed');
    if (out.status !== 'failed') return;
    expect(out.failure.kind).toBe('auth-unresolvable');
    expect(out.failure.reason).toBe('Lane judge: endpoint unreachable');
    expect(out.failure.retryAfterMs).toBe(LANE_AUTH_RETRY_MS);
    // Q2: it stalls. It does NOT quietly ride the user's active provider.
    expect(query.execute).not.toHaveBeenCalled();
  });

  it('forwards a quota failure verbatim and never calls the LLM either', async () => {
    // The gate's whole value: the second and later rows cost ZERO upstream
    // requests. A runner that dispatched anyway would re-pay the discovery
    // cost per row, which is the defect.
    const query = makeQueryStub([]);
    const resolver = makeFailingResolverStub({
      ok: false,
      failure: {
        kind: 'quota-exhausted',
        reason:
          'Lane judge: Provider quota exhausted; retrying in about 15 min.',
        retryAfterMs: LANE_QUOTA_RETRY_MS,
      },
    });
    const runner = new LaneRunnerService(
      makeLogger(),
      resolver.service,
      makeBudgetStub().store,
      query.query,
    );

    const out = await runner.run({ laneId: 'judge', prompt: 'hi' });

    expect(out.status).toBe('failed');
    if (out.status !== 'failed') return;
    expect(out.failure.kind).toBe('quota-exhausted');
    expect(out.failure.retryAfterMs).toBe(LANE_QUOTA_RETRY_MS);
    expect(out.failure.reason).not.toMatch(/timed out/i);
    expect(query.execute).not.toHaveBeenCalled();
  });

  it('rethrows a non-auth resolver error rather than burying a defect', async () => {
    // The resolver already distinguishes the two; the runner must not add a
    // second catch that turns a real bug into a user-facing queue `reason`.
    const bug = new TypeError('cannot read properties of undefined');
    const runner = new LaneRunnerService(
      makeLogger(),
      makeThrowingResolverStub(bug),
      makeBudgetStub().store,
      makeQueryStub([]).query,
    );

    await expect(runner.run({ laneId: 'judge', prompt: 'x' })).rejects.toThrow(
      bug,
    );
  });
});

describe('LaneRunnerService — a host with no SDK is unavailable, not failed', () => {
  it('answers `unavailable` rather than putting a retry backoff on the row', async () => {
    const runner = new LaneRunnerService(
      makeLogger(),
      makeResolverStub(resolvedLane('judge')).service,
      makeBudgetStub().store,
      null,
    );

    const out = await runner.run({ laneId: 'judge', prompt: 'x' });

    expect(out.status).toBe('unavailable');
    // A `SkillLaneFailure` would schedule a retry for a host that can never
    // succeed; `unavailable` lets the caller mark the row `skipped` instead.
    expect(out).not.toHaveProperty('failure');
  });

  it('answers `unavailable` for a REGISTERED query service that was never initialized, without calling it', async () => {
    // The CLI's shape: `withEngine({ mode: 'full', requireSdk: false })`
    // registers `agent-sdk` — so the DI token resolves — and never runs
    // `SdkAgentAdapter.initialize()`, so `execute` can only throw. Reading the
    // registration alone called that a live lane, and the throw reached
    // `SkillJudgeService` as `judge-call-threw`, which is an `unscored` verdict:
    // `ptah skill-synthesis promote` then answered `judge-unscored` and exited 2
    // on a host that simply has no judge.
    const query = makeQueryStub([]);
    const uninitialized: IInternalQuery = {
      ...query.query,
      isInitialized: () => false,
    };
    const runner = new LaneRunnerService(
      makeLogger(),
      makeResolverStub(resolvedLane('judge')).service,
      makeBudgetStub().store,
      uninitialized,
    );

    const out = await runner.run({ laneId: 'judge', prompt: 'x' });

    expect(out.status).toBe('unavailable');
    expect(out).not.toHaveProperty('failure');
    expect(query.execute).not.toHaveBeenCalled();
  });

  it('runs normally when the query service does not answer the question at all', async () => {
    // Absent is not "no". Every existing test double omits `isInitialized`, and
    // an optional probe read as `!isInitialized?.()` would silently disable
    // every one of them.
    const query = makeQueryStub([
      [assistantText('hi'), resultMessage({ result: 'hi' })],
    ]);
    const runner = new LaneRunnerService(
      makeLogger(),
      makeResolverStub(resolvedLane('judge')).service,
      makeBudgetStub().store,
      query.query,
    );

    const out = await runner.run({ laneId: 'judge', prompt: 'x' });

    expect(out.status).toBe('ok');
    expect(query.execute).toHaveBeenCalledTimes(1);
  });

  it('still reports an INITIALIZED but broken SDK as a retryable failure', async () => {
    // `isInitialized()` is "was there ever an SDK here", not "is it healthy".
    // An adapter that initialized and errored owns a transport fault, and
    // downgrading that to `unavailable` would let a caller mark the row
    // `skipped` and drop work a later retry could have finished.
    const hanging = makeHangingQueryStub();
    const initialized: IInternalQuery = {
      ...hanging.query,
      isInitialized: () => true,
    };
    const runner = new LaneRunnerService(
      makeLogger(),
      makeResolverStub(resolvedLane('judge', { config: { timeoutMs: 10 } }))
        .service,
      makeBudgetStub().store,
      initialized,
    );

    const out = await runner.run({ laneId: 'judge', prompt: 'x' });

    expect(out.status).toBe('failed');
    if (out.status !== 'failed') return;
    expect(out.failure.kind).toBe('timeout');
  });
});

describe('LaneRunnerService — the happy path', () => {
  it.each(SKILL_LANE_IDS)(
    'runs lane %s on the resolved model with the lane timeout',
    async (laneId) => {
      const lane = resolvedLane(laneId, { model: 'resolved-model' });
      const query = makeQueryStub([
        [assistantText('the answer'), resultMessage({ result: 'the answer' })],
      ]);
      const runner = new LaneRunnerService(
        makeLogger(),
        makeResolverStub(lane).service,
        makeBudgetStub().store,
        query.query,
      );

      const out = await runner.run({ laneId, prompt: 'question' });

      expect(out.status).toBe('ok');
      if (out.status !== 'ok') return;
      expect(out.run.text).toBe('the answer');
      expect(out.run.executions).toBe(1);
      expect(query.calls[0].model).toBe('resolved-model');
      expect(query.calls[0].prompt).toBe('question');
    },
  );

  it('closes the handle on the success path too', async () => {
    const query = makeQueryStub([[resultMessage({ result: '{}' })]]);
    const runner = new LaneRunnerService(
      makeLogger(),
      makeResolverStub(resolvedLane('judge')).service,
      makeBudgetStub().store,
      query.query,
    );

    await runner.run({ laneId: 'judge', prompt: 'x' });

    expect(query.closed).toBe(1);
    expect(query.aborted).toBe(0);
  });

  it('records the result message usage into the budget ledger', async () => {
    const budget = makeBudgetStub();
    const query = makeQueryStub([
      [
        resultMessage({
          result: 'ok',
          usage: { input_tokens: 1200, output_tokens: 340 },
          total_cost_usd: 0.0042,
        }),
      ],
    ]);
    const runner = new LaneRunnerService(
      makeLogger(),
      makeResolverStub(resolvedLane('synthesis')).service,
      budget.store,
      query.query,
    );

    const out = await runner.run({ laneId: 'synthesis', prompt: 'x' });

    expect(budget.record).toHaveBeenCalledWith({
      inputTokens: 1200,
      outputTokens: 340,
      costUsd: 0.0042,
    });
    expect(out.status === 'ok' && out.run.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 340,
      costUsd: 0.0042,
    });
  });

  it('records nothing when the provider reports no usage', async () => {
    const budget = makeBudgetStub();
    const query = makeQueryStub([[resultMessage({ result: 'ok' })]]);
    await new LaneRunnerService(
      makeLogger(),
      makeResolverStub(resolvedLane('synthesis')).service,
      budget.store,
      query.query,
    ).run({ laneId: 'synthesis', prompt: 'x' });

    expect(budget.record).not.toHaveBeenCalled();
  });

  it('survives a ledger write that throws — the tokens are already spent', async () => {
    const logger = makeLogger();
    const budget = makeBudgetStub();
    budget.record.mockImplementation(() => {
      throw new Error('database is locked');
    });
    const query = makeQueryStub([
      [resultMessage({ result: 'ok', usage: { input_tokens: 5 } })],
    ]);

    const out = await new LaneRunnerService(
      logger,
      makeResolverStub(resolvedLane('judge')).service,
      budget.store,
      query.query,
    ).run({ laneId: 'judge', prompt: 'x' });

    // Failing here would re-run the stage next tick and spend the tokens twice.
    expect(out.status).toBe('ok');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed to record lane usage'),
      expect.anything(),
    );
  });
});

describe('LaneRunnerService — R6, the tool-use capability guard', () => {
  it('forces maxTurns to 1 and passesAllowed to 1 on a `toolUse: none` lane', async () => {
    const lane = resolvedLane('judge', {
      config: { toolUse: 'none', maxPasses: 4 },
    });
    const query = makeQueryStub([[resultMessage({ result: 'ok' })]]);
    const out = await new LaneRunnerService(
      makeLogger(),
      makeResolverStub(lane).service,
      makeBudgetStub().store,
      query.query,
    ).run({ laneId: 'judge', prompt: 'x', maxTurns: 12 });

    // The guard is applied BEFORE the call, not discovered by burning the
    // timeout on a model that cannot drive tools.
    expect(query.calls[0].maxTurns).toBe(1);
    expect(out.status === 'ok' && out.run.passesAllowed).toBe(1);
  });

  it('does NOT mark a declared `toolUse: none` lane as degraded', async () => {
    // Both shipped default lanes declare it; marking every one of their runs
    // degraded would make `degraded_reason` meaningless on the rows that are.
    const lane = resolvedLane('judge', { config: { toolUse: 'none' } });
    const out = await new LaneRunnerService(
      makeLogger(),
      makeResolverStub(lane).service,
      makeBudgetStub().store,
      makeQueryStub([[resultMessage({ result: 'ok' })]]).query,
    ).run({ laneId: 'judge', prompt: 'x' });

    expect(out.status === 'ok' && out.run.degradedReason).toBeNull();
  });

  it('collapses to a single pass ONCE when pass 1 hits error_max_turns', async () => {
    const lane = resolvedLane('archaeologist', {
      config: { toolUse: 'required', maxPasses: 4 },
    });
    const query = makeQueryStub([
      [assistantText('partial'), resultMessage({ subtype: 'error_max_turns' })],
    ]);
    const out = await new LaneRunnerService(
      makeLogger(),
      makeResolverStub(lane).service,
      makeBudgetStub().store,
      query.query,
    ).run({ laneId: 'archaeologist', prompt: 'x', maxTurns: 6 });

    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.run.degradedReason).toBe('tool-use-unsupported');
    expect(out.run.passesAllowed).toBe(1);
    // "Never loop to timeout": the degradation is REPORTED, not retried.
    expect(query.execute).toHaveBeenCalledTimes(1);
  });

  it('keeps the full pass budget when the lane drives tools successfully', async () => {
    const lane = resolvedLane('archaeologist', {
      config: { toolUse: 'required', maxPasses: 4 },
    });
    const out = await new LaneRunnerService(
      makeLogger(),
      makeResolverStub(lane).service,
      makeBudgetStub().store,
      makeQueryStub([[resultMessage({ subtype: 'success', result: 'ok' })]])
        .query,
    ).run({ laneId: 'archaeologist', prompt: 'x', maxTurns: 6 });

    expect(out.status === 'ok' && out.run.passesAllowed).toBe(4);
    expect(out.status === 'ok' && out.run.degradedReason).toBeNull();
  });
});

describe('LaneRunnerService — the execution bound', () => {
  it('never calls the LLM more than twice in one run', async () => {
    // The bound IS R6's mitigation: there is no loop in the runner that can
    // call the LLM, so a lane cannot burn its timeout rediscovering the same
    // missing capability.
    expect(LANE_MAX_EXECUTIONS_PER_RUN).toBe(2);

    const query = makeQueryStub([
      [resultMessage({ result: 'not json at all' })],
      [resultMessage({ result: 'still not json' })],
      [resultMessage({ result: '{"ok":true}' })],
    ]);
    const out = await new LaneRunnerService(
      makeLogger(),
      makeResolverStub(
        resolvedLane('judge', { config: { structuredOutput: 'sdk' } }),
      ).service,
      makeBudgetStub().store,
      query.query,
    ).run({ laneId: 'judge', prompt: 'x', outputSchema: { type: 'object' } });

    expect(query.execute).toHaveBeenCalledTimes(LANE_MAX_EXECUTIONS_PER_RUN);
    expect(out.status).toBe('failed');
    if (out.status !== 'failed') return;
    expect(out.failure.kind).toBe('structured-output-unsupported');
    expect(out.failure.retryAfterMs).toBe(LANE_DEGRADED_RETRY_MS);
  });

  it('does not fail a prose run just because it is not JSON', async () => {
    // No schema requested ⇒ nothing to fail to parse.
    const out = await new LaneRunnerService(
      makeLogger(),
      makeResolverStub(resolvedLane('synthesis')).service,
      makeBudgetStub().store,
      makeQueryStub([[assistantText('a paragraph of prose')]]).query,
    ).run({ laneId: 'synthesis', prompt: 'x' });

    expect(out.status).toBe('ok');
    expect(out.status === 'ok' && out.run.json).toBeNull();
  });
});

describe('LaneRunnerService — the queue write on a transport failure', () => {
  const AUTH_FAILURE = {
    ok: false as const,
    failure: {
      kind: 'auth-unresolvable' as const,
      reason: 'Lane judge: endpoint unreachable',
      retryAfterMs: LANE_AUTH_RETRY_MS,
    },
  };

  it('requeues the row behind the backoff on auth-unresolvable, never marking it unscored', async () => {
    // `unscored` is the JUDGE's verdict. An endpoint that never answered has
    // produced no verdict at all, and conflating the two would make the status
    // unreadable on the Activity surface.
    const queue = makeQueueStub();
    const before = Date.now();

    const out = await new LaneRunnerService(
      makeLogger(),
      makeFailingResolverStub(AUTH_FAILURE).service,
      makeBudgetStub().store,
      makeQueryStub([]).query,
      queue.store,
    ).run({ laneId: 'judge', prompt: 'x', queueItemId: 'row-1' });

    expect(out.status).toBe('failed');
    expect(queue.requeue).toHaveBeenCalledTimes(1);
    const [id, notBefore, reason] = queue.requeue.mock.calls[0] as [
      string,
      number,
      string,
    ];
    expect(id).toBe('row-1');
    expect(notBefore).toBeGreaterThanOrEqual(before + LANE_AUTH_RETRY_MS);
    expect(reason).toBe('Lane judge: endpoint unreachable');
  });

  it('does nothing to the queue when the caller supplied no row', async () => {
    // The judge also runs at the foreground promotion gate, which has no row.
    const queue = makeQueueStub();
    await new LaneRunnerService(
      makeLogger(),
      makeFailingResolverStub(AUTH_FAILURE).service,
      makeBudgetStub().store,
      makeQueryStub([]).query,
      queue.store,
    ).run({ laneId: 'judge', prompt: 'x' });

    expect(queue.requeue).not.toHaveBeenCalled();
  });

  it('requeues a quota-exhausted row behind the provider cooldown too', async () => {
    // `quota-exhausted` is TRANSPORT: nothing ran. It earns the same queue
    // write as the other two, and it must not be `markUnscored`.
    const queue = makeQueueStub();
    const before = Date.now();

    const out = await new LaneRunnerService(
      makeLogger(),
      makeFailingResolverStub({
        ok: false,
        failure: {
          kind: 'quota-exhausted',
          reason: 'Lane judge: Provider quota exhausted.',
          retryAfterMs: LANE_QUOTA_RETRY_MS,
        },
      }).service,
      makeBudgetStub().store,
      makeQueryStub([]).query,
      queue.store,
    ).run({ laneId: 'judge', prompt: 'x', queueItemId: 'row-1' });

    expect(out.status).toBe('failed');
    expect(queue.requeue).toHaveBeenCalledTimes(1);
    const [id, notBefore, reason] = queue.requeue.mock.calls[0] as [
      string,
      number,
      string,
    ];
    expect(id).toBe('row-1');
    expect(notBefore).toBeGreaterThanOrEqual(before + LANE_QUOTA_RETRY_MS);
    expect(notBefore).toBeLessThan(before + LANE_AUTH_RETRY_MS);
    expect(reason).toBe('Lane judge: Provider quota exhausted.');
  });

  it('leaves structured-output-unsupported for the drain to map', async () => {
    // That transition also writes the candidate's `judge_status`; splitting the
    // pair across two owners is how a row and its candidate end up disagreeing.
    const queue = makeQueueStub();
    const out = await new LaneRunnerService(
      makeLogger(),
      makeResolverStub(
        resolvedLane('judge', { config: { structuredOutput: 'parse' } }),
      ).service,
      makeBudgetStub().store,
      makeQueryStub([[resultMessage({ result: 'no json here' })]]).query,
      queue.store,
    ).run({
      laneId: 'judge',
      prompt: 'x',
      queueItemId: 'row-1',
      outputSchema: { type: 'object' },
    });

    expect(out.status === 'failed' && out.failure.kind).toBe(
      'structured-output-unsupported',
    );
    expect(queue.requeue).not.toHaveBeenCalled();
  });

  it('leaves the row of a successful run alone', async () => {
    const queue = makeQueueStub();
    const out = await new LaneRunnerService(
      makeLogger(),
      makeResolverStub(resolvedLane('judge')).service,
      makeBudgetStub().store,
      makeQueryStub([[resultMessage({ result: 'ok' })]]).query,
      queue.store,
    ).run({ laneId: 'judge', prompt: 'x', queueItemId: 'row-1' });

    expect(out.status).toBe('ok');
    expect(queue.requeue).not.toHaveBeenCalled();
  });

  it('tolerates a row it has already lost rather than failing the run twice', async () => {
    const logger = makeLogger();
    const queue = makeQueueStub(false);
    const out = await new LaneRunnerService(
      logger,
      makeFailingResolverStub(AUTH_FAILURE).service,
      makeBudgetStub().store,
      makeQueryStub([]).query,
      queue.store,
    ).run({ laneId: 'judge', prompt: 'x', queueItemId: 'row-1' });

    expect(out.status).toBe('failed');
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('no longer claimed'),
      expect.anything(),
    );
  });

  it('runs unchanged in a host that resolved no queue store at all', async () => {
    const out = await new LaneRunnerService(
      makeLogger(),
      makeFailingResolverStub(AUTH_FAILURE).service,
      makeBudgetStub().store,
      makeQueryStub([]).query,
    ).run({ laneId: 'judge', prompt: 'x', queueItemId: 'row-1' });

    expect(out.status === 'failed' && out.failure.kind).toBe(
      'auth-unresolvable',
    );
  });
});

describe('timeoutBackoffMs — 2^attempt x 60s, capped at 6h', () => {
  it('doubles per attempt', () => {
    expect(timeoutBackoffMs(0)).toBe(60_000);
    expect(timeoutBackoffMs(1)).toBe(120_000);
    expect(timeoutBackoffMs(3)).toBe(480_000);
  });

  it('caps at six hours rather than overflowing', () => {
    expect(timeoutBackoffMs(50)).toBe(6 * 60 * 60_000);
  });
});
