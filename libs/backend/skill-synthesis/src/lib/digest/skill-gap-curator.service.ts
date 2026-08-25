/**
 * `SkillGapCuratorService` — the four sweeps of the weekly gap digest
 * (plan §4 Phase 4, task B4.2.2).
 *
 * ## What this service is allowed to do
 *
 * Rank, evidence and nudge. Nothing else. It never promotes, rejects, demotes,
 * deletes or files a new suggestion. Every RANKING number below is READ from
 * something already measured (session verdicts, the invocation → outcome join,
 * the user's own memory) — no model scores anything here, and that is the
 * autonomy boundary phase 4 was approved under: the user still accepts or
 * dismisses, so the digest's whole job is to make the accepting well-informed.
 *
 * The one write it makes is sweep (a)'s description rewrite, and it goes
 * through the EXISTING `SkillSuggestionStore.updatePending` path — see
 * `applyDescriptionRewrites` for the conditions on it. There is deliberately no
 * second suggestion-writing path here: `insertPending` is never called (pinned
 * by a source scan in the spec), so the digest can sharpen a proposal the user
 * has not yet decided on, and can do nothing at all to one they have.
 *
 * ## The one LLM call, and why it is on the `synthesis` lane
 *
 * B4.7 gives that rewrite a real lane: the appended trigger clause is AUTHORED
 * rather than copy-pasted, on `laneId: 'synthesis'` — the authoring lane, and
 * deliberately not a fifth lane id, which would mean eight new settings keys
 * for a pass that asks the same kind of question `SkillSynthesizerService` and
 * `SkillCuratorService` already ask there.
 *
 * Four properties of that call are contracts:
 *
 *  - **It is OPT-IN, and opting out is the default.** `DigestRequest.allowRewrite`
 *    defaults to `false` in `runDigest`, and `false` means the lane is not
 *    called at all. Nothing budgets this call: `digest` is a member of
 *    `TOKEN_SPENDING_STAGES` but has no queue handler and no producer, so the
 *    drain's `maxTokensPerDay` gate never sees a digest item, while the RPC in
 *    front of it is refreshed automatically by the panel on tab init and on
 *    four background event kinds. Read `runDigest`'s own header before changing
 *    that default; it is the difference between a read and unmetered spend on
 *    background activity.
 *  - **`LaneRunnerService` is injected `{isOptional: true}` and its absence is
 *    not an error.** A CLI or e2e host has no lane at all, and the runner
 *    itself answers `unavailable` on a host with no SDK. Either way the sweep
 *    falls back to appending the archaeologist's VERBATIM session intents —
 *    which is exactly what B4.2 shipped, so the lane strictly adds and can
 *    never subtract.
 *  - **ONE call per `runDigest`, and zero when nothing is fresh.** Every
 *    eligible suggestion rides one batched request (`DIGEST_REWRITE_MAX_SKILLS`
 *    of them; the remainder take the verbatim path rather than buying a second
 *    call). The freshness gate runs BEFORE the lane, so a weekly digest over a
 *    library it has already sharpened spends nothing at all.
 *  - **The rubric rides `systemPromptAppend`, never `prompt`.** `maxInputChars`
 *    clips `prompt` and does not clip `systemPromptAppend`; a rubric in the
 *    clippable half loses its "reply with ONLY JSON" tail first and every call
 *    on the lane comes back unparseable.
 *
 * The service still owns no timeout, no `AbortController` and no input clamp —
 * `LaneRunnerService` owns all three.
 *
 * ## `winRate` is `number | null` and `null` is NEVER `0`
 *
 * `scoreForWinRate` is the ONE place that distinction turns into an ordering,
 * and it branches on `null` explicitly rather than coalescing. A skill nobody
 * measured scores BELOW every measured skill, including a perfect one, because
 * "we have no evidence" is not "this is bad" — whereas a measured `0` scores
 * top of the sweep, because a skill that loses every measured session is
 * exactly what the digest exists to surface. One `??` or `||` on that path
 * inverts both facts at once and nothing else in the system would notice; the
 * spec mutation-tests it for that reason.
 *
 * ## A lane failure has nowhere to go from here, and it is NOT flattened
 *
 * `runDigest` returns `DigestItem[]` to `skillSynthesis:digest`. It is not a
 * queue stage — nothing enqueues a `digest` row and no handler is registered
 * for one — so there is no `{outcome, failure}` channel to hand a
 * `SkillLaneFailure` out through, and widening the return type would change the
 * RPC wire shape in a lib this batch does not own. What this file therefore
 * does NOT do is invent one: no result type here carries a lane failure
 * COLLAPSED into a reason string, which is the defect `JudgePanelResult` and
 * `TriggerEvalOutcome` already have. The failure is logged with its `kind` and
 * `reason` as separate structured fields that nothing downstream reads as a
 * decision, and the sweep falls back to verbatim intents. See the batch report
 * for the escalation.
 *
 * ## The C2 ⇢ C4 soft edge
 *
 * Sweep (b) reads `skill_session_verdicts.friction_map`, which phase 2 (C2)
 * writes. Phase 4 must ship and run on a host where that never happened — an
 * empty verdict table, or a schema old enough not to have the table at all.
 * Every read below is therefore individually guarded and degrades to "no
 * evidence of this kind", never to a rejected promise: `runDigest` resolves on
 * every path, and a sweep with nothing to say returns `[]`. That is also why
 * the guards wrap the READS rather than the whole method — a missing verdict
 * table must not cost the win-rate sweep its answer.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  MEMORY_CONTRACT_TOKENS,
  type IMemoryReader,
  type MemoryHitPage,
} from '@ptah-extension/memory-contracts';
import { SkillCandidateStore } from '../skill-candidate.store';
import type { SkillWinRate } from '../skill-candidate.store';
import { SessionVerdictStore } from '../archaeology/session-verdict.store';
import { SkillSuggestionStore } from '../skill-suggestion.store';
import type {
  FrictionEntry,
  SessionVerdict,
} from '../archaeology/session-verdict.types';
import type { SkillCandidateRow } from '../types';
import { SKILL_SYNTHESIS_TOKENS } from '../di/tokens';
import type { LaneRunnerService } from '../lanes/lane-runner.service';
import {
  isWinEvidence,
  type DigestItem,
  type DigestItemKind,
} from './digest.types';

/** Items returned by one pass, after ranking. */
export const DIGEST_DEFAULT_LIMIT = 20;

