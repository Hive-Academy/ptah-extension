/**
 * JudgePanelService — a two-judge panel with disagreement escalation
 * (TASK_2026_180, B3.4.1).
 *
 * One judge's scorecard is one sample. This convenes a second on the SAME
 * `judge` lane, compares the two PER CRITERION, and — only when they disagree by
 * more than `skillSynthesis.judgePanel.disagreementThreshold` on any one of them
 * — pays for a third call on the `synthesis` lane that reads both rationales and
 * answers for itself. Every rationale the run produced is persisted to
 * `judge_panel_rationales`.
 *
 * ## THERE IS NO TRIBUNAL HERE, AND THAT IS A HARD CONSTRAINT
 *
 * "Panel" in this file means **two `IInternalQuery` calls on one lane**. It does
 * not mean the multi-vendor tribunal, and `libs/backend/skill-synthesis` imports
 * nothing from it — not the lib, not its types, not a helper. That is global
 * invariant 9, and it is asserted MECHANICALLY by a source scan in this file's
 * spec rather than trusted to this paragraph, the same way
 * `lane-resolver.providers.spec.ts` pins "no provider id" and
 * `skill-drain.failures.spec.ts` pins the single owner of the queue-row id the
 * runner takes. (That guard is a bare substring scan, so naming its field here
 * in prose would put this file on its offender list — hence the paraphrase.)
 *
 * The reason is dependency direction, not taste. The tribunal is a vendor-aware
 * orchestrator; this library is deliberately vendor-blind (lanes differ only by
 * declared capability) and runs inside a background drain with a token budget.
 * Importing an orchestrator that fans work out across vendors would put an
 * unbounded, provider-named cost behind a gate whose whole purpose is to be
 * cheap and measurable.
 *
 * ## R8 — the second judge only runs after a `scored` first verdict
 *
 * An `unscored` first verdict means "we do not know". Buying a second opinion to
 * average against an unknown is the fabrication phase 1 removed, wearing a
 * larger bill: there is nothing to compare, nothing to disagree with, and the
 * only possible outcomes are "we still do not know" and a number invented from
 * one half of a panel. So a non-`scored` first verdict returns immediately, ONE
 * call spent, and the candidate stays retry-eligible exactly as the single-judge
 * path leaves it.
 *
 * That, plus escalating only ABOVE the threshold, is the whole of R8's
 * mitigation: the panel costs 2 calls in the common case and 3 only when two
 * judges genuinely disagree, never the 4 a naive panel-plus-replay would.
 *
 * ## What the panel's verdict IS
 *
 *  - Both panellists `scored`, agreement within threshold → the per-criterion
 *    MEAN of the two, with the composite recomputed from the merged scorecard.
 *    Aggregating two verdicts that agree is not fabrication; it is the point.
 *  - Both `scored`, disagreement above threshold → whatever the ESCALATION says,
 *    and `unscored` when the escalation itself could not answer. The mean is
 *    deliberately NOT the fallback there: the two panellists disagreeing by more
 *    than the threshold is precisely the evidence that their midpoint means
 *    nothing, so publishing it would be a number no judge awarded.
 *  - First verdict not `scored` → that verdict, verbatim (R8).
 *
 * ## The panel writes both columns, or neither
 *
 * `recordJudgeVerdict` for the verdict, `recordJudgePanel` for the rationales.
 * The verdict write goes FIRST and is not wrapped: the store already throws on
 * `{status:'unscored', score:N}` and this service neither re-validates it nor
 * catches it, for the same reason `SkillPromotionService` does not.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SKILL_SYNTHESIS_TOKENS } from '../di/tokens';
import type { LaneRunnerService } from '../lanes/lane-runner.service';
import type { SkillCandidateStore } from '../skill-candidate.store';
import {
  JUDGE_CRITERION_KEYS,
  JUDGE_REASONS,
  JUDGE_VERDICT_JSON_SCHEMA,
  judgeComposite,
  readJudgeVerdictObject,
  toJudgeCriteria,
  type JudgeCriteria,
  type JudgeDecision,
  type SkillJudgeService,
} from '../skill-judge.service';
import type {
  JudgePanelRationale,
  SkillCandidateRow,
  SkillSynthesisSettings,
} from '../types';

/** Settings section, matching every other reader in this library. */
export const JUDGE_PANEL_SECTION = 'ptah';

