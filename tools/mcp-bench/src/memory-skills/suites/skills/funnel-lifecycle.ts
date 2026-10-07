/**
 * Task 22.2 (benchmark-design.md 4.4): the promote, retire and delivery stages
 * and `skill.backlog.drain`, each over the real product services
 * (`FunnelLifecyclePort` / `FunnelBacklogPort`) on the injected clock.
 *
 * Scenario state (candidates, promoted skills, accepted suggestions) is
 * seeded through the product's own stores and generator; what is scored is
 * what the product then does with it. Wall-clock time is never asserted and
 * never written: every time below is an offset on the simulated clock.
 *
 * Imports only Node, zod and parent-loadable modules.
 */

import { join } from 'node:path';

import type { CaseRecord } from '../../runner/suite-result';
import type {
  FunnelClock,
  FunnelDrainTick,
  FunnelLifecyclePort,
  FunnelLifecycleSettings,
  FunnelRaceObservation,
  FunnelRaceSchedule,
} from './funnel-port';
import {
  invariantOf,
  notEvaluated,
  runOnceUnderCap,
  scoredCase,
  type FunnelRunOutcome,
  type InvariantResult,
  type StageScore,
} from './funnel-report';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const QUARTER_HOUR_MS = 15 * 60_000;
/**
 * The bench's bound for the reconcile wait (design 4.4: "once the injected
 * clock passes the bound"). The product has no bound today; any finite one
 * makes the point. The clock is advanced twice this far.
 */
export const RECONCILE_WAIT_BOUND_MS = 5 * 60_000;
export const RACE_SCHEDULES: readonly FunnelRaceSchedule[] = [
  'a-then-b',
  'b-then-a',
  'alternating',
];

/** A concise, trigger-oriented procedure, so the judge sees a real skill. */
export function benchSkillBody(name: string): string {
  const title = name.replace(/^bench-/, '').replace(/-/g, ' ');
  return [
    `# ${title}`,
    '',
    '## Steps',
    '1. Read the failing output and name the one component it implicates.',
    '2. Reproduce the failure with the narrowest test target that covers it.',
    '3. Change the smallest unit that explains the failure; keep the public contract.',
    '4. Re-run the narrow target, then the project target, and read both summaries.',
    '',
    '## Gotchas',
    '- A green narrow target does not prove the project target; run both.',
    '- Never widen a contract to make one test pass.',
    '',
  ].join('\n');
}

// ------------------------------------------------------------------ promote

export interface PromoteObservation {
  readonly settings: FunnelLifecycleSettings;
  readonly candidateId: string;
  readonly uses: number;
  readonly eventsRecorded: number;
  readonly successCount: number;
  readonly distinctContexts: number;
  readonly statusAfter: string;
  readonly tick: FunnelDrainTick;
  readonly races: readonly {
    readonly schedule: FunnelRaceSchedule;
    readonly cap: number;
    readonly ids: readonly [string, string];
    readonly observation: FunnelRaceObservation;
  }[];
}

/** Count promotions whose cap read and compare-and-set have anything between them. */
export function interleavingPoints(
  log: readonly string[],
  ids: readonly string[],
): number {
  let points = 0;
  for (const id of ids) {
    const read = log.indexOf(`read:${id}`);
    const cas = log.indexOf(`cas:${id}`);
    if (read < 0 || cas < 0 || cas < read) continue;
    if (log.slice(read + 1, cas).length > 0) points += 1;
  }
  return points;
}

export async function runPromoteScenario(
  port: FunnelLifecyclePort,
  clock: FunnelClock,
): Promise<PromoteObservation> {
  const settings = await port.begin(clock);
  const name = 'bench-funnel-routine-triage';
  const candidateId = port.seedCandidate({
    name,
    body: benchSkillBody(name),
    sessionIds: ['bench-promote-origin'],
    createdAt: clock.now(),
  });
  const slug = port.candidate(candidateId)?.name ?? name;
  const uses = settings.successesToPromote;
  for (let use = 1; use <= uses; use += 1) {
    clock.advance(HOUR_MS);
    await port.recordSkillUse({
      slug,
      sessionId: `bench-promote-use-${use}`,
      workspaceRoot: join(settings.scratchRoot, `context-${use}`),
    });
  }
  clock.advance(QUARTER_HOUR_MS);
  const tick = await port.drainTick('weekly');
  const after = port.candidate(candidateId);

  const races: PromoteObservation['races'][number][] = [];
  for (const schedule of RACE_SCHEDULES) {
    const ids: [string, string] = ['a', 'b'].map((side) => {
      const raceName = `bench-race-${schedule}-${side}`;
      return port.seedCandidate({
        name: raceName,
        body: benchSkillBody(raceName),
        sessionIds: [`bench-race-${schedule}-${side}-origin`],
        createdAt: clock.now(),
      });
    }) as [string, string];
    const cap = port.residentCount() + 1;
    const observation = await port.promoteRace({ ids, cap, schedule });
    races.push({ schedule, cap, ids, observation });
  }
  return {
    settings,
    candidateId,
    uses,
    eventsRecorded: port.invocationEvents(slug),
    successCount: after?.successCount ?? 0,
    distinctContexts: port.countDistinctContexts(candidateId),
    statusAfter: after?.status ?? 'missing',
    tick,
    races,
  };
}

