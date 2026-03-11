# Freemium Model Patterns

## Overview

The freemium model offers a free tier alongside paid tiers. Revenue comes from converting free users to paid plans through feature gating, usage limits, and trial periods. This reference covers tier architecture, feature gating mechanisms, trial management, and upgrade/downgrade flows.

## Tier Architecture

### Plan Configuration Pattern

Define plans as a static configuration file rather than database records. This keeps pricing changes in version control, avoids schema migrations for plan tweaks, and enables type-safe feature checks at compile time.

```typescript
// src/config/plans.config.ts

/** Feature flags available across all plans */
export const FEATURES = {
  BASIC_CHAT: 'basic_chat',
  ADVANCED_CHAT: 'advanced_chat',
  FILE_UPLOAD: 'file_upload',
  API_ACCESS: 'api_access',
  PRIORITY_SUPPORT: 'priority_support',
  SSO: 'sso',
  AUDIT_LOG: 'audit_log',
  CUSTOM_BRANDING: 'custom_branding',
  TEAM_MANAGEMENT: 'team_management',
} as const;

export type Feature = (typeof FEATURES)[keyof typeof FEATURES];

/** Usage limits -- use -1 for unlimited */
export interface PlanLimits {
  readonly messagesPerDay: number;
  readonly storageMb: number;
  readonly teamMembers: number;
  readonly apiCallsPerMonth: number;
}

export interface PlanDefinition {
  readonly name: string;
  readonly slug: string;
  readonly monthlyPrice: number;
  readonly yearlyPrice: number;
  readonly trialDays: number;
  readonly features: readonly Feature[];
  readonly limits: PlanLimits;
}

export const PLANS = {
  community: {
    name: 'Community',
    slug: 'community',
    monthlyPrice: 0,
    yearlyPrice: 0,
    trialDays: 0,
    features: [FEATURES.BASIC_CHAT],
    limits: {
      messagesPerDay: 50,
      storageMb: 100,
      teamMembers: 1,
      apiCallsPerMonth: 0,
    },
  },
  pro: {
    name: 'Pro',
    slug: 'pro',
    monthlyPrice: 9,
    yearlyPrice: 90,
    trialDays: 14,
    features: [FEATURES.BASIC_CHAT, FEATURES.ADVANCED_CHAT, FEATURES.FILE_UPLOAD, FEATURES.API_ACCESS, FEATURES.PRIORITY_SUPPORT],
    limits: {
      messagesPerDay: 1000,
      storageMb: 10_000,
      teamMembers: 5,
      apiCallsPerMonth: 50_000,
    },
  },
  enterprise: {
    name: 'Enterprise',
    slug: 'enterprise',
    monthlyPrice: 49,
    yearlyPrice: 490,
    trialDays: 14,
    features: [FEATURES.BASIC_CHAT, FEATURES.ADVANCED_CHAT, FEATURES.FILE_UPLOAD, FEATURES.API_ACCESS, FEATURES.PRIORITY_SUPPORT, FEATURES.SSO, FEATURES.AUDIT_LOG, FEATURES.CUSTOM_BRANDING, FEATURES.TEAM_MANAGEMENT],
    limits: {
      messagesPerDay: -1,
      storageMb: -1,
      teamMembers: -1,
      apiCallsPerMonth: -1,
    },
  },
} as const satisfies Record<string, PlanDefinition>;

export type PlanSlug = keyof typeof PLANS;

/** Helper to resolve plan definition from slug, with fallback to community */
export function getPlanDefinition(slug: string): PlanDefinition {
  return PLANS[slug as PlanSlug] ?? PLANS.community;
}
```

### Plan Service

Centralizes plan lookups and feature checks. All feature gating flows through this service.

```typescript
// src/services/plan.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PLANS, PlanSlug, Feature, getPlanDefinition } from '../config/plans.config';

@Injectable()
export class PlanService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve the active plan slug for a user */
  async getUserPlan(userId: string): Promise<PlanSlug> {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: ['active', 'trialing'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      return 'community';
    }

    // Strip trial_ prefix if present (trial_pro -> pro)
    const plan = subscription.planSlug.replace(/^trial_/, '') as PlanSlug;
    return plan in PLANS ? plan : 'community';
  }

  /** Check if a user's plan includes a specific feature */
  async hasFeature(userId: string, feature: Feature): Promise<boolean> {
    const planSlug = await this.getUserPlan(userId);
    const plan = getPlanDefinition(planSlug);
    return plan.features.includes(feature);
  }

  /** Check if a user is within a specific usage limit */
  async checkLimit(userId: string, limitKey: keyof PlanDefinition['limits'], currentUsage: number): Promise<boolean> {
    const planSlug = await this.getUserPlan(userId);
    const plan = getPlanDefinition(planSlug);
    const limit = plan.limits[limitKey];
    return limit === -1 || currentUsage < limit; // -1 = unlimited
  }

  /** Get all plan definitions for display (pricing page, settings) */
  getAllPlans(): PlanDefinition[] {
    return Object.values(PLANS);
  }
}
```

