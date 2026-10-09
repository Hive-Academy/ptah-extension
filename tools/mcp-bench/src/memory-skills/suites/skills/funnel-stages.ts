/**
 * Task 22.1 (benchmark-design.md 4.4): one scripted pass of
 * `gt-skill-sessions@v1` through the real funnel, then the prefilter,
 * archaeology, cluster, draft, judge, feed-parity and replay stages scored from
 * what the product left behind.
 *
 * The pass, on the injected clock (`FunnelClock`):
 *  1. every session's trigger operation, in fixture order: `session-end`
 *     through the SDK session-end registry, `idle-timeout` through session
 *     activity and the trigger service's own idle timer, `manual-analyze`
 *     through the RPC method `skillSynthesis:analyzeNow`;
 *  2. one drain cycle (`FunnelRunPort.drainCycle`), which is where the
 *     fixture's `drain-eligible-candidate` and `prefilter-rejected` operations
 *     happen for queued sessions;
 *  3. a snapshot of the feed, candidates, verdicts, queue and suggestions, and
 *     the feed a fresh product graph over the same database reports.
 * The pass runs once under the safety cap and every stage suite scores the
 * same observation. Labels and expected events come from the fixture only.
 *
 * Imports only Node, zod and parent-loadable modules.
 */

import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { compareCodeUnits } from '../../../utils/compare-code-units';
import { rate, type Rate } from '../../metrics/curation-metrics';
import type { CaseRecord } from '../../runner/suite-result';
import type { FunnelFixture, FunnelFixtureSession } from './funnel-fixture';
import type {
  ManualAnalyzeOutcome,
  FunnelCandidateView,
  FunnelClock,
  FunnelDrainTick,
  FunnelFeedEvent,
  FunnelRunPort,
  FunnelSnapshot,
} from './funnel-port';
import {
  invariantOf,
  notEvaluated,
  ratesMetrics,
  runCase,
  runOnceUnderCap,
  scoredCase,
  thresholdInvariantOf,
  type FunnelRunOutcome,
  type InvariantResult,
  type StageScore,
} from './funnel-report';

/** Design 4.4: recall on labelled routine sessions must reach 0.9. */
export const PREFILTER_RECALL_FLOOR = 0.9;
/** `judge_panel_rationales` entry keys (`types.ts` `JudgePanelRationale`). */
const RATIONALE_KEYS = [
  'criteria',
  'reason',
  'role',
  'score',
  'status',
  'summary',
];
/** `JUDGE_CRITERION_KEYS` (`skill-judge.service.ts:97-103`). */
const CRITERION_KEYS = [
  'actionability',
  'generalization',
  'novelty',
  'scope',
  'triggerClarity',
];
/** The C-S8 docs claim (`how-it-works.mdx:106`). */
export const REPLAY_DOCS_PHRASE = 'Replay is designed, not running yet';

/**
 * What the bench did for one session's trigger operation: it ran, it cannot
 * run in this host (excluded from scoring), or the RPC ran and refused (scored,
 * with the refusal kept on the session's cases).
 */
export type TriggerOutcome = ManualAnalyzeOutcome;

export interface FunnelPassObservation {
  readonly triggers: Readonly<Record<string, TriggerOutcome>>;
  readonly ticks: readonly FunnelDrainTick[];
  readonly snapshot: FunnelSnapshot;
  readonly restartFeed: readonly FunnelFeedEvent[];
}

export interface FunnelPass {
  readonly outcome: FunnelRunOutcome;
  /** `null` when the run did not complete. */
  readonly observation: FunnelPassObservation | null;
}

export interface FunnelStageInput {
  readonly fixture: FunnelFixture;
  readonly pass: FunnelPass;
  /** `options.replayDocs`; absent ⇒ the docs half of the replay invariant is open. */
  readonly replayDocs?: { readonly file: string; readonly phrase: string };
}

