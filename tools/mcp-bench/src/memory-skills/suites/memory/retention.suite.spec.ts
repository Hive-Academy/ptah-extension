/**
 * Batch 20.1 spec for `mem.retention.lifecycle`, `mem.retention.growth` and
 * `mem.ranking.roster`. The suites run over an in-memory {@link RetentionPort}
 * that models TODAY's product: the archive/delete/evict decision is the pure
 * age-only policy (the product's current decision, `retention-policies.ts`),
 * observations are purged 7 days after processing and deleted 14 days after
 * capture while unprocessed (`MEMORY_RETENTION_DEFAULTS`), a stalled pass
 * leaves its observations untouched, and the roster ranks by the product's own
 * `rankSalience`. Like the product, the double stamps every write with
 * `Date.now()`, so the suites' simulated clock is exercised for real.
 *
 * The expectations pin today's recorded failures: false-delete > 0 and
 * unprocessed observations deleted under the 9-day stall.
 */
import 'reflect-metadata';
jest.mock('vscode', () => ({}), { virtual: true });

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MEMORY_RETENTION_DEFAULTS,
  rankSalience,
} from '@ptah-extension/memory-curator';

import {
  ageOnlyPolicy,
  oracleRetentionPolicy,
  type RetentionPolicyRow,
  type RetentionTier,
} from '../../baselines/retention-policies';
import { DEFAULT_RETENTION_POLICY_SETTINGS } from '../../baselines/retention-policy-defaults';
import type { MemorySkillsHostSuiteContext } from '../../host/memory-skills-host';
import { curationDetailsSchema } from '../../memory-skills-suite-kinds';
import { toScorecardSuite } from '../../runner/run-scorecard';
import { readSuiteResult } from '../../runner/suite-result';
import {
  buildRetentionSeed,
  DEFAULT_USAGE_DISTRIBUTION,
} from './retention-seed';
import { RETENTION_GROWTH_SUITE_ID } from './retention-growth';
import {
  RETENTION_LIFECYCLE_SUITE_ID,
  simulatePolicy,
  summarizeLifecycle,
} from './retention-lifecycle';
import {
  parseRosterSubjects,
  RANKING_ROSTER_SUITE_ID,
} from './retention-roster';
import {
  DAY_MS,
  loadRetentionSeed,
  retentionOptionsSchema,
  type CurateOutcome,
  type ObservationLoadRow,
  type RetentionPort,
  type RetentionRunSummary,
  type SeedMemoryInsert,
} from './retention-support';
import { createRetentionSuites } from './retention.suite';

const FIXTURES = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'memory-skills',
);

interface FakeMemory extends SeedMemoryInsert {
  readonly id: string;
  tier: RetentionTier;
  archivedAt: number | null;
  lastUsedAt: number;
  hits: number;
}

interface FakeObservation {
  readonly sessionId: string;
  readonly capturedAt: number;
  processedAt: number | null;
  readonly bytes: number;
}

type RunMode =
  | { kind: 'today' }
  | { kind: 'skip'; reason: string }
  | { kind: 'note'; note: 'vec-unavailable' };

/** Today's product behaviour, in memory (see the module header). */
class FakeRetentionPort implements RetentionPort {
  readonly memories = new Map<string, FakeMemory>();
  readonly observations: FakeObservation[] = [];
  readonly observationWorkspaceRoot = '/fake/workspace';
  runMode: RunMode = { kind: 'today' };
  failInsertAfter = Number.POSITIVE_INFINITY;
  private nextId = 1;

  lifecycleSettings() {
    return DEFAULT_RETENTION_POLICY_SETTINGS;
  }

  async insertMemory(insert: SeedMemoryInsert): Promise<string> {
    if (this.memories.size >= this.failInsertAfter) {
      throw new Error('insert failed');
    }
    const id = `m${String(this.nextId++).padStart(4, '0')}`;
    this.memories.set(id, {
      ...insert,
      id,
      tier: 'recall',
      archivedAt: null,
      lastUsedAt: Date.now(),
      hits: 0,
    });
    return id;
  }

  recordUse(memoryIds: readonly string[]): void {
    for (const id of memoryIds) {
      const row = this.memories.get(id);
      if (row === undefined) continue;
      row.hits += 1;
      row.lastUsedAt = Date.now();
      row.tier = row.tier === 'archival' ? 'recall' : row.tier;
      row.archivedAt = null;
    }
  }

