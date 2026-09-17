import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, PrismaService } from '@ptah-api/core';
import { AuditLogService } from '@ptah-api/audit';
import type { AdminActor } from '@ptah-api/licensing';

import type {
  WaitlistFilterQueryDto,
  WaitlistListQueryDto,
} from './admin-waitlist.dto';
import type {
  WaitlistDetailsAuditMetadata,
  WaitlistDetailsResponse,
  WaitlistEligibleIdsResponse,
  WaitlistListResponse,
  WaitlistListRow,
  WaitlistUserContext,
} from './admin-waitlist.types';
import {
  WAITLIST_ELIGIBLE_IDS_LIMIT,
  WAITLIST_ELIGIBLE_PREDICATE,
  WAITLIST_EXPORT_MAX_ROWS,
  WAITLIST_STAGE_PREDICATES,
  buildWaitlistOrderBy,
  buildWaitlistWhere,
  deriveWaitlistStage,
  type WaitlistFilterInput,
  type WaitlistLifecycleFacts,
} from './waitlist-query';

/**
 * The projection every list-like read selects. Exactly the fields the wire
 * row and the CSV export need — the stage derivation consumes the three
 * lifecycle stamps plus `createdAt`, and the display needs the identity.
 */
const WAITLIST_SELECT: Prisma.WaitlistSelect = {
  id: true,
  email: true,
  source: true,
  createdAt: true,
  notifiedAt: true,
  approvedAt: true,
  convertedAt: true,
};

/** A `Waitlist` row in the {@link WAITLIST_SELECT} projection. */
export interface WaitlistRecordRow extends WaitlistLifecycleFacts {
  id: string;
  email: string;
  source: string | null;
}

/**
 * CSV export result. The filename is SERVER-CONTROLLED — the client suggests
 * nothing — and the csv string is fully encoded and formula-safe before it
 * leaves the service, so the controller's only job is headers plus the body.
 */
export interface WaitlistExportResult {
  filename: string;
  csv: string;
}

/** Fixed header and column order for the export (`implementation-plan.md`). */
const CSV_HEADER =
  'id,email,source,stage,createdAt,notifiedAt,approvedAt,convertedAt';

/**
 * Spreadsheet formula prefixes (CSV injection). Leading tab/CR/SPACE are
 * included: `=1+1` hidden behind whitespace still evaluates in Excel.
 */
const CSV_FORMULA_PREFIX = /^[\t\r ]*[=+\-@]/;

/**
 * AdminWaitlistService — the admin waitlist READ surface
 * (TASK_2026_462 Batch A, Component 2).
 *
 * One service owns every waitlist-specific read the pipeline needs: the
 * paginated list with its stage-tab counts, capped eligible-id resolution,
 * the audited CSV export, and the per-entry details aggregate. Stage math,
 * filter combination and sort order come from `waitlist-query.ts` — the ONE
 * policy module — so this service never re-derives a stage or builds a
 * `where` of its own.
 *
 * ── WHY A THIRD SERVICE IN `AdminModule`, NOT MORE OF `AdminService` ────────
 * The generic `AdminService.list` is a single-filter text parser shared by
 * every admin model (`admin.dto.ts:25`, `admin.service.ts:429`); waitlist
 * needs compound stage/source/date semantics that do not generalize. This is
 * the same reasoning that put `WaitlistApprovalService` beside it
 * (`admin.module.ts:43`): mutation orchestration, generic CRUD and this read
 * surface are three concerns, and each stays in its own class.
 *
 * ── ERROR POSTURE ──────────────────────────────────────────────────────────
 * The DTO layer owns every 400 (validation). `buildWaitlistWhere` owns the one
 * range 400 (`INVALID_DATE_RANGE`) and is always called BEFORE any try block
 * here, so its `BadRequestException` propagates unchanged. This service adds
 * the 404 (`WAITLIST_NOT_FOUND`) and the 413 (`WAITLIST_EXPORT_LIMIT_EXCEEDED`)
 * at their exact decision points, and translates every unexpected Prisma or
 * audit failure into a route-specific 503 CODE. The diagnosable cause goes to
 * `logger.error` server-side; the client gets the code, never the message.
 */
