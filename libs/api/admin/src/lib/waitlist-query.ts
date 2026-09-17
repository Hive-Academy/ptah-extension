import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@ptah-api/core';

/**
 * The ONE waitlist stage / query policy (TASK_2026_462 Component 1).
 *
 * Every surface that reads the waitlist — the admin pipeline list, its stage
 * counts, eligible-id resolution, CSV export, details and `/v1/admin/stats` —
 * derives its notion of "which stage is this row in" from the exports of this
 * file and from nowhere else.
 *
 * WHY A POLICY MODULE AT ALL. The three lifecycle stamps are independent
 * nullable facts: `convertedAt` (paid — Paddle fan-out only), `approvedAt`
 * (free founding grant) and `notifiedAt` (HISTORICAL — nothing writes it since
 * TASK_2026_201 deleted the paid invite wave). Deriving tabs from raw
 * timestamp presence OVERLAPS: an approved row that was never notified reads
 * as both New and Approved under presence-only logic. The precedence below is
 * exhaustive and disjoint, so `new + invited + approved + converted === total`
 * — the invariant the list counts and the stats tests assert. Raw `notified`
 * stays outside that equation: it answers a historical question, not a stage.
 *
 * SECURITY POSTURE. The exported `const` tuples are the single source of the
 * DTO allowlists — `admin-waitlist.dto.ts` decorates with these very arrays,
 * so a wire value can never widen past what the query layer accepts. Inside
 * this module no user string becomes a Prisma key: stage and source select
 * LITERAL predicate objects from hard-coded maps, and the sort builder guards
 * its input against the closed field union before touching an object key.
 *
 * ⚠️ THIS MODULE OWNS NO PERSISTENCY AND NO HTTP. It throws exactly one
 * exception — the `INVALID_DATE_RANGE` `BadRequestException` for a reversed
 * created range — and every other malformed input is a DTO concern that never
 * reaches here. Controllers, response mapping, audit and Angular live
 * elsewhere. Dependency direction: controller/service → this policy → Prisma
 * types, never the reverse.
 */

/** Stage tabs, wire values and predicate keys in one closed set. */
export const WAITLIST_STAGES = [
  'all',
  'new',
  'invited',
  'approved',
  'converted',
] as const;

export type WaitlistStage = (typeof WAITLIST_STAGES)[number];

/** The four stages a ROW can be in — `'all'` is a filter, not a stage. */
export type WaitlistListStage = Exclude<WaitlistStage, 'all'>;

/**
 * Source dropdown values. The five non-null members mirror the web join
 * contract; `'unknown'` is the API's explicit null bucket, not a stored value.
 * Historical free-form sources stay discoverable through search and visible
 * in list/export rows, but cannot become a dropdown filter value.
 */
export const WAITLIST_SOURCES = [
  'landing',
  'pricing',
  'profile',
  'vscode',
  'early-adopter',
  'unknown',
] as const;

export type WaitlistSource = (typeof WAITLIST_SOURCES)[number];

/** Allowlisted sort columns — every member is a literal `Waitlist` column. */
export const WAITLIST_SORT_FIELDS = [
  'createdAt',
  'notifiedAt',
  'approvedAt',
  'convertedAt',
  'source',
] as const;

export type WaitlistSortField = (typeof WAITLIST_SORT_FIELDS)[number];

export const WAITLIST_SORT_ORDERS = ['asc', 'desc'] as const;

export type WaitlistSortOrder = (typeof WAITLIST_SORT_ORDERS)[number];

/** The stable page-size set the pipeline UI offers. */
export const WAITLIST_PAGE_SIZES = [10, 25, 50, 100] as const;

export type WaitlistPageSize = (typeof WAITLIST_PAGE_SIZES)[number];

/**
 * Cap for select-matching resolution. Matches `ApproveWaitlistDto`'s
 * `@ArrayMaxSize(50)`: one confirmation maps to one bounded approval wave,
 * and the response must disclose the cap rather than silently omit rows.
 */
export const WAITLIST_ELIGIBLE_IDS_LIMIT = 50;

