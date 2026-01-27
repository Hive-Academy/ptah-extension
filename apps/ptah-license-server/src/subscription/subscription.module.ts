import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { PaddleModule } from '../paddle/paddle.module';
import { AuthModule } from '../app/auth/auth.module';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { SubscriptionDbService } from './subscription-db.service';
import { PaddleSyncService } from './paddle-sync.service';
import { SubscriptionEventListener } from './events';

/**
 * SubscriptionModule - Paddle subscription management for user-facing APIs
 *
 * TASK_2025_123: Reliable Paddle Subscription Management System
 *
 * Provides:
 * - Subscription status checking with Paddle API + local fallback
 * - Pre-checkout validation to prevent duplicate subscriptions
 * - User-initiated reconciliation with Paddle state
 * - Customer portal session generation
 *
 * Endpoints (all protected with JwtAuthGuard):
 * - GET  /api/v1/subscriptions/status           - Get subscription status
 * - POST /api/v1/subscriptions/validate-checkout - Validate before checkout
 * - POST /api/v1/subscriptions/reconcile        - Sync with Paddle
 * - POST /api/v1/subscriptions/portal-session   - Get portal URL
 *
 * Dependencies:
 * - PrismaModule: Database access (User, License, Subscription)
 * - EventsModule: SSE broadcasting for real-time updates
 * - ConfigModule: Price ID mappings and environment config
 * - PaddleModule: Paddle SDK client (PADDLE_CLIENT token)
 *
 * Note: PaddleModule exports PADDLE_CLIENT which is injected into SubscriptionService
 */
@Module({
  imports: [
    PrismaModule,
    EventsModule,
    ConfigModule,
    PaddleModule, // Provides PADDLE_CLIENT token
    AuthModule, // Provides AuthService for JwtAuthGuard
  ],
  controllers: [SubscriptionController],
  providers: [
    SubscriptionService,
    SubscriptionDbService,
    PaddleSyncService,
    SubscriptionEventListener, // Handles async event processing
  ],
  exports: [SubscriptionService, SubscriptionDbService, PaddleSyncService],
})
export class SubscriptionModule {}
