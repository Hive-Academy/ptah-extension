/**
 * Batch 17 spec for `mem.extraction`. It drives the REAL `MemoryCuratorService`
 * (window planning, extract across windows, resolve, persist) constructed
 * positionally as the product's own specs do, over an in-memory store, with
 * the REAL `RecordedCuratorLlm` double. The cassette is synthetic: a
 * deterministic extractor ("a model that writes down every planted statement
 * and every bait it can see, the abstention fact included") is
 * recorded through the double's record mode into the spec's temp dir, then
 * replayed. No live model is involved anywhere.
 */
import 'reflect-metadata';
jest.mock('vscode', () => ({}), { virtual: true });

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  CuratorExtraction,
  ExtractedMemoryDraft,
  ICompactionCallbackRegistry,
  ICuratorLLM,
  ITranscriptReader,
  ResolvedMemoryDraft,
} from '@ptah-extension/memory-contracts';
import {
  MemoryCuratorService,
  type MemoryCuratorEvent,
  type MemoryStore,
} from '@ptah-extension/memory-curator';
import type { Logger } from '@ptah-extension/vscode-core';

import {
  CassetteStore,
  type CassetteEntry,
} from '../../doubles/cassette-store';
import { RecordedCuratorLlm } from '../../doubles/recorded-curator-llm';
import { factSchema, type Fact } from '../../ground-truth/label-schemas';
import { parseDistractorBank } from '../../ground-truth/seeded-session-generator';
import { matchesFact } from '../../matching/fact-matcher';
import type { RunnerHost } from '../../runner/host-completion-reader';
import { toScorecardSuite } from '../../runner/run-scorecard';
import {
  readSuiteResult,
  type CaseRecord,
  type SuiteResult,
} from '../../runner/suite-result';
import { BAIT_SIGNATURES } from './bait-signatures';
import {
  EXTRACTION_DISTRACTORS_TARGET,
  EXTRACTION_FACTS_TARGET,
  EXTRACTION_SUITE_ID,
  planExtractionCases,
  runExtractionSuite,
  type ExtractionEnv,
} from './extraction.suite';

const FIXTURES = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'memory-skills',
);
const SYNTHETIC_MODEL = 'synthetic:spec-extractor';
const facts: Fact[] = readFileSync(
  join(FIXTURES, 'memory-facts.v1.jsonl'),
  'utf8',
)
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => factSchema.parse(JSON.parse(line)));
const bank = parseDistractorBank(
  readFileSync(join(FIXTURES, 'distractors.v1.jsonl'), 'utf8'),
);
const baits = bank.filter((record) => record.kind === 'distractor');
/**
 * Share of durable facts whose own statement satisfies their R-M4 label: the
 * recall ceiling of any policy that stores the statement verbatim. Below 1
 * today because F-005 lists "google account" as forbidden while its own
 * statement says "not the active Google account" (a gt-memory@v1 label
 * defect, reported in batch-17-report.md).
 */
const durable = facts.filter((fact) => fact.category !== 'abstention');
const selfMatchingShare =
  durable.filter((fact) => matchesFact(fact, { content: fact.statement }))
    .length / durable.length;

function logger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

/** The store surface `MemoryCuratorService` and the suite touch, in memory. */
class InMemoryStore {
  readonly rows: {
    id: string;
    workspaceRoot: string | null;
    subject: string | null;
    content: string;
    chunks: string[];
  }[] = [];

  list(filter: { workspaceRoot?: string | null }) {
    const memories = this.rows
      .filter((row) => row.workspaceRoot === filter.workspaceRoot)
      .map((row) => ({
        id: row.id,
        subject: row.subject,
        content: row.content,
      }));
    return { memories, total: memories.length };
  }
  getChunks(id: string) {
    return (this.rows.find((row) => row.id === id)?.chunks ?? []).map(
      (text) => ({ text }),
    );
  }
  findMergeCandidates() {
    return [];
  }
  getMergeTarget() {
    return null;
  }
  async insertMemoryWithChunks(
    insert: {
      workspaceRoot?: string | null;
      subject?: string | null;
      content: string;
    },
    chunks: { text: string }[],
  ) {
    this.rows.push({
      id: `m${this.rows.length + 1}`,
      workspaceRoot: insert.workspaceRoot ?? null,
      subject: insert.subject ?? null,
      content: insert.content,
      chunks: chunks.map((chunk) => chunk.text),
    });
  }
  async appendChunks() {
    return 'appended';
  }
}

