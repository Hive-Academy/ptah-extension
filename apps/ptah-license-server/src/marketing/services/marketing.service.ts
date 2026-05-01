import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import { SegmentResolverService } from './segment-resolver.service';
import { TemplateRenderService } from './template-render.service';
import { UnsubscribeTokenService } from './unsubscribe-token.service';
import { EmailService } from '../../email/services/email.service';
import type { SendCampaignDto } from '../dto/send-campaign.dto';
import type { ResendWebhookPayload } from '../dto/resend-webhook.dto';

/**
 * MarketingService — campaign send orchestrator + Resend webhook handler.
 *
 * TASK_2025_292 Batch 5. Implements:
 *   - sendCampaign(dto, actor): validation + segment resolve + DB row +
 *     fire-and-forget runCampaign worker. Returns 202-shaped response.
 *   - runCampaign(campaignId, …): chunked dispatch loop (500 / chunk),
 *     hand-rolled semaphore with concurrency cap 10, per-email re-read of
 *     `marketingOptIn` (R3 race mitigation), List-Unsubscribe headers,
 *     tags for webhook correlation, structured logging, audit log row.
 *   - handleResendWebhook(event): hard bounce → opt-out + audit + counter,
 *     soft bounce → counter only, complaint → opt-out + audit + counter.
 *     Idempotent via in-memory svix-id de-dupe (single-process MVP — see
 *     §9-R10 of implementation-plan.md).
 */
@Injectable()
export class MarketingService {
  private readonly logger = new Logger(MarketingService.name);

  /** Chunk size for serial waves of email dispatch (plan §6.4). */
  private static readonly CHUNK_SIZE = 500;

  /** Concurrency cap inside each chunk (plan §6.4 — hand-rolled semaphore, no extra dep). */
  private static readonly CONCURRENCY = 10;

  /**
   * Idempotency cache for the Resend webhook. We dedupe on `svix-id` first
   * (preferred — Resend stamps every retry with the same id) and fall back to
   * `email_id + type` when no svix id was forwarded.
   *
   * Trade-off: the Set lives in-process and is lost on restart. For the
   * single-instance license-server topology this is acceptable; if we ever
   * scale horizontally, persist this in Postgres or Redis. The cap below
   * keeps memory bounded (~1 MB for 5k entries).
   */
  private readonly processedEventIds = new Set<string>();
  private static readonly DEDUP_CAP = 5000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
    @Inject(SegmentResolverService)
    private readonly segmentResolver: SegmentResolverService,
    @Inject(TemplateRenderService)
    private readonly templateRender: TemplateRenderService,
    @Inject(UnsubscribeTokenService)
    private readonly tokenService: UnsubscribeTokenService,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async getSegments() {
    return this.segmentResolver.getSegmentCounts();
  }

  // ===========================================================================
  // T-B5-01: sendCampaign — orchestrator
  // ===========================================================================

