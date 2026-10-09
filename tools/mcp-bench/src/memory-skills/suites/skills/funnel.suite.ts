/**
 * The skills funnel host suites (benchmark-design.md 4.4, Batch 22):
 *
 *  - `skill.funnel.{prefilter,archaeology,cluster,draft,judge,feed-parity,replay}`
 *    (Task 22.1) score ONE scripted pass of `gt-skill-sessions@v1` through the
 *    real funnel; the first of them to run in a host run executes the pass and
 *    the rest score the same observation (`funnel-stages.ts`);
 *  - `skill.funnel.{promote,retire,delivery}` and `skill.backlog.drain`
 *    (Task 22.2) each run their own scenario (`funnel-lifecycle.ts`).
 *
 * Each suite writes one `funnel` result (`<suiteId>.suite.json`) whose
 * `details.stages` holds its stage with `in`/`out` and every evaluated
 * invariant. Time runs on the injected clock (`installFunnelClock`), restored
 * in the suite's own `finally`.
 *
 * Every suite writes the isolated database and skills directory (queue rows,
 * candidates, promotions, retirements, 30 simulated days of drain), so each
 * declares `placement: 'last'` (`host/suite-placement.ts`).
 *
 * The product port is injected: the host entry passes `hostFunnelPorts`
 * (`funnel-host-port.ts`, host-only); this module imports its types only.
 *
 * Imports only Node, zod and modules the runner parent may load.
 */

import { isAbsolute } from 'node:path';

import { z } from 'zod';

import type {
  MemorySkillsHostSuite,
  MemorySkillsHostSuiteContext,
} from '../../host/memory-skills-host';
import { SAFETY_CAP_MS } from '../../runner/case-runner';
import { writeSuiteResult } from '../../runner/suite-result';
import {
  DEFAULT_FUNNEL_SESSIONS_DIR,
  FUNNEL_FIXTURE_ID,
  loadFunnelFixture,
  type FunnelFixture,
} from './funnel-fixture';
import {
  lifecycleOutcome,
  runDeliveryScenario,
  runPromoteScenario,
  runReconcileWaitCase,
  runRetireScenario,
  scoreDelivery,
  scorePromote,
  scoreRetire,
} from './funnel-lifecycle';
import { runBacklogScenario, scoreBacklog } from './funnel-backlog';
import {
  installFunnelClock,
  type FunnelClock,
  type FunnelLaneStats,
  type FunnelPorts,
} from './funnel-port';
import {
  notEvaluated,
  runCase,
  runOnceUnderCap,
  stageSuiteResult,
  type FunnelRunOutcome,
  type StageScore,
  type StageSuiteMeta,
} from './funnel-report';
import {
  FUNNEL_STAGE_SCORERS,
  REPLAY_DOCS_PHRASE,
  runFunnelPass,
  type FunnelPass,
} from './funnel-stages';

export const FUNNEL_SUITE_IDS = {
  prefilter: 'skill.funnel.prefilter',
  archaeology: 'skill.funnel.archaeology',
  cluster: 'skill.funnel.cluster',
  draft: 'skill.funnel.draft',
  judge: 'skill.funnel.judge',
  'feed-parity': 'skill.funnel.feed-parity',
  replay: 'skill.funnel.replay',
  promote: 'skill.funnel.promote',
  retire: 'skill.funnel.retire',
  delivery: 'skill.funnel.delivery',
  backlog: 'skill.backlog.drain',
} as const;

const nonEmpty = z.string().min(1);

export const funnelOptionsSchema = z.strictObject({
  /** `gt-skill-sessions@v1` in the isolated home (home-relative). */
  sessionsDir: nonEmpty.default(DEFAULT_FUNNEL_SESSIONS_DIR),
  /** Safety cap per run; default `SAFETY_CAP_MS` (120 s, design 4.4). */
  capMs: z.number().int().positive().optional(),
  /**
   * Cap of the reconcile-wait case alone (design 4.4: today the wait has no
   * timeout, so this case ends at the cap). Default `SAFETY_CAP_MS`.
   */
  reconcileCapMs: z.number().int().positive().optional(),
  /** Cassette version recorded on lane-driven suites. */
  cassetteVersion: nonEmpty.default('funnel.v1'),
  /** C-S8 docs check; absent ⇒ that replay invariant is not evaluated. */
  replayDocs: z
    .strictObject({
      file: nonEmpty.refine((value) => isAbsolute(value), {
        message: 'must be an absolute path',
      }),
      phrase: nonEmpty.default(REPLAY_DOCS_PHRASE),
    })
    .optional(),
  backlog: z
    .strictObject({
      days: z.number().int().min(1).max(60).default(30),
      /**
       * Design 4.4: the snapshot's measured weekly rate within 50-470/week.
       * Default 163: the measured prefilter-eligible sessions per week the
       * drain's weekly cap was sized on (`skill-drain.service.ts:471-473`).
       */
      sessionsPerWeek: z.number().int().min(50).max(470).default(163),
    })
    .default({ days: 30, sessionsPerWeek: 163 }),
});
export type FunnelOptions = z.infer<typeof funnelOptionsSchema>;

