import 'reflect-metadata';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { MergePair } from '../../ground-truth/label-schemas';
import { curationDetailsSchema } from '../../memory-skills-suite-kinds';
import type { RunnerHost } from '../../runner/host-completion-reader';
import { toScorecardSuite } from '../../runner/run-scorecard';
import { readSuiteResult } from '../../runner/suite-result';
import {
  createDedupSuites,
  DEDUP_RERANK_SUITE_ID,
  DEDUP_SUITE_ID,
  labelledDraft,
  RERANK_NA_NO_PRE_RERANK,
} from './dedup.suite';
import {
  commitDrafts,
  ModelCallLog,
  stableCandidates,
} from './merge-update-pass';
import type { RerankPort } from './merge-update-ports';
import {
  FakeMemory,
  replayCurator,
  suiteContext,
  SyntheticCassette,
} from './merge-update.test-support';

const LABELLED = {
  source: 'spec',
  sourceCommit: 'abcdef1',
  labeller: 'spec',
  labelledAt: '2026-10-07T00:00:00.000Z',
};

/**
 * 40 should-merge pairs (0-19 subjects equal after case folding, 20-39
 * different) and 40 should-not-merge pairs with byte-equal subjects. Pairs
 * 0-4 of the should-not-merge set share four words with every should-merge
 * query (rerank distractors).
 */
function pairSet(shouldMerge = 40, shouldNotMerge = 40): MergePair[] {
  const pairs: MergePair[] = [];
  for (let i = 0; i < shouldMerge; i += 1) {
    pairs.push({
      ...LABELLED,
      id: `M-${i}`,
      kind: 'should-merge',
      factIds: [`F-${i}`, `F-${i}`],
      left: {
        session: `m${i}a`,
        subject: `Topic-${i}`,
        statement: `fact marker${i} alpha`,
      },
      right: {
        session: `m${i}b`,
        subject: i < 20 ? `topic-${i}` : `other-${i}`,
        statement: `marker${i} beta gamma delta epsilon`,
      },
    });
  }
  for (let j = 0; j < shouldNotMerge; j += 1) {
    pairs.push({
      ...LABELLED,
      id: `N-${j}`,
      kind: 'should-not-merge',
      factIds: [`G-${j}a`, `G-${j}b`],
      left: {
        session: `n${j}a`,
        subject: `shared-${j}`,
        statement:
          j < 5
            ? `beta gamma delta epsilon zeta${j}`
            : `unrelated${j} words${j}`,
      },
      right: {
        session: `n${j}b`,
        subject: `shared-${j}`,
        statement: `different${j} claim${j}`,
      },
    });
  }
  return pairs;
}

/** Resolve answers: merge same-subject should-merge pairs and N-0..N-3. */
function cassetteFor(pairs: readonly MergePair[]): SyntheticCassette {
  const cassette = new SyntheticCassette();
  for (const pair of pairs) {
    const sameSubject =
      pair.left.subject.toLowerCase() === pair.right.subject.toLowerCase();
    if (!sameSubject) continue;
    const left = labelledDraft(pair.left);
    const right = labelledDraft(pair.right);
    const { related } = stableCandidates([
      { id: 'left', subject: left.subject, content: left.content },
    ]);
    const merge =
      pair.kind === 'should-merge' ||
      ['N-0', 'N-1', 'N-2', 'N-3'].includes(pair.id);
    cassette.resolve([right], related, [
      { ...right, mergeTargetId: merge ? related[0].id : null },
    ]);
  }
  return cassette;
}

function rateMetricsExact(metrics: Record<string, number | null>): void {
  for (const name of Object.keys(metrics)) {
    const num = metrics[`${name}.num`];
    const den = metrics[`${name}.den`];
    if (num === undefined || den === undefined) continue;
    expect(metrics[name]).toBe(
      den === 0 || den === null ? null : (num as number) / den,
    );
  }
}

