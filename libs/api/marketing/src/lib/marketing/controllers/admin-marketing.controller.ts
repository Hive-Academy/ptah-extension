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
import { JwtAuthGuard } from '@ptah-api/identity';
import { AdminGuard } from '@ptah-api/identity';
import { AdminThrottlerGuard } from '@ptah-api/identity';
import { SegmentResolverService } from '../services/segment-resolver.service';
import { TemplateRenderService } from '../services/template-render.service';
import { MarketingService } from '../services/marketing.service';
import { PrismaService, dtoPipe } from '@ptah-api/core';
import { SaveTemplateDto } from '../dto/save-template.dto';
import { SendCampaignDto } from '../dto/send-campaign.dto';

/**
 * AdminMarketingController — campaign template CRUD and campaign dispatch for
 * the native admin dashboard. Guard chain: `JwtAuthGuard` → `AdminGuard` →
 * `AdminThrottlerGuard` at CLASS level.
 *
 * ⚠️ EVERY `@Body()` / `@Query()` PARAM MUST BIND `dtoPipe(TheDto)`.
 * A bare `@Body() dto: X` is SILENTLY UNVALIDATED in this server: esbuild does
 * not emit `emitDecoratorMetadata`, so Nest cannot infer the DTO type and the
 * global ValidationPipe short-circuits — every `class-validator` decorator
 * becomes inert. See `libs/api/core/src/lib/common/dto-validation.pipe.ts`.
 * `apps/ptah-license-server/src/common/controller-validation.spec.ts` fails the
 * build if a binding is dropped.
 *
 * This is the highest-consequence pair of bodies in the server: until
 * TASK_2026_170 B8 bound them, `SendCampaignDto`'s `@ArrayMaxSize(5000)` and its
 * `segment` allowlist were inert, so nothing capped an outbound campaign or
 * constrained which cohort it addressed.
 *
 * 🔴 When a caller trips one of these caps, FIX THE CALLER, not the DTO. B8
 * capped the campaign-name input at 93 chars in `marketing-compose.ts` because
 * the test-send path appends `" (test)"` (+7) against `@Length(1, 100)`.
 */
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
  async saveTemplate(@Body(dtoPipe(SaveTemplateDto)) dto: SaveTemplateDto) {
    const existing = await this.prisma.marketingCampaignTemplate.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException('TEMPLATE_NAME_TAKEN');
    }
    const sanitizedHtml = this.templateRender.sanitizeForStorage(dto.htmlBody);
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
  async sendCampaign(
    @Body(dtoPipe(SendCampaignDto)) dto: SendCampaignDto,
    @Req() req: Request,
  ) {
    const actorEmail = req.user?.email ?? 'unknown';
    return this.marketing.sendCampaign(dto, { email: actorEmail });
  }
}
