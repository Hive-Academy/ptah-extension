/**
 * TriggerEvalService — the one gate in this library that MEASURES instead of
 * asking a model what it thinks.
 *
 * ## What it answers
 *
 * `SkillJudgeService` scores a criterion called `triggerClarity`: a model's
 * opinion of whether a description reads like it would fire at the right
 * moment. That opinion is unfalsifiable and it has never been checked against
 * what retrieval actually does. This service replaces it in ranking with a
 * number that was measured:
 *
 *   Given prompts this skill SHOULD answer and prompts it should NOT, how often
 *   does its DESCRIPTION come back from retrieval?
 *
 * ## Zero LLM cost on the retrieval path — this is the defining property
 *
 * Exactly ONE lane call happens per evaluation, and it happens before any
 * measuring: the ~5 should-trigger + ~5 near-miss prompts are generated on the
 * cheapest lane. Everything after that — embedding, ranking, precision, recall,
 * score, collisions — is local `IEmbedder` arithmetic. Nothing in the scoring
 * path may ever call a model, because the moment a model scores the retrieval
 * this stops being a measurement and becomes a second judge, which is the thing
 * it exists to replace. `trigger-eval.service.spec.ts` pins the call count at
 * one AND scans this file's text for a second `laneRunner.run(` call site.
 *
 * ## Description-only, and why that is not the same as the dedup embedding
 *
 * A candidate's STORED embedding is built from `ExtractedTrajectory.canonical
 * Text` — the session transcript (`skill-synthesis.service.ts:940`). That is
 * what cosine dedup and clustering compare. It is NOT what decides whether a
 * skill fires: an agent choosing between skills reads DESCRIPTIONS. So this
 * service embeds descriptions itself, freshly, for the target and for every
 * active skill, and never reuses the stored vectors for the retrieval.
 *
 * That difference is the whole of the collision finding. Two skills can carry
 * nearly identical descriptions while their transcripts diverge enough that
 * dedup's cosine similarity never crosses `dedupClusterThreshold` — so dedup
 * reports two distinct skills and the agent, reading only descriptions, cannot
 * tell them apart. `SkillCandidateStore.searchActiveByEmbedding` is used HERE
 * for exactly that cross-check: it is the dedup-space view, and a collision it
 * does not surface is a collision dedup misses.
 *
 * ## The near-miss half is not optional
 *
 * Precision over should-trigger prompts alone is 1.0 by construction and
 * measures nothing at all. The near-misses are the only source of false
 * positives, and therefore the only reason precision is a number rather than a
 * formality. `measureRetrieval` REFUSES to score a prompt set with an empty
 * side: it returns an all-`null` measurement rather than a flattering one.
 *
 * ## `null` is not `0`
 *
 * A precision of `0` means the description retrieved nothing it should have,
 * and that is evidence AGAINST the candidate. `null` means the measurement
 * never happened, and must leave the candidate exactly as retry-eligible as it
 * was. `SkillCandidateStore.recordTriggerEval` pins that distinction at the
 * write; nothing here may coalesce one into the other.
 *
 * ## The write rule, in one sentence
 *
 * The candidate is written to IFF prompt generation succeeded — numbers when
 * the set was scoreable, `null`s when it was not. Everything that stopped the
 * eval before the prompts existed (gate off, no embedder, no description, a
 * lane that failed or is absent) writes NOTHING, so a previous good measurement
 * survives a host that simply cannot run the gate today.
 *
 * ## Known bias, stated rather than hidden
 *
 * The prompts are generated FROM the description, so a description that is
 * self-consistent scores better than one describing a workflow it does not
 * actually implement. The gate measures "does this description attract what it
 * claims to attract", not "is the claim true" — that is replay's job. Both
 * halves share the bias, which is why precision stays informative even though
 * recall is generous.
 */
