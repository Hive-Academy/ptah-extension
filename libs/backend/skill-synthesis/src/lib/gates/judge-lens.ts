/**
 * The second panellist's LENS — what makes a two-judge panel worth paying for
 * (TASK_2026_180, B3.4b).
 *
 * ## The defect this exists to remove
 *
 * B3.4 landed a panel that called the judge TWICE with byte-identical
 * arguments. The only thing that could differ between panellist A and panellist
 * B was sampling nondeterminism, so against a temperature-0 endpoint the second
 * call was guaranteed to return the first call's scorecard: pure cost, zero
 * information, and an escalation branch that could never fire.
 *
 * A panel whose members cannot disagree learns nothing. Disagreement has to be
 * SIGNAL — two different questions — not noise.
 *
 * ## What varies, and what must not
 *
 * The QUESTION varies. The SCORECARD does not. Both panellists score the same
 * five criteria on the same 1–10 scale, because the escalation compares them PER
 * CRITERION and a differently-shaped rubric on one side would make every delta
 * meaningless. A judges the artifact on its own terms — the unchanged rubric. B
 * judges the same artifact IN CONTEXT of the library it would join, and is
 * shown material A never saw:
 *
 *  - the candidate's nearest DESCRIPTION neighbours among the active skills, and
 *  - the measured gate results already recorded on its row (trigger score /
 *    precision / recall from `TriggerEvalService`, replay confidence from
 *    `ReplayValidatorService`).
 *
 * That is what makes a disagreement mean something concrete. A says "novel and
 * clearly triggered"; B, seeing three near-identical descriptions already in the
 * library beside a MEASURED trigger score of 0.2, scores novelty and
 * triggerClarity far lower — the delta clears the threshold and the escalation
 * adjudicates a real conflict instead of rounding error. The library's own
 * measured history feeds back into what gets promoted, which is the whole of the
 * self-learning loop.
 *
 * ## Description space, not dedup space
 *
 * The neighbours are computed over DESCRIPTIONS, freshly embedded, exactly as
 * `TriggerEvalService` does and for the reason its header gives: a candidate's
 * STORED vector is built from the session transcript, which is what cosine dedup
 * compares and is NOT what decides whether a skill fires. An agent choosing
 * between skills reads descriptions. `novelty` and `triggerClarity` — the two
 * criteria this lens most moves — are description-space questions, so asking
 * dedup space would answer a different one and would answer it with nothing at
 * all in any host without the vector extension loaded.
 *
 * ## A degenerate lens must not be convened
 *
 * With no neighbours AND no recorded measurements, B is asking A's question with
 * A's inputs — the identical-call defect, re-created. {@link isLensDegenerate}
 * is how the panel decides to spend nothing rather than run a judge that cannot
 * inform anything. It is a PRINCIPLED skip, not a heuristic: the condition is
 * exactly "there is no evidence that could move a score".
 *
 * ## Everything here rides `systemPromptAppend`
 *
 * Both the lens instruction and its evidence go on the half the lane does NOT
 * clip. `maxInputChars` bounds `prompt`, and a clipped lens degrades B silently
 * back into A — the exact failure that would make this fix look applied while
 * doing nothing. The evidence is variable material, which normally rides
 * `prompt`; it is on the unclippable half anyway because it is bounded BY
 * CONSTRUCTION here ({@link JUDGE_LENS_MAX_NEIGHBOURS} entries, each description
 * clamped to {@link JUDGE_LENS_DESCRIPTION_CHARS}) and because it is the only
 * thing that makes the second call a second call.
 */
import { JUDGE_CRITERION_KEYS } from '../skill-judge.service';

/**
 * How many neighbours B is shown. Three is the shortlist an agent would
 * actually weigh; a longer list is the same evidence restated, and it is the
 * nearest one that decides whether this candidate is novel.
 */
export const JUDGE_LENS_MAX_NEIGHBOURS = 3;

/** Per-neighbour description clamp, so the block stays bounded. */
export const JUDGE_LENS_DESCRIPTION_CHARS = 200;

