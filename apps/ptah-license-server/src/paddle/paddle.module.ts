import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaddleController } from './paddle.controller';
import { PaddleService } from './paddle.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';

/**
 * PaddleModule - Paddle payment integration for subscription management
 *
 * Provides:
 * - Webhook endpoint (POST /webhooks/paddle) for subscription lifecycle events
 * - Signature verification for secure webhook processing
 * - License provisioning on subscription.created
 * - License updates on subscription.updated and subscription.canceled
 *
 * Events Handled:
 * - subscription.created: Creates user (if new) and provisions license
 * - subscription.updated: Updates license plan based on new price
 * - subscription.canceled: Sets license expiration to subscription end date
 *
 * Dependencies:
 * - PrismaModule (database access for users, licenses, subscriptions)
 * - EmailModule (sending license key emails)
 * - ConfigModule (Paddle API key, webhook secret, price ID mappings)
 *
 * Security:
 * - All webhooks verified via HMAC SHA256 signature
 * - Idempotent processing via event_id tracking
 */
@Module({
  imports: [PrismaModule, EmailModule, ConfigModule],
  controllers: [PaddleController],
  providers: [PaddleService],
  exports: [PaddleService],
})
export class PaddleModule {}