/** Run the scripted pass once, under the safety cap (no retry). Never throws. */
export async function runFunnelPass(
  port: FunnelRunPort,
  fixture: FunnelFixture,
  clock: FunnelClock,
  capMs?: number,
): Promise<FunnelPass> {
  let operations = 0;
  const execute = async (): Promise<FunnelPassObservation> => {
    await port.prepare(fixture.files, clock);
    const triggers: Record<string, TriggerOutcome> = {};
    for (const session of fixture.sessions) {
      triggers[session.id] = await trigger(port, session);
      operations += 1;
    }
    const ticks = await port.drainCycle();
    operations += ticks.length;
    const ids = fixture.sessions.map((session) => session.id);
    const snapshot = port.snapshot(ids);
    const restartFeed = await port.restartFeed(ids);
    operations += 1;
    return { triggers, ticks, snapshot, restartFeed };
  };
  try {
    const run = await runOnceUnderCap(execute, capMs);
    return {
      outcome: {
        error: run.outcome === 'completed' ? null : run.error,
        latencyMs: run.latencyMs,
        attempts: 1,
        lane: port.laneStats(),
        operations,
      },
      observation: run.outcome === 'completed' ? run.value : null,
    };
  } finally {
    await port.close();
  }
}

async function trigger(
  port: FunnelRunPort,
  session: FunnelFixtureSession,
): Promise<TriggerOutcome> {
  const first = session.script[0];
  switch (first) {
    case 'session-end':
      await port.sessionEnd(session.id);
      return 'ran';
    case 'idle-timeout':
      await port.idleTimeout(session.id);
      return 'ran';
    case 'manual-analyze':
      return port.manualAnalyze(session.id);
    default:
      throw new Error(
        `${session.id}: script must open with a trigger operation, got ${first}`,
      );
  }
}

// ----------------------------------------------------------- observation views

function candidatesBySession(
  candidates: readonly FunnelCandidateView[],
): Map<string, FunnelCandidateView[]> {
  const bySession = new Map<string, FunnelCandidateView[]>();
  for (const candidate of candidates) {
    for (const id of candidate.sourceSessionIds) {
      bySession.set(id, [...(bySession.get(id) ?? []), candidate]);
    }
  }
  return bySession;
}

/** Sessions the trigger operation reached (an unreachable RPC excludes it). */
function evaluatedSessions(input: FunnelStageInput): FunnelFixtureSession[] {
  const triggers = input.pass.observation?.triggers ?? {};
  return input.fixture.sessions.filter(
    (s) => triggers[s.id] !== undefined && triggers[s.id] !== 'unreachable',
  );
}

/** ` (rpc refused: <error>)` when the session's RPC trigger was refused. */
function triggerNote(input: FunnelStageInput, sessionId: string): string {
  const outcome = input.pass.observation?.triggers[sessionId];
  return typeof outcome === 'object'
    ? ` (rpc refused: ${outcome.rpcError})`
    : '';
}

function excludedNote(input: FunnelStageInput): InvariantResult[] {
  const triggers = input.pass.observation?.triggers ?? {};
  const excluded = input.fixture.sessions
    .filter((s) => triggers[s.id] === 'unreachable')
    .map((s) => s.id);
  return excluded.length === 0
    ? []
    : [
        notEvaluated(
          'manual-analyze-sessions',
          `skillSynthesis:analyzeNow is not registered in this host; excluded ${excluded.join(', ')}`,
        ),
      ];
}

function failedRunScore(
  stage: StageScore['stage'],
  input: FunnelStageInput,
): StageScore {
  return {
    stage,
    in: 0,
    out: 0,
    invariants: [
      notEvaluated('run', input.pass.outcome.error ?? 'no observation'),
    ],
    metrics: {},
    cases: [
      runCase(
        'funnel-run',
        input.fixture.sessions.map((s) => s.id),
        input.pass.outcome,
      ),
    ],
  };
}

function withRunCase(
  input: FunnelStageInput,
  cases: CaseRecord[],
): CaseRecord[] {
  return [
    runCase(
      'funnel-run',
      input.fixture.sessions.map((s) => s.id),
      input.pass.outcome,
    ),
    ...cases,
  ];
}

// ----------------------------------------------------------- stages

