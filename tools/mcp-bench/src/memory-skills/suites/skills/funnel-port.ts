/**
 * The product surface the skills funnel suites drive (benchmark-design.md
 * 4.4), as views and operations. Types only plus the injected clock, so the
 * runner parent may load it; the host entry wires the real implementation
 * (`funnel-host-port.ts`, host-only) and the specs wire the same
 * implementation over a production-DI container they build themselves.
 *
 * Every operation reaches product code through a product entry point (the
 * SDK callback registries, `SkillDrainService.drain`, the RPC handler, the
 * promotion / retirement / curator services). The only overrides are the
 * record/replay lane runner (`LANE_RUNNER_SERVICE`), observation-only hooks on
 * product store instances, and the never-resolving repropagation port the
 * design names for the reconcile-timeout case. Each is named where it is used.
 */

import {
  installSimulatedClock,
  type SimulatedClock,
} from '../memory/retention-support';

/** The injected clock: `Date.now` replaced for the suite, advanced explicitly. */
export interface FunnelClock {
  now(): number;
  advance(ms: number): void;
  restore(): void;
}

/**
 * Install the simulated clock at the current real instant (the base is never
 * written anywhere; every assertion uses offsets). Starting at the real instant
 * keeps singletons constructed before the install (the drain's `startedAt`) on
 * the same time line.
 */
export function installFunnelClock(): FunnelClock {
  const clock: SimulatedClock = installSimulatedClock(Date.now());
  return {
    now: () => Date.now(),
    advance: (ms) => {
      if (!Number.isFinite(ms) || ms < 0) {
        throw new RangeError(`clock advance must be >= 0 ms, got ${ms}`);
      }
      clock.set(Date.now() + ms);
    },
    restore: () => clock.restore(),
  };
}

/** One `SkillSynthesisService` activity-feed event, scoped to a session. */
export interface FunnelFeedEvent {
  readonly kind: string;
  readonly sessionId: string | null;
  readonly reason: string | null;
}

/** A `skill_candidates` row as the funnel scores it. */
export interface FunnelCandidateView {
  readonly id: string;
  readonly name: string;
  readonly sourceSessionIds: readonly string[];
  readonly status: string;
  readonly rejectedReason: string | null;
  readonly successCount: number;
  /** `classifyBodyShape` over the candidate's SKILL.md; `unreadable` when absent. */
  readonly bodyShape: 'fallback' | 'model' | 'unreadable';
  readonly judgeStatus: string | null;
  /** Raw `judge_panel_rationales` JSON; `null` = no panel row. */
  readonly judgePanelRationales: string | null;
  readonly replayConfidence: number | null;
  readonly createdAt: number;
}

/** A `skill_session_verdicts` row as the archaeology stage scores it. */
export interface FunnelVerdictView {
  readonly sessionId: string;
  readonly routinePresent: boolean;
  readonly degraded: boolean;
  readonly createdAt: number;
}

/** A `skill_synthesis_queue` row. */
export interface FunnelQueueRowView {
  readonly sessionId: string;
  readonly stage: string;
  readonly status: string;
  readonly reason: string | null;
  readonly enqueuedAt: number;
  readonly finishedAt: number | null;
  /** The `candidate_id` column: what the row produced (set by the drain). */
  readonly candidateId: string | null;
  /** The payload `candidateId`: what a gate row was dispatched to grade. */
  readonly payloadCandidateId: string | null;
}

/** A `skill_suggestions` row (umbrella clusters). */
export interface FunnelSuggestionView {
  readonly id: string;
  readonly memberSessionIds: readonly string[];
}

/** What one `SkillDrainService.drain` tick reported. */
export interface FunnelDrainTick {
  readonly tier: 'frequent' | 'nightly' | 'weekly';
  readonly claimed: number;
  readonly done: number;
  readonly failed: number;
  readonly unscored: number;
  readonly skippedItems: number;
  /** The drain's own skip reason when a gate stopped the tick. */
  readonly skipReason: string | null;
  readonly error: string | null;
}

/** Calls the record/replay lane runner served, and its cassette misses. */
export interface FunnelLaneStats {
  readonly calls: number;
  readonly misses: number;
}

export interface FunnelSnapshot {
  readonly feed: readonly FunnelFeedEvent[];
  readonly candidates: readonly FunnelCandidateView[];
  readonly verdicts: readonly FunnelVerdictView[];
  readonly queue: readonly FunnelQueueRowView[];
  readonly suggestions: readonly FunnelSuggestionView[];
}

export interface FunnelSessionFile {
  readonly id: string;
  readonly jsonl: string;
}

/** Task 22.1: one scripted pass of the fixture sessions through the funnel. */
export interface FunnelRunPort {
  /**
   * Stage the transcripts where the product's JSONL reader resolves them for
   * the funnel workspace and start the synthesis and trigger services.
   */
  prepare(
    sessions: readonly FunnelSessionFile[],
    clock: FunnelClock,
  ): Promise<void>;
  /** `SessionEndCallbackRegistry.notifyAll`; resolves once the enqueue settled. */
  sessionEnd(sessionId: string): Promise<void>;
  /** Session activity, then the trigger's own idle timer fired on the clock. */
  idleTimeout(sessionId: string): Promise<void>;
  /** RPC `skillSynthesis:analyzeNow`; `unreachable` when no RPC handler has it. */
  manualAnalyze(sessionId: string): Promise<'ran' | 'unreachable'>;
  /**
   * One drain cycle on the clock: frequent ticks every 15 simulated minutes
   * until no frequent-tier row is eligible (at most one simulated day), then
   * one nightly and one weekly tick.
   */
  drainCycle(): Promise<FunnelDrainTick[]>;
  snapshot(sessionIds: readonly string[]): FunnelSnapshot;
  /**
   * The feed a freshly constructed product graph over the same database
   * reports: `registerSkillSynthesisServices` into a child container, `start`,
   * read, `stop`. The in-process stand-in for a host restart.
   */
  restartFeed(sessionIds: readonly string[]): Promise<FunnelFeedEvent[]>;
  laneStats(): FunnelLaneStats;
  close(): Promise<void>;
}

