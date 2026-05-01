import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated-prisma-client/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/services/email.service';
import { AuditLogService } from '../audit/audit-log.service';
import {
  ADMIN_MODELS,
  AdminModelConfig,
  AdminModelKey,
} from './admin-models.config';
import { BulkEmailDto, ListQueryDto } from './admin.dto';
import { DeleteUserDto } from './dto/delete-user.dto';
import type {
  AdminBulkEmailResponse,
  AdminListResponse,
} from './admin.controller';

/**
 * Per-user relation counts included in the deletion preview & result payloads.
 * Matches the 4 `User` relations in `schema.prisma` that cascade via `onDelete`.
 * `failed_webhooks` is intentionally omitted — that table has no FK to users.
 */
export interface UserCascadedCounts {
  subscriptions: number;
  licenses: number;
  trialReminders: number;
  sessionRequests: number;
}

export interface UserDeletionPreview {
  userId: string;
  email: string;
  cascaded: UserCascadedCounts;
  hasActivePaidSubscription: boolean;
  activePaddleSubscriptionId?: string;
  isAdminSelf: boolean;
}

export interface UserDeletionResult {
  deleted: true;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    createdAt: Date;
  };
  cascaded: UserCascadedCounts;
  auditLogId: string;
}

export interface DeleteUserActor {
  email: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Subscription statuses that count as an "active paid" subscription for the
 * cascade-delete confirmation gate (§5.1). A subscription in any of these
 * states represents real money that Paddle considers live — the admin must
 * explicitly acknowledge before we delete the user row (which cascades to
 * the subscription row in our DB; Paddle's own row is unaffected).
 */
const ACTIVE_PAID_STATUSES: readonly string[] = [
  'active',
  'trialing',
  'past_due',
];

/**
 * AdminService
 *
 * Generic CRUD (list/get/update) + bulk-email layer over 6 Prisma models.
 * All user-supplied field names are validated against the per-model allowlist
 * in `admin-models.config.ts` BEFORE flowing into Prisma. Unknown fields are
 * rejected (sort) or silently dropped (PATCH body).
 *
 * SECURITY:
 *   - `cfg.prismaModel` is a hard-coded string literal union, never user-input.
 *   - `sortBy` validated against `cfg.sortableFields` → BadRequestException on miss.
 *   - `search` iterates `cfg.searchFields` (hard-coded) only.
 *   - PATCH body filtered through `cfg.editableFields` in `filterEditable()`.
 *   - ISO date strings coerced to `Date` for DateTime columns.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /**
   * List records with pagination, sort, and optional text search.
   * Uses a single `$transaction([findMany, count])` round trip.
   */
  async list(key: AdminModelKey, q: ListQueryDto): Promise<AdminListResponse> {
    const cfg = ADMIN_MODELS[key];
    const page = Number(q.page ?? 1) || 1;
    const pageSize = Number(q.pageSize ?? 25) || 25;

    // Validate sortBy against the hard-coded allowlist BEFORE touching Prisma.
    if (q.sortBy && !cfg.sortableFields.includes(q.sortBy)) {
      throw new BadRequestException(
        `sortBy '${q.sortBy}' not allowed. Allowed: ${cfg.sortableFields.join(', ')}`,
      );
    }
    const sortBy =
      q.sortBy && cfg.sortableFields.includes(q.sortBy)
        ? q.sortBy
        : cfg.defaultSortBy;

    const where = this.buildSearchWhere(cfg, q.search);

    // cfg.prismaModel is a hard-coded literal union — safe to index dynamically.
    const delegate = (
      this.prisma as unknown as Record<
        string,
        {
          findMany: (args: unknown) => Promise<unknown[]>;
          count: (args: unknown) => Promise<number>;
        }
      >
    )[cfg.prismaModel];

    const [rows, total] = await this.prisma.$transaction([
      delegate.findMany({
        where,
        orderBy: { [sortBy]: q.sortOrder ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: cfg.include,
      }) as unknown as never,
      delegate.count({ where }) as unknown as never,
    ]);

    return {
      data: rows as Record<string, unknown>[],
      total: total as unknown as number,
      page,
      pageSize,
      totalPages: Math.ceil((total as unknown as number) / pageSize),
    };
  }

  /**
   * Fetch a single record by primary id.
   * Returns `null` when not found — controller translates to 404.
   */
  async getById(
    key: AdminModelKey,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    const cfg = ADMIN_MODELS[key];
    const delegate = (
      this.prisma as unknown as Record<
        string,
        {
          findUnique: (
            args: unknown,
          ) => Promise<Record<string, unknown> | null>;
        }
      >
    )[cfg.prismaModel];
    return delegate.findUnique({
      where: { id },
      include: cfg.include,
    });
  }

  /**
   * PATCH a record.
   *
   * - Filters body through `cfg.editableFields` (drops non-editable keys).
   * - Coerces ISO date strings for `*At` / `expires*` / `scheduled*` fields.
   * - Throws BadRequestException if no editable fields were supplied.
   * - Logs the write with a correlation-friendly message.
   */
  async update(
    key: AdminModelKey,
    id: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const cfg = ADMIN_MODELS[key];
    const data = this.filterEditable(cfg, body);

    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        `No editable fields supplied. Editable: ${
          cfg.editableFields.length > 0
            ? cfg.editableFields.join(', ')
            : '(none)'
        }`,
      );
    }

    this.logger.log(
      `Admin PATCH ${key}/${id} fields=[${Object.keys(data).join(',')}]`,
    );

    const delegate = (
      this.prisma as unknown as Record<
        string,
        {
          update: (args: unknown) => Promise<Record<string, unknown>>;
        }
      >
    )[cfg.prismaModel];

    return delegate.update({
      where: { id },
      data,
      include: cfg.include,
    });
  }

