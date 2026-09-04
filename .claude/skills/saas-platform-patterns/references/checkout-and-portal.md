# Checkout and Portal Patterns

## Overview

This reference covers the endpoints and flows that sit between your frontend and your payment provider: pre-checkout validation, the checkout redirect flow, customer portal sessions for self-service billing management, price ID mapping, and user-initiated reconciliation for when webhooks are delayed.

## Pre-Checkout Validation

Before redirecting a user to the payment provider's checkout page, validate server-side that the user is eligible. This prevents duplicate subscriptions, invalid plan requests, and unnecessary checkout sessions.

```typescript
// src/services/checkout.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PLANS, PlanSlug } from '../config/plans.config';

export interface CheckoutValidationResult {
  eligible: boolean;
  reason?: string;
  checkoutUrl?: string;
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService // Inject your payment provider service (see nestjs-backend-patterns) // private readonly paymentService: PaymentService,
  ) {}

  /**
   * Validate that a user can proceed to checkout for a given plan.
   * Returns eligibility status and, if eligible, a checkout URL.
   */
  async validateCheckout(userId: string, planSlug: PlanSlug, billingInterval: 'monthly' | 'yearly'): Promise<CheckoutValidationResult> {
    // 1. Validate the requested plan exists
    const plan = PLANS[planSlug];
    if (!plan) {
      return { eligible: false, reason: 'Invalid plan selected.' };
    }

    if (plan.monthlyPrice === 0) {
      return { eligible: false, reason: 'Cannot checkout for a free plan.' };
    }

    // 2. Check for existing active subscription
    const existingSubscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ['active', 'trialing'] },
        // Exclude internal trial subscriptions
        NOT: { externalSubscriptionId: { startsWith: 'internal_' } },
      },
    });

    if (existingSubscription) {
      return {
        eligible: false,
        reason: 'You already have an active subscription. Use the billing portal to change your plan.',
      };
    }

    // 3. Check for canceled subscription still in grace period
    const gracePeriodSub = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: 'canceled',
        currentPeriodEnd: { gt: new Date() },
      },
    });

    if (gracePeriodSub) {
      return {
        eligible: false,
        reason: 'Your previous subscription is still active until the end of the billing period. Resubscribe after it expires, or use the billing portal to resume.',
      };
    }

    // 4. Get or create payment provider customer
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return { eligible: false, reason: 'User not found.' };
    }

    // 5. Generate checkout URL
    // Replace with your payment provider's checkout session creation
    const checkoutUrl = await this.createCheckoutSession(user, planSlug, billingInterval);

    this.logger.log(`Checkout validated: user=${userId} plan=${planSlug} interval=${billingInterval}`);

    return { eligible: true, checkoutUrl };
  }

  /**
   * Create a checkout session with the payment provider.
   * This is provider-specific -- adapt to your SDK.
   */
  private async createCheckoutSession(user: { id: string; email: string; externalCustomerId?: string | null }, planSlug: PlanSlug, billingInterval: 'monthly' | 'yearly'): Promise<string> {
    // Example: Generic payment provider SDK call
    // const session = await this.paymentService.createCheckout({
    //   customerEmail: user.email,
    //   customerId: user.externalCustomerId,
    //   priceId: this.resolvePriceId(planSlug, billingInterval),
    //   successUrl: `${process.env['APP_URL']}/subscription/success`,
    //   cancelUrl: `${process.env['APP_URL']}/subscription/cancel`,
    //   metadata: { userId: user.id },
    // });
    // return session.url;

    // Placeholder -- replace with real provider call
    throw new Error('Implement createCheckoutSession with your payment provider SDK');
  }

  /**
   * Map internal plan + interval to payment provider price ID.
   */
  private resolvePriceId(planSlug: PlanSlug, interval: 'monthly' | 'yearly'): string {
    const priceIds: Record<string, Record<string, string>> = {
      pro: {
        monthly: process.env['PRICE_PRO_MONTHLY'] ?? '',
        yearly: process.env['PRICE_PRO_YEARLY'] ?? '',
      },
      enterprise: {
        monthly: process.env['PRICE_ENTERPRISE_MONTHLY'] ?? '',
        yearly: process.env['PRICE_ENTERPRISE_YEARLY'] ?? '',
      },
    };

    const priceId = priceIds[planSlug]?.[interval];
    if (!priceId) {
      throw new BadRequestException(`No price configured for ${planSlug}/${interval}`);
    }

    return priceId;
  }
}
```

## Checkout Flow

