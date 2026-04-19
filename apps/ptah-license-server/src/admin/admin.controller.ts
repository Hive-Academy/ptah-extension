import {
  BadRequestException,
  Body,
  Controller,
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
import type { Request } from 'express';
import { JwtAuthGuard } from '../app/auth/guards/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { BulkEmailDto, ListQueryDto, UpdateRecordDto } from './admin.dto';
import { ADMIN_MODELS, AdminModelKey } from './admin-models.config';

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

  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

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
