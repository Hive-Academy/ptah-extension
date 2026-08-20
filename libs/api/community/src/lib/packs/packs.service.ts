import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ptah-api/core';
import { PrismaService } from '@ptah-api/core';
import { AuditLogService } from '@ptah-api/audit';
import type { AdminAuditAction } from '@ptah-api/audit';
import {
  toPackResponse,
  type CreatePackInput,
  type ListPacksQuery,
  type PackResponse,
  type UpdatePackInput,
} from './packs.types';

/** Prisma `include` shared by every read so `cohortName` is always resolvable. */
const COHORT_INCLUDE = { cohort: { select: { name: true } } } as const;

/**
 * PacksService — owns the ADMIN-ONLY Builders pack registry (TASK_2026_169).
 *
 * ⚠️ THIS SERVICE HAS NO MEMBER-FACING READ PATH, BY DESIGN — AND THAT IS A
 * CLAIM ABOUT THIS SERVICE, NOT ABOUT THE TABLE. Every method here is reachable
 * only from `AdminPacksController`, which is `AdminGuard`-gated at class level.
 *
 * The TABLE does have a member-facing read as of Phase 5: `MemberPacksService`
 * (`member-packs.service.ts`) serves `GET /v1/members/packs`, filtered on
 * `memberVisible: true` and nothing else (A-1, R5.6). The two services are
 * separate on purpose and neither delegates to the other:
 *   - They emit DIFFERENT SHAPES. This one returns `PackResponse`, which
 *     carries `notes`; that one returns `MemberPack`, which cannot (R5.2,
 *     NFR-S5). A shared read method would have to strip a field, and a mapper
 *     that strips is one added column away from leaking.
 *   - They live in DIFFERENT MODULES. `MemberPacksModule` is not `PacksModule`,
 *     so structural test G6 — every controller in `PacksModule` is mounted
 *     under `v1/admin/` — stays true unmodified.
 * Ptah still never serves pack content and never decides who may access a pack;
 * access is administered entirely on GitHub (R5.7). Delivering a link is not
 * granting access, so the member read is not a gate.
 *
 * Dependencies are therefore just the two `@Global()` services: `PrismaService`
 * and `AuditLogService`. In particular this service injects NEITHER
 * `MembershipService` NOR `MemberGroupsService` — it performs no membership or
 * cohort resolution of any kind. `MemberPacksService` injects even less: only
 * `PrismaService`, and a spec asserts it imports no cohort resolver at all.
 *
 * `cohortKey` is a bookkeeping label backed by a real FK to `MemberGroup.key`
 * so it cannot name a cohort that does not exist. It gates nothing.
 *
 * Audit semantics: unlike the best-effort `safeAudit` used by services whose
 * mutation is not a DB write, pack create/update/delete enlist the audit row in
 * the SAME `prisma.$transaction` as the mutation (via the `tx` param that
 * `WriteAuditLogParams` supports). Both are DB writes, so atomicity is free —
 * a pack mutation can never commit without its audit trail.
 */
@Injectable()
export class PacksService {
  private readonly logger = new Logger(PacksService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  /**
   * Every pack, newest first, across every cohort.
   *
   * `search` targets the FIXED columns `title` and `slug` — never a
   * caller-supplied field name — and `cohortKey` is a value filter on an
   * FK-constrained column, so an unknown cohort simply returns `[]`.
   */
  async listAll(query: ListPacksQuery): Promise<PackResponse[]> {
    const where: Prisma.PackWhereInput = {
      ...(query.cohortKey ? { cohortKey: query.cohortKey } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.pack.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: COHORT_INCLUDE,
    });
    return rows.map(toPackResponse);
  }

  /** One pack by id. Throws 404 when it does not exist. */
  async getById(id: string): Promise<PackResponse> {
    const row = await this.prisma.pack.findUnique({
      where: { id },
      include: COHORT_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException(`Pack ${id} not found`);
    }
    return toPackResponse(row);
  }

  /**
   * Create a registry row. The audit write is enlisted in the same transaction,
   * so the pack and its audit trail commit or roll back together.
   *
   * Duplicate slug → 409. Unknown `cohortKey` → 400 (FK violation).
   */
  async create(
    input: CreatePackInput,
    actor: { email: string | null; ipAddress?: string; userAgent?: string },
  ): Promise<PackResponse> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.pack.create({
          data: {
            slug: input.slug,
            title: input.title,
            description: input.description,
            repoUrl: input.repoUrl,
            notes: input.notes ?? null,
            // A-1: NOT defaulted here. Omitted, the column default (`false`)
            // decides, so a create that forgets this field yields a pack no
            // member can see. `?? false` would duplicate the authority.
            ...(input.memberVisible === undefined
              ? {}
              : { memberVisible: input.memberVisible }),
            accessNote: input.accessNote ?? null,
            tags: input.tags ?? [],
            cohortKey: input.cohortKey ?? null,
            createdBy: actor.email,
          },
          include: COHORT_INCLUDE,
        });

        await this.writeAudit(tx, 'pack.create', created.id, actor, {
          slug: created.slug,
          title: created.title,
          repoUrl: created.repoUrl,
          cohortKey: created.cohortKey,
          // R8.5: member visibility is the one field on this row whose change
          // is a PUBLISHING decision, so the audit trail records it explicitly
          // rather than leaving it to the `fields` key list.
          memberVisible: created.memberVisible,
          tags: created.tags,
        });

        return created;
      });