import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  PERSISTENCE_TOKENS,
  type IEmbedder,
} from '@ptah-extension/persistence-sqlite';
import { SKILL_SYNTHESIS_TOKENS } from '../di/tokens';
import type { LaneRun, LaneRunnerService } from '../lanes/lane-runner.service';
import type { SkillCandidateStore } from '../skill-candidate.store';
import { cosineSimilarity } from '../cosine-similarity';
import type {
  CandidateId,
  SkillCandidateRow,
  SkillSynthesisSettings,
  TriggerEvalMeasurement,
} from '../types';

/** Settings section, matching every other reader in this library. */
export const TRIGGER_EVAL_SECTION = 'ptah';

/** The gate switch. Routed by B3.1 into `FILE_BASED_SETTINGS_KEYS`. */
export const TRIGGER_EVAL_ENABLED_KEY = 'skillSynthesis.triggerEval.enabled';

/** Default when the key is absent, matching `FILE_BASED_SETTINGS_DEFAULTS`. */
export const TRIGGER_EVAL_ENABLED_DEFAULT = true;

/** How many prompts of each kind the generation pass is asked for. */
export const TRIGGER_EVAL_PROMPTS_PER_SIDE = 5;

/**
 * A hard ceiling per side, applied to what the model returned. A generation
 * pass that answers with forty prompts would quietly turn a bounded local
 * computation into an unbounded one, and the extra prompts are not better
 * evidence — they are the same evidence, restated.
 */
export const TRIGGER_EVAL_MAX_PROMPTS_PER_SIDE = 8;

/**
 * How many skills a retrieval is assumed to surface. Models the shortlist an
 * agent would actually consider, not the whole library.
 */
export const TRIGGER_EVAL_TOP_K = 3;

/**
 * The absolute similarity a description must reach before "it was returned"
 * means anything.
 *
 * WITHOUT THIS THE NEAR-MISS HALF COLLAPSES ON A SMALL LIBRARY. Top-K is a
 * RELATIVE test: with two active skills, every prompt in the language retrieves
 * both of them, so every near-miss counts as a false positive and precision is
 * pinned near 0.5 regardless of what the description says. The floor restores
 * the absolute question — "is this description actually about that prompt" —
 * which is the one the agent is really asking. It is a tunable constant rather
 * than a measured value, and that is the one unmeasured knob in this file; it
 * is stated here so it is tuned deliberately instead of discovered.
 */
export const TRIGGER_EVAL_MIN_SIMILARITY = 0.35;

/**
 * How close a rival description has to come, on one of OUR prompts, to count as
 * a collision. Not "strictly higher": a rival a hair below the target still
 * makes the choice a coin-flip for the agent, and reporting only outright
 * losses would hide exactly the ambiguous pairs worth rewriting.
 */
export const TRIGGER_EVAL_COLLISION_MARGIN = 0.02;

/** Why an evaluation never reached the retrieval. Stable tokens, not prose. */
export const TRIGGER_EVAL_SKIP_REASONS = {
  /** `skillSynthesis.triggerEval.enabled` is off. */
  disabled: 'trigger-eval-disabled',
  /** The candidate has no description to retrieve on. */
  noDescription: 'trigger-eval-no-description',
  /** No `IEmbedder` in this host — retrieval is not computable here. */
  noEmbedder: 'trigger-eval-no-embedder',
  /** No lane in this host, or the lane failed / answered unparseably. */
  noPrompts: 'trigger-eval-prompt-generation-unavailable',
} as const;

/** Why a measurement came back all-`null` despite the retrieval running. */
export const TRIGGER_EVAL_UNMEASURED_REASONS = {
  /** No should-trigger prompts — there is nothing recall could be over. */
  noPositives: 'trigger-eval-no-should-trigger-prompts',
  /**
   * No near-miss prompts. Precision without negatives is 1.0 by construction,
   * so scoring here would publish a number that measured nothing.
   */
  noNegatives: 'trigger-eval-no-near-miss-prompts',
  /** The embedder returned a vector count that does not match its input. */
  badVectors: 'trigger-eval-embedder-returned-unusable-vectors',
} as const;

