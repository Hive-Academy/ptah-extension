import 'reflect-metadata';

jest.mock('vscode', () => ({}), { virtual: true });
// The JSONL reader and the curator report resolve `~` through `os.homedir()`.
jest.mock('os', () => {
  const actual = jest.requireActual<typeof import('os')>('os');
  const nodePath = jest.requireActual<typeof import('path')>('path');
  return {
    ...actual,
    homedir: () => nodePath.join(actual.tmpdir(), 'ptah-620-funnel-home'),
  };
});
jest.mock('node:os', () => {
  const actual = jest.requireActual<typeof import('os')>('os');
  const nodePath = jest.requireActual<typeof import('path')>('path');
  return {
    ...actual,
    homedir: () => nodePath.join(actual.tmpdir(), 'ptah-620-funnel-home'),
  };
});

import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { MemorySkillsHostSuiteContext } from '../../host/memory-skills-host';
import { funnelDetailsSchema } from '../../memory-skills-suite-kinds';
import { readSuiteResult } from '../../runner/suite-result';
import {
  funnelSpecContainer,
  SyntheticLane,
  type FunnelSpecContainer,
} from './funnel-di.test-support';
import { funnelPortsOver } from './funnel-host-port';
import { createFunnelSuites, FUNNEL_SUITE_IDS } from './funnel.suite';
import { feedDiff } from './funnel-stages';

const FIXTURE_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'memory-skills',
  'skill-sessions.v1',
);
const STAGES = [
  'prefilter',
  'archaeology',
  'cluster',
  'draft',
  'judge',
  'feed-parity',
  'replay',
] as const;
const ROUTINE = Array.from(
  { length: 12 },
  (_, i) => `skill-session-${String(i + 1).padStart(2, '0')}`,
);

function contextFor(
  spec: FunnelSpecContainer,
  runDir: string,
  options: unknown,
): MemorySkillsHostSuiteContext {
  return {
    runId: 'spec-run',
    runDir,
    options,
    workspaceRoot: join(homedir(), 'host-workspace'),
    isolation: {
      home: homedir(),
      userDataPath: join(homedir(), '.ptah'),
      dbPath: join(homedir(), 'skills.sqlite'),
    },
    container: spec.container,
    doubles: {
      mode: 'record',
      laneRunner: spec.laneRunner,
    } as unknown as MemorySkillsHostSuiteContext['doubles'],
    ci: false,
  };
}

async function runStages(
  spec: FunnelSpecContainer,
  runDir: string,
  options: unknown,
) {
  const suites = createFunnelSuites({
    portsOf: (context) =>
      funnelPortsOver({
        container: context.container,
        home: context.isolation.home,
        laneRunner: spec.laneRunner,
      }),
  });
  const context = contextFor(spec, runDir, options);
  for (const stage of STAGES) {
    const suite = suites.find((s) => s.id === FUNNEL_SUITE_IDS[stage]);
    if (!suite) throw new Error(`no suite for ${stage}`);
    expect(suite.placement).toBe('last');
    await suite.run(context);
  }
  return Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      readSuiteResult(runDir, FUNNEL_SUITE_IDS[stage]),
    ]),
  ) as Record<(typeof STAGES)[number], ReturnType<typeof readSuiteResult>>;
}

function invariant(
  result: ReturnType<typeof readSuiteResult>['result'],
  id: string,
) {
  const details = funnelDetailsSchema.parse(result.details);
  return details.stages[0].invariants.find((inv) => inv.id === id);
}

function seedHome(): void {
  rmSync(homedir(), { recursive: true, force: true });
  mkdirSync(join(homedir(), 'memory-skills'), { recursive: true });
  cpSync(FIXTURE_DIR, join(homedir(), 'memory-skills', 'skill-sessions.v1'), {
    recursive: true,
  });
}