/** prefilter: recall on routine-labelled sessions >= 0.9; precision vs accept-all. */
export function scorePrefilter(input: FunnelStageInput): StageScore {
  const observation = input.pass.observation;
  if (observation === null) return failedRunScore('prefilter', input);
  const sessions = evaluatedSessions(input);
  const bySession = candidatesBySession(observation.snapshot.candidates);
  const accepted = sessions.filter((s) => bySession.has(s.id));
  const routine = sessions.filter((s) => s.routine !== null);
  const truePositive = accepted.filter((s) => s.routine !== null);
  const recall = rate(truePositive.length, routine.length);
  const precision = rate(truePositive.length, accepted.length);
  const acceptAllPrecision = rate(routine.length, sessions.length);
  const acceptAllRecall = rate(routine.length, routine.length);
  const missed = routine.filter((s) => !bySession.has(s.id)).map((s) => s.id);
  const cases = sessions.map((s) => {
    const passed = bySession.has(s.id);
    const expected = s.routine !== null ? 'accepted' : 'rejected';
    return scoredCase(
      s.id,
      { id: s.id, routine: s.routine, degraded: s.degraded },
      expected,
      `${passed ? 'accepted' : 'rejected'}${triggerNote(input, s.id)}`,
      (expected === 'accepted') === passed,
    );
  });
  return {
    stage: 'prefilter',
    in: sessions.length,
    out: accepted.length,
    invariants: [
      thresholdInvariantOf(
        'recall-routine-ge-0.9',
        recall.value !== null && recall.value >= PREFILTER_RECALL_FLOOR,
        missed,
      ),
      ...excludedNote(input),
    ],
    metrics: ratesMetrics({
      'prefilter.recall': recall,
      'prefilter.precision': precision,
    }),
    baselines: [
      {
        id: 'accept-all',
        label: 'accept every session',
        metrics: ratesMetrics({
          'prefilter.recall': acceptAllRecall,
          'prefilter.precision': acceptAllPrecision,
        }),
      },
    ],
    deltas: {
      'accept-all': {
        'prefilter.recall': delta(recall, acceptAllRecall),
        'prefilter.precision': delta(precision, acceptAllPrecision),
      },
    },
    cases: withRunCase(input, cases),
    extra: { precision: precision.value, recall: recall.value },
  };
}

function delta(product: Rate, baseline: Rate): number | null {
  return product.value === null || baseline.value === null
    ? null
    : product.value - baseline.value;
}

/**
 * archaeology: runs before authoring for every accepted session; a degraded or
 * no-routine verdict leaves no live candidate; verdict accuracy vs the labels,
 * with the majority-class "no routine" baseline.
 */
export function scoreArchaeology(input: FunnelStageInput): StageScore {
  const observation = input.pass.observation;
  if (observation === null) return failedRunScore('archaeology', input);
  const sessions = evaluatedSessions(input);
  const bySession = candidatesBySession(observation.snapshot.candidates);
  const verdicts = new Map(
    observation.snapshot.verdicts.map((v) => [v.sessionId, v]),
  );
  const accepted = sessions.filter((s) => bySession.has(s.id));

  const notBefore = accepted
    .filter((s) => {
      const verdict = verdicts.get(s.id);
      const firstDraft = Math.min(
        ...(bySession.get(s.id) ?? []).map((c) => c.createdAt),
      );
      return verdict === undefined || verdict.createdAt > firstDraft;
    })
    .map((s) => s.id);

  const noRoutine = sessions.filter((s) => {
    const verdict = verdicts.get(s.id);
    return (
      verdict !== undefined && (verdict.degraded || !verdict.routinePresent)
    );
  });
  const liveDespite = noRoutine
    .filter((s) =>
      (bySession.get(s.id) ?? []).some((c) => c.status !== 'rejected'),
    )
    .map((s) => s.id);

  const judged = sessions.filter((s) => verdicts.has(s.id));
  const routineRight = judged.filter(
    (s) => verdicts.get(s.id)?.routinePresent === (s.routine !== null),
  ).length;
  const degradedRight = judged.filter(
    (s) => verdicts.get(s.id)?.degraded === s.degraded,
  ).length;
  const majorityRight = judged.filter((s) => s.routine === null).length;
  const routineAccuracy = rate(routineRight, judged.length);
  const degradedAccuracy = rate(degradedRight, judged.length);
  const majority = rate(majorityRight, judged.length);
  const coverage = rate(judged.length, accepted.length);

  const cases = judged.map((s) => {
    const verdict = verdicts.get(s.id);
    const expected = `routine=${s.routine !== null} degraded=${s.degraded}`;
    const observed = `routine=${verdict?.routinePresent} degraded=${verdict?.degraded}`;
    return scoredCase(
      `${s.id}:verdict`,
      { id: s.id, routine: s.routine, degraded: s.degraded },
      expected,
      observed,
      expected === observed,
    );
  });
  return {
    stage: 'archaeology',
    in: accepted.length,
    out: judged.length,
    invariants: [
      accepted.length === 0
        ? notEvaluated('runs-before-authoring', 'no session reached authoring')
        : invariantOf('runs-before-authoring', notBefore),
      noRoutine.length === 0
        ? notEvaluated(
            'no-candidate-without-routine',
            'no degraded or no-routine verdict in the run',
          )
        : invariantOf('no-candidate-without-routine', liveDespite),
      ...excludedNote(input),
    ],
    metrics: ratesMetrics({
      'archaeology.routineAccuracy': routineAccuracy,
      'archaeology.degradedAccuracy': degradedAccuracy,
      'archaeology.coverage': coverage,
    }),
    baselines: [
      {
        id: 'majority-no-routine',
        label: 'predict "no routine" for every session',
        metrics: ratesMetrics({ 'archaeology.routineAccuracy': majority }),
      },
    ],
    deltas: {
      'majority-no-routine': {
        'archaeology.routineAccuracy': delta(routineAccuracy, majority),
      },
    },
    cases: withRunCase(input, cases),
    extra: {
      archaeologyAccuracy: {
        routine: routineAccuracy.value,
        degraded: degradedAccuracy.value,
        n: judged.length,
      },
    },
  };
}