export type TriggerEvalSkipReason =
  (typeof TRIGGER_EVAL_SKIP_REASONS)[keyof typeof TRIGGER_EVAL_SKIP_REASONS];

export type TriggerEvalUnmeasuredReason =
  (typeof TRIGGER_EVAL_UNMEASURED_REASONS)[keyof typeof TRIGGER_EVAL_UNMEASURED_REASONS];

/**
 * What the gate reads. Structural rather than `SkillCandidateRow` so a caller
 * holding a freshly drafted skill can evaluate it before it is a row; a
 * `SkillCandidateRow` satisfies it as-is.
 */
export interface TriggerEvalTarget {
  readonly id: CandidateId;
  /** The trigger-oriented description. The ONLY text retrieval sees. */
  readonly description: string;
  /** Optional human title; used only to make the generated prompts concrete. */
  readonly displayName?: string | null;
  /**
   * The candidate's stored (transcript-derived) embedding row, when it has
   * one. Read ONLY to ask what dedup would have seen — never for retrieval.
   */
  readonly embeddingRowid?: number | null;
}

export interface TriggerPromptSet {
  readonly shouldTrigger: readonly string[];
  readonly nearMiss: readonly string[];
}

/** One prompt, and what retrieval did with it. */
export interface TriggerPromptOutcome {
  readonly prompt: string;
  readonly kind: 'should-trigger' | 'near-miss';
  /** Cosine of the target's DESCRIPTION against this prompt. */
  readonly targetSimilarity: number;
  /** Rank of the target among the retrieval corpus, 0-based. */
  readonly targetRank: number;
  /** In the top K AND above the similarity floor. */
  readonly triggered: boolean;
}

/**
 * An active skill whose DESCRIPTION competes for a prompt that belongs to the
 * candidate, and which dedup's transcript-space comparison does not flag.
 */
export interface DescriptionCollision {
  readonly rivalId: CandidateId;
  readonly rivalName: string;
  /** The should-trigger prompt on which the rival came closest. */
  readonly prompt: string;
  /** Rival description ↔ prompt. */
  readonly rivalSimilarity: number;
  /** Target description ↔ same prompt. */
  readonly targetSimilarity: number;
  /**
   * What `searchActiveByEmbedding` — the dedup-space view — reports for this
   * pair. `null` means dedup cannot see the pair at all (no stored vector, or
   * no vector extension in this host), which is the strongest form of "missed".
   */
  readonly dedupSimilarity: number | null;
}

export interface TriggerEvalReport {
  /** Exactly what was handed to `recordTriggerEval`. */
  readonly measurement: TriggerEvalMeasurement;
  readonly prompts: TriggerPromptSet;
  readonly outcomes: readonly TriggerPromptOutcome[];
  readonly collisions: readonly DescriptionCollision[];
  /** Set when `measurement` is all-`null` despite the retrieval running. */
  readonly unmeasuredReason: TriggerEvalUnmeasuredReason | null;
  /** How many active skills competed, excluding the target itself. */
  readonly activeCompared: number;
}

export type TriggerEvalOutcome =
  | { readonly status: 'evaluated'; readonly report: TriggerEvalReport }
  | { readonly status: 'skipped'; readonly reason: TriggerEvalSkipReason };

/** The generation pass, as a JSON Schema for lanes whose endpoint honours one. */
export const TRIGGER_PROMPTS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    shouldTrigger: { type: 'array', items: { type: 'string' } },
    nearMiss: { type: 'array', items: { type: 'string' } },
  },
  required: ['shouldTrigger', 'nearMiss'],
  additionalProperties: false,
};

/**
 * Parsed permissively on purpose. An empty side is NOT a parse error — it is a
 * measurable fact about the generation pass, and the decision not to score it
 * belongs in `measureRetrieval` where it can be read beside the rule it
 * enforces, not scattered into a schema.
 */
const TriggerPromptsSchema = z.object({
  shouldTrigger: z.array(z.string()),
  nearMiss: z.array(z.string()),
});

