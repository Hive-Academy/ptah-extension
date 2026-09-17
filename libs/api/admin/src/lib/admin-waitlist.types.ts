import type { WaitlistListStage } from './waitlist-query';

/**
 * Response contracts for the admin waitlist READ surface
 * (`GET /api/v1/admin/waitlist`, `…/eligible-ids`, `…/export.csv`,
 * `…/:id/details` — TASK_2026_462 Batch A).
 *
 * ⚠️ WHY THESE TYPES LIVE HERE AND NOT IN `libs/api-contracts/community`.
 * Same convention as `waitlist-approval.types.ts:10`: that lib is the
 * COMMUNITY domain with an executable boundary guard, the server declares
 * admin response types next to the handler (`AdminStatsResponse` in
 * `admin.service.ts` is the precedent), and the admin client re-declares
 * them as Zod schemas validated at its own HTTP boundary.
 *
 * ⚠️ NO LICENCE KEY AND NO PADDLE IDENTIFIER APPEARS ANYWHERE IN THESE
 * PAYLOADS. `WaitlistUserContext.licenses` projects the `License` row's id,
 * plan, status and source — never `licenseKey`; `subscriptions` projects
 * status and price only — never `paddleSubscriptionId` or a customer id.
 * Audit rows project an allowlisted metadata view — never `ipAddress`,
 * `userAgent` or a raw snapshot.
 */

/**
 * One waitlist row as the wire sees it. The server, not the client, derives
 * `stage`, `stageAt` and `approvalEligible` through the one policy module
 * (`waitlist-query.ts`), so every surface — list, stats, export, details,
 * selection — answers "which stage is this row in" identically.
 */
export interface WaitlistListRow {
  id: string;
  email: string;
  source: string | null;
  /** ISO-8601 UTC instant. */
  createdAt: string;
  /** ISO-8601 UTC instant, or null — historical, nothing writes it. */
  notifiedAt: string | null;
  /** ISO-8601 UTC instant, or null — the free founding grant. */
  approvedAt: string | null;
  /** ISO-8601 UTC instant, or null — they paid (Paddle fan-out only). */
  convertedAt: string | null;
  /** The row's ONE stage: converted > approved > invited > new. */
  stage: WaitlistListStage;
  /**
   * The timestamp relevant to `stage`: the winning stamp, else `createdAt`.
   * Never null.
   */
  stageAt: string;
  /** `approvedAt === null && convertedAt === null`. */
  approvalEligible: boolean;
}

/**
 * Stage-tab counts for the list response. `all`/`new`/`invited`/`approved`/
 * `converted` are disjoint and sum to `all`; `pending` is the aggregate
 * `new + invited`, computed from the two counts — never a fifth predicate.
 * All five stages count with the request's optional filters applied and its
 * `stage` omitted.
 */
export interface WaitlistStageCounts {
  all: number;
  /** `new + invited`. */
  pending: number;
  new: number;
  invited: number;
  approved: number;
  converted: number;
}

/** `GET /api/v1/admin/waitlist` — one page plus filtered stage counts. */
export interface WaitlistListResponse {
  /** The requested page. Beyond the final page this is empty, never an error. */
  data: WaitlistListRow[];
  /** Rows matching the ACTIVE stage plus the optional filters. */
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Stage-tab counts under the same optional filters, stage omitted. */
  counts: WaitlistStageCounts;
}

/**
 * `GET /api/v1/admin/waitlist/eligible-ids` — resolve select-matching to
 * explicit ids, capped at {@link WAITLIST_ELIGIBLE_IDS_LIMIT}. The only
 * select-matching route; approving by filter is impossible by construction.
 */
export interface WaitlistEligibleIdsResponse {
  /** Ordered explicit ids, `length <= limit`. */
  ids: string[];
  /** `ids.length`. */
  selected: number;
  /** Every approval-eligible row matching the current filters. */
  eligibleMatching: number;
  /** The cap, echoed so the client never hard-codes it. */
  limit: number;
  /** `eligibleMatching > selected` — a disclosure the UI must render. */
  truncated: boolean;
}

/**
 * The linked-account context a waitlist row's email resolves to, or `null`
 * when no user carries that address. Missing relations are empty arrays, not
 * errors.
 */
export interface WaitlistUserContext {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: string;
  /** `License` rows by id — NEVER `licenseKey`. */
  licenses: Array<{
    id: string;
    plan: string;
    status: string;
    source: string;
    expiresAt: string | null;
    createdAt: string;
    createdBy: string;
  }>;
  /** Subscription state — no Paddle customer or subscription identifiers. */
  subscriptions: Array<{
    id: string;
    status: string;
    priceId: string;
    currentPeriodEnd: string;
    trialEnd: string | null;
    canceledAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  /** Cohort assignments with their group identity. */
  groups: Array<{
    id: string;
    key: string;
    name: string;
    assignedAt: string;
    source: string;
  }>;
}

/**
 * The allowlisted metadata view of one `waitlist.approve` audit row. Keys the
 * approval writer never sets are simply absent — unknown or future metadata
 * keys are dropped by the projection, never forwarded.
 */
export interface WaitlistDetailsAuditMetadata {
  userId?: string;
  userWasCreated?: boolean;
  licenseId?: string;
  durationPreset?: string;
  expiresAt?: string | null;
  groupKey?: string;
  wasNotified?: boolean;
  cohortAlreadyAssigned?: boolean;
}

/** One directly attributable `Waitlist`-targeted audit event, newest last read. */
export interface WaitlistDetailsAudit {
  id: string;
  actorEmail: string | null;
  action: string;
  targetType: 'Waitlist';
  targetId: string;
  createdAt: string;
  metadata: WaitlistDetailsAuditMetadata;
}

/** `GET /api/v1/admin/waitlist/:id/details` — one entry plus its context. */
export interface WaitlistDetailsResponse {
  entry: WaitlistListRow;
  /** Null when the lead never registered — the entry itself is still valid. */
  user: WaitlistUserContext | null;
  /** The 100 newest `Waitlist`/id audit rows, newest first. */
  audit: WaitlistDetailsAudit[];
}