describe('skill.funnel stage suites over production DI (synthetic cassette)', () => {
  const root = join(tmpdir(), 'ptah-620-funnel-spec');
  let spec: FunnelSpecContainer;
  let results: Awaited<ReturnType<typeof runStages>>;
  let lane: SyntheticLane;

  beforeAll(async () => {
    rmSync(root, { recursive: true, force: true });
    seedHome();
    lane = new SyntheticLane();
    spec = funnelSpecContainer({
      root: homedir(),
      cassettePath: join(root, 'funnel.synthetic.jsonl'),
      mode: 'record',
      inner: lane,
    });
    results = await runStages(spec, join(root, 'run'), { capMs: 120_000 });
  }, 180_000);

  afterAll(() => {
    spec?.dispose();
    rmSync(root, { recursive: true, force: true });
    rmSync(homedir(), { recursive: true, force: true });
  });

  it('writes one valid funnel result per stage, every rate value = num / den', () => {
    for (const stage of STAGES) {
      const { result, cases } = results[stage];
      expect(result.kind).toBe('funnel');
      const details = funnelDetailsSchema.parse(result.details);
      expect(details.fixtureId).toBe('gt-skill-sessions@v1');
      expect(details.stages).toHaveLength(1);
      expect(details.stages[0].stage).toBe(stage);
      expect(cases[0].caseId).toBe('funnel-run');
      expect(cases[0].outcome).toBe('pass');
      for (const [key, value] of Object.entries(result.metrics)) {
        if (!key.endsWith('.num')) continue;
        const name = key.slice(0, -'.num'.length);
        const den = result.metrics[`${name}.den`];
        expect(result.metrics[name]).toBe(
          den === 0 ? null : (value ?? 0) / (den ?? 1),
        );
      }
      expect(result.metrics['lane.misses']).toBe(0);
    }
  });

  it('prefilter: every routine session drafts a candidate; single edits pass too', () => {
    const { result } = results.prefilter;
    // RPC analyzeNow is not registered in this container: 4 manual sessions excluded.
    expect(result.metrics['prefilter.in']).toBe(26);
    expect(result.metrics['prefilter.recall.num']).toBe(12);
    expect(result.metrics['prefilter.recall.den']).toBe(12);
    expect(result.metrics['prefilter.precision.den']).toBe(15);
    expect(result.baselines[0].metrics['prefilter.precision.num']).toBe(12);
    expect(result.baselines[0].metrics['prefilter.precision.den']).toBe(26);
    expect(invariant(result, 'recall-routine-ge-0.9')?.pass).toBe(true);
    expect(result.verdict).toBe('na');
    expect(result.naReason).toMatch(/manual-analyze-sessions/);
  });

  it('archaeology runs after authoring, so the before-authoring invariant fails', () => {
    const { result } = results.archaeology;
    const before = invariant(result, 'runs-before-authoring');
    expect(before?.pass).toBe(false);
    expect(before?.violations).toBe(15);
    expect(result.verdict).toBe('fail');
    expect(result.metrics['archaeology.routineAccuracy.den']).toBe(15);
  });

  it('cluster: every candidate is a single-session auto-candidate', () => {
    const { result } = results.cluster;
    expect(invariant(result, 'no-single-session-auto-candidate')).toMatchObject(
      {
        pass: false,
        violations: 15,
      },
    );
    expect(result.verdict).toBe('fail');
  });

  it('draft: no template fallback in a fully answered run ⇒ na, never a vacuous pass', () => {
    const { result } = results.draft;
    expect(result.metrics['draft.fallbacks']).toBe(0);
    expect(result.verdict).toBe('na');
    expect(result.naReason).toMatch(/fallback-never-judged/);
  });

  it('judge: the weekly tick gives every non-fallback draft a panel row of constant shape', () => {
    const { result } = results.judge;
    expect(result.metrics['judge.panelShare.den']).toBe(15);
    expect(result.metrics['judge.panelShare.num']).toBe(15);
    expect(invariant(result, 'panel-row-within-one-cycle')?.pass).toBe(true);
    expect(invariant(result, 'panel-scorecard-shape-constant')?.pass).toBe(
      true,
    );
    expect(result.verdict).toBe('pass');
  });

  it('feed-parity: single edits add phantom analyze-run events and the feed is lost on restart', () => {
    const { result, cases } = results['feed-parity'];
    expect(invariant(result, 'feed-survives-restart')?.pass).toBe(false);
    const singleEdit = cases.find((c) => c.caseId === 'skill-session-20:feed');
    expect(singleEdit).toMatchObject({ expected: '(none)', outcome: 'fail' });
    for (const id of ROUTINE) {
      expect(cases.find((c) => c.caseId === `${id}:feed`)?.outcome).toBe(
        'pass',
      );
    }
    expect(
      cases.find((c) => c.caseId === 'skill-session-15:feed'),
    ).toMatchObject({
      expected: 'idle-trigger > ineligible:prefilterRejected',
    });
    expect(result.verdict).toBe('fail');
  });

  it('replay: coverage is 0; the docs half stays open without options.replayDocs', () => {
    const { result } = results.replay;
    expect(invariant(result, 'replay-coverage-zero')?.pass).toBe(true);
    expect(result.metrics['replay.coverage.num']).toBe(0);
    expect(result.verdict).toBe('na');
    expect(result.naReason).toMatch(/docs-say-not-running/);
  });

  it('made every model call through the record double and its synthetic inner lane', () => {
    expect(lane.calls.length).toBeGreaterThan(0);
    expect(results.prefilter.result.modelCalls).toBe(lane.calls.length);
  });
});

describe('skill.funnel stage suites with an empty replay cassette', () => {
  const root = join(tmpdir(), 'ptah-620-funnel-miss');
  let spec: FunnelSpecContainer;

  afterAll(() => {
    spec?.dispose();
    rmSync(root, { recursive: true, force: true });
    rmSync(homedir(), { recursive: true, force: true });
  });

  it('reports na cassette-miss on every stage (R-M5): a swallowed miss is never scored', async () => {
    rmSync(root, { recursive: true, force: true });
    seedHome();
    spec = funnelSpecContainer({
      root: homedir(),
      cassettePath: join(root, 'empty.jsonl'),
      mode: 'replay',
    });
    const results = await runStages(spec, join(root, 'run'), {});
    for (const stage of STAGES) {
      expect(results[stage].result.verdict).toBe('na');
      expect(results[stage].result.naReason).toBe('cassette-miss');
      expect(results[stage].result.metrics['lane.misses']).toBeGreaterThan(0);
    }
  }, 180_000);
});

describe('feedDiff', () => {
  it('separates missing, phantom and order-only differences', () => {
    expect(feedDiff(['a', 'b'], ['b', 'a'])).toEqual({
      missing: [],
      phantom: [],
      orderOnly: true,
    });
    expect(feedDiff(['manual-run', 'x'], ['x', 'analyze-run'])).toEqual({
      missing: ['manual-run'],
      phantom: ['analyze-run'],
      orderOnly: false,
    });
  });
});
