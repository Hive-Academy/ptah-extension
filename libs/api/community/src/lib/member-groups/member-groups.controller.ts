import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
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
import { dtoPipe } from '@ptah-api/core';
import {
  MemberGroupsService,
  type GroupMembersPage,
  type MemberGroupWithCount,
} from './member-groups.service';
import {
  AssignMembersDto,
  CreateMemberGroupDto,
  ListGroupMembersQueryDto,
  UpdateMemberGroupDto,
} from './dto/member-group.dto';

/** Public list shape for a member group (member count included). */
export interface MemberGroupResponse {
  id: string;
  key: string;
  name: string;
  description: string | null;
  /**
   * This cohort's own Google Calendar master event for the weekly live session
   * (null = the cohort uses `BUILDERS_SESSION_EVENT_ID`). Exposed on list,
   * create and patch so cohorts are configurable from the admin panel rather
   * than a DB console.
   */
  sessionEventId: string | null;
  isDefault: boolean;
  memberCount: number;
  createdAt: string;
}

/**
 * MemberGroupsController — admin CRUD + assignment for member cohorts.
 *
 * Mounted at `/api/v1/admin/groups/*`. Guard chain mirrors AdminController:
 * `JwtAuthGuard` → `AdminGuard` (class-level; JWT populates `request.user`,
 * the email-allowlist guard then authorizes). Write routes add
 * `AdminThrottlerGuard` for a per-admin-email rate budget.
 *
 * Assignment has NO external fan-out. It used to drive a best-effort forum
 * group sync through an optional provisioning collaborator; TASK_2026_177 P1b
 * removed that whole integration, so `assignMany` is now the single write and
 * the `MemberGroupAssignment` row is the only source of truth. Cohort-scoped
 * visibility is resolved in-product by `CohortResolver` (R7.8).
 *
 * ⚠️ EVERY `@Body()` / `@Query()` PARAM MUST BIND `dtoPipe(TheDto)`.
 * A bare `@Body() dto: X` is SILENTLY UNVALIDATED in this server: esbuild does
 * not emit `emitDecoratorMetadata`, so Nest cannot infer the DTO type and the
 * global ValidationPipe short-circuits — every `class-validator` decorator
 * becomes inert. Before TASK_2026_169 that made
 * `POST /admin/groups {"key":"INVALID KEY WITH SPACES!!"}` return 201.
 * See `src/common/dto-validation.pipe.ts`. Structural test G7 in
 * `src/admin/admin-guards.spec.ts` fails the build if a binding is dropped.
 */
@Controller('v1/admin/groups')
@UseGuards(JwtAuthGuard, AdminGuard)
export class MemberGroupsController {
  private readonly logger = new Logger(MemberGroupsController.name);

  constructor(
    @Inject(MemberGroupsService)
    private readonly groups: MemberGroupsService,
  ) {}

  @Get()
  async list(): Promise<{ groups: MemberGroupResponse[] }> {
    const groups = await this.groups.listWithCounts();
    return { groups: groups.map((g) => this.toResponse(g)) };
  }

  /**
   * Paginated members of a group (TASK_2026_169). Read-only, so no throttle
   * override — the global 100/min default applies.
   */
  @Get(':id/members')
  async listMembers(
    @Param('id') id: string,
    @Query(dtoPipe(ListGroupMembersQueryDto)) query: ListGroupMembersQueryDto,
  ): Promise<GroupMembersPage> {
    return this.groups.listMembers(id, {
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
    });
  }

  @Post()
  @UseGuards(AdminThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @Req() req: Request,
    @Body(dtoPipe(CreateMemberGroupDto)) dto: CreateMemberGroupDto,
  ): Promise<MemberGroupResponse> {
    const actor = req.user?.email ?? null;
    this.logger.log(
      `Admin create member group: actor=${actor ?? 'unknown'} key=${dto.key}`,
    );
    const group = await this.groups.create(dto, actor);
    return this.toResponse(group);
  }

  @Patch(':id')
  @UseGuards(AdminThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(UpdateMemberGroupDto)) dto: UpdateMemberGroupDto,
  ): Promise<MemberGroupResponse> {
    const actor = req.user?.email ?? null;
    this.logger.log(
      `Admin update member group: actor=${actor ?? 'unknown'} id=${id} keys=[${Object.keys(
        dto,
      ).join(',')}]`,
    );
    const group = await this.groups.update(id, dto, actor);
    return this.toResponse(group);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async assign(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(dtoPipe(AssignMembersDto)) dto: AssignMembersDto,
  ): Promise<{ assigned: number; skipped: number }> {
    const actor = req.user?.email ?? null;
    const result = await this.groups.assignMany(id, dto, actor);
    this.logger.log(
      `Admin assign member group: actor=${actor ?? 'unknown'} id=${id} assigned=${result.assigned} skipped=${result.skipped}`,
    );

    return { assigned: result.assigned, skipped: result.skipped };
  }

  @Delete(':id/members/:userId')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async unassign(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<{ removed: boolean }> {
    const actor = req.user?.email ?? null;
    this.logger.log(
      `Admin unassign member group: actor=${actor ?? 'unknown'} id=${id} userId=${userId}`,
    );
    return this.groups.unassign(id, userId, actor);
  }

  private toResponse(group: MemberGroupWithCount): MemberGroupResponse {
    return {
      id: group.id,
      key: group.key,
      name: group.name,
      description: group.description,
      sessionEventId: group.sessionEventId,
      isDefault: group.isDefault,
      memberCount: group.memberCount,
      createdAt: group.createdAt.toISOString(),
    };
  }
}
