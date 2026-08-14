/**
 * P3-1, trigger half — `TriggerEvalService`.
 *
 * ## The stub embedder is the point, not a shortcut
 *
 * A real `IEmbedder` downloads a model, so a spec built on one would be slow,
 * network-dependent, and — worst — its numbers would drift with the model. Every
 * vector here is written by hand, so each case states the retrieval geometry it
 * is asserting about instead of hoping a transformer produces it. `EMBEDDINGS`
 * below is a plain text → vector table; anything absent embeds to a neutral
 * vector that is far from everything.
 *
 * ## What this file is really guarding
 *
 * 1. The score is DERIVED — F1 of precision and recall — and never written as a
 *    fourth independent number.
 * 2. The near-miss half is load-bearing. Remove it and the service refuses to
 *    score AT ALL rather than publishing a trivial 1.0.
 * 3. An unmeasured score is `null`, never `0`, and a measured `0` is never
 *    `null`.
 * 4. Exactly one model call happens per evaluation, and it is the prompt
 *    generation. The retrieval is local arithmetic — asserted both by call count
 *    and by a scan of the service's own source text.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IEmbedder } from '@ptah-extension/persistence-sqlite';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { LaneRunnerService } from '../lanes/lane-runner.service';
import type { SkillCandidateStore } from '../skill-candidate.store';
import type {
  CandidateId,
  SkillCandidateRow,
  SkillSynthesisSettings,
  TriggerEvalMeasurement,
} from '../types';
import {
  TriggerEvalService,
  TRIGGER_EVAL_ENABLED_KEY,
  TRIGGER_EVAL_MIN_SIMILARITY,
  TRIGGER_EVAL_SKIP_REASONS,
  TRIGGER_EVAL_UNMEASURED_REASONS,
  f1,
  measureRetrieval,
  type TriggerPromptOutcome,
  type TriggerPromptSet,
} from './trigger-eval.service';

// ── The hand-written embedding space ────────────────────────────────────────
//
// Three orthogonal axes. A vector's first component is "our topic", the second
// is "the rival topic", the third is "somewhere else entirely". Cosine
// similarity between two of these is then just the normalized dot product, which
// makes every expected number in this file readable off the table.

const TARGET_DESCRIPTION = 'Rotate a leaked API credential across every host';
const RIVAL_DESCRIPTION = 'Rotate a leaked API credential and redeploy';
const FAR_DESCRIPTION = 'Convert a spreadsheet into a bar chart';

const ON_TOPIC = ['rotate the key on staging', 'the token leaked, swap it out'];
const OFF_TOPIC = ['make me a pie chart', 'rename this variable everywhere'];
/** On the RIVAL's axis: near the target, but not the same request. */
const ADJACENT = ['redeploy after the key rotation'];

function vec(x: number, y: number, z: number): Float32Array {
  return Float32Array.from([x, y, z]);
}

const EMBEDDINGS: Record<string, Float32Array> = {
  [TARGET_DESCRIPTION]: vec(1, 0, 0),
  [RIVAL_DESCRIPTION]: vec(0.97, 0.24, 0),
  [FAR_DESCRIPTION]: vec(0, 0, 1),
  [ON_TOPIC[0]]: vec(1, 0, 0),
  [ON_TOPIC[1]]: vec(0.99, 0.14, 0),
  [OFF_TOPIC[0]]: vec(0, 0, 1),
  [OFF_TOPIC[1]]: vec(0, 0, 1),
  [ADJACENT[0]]: vec(0.6, 0.8, 0),
};

/** Neutral: equidistant from the three axes and below the similarity floor. */
const UNKNOWN = vec(0.2, 0.2, 0.2);

