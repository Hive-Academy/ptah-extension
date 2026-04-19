import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/services/email.service';
import {
  ADMIN_MODELS,
  AdminModelConfig,
  AdminModelKey,
} from './admin-models.config';
import { BulkEmailDto, ListQueryDto } from './admin.dto';
import type {
  AdminBulkEmailResponse,
  AdminListResponse,
} from './admin.controller';

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
}
