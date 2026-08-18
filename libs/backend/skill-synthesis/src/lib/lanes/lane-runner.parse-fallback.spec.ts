/**
 * P1-6 — the structured-output → manual-parse ladder.
 *
 * ## The manual extractors are LOAD-BEARING
 *
 * `outputFormat` is honoured by the Anthropic endpoint. A self-hosted or
 * proxied endpoint typically ignores the field with no error at all: the call
 * succeeds, `structured_output` is simply absent, and the model answers in
 * prose with a fenced JSON block. For a lane declaring `structuredOutput:
 * 'parse'` the manual extractor is not a safety net — it is the ONLY path. That
 * is why `extractJsonObject` (and the judge's flat-object regex it subsumes)
 * must never be deleted as dead code, and why this spec asserts recovery from
 * prose-plus-code-fence rather than from clean JSON.
 *
 * ## The cost guard
 *
 * At most ONE re-run per `run()`. A ladder that kept retrying would convert a
 * capability mismatch into an unbounded spend against a background budget the
 * user is not watching.
 */
import 'reflect-metadata';
import {
  LANE_DEGRADED_RETRY_MS,
  LaneRunnerService,
} from './lane-runner.service';
import { extractJsonObject } from './lane-json';
import {
  assistantText,
  makeBudgetStub,
  makeLogger,
  makeQueryStub,
  makeResolverStub,
  resolvedLane,
  resultMessage,
} from './lane-runner.test-support';

const SCHEMA = {
  type: 'object',
  properties: { novelty: { type: 'number' } },
} as const;

function runner(
  lane: ReturnType<typeof resolvedLane>,
  query: ReturnType<typeof makeQueryStub>,
): LaneRunnerService {
  return new LaneRunnerService(
    makeLogger(),
    makeResolverStub(lane).service,
    makeBudgetStub().store,
    query.query,
  );
}

describe('P1-6 case 1 — a `parse` lane never sends outputFormat', () => {
  it('omits outputFormat entirely and recovers JSON from prose + a code fence', async () => {
    const lane = resolvedLane('judge', {
      config: { structuredOutput: 'parse' },
    });
    const query = makeQueryStub([
      [
        assistantText(
          [
            'Sure — here is my assessment of the candidate.',
            '',
            '```json',
            '{"novelty": 7, "actionability": 8, "note": "watch the } in here"}',
            '```',
            '',
            'Let me know if you want it re-scored.',
          ].join('\n'),
        ),
        resultMessage({ subtype: 'success' }),
      ],
    ]);

    const out = await runner(lane, query).run({
      laneId: 'judge',
      prompt: 'score it',
      outputSchema: SCHEMA as unknown as Record<string, unknown>,
    });

    // Sending outputFormat to an endpoint that cannot honour it is at best
    // wasted, at worst a hard 400 on a strict proxy.
    expect(query.calls[0].outputFormat).toBeUndefined();
    expect(query.execute).toHaveBeenCalledTimes(1);

    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.run.json).toEqual({
      novelty: 7,
      actionability: 8,
      note: 'watch the } in here',
    });
    // A declared `'parse'` lane is configuration, not a degradation — it did
    // exactly what it said it would.
    expect(out.run.degradedReason).toBeNull();
    expect(out.run.structuredOutputHonoured).toBe(false);
  });

  it('fails as structured-output-unsupported when the prose carries no JSON', async () => {
    const lane = resolvedLane('judge', {
      config: { structuredOutput: 'parse' },
    });
    const query = makeQueryStub([
      [assistantText('I would rather not score this one.'), resultMessage({})],
    ]);

    const out = await runner(lane, query).run({
      laneId: 'judge',
      prompt: 'score it',
      outputSchema: SCHEMA as unknown as Record<string, unknown>,
    });

    // No second rung exists for a `'parse'` lane — the first call already had
    // no outputFormat to drop.
    expect(query.execute).toHaveBeenCalledTimes(1);
    expect(out.status).toBe('failed');
    if (out.status !== 'failed') return;
    expect(out.failure.kind).toBe('structured-output-unsupported');
    expect(out.failure.retryAfterMs).toBe(LANE_DEGRADED_RETRY_MS);
  });
});

