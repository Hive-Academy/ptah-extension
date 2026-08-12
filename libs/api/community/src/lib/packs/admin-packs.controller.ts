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
import { JwtAuthGuard } from '@ptah-api/identity';
import { AdminGuard } from '@ptah-api/identity';
import { AdminThrottlerGuard } from '@ptah-api/identity';
import { PacksService } from './packs.service';
import {
  CreatePackDto,
  ListPacksQueryDto,
  UpdatePackDto,
} from './dto/pack.dto';
import { dtoPipe } from '@ptah-api/core';
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
 * ⚠️ THIS CONTROLLER NOW HAS A MEMBER-FACING SIBLING — IN ANOTHER MODULE.
 * Phase 5 (Batch 14) added a member-facing READ of this table at
 * `GET /v1/members/packs`, filtered on `memberVisible` alone (A-1, R5.6),
 * because the forum group the link used to be posted in was deleted by
 * TASK_2026_177 P1b. It is served by `MemberPacksController`, which sits in the
 * SAME DIRECTORY and a DIFFERENT MODULE (`MemberPacksModule`).
 *
 * 🔴 CO-LOCATION IS NOT CO-REGISTRATION, AND THE DISTINCTION IS LOAD-BEARING.
 * Structural test G6 asserts that every controller in `PacksModule` is mounted
 * under `v1/admin/`. A member controller added to `PacksModule` would fail G6 —
 * which is the correct outcome, because `PacksModule` deliberately refuses to
 * be `@Global()` so that `PacksService` (the mapper of which emits `notes`)
 * cannot be injected from a member surface at all. `MemberPacksModule` provides
 * its own `MemberPacksService` and imports nothing from `PacksModule`, so G6
 * stays true exactly as this docblock predicted before the sibling existed.
 *
 * ⚠️ WHAT DID NOT CHANGE. Members still receive pack CONTENT through GitHub (a
 * collaborator invite, or the repo link handed to their cohort), never through
 * Ptah, and Ptah still provisions no GitHub access (R5.7). Only the discovery
 * and link-delivery channel moved in-product. `accessNote` exists precisely to
 * say so to the member before they follow `repoUrl` (R5.5).
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
        // A-1: passed through UNDEFAULTED. `dto.memberVisible ?? false` would
        // look identical and quietly move the authority off the column default.
        memberVisible: dto.memberVisible,
        accessNote: dto.accessNote ?? null,
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