  memoryStates(workspaceRoot: string) {
    return [...this.memories.values()]
      .filter((row) => row.workspaceRoot === workspaceRoot)
      .map((row) => ({ memoryId: row.id, tier: row.tier }));
  }

  async runRetention(nowMs: number): Promise<RetentionRunSummary> {
    if (this.runMode.kind === 'skip') {
      return {
        status: 'skipped',
        reason: this.runMode.reason,
        archived: 0,
        deleted: 0,
        evicted: 0,
        stuckQuarantined: 0,
        processedPurged: 0,
        lifecycleNote: null,
      };
    }
    const before = this.observations.length;
    const stuckCutoff = nowMs - MEMORY_RETENTION_DEFAULTS.stuckDays * DAY_MS;
    const purgeCutoff =
      nowMs - MEMORY_RETENTION_DEFAULTS.processedDays * DAY_MS;
    let stuck = 0;
    for (let index = this.observations.length - 1; index >= 0; index -= 1) {
      const row = this.observations[index];
      const purge = row.processedAt !== null && row.processedAt < purgeCutoff;
      const quarantine =
        row.processedAt === null && row.capturedAt < stuckCutoff;
      if (quarantine) stuck += 1;
      if (purge || quarantine) this.observations.splice(index, 1);
    }
    const rows: RetentionPolicyRow[] = [...this.memories.values()].map(
      (row) => ({
        id: row.id,
        tier: row.tier,
        workspaceRoot: row.workspaceRoot,
        lastUsedAtMs: row.lastUsedAt,
        archivedAtMs: row.archivedAt,
        pinned: false,
        hits: row.hits,
        kind: row.kind,
        useful: false,
      }),
    );
    const decision =
      this.runMode.kind === 'note'
        ? { archived: [], deleted: [], evicted: [] }
        : ageOnlyPolicy(rows, nowMs, this.lifecycleSettings());
    for (const id of [...decision.deleted, ...decision.evicted])
      this.memories.delete(id);
    for (const id of decision.archived) {
      const row = this.memories.get(id);
      if (row !== undefined) {
        row.tier = 'archival';
        row.archivedAt = nowMs;
      }
    }
    return {
      status: 'completed',
      reason: null,
      archived: decision.archived.length,
      deleted: decision.deleted.length,
      evicted: decision.evicted.length,
      stuckQuarantined: stuck,
      processedPurged: before - this.observations.length - stuck,
      lifecycleNote: this.runMode.kind === 'note' ? this.runMode.note : null,
    };
  }

  dbBytes(): number {
    const observationBytes = this.observations.reduce(
      (sum, row) => sum + row.bytes,
      0,
    );
    return (
      4_096 * (8 + this.memories.size + Math.ceil(observationBytes / 4_096))
    );
  }

  enqueueObservations(
    sessionId: string,
    rows: readonly ObservationLoadRow[],
  ): void {
    for (const row of rows) {
      this.observations.push({
        sessionId,
        capturedAt: Date.now(),
        processedAt: null,
        bytes: row.text.length,
      });
    }
  }

  async curate(
    sessionId: string,
    _marker: string,
    stalled: boolean,
  ): Promise<CurateOutcome> {
    if (stalled) return 'stalled';
    for (const row of this.observations) {
      if (row.sessionId === sessionId && row.processedAt === null)
        row.processedAt = Date.now();
    }
    return 'ran';
  }

  unprocessed(sessionId: string): number {
    return this.observations.filter(
      (row) => row.sessionId === sessionId && row.processedAt === null,
    ).length;
  }

  observationRows(sessionId: string): number {
    return this.observations.filter((row) => row.sessionId === sessionId)
      .length;
  }

  async buildSessionStartBlock(workspaceRoot: string): Promise<string> {
    const now = Date.now();
    const subjects = [...this.memories.values()]
      .filter((row) => row.workspaceRoot === workspaceRoot)
      .sort((left, right) => {
        const score = (row: FakeMemory) =>
          rankSalience(
            {
              salience: row.salience,
              hits: row.hits,
              pinned: false,
              lastUsedAt: row.lastUsedAt,
            },
            now,
          );
        return score(right) - score(left) || (left.id < right.id ? 1 : -1);
      })
      .slice(0, 10)
      .map((row) => row.subject);
    return [
      '## Workspace Memory Snapshot',
      '',
      `Recent observations curated for this workspace (${subjects.length}):`,
      '',
      ...subjects.map((subject, index) => `${index + 1}. ${subject}`),
      '',
      '---',
    ].join('\n');
  }
}

