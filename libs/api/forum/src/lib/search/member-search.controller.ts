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
import type { MemberSearchResults } from '@ptah-contracts/community';

import { requireMemberContext } from '../common/member-context';

import { SearchQueryDto } from './dto/search.query.dto';
import { SearchService } from './search.service';

/**
 * `MemberSearchController` — `GET /api/v1/members/search` (R1.7).
 *
 * ── WHY IT IS ITS OWN CLASS AND NOT A ROUTE ON `MemberCommunityController` ───
 * Two reasons, and the second is the binding one:
 *
 *  1. Search spans MORE than the forum. `?kinds=topics,posts,lessons` already
 *     names lessons, which Phase 3 fills in. Hanging it off
 *     `v1/members/community` would put the cross-surface search inside the
 *     forum's namespace and make Phase 3 either move it (a breaking URL change
 *     after the frontend ships) or leave it lying about its scope.
 *  2. `v1/members/{entitlement,hub,sessions,community,search}` are five
 *     DISJOINT LITERAL siblings at depth 3. RI-1 in `route-map.spec.ts` fails
 *     the build if one controller prefix becomes a path-prefix of another's, and
 *     RI-2 fails if two controllers can contest a concrete path. This class may
 *     therefore never declare a parameter at segment 3 — a `@Controller('v1/members')`
 *     with `@Get(':x')` is the shape AD-12 was done to remove.
 *
 * ── GUARDS, AND WHY SEARCH NEEDS THE SAME CHAIN AS THE FEED ─────────────────
 * `@UseGuards(JwtAuthGuard, MemberGuard)` at CLASS level. Search is the surface
 * most likely to leak a category the member cannot see, because the natural
 * implementation searches everything and filters afterwards. It does not:
 * `SearchService` resolves visibility through the SHARED
 * `buildCategoryVisibilityWhere` and binds the surviving category ids into the
 * SQL as parameters, so the restriction happens IN THE DATABASE and `total` is
 * correct too (R1.7.2). `req.memberContext` is read here and never re-derived
 * (R7.3).
 *
 * ── PRE-1 / RISK-I ──────────────────────────────────────────────────────────
 * The one `@Query()` binds `dtoPipe(SearchQueryDto)`. It is a WHOLE-OBJECT DTO,
 * not `@Query('q') q: string` — `NAMED_PRIMITIVE_PARAM_COUNT = 6` is asserted
 * by exact equality, so a named primitive here fails the build. Without the
 * explicit binding the `@MinLength(2)` / `@MaxLength(200)` on `q` and the
 * `@Max(MAX_PAGE_SIZE)` on `pageSize` are inert, because esbuild emits no
 * `design:paramtypes` (see `libs/api/core/src/lib/common/dto-validation.pipe.ts`).
 *
 * ── READS INHERIT THE GLOBAL 100/min ────────────────────────────────────────
 * No `@Throttle` override (NFR-S9, §3.1). The expensive part of a search is
 * bounded by the DTO — `pageSize` is capped at 50 and `q` at 200 characters —
 * and `toLikePattern` escapes `%` and `_` so a member cannot turn one request
 * into a full scan of every post body with a single wildcard.
 *
 * ── NO HTML EVER LEAVES HERE (R1.7.5, PRE-4) ────────────────────────────────
 * Excerpts are PLAIN TEXT with match offsets into the returned window. No
 * `<mark>` is produced anywhere in this lib, even when a matched body itself
 * contains markup — highlighting is the client's job over text nodes, and
 * sanitisation belongs to the single frontend chokepoint.
 */
@Controller('v1/members/search')
@UseGuards(JwtAuthGuard, MemberGuard)
export class MemberSearchController {
  private readonly logger = new Logger(MemberSearchController.name);

  constructor(@Inject(SearchService) private readonly search: SearchService) {}

  @Get()
  async searchAll(
    @Req() req: Request,
    @Query(dtoPipe(SearchQueryDto)) query: SearchQueryDto,
  ): Promise<MemberSearchResults> {
    const ctx = requireMemberContext(
      req,
      MemberSearchController.name,
      this.logger,
    );
    return this.search.search(ctx, query);
  }
}