## Feature Gating

### Approach 1: Guard-Based (Declarative)

Best for protecting entire endpoints or controllers. Attach to routes with a decorator.

```typescript
// src/guards/plan.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanService } from '../services/plan.service';
import { Feature } from '../config/plans.config';

export const REQUIRED_FEATURE_KEY = 'requiredFeature';

/** Decorator: @RequireFeature(FEATURES.API_ACCESS) */
export const RequireFeature = (feature: Feature) => Reflect.metadata(REQUIRED_FEATURE_KEY, feature) as MethodDecorator & ClassDecorator;

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly planService: PlanService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.getAllAndOverride<Feature>(REQUIRED_FEATURE_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredFeature) {
      return true; // No feature requirement, allow access
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.sub;

    if (!userId) {
      throw new ForbiddenException('Authentication required');
    }

    const hasAccess = await this.planService.hasFeature(userId, requiredFeature);

    if (!hasAccess) {
      throw new ForbiddenException(`Your current plan does not include the "${requiredFeature}" feature. Please upgrade to access this functionality.`);
    }

    return true;
  }
}
```

Usage:

```typescript
// src/controllers/api.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PlanGuard, RequireFeature } from '../guards/plan.guard';
import { FEATURES } from '../config/plans.config';

@Controller('api')
@UseGuards(JwtAuthGuard, PlanGuard)
export class ApiController {
  @Get('data')
  @RequireFeature(FEATURES.API_ACCESS)
  async getData() {
    return { data: 'premium content' };
  }

  @Get('audit')
  @RequireFeature(FEATURES.AUDIT_LOG)
  async getAuditLog() {
    return { logs: [] };
  }
}
```

### Approach 2: Service-Based (Imperative)

Best for conditional logic within a service method where the response varies by plan rather than being fully blocked.

```typescript
// In any service
async generateReport(userId: string): Promise<Report> {
  const hasAdvanced = await this.planService.hasFeature(userId, FEATURES.ADVANCED_CHAT);

  if (hasAdvanced) {
    return this.buildDetailedReport(userId);
  }

  return this.buildBasicReport(userId);
}
```

### Approach 3: Frontend Feature Flags

Send the user's feature set with authentication tokens so the frontend can show/hide UI elements. **Always enforce server-side** -- frontend flags are for UX only.

```typescript
// In auth response or user profile endpoint
async getUserProfile(userId: string) {
  const planSlug = await this.planService.getUserPlan(userId);
  const plan = getPlanDefinition(planSlug);

  return {
    id: userId,
    plan: planSlug,
    features: plan.features,
    limits: plan.limits,
  };
}
```

Frontend usage (framework-agnostic):

```typescript
// Frontend feature check
function canAccess(feature: string): boolean {
  return currentUser.features.includes(feature);
}

// Conditionally render upgrade prompt
if (!canAccess('api_access')) {
  showUpgradePrompt('Upgrade to Pro for API access');
}
```

## Trial Period Management

### Trial Configuration

Trials grant temporary access to a paid plan. Configuration lives in the plan definition (`trialDays` field). Trials are tracked via a `trial_` prefix on the plan slug and a `trialEnd` timestamp on the subscription.

### Trial Start

Trials begin either on signup (automatic) or on first premium action (manual trigger).

```typescript
// src/services/trial.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PLANS, PlanSlug } from '../config/plans.config';
import { LicenseService } from './license.service';

@Injectable()
export class TrialService {
  private readonly logger = new Logger(TrialService.name);

  constructor(private readonly prisma: PrismaService, private readonly licenseService: LicenseService) {}

  /** Start a trial for a user on a specific plan */
  async startTrial(userId: string, planSlug: PlanSlug): Promise<void> {
    const plan = PLANS[planSlug];
    if (!plan || plan.trialDays === 0) {
      this.logger.warn(`Plan ${planSlug} does not support trials`);
      return;
    }

    // Check if user already had a trial for this plan
    const existingTrial = await this.prisma.subscription.findFirst({
      where: { userId, planSlug: `trial_${planSlug}` },
    });

    if (existingTrial) {
      this.logger.warn(`User ${userId} already used trial for ${planSlug}`);
      return;
    }

    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + plan.trialDays);

    // Create trial subscription (internal, no external payment ID)
    await this.prisma.subscription.create({
      data: {
        userId,
        externalSubscriptionId: `internal_trial_${userId}_${planSlug}`,
        externalCustomerId: `internal_${userId}`,
        status: 'trialing',
        planSlug: `trial_${planSlug}`,
        priceId: 'trial',
        currentPeriodEnd: trialEnd,
        trialEnd,
      },
    });

    // Provision trial license
    await this.licenseService.createLicense(userId, `trial_${planSlug}`, 'trial_start');

    this.logger.log(`Trial started for user ${userId}: ${planSlug} until ${trialEnd.toISOString()}`);
  }

  /** Check how many days remain in a user's trial */
  async getTrialDaysRemaining(userId: string): Promise<number | null> {
    const trial = await this.prisma.subscription.findFirst({
      where: { userId, status: 'trialing' },
    });

    if (!trial?.trialEnd) return null;

    const now = new Date();
    const diffMs = trial.trialEnd.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }
}
```