/**
 * Fixed instructions, so they ride `systemPromptAppend` and stay out of reach
 * of the lane's `maxInputChars` clip — the same rule the judge rubric follows.
 */
const TRIGGER_PROMPT_RUBRIC = [
  `You are building an evaluation set for a retrieval system that decides which reusable workflow skill to surface for a user's request.`,
  ``,
  `Reply with ONLY: {"shouldTrigger": string[], "nearMiss": string[]}. No preamble, no code fences.`,
  ``,
  `shouldTrigger: exactly ${TRIGGER_EVAL_PROMPTS_PER_SIDE} requests a user would type where THIS skill is the right one to surface.`,
  `nearMiss: exactly ${TRIGGER_EVAL_PROMPTS_PER_SIDE} requests that are plausibly adjacent — same domain, same vocabulary, same tools — but where surfacing this skill would be WRONG.`,
  ``,
  `Rules for both lists:`,
  `- Write how a developer actually types: one or two sentences, imperative, concrete.`,
  `- Do NOT reuse the wording of the description. Paraphrasing it measures nothing.`,
  `- The near misses must be genuinely tempting. Unrelated requests make the evaluation worthless.`,
].join('\n');

@injectable()
export class TriggerEvalService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE)
    private readonly laneRunner: LaneRunnerService,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE)
    private readonly store: SkillCandidateStore,
    /**
     * Optional for the same reason every other consumer's is: a host with no
     * embedder registered still resolves this service, and answers `skipped`.
     * Retrieval is not approximable without it — there is no cheaper fallback
     * that would still be a measurement.
     */
    @inject(PERSISTENCE_TOKENS.EMBEDDER, { isOptional: true })
    private readonly embedder: IEmbedder | null = null,
  ) {}

  /** Whether the gate is switched on in this workspace. */
  isEnabled(): boolean {
    return (
      this.workspace.getConfiguration<boolean>(
        TRIGGER_EVAL_SECTION,
        TRIGGER_EVAL_ENABLED_KEY,
        TRIGGER_EVAL_ENABLED_DEFAULT,
      ) ?? TRIGGER_EVAL_ENABLED_DEFAULT
    );
  }

  /**
   * Measure how well `target`'s description retrieves, and persist the result.
   *
   * Writes to the candidate iff prompt generation succeeded — see the header's
   * write rule. Never throws for an absent capability; a genuine defect (a
   * store that cannot write, an embedder that rejects) propagates, because the
   * drain's own catch is where a defect belongs.
   */
  async evaluate(
    target: TriggerEvalTarget,
    settings: SkillSynthesisSettings,
    signal?: AbortSignal,
  ): Promise<TriggerEvalOutcome> {
    if (!this.isEnabled()) {
      return { status: 'skipped', reason: TRIGGER_EVAL_SKIP_REASONS.disabled };
    }
    const description = target.description.trim();
    if (description.length === 0) {
      return {
        status: 'skipped',
        reason: TRIGGER_EVAL_SKIP_REASONS.noDescription,
      };
    }
    const embedder = this.embedder;
    if (!embedder) {
      this.logger.debug(
        '[skill-trigger-eval] no embedder in this host; retrieval is not computable',
        { candidateId: target.id },
      );
      return {
        status: 'skipped',
        reason: TRIGGER_EVAL_SKIP_REASONS.noEmbedder,
      };
    }

    // The ONE lane call. Everything below this line is local arithmetic.
    const prompts = await this.generatePrompts(target, description, signal);
    if (!prompts) {
      return { status: 'skipped', reason: TRIGGER_EVAL_SKIP_REASONS.noPrompts };
    }

    const rivals = this.activeRivals(target.id);
    const texts = [
      description,
      ...rivals.map((row) => row.description.trim()),
      ...prompts.shouldTrigger,
      ...prompts.nearMiss,
    ];
    const vectors = await embedder.embed(texts);
    if (vectors.length !== texts.length) {
      this.logger.warn(
        '[skill-trigger-eval] embedder returned a vector count that does not match its input',
        {
          candidateId: target.id,
          expected: texts.length,
          received: vectors.length,
        },
      );
      return this.persist(target.id, UNMEASURED, prompts, {
        outcomes: [],
        collisions: [],
        unmeasuredReason: TRIGGER_EVAL_UNMEASURED_REASONS.badVectors,
        activeCompared: rivals.length,
      });
    }

    const targetVector = vectors[0];
    const rivalVectors = vectors.slice(1, 1 + rivals.length);
    const promptVectors = vectors.slice(1 + rivals.length);

    const outcomes: TriggerPromptOutcome[] = [];
    const collisionsByRival = new Map<CandidateId, DescriptionCollision>();

    for (let i = 0; i < promptVectors.length; i++) {
      const isPositive = i < prompts.shouldTrigger.length;
      const prompt = texts[1 + rivals.length + i];
      const promptVector = promptVectors[i];
      const targetSimilarity = cosineSimilarity(targetVector, promptVector);

      let rank = 0;
      for (let r = 0; r < rivals.length; r++) {
        const rivalSimilarity = cosineSimilarity(rivalVectors[r], promptVector);
        if (rivalSimilarity > targetSimilarity) rank++;
        if (!isPositive) continue;
        if (rivalSimilarity < TRIGGER_EVAL_MIN_SIMILARITY) continue;
        if (rivalSimilarity < targetSimilarity - TRIGGER_EVAL_COLLISION_MARGIN)
          continue;
        const previous = collisionsByRival.get(rivals[r].id);
        if (previous && previous.rivalSimilarity >= rivalSimilarity) continue;
        collisionsByRival.set(rivals[r].id, {
          rivalId: rivals[r].id,
          rivalName: rivals[r].name,
          prompt,
          rivalSimilarity,
          targetSimilarity,
          dedupSimilarity: null,
        });
      }

      outcomes.push({
        prompt,
        kind: isPositive ? 'should-trigger' : 'near-miss',
        targetSimilarity,
        targetRank: rank,
        triggered:
          rank < TRIGGER_EVAL_TOP_K &&
          targetSimilarity >= TRIGGER_EVAL_MIN_SIMILARITY,
      });
    }

    const collisions = this.keepOnlyDedupMisses(
      target,
      [...collisionsByRival.values()],
      settings,
    );

    const measured = measureRetrieval(outcomes, prompts);
    return this.persist(target.id, measured.measurement, prompts, {
      outcomes,
      collisions,
      unmeasuredReason: measured.unmeasuredReason,
      activeCompared: rivals.length,
    });
  }

  /**
   * The active library, minus the target. The target is excluded by id because
   * a candidate evaluated AFTER promotion is in this list, and leaving it in
   * would let it out-rank itself and score a permanent collision with its own
   * description.
   */
  private activeRivals(targetId: CandidateId): SkillCandidateRow[] {
    return this.store
      .listByStatus('promoted')
      .filter(
        (row) => row.id !== targetId && row.description.trim().length > 0,
      );
  }

  /**
   * Keep only the collisions dedup does NOT already see.
   *
   * `searchActiveByEmbedding` is the dedup-space view: it compares the stored
   * TRANSCRIPT embeddings that clustering and `isDuplicate` run on. A rival it
   * returns above `dedupClusterThreshold` is a pair dedup would already have
   * merged, so reporting it here would just be re-reporting dedup. Everything
   * else is the finding: descriptions that compete while transcripts do not.
   *
   * With no stored vector, or no vector extension in this host, the search
   * returns nothing and every collision counts as missed — which is exactly
   * true, because dedup is doing nothing at all in that host.
   */
  private keepOnlyDedupMisses(
    target: TriggerEvalTarget,
    collisions: DescriptionCollision[],
    settings: SkillSynthesisSettings,
  ): DescriptionCollision[] {
    if (collisions.length === 0) return [];
    const dedupView = new Map<CandidateId, number>();
    const rowid = target.embeddingRowid ?? null;
    if (rowid !== null) {
      const stored = this.store.getEmbedding(rowid);
      if (stored) {
        for (const hit of this.store.searchActiveByEmbedding(
          stored,
          Math.max(collisions.length, TRIGGER_EVAL_TOP_K),
        )) {
          dedupView.set(hit.row.id, hit.similarity);
        }
      }
    }
    const missed: DescriptionCollision[] = [];
    for (const collision of collisions) {
      const dedupSimilarity = dedupView.get(collision.rivalId) ?? null;
      if (
        dedupSimilarity !== null &&
        dedupSimilarity > settings.dedupClusterThreshold
      ) {
        continue;
      }
      missed.push({ ...collision, dedupSimilarity });
    }
    missed.sort((a, b) => b.rivalSimilarity - a.rivalSimilarity);
    return missed;
  }

  /** The single write site, so the null/number rule cannot diverge per branch. */
  private persist(
    id: CandidateId,
    measurement: TriggerEvalMeasurement,
    prompts: TriggerPromptSet,
    rest: Omit<TriggerEvalReport, 'measurement' | 'prompts'>,
  ): TriggerEvalOutcome {
    this.store.recordTriggerEval(id, measurement);
    this.logger.debug('[skill-trigger-eval] measurement written', {
      candidateId: id,
      precision: measurement.precision,
      recall: measurement.recall,
      score: measurement.score,
      collisions: rest.collisions.length,
      unmeasuredReason: rest.unmeasuredReason,
    });
    return {
      status: 'evaluated',
      report: { measurement, prompts, ...rest },
    };
  }

  /**
   * The one lane call. Returns `null` — and the caller writes nothing — for
   * every shape of "we did not get prompts": no lane in this host, a stalled
   * lane, an unparseable answer.
   */
  private async generatePrompts(
    target: TriggerEvalTarget,
    description: string,
    signal?: AbortSignal,
  ): Promise<TriggerPromptSet | null> {
    let result;
    try {
      result = await this.laneRunner.run({
        laneId: 'judge',
        systemPromptAppend: TRIGGER_PROMPT_RUBRIC,
        prompt: buildGenerationPrompt(target, description),
        outputSchema: TRIGGER_PROMPTS_JSON_SCHEMA,
        signal,
      });
    } catch (error: unknown) {
      this.logger.warn('[skill-trigger-eval] prompt generation threw', {
        candidateId: target.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    if (result.status === 'unavailable') {
      this.logger.debug('[skill-trigger-eval] no lane in this host', {
        candidateId: target.id,
        reason: result.reason,
      });
      return null;
    }
    if (result.status === 'failed') {
      this.logger.warn('[skill-trigger-eval] prompt generation failed', {
        candidateId: target.id,
        kind: result.failure.kind,
        reason: result.failure.reason,
      });
      return null;
    }

    const parsed = TriggerPromptsSchema.safeParse(readJson(result.run));
    if (!parsed.success) {
      this.logger.warn(
        '[skill-trigger-eval] unusable prompt-generation reply',
        {
          candidateId: target.id,
          raw: result.run.text.slice(0, 200),
        },
      );
      return null;
    }
    return {
      shouldTrigger: cleanPrompts(parsed.data.shouldTrigger),
      nearMiss: cleanPrompts(parsed.data.nearMiss),
    };
  }
}

/**
 * The measurement that did not happen. All three `null` TOGETHER — the store
 * writes the four columns as one group precisely so a precision can never end
 * up beside another run's recall, and a `0` in any of these slots would be a
 * claim nobody measured.
 */
const UNMEASURED: TriggerEvalMeasurement = {
  score: null,
  precision: null,
  recall: null,
};

/**
 * Precision, recall and the derived score.
 *
 * ## The derivation, stated once and pinned by the spec
 *
 *   recall    = TP / |should-trigger|
 *   precision = TP / (TP + FP)          , and 0 when TP + FP = 0
 *   score     = 2 · P · R / (P + R)     , and 0 when P + R = 0
 *
 * `score` is the HARMONIC mean — F1 — on 0–1, and it is DERIVED, never written
 * independently. The arithmetic mean was rejected: a description that fires for
 * everything scores recall 1.0 and precision ~0.5, which the mean rounds up to
 * a respectable 0.75, and at the limit (precision 0, recall 1) the mean still
 * reports 0.5 for a description that is pure noise. The whole point of the gate
 * is that ONE bad half must dominate, and only the harmonic mean does that.
 *
 * ## The two zeros that are real results
 *
 * `TP + FP = 0` means the description was retrieved by nothing at all — a
 * genuine, informative 0, not an undefined. Same for `P + R = 0`. Neither is
 * `null`: `null` is reserved for measurements that did not happen.
 *
 * ## The refusal
 *
 * An empty side of the prompt set returns all-`null`. With no negatives,
 * precision is 1.0 by construction; with no positives, recall has no
 * denominator. Publishing either would be publishing a formality as a
 * measurement, and the ranking downstream cannot tell the two apart.
 */
export function measureRetrieval(
  outcomes: readonly TriggerPromptOutcome[],
  prompts: TriggerPromptSet,
): {
  measurement: TriggerEvalMeasurement;
  unmeasuredReason: TriggerEvalUnmeasuredReason | null;
} {
  if (prompts.shouldTrigger.length === 0) {
    return {
      measurement: UNMEASURED,
      unmeasuredReason: TRIGGER_EVAL_UNMEASURED_REASONS.noPositives,
    };
  }
  if (prompts.nearMiss.length === 0) {
    return {
      measurement: UNMEASURED,
      unmeasuredReason: TRIGGER_EVAL_UNMEASURED_REASONS.noNegatives,
    };
  }

  let truePositives = 0;
  let falsePositives = 0;
  let positives = 0;
  for (const outcome of outcomes) {
    if (outcome.kind === 'should-trigger') {
      positives++;
      if (outcome.triggered) truePositives++;
    } else if (outcome.triggered) {
      falsePositives++;
    }
  }
  if (positives === 0) {
    return {
      measurement: UNMEASURED,
      unmeasuredReason: TRIGGER_EVAL_UNMEASURED_REASONS.noPositives,
    };
  }

  const retrieved = truePositives + falsePositives;
  const precision = retrieved === 0 ? 0 : truePositives / retrieved;
  const recall = truePositives / positives;
  const score = f1(precision, recall);
  return { measurement: { score, precision, recall }, unmeasuredReason: null };
}

/** F1. Exported so the spec pins the derivation itself, not a case of it. */
export function f1(precision: number, recall: number): number {
  const denominator = precision + recall;
  if (denominator === 0) return 0;
  return (2 * precision * recall) / denominator;
}

/**
 * Trim, drop blanks, drop duplicates, and cap the side. A duplicated prompt
 * would be counted twice and would silently weight one phrasing above the rest.
 */
function cleanPrompts(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const cleaned = entry.replace(/\s+/g, ' ').trim();
    if (cleaned.length === 0) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= TRIGGER_EVAL_MAX_PROMPTS_PER_SIDE) break;
  }
  return out;
}

/**
 * The generation input. Description-first and description-only: the retrieval
 * under test sees nothing else, so giving the generator the body would produce
 * prompts the description could not possibly have earned.
 */
function buildGenerationPrompt(
  target: TriggerEvalTarget,
  description: string,
): string {
  const title = target.displayName?.trim();
  return [
    title ? `Skill: ${title}` : `Skill (untitled)`,
    ``,
    `Its description, which is the ONLY text retrieval will see:`,
    `---`,
    description,
  ].join('\n');
}

/** The lane's structured answer when it is an object, else nothing. */
function readJson(run: LaneRun): unknown {
  if (run.json !== null && typeof run.json === 'object') return run.json;
  return undefined;
}
