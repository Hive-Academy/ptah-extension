import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { BenchHostContainer } from '../../../transport/bench-host-boot';
import type { MemorySkillsHostSuiteContext } from '../../host/memory-skills-host';
import { curationDetailsSchema } from '../../memory-skills-suite-kinds';
import { toScorecardSuite } from '../../runner/run-scorecard';
import { readSuiteResult, type SuiteResult } from '../../runner/suite-result';
import {
  ABSTENTION_SUITE_ID,
  createReadSideSuites,
  FTS_AND_SUITE_ID,
  grepKeywords,
  INJECTION_RECALL_SUITE_ID,
  MIN_SCORE,
  numberedLines,
} from './read-side.suite';
import type { ReadSideHit, ReadSidePort, ReadSideRow } from './read-side-port';

const FIXTURES = resolve(__dirname, '../../../../fixtures/memory-skills');

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter((t) => t.length > 2);
}

/** Share of the query's tokens the text contains: a deterministic stand-in score. */
function overlap(query: string, text: string): number {
  const q = [...new Set(tokens(query))];
  const t = new Set(tokens(text));
  return q.length === 0
    ? 0
    : q.filter((token) => t.has(token)).length / q.length;
}

interface FakeOptions {
  /** Product search returns nothing (an AND plan that finds no row). */
  readonly emptySearch?: boolean;
  /** Block injection never fires (a perfect abstention threshold). */
  readonly neverInject?: boolean;
  /** Throws on the n-th `buildBlock` call (1-based). */
  readonly throwOnBlock?: number;
}

/** An in-memory port: rows keyed by the exact workspace string, like the product DB. */
class FakePort implements ReadSidePort {
  readonly rows: (ReadSideRow & { workspaceRoot: string })[] = [];
  readonly inserted: string[] = [];
  private blockCalls = 0;

  constructor(private readonly options: FakeOptions = {}) {}

  async insertRow(workspaceRoot: string, content: string): Promise<string> {
    const memoryId = `M${String(this.rows.length + 1).padStart(3, '0')}`;
    this.rows.push({
      memoryId,
      subject: null,
      content,
      chunkText: content,
      workspaceRoot,
    });
    this.inserted.push(workspaceRoot);
    return memoryId;
  }

  async listRows(workspaceRoot: string): Promise<readonly ReadSideRow[]> {
    return this.rows.filter((row) => row.workspaceRoot === workspaceRoot);
  }

  private ranked(query: string, workspaceRoot: string): ReadSideHit[] {
    return this.rows
      .filter((row) => row.workspaceRoot === workspaceRoot)
      .map((row) => ({ ...row, score: overlap(query, row.chunkText) }))
      .filter((row) => row.score > 0)
      .sort(
        (a, b) => b.score - a.score || a.memoryId.localeCompare(b.memoryId),
      );
  }

  async searchRich(query: string, topK: number, workspaceRoot: string) {
    return {
      bm25Only: true,
      hits: this.options.emptySearch
        ? []
        : this.ranked(query, workspaceRoot).slice(0, topK),
    };
  }

  async searchFtsOr(query: string, topK: number, workspaceRoot: string) {
    return this.ranked(query, workspaceRoot)
      .slice(0, topK)
      .map((hit) => hit.memoryId);
  }

  async buildBlock(query: string, workspaceRoot: string): Promise<string> {
    this.blockCalls += 1;
    if (this.blockCalls === this.options.throwOnBlock)
      throw new Error('reader down');
    if (this.options.neverInject) return '';
    const hits = this.ranked(query, workspaceRoot)
      .filter((hit) => hit.score >= MIN_SCORE)
      .slice(0, 5);
    if (hits.length === 0) return '';
    return [
      '## Recalled Memory Context',
      '',
      ...hits.map((hit, i) => `${i + 1}. [memory]: ${hit.chunkText}`),
      '',
      '---',
    ].join('\n');
  }

  async buildSessionStartBlock(): Promise<string> {
    return '';
  }
}