export type FunnelPortsOf = (
  context: MemorySkillsHostSuiteContext,
) => FunnelPorts;

type Stage22 = keyof typeof FUNNEL_STAGE_SCORERS;

const STAGE_CLAIMS: Record<Stage22, StageSuiteMeta['claim']> = {
  prefilter: {
    source: 'ledger',
    ref: '461',
    text: 'the stricter prefilter keeps real routines',
  },
  archaeology: {
    source: 'ledger',
    ref: '588',
    text: 'archaeology before authoring; a degraded or no-routine verdict yields no candidate',
  },
  cluster: {
    source: 'ledger',
    ref: '588',
    text: 'a cluster spans at least two sessions; no single-session auto-candidate',
  },
  draft: {
    source: 'ledger',
    ref: '471 decision 6',
    text: 'a template fallback is marked and never judged',
  },
  judge: {
    source: 'ledger',
    ref: '471 decisions 7, 9',
    text: 'every non-fallback draft gets a judge-panel row; constant scorecard shape. Scope: fixture scale (gt-skill-sessions@v1, one drain cycle); does not close the 471 decision-7 copy-scale backlog row (2,347 unjudged), which skill.backlog.drain and the backlog audit measure',
  },
  'feed-parity': {
    source: 'ledger',
    ref: '586',
    text: 'the activity feed shows exactly what the pipeline did, also after a restart',
  },
  replay: { source: 'ledger', ref: 'forensics C-S8', text: REPLAY_DOCS_PHRASE },
};

const SESSIONS_GROUND_TRUTH: StageSuiteMeta['groundTruth'] = {
  id: 'gt-skill-sessions',
  version: 'v1',
  method: 'generated',
};
const SCENARIO_GROUND_TRUTH: StageSuiteMeta['groundTruth'] = {
  id: 'skill-funnel-lifecycle-scenarios',
  version: 'v1',
  method: 'seeded',
};

interface ClosablePort {
  laneStats(): FunnelLaneStats;
  close(): Promise<void>;
}

type LifecycleMeta = Omit<
  StageSuiteMeta,
  'suiteId' | 'fixtureId' | 'cassetteVersion'
> & {
  readonly usesLane: boolean;
  /** Cap added to `capMs` for a scenario that runs its own capped case. */
  readonly extraCapMs?: (options: FunnelOptions) => number;
};

function failedScore(
  stage: StageScore['stage'],
  run: FunnelRunOutcome,
): StageScore {
  return {
    stage,
    in: 0,
    out: 0,
    invariants: [notEvaluated('run', run.error ?? 'no observation')],
    metrics: {},
    cases: [],
  };
}

function write(
  context: MemorySkillsHostSuiteContext,
  meta: StageSuiteMeta,
  run: FunnelRunOutcome,
  score: StageScore,
  withRun: boolean,
): void {
  const scored = withRun
    ? {
        ...score,
        cases: [
          runCase(`${score.stage}-run`, meta.suiteId, run),
          ...score.cases,
        ],
      }
    : score;
  const { result, cases } = stageSuiteResult(meta, run, scored);
  writeSuiteResult(context.runDir, result, cases);
}

/** A plan whose funnel suites disagree on the shared pass's options. */
export class FunnelPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FunnelPlanError';
  }
}

/** The options that shape the shared 22.1 pass, canonically. */
function sharedPassKey(options: FunnelOptions): string {
  return JSON.stringify({
    sessionsDir: options.sessionsDir,
    capMs: options.capMs ?? null,
  });
}

/** The seven suite ids that score the shared 22.1 pass. */
export const FUNNEL_PASS_SUITE_IDS: readonly string[] = (
  Object.keys(FUNNEL_STAGE_SCORERS) as Stage22[]
).map((stage) => FUNNEL_SUITE_IDS[stage]);

