/**
 * ReplayValidatorService — the empirical replay gate (TASK_2026_180, B3.2).
 *
 * The judge asks a model whether a drafted skill LOOKS good. This asks
 * something a rubric cannot: hold one session out of the cluster the skill was
 * drafted from, hand a fresh `replay` lane the SKILL plus that session's
 * OPENING ASK, and see whether the plan it produces resembles what that session
 * actually did. A comparator call scores the resemblance 0–1 and the number is
 * persisted as `replay_confidence` beside the hold-out it was measured against.
 *
 * ## The hold-out is the whole experiment, and it must be a real one
 *
 * A skill graded against a session it was synthesized FROM measures memory, not
 * transfer. {@link selectHoldoutSessionId} therefore subtracts
 * `candidate.sourceSessionIds` from the cluster's sessions and returns `null`
 * when nothing is left — and a `null` hold-out yields a `null` confidence, not
 * a low one. Exported so the CLUSTER-SYNTHESIS stage can call the same function
 * to decide which member to EXCLUDE before drafting; the two must agree or the
 * gate reports `replay-no-holdout` forever. The pick is deterministic
 * (lexicographically greatest) so a re-run measures the same thing twice.
 *
 * ## THE ASK AND THE ACTUAL ARE SERVED SEPARATELY, ON PURPOSE
 *
 * The replay call sees the skill and the ask. It NEVER sees the hold-out's
 * outcome, routine or transcript. If it did, the comparator would be scoring a
 * summary against its own source and every candidate would read as excellent.
 * That split is why this is two lane calls rather than one.
 *
 * ## PLAN ONLY, NO FILE WRITES — three layers, one of them load-bearing
 *
 * This is a background stage that hands a model a real user's task and asks it
 * what it would do. Nothing about it may touch a workspace.
 *
 *  1. {@link REPLAY_PLAN_CONTRACT} travels as `systemPromptAppend`, which the
 *     lane does NOT clip. Putting it in `prompt` would let `maxInputChars` eat
 *     the "do not write files" clause off the end of a long skill body — the
 *     same defect the judge's rubric placement avoids. Pinned by a spec that
 *     runs the REAL runner with a tiny `maxInputChars`.
 *  2. `cwd` is `os.homedir()` on both calls, exactly as the one-shot callers in
 *     this library already do. A model with no repository under its working
 *     directory has nothing to edit even if it ignores layer 1.
 *  3. `maxTurns: 1`. The `replay` lane declares `toolUse: 'none'` by default, so
 *     the runner forces this anyway; it is stated explicitly so a user who sets
 *     `skillSynthesis.replay.toolUse` to `required` does not accidentally buy
 *     this stage a tool loop.
 *
 * Layers 2 and 3 are DEFENCE IN DEPTH and are deliberately redundant with
 * `LaneRunnerService`'s own defaults (`lane-runner.service.ts:303` already
 * falls back to `os.homedir()`, and `:285` already floors `maxTurns` at 1).
 * Removing them here therefore does not change what the endpoint receives
 * today — layer 1 is the only one whose removal is observable. That is written
 * down rather than left implied because an unenforceable safety contract that
 * reads as enforced is worse than an honest one.
 *
 * ## `null` is not `0`
 *
 * A replay that ran and matched nothing scores a genuine `0`, and that is
 * evidence AGAINST the candidate. A replay that could not run — no hold-out, no
 * evidence, an unparseable comparison — stores `null`, which means unmeasured
 * and leaves the candidate retry-eligible. `SkillCandidateStore.recordReplay`
 * is the enforcing edge (it rejects a confidence with no hold-out behind it);
 * this service must never coalesce one state into the other.
 *
 * ## R8 — weekly tier only
 *
 * The `replay` stage is in `WEEKLY_ONLY_STAGES` (`queue/skill-drain.service.ts`),
 * so the tier gate is the drain's and is already in place. The switch this
 * service owns is `skillSynthesis.replayValidation.enabled`.
 *
 * **The key is `replayValidation`, NOT `replay`.** `skillSynthesis.replay.*` is
 * the replay LANE's capability sub-tree (`lanes/skill-lane-config.ts`), and a
 * gate switch inside it would make `skillSynthesis.replay.enabled` look like a
 * ninth lane field. `platform-core/src/file-settings-keys.ts` carries the same
 * note beside the key.
 */