function makeEmbedder(): { embedder: IEmbedder; embed: jest.Mock } {
  const embed = jest.fn(
    async (texts: readonly string[]): Promise<Float32Array[]> =>
      texts.map((t) => EMBEDDINGS[t] ?? UNKNOWN),
  );
  return {
    embed,
    embedder: {
      dim: 3,
      modelId: 'spec-stub',
      embed,
      dispose: jest.fn(async () => undefined),
    } as unknown as IEmbedder,
  };
}

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeWorkspace(
  enabled: boolean | undefined = true,
): IWorkspaceProvider {
  return {
    getConfiguration: jest.fn(
      (_section: string, key: string, fallback?: unknown) =>
        key === TRIGGER_EVAL_ENABLED_KEY ? enabled : fallback,
    ),
  } as unknown as IWorkspaceProvider;
}

function activeRow(
  id: string,
  description: string,
  overrides: Partial<SkillCandidateRow> = {},
): SkillCandidateRow {
  return {
    id: id as CandidateId,
    name: id,
    description,
    status: 'promoted',
    embeddingRowid: null,
    ...overrides,
  } as unknown as SkillCandidateRow;
}

function makeStore(
  active: SkillCandidateRow[],
  opts: {
    storedEmbedding?: Float32Array | null;
    dedupHits?: Array<{ row: SkillCandidateRow; similarity: number }>;
  } = {},
): {
  store: SkillCandidateStore;
  recordTriggerEval: jest.Mock;
  searchActiveByEmbedding: jest.Mock;
} {
  const recordTriggerEval = jest.fn(
    (_id: CandidateId, m: TriggerEvalMeasurement) => m,
  );
  const searchActiveByEmbedding = jest.fn(() => opts.dedupHits ?? []);
  return {
    recordTriggerEval,
    searchActiveByEmbedding,
    store: {
      listByStatus: jest.fn(() => active),
      recordTriggerEval,
      getEmbedding: jest.fn(() => opts.storedEmbedding ?? null),
      searchActiveByEmbedding,
    } as unknown as SkillCandidateStore,
  };
}

function makeLane(prompts: TriggerPromptSet | null): {
  runner: LaneRunnerService;
  run: jest.Mock;
} {
  const run = jest.fn(async () =>
    prompts === null
      ? { status: 'unavailable' as const, reason: 'no lane here' }
      : {
          status: 'ok' as const,
          run: {
            json: {
              shouldTrigger: [...prompts.shouldTrigger],
              nearMiss: [...prompts.nearMiss],
            },
            text: '',
          },
        },
  );
  return { run, runner: { run } as unknown as LaneRunnerService };
}

const SETTINGS = {
  dedupClusterThreshold: 0.78,
} as unknown as SkillSynthesisSettings;

const TARGET = {
  id: 'cand-target' as CandidateId,
  description: TARGET_DESCRIPTION,
  displayName: 'Credential Rotation',
  embeddingRowid: null,
};

/** The same candidate, but with a stored transcript vector dedup can read. */
const EMBEDDED_TARGET = { ...TARGET, embeddingRowid: 42 };

function makeService(opts: {
  prompts: TriggerPromptSet | null;
  active?: SkillCandidateRow[];
  enabled?: boolean;
  embedder?: IEmbedder | null;
  storeOpts?: Parameters<typeof makeStore>[1];
}): {
  service: TriggerEvalService;
  run: jest.Mock;
  embed: jest.Mock;
  recordTriggerEval: jest.Mock;
  searchActiveByEmbedding: jest.Mock;
} {
  const lane = makeLane(opts.prompts);
  const embedder = makeEmbedder();
  const store = makeStore(opts.active ?? [], opts.storeOpts);
  const service = new TriggerEvalService(
    makeLogger(),
    makeWorkspace(opts.enabled ?? true),
    lane.runner,
    store.store,
    opts.embedder === undefined ? embedder.embedder : opts.embedder,
  );
  return {
    service,
    run: lane.run,
    embed: embedder.embed,
    recordTriggerEval: store.recordTriggerEval,
    searchActiveByEmbedding: store.searchActiveByEmbedding,
  };
}

/** The healthy set: two on-topic prompts, two off-topic near misses. */
const BALANCED: TriggerPromptSet = {
  shouldTrigger: [...ON_TOPIC],
  nearMiss: [...OFF_TOPIC],
};

// ── 1. The derivation ───────────────────────────────────────────────────────

