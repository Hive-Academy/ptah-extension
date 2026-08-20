/**
 * The weekly gap digest's wire shape (plan §4 Phase 4, task B4.2.1).
 *
 * WHAT A DIGEST ITEM IS. One ranked, evidenced NUDGE. It says "here is
 * something about your skill library worth a minute of your attention, and here
 * are the session ids that made us say it". It is never an action: nothing in
 * this folder promotes, rejects, demotes or deletes anything. The system ranks
 * and evidences; the user still accepts or dismisses. That autonomy boundary is
 * the product contract phase 4 was approved under, and it is why `DigestItem`
 * carries a `rationale` and an `evidence` block instead of a verb.
 *
 * `evidence` IS THE POINT, NOT DECORATION. `sessionIds` are the receipts — an
 * item nobody can trace back to real sessions is an opinion, and the digest has
 * no way to earn trust from opinions. `counts` is the open per-kind tally
 * (`Record<string, number>` rather than a union of shapes: the four sweeps count
 * genuinely different things, and a discriminated union here would make the RPC
 * mirror in B4.4 four wire types instead of one).
 *
 * `winRate` IS `number | null` AND `null` IS NEVER `0`. A skill nobody has
 * measured has no win rate; a skill measured and beaten has a low one. Every
 * ranking in this folder branches on that `null` rather than coalescing it — a
 * single `??` or `||` on this field silently converts "we never measured this"
 * into "this loses every time", which is the exact inversion
 * `SkillCandidateStore.getWinRates()`'s header exists to forbid. See
 * `scoreForWinRate` in `skill-gap-curator.service.ts` for the one place that
 * decision is made, and the mutation-tested spec that pins it.
 */
import type { EvidenceClass } from '../archaeology/session-verdict.types';

/**
 * Which sweep produced an item. Ordered as the four sweeps appear in the batch,
 * and used as the deterministic tie-break when two items score identically —
 * a digest whose order changes between two identical runs cannot be reasoned
 * about by the user or asserted on by a test.
 */
export const DIGEST_ITEM_KINDS = [
  /** (a) A succeeded session a relevant skill should have carried, but did not. */
  'missed-trigger',
  /** (b) A friction cluster with no success anywhere in it — a skill-shaped hole. */
  'friction-opportunity',
  /** (c) A skill's measured (or deliberately unmeasured) win rate. */
  'win-rate',
  /** (d) A recurring pain the user's own memory corroborates. */
  'memory-signal',
] as const;

export type DigestItemKind = (typeof DIGEST_ITEM_KINDS)[number];

/**
 * The evidence classes that count as a WIN.
 *
 * A LOCAL MIRROR OF THE `getWinRates()` SQL, ON PURPOSE AND UNDER TEST. The
 * canonical partition lives in that query's `CASE` arms
 * (`skill-candidate.store.ts`). Rather than inferring the partition a second
 * way and letting the two drift silently,
 * `skill-gap-curator.service.spec.ts` scans the store's source and fails if any
 * member here is missing from it. `no-correction` is deliberately ABSENT: it is
 * weak evidence of success — not a win, and not unknown either.
 *
 * THE MIRROR TEST IS SUPPOSED TO BREAK WHEN THAT SQL CHANGES — that is the
 * whole mechanism. B4.7 gave `getWinRates` an optional `workspaceRoot` and two
 * statement bodies instead of one, and the scan was widened WITH it (it now
 * anchors on `getWinRates(` and additionally asserts the workspace predicate
 * and the `NULL` arm that keeps pre-`0037` events in a scoped read). Making a
 * failing mirror pass by loosening or deleting the scan removes the only thing
 * keeping these three literals honest.
 */
export const DIGEST_WIN_EVIDENCE_CLASSES: readonly EvidenceClass[] = [
  'tests-green',
  'user-accepted',
  'explicit-confirmation',
];

/** Whether a verdict's evidence class settles the session as a success. */
export function isWinEvidence(value: EvidenceClass | null): boolean {
  return value !== null && DIGEST_WIN_EVIDENCE_CLASSES.includes(value);
}

/**
 * The receipts behind one item.
 *
 * `sessionIds` is `readonly` because the digest hands the same array to every
 * consumer — the Activity panel, the RPC mirror and the ranking itself — and a
 * consumer that sorted it in place would reorder another's evidence.
 */
export interface DigestEvidence {
  /** The sessions that justify the item. NEVER empty — an item with no receipts is not filed. */
  readonly sessionIds: readonly string[];
  /** Per-kind tallies (`missedSessions`, `retry`, `invocations`, `memoryHits`, …). */
  readonly counts: Record<string, number>;
  /** `wins / measured` for the skill involved; `null` = unmeasured, NEVER `0`. */
  readonly winRate: number | null;
}

/**
 * One ranked nudge. `score` is a 0–1 attention weight, sorted DESCENDING by the
 * curator before it returns; it is not a quality score and carries no unit
 * beyond "look at this one first".
 */
export interface DigestItem {
  readonly kind: DigestItemKind;
  /** One short human-facing line. Safe to render as a heading. */
  readonly title: string;
  /** Why this was surfaced, stated as measured facts rather than advice. */
  readonly rationale: string;
  /** Attention weight, 0–1. Higher first. */
  readonly score: number;
  readonly evidence: DigestEvidence;
}