  /**
   * Bulk-email N users selected by id.
   *
   * - Looks up the users' emails via a single `findMany({ where: { id: { in: [...] } } })`.
   * - Sends via `EmailService.sendCustomEmail` in parallel (`Promise.allSettled`).
   * - Aggregates `{ sent, failed: [{ userId, error }] }`.
   * - Logs subject + recipient count for audit.
   */
  async bulkEmailUsers(dto: BulkEmailDto): Promise<AdminBulkEmailResponse> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: dto.userIds } },
      select: { id: true, email: true },
    });

    this.logger.log(
      `Bulk email: subject="${dto.subject}" recipients=${users.length}`,
    );

    const results = await Promise.allSettled(
      users.map((u) =>
        this.email.sendCustomEmail({
          to: u.email,
          subject: dto.subject,
          html: dto.html,
        }),
      ),
    );

    const failed: AdminBulkEmailResponse['failed'] = [];
    let sent = 0;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        sent += 1;
      } else {
        const reason = r.reason as { message?: string } | undefined;
        failed.push({
          userId: users[i].id,
          error: reason?.message ?? String(r.reason),
        });
      }
    });

    this.logger.log(
      `Bulk email complete: sent=${sent} failed=${failed.length}`,
    );

    return { sent, failed };
  }

  /**
   * Build a case-insensitive `contains` OR clause across `cfg.searchFields`.
   * Returns `{}` (no filter) when `search` is empty/whitespace.
   */
  private buildSearchWhere(
    cfg: AdminModelConfig,
    search?: string,
  ): Record<string, unknown> {
    if (!search || search.trim().length === 0) return {};
    const term = search.trim();
    return {
      OR: cfg.searchFields.map((field) => ({
        [field]: { contains: term, mode: 'insensitive' as const },
      })),
    };
  }

  /**
   * Filter a PATCH body through the model's `editableFields` allowlist.
   * Non-editable keys are silently dropped (tolerates UI-sent extras).
   * ISO date strings for `*At` / `expires*` / `scheduled*` fields are
   * coerced to `Date` instances so Prisma accepts them as DateTime input.
   */
  private filterEditable(
    cfg: AdminModelConfig,
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const field of cfg.editableFields) {
      if (field in body) {
        data[field] = this.coerceIfDate(field, body[field]);
      }
    }
    return data;
  }

  /**
   * Convert ISO string to `Date` for known DateTime field-name patterns.
   * Preserves invalid strings so Prisma throws a clear validation error.
   */
  private coerceIfDate(field: string, value: unknown): unknown {
    if (typeof value !== 'string') return value;
    if (!/At$|^expires|^scheduled/.test(field)) return value;
    const d = new Date(value);
    return isNaN(d.getTime()) ? value : d;
  }

  // --------------------------------------------------------------------------
  // TASK_2025_292 — User cascade deletion (Batch B2)
  // --------------------------------------------------------------------------

  /**
   * Compute the impact preview for `DELETE /v1/admin/users/:id` (§5.1).
   *
   * Counts every cascaded row per the 4 User relations in
   * `schema.prisma` (subscriptions, licenses, trial_reminders, session_requests).
   * Also flags:
   *   - `hasActivePaidSubscription` — any subscription row in
   *     ('active' | 'trialing' | 'past_due'), plus the paddleSubscriptionId
   *     so the frontend can show "Paddle sub {id}" in the warning banner.
   *   - `isAdminSelf` — target email (lower-cased) matches `ADMIN_EMAILS`.
   *     Preview returns this so the UI can pre-disable the delete button;
   *     the service itself re-checks in `deleteUserCascade` to avoid a TOCTOU.
   *
   * Throws `NotFoundException` when the user id does not exist.
   */
  async getUserDeletionPreview(id: string): Promise<UserDeletionPreview> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true },
    });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    const [
      subscriptions,
      licenses,
      trialReminders,
      sessionRequests,
      activePaid,
    ] = await this.prisma.$transaction([
      this.prisma.subscription.count({ where: { userId: id } }),
      this.prisma.license.count({ where: { userId: id } }),
      this.prisma.trialReminder.count({ where: { userId: id } }),
      this.prisma.sessionRequest.count({ where: { userId: id } }),
      this.prisma.subscription.findFirst({
        where: { userId: id, status: { in: [...ACTIVE_PAID_STATUSES] } },
        select: { paddleSubscriptionId: true },
      }),
    ]);

    return {
      userId: user.id,
      email: user.email,
      cascaded: { subscriptions, licenses, trialReminders, sessionRequests },
      hasActivePaidSubscription: activePaid !== null,
      activePaddleSubscriptionId: activePaid?.paddleSubscriptionId,
      isAdminSelf: this.isAdminEmail(user.email),
    };
  }

  /**
   * Execute the user cascade delete inside a single Prisma interactive
   * transaction (§6.2). Steps:
   *
   *   1. Load the user row (404 if missing).
   *   2. Refuse if target email is on the ADMIN_EMAILS allowlist
   *      (`CANNOT_DELETE_ADMIN`).
   *   3. Verify typed `body.confirmEmail` matches user.email (case-insensitive).
   *   4. Check for active paid subscription; require `acknowledgePaidSubscription`
   *      override to proceed when present.
   *   5. Snapshot counts + the user row for the audit payload.
   *   6. Write an `admin_audit_log` row via `auditLog.write({..., tx})` —
   *      atomic with the delete (R8).
   *   7. `tx.user.delete(...)` — schema `onDelete: Cascade` handles children.
   *
   * Concurrent-delete race: if the row disappears between step 1 and step 7,
   * Prisma throws `P2025`. We catch and rethrow as `NotFoundException` so the
   * admin sees 404 instead of a bare 500.
   *
   * Privacy: user email is persisted to `targetSnapshot` (needed for audit
   * reconstruction) but NEVER logged via `Logger`. Structured log keeps only
   * the actor email + target id.
   */
  async deleteUserCascade(
    id: string,
    body: DeleteUserDto,
    actor: DeleteUserActor,
  ): Promise<UserDeletionResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id } });
        if (!user) {
          throw new NotFoundException(`User ${id} not found`);
        }

        // (2) Admin self-delete guard — case-insensitive compare.
        if (this.isAdminEmail(user.email)) {
          throw new ForbiddenException({
            code: 'CANNOT_DELETE_ADMIN',
            message: 'Admins cannot delete another admin account',
          });
        }

        // (3) Typed-email confirmation.
        if (
          body.confirmEmail.trim().toLowerCase() !==
          user.email.trim().toLowerCase()
        ) {
          throw new BadRequestException({
            code: 'CONFIRM_EMAIL_MISMATCH',
            message: 'confirmEmail does not match target user email',
          });
        }

        // (4) Active paid subscription gate.
        const activePaid = await tx.subscription.findFirst({
          where: {
            userId: id,
            status: { in: [...ACTIVE_PAID_STATUSES] },
          },
          select: { paddleSubscriptionId: true },
        });
        if (activePaid && body.acknowledgePaidSubscription !== true) {
          throw new ConflictException({
            code: 'ACTIVE_PAID_SUBSCRIPTION',
            paddleSubscriptionId: activePaid.paddleSubscriptionId,
            message:
              'User has an active paid Paddle subscription. Re-submit with acknowledgePaidSubscription: true to force-delete.',
          });
        }

        // (5) Snapshot counts + user row for the audit payload.
        const [subscriptions, licenses, trialReminders, sessionRequests] =
          await Promise.all([
            tx.subscription.count({ where: { userId: id } }),
            tx.license.count({ where: { userId: id } }),
            tx.trialReminder.count({ where: { userId: id } }),
            tx.sessionRequest.count({ where: { userId: id } }),
          ]);

        const cascadedCounts: UserCascadedCounts = {
          subscriptions,
          licenses,
          trialReminders,
          sessionRequests,
        };

        const snapshot = {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          workosId: user.workosId,
          paddleCustomerId: user.paddleCustomerId,
          emailVerified: user.emailVerified,
          marketingOptIn: user.marketingOptIn,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        };

        // (6) Audit log — in-transaction so it rolls back on failure.
        const auditLogId = await this.auditLog.write({
          actorEmail: actor.email,
          action: 'user.delete',
          targetType: 'User',
          targetId: id,
          targetSnapshot: snapshot,
          metadata: {
            cascadedCounts,
            acknowledgedPaidSubscription:
              body.acknowledgePaidSubscription === true,
          },
          ipAddress: actor.ip,
          userAgent: actor.userAgent,
          tx,
        });

        // (7) Cascade delete — schema FKs handle the children.
        await tx.user.delete({ where: { id } });

        // Structured log — no email in cleartext beyond the audit context
        // that callers can tail via `kubectl logs | grep admin_audit_log`.
        this.logger.log({
          message: 'admin user cascade delete',
          actorEmail: actor.email,
          targetId: id,
          cascadedCounts,
          auditLogId,
        });

        return {
          deleted: true as const,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            createdAt: user.createdAt,
          },
          cascaded: cascadedCounts,
          auditLogId,
        };
      });
    } catch (err) {
      // Concurrent delete race — map Prisma's P2025 to 404 (E6).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`User ${id} not found`);
      }
      throw err;
    }
  }

  /**
   * Case-insensitive check of `email` against the comma-separated
   * `ADMIN_EMAILS` env var. Returns `false` when ADMIN_EMAILS is unset — the
   * delete route is guarded by `AdminGuard` upstream which fail-closes on
   * missing allowlist, so this service layer never runs without a list.
   */
  private isAdminEmail(email: string): boolean {
    const raw = this.config.get<string>('ADMIN_EMAILS');
    if (!raw || raw.trim().length === 0) return false;
    const allowlist = raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    return allowlist.includes(email.trim().toLowerCase());
  }
}