/**
 * Plan-time check (pure): every listed 22.1 stage suite must give the shared
 * pass the same `sessionsDir` and `capMs`. The runner parent and the host plan
 * schema call this before any suite runs; each suite also refuses at run time.
 */
export function funnelPlanProblems(
  suites: readonly { readonly id: string; readonly options?: unknown }[],
): string[] {
  const keys = new Map<string, string[]>();
  const problems: string[] = [];
  for (const suite of suites) {
    if (!FUNNEL_PASS_SUITE_IDS.includes(suite.id)) continue;
    const parsed = funnelOptionsSchema.safeParse(suite.options ?? {});
    if (!parsed.success) {
      problems.push(`suite ${suite.id} has invalid funnel options`);
      continue;
    }
    const key = sharedPassKey(parsed.data);
    keys.set(key, [...(keys.get(key) ?? []), suite.id]);
  }
  if (keys.size > 1) {
    problems.push(
      `funnel stage suites share one pass but disagree on sessionsDir/capMs: ${[
        ...keys.entries(),
      ]
        .map(([key, ids]) => `${ids.join(', ')} -> ${key}`)
        .join('; ')}`,
    );
  }
  return problems;
}

/** All eleven funnel suites over the injected product ports. */
export function createFunnelSuites(deps: {
  readonly portsOf: FunnelPortsOf;
  /** Test seam for deterministic calendar scenarios; production uses real now. */
  readonly installClock?: () => FunnelClock;
}): readonly MemorySkillsHostSuite[] {
  const installClock = deps.installClock ?? installFunnelClock;
  // One 22.1 pass per host run, shared by the seven stage suites.
  const passes = new Map<
    string,
    {
      readonly shared: string;
      readonly run: Promise<{ fixture: FunnelFixture; pass: FunnelPass }>;
    }
  >();

  const passFor = (
    context: MemorySkillsHostSuiteContext,
    options: FunnelOptions,
  ) => {
    const shared = sharedPassKey(options);
    const existing = passes.get(context.runId);
    if (existing !== undefined) {
      // A later stage suite scores the pass the first one ran; it may not ask
      // for a different one (Phase 3.6 review finding 3).
      if (existing.shared !== shared) {
        throw new FunnelPlanError(
          `the shared funnel pass ran with ${existing.shared}; this suite asks for ${shared}`,
        );
      }
      return existing.run;
    }
    const started = (async () => {
      const fixture = loadFunnelFixture(
        context.isolation.home,
        options.sessionsDir,
      );
      const clock = installClock();
      try {
        const pass = await runFunnelPass(
          deps.portsOf(context).run(),
          fixture,
          clock,
          options.capMs,
        );
        return { fixture, pass };
      } finally {
        clock.restore();
      }
    })();
    passes.set(context.runId, { shared, run: started });
    return started;
  };

  const stageSuite = (stage: Stage22): MemorySkillsHostSuite => ({
    id: FUNNEL_SUITE_IDS[stage],
    placement: 'last',
    async run(context) {
      const options = funnelOptionsSchema.parse(context.options ?? {});
      const { fixture, pass } = await passFor(context, options);
      const score = FUNNEL_STAGE_SCORERS[stage]({
        fixture,
        pass,
        ...(options.replayDocs === undefined
          ? {}
          : { replayDocs: options.replayDocs }),
      });
      write(
        context,
        {
          suiteId: FUNNEL_SUITE_IDS[stage],
          claim: STAGE_CLAIMS[stage],
          groundTruth: SESSIONS_GROUND_TRUTH,
          fixtureId: FUNNEL_FIXTURE_ID,
          cassetteVersion: options.cassetteVersion,
        },
        pass.outcome,
        score,
        false,
      );
    },
  });

  /**
   * A 22.2 suite: its scenario runs once under the cap on a fresh clock; the
   * port is closed and the clock restored whatever happens.
   */
  const lifecycleSuite = <P extends ClosablePort, T>(
    key: 'promote' | 'retire' | 'delivery' | 'backlog',
    stage: StageScore['stage'],
    meta: LifecycleMeta,
    open: (ports: FunnelPorts) => P,
    scenario: (
      port: P,
      context: MemorySkillsHostSuiteContext,
      options: FunnelOptions,
      clock: FunnelClock,
    ) => Promise<{ value: T; operations: number }>,
    score: (value: T) => StageScore,
  ): MemorySkillsHostSuite => ({
    id: FUNNEL_SUITE_IDS[key],
    placement: 'last',
    async run(context) {
      const options = funnelOptionsSchema.parse(context.options ?? {});
      const port = open(deps.portsOf(context));
      const clock = installClock();
      let operations = 0;
      let outcome: FunnelRunOutcome;
      let scored: StageScore;
      try {
        const run = await runOnceUnderCap(
          async () => {
            const result = await scenario(port, context, options, clock);
            operations = result.operations;
            return result.value;
          },
          (options.capMs ?? SAFETY_CAP_MS) + (meta.extraCapMs?.(options) ?? 0),
        );
        outcome = lifecycleOutcome(run, port.laneStats(), operations);
        scored =
          run.outcome === 'completed'
            ? score(run.value)
            : failedScore(stage, outcome);
      } finally {
        try {
          await port.close();
        } finally {
          clock.restore();
        }
      }
      write(
        context,
        {
          suiteId: FUNNEL_SUITE_IDS[key],
          claim: meta.claim,
          groundTruth: meta.groundTruth,
          fixtureId:
            meta.groundTruth.id === SESSIONS_GROUND_TRUTH.id
              ? FUNNEL_FIXTURE_ID
              : `${meta.groundTruth.id}@${meta.groundTruth.version}`,
          cassetteVersion: meta.usesLane ? options.cassetteVersion : null,
        },
        outcome,
        scored,
        true,
      );
    },
  });

  return [
    stageSuite('prefilter'),
    stageSuite('archaeology'),
    stageSuite('cluster'),
    stageSuite('draft'),
    stageSuite('judge'),
    stageSuite('feed-parity'),
    stageSuite('replay'),
    lifecycleSuite(
      'promote',
      'promote',
      {
        claim: {
          source: 'ledger',
          ref: '471 decision 7; 578 P1',
          text: 'real uses reach the success counter and promote automatically; the cap holds under interleaved promotions',
        },
        groundTruth: SCENARIO_GROUND_TRUTH,
        usesLane: true,
      },
      (ports) => ports.lifecycle(),
      async (port, _context, _options, clock) => {
        const value = await runPromoteScenario(port, clock);
        return { value, operations: value.uses + 1 + value.races.length };
      },
      scorePromote,
    ),
    lifecycleSuite(
      'retire',
      'retire',
      {
        claim: {
          source: 'ledger',
          ref: '578 P1',
          text: 'a used skill is never retired; boot reconcile keeps promoted dirs; the reconcile wait is bounded',
        },
        groundTruth: SCENARIO_GROUND_TRUTH,
        usesLane: false,
        // The reconcile-wait case runs inside this scenario under its own cap.
        extraCapMs: (options) => options.reconcileCapMs ?? SAFETY_CAP_MS,
      },
      (ports) => ports.lifecycle(),
      async (port, _context, options, clock) => {
        const observation = await runRetireScenario(port, clock);
        const wait = await runReconcileWaitCase(
          port,
          clock,
          options.reconcileCapMs,
        );
        return { value: { observation, wait }, operations: 4 };
      },
      ({ observation, wait }) => scoreRetire(observation, wait),
    ),
    lifecycleSuite(
      'delivery',
      'delivery',
      {
        claim: {
          source: 'ledger',
          ref: 'forensics C-S3',
          text: "a promoted skill appears in a fresh workspace's .claude/skills",
        },
        groundTruth: SCENARIO_GROUND_TRUTH,
        usesLane: true,
      },
      (ports) => ports.lifecycle(),
      async (port, _context, _options, clock) => {
        const value = await runDeliveryScenario(port, clock);
        return { value, operations: 2 };
      },
      scoreDelivery,
    ),
    lifecycleSuite(
      'backlog',
      'backlog-drain',
      {
        claim: {
          source: 'ledger',
          ref: 'forensics failure #9, S4',
          text: 'the drain keeps up with the measured session rate',
        },
        groundTruth: SESSIONS_GROUND_TRUTH,
        usesLane: true,
      },
      (ports) => ports.backlog(),
      async (port, context, options, clock) => {
        const fixture = loadFunnelFixture(
          context.isolation.home,
          options.sessionsDir,
        );
        const routineIds = new Set(
          fixture.sessions.filter((s) => s.routine !== null).map((s) => s.id),
        );
        const templates = fixture.files.filter((file) =>
          routineIds.has(file.id),
        );
        const value = await runBacklogScenario(
          port,
          templates,
          options.backlog,
          clock,
        );
        return { value, operations: value.enqueued + value.ticks };
      },
      scoreBacklog,
    ),
  ];
}