/** cluster: a cluster counts >= 2 distinct sessions; no single-session auto-candidate. */
export function scoreCluster(input: FunnelStageInput): StageScore {
  const observation = input.pass.observation;
  if (observation === null) return failedRunScore('cluster', input);
  const candidates = observation.snapshot.candidates;
  const distinct = (ids: readonly string[]): number => new Set(ids).size;
  const single = candidates
    .filter((c) => distinct(c.sourceSessionIds) < 2)
    .map((c) => c.id);
  const suggestions = observation.snapshot.suggestions;
  const thinClusters = suggestions
    .filter((s) => distinct(s.memberSessionIds) < 2)
    .map((s) => s.id);
  const cases = candidates.map((c) =>
    scoredCase(
      `${c.id}:sessions`,
      { sessions: [...c.sourceSessionIds].sort(compareCodeUnits) },
      '>= 2 distinct sessions',
      `${distinct(c.sourceSessionIds)} distinct session(s)`,
      distinct(c.sourceSessionIds) >= 2,
    ),
  );
  return {
    stage: 'cluster',
    in: candidates.length,
    out: candidates.length - single.length,
    invariants: [
      candidates.length === 0
        ? notEvaluated(
            'no-single-session-auto-candidate',
            'the run produced no candidate',
          )
        : invariantOf('no-single-session-auto-candidate', single),
      suggestions.length === 0
        ? notEvaluated(
            'cluster-min-two-sessions',
            'no cluster suggestion covers a fixture session',
          )
        : invariantOf('cluster-min-two-sessions', thinClusters),
    ],
    metrics: {
      'cluster.singleSessionCandidates': single.length,
      'cluster.suggestions': suggestions.length,
    },
    cases: withRunCase(input, cases),
  };
}

/** draft: a template fallback is marked and never judged. */
export function scoreDraft(input: FunnelStageInput): StageScore {
  const observation = input.pass.observation;
  if (observation === null) return failedRunScore('draft', input);
  const candidates = observation.snapshot.candidates;
  const fallbacks = candidates.filter((c) => c.bodyShape === 'fallback');
  const judgedFallbacks = fallbacks
    .filter((c) => c.judgeStatus !== null || c.judgePanelRationales !== null)
    .map((c) => c.id);
  const cases = fallbacks.map((c) =>
    scoredCase(
      `${c.id}:fallback`,
      { id: c.id },
      'never judged',
      c.judgeStatus === null && c.judgePanelRationales === null
        ? 'not judged'
        : `judged (${c.judgeStatus ?? 'panel'})`,
      c.judgeStatus === null && c.judgePanelRationales === null,
    ),
  );
  return {
    stage: 'draft',
    in: candidates.length,
    out: candidates.filter((c) => c.bodyShape === 'model').length,
    invariants: [
      fallbacks.length === 0
        ? notEvaluated(
            'fallback-never-judged',
            'the run drafted no template fallback',
          )
        : invariantOf('fallback-never-judged', judgedFallbacks),
      notEvaluated(
        'fallback-marked',
        'skill_candidates has no fallback field; a fallback is identifiable only by its body text',
      ),
    ],
    metrics: {
      'draft.fallbacks': fallbacks.length,
      'draft.unreadableBodies': candidates.filter(
        (c) => c.bodyShape === 'unreadable',
      ).length,
    },
    cases: withRunCase(input, cases),
  };
}

