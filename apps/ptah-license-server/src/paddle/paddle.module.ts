import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaddleController } from './paddle.controller';
import { PaddleService } from './paddle.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import {
  PaddleClientProvider,
  PADDLE_CLIENT,
} from './providers/paddle.provider';

/**
 * PaddleModule - Paddle payment integration for subscription management
 *
 * Provides:
 * - Paddle SDK client (properly initialized via DI)
 * - Webhook endpoint (POST /webhooks/paddle) for subscription lifecycle events
 * - Signature verification for secure webhook processing
 * - License provisioning on subscription.created
 * - License updates on subscription.updated and subscription.canceled
 *
 * Events Handled:
 * - subscription.created: Creates user (if new) and provisions license
 * - subscription.activated: Same as created (confirms payment)
 * - subscription.updated: Updates license plan based on new price
 * - subscription.canceled: Sets license expiration to subscription end date
 * - subscription.past_due: Updates subscription status
 * - subscription.paused: Pauses license
 * - subscription.resumed: Reactivates license
 *
 * Dependencies:
 * - PrismaModule (database access for users, licenses, subscriptions)
 * - EmailModule (sending license key emails)
 * - ConfigModule (Paddle API key, webhook secret, price ID mappings)
 *
 * Security:
 * - All webhooks verified via HMAC SHA256 signature
 * - Idempotent processing via event_id tracking
 *
 * Configuration Required:
 * - PADDLE_API_KEY: Paddle API key (required)
 * - PADDLE_WEBHOOK_SECRET: Webhook signature secret (required)
 * - PADDLE_PRICE_ID_PRO_MONTHLY: Monthly price ID
 * - PADDLE_PRICE_ID_PRO_YEARLY: Yearly price ID
 */
@Module({
  imports: [PrismaModule, EmailModule, ConfigModule],
  controllers: [PaddleController],
  providers: [PaddleClientProvider, PaddleService],
  exports: [PaddleService, PADDLE_CLIENT],
})
export class PaddleModule {}