/** Deterministic stand-in for the extract model, recorded into the cassette. */
const syntheticExtractor: ICuratorLLM = {
  async extract(transcript: string): Promise<CuratorExtraction> {
    const drafts: ExtractedMemoryDraft[] = facts
      .filter((fact) => transcript.includes(fact.statement))
      .map((fact) => ({
        kind: 'fact',
        subject: fact.question,
        content: fact.statement,
        salienceHint: 0.6,
      }));
    // A maximally gullible model: every bait it sees becomes a memory.
    for (const bait of baits) {
      if (transcript.includes(bait.text)) {
        drafts.push({
          kind: 'fact',
          subject: bait.id,
          content: bait.text,
          salienceHint: 0.4,
        });
      }
    }
    return { status: 'extracted', drafts };
  },
  async resolve(drafts): Promise<readonly ResolvedMemoryDraft[]> {
    return drafts.map((draft) => ({ ...draft, mergeTargetId: null }));
  },
};

let root: string;
let home: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ms-b17-extraction-'));
  home = join(root, 'home');
  mkdirSync(join(home, 'memory-skills'), { recursive: true });
  copyFileSync(
    join(FIXTURES, 'memory-facts.v1.jsonl'),
    join(home, EXTRACTION_FACTS_TARGET),
  );
  copyFileSync(
    join(FIXTURES, 'distractors.v1.jsonl'),
    join(home, EXTRACTION_DISTRACTORS_TARGET),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function harness(
  mode: 'record' | 'replay',
  cassette: string,
): {
  env: ExtractionEnv;
  double: RecordedCuratorLlm;
} {
  const double = new RecordedCuratorLlm({
    store: new CassetteStore({ path: cassette, mode }),
    model: SYNTHETIC_MODEL,
    ...(mode === 'record' ? { inner: syntheticExtractor } : {}),
  });
  const store = new InMemoryStore();
  const curator = new MemoryCuratorService(
    logger(),
    {
      register: jest.fn(() => () => undefined),
    } as unknown as ICompactionCallbackRegistry,
    store as unknown as MemoryStore,
    { read: jest.fn().mockResolvedValue('') } as unknown as ITranscriptReader,
    double,
  );
  const env: ExtractionEnv = {
    curate: (request) => curator.curate({ ...request, userInitiated: true }),
    rowsFor: (workspaceRoot) =>
      store.list({ workspaceRoot }).memories.map((memory) => ({
        subject: memory.subject,
        content: memory.content,
        chunks: store.getChunks(memory.id).map((chunk) => chunk.text),
      })),
    onCuratorError: (listener) => {
      const subscription = curator.onEvent((event: MemoryCuratorEvent) => {
        if (event.kind === 'curator-error') {
          listener({ sessionId: event.sessionId, error: event.error ?? '' });
        }
      });
      return () => subscription.dispose();
    },
    modelCalls: () => {
      const counts = double.callCounts();
      return counts.extract + counts.resolve;
    },
  };
  return { env, double };
}

async function run(
  mode: 'record' | 'replay',
  cassette: string,
  runName: string,
  options: Record<string, unknown> = {},
) {
  const runDir = join(root, 'runs', runName);
  const { env } = harness(mode, cassette);
  await runExtractionSuite({
    runDir,
    home,
    workspaceRoot: join(root, 'workspace'),
    options,
    env,
  });
  return { runDir, ...readSuiteResult(runDir, EXTRACTION_SUITE_ID) };
}

function withoutTiming<T extends { latencyMs: number; attempts?: number }>(
  records: readonly T[],
) {
  return records.map(
    ({ latencyMs: _latency, attempts: _attempts, ...rest }) => rest,
  );
}

const runFacts = { runId: 'ms-spec', startedAt: '2026-10-07T00:00:00.000Z' };
const host = { pid: 1, port: 2 } as unknown as RunnerHost;

describe('mem.extraction', () => {
  it('records a synthetic cassette with its model id and replays it identically', async () => {
    const cassette = join(root, 'cassettes', 'extraction.v1.jsonl');
    const recorded = await run('record', cassette, 'record');
    const replayed = await run('replay', cassette, 'replay');

    const entries = readFileSync(cassette, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as CassetteEntry);
    expect(entries.length).toBeGreaterThan(0);
    expect(new Set(entries.map((entry) => entry.model))).toEqual(
      new Set([SYNTHETIC_MODEL]),
    );

    expect(withoutTiming(replayed.cases)).toEqual(
      withoutTiming(recorded.cases),
    );
    expect(replayed.result.details).toEqual(recorded.result.details);
    expect(replayed.result.metrics).toEqual(recorded.result.metrics);
    expect(replayed.result.modelCalls).toBe(recorded.result.modelCalls);
    // Identical windows (shared filler) reuse one entry, so calls >= entries.
    expect(replayed.result.modelCalls).toBeGreaterThanOrEqual(entries.length);
    expect(replayed.cases.every((c) => c.error === null)).toBe(true);
    expect(replayed.result.cassetteVersion).toBe('extraction.v1');
  });

  it('reports head and middle-window recall separately and records the middle-window failure', async () => {
    const cassette = join(root, 'cassettes', 'extraction.v1.jsonl');
    await run('record', cassette, 'record');
    const { result, cases } = await run('replay', cassette, 'replay', {
      matcherValidated: true,
    });

    // The middle of a long session never reaches the model: expected ~0 today.
    expect(result.metrics['recall.longMiddle']).toBe(0);
    expect(result.metrics['recall.longHead']).toBe(selfMatchingShare);
    const middle = cases.filter((c) => c.caseId.startsWith('long-middle/'));
    const head = cases.filter((c) => c.caseId.startsWith('long-head/'));
    expect(middle.length).toBeGreaterThan(0);
    expect(middle.length).toBe(head.length);
    expect(middle.every((c) => c.outcome === 'fail')).toBe(true);
    expect(
      middle.every((c) => c.baselineOutcomes?.['extract-all'] !== undefined),
    ).toBe(true);
    // Recorded, not hidden: the suite fails once the matcher is trusted.
    expect(result.verdict).toBe('fail');
    expect(result.naReason).toBeUndefined();
  });

  it('keeps every rate exactly num / den, in the details and in each baseline', async () => {
    const cassette = join(root, 'cassettes', 'extraction.v1.jsonl');
    await run('record', cassette, 'record');
    const { result } = await run('replay', cassette, 'replay');

    const details = result.details as {
      recall: number | null;
      precision: number | null;
      fmr: number | null;
      baits: number;
      confusion: { tp: number; fp: number; fn: number; unlabelled?: number };
      byCategory: Record<
        string,
        { tp: number; fp: number; fn: number; tn?: number }
      >;
      bySedimentClass: Record<string, number>;
    };
    expect(details.precision).toBe(
      details.confusion.tp / (details.confusion.tp + details.confusion.fp),
    );
    const recalled = Object.entries(details.byCategory)
      .filter(
        ([category]) =>
          !category.startsWith('long-') && category !== 'abstention',
      )
      .reduce(
        (sum, [, counts]) => ({
          tp: sum.tp + counts.tp,
          fn: sum.fn + counts.fn,
        }),
        { tp: 0, fn: 0 },
      );
    expect(details.recall).toBe(recalled.tp / (recalled.tp + recalled.fn));
    expect(details.confusion.fn).toBe(recalled.fn);
    const middle = details.byCategory['long-middle'];
    expect(result.metrics['recall.longMiddle']).toBe(
      middle.tp / (middle.tp + middle.fn),
    );
    const written = Object.entries(details.bySedimentClass)
      .filter(([key]) => key.endsWith('.written'))
      .reduce((sum, [, n]) => sum + n, 0);
    expect(details.fmr).toBe((details.baits - written) / details.baits);
    // The gullible synthetic model wrote every bait: FMR is 0 of every planted bait.
    expect(written).toBe(details.baits);
    expect(details.fmr).toBe(0);
    expect(details.byCategory['abstention']).toEqual({
      tp: 0,
      fp: 1,
      fn: 0,
      tn: 0,
    });

    expect(result.baselines.map((b) => b.id)).toEqual([
      'extract-all',
      'no-memory',
    ]);
    for (const baseline of result.baselines) {
      for (const key of [
        'recall.seeded',
        'recall.longMiddle',
        'recall.longHead',
        'precision.seeded',
        'fmr.seeded',
      ]) {
        const num = baseline.metrics[`${key}.num`] as number;
        const den = baseline.metrics[`${key}.den`] as number;
        expect(baseline.metrics[key]).toBe(den === 0 ? null : num / den);
      }
    }
    const extractAll = result.baselines[0].metrics;
    const noMemory = result.baselines[1].metrics;
    // Extract-all writes every statement: its recall is the matcher ceiling.
    expect(extractAll['recall.seeded']).toBe(selfMatchingShare);
    expect(extractAll['recall.longMiddle']).toBe(selfMatchingShare);
    expect(noMemory['recall.seeded']).toBe(0);
    expect(noMemory['precision.seeded']).toBeNull();
    expect(noMemory['fmr.seeded']).toBe(1);
    expect(result.deltas['no-memory']['recall.seeded']).toBe(details.recall);
    expect(result.deltas['no-memory']['recall.seeded.ci95.lo']).not.toBeNull();
    // R-M4 is not met yet, so the verdict is na, never pass.
    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe('matcher-unvalidated');
  });

  it('maps a cassette miss to a case error and the suite to na: cassette-miss', async () => {
    const { result, cases } = await run(
      'replay',
      join(root, 'empty.jsonl'),
      'miss',
      {
        matcherValidated: true,
      },
    );
    expect(cases.length).toBeGreaterThan(0);
    expect(
      cases.every(
        (c) =>
          c.error?.startsWith('cassette-miss: ') &&
          c.error.includes('Cassette miss for extract'),
      ),
    ).toBe(true);
    expect(cases.every((c) => c.outcome === 'fail')).toBe(true);
    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe('cassette-miss');
  });

  it('gives the runner a deterministic projection hash and the right cost.source', async () => {
    const cassette = join(root, 'cassettes', 'extraction.v1.jsonl');
    const recorded = await run('record', cassette, 'record');
    const first = await run('replay', cassette, 'replay-1');
    const second = await run('replay', cassette, 'replay-2');
    const scored = (entry: {
      result: SuiteResult;
      cases: readonly CaseRecord[];
    }) => ({
      placement: 'host' as const,
      result: entry.result,
      cases: entry.cases.map((c) => ({ ...c, latencyMs: 0 })),
    });
    const a = toScorecardSuite(scored(first), 'replay', { ...runFacts, host });
    const b = toScorecardSuite(scored(second), 'replay', { ...runFacts, host });
    expect(a.cost.source).toBe('cassette');
    expect(a.projectionSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.projectionSha256).toBe(b.projectionSha256);
    expect(
      toScorecardSuite(scored(recorded), 'record', { ...runFacts, host }).cost
        .source,
    ).toBe('live');
  });

  it('fails closed when the curator never reaches the record/replay double', async () => {
    const { env } = harness('replay', join(root, 'empty.jsonl'));
    await expect(
      runExtractionSuite({
        runDir: join(root, 'runs', 'unwired'),
        home,
        workspaceRoot: join(root, 'workspace'),
        options: {},
        env: { ...env, modelCalls: () => 0 },
      }),
    ).rejects.toThrow('CURATOR_LLM was not replaced');
  });

  it('plans one seeded case per fact and paired head/middle long sessions', () => {
    const planned = planExtractionCases(facts, bank, 'seed');
    expect(planned.filter((c) => c.slice === 'seeded')).toHaveLength(
      facts.length,
    );
    const middle = planned.filter((c) => c.slice === 'long-middle');
    const head = planned.filter((c) => c.slice === 'long-head');
    expect(middle.map((c) => c.targets.map((f) => f.id))).toEqual(
      head.map((c) => c.targets.map((f) => f.id)),
    );
    expect(
      middle.flatMap((c) => c.targets).some((f) => f.category === 'abstention'),
    ).toBe(false);
    for (const session of planned.map((c) => c.session)) {
      for (const bait of session.baits)
        expect(BAIT_SIGNATURES[bait.id]).toBeDefined();
    }
  });

  it('matches every bait text with its signature and no in-session rebuttal', () => {
    for (const bait of baits) {
      if (bait.kind !== 'distractor') continue;
      const signatures = BAIT_SIGNATURES[bait.id];
      expect(signatures).toBeDefined();
      const hit = (text: string) =>
        signatures.some((s) => matchesFact(s, { content: text }));
      expect(hit(bait.text)).toBe(true);
      if (bait.rebuttal !== undefined) expect(hit(bait.rebuttal)).toBe(false);
    }
  });

  it('refuses a planted bait without a signature', () => {
    const unsigned = bank.map((record) =>
      record.kind === 'distractor'
        ? { ...record, id: `X-${record.id}` }
        : record,
    );
    expect(() => planExtractionCases(facts, unsigned, 'seed')).toThrow(
      'has no signature',
    );
  });

  it('refuses a fixture path that escapes the isolated home', async () => {
    const { env } = harness('replay', join(root, 'empty.jsonl'));
    await expect(
      runExtractionSuite({
        runDir: join(root, 'runs', 'escape'),
        home,
        workspaceRoot: join(root, 'workspace'),
        options: { factsFile: '../outside.jsonl' },
        env,
      }),
    ).rejects.toThrow('outside the isolated home');
  });
});