/** Verdict rows scanned per pass. Bounded: the digest is a weekly summary, not a report. */
export const DIGEST_VERDICT_SCAN_LIMIT = 200;

/** Invoked-session lookback per skill, for "was this skill used in that session?". */
export const DIGEST_INVOCATION_LOOKBACK = 200;

/** Session ids cited per item. Receipts, not an export. */
export const DIGEST_EVIDENCE_SESSION_CAP = 5;

/**
 * Share of a skill's own description tokens that must appear in a session's
 * intent/outcome text before we are willing to say the skill was RELEVANT to
 * that session. Deliberately blunt: this is a nudge, and the user reading the
 * cited session ids is the real precision gate. Retrieval-grade relevance is
 * `TriggerEvalService`'s measured job, on embeddings, at the gate — not here.
 */
export const DIGEST_MIN_RELEVANCE = 0.34;

/** A skill whose description carries fewer content tokens than this is unjudgeable. */
export const DIGEST_MIN_SKILL_TOKENS = 2;

/** Sessions a friction cluster needs before it is a pattern rather than a bad day. */
export const DIGEST_FRICTION_MIN_SESSIONS = 2;

/** Content tokens forming a friction cluster's signature. */
export const DIGEST_FRICTION_SIGNATURE_TOKENS = 3;

/** Memory probes per pass, and hits requested per probe. */
export const DIGEST_MEMORY_MAX_QUERIES = 3;
export const DIGEST_MEMORY_TOP_K = 5;

// ── Scores. All 0–1, all sorted descending. ────────────────────────────────
export const DIGEST_MISSED_TRIGGER_BASE = 0.55;
export const DIGEST_MISSED_TRIGGER_STEP = 0.1;
export const DIGEST_MISSED_TRIGGER_MAX = 0.95;
export const DIGEST_FRICTION_BASE = 0.5;
export const DIGEST_FRICTION_STEP = 0.08;
export const DIGEST_FRICTION_MAX = 0.9;
export const DIGEST_MEMORY_BASE = 0.4;
export const DIGEST_MEMORY_STEP = 0.05;
export const DIGEST_MEMORY_MAX = 0.7;

/**
 * The win-rate sweep's band. A measured rate scores
 * `BASE + (1 - rate) * WEIGHT`, so a perfect skill sits at the floor (`0.2`)
 * and a skill that lost every measured session sits at the ceiling (`0.8`).
 * `UNMEASURED` sits BELOW the floor on purpose: an unmeasured skill must never
 * outrank a measured one, in either direction.
 */
export const DIGEST_WIN_RATE_MEASURED_BASE = 0.2;
export const DIGEST_WIN_RATE_WEIGHT = 0.6;
export const DIGEST_WIN_RATE_UNMEASURED = 0.1;

/** Marker the description rewrite appends after. Also the idempotency probe. */
export const DIGEST_TRIGGER_CLAUSE_PREFIX = 'Also use when: ';

/** Rewritten descriptions are clamped to this, on a word boundary. */
export const DIGEST_DESCRIPTION_MAX_CHARS = 500;

/** Intents quoted into a rewritten description, and the clamp on each. */
export const DIGEST_REWRITE_MAX_INTENTS = 2;
export const DIGEST_REWRITE_INTENT_CHARS = 120;

/**
 * Suggestions carried by the ONE batched lane call. Targets past this take the
 * verbatim path rather than buying a second call — the `synthesis` lane's
 * `maxInputChars` is 8 000 and this bound keeps the built prompt comfortably
 * inside it, so the runner's clip never eats a skill's intents mid-list.
 */
export const DIGEST_REWRITE_MAX_SKILLS = 8;

/** A skill's current description, clamped before it is quoted into the prompt. */
export const DIGEST_REWRITE_PROMPT_DESCRIPTION_CHARS = 200;

/** Characters the authored clause is asked, and then held, to stay under. */
export const DIGEST_REWRITE_CLAUSE_MAX_CHARS = 180;

/**
 * THE FIXED POINT. The share of a clause's own content tokens that must appear
 * in a description before we call that clause SAID.
 *
 * One threshold, used in both directions, and that is what makes a generative
 * rewrite idempotent:
 *
 *  - BEFORE the lane, an intent already covered at this ratio by the current
 *    description is dropped as stale, so it is never sent and never re-written.
 *  - AFTER the lane, an authored clause is ACCEPTED only if the resulting
 *    description covers the same intents at the same ratio; otherwise it is
 *    discarded and the verbatim intent is used, which covers by construction.
 *
 * So every write this service makes lands in a state where its own freshness
 * gate rejects the evidence that produced it. The second pass makes no lane
 * call and no write — not because the model happened to answer identically
 * (it will not), but because there is provably nothing left to say. Model
 * output is nondeterministic; this fixed point does not depend on it.
 */
export const DIGEST_REWRITE_COVERAGE = 0.6;

/**
 * The attention weight of one skill's win rate.
 *
 * THE `null` BRANCH IS THE CONTRACT. `null` means "no session carrying this
 * skill has a settled outcome", which is a statement about our evidence, not
 * about the skill. Coalescing it (`winRate ?? 0`, `winRate || 0`) would score
 * it `BASE + WEIGHT` — the top of the sweep, ahead of every skill we actually
 * measured, including one that genuinely loses. Exported so the spec can
 * mutation-test that branch directly rather than only through a full pass.
 */