### Trial Reminder Schedule

Send automated emails as the trial approaches expiration. Use a cron job or scheduled task.

```typescript
// src/tasks/trial-reminder.task.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

interface ReminderWindow {
  readonly daysBeforeExpiry: number;
  readonly templateId: string;
}

const REMINDER_SCHEDULE: readonly ReminderWindow[] = [
  { daysBeforeExpiry: 7, templateId: 'trial_7day_reminder' },
  { daysBeforeExpiry: 3, templateId: 'trial_3day_reminder' },
  { daysBeforeExpiry: 1, templateId: 'trial_1day_reminder' },
  { daysBeforeExpiry: 0, templateId: 'trial_expired' },
];

@Injectable()
export class TrialReminderTask {
  private readonly logger = new Logger(TrialReminderTask.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async checkTrialReminders(): Promise<void> {
    for (const window of REMINDER_SCHEDULE) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + window.daysBeforeExpiry);

      // Find trials expiring on target date that haven't received this reminder
      const trials = await this.prisma.subscription.findMany({
        where: {
          status: 'trialing',
          trialEnd: {
            gte: new Date(targetDate.setHours(0, 0, 0, 0)),
            lt: new Date(targetDate.setHours(23, 59, 59, 999)),
          },
        },
        include: { user: true },
      });

      for (const trial of trials) {
        const alreadySent = await this.prisma.trialReminder.findFirst({
          where: { userId: trial.userId, templateId: window.templateId },
        });

        if (!alreadySent) {
          // Send email (via your email service)
          this.logger.log(`Sending ${window.templateId} to ${trial.user.email}`);

          await this.prisma.trialReminder.create({
            data: {
              userId: trial.userId,
              templateId: window.templateId,
              sentAt: new Date(),
            },
          });
        }
      }
    }
  }
}
```

### Auto-Downgrade on Trial Expiry

```typescript
// src/tasks/trial-expiry.task.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { LicenseService } from '../services/license.service';

@Injectable()
export class TrialExpiryTask {
  private readonly logger = new Logger(TrialExpiryTask.name);

  constructor(private readonly prisma: PrismaService, private readonly licenseService: LicenseService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async expireTrials(): Promise<void> {
    const expiredTrials = await this.prisma.subscription.findMany({
      where: {
        status: 'trialing',
        trialEnd: { lt: new Date() },
      },
    });

    for (const trial of expiredTrials) {
      // Expire the trial subscription
      await this.prisma.subscription.update({
        where: { id: trial.id },
        data: { status: 'expired' },
      });

      // Downgrade license to community
      await this.licenseService.createLicense(trial.userId, 'community', 'trial_expired');

      this.logger.log(`Trial expired, downgraded user ${trial.userId} to community`);
    }
  }
}
```

## Upgrade and Downgrade Flows

### Upgrade Flow

```
User clicks "Upgrade to Pro"
    |
    v
POST /subscriptions/validate-checkout { planSlug: 'pro' }
    |-- Check: no active paid subscription (prevent duplicates)
    |-- Check: plan is valid and available
    |-- Return: { eligible: true, checkoutUrl: '...' }
    |
    v
Frontend redirects to payment provider checkout
    |
    v
Payment provider processes payment
    |
    v
POST /webhooks/payments (subscription.created event)
    |-- Subscription engine creates record
    |-- License service provisions new key
    |-- Old trial/community license revoked
    |
    v
User is now on Pro plan
```

### Downgrade Flow

```
User clicks "Cancel subscription"
    |
    v
POST /subscriptions/cancel
    |-- Call payment provider cancel API
    |-- Provider sets subscription to cancel at period end
    |
    v
POST /webhooks/payments (subscription.canceled event)
    |-- Set local status to 'canceled'
    |-- Keep access until currentPeriodEnd (grace period)
    |
    v
Period ends (detected by cron or next webhook)
    |-- Downgrade license to community
    |-- User loses premium features
```

### Grace Period Access

During the grace period between cancellation and period end, the user retains full access to their paid features.

```typescript
/** Check if user still has paid access (including grace period) */
async hasActiveAccess(userId: string): Promise<boolean> {
  const subscription = await this.prisma.subscription.findFirst({
    where: {
      userId,
      status: { in: ['active', 'trialing', 'canceled'] },
      currentPeriodEnd: { gt: new Date() }, // Still within paid period
    },
  });

  return subscription !== null;
}
```

## Prisma Schema Additions

```prisma
model TrialReminder {
  id         String   @id @default(uuid())
  userId     String
  templateId String   // trial_7day_reminder, trial_3day_reminder, etc.
  sentAt     DateTime
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, templateId])
}
```