/**
 * Defensive ceiling for CSV export, checked BEFORE data retrieval. Far above
 * the current 400+ row dataset; exists to bound server memory. Over-limit
 * requests get 413 `WAITLIST_EXPORT_LIMIT_EXCEEDED` and narrow their filters.
 */
export const WAITLIST_EXPORT_MAX_ROWS = 50_000;

/**
 * The disjoint stage predicates, Converted > Approved > Invited > New.
 *
 * Literal objects — a stage wire value selects one of these by KEY LOOKUP
 * against this map, so no part of the resulting `where` originates from user
 * input. `pending` is deliberately absent: it is the AGGREGATE `new +
 * invited`, computed from two counts, never a fifth predicate.
 */
export const WAITLIST_STAGE_PREDICATES: Record<
  WaitlistListStage,
  Prisma.WaitlistWhereInput
> = {
  converted: { convertedAt: { not: null } },
  approved: { convertedAt: null, approvedAt: { not: null } },
  invited: {
    convertedAt: null,
    approvedAt: null,
    notifiedAt: { not: null },
  },
  new: { convertedAt: null, approvedAt: null, notifiedAt: null },
};

/**
 * Approval eligibility: BOTH stamps absent. This is the server-side twin of
 * the UI's eligibility rule — an already approved or converted row can never
 * be approval-eligible, regardless of its historical `notifiedAt` value.
 */
export const WAITLIST_ELIGIBLE_PREDICATE: Prisma.WaitlistWhereInput = {
  approvedAt: null,
  convertedAt: null,
};

/**
 * The lifecycle facts a waitlist row carries. Exactly the projection the
 * stage derivation needs — nothing wider, so a policy test cannot depend on
 * fields the read paths do not select.
 */
export interface WaitlistLifecycleFacts {
  createdAt: Date;
  notifiedAt: Date | null;
  approvedAt: Date | null;
  convertedAt: Date | null;
}

/** Stage derivation result — the three per-row fields the wire row adds. */
export interface WaitlistStageDerivation {
  stage: WaitlistListStage;
  /**
   * The timestamp relevant to the current stage: `convertedAt`, `approvedAt`
   * or `notifiedAt` for those stages, `createdAt` for New. Never null.
   */
  stageAt: Date;
  /** `approvedAt === null && convertedAt === null`. */
  approvalEligible: boolean;
}

/**
 * Resolve one row's stage by Converted > Approved > Invited > New precedence
 * (R1.1), together with its display timestamp and approval eligibility.
 *
 * Pure and total: every possible combination of the three stamps lands in
 * exactly one stage, which is what makes the stage-sum invariant provable.
 */
export function deriveWaitlistStage(
  row: WaitlistLifecycleFacts,
): WaitlistStageDerivation {
  if (row.convertedAt !== null) {
    return {
      stage: 'converted',
      stageAt: row.convertedAt,
      approvalEligible: false,
    };
  }
  if (row.approvedAt !== null) {
    return {
      stage: 'approved',
      stageAt: row.approvedAt,
      approvalEligible: false,
    };
  }
  if (row.notifiedAt !== null) {
    return {
      stage: 'invited',
      stageAt: row.notifiedAt,
      approvalEligible: true,
    };
  }
  return { stage: 'new', stageAt: row.createdAt, approvalEligible: true };
}

/**
 * The validated filter vocabulary the DTO layer hands to
 * {@link buildWaitlistWhere}. Every member has already passed its DTO
 * allowlist by the time it arrives here; the guards below are belt-and-braces
 * against a caller that bypasses TypeScript, not a second validation layer.
 */
export interface WaitlistFilterInput {
  stage?: WaitlistStage;
  search?: string;
  source?: WaitlistSource;
  /** Inclusive lower bound (ISO-8601 instant). */
  createdFrom?: string;
  /** Inclusive upper bound (ISO-8601 instant). */
  createdTo?: string;
}

/** Runtime membership guards over the closed tuples exported above. */
function isWaitlistListStage(value: unknown): value is WaitlistListStage {
  return (
    typeof value === 'string' &&
    value !== 'all' &&
    value in WAITLIST_STAGE_PREDICATES
  );
}