```
+-------------------+     POST /subscriptions/     +-------------------+
|                   |     validate-checkout         |                   |
|  Frontend         |----------------------------->|  Backend           |
|  (Pricing Page)   |                              |  CheckoutService   |
|                   |<-----------------------------|                   |
+-------------------+     { eligible, checkoutUrl } +-------------------+
        |
        | (if eligible)
        | window.open(checkoutUrl) or redirect
        v
+-------------------+
|  Payment Provider |
|  Checkout Page    |
|  (Stripe/Paddle)  |
+-------------------+
        |
        | User completes payment
        v
+-------------------+     POST /webhooks/payments  +-------------------+
|  Payment Provider |----------------------------->|  Webhook Layer     |
|  (server-to-server)|                             |  (Layer 1 + 2)    |
+-------------------+                              +--------+----------+
                                                            |
                                                            v
                                                   +-------------------+
                                                   |  Subscription     |
                                                   |  Service (Layer 3)|
                                                   |  -> License       |
                                                   |  -> Email         |
                                                   +-------------------+
                                                            |
                                                            v
                                                   +-------------------+
                                                   |  SSE / WebSocket  |
                                                   |  Push to Frontend |
                                                   +-------------------+
```

### Controller

```typescript
// src/controllers/subscription.controller.ts
import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { CheckoutService, CheckoutValidationResult } from '../services/checkout.service';
import { PlanSlug } from '../config/plans.config';

interface ValidateCheckoutDto {
  planSlug: PlanSlug;
  billingInterval: 'monthly' | 'yearly';
}

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post('validate-checkout')
  async validateCheckout(@CurrentUser('sub') userId: string, @Body() dto: ValidateCheckoutDto): Promise<CheckoutValidationResult> {
    return this.checkoutService.validateCheckout(userId, dto.planSlug, dto.billingInterval);
  }

  @Post('portal-session')
  async createPortalSession(@CurrentUser('sub') userId: string): Promise<{ url: string }> {
    const url = await this.checkoutService.createPortalSession(userId);
    return { url };
  }

  @Post('reconcile')
  async reconcile(@CurrentUser('sub') userId: string): Promise<{ synced: boolean; status: string }> {
    return this.checkoutService.reconcileSubscription(userId);
  }
}
```

## Customer Portal Integration

Payment providers offer hosted portals where customers manage billing, update payment methods, change plans, and cancel subscriptions. Generate a short-lived portal session URL and redirect the user.

```typescript
// Add to CheckoutService

/**
 * Create a billing portal session for the user.
 * The portal lets users update payment methods, change plans, and cancel.
 */
async createPortalSession(userId: string): Promise<string> {
  const user = await this.prisma.user.findUnique({ where: { id: userId } });

  if (!user?.externalCustomerId) {
    throw new BadRequestException(
      'No billing account found. Subscribe to a plan first.',
    );
  }

  // Example: Generic payment provider SDK call
  // const session = await this.paymentService.createPortalSession({
  //   customerId: user.externalCustomerId,
  //   returnUrl: `${process.env['APP_URL']}/settings/billing`,
  // });
  // return session.url;

  throw new Error('Implement createPortalSession with your payment provider SDK');
}
```

**Frontend usage:**

```typescript
// Frontend: Open portal in new tab
async function openBillingPortal() {
  const response = await fetch('/api/subscriptions/portal-session', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const { url } = await response.json();
  window.open(url, '_blank');
}
```

**Design decisions:**

| Decision               | Rationale                                                    |
| ---------------------- | ------------------------------------------------------------ |
| Open in new tab        | User stays in your app; portal is a side journey             |
| Short-lived URL        | Portal URLs expire (typically 5 minutes); generate on demand |
| Server-side generation | Customer ID is sensitive; never expose to frontend           |
| Return URL config      | Provider redirects back to your billing settings page        |

## Price ID Mapping

Price IDs are opaque identifiers from your payment provider (e.g., `pri_01abc...` for Paddle, `price_1Abc...` for Stripe). Map them to your internal plan slugs via configuration.

```typescript
// src/config/pricing.config.ts

/**
 * Bidirectional mapping between payment provider price IDs and internal plans.
 *
 * Use environment variables to swap between sandbox and production IDs
 * without code changes.
 */

interface PriceMapping {
  priceId: string;
  planSlug: string;
  interval: 'monthly' | 'yearly';
}

const PRICE_MAPPINGS: readonly PriceMapping[] = [
  {
    priceId: process.env['PRICE_PRO_MONTHLY'] ?? 'pri_pro_monthly_sandbox',
    planSlug: 'pro',
    interval: 'monthly',
  },
  {
    priceId: process.env['PRICE_PRO_YEARLY'] ?? 'pri_pro_yearly_sandbox',
    planSlug: 'pro',
    interval: 'yearly',
  },
  {
    priceId: process.env['PRICE_ENTERPRISE_MONTHLY'] ?? 'pri_ent_monthly_sandbox',
    planSlug: 'enterprise',
    interval: 'monthly',
  },
  {
    priceId: process.env['PRICE_ENTERPRISE_YEARLY'] ?? 'pri_ent_yearly_sandbox',
    planSlug: 'enterprise',
    interval: 'yearly',
  },
];

/** Price ID -> Plan slug (used by webhook handlers) */
export const PRICE_TO_PLAN_MAP: Record<string, string> = Object.fromEntries(PRICE_MAPPINGS.map((m) => [m.priceId, m.planSlug]));

/** Plan slug + interval -> Price ID (used by checkout) */
export function getPriceId(planSlug: string, interval: 'monthly' | 'yearly'): string | undefined {
  return PRICE_MAPPINGS.find((m) => m.planSlug === planSlug && m.interval === interval)?.priceId;
}
```