export function scorePromote(observation: PromoteObservation): StageScore {
  const id = observation.candidateId;
  const recorded = observation.eventsRecorded;
  const exercised = observation.races.filter((race) =>
    race.ids.every(
      (raceId) => race.observation.decisions[raceId] === 'promoted',
    ),
  );
  const breached = exercised
    .filter((race) => race.observation.residentAfter > race.cap)
    .map((race) => race.schedule);
  const points = exercised.reduce(
    (sum, race) => sum + interleavingPoints(race.observation.log, race.ids),
    0,
  );
  const cases: CaseRecord[] = [
    scoredCase(
      'tracker:success-counter',
      { uses: observation.uses },
      `success_count >= ${recorded} recorded events`,
      `success_count ${observation.successCount}, ${recorded} event(s) recorded`,
      recorded > 0 && observation.successCount >= recorded,
    ),
    scoredCase(
      'tracker:distinct-contexts',
      { uses: observation.uses },
      `>= ${Math.min(2, observation.uses)} distinct contexts`,
      `${observation.distinctContexts} distinct contexts`,
      observation.distinctContexts >= Math.min(2, observation.uses),
    ),
    scoredCase(
      'automatic-promotion',
      { uses: observation.uses },
      'promoted without a human accept',
      observation.statusAfter,
      observation.statusAfter === 'promoted',
    ),
    ...observation.races.map((race) => {
      const ran = exercised.includes(race);
      const held = race.observation.residentAfter <= race.cap;
      const racePoints = interleavingPoints(race.observation.log, race.ids);
      return scoredCase(
        `race:${race.schedule}`,
        { schedule: race.schedule },
        `resident <= cap ${race.cap}`,
        ran
          ? `resident ${race.observation.residentAfter}; ${racePoints === 0 ? 'no-interleaving-point' : `${racePoints} interleaving point(s)`}`
          : `not exercised: ${JSON.stringify(race.observation.decisions)}`,
        ran && held,
      );
    }),
  ];
  return {
    stage: 'promote',
    in: 1 + observation.races.length * 2,
    out: [
      observation.statusAfter,
      ...observation.races.flatMap((race) =>
        Object.values(race.observation.decisions),
      ),
    ].filter((s) => s === 'promoted').length,
    invariants: [
      recorded === 0
        ? notEvaluated(
            'invocations-reach-success-counter',
            'the trigger service recorded no invocation event',
          )
        : invariantOf(
            'invocations-reach-success-counter',
            observation.successCount >= recorded ? [] : [id],
          ),
      recorded === 0
        ? notEvaluated(
            'distinct-contexts-counted',
            'the trigger service recorded no invocation event',
          )
        : invariantOf(
            'distinct-contexts-counted',
            observation.distinctContexts >= Math.min(2, observation.uses)
              ? []
              : [id],
          ),
      invariantOf(
        'automatic-promotion-after-uses',
        observation.statusAfter === 'promoted' ? [] : [id],
      ),
      exercised.length === 0
        ? notEvaluated(
            'cap-holds-under-interleaving',
            'no schedule promoted both candidates',
          )
        : invariantOf('cap-holds-under-interleaving', breached),
    ],
    metrics: {
      'promote.successCount': observation.successCount,
      'promote.eventsRecorded': recorded,
      'promote.distinctContexts': observation.distinctContexts,
      'promote.racesExercised': exercised.length,
      // 0 = `no-interleaving-point`: the cap read and the compare-and-set run
      // with no await between them, so the race cannot occur in one process.
      'promote.interleavingPoints': points,
    },
    cases,
  };
}

// ------------------------------------------------------------------ retire

export interface RetireObservation {
  readonly settings: FunnelLifecycleSettings;
  readonly ids: Readonly<
    Record<'control' | 'recent' | 'commit' | 'member', string>
  >;
  readonly names: Readonly<
    Record<'control' | 'recent' | 'commit' | 'member', string>
  >;
  readonly retired: readonly string[];
  readonly skippedReason: string | null;
  readonly commitEventsBefore: number;
  readonly commitEventsAfter: number;
  readonly reconcile: 'linked' | 'not-linked';
  readonly memberDirAfter: boolean;
}

