# Subscription State Machine

## Overview

The subscription state machine is the central engine that reacts to payment provider webhooks and drives license provisioning, email notifications, and status changes. It is **provider-agnostic** -- the same state transitions apply whether you use Stripe, Paddle, LemonSqueezy, or any other billing platform.

This service is the **business service** (Layer 3) in the webhook architecture. The webhook controller and routing layer (see `webhook-architecture` skill) verify signatures and route events here.

## Prisma Schema

```prisma
model User {
  id                  String         @id @default(uuid())
  email               String         @unique
  name                String?
  externalCustomerId  String?        @unique // Payment provider customer ID
  createdAt           DateTime       @default(now())
  updatedAt           DateTime       @updatedAt

  subscriptions Subscription[]
  licenses      License[]
}

model Subscription {
  id                      String    @id @default(uuid())
  userId                  String
  externalSubscriptionId  String    @unique  // Payment provider subscription ID
  externalCustomerId      String
  status                  String    @default("active") // active | trialing | paused | canceled | past_due | expired
  planSlug                String    // pro | enterprise | trial_pro | trial_enterprise
  priceId                 String    // Payment provider price ID
  currentPeriodEnd        DateTime
  trialEnd                DateTime?
  canceledAt              DateTime?
  pausedAt                DateTime?
  createdAt               DateTime  @default(now())
  updatedAt               DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([status])
  @@index([externalCustomerId])
}
```

**Field notes:**

- `externalSubscriptionId`: Unique identifier from the payment provider. For internal subscriptions (free tier, trials started without payment), use a prefix like `internal_trial_{userId}_{plan}`.
- `planSlug`: Maps to your `plans.config.ts`. Trial plans use `trial_` prefix.
- `priceId`: The payment provider's price identifier. Used to map back to internal plan slugs.
- `currentPeriodEnd`: When the current billing period expires. Updated on each renewal.
- `canceledAt`: When the user requested cancellation. Access continues until `currentPeriodEnd`.

## State Transition Diagram

```
                                  subscription.created
                                  (with trial)
                    +-----------------------------------+
                    |                                   v
               +----+----+                        +-----------+
               |  (none) |                        | trialing  |
               +----+----+                        +-----+-----+
                    |                                   |
                    | subscription.created              | subscription.activated
                    | (no trial)                        | (trial converts to paid)
                    |                                   |
                    v                                   v
               +---------+    subscription.updated +---------+
               |         |<------------------------|         |
               | active  |    (plan/price change)  | active  |
               |         |                         |         |
               +----+----+                         +---------+
                    |
         +----------+----------+----------+
         |          |          |          |
         v          v          v          |
   +-----------+ +----------+ +--------+ |
   | canceled  | | past_due | | paused | |
   +-----------+ +----------+ +--------+ |
         |          |               |     |
         |          |               |     |
         |          v               v     |
         |     +---------+    +---------+ |
         |     | active  |    | active  | |
         |     | (paid)  |    |(resumed)| |
         |     +---------+    +---------+ |
         |          |                     |
         |     +---------+               |
         |     |canceled |               |
         |     +---------+               |
         |          |                     |
         v          v                     |
   +-----------+                          |
   | expired   | (period ends)            |
   +-----------+                          |
         |                                |
         | resubscription                 |
         +--------------------------------+
```

## Webhook Event Mapping

Map payment provider events to your internal handler methods. This table is provider-agnostic -- adapt the left column to match your provider's event names.

| Provider Event                     | Internal Handler                | State Transition                   |
| ---------------------------------- | ------------------------------- | ---------------------------------- |
| `subscription.created`             | `handleSubscriptionCreated()`   | (none) -> trialing or active       |
| `subscription.activated`           | `handleSubscriptionActivated()` | trialing -> active                 |
| `subscription.updated`             | `handleSubscriptionUpdated()`   | active -> active (plan change)     |
| `subscription.canceled`            | `handleSubscriptionCanceled()`  | active -> canceled                 |
| `subscription.past_due`            | `handleSubscriptionPastDue()`   | active -> past_due                 |
| `subscription.paused`              | `handleSubscriptionPaused()`    | active -> paused                   |
| `subscription.resumed`             | `handleSubscriptionResumed()`   | paused -> active                   |
| `transaction.completed` (renewal)  | `handleRenewalPayment()`        | active -> active (period extended) |
| `transaction.completed` (recovery) | `handlePaymentRecovered()`      | past_due -> active                 |