const rationaleSchema = z.array(z.record(z.string(), z.unknown()));

/** Ids of panel rows whose scorecard shape differs from the constant one. */
function shapeViolations(candidates: readonly FunnelCandidateView[]): string[] {
  const bad: string[] = [];
  for (const c of candidates) {
    if (c.judgePanelRationales === null) continue;
    let entries: Record<string, unknown>[];
    try {
      entries = rationaleSchema.parse(
        JSON.parse(c.judgePanelRationales) as unknown,
      );
    } catch {
      bad.push(c.id);
      continue;
    }
    const ok =
      entries.length > 0 &&
      entries.every((entry) => {
        const keys = Object.keys(entry).sort(compareCodeUnits);
        if (keys.join() !== RATIONALE_KEYS.join()) return false;
        const criteria = entry['criteria'];
        return (
          criteria === null ||
          (typeof criteria === 'object' &&
            Object.keys(criteria as object)
              .sort(compareCodeUnits)
              .join() === CRITERION_KEYS.join())
        );
      });
    if (!ok) bad.push(c.id);
  }
  return bad;
}

/** judge: every non-fallback draft gets a panel row within one drain cycle; constant shape. */
export function scoreJudge(input: FunnelStageInput): StageScore {
  const observation = input.pass.observation;
  if (observation === null) return failedRunScore('judge', input);
  const drafts = observation.snapshot.candidates.filter(
    (c) => c.bodyShape === 'model',
  );
  const paneled = drafts.filter((c) => c.judgePanelRationales !== null);
  const missing = drafts
    .filter((c) => c.judgePanelRationales === null)
    .map((c) => c.id);
  const share = rate(paneled.length, drafts.length);
  const cases = drafts.map((c) =>
    scoredCase(
      `${c.id}:panel`,
      { id: c.id },
      'panel row after one drain cycle (fixture scale)',
      c.judgePanelRationales === null
        ? `no panel row (judgeStatus ${c.judgeStatus ?? 'null'})`
        : 'panel row',
      c.judgePanelRationales !== null,
    ),
  );
  return {
    stage: 'judge',
    in: drafts.length,
    out: paneled.length,
    invariants: [
      drafts.length === 0
        ? notEvaluated(
            'panel-row-within-one-cycle',
            'the run drafted no non-fallback candidate',
          )
        : invariantOf('panel-row-within-one-cycle', missing),
      paneled.length === 0
        ? notEvaluated(
            'panel-scorecard-shape-constant',
            'no panel row to inspect',
          )
        : invariantOf(
            'panel-scorecard-shape-constant',
            shapeViolations(paneled),
          ),
    ],
    metrics: ratesMetrics({ 'judge.panelShare': share }),
    cases: withRunCase(input, cases),
  };
}

function eventKey(event: { kind: string; reason?: string | null }): string {
  return event.kind === 'ineligible'
    ? `${event.kind}:${event.reason ?? ''}`
    : event.kind;
}

/** Missing and phantom events between two sequences (multiset difference). */
export function feedDiff(
  expected: readonly string[],
  observed: readonly string[],
): { missing: string[]; phantom: string[]; orderOnly: boolean } {
  const left = [...expected];
  const phantom: string[] = [];
  for (const event of observed) {
    const at = left.indexOf(event);
    if (at >= 0) left.splice(at, 1);
    else phantom.push(event);
  }
  const equalAsMultiset = left.length === 0 && phantom.length === 0;
  return {
    missing: left,
    phantom,
    orderOnly: equalAsMultiset && expected.join('|') !== observed.join('|'),
  };
}

/**
 * feed-parity: the feed equals the fixture's expected events (no missing, no
 * phantom, scripted order), and the same after a restart. Queue-table parity
 * is a secondary diagnostic metric only.
 */
