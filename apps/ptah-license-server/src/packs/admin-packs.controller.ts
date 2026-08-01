import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
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
import { AdminGuard } from '../admin/admin.guard';
import { AdminThrottlerGuard } from '../admin/admin-throttler.guard';
import { PacksService } from './packs.service';
import {
  CreatePackDto,
  ListPacksQueryDto,
  UpdatePackDto,
} from './dto/pack.dto';
import { dtoPipe } from '../common/dto-validation.pipe';
import type { PackResponse } from './packs.types';

/**
 * AdminPacksController — admin CRUD for the Builders pack registry
 * (TASK_2026_169).
 *
 * Mounted at `/api/v1/admin/packs/*`. Guard chain mirrors
 * `MemberGroupsController`: `JwtAuthGuard` → `AdminGuard` declared at CLASS
 * level (never method-only, so a future handler cannot land unguarded — leak
 * risk L1, asserted by structural test G1). Write routes add
 * `AdminThrottlerGuard` for a per-admin-email rate budget.
 *
 * ⚠️ THIS MODULE HAS NO MEMBER-FACING SIBLING, AND MUST NOT GAIN ONE.
 * Unlike `google-sessions/` and `discourse/` — where an admin controller sits
 * beside a Builders-gated member controller — packs are an admin-only registry.
 * Members receive packs through GitHub (a collaborator invite, or the repo link
 * posted inside their cohort's Discourse group), never through Ptah. Structural
 * test G6 asserts every controller in `PacksModule` is mounted under
 * `v1/admin/`.
 *
 * ⚠️ ROUTING: `PacksModule` MUST be registered in `app.module.ts` BEFORE
 * `AdminModule`. `AdminController` is `@Controller('v1/admin')` with `@Get(':model')`
 * wildcards; registered in the wrong order, `GET /api/v1/admin/packs` falls
 * through to it and 400s with "Unknown admin model: packs".
 */
@Controller('v1/admin/packs')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminPacksController {
  constructor(@Inject(PacksService) private readonly packs: PacksService) {}

  /** Every pack, all cohorts, newest first. */
  @Get()
  async list(
    @Query(dtoPipe(ListPacksQueryDto)) query: ListPacksQueryDto,
  ): Promise<{ packs: PackResponse[] }> {
    const packs = await this.packs.listAll({
      search: query.search,
      cohortKey: query.cohortKey,
    });
    return { packs };
  }

  /** One pack by id (404 when missing). */
  @Get(':id')
  async get(@Param('id') id: string): Promise<PackResponse> {
    return this.packs.getById(id);
  }

  @Post()
  @UseGuards(AdminThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @Req() req: Request,
    @Body(dtoPipe(CreatePackDto)) dto: CreatePackDto,
  ): Promise<PackResponse> {
    return this.packs.create(
      {
        slug: dto.slug,
        title: dto.title,
        description: dto.description,
        repoUrl: dto.repoUrl,
        notes: dto.notes ?? null,
        tags: dto.tags ?? [],
        cohortKey: dto.cohortKey ?? null,
      },
      this.actor(req),
    );
  }

  @Patch(':id')
  @UseGuards(AdminThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(UpdatePackDto)) dto: UpdatePackDto,
  ): Promise<PackResponse> {
    return this.packs.update(id, dto, this.actor(req));
  }

  @Delete(':id')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async remove(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ deleted: boolean }> {
    return this.packs.delete(id, this.actor(req));
  }

  /**
   * Audit actor context for a mutation. `req.user` is guaranteed populated by
   * `JwtAuthGuard` + `AdminGuard`; the `?? null` is defensive typing only.
   */
  private actor(req: Request): {
    email: string | null;
    ipAddress?: string;
    userAgent?: string;
  } {
    return {
      email: req.user?.email ?? null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    };
  }
}