## Subscription Service Implementation

```typescript
// src/services/subscription.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LicenseService } from './license.service';
import { LicenseVerificationService } from './license-verification.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PRICE_TO_PLAN_MAP } from '../config/pricing.config';

/** Generic event data -- adapt to your payment provider's webhook payload */
export interface SubscriptionEventData {
  eventId: string;
  subscriptionId: string;
  customerId: string;
  customerEmail: string;
  customerName?: string;
  priceId: string;
  status: string;
  currentPeriodEnd: string; // ISO 8601
  trialEnd?: string; // ISO 8601
}

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly licenseService: LicenseService,
    private readonly verificationService: LicenseVerificationService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Event Handlers ─────────────────────────────────────────────

  async handleSubscriptionCreated(data: SubscriptionEventData): Promise<void> {
    const plan = this.mapPriceIdToPlan(data.priceId);
    const isTrial = !!data.trialEnd;

    // Upsert user (may be first-time customer)
    const user = await this.prisma.user.upsert({
      where: { email: data.customerEmail },
      update: { externalCustomerId: data.customerId, name: data.customerName },
      create: {
        email: data.customerEmail,
        name: data.customerName,
        externalCustomerId: data.customerId,
      },
    });

    // Create subscription record
    const subscription = await this.prisma.subscription.create({
      data: {
        userId: user.id,
        externalSubscriptionId: data.subscriptionId,
        externalCustomerId: data.customerId,
        status: isTrial ? 'trialing' : 'active',
        planSlug: isTrial ? `trial_${plan}` : plan,
        priceId: data.priceId,
        currentPeriodEnd: new Date(data.currentPeriodEnd),
        trialEnd: data.trialEnd ? new Date(data.trialEnd) : null,
      },
    });

    // Provision license
    await this.licenseService.createLicense(user.id, isTrial ? `trial_${plan}` : plan, `webhook_${data.eventId}`, new Date(data.currentPeriodEnd));

    // Emit internal event for side-effects (emails, analytics, SSE)
    this.eventEmitter.emit('subscription.created', {
      userId: user.id,
      plan,
      isTrial,
      subscriptionId: subscription.id,
    });

    this.logger.log(`Subscription created: user=${user.id} plan=${plan} trial=${isTrial}`);
  }

  async handleSubscriptionActivated(data: SubscriptionEventData): Promise<void> {
    const plan = this.mapPriceIdToPlan(data.priceId);

    const subscription = await this.findSubscription(data.subscriptionId);
    if (!subscription) return;

    // Trial -> Active transition
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'active',
        planSlug: plan, // Remove trial_ prefix
        trialEnd: null,
      },
    });

    // Upgrade license from trial to paid
    await this.licenseService.createLicense(subscription.userId, plan, `webhook_${data.eventId}`, new Date(data.currentPeriodEnd));

    await this.verificationService.invalidateUser(subscription.userId);

    this.eventEmitter.emit('subscription.activated', {
      userId: subscription.userId,
      plan,
    });

    this.logger.log(`Subscription activated (trial->paid): user=${subscription.userId} plan=${plan}`);
  }

  async handleSubscriptionUpdated(data: SubscriptionEventData): Promise<void> {
    const newPlan = this.mapPriceIdToPlan(data.priceId);

    const subscription = await this.findSubscription(data.subscriptionId);
    if (!subscription) return;

    const oldPlan = subscription.planSlug;

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        planSlug: newPlan,
        priceId: data.priceId,
        currentPeriodEnd: new Date(data.currentPeriodEnd),
      },
    });

    // Update license to new plan
    await this.licenseService.createLicense(subscription.userId, newPlan, `webhook_${data.eventId}`, new Date(data.currentPeriodEnd));

    await this.verificationService.invalidateUser(subscription.userId);

    this.eventEmitter.emit('subscription.updated', {
      userId: subscription.userId,
      oldPlan,
      newPlan,
    });

    this.logger.log(`Subscription updated: user=${subscription.userId} ${oldPlan}->${newPlan}`);
  }

  async handleSubscriptionCanceled(data: SubscriptionEventData): Promise<void> {
    const subscription = await this.findSubscription(data.subscriptionId);
    if (!subscription) return;

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'canceled',
        canceledAt: new Date(),
      },
    });

    // Set license to expire at end of current period (grace period)
    await this.licenseService.setExpiration(subscription.userId, subscription.currentPeriodEnd);

    await this.verificationService.invalidateUser(subscription.userId);

    this.eventEmitter.emit('subscription.canceled', {
      userId: subscription.userId,
      plan: subscription.planSlug,
      accessUntil: subscription.currentPeriodEnd,
    });

    this.logger.log(`Subscription canceled: user=${subscription.userId} access until ${subscription.currentPeriodEnd.toISOString()}`);
  }

  async handleSubscriptionPastDue(data: SubscriptionEventData): Promise<void> {
    const subscription = await this.findSubscription(data.subscriptionId);
    if (!subscription) return;

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'past_due' },
    });

    this.eventEmitter.emit('subscription.past_due', {
      userId: subscription.userId,
      plan: subscription.planSlug,
    });

    this.logger.log(`Subscription past due: user=${subscription.userId}`);
  }

  async handleSubscriptionPaused(data: SubscriptionEventData): Promise<void> {
    const subscription = await this.findSubscription(data.subscriptionId);
    if (!subscription) return;

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'paused', pausedAt: new Date() },
    });

    await this.licenseService.pauseUserLicenses(subscription.userId);
    await this.verificationService.invalidateUser(subscription.userId);

    this.eventEmitter.emit('subscription.paused', {
      userId: subscription.userId,
    });

    this.logger.log(`Subscription paused: user=${subscription.userId}`);
  }

  async handleSubscriptionResumed(data: SubscriptionEventData): Promise<void> {
    const subscription = await this.findSubscription(data.subscriptionId);
    if (!subscription) return;

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'active',
        pausedAt: null,
        currentPeriodEnd: new Date(data.currentPeriodEnd),
      },
    });

    await this.licenseService.resumeUserLicenses(subscription.userId);
    await this.verificationService.invalidateUser(subscription.userId);

    this.eventEmitter.emit('subscription.resumed', {
      userId: subscription.userId,
    });

    this.logger.log(`Subscription resumed: user=${subscription.userId}`);
  }

  async handleRenewalPayment(data: SubscriptionEventData): Promise<void> {
    const subscription = await this.findSubscription(data.subscriptionId);
    if (!subscription) return;

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'active',
        currentPeriodEnd: new Date(data.currentPeriodEnd),
      },
    });

    // Extend license expiration
    await this.licenseService.setExpiration(subscription.userId, new Date(data.currentPeriodEnd));

    await this.verificationService.invalidateUser(subscription.userId);

    this.logger.log(`Renewal processed: user=${subscription.userId} until ${data.currentPeriodEnd}`);
  }

  async handlePaymentRecovered(data: SubscriptionEventData): Promise<void> {
    const subscription = await this.findSubscription(data.subscriptionId);
    if (!subscription) return;

    // past_due -> active
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'active',
        currentPeriodEnd: new Date(data.currentPeriodEnd),
      },
    });

    await this.verificationService.invalidateUser(subscription.userId);

    this.eventEmitter.emit('subscription.recovered', {
      userId: subscription.userId,
    });

    this.logger.log(`Payment recovered: user=${subscription.userId}`);
  }

  // ─── Subscription Status Resolution ─────────────────────────────

  /**
   * Resolve the current subscription status for a user.
   *
   * Strategy:
   * 1. For internal subscriptions (free tier, trial), use local DB only.
   * 2. For external subscriptions, prefer local DB (updated by webhooks).
   * 3. If caller requests fresh data, query the payment provider API.
   */
  async getSubscriptionStatus(userId: string, options?: { forceSync?: boolean }): Promise<SubscriptionStatus> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      return {
        plan: 'community',
        status: 'none',
        requiresSync: false,
      };
    }

    // Internal subscriptions (trials started without payment)
    if (subscription.externalSubscriptionId.startsWith('internal_')) {
      return {
        plan: subscription.planSlug,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        trialEnd: subscription.trialEnd ?? undefined,
        requiresSync: false,
      };
    }

    // External subscriptions -- local DB is source of truth (updated by webhooks)
    // Only sync if explicitly requested (e.g., user-initiated reconciliation)
    return {
      plan: subscription.planSlug,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      trialEnd: subscription.trialEnd ?? undefined,
      canceledAt: subscription.canceledAt ?? undefined,
      requiresSync: options?.forceSync ?? false,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private async findSubscription(externalSubscriptionId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { externalSubscriptionId },
    });

    if (!subscription) {
      this.logger.warn(`Subscription not found: ${externalSubscriptionId}`);
    }

    return subscription;
  }

  private mapPriceIdToPlan(priceId: string): string {
    const plan = PRICE_TO_PLAN_MAP[priceId];

    if (!plan) {
      this.logger.warn(`Unknown price ID: ${priceId}, defaulting to community`);
      return 'community';
    }

    return plan;
  }
}

// ─── Types ──────────────────────────────────────────────────────

export interface SubscriptionStatus {
  plan: string;
  status: string;
  currentPeriodEnd?: Date;
  trialEnd?: Date;
  canceledAt?: Date;
  requiresSync: boolean;
}
```