export async function runRetireScenario(
  port: FunnelLifecyclePort,
  clock: FunnelClock,
): Promise<RetireObservation> {
  const settings = await port.begin(clock);
  const now = clock.now();
  const idleDays =
    settings.dormantAfterDays + settings.retireAfterDormantDays + 10;
  const seed = (key: string, promotedAt: number) => {
    const name = `bench-retire-${key}`;
    return port.seedPromoted({
      name,
      body: benchSkillBody(name),
      sessionIds: [`${name}-origin`],
      createdAt: promotedAt,
      promotedAt,
    });
  };
  const ids = {
    control: seed('idle-control', now - idleDays * DAY_MS),
    recent: seed('recent-use', now - idleDays * DAY_MS),
    commit: seed('commit-use', now - idleDays * DAY_MS),
    member: seed('reconcile-member', now - DAY_MS),
  };
  const nameOf = (id: string): string => port.candidate(id)?.name ?? id;
  const names = {
    control: nameOf(ids.control),
    recent: nameOf(ids.recent),
    commit: nameOf(ids.commit),
    member: nameOf(ids.member),
  };
  // A use inside the window, through the real trigger path.
  await port.recordSkillUse({
    slug: names.recent,
    sessionId: 'bench-retire-recent-session',
    workspaceRoot: join(settings.scratchRoot, 'retire-recent'),
    at: now - (settings.retireAfterDormantDays - 1) * DAY_MS,
  });
  const commitEventsBefore = port.invocationEvents(names.commit);
  const result = await port.retire({
    now,
    useAtCommit: {
      slug: names.commit,
      sessionId: 'bench-retire-commit-session',
    },
  });
  const commitEventsAfter = port.invocationEvents(names.commit);

  const suggestion = port.seedAcceptedSuggestion({
    slug: 'bench-reconcile-umbrella',
    body: benchSkillBody('bench-reconcile-umbrella'),
    memberCandidateIds: [ids.member],
    memberSessionIds: ['bench-reconcile-s1', 'bench-reconcile-s2'],
  });
  const reconcile = await port.bootReconcile(suggestion);
  return {
    settings,
    ids,
    names,
    retired: result.retired,
    skippedReason: result.skippedReason,
    commitEventsBefore,
    commitEventsAfter,
    reconcile,
    memberDirAfter: port.activeDirExists(names.member),
  };
}

/** The reconcile-timeout case, run under its own cap (never retried). */
export async function runReconcileWaitCase(
  port: FunnelLifecyclePort,
  clock: FunnelClock,
  capMs?: number,
): Promise<{ settled: boolean; error: string | null; latencyMs: number }> {
  // An accepted suggestion the reconcile will adopt, so it reaches the
  // repropagation that never resolves.
  port.seedAcceptedSuggestion({
    slug: 'bench-reconcile-wait',
    body: benchSkillBody('bench-reconcile-wait'),
    memberCandidateIds: [],
    memberSessionIds: ['bench-reconcile-wait-s1'],
  });
  const run = await runOnceUnderCap(async () => {
    const pass = port.reconcileWait();
    clock.advance(2 * RECONCILE_WAIT_BOUND_MS);
    return pass;
  }, capMs);
  return run.outcome === 'completed'
    ? { settled: true, error: null, latencyMs: run.latencyMs }
    : { settled: false, error: run.error, latencyMs: run.latencyMs };
}

