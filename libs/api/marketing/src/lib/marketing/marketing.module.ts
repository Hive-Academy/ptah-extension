import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { IdentityModule } from '@ptah-api/identity';
import { EmailModule } from '@ptah-api/email';
import { PrismaModule } from '@ptah-api/core';
import { AuditModule } from '@ptah-api/audit';
import { UnsubscribeTokenService } from './services/unsubscribe-token.service';
import { TemplateRenderService } from './services/template-render.service';
import { SegmentResolverService } from './services/segment-resolver.service';
import { MarketingService } from './services/marketing.service';
import { PublicMarketingController } from './controllers/public-marketing.controller';
import { AdminMarketingController } from './controllers/admin-marketing.controller';
import { ResendWebhookController } from './controllers/resend-webhook.controller';
import { ResendWebhookGuard } from './guards/resend-webhook.guard';

@Module({
  imports: [
    EmailModule,
    IdentityModule,
    ConfigModule,
    PrismaModule,
    AuditModule,
    JwtModule.register({}),
  ],
  providers: [
    UnsubscribeTokenService,
    TemplateRenderService,
    SegmentResolverService,
    MarketingService,
    ResendWebhookGuard,
  ],
  controllers: [
    PublicMarketingController,
    AdminMarketingController,
    ResendWebhookController,
  ],
  exports: [
    UnsubscribeTokenService,
    TemplateRenderService,
    SegmentResolverService,
    MarketingService,
  ],
})
export class MarketingModule {}