function makeHome(root: string): string {
  const home = join(root, 'home');
  mkdirSync(join(home, 'memory-skills'), { recursive: true });
  for (const name of ['memory-facts.v1.jsonl', 'distractors.v1.jsonl']) {
    copyFileSync(join(FIXTURES, name), join(home, 'memory-skills', name));
  }
  return home;
}

function contextFor(
  root: string,
  home: string,
  options: unknown = {},
): MemorySkillsHostSuiteContext {
  return {
    runId: 'ms-retention',
    runDir: join(root, 'run'),
    options,
    workspaceRoot: '/fake/workspace',
    isolation: {
      home,
      userDataPath: join(home, 'ud'),
      dbPath: join(home, 'db.sqlite'),
    },
    container: undefined as never,
    doubles: undefined as never,
    ci: false,
  };
}

async function runSuite(
  id: string,
  root: string,
  port: RetentionPort,
  options: unknown = {},
) {
  const home = makeHome(root);
  const suite = createRetentionSuites({ portOf: () => port }).find(
    (s) => s.id === id,
  );
  if (suite === undefined) throw new Error(`no suite ${id}`);
  await suite.run(contextFor(root, home, options));
  return readSuiteResult(join(root, 'run'), id);
}

/** Every `<name>` with `.num`/`.den` equals `num / den` exactly (or `null` when `den` is 0). */
function expectExactRates(metrics: Record<string, number | null>): string[] {
  const names = Object.keys(metrics)
    .filter((key) => key.endsWith('.num'))
    .map((key) => key.slice(0, -'.num'.length));
  for (const name of names) {
    const num = metrics[`${name}.num`];
    const den = metrics[`${name}.den`];
    if (typeof num !== 'number' || typeof den !== 'number')
      throw new Error(`${name}: no num/den`);
    expect(metrics[name]).toBe(den === 0 ? null : num / den);
  }
  return names;
}

function scorecardOf(scored: ReturnType<typeof readSuiteResult>) {
  return toScorecardSuite({ placement: 'host', ...scored }, 'replay', {
    runId: 'ms-retention',
    startedAt: '2026-10-07T00:00:00.000Z',
    host: {
      pid: 1,
      port: 2,
      guardMode: 'hash',
      exitedEarly: () => false,
      stop: async () => undefined,
    } as never,
  });
}

