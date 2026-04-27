import type { Prisma } from '../generated-prisma-client/client';

/**
 * Audit log types for cross-cutting admin action tracking (TASK_2025_292).
 *
 * The `AdminAuditAction` union enumerates every destructive or compliance-relevant
 * admin action we record in the `admin_audit_log` table. Keeping this as a const
 * union (not a Prisma enum) mirrors the Q1/Q2 decision in
 * `implementation-plan.md` §1 — strings are cheap to extend without migrations.
 */
export type AdminAuditAction =
  | 'user.delete'
  | 'user.unsubscribe'
  | 'user.resubscribe'
  | 'user.bounced'
  | 'user.complained'
  | 'license.complimentary.issue'
  | 'marketing.campaign.send';

/**
 * Target type enum — the kind of entity an audit row describes.
 * Kept as a union (not enum) for the same reasons as `AdminAuditAction`.
 */
export type AdminAuditTargetType =
  | 'User'
  | 'License'
  | 'MarketingCampaign'
  | 'Subscription';

/**
 * Input shape for `AuditLogService.write`.
 *
 * Fields map 1:1 to the `admin_audit_log` Prisma model. Nullable fields are
 * stripped by the service before calling `prisma.adminAuditLog.create` so
 * Postgres gets `NULL` (via column default) rather than a literal `null`
 * that Prisma's generated `create` input refuses.
 *
 * `tx` lets callers enlist the audit write in their own transaction (e.g. the
 * cascade-delete flow in B2). When omitted, the service uses the singleton
 * `PrismaService` client.
 */
export interface WriteAuditLogParams {
  actorEmail: string | null;
  action: AdminAuditAction;
  targetType: AdminAuditTargetType;
  targetId?: string;
  targetSnapshot?: unknown;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  /**
   * Optional interactive-transaction client supplied by callers that already
   * opened `prisma.$transaction(async tx => …)`. When provided, the audit
   * row commits/rolls back atomically with the caller's transaction.
   */
  tx?: Prisma.TransactionClient;
}