describe('trigger_score is DERIVED from precision and recall (F1)', () => {
  /**
   * The derivation itself, pinned as an identity rather than as one case of it.
   * If someone re-derives the score as an arithmetic mean, every row below
   * except the two symmetric ones changes.
   */
  it.each([
    [1, 1, 1],
    [0.5, 1, 2 / 3],
    [1, 0.5, 2 / 3],
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, 0],
    [0.8, 0.4, 8 / 15],
  ])('f1(%s, %s) === %s', (precision, recall, expected) => {
    expect(f1(precision, recall)).toBeCloseTo(expected, 10);
  });

  it('is the harmonic mean, NOT the arithmetic mean', () => {
    // The case the choice exists for: a description that fires for everything.
    // The arithmetic mean would call this 0.75; F1 calls it 0.667.
    expect(f1(0.5, 1)).toBeCloseTo(2 / 3, 10);
    expect(f1(0.5, 1)).not.toBeCloseTo((0.5 + 1) / 2, 3);
  });

  it('never writes a score that disagrees with its own precision and recall', async () => {
    const h = makeService({ prompts: BALANCED });
    const outcome = await h.service.evaluate(TARGET, SETTINGS);

    expect(outcome.status).toBe('evaluated');
    if (outcome.status !== 'evaluated') throw new Error('unreachable');
    const { score, precision, recall } = outcome.report.measurement;
    expect(precision).not.toBeNull();
    expect(recall).not.toBeNull();
    expect(score).toBeCloseTo(f1(precision as number, recall as number), 10);
  });

  it('scores a clean description 1.0 across the board', async () => {
    const h = makeService({ prompts: BALANCED });
    const outcome = await h.service.evaluate(TARGET, SETTINGS);
    if (outcome.status !== 'evaluated') throw new Error('unreachable');

    expect(outcome.report.measurement).toEqual({
      precision: 1,
      recall: 1,
      score: 1,
    });
    expect(h.recordTriggerEval).toHaveBeenCalledTimes(1);
    expect(h.recordTriggerEval.mock.calls[0][1]).toEqual({
      precision: 1,
      recall: 1,
      score: 1,
    });
  });
});

// ── 2. The near-miss half is what makes precision mean anything ─────────────

describe('the near-miss prompts are load-bearing', () => {
  /**
   * THE MUTATION GUARD. Positives alone give precision 1.0 by construction: TP
   * is every prompt and FP cannot exist. A service that scored this set would
   * publish a perfect number that measured nothing, so it refuses instead.
   */
  it('refuses to score a set with no near-miss prompts', async () => {
    const h = makeService({
      prompts: { shouldTrigger: [...ON_TOPIC], nearMiss: [] },
    });
    const outcome = await h.service.evaluate(TARGET, SETTINGS);
    if (outcome.status !== 'evaluated') throw new Error('unreachable');

    expect(outcome.report.unmeasuredReason).toBe(
      TRIGGER_EVAL_UNMEASURED_REASONS.noNegatives,
    );
    expect(outcome.report.measurement).toEqual({
      precision: null,
      recall: null,
      score: null,
    });
    // The specific failure this guards: precision must NOT come back 1.
    expect(outcome.report.measurement.precision).not.toBe(1);
  });

  it('refuses to score a set with no should-trigger prompts', async () => {
    const h = makeService({
      prompts: { shouldTrigger: [], nearMiss: [...OFF_TOPIC] },
    });
    const outcome = await h.service.evaluate(TARGET, SETTINGS);
    if (outcome.status !== 'evaluated') throw new Error('unreachable');

    expect(outcome.report.unmeasuredReason).toBe(
      TRIGGER_EVAL_UNMEASURED_REASONS.noPositives,
    );
    expect(outcome.report.measurement.recall).toBeNull();
  });

  it('a near miss that retrieves the skill costs precision, and only precision', async () => {
    // `ADJACENT` sits on the rival axis but still above the similarity floor
    // for the target, so it fires when it should not.
    const h = makeService({
      prompts: { shouldTrigger: [...ON_TOPIC], nearMiss: [...ADJACENT] },
    });
    const outcome = await h.service.evaluate(TARGET, SETTINGS);
    if (outcome.status !== 'evaluated') throw new Error('unreachable');

    expect(cosineOf(ADJACENT[0])).toBeGreaterThanOrEqual(
      TRIGGER_EVAL_MIN_SIMILARITY,
    );
    expect(outcome.report.measurement.recall).toBe(1);
    expect(outcome.report.measurement.precision).toBeCloseTo(2 / 3, 10);
    expect(outcome.report.measurement.score).toBeCloseTo(f1(2 / 3, 1), 10);
    // And it is strictly worse than the same recall with clean negatives.
    expect(outcome.report.measurement.score).toBeLessThan(1);
  });

  it('is what separates a precise description from an indiscriminate one', async () => {
    const precise = await makeService({ prompts: BALANCED }).service.evaluate(
      TARGET,
      SETTINGS,
    );
    const sloppy = await makeService({
      prompts: { shouldTrigger: [...ON_TOPIC], nearMiss: [...ADJACENT] },
    }).service.evaluate(TARGET, SETTINGS);
    if (precise.status !== 'evaluated' || sloppy.status !== 'evaluated') {
      throw new Error('unreachable');
    }
    expect(precise.report.measurement.score).toBeGreaterThan(
      sloppy.report.measurement.score as number,
    );
  });
});

