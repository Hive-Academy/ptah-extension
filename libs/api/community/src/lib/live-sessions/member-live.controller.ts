import {
  Controller,
  Get,
  Inject,
  Logger,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { dtoPipe } from '@ptah-api/core';
import { JwtAuthGuard } from '@ptah-api/identity';
import { MemberGuard } from '@ptah-api/membership';
import type { MemberLiveResponse } from '@ptah-contracts/community';

import { requireMemberContext } from './common/member-context';
import { ListLiveQueryDto, resolveLiveQuery } from './dto/list-live.query.dto';
import { LiveFeedService } from './live-feed.service';

/**
 * `MemberLiveController` — `GET /api/v1/members/live` (R3.3, R3.6, plan §3.5).
 *
 * ── THE PREFIX IS A DEPTH-3 LITERAL, AND NO ROUTE HERE MAY PARAMETERISE
 *    SEGMENT 3 (AD-12, RI-1) ────────────────────────────────────────────────
 * `v1/members/{entitlement,hub,sessions,community,search,courses,
 * lesson-comments,live,session-requests}` are nine DISJOINT literal siblings.
 * RI-1 in `route-map.spec.ts` fails the build the moment one controller's
 * prefix becomes a segment-wise path-prefix of another's, and both ledgers it
 * could be excused through (`PREFIX_EXCEPTIONS`, `KNOWN_PREFIX_DEBT`) are
 * deliberately closed to new entries.
 *
 * ⚠️ `v1/members/live` vs `v1/members/session-requests` vs `v1/members/sessions`:
 * segment 3 differs in every pair, and note that `live` and `session-requests`
 * are not even STRING prefixes of anything here. That is not an accident of
 * naming — `v1/members/sessions/live` WOULD have nested under the existing
 * `v1/members/sessions` and reproduced RISK-J exactly.
 *
 * ── GUARDS AT CLASS LEVEL, IN THAT ORDER ───────────────────────────────────
 * `JwtAuthGuard` then `MemberGuard`: authenticate, then check entitlement. At
 * CLASS level rather than per handler so a route added later is guarded by
 * default — a per-handler `@UseGuards` leaves every FUTURE handler open, and
 * this surface's whole visibility model derives from the `MemberContext` the
 * second guard attaches.
 *
 * ⚠️ `requireMemberContext` IS A TRIPWIRE FOR A REMOVED GUARD, NOT A NULL
 * CHECK. With `ctx` undefined the feed's visibility `where` would carry
 * `cohortKeys: undefined`, and Prisma treats an undefined filter as no
 * constraint.
 *
 * ── R3.6: THIS ENDPOINT DOES NOT FAIL WHEN GOOGLE IS UNCONFIGURED ──────────
 * `GOOGLE_OAUTH_*` unset is the default state of this workspace and a
 * legitimate production posture. The response then carries
 * `calendarAvailable: false`, the Ptah-sourced sessions, and NO ERROR. There is
 * no branch here that could produce one: `LiveFeedService.read` folds every
 * Calendar non-answer into that flag rather than throwing.
 *
 * ── NO WRITES ──────────────────────────────────────────────────────────────
 * The live schedule is authored by admins (`v1/admin/live-sessions`). This
 * controller is read-only, so it takes the global 100/min throttle and names no
 * tier of its own.
 */
@Controller('v1/members/live')
@UseGuards(JwtAuthGuard, MemberGuard)
export class MemberLiveController {
  private readonly logger = new Logger(MemberLiveController.name);

  constructor(
    @Inject(LiveFeedService) private readonly feed: LiveFeedService,
  ) {}

  /**
   * `GET` — the merged upcoming / live / replays feed (AD-3).
   *
   * 🔴 `@Query(dtoPipe(ListLiveQueryDto))` — A WHOLE-OBJECT DTO, NOT
   * `@Query('page') page: string` (PRE-1, RISK-I). Two things ride on it: a
   * bare `@Query()` is SILENTLY UNVALIDATED because esbuild emits no
   * `emitDecoratorMetadata`, and `NAMED_PRIMITIVE_PARAM_COUNT` is an
   * EXACT-EQUALITY assertion at 6, so a named primitive here fails the build.
   */
  @Get()
  async read(
    @Req() req: Request,
    @Query(dtoPipe(ListLiveQueryDto)) query: ListLiveQueryDto,
  ): Promise<MemberLiveResponse> {
    const ctx = requireMemberContext(
      req,
      MemberLiveController.name,
      this.logger,
    );
    return this.feed.read(ctx, resolveLiveQuery(query));
  }
}