import * as os from 'node:os';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SKILL_SYNTHESIS_TOKENS } from '../di/tokens';
import type { LaneRun, LaneRunnerService } from '../lanes/lane-runner.service';
import type { SkillLaneFailure } from '../lanes/lane.types';
import type { SessionVerdictStore } from '../archaeology/session-verdict.store';
import type { SessionVerdict } from '../archaeology/session-verdict.types';
import type { SkillCandidateStore } from '../skill-candidate.store';
import {
  TrajectoryExtractor,
  type ExtractedTrajectory,
} from '../trajectory-extractor';
import type { SkillCandidateRow } from '../types';

/** The gate switch. See the header for why it is not `skillSynthesis.replay.enabled`. */
export const REPLAY_VALIDATION_ENABLED_KEY =
  'skillSynthesis.replayValidation.enabled';

/** Matches `SKILL_LANE_SECTION` and `SkillSynthesisService.readSettings`. */
const SETTINGS_SECTION = 'ptah';

/**
 * Why the gate answered the way it did. Written to the queue row's user-facing
 * `reason` by the drain, so these are stable tokens rather than free prose —
 * the same discipline `JUDGE_REASONS` keeps.
 */
export const REPLAY_REASONS = {
  /** A genuine measurement. The ONLY reason that carries a confidence. */
  measured: 'replay-measured',
  /** `skillSynthesis.replayValidation.enabled` is off. */
  disabled: 'replay-disabled',
  /** No LLM registered in this host (CLI, e2e). Not a failure. */
  noLane: 'replay-no-lane',
  /** Every session in the cluster fed the draft, so there is nothing to hold out. */
  noHoldout: 'replay-no-holdout',
  /** The hold-out has neither a usable verdict nor a readable trajectory. */
  noEvidence: 'replay-no-holdout-evidence',
  /** The replay lane answered, but with no plan in it. */
  emptyPlan: 'replay-empty-plan',
  /** The comparator answered, but with no usable 0–1 alignment in it. */
  unscoredComparison: 'replay-unscored-comparison',
} as const;

export type ReplayValidationStatus = 'measured' | 'unmeasured' | 'disabled';

export interface ReplayValidationRequest {
  /** The drafted candidate. `sourceSessionIds` is what the hold-out subtracts. */
  readonly candidate: SkillCandidateRow;
  /** The drafted skill body, as the judge already receives it. */
  readonly body: string;
  /** Every session in the cluster this candidate was drafted from. */
  readonly clusterSessionIds: readonly string[];
  /** Used to locate the hold-out's transcript. `''` is legal. */
  readonly workspaceRoot: string;
  /** The drain's tick signal. */
  readonly signal?: AbortSignal;
  /** The queue row's attempt count. Drives the lane's timeout backoff only. */
  readonly attempt?: number;
}

export interface ReplayValidationResult {
  readonly status: ReplayValidationStatus;
  /** Populated ONLY on `status: 'measured'`. Never a stand-in for "unknown". */
  readonly confidence: number | null;
  /** The session held out, when one was found — even if the measurement failed. */
  readonly holdoutSessionId: string | null;
  /**
   * The gate ran on `ExtractedTrajectory` text because the hold-out had no
   * usable verdict. The drain writes this to `payload.verdictFallback` so the
   * Activity tab can say the gate ran on weaker evidence.
   */
  readonly verdictFallback: boolean;
  /** A {@link REPLAY_REASONS} member, or a lane failure's own user-facing reason. */
  readonly reason: string;
  /** Whether `recordReplay` was called. False on `disabled` and on a lane failure. */
  readonly persisted: boolean;
  /** Non-null when a lane failed, so the drain can map it onto a row transition. */
  readonly failure: SkillLaneFailure | null;
}