describe('retention suites', () => {
  let root: string;
  const originalNow = Date.now;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ptah-620-retention-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    Date.now = originalNow;
  });

  it('builds the seed deterministically from the committed fixtures', () => {
    const home = makeHome(root);
    const options = retentionOptionsSchema.parse({});
    const first = loadRetentionSeed(home, options);
    expect(loadRetentionSeed(home, options)).toEqual(first);
    const acceptedFacts = readFileSync(
      join(FIXTURES, 'memory-facts.v1.jsonl'),
      'utf8',
    )
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as { id: string; category: string });
    const durableIds = acceptedFacts
      .filter((fact) => fact.category !== 'abstention')
      .map((fact) => fact.id);
    expect(durableIds).toHaveLength(127);
    expect(first.filter((row) => row.useful).map((row) => row.id)).toEqual(
      durableIds,
    );
    expect(first.filter((row) => !row.useful)).toHaveLength(7);
    for (const row of first) {
      if (row.useful) expect(row.questionDay).toBeGreaterThanOrEqual(1);
      if (row.useful) expect(row.questionDay).toBeLessThanOrEqual(180);
      expect(row.lastUsedAgeDays).toBeLessThanOrEqual(89);
    }
  });

  it("records today's false-deletes in mem.retention.lifecycle and fails", async () => {
    const port = new FakeRetentionPort();
    const scored = await runSuite(RETENTION_LIFECYCLE_SUITE_ID, root, port);
    const { result, cases } = scored;
    const details = curationDetailsSchema.parse(result.details);
    if (details.operation !== 'retention') throw new Error('not retention');

    expect(result.verdict).toBe('fail');
    const seed = loadRetentionSeed(
      makeHome(root),
      retentionOptionsSchema.parse({}),
    );
    const ageOnly = summarizeLifecycle(
      seed,
      simulatePolicy(
        seed,
        ageOnlyPolicy,
        DEFAULT_RETENTION_POLICY_SETTINGS,
        180,
        0,
      ),
    );
    // The double implements the pure age-only decision: calculate the
    // expected rates independently from the committed U2 seed.
    expect(result.metrics['falseDelete.num']).toBe(ageOnly.falseDelete.num);
    expect(result.metrics['falseDelete.den']).toBe(ageOnly.falseDelete.den);
    expect(result.metrics['archivedThenNeeded.num']).toBe(
      ageOnly.archivedThenNeeded.num,
    );
    expect(result.metrics['falseRetain.num']).toBe(ageOnly.falseRetain.num);
    expect(result.metrics['falseRetain.den']).toBe(ageOnly.falseRetain.den);
    // The double IS the age-only decision, so product and pure baseline agree on every row.
    expect(result.metrics['ageOnlyAgreement']).toBe(1);
    expect(expectExactRates(result.metrics)).toEqual(
      expect.arrayContaining([
        'falseDelete',
        'falseRetain',
        'archivedThenNeeded',
        'ageOnlyAgreement',
      ]),
    );
    for (const baseline of result.baselines) expectExactRates(baseline.metrics);

    const baselines = Object.fromEntries(
      result.baselines.map((b) => [b.id, b.metrics]),
    );
    expect(Object.keys(baselines)).toEqual([
      'no-lifecycle',
      'age-only',
      'oracle',
    ]);
    expect(baselines['oracle']['falseDelete.num']).toBe(0);
    expect(baselines['no-lifecycle']['falseDelete.num']).toBe(0);
    expect(baselines['no-lifecycle']['falseRetain']).toBe(1);
    expect(baselines['age-only']['falseDelete']).toBe(
      result.metrics['falseDelete'],
    );

    expect(details.simulatedDays).toBe(180);
    expect(details.dbBytesByDay.map((entry) => entry.day)).toEqual(
      Array.from({ length: 181 }, (_, day) => day),
    );
    expect(details.falseDelete.fp).toBe(result.metrics['falseDelete.num']);
    expect(details.falseRetain.fp).toBe(result.metrics['falseRetain.num']);
    expect(cases).toHaveLength(seed.length);
    const lost = cases.filter(
      (c) => c.caseId.startsWith('row/F-') && c.outcome === 'fail',
    );
    expect(lost).toHaveLength(result.metrics['falseDelete.num'] as number);
    expect(lost[0].observed).toMatch(
      /^removed on question day \d+; removed on day \d+$/,
    );
    expect(lost[0].baselineOutcomes).toEqual({
      'no-lifecycle': 'pass',
      'age-only': 'fail',
      oracle: 'pass',
    });
    expect(Date.now).toBe(originalNow);
  });

  it('agrees with the pure policies when the seed is simulated directly', () => {
    const home = makeHome(root);
    const seed = loadRetentionSeed(home, retentionOptionsSchema.parse({}));
    const settings = DEFAULT_RETENTION_POLICY_SETTINGS;
    const oracle = summarizeLifecycle(
      seed,
      simulatePolicy(seed, oracleRetentionPolicy, settings, 180, 0),
    );
    expect(oracle.falseDelete).toEqual({
      value: 0,
      num: 0,
      den: seed.filter((row) => row.useful).length,
    });
    const ageOnly = summarizeLifecycle(
      seed,
      simulatePolicy(seed, ageOnlyPolicy, settings, 180, 0),
    );
    // Nothing disposable survives 180 idle days under age-only.
    expect(ageOnly.falseRetain).toEqual({
      value: 0,
      num: 0,
      den: seed.filter((row) => !row.useful).length,
    });
    expect(ageOnly.removedConfusion.tp + ageOnly.removedConfusion.fn).toBe(
      seed.filter((row) => !row.useful).length,
    );
  });

  it('marks the lifecycle na when a retention run is skipped or the lifecycle is paused', async () => {
    const skipped = new FakeRetentionPort();
    skipped.runMode = { kind: 'skip', reason: 'boot-deferred' };
    const first = await runSuite(RETENTION_LIFECYCLE_SUITE_ID, root, skipped);
    expect(first.result.verdict).toBe('na');
    expect(first.result.naReason).toBe('retention-run-skipped: boot-deferred');

    const paused = new FakeRetentionPort();
    paused.runMode = { kind: 'note', note: 'vec-unavailable' };
    const other = mkdtempSync(join(tmpdir(), 'ptah-620-retention-'));
    try {
      const second = await runSuite(
        RETENTION_LIFECYCLE_SUITE_ID,
        other,
        paused,
      );
      expect(second.result.verdict).toBe('na');
      expect(second.result.naReason).toBe('lifecycle-vec-unavailable');
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('restores Date.now when the port throws mid-run', async () => {
    const port = new FakeRetentionPort();
    port.failInsertAfter = 3;
    await expect(
      runSuite(RETENTION_LIFECYCLE_SUITE_ID, root, port),
    ).rejects.toThrow('insert failed');
    expect(Date.now).toBe(originalNow);
  });

  it('records the unprocessed observations the 9-day stall loses in mem.retention.growth', async () => {
    const scored = await runSuite(
      RETENTION_GROWTH_SUITE_ID,
      root,
      new FakeRetentionPort(),
    );
    const { result, cases } = scored;
    const details = curationDetailsSchema.parse(result.details);
    if (details.operation !== 'retention') throw new Error('not retention');

    // Days 20-28, 4 sessions a day, 10 observations a session; each is deleted 15 days later.
    expect(details.unprocessedObservationsDeleted).toBe(9 * 4 * 10);
    expect(result.metrics['unprocessedDeleted.num']).toBe(360);
    expect(result.metrics['unprocessedDeleted.den']).toBe(181 * 4 * 10);
    expectExactRates(result.metrics);
    expect(result.metrics['passes.stalled']).toBe(36);
    expect(result.verdict).toBe('fail');
    expect(details.dbBytesByDay).toHaveLength(181);
    expect(cases).toHaveLength(181);
    const failed = cases
      .filter((c) => c.outcome === 'fail')
      .map((c) => c.caseId);
    expect(failed).toEqual(
      Array.from({ length: 9 }, (_, i) => `day/0${35 + i}`),
    );
    expect(cases[35].observed).toMatch(
      /^retention completed; 40 unprocessed deleted; passes 4 ran, 0 stalled, 0 threw; \d+ bytes$/,
    );
    expect(cases[20].observed).toContain(
      '0 ran, 4 stalled, 0 threw (stall day)',
    );
    expect(result.baselines[0]).toMatchObject({ id: 'no-retention' });
    expect(
      result.deltas['no-retention']['unprocessedObservationsDeleted'],
    ).toBe(360);
    expect(Date.now).toBe(originalNow);
  });

  it('passes mem.retention.growth without a stall: nothing unprocessed is lost and the DB is bounded', async () => {
    const scored = await runSuite(
      RETENTION_GROWTH_SUITE_ID,
      root,
      new FakeRetentionPort(),
      {
        growth: { stall: { startDay: 0, days: 0 } },
      },
    );
    expect(scored.result.metrics['unprocessedObservationsDeleted']).toBe(0);
    expect(scored.result.metrics['bounded']).toBe(1);
    expect(scored.result.verdict).toBe('pass');
  });

  it('scores the session-start roster against labelled-useful subjects and recency only', async () => {
    const scored = await runSuite(
      RANKING_ROSTER_SUITE_ID,
      root,
      new FakeRetentionPort(),
    );
    const { result, cases } = scored;
    const details = curationDetailsSchema.parse(result.details);
    if (details.operation !== 'ranking') throw new Error('not ranking');
    expect(details.target).toBe('roster');
    expect(details.ndcgAt10).toBe(result.metrics['ndcgAt10']);
    expect(details.ndcgAt10).toBeGreaterThanOrEqual(0);
    expect(details.ndcgAt10).toBeLessThanOrEqual(1);
    expect(result.metrics['rosterLength']).toBe(10);
    expect(cases).toHaveLength(
      loadRetentionSeed(
        makeHome(root),
        retentionOptionsSchema.parse({}),
      ).filter((row) => row.useful).length,
    );
    expectExactRates(result.metrics);
    expectExactRates(result.baselines[0].metrics);
    expect(result.metrics['usefulInRoster.num']).toBe(
      cases.filter((c) => c.outcome === 'pass').length,
    );
    const recency = result.baselines[0].metrics['ndcgAt10'] as number;
    expect(result.verdict).toBe(
      (result.metrics['ndcgAt10'] as number) > recency ? 'pass' : 'fail',
    );
    expect(Date.now).toBe(originalNow);
  });

  it('produces the same projection hash from two runs in different directories, with cost.source none', async () => {
    const hashes: string[] = [];
    for (const id of [
      RETENTION_LIFECYCLE_SUITE_ID,
      RETENTION_GROWTH_SUITE_ID,
      RANKING_ROSTER_SUITE_ID,
    ]) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const dir = mkdtempSync(join(tmpdir(), 'ptah-620-retention-'));
        try {
          const suite = scorecardOf(
            await runSuite(id, dir, new FakeRetentionPort()),
          );
          expect(suite.cost.source).toBe('none');
          hashes.push(suite.projectionSha256 ?? '');
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
    }
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[2]).toBe(hashes[3]);
    expect(hashes[4]).toBe(hashes[5]);
    expect(new Set(hashes).size).toBe(3);
  });

  it('reads a labelled rows file and refuses a seed it cannot score', () => {
    const home = makeHome(root);
    const row = {
      id: 'R-1',
      kind: 'fact',
      subject: 'R-1 subject',
      content: 'c',
      useful: true,
      questionDay: 5,
      lastUsedAgeDays: 0,
      hits: 0,
      salience: 0.5,
    };
    writeFileSync(join(home, 'rows.jsonl'), `${JSON.stringify(row)}\n`);
    expect(
      loadRetentionSeed(
        home,
        retentionOptionsSchema.parse({ rowsFile: 'rows.jsonl' }),
      ),
    ).toEqual([row]);
    writeFileSync(
      join(home, 'rows.jsonl'),
      `${JSON.stringify(row)}\n${JSON.stringify({ ...row, id: 'R-2' })}\n`,
    );
    expect(() =>
      loadRetentionSeed(
        home,
        retentionOptionsSchema.parse({ rowsFile: 'rows.jsonl' }),
      ),
    ).toThrow(/repeats subject/);
    writeFileSync(
      join(home, 'rows.jsonl'),
      `${JSON.stringify({ ...row, questionDay: null })}\n`,
    );
    expect(() =>
      loadRetentionSeed(
        home,
        retentionOptionsSchema.parse({ rowsFile: 'rows.jsonl' }),
      ),
    ).toThrow(/question day/);
    expect(() => retentionOptionsSchema.parse({ days: 400 })).toThrow();
    expect(() =>
      retentionOptionsSchema.parse({ growth: { observationsPerSession: 20 } }),
    ).toThrow();
  });

  it('draws usage independently of the label unless the plan says otherwise', () => {
    const facts = [] as never[];
    const distractors = [{ id: 'D-1', text: 'one two three' }];
    const a = buildRetentionSeed({
      facts,
      distractors,
      seed: 's',
      days: 10,
      usage: {
        useful: DEFAULT_USAGE_DISTRIBUTION,
        disposable: DEFAULT_USAGE_DISTRIBUTION,
      },
    });
    const b = buildRetentionSeed({
      facts,
      distractors,
      seed: 's',
      days: 10,
      usage: {
        useful: DEFAULT_USAGE_DISTRIBUTION,
        disposable: [{ weight: 1, lastUsedAgeDays: [200, 200], hits: [7, 7] }],
      },
    });
    expect(a[0].subject).toBe('D-1 one two three');
    expect(b[0]).toMatchObject({ lastUsedAgeDays: 200, hits: 7 });
  });

  it('parses the roster list and nothing after it', () => {
    expect(parseRosterSubjects('')).toEqual([]);
    expect(
      parseRosterSubjects(
        [
          '## Workspace Memory Snapshot',
          '',
          'Recent observations curated for this workspace (2):',
          '',
          '1. a b',
          '2. c',
          '',
          'Available knowledge corpora (1):',
          '',
          '1. corpus (3)',
          '',
          '---',
        ].join('\n'),
      ),
    ).toEqual(['a b', 'c']);
  });
});