export function scoreForWinRate(winRate: number | null): number {
  if (winRate === null) return DIGEST_WIN_RATE_UNMEASURED;
  const bounded = Math.min(1, Math.max(0, winRate));
  return DIGEST_WIN_RATE_MEASURED_BASE + (1 - bounded) * DIGEST_WIN_RATE_WEIGHT;
}

/**
 * Ranking order: score descending, then a stable tie-break so two identical
 * runs produce byte-identical digests. `DIGEST_ITEM_KINDS`' declaration order
 * is the secondary key and the title is the third.
 */
export function compareDigestItems(a: DigestItem, b: DigestItem): number {
  if (b.score !== a.score) return b.score - a.score;
  const kindDelta = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
  if (kindDelta !== 0) return kindDelta;
  return a.title.localeCompare(b.title);
}

const KIND_ORDER: readonly DigestItemKind[] = [
  'missed-trigger',
  'friction-opportunity',
  'win-rate',
  'memory-signal',
];

/** What one pass is scoped to. */
export interface DigestRequest {
  /** The workspace whose verdicts are swept. `''` is the cross-project feed. */
  readonly workspaceRoot: string;
  /** Items returned after ranking. Defaults to `DIGEST_DEFAULT_LIMIT`. */
  readonly limit?: number;
  /**
   * May this pass SPEND on the authoring lane? **Defaults to `false`.**
   *
   * See {@link SkillGapCuratorService.runDigest} for why the default is the
   * cheap one and why it is decided here rather than at any caller.
   */
  readonly allowRewrite?: boolean;
}

/** One friction cluster: sessions that went wrong the same way. */
interface FrictionCluster {
  readonly signature: string;
  readonly sessionIds: string[];
  readonly note: string;
  readonly counts: Record<string, number>;
}

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'against',
  'because',
  'been',
  'before',
  'being',
  'between',
  'could',
  'does',
  'doing',
  'during',
  'each',
  'from',
  'have',
  'having',
  'into',
  'itself',
  'just',
  'more',
  'most',
  'once',
  'only',
  'other',
  'over',
  'same',
  'should',
  'some',
  'such',
  'than',
  'that',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'under',
  'until',
  'very',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'with',
  'would',
  'your',
]);

/** Lowercased content tokens of length ≥ 4, stop-words removed. */
function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4) continue;
    if (STOP_WORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

/** Share of `needle` present in `haystack`; `0` when `needle` is empty. */
function overlapRatio(needle: Set<string>, haystack: Set<string>): number {
  if (needle.size === 0) return 0;
  let hits = 0;
  for (const token of needle) if (haystack.has(token)) hits += 1;
  return hits / needle.size;
}

/** The searchable text of a verdict: what was wanted, what happened, what was learned. */
function verdictText(verdict: SessionVerdict): string {
  return [
    verdict.intent ?? '',
    verdict.outcome ?? '',
    verdict.routine?.summary ?? '',
  ].join(' ');
}

/** Clamp on a word boundary, without a trailing ellipsis the UI would double up. */
function clampWords(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const boundary = cut.lastIndexOf(' ');
  return (boundary > max * 0.5 ? cut.slice(0, boundary) : cut).trim();
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Is `clause` already SAID by `text`?
 *
 * Token coverage rather than the exact-substring test B4.2 used, because the
 * clause may now be AUTHORED: a paraphrase of an intent already in the
 * description would sail past a substring check and get appended a second time
 * every week. The exact-substring test survives as the fallback for a clause
 * with no content tokens to measure (everything in it is shorter than four
 * characters or a stop word), where a ratio over an empty set would answer `0`
 * forever and re-append it on every pass.
 */
function isCovered(clause: string, text: string): boolean {
  const tokens = tokenize(clause);
  if (tokens.size === 0) {
    return text.toLowerCase().includes(clause.toLowerCase());
  }
  return overlapRatio(tokens, tokenize(text)) >= DIGEST_REWRITE_COVERAGE;
}

/**
 * The authoring rubric. FIXED instructions, so it travels as
 * `systemPromptAppend` — `LaneRunnerService` clips `prompt` at the lane's
 * `maxInputChars` and does not clip this, and a rubric in the clippable half
 * loses its output-format sentence first.
 *
 * The vocabulary rule is not style advice. `isCovered` discards a clause that
 * does not repeat the intents' distinctive words, so telling the model the
 * acceptance test up front is what makes the lane worth calling instead of an
 * expensive way to reach the verbatim fallback.
 */
export const DIGEST_REWRITE_RUBRIC = [
  `You rewrite the trigger sentence of an AI coding skill so that retrieval finds the skill on work it already matches.`,
  ``,
  `For each numbered skill you are given its current description and one or more VERBATIM user session intents — real work that skill should have been used for and was not.`,
  ``,
  `Rules:`,
  `1. Write ONE clause per skill naming that work. It is appended directly after the words "${DIGEST_TRIGGER_CLAUSE_PREFIX}", so begin mid-sentence, lower case, and do not repeat those words.`,
  `2. REUSE THE DISTINCTIVE WORDS OF THE QUOTED INTENTS — the concrete tool, framework, file type or task names. A clause that does not repeat them is DISCARDED and the raw intent is used instead, so paraphrasing them away wastes the call.`,
  `3. Describe only what the intents say. Never invent a capability the skill has not shown.`,
  `4. At most ${DIGEST_REWRITE_CLAUSE_MAX_CHARS} characters per clause. No trailing period.`,
  `5. Omit a skill entirely rather than guessing at one.`,
  ``,
  `Reply with ONLY this JSON object and nothing else:`,
  `{"rewrites":[{"ref":"<the ref you were given>","clause":"<the clause>"}]}`,
].join('\n');

/** The `rewrites` envelope. An OBJECT, so the runner's manual extractor can also read it. */
const DIGEST_REWRITE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    rewrites: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          clause: { type: 'string' },
        },
        required: ['ref', 'clause'],
      },
    },
  },
  required: ['rewrites'],
};

