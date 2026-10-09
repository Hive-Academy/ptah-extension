import 'reflect-metadata';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtractedMemoryDraft } from '@ptah-extension/memory-contracts';

import type {
  TemporalCase,
  UpdateCase,
} from '../../ground-truth/label-schemas';
import { curationDetailsSchema } from '../../memory-skills-suite-kinds';
import { readSuiteResult } from '../../runner/suite-result';
import { MIRRORED_COMMIT_NA, stableCandidates } from './merge-update-pass';
import {
  FakeMemory,
  replayCurator,
  suiteContext,
  SyntheticCassette,
} from './merge-update.test-support';
import {
  createUpdateSuites,
  SEED_SUITE_ID,
  TEMPORAL_SUITE_ID,
  temporalSession,
  transcriptOf,
  UPDATE_SUITE_ID,
  updateSessions,
} from './update.suite';

const LABELLED = {
  source: 'spec',
  sourceCommit: 'abcdef1',
  labeller: 'spec',
  labelledAt: '2026-10-07T00:00:00.000Z',
};

function updateCases(count = 25): UpdateCase[] {
  return Array.from({ length: count }, (_, i) => ({
    ...LABELLED,
    id: `U-${i}`,
    slot: `slot-${i}`,
    v1: { value: `alpha-${i}`, at: '2026-09-01' },
    v2: { value: `beta-${i}`, at: '2026-09-10' },
    bait: `gamma-${i}`,
    question: `What is slot-${i} now?`,
    expectedAnswer: `beta-${i}`,
  }));
}

function draft(subject: string, content: string): ExtractedMemoryDraft {
  return { kind: 'fact', subject, content, salienceHint: 0.6 };
}

/**
 * Cases 0-14: v1 and v2 extracted, v2 merged into the v1 row (stale);
 * 15-19: the bait is extracted from the v1 session (hallucination);
 * 20-24: nothing from v1, v2 alone (correct).
 */
function updateCassette(cases: readonly UpdateCase[]): SyntheticCassette {
  const cassette = new SyntheticCassette();
  cases.forEach((c, i) => {
    const [s1, s2] = updateSessions(c);
    const v1Draft = draft(c.slot, `${c.slot} is ${c.v1.value}`);
    const baitDraft = draft(c.slot, `${c.slot} is ${c.bait}`);
    const v2Draft = draft(c.slot, `${c.slot} is ${c.v2.value}`);
    const first = i < 15 ? [v1Draft] : i < 20 ? [baitDraft] : [];
    cassette.extract(transcriptOf(s1), { status: 'extracted', drafts: first });
    cassette.extract(transcriptOf(s2), {
      status: 'extracted',
      drafts: [v2Draft],
    });
    if (first.length > 0) {
      const { related } = stableCandidates([
        { id: 'r', subject: first[0].subject, content: first[0].content },
      ]);
      cassette.resolve([v2Draft], related, [
        { ...v2Draft, mergeTargetId: i < 15 ? related[0].id : null },
      ]);
    }
  });
  return cassette;
}

function temporalCases(count = 15): TemporalCase[] {
  return Array.from({ length: count }, (_, i) => {
    const date = `2026-08-${String(i + 1).padStart(2, '0')}`;
    return {
      ...LABELLED,
      id: `T-${i}`,
      date,
      question: `What was decided on ${date} about topic-${i}`,
      expectedAnswer: `topic-${i} answer-${i}`,
    };
  });
}

/** Cases 0-9 extract their answer; 10-14 extract nothing. */
function temporalCassette(cases: readonly TemporalCase[]): SyntheticCassette {
  const cassette = new SyntheticCassette();
  cases.forEach((c, i) => {
    cassette.extract(transcriptOf(temporalSession(c)), {
      status: 'extracted',
      drafts: i < 10 ? [draft(`t-${i}`, c.expectedAnswer)] : [],
    });
  });
  return cassette;
}

function rateMetricsExact(metrics: Record<string, number | null>): void {
  for (const name of Object.keys(metrics)) {
    const num = metrics[`${name}.num`];
    const den = metrics[`${name}.den`];
    if (num === undefined || den === undefined) continue;
    expect(metrics[name]).toBe(
      den === 0 ? null : (num as number) / (den as number),
    );
  }
}