/** The gate switch. Off ⇒ one judge, exactly as before the panel existed. */
export const JUDGE_PANEL_ENABLED_KEY = 'skillSynthesis.judgePanel.enabled';

/** The per-criterion gap that buys the escalation call. */
export const JUDGE_PANEL_THRESHOLD_KEY =
  'skillSynthesis.judgePanel.disagreementThreshold';

/** Defaults, matching `FILE_BASED_SETTINGS_DEFAULTS` in `platform-core`. */
export const JUDGE_PANEL_ENABLED_DEFAULT = true;
export const JUDGE_PANEL_THRESHOLD_DEFAULT = 3;

/**
 * Why the panel answered the way it did. Stable tokens, like `JUDGE_REASONS` —
 * the drain writes them to the queue row's user-facing `reason`.
 *
 * There is no `panel-disagreement` member: a disagreement is not an outcome, it
 * is what BUYS the escalation, and the outcome is then the escalation's own.
 */
export const JUDGE_PANEL_REASONS = {
  /** Two panellists agreed within the threshold; the verdict is their mean. */
  agreed: 'judge-panel-agreed',
  /** They disagreed and the escalation answered. */
  escalated: 'judge-panel-escalated',
  /** They disagreed and the escalation could not produce a scorecard. */
  escalationUnscored: 'judge-panel-escalation-unscored',
  /** The panel is switched off; the single judge's verdict stands. */
  disabled: 'judge-panel-disabled',
} as const;

/**
 * The escalation's fixed instructions. Rides `systemPromptAppend` for exactly
 * the reason the judge's rubric does: `maxInputChars` clips `prompt` and must
 * never be able to eat the "reply with ONLY JSON" line off the end.
 */
export const JUDGE_PANEL_ESCALATION_RUBRIC = [
  `Two independent reviewers scored the same skill document and disagreed. Read both scorecards and the skill, then give your OWN scores. Reply with ONLY valid JSON.`,
  ``,
  `You are not averaging them and you are not picking a side. Where they disagree, decide which reading the document actually supports, and say so with your numbers.`,
  ``,
  `Score each criterion 1-10, on the same rubric they used:`,
  `- novelty: How novel/non-obvious is this versus common knowledge an agent already has?`,
  `- actionability: How directly executable are the steps (imperative, concrete, ordered)?`,
  `- scope: Is the scope a single well-defined workflow (not too broad, not a trivial one-off)?`,
  `- generalization: Is it repo-agnostic and transferable, with NO leftover workspace paths, file names, or session-specific details?`,
  `- triggerClarity: Does the description clearly state WHEN to use the skill, so another agent could decide to trigger it?`,
  ``,
  `Be strict. A disagreement usually means one reviewer was generous, not that the truth is in the middle.`,
  ``,
  `Reply with ONLY: {"novelty": <number>, "actionability": <number>, "scope": <number>, "generalization": <number>, "triggerClarity": <number>}`,
].join('\n');

export interface JudgePanelRequest {
  readonly candidate: SkillCandidateRow;
  /** The drafted skill body, as the single judge already receives it. */
  readonly body: string;
  readonly settings: SkillSynthesisSettings;
  /** Optional background material, forwarded to both panellists unchanged. */
  readonly context?: string;
  /** The drain's tick signal, forwarded to the escalation lane call. */
  readonly signal?: AbortSignal;
  /** The queue row's attempt count. Drives the lane's timeout backoff only. */
  readonly attempt?: number;
}