**Environment variables:**

```bash
# .env.sandbox
PRICE_PRO_MONTHLY=pri_01abc_sandbox
PRICE_PRO_YEARLY=pri_02def_sandbox
PRICE_ENTERPRISE_MONTHLY=pri_03ghi_sandbox
PRICE_ENTERPRISE_YEARLY=pri_04jkl_sandbox

# .env.production
PRICE_PRO_MONTHLY=pri_01abc_live
PRICE_PRO_YEARLY=pri_02def_live
PRICE_ENTERPRISE_MONTHLY=pri_03ghi_live
PRICE_ENTERPRISE_YEARLY=pri_04jkl_live
```

## User-Initiated Reconciliation

Webhooks can be delayed due to provider outages, network issues, or retry queues. Provide an endpoint that lets users trigger a sync between your local database and the payment provider.

```typescript
// Add to CheckoutService

/**
 * User-triggered sync: query payment provider for latest subscription state
 * and update local database if out of sync.
 *
 * Use case: User completed payment but webhook hasn't arrived yet.
 */
async reconcileSubscription(userId: string): Promise<{ synced: boolean; status: string }> {
  const user = await this.prisma.user.findUnique({ where: { id: userId } });

  if (!user?.externalCustomerId) {
    return { synced: false, status: 'no_billing_account' };
  }

  // Query payment provider for current subscription state
  // const providerSub = await this.paymentService.getSubscription(user.externalCustomerId);
  //
  // if (!providerSub) {
  //   return { synced: true, status: 'no_subscription' };
  // }

  // Compare with local state
  const localSub = await this.prisma.subscription.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  // If provider shows active but local doesn't exist or differs, update
  // if (providerSub.status === 'active' && localSub?.status !== 'active') {
  //   await this.prisma.subscription.upsert({
  //     where: { externalSubscriptionId: providerSub.id },
  //     update: {
  //       status: providerSub.status,
  //       currentPeriodEnd: new Date(providerSub.currentPeriodEnd),
  //     },
  //     create: {
  //       userId,
  //       externalSubscriptionId: providerSub.id,
  //       externalCustomerId: user.externalCustomerId,
  //       status: providerSub.status,
  //       planSlug: this.mapPriceIdToPlan(providerSub.priceId),
  //       priceId: providerSub.priceId,
  //       currentPeriodEnd: new Date(providerSub.currentPeriodEnd),
  //     },
  //   });
  //
  //   // Re-provision license
  //   const plan = this.mapPriceIdToPlan(providerSub.priceId);
  //   await this.licenseService.createLicense(userId, plan, 'reconciliation');
  //
  //   return { synced: true, status: providerSub.status };
  // }

  // Placeholder -- replace with real provider call
  return {
    synced: false,
    status: localSub?.status ?? 'none',
  };
}
```

### Frontend Reconciliation UI

```typescript
// Trigger when user reports missing access
async function checkSubscriptionStatus() {
  showLoadingSpinner('Checking subscription status...');

  const response = await fetch('/api/subscriptions/reconcile', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  const result = await response.json();

  if (result.synced) {
    showSuccess('Subscription synced successfully. Please refresh.');
  } else {
    showInfo(`Current status: ${result.status}. If you just paid, please wait a moment and try again.`);
  }
}
```

## Complete Module Registration

```typescript
// src/licensing/licensing.module.ts
import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { CheckoutService } from './services/checkout.service';
import { SubscriptionService } from './services/subscription.service';
import { LicenseService } from './services/license.service';
import { LicenseVerificationService } from './services/license-verification.service';
import { LicenseController } from './controllers/license.controller';
import { SubscriptionController } from './controllers/subscription.controller';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }])],
  providers: [CheckoutService, SubscriptionService, LicenseService, LicenseVerificationService],
  controllers: [LicenseController, SubscriptionController],
  exports: [CheckoutService, SubscriptionService, LicenseService, LicenseVerificationService],
})
export class LicensingModule {}
```

## Security Considerations

| Concern                 | Mitigation                                                               |
| ----------------------- | ------------------------------------------------------------------------ |
| Duplicate subscriptions | Pre-checkout validation checks for existing active subscriptions         |
| Price manipulation      | Price IDs resolved server-side from env config, not from client input    |
| Portal URL leakage      | Short-lived URLs generated on demand; customer ID never sent to frontend |
| Webhook delays          | User-initiated reconciliation endpoint as a fallback                     |
| Rate limiting           | Throttle verification and reconciliation endpoints to prevent abuse      |
| CSRF on checkout        | Validate checkout is POST with auth token; checkout URL is one-time-use  |
