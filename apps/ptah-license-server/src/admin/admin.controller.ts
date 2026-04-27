import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  MethodNotAllowedException,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
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
import { BulkEmailDto, ListQueryDto, UpdateRecordDto } from './admin.dto';
import { DeleteUserDto } from './dto/delete-user.dto';
import { ADMIN_MODELS, AdminModelKey } from './admin-models.config';
import { LicenseService } from '../license/services/license.service';
import type { ComplimentaryLicenseResult } from '../license/services/license.service';
import { IssueComplimentaryLicenseDto } from '../license/dto/issue-complimentary-license.dto';

/**
 * Paginated list response shape returned by GET /:model.
 */
export interface AdminListResponse<T = Record<string, unknown>> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Bulk-email response returned by POST /users/bulk-email.
 */
export interface AdminBulkEmailResponse {
  sent: number;
  failed: Array<{ userId: string; error: string }>;
}

/**
 * AdminController — native admin dashboard REST API.
 *
 * Mounted at `/api/v1/admin/*` (global prefix `api` + controller prefix `v1/admin`).
 * Guard chain: `JwtAuthGuard` → `AdminGuard` (order matters — JWT populates
 * `request.user` which the email allowlist guard then consults).
 *
 * Routes:
 *   POST   /users/bulk-email    - Bulk marketing email to N users (users-only)
 *   GET    /:model              - List + paginate + sort + search any model
 *   GET    /:model/:id          - Show one record
 *   PATCH  /:model/:id          - Update editable fields (405 if model is read-only)
 *
 * The `users/bulk-email` route MUST be declared before `:model/:id` so Nest
 * doesn't match the literal `users/bulk-email` against the `:model/:id`
 * placeholder route.
 */
@Controller('v1/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(LicenseService) private readonly licenseService: LicenseService,
  ) {}

  @Post('users/bulk-email')
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
   * (TASK_2025_292 §5.1). MUST precede the `:model/:id` wildcard route below,
   * otherwise Nest matches `users/:id/deletion-preview` against the 2-segment
   * wildcard and a literal `deletion-preview` becomes the `:id` param.
   */
  @Get('users/:id/deletion-preview')
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
   *
   * Route ordering: MUST be declared BEFORE the `:model/:id` PATCH wildcard
   * so Nest picks this literal DELETE over the generic write path.
   */
  @Delete('users/:id')
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

  /**
   * POST /licenses/complimentary — issue an admin-gifted complimentary license
   * (TASK_2025_292 §5.1, §6.3).
   *
   * Guard chain: `JwtAuthGuard` → `AdminGuard` (class-level) → `AdminThrottlerGuard`
   * (per-admin-email bucket). Throttle: 20/minute — high enough for a migration
   * batch but still a hard upper bound.
   *
   * Route ordering: MUST precede the `:model` / `:model/:id` wildcards below so
   * Nest picks this literal `licenses/complimentary` match over the generic
   * `GET /:model` path (even with different verbs, keeping the literal-first
   * convention prevents future surprises).
   */
  @Post('licenses/complimentary')
  @UseGuards(AdminThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async issueComplimentaryLicense(
    @Req() req: Request,
    @Body() body: IssueComplimentaryLicenseDto,
  ): Promise<ComplimentaryLicenseResult> {
    const actorEmail = req.user?.email ?? 'unknown';
    const userAgent = req.headers['user-agent'];
    this.logger.log(
      `Admin POST complimentary-license: actor=${actorEmail} targetUserId=${body.userId} preset=${body.durationPreset} stack=${body.stackOnTopOfPaid === true}`,
    );
    return this.licenseService.createComplimentaryLicense(body, {
      email: actorEmail,
      ip: req.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    });
  }

  @Get(':model')
  async list(
    @Param('model') model: string,
    @Query() q: ListQueryDto,
  ): Promise<AdminListResponse> {
    const key = this.assertModel(model);
    return this.admin.list(key, q);
  }

  @Get(':model/:id')
  async show(
    @Param('model') model: string,
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    const key = this.assertModel(model);
    const record = await this.admin.getById(key, id);
    if (!record) {
      throw new NotFoundException(`${model}/${id} not found`);
    }
    return record;
  }

  @Patch(':model/:id')
  async update(
    @Req() req: Request,
    @Param('model') model: string,
    @Param('id') id: string,
    @Body() body: UpdateRecordDto,
  ): Promise<Record<string, unknown>> {
    const key = this.assertModel(model);
    if (ADMIN_MODELS[key].readOnly) {
      throw new MethodNotAllowedException('Model is read-only');
    }
    const actor = req.user?.email ?? 'unknown';
    this.logger.log(
      `Admin PATCH: actor=${actor} model=${model} id=${id} keys=[${Object.keys(body).join(',')}]`,
    );
    return this.admin.update(key, id, body);
  }

  /**
   * Coerce a raw `:model` path param to `AdminModelKey` by checking the
   * hard-coded `ADMIN_MODELS` map. Throws 400 on unknown slug.
   */
  private assertModel(model: string): AdminModelKey {
    if (!(model in ADMIN_MODELS)) {
      throw new BadRequestException(`Unknown admin model: ${model}`);
    }
    return model as AdminModelKey;
  }
}