/** One pending suggestion the sweep has fresh evidence for. */
interface RewriteTarget {
  /** Opaque handle the model echoes back. Suggestion ids never enter the prompt. */
  readonly ref: string;
  readonly suggestionId: string;
  readonly slug: string;
  readonly description: string;
  /** Clamped, de-duplicated, and not already said by `description`. */
  readonly fresh: readonly string[];
}

/** What sweep (a) found, before any writing happens. */
interface MissedTrigger {
  readonly skill: SkillCandidateRow;
  readonly missed: readonly SessionVerdict[];
  readonly intents: readonly string[];
}

/** Read the model's answer without trusting any of its shape. */
function parseRewrites(json: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof json !== 'object' || json === null) return out;
  const list = (json as { rewrites?: unknown }).rewrites;
  if (!Array.isArray(list)) return out;
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { ref, clause } = entry as { ref?: unknown; clause?: unknown };
    if (typeof ref !== 'string' || typeof clause !== 'string') continue;
    const trimmed = clause.trim().replace(/\.$/, '').trim();
    if (trimmed.length === 0) continue;
    out.set(ref, clampWords(trimmed, DIGEST_REWRITE_CLAUSE_MAX_CHARS));
  }
  return out;
}

/**
 * The intents this description does NOT already say, clamped and de-duplicated.
 *
 * THE GATE THAT MAKES THE PASS FREE THE SECOND TIME. It runs before the lane,
 * so a digest over a library it already sharpened returns `[]` here for every
 * skill and never opens a call at all.
 */
function selectFreshClauses(
  current: string,
  intents: readonly string[],
): string[] {
  const fresh: string[] = [];
  for (const intent of intents) {
    const clause = clampWords(intent, DIGEST_REWRITE_INTENT_CHARS);
    if (clause.length === 0) continue;
    if (isCovered(clause, current)) continue;
    if (fresh.includes(clause)) continue;
    fresh.push(clause);
    if (fresh.length === DIGEST_REWRITE_MAX_INTENTS) break;
  }
  return fresh;
}

/**
 * The description to persist, or `null` when there is no room to say it.
 *
 * The authored clause is TRIED FIRST and the verbatim intents are the fallback,
 * and both go through the same acceptance test: the FINAL clamped string must
 * cover every fresh clause at `DIGEST_REWRITE_COVERAGE`. Testing the composed
 * result rather than the clause on its own is deliberate — a clause that covers
 * its intents perfectly and then loses half its words to
 * `DIGEST_DESCRIPTION_MAX_CHARS` would otherwise be persisted as a half-written
 * fragment AND leave the next pass believing the evidence was recorded.
 */
function composeDescription(
  current: string,
  fresh: readonly string[],
  authored: string | null,
): string | null {
  if (fresh.length === 0) return null;
  const attempts = [authored, fresh.join('; ')].filter(
    (text): text is string => text !== null && text.trim().length > 0,
  );

  for (const clause of attempts) {
    const next = clampWords(
      `${current.trim()} ${DIGEST_TRIGGER_CLAUSE_PREFIX}${clause}`,
      DIGEST_DESCRIPTION_MAX_CHARS,
    );
    // A description already at the ceiling clamps straight back to itself:
    // there is no room for the evidence, so nothing is written and the digest
    // item still nudges. Silently persisting a truncated marker would leave a
    // half-written clause in a user-facing field.
    if (!next.includes(DIGEST_TRIGGER_CLAUSE_PREFIX)) continue;
    if (next === current.trim()) continue;
    if (!fresh.every((intent) => isCovered(intent, next))) continue;
    return next;
  }
  return null;
}

/**
 * The VARIABLE half of the lane request — the only half `maxInputChars` clips.
 * Descriptions are clamped here rather than left to the runner's clip, so the
 * material that gets dropped when a batch runs long is one skill's context and
 * never the tail of the list.
 */
function buildRewritePrompt(targets: readonly RewriteTarget[]): string {
  const blocks = targets.map((target) =>
    [
      `ref: ${target.ref}`,
      `current description: ${clampWords(target.description, DIGEST_REWRITE_PROMPT_DESCRIPTION_CHARS)}`,
      `missed session intents:`,
      ...target.fresh.map((intent) => `- ${intent}`),
    ].join('\n'),
  );
  return [
    `Rewrite the trigger clause for ${targets.length} skill(s).`,
    ``,
    blocks.join('\n\n'),
  ].join('\n');
}