@Injectable()
export class AdminWaitlistService {
  private readonly logger = new Logger(AdminWaitlistService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
  ) {}

  /**
   * One page of the pipeline plus its stage-tab counts
   * (`GET /v1/admin/waitlist`).
   *
   * The page read, the stage-filtered total and all five stage counts run in
   * ONE Prisma array `$transaction` — the same single-round-trip shape as
   * `AdminService.list` and `AdminService.getStats`. The stage counts apply
   * the request's optional filters with `stage` OMITTED, so the tabs stay
   * accurate while the admin views one stage.
   *
   * A page beyond the final page is an empty `data` array with accurate
   * metadata, never an error — the frontend canonicalizes back to the last
   * valid page after receiving it.
   */
  async list(query: WaitlistListQueryDto): Promise<WaitlistListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const filters = this.filtersOf(query);
    this.validateDateRange(filters.createdFrom, filters.createdTo);
    // Stage applies to the page and to `total` only.
    const where = buildWaitlistWhere(filters);
    const countWhere =
      !filters.stage || filters.stage === 'all'
        ? where
        : buildWaitlistWhere({ ...filters, stage: 'all' });
    const orderBy = buildWaitlistOrderBy(
      query.sortBy ?? 'createdAt',
      query.sortOrder ?? 'desc',
    );

