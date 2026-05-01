import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  ConflictException,
  HttpStatus,
  HttpCode,
  Inject,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../app/auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../admin/admin.guard';
import { AdminThrottlerGuard } from '../../admin/admin-throttler.guard';
import { SegmentResolverService } from '../services/segment-resolver.service';
import { TemplateRenderService } from '../services/template-render.service';
import { MarketingService } from '../services/marketing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SaveTemplateDto } from '../dto/save-template.dto';
import { SendCampaignDto } from '../dto/send-campaign.dto';

@Controller('v1/admin/marketing')
@UseGuards(JwtAuthGuard, AdminGuard, AdminThrottlerGuard)
export class AdminMarketingController {
  constructor(
    @Inject(SegmentResolverService)
    private readonly segmentResolver: SegmentResolverService,
    @Inject(TemplateRenderService)
    private readonly templateRender: TemplateRenderService,
    @Inject(MarketingService) private readonly marketing: MarketingService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get('segments')
  async getSegments() {
    const segments = await this.segmentResolver.getSegmentCounts();
    return { segments };
  }

  @Post('templates')
  async saveTemplate(@Body() dto: SaveTemplateDto) {
    // 1. Check for duplicate name
    const existing = await this.prisma.marketingCampaignTemplate.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException('TEMPLATE_NAME_TAKEN');
    }

    // 2. Sanitize and validate HTML (throws TEMPLATE_SANITISE_REJECTED on diff)
    const sanitizedHtml = this.templateRender.sanitizeForStorage(dto.htmlBody);

    // 3. Save to database
    return this.prisma.marketingCampaignTemplate.create({
      data: {
        name: dto.name,
        subject: dto.subject,
        htmlBody: sanitizedHtml,
        variables: dto.variables || [],
      },
    });
  }

  /**
   * T-B5-03: real orchestrator wired in. Throttled at 3/min per
   * AdminThrottlerGuard's per-admin-email tracker so a single admin can't
   * accidentally fan out hundreds of campaigns.
   */
  @Post('send')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async sendCampaign(@Body() dto: SendCampaignDto, @Req() req: Request) {
    const actorEmail = req.user?.email ?? 'unknown';
    return this.marketing.sendCampaign(dto, { email: actorEmail });
  }
}