/**
 * The evidence one gate run works from.
 *
 * TWO FIELDS, TWO SOURCES, DELIBERATELY NOT MERGED. `ask` is what the replay
 * call is given; `actual` is what only the comparator is given. Merging them
 * into one "context" blob is the single change that would make this gate
 * measure nothing while still producing a plausible number.
 */
export interface GateEvidence {
  readonly sessionId: string;
  /** The hold-out session's opening ask, handed to the replay lane. */
  readonly ask: string;
  /** What the hold-out session actually did. Comparator only. */
  readonly actual: string;
  /**
   * `true` ⇒ `actual` came from `ExtractedTrajectory.canonicalText` because the
   * hold-out had no usable verdict. This is the C2 ⇢ C3 soft edge: phase 3
   * ships and passes CI whether or not phase 2 has landed.
   */
  readonly fallback: boolean;
}

/** The comparator's reply shape, for lanes whose endpoint honours a schema. */
export const REPLAY_ALIGNMENT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    alignment: { type: 'number', minimum: 0, maximum: 1 },
    rationale: { type: 'string' },
  },
  required: ['alignment'],
};

/**
 * The replay call's fixed instructions. Rides `systemPromptAppend` so
 * `maxInputChars` can never clip the plan-only clause off the end — see the
 * header, layer 1.
 */
export const REPLAY_PLAN_CONTRACT = [
  `You are testing a skill document. You are NOT doing the work it describes.`,
  ``,
  `The user gives you a SKILL and a TASK. Write the plan you WOULD follow if you were to do that task using that skill.`,
  ``,
  `PLAN ONLY. These rules are absolute:`,
  `- Do NOT create, modify, move or delete any file, anywhere, for any reason.`,
  `- Do NOT run any command, test, build, script or tool.`,
  `- Do NOT read anything outside the text below. There is no repository here.`,
  `- Do NOT attempt to complete the task. Nobody is waiting for the result.`,
  ``,
  `Reply with the plan as a short numbered list of the concrete steps the skill would have you take, in order. Reply with nothing else.`,
].join('\n');

/**
 * The comparator's fixed instructions. Same `systemPromptAppend` placement, and
 * the same reason: the "reply with ONLY JSON" line must survive a clip.
 */
export const REPLAY_COMPARATOR_RUBRIC = [
  `Score how well a PLAN matches what a real session ACTUALLY did. Reply with ONLY valid JSON.`,
  ``,
  `Do NOT create or modify any file and do NOT run any command. Read the two texts and score them.`,
  ``,
  `"alignment" is a number from 0 to 1:`,
  `- 1.0 — the plan's steps cover what actually happened, in a compatible order, with nothing invented`,
  `- 0.5 — the plan gets the approach right but misses or adds substantial steps`,
  `- 0.0 — the plan describes different work`,
  ``,
  `Judge the STEPS, not the wording. A plan that would have reached the same outcome by an equally valid route scores high. Be strict, and score 0 rather than guessing — a 0 is a real result and is more useful than a flattering number.`,
  ``,
  `Reply with ONLY: {"alignment": <number between 0 and 1>, "rationale": "<one short sentence>"}`,
].join('\n');

