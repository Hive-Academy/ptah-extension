import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  BadRequestException,
  ConflictException,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../app/auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../admin/admin.guard';
import { AdminThrottlerGuard } from '../../admin/admin-throttler.guard';
import { SegmentResolverService } from '../services/segment-resolver.service';
import { TemplateRenderService } from '../services/template-render.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SaveTemplateDto } from '../dto/save-template.dto';
import { SendCampaignDto } from '../dto/send-campaign.dto';

@Controller('v1/admin/marketing')
@UseGuards(JwtAuthGuard, AdminGuard, AdminThrottlerGuard)
export class AdminMarketingController {
  constructor(
    private readonly segmentResolver: SegmentResolverService,
    private readonly templateRender: TemplateRenderService,
    private readonly prisma: PrismaService,
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

  @Post('send')
  @HttpCode(HttpStatus.ACCEPTED)
  async sendCampaign(@Body() dto: SendCampaignDto) {
    // Validate DTO requirements (mutually exclusive content)
    if (!dto.templateId && (!dto.subject || !dto.htmlBody)) {
      throw new BadRequestException('CONTENT_REQUIRED');
    }
    if (dto.templateId && (dto.subject || dto.htmlBody)) {
      throw new BadRequestException('CONTENT_AMBIGUOUS');
    }

    // Resolve template if provided
    if (dto.templateId) {
      const template = await this.prisma.marketingCampaignTemplate.findUnique({
        where: { id: dto.templateId },
      });
      if (!template) {
        throw new BadRequestException('TEMPLATE_NOT_FOUND');
      }
    }

    // Resolve recipients to check if empty
    const { optedInUserIds } = await this.segmentResolver.resolve(
      dto.segment,
      dto.userIds,
    );
    if (optedInUserIds.length === 0) {
      throw new BadRequestException('EMPTY_SEGMENT');
    }

    // STUB: B5 replaces with real orchestrator
    return {
      campaignId: 'pending-b5',
      recipientCount: optedInUserIds.length,
      status: 'stub',
    };
  }
}
