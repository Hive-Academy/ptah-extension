import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated-prisma-client/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';

/**
 * A member group enriched with its current assignment count — the shape the
 * admin panel + stats surfaces consume.
 */
export interface MemberGroupWithCount {
  id: string;
  key: string;
  name: string;
  description: string | null;
  discourseGroup: string | null;
  isDefault: boolean;
  memberCount: number;
  createdAt: Date;
}

/** The compact `{ key, name }` shape surfaced to members on /me + /sessions. */
export interface UserMemberGroup {
  key: string;
  name: string;
}

export interface CreateMemberGroupInput {
  key: string;
  name: string;
  description?: string | null;
  discourseGroup?: string | null;
  isDefault?: boolean;
}

export interface UpdateMemberGroupInput {
  name?: string;
  description?: string | null;
  discourseGroup?: string | null;
  isDefault?: boolean;
}

export interface AssignManyInput {
  userIds?: string[];
  emails?: string[];
}

/**
 * Result of an admin bulk-assign. `assigned` counts newly-created assignments;
 * `skipped` counts users that were already in the group or could not be
 * resolved (unknown id/email). `syncedUsers` + `discourseGroup` are internal
 * hints the controller uses to drive best-effort Discourse group sync.
 */
export interface AssignManyResult {
  assigned: number;
  skipped: number;
  syncedUsers: Array<{ userId: string; email: string }>;
  discourseGroup: string | null;
}

/** Assignment `source` values — how a user came to be in a group. */
export type MemberGroupAssignmentSource =
  | 'auto_provisioning'
  | 'admin'
  | 'migration';

/**
 * MemberGroupsService — owns member-cohort (group) CRUD + user assignment.
 *
 * Design invariants:
 *   - Exactly one group is the default at a time. Creating/updating a group
 *     with `isDefault: true` atomically clears the previous default inside a
 *     transaction.
 *   - Assignments are idempotent (unique on `[userId, groupId]`). Re-assigning
 *     an already-member is a no-op counted as `skipped`.
 *   - `assignDefaultGroup` is the fan-out entry point (called from the Paddle
 *     Builders provisioning path); it upserts and never audits (system action).
 *   - Admin mutations (create/update/assign/unassign) write an AdminAuditLog
 *     row (`group.*` actions).
 *
 * This service NEVER touches Discourse — that dependency is inverted so
 * `DiscourseProvisioningService` (and the admin controller) depend on this
 * service, not the reverse, keeping the module graph acyclic.
 */
