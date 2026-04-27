import { Injectable, Logger, Inject } from '@nestjs/common';
import { Prisma } from '../generated-prisma-client/client';
import { PrismaService } from '../prisma/prisma.service';
import type { WriteAuditLogParams } from './audit-log.types';

/**
 * AuditLogService — global cross-cutting writer for the `admin_audit_log` table
 * (TASK_2025_292 §6.1).
 *
 * Consumers: AdminService (user cascade delete), LicenseService
 * (complimentary license issuance), MarketingService (campaign send,
 * unsubscribe/bounce/complaint webhooks). Any future destructive admin
 * action should also record here.
 *
 * Transaction semantics (R8): callers that already opened an interactive
 * transaction via `prisma.$transaction(async tx => …)` pass `tx` so the
 * audit row commits atomically with their mutation. When omitted, the
 * service uses the singleton `PrismaService` client.
 *
 * Privacy: `targetSnapshot` may contain PII (e.g. user email, license key
 * prefix) — it is persisted to the DB but NEVER logged via Logger. Only
 * `actorEmail`, `action`, and `targetType`/`targetId` appear in structured
 * logs so the audit trail is reconstructable without leaking secrets.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Persist one audit row. Returns the created row's id.
   *
   * Optional fields (`targetId`, `targetSnapshot`, `metadata`, `ipAddress`,
   * `userAgent`) are omitted from the Prisma `create` payload when
   * `null`/`undefined` so the column keeps its schema default and Prisma's
   * generated input types don't reject them.
   */
  async write(params: WriteAuditLogParams): Promise<string> {
    const {
      actorEmail,
      action,
      targetType,
      targetId,
      targetSnapshot,
      metadata,
      ipAddress,
      userAgent,
      tx,
    } = params;

    const data: Record<string, unknown> = {
      actorEmail,
      action,
      targetType,
    };

    if (targetId !== undefined && targetId !== null) {
      data['targetId'] = targetId;
    }
    if (targetSnapshot !== undefined && targetSnapshot !== null) {
      data['targetSnapshot'] = targetSnapshot;
    }
    if (metadata !== undefined && metadata !== null) {
      data['metadata'] = metadata;
    }
    if (ipAddress !== undefined && ipAddress !== null) {
      data['ipAddress'] = ipAddress;
    }
    if (userAgent !== undefined && userAgent !== null) {
      data['userAgent'] = userAgent;
    }

    // Both `tx` and `PrismaService` expose the same `adminAuditLog.create`
    // from the generated client. `Prisma.TransactionClient` is
    // `Omit<PrismaClient, ITXClientDenyList>` — structurally compatible
    // with the full client, so the narrow type is safe for either branch.
    const client: Prisma.TransactionClient = tx ?? this.prisma;
    const created = await client.adminAuditLog.create({
      data: data as Prisma.AdminAuditLogUncheckedCreateInput,
      select: { id: true },
    });

    // Structured log — deliberately omits targetSnapshot/metadata which may
    // contain PII. Enough breadcrumbs to reconstruct the audit trail from
    // the DB if needed.
    this.logger.log({
      message: 'admin audit log recorded',
      auditLogId: created.id,
      actorEmail: actorEmail ?? 'system',
      action,
      targetType,
      targetId: targetId ?? null,
      transactional: tx !== undefined,
    });

    return created.id;
  }
}