      this.logger.log(
        `Admin created pack: actor=${actor.email ?? 'unknown'} id=${row.id} slug=${row.slug}`,
      );
      return toPackResponse(row);
    } catch (error: unknown) {
      throw this.mapPrismaError(error, input.slug, input.cohortKey ?? null);
    }
  }

  /**
   * Patch a pack's mutable fields. Only supplied keys are written; `null` for
   * `notes` / `cohortKey` clears the stored value.
   *
   * Missing id → 404. Duplicate slug → 409. Unknown `cohortKey` → 400.
   */
  async update(
    id: string,
    input: UpdatePackInput,
    actor: { email: string | null; ipAddress?: string; userAgent?: string },
  ): Promise<PackResponse> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.pack.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!existing) {
          throw new NotFoundException(`Pack ${id} not found`);
        }

        const data: Prisma.PackUpdateInput = {};
        if (input.slug !== undefined) data.slug = input.slug;
        if (input.title !== undefined) data.title = input.title;
        if (input.description !== undefined) {
          data.description = input.description;
        }
        if (input.repoUrl !== undefined) data.repoUrl = input.repoUrl;
        if (input.notes !== undefined) data.notes = input.notes;
        if (input.memberVisible !== undefined) {
          data.memberVisible = input.memberVisible;
        }
        if (input.accessNote !== undefined) data.accessNote = input.accessNote;
        if (input.tags !== undefined) data.tags = input.tags;
        if (input.cohortKey !== undefined) {
          // Relation field: connect the label, or detach it entirely when null.
          data.cohort =
            input.cohortKey === null
              ? { disconnect: true }
              : { connect: { key: input.cohortKey } };
        }

        const updated = await tx.pack.update({
          where: { id },
          data,
          include: COHORT_INCLUDE,
        });

        await this.writeAudit(tx, 'pack.update', updated.id, actor, {
          slug: updated.slug,
          fields: this.suppliedKeys(input),
          cohortKey: updated.cohortKey,
          // R8.5, as in `create`: the resulting visibility is recorded as a
          // VALUE, not merely as a key name in `fields`. "memberVisible was
          // among the changed keys" does not tell an auditor whether a pack was
          // published or unpublished.
          memberVisible: updated.memberVisible,
        });

        return updated;
      });

      this.logger.log(
        `Admin updated pack: actor=${actor.email ?? 'unknown'} id=${id} keys=[${this.suppliedKeys(
          input,
        ).join(',')}]`,
      );
      return toPackResponse(row);
    } catch (error: unknown) {
      throw this.mapPrismaError(error, input.slug, input.cohortKey ?? null, id);
    }
  }

  /**
   * Delete a pack registry row. Throws 404 when it does not exist — a silent
   * `{ deleted: false }` would let an admin believe a stale row was removed.
   *
   * Deleting the REGISTRY ROW revokes nothing: the GitHub repository and every
   * collaborator invite on it are untouched.
   */
  async delete(
    id: string,
    actor: { email: string | null; ipAddress?: string; userAgent?: string },
  ): Promise<{ deleted: boolean }> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.pack.findUnique({
          where: { id },
          select: { id: true, slug: true, repoUrl: true, cohortKey: true },
        });
        if (!existing) {
          throw new NotFoundException(`Pack ${id} not found`);
        }

        await tx.pack.delete({ where: { id } });
        await this.writeAudit(tx, 'pack.delete', id, actor, {
          slug: existing.slug,
          repoUrl: existing.repoUrl,
          cohortKey: existing.cohortKey,
        });
      });

      this.logger.log(
        `Admin deleted pack: actor=${actor.email ?? 'unknown'} id=${id}`,
      );
      return { deleted: true };
    } catch (error: unknown) {
      throw this.mapPrismaError(error, undefined, null, id);
    }
  }

  /**
   * The keys the caller actually supplied on a patch. Under ES2022 class-field
   * semantics a `plainToInstance`-built DTO carries every declared optional
   * property as `undefined`, so a bare `Object.keys` would over-report which
   * fields an admin touched in the audit trail.
   */
  private suppliedKeys(input: UpdatePackInput): string[] {
    return Object.keys(input).filter(
      (key) => (input as Record<string, unknown>)[key] !== undefined,
    );
  }

  /** Write the audit row on the caller's transaction client. */
  private async writeAudit(
    tx: Prisma.TransactionClient,
    action: Extract<AdminAuditAction, `pack.${string}`>,
    targetId: string,
    actor: { email: string | null; ipAddress?: string; userAgent?: string },
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.write({
      actorEmail: actor.email,
      action,
      targetType: 'Pack',
      targetId,
      metadata,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      tx,
    });
  }

  /**
   * Translate a Prisma failure into a typed Nest exception. Raw Prisma messages
   * are NEVER forwarded to the client — each branch produces a fixed, sanitized
   * sentence built from values the caller already supplied.
   */
  private mapPrismaError(
    error: unknown,
    slug: string | undefined,
    cohortKey: string | null,
    id?: string,
  ): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return new ConflictException(
          slug
            ? `A pack with slug '${slug}' already exists`
            : 'A pack with that slug already exists',
        );
      }
      // P2003 = FK constraint failed; P2025 = a required connected record was
      // not found (Prisma reports an unknown `cohort.connect` target this way).
      if (error.code === 'P2003' || error.code === 'P2025') {
        if (cohortKey) {
          return new BadRequestException(
            `Unknown cohort '${cohortKey}' — create the member group first`,
          );
        }
        if (id) {
          return new NotFoundException(`Pack ${id} not found`);
        }
        return new BadRequestException('Invalid pack reference');
      }
    }
    return error instanceof Error
      ? error
      : new Error('Unknown packs persistence error');
  }
}