  async sendCampaign(
    dto: SendCampaignDto,
    actor: { email: string },
  ): Promise<{
    campaignId: string;
    recipientCount: number;
    skippedCount: number;
    status: 'in_progress';
  }> {
    // 1. Content validation. The DTO permits both fields optional; we enforce
    //    the mutual-exclusion contract here so the controller and the service
    //    share one source of truth (defence-in-depth — controller also checks).
    const hasInline =
      typeof dto.subject === 'string' &&
      dto.subject.length > 0 &&
      typeof dto.htmlBody === 'string' &&
      dto.htmlBody.length > 0;
    const hasTemplate =
      typeof dto.templateId === 'string' && dto.templateId.length > 0;

    if (!hasTemplate && !hasInline) {
      throw new BadRequestException('CONTENT_REQUIRED');
    }
    if (hasTemplate && (dto.subject || dto.htmlBody)) {
      throw new BadRequestException('CONTENT_AMBIGUOUS');
    }

    // 2. Resolve template if provided (404 not 400 per task: TEMPLATE_NOT_FOUND).
    let resolvedSubject = dto.subject ?? '';
    let resolvedHtml = dto.htmlBody ?? '';
    let templateId: string | null = null;

    if (hasTemplate) {
      const template = await this.prisma.marketingCampaignTemplate.findUnique({
        where: { id: dto.templateId as string },
      });
      if (!template) {
        throw new NotFoundException('TEMPLATE_NOT_FOUND');
      }
      resolvedSubject = template.subject;
      resolvedHtml = template.htmlBody;
      templateId = template.id;
    }

    // 3. Resolve recipient segment (segment + explicit userIds union, opt-in checked).
    const { optedInUserIds, skippedUserIds } =
      await this.segmentResolver.resolve(dto.segment, dto.userIds);

    if (optedInUserIds.length === 0) {
      throw new BadRequestException('EMPTY_SEGMENT');
    }

    // 4. Persist the campaign row before dispatching so the runCampaign worker
    //    has a stable id and we have a record even if the process crashes.
    const segmentLabel = dto.segment
      ? dto.segment
      : dto.userIds && dto.userIds.length > 0
        ? 'custom'
        : 'all';

    const campaign = await this.prisma.marketingCampaign.create({
      data: {
        name: dto.name,
        subject: resolvedSubject,
        templateId: templateId,
        segment: segmentLabel,
        recipientCount: optedInUserIds.length,
        skippedUserIds: skippedUserIds,
        createdBy: actor.email,
      },
    });

    // 5. Fire-and-forget worker. We deliberately do NOT await — the controller
    //    returns 202 immediately. Errors inside `runCampaign` are caught and
    //    logged; they do not propagate to the HTTP layer.
    void this.runCampaign(campaign.id, {
      recipients: optedInUserIds,
      subject: resolvedSubject,
      htmlBody: resolvedHtml,
      actorEmail: actor.email,
    }).catch((err) => {
      this.logger.error(
        `runCampaign crashed for campaignId=${campaign.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
      );
    });

    return {
      campaignId: campaign.id,
      recipientCount: optedInUserIds.length,
      skippedCount: skippedUserIds.length,
      status: 'in_progress',
    };
  }

  // ===========================================================================
  // T-B5-02: runCampaign — chunked dispatch with per-email re-check (R3)
  // ===========================================================================

  /**
   * Background worker invoked from `sendCampaign`. Splits recipients into
   * `CHUNK_SIZE` waves, runs each wave with a hand-rolled semaphore capping
   * at `CONCURRENCY`, re-reads `marketingOptIn` per email (R3), renders the
   * template, signs an unsubscribe token, sends via EmailService with the
   * required RFC 8058 headers and Resend correlation tags, and finally
   * updates `sentCount`/`completedAt` and writes one audit row.
   *
   * Marked `private` to enforce the "only sendCampaign starts a run" contract.
   * Visible-for-testing: the spec file constructs a service instance and
   * invokes the public `sendCampaign` end-to-end rather than poking this.
   */
  private async runCampaign(
    campaignId: string,
    params: {
      recipients: string[];
      subject: string;
      htmlBody: string;
      actorEmail: string;
    },
  ): Promise<void> {
    const start = Date.now();
    let sent = 0;
    let failed = 0;
    let skippedMidLoop = 0;
    let caughtError: Error | null = null;

    const baseUrl = this.getUnsubscribeBaseUrl();

    try {
      for (
        let i = 0;
        i < params.recipients.length;
        i += MarketingService.CHUNK_SIZE
      ) {
        const chunk = params.recipients.slice(
          i,
          i + MarketingService.CHUNK_SIZE,
        );
        const chunkResult = await this.dispatchChunk(chunk, {
          campaignId,
          subject: params.subject,
          htmlBody: params.htmlBody,
          baseUrl,
        });
        sent += chunkResult.sent;
        failed += chunkResult.failed;
        skippedMidLoop += chunkResult.skippedMidLoop;

        // Persist incremental progress so observers see the campaign tick up.
        // Wrapped in try/catch so a transient DB hiccup on the progress write
        // doesn't abort the whole run — the finally block still records final
        // outcome via an atomic transaction.
        try {
          await this.prisma.marketingCampaign.update({
            where: { id: campaignId },
            data: { sentCount: sent },
          });
        } catch (progressErr) {
          // Surface as a caught error so the finally records 'failed'/'partial'
          // status with errorMessage. Re-throw to halt further chunks — there's
          // no safe way to keep dispatching when DB writes are failing.
          caughtError =
            progressErr instanceof Error
              ? progressErr
              : new Error(String(progressErr));
          throw caughtError;
        }
      }
    } catch (err) {
      if (!caughtError) {
        caughtError = err instanceof Error ? err : new Error(String(err));
      }
    } finally {
      const durationMs = Date.now() - start;

      // Determine final status based on observed outcome.
      //   completed → no errors and no failures
      //   partial   → no caught error but some emails failed or were skipped mid-loop
      //   failed    → caught error during run
      const status: 'completed' | 'partial' | 'failed' = caughtError
        ? 'failed'
        : failed > 0 || skippedMidLoop > 0
          ? 'partial'
          : 'completed';

      const errorMessage = caughtError ? caughtError.message : undefined;

      // Atomic completion + audit. ALWAYS runs — even on failure — so the
      // campaign row never sits stuck `in_progress` and the audit trail is
      // populated with the actual outcome. Wrapped in its own try/catch so
      // a tx failure here can't crash the worker without surfacing.
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.marketingCampaign.update({
            where: { id: campaignId },
            data: {
              sentCount: sent,
              completedAt: new Date(),
            },
          });

          await this.auditLog.write({
            actorEmail: params.actorEmail,
            action: 'marketing.campaign.send',
            targetType: 'MarketingCampaign',
            targetId: campaignId,
            metadata: {
              recipientCount: params.recipients.length,
              sent,
              failed,
              skippedMidLoop,
              duration_ms: durationMs,
              status,
              ...(errorMessage ? { errorMessage } : {}),
            },
            tx,
          });
        });
      } catch (finalErr) {
        // Last-resort log so observability still sees the campaign attempted
        // to finalize. Operational follow-up: the row may remain without
        // completedAt — surface via the campaigns list page.
        this.logger.error(
          `runCampaign final commit failed for campaignId=${campaignId}: ${
            finalErr instanceof Error ? finalErr.message : String(finalErr)
          }`,
          finalErr instanceof Error ? finalErr.stack : undefined,
        );
      }

      // Structured log line — fields enumerated per plan §6.4.
      this.logger.log({
        message: 'marketing campaign send completed',
        campaignId,
        recipientCount: params.recipients.length,
        sent,
        failed,
        skippedMidLoop,
        duration_ms: durationMs,
        status,
        ...(errorMessage ? { errorMessage } : {}),
      });
    }
  }

  /**
   * Dispatch a chunk of recipients with a hand-rolled semaphore. Each task:
   *   1. Re-reads `marketingOptIn` (R3) — skips if user opted out mid-send or
   *      was deleted between resolve and dispatch.
   *   2. Renders template with footer + unsubscribe URL.
   *   3. Sends via EmailService with `List-Unsubscribe` + tags.
   */
  private async dispatchChunk(
    userIds: string[],
    ctx: {
      campaignId: string;
      subject: string;
      htmlBody: string;
      baseUrl: string;
    },
  ): Promise<{ sent: number; failed: number; skippedMidLoop: number }> {
    let sent = 0;
    let failed = 0;
    let skippedMidLoop = 0;

    // Hand-rolled semaphore — no new npm dep. We slot a fixed-size pool of
    // workers each draining the queue serially.
    const queue = [...userIds];
    const workerCount = Math.min(MarketingService.CONCURRENCY, queue.length);

    const worker = async () => {
      while (queue.length > 0) {
        const userId = queue.shift();
        if (!userId) break;
        const result = await this.dispatchOne(userId, ctx);
        if (result === 'sent') sent++;
        else if (result === 'skipped') skippedMidLoop++;
        else failed++;
      }
    };

    const workers: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i++) workers.push(worker());
    await Promise.all(workers);

    return { sent, failed, skippedMidLoop };
  }

  /**
   * Single-email dispatch. Returns `'sent' | 'skipped' | 'failed'`. Never
   * throws — all exceptions are caught and logged so one bad email does not
   * abort the rest of the chunk.
   */
  private async dispatchOne(
    userId: string,
    ctx: {
      campaignId: string;
      subject: string;
      htmlBody: string;
      baseUrl: string;
    },
  ): Promise<'sent' | 'skipped' | 'failed'> {
    try {
      // R3: per-email re-read of opt-in. Cheap (single SELECT) and
      // eliminates the resolve→dispatch race window.
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          marketingOptIn: true,
        },
      });
      if (!user || !user.marketingOptIn) {
        return 'skipped';
      }

      const token = await this.tokenService.sign(user.id);
      const unsubscribeUrl = `${ctx.baseUrl}/unsubscribe/${token}`;

      const rendered = this.templateRender.render({
        htmlBody: ctx.htmlBody,
        subject: ctx.subject,
        user: { firstName: user.firstName, email: user.email },
        unsubscribeUrl,
      });

      await this.email.sendCustomEmail({
        to: user.email,
        subject: rendered.subject,
        html: rendered.html,
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        tags: [
          { name: 'campaignId', value: ctx.campaignId },
          { name: 'userId', value: user.id },
        ],
      });

      return 'sent';
    } catch (err) {
      this.logger.warn(
        `email dispatch failed campaignId=${ctx.campaignId} userId=${userId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return 'failed';
    }
  }

  /**
   * Resolve the public host that hosts `/unsubscribe/:token`. Prefers a
   * dedicated env var; falls back to `FRONTEND_URL` (existing convention)
   * and finally to a sane default so a misconfigured environment still
   * produces deliverable links rather than `undefined`.
   */
  private getUnsubscribeBaseUrl(): string {
    return (
      this.config.get<string>('MARKETING_UNSUBSCRIBE_BASE_URL') ||
      this.config.get<string>('FRONTEND_URL') ||
      'https://ptah.live'
    ).replace(/\/$/, '');
  }

  // ===========================================================================
  // T-B5-04: handleResendWebhook
  // ===========================================================================

  /**
   * Handles Resend webhook events for campaign correlation:
   *   - email.bounced   → hard: opt-out + counter; soft: counter only.
   *   - email.complained → opt-out + counter.
   *   - email.delivery_delayed → soft signal, counter only (treated like soft bounce).
   *
   * Idempotent: identical (svix-id, type) tuples are skipped so a Resend retry
   * does not double-flip opt-in or double-bump counters.
   *
   * The guard already verified the signature; the controller passes both the
   * parsed payload and the optional `svixId` for de-dupe.
   */
  async handleResendWebhook(
    event: ResendWebhookPayload,
    svixId?: string,
  ): Promise<void> {
    const dedupKey = `${svixId ?? event.data.email_id}:${event.type}`;
    if (this.processedEventIds.has(dedupKey)) {
      this.logger.debug(`Resend webhook duplicate ignored: ${dedupKey}`);
      return;
    }
    this.rememberEventId(dedupKey);

    // Resend has shipped tags in two shapes — normalize before reading.
    const tags = this.normalizeTags(event.data.tags);
    const userId = tags['userId'];
    const campaignId = tags['campaignId'];

    if (!userId && !campaignId) {
      // Neither correlation id present — likely a malformed/unknown payload
      // shape. Warn so observability surfaces silent contract drift.
      // Fingerprint = svix-id + event type only (no PII).
      this.logger.warn(
        `Resend webhook tags yielded no userId/campaignId: svixId=${
          svixId ?? 'none'
        } type=${event.type}`,
      );
    }

    switch (event.type) {
      case 'email.bounced': {
        const bounceType = event.data.bounce?.type ?? 'hard';
        const isHard = bounceType === 'hard' || bounceType === 'permanent';
        if (isHard && userId) {
          await this.flipOptOut(userId, 'user.bounced', {
            campaignId,
            bounceType,
            emailId: event.data.email_id,
          });
        }
        if (campaignId) {
          await this.bumpCampaignCounter(campaignId, 'bouncedCount');
        }
        return;
      }

      case 'email.complained': {
        if (userId) {
          await this.flipOptOut(userId, 'user.complained', {
            campaignId,
            emailId: event.data.email_id,
          });
        }
        if (campaignId) {
          await this.bumpCampaignCounter(campaignId, 'complainedCount');
        }
        return;
      }

      case 'email.delivery_delayed': {
        // Soft-bounce-equivalent. Per plan §6.4: counter only, no opt-out flip.
        if (campaignId) {
          await this.bumpCampaignCounter(campaignId, 'bouncedCount');
        }
        return;
      }

      default:
        // Other event types (sent, delivered, opened, clicked) are not
        // tracked at the campaign level for this batch.
        return;
    }
  }

  /**
   * Normalize the polymorphic Resend `tags` payload into a flat record.
   *
   * Resend has shipped two shapes for webhook tags:
   *   - Object: `{ campaignId: 'c-1', userId: 'u-1' }`
   *   - Array:  `[{ name: 'campaignId', value: 'c-1' }, ...]`
   *
   * This helper accepts either, returns a flat `Record<string,string>`,
   * and silently coerces non-string values via `String(...)`. Anything
   * that doesn't match either contract returns an empty record so
   * downstream code can branch on `!userId && !campaignId` and emit
   * one `warn` log rather than throwing (webhook 200 is preferred over
   * 500 for inputs we don't recognize — Resend would otherwise retry
   * indefinitely).
   */
  private normalizeTags(tags: unknown): Record<string, string> {
    if (!tags) return {};

    // Array shape: [{ name, value }, ...]
    if (Array.isArray(tags)) {
      const out: Record<string, string> = {};
      for (const entry of tags) {
        if (
          entry &&
          typeof entry === 'object' &&
          'name' in entry &&
          'value' in entry
        ) {
          const name = (entry as { name: unknown }).name;
          const value = (entry as { value: unknown }).value;
          if (typeof name === 'string' && name.length > 0) {
            out[name] = typeof value === 'string' ? value : String(value);
          }
        }
      }
      return out;
    }

    // Object shape: { key: value, ... }
    if (typeof tags === 'object') {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(
        tags as Record<string, unknown>,
      )) {
        if (typeof key === 'string' && key.length > 0) {
          out[key] = typeof value === 'string' ? value : String(value);
        }
      }
      return out;
    }

    // Anything else (string, number, boolean) — unknown shape.
    return {};
  }

  /**
   * Flip a user's marketing opt-in to false and write a paired audit row.
   * Wrapped in a transaction so the user mutation and audit row commit
   * atomically — if either fails, neither side-effect is observed.
   */
  private async flipOptOut(
    userId: string,
    action: 'user.bounced' | 'user.complained',
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            marketingOptIn: false,
            unsubscribedAt: new Date(),
          },
        });
        await this.auditLog.write({
          actorEmail: null, // System / webhook-driven
          action,
          targetType: 'User',
          targetId: userId,
          metadata,
          tx,
        });
      });
    } catch (err) {
      // User may have been hard-deleted between send and webhook arrival.
      // Log and move on — the campaign counter still gets bumped by the caller.
      this.logger.warn(
        `flipOptOut(${action}) skipped for userId=${userId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Atomically increment a campaign counter column.
   *
   * Uses Prisma's nested `increment` to ensure concurrent webhook deliveries
   * don't lose updates (read-modify-write would race; `increment` translates
   * to a `column = column + 1` UPDATE which Postgres handles atomically).
   */
  private async bumpCampaignCounter(
    campaignId: string,
    column: 'bouncedCount' | 'complainedCount',
  ): Promise<void> {
    try {
      await this.prisma.marketingCampaign.update({
        where: { id: campaignId },
        data: { [column]: { increment: 1 } },
      });
    } catch (err) {
      // Campaign id from a tag may not match a real row (e.g. ad-hoc test send).
      this.logger.debug(
        `bumpCampaignCounter(${column}) skipped for campaignId=${campaignId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Remember a processed event id while keeping the dedup set bounded.
   * When the cap is reached we drop the oldest 25% (insertion order is
   * preserved by Set in JavaScript) so the cache stays useful but does not
   * grow unboundedly.
   */
  private rememberEventId(key: string): void {
    if (this.processedEventIds.size >= MarketingService.DEDUP_CAP) {
      const drop = Math.floor(MarketingService.DEDUP_CAP / 4);
      let i = 0;
      for (const k of this.processedEventIds) {
        if (i++ >= drop) break;
        this.processedEventIds.delete(k);
      }
    }
    this.processedEventIds.add(key);
  }
}
