/**
 * `skill.backlog.drain` (benchmark-design.md 4.4): a scripted load of sessions
 * enqueued per simulated day at a measured weekly rate, with the three drain
 * tiers ticking on their cron schedule on the injected clock. Scored: net
 * backlog slope per stage, queue age p95, and the judged share of the
 * non-fallback candidates the load produced.
 *
 * The load copies the routine transcripts of `gt-skill-sessions@v1` under new
 * session ids, so after a template's first draft the product takes its
 * `findByTrajectoryHash` reuse branch; every copy still carries its own
 * prefilter, archaeology and gate rows through the queue.
 *
 * Imports only Node, zod and parent-loadable modules.
 */

import { rate } from '../../metrics/curation-metrics';
import type { CaseRecord } from '../../runner/suite-result';
import { compareCodeUnits } from '../../../utils/compare-code-units';
import type {
  FunnelBacklogPort,
  FunnelClock,
  FunnelDrainTick,
  FunnelQueueRowView,
  FunnelSessionFile,
} from './funnel-port';
import {
  invariantOf,
  notEvaluated,
  ratesMetrics,
  scoredCase,
  type StageScore,
} from './funnel-report';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const QUARTER_HOUR_MS = 15 * 60_000;

/** Design 4.4: queue age p95 must stay within 14 simulated days. */
export const QUEUE_AGE_P95_LIMIT_DAYS = 14;

/** The stages the backlog is measured on (design 4.4 `skill.backlog.audit`). */
export const BACKLOG_STAGES = [
  'prefilter',
  'archaeology',
  'judge-panel',
  'trigger-eval',
] as const;

const PENDING_STATUSES = new Set(['queued', 'claimed', 'running', 'unscored']);

export interface BacklogLoad {
  readonly days: number;
  readonly sessionsPerWeek: number;
}

export interface BacklogObservation {
  readonly load: BacklogLoad;
  readonly enqueued: number;
  readonly ticks: number;
  readonly tickErrors: readonly string[];
  /** End-of-day pending rows per stage, day 0..days-1. */
  readonly dailyPending: Readonly<Record<string, readonly number[]>>;
  readonly rows: readonly FunnelQueueRowView[];
  readonly endAt: number;
  readonly judged: readonly {
    readonly id: string;
    readonly judged: boolean;
    readonly fallback: boolean;
  }[];
}

/** Sessions on day `day` at `perWeek`: the integer part of the running total. */
export function sessionsOnDay(day: number, perWeek: number): number {
  return (
    Math.floor(((day + 1) * perWeek) / 7) - Math.floor((day * perWeek) / 7)
  );
}

/** Least-squares slope of `values` against their index; `null` below two points. */
export function slope(values: readonly number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  });
  return num / den;
}

/** Nearest-rank p95; `null` for an empty list. */
export function p95(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)];
}

const BACKLOG_PREFIX = 'bench-backlog-';

export async function runBacklogScenario(
  port: FunnelBacklogPort,
  templates: readonly FunnelSessionFile[],
  load: BacklogLoad,
  clock: FunnelClock,
): Promise<BacklogObservation> {
  if (templates.length === 0)
    throw new Error('backlog load needs at least one template session');
  await port.begin(templates, clock);
  // Day 0 starts at the next UTC midnight on the simulated clock.
  const base = (Math.floor(clock.now() / DAY_MS) + 1) * DAY_MS;
  clock.advance(base - clock.now());
  type Event = { at: number; order: number; run: () => Promise<void> };
  const dailyPending: Record<string, number[]> = Object.fromEntries(
    BACKLOG_STAGES.map((s) => [s, []]),
  );
  const tickErrors: string[] = [];
  let enqueued = 0;
  let ticks = 0;
  const tick = (tier: FunnelDrainTick['tier']) => async () => {
    const summary = await port.drainTick(tier);
    ticks += 1;
    if (summary.error !== null) tickErrors.push(`${tier}: ${summary.error}`);
  };
  for (let day = 0; day < load.days; day += 1) {
    const start = base + day * DAY_MS;
    const events: Event[] = [];
    const count = sessionsOnDay(day, load.sessionsPerWeek);
    for (let k = 0; k < count; k += 1) {
      const index = enqueued + k;
      const sessionId = `${BACKLOG_PREFIX}d${String(day).padStart(3, '0')}-s${String(k).padStart(3, '0')}`;
      const template = templates[index % templates.length].id;
      events.push({
        at: start + 9 * HOUR_MS + Math.floor((k * 8 * HOUR_MS) / count),
        order: 0,
        run: () => port.enqueueCopy(template, sessionId),
      });
    }
    enqueued += count;
    for (let q = 0; q < DAY_MS / QUARTER_HOUR_MS; q += 1) {
      events.push({
        at: start + q * QUARTER_HOUR_MS,
        order: 1,
        run: tick('frequent'),
      });
    }
    // `0 3 * * *` and `0 4 * * 0` (`thoth-runtime/src/lib/skill-drain-jobs.ts:55,63`).
    events.push({ at: start + 3 * HOUR_MS, order: 2, run: tick('nightly') });
    if (new Date(start).getUTCDay() === 0) {
      events.push({ at: start + 4 * HOUR_MS, order: 3, run: tick('weekly') });
    }
    events.sort((a, b) => a.at - b.at || a.order - b.order);
    for (const event of events) {
      clock.advance(Math.max(0, event.at - clock.now()));
      await event.run();
    }
    clock.advance(Math.max(0, start + DAY_MS - 1 - clock.now()));
    const rows = port.queueRows(BACKLOG_PREFIX);
    for (const stage of BACKLOG_STAGES) {
      dailyPending[stage].push(
        rows.filter((r) => r.stage === stage && PENDING_STATUSES.has(r.status))
          .length,
      );
    }
  }
  const rows = port.queueRows(BACKLOG_PREFIX);
  const candidateIds = new Set<string>();
  for (const row of rows) {
    if (row.stage === 'prefilter' && row.candidateId !== null)
      candidateIds.add(row.candidateId);
    if (row.payloadCandidateId !== null)
      candidateIds.add(row.payloadCandidateId);
  }
  const judged = [...candidateIds].sort(compareCodeUnits).flatMap((id) => {
    const view = port.candidate(id);
    return view === null
      ? []
      : [
          {
            id,
            judged: view.judgePanelRationales !== null,
            fallback: view.bodyShape === 'fallback',
          },
        ];
  });
  return {
    load,
    enqueued,
    ticks,
    tickErrors,
    dailyPending,
    rows,
    endAt: clock.now(),
    judged,
  };
}