// ── 3. null is not 0 ────────────────────────────────────────────────────────

describe('an unmeasured score is null, never 0', () => {
  it('writes three nulls — not three zeros — when the set is unscoreable', async () => {
    const h = makeService({
      prompts: { shouldTrigger: [...ON_TOPIC], nearMiss: [] },
    });
    await h.service.evaluate(TARGET, SETTINGS);

    const written = h.recordTriggerEval.mock.calls[0][1];
    expect(written).toEqual({ precision: null, recall: null, score: null });
    expect(written.score).not.toBe(0);
    expect(written.precision).not.toBe(0);
    expect(written.recall).not.toBe(0);
    expect(Object.is(written.score, null)).toBe(true);
  });

  it('writes a MEASURED zero as 0 — not as null — when nothing retrieved', async () => {
    // Both positives are off-axis for this description: it retrieves nothing it
    // should have. That is a result, and it is evidence against the candidate.
    const h = makeService({
      prompts: { shouldTrigger: [...OFF_TOPIC], nearMiss: [...OFF_TOPIC] },
    });
    const outcome = await h.service.evaluate(TARGET, SETTINGS);
    if (outcome.status !== 'evaluated') throw new Error('unreachable');

    expect(outcome.report.unmeasuredReason).toBeNull();
    expect(outcome.report.measurement).toEqual({
      precision: 0,
      recall: 0,
      score: 0,
    });
    expect(outcome.report.measurement.score).not.toBeNull();
  });

  it('measureRetrieval keeps the two apart at the unit level', () => {
    const noRetrieval = measureRetrieval(
      [
        outcomeOf('a', 'should-trigger', false),
        outcomeOf('b', 'near-miss', false),
      ],
      { shouldTrigger: ['a'], nearMiss: ['b'] },
    );
    expect(noRetrieval.measurement).toEqual({
      precision: 0,
      recall: 0,
      score: 0,
    });

    const noNegatives = measureRetrieval(
      [outcomeOf('a', 'should-trigger', true)],
      { shouldTrigger: ['a'], nearMiss: [] },
    );
    expect(noNegatives.measurement).toEqual({
      precision: null,
      recall: null,
      score: null,
    });
  });
});

// ── 4. Nothing on the retrieval path calls a model ──────────────────────────