/** Product settings the lifecycle suites read (never assume a default). */
export interface FunnelLifecycleSettings {
  readonly dormantAfterDays: number;
  /** `skillSynthesis.retirement.retireAfterDormantDays` (K2: default 30). */
  readonly retireAfterDormantDays: number;
  readonly successesToPromote: number;
  readonly maxActiveSkills: number;
  /** A directory in the isolated home for scenario workspaces. */
  readonly scratchRoot: string;
}

export interface SeedSkillInput {
  readonly name: string;
  readonly body: string;
  readonly sessionIds: readonly string[];
  readonly createdAt: number;
}

/** What one interleaving schedule observed. */
export interface FunnelRaceObservation {
  /** Promotion outcome per candidate id (`PromotionDecision.reason`). */
  readonly decisions: Readonly<Record<string, string>>;
  /** Resident promoted skills after both promotions settled. */
  readonly residentAfter: number;
  /**
   * Ordered hook log: `pause:<id>`, `read:<id>` (cap read,
   * `listActiveOrderedByDecayScore`), `cas:<id>` (`promoteAtomically`).
   */
  readonly log: readonly string[];
}

export type FunnelRaceSchedule = 'a-then-b' | 'b-then-a' | 'alternating';

export interface FunnelRetireObservation {
  readonly retired: readonly string[];
  readonly dormant: readonly string[];
  readonly skippedReason: string | null;
}

export interface FunnelDeliveryObservation {
  readonly promoted: boolean;
  readonly reason: string;
  readonly slug: string | null;
  /** `null` when the host has no harness propagation service. */
  readonly hostWorkspaceHasSkill: boolean | null;
  readonly freshWorkspaceHasSkill: boolean | null;
}

/** Task 22.2: promotion, retirement, delivery and the backlog drain. */
export interface FunnelLifecyclePort {
  begin(clock: FunnelClock): Promise<FunnelLifecycleSettings>;
  seedCandidate(input: SeedSkillInput): string;
  seedPromoted(input: SeedSkillInput & { readonly promotedAt: number }): string;
  candidate(id: string): FunnelCandidateView | null;
  countDistinctContexts(id: string): number;
  /** `skill_invocation_events` rows for the slug. */
  invocationEvents(slug: string): number;
  /** A `Skill` tool use through `PostToolUseCallbackRegistry.notifyAll`. */
  recordSkillUse(input: {
    readonly slug: string;
    readonly sessionId: string;
    readonly workspaceRoot: string;
    /** The hook payload's `timestamp` (the event's `invoked_at`); default now. */
    readonly at?: number;
  }): Promise<void>;
  drainTick(tier: FunnelDrainTick['tier']): Promise<FunnelDrainTick>;
  residentCount(): number;
  promoteRace(input: {
    readonly ids: readonly [string, string];
    readonly cap: number;
    readonly schedule: FunnelRaceSchedule;
  }): Promise<FunnelRaceObservation>;
  /**
   * `SkillRetirementService.run(origin, now)`. With `useAtCommit`, a real
   * invocation event is recorded for that slug through the product recorder
   * at the moment the pass re-reads the row before its destructive step.
   */
  retire(input: {
    readonly now: number;
    readonly useAtCommit?: {
      readonly slug: string;
      readonly sessionId: string;
    };
  }): Promise<FunnelRetireObservation>;
  activeDirExists(slug: string): boolean;
  /** An accepted suggestion with no promoted candidate (the pre-578 shape). */
  seedAcceptedSuggestion(input: {
    readonly slug: string;
    readonly body: string;
    readonly memberCandidateIds: readonly string[];
    readonly memberSessionIds: readonly string[];
  }): string;
  suggestionLinked(id: string): boolean;
  /** `SkillCuratorService.start` with the curator disabled: the boot reconcile only. */
  bootReconcile(suggestionId: string): Promise<'linked' | 'not-linked'>;
  /**
   * The curator pass waiting on a reconcile whose repropagation never
   * resolves. Resolves when the pass settled; never resolves today.
   */
  reconcileWait(): Promise<'settled'>;
  delivery(candidateId: string): Promise<FunnelDeliveryObservation>;
  laneStats(): FunnelLaneStats;
  close(): Promise<void>;
}

/** One simulated day of the backlog load. */
export interface FunnelBacklogDay {
  readonly day: number;
  readonly enqueued: number;
  readonly queuedByStage: Readonly<Record<string, number>>;
}

/** `skill.backlog.drain`: the scripted load over simulated days. */
export interface FunnelBacklogPort {
  begin(
    sessions: readonly FunnelSessionFile[],
    clock: FunnelClock,
  ): Promise<void>;
  /** Copy a template transcript under a new session id and enqueue it. */
  enqueueCopy(templateId: string, sessionId: string): Promise<void>;
  drainTick(tier: FunnelDrainTick['tier']): Promise<FunnelDrainTick>;
  queueRows(sessionPrefix: string): FunnelQueueRowView[];
  candidate(id: string): FunnelCandidateView | null;
  laneStats(): FunnelLaneStats;
  close(): Promise<void>;
}

/** The three ports one bench host context provides. */
export interface FunnelPorts {
  readonly run: () => FunnelRunPort;
  readonly lifecycle: () => FunnelLifecyclePort;
  readonly backlog: () => FunnelBacklogPort;
}
