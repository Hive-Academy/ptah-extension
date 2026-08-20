import { IsISO8601 } from 'class-validator';

import { IsOptionalNotNull } from '../common/optional-field';

/**
 * `GET /v1/admin/live-sessions` — the authoring surface's date-range filter
 * (plan §2.10).
 *
 * 🔴 A WHOLE-OBJECT QUERY DTO, FOR THE SAME EXACT-EQUALITY REASON AS
 * `ListLiveQueryDto`. `NAMED_PRIMITIVE_PARAM_COUNT` is asserted at EXACTLY 6
 * (RISK-I), so `@Query('from') from: string` here would fail the build.
 *
 * ── 🔴 THERE IS NO `?includeDeleted`, AND ITS ABSENCE IS THE DESIGN ─────────
 *
 * Plan §2.10's admin table has none, and adding one would be a DESIGN EVENT
 * rather than a parameter:
 *
 *   - it would be this directory's FIRST AD-5 exemption, on the read path that
 *     currently keeps `EXPECTED_EXEMPTIONS` at `[]`;
 *   - a paged read needs TWO entries, not one — the page AND the total run under
 *     the same `where` (Batch 6C's C-1);
 *   - and `soft-delete-filter.spec.ts`'s census docblock says an exemption is a
 *     decision a reviewer reads, not a formality.
 *
 * ⚠️ THE CONSEQUENCE IS RECORDED RATHER THAN PAPERED OVER (the same gap Batch
 * 9B raised as its F-3 for courses): `POST :id/restore` exists and there is no
 * API path to DISCOVER a restorable session, so an admin must already hold its
 * id — from a screen that by construction never showed it. Whoever adds the
 * discovery read owns the exemption.
 *
 * ── WHY A DATE RANGE AT ALL ────────────────────────────────────────────────
 * The archive accumulates for ever while the schedule does not, so an unfiltered
 * admin list is a table that grows without bound for a screen whose job is "what
 * am I running this month". `from`/`to` bound it without touching visibility,
 * without touching `NOT_DELETED`, and without an exemption.
 */
export class ListAdminLiveQueryDto {
  /** Inclusive lower bound on `startsAt`. ISO 8601. */
  @IsOptionalNotNull()
  @IsISO8601()
  from?: string;

  /** Exclusive upper bound on `startsAt`. ISO 8601. */
  @IsOptionalNotNull()
  @IsISO8601()
  to?: string;
}

/**
 * Defaults resolved ONCE, OUTSIDE the DTO — see `resolveLiveQuery`'s note on
 * why class-field initialisers are avoided.
 *
 * ⚠️ AN OMITTED BOUND STAYS `undefined`, NOT `new Date(undefined)`. The latter
 * is an Invalid Date, which Prisma sends to Postgres as a value no row compares
 * equal to — an empty admin list with no error to explain it.
 */
export function resolveAdminLiveQuery(query: ListAdminLiveQueryDto): {
  from?: Date;
  to?: Date;
} {
  return {
    from: query.from === undefined ? undefined : new Date(query.from),
    to: query.to === undefined ? undefined : new Date(query.to),
  };
}