describe('the retrieval is measured, not judged', () => {
  it('makes exactly ONE lane call per evaluation, and it is the prompt generation', async () => {
    const h = makeService({
      prompts: BALANCED,
      active: [activeRow('rival', RIVAL_DESCRIPTION)],
    });
    const outcome = await h.service.evaluate(TARGET, SETTINGS);

    expect(outcome.status).toBe('evaluated');
    expect(h.run).toHaveBeenCalledTimes(1);
    // Cheapest lane, and a schema so the endpoint can answer structurally.
    expect(h.run.mock.calls[0][0].laneId).toBe('judge');
    expect(h.run.mock.calls[0][0].outputSchema).toBeDefined();
  });

  it('embeds every description and prompt in ONE local batch', async () => {
    const h = makeService({
      prompts: BALANCED,
      active: [
        activeRow('rival', RIVAL_DESCRIPTION),
        activeRow('far', FAR_DESCRIPTION),
      ],
    });
    await h.service.evaluate(TARGET, SETTINGS);

    expect(h.embed).toHaveBeenCalledTimes(1);
    // target + 2 active + 2 positives + 2 negatives
    expect(h.embed.mock.calls[0][0]).toHaveLength(7);
    expect(h.embed.mock.calls[0][0][0]).toBe(TARGET_DESCRIPTION);
  });

  /**
   * The mechanical half. A call-count assertion only covers the paths this
   * spec walks; a second `laneRunner.run(` added to a branch nobody exercises
   * would slip past it. There is exactly one model call site in the file, and
   * it is in `generatePrompts`.
   */
  it('has exactly one lane call site in its source text', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'trigger-eval.service.ts'),
      'utf8',
    );
    const callSites = source.match(/this\.laneRunner\.run\(/g) ?? [];
    expect(callSites).toHaveLength(1);
  });
});

// ── 5. Description collisions cosine dedup misses ───────────────────────────

describe('description collisions the transcript-space dedup misses', () => {
  it('reports an active rival whose DESCRIPTION competes for our prompts', async () => {
    const h = makeService({
      prompts: BALANCED,
      active: [
        activeRow('rival', RIVAL_DESCRIPTION),
        activeRow('far', FAR_DESCRIPTION),
      ],
      // No stored vector ⇒ dedup sees nothing at all ⇒ every collision is missed.
      storeOpts: { storedEmbedding: null },
    });
    const outcome = await h.service.evaluate(TARGET, SETTINGS);
    if (outcome.status !== 'evaluated') throw new Error('unreachable');

    expect(outcome.report.collisions).toHaveLength(1);
    expect(outcome.report.collisions[0].rivalId).toBe('rival');
    expect(outcome.report.collisions[0].dedupSimilarity).toBeNull();
    // The far-off description never competes, so it is never a finding.
    expect(outcome.report.collisions.some((c) => c.rivalId === 'far')).toBe(
      false,
    );
  });

  it('does NOT re-report a pair dedup already merges', async () => {
    const rival = activeRow('rival', RIVAL_DESCRIPTION);
    const h = makeService({
      prompts: BALANCED,
      active: [rival],
      storeOpts: {
        storedEmbedding: vec(1, 0, 0),
        // Above `dedupClusterThreshold` (0.78): dedup can see this pair, so it
        // is dedup's finding and not ours.
        dedupHits: [{ row: rival, similarity: 0.95 }],
      },
    });
    const outcome = await h.service.evaluate(EMBEDDED_TARGET, SETTINGS);
    if (outcome.status !== 'evaluated') throw new Error('unreachable');

    expect(h.searchActiveByEmbedding).toHaveBeenCalledTimes(1);
    expect(outcome.report.collisions).toEqual([]);
  });

  it('reports a pair whose transcripts diverge but whose descriptions do not', async () => {
    const rival = activeRow('rival', RIVAL_DESCRIPTION);
    const h = makeService({
      prompts: BALANCED,
      active: [rival],
      storeOpts: {
        storedEmbedding: vec(1, 0, 0),
        // Below the dedup threshold: two genuinely different sessions that
        // ended up describing themselves the same way. This is the finding.
        dedupHits: [{ row: rival, similarity: 0.31 }],
      },
    });
    const outcome = await h.service.evaluate(EMBEDDED_TARGET, SETTINGS);
    if (outcome.status !== 'evaluated') throw new Error('unreachable');

    expect(outcome.report.collisions).toHaveLength(1);
    expect(outcome.report.collisions[0].dedupSimilarity).toBeCloseTo(0.31, 10);
    expect(outcome.report.collisions[0].rivalSimilarity).toBeGreaterThan(
      TRIGGER_EVAL_MIN_SIMILARITY,
    );
  });

  it('never collides a promoted candidate with itself', async () => {
    const self = activeRow('cand-target', TARGET_DESCRIPTION);
    const h = makeService({ prompts: BALANCED, active: [self] });
    const outcome = await h.service.evaluate(TARGET, SETTINGS);
    if (outcome.status !== 'evaluated') throw new Error('unreachable');

    expect(outcome.report.activeCompared).toBe(0);
    expect(outcome.report.collisions).toEqual([]);
  });
});