@injectable()
export class SkillGapCuratorService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SkillCandidateStore)
    private readonly candidates: SkillCandidateStore,
    @inject(SessionVerdictStore)
    private readonly verdicts: SessionVerdictStore,
    @inject(SkillSuggestionStore)
    private readonly suggestions: SkillSuggestionStore,
    /**
     * The user's own memory, optional by design. A CLI, an e2e host or an
     * install with indexing off registers no reader, and sweep (d) then
     * contributes nothing rather than failing the pass — memory-conditioned
     * relevance is a corroborating signal, never a precondition.
     */
    @inject(MEMORY_CONTRACT_TOKENS.MEMORY_READER, { isOptional: true })
    private readonly memory: IMemoryReader | null,
    /**
     * The authoring lane behind sweep (a)'s rewrite, optional for the same
     * reason `archaeologist`, `judge-panel`, `replay` and `trigger-eval` are:
     * a CLI or e2e host provisions no LLM at all. Absent, the sweep appends the
     * archaeologist's verbatim intents instead — the behaviour B4.2 shipped —
     * so the lane can only ever add. `= null` so the two specs that build this
     * service positionally keep compiling without knowing the lane exists.
     */
    @inject(SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE, { isOptional: true })
    private readonly laneRunner: LaneRunnerService | null = null,
  ) {}

  /**
   * Run all four sweeps and return the ranked digest, highest score first.
   *
   * NEVER REJECTS. A failing store, a missing table and an unavailable memory
   * reader each cost their own sweep and nothing else.
   *
   * ## `allowRewrite` defaults to `false`, and THIS is the only place it does
   *
   * The lane call in sweep (a) is NOT covered by any budget. `digest` is a
   * member of `SkillQueueStage`, `WEEKLY_ONLY_STAGES` and
   * `TOKEN_SPENDING_STAGES`, but **no handler is registered for it and nothing
   * enqueues a `digest` row** — `registerStageHandler` is called for
   * `prefilter`, `embedding`, `archaeology`, `judge-panel`, `replay` and
   * `trigger-eval`, never for `digest`. So `SkillDrainService` never claims a
   * digest item and its `maxTokensPerDay` gate never fires for one. The only
   * caller of this method anywhere is the `skillSynthesis:digest` RPC, running
   * synchronously in the foreground.
   *
   * That RPC is called AUTOMATICALLY: the Skills tab refreshes the digest on
   * init, and `SkillSynthesisLiveService` refreshes it (debounced) on four
   * background event kinds. Left to spend by default, background activity would
   * buy ungated LLM calls.
   *
   * Hence `=== true`, not `?? false`. Anything a caller did not explicitly ask
   * for — omitted, `undefined`, or a value that slipped past a boundary as
   * something other than the boolean `true` — reads as "do not spend". The
   * default lives here rather than in the RPC handler or the panel because a
   * default at a caller protects that caller only, and the next caller to
   * appear inherits nothing.
   *
   * `false` is not a degraded digest. Every sweep, every score and sweep (a)'s
   * write all still happen; the appended clause is the archaeologist's verbatim
   * session intent instead of an authored paraphrase, which is exactly what
   * B4.2 shipped. What `false` buys is that the lane is not called AT ALL — not
   * called and discarded, not called with a smaller budget. Zero lane calls.
   */
  async runDigest(request: DigestRequest): Promise<DigestItem[]> {
    const limit = request.limit ?? DIGEST_DEFAULT_LIMIT;
    const allowRewrite = request.allowRewrite === true;
    const verdicts = this.readVerdicts(request.workspaceRoot);
    // Scoped to the SAME workspace as the other three sweeps. Before B4.7 this
    // read was cross-project purely because the store's query took no argument,
    // so a per-workspace digest could carry one row from another repo.
    const winRates = this.readWinRates(request.workspaceRoot);
    const skills = this.readPromotedSkills();

    const items: DigestItem[] = [];
    const clusters = this.clusterFriction(verdicts);

    const missed = this.collectMissedTriggers(verdicts, skills);
    const rewritten = await this.applyDescriptionRewrites(missed, allowRewrite);
    items.push(...this.buildMissedTriggerItems(missed, rewritten, winRates));
    items.push(...this.sweepFrictionOpportunities(clusters));
    items.push(...this.sweepWinRates(winRates, skills));
    items.push(
      ...(await this.sweepMemorySignals(
        clusters,
        verdicts,
        request.workspaceRoot,
      )),
    );

    return items.sort(compareDigestItems).slice(0, limit);
  }

  // ── Sweep (a): a relevant skill existed and was never invoked ─────────────

  /**
   * Succeeded sessions that a skill in the library should have carried.
   *
   * The evidence is the pair "this session succeeded" AND "this skill was never
   * invoked in it" — the second half is why the sweep needs the per-slug
   * invoked-session set rather than the dominant-slug lookup: a session that
   * used SOME other skill is still a missed trigger for this one.
   */
  private collectMissedTriggers(
    verdicts: readonly SessionVerdict[],
    skills: readonly SkillCandidateRow[],
  ): MissedTrigger[] {
    const succeeded = verdicts.filter((v) => isWinEvidence(v.evidenceClass));
    if (succeeded.length === 0 || skills.length === 0) return [];

    const sessionTokens = new Map<string, Set<string>>();
    for (const verdict of succeeded) {
      sessionTokens.set(verdict.sessionId, tokenize(verdictText(verdict)));
    }

    const found: MissedTrigger[] = [];
    for (const skill of skills) {
      const skillTokens = tokenize(`${skill.name} ${skill.description}`);
      if (skillTokens.size < DIGEST_MIN_SKILL_TOKENS) continue;

      // `null` = we could not read this skill's invocations. An empty set would
      // claim it was never invoked anywhere and turn a failed read into a
      // fabricated missed trigger, so the skill is skipped for this pass.
      const invoked = this.invokedSessionsFor(skill.name);
      if (invoked === null) continue;
      const missed = succeeded.filter((verdict) => {
        if (invoked.has(verdict.sessionId)) return false;
        const tokens = sessionTokens.get(verdict.sessionId);
        return (
          tokens !== undefined &&
          overlapRatio(skillTokens, tokens) >= DIGEST_MIN_RELEVANCE
        );
      });
      if (missed.length === 0) continue;

      found.push({
        skill,
        missed,
        intents: missed
          .map((v) => v.intent)
          .filter(
            (intent): intent is string => (intent ?? '').trim().length > 0,
          ),
      });
    }
    return found;
  }

  /** The digest items, once the rewrite pass has said which slugs it changed. */
  private buildMissedTriggerItems(
    found: readonly MissedTrigger[],
    rewritten: ReadonlySet<string>,
    winRates: ReadonlyMap<string, SkillWinRate>,
  ): DigestItem[] {
    return found.map(({ skill, missed }) => {
      const changed = rewritten.has(skill.name);
      const title = skill.displayName ?? skill.name;
      return {
        kind: 'missed-trigger' as const,
        title: `"${title}" fit ${missed.length} succeeded session(s) but was never invoked`,
        rationale: changed
          ? `The description did not retrieve on work it matches. Its pending suggestion's description now names that work; accept or edit it to keep the change.`
          : `The description did not retrieve on work it matches — rewriting it so it names this work would make the skill reachable.`,
        score: Math.min(
          DIGEST_MISSED_TRIGGER_MAX,
          DIGEST_MISSED_TRIGGER_BASE +
            (missed.length - 1) * DIGEST_MISSED_TRIGGER_STEP,
        ),
        evidence: {
          sessionIds: missed
            .slice(0, DIGEST_EVIDENCE_SESSION_CAP)
            .map((v) => v.sessionId),
          counts: {
            missedSessions: missed.length,
            descriptionRewrites: changed ? 1 : 0,
          },
          winRate: this.winRateOf(winRates, skill.name),
        },
      };
    });
  }

  /**
   * Sharpen each skill's PENDING suggestion so its description names the work
   * it missed, and return the slugs that actually moved.
   *
   * FOUR CONDITIONS, AND ALL FOUR ARE THE AUTONOMY BOUNDARY:
   *
   *  1. Every write goes through `SkillSuggestionStore.updatePending` — the
   *     path the Skills tab's own edit uses. There is no second writer here and
   *     `insertPending` is never called, so the digest cannot file a proposal
   *     the user never asked for. Pinned by a source scan in the spec, because
   *     the DB-count assertion only catches it on a seeded pass.
   *  2. Only a row that is still `pending` moves; the store itself refuses an
   *     accepted or dismissed one, and nothing here overrides that.
   *  3. The clause is AUTHORED on the `synthesis` lane when the caller opted in
   *     AND a lane is available, and VERBATIM session intent otherwise — but
   *     either way it must pass `isCovered` against the intents it claims to
   *     name, so the model can sharpen the wording and cannot replace the
   *     evidence with prose of its own. A clause that fails falls back to the
   *     verbatim intent rather than to nothing.
   *  4. It is idempotent, and provably rather than incidentally — see
   *     `DIGEST_REWRITE_COVERAGE`. The freshness gate runs BEFORE the lane, so
   *     a second pass over the same evidence makes no call and no write.
   *
   * The whole method is one guarded read plus writes: a throwing suggestion
   * store costs the rewrite and nothing else, because `runDigest` may not
   * reject.
   */
  private async applyDescriptionRewrites(
    found: readonly MissedTrigger[],
    allowRewrite: boolean,
  ): Promise<Set<string>> {
    const changed = new Set<string>();
    const targets = this.collectRewriteTargets(found);
    if (targets.length === 0) return changed;

    // ONE call, for every target at once, and NONE at all when the caller did
    // not opt in. `null` = the caller opted out, no lane in this host, the lane
    // was unavailable, or it failed — all four take the verbatim path, which is
    // why the rest of this method has one fallback to reason about rather than
    // two. The opt-out is checked HERE and short-circuits `authorClauses`
    // entirely: an unbudgeted call whose answer is then discarded costs exactly
    // as much as one that is used.
    const authored = allowRewrite
      ? await this.authorClauses(targets.slice(0, DIGEST_REWRITE_MAX_SKILLS))
      : null;

    for (const target of targets) {
      const next = composeDescription(
        target.description,
        target.fresh,
        authored?.get(target.ref) ?? null,
      );
      if (next === null) continue;
      try {
        const result = this.suggestions.updatePending(target.suggestionId, {
          description: next,
        });
        if (result?.description === next) changed.add(target.slug);
      } catch (error: unknown) {
        this.logger.warn('[skill-digest] description rewrite failed', {
          slug: target.slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return changed;
  }

  /**
   * The pending suggestions with something NEW to say, and what it is.
   *
   * `listByStatus('pending')` is read ONCE for the whole sweep rather than once
   * per skill: the pass walks every promoted skill, and a per-slug query would
   * make the digest's cost scale with the library instead of with the evidence.
   */
  private collectRewriteTargets(
    found: readonly MissedTrigger[],
  ): RewriteTarget[] {
    let pending;
    try {
      pending = this.suggestions.listByStatus('pending');
    } catch (error: unknown) {
      this.logger.warn('[skill-digest] pending suggestions unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    const targets: RewriteTarget[] = [];
    for (const { skill, intents } of found) {
      if (intents.length === 0) continue;
      for (const row of pending) {
        if (row.name !== skill.name) continue;
        const fresh = selectFreshClauses(row.description, intents);
        if (fresh.length === 0) continue;
        targets.push({
          ref: String(targets.length + 1),
          suggestionId: row.id,
          slug: skill.name,
          description: row.description,
          fresh,
        });
      }
    }
    return targets;
  }

  /**
   * The one lane call. `null` on every path that did not produce clauses, so
   * the caller has exactly one fallback to reason about.
   *
   * A `SkillLaneFailure` is logged with `kind` and `reason` as SEPARATE
   * structured fields and is deliberately not collapsed into a token any
   * consumer reads — see this file's header for why it cannot be handed
   * further out than this.
   */
  private async authorClauses(
    targets: readonly RewriteTarget[],
  ): Promise<Map<string, string> | null> {
    const runner = this.laneRunner;
    if (!runner) return null;

    let result;
    try {
      result = await runner.run({
        laneId: 'synthesis',
        prompt: buildRewritePrompt(targets),
        // FIXED instructions on the half `maxInputChars` does not clip.
        systemPromptAppend: DIGEST_REWRITE_RUBRIC,
        outputSchema: DIGEST_REWRITE_SCHEMA,
      });
    } catch (error: unknown) {
      this.logger.warn('[skill-digest] rewrite lane threw', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    if (result.status === 'unavailable') {
      this.logger.debug(
        '[skill-digest] no synthesis lane in this host; appending verbatim intents',
        { reason: result.reason },
      );
      return null;
    }
    if (result.status === 'failed') {
      this.logger.warn(
        '[skill-digest] rewrite lane failed; appending verbatim intents',
        { kind: result.failure.kind, reason: result.failure.reason },
      );
      return null;
    }

    const clauses = parseRewrites(result.run.json);
    return clauses.size > 0 ? clauses : null;
  }

  // ── Sweep (b): friction clusters with no success ──────────────────────────

  /**
   * Sessions that went wrong the same way, with no success anywhere in the
   * cluster — a skill-shaped hole in the library.
   *
   * The "no success" test runs across the WHOLE swept set, not just the failing
   * half: a cluster where one session eventually succeeded is a solved problem
   * and the routine that solved it is synthesis's business, not the digest's.
   */
  private sweepFrictionOpportunities(
    clusters: readonly FrictionCluster[],
  ): DigestItem[] {
    return clusters
      .filter(
        (cluster) => cluster.sessionIds.length >= DIGEST_FRICTION_MIN_SESSIONS,
      )
      .map((cluster) => ({
        kind: 'friction-opportunity' as const,
        title: `${cluster.sessionIds.length} sessions hit the same friction and none succeeded`,
        rationale: `Recurring friction with no measured success: "${clampWords(cluster.note, 160)}". A skill covering this would be learned from failure rather than from a smooth session.`,
        score: Math.min(
          DIGEST_FRICTION_MAX,
          DIGEST_FRICTION_BASE +
            (cluster.sessionIds.length - DIGEST_FRICTION_MIN_SESSIONS) *
              DIGEST_FRICTION_STEP,
        ),
        evidence: {
          sessionIds: cluster.sessionIds.slice(0, DIGEST_EVIDENCE_SESSION_CAP),
          counts: cluster.counts,
          // No skill exists for this hole, so there is nothing measured to
          // report. `null`, never `0` — see the file header.
          winRate: null,
        },
      }));
  }

  /**
   * Group verdicts carrying friction by a signature built from their friction
   * notes, dropping any group that contains a succeeded session.
   */
  private clusterFriction(
    verdicts: readonly SessionVerdict[],
  ): FrictionCluster[] {
    const groups = new Map<
      string,
      {
        sessionIds: string[];
        note: string;
        counts: Record<string, number>;
        hasWin: boolean;
      }
    >();

    for (const verdict of verdicts) {
      if (verdict.frictionMap.length === 0) continue;
      const signature = this.frictionSignature(verdict.frictionMap);
      if (signature.length === 0) continue;

      const group = groups.get(signature) ?? {
        sessionIds: [],
        note: verdict.frictionMap[0].note,
        counts: { sessions: 0, correction: 0, retry: 0, 'dead-end': 0 },
        hasWin: false,
      };
      group.sessionIds.push(verdict.sessionId);
      // Bracket, not dot: `counts` is an index signature, and consumers of this
      // barrel compile with `noPropertyAccessFromIndexSignature`.
      group.counts['sessions'] += 1;
      for (const entry of verdict.frictionMap) {
        group.counts[entry.kind] = (group.counts[entry.kind] ?? 0) + 1;
      }
      if (isWinEvidence(verdict.evidenceClass)) group.hasWin = true;
      groups.set(signature, group);
    }

    const clusters: FrictionCluster[] = [];
    for (const [signature, group] of groups) {
      if (group.hasWin) continue;
      clusters.push({
        signature,
        sessionIds: group.sessionIds,
        note: group.note,
        counts: group.counts,
      });
    }
    return clusters;
  }

  /** The N most-repeated content tokens across a session's friction notes, sorted. */
  private frictionSignature(entries: readonly FrictionEntry[]): string {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      for (const token of tokenize(entry.note)) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, DIGEST_FRICTION_SIGNATURE_TOKENS)
      .map(([token]) => token)
      .sort()
      .join('|');
  }

  // ── Sweep (c): per-skill win rate ─────────────────────────────────────────

  /**
   * One item per slug with recorded invocations, scored by `scoreForWinRate`.
   *
   * An UNMEASURED skill is reported rather than skipped, and reported LAST.
   * Skipping it would hide the fact that a skill is being used with no evidence
   * either way; scoring it as a `0` would put it first. Both are wrong, and the
   * second is the one that looks right.
   */
  private sweepWinRates(
    winRates: ReadonlyMap<string, SkillWinRate>,
    skills: readonly SkillCandidateRow[],
  ): DigestItem[] {
    const titles = new Map(
      skills.map((s) => [s.name, s.displayName ?? s.name] as const),
    );
    const items: DigestItem[] = [];
    for (const rate of winRates.values()) {
      const sessionIds = this.recentSessionsFor(rate.slug);
      if (sessionIds.length === 0) continue;
      const title = titles.get(rate.slug) ?? rate.slug;
      items.push({
        kind: 'win-rate',
        title:
          rate.winRate === null
            ? `"${title}" has no measured outcome yet`
            : `"${title}" wins ${percent(rate.winRate)} of measured sessions`,
        rationale:
          rate.winRate === null
            ? `${rate.invocations} invocation(s), none in a session with a settled outcome. Unmeasured is not a loss: this is ranked last, not first.`
            : `${rate.wins} win(s) across ${rate.invocations - rate.unknown} measured session(s) of ${rate.invocations} invocation(s).`,
        score: scoreForWinRate(rate.winRate),
        evidence: {
          sessionIds,
          counts: {
            invocations: rate.invocations,
            wins: rate.wins,
            unknown: rate.unknown,
          },
          winRate: rate.winRate,
        },
      });
    }
    return items;
  }

  // ── Sweep (d): memory-conditioned relevance ───────────────────────────────

  /**
   * Ask the user's own memory whether the friction we just clustered is a
   * recurring part of their stack, and cite the answer.
   *
   * This is what keeps a recommendation from resting on trajectory similarity
   * alone: two sessions can look alike and mean nothing, while a memory the
   * user's own workspace produced about the same subject is corroboration from
   * an independent source. Without a reader the sweep is silent — a host
   * without memory degrades, it does not fail.
   */
  private async sweepMemorySignals(
    clusters: readonly FrictionCluster[],
    verdicts: readonly SessionVerdict[],
    workspaceRoot: string,
  ): Promise<DigestItem[]> {
    const reader = this.memory;
    if (!reader) return [];

    const probes = this.buildMemoryProbes(clusters, verdicts);
    const items: DigestItem[] = [];
    const seen = new Set<string>();

    for (const probe of probes) {
      let page: MemoryHitPage | null = null;
      try {
        page = await reader.search(
          probe.query,
          DIGEST_MEMORY_TOP_K,
          workspaceRoot,
        );
      } catch (error: unknown) {
        this.logger.warn('[skill-digest] memory search failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      const hits = page.hits;
      if (hits.length === 0) continue;
      const top = hits[0];
      if (seen.has(top.memoryId)) continue;
      seen.add(top.memoryId);

      items.push({
        kind: 'memory-signal',
        title: `Memory corroborates: ${clampWords(top.subject ?? top.chunkText, 80)}`,
        rationale: `${hits.length} memory observation(s) match work in ${probe.sessionIds.length} session(s): "${clampWords(top.chunkText, 160)}". The recommendation rests on the user's recorded stack, not on trajectory similarity alone.`,
        score: Math.min(
          DIGEST_MEMORY_MAX,
          DIGEST_MEMORY_BASE + hits.length * DIGEST_MEMORY_STEP,
        ),
        evidence: {
          sessionIds: probe.sessionIds.slice(0, DIGEST_EVIDENCE_SESSION_CAP),
          counts: {
            memoryHits: hits.length,
            sessions: probe.sessionIds.length,
            bm25Only: page.bm25Only ? 1 : 0,
          },
          // A memory observation says nothing about any skill's outcome.
          winRate: null,
        },
      });
    }
    return items;
  }

  /**
   * What to ask memory about: the friction clusters first (they are the
   * strongest signal the digest has), then unresolved sessions, so a workspace
   * with no clustered friction still gets the sweep.
   */
  private buildMemoryProbes(
    clusters: readonly FrictionCluster[],
    verdicts: readonly SessionVerdict[],
  ): Array<{ query: string; sessionIds: string[] }> {
    const probes: Array<{ query: string; sessionIds: string[] }> = [];
    for (const cluster of clusters) {
      probes.push({ query: cluster.note, sessionIds: cluster.sessionIds });
      if (probes.length === DIGEST_MEMORY_MAX_QUERIES) return probes;
    }
    for (const verdict of verdicts) {
      if (isWinEvidence(verdict.evidenceClass)) continue;
      const intent = (verdict.intent ?? '').trim();
      if (intent.length === 0) continue;
      probes.push({ query: intent, sessionIds: [verdict.sessionId] });
      if (probes.length === DIGEST_MEMORY_MAX_QUERIES) return probes;
    }
    return probes;
  }

  // ── Guarded reads. Each degrades to "no evidence of this kind". ───────────

  private readVerdicts(workspaceRoot: string): SessionVerdict[] {
    try {
      return this.verdicts.listByWorkspace(
        workspaceRoot,
        DIGEST_VERDICT_SCAN_LIMIT,
      );
    } catch (error: unknown) {
      // The C2 ⇢ C4 soft edge: no verdict table on this host yet. Sweeps (a),
      // (b) and (d) have nothing to read; (c) reads its own join, which lands
      // on the same table and degrades the same way.
      this.logger.warn('[skill-digest] verdict sweep unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * The win rates for THIS workspace. The argument is passed through verbatim,
   * `''` included, so sweep (c) scopes exactly as `listByWorkspace` scopes the
   * other three — a digest whose four sweeps disagree about what "here" means
   * is one the user can catch out. Pre-`0037` rows carry a NULL
   * `workspace_root` and the store's predicate keeps them; see `getWinRates`.
   */
  private readWinRates(workspaceRoot: string): Map<string, SkillWinRate> {
    try {
      return new Map(
        this.candidates.getWinRates(workspaceRoot).map((r) => [r.slug, r]),
      );
    } catch (error: unknown) {
      this.logger.warn('[skill-digest] win-rate join unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return new Map();
    }
  }

  private readPromotedSkills(): SkillCandidateRow[] {
    try {
      return this.candidates.listByStatus('promoted');
    } catch (error: unknown) {
      this.logger.warn('[skill-digest] skill library unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /** `null` = the lookup failed, which is NOT "never invoked". */
  private invokedSessionsFor(slug: string): Set<string> | null {
    try {
      return new Set(
        this.candidates.getRecentSessionsForSlug(
          slug,
          DIGEST_INVOCATION_LOOKBACK,
        ),
      );
    } catch (error: unknown) {
      this.logger.warn('[skill-digest] invocation lookup failed', {
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private recentSessionsFor(slug: string): string[] {
    try {
      return this.candidates.getRecentSessionsForSlug(
        slug,
        DIGEST_EVIDENCE_SESSION_CAP,
      );
    } catch (error: unknown) {
      this.logger.warn('[skill-digest] evidence lookup failed', {
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * `undefined` from the map means the slug has no invocation events at all —
   * unmeasured, therefore `null`. Written as a branch rather than `?? null` so
   * the two different "no number" cases stay visibly distinct.
   */
  private winRateOf(
    winRates: ReadonlyMap<string, SkillWinRate>,
    slug: string,
  ): number | null {
    const row = winRates.get(slug);
    if (!row) return null;
    return row.winRate;
  }
}