export function scoreBacklog(observation: BacklogObservation): StageScore {
  const perStage = BACKLOG_STAGES.map((stage) => {
    const rows = observation.rows.filter((r) => r.stage === stage);
    const ages = rows.map(
      (r) => ((r.finishedAt ?? observation.endAt) - r.enqueuedAt) / DAY_MS,
    );
    const perDay = slope(observation.dailyPending[stage] ?? []);
    return {
      stage,
      ageP95Days: p95(ages),
      slopePerWeek: perDay === null ? null : perDay * 7,
      rows: rows.length,
    };
  });
  const drafts = observation.judged.filter((c) => !c.fallback);
  const share = rate(drafts.filter((c) => c.judged).length, drafts.length);
  const growing = perStage
    .filter((s) => s.slopePerWeek !== null && s.slopePerWeek > 0)
    .map((s) => s.stage);
  const aged = perStage
    .filter(
      (s) => s.ageP95Days !== null && s.ageP95Days > QUEUE_AGE_P95_LIMIT_DAYS,
    )
    .map((s) => s.stage);
  const measured = perStage.filter((s) => s.slopePerWeek !== null);
  const cases: CaseRecord[] = perStage.map((s) =>
    scoredCase(
      `backlog:${s.stage}`,
      { stage: s.stage, load: observation.load },
      `slope <= 0/week, age p95 <= ${QUEUE_AGE_P95_LIMIT_DAYS} d`,
      `slope ${s.slopePerWeek ?? 'na'}/week, age p95 ${s.ageP95Days ?? 'na'} d, ${s.rows} rows`,
      !growing.includes(s.stage) && !aged.includes(s.stage),
    ),
  );
  return {
    stage: 'backlog-drain',
    in: observation.enqueued,
    out: observation.rows.filter(
      (r) => r.stage === 'prefilter' && !PENDING_STATUSES.has(r.status),
    ).length,
    invariants: [
      measured.length === 0
        ? notEvaluated('backlog-slope-le-0', 'fewer than two simulated days')
        : invariantOf('backlog-slope-le-0', growing),
      invariantOf('queue-age-p95-le-14d', aged),
      drafts.length === 0
        ? notEvaluated(
            'judged-share-is-1',
            'the load produced no non-fallback candidate',
          )
        : invariantOf(
            'judged-share-is-1',
            drafts.filter((c) => !c.judged).map((c) => c.id),
          ),
      observation.tickErrors.length === 0
        ? invariantOf('drain-ticks-without-error', [])
        : invariantOf(
            'drain-ticks-without-error',
            observation.tickErrors.slice(0, 10),
          ),
    ],
    metrics: {
      ...ratesMetrics({ 'backlog.judgedShare': share }),
      'backlog.enqueued': observation.enqueued,
      'backlog.ticks': observation.ticks,
    },
    cases,
    extra: {
      backlog: perStage.map((s) => ({
        stage: s.stage,
        ageP95Days: s.ageP95Days,
        slopePerWeek: s.slopePerWeek,
        judgedShare: s.stage === 'judge-panel' ? share.value : null,
      })),
    },
  };
}