describe('mem.update, mem.temporal and mem.update.seed', () => {
  let dir: string;
  let home: string;
  let tick: number;
  const now = (): number => (tick += 3);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'b18-update-'));
    home = join(dir, 'home');
    mkdirSync(home, { recursive: true });
    tick = 0;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function setup(
    file: string,
    records: readonly object[],
    options: Record<string, unknown>,
    cassette: SyntheticCassette = new SyntheticCassette(),
    seedMode: 'replace' | 'append' = 'replace',
  ) {
    writeFileSync(
      join(home, file),
      records.map((r) => `${JSON.stringify(r)}\n`).join(''),
    );
    const cassettePath = join(dir, 'curator.jsonl');
    cassette.write(cassettePath);
    const curator = replayCurator(cassettePath);
    const fake = new FakeMemory({ curator, seedMode });
    const runDir = join(dir, 'run');
    const context = suiteContext({
      home,
      runDir,
      options,
      curator,
      laneCassette: join(dir, 'lane.jsonl'),
    });
    const [update, temporal, seed] = createUpdateSuites({
      resolvePorts: () => fake,
      now,
    });
    return { fake, context, update, temporal, seed, runDir };
  }

  it('plants the bait once, as a rejected hypothesis, and keeps dates out of the transcript', () => {
    const [s1, s2] = updateSessions(updateCases(1)[0]);
    const t1 = transcriptOf(s1);
    expect(t1.split('gamma-0')).toHaveLength(2);
    expect(t1).toContain('USER: Decision for slot-0: alpha-0');
    expect(transcriptOf(s2)).toContain('beta-0');
    expect(`${t1}${transcriptOf(s2)}`).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect([s1.date, s2.date]).toEqual(['2026-09-01', '2026-09-10']);
  });

  it("classifies every case and records today's stale result against the baselines", async () => {
    const cases = updateCases();
    const { context, update, runDir } = setup(
      'updates.jsonl',
      cases,
      { updateCases: 'updates.jsonl', cassetteVersion: 'synthetic-v1' },
      updateCassette(cases),
    );
    await update.run(context);
    const { result, cases: records } = readSuiteResult(runDir, UPDATE_SUITE_ID);

    expect(curationDetailsSchema.parse(result.details)).toEqual({
      operation: 'update',
      cases: 25,
      correct: 5 / 25,
      stale: 15 / 25,
      omission: 0,
      hallucination: 5 / 25,
      readPath: 'searchRich',
    });
    expect(result.metrics['buildBlock.correct']).toBe(5 / 25);
    rateMetricsExact(result.metrics);
    const baseline = (id: string) =>
      result.baselines.find((b) => b.id === id)?.metrics ?? {};
    expect(baseline('latest-chunk-wins')['correct']).toBe(1);
    expect(baseline('raw-grep')['correct']).toBe(1);
    expect(baseline('no-memory')['omission']).toBe(1);
    for (const b of result.baselines) rateMetricsExact(b.metrics);
    expect(result.deltas['latest-chunk-wins']['correct']).toBeCloseTo(-0.8, 12);
    // Today's expected failure (no supersede marker, v1 stays retrievable) is
    // in the numbers; the verdict is na because the commit step is mirrored.
    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe(MIRRORED_COMMIT_NA);
    // 50 extract calls + 20 resolve calls (cases 0-19 have a candidate).
    expect(result.modelCalls).toBe(70);
    expect(result.cassetteVersion).toBe('synthetic-v1');

    const byId = new Map(records.map((r) => [r.caseId, r]));
    expect(byId.get('U-0')).toMatchObject({
      expected: 'correct',
      observed:
        'searchRich=stale; buildBlock=stale; sessions=extracted:1,extracted:1',
      outcome: 'fail',
      baselineOutcomes: {
        'latest-chunk-wins': 'pass',
        'raw-grep': 'pass',
        'no-memory': 'fail',
      },
    });
    expect(byId.get('U-17')?.observed).toMatch(/^searchRich=hallucination/);
    expect(byId.get('U-22')).toMatchObject({ outcome: 'pass' });
  });

  it('goes na on a cassette miss and keeps the key', async () => {
    const cases = updateCases();
    const { context, update, runDir } = setup('updates.jsonl', cases, {
      updateCases: 'updates.jsonl',
    });
    await update.run(context);
    const { result, cases: records } = readSuiteResult(runDir, UPDATE_SUITE_ID);
    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe('cassette-miss');
    expect(records.every((r) => r.observed === 'cassette-miss')).toBe(true);
    expect(records[0].error).toMatch(/^cassette-miss: extract [0-9a-f]{64}$/);
    expect(result.cassetteVersion).toBeNull();
  });

  it('is na below 25 update cases', async () => {
    const cases = updateCases(3);
    const { context, update, runDir } = setup(
      'updates.jsonl',
      cases,
      { updateCases: 'updates.jsonl' },
      updateCassette(cases),
    );
    await update.run(context);
    expect(readSuiteResult(runDir, UPDATE_SUITE_ID).result.naReason).toBe(
      'ground-truth-below-minimum',
    );
  });

  it('measures dated recall and date visibility against raw grep', async () => {
    const cases = temporalCases();
    const { context, temporal, runDir } = setup(
      'temporal.jsonl',
      cases,
      { temporalCases: 'temporal.jsonl', cassetteVersion: 'synthetic-v1' },
      temporalCassette(cases),
    );
    await temporal.run(context);
    const { result, cases: records } = readSuiteResult(
      runDir,
      TEMPORAL_SUITE_ID,
    );
    expect(curationDetailsSchema.parse(result.details)).toEqual({
      operation: 'temporal',
      cases: 15,
      accuracy: 10 / 15,
      dateVisibleShare: 0,
    });
    rateMetricsExact(result.metrics);
    const grep =
      result.baselines.find((b) => b.id === 'raw-grep')?.metrics ?? {};
    expect(grep['accuracy']).toBe(1);
    expect(grep['dateVisibleShare']).toBe(1);
    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe(MIRRORED_COMMIT_NA);
    expect(result.modelCalls).toBe(15);
    expect(records.find((r) => r.caseId === 'T-0')).toMatchObject({
      outcome: 'pass',
      baselineOutcomes: { 'raw-grep': 'pass', 'no-memory': 'fail' },
    });
    expect(records.find((r) => r.caseId === 'T-12')?.outcome).toBe('fail');
  });

  it('attributes a session cassette miss to its temporal question', async () => {
    const cases = temporalCases();
    const { context, temporal, runDir } = setup(
      'temporal.jsonl',
      cases,
      { temporalCases: 'temporal.jsonl' },
      temporalCassette(cases.slice(1)),
    );
    await temporal.run(context);
    const { result, cases: records } = readSuiteResult(
      runDir,
      TEMPORAL_SUITE_ID,
    );
    expect(records.find((r) => r.caseId === 'T-0')).toMatchObject({
      observed: 'cassette-miss',
      outcome: 'fail',
    });
    expect(result.naReason).toBe('cassette-miss');
  });

  it('holds the seed supersede invariant on every case', async () => {
    const cases = updateCases(3);
    const { context, seed, runDir } = setup('updates.jsonl', cases, {
      updateCases: 'updates.jsonl',
    });
    await seed.run(context);
    const { result, cases: records } = readSuiteResult(runDir, SEED_SUITE_ID);
    expect(result.details).toMatchObject({ operation: 'update', correct: 1 });
    expect(result.verdict).toBe('pass');
    expect(result.modelCalls).toBe(0);
    expect(
      result.baselines.find((b) => b.id === 'append-only')?.metrics['stale'],
    ).toBe(1);
    expect(records[0]).toMatchObject({
      observed:
        'searchRich=correct; buildBlock=correct; seed=inserted,replaced',
      baselineOutcomes: { 'append-only': 'fail', 'no-memory': 'fail' },
    });
  });

  it('fails the seed invariant when a reseed keeps the old row', async () => {
    const cases = updateCases(3);
    const { context, seed, runDir } = setup(
      'updates.jsonl',
      cases,
      { updateCases: 'updates.jsonl' },
      undefined,
      'append',
    );
    await seed.run(context);
    const { result } = readSuiteResult(runDir, SEED_SUITE_ID);
    expect(result.details).toMatchObject({ correct: 0, stale: 1 });
    expect(result.verdict).toBe('fail');
  });
});