## Price-to-Plan Mapping

```typescript
// src/config/pricing.config.ts

/**
 * Maps payment provider price IDs to internal plan slugs.
 * Use environment variables for sandbox vs production IDs.
 */
export const PRICE_TO_PLAN_MAP: Record<string, string> = {
  // Monthly prices
  [process.env['PRICE_PRO_MONTHLY'] ?? 'pri_pro_monthly']: 'pro',
  [process.env['PRICE_ENTERPRISE_MONTHLY'] ?? 'pri_ent_monthly']: 'enterprise',

  // Yearly prices
  [process.env['PRICE_PRO_YEARLY'] ?? 'pri_pro_yearly']: 'pro',
  [process.env['PRICE_ENTERPRISE_YEARLY'] ?? 'pri_ent_yearly']: 'enterprise',
};
```

## Internal Events

The subscription service emits internal events via `EventEmitter2` for decoupled side-effects.

| Event                    | Payload                               | Typical Listeners                  |
| ------------------------ | ------------------------------------- | ---------------------------------- |
| `subscription.created`   | userId, plan, isTrial, subscriptionId | Welcome email, analytics, SSE push |
| `subscription.activated` | userId, plan                          | Trial-converted email, analytics   |
| `subscription.updated`   | userId, oldPlan, newPlan              | Plan-change email, feature unlock  |
| `subscription.canceled`  | userId, plan, accessUntil             | Cancellation email, exit survey    |
| `subscription.past_due`  | userId, plan                          | Dunning email, in-app warning      |
| `subscription.paused`    | userId                                | Pause confirmation email           |
| `subscription.resumed`   | userId                                | Resume confirmation email          |
| `subscription.recovered` | userId                                | Payment recovered email            |