function isWaitlistSource(value: unknown): value is WaitlistSource {
  return (
    typeof value === 'string' &&
    (WAITLIST_SOURCES as readonly string[]).includes(value)
  );
}

function isWaitlistSortField(value: unknown): value is WaitlistSortField {
  return (
    typeof value === 'string' &&
    (WAITLIST_SORT_FIELDS as readonly string[]).includes(value)
  );
}

/** Parse a DTO-validated ISO-8601 instant; absent stays absent. */
function parseInstant(value: string | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Combine stage, search, source and created-range filters into ONE Prisma
 * `where` with AND semantics (R2.1).
 *
 *   - `stage` selects a literal predicate from {@link WAITLIST_STAGE_PREDICATES};
 *     `'all'` (or an unexpected value) contributes nothing.
 *   - `search` is trimmed here and matches email OR source,
 *     case-insensitive `contains` — the same idiom as
 *     `AdminService.buildSearchWhere`.
 *   - `source` is an exact equality filter; `'unknown'` reads `source IS NULL`.
 *   - `createdFrom`/`createdTo` are INCLUSIVE `gte`/`lte` bounds on `createdAt`.
 *
 * Throws `BadRequestException` `{ code: 'INVALID_DATE_RANGE' }` when
 * `createdFrom` is strictly after `createdTo`. This is the ONLY exception the
 * module throws, and it is the only range check the DTOs cannot express.
 */
export function buildWaitlistWhere(
  filters: WaitlistFilterInput,
): Prisma.WaitlistWhereInput {
  const clauses: Prisma.WaitlistWhereInput[] = [];

  if (isWaitlistListStage(filters.stage)) {
    clauses.push(WAITLIST_STAGE_PREDICATES[filters.stage]);
  }

  const search = filters.search?.trim();
  if (search) {
    clauses.push({
      OR: [
        { email: { contains: search, mode: 'insensitive' } },
        { source: { contains: search, mode: 'insensitive' } },
      ],
    });
  }

  if (isWaitlistSource(filters.source)) {
    clauses.push(
      filters.source === 'unknown'
        ? { source: null }
        : { source: filters.source },
    );
  }

  const createdFrom = parseInstant(filters.createdFrom);
  const createdTo = parseInstant(filters.createdTo);
  if (createdFrom !== undefined && createdTo !== undefined) {
    if (createdFrom.getTime() > createdTo.getTime()) {
      throw new BadRequestException({
        code: 'INVALID_DATE_RANGE',
        message: 'createdFrom must be before or equal to createdTo',
      });
    }
  }

  if (createdFrom !== undefined || createdTo !== undefined) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (createdFrom !== undefined) {
      createdAt.gte = createdFrom;
    }
    if (createdTo !== undefined) {
      createdAt.lte = createdTo;
    }
    clauses.push({ createdAt });
  }

  if (clauses.length === 0) {
    return {};
  }
  if (clauses.length === 1) {
    return clauses[0];
  }
  return { AND: clauses };
}

/**
 * Deterministic `orderBy` for every list-like read: the requested allowlisted
 * field and direction, then `{ id: 'asc' }` as the tie-breaker.
 *
 * ⚠️ THE TIE-BREAKER IS THE ONLY DETERMINISM PROMISED. Sorting by a nullable
 * column leaves null placement to the database; the id key pins the order of
 * equal-key rows so pagination and export row order are stable. Callers must
 * not rely on nulls-first or nulls-last.
 *
 * `sortBy` arrives DTO-validated as a member of the closed
 * {@link WAITLIST_SORT_FIELDS} union; the guard below demotes an unexpected
 * runtime value to the default column rather than letting it become an
 * object key.
 */
export function buildWaitlistOrderBy(
  sortBy: WaitlistSortField,
  sortOrder: WaitlistSortOrder,
): Prisma.WaitlistOrderByWithRelationInput[] {
  const field = isWaitlistSortField(sortBy) ? sortBy : 'createdAt';
  const direction: Prisma.SortOrder = sortOrder === 'asc' ? 'asc' : 'desc';
  return [
    { [field]: direction } as Prisma.WaitlistOrderByWithRelationInput,
    { id: 'asc' },
  ];
}
