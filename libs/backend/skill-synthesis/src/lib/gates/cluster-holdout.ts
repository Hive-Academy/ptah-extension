/**
 * Reserving the replay gate's hold-out at DRAFT time (TASK_2026_180, B3.6).
 *
 * `ReplayValidatorService` grades a drafted skill against a session the draft
 * did NOT see. That is what makes its number a measure of TRANSFER rather than
 * of recall. B3.2 shipped the gate and {@link selectHoldoutSessionId}, but
 * nothing on the drafting side ever held a session back: the cluster-synthesis
 * path fed EVERY member to the synthesizer and recorded EVERY cluster session as
 * the draft's sources, so the gate's subtraction always came back empty and the
 * stage reported `replay-no-holdout` forever. This module is the missing half.
 *
 * ## ONE SELECTOR, TWO CALLERS — never two rules
 *
 * {@link planClusterDraft} does NOT re-derive "which member to exclude". It
 * calls the gate's own {@link selectHoldoutSessionId}, with `used` empty,
 * against the full cluster. The gate later calls the identical function with
 * `used` set to the sessions the draft consumed. Two independent rules would
 * agree on the day they were written and silently diverge on the day either one
 * learned about a new session-id shape — and the failure mode of divergence is
 * not an exception, it is a `null` confidence that reads exactly like "this
 * cluster had nothing to spare".
 *
 * The agreement is therefore stated as an invariant and pinned by a spec:
 *
 * ```text
 * selectHoldoutSessionId(plan.clusterSessionIds, plan.draftedSessionIds)
 *   === plan.holdoutSessionId          // for EVERY plan, reserved or not
 * ```
 *
 * It holds in both directions by construction. When a hold-out is reserved, the
 * selector returns the lexicographically greatest cluster session, and the
 * greatest element of a set is still the greatest element of any subset that
 * contains it — so subtracting the drafted sessions leaves it at the top. When
 * no hold-out is reserved, the drafted set IS the cluster, the subtraction is
 * empty, and both sides read `null`.
 *
 * ## THE FLOOR OUTRANKS THE MEASUREMENT
 *
 * `skillSynthesis.suggestionMinClusterSize` (default 2) is the number of
 * sessions a suggestion must be distilled from before it is worth proposing at
 * all, and `SkillClusteringService` only emits clusters that meet it. Holding a
 * member back from a cluster sitting exactly ON that floor would draft from one
 * session — single-session synthesis wearing a cluster's name — which trades the
 * quality of the artefact for the existence of a number about it. This module
 * refuses that trade: a hold-out is reserved ONLY when the remaining draft still
 * meets the floor, and a cluster at the floor is drafted from every member and
 * reported with `holdoutSessionId: null`.
 *
 * `null` is the honest answer there, not a degradation. B3.1 pinned that
 * `replay_confidence` `null` means "never measured" and `0` means "measured and
 * matched nothing", so a cluster that CANNOT be measured must read `null` —
 * which is also what the gate independently produces for it, because the
 * subtraction over an unreserved plan is empty.
 *
 * ## EXCLUSION IS MEMBER-GRANULAR, THE HOLD-OUT IS A SESSION
 *
 * The synthesizer's unit is a cluster MEMBER (a candidate with a body); there is
 * no way to feed it "this candidate minus one of its sessions". So reserving
 * session `X` drops every member that lists `X` among its sources. A candidate
 * normally carries exactly one session (`skill-synthesis.service.ts:1014`
 * registers `[sessionId]`), so this is one member in practice — but when a
 * member carries several, its siblings leave the draft with it, and the
 * invariant above still holds because the reserved session was the greatest of
 * the whole cluster.
 */
import { selectHoldoutSessionId } from './replay-validator.service';

/**
 * A draft may never be built from zero members, whatever the setting says.
 * `suggestionMinClusterSize` is user-writable and a `0` there would otherwise
 * hand the synthesizer an empty member list and call the result a skill.
 */
const ABSOLUTE_DRAFT_FLOOR = 1;