/**
 * The absolute cosine a rival description must reach to count as a neighbour.
 *
 * Without a floor, the "nearest" skill in a two-skill library is whatever is
 * there, however unrelated, and B would be told the library already covers
 * ground it does not cover — evidence that argues for a lower novelty score with
 * nothing behind it. Deliberately a LOCAL constant rather than a reuse of
 * `TRIGGER_EVAL_MIN_SIMILARITY`: that one bounds prompt↔description retrieval
 * and this one bounds description↔description overlap, and tuning either through
 * a shared symbol would silently retune the other.
 */
export const JUDGE_LENS_MIN_SIMILARITY = 0.35;

/** One active skill whose description already occupies the candidate's ground. */
export interface JudgeLensNeighbour {
  /** The rival's slug. Identifies it to a reader without a second lookup. */
  readonly name: string;
  readonly description: string;
  /** Cosine of the two DESCRIPTIONS, 0–1. */
  readonly similarity: number;
}

/**
 * The gate results already MEASURED for this candidate. Every field is 0–1 and
 * every field is nullable, and `null` is never `0`: `0` is a measurement that
 * went badly and is evidence against the candidate, `null` means the gate never
 * ran and must not be rendered at all.
 */
export interface JudgeLensMeasurements {
  readonly triggerScore: number | null;
  readonly triggerPrecision: number | null;
  readonly triggerRecall: number | null;
  readonly replayConfidence: number | null;
}

export interface JudgeContextLens {
  readonly neighbours: readonly JudgeLensNeighbour[];
  /** `null` when NO gate has recorded anything — not a zeroed record. */
  readonly measurements: JudgeLensMeasurements | null;
}

/** The lens of a host that could compute nothing. Always degenerate. */
export const EMPTY_JUDGE_LENS: JudgeContextLens = {
  neighbours: [],
  measurements: null,
};

/**
 * Whether the lens would ask A's question with A's inputs.
 *
 * The panel spends nothing on a second panellist in that case. Note that a
 * measurements record consisting entirely of `null`s never reaches here —
 * {@link readLensMeasurements} collapses it to `null` — so "has measurements"
 * genuinely means "at least one gate produced a number".
 */
export function isLensDegenerate(lens: JudgeContextLens): boolean {
  return lens.neighbours.length === 0 && lens.measurements === null;
}

/** The four measured columns of a candidate row, or `null` if none is set. */
export function readLensMeasurements(row: {
  readonly triggerScore: number | null;
  readonly triggerPrecision: number | null;
  readonly triggerRecall: number | null;
  readonly replayConfidence: number | null;
}): JudgeLensMeasurements | null {
  const measurements: JudgeLensMeasurements = {
    triggerScore: row.triggerScore,
    triggerPrecision: row.triggerPrecision,
    triggerRecall: row.triggerRecall,
    replayConfidence: row.replayConfidence,
  };
  const anyMeasured = Object.values(measurements).some(
    (value) => value !== null,
  );
  return anyMeasured ? measurements : null;
}

/**
 * Rank rival descriptions against the candidate's and keep the nearest few.
 *
 * Pure, so the ranking is testable without an embedder and without a database.
 * `similarities[i]` belongs to `rivals[i]`; a length mismatch yields nothing,
 * because a misaligned pairing would attribute one skill's description to
 * another's score.
 */
export function selectLensNeighbours(
  rivals: readonly { readonly name: string; readonly description: string }[],
  similarities: readonly number[],
): JudgeLensNeighbour[] {
  if (rivals.length !== similarities.length) return [];
  return rivals
    .map((rival, index) => ({
      name: rival.name,
      description: rival.description.trim(),
      similarity: similarities[index],
    }))
    .filter(
      (entry) =>
        entry.description.length > 0 &&
        Number.isFinite(entry.similarity) &&
        entry.similarity >= JUDGE_LENS_MIN_SIMILARITY,
    )
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, JUDGE_LENS_MAX_NEIGHBOURS);
}

/**
 * The evidence block. Shared verbatim by panellist B and by the escalation, so
 * the escalation can check B's reasoning against the same material rather than
 * being told only that B scored something low.
 *
 * Returns `''` for a degenerate lens, which no caller renders.
 */
