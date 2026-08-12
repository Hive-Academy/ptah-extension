import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  MethodNotAllowedException,
  NotFoundException,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '@ptah-api/identity';
import { AdminGuard } from '@ptah-api/identity';
import { dtoPipe, passthroughDtoPipe } from '@ptah-api/core';
import { AdminService } from './admin.service';
import { ListQueryDto, UpdateRecordDto } from './admin.dto';
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
 * AdminRecordsController — the GENERIC model CRUD surface of the native admin
 * dashboard (TASK_2026_170 R2).
 *
 * Mounted at `/api/v1/admin/records/*` (global prefix `api` + controller prefix
 * `v1/admin/records`). Guard chain: `JwtAuthGuard` → `AdminGuard` at CLASS
 * level (order matters — JWT populates `request.user`, which the email
 * allowlist guard then consults; never method-only, so a future handler cannot
 * land unguarded).
 *
 * Routes:
 *   GET    /:model              - List + paginate + sort + search any model
 *   GET    /:model/:id          - Show one record
 *   PATCH  /:model/:id          - Update editable fields (405 if model is read-only)
 *
 * ⚠️ WHY THE `records` SEGMENT EXISTS — this is the whole point of R2.
 * These three handlers used to sit on `@Controller('v1/admin')` as bare
 * `:model` / `:model/:id` wildcards. Ten sibling admin routes across five other
 * controllers (`packs`, `groups`, `sessions`, `community/*`, `marketing/*`)
 * matched those wildcards too, and Nest arbitrates a cross-controller tie by
 * MODULE REGISTRATION ORDER. Every one of those siblings worked only because
 * its module happened to appear above `AdminModule` in `app.module.ts`'s
 * `imports` array. Moving the wildcards under a literal segment this controller
 * owns exclusively makes the ordering irrelevant — the invariant is now
 * enforced by `src/common/route-map.spec.ts` (RI-1/RI-2/RI-3) rather than
 * requested by a comment on an array literal.
 *
 * ⚠️ `records/users` and `users` are DIFFERENT RESOURCES, deliberately.
 * `GET /records/users` is the generic table view driven by
 * `ADMIN_MODELS['users']`. `AdminUsersController` (`v1/admin/users`) is
 * user-specific administration — cascade delete with typed confirmation,
 * impact preview, bulk mail — none of which the generic CRUD can express.
 *
 * ⚠️ EVERY `@Body()` / `@Query()` PARAM MUST BIND `dtoPipe(TheDto)`.
 * A bare `@Body() dto: X` is SILENTLY UNVALIDATED in this server: esbuild does
 * not emit `emitDecoratorMetadata`, so Nest cannot infer the DTO type and the
 * global ValidationPipe short-circuits — every `class-validator` decorator
 * becomes inert. See `libs/api/core/src/lib/common/dto-validation.pipe.ts`.
 * `apps/ptah-license-server/src/common/controller-validation.spec.ts` fails the
 * build if a binding is dropped.
 *
 * 🔴 `update` IS THE ONE DELIBERATE EXCEPTION IN THIS SERVER (TASK_2026_170 F1).
 * It binds `passthroughDtoPipe(UpdateRecordDto)`, NOT `dtoPipe(...)`.
 * `UpdateRecordDto` is an index-signature class with ZERO class-validator
 * metadata, and class-validator's `whitelist()` step marks EVERY property of a
 * zero-metadata class as not-allowed — so `dtoPipe` there would 400 every
 * non-empty admin PATCH. The authoritative allowlist for that handler is
 * `AdminService.filterEditable()` against `ADMIN_MODELS[key].editableFields`.
 * Do not "fix" this to `dtoPipe`, and do not add decorators to `UpdateRecordDto`.
 */
@Controller('v1/admin/records')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminRecordsController {
  private readonly logger = new Logger(AdminRecordsController.name);

  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get(':model')
  async list(
    @Param('model') model: string,
    @Query(dtoPipe(ListQueryDto)) q: ListQueryDto,
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
    @Body(passthroughDtoPipe(UpdateRecordDto)) body: UpdateRecordDto,
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