/** Why {@link planClusterDraft} answered the way it did. Stable tokens. */
export type ClusterDraftReason =
  /** A member was held back; `holdoutSessionId` is non-null and measurable. */
  | 'holdout-reserved'
  /** Holding one back would have drafted below `suggestionMinClusterSize`. */
  | 'cluster-at-floor'
  /** The cluster carries no usable session id at all. Nothing to hold out. */
  | 'no-cluster-sessions';

/** The only thing this module needs to know about a cluster member. */
export interface ClusterMemberSessions {
  readonly sourceSessionIds: readonly string[];
}

/**
 * What the cluster-synthesis stage should draft from, and what it deliberately
 * did not.
 */
export interface ClusterDraftPlan<T extends ClusterMemberSessions> {
  /** The members to hand the synthesizer. Never empty for a non-empty cluster. */
  readonly drafted: readonly T[];
  /**
   * The sessions the draft actually consumed. This is what must be persisted as
   * the candidate's `sourceSessionIds` — it is the `used` half of the gate's
   * subtraction.
   */
  readonly draftedSessionIds: readonly string[];
  /**
   * Every session in the cluster, held out or not. This is the gate's
   * `clusterSessionIds`; without it the difference is unrecoverable.
   */
  readonly clusterSessionIds: readonly string[];
  /**
   * The session reserved for the replay gate, or `null` when the cluster had
   * none to spare. Never a stand-in for "unknown".
   */
  readonly holdoutSessionId: string | null;
  readonly reason: ClusterDraftReason;
}

/**
 * The distinct, non-blank sessions a set of members was built from.
 *
 * Blank ids are dropped for the same reason {@link selectHoldoutSessionId}
 * drops them: an empty session id addresses no transcript, and one reserved as
 * a hold-out would be persisted as a measurement nobody can look up.
 */
export function clusterSessionIdsOf(
  members: readonly ClusterMemberSessions[],
): string[] {
  return [
    ...new Set(
      members.flatMap((m) => m.sourceSessionIds.map((id) => id.trim())),
    ),
  ].filter(Boolean);
}

/**
 * Decide which cluster members the draft may see, and which single session is
 * reserved for the replay gate.
 *
 * See the header: the pick delegates to the gate's own selector, and the floor
 * outranks the measurement.
 */
export function planClusterDraft<T extends ClusterMemberSessions>(
  members: readonly T[],
  minClusterSize: number,
): ClusterDraftPlan<T> {
  const clusterSessionIds = clusterSessionIdsOf(members);

  // The gate's rule, called from the drafting side. Nothing is `used` yet.
  const holdoutSessionId = selectHoldoutSessionId(clusterSessionIds);
  if (holdoutSessionId === null) {
    return draftEverything(members, clusterSessionIds, 'no-cluster-sessions');
  }

  const drafted = members.filter((m) => !owns(m, holdoutSessionId));
  const floor = Math.max(ABSOLUTE_DRAFT_FLOOR, minClusterSize);
  if (drafted.length < floor) {
    return draftEverything(members, clusterSessionIds, 'cluster-at-floor');
  }

  return {
    drafted,
    draftedSessionIds: clusterSessionIdsOf(drafted),
    clusterSessionIds,
    holdoutSessionId,
    reason: 'holdout-reserved',
  };
}

/**
 * No reservation: the draft consumed the whole cluster, so `draftedSessionIds`
 * IS `clusterSessionIds` and the gate's subtraction over them is empty — which
 * is how the gate independently reaches the same `null` this plan reports.
 */
function draftEverything<T extends ClusterMemberSessions>(
  members: readonly T[],
  clusterSessionIds: readonly string[],
  reason: ClusterDraftReason,
): ClusterDraftPlan<T> {
  return {
    drafted: members,
    draftedSessionIds: clusterSessionIds,
    clusterSessionIds,
    holdoutSessionId: null,
    reason,
  };
}

function owns(member: ClusterMemberSessions, sessionId: string): boolean {
  return member.sourceSessionIds.some((id) => id.trim() === sessionId);
}