describe('P1-6 case 2 — an `sdk` lane re-runs EXACTLY once without outputFormat', () => {
  it('drops outputFormat on the retry and parses the second answer manually', async () => {
    const lane = resolvedLane('synthesis', {
      config: { structuredOutput: 'sdk' },
    });
    const query = makeQueryStub([
      // Pass 1: schema was sent, no `structured_output` came back, and the
      // result text is not JSON. That is the whole detection signal.
      [
        resultMessage({
          subtype: 'success',
          result: 'I cannot do JSON schemas.',
        }),
      ],
      [
        assistantText('Fine: {"name":"a-skill","description":"d","body":"b"}'),
        resultMessage({ subtype: 'success' }),
      ],
    ]);

    const out = await runner(lane, query).run({
      laneId: 'synthesis',
      prompt: 'synthesize',
      outputSchema: SCHEMA as unknown as Record<string, unknown>,
    });

    expect(query.execute).toHaveBeenCalledTimes(2);
    expect(query.calls[0].outputFormat).toEqual({
      type: 'json_schema',
      schema: SCHEMA,
    });
    expect(query.calls[1].outputFormat).toBeUndefined();
    // Same prompt — this is a retry of one request, not a new one.
    expect(query.calls[1].prompt).toBe(query.calls[0].prompt);

    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.run.json).toEqual({
      name: 'a-skill',
      description: 'd',
      body: 'b',
    });
    expect(out.run.degradedReason).toBe('structured-output-unsupported');
    expect(out.run.executions).toBe(2);
  });

  it('does NOT re-run when the SDK honoured the schema', async () => {
    const lane = resolvedLane('judge', { config: { structuredOutput: 'sdk' } });
    const query = makeQueryStub([
      [
        resultMessage({
          structured_output: { novelty: 9 },
          subtype: 'success',
        }),
      ],
    ]);

    const out = await runner(lane, query).run({
      laneId: 'judge',
      prompt: 'score it',
      outputSchema: SCHEMA as unknown as Record<string, unknown>,
    });

    expect(query.execute).toHaveBeenCalledTimes(1);
    expect(out.status === 'ok' && out.run.json).toEqual({ novelty: 9 });
    expect(out.status === 'ok' && out.run.structuredOutputHonoured).toBe(true);
    expect(out.status === 'ok' && out.run.degradedReason).toBeNull();
  });

  it('does NOT re-run when structured output is absent but the text parses', async () => {
    // The endpoint ignored the field yet answered in JSON anyway. There is
    // nothing to recover, so spending a second call would be pure waste.
    const lane = resolvedLane('judge', { config: { structuredOutput: 'sdk' } });
    const query = makeQueryStub([
      [resultMessage({ result: '{"novelty": 4}', subtype: 'success' })],
    ]);

    const out = await runner(lane, query).run({
      laneId: 'judge',
      prompt: 'score it',
      outputSchema: SCHEMA as unknown as Record<string, unknown>,
    });

    expect(query.execute).toHaveBeenCalledTimes(1);
    expect(out.status === 'ok' && out.run.json).toEqual({ novelty: 4 });
  });

  it('treats a schema-honouring null as honoured, not as a missing field', async () => {
    // Presence, not truthiness. A provider that legitimately answered `null`
    // under the schema has not failed to honour it.
    const lane = resolvedLane('judge', { config: { structuredOutput: 'sdk' } });
    const query = makeQueryStub([
      [resultMessage({ structured_output: null, subtype: 'success' })],
    ]);

    const out = await runner(lane, query).run({
      laneId: 'judge',
      prompt: 'x',
      outputSchema: SCHEMA as unknown as Record<string, unknown>,
    });

    expect(query.execute).toHaveBeenCalledTimes(1);
    expect(out.status).toBe('ok');
    expect(out.status === 'ok' && out.run.structuredOutputHonoured).toBe(true);
  });
});

describe('extractJsonObject — the parser that must not be deleted', () => {
  it('recovers a fenced object wrapped in prose', () => {
    expect(extractJsonObject('blah\n```json\n{"a":1}\n```\nmore blah')).toEqual(
      { a: 1 },
    );
  });

  it('is not fooled by a brace inside a string value', () => {
    // A skill body routinely contains `}`. A naive depth counter closes early
    // and hands back a slice that does not parse.
    expect(extractJsonObject('{"body":"use ${x} and }"}')).toEqual({
      body: 'use ${x} and }',
    });
  });

  it('handles nested objects, which the judge s flat regex could not', () => {
    expect(extractJsonObject('x {"a":{"b":2}} y')).toEqual({ a: { b: 2 } });
  });

  it('skips a stray opening brace in prose and finds the real object', () => {
    // The synthesizer's scan-from-the-first-brace extractor returns null here.
    expect(extractJsonObject('use { carefully. Answer: {"a":1}')).toEqual({
      a: 1,
    });
  });

  it('returns null rather than throwing on garbage', () => {
    expect(extractJsonObject('no json at all')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
    expect(extractJsonObject('{ unbalanced')).toBeNull();
  });
});
