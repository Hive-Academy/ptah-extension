/**
 * SkillJudgeService — LLM-as-judge gate during skill promotion (Signal 5).
 *
 * Evaluates a candidate's body against five skill-authoring criteria (novelty,
 * actionability, scope, generalization, triggerClarity), each scored 1-10 by the
 * LLM, and returns their composite average.
 *
 * ## It reports a STATUS; it never fabricates a score
 *
 * Before phase 1 this service failed OPEN: an unparseable reply, an out-of-range
 * score, or a thrown error each returned `{ passed: true, score: 10 }`. That is
 * a lie with a number attached — the UI rendered a fabricated perfect verdict,
 * and promotion waved the candidate through on the strength of it.
 *
 * All three of those paths now return `{ status: 'unscored', score: null }` with
 * a DISTINCT `reason`, and `score: 10` appears nowhere in this file. `unscored`
 * is neither a pass nor a block: the caller leaves the candidate at
 * `status='candidate'`, its queue row goes back to re-eligible with a backoff,
 * and the next drain retries. `disabled` is the separate "there is no gate
 * configured here" answer, and it does not block anything.
 *
 * Deciding whether a `scored` verdict is good ENOUGH is the caller's job, not
 * this service's — the threshold lives in `settings.minJudgeScore` and each
 * caller (promotion, the curator's suggestion pass, the enhancer) applies it
 * with its own policy for the two non-`scored` statuses.
 *
 * ## No timeout of its own
 *
 * `JUDGE_TIMEOUT_MS` is gone. Every LLM call in this library runs through
 * `LaneRunner`, which owns the `AbortController`, the lane's `timeoutMs`, the
 * `maxInputChars` clip and the structured-output ladder. The rubric travels as
 * `systemPromptAppend` precisely BECAUSE the lane clips: `maxInputChars` bounds
 * the candidate material, and clipping must never be able to eat the criteria
 * list or the "reply with ONLY JSON" instruction off the end of the prompt.
 *
 * Runs at the promotion gate and at the suggestion-pass gate — NOT at candidate
 * creation time.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type { SkillCandidateRow, SkillSynthesisSettings } from './types';
import type { JudgeCriterionScores, JudgeStatus } from './types';
import { SKILL_SYNTHESIS_TOKENS } from './di/tokens';
import type { LaneRun, LaneRunnerService } from './lanes/lane-runner.service';

/**
 * The five criteria of a `scored` verdict, every one of them populated.
 *
 * Deliberately NOT `JudgeCriterionScores` (whose fields are nullable): a partial
 * scorecard is exactly the condition that produces an `unscored` verdict, so a
 * `scored` decision that could still carry nulls would push that check onto
 * every consumer. Assignable to `JudgeCriterionScores` on the way to the store.
 */
export type JudgeCriteria = {
  [K in keyof JudgeCriterionScores]: number;
};

/**
 * Why the judge answered the way it did. Written verbatim to
 * `skill_candidates.judge_reason`, so these are stable tokens rather than free
 * prose — the enhancer and the UI both compare against them.
 *
 * The three `unscored` members are the three former fail-open sites, and they
 * are distinct on purpose: "the model said nothing parseable", "the model
 * answered with values that are not scores" and "the call never completed" are
 * three different defects, and collapsing them into one reason would make the
 * retry ladder impossible to diagnose from a queue row.
 */
export const JUDGE_REASONS = {
  /** A genuine composite verdict. The ONLY reason that carries a score. */
  verdict: 'judge-verdict',
  /** The gate is switched off, or this host has no LLM to run it on. */
  disabled: 'judge-disabled',
  /** Former fail-open site 1: the reply contained no usable JSON object. */
  noJson: 'judge-no-json-in-response',
  /** Former fail-open site 2: JSON parsed, but the five values are not scores. */
  invalidScores: 'judge-invalid-score-values',
  /** Former fail-open site 3: the call itself threw. */
  callThrew: 'judge-call-threw',
} as const;

export interface JudgeDecision {
  readonly status: JudgeStatus;
  /** Populated ONLY on `status: 'scored'`. Never a stand-in for "unknown". */
  readonly score: number | null;
  readonly criteria: JudgeCriteria | null;
  /** A `JUDGE_REASONS` member, or a lane failure's own user-facing reason. */
  readonly reason: string;
}