export function renderLensEvidence(lens: JudgeContextLens): string {
  const lines: string[] = [];
  if (lens.neighbours.length > 0) {
    lines.push(
      `ALREADY IN THE ACTIVE LIBRARY — the nearest descriptions to this one (cosine over descriptions, 0-1):`,
    );
    for (const neighbour of lens.neighbours) {
      lines.push(
        `- ${neighbour.similarity.toFixed(2)} "${neighbour.name}": ${clamp(
          neighbour.description,
          JUDGE_LENS_DESCRIPTION_CHARS,
        )}`,
      );
    }
  }
  const measured = lens.measurements;
  if (measured) {
    if (lines.length > 0) lines.push('');
    lines.push(
      `ALREADY MEASURED for THIS skill (0-1; these are measurements, not opinions — an absent line was never measured and must not be read as a zero):`,
    );
    const rows: ReadonlyArray<readonly [string, number | null]> = [
      ['retrieval trigger score', measured.triggerScore],
      ['retrieval precision', measured.triggerPrecision],
      ['retrieval recall', measured.triggerRecall],
      [
        'replay confidence against a held-out session',
        measured.replayConfidence,
      ],
    ];
    for (const [label, value] of rows) {
      if (value === null) continue;
      lines.push(`- ${label}: ${value.toFixed(2)}`);
    }
  }
  return lines.join('\n');
}

/**
 * The whole of panellist B's instruction: the lens, then the evidence.
 *
 * Appended AFTER the judge's own rubric so the five criteria and the 1–10 scale
 * are already established when this narrows the question. It re-states the JSON
 * requirement last, because last is where a "reply with ONLY JSON" line has to
 * be to survive a model that reads the tail hardest.
 */
export function renderJudgeLens(lens: JudgeContextLens): string {
  const evidence = renderLensEvidence(lens);
  if (evidence.length === 0) return '';
  return [
    `SECOND REVIEWER — READ THIS AND CHANGE HOW YOU SCORE.`,
    ``,
    `A first reviewer has already scored this document ON ITS OWN TERMS. Scoring it the same way again would tell nobody anything. Your job is to score the SAME five criteria on the SAME 1-10 scale, but judged IN CONTEXT OF THE LIBRARY THIS SKILL WOULD JOIN, using the evidence below — which the first reviewer never saw.`,
    ``,
    `How the evidence must move your numbers:`,
    `- novelty: score LOW when a description below already covers this ground. A skill that reads as novel in isolation is not novel if the library already holds it.`,
    `- triggerClarity: score LOW when a description below competes for the same requests, or when a measured retrieval score is low. A description cannot be clear about WHEN to fire if retrieval does not fire it, or if a rival fires just as strongly.`,
    `- generalization and scope: a measured replay confidence is evidence about whether this transfers beyond the session it came from.`,
    `- actionability: judge as before; the evidence below says little about it.`,
    ``,
    `Where the measurements contradict how the document READS, trust the measurements — they were taken, the reading is an impression. Do not soften a score to stay near the first reviewer; you are not shown their numbers, and agreeing for its own sake is the failure this second pass exists to prevent.`,
    ``,
    evidence,
    ``,
    `Reply with ONLY: {${JUDGE_CRITERION_KEYS.map(
      (key) => `"${key}": <number>`,
    ).join(', ')}}`,
  ].join('\n');
}

/**
 * The escalation's view of the same evidence.
 *
 * The escalation is told the second reviewer saw this and the first did not,
 * because that is usually the whole explanation of the gap it is adjudicating.
 */
export function renderEscalationEvidence(lens: JudgeContextLens): string {
  const evidence = renderLensEvidence(lens);
  if (evidence.length === 0) return '';
  return [
    `The two reviewers were NOT shown the same material. The first read the document alone. The second was additionally shown the evidence below, which is very often the whole explanation of the gap you are adjudicating — check the second reviewer's numbers against it rather than splitting the difference.`,
    ``,
    evidence,
  ].join('\n');
}

/** Clamp on a word boundary where there is one, else hard. */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const space = head.lastIndexOf(' ');
  return `${(space > max / 2 ? head.slice(0, space) : head).trimEnd()}…`;
}
