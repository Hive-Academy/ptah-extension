import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import { SegmentResolverService } from './segment-resolver.service';
import { TemplateRenderService } from './template-render.service';
import { UnsubscribeTokenService } from './unsubscribe-token.service';
import { EmailService } from '../../email/services/email.service';
import { ConfigService } from '@nestjs/config';
import type { SendCampaignDto } from '../dto/send-campaign.dto';
import type { ResendWebhookPayload } from '../dto/resend-webhook.dto';

@Injectable()
export class MarketingService {
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

  // B5 will implement sendCampaign and handleResendWebhook
  async sendCampaign(
    _dto: SendCampaignDto,
    _actor: { email: string },
  ): Promise<{
    campaignId: string;
    recipientCount: number;
    skippedCount: number;
  }> {
    throw new Error('Not yet implemented — B5');
  }

  async handleResendWebhook(_event: ResendWebhookPayload): Promise<void> {
    throw new Error('Not yet implemented — B5');
  }
}
