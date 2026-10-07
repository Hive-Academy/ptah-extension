import 'reflect-metadata';

jest.mock('vscode', () => ({}), { virtual: true });
// The JSONL reader and the curator report resolve `~` through `os.homedir()`.
jest.mock('os', () => {
  const actual = jest.requireActual<typeof import('os')>('os');
  const nodePath = jest.requireActual<typeof import('path')>('path');
  return {
    ...actual,
    homedir: () => nodePath.join(actual.tmpdir(), 'ptah-620-lifecycle-home'),
  };
});
jest.mock('node:os', () => {
  const actual = jest.requireActual<typeof import('os')>('os');
  const nodePath = jest.requireActual<typeof import('path')>('path');
  return {
    ...actual,
    homedir: () => nodePath.join(actual.tmpdir(), 'ptah-620-lifecycle-home'),
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
import { p95, sessionsOnDay, slope } from './funnel-backlog';
import { interleavingPoints } from './funnel-lifecycle';
import { createFunnelSuites, FUNNEL_SUITE_IDS } from './funnel.suite';

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

type Key = 'promote' | 'retire' | 'delivery' | 'backlog';

function invariant(
  result: ReturnType<typeof readSuiteResult>['result'],
  id: string,
) {
  return funnelDetailsSchema
    .parse(result.details)
    .stages[0].invariants.find((inv) => inv.id === id);
}

describe('skill.funnel lifecycle suites over production DI (synthetic cassette)', () => {
  const root = join(tmpdir(), 'ptah-620-lifecycle-spec');
  const runDir = join(root, 'run');
  let spec: FunnelSpecContainer;
  let run: (
    key: Key,
    options?: unknown,
  ) => Promise<ReturnType<typeof readSuiteResult>>;

  beforeAll(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(homedir(), { recursive: true, force: true });
    mkdirSync(join(homedir(), 'memory-skills'), { recursive: true });
    cpSync(FIXTURE_DIR, join(homedir(), 'memory-skills', 'skill-sessions.v1'), {
      recursive: true,
    });
    spec = funnelSpecContainer({
      root: homedir(),
      cassettePath: join(root, 'lifecycle.synthetic.jsonl'),
      mode: 'record',
      inner: new SyntheticLane(),
    });
    const suites = createFunnelSuites({
      portsOf: (context) =>
        funnelPortsOver({
          container: context.container,
          home: context.isolation.home,
          laneRunner: spec.laneRunner,
        }),
    });
    run = async (key, options = {}) => {
      const suite = suites.find((s) => s.id === FUNNEL_SUITE_IDS[key]);
      if (!suite) throw new Error(`no suite ${key}`);
      expect(suite.placement).toBe('last');
      const context: MemorySkillsHostSuiteContext = {
        runId: 'spec-lifecycle',
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
      await suite.run(context);
      return readSuiteResult(runDir, FUNNEL_SUITE_IDS[key]);
    };
  });

  afterAll(() => {
    spec?.dispose();
    rmSync(root, { recursive: true, force: true });
    rmSync(homedir(), { recursive: true, force: true });
  });

  it('promote: trigger-recorded uses never reach the success counter; the cap race has no interleaving point', async () => {
    const { result, cases } = await run('promote');
    expect(result.metrics['promote.eventsRecorded']).toBe(3);
    expect(result.metrics['promote.successCount']).toBe(0);
    expect(
      invariant(result, 'invocations-reach-success-counter'),
    ).toMatchObject({ pass: false, violations: 1 });
    expect(invariant(result, 'distinct-contexts-counted')?.pass).toBe(false);
    expect(invariant(result, 'automatic-promotion-after-uses')?.pass).toBe(
      false,
    );
    expect(result.metrics['promote.racesExercised']).toBe(3);
    expect(result.metrics['promote.interleavingPoints']).toBe(0);
    expect(invariant(result, 'cap-holds-under-interleaving')?.pass).toBe(true);
    for (const schedule of ['a-then-b', 'b-then-a', 'alternating']) {
      expect(cases.find((c) => c.caseId === `race:${schedule}`)).toMatchObject({
        outcome: 'pass',
        observed: expect.stringContaining('no-interleaving-point'),
      });
    }
    expect(result.verdict).toBe('fail');
    expect(result.cassetteVersion).toBe('funnel.v1');
  }, 120_000);

  it('retire: a use at commit time does not save the skill; the boot reconcile deletes a promoted dir; the wait has no timeout', async () => {
    const { result, cases } = await run('retire', { reconcileCapMs: 2_000 });
    expect(result.metrics['retire.retireAfterDormantDays']).toBe(30);
    expect(cases.find((c) => c.caseId === 'retire:idle-control')?.outcome).toBe(
      'pass',
    );
    expect(
      cases.find((c) => c.caseId === 'retire:use-inside-window')?.outcome,
    ).toBe('pass');
    expect(
      cases.find((c) => c.caseId === 'retire:use-at-commit'),
    ).toMatchObject({
      outcome: 'fail',
      observed: 'retired; use recorded at re-read: true',
    });
    expect(invariant(result, 'used-skill-never-retired')).toMatchObject({
      pass: false,
      violations: 1,
    });
    expect(
      invariant(result, 'reconcile-never-deletes-promoted-dir'),
    ).toMatchObject({ pass: false, violations: 1 });
    expect(
      cases.find((c) => c.caseId === 'reconcile:wait-timeout'),
    ).toMatchObject({
      outcome: 'fail',
      error: 'safety-cap',
    });
    expect(invariant(result, 'reconcile-wait-times-out')?.pass).toBe(false);
    expect(result.verdict).toBe('fail');
    expect(result.cassetteVersion).toBeNull();
  }, 120_000);

  it('delivery: without a harness propagation service both checks stay open (na)', async () => {
    const { result } = await run('delivery');
    expect(result.verdict).toBe('na');
    expect(result.naReason).toMatch(/no harness propagation service/);
  }, 120_000);

  it('backlog drain: the scripted load runs on the simulated clock with exact rates', async () => {
    const { result } = await run('backlog', {
      backlog: { days: 2, sessionsPerWeek: 70 },
    });
    const details = funnelDetailsSchema.parse(result.details);
    expect(result.metrics['backlog.enqueued']).toBe(20);
    expect(result.metrics['backlog.ticks']).toBe(2 * 96 + 2);
    expect(details.backlog?.map((row) => row.stage)).toEqual([
      'prefilter',
      'archaeology',
      'judge-panel',
      'trigger-eval',
    ]);
    const num = result.metrics['backlog.judgedShare.num'] ?? 0;
    const den = result.metrics['backlog.judgedShare.den'] ?? 0;
    expect(result.metrics['backlog.judgedShare']).toBe(
      den === 0 ? null : num / den,
    );
    expect(invariant(result, 'drain-ticks-without-error')?.pass).toBe(true);
    expect(['pass', 'fail', 'na']).toContain(result.verdict);
  }, 300_000);
});

describe('lifecycle arithmetic', () => {
  it('deals a weekly rate into whole sessions per day', () => {
    const week = Array.from({ length: 7 }, (_, day) => sessionsOnDay(day, 163));
    expect(week.reduce((a, b) => a + b, 0)).toBe(163);
    expect(Math.max(...week) - Math.min(...week)).toBeLessThanOrEqual(1);
  });

  it('fits a least-squares slope and a nearest-rank p95', () => {
    expect(slope([0, 2, 4, 6])).toBe(2);
    expect(slope([5])).toBeNull();
    expect(p95([])).toBeNull();
    expect(p95(Array.from({ length: 20 }, (_, i) => i + 1))).toBe(19);
  });

  it('counts an interleaving point only between a promotion read and its compare-and-set', () => {
    expect(
      interleavingPoints(
        ['pause:a', 'pause:b', 'read:a', 'cas:a', 'read:b', 'cas:b'],
        ['a', 'b'],
      ),
    ).toBe(0);
    expect(interleavingPoints(['read:a', 'pause:b', 'cas:a'], ['a', 'b'])).toBe(
      1,
    );
  });
});
