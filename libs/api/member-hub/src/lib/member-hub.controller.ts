import {
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '@ptah-api/identity';
// Value import for the guard; the type import beside it is ALSO what loads the
// `Express.Request.memberContext` global augmentation, without which
// `req.memberContext` does not typecheck here.
import { MemberGuard, type MemberContext } from '@ptah-api/membership';
import type { MemberHubResponse } from '@ptah-contracts/community';
import { MemberHubService } from './member-hub.service';

/**
 * `GET /api/v1/members/hub` — the member home screen, in ONE request (R6.1,
 * R6.2, R6.5).
 *
 * ── ONE REQUEST IS THE CONTRACT, NOT AN OPTIMISATION ───────────────────────
 * The alternative — five calls from the client, one per card — is what the
 * "known backend debt" note in this task's context calls out by name
 * ("`/members/home` should be one aggregate endpoint, not five waterfall
 * calls"). R6.2 pins it as an e2e network-count assertion on `/members`,
 * written in Phase 1 and re-run UNCHANGED in every later phase. A later batch
 * that needs a second fetch for the initial render has broken this contract
 * rather than extended it.
 *
 * ── GUARD ORDER IS LOAD-BEARING ───────────────────────────────────────────
 * `@UseGuards(JwtAuthGuard, MemberGuard)` at CLASS level, in that order.
 * `JwtAuthGuard` populates `req.user` (401 without a valid `ptah_auth` cookie);
 * `MemberGuard` then resolves entitlement + cohort keys ONCE and attaches
 * `req.memberContext` (403 `{ reason: 'membership_required' }` for a logged-in
 * non-member). Nothing below re-derives either (R7.3, NFR-S8).
 *
 * ── ERRORS ARE TYPED AND SANITISED (NFR-S7) ───────────────────────────────
 * No raw dependency message reaches a client. Prisma names tables and
 * connection strings in its errors and Google returns upstream bodies; both are
 * logged server-side and replaced with a fixed sentence. The hub's own
 * per-section failures never reach here at all — `Promise.allSettled` in
 * `MemberHubService` degrades them to `status: 'unavailable'` inside a `200`.
 *
 * ── NO PAYLOAD PARAMS, BY DESIGN (PRE-1) ──────────────────────────────────
 * The hub takes no `@Body()` and no `@Query()`. If a later phase adds one it
 * MUST bind `dtoPipe(TheDto)` — esbuild emits no `design:paramtypes`, so a bare
 * `@Query() q: X` is silently unvalidated and
 * `controller-validation.spec.ts` fails the build.
 */
@Controller('v1/members/hub')
@UseGuards(JwtAuthGuard, MemberGuard)
export class MemberHubController {
  private readonly logger = new Logger(MemberHubController.name);

  constructor(
    @Inject(MemberHubService) private readonly hub: MemberHubService,
  ) {}

  @Get()
  async getHub(@Req() req: Request): Promise<MemberHubResponse> {
    const ctx: MemberContext | undefined = req.memberContext;
    if (!ctx) {
      // Unreachable while the class-level guards are declared above. It is
      // checked rather than asserted because the failure mode of removing
      // `MemberGuard` would otherwise be an UNGATED hub reading `undefined`,
      // and "the guard was removed" must fail loudly, not degrade.
      this.logger.error(
        `No memberContext on ${req.method} ${req.path} — MemberGuard is not ` +
          `applied to MemberHubController. Refusing to compose an ungated hub.`,
      );
      throw new InternalServerErrorException(
        'The member hub is not available right now. Please try again.',
      );
    }

    return this.hub.compose(ctx);
  }
}
