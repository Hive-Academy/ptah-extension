import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../app/auth/auth.module';
import { EmailModule } from '../email/email.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
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
    AuthModule,
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