describe('mem.dedup and mem.dedup.rerank', () => {
  let dir: string;
  let home: string;
  let tick: number;
  const now = (): number => (tick += 5);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'b18-dedup-'));
    home = join(dir, 'home');
    tick = 0;
    mkdirSync(home, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function setup(
    pairs: readonly MergePair[],
    options: {
      cassette?: SyntheticCassette;
      reranker?: RerankPort | null;
      idPrefix?: string;
      runDir?: string;
    } = {},
  ) {
    writeFileSync(
      join(home, 'merge-pairs.jsonl'),
      pairs.map((p) => `${JSON.stringify(p)}\n`).join(''),
    );
    const cassettePath = join(dir, `curator-${options.idPrefix ?? 'a'}.jsonl`);
    (options.cassette ?? new SyntheticCassette()).write(cassettePath);
    const curator = replayCurator(cassettePath);
    const fake = new FakeMemory({
      curator,
      reranker: options.reranker ?? null,
      idPrefix: options.idPrefix,
    });
    const runDir = options.runDir ?? join(dir, 'run');
    const context = suiteContext({
      home,
      runDir,
      options: {
        mergePairs: 'merge-pairs.jsonl',
        cassetteVersion: 'synthetic-v1',
      },
      curator,
      laneCassette: join(dir, 'lane.jsonl'),
    });
    const [dedup, rerank] = createDedupSuites({
      resolvePorts: () => fake,
      now,
    });
    return { fake, context, dedup, rerank, runDir };
  }

  it('scores the product against the three pure policies with exact rates', async () => {
    const pairs = pairSet();
    const { context, dedup, runDir } = setup(pairs, {
      cassette: cassetteFor(pairs),
    });
    await dedup.run(context);

    const { result, cases } = readSuiteResult(runDir, DEDUP_SUITE_ID);
    expect(curationDetailsSchema.parse(result.details)).toEqual({
      operation: 'dedup',
      pairs: { tp: 20, fp: 4, fn: 20, tn: 36 },
      mergePrecision: 20 / 24,
      mergeRecall: 20 / 40,
      duplicateClusterRate: 20 / 40,
      singletonSubjectShare: 64 / 100,
      callsPerMerge: 60 / 24,
    });
    expect(result.metrics['mergeF1']).toBe(40 / 64);
    expect(result.metrics['candidateRecall']).toBe(20 / 40);
    rateMetricsExact(result.metrics);

    const baseline = (id: string) =>
      result.baselines.find((b) => b.id === id)?.metrics ?? {};
    expect(baseline('byte-equal-subject')['mergeF1']).toBe(0);
    expect(baseline('never-merge')['mergeRecall']).toBe(0);
    expect(baseline('tier1-only')['mergeF1']).toBe(40 / 100);
    for (const b of result.baselines) rateMetricsExact(b.metrics);
    expect(result.deltas['byte-equal-subject']['mergeF1']).toBe(40 / 64);

    expect(result.verdict).toBe('pass');
    expect(result.modelCalls).toBe(60);
    expect(result.cost.calls).toBe(60);
    expect(result.cassetteVersion).toBe('synthetic-v1');
    expect(result.groundTruth).toEqual({
      id: 'gt-merge',
      version: 'v1',
      method: 'labelled',
    });

    expect(cases).toHaveLength(80);
    const byId = new Map(cases.map((c) => [c.caseId, c]));
    expect(byId.get('M-0')).toMatchObject({
      expected: 'merged',
      observed: 'merged; target-in-candidates=yes',
      outcome: 'pass',
      baselineOutcomes: {
        'byte-equal-subject': 'fail',
        'never-merge': 'fail',
        'tier1-only': 'pass',
      },
    });
    // Different subjects: tier 2 never runs, so the resolver never sees the row.
    expect(byId.get('M-25')).toMatchObject({
      observed: 'separate; target-in-candidates=no',
      outcome: 'fail',
    });
    expect(byId.get('N-0')).toMatchObject({
      expected: 'separate',
      outcome: 'fail',
    });
    expect(byId.get('N-9')).toMatchObject({ outcome: 'pass' });
  });

  it('keeps the projection free of row ids and sets cost.source from the run', async () => {
    const pairs = pairSet();
    const host: RunnerHost = {
      pid: 1,
      port: 2,
      guardMode: 'hash',
      exitedEarly: () => undefined,
      stop: async () => {
        throw new Error('not used');
      },
    };
    const hashes: string[] = [];
    for (const prefix of ['a', 'zz']) {
      const run = setup(pairs, {
        cassette: cassetteFor(pairs),
        idPrefix: prefix,
        runDir: join(dir, `run-${prefix}`),
      });
      await run.dedup.run(run.context);
      const scored = readSuiteResult(run.runDir, DEDUP_SUITE_ID);
      const suite = toScorecardSuite(
        { placement: 'host', ...scored },
        'replay',
        { runId: `r-${prefix}`, startedAt: '2026-10-07T00:00:00.000Z', host },
      );
      expect(suite.cost.source).toBe('cassette');
      hashes.push(suite.projectionSha256 ?? '');
    }
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes[1]).toBe(hashes[0]);
  });

  it('records a cassette miss per case and goes na, never pass', async () => {
    const pairs = pairSet();
    const { context, dedup, runDir } = setup(pairs);
    await dedup.run(context);
    const { result, cases } = readSuiteResult(runDir, DEDUP_SUITE_ID);
    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe('cassette-miss');
    const missed = cases.filter((c) => c.observed === 'cassette-miss');
    // 20 same-subject should-merge + 40 should-not-merge pairs reach resolve.
    expect(missed).toHaveLength(60);
    expect(missed[0].cassetteKey).toMatch(/^[0-9a-f]{64}$/);
    expect(missed[0].error).toMatch(/^cassette-miss: resolve /);
    expect(result.cost.error_rate).toBe(1);
    // The 20 different-subject pairs never call the model and still complete.
    expect(result.details).toMatchObject({ pairs: { tp: 0, fn: 20 } });
  });

  it('is na below the design minimum of 40 + 40 pairs', async () => {
    const pairs = pairSet(4, 4);
    const { context, dedup, runDir } = setup(pairs, {
      cassette: cassetteFor(pairs),
    });
    await dedup.run(context);
    const { result } = readSuiteResult(runDir, DEDUP_SUITE_ID);
    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe('ground-truth-below-minimum');
  });

  it.each(['/abs/pairs.jsonl', '../outside.jsonl'])(
    'refuses a ground-truth path outside the isolated home (%s)',
    async (path) => {
      const { context, dedup } = setup(pairSet(1, 1));
      await expect(
        dedup.run({ ...context, options: { mergePairs: path } }),
      ).rejects.toThrow(/home-relative|leaves the isolated home/);
    },
  );

  it('refuses unknown options', async () => {
    const { context, dedup } = setup(pairSet(1, 1));
    await expect(
      dedup.run({ ...context, options: { mergePairs: 'x', extra: 1 } }),
    ).rejects.toThrow();
  });

  /** Score 1 on every candidate: the inert reranker forensics M3 reports. */
  const inert: RerankPort = {
    rerank: async (_query, candidates, topK) =>
      candidates.map((c) => ({ id: c.id, score: 1 })).slice(0, topK),
  };
  /** Scores the candidate holding the query's marker token first. */
  const discriminating: RerankPort = {
    rerank: async (query, candidates, topK) => {
      const marker = query.split(/\s+/u).find((t) => /^marker\d+$/u.test(t));
      return candidates
        .map((c) => ({
          id: c.id,
          score:
            marker !== undefined && c.text.split(/\s+/u).includes(marker)
              ? 1
              : 0,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    },
  };

  it('reports an inert reranker as zero variance and stays na without a pre-rerank baseline', async () => {
    const { context, rerank, runDir } = setup(pairSet(), { reranker: inert });
    await rerank.run(context);
    const { result, cases } = readSuiteResult(runDir, DEDUP_RERANK_SUITE_ID);
    expect(curationDetailsSchema.parse(result.details)).toEqual({
      operation: 'rerank',
      lists: 40,
      ndcgAt5: 0,
      ndcgAt5NoRerank: null,
      zeroVarianceLists: 40,
    });
    expect(result.metrics['zeroVarianceShare']).toBe(1);
    rateMetricsExact(result.metrics);
    // No product seam yields the pre-rerank order, so no verdict is claimed.
    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe(RERANK_NA_NO_PRE_RERANK);
    expect(result.baselines).toEqual([
      {
        id: 'no-rerank',
        label: expect.stringContaining('unavailable'),
        metrics: { ndcgAt5: null },
      },
    ]);
    expect(result.deltas).toEqual({ 'no-rerank': { ndcgAt5: null } });
    expect(result.modelCalls).toBe(0);
    expect(cases[0].observed).toBe('rank=absent; variance=zero');
    expect(cases[0].baselineOutcomes).toBeUndefined();
  });

  it("reports a working reranker's ranks and variance, still na", async () => {
    const { context, rerank, runDir } = setup(pairSet(), {
      reranker: discriminating,
    });
    await rerank.run(context);
    const { result, cases } = readSuiteResult(runDir, DEDUP_RERANK_SUITE_ID);
    expect(result.details).toMatchObject({
      lists: 40,
      ndcgAt5: 1,
      ndcgAt5NoRerank: null,
      zeroVarianceLists: 0,
    });
    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe(RERANK_NA_NO_PRE_RERANK);
    expect(cases[0]).toMatchObject({
      observed: 'rank=1; variance=nonzero',
      outcome: 'pass',
    });
  });

  it('is na: no-reranker when the embedder has no reranker', async () => {
    const { context, rerank, runDir } = setup(pairSet(), { reranker: null });
    await rerank.run(context);
    const { result } = readSuiteResult(runDir, DEDUP_RERANK_SUITE_ID);
    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe('no-reranker');
  });

  it('commits exactly what the resolver returned, as the product does', async () => {
    const pair = pairSet(1, 0)[0];
    const left = labelledDraft(pair.left);
    const right = labelledDraft({ ...pair.right, subject: 'Topic-0' });
    const { related } = stableCandidates([
      { id: 'x', subject: left.subject, content: left.content },
    ]);
    // The resolver rewrites the right draft: new subject, content, salience
    // and type, and inserts it as new instead of merging.
    const rewritten = {
      ...right,
      subject: 'rewritten-subject',
      content: 'rewritten content',
      salienceHint: 0.9,
      type: 'decision' as const,
      concepts: ['c1'],
      mergeTargetId: null,
    };
    // And a second pass merges with rewritten content.
    const merged = {
      ...right,
      content: 'merged content',
      mergeTargetId: related[0].id,
    };
    const cassettePath = join(dir, 'commit.jsonl');
    new SyntheticCassette()
      .resolve([right], related, [rewritten])
      .write(cassettePath);
    const curator = replayCurator(cassettePath);
    const fake = new FakeMemory({ curator });
    const log = new ModelCallLog(now);
    await commitDrafts(
      fake,
      { drafts: [left], workspaceRoot: '/w', sessionId: 's' },
      log,
    );
    const pass = await commitDrafts(
      fake,
      { drafts: [right], workspaceRoot: '/w', sessionId: 's' },
      log,
    );
    const { mergeTargetId: _dropped, ...persisted } = rewritten;
    expect(pass.decisions).toEqual([
      { draft: persisted, outcome: 'created', rowId: expect.any(String) },
    ]);
    expect(fake.inserted[1]).toEqual(persisted);

    const mergePath = join(dir, 'merge.jsonl');
    new SyntheticCassette()
      .resolve([right], related, [merged])
      .write(mergePath);
    const mergeFake = new FakeMemory({ curator: replayCurator(mergePath) });
    await commitDrafts(
      mergeFake,
      { drafts: [left], workspaceRoot: '/w', sessionId: 's' },
      log,
    );
    const mergePass = await commitDrafts(
      mergeFake,
      { drafts: [right], workspaceRoot: '/w', sessionId: 's' },
      log,
    );
    expect(mergePass.decisions[0].outcome).toBe('merged');
    expect(mergeFake.appended).toEqual([
      { id: mergeFake.rows[0].id, text: 'merged content' },
    ]);
  });

  it('counts a failed write as skipped and keeps committing', async () => {
    const cassettePath = join(dir, 'none.jsonl');
    new SyntheticCassette().write(cassettePath);
    const fake = new FakeMemory({ curator: replayCurator(cassettePath) });
    let calls = 0;
    const original = fake.insertRow.bind(fake);
    fake.insertRow = async (row) => {
      calls += 1;
      if (calls === 1) throw new Error('disk full');
      return original(row);
    };
    const drafts = [
      {
        kind: 'fact' as const,
        subject: 'a',
        content: 'one',
        salienceHint: 0.5,
      },
      {
        kind: 'fact' as const,
        subject: 'b',
        content: 'two',
        salienceHint: 0.5,
      },
    ];
    const pass = await commitDrafts(
      fake,
      { drafts, workspaceRoot: '/w', sessionId: 's' },
      new ModelCallLog(now),
    );
    expect(pass.decisions.map((d) => d.outcome)).toEqual([
      'skipped',
      'created',
    ]);
    expect(pass.decisions[0].rowId).toBeNull();
  });
});