export function scoreFeedParity(input: FunnelStageInput): StageScore {
  const observation = input.pass.observation;
  if (observation === null) return failedRunScore('feed-parity', input);
  const sessions = evaluatedSessions(input);
  const feedOf = (events: readonly FunnelFeedEvent[], id: string): string[] =>
    events.filter((e) => e.sessionId === id).map(eventKey);
  const bySession = candidatesBySession(observation.snapshot.candidates);
  let missing = 0;
  let phantom = 0;
  let orderOnly = 0;
  let dbAgree = 0;
  const unequal: string[] = [];
  const lostOnRestart: string[] = [];
  const cases: CaseRecord[] = [];
  for (const s of sessions) {
    const expected = s.expectedEvents.map(eventKey);
    const observed = feedOf(observation.snapshot.feed, s.id);
    const diff = feedDiff(expected, observed);
    missing += diff.missing.length;
    phantom += diff.phantom.length;
    if (diff.orderOnly) orderOnly += 1;
    const equal = expected.join('|') === observed.join('|');
    if (!equal) unequal.push(s.id);
    const afterRestart = feedOf(observation.restartFeed, s.id);
    if (afterRestart.join('|') !== expected.join('|')) lostOnRestart.push(s.id);
    // Secondary diagnostic: does the durable state agree with the expectation?
    const draftedExpected = expected.includes('analyze-run');
    if (draftedExpected === bySession.has(s.id)) dbAgree += 1;
    cases.push(
      scoredCase(
        `${s.id}:feed`,
        { id: s.id, script: s.script, expectedEvents: s.expectedEvents },
        expected.join(' > ') || '(none)',
        `${observed.join(' > ') || '(none)'}${triggerNote(input, s.id)}`,
        equal,
      ),
    );
  }
  return {
    stage: 'feed-parity',
    in: sessions.length,
    out: sessions.length - unequal.length,
    invariants: [
      invariantOf('feed-equals-script', unequal),
      invariantOf('feed-survives-restart', lostOnRestart),
      ...excludedNote(input),
    ],
    metrics: {
      ...ratesMetrics({
        'feed.parity': rate(sessions.length - unequal.length, sessions.length),
        'feed.restartParity': rate(
          sessions.length - lostOnRestart.length,
          sessions.length,
        ),
        'feed.dbParity': rate(dbAgree, sessions.length),
      }),
      'feed.missingEvents': missing,
      'feed.phantomEvents': phantom,
      'feed.orderOnlySessions': orderOnly,
    },
    cases: withRunCase(input, cases),
  };
}

/** replay: coverage = 0 and the docs say "not running yet" (C-S8). */
export function scoreReplay(input: FunnelStageInput): StageScore {
  const observation = input.pass.observation;
  if (observation === null) return failedRunScore('replay', input);
  const candidates = observation.snapshot.candidates;
  const measured = candidates
    .filter((c) => c.replayConfidence !== null)
    .map((c) => c.id);
  const replayRows = observation.snapshot.queue
    .filter((row) => row.stage === 'replay')
    .map((row) => `${row.sessionId}:replay`);
  let docs: InvariantResult;
  if (input.replayDocs === undefined) {
    docs = notEvaluated('docs-say-not-running', 'options.replayDocs not given');
  } else {
    let text: string | null;
    try {
      text = readFileSync(input.replayDocs.file, 'utf8');
    } catch {
      // An unreadable docs file leaves the invariant open, never passed.
      text = null;
    }
    docs =
      text === null
        ? notEvaluated(
            'docs-say-not-running',
            `cannot read ${input.replayDocs.file}`,
          )
        : invariantOf(
            'docs-say-not-running',
            text.includes(input.replayDocs.phrase)
              ? []
              : [input.replayDocs.file],
          );
  }
  return {
    stage: 'replay',
    in: candidates.length,
    out: measured.length,
    invariants: [
      candidates.length === 0
        ? notEvaluated('replay-coverage-zero', 'the run produced no candidate')
        : invariantOf('replay-coverage-zero', [...measured, ...replayRows]),
      docs,
    ],
    metrics: ratesMetrics({
      'replay.coverage': rate(measured.length, candidates.length),
    }),
    cases: withRunCase(input, [
      scoredCase(
        'replay-coverage',
        { candidates: candidates.length },
        'coverage 0',
        `${measured.length} measured, ${replayRows.length} replay rows`,
        measured.length === 0 && replayRows.length === 0,
      ),
    ]),
  };
}

/** Every 22.1 stage, by suite id suffix. */
export const FUNNEL_STAGE_SCORERS = {
  prefilter: scorePrefilter,
  archaeology: scoreArchaeology,
  cluster: scoreCluster,
  draft: scoreDraft,
  judge: scoreJudge,
  'feed-parity': scoreFeedParity,
  replay: scoreReplay,
} as const;