// ── 6. The gate, and the write rule ─────────────────────────────────────────

describe('the gate and the write rule', () => {
  it('skips and writes NOTHING when skillSynthesis.triggerEval.enabled is false', async () => {
    const h = makeService({ prompts: BALANCED, enabled: false });
    const outcome = await h.service.evaluate(TARGET, SETTINGS);

    expect(outcome).toEqual({
      status: 'skipped',
      reason: TRIGGER_EVAL_SKIP_REASONS.disabled,
    });
    expect(h.run).not.toHaveBeenCalled();
    expect(h.embed).not.toHaveBeenCalled();
    expect(h.recordTriggerEval).not.toHaveBeenCalled();
  });

  it('skips and writes NOTHING when this host has no embedder', async () => {
    const h = makeService({ prompts: BALANCED, embedder: null });
    const outcome = await h.service.evaluate(TARGET, SETTINGS);

    expect(outcome).toEqual({
      status: 'skipped',
      reason: TRIGGER_EVAL_SKIP_REASONS.noEmbedder,
    });
    expect(h.run).not.toHaveBeenCalled();
    expect(h.recordTriggerEval).not.toHaveBeenCalled();
  });

  it('skips and writes NOTHING when no lane can generate the prompts', async () => {
    const h = makeService({ prompts: null });
    const outcome = await h.service.evaluate(TARGET, SETTINGS);

    expect(outcome).toEqual({
      status: 'skipped',
      reason: TRIGGER_EVAL_SKIP_REASONS.noPrompts,
    });
    expect(h.embed).not.toHaveBeenCalled();
    // A host that cannot run the gate must not clear a previous measurement.
    expect(h.recordTriggerEval).not.toHaveBeenCalled();
  });

  it('skips a candidate with no description at all', async () => {
    const h = makeService({ prompts: BALANCED });
    const outcome = await h.service.evaluate(
      { ...TARGET, description: '   ' },
      SETTINGS,
    );

    expect(outcome).toEqual({
      status: 'skipped',
      reason: TRIGGER_EVAL_SKIP_REASONS.noDescription,
    });
    expect(h.run).not.toHaveBeenCalled();
  });

  it('de-duplicates and trims the prompts the generation pass returned', async () => {
    const h = makeService({
      prompts: {
        shouldTrigger: [ON_TOPIC[0], `  ${ON_TOPIC[0].toUpperCase()}  `, '  '],
        nearMiss: [OFF_TOPIC[0], OFF_TOPIC[0]],
      },
    });
    const outcome = await h.service.evaluate(TARGET, SETTINGS);
    if (outcome.status !== 'evaluated') throw new Error('unreachable');

    expect(outcome.report.prompts.shouldTrigger).toEqual([ON_TOPIC[0]]);
    expect(outcome.report.prompts.nearMiss).toEqual([OFF_TOPIC[0]]);
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────

function outcomeOf(
  prompt: string,
  kind: TriggerPromptOutcome['kind'],
  triggered: boolean,
): TriggerPromptOutcome {
  return { prompt, kind, targetSimilarity: 0, targetRank: 0, triggered };
}

/** Cosine of the target description against a prompt, straight off the table. */
function cosineOf(prompt: string): number {
  const a = EMBEDDINGS[TARGET_DESCRIPTION];
  const b = EMBEDDINGS[prompt] ?? UNKNOWN;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