describe('read-side memory suites', () => {
  let root: string;
  let home: string;
  let runId: string;
  let runDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ptah-620-b19-read-'));
    home = join(root, 'home');
    mkdirSync(join(home, 'fixtures'), { recursive: true });
    copyFileSync(
      join(FIXTURES, 'memory-facts.v1.jsonl'),
      join(home, 'fixtures', 'facts.jsonl'),
    );
    copyFileSync(
      join(FIXTURES, 'distractors.v1.jsonl'),
      join(home, 'fixtures', 'distractors.jsonl'),
    );
    runId = 'ms-test-1';
    runDir = join(root, 'bench', 'runs', runId);
    mkdirSync(runDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function contextFor(
    options: unknown,
    dir = runDir,
  ): MemorySkillsHostSuiteContext {
    return {
      runId,
      runDir: dir,
      options,
      workspaceRoot: join(root, 'workspace'),
      isolation: {
        home,
        userDataPath: join(home, '.ptah'),
        dbPath: join(home, 'db.sqlite'),
      },
      container: {} as BenchHostContainer,
      doubles: {} as MemorySkillsHostSuiteContext['doubles'],
      ci: true,
    };
  }

  const baseOptions = {
    factsFile: 'fixtures/facts.jsonl',
    distractorsFile: 'fixtures/distractors.jsonl',
  };

  async function runSuite(
    id: string,
    port: ReadSidePort,
    options: unknown = baseOptions,
    dir = runDir,
  ) {
    const suite = createReadSideSuites(() => port).find((s) => s.id === id);
    if (suite === undefined) throw new Error(`no suite ${id}`);
    await suite.run(contextFor(options, dir));
    return readSuiteResult(dir, id);
  }

  function expectExactRates(result: SuiteResult): void {
    const rated = Object.keys(result.metrics).filter(
      (key) => result.metrics[`${key}.den`] !== undefined,
    );
    expect(rated.length).toBeGreaterThan(0);
    for (const key of rated) {
      const num = result.metrics[`${key}.num`] as number;
      const den = result.metrics[`${key}.den`] as number;
      expect(result.metrics[key]).toBe(den === 0 ? null : num / den);
    }
    for (const baseline of result.baselines) {
      for (const key of Object.keys(baseline.metrics).filter(
        (k) => baseline.metrics[`${k}.den`] !== undefined,
      )) {
        const num = baseline.metrics[`${key}.num`] as number;
        const den = baseline.metrics[`${key}.den`] as number;
        expect(baseline.metrics[key]).toBe(den === 0 ? null : num / den);
      }
    }
  }

  it('scores searchRich against the pinned OR builder with exact num/den rates', async () => {
    const port = new FakePort();
    const { result, cases } = await runSuite(FTS_AND_SUITE_ID, port);

    // F-009 (category abstention) is held out: 9 seeded facts + 7 distractor rows.
    expect(port.rows).toHaveLength(16);
    expect(new Set(port.inserted)).toEqual(
      new Set([join(runDir, 'workspaces', FTS_AND_SUITE_ID)]),
    );
    expect(cases.map((c) => c.caseId)).toEqual(
      [
        'F-001',
        'F-002',
        'F-003',
        'F-004',
        'F-005',
        'F-006',
        'F-007',
        'F-008',
        'F-010',
      ].map((id) => `fts.${id}`),
    );
    expect(result.kind).toBe('curation');
    expect(curationDetailsSchema.parse(result.details)).toMatchObject({
      operation: 'ranking',
      target: 'fts-and',
    });
    expect(result.baselines.map((b) => b.id)).toEqual(['fts-or']);
    expect(Object.keys(result.deltas)).toEqual(['fts-or']);
    expect(result.modelCalls).toBe(0);
    expect(result.cassetteVersion).toBeNull();
    // 16 inserts + 1 listing + 2 searches per case.
    expect(result.cost.calls).toBe(16 + 1 + 2 * 9);
    expect(result.cost.latency_ms.p50).not.toBeNull();
    expect(result.cost.error_rate).toBe(0);
    expectExactRates(result);
    // F-005 has no matching row (see the injection test): recorded, not ranked.
    expect(result.metrics['unanswerable']).toBe(1);
    expect(result.metrics['recallAt10.den']).toBe(8);
    expect(cases.find((c) => c.caseId === 'fts.F-005')).toMatchObject({
      outcome: 'fail',
      observed: 'relevant=0; no stored row matches the fact',
    });
    for (const record of cases) {
      expect(record.baselineOutcomes).toHaveProperty('fts-or');
      expect(record.observed).not.toContain(root);
    }
  });

  it('fails fts-and when the product ranks below the OR baseline', async () => {
    const { result } = await runSuite(
      FTS_AND_SUITE_ID,
      new FakePort({ emptySearch: true }),
    );
    expect(result.verdict).toBe('fail');
    expect(result.metrics['recallAt10']).toBe(0);
    expect(result.baselines[0].metrics['recallAt10']).toBeGreaterThan(0);
    expect(result.deltas['fts-or']['recallAt10']).toBeLessThan(0);
  });

  it('reports injection recall with last-N, grep and no-memory baselines', async () => {
    const { result, cases } = await runSuite(
      INJECTION_RECALL_SUITE_ID,
      new FakePort(),
    );
    expect(curationDetailsSchema.parse(result.details)).toMatchObject({
      operation: 'injection-recall',
      cases: 9,
      k: 5,
    });
    expect(result.baselines.map((b) => b.id)).toEqual([
      'last-n',
      'grep-top5',
      'no-memory',
    ]);
    const noMemory = result.baselines.find((b) => b.id === 'no-memory');
    expect(noMemory?.metrics['recall']).toBe(0);
    // The statement stream holds 16 messages, so last-50 sees every fact,
    // except F-005: its statement carries its own forbidden token
    // ("google account"), so no verbatim copy of it can match (fixture finding).
    const lastN = result.baselines.find((b) => b.id === 'last-n');
    expect(lastN?.metrics).toMatchObject({ 'recall.num': 8, 'recall.den': 9 });
    expect(
      cases.find((c) => c.caseId === 'inject.F-005')?.baselineOutcomes?.[
        'last-n'
      ],
    ).toBe('fail');
    expectExactRates(result);
    expect(
      cases.every((c) => c.baselineOutcomes?.['no-memory'] === 'fail'),
    ).toBe(true);
  });

  it('records the expected abstention failure and is na below 15 cases', async () => {
    const { result, cases } = await runSuite(
      ABSTENTION_SUITE_ID,
      new FakePort(),
    );
    // Only F-009 is held out in the 10-fact seed.
    expect(cases.map((c) => c.caseId)).toEqual(['abstain.F-009']);
    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe('cases-below-design-minimum: 1 of 15');
    expect(result.metrics['falseInjectionRate.den']).toBe(1);
    expect(result.metrics['minScore']).toBe(MIN_SCORE);
    expect(result.baselines[0]).toMatchObject({
      id: 'no-memory',
      metrics: { falseInjectionRate: 0 },
    });
    expectExactRates(result);
  });

  it('scores abstention cases from an abstention file: fail when injected, pass when silent', async () => {
    const lines = Array.from({ length: 15 }, (_, i) =>
      JSON.stringify({
        id: `A-${String(i + 1).padStart(2, '0')}`,
        statement: `An unrelated statement ${i}.`,
        baitKind: 'sediment',
        question:
          i % 2 === 0
            ? 'Which PowerShell version broke the offline guard JSON array?'
            : 'What is the colour of the office kettle?',
        source: 'synthetic',
        sourceCommit: 'bf682eab8',
        labeller: 'spec',
        labelledAt: '2026-10-07T00:00:00.000Z',
      }),
    );
    writeFileSync(
      join(home, 'fixtures', 'abstention.jsonl'),
      `${lines.join('\n')}\n`,
    );
    const options = {
      ...baseOptions,
      abstentionFile: 'fixtures/abstention.jsonl',
    };

    const injected = await runSuite(
      ABSTENTION_SUITE_ID,
      new FakePort(),
      options,
    );
    expect(injected.cases).toHaveLength(16);
    expect(injected.result.verdict).toBe('fail');
    expect(injected.result.metrics['falseInjectionRate.num']).toBeGreaterThan(
      0,
    );
    expect(injected.result.metrics['injectedScoreMin']).toBeGreaterThanOrEqual(
      MIN_SCORE,
    );

    const silentDir = join(root, 'bench', 'runs', 'ms-test-2');
    const silent = await runSuite(
      ABSTENTION_SUITE_ID,
      new FakePort({ neverInject: true }),
      options,
      silentDir,
    );
    expect(silent.result.verdict).toBe('pass');
    expect(silent.result.details).toMatchObject({
      falseInjectionRate: 0,
      meanInjectedHits: 0,
    });
  });

  it('records a throwing case as an error, keeps it out of the denominators and fails', async () => {
    const { result, cases } = await runSuite(
      INJECTION_RECALL_SUITE_ID,
      new FakePort({ throwOnBlock: 2 }),
    );
    const errored = cases.filter((c) => c.error != null);
    expect(errored).toHaveLength(1);
    expect(errored[0]).toMatchObject({
      caseId: 'inject.F-002',
      outcome: 'fail',
      error: 'reader down',
    });
    expect(result.metrics['recall.den']).toBe(8);
    expect(result.cost.error_rate).toBe(1 / 9);
    expect(result.verdict).toBe('fail');
  });

  it('reads a fixture DB under its own key without inserting, with session-file baselines', async () => {
    const port = new FakePort();
    const seededRoot = 'D:/seeded/workspace';
    await port.insertRow(
      seededRoot,
      'The user asked for proper fixes to be orchestrated over the 2 lanes with our CLI tool, not subagents.',
    );
    port.inserted.length = 0;
    const session = [
      {
        type: 'user',
        timestamp: '2026-09-04T10:00:00.000Z',
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Orchestrate over the 2 lanes with our CLI tool, not subagents.',
            },
          ],
        },
      },
      {
        type: 'assistant',
        timestamp: '2026-09-04T10:01:00.000Z',
        message: { role: 'assistant', content: 'Noted.' },
      },
    ];
    writeFileSync(
      join(home, 'fixtures', 's1.jsonl'),
      session.map((l) => JSON.stringify(l)).join('\n'),
    );
    const options = {
      factsFile: 'fixtures/facts.jsonl',
      seed: {
        mode: 'fixture-db',
        workspaceRoot: seededRoot,
        sessionFiles: ['fixtures/s1.jsonl'],
      },
    };
    const { result, cases } = await runSuite(
      INJECTION_RECALL_SUITE_ID,
      port,
      options,
    );
    expect(port.inserted).toEqual([]);
    expect(cases.find((c) => c.caseId === 'inject.F-001')).toMatchObject({
      outcome: 'pass',
      baselineOutcomes: { 'last-n': 'pass', 'no-memory': 'fail' },
    });
    expect(result.cost.calls).toBe(1 + 2 * 9);
  });

  it('refuses fixture paths outside the isolated home', async () => {
    const suite = createReadSideSuites(() => new FakePort())[0];
    await expect(
      suite.run(contextFor({ factsFile: '../escape.jsonl' })),
    ).rejects.toThrow(/leaves the isolated home/);
    await expect(
      suite.run(contextFor({ factsFile: join(root, 'abs.jsonl') })),
    ).rejects.toThrow(/home-relative/);
    await expect(
      suite.run(contextFor({ factsFile: 'f', extra: 1 })),
    ).rejects.toThrow();
  });

  it('projects identically across runs and sets cost.source none', async () => {
    const first = await runSuite(FTS_AND_SUITE_ID, new FakePort());
    const otherDir = join(root, 'bench', 'runs', 'ms-test-2');
    const second = await runSuite(
      FTS_AND_SUITE_ID,
      new FakePort(),
      baseOptions,
      otherDir,
    );
    const host = {
      pid: 1,
      port: 2,
      guardMode: 'hash',
      exitedEarly: () => false,
      stop: async () => undefined,
    };
    const card = (scored: typeof first, id: string) =>
      toScorecardSuite(
        { placement: 'host', result: scored.result, cases: scored.cases },
        'replay',
        {
          runId: id,
          startedAt: '2026-10-07T00:00:00.000Z',
          host: host as never,
        },
      );
    const a = card(first, 'ms-test-1');
    const b = card(second, 'ms-test-2');
    expect(a.cost.source).toBe('none');
    expect(a.projectionSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.projectionSha256).toBe(b.projectionSha256);
  });

  it('parses block lines and grep keywords deterministically', () => {
    expect(numberedLines('## h\n1. [a]: x\n2. [memory]: y\n---')).toEqual([
      '1. [a]: x',
      '2. [memory]: y',
    ]);
    expect(
      grepKeywords('Which PowerShell 5 behavior broke the offline guard?'),
    ).toEqual(['powershell', 'behavior', 'broke', 'offline', 'guard']);
  });
});