@injectable()
export class ReplayValidatorService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE)
    private readonly laneRunner: LaneRunnerService,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE)
    private readonly candidates: SkillCandidateStore,
    @inject(SKILL_SYNTHESIS_TOKENS.SESSION_VERDICT_STORE)
    private readonly verdicts: SessionVerdictStore,
    @inject(TrajectoryExtractor)
    private readonly trajectories: TrajectoryExtractor,
  ) {}

  /**
   * Measure one candidate. Resolves in every degraded case — the drain's
   * `drain()` never throws, and a gate that threw on a missing transcript would
   * be the first thing to break that.
   *
   * The one exception is a `recordReplay` write that fails: that is the whole
   * point of the stage, and reporting `measured` for a number nobody stored
   * would be the judge's fabricated-score defect in a new costume. It
   * propagates to the drain's own catch.
   */
  async validate(
    req: ReplayValidationRequest,
  ): Promise<ReplayValidationResult> {
    if (!this.enabled()) {
      return outcome({ status: 'disabled', reason: REPLAY_REASONS.disabled });
    }

    const holdoutSessionId = selectHoldoutSessionId(
      req.clusterSessionIds,
      req.candidate.sourceSessionIds,
    );
    if (holdoutSessionId === null) {
      this.logger.debug('[skill-replay] no session left to hold out', {
        candidateId: req.candidate.id,
        cluster: req.clusterSessionIds.length,
      });
      // Nothing ran, so nothing is written: a `replay_at` stamp here would
      // claim a measurement was attempted against a hold-out that never
      // existed, and `recordReplay` would have to accept a null pair.
      return outcome({
        status: 'unmeasured',
        reason: REPLAY_REASONS.noHoldout,
      });
    }

    const evidence = await this.resolveEvidence(
      holdoutSessionId,
      req.workspaceRoot,
    );
    if (evidence === null) {
      this.logger.debug('[skill-replay] the hold-out yielded no evidence', {
        candidateId: req.candidate.id,
        holdoutSessionId,
      });
      return this.persistUnmeasured(
        req,
        holdoutSessionId,
        false,
        REPLAY_REASONS.noEvidence,
      );
    }

    const plan = await this.runPlan(req, evidence);
    if (plan.kind !== 'text') return this.mapLaneOutcome(plan, evidence);
    if (plan.text.length === 0) {
      this.logger.warn('[skill-replay] the replay lane produced no plan', {
        candidateId: req.candidate.id,
        holdoutSessionId,
      });
      return this.persistUnmeasured(
        req,
        holdoutSessionId,
        evidence.fallback,
        REPLAY_REASONS.emptyPlan,
      );
    }

    const comparison = await this.runComparator(req, evidence, plan.text);
    if (comparison.kind !== 'text') {
      return this.mapLaneOutcome(comparison, evidence);
    }

    const confidence = readAlignment(comparison.run);
    if (confidence === null) {
      this.logger.warn('[skill-replay] no usable alignment in the comparison', {
        candidateId: req.candidate.id,
        holdoutSessionId,
        raw: comparison.run.text.slice(0, 200),
      });
      return this.persistUnmeasured(
        req,
        holdoutSessionId,
        evidence.fallback,
        REPLAY_REASONS.unscoredComparison,
      );
    }

    this.candidates.recordReplay(req.candidate.id, {
      confidence,
      holdoutSessionId,
    });
    this.logger.info('[skill-replay] measured', {
      candidateId: req.candidate.id,
      holdoutSessionId,
      confidence,
      verdictFallback: evidence.fallback,
    });
    return outcome({
      status: 'measured',
      confidence,
      holdoutSessionId,
      verdictFallback: evidence.fallback,
      reason: REPLAY_REASONS.measured,
      persisted: true,
    });
  }

  /**
   * The hold-out's evidence, verdict-first.
   *
   * Both reads happen unconditionally because the `ask` and the `actual` come
   * from different places even on the happy path: the ask is the session's
   * OPENING message, which only the trajectory has, while the actual is the
   * analyzed routine, which only the verdict has. The verdict's `intent` is
   * explicitly not a first-message echo (`session-verdict.types.ts:6-11`), so
   * it stands in for the ask only when there is no trajectory at all.
   */
  private async resolveEvidence(
    sessionId: string,
    workspaceRoot: string,
  ): Promise<GateEvidence | null> {
    // ONE definition of "usable", and it is the store's. Re-deriving
    // `row !== null && row.degradedReason === null` here would fork the
    // predicate the moment either side changes.
    const usable = this.verdicts.hasUsableVerdict(sessionId);
    const verdict = usable ? this.verdicts.findBySession(sessionId) : null;

    let trajectory: ExtractedTrajectory | null = null;
    try {
      trajectory = await this.trajectories.extract(sessionId, workspaceRoot);
    } catch (error: unknown) {
      this.logger.debug('[skill-replay] could not read the hold-out session', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return resolveGateEvidence(sessionId, verdict, trajectory);
  }

  private async runPlan(
    req: ReplayValidationRequest,
    evidence: GateEvidence,
  ): Promise<LaneOutcome> {
    return this.run(req, {
      systemPromptAppend: REPLAY_PLAN_CONTRACT,
      prompt: buildPlanPrompt(req.candidate, req.body, evidence),
    });
  }

  private async runComparator(
    req: ReplayValidationRequest,
    evidence: GateEvidence,
    plan: string,
  ): Promise<LaneOutcome> {
    return this.run(req, {
      systemPromptAppend: REPLAY_COMPARATOR_RUBRIC,
      prompt: buildComparatorPrompt(evidence, plan),
      outputSchema: REPLAY_ALIGNMENT_JSON_SCHEMA,
    });
  }

  /**
   * The single place a lane call is made, so the three plan-only layers cannot
   * be present on one call and forgotten on the other.
   */
  private async run(
    req: ReplayValidationRequest,
    parts: {
      systemPromptAppend: string;
      prompt: string;
      outputSchema?: Record<string, unknown>;
    },
  ): Promise<LaneOutcome> {
    let result;
    try {
      result = await this.laneRunner.run({
        laneId: 'replay',
        systemPromptAppend: parts.systemPromptAppend,
        prompt: parts.prompt,
        outputSchema: parts.outputSchema,
        // Layers 2 and 3 of the plan-only contract. See the header.
        cwd: os.homedir(),
        maxTurns: 1,
        signal: req.signal,
        attempt: req.attempt,
      });
    } catch (error: unknown) {
      // `LaneRunner` converts timeouts and cancellation into a `failed` result,
      // so reaching here is a transport error it did not recognise. Still "we
      // do not know", never a confidence.
      this.logger.warn('[skill-replay] the replay lane threw', {
        candidateId: req.candidate.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return { kind: 'threw' };
    }

    if (result.status === 'unavailable') {
      this.logger.debug('[skill-replay] no replay lane in this host', {
        candidateId: req.candidate.id,
        reason: result.reason,
      });
      return { kind: 'unavailable' };
    }
    if (result.status === 'failed') {
      this.logger.warn('[skill-replay] the replay lane failed', {
        candidateId: req.candidate.id,
        kind: result.failure.kind,
        reason: result.failure.reason,
      });
      return { kind: 'failed', failure: result.failure };
    }
    return { kind: 'text', run: result.run, text: result.run.text.trim() };
  }

  /**
   * A lane that never answered leaves the candidate EXACTLY as it was.
   *
   * No `replay_at` stamp, no `null` confidence write: the row must stay
   * indistinguishable from "not yet measured" so the next weekly tick tries
   * again. `unavailable` is reported as `disabled` for the same reason the
   * judge does — a host with no LLM has nothing wrong with it and must not
   * carry a retry backoff for a stage it can never run.
   */
  private mapLaneOutcome(
    outcomeOfLane: Exclude<LaneOutcome, { kind: 'text' }>,
    evidence: GateEvidence,
  ): ReplayValidationResult {
    if (outcomeOfLane.kind === 'unavailable') {
      return outcome({
        status: 'disabled',
        holdoutSessionId: evidence.sessionId,
        verdictFallback: evidence.fallback,
        reason: REPLAY_REASONS.noLane,
      });
    }
    if (outcomeOfLane.kind === 'threw') {
      return outcome({
        status: 'unmeasured',
        holdoutSessionId: evidence.sessionId,
        verdictFallback: evidence.fallback,
        reason: REPLAY_REASONS.unscoredComparison,
      });
    }
    return outcome({
      status: 'unmeasured',
      holdoutSessionId: evidence.sessionId,
      verdictFallback: evidence.fallback,
      reason: outcomeOfLane.failure.reason,
      failure: outcomeOfLane.failure,
    });
  }

  /**
   * The gate RAN and produced no trustworthy number. `null` is stored with the
   * hold-out and a fresh `replay_at`, which is a different record from "never
   * measured" — the Activity tab can say the gate ran and came back empty.
   */
  private persistUnmeasured(
    req: ReplayValidationRequest,
    holdoutSessionId: string,
    verdictFallback: boolean,
    reason: string,
  ): ReplayValidationResult {
    this.candidates.recordReplay(req.candidate.id, {
      confidence: null,
      holdoutSessionId,
    });
    return outcome({
      status: 'unmeasured',
      holdoutSessionId,
      verdictFallback,
      reason,
      persisted: true,
    });
  }

  private enabled(): boolean {
    try {
      const raw = this.workspace.getConfiguration<boolean>(
        SETTINGS_SECTION,
        REPLAY_VALIDATION_ENABLED_KEY,
        true,
      );
      return typeof raw === 'boolean' ? raw : true;
    } catch {
      return true;
    }
  }
}

/** What one lane call produced, before `validate` interprets it. */
type LaneOutcome =
  | { readonly kind: 'text'; readonly run: LaneRun; readonly text: string }
  | { readonly kind: 'failed'; readonly failure: SkillLaneFailure }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'threw' };

function outcome(
  parts: Partial<ReplayValidationResult> & {
    status: ReplayValidationStatus;
    reason: string;
  },
): ReplayValidationResult {
  return {
    confidence: null,
    holdoutSessionId: null,
    verdictFallback: false,
    persisted: false,
    failure: null,
    ...parts,
  };
}

/**
 * The cluster member to hold out, or `null` when the cluster has none.
 *
 * `used` is subtracted because a skill graded against a session it was drafted
 * from measures recall, not transfer. Deterministic (lexicographically
 * greatest) so the cluster-synthesis stage and this gate agree on which member
 * to exclude without passing the choice between them, and so a re-run of the
 * gate measures the same pair twice.
 *
 * Blank and duplicate ids are dropped: an empty session id addresses no
 * transcript and would be persisted as a hold-out nobody can look up.
 */
export function selectHoldoutSessionId(
  clusterSessionIds: readonly string[],
  used: readonly string[] = [],
): string | null {
  const excluded = new Set(used.map((id) => id.trim()).filter(Boolean));
  const eligible = [
    ...new Set(clusterSessionIds.map((id) => id.trim()).filter(Boolean)),
  ]
    .filter((id) => !excluded.has(id))
    .sort();
  return eligible.length > 0 ? eligible[eligible.length - 1] : null;
}

/**
 * Pick the evidence base for one gate run: the analyzed verdict when there is a
 * usable one, otherwise the raw trajectory.
 *
 * SHARED WITH TRIGGER-EVAL (B3.3). Both gates need the identical branch and the
 * identical `fallback` flag, and two copies would drift the day one of them
 * learns about a new verdict field. It lives in this file only because B3.2
 * landed first; move it to `gates/gate-evidence.ts` when there is a second
 * caller.
 *
 * `verdict` must ALREADY have passed `SessionVerdictStore.hasUsableVerdict` —
 * this function does not re-derive that predicate, so there is exactly one
 * definition of "usable" in the codebase.
 */
export function resolveGateEvidence(
  sessionId: string,
  verdict: SessionVerdict | null,
  trajectory: ExtractedTrajectory | null,
): GateEvidence | null {
  // The opening ask. The trajectory's `shortDescription` IS the first user
  // turn; the verdict's `intent` is an ANALYZED goal and is deliberately not a
  // first-message echo, so it stands in only when there is no trajectory.
  const ask =
    nonEmpty(trajectory?.shortDescription) ?? nonEmpty(verdict?.intent) ?? null;
  if (ask === null) return null;

  const fromVerdict = renderVerdictEvidence(verdict);
  if (fromVerdict !== null) {
    return { sessionId, ask, actual: fromVerdict, fallback: false };
  }

  const fromTrajectory = nonEmpty(trajectory?.canonicalText);
  if (fromTrajectory === null) return null;
  return { sessionId, ask, actual: fromTrajectory, fallback: true };
}

/**
 * The verdict rendered as "what actually happened", or `null` when the verdict
 * carries nothing to compare against.
 *
 * A present-but-empty verdict falls through to the trajectory rather than
 * feeding the comparator a blank: a comparison against nothing scores 0, and a
 * 0 means "the plan was wrong", which would be a fabricated result.
 */
function renderVerdictEvidence(verdict: SessionVerdict | null): string | null {
  if (!verdict) return null;
  const lines: string[] = [];
  const outcomeText = nonEmpty(verdict.outcome);
  if (outcomeText) lines.push(`Outcome: ${outcomeText}`);
  if (verdict.evidenceClass) {
    lines.push(`Evidence: ${verdict.evidenceClass}`);
  }
  if (verdict.routine) {
    lines.push(`Routine: ${verdict.routine.summary}`);
    verdict.routine.steps.forEach((step, i) =>
      lines.push(`  ${i + 1}. ${step}`),
    );
  }
  const friction = verdict.frictionMap
    .map(
      (entry) => `  - turn ${entry.turnIndex} (${entry.kind}): ${entry.note}`,
    )
    .join('\n');
  if (friction.length > 0) lines.push(`Friction:`, friction);
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * The replay call's variable half — the SKILL and the ASK, and nothing about
 * what the hold-out actually did. See the header.
 */
function buildPlanPrompt(
  candidate: SkillCandidateRow,
  body: string,
  evidence: GateEvidence,
): string {
  return [
    `SKILL`,
    `Name: ${candidate.name}`,
    `Description: ${candidate.description}`,
    `---`,
    body,
    `---`,
    ``,
    `TASK`,
    evidence.ask,
  ].join('\n');
}

/** The comparator's variable half — the plan, and what actually happened. */
function buildComparatorPrompt(evidence: GateEvidence, plan: string): string {
  return [
    `TASK`,
    evidence.ask,
    ``,
    `PLAN produced from the skill`,
    `---`,
    plan,
    `---`,
    ``,
    `WHAT THE REAL SESSION ACTUALLY DID`,
    `---`,
    evidence.actual,
    `---`,
  ].join('\n');
}

/**
 * The lane's JSON answer when it is an object, else a flat `{...}` scan over
 * the assistant text.
 *
 * Both halves are load-bearing and neither is dead code (global invariant 6):
 * `run.json` covers an endpoint that honoured `outputFormat` but is `unknown`,
 * and the regex is the ONLY path for a lane declaring
 * `structuredOutput: 'parse'`. Copied in shape from `SkillJudgeService`, which
 * is the established reader for this library.
 */
function readAlignment(run: LaneRun): number | null {
  const direct = toAlignment(pick(run.json));
  if (direct !== null) return direct;

  const match = /\{[^{}]*\}/.exec(run.text.trim());
  if (!match) return null;
  try {
    return toAlignment(pick(JSON.parse(match[0])));
  } catch {
    return null;
  }
}

function pick(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return (value as Record<string, unknown>)['alignment'];
}

/**
 * A finite 0–1 number, or `null`.
 *
 * An out-of-range or unparseable answer is UNMEASURED, never clamped: clamping
 * `1.4` to `1` invents a perfect score out of a reply that did not follow the
 * rubric, which is precisely the fabricated-verdict defect phase 1 removed from
 * the judge.
 */
function toAlignment(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
