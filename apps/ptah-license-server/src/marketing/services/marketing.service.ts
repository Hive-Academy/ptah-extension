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

  async sendCampaign(
    dto: SendCampaignDto,
    actor: { email: string },
  ): Promise<{
    campaignId: string;
    recipientCount: number;
    skippedCount: number;
    status: 'in_progress';
  }> {
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
    const { optedInUserIds, skippedUserIds } =
      await this.segmentResolver.resolve(dto.segment, dto.userIds);

    if (optedInUserIds.length === 0) {
      throw new BadRequestException('EMPTY_SEGMENT');
    }
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
        try {
          await this.prisma.marketingCampaign.update({
            where: { id: campaignId },
            data: { sentCount: sent },
          });
        } catch (progressErr) {
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
      const status: 'completed' | 'partial' | 'failed' = caughtError
        ? 'failed'
        : failed > 0 || skippedMidLoop > 0
          ? 'partial'
          : 'completed';

      const errorMessage = caughtError ? caughtError.message : undefined;
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
        this.logger.error(
          `runCampaign final commit failed for campaignId=${campaignId}: ${
            finalErr instanceof Error ? finalErr.message : String(finalErr)
          }`,
          finalErr instanceof Error ? finalErr.stack : undefined,
        );
      }
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
    const tags = this.normalizeTags(event.data.tags);
    const userId = tags['userId'];
    const campaignId = tags['campaignId'];

    if (!userId && !campaignId) {
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
        if (campaignId) {
          await this.bumpCampaignCounter(campaignId, 'bouncedCount');
        }
        return;
      }

      default:
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
