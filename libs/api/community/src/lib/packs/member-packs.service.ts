import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import type { MemberPack } from '@ptah-contracts/community';

import { toMemberPack } from './packs.types';

/**
 * The cohort name join, re-declared rather than imported from
 * `packs.service.ts`.
 *
 * ⚠️ THE DUPLICATION IS THE CHEAPER OF THE TWO MISTAKES. Importing the admin
 * service's copy would put an import edge from the member read path into the
 * file that owns every pack MUTATION and the audit writes — one `import` line
 * away from a member service that can reach `PacksService` itself. Two
 * four-token object literals that happen to agree is not the kind of duplication
 * DRY is about; a member module reaching into the admin module is exactly the
 * coupling `MemberPacksModule` exists to prevent (RISK-AG).
 */
const COHORT_INCLUDE = { cohort: { select: { name: true } } } as const;

/**
 * `MemberPacksService` — the member-facing read of the pack registry (R5.1,
 * R5.3, R5.4 / A-1, NFR-S4, NFR-S5, plan §3.6).
 *
 * ── 🔴 THIS SERVICE IS DEFINED AS MUCH BY WHAT IT DOES NOT INJECT ──────────
 * `PrismaService` AND NOTHING ELSE. No `AuditLogService` (this is a read, and
 * a read is not an admin action). No `MembershipService`. No
 * `MemberGroupsService`. And above all **no `CohortResolver`** — which is
 * `@Global()` (`libs/api/membership/src/lib/cohort-resolver.service.ts:29`,
 * provided by the `@Global()` `MembershipModule`) and therefore injectable from
 * anywhere in this server without adding a single module import. NOTHING
 * STRUCTURAL STOPS THAT INJECTION, so the absence is asserted as source text in
 * `member-packs.service.spec.ts` rather than left as an intention. That
 * assertion is the control, and it mirrors `admin-guards.spec.ts` G6, which
 * asserts the same absence on the admin half.
 *
 * ── 🔴 THE `where` IS `{ memberVisible: true }` AND NOTHING ELSE (A-1) ──────
 * One column decides member visibility. There is no `cohortKey` clause, no
 * `ctx.cohortKeys` clause and no visibility helper, because `cohortKey` IS A
 * BOOKKEEPING LABEL AND NOT AN ACCESS CONTROL — changing it grants and revokes
 * nothing (`packs.types.ts`). Every member-visible pack is shown to every
 * entitled member, including a member with zero cohort assignments, which is the
 * normal state of an entitled member an admin has not yet placed in a cohort
 * (R7.8: empty is normal, never an error).
 *
 * ⚠️ THE `_ctx` PARAMETER IS DELIBERATELY UNREAD, AND THE UNDERSCORE SAYS SO AT
 * THE SIGNATURE RATHER THAN ONLY IN PROSE. It is taken because every member read
 * service in this task takes one — the guard chain resolves a `MemberContext`
 * once per request and passes it down — and because a caller that has one has
 * provably been through `MemberGuard`. It is NOT taken so that a later reader can
 * "finish the job" by folding `_ctx.cohortKeys` into the `where`. Doing that
 * would silently convert a discovery surface into a gate and hide every
 * unlabelled pack from every member; the spec's three-fixture case fails
 * immediately if anyone tries.
 *
 * ── THIS REGISTRY STILL GATES NOTHING (R5.7) ───────────────────────────────
 * Ptah never serves pack content and never provisions GitHub access. Phase 5
 * replaced the DELIVERY CHANNEL — the link used to be posted in the cohort's
 * group on the external forum that P1b deleted — and delivering a link is not
 * granting access. `accessNote` exists precisely so a member reads how access is
 * granted BEFORE following `repoUrl` into a GitHub 404 (R5.5).
 */
@Injectable()
export class MemberPacksService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Every member-visible pack — `GET /api/v1/members/packs` (R5.1, R5.3).
   *
   * ONE QUERY, A BARE ARRAY, NO PAGINATION. Plan §1.2 rejects an index on
   * `member_visible` because the table holds tens of rows and is always read in
   * full; paging a list that never has a second page is a knob with nothing
   * behind it, and it would have cost a query DTO on a controller that
   * deliberately has no `@Query` at all.
   *
   * `orderBy: { title: 'asc' }` — a stable, human-meaningful order. There is no
   * `createdAt` on `MemberPack` for a client to sort by, so the server has to
   * pick one, and "alphabetical" is the one a member can predict.
   */
  async list(_ctx: MemberContext): Promise<MemberPack[]> {
    const rows = await this.prisma.pack.findMany({
      where: { memberVisible: true },
      include: COHORT_INCLUDE,
      orderBy: { title: 'asc' },
    });

    return rows.map((row) => toMemberPack(row));
  }
}
