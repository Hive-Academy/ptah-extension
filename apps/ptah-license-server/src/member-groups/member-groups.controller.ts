import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  Optional,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../app/auth/guards/jwt-auth.guard';
import { AdminGuard } from '../admin/admin.guard';
import { AdminThrottlerGuard } from '../admin/admin-throttler.guard';
import { DiscourseProvisioningService } from '../discourse/discourse-provisioning.service';
import {
  MemberGroupsService,
  type MemberGroupWithCount,
} from './member-groups.service';
import {
  AssignMembersDto,
  CreateMemberGroupDto,
  UpdateMemberGroupDto,
} from './dto/member-group.dto';

/** Public list shape for a member group (member count included). */
export interface MemberGroupResponse {
  id: string;
  key: string;
  name: string;
  description: string | null;
  discourseGroup: string | null;
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
 * Discourse group sync on assign is best-effort and non-fatal: a sync failure
 * never fails the assignment (the assignment is the source of truth; Discourse
 * SSO re-asserts group membership on next login).
 */
@Controller('v1/admin/groups')
@UseGuards(JwtAuthGuard, AdminGuard)
export class MemberGroupsController {
  private readonly logger = new Logger(MemberGroupsController.name);

  constructor(
    @Inject(MemberGroupsService)
    private readonly groups: MemberGroupsService,
    // Optional: Discourse provisioning (bound by the @Global() DiscourseModule).
    // @Optional keeps the assign path resilient if the module is unregistered.
    @Optional()
    @Inject(DiscourseProvisioningService)
    private readonly discourse?: DiscourseProvisioningService,
  ) {}

  @Get()
  async list(): Promise<{ groups: MemberGroupResponse[] }> {
    const groups = await this.groups.listWithCounts();
    return { groups: groups.map((g) => this.toResponse(g)) };
  }

  @Post()
  @UseGuards(AdminThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @Req() req: Request,
    @Body() dto: CreateMemberGroupDto,
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
    @Body() dto: UpdateMemberGroupDto,
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
    @Body() dto: AssignMembersDto,
  ): Promise<{ assigned: number; skipped: number }> {
    const actor = req.user?.email ?? null;
    const result = await this.groups.assignMany(id, dto, actor);
    this.logger.log(
      `Admin assign member group: actor=${actor ?? 'unknown'} id=${id} assigned=${result.assigned} skipped=${result.skipped}`,
    );

    // Best-effort Discourse group sync for the newly-assigned users. Non-fatal:
    // the assignment already committed; a Discourse hiccup must not surface.
    if (this.discourse && result.discourseGroup && result.syncedUsers.length) {
      for (const user of result.syncedUsers) {
        try {
          await this.discourse.syncMemberGroup(
            user.userId,
            user.email,
            result.discourseGroup,
            true,
          );
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(
            `Discourse cohort sync failed for user ${user.userId} on group ${id}: ${message}`,
          );
        }
      }
    }

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
      discourseGroup: group.discourseGroup,
      isDefault: group.isDefault,
      memberCount: group.memberCount,
      createdAt: group.createdAt.toISOString(),
    };
  }
}