export function scoreRetire(
  observation: RetireObservation,
  wait: { settled: boolean; error: string | null; latencyMs: number },
): StageScore {
  const { ids, names } = observation;
  const controlRetired = observation.retired.includes(names.control);
  const usedRetired = [names.recent, names.commit]
    .filter((name) => observation.retired.includes(name))
    .map((name) => (name === names.recent ? ids.recent : ids.commit));
  const hookFired =
    observation.commitEventsAfter > observation.commitEventsBefore;
  const cases: CaseRecord[] = [
    scoredCase(
      'retire:idle-control',
      { key: 'control' },
      'retired (positive control)',
      controlRetired
        ? 'retired'
        : `kept (${observation.skippedReason ?? 'not due'})`,
      controlRetired,
    ),
    scoredCase(
      'retire:use-inside-window',
      { key: 'recent' },
      'kept',
      observation.retired.includes(names.recent) ? 'retired' : 'kept',
      !observation.retired.includes(names.recent),
    ),
    scoredCase(
      'retire:use-at-commit',
      { key: 'commit' },
      'kept (re-checked at commit)',
      `${observation.retired.includes(names.commit) ? 'retired' : 'kept'}; use recorded at re-read: ${hookFired}`,
      !observation.retired.includes(names.commit),
    ),
    scoredCase(
      'reconcile:promoted-member-dir',
      { key: 'member' },
      'promoted member directory kept',
      observation.reconcile === 'linked'
        ? observation.memberDirAfter
          ? 'kept'
          : 'deleted'
        : 'reconcile did not adopt',
      observation.reconcile === 'linked' && observation.memberDirAfter,
    ),
    {
      ...scoredCase(
        'reconcile:wait-timeout',
        { boundMs: RECONCILE_WAIT_BOUND_MS },
        'settles once the injected clock passes the bound',
        wait.settled ? 'settled' : `error: ${wait.error ?? 'pending'}`,
        wait.settled,
      ),
      latencyMs: wait.latencyMs,
      error: wait.error,
    },
  ];
  return {
    stage: 'retire',
    in: 4,
    out: observation.retired.length,
    invariants: [
      !controlRetired
        ? notEvaluated(
            'used-skill-never-retired',
            `the idle positive control was not retired (${observation.skippedReason ?? 'not due'})`,
          )
        : !hookFired
          ? notEvaluated(
              'used-skill-never-retired',
              'the pass never re-read the commit-time row',
            )
          : invariantOf('used-skill-never-retired', usedRetired),
      observation.reconcile !== 'linked'
        ? notEvaluated(
            'reconcile-never-deletes-promoted-dir',
            'the boot reconcile did not adopt the accepted suggestion',
          )
        : invariantOf(
            'reconcile-never-deletes-promoted-dir',
            observation.memberDirAfter ? [] : [ids.member],
          ),
      invariantOf(
        'reconcile-wait-times-out',
        wait.settled ? [] : ['reconcile-wait'],
      ),
    ],
    metrics: {
      'retire.retireAfterDormantDays':
        observation.settings.retireAfterDormantDays,
      'retire.dormantAfterDays': observation.settings.dormantAfterDays,
      'retire.retired': observation.retired.length,
    },
    cases,
  };
}

// ------------------------------------------------------------------ delivery

export interface DeliveryObservation {
  readonly candidateId: string;
  readonly promoted: boolean;
  readonly reason: string;
  readonly hostWorkspaceHasSkill: boolean | null;
  readonly freshWorkspaceHasSkill: boolean | null;
}

export async function runDeliveryScenario(
  port: FunnelLifecyclePort,
  clock: FunnelClock,
): Promise<DeliveryObservation> {
  await port.begin(clock);
  const name = 'bench-delivery-skill';
  const candidateId = port.seedCandidate({
    name,
    body: benchSkillBody(name),
    sessionIds: ['bench-delivery-origin'],
    createdAt: clock.now(),
  });
  const observed = await port.delivery(candidateId);
  return {
    candidateId,
    promoted: observed.promoted,
    reason: observed.reason,
    hostWorkspaceHasSkill: observed.hostWorkspaceHasSkill,
    freshWorkspaceHasSkill: observed.freshWorkspaceHasSkill,
  };
}

export function scoreDelivery(observation: DeliveryObservation): StageScore {
  const id = observation.candidateId;
  const open = !observation.promoted
    ? `promotion refused (${observation.reason})`
    : null;
  const check = (
    invariant: string,
    delivered: boolean | null,
  ): InvariantResult =>
    open !== null
      ? notEvaluated(invariant, open)
      : delivered === null
        ? notEvaluated(invariant, 'no harness propagation service in this host')
        : invariantOf(invariant, delivered ? [] : [id]);
  return {
    stage: 'delivery',
    in: 1,
    out: observation.freshWorkspaceHasSkill === true ? 1 : 0,
    invariants: [
      check(
        'promoted-skill-in-fresh-workspace',
        observation.freshWorkspaceHasSkill,
      ),
      check(
        'promoted-skill-in-host-workspace',
        observation.hostWorkspaceHasSkill,
      ),
    ],
    metrics: {},
    cases: [
      scoredCase(
        'delivery:fresh-workspace',
        { id: 'bench-delivery-skill' },
        '.claude/skills/<slug>/SKILL.md present',
        observation.freshWorkspaceHasSkill === null
          ? `unmeasured (${open ?? 'no harness'})`
          : String(observation.freshWorkspaceHasSkill),
        observation.freshWorkspaceHasSkill === true,
      ),
    ],
  };
}

/** The shared run outcome of a lifecycle scenario. */
export function lifecycleOutcome(
  run: { outcome: string; error?: string; latencyMs: number },
  lane: FunnelRunOutcome['lane'],
  operations: number,
): FunnelRunOutcome {
  return {
    error: run.outcome === 'completed' ? null : (run.error ?? 'error'),
    latencyMs: run.latencyMs,
    attempts: 1,
    lane,
    operations,
  };
}