/**
 * The five criteria, in rubric order. Exported because the panel compares them
 * PER CRITERION — a headline-only comparison would let two panellists who agree
 * on the average while differing by six points on novelty pass as agreeing.
 */
export const JUDGE_CRITERION_KEYS = [
  'novelty',
  'actionability',
  'scope',
  'generalization',
  'triggerClarity',
] as const;

export const JUDGE_VERDICT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: Object.fromEntries(
    JUDGE_CRITERION_KEYS.map((key) => [
      key,
      { type: 'number', minimum: 1, maximum: 10 },
    ]),
  ),
  required: [...JUDGE_CRITERION_KEYS],
  additionalProperties: false,
};

/**
 * The scoring rubric. Fixed text, so it rides `systemPromptAppend` and is out of
 * reach of the lane's `maxInputChars` clip — see the header.
 */
const JUDGE_RUBRIC = [
  `Evaluate the synthesized skill the user supplies against skill-authoring best practices. A good skill is a REUSABLE, repo-agnostic workflow with a trigger-oriented description and concise, actionable steps. Reply with ONLY valid JSON.`,
  ``,
  `Score each criterion 1-10 (be strict — score low when in doubt):`,
  `- novelty: How novel/non-obvious is this versus common knowledge an agent already has?`,
  `- actionability: How directly executable are the steps (imperative, concrete, ordered)?`,
  `- scope: Is the scope a single well-defined workflow (not too broad, not a trivial one-off)?`,
  `- generalization: Is it repo-agnostic and transferable, with NO leftover workspace paths, file names, or session-specific details? Score 1-3 if it merely echoes one session or restates the user's request.`,
  `- triggerClarity: Does the description clearly state WHEN to use the skill, so another agent could decide to trigger it? Score low if vague or it just names the task.`,
  ``,
  `Reply with ONLY: {"novelty": <number>, "actionability": <number>, "scope": <number>, "generalization": <number>, "triggerClarity": <number>}`,
].join('\n');

