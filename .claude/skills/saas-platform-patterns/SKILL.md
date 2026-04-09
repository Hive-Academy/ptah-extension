---
name: saas-platform-patterns
description: 'SaaS platform business patterns for NestJS applications implementing monetization, licensing, subscription management, and checkout flows. Use when designing freemium/trial/paid tier models, implementing license key generation and verification, building subscription state machines driven by payment webhooks, setting up pre-checkout validation and customer portal integration, managing trial periods with auto-downgrade, or implementing plan configuration and pricing architecture. Covers the full SaaS lifecycle from free tier through paid subscription management.'
---

# SaaS Platform Patterns

Patterns for turning a NestJS backend into a monetizable SaaS platform. These patterns cover the **business layer** that sits above payment provider integration (Stripe, Paddle, LemonSqueezy, etc.) and below the API surface. Provider-agnostic by design -- swap payment providers without rewriting business logic.

## Monetization Models

| Model         | Description                                | Complexity | Best For                               |
| ------------- | ------------------------------------------ | ---------- | -------------------------------------- |
| Freemium      | Free tier + paid tiers with feature gating | Medium     | Developer tools, productivity apps     |
| Trial-to-Paid | Time-limited full access, then paywall     | Low        | B2B, enterprise software               |
| Usage-Based   | Pay per API call, storage, or compute      | High       | APIs, infrastructure, cloud tools      |
| Seat-Based    | Per-user pricing within an organization    | Medium     | Team collaboration, project management |

Most SaaS products combine models (e.g., freemium + seat-based). Start with the simplest model that validates your pricing, then layer complexity.

## Architecture Overview

```
+-------------------------------------------------------+
|  Plan Configuration                                    |
|  Static tier definitions, feature flags, pricing       |
|  plans.config.ts                                       |
+---------------------------+---------------------------+
                            |
+---------------------------v---------------------------+
|  License System                                       |
|  Key generation, verification, status tracking        |
|  license.service.ts + License model                   |
+---------------------------+---------------------------+
                            |
+---------------------------v---------------------------+
|  Subscription Engine                                  |
|  State machine driven by payment webhooks             |
|  subscription.service.ts + Subscription model         |
+---------------------------+---------------------------+
                            |
+---------------------------v---------------------------+
|  Checkout Flow                                        |
|  Pre-checkout validation, portal session, price map   |
|  checkout.service.ts                                  |
+---------------------------+---------------------------+
                            |
+---------------------------v---------------------------+
|  Trial Manager                                        |
|  Period tracking, reminder emails, auto-downgrade     |
|  trial.service.ts (or within subscription.service)    |
+-------------------------------------------------------+
```

**Data flows downward through webhooks**: Payment provider emits events, the webhook layer (see `webhook-architecture` skill) routes them into the subscription engine, which updates licenses and triggers side-effects (emails, SSE pushes, audit logs).

## Quick Start: Freemium Model

### 1. Define Plans

```typescript
// src/config/plans.config.ts
export interface PlanDefinition {
  readonly name: string;
  readonly slug: string;
  readonly monthlyPrice: number;
  readonly yearlyPrice: number;
  readonly features: readonly string[];
  readonly limits: Readonly<Record<string, number>>;
}

export const PLANS = {
  community: {
    name: 'Community',
    slug: 'community',
    monthlyPrice: 0,
    yearlyPrice: 0,
    features: ['basic_chat', 'community_support'],
    limits: { messages_per_day: 50, storage_mb: 100 },
  },
  pro: {
    name: 'Pro',
    slug: 'pro',
    monthlyPrice: 9,
    yearlyPrice: 90,
    features: ['basic_chat', 'advanced_chat', 'priority_support', 'api_access'],
    limits: { messages_per_day: 1000, storage_mb: 10_000 },
  },
  enterprise: {
    name: 'Enterprise',
    slug: 'enterprise',
    monthlyPrice: 49,
    yearlyPrice: 490,
    features: ['basic_chat', 'advanced_chat', 'priority_support', 'api_access', 'sso', 'audit_log', 'custom_branding'],
    limits: { messages_per_day: -1, storage_mb: -1 }, // -1 = unlimited
  },
} as const satisfies Record<string, PlanDefinition>;

export type PlanSlug = keyof typeof PLANS;
```

### 2. Generate License Keys

```typescript
// src/services/license.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'crypto';

@Injectable()
export class LicenseService {
  private readonly logger = new Logger(LicenseService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createLicense(userId: string, plan: string, createdBy: string): Promise<string> {
    // Revoke existing active licenses
    await this.prisma.license.updateMany({
      where: { userId, status: 'active' },
      data: { status: 'revoked' },
    });

    const licenseKey = `lic_${randomBytes(32).toString('hex')}`;

    await this.prisma.license.create({
      data: { userId, licenseKey, plan, status: 'active', createdBy },
    });

    this.logger.log(`License created for user ${userId}, plan: ${plan}`);
    return licenseKey;
  }

  async verify(licenseKey: string) {
    const license = await this.prisma.license.findUnique({
      where: { licenseKey },
    });

    if (!license || license.status !== 'active') {
      return { valid: false, plan: 'community' };
    }

    if (license.expiresAt && license.expiresAt < new Date()) {
      await this.prisma.license.update({
        where: { id: license.id },
        data: { status: 'expired' },
      });
      return { valid: false, plan: 'community' };
    }

    return { valid: true, plan: license.plan, expiresAt: license.expiresAt };
  }
}
```

