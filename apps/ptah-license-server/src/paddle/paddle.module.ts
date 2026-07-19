import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaddleController } from './paddle.controller';
import { PaddleService } from './paddle.service';
import { PaddleWebhookService } from './paddle-webhook.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { EventsModule } from '../events/events.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { WaitlistService } from '../waitlist/waitlist.service';
import { WAITLIST_CONVERSION_SINK } from '../circle/waitlist-conversion.sink';
import {
  PaddleClientProvider,
  PADDLE_CLIENT,
} from './providers/paddle.provider';

/**
 * PaddleModule - Paddle payment integration for subscription management
 *
 * Architecture:
 * - PaddleController: Thin HTTP layer - validates request, delegates to service
 * - PaddleWebhookService: Webhook processing with SDK-based signature verification
 * - PaddleService: Business logic for license provisioning and updates
 *
 * Provides:
 * - Paddle SDK client (properly initialized via DI)
 * - Webhook endpoint (POST /webhooks/paddle) for subscription lifecycle events
 * - SDK-based signature verification via Webhooks.unmarshal()
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
 * - transaction.completed: Extends license on successful renewal payment
 *
 * Dependencies:
 * - PrismaModule (database access for users, licenses, subscriptions)
 * - EmailModule (sending license key emails)
 * - ConfigModule (Paddle API key, webhook secret, price ID mappings)
 * - EventsModule (SSE events for real-time frontend updates)
 *
 * Security:
 * - All webhooks verified via Paddle SDK's Webhooks.unmarshal()
 * - SDK handles HMAC SHA256 verification and timestamp validation
 * - Idempotent processing via event_id tracking
 *
 * Configuration Required:
 * - PADDLE_API_KEY: Paddle API key (required)
 * - PADDLE_WEBHOOK_SECRET: Webhook signature secret (required)
 * - PADDLE_PRICE_ID_BUILDERS_MONTHLY: Builders monthly price ID
 * - PADDLE_PRICE_ID_BUILDERS_YEARLY: Builders yearly price ID
 */
@Module({
  imports: [
    PrismaModule,
    EmailModule,
    ConfigModule,
    EventsModule,
    WaitlistModule,
  ],
  controllers: [PaddleController],
  providers: [
    PaddleClientProvider,
    PaddleService,
    PaddleWebhookService,
    { provide: WAITLIST_CONVERSION_SINK, useExisting: WaitlistService },
  ],
  exports: [PaddleService, PADDLE_CLIENT],
})
export class PaddleModule {}
