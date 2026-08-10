import {
  Controller,
  Get,
  Inject,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '@ptah-api/identity';
import { MemberGuard } from '@ptah-api/membership';
import type { MemberPack } from '@ptah-contracts/community';

import { requireMemberContext } from '../live-sessions/common/member-context';

import { MemberPacksService } from './member-packs.service';

/**
 * `MemberPacksController` — `GET /api/v1/members/packs` (R5.1, R5.3, plan §3.6).
 *
 * ── 🔴 IT IS IN `MemberPacksModule`, NOT IN `PacksModule`, AND THAT IS A
 *    BUILD-BREAKING DISTINCTION (RISK-AG) ───────────────────────────────────
 * This file sits in the SAME DIRECTORY as `admin-packs.controller.ts` because
 * plan §2.9's layout puts the two pack surfaces together, and that reads as
 * "same module". It is not. `admin-guards.spec.ts` G6 asserts that EVERY
 * controller in `PacksModule` is mounted under `v1/admin/`; adding this class to
 * that module's `controllers` array fails G6 immediately, and G6 is the cheapest
 * guard on the whole architecture — packs may never acquire a member endpoint by
 * accident. **CO-LOCATION IS NOT CO-REGISTRATION.** `PacksModule` also refuses
 * `@Global()` on purpose, so `PacksService` is not reachable from here even if
 * someone tried; this controller's service is a different class with a different
 * dependency set.
 *
 * ── THE PREFIX IS A DEPTH-3 LITERAL (AD-12, RI-1) ──────────────────────────
 * `v1/members/packs` joins nine existing literal siblings —
 * `{entitlement,hub,sessions,session-requests,live,community,courses,
 * lesson-comments,search}` — and segment 3 differs in every pair, so no prefix
 * is a segment-wise path prefix of another. Both ledgers RI-1 could excuse a
 * violation through (`PREFIX_EXCEPTIONS`, `KNOWN_PREFIX_DEBT` in
 * `route-map.spec.ts`) are deliberately at their floor and gain nothing here.
 *
 * ── GUARDS AT CLASS LEVEL, IN THAT ORDER ───────────────────────────────────
 * `JwtAuthGuard` then `MemberGuard`: authenticate, then check entitlement.
 * CLASS level rather than per handler, so a route added later is guarded by
 * default — a per-handler `@UseGuards` leaves every FUTURE handler open, which
 * is leak risk L1 and what `admin-guards.spec.ts` G1 exists to catch on the
 * admin side.
 *
 * ── 🔴 ONE HANDLER, A BARE ARRAY, AND NO `@Query` AT ALL ───────────────────
 * Plan §3.6's table says `MemberPack[]`, not `Paged<MemberPack>`, and plan §1.2
 * rejects an index on `member_visible` because the table is "tens of rows,
 * always read in full". Paginating it would contradict both. The absence of any
 * query parameter also keeps `NAMED_PRIMITIVE_PARAM_COUNT` at EXACTLY 6 — that
 * constant is asserted by exact equality in `controller-validation.spec.ts`, so
 * one `@Query('page') page: string` here would fail the build. There is no
 * `@Body()` either, so this controller adds nothing to
 * `MIN_TOTAL_PAYLOAD_PARAMS` and needs no `dtoPipe` binding (PRE-1 is satisfied
 * vacuously, not waived).
 *
 * ── READ-ONLY ─────────────────────────────────────────────────────────────
 * Packs are authored at `v1/admin/packs`. This surface takes the global 100/min
 * throttle and names no tier of its own.
 */
@Controller('v1/members/packs')
@UseGuards(JwtAuthGuard, MemberGuard)
export class MemberPacksController {
  private readonly logger = new Logger(MemberPacksController.name);

  constructor(
    @Inject(MemberPacksService) private readonly packs: MemberPacksService,
  ) {}

  /**
   * `GET` — every member-visible pack, alphabetical by title (R5.1).
   *
   * ⚠️ `requireMemberContext` IS A TRIPWIRE FOR A REMOVED GUARD, NOT A NULL
   * CHECK. The context it returns is deliberately unread by the query (A-1 —
   * see `MemberPacksService.list`), so the tripwire is doing LESS work here
   * than on the session-request surface, where an undefined context would widen
   * a `where`. It is kept anyway, and kept identical, because the property it
   * protects is "this handler cannot be reached without `MemberGuard`" — and
   * that property is what makes the endpoint entitled-members-only at all. A
   * `403` for a non-member is the entire access decision on this route.
   */
  @Get()
  async list(@Req() req: Request): Promise<MemberPack[]> {
    const ctx = requireMemberContext(
      req,
      MemberPacksController.name,
      this.logger,
    );
    return this.packs.list(ctx);
  }
}