export interface JudgePanelResult {
  /** The panel's verdict. Written through `recordJudgeVerdict` when persisted. */
  readonly verdict: JudgeDecision;
  /** Every rationale the run produced, in the order they were produced. */
  readonly rationales: readonly JudgePanelRationale[];
  /** Whether the third, `synthesis`-lane call happened. */
  readonly escalated: boolean;
  /**
   * The largest per-criterion gap between the two panellists, or `null` when
   * fewer than two of them scored. `null` is NOT `0`: "nobody compared" and
   * "they agreed exactly" are different facts.
   */
  readonly maxDelta: number | null;
  /** How many judge calls were made: 1 (R8, or panel off) or 2. */
  readonly panellists: number;
  /** A `JUDGE_PANEL_REASONS` member, or the single judge's own reason. */
  readonly reason: string;
  /** Whether the two writes happened. */
  readonly persisted: boolean;
}

@injectable()
export class JudgePanelService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_JUDGE_SERVICE)
    private readonly judge: SkillJudgeService,
    @inject(SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE)
    private readonly laneRunner: LaneRunnerService,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE)
    private readonly candidates: SkillCandidateStore,
  ) {}

  /**
   * Convene the panel for one candidate and persist what it decided.
   *
   * Resolves in every degraded case — this runs inside `drain()`, which never
   * throws. The one thing that DOES propagate is a store write that rejects the
   * verdict: reporting a panel verdict nobody stored would be the judge's
   * fabricated-score defect in a new costume.
   */
  async evaluate(req: JudgePanelRequest): Promise<JudgePanelResult> {
    const first = await this.judge.judge(
      req.candidate,
      req.body,
      req.settings,
      req.context,
    );

    // R8. An `unscored`/`disabled` first verdict ends the panel here: there is
    // nothing for a second opinion to disagree WITH.
    if (first.status !== 'scored' || first.criteria === null) {
      this.logger.debug(
        '[skill-judge-panel] first verdict is not scored; no second judge',
        {
          candidateId: req.candidate.id,
          status: first.status,
          reason: first.reason,
        },
      );
      return this.persist(req, {
        verdict: first,
        rationales: [rationale('panellist-a', first)],
        escalated: false,
        maxDelta: null,
        panellists: 1,
        reason: first.reason,
        persisted: false,
      });
    }

    if (!this.enabled()) {
      this.logger.debug(
        '[skill-judge-panel] panel disabled; one judge stands',
        {
          candidateId: req.candidate.id,
        },
      );
      return this.persist(req, {
        verdict: first,
        rationales: [rationale('panellist-a', first)],
        escalated: false,
        maxDelta: null,
        panellists: 1,
        reason: JUDGE_PANEL_REASONS.disabled,
        persisted: false,
      });
    }

    const second = await this.judge.judge(
      req.candidate,
      req.body,
      req.settings,
      req.context,
    );
    const rationales: JudgePanelRationale[] = [
      rationale('panellist-a', first),
      rationale('panellist-b', second),
    ];

    // A second panellist that could not score leaves nothing to compare. The
    // FIRST verdict stands rather than the panel collapsing to `unscored`: it
    // was a genuine scorecard and discarding it would spend two calls to end up
    // worse off than one.
    if (second.status !== 'scored' || second.criteria === null) {
      this.logger.info(
        '[skill-judge-panel] second panellist did not score; first verdict stands',
        {
          candidateId: req.candidate.id,
          status: second.status,
          reason: second.reason,
        },
      );
      return this.persist(req, {
        verdict: first,
        rationales,
        escalated: false,
        maxDelta: null,
        panellists: 2,
        reason: second.reason,
        persisted: false,
      });
    }

    const maxDelta = maxCriterionDelta(first.criteria, second.criteria);
    const threshold = this.disagreementThreshold();

    // STRICTLY greater. A delta exactly at the threshold is agreement — the key
    // is documented as "the two panellists disagree by MORE than N points".
    if (maxDelta <= threshold) {
      const merged = meanCriteria(first.criteria, second.criteria);
      return this.persist(req, {
        verdict: {
          status: 'scored',
          score: judgeComposite(merged),
          criteria: merged,
          reason: JUDGE_REASONS.verdict,
        },
        rationales,
        escalated: false,
        maxDelta,
        panellists: 2,
        reason: JUDGE_PANEL_REASONS.agreed,
        persisted: false,
      });
    }

    this.logger.info(
      '[skill-judge-panel] panellists disagree; escalating to the synthesis lane',
      { candidateId: req.candidate.id, maxDelta, threshold },
    );
    const escalation = await this.escalate(req, rationales);
    rationales.push(rationale('escalation', escalation));

    return this.persist(req, {
      verdict: escalation,
      rationales,
      escalated: true,
      maxDelta,
      panellists: 2,
      reason:
        escalation.status === 'scored'
          ? JUDGE_PANEL_REASONS.escalated
          : JUDGE_PANEL_REASONS.escalationUnscored,
      persisted: false,
    });
  }

  /**
   * The third call, on the `synthesis` lane.
   *
   * A different lane, not a different vendor: `synthesis` is the lane configured
   * for the heavier reasoning work in this library, and moving the tie-break
   * onto it is a capability decision. Nothing here knows or asks which provider
   * sits behind either lane.
   */
  private async escalate(
    req: JudgePanelRequest,
    rationales: readonly JudgePanelRationale[],
  ): Promise<JudgeDecision> {
    let result;
    try {
      result = await this.laneRunner.run({
        laneId: 'synthesis',
        systemPromptAppend: JUDGE_PANEL_ESCALATION_RUBRIC,
        prompt: buildEscalationPrompt(req, rationales),
        outputSchema: JUDGE_VERDICT_JSON_SCHEMA,
        signal: req.signal,
        attempt: req.attempt,
      });
    } catch (error: unknown) {
      this.logger.warn('[skill-judge-panel] the escalation call threw', {
        candidateId: req.candidate.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return unscored(JUDGE_REASONS.callThrew);
    }

    if (result.status === 'unavailable') {
      // A host with no LLM cannot escalate. `disabled` rather than `unscored`,
      // matching the judge: nothing is wrong with such a host.
      this.logger.debug('[skill-judge-panel] no synthesis lane in this host', {
        candidateId: req.candidate.id,
        reason: result.reason,
      });
      return {
        status: 'disabled',
        score: null,
        criteria: null,
        reason: JUDGE_REASONS.disabled,
      };
    }
    if (result.status === 'failed') {
      this.logger.warn('[skill-judge-panel] the escalation lane failed', {
        candidateId: req.candidate.id,
        kind: result.failure.kind,
        reason: result.failure.reason,
      });
      return unscored(result.failure.reason);
    }

    const raw = readJudgeVerdictObject(result.run);
    if (!raw) {
      this.logger.warn('[skill-judge-panel] no JSON in the escalation reply', {
        candidateId: req.candidate.id,
        raw: result.run.text.slice(0, 200),
      });
      return unscored(JUDGE_REASONS.noJson);
    }
    const criteria = toJudgeCriteria(raw);
    if (!criteria) {
      this.logger.warn('[skill-judge-panel] invalid escalation score values', {
        candidateId: req.candidate.id,
        parsed: raw,
      });
      return unscored(JUDGE_REASONS.invalidScores);
    }
    return {
      status: 'scored',
      score: judgeComposite(criteria),
      criteria,
      reason: JUDGE_REASONS.verdict,
    };
  }

  /**
   * Write the verdict, then the panel. Both, or neither.
   *
   * A `disabled` verdict from a host with no judge lane writes nothing at all:
   * there was no deliberation, and a one-entry panel recording "there is no
   * gate here" would put noise in a column the UI renders.
   */
  private persist(
    req: JudgePanelRequest,
    result: JudgePanelResult,
  ): JudgePanelResult {
    const recordable = result.rationales.filter(
      (entry) => entry.status !== 'disabled',
    );
    if (recordable.length === 0) return result;

    // Not wrapped, not re-validated: the store is the enforcing gate and an
    // impossible verdict MUST reach it and MUST throw.
    this.candidates.recordJudgeVerdict(req.candidate.id, {
      status: result.verdict.status,
      score: result.verdict.score,
      reason: result.verdict.reason,
      criteria: result.verdict.criteria ?? undefined,
    });
    this.candidates.recordJudgePanel(req.candidate.id, recordable);
    return { ...result, persisted: true };
  }

  private enabled(): boolean {
    try {
      const raw = this.workspace.getConfiguration<boolean>(
        JUDGE_PANEL_SECTION,
        JUDGE_PANEL_ENABLED_KEY,
        JUDGE_PANEL_ENABLED_DEFAULT,
      );
      return typeof raw === 'boolean' ? raw : JUDGE_PANEL_ENABLED_DEFAULT;
    } catch {
      return JUDGE_PANEL_ENABLED_DEFAULT;
    }
  }

  /**
   * The escalation threshold, on the judge's 0–10 scale.
   *
   * A negative value would escalate every candidate — three calls each, which is
   * exactly the cost R8 exists to bound — so it falls back rather than being
   * honoured. `0` IS honoured: it means "escalate on any disagreement at all",
   * which is a coherent (if expensive) thing to ask for.
   */
  private disagreementThreshold(): number {
    try {
      const raw = this.workspace.getConfiguration<number>(
        JUDGE_PANEL_SECTION,
        JUDGE_PANEL_THRESHOLD_KEY,
        JUDGE_PANEL_THRESHOLD_DEFAULT,
      );
      return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
        ? raw
        : JUDGE_PANEL_THRESHOLD_DEFAULT;
    } catch {
      return JUDGE_PANEL_THRESHOLD_DEFAULT;
    }
  }
}

/** The largest absolute per-criterion gap between two scorecards. */
export function maxCriterionDelta(a: JudgeCriteria, b: JudgeCriteria): number {
  let worst = 0;
  for (const key of JUDGE_CRITERION_KEYS) {
    const delta = Math.abs(a[key] - b[key]);
    if (delta > worst) worst = delta;
  }
  return worst;
}

/** The per-criterion mean of two scorecards that agreed. */
export function meanCriteria(
  a: JudgeCriteria,
  b: JudgeCriteria,
): JudgeCriteria {
  const out = {} as JudgeCriteria;
  for (const key of JUDGE_CRITERION_KEYS) {
    out[key] = (a[key] + b[key]) / 2;
  }
  return out;
}

function unscored(reason: string): JudgeDecision {
  return { status: 'unscored', score: null, criteria: null, reason };
}

/** One panellist's answer, in the shape `judge_panel_rationales` stores. */
function rationale(
  role: JudgePanelRationale['role'],
  decision: JudgeDecision,
): JudgePanelRationale {
  return {
    role,
    status: decision.status,
    score: decision.score,
    criteria: decision.criteria,
    reason: decision.reason,
    summary: renderRationale(role, decision),
  };
}

/**
 * The rendering the escalation reads and the row keeps.
 *
 * A non-`scored` panellist renders its REASON and no numbers. Printing a
 * placeholder score for it would hand the escalation a figure nobody awarded,
 * which is the whole defect this phase removed.
 */
export function renderRationale(
  role: JudgePanelRationale['role'],
  decision: JudgeDecision,
): string {
  if (decision.status !== 'scored' || decision.criteria === null) {
    return `${role}: no score (${decision.reason})`;
  }
  const scores = JUDGE_CRITERION_KEYS.map(
    (key) => `${key}=${decision.criteria?.[key]}`,
  ).join(', ');
  return `${role}: composite=${decision.score} (${scores})`;
}

/** The variable half — the only half the lane may clip. */
function buildEscalationPrompt(
  req: JudgePanelRequest,
  rationales: readonly JudgePanelRationale[],
): string {
  return [
    `Skill name: ${req.candidate.name}`,
    `Skill description: ${req.candidate.description}`,
    ``,
    `Body:`,
    `---`,
    req.body,
    `---`,
    ``,
    `The two reviewers said:`,
    ...rationales.map((entry) => entry.summary),
    ...(req.context
      ? [
          ``,
          `Background (measured usage signal for context only — do NOT add new scoring criteria):`,
          req.context,
        ]
      : []),
  ].join('\n');
}
