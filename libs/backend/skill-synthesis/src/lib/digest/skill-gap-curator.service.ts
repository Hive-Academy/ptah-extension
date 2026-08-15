/**
 * `SkillGapCuratorService` — the four sweeps of the weekly gap digest
 * (plan §4 Phase 4, task B4.2.2).
 *
 * ## What this service is allowed to do
 *
 * Rank, evidence and nudge. Nothing else. It never promotes, rejects, demotes,
 * deletes or files a new suggestion, and it never asks a model anything — every
 * number below is READ from something already measured (session verdicts, the
 * invocation → outcome join, the user's own memory). That is not a cost
 * optimisation, it is the autonomy boundary phase 4 was approved under: the
 * user still accepts or dismisses, so the digest's whole job is to make the
 * accepting well-informed. It also means this service owns no timeout, opens no
 * lane and needs none — the "every LLM call goes through `LaneRunnerService`"
 * rule is satisfied vacuously, and it should stay that way. A sweep that wants
 * a model has become a queue stage and belongs on a lane.
 *
 * The one write it makes is sweep (a)'s description rewrite, and it goes
 * through the EXISTING `SkillSuggestionStore.updatePending` path — see
 * `rewriteDescriptionFor` for the four conditions on it. There is deliberately
 * no second suggestion-writing path here: `insertPending` is never called, so
 * the digest can sharpen a proposal the user has not yet decided on, and can do
 * nothing at all to one they have.
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
  ) {}

  /**
   * Run all four sweeps and return the ranked digest, highest score first.
   *
   * NEVER REJECTS. A failing store, a missing table and an unavailable memory
   * reader each cost their own sweep and nothing else.
   */
  async runDigest(request: DigestRequest): Promise<DigestItem[]> {
    const limit = request.limit ?? DIGEST_DEFAULT_LIMIT;
    const verdicts = this.readVerdicts(request.workspaceRoot);
    const winRates = this.readWinRates();
    const skills = this.readPromotedSkills();

    const items: DigestItem[] = [];
    const clusters = this.clusterFriction(verdicts);

    items.push(...this.sweepMissedTriggers(verdicts, skills, winRates));
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
  private sweepMissedTriggers(
    verdicts: readonly SessionVerdict[],
    skills: readonly SkillCandidateRow[],
    winRates: ReadonlyMap<string, SkillWinRate>,
  ): DigestItem[] {
    const succeeded = verdicts.filter((v) => isWinEvidence(v.evidenceClass));
    if (succeeded.length === 0 || skills.length === 0) return [];

    const sessionTokens = new Map<string, Set<string>>();
    for (const verdict of succeeded) {
      sessionTokens.set(verdict.sessionId, tokenize(verdictText(verdict)));
    }

    const items: DigestItem[] = [];
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

      const intents = missed
        .map((v) => v.intent)
        .filter((intent): intent is string => (intent ?? '').trim().length > 0);
      const rewritten = this.rewriteDescriptionFor(skill.name, intents);
      const title = skill.displayName ?? skill.name;
      items.push({
        kind: 'missed-trigger',
        title: `"${title}" fit ${missed.length} succeeded session(s) but was never invoked`,
        rationale: rewritten
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
            descriptionRewrites: rewritten ? 1 : 0,
          },
          winRate: this.winRateOf(winRates, skill.name),
        },
      });
    }
    return items;
  }

  /**
   * Sharpen the skill's PENDING suggestion so its description names the work it
   * missed. Four conditions, and all four are the autonomy boundary:
   *
   *  1. It goes through `SkillSuggestionStore.updatePending` — the path the
   *     Skills tab's own edit uses. There is no second writer here, and
   *     `insertPending` is never called, so the digest cannot file a proposal
   *     the user never asked for.
   *  2. Only a row that is still `pending` moves; the store itself refuses an
   *     accepted or dismissed one, and this method never overrides that.
   *  3. The appended text is VERBATIM session intent — evidence the
   *     archaeologist already wrote and the user can go read — never generated
   *     prose. This service asks no model anything.
   *  4. It is idempotent: an intent already named in the description is not
   *     appended again, so a weekly pass does not grow the field without bound.
   *
   * Returns `true` only when a row was actually updated.
   */
  private rewriteDescriptionFor(
    slug: string,
    intents: readonly string[],
  ): boolean {
    if (intents.length === 0) return false;
    try {
      const pending = this.suggestions
        .listByStatus('pending')
        .filter((row) => row.name === slug);
      let updated = false;
      for (const row of pending) {
        const next = this.buildRewrittenDescription(row.description, intents);
        if (next === null) continue;
        const result = this.suggestions.updatePending(row.id, {
          description: next,
        });
        if (result?.description === next) updated = true;
      }
      return updated;
    } catch (error: unknown) {
      this.logger.warn('[skill-digest] description rewrite failed', {
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /** `null` when there is nothing new to say, or no room left to say it. */
  private buildRewrittenDescription(
    current: string,
    intents: readonly string[],
  ): string | null {
    const existing = current.toLowerCase();
    const fresh: string[] = [];
    for (const intent of intents) {
      const clause = clampWords(intent, DIGEST_REWRITE_INTENT_CHARS);
      if (clause.length === 0) continue;
      if (existing.includes(clause.toLowerCase())) continue;
      if (fresh.includes(clause)) continue;
      fresh.push(clause);
      if (fresh.length === DIGEST_REWRITE_MAX_INTENTS) break;
    }
    if (fresh.length === 0) return null;

    const next = clampWords(
      `${current.trim()} ${DIGEST_TRIGGER_CLAUSE_PREFIX}${fresh.join('; ')}`,
      DIGEST_DESCRIPTION_MAX_CHARS,
    );
    // A description already at the ceiling clamps straight back to itself:
    // there is no room for the evidence, so nothing is written and the digest
    // item still nudges. Silently persisting a truncated marker would leave a
    // half-written clause in a user-facing field.
    if (!next.includes(DIGEST_TRIGGER_CLAUSE_PREFIX)) return null;
    if (next === current.trim()) return null;
    return next;
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

  private readWinRates(): Map<string, SkillWinRate> {
    try {
      return new Map(this.candidates.getWinRates().map((r) => [r.slug, r]));
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