### 3. Handle Subscription Webhooks

```typescript
// src/services/subscription.service.ts (excerpt)
async handleSubscriptionCreated(data: SubscriptionEventData): Promise<void> {
  const plan = this.mapPriceIdToPlan(data.priceId);

  // Upsert user
  const user = await this.prisma.user.upsert({
    where: { email: data.customerEmail },
    update: { externalCustomerId: data.customerId },
    create: { email: data.customerEmail, externalCustomerId: data.customerId },
  });

  // Create subscription record
  await this.prisma.subscription.create({
    data: {
      userId: user.id,
      externalSubscriptionId: data.subscriptionId,
      externalCustomerId: data.customerId,
      status: data.trialEnd ? 'trialing' : 'active',
      priceId: data.priceId,
      currentPeriodEnd: new Date(data.currentPeriodEnd),
      trialEnd: data.trialEnd ? new Date(data.trialEnd) : null,
    },
  });

  // Provision license
  await this.licenseService.createLicense(user.id, plan, `webhook_${data.eventId}`);
}
```

## Module Structure

```
libs/
├── shared/
│   ├── licensing/
│   │   ├── config/
│   │   │   └── plans.config.ts         # Tier definitions
│   │   ├── services/
│   │   │   ├── license.service.ts       # Key generation and verification
│   │   │   ├── subscription.service.ts  # State machine and webhook handlers
│   │   │   ├── checkout.service.ts      # Pre-checkout and portal
│   │   │   └── trial.service.ts         # Trial period management
│   │   ├── controllers/
│   │   │   ├── license.controller.ts    # Public verification endpoint
│   │   │   └── subscription.controller.ts # Checkout and portal endpoints
│   │   ├── guards/
│   │   │   └── plan.guard.ts            # @RequirePlan() decorator guard
│   │   └── licensing.module.ts
│   └── payments/                        # Payment provider abstraction
│       └── ...                          # (see nestjs-backend-patterns)
```

## Decision Matrix

| Need                              | Pattern                             | Reference                                                                 |
| --------------------------------- | ----------------------------------- | ------------------------------------------------------------------------- |
| Define tiers, features, limits    | Plan configuration + feature gating | [freemium-model.md](references/freemium-model.md)                         |
| Generate and verify license keys  | License lifecycle + status machine  | [license-lifecycle.md](references/license-lifecycle.md)                   |
| React to payment webhooks         | Subscription state machine          | [subscription-state-machine.md](references/subscription-state-machine.md) |
| Checkout, portal, price mapping   | Checkout flow + reconciliation      | [checkout-and-portal.md](references/checkout-and-portal.md)               |
| Webhook processing infrastructure | 3-layer webhook architecture        | See `webhook-architecture` skill                                          |
| Payment provider abstraction      | Provider pattern                    | See `nestjs-backend-patterns` skill                                       |

## Integration with Other Skills

- **webhook-architecture**: Provides the HTTP layer that receives payment events. The subscription state machine in this skill is the **business service** (Layer 3) that webhook routing invokes.
- **nestjs-backend-patterns**: Provides the provider pattern for swappable payment SDKs. This skill consumes the abstract payment client.
- **nx-workspace-architect**: Guides library placement. Licensing lives in `shared/licensing`, payment adapters in `shared/payments`.

## Anti-Patterns

| Anti-Pattern                                  | Why It Fails                          | Do Instead                                          |
| --------------------------------------------- | ------------------------------------- | --------------------------------------------------- |
| Storing plan details in DB                    | Schema migrations for pricing changes | Static config file, deploy to change plans          |
| Trusting client-side feature flags            | Users can modify frontend flags       | Always verify plan server-side via guard or service |
| Checking subscription status on every request | Hammers payment API, adds latency     | Cache locally, sync on webhook events               |
| Coupling business logic to payment provider   | Cannot switch providers               | Abstract via interface, provider-specific adapters  |
| Skipping idempotency on webhooks              | Duplicate charges, duplicate licenses | Deduplicate by event ID (see webhook-architecture)  |

## References

Load these for detailed implementation guidance:

- [freemium-model.md](references/freemium-model.md) - Tier architecture, feature gating, trial management, upgrade/downgrade flows
- [license-lifecycle.md](references/license-lifecycle.md) - Key generation, Prisma schema, status machine, verification endpoint, provisioning
- [subscription-state-machine.md](references/subscription-state-machine.md) - Subscription model, state transitions, webhook handlers, status resolution
- [checkout-and-portal.md](references/checkout-and-portal.md) - Pre-checkout validation, checkout flow, portal integration, price mapping, reconciliation