@Injectable()
export class MemberGroupsService {
  private readonly logger = new Logger(MemberGroupsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  /** List every group with its current member count (default first). */
  async listWithCounts(): Promise<MemberGroupWithCount[]> {
    const groups = await this.prisma.memberGroup.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: { _count: { select: { assignments: true } } },
    });
    return groups.map((g) => this.toWithCount(g, g._count.assignments));
  }

  /** The current default group, or null when none is flagged. */
  async getDefaultGroup(): Promise<{
    id: string;
    key: string;
    name: string;
    discourseGroup: string | null;
  } | null> {
    const group = await this.prisma.memberGroup.findFirst({
      where: { isDefault: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, key: true, name: true, discourseGroup: true },
    });
    return group ?? null;
  }

  /**
   * The `{ key, name }` groups a user belongs to (assignment order). Returns an
   * empty array for an unassigned/unknown user.
   */
  async getGroupsForUser(userId: string): Promise<UserMemberGroup[]> {
    const rows = await this.prisma.memberGroupAssignment.findMany({
      where: { userId },
      orderBy: { assignedAt: 'asc' },
      include: { group: { select: { key: true, name: true } } },
    });
    return rows.map((r) => ({ key: r.group.key, name: r.group.name }));
  }

  /**
   * The non-null Discourse group names a user's groups map to — used by the
   * Discourse provisioning extension to assert cohort forum access.
   */
  async getDiscourseGroupsForUser(userId: string): Promise<string[]> {
    const rows = await this.prisma.memberGroupAssignment.findMany({
      where: { userId, group: { discourseGroup: { not: null } } },
      include: { group: { select: { discourseGroup: true } } },
    });
    return rows
      .map((r) => r.group.discourseGroup)
      .filter(
        (name): name is string => typeof name === 'string' && name !== '',
      );
  }

  /**
   * Idempotently assign a user to the current default group with source
   * `auto_provisioning`. No-op when there is no default group or the user is
   * already assigned. Called from the Builders provisioning fan-out — never
   * audits (system action, not an admin one).
   */
  async assignDefaultGroup(userId: string): Promise<void> {
    const def = await this.getDefaultGroup();
    if (!def) {
      this.logger.debug(
        `No default member group configured — skipping auto-assign for user ${userId}`,
      );
      return;
    }
    await this.prisma.memberGroupAssignment.upsert({
      where: { userId_groupId: { userId, groupId: def.id } },
      create: { userId, groupId: def.id, source: 'auto_provisioning' },
      update: {},
    });
    this.logger.log(
      `Ensured default group '${def.key}' assignment for user ${userId}`,
    );
  }

  /**
   * Create a group. When `isDefault` is true the previous default is cleared
   * atomically in the same transaction. Throws 409 on duplicate key.
   */
  async create(
    input: CreateMemberGroupInput,
    actorEmail: string | null,
  ): Promise<MemberGroupWithCount> {
    try {
      const group = await this.prisma.$transaction(async (tx) => {
        if (input.isDefault) {
          await tx.memberGroup.updateMany({
            where: { isDefault: true },
            data: { isDefault: false },
          });
        }
        return tx.memberGroup.create({
          data: {
            key: input.key,
            name: input.name,
            description: input.description ?? null,
            discourseGroup: input.discourseGroup ?? null,
            isDefault: input.isDefault ?? false,
          },
        });
      });

      await this.safeAudit(actorEmail, 'group.create', group.id, {
        key: group.key,
        name: group.name,
        isDefault: group.isDefault,
        discourseGroup: group.discourseGroup,
      });

      return this.toWithCount(group, 0);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `A member group with key '${input.key}' already exists`,
        );
      }
      throw error;
    }
  }

  /**
   * Patch a group's mutable fields. Passing `isDefault: true` atomically
   * demotes the previous default. Only supplied keys are written; passing
   * `null` for description/discourseGroup clears them.
   */
  async update(
    id: string,
    input: UpdateMemberGroupInput,
    actorEmail: string | null,
  ): Promise<MemberGroupWithCount> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.memberGroup.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException(`Member group ${id} not found`);
      }
      if (input.isDefault === true) {
        await tx.memberGroup.updateMany({
          where: { isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }
      const data: Prisma.MemberGroupUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.description !== undefined) data.description = input.description;
      if (input.discourseGroup !== undefined) {
        data.discourseGroup = input.discourseGroup;
      }
      if (input.isDefault !== undefined) data.isDefault = input.isDefault;

      const group = await tx.memberGroup.update({
        where: { id },
        data,
        include: { _count: { select: { assignments: true } } },
      });
      return group;
    });

    await this.safeAudit(actorEmail, 'group.update', updated.id, {
      key: updated.key,
      fields: Object.keys(input),
      isDefault: updated.isDefault,
    });

    return this.toWithCount(updated, updated._count.assignments);
  }

  /**
   * Bulk-assign users (by id and/or email) to a group with source `admin`.
   * Idempotent per user (already-member → skipped). Unknown ids/emails are
   * skipped. Returns per-run tallies plus the newly-synced users so the caller
   * can drive best-effort Discourse group sync.
   */
  async assignMany(
    groupId: string,
    input: AssignManyInput,
    actorEmail: string | null,
    source: MemberGroupAssignmentSource = 'admin',
  ): Promise<AssignManyResult> {
    const group = await this.prisma.memberGroup.findUnique({
      where: { id: groupId },
      select: { id: true, key: true, discourseGroup: true },
    });
    if (!group) {
      throw new NotFoundException(`Member group ${groupId} not found`);
    }

    const { users, unresolved } = await this.resolveUsers(input);
    let assigned = 0;
    let skipped = unresolved;
    const syncedUsers: Array<{ userId: string; email: string }> = [];

    for (const user of users) {
      const existing = await this.prisma.memberGroupAssignment.findUnique({
        where: { userId_groupId: { userId: user.id, groupId } },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      try {
        await this.prisma.memberGroupAssignment.create({
          data: { userId: user.id, groupId, source },
        });
      } catch (error: unknown) {
        // Concurrent assign for the same user+group loses the race on the
        // [userId, groupId] unique — count it as skipped, not a 500.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          skipped += 1;
          continue;
        }
        throw error;
      }
      assigned += 1;
      syncedUsers.push({ userId: user.id, email: user.email });
    }

    await this.safeAudit(actorEmail, 'group.assign', groupId, {
      key: group.key,
      assigned,
      skipped,
      requestedUserIds: input.userIds ?? null,
      requestedEmails: input.emails ?? null,
      source,
    });

    return {
      assigned,
      skipped,
      syncedUsers,
      discourseGroup: group.discourseGroup,
    };
  }

  /**
   * Remove a user from a group. Idempotent — a missing assignment is a no-op
   * (returns `{ removed: false }`). Audited as `group.unassign` when a row was
   * actually deleted.
   */
  async unassign(
    groupId: string,
    userId: string,
    actorEmail: string | null,
  ): Promise<{ removed: boolean }> {
    const result = await this.prisma.memberGroupAssignment.deleteMany({
      where: { groupId, userId },
    });
    const removed = result.count > 0;
    if (removed) {
      await this.safeAudit(actorEmail, 'group.unassign', groupId, { userId });
    }
    return { removed };
  }

  /**
   * Resolve `{ userIds, emails }` to distinct existing users. Ids/emails that
   * do not map to a user are counted as `unresolved` (skipped). Emails are
   * matched case-insensitively (stored lowercased).
   */
  private async resolveUsers(input: AssignManyInput): Promise<{
    users: Array<{ id: string; email: string }>;
    unresolved: number;
  }> {
    const requestedIds = [...new Set(input.userIds ?? [])];
    const requestedEmails = [
      ...new Set((input.emails ?? []).map((e) => e.trim().toLowerCase())),
    ];

    const byId = requestedIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: requestedIds } },
          select: { id: true, email: true },
        })
      : [];
    const byEmail = requestedEmails.length
      ? await this.prisma.user.findMany({
          where: { email: { in: requestedEmails } },
          select: { id: true, email: true },
        })
      : [];

    const dedup = new Map<string, { id: string; email: string }>();
    for (const u of [...byId, ...byEmail]) {
      dedup.set(u.id, u);
    }

    const foundIds = new Set(byId.map((u) => u.id));
    const foundEmails = new Set(byEmail.map((u) => u.email.toLowerCase()));
    const missingIds = requestedIds.filter((id) => !foundIds.has(id)).length;
    const missingEmails = requestedEmails.filter(
      (e) => !foundEmails.has(e),
    ).length;

    return {
      users: [...dedup.values()],
      unresolved: missingIds + missingEmails,
    };
  }

  private toWithCount(
    group: {
      id: string;
      key: string;
      name: string;
      description: string | null;
      discourseGroup: string | null;
      isDefault: boolean;
      createdAt: Date;
    },
    memberCount: number,
  ): MemberGroupWithCount {
    return {
      id: group.id,
      key: group.key,
      name: group.name,
      description: group.description,
      discourseGroup: group.discourseGroup,
      isDefault: group.isDefault,
      memberCount,
      createdAt: group.createdAt,
    };
  }

  /**
   * Best-effort AdminAuditLog write. An audit failure must never fail the
   * originating admin mutation — it is logged and swallowed.
   */
  private async safeAudit(
    actorEmail: string | null,
    action: 'group.create' | 'group.update' | 'group.assign' | 'group.unassign',
    targetId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.write({
        actorEmail,
        action,
        targetType: 'MemberGroup',
        targetId,
        metadata,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Failed to write ${action} audit log for group ${targetId}: ${message}`,
      );
    }
  }
}
