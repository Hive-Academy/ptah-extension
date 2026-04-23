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
import { PublicMarketingController } from './controllers/public-marketing.controller';
import { AdminMarketingController } from './controllers/admin-marketing.controller';

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
  ],
  controllers: [PublicMarketingController, AdminMarketingController],
  exports: [
    UnsubscribeTokenService,
    TemplateRenderService,
    SegmentResolverService,
  ],
})
export class MarketingModule {}