@injectable()
export class SkillJudgeService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE)
    private readonly laneRunner: LaneRunnerService,
  ) {}

  /**
   * Evaluate a candidate. Returns a verdict, a stated inability to produce one,
   * or "the gate is off" — and never invents a number for the last two.
   *
   * @param lens Optional extra instruction, appended AFTER the rubric on the
   * unclippable half. The judge panel's second panellist supplies one so that it
   * asks a different QUESTION about the same artifact; every other caller omits
   * it and gets today's behaviour byte for byte. It rides `systemPromptAppend`
   * rather than `prompt` because `maxInputChars` clips `prompt`, and a clipped
   * lens turns the second panellist silently back into the first — see
   * `gates/judge-lens.ts`.
   */
  async judge(
    candidate: SkillCandidateRow,
    body: string,
    settings: SkillSynthesisSettings,
    context?: string,
    lens?: string,
  ): Promise<JudgeDecision> {
    if (!settings.judgeEnabled) {
      return disabled(JUDGE_REASONS.disabled);
    }

    let result;
    try {
      result = await this.laneRunner.run({
        laneId: 'judge',
        systemPromptAppend: withLens(lens),
        prompt: buildJudgePrompt(candidate, body, context),
        outputSchema: JUDGE_VERDICT_JSON_SCHEMA,
      });
    } catch (error: unknown) {
      // Former fail-open site 3. `LaneRunner` converts timeouts and cancellation
      // into a `failed` result, so reaching here means a transport error it did
      // not recognise — still "we do not know", never a pass.
      this.logger.warn('[skill-judge] judge call threw; verdict is unscored', {
        candidateId: candidate.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return unscored(JUDGE_REASONS.callThrew);
    }

    if (result.status === 'unavailable') {
      // A host with no LLM registered has nothing wrong with it, and this is
      // the pre-lane behaviour of an absent `InternalQueryService`.
      this.logger.debug('[skill-judge] no judge lane in this host', {
        candidateId: candidate.id,
        reason: result.reason,
      });
      return disabled(JUDGE_REASONS.disabled);
    }

    if (result.status === 'failed') {
      // A stalled lane (auth, timeout, no parseable output after both rungs).
      // The lane's own reason is already short and user-facing.
      this.logger.warn('[skill-judge] lane failed; verdict is unscored', {
        candidateId: candidate.id,
        kind: result.failure.kind,
        reason: result.failure.reason,
      });
      return unscored(result.failure.reason);
    }

    const raw = readJudgeVerdictObject(result.run);
    if (!raw) {
      // Former fail-open site 1.
      this.logger.warn('[skill-judge] could not extract JSON from response', {
        candidateId: candidate.id,
        raw: result.run.text.slice(0, 200),
      });
      return unscored(JUDGE_REASONS.noJson);
    }

    const criteria = toJudgeCriteria(raw);
    if (!criteria) {
      // Former fail-open site 2.
      this.logger.warn('[skill-judge] invalid score values in response', {
        candidateId: candidate.id,
        parsed: raw,
      });
      return unscored(JUDGE_REASONS.invalidScores);
    }

    const score = judgeComposite(criteria);
    this.logger.info('[skill-judge] verdict', {
      candidateId: candidate.id,
      composite: score,
      ...criteria,
    });
    return { status: 'scored', score, criteria, reason: JUDGE_REASONS.verdict };
  }
}

/**
 * The lane's JSON answer when it is an object, else this module's own flat
 * `{...}` scan over the assistant text.
 *
 * Both halves are load-bearing. `run.json` covers an endpoint that honoured
 * `outputFormat`, but it is `unknown`: a provider may honour the schema and
 * answer `null`, a string, or an array, none of which is a scorecard. The regex
 * is the `structuredOutput: 'parse'` path and must never be deleted as dead code
 * — it matches the FIRST FLAT object, which is deliberately narrower than the
 * runner's balanced-brace extractor and so still catches a verdict the runner
 * surfaced inside a larger wrapper object.
 *
 * A module-level function rather than a private method because the judge PANEL
 * (`gates/judge-panel.service.ts`) escalates a disagreement onto the `synthesis`
 * lane and has to read the SAME scorecard shape back. Two copies of this ladder
 * would drift the first time either side learned about a new wrapper shape, and
 * the drift would show up as one path silently scoring where the other reported
 * `unscored`.
 */
export function readJudgeVerdictObject(
  run: LaneRun,
): Record<string, unknown> | null {
  if (isPlainObject(run.json)) return run.json;

  const match = /\{[^{}]*\}/.exec(run.text.trim());
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(match[0]);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The rubric, plus a caller's lens when there is one.
 *
 * The lens goes LAST so the five criteria and the 1-10 scale are established
 * before anything narrows the question, and so the final line of the system
 * prompt is still a "reply with ONLY JSON" instruction.
 */
function withLens(lens?: string): string {
  const extra = lens?.trim() ?? '';
  return extra.length === 0 ? JUDGE_RUBRIC : `${JUDGE_RUBRIC}\n\n${extra}`;
}

/** The variable half of the prompt — the only half the lane may clip. */
function buildJudgePrompt(
  candidate: SkillCandidateRow,
  body: string,
  context?: string,
): string {
  return [
    `Skill name: ${candidate.name}`,
    `Skill description: ${candidate.description}`,
    ``,
    `Body:`,
    `---`,
    body,
    `---`,
    // Optional background material (e.g. the enhancer's measured-scorecard
    // block). Informational only — the five scoring criteria are unchanged.
    ...(context
      ? [
          ``,
          `Background (measured usage signal for context only — do NOT add new scoring criteria):`,
          context,
        ]
      : []),
  ].join('\n');
}

function disabled(reason: string): JudgeDecision {
  return { status: 'disabled', score: null, criteria: null, reason };
}

function unscored(reason: string): JudgeDecision {
  return { status: 'unscored', score: null, criteria: null, reason };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * All five criteria or nothing — a partial scorecard is not a verdict.
 *
 * Exported for the panel's escalation pass, for the same
 * one-definition-or-it-drifts reason {@link readJudgeVerdictObject} is.
 */
export function toJudgeCriteria(
  raw: Record<string, unknown>,
): JudgeCriteria | null {
  const out = {} as JudgeCriteria;
  for (const key of JUDGE_CRITERION_KEYS) {
    const score = toScore(raw[key]);
    if (score === null) return null;
    out[key] = score;
  }
  return out;
}

/** The composite the five criteria average to. Exported with its parser. */
export function judgeComposite(criteria: JudgeCriteria): number {
  const total = JUDGE_CRITERION_KEYS.reduce(
    (sum, key) => sum + criteria[key],
    0,
  );
  return total / JUDGE_CRITERION_KEYS.length;
}

/** Safely coerce an unknown value to a 1-10 score, or null if invalid. */
function toScore(v: unknown): number | null {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1 || n > 10) return null;
  return n;
}
