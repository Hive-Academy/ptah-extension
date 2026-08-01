import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../app/auth/guards/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminThrottlerGuard } from './admin-throttler.guard';
import {
  AdminService,
  UserDeletionPreview,
  UserDeletionResult,
} from './admin.service';
import { BulkEmailDto } from './admin.dto';
import { DeleteUserDto } from './dto/delete-user.dto';

/**
 * Bulk-email response returned by POST /users/bulk-email.
 */
export interface AdminBulkEmailResponse {
  sent: number;
  failed: Array<{ userId: string; error: string }>;
}

/**
 * AdminUsersController — USER-SPECIFIC administration (TASK_2026_170 R2).
 *
 * Mounted at `/api/v1/admin/users/*` — paths UNCHANGED by the R2 split; only
 * the owning class changed. Guard chain: `JwtAuthGuard` → `AdminGuard` at CLASS
 * level (order matters — JWT populates `request.user`, which the email
 * allowlist guard then consults).
 *
 * Routes:
 *   POST   /bulk-email             - Bulk marketing email to N users
 *   GET    /:id/deletion-preview   - Cascade-delete impact preview
 *   DELETE /:id                    - GDPR / admin-tool hard delete
 *
 * ⚠️ THIS CONTROLLER HAS NO ROOT `@Get()`, AND THAT IS LOAD-BEARING.
 * `GET /api/v1/admin/users` used to resolve — but only because it fell through
 * to `AdminController`'s `@Get(':model')` wildcard, i.e. it was the GENERIC
 * table view, not a route this resource ever declared. That wildcard now lives
 * at `v1/admin/records/:model`, so the generic user list is
 * `GET /api/v1/admin/records/users`. `apps/ptah-landing-page/src/app/guards/
 * admin-auth.guard.ts` probes exactly that path to gate the whole dashboard;
 * if you ever "restore" a root `@Get()` here it must be a deliberate new
 * endpoint, not a compatibility alias.
 *
 * ⚠️ ROUTE ORDERING IS NO LONGER A HAZARD HERE. `POST /bulk-email` and
 * `GET /:id/deletion-preview` used to sit above the `:model/:id` wildcard by
 * hand-maintained convention. The wildcard is gone from this prefix; the
 * remaining routes are not unifiable with each other (different verbs, or
 * different segment counts), which `src/common/route-map.spec.ts` asserts
 * mechanically (RI-3).
 *
 * ⚠️ VALIDATION DEBT: `@Body()` on `bulkEmailUsers` and `deleteUser` is still
 * bare. Binding is TASK_2026_170 B7b; tracked by
 * `src/common/controller-validation.spec.ts`'s `UNVALIDATED_DEBT` ledger.
 */
@Controller('v1/admin/users')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminUsersController {
  private readonly logger = new Logger(AdminUsersController.name);

  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Post('bulk-email')
  @HttpCode(200)
  async bulkEmailUsers(
    @Req() req: Request,
    @Body() dto: BulkEmailDto,
  ): Promise<AdminBulkEmailResponse> {
    const actor = req.user?.email ?? 'unknown';
    this.logger.log(
      `Admin bulk-email: actor=${actor} subject="${dto.subject}" userIds=${dto.userIds.length}`,
    );
    return this.admin.bulkEmailUsers(dto);
  }

  /**
   * GET /users/:id/deletion-preview — impact preview for the cascade-delete UI
   * (TASK_2025_292 §5.1).
   */
  @Get(':id/deletion-preview')
  async userDeletionPreview(
    @Param('id') id: string,
  ): Promise<UserDeletionPreview> {
    return this.admin.getUserDeletionPreview(id);
  }

  /**
   * DELETE /users/:id — GDPR / admin-tool user hard-delete with typed-email
   * confirmation (TASK_2025_292 §5.1).
   *
   * Guard chain: `JwtAuthGuard` → `AdminGuard` → `AdminThrottlerGuard`
   * (class-level provides the first two; route-level adds throttler so the
   * `@Throttle` budget below is enforced per-admin-email).
   *
   * Throttle: 5 / minute per admin — a hard upper bound; the UI already
   * requires typed confirmation so normal usage is ≤1/request.
   */
  @Delete(':id')
  @UseGuards(AdminThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async deleteUser(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: DeleteUserDto,
  ): Promise<UserDeletionResult> {
    const actorEmail = req.user?.email ?? 'unknown';
    const userAgent = req.headers['user-agent'];
    this.logger.log(
      `Admin DELETE user: actor=${actorEmail} targetId=${id} acknowledgedPaid=${body.acknowledgePaidSubscription === true}`,
    );
    return this.admin.deleteUserCascade(id, body, {
      email: actorEmail,
      ip: req.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    });
  }
}