### Event Listener Example

```typescript
// src/listeners/subscription-email.listener.ts
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class SubscriptionEmailListener {
  constructor(private readonly emailService: EmailService) {}

  @OnEvent('subscription.created')
  async onCreated(payload: { userId: string; plan: string; isTrial: boolean }) {
    if (payload.isTrial) {
      await this.emailService.sendTrialWelcome(payload.userId, payload.plan);
    } else {
      await this.emailService.sendSubscriptionWelcome(payload.userId, payload.plan);
    }
  }

  @OnEvent('subscription.canceled')
  async onCanceled(payload: { userId: string; accessUntil: Date }) {
    await this.emailService.sendCancellationConfirmation(payload.userId, payload.accessUntil);
  }

  @OnEvent('subscription.past_due')
  async onPastDue(payload: { userId: string }) {
    await this.emailService.sendPaymentFailedNotice(payload.userId);
  }
}
```

## NestJS Module Registration

```typescript
// src/licensing/licensing.module.ts
import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SubscriptionService } from './services/subscription.service';
import { LicenseService } from './services/license.service';
import { LicenseVerificationService } from './services/license-verification.service';
import { LicenseController } from './controllers/license.controller';
import { SubscriptionEmailListener } from './listeners/subscription-email.listener';

@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [SubscriptionService, LicenseService, LicenseVerificationService, SubscriptionEmailListener],
  controllers: [LicenseController],
  exports: [SubscriptionService, LicenseService, LicenseVerificationService],
})
export class LicensingModule {}
```