    try {
      const [rows, total, all, newCount, invited, approved, converted] =
        await this.prisma.$transaction([
          this.prisma.waitlist.findMany({
            where,
            orderBy,
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: WAITLIST_SELECT,
          }),
          this.prisma.waitlist.count({ where }),
          this.prisma.waitlist.count({ where: countWhere }),
          this.prisma.waitlist.count({
            where: { AND: [countWhere, WAITLIST_STAGE_PREDICATES.new] },
          }),
          this.prisma.waitlist.count({
            where: { AND: [countWhere, WAITLIST_STAGE_PREDICATES.invited] },
          }),
          this.prisma.waitlist.count({
            where: { AND: [countWhere, WAITLIST_STAGE_PREDICATES.approved] },
          }),
          this.prisma.waitlist.count({
            where: { AND: [countWhere, WAITLIST_STAGE_PREDICATES.converted] },
          }),
        ]);

      return {
        data: rows.map((row) => this.toListRow(row)),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        counts: {
          all,
          // The aggregate is computed from the two disjoint counts — `pending`
          // is never a fifth predicate.
          pending: newCount + invited,
          new: newCount,
          invited,
          approved,
          converted,
        },
      };
    } catch (error: unknown) {
      throw this.unavailable(
        error,
        'WAITLIST_QUERY_UNAVAILABLE',
        'Waitlist query is temporarily unavailable',
        'list',
      );
    }
  }

  /**
   * Resolve select-matching to explicit ids, capped at
   * {@link WAITLIST_ELIGIBLE_IDS_LIMIT} (`GET /v1/admin/waitlist/eligible-ids`).
   *
   * The eligibility predicate is ANDed AFTER the filters, so a filtered tab
   * still yields only approval-eligible rows. The eligible count and the
   * id read run in ONE array `$transaction`; `truncated` discloses the cap so
   * the UI can render `50 selected of N matching`.
   *
   * ⚠️ THIS IS THE ONLY SELECT-MATCHING ROUTE. It returns ids and never
   * mutates — approving by filter is impossible by construction, because the
   * approval endpoint only ever accepts explicit ids.
   */
  async resolveEligibleIds(
    query: WaitlistFilterQueryDto,
  ): Promise<WaitlistEligibleIdsResponse> {
    const filters = this.filtersOf(query);
    // AND, not merge: both the filtered set and the eligibility set must hold.
    const where: Prisma.WaitlistWhereInput = {
      AND: [buildWaitlistWhere(filters), WAITLIST_ELIGIBLE_PREDICATE],
    };
    const orderBy = buildWaitlistOrderBy(
      query.sortBy ?? 'createdAt',
      query.sortOrder ?? 'desc',
    );

    try {
      const [eligibleMatching, rows] = await this.prisma.$transaction([
        this.prisma.waitlist.count({ where }),
        this.prisma.waitlist.findMany({
          where,
          orderBy,
          take: WAITLIST_ELIGIBLE_IDS_LIMIT,
          select: { id: true },
        }),
      ]);

      const ids = rows.map((row) => row.id);
      return {
        ids,
        selected: ids.length,
        eligibleMatching,
        limit: WAITLIST_ELIGIBLE_IDS_LIMIT,
        truncated: eligibleMatching > ids.length,
      };
    } catch (error: unknown) {
      throw this.unavailable(
        error,
        'WAITLIST_SELECTION_UNAVAILABLE',
        'Waitlist selection is temporarily unavailable',
        'eligible-ids',
      );
    }
  }

  /**
   * The audited CSV export (`GET /v1/admin/waitlist/export.csv`).
   *
   * Order of operations, and each step is load-bearing:
   *   1. count — the 50,000-row defensive cap is checked BEFORE any data
   *      retrieval, so an over-broad request costs one count, not a scan;
   *   2. findMany — the SAME filters and order as the list, plus the id
   *      tie-breaker, with `take` at the cap so a growing dataset between the
   *      count and the read can still not exceed it;
   *   3. encode — quoting, quote-doubling and formula neutralization happen
   *      before anything is sent;
   *   4. audit — written and AWAITED before the bytes leave the server.
   *      An audit failure fails the whole request with 503
   *      `WAITLIST_EXPORT_AUDIT_FAILED` and NO csv is sent: an export that
   *      trades its audit row for a successful download is unauditable by
   *      construction.
   *
   * ⚠️ THE AUDIT METADATA RECORDS THE SHAPE OF THE EXPORT, NEVER ITS CONTENT.
   * The search string is reduced to the boolean `searchApplied` — a search
   * term can hold an arbitrary fragment of a person's address, and copying it
   * onto an audit row would persist PII the admin never meant to keep. There
   * is no `targetId`: a bulk export targets no single row.
   */
  async exportCsv(
    query: WaitlistFilterQueryDto,
    actor: AdminActor,
  ): Promise<WaitlistExportResult> {
    const filters = this.filtersOf(query);
    const where = buildWaitlistWhere(filters);
    const orderBy = buildWaitlistOrderBy(
      query.sortBy ?? 'createdAt',
      query.sortOrder ?? 'desc',
    );

    let matches: number;
    try {
      matches = await this.prisma.waitlist.count({ where });
    } catch (error: unknown) {
      throw this.unavailable(
        error,
        'WAITLIST_EXPORT_UNAVAILABLE',
        'Waitlist export is temporarily unavailable',
        'export count',
      );
    }
    if (matches > WAITLIST_EXPORT_MAX_ROWS) {
      throw new PayloadTooLargeException({
        code: 'WAITLIST_EXPORT_LIMIT_EXCEEDED',
        message: 'Narrow the filters before exporting.',
      });
    }

    let rows: WaitlistRecordRow[];
    try {
      rows = await this.prisma.waitlist.findMany({
        where,
        orderBy,
        take: WAITLIST_EXPORT_MAX_ROWS + 1,
        select: WAITLIST_SELECT,
      });
    } catch (error: unknown) {
      throw this.unavailable(
        error,
        'WAITLIST_EXPORT_UNAVAILABLE',
        'Waitlist export is temporarily unavailable',
        'export read',
      );
    }

    if (rows.length > WAITLIST_EXPORT_MAX_ROWS) {
      throw new PayloadTooLargeException({
        code: 'WAITLIST_EXPORT_LIMIT_EXCEEDED',
        message: 'Narrow the filters before exporting.',
      });
    }

    const csv = this.encodeCsv(rows);

    try {
      await this.auditLog.write({
        actorEmail: actor.email,
        action: 'waitlist.export',
        targetType: 'Waitlist',
        metadata: {
          stage: query.stage ?? 'all',
          source: query.source ?? null,
          createdFrom: query.createdFrom ?? null,
          createdTo: query.createdTo ?? null,
          sortBy: query.sortBy ?? 'createdAt',
          sortOrder: query.sortOrder ?? 'desc',
          searchApplied: Boolean(query.search?.trim()),
          exportedCount: rows.length,
        },
        ipAddress: actor.ip,
        userAgent: actor.userAgent,
      });
    } catch (error: unknown) {
      throw this.unavailable(
        error,
        'WAITLIST_EXPORT_AUDIT_FAILED',
        'Waitlist export is temporarily unavailable',
        'export audit',
      );
    }

    return {
      // Server-controlled UTC date — the client suggests nothing.
      filename: `waitlist-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
    };
  }

  /**
   * One entry plus its linked-account and audit context
   * (`GET /v1/admin/waitlist/:id/details`).
   *
   * Three reads, on demand only: the entry, one nested user query, one
   * bounded audit query. A missing entry is a safe 404; a present entry with
   * no registered user, licences, subscriptions, groups or audit rows is a
   * valid `null`/empty-array response, never an error.
   *
   * ⚠️ THE USER MATCH IS BY NORMALIZED EMAIL, NOT A STORED FOREIGN KEY — the
   * `Waitlist` row carries none. Normalization is the ingestion rule itself
   * (`trim().toLowerCase()`), and the lookup is case-insensitive so a
   * differently-cased stored address still resolves. At most one row can
   * match.
   *
   * ⚠️ THE AUDIT STREAM IS THE WAITLIST-TARGETED ONE ONLY. The
   * complimentary-licence core writes `license.complimentary.issue` with no
   * `targetId`, so its rows cannot be joined to this entry without guessing —
   * the licences above come from the user relation instead, and no false
   * email/time join is inferred.
   */
  async getDetails(id: string): Promise<WaitlistDetailsResponse> {
    let entry: WaitlistRecordRow | null;
    try {
      entry = await this.prisma.waitlist.findUnique({
        where: { id },
        select: WAITLIST_SELECT,
      });
    } catch (error: unknown) {
      throw this.unavailable(
        error,
        'WAITLIST_DETAILS_UNAVAILABLE',
        'Waitlist details are temporarily unavailable',
        'details entry',
      );
    }
    if (!entry) {
      throw new NotFoundException({
        code: 'WAITLIST_NOT_FOUND',
        message: 'Waitlist entry not found',
      });
    }

    const normalizedEmail = entry.email.trim().toLowerCase();
    try {
      // Independent reads, one round trip — the same array-transaction shape
      // as the list. Nested selects keep this to one user query, not one
      // per relation.
      const [user, auditRows] = await this.prisma.$transaction([
        this.prisma.user.findFirst({
          where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            createdAt: true,
            licenses: {
              // NEVER `licenseKey` — the member's credential stays in the DB
              // and the welcome email, nowhere else.
              select: {
                id: true,
                plan: true,
                status: true,
                source: true,
                expiresAt: true,
                createdAt: true,
                createdBy: true,
              },
            },
            subscriptions: {
              // Status and price only — no Paddle customer or subscription
              // identifiers.
              select: {
                id: true,
                status: true,
                priceId: true,
                currentPeriodEnd: true,
                trialEnd: true,
                canceledAt: true,
                createdAt: true,
                updatedAt: true,
              },
            },
            memberGroupAssignments: {
              select: {
                id: true,
                assignedAt: true,
                source: true,
                group: { select: { id: true, key: true, name: true } },
              },
            },
          },
        }),
        this.prisma.adminAuditLog.findMany({
          where: { targetType: 'Waitlist', targetId: entry.id },
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: {
            id: true,
            actorEmail: true,
            action: true,
            targetType: true,
            targetId: true,
            createdAt: true,
            metadata: true,
          },
        }),
      ]);

      return {
        entry: this.toListRow(entry),
        user: user ? this.toUserContext(user) : null,
        audit: auditRows.map((row) => ({
          id: row.id,
          actorEmail: row.actorEmail,
          action: row.action,
          targetType: 'Waitlist' as const,
          targetId: row.targetId ?? entry.id,
          createdAt: row.createdAt.toISOString(),
          metadata: projectAuditMetadata(row.metadata),
        })),
      };
    } catch (error: unknown) {
      throw this.unavailable(
        error,
        'WAITLIST_DETAILS_UNAVAILABLE',
        'Waitlist details are temporarily unavailable',
        'details context',
      );
    }
  }

  /**
   * Validate that createdFrom is not after createdTo once per request,
   * avoiding redundant checks when building page and count where clauses.
   */
  private validateDateRange(createdFrom?: string, createdTo?: string): void {
    if (createdFrom !== undefined && createdTo !== undefined) {
      const from = new Date(createdFrom).getTime();
      const to = new Date(createdTo).getTime();
      if (!Number.isNaN(from) && !Number.isNaN(to) && from > to) {
        throw new BadRequestException({
          code: 'INVALID_DATE_RANGE',
          message: 'createdFrom must be before or equal to createdTo',
        });
      }
    }
  }

  /** Extract the shared filter vocabulary from either query DTO. */
  private filtersOf(query: WaitlistFilterQueryDto): WaitlistFilterInput {
    return {
      stage: query.stage,
      search: query.search,
      source: query.source,
      createdFrom: query.createdFrom,
      createdTo: query.createdTo,
    };
  }

  /** Map a projected `Waitlist` row onto the wire shape, stage derived once. */
  private toListRow(row: WaitlistRecordRow): WaitlistListRow {
    const { stage, stageAt, approvalEligible } = deriveWaitlistStage(row);
    return {
      id: row.id,
      email: row.email,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
      notifiedAt: row.notifiedAt ? row.notifiedAt.toISOString() : null,
      approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
      convertedAt: row.convertedAt ? row.convertedAt.toISOString() : null,
      stage,
      stageAt: stageAt.toISOString(),
      approvalEligible,
    };
  }

  /** Map the nested user projection onto the wire shape, dates to ISO. */
  private toUserContext(user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    createdAt: Date;
    licenses: Array<{
      id: string;
      plan: string;
      status: string;
      source: string;
      expiresAt: Date | null;
      createdAt: Date;
      createdBy: string;
    }>;
    subscriptions: Array<{
      id: string;
      status: string;
      priceId: string;
      currentPeriodEnd: Date;
      trialEnd: Date | null;
      canceledAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
    memberGroupAssignments: Array<{
      id: string;
      assignedAt: Date;
      source: string;
      group: { id: string; key: string; name: string };
    }>;
  }): WaitlistUserContext {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      createdAt: user.createdAt.toISOString(),
      licenses: user.licenses.map((license) => ({
        id: license.id,
        plan: license.plan,
        status: license.status,
        source: license.source,
        expiresAt: license.expiresAt ? license.expiresAt.toISOString() : null,
        createdAt: license.createdAt.toISOString(),
        createdBy: license.createdBy,
      })),
      subscriptions: user.subscriptions.map((subscription) => ({
        id: subscription.id,
        status: subscription.status,
        priceId: subscription.priceId,
        currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
        trialEnd: subscription.trialEnd
          ? subscription.trialEnd.toISOString()
          : null,
        canceledAt: subscription.canceledAt
          ? subscription.canceledAt.toISOString()
          : null,
        createdAt: subscription.createdAt.toISOString(),
        updatedAt: subscription.updatedAt.toISOString(),
      })),
      groups: user.memberGroupAssignments.map((assignment) => ({
        id: assignment.group.id,
        key: assignment.group.key,
        name: assignment.group.name,
        assignedAt: assignment.assignedAt.toISOString(),
        source: assignment.source,
      })),
    };
  }

  /**
   * Encode the export: fixed header, one line per row, every scalar quoted
   * with embedded quotes doubled, nulls as empty fields, timestamps as
   * ISO-8601 UTC.
   */
  private encodeCsv(rows: readonly WaitlistRecordRow[]): string {
    const lines = [CSV_HEADER];
    for (const row of rows) {
      const { stage } = deriveWaitlistStage(row);
      lines.push(
        [
          this.csvCell(row.id),
          this.csvCell(row.email),
          this.csvCell(row.source),
          this.csvCell(stage),
          this.csvCell(row.createdAt.toISOString()),
          this.csvCell(row.notifiedAt ? row.notifiedAt.toISOString() : null),
          this.csvCell(row.approvedAt ? row.approvedAt.toISOString() : null),
          this.csvCell(row.convertedAt ? row.convertedAt.toISOString() : null),
        ].join(','),
      );
    }
    return lines.join('\n');
  }

  /**
   * Quote one CSV scalar. Formula neutralization happens BEFORE quoting — a
   * value matching {@link CSV_FORMULA_PREFIX} gains a leading `'` so
   * spreadsheet applications treat it as text.
   */
  private csvCell(value: string | null): string {
    let scalar = value ?? '';
    if (CSV_FORMULA_PREFIX.test(scalar)) {
      scalar = `'${scalar}`;
    }
    return `"${scalar.replace(/"/g, '""')}"`;
  }

  /**
   * Log the cause server-side and translate it into the route's sanitized
   * 503. The client gets `{ code, message }` — Prisma and audit error text
   * name columns, constraints and infrastructure, and none of that reaches
   * an admin browser.
   */
  private unavailable(
    error: unknown,
    code: string,
    message: string,
    context: string,
  ): ServiceUnavailableException {
    const cause = error instanceof Error ? error.message : 'Unknown error';
    this.logger.error(
      `Admin waitlist ${context} FAILED: code=${code} cause=${cause}`,
    );
    return new ServiceUnavailableException({ code, message });
  }
}

/**
 * Project stored audit metadata onto the allowlisted view, field by field.
 * Unknown keys, and known keys holding a value of the wrong type, are dropped
 * here — never forwarded to the client or cast into the response type.
 */
function projectAuditMetadata(metadata: unknown): WaitlistDetailsAuditMetadata {
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    return {};
  }
  const source = metadata as Record<string, unknown>;
  const projected: WaitlistDetailsAuditMetadata = {};

  if (typeof source['userId'] === 'string') {
    projected.userId = source['userId'];
  }
  if (typeof source['userWasCreated'] === 'boolean') {
    projected.userWasCreated = source['userWasCreated'];
  }
  if (typeof source['licenseId'] === 'string') {
    projected.licenseId = source['licenseId'];
  }
  if (typeof source['durationPreset'] === 'string') {
    projected.durationPreset = source['durationPreset'];
  }
  if (source['expiresAt'] === null || typeof source['expiresAt'] === 'string') {
    projected.expiresAt = source['expiresAt'];
  }
  if (typeof source['groupKey'] === 'string') {
    projected.groupKey = source['groupKey'];
  }
  if (typeof source['wasNotified'] === 'boolean') {
    projected.wasNotified = source['wasNotified'];
  }
  if (typeof source['cohortAlreadyAssigned'] === 'boolean') {
    projected.cohortAlreadyAssigned = source['cohortAlreadyAssigned'];
  }

  return projected;
}
