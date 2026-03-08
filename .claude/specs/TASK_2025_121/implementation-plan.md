# Implementation Plan - TASK_2025_121

## Two-Tier Paid Extension Model: Basic + Pro

---

## Executive Summary

This implementation transforms Ptah from a "Free + Pro" model to a "Basic (paid) + Pro (paid)" model where the entire extension requires a valid license to function. The core security requirement is that the extension MUST NOT operate without a valid license.

**Pricing Structure:**

- **Basic Plan**: $3/month, $30/year (14-day trial) - Core visual editor features
- **Pro Plan**: $5/month, $50/year (14-day trial) - Basic + MCP server + all premium features

---

## Codebase Investigation Summary

### Libraries Discovered

| Library/Module               | Purpose                               | Key Files                                                                                               |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/ptah-license-server`   | License verification, Paddle webhooks | `src/config/plans.config.ts`, `src/paddle/paddle.service.ts`, `src/license/services/license.service.ts` |
| `libs/backend/vscode-core`   | VS Code license service, DI tokens    | `src/services/license.service.ts`, `src/di/tokens.ts`                                                   |
| `libs/shared`                | RPC types, branded types              | `src/lib/types/rpc.types.ts`                                                                            |
| `apps/ptah-extension-vscode` | Extension activation, RPC handlers    | `src/main.ts`, `src/services/rpc/handlers/license-rpc.handlers.ts`                                      |
| `apps/ptah-landing-page`     | Pricing UI, checkout flow             | `src/app/pages/pricing/`, `src/environments/`                                                           |

### Current Architecture Patterns

**License Verification Flow (Evidence: `main.ts:143-161`)**

```typescript
// Current pattern - verifies license but doesn't block
const licenseStatus: LicenseStatus = await licenseService.verifyLicense();
if (licenseStatus.valid && licenseStatus.tier !== 'free') {
  // Premium features enabled
} else {
  // Free tier - extension still works
}
```

**LicenseStatus Interface (Evidence: `license.service.ts:21-35`)**

```typescript
export interface LicenseStatus {
  valid: boolean;
  tier: 'free' | 'early_adopter';  // Current tiers
  plan?: { ... };
  expiresAt?: string;
  daysRemaining?: number;
  reason?: 'expired' | 'revoked' | 'not_found';
}
```

**Plan Configuration (Evidence: `plans.config.ts:12-45`)**

```typescript
export const PLANS = {
  free: { ... expiresAfterDays: 14, isPremium: false },
  pro: { ... monthlyPrice: 8, yearlyPrice: 80, isPremium: true }
};
```

**Paddle Price Mapping (Evidence: `paddle.service.ts:665-683`)**

```typescript
private mapPriceIdToPlan(priceId: string | undefined): string {
  // Currently only maps to 'pro' or 'free'
  if (priceId === proMonthlyPriceId || priceId === proYearlyPriceId) {
    return 'pro';
  }
  return 'free';
}
```

---

## Architecture Design

### 1. License Enforcement Architecture

The critical security requirement is that the extension **MUST NOT function without a valid license**. This requires a multi-layer enforcement approach:

```
+------------------------------------------------------------------+
|                    LICENSE ENFORCEMENT LAYERS                      |
+------------------------------------------------------------------+
|                                                                    |
|  Layer 1: Extension Activation Gate (Hard Block)                  |
|  +---------------------------------------------------------+     |
|  | main.ts: Verify license BEFORE initializing services     |     |
|  | - No valid license = Show blocking modal, disable ALL    |     |
|  | - Valid license = Continue normal activation             |     |
|  +---------------------------------------------------------+     |
|                              |                                    |
|                              v                                    |
|  Layer 2: Feature Gate Service (Soft Block)                       |
|  +---------------------------------------------------------+     |
|  | FeatureGateService: Check tier for feature access        |     |
|  | - Basic tier = Core features only                        |     |
|  | - Pro tier = All features                                |     |
|  +---------------------------------------------------------+     |
|                              |                                    |
|                              v                                    |
|  Layer 3: RPC Method Guards (Runtime Block)                       |
|  +---------------------------------------------------------+     |
|  | RPC handlers verify license before executing             |     |
|  | - Prevents bypass via direct RPC calls                   |     |
|  +---------------------------------------------------------+     |
|                              |                                    |
|                              v                                    |
|  Layer 4: Periodic Revalidation (Revocation Check)                |
|  +---------------------------------------------------------+     |
|  | Background revalidation every 1 hour                     |     |
|  | - Catches license revocation/expiration                  |     |
|  | - Triggers blocking modal if license becomes invalid     |     |
|  +---------------------------------------------------------+     |
|                                                                    |
+------------------------------------------------------------------+
```

### 2. License State Machine

```
                    +-------------------+
                    |    NO LICENSE     |
                    |   (Extension      |
                    |    Blocked)       |
                    +--------+----------+
                             |
            Enter License Key|
                             v
+----------------+     +----+------------+     +----------------+
|  TRIAL_BASIC   |     |  TRIAL_PRO     |     |    EXPIRED     |
|  (14 days)     |     |  (14 days)     |     | (All features  |
|  Basic features|     |  All features  |     |   disabled)    |
+-------+--------+     +-------+--------+     +-------+--------+
        |                      |                      ^
        | Trial ends           | Trial ends           | Subscription
        | Payment succeeds     | Payment succeeds     | canceled/expired
        v                      v                      |
+-------+--------+     +-------+--------+             |
|     BASIC      |<----|      PRO       |-------------+
| (Subscription) | Up  | (Subscription) | Down
|                | grade               |  grade
+----------------+     +----------------+
```

### 3. Tier Feature Matrix

| Feature                 | No License | Basic | Pro |
| ----------------------- | ---------- | ----- | --- |
| Extension Activation    | BLOCKED    | YES   | YES |
| Visual Chat Interface   | BLOCKED    | YES   | YES |
| Session History         | BLOCKED    | YES   | YES |
| Session Management      | BLOCKED    | YES   | YES |
| SDK Access (Claude CLI) | BLOCKED    | YES   | YES |
| Permission Management   | BLOCKED    | YES   | YES |
| Real-time Streaming     | BLOCKED    | YES   | YES |
| Basic Workspace Context | BLOCKED    | YES   | YES |
| MCP Server              | BLOCKED    | NO    | YES |
| Workspace Intelligence  | BLOCKED    | NO    | YES |
| OpenRouter Proxy        | BLOCKED    | NO    | YES |
| Custom Tools            | BLOCKED    | NO    | YES |
| Setup Wizard            | BLOCKED    | NO    | YES |
| Real-time Cost Tracking | BLOCKED    | NO    | YES |

---

## Component Specifications

### Component 1: Updated Plan Configuration

**Purpose**: Define Basic and Pro plans with new pricing and features.

**Pattern**: Configuration object (verified from `plans.config.ts:12-45`)

**File**: `apps/ptah-license-server/src/config/plans.config.ts`

**Evidence**:

- Current pattern: `plans.config.ts:12-45`
- Export: `PLANS`, `PlanName`, `getPlanConfig`, `calculateExpirationDate`

**Implementation Pattern**:

```typescript
// Pattern source: plans.config.ts:12-45 (REWRITE)
export const PLANS = {
  basic: {
    name: 'Basic',
    features: ['basic_cli_wrapper', 'session_history', 'permission_management', 'sdk_access', 'real_time_streaming', 'basic_workspace_context'],
    expiresAfterDays: null, // Subscription-based (managed by Paddle)
    monthlyPrice: 3,
    yearlyPrice: 30,
    isPremium: false,
    description: 'Core visual editor for Claude Code',
  },
  pro: {
    name: 'Pro',
    features: ['all_basic_features', 'mcp_server', 'workspace_intelligence', 'openrouter_proxy', 'custom_tools', 'setup_wizard', 'cost_tracking', 'priority_support'],
    expiresAfterDays: null, // Subscription-based (managed by Paddle)
    monthlyPrice: 5,
    yearlyPrice: 50,
    isPremium: true,
    description: 'Full workspace intelligence suite',
  },
} as const;

export type PlanName = keyof typeof PLANS;
```

**Quality Requirements**:

- Remove `free` plan entirely
- Both plans are subscription-based (no expiresAfterDays)
- Feature arrays must match tier feature matrix

**Files Affected**:

- `apps/ptah-license-server/src/config/plans.config.ts` (REWRITE)

---

### Component 2: Updated LicenseStatus Type System

**Purpose**: Support new tier values including trial states.

**Pattern**: TypeScript interface (verified from `license.service.ts:21-35`)

**Files**:

- `libs/backend/vscode-core/src/services/license.service.ts`
- `libs/shared/src/lib/types/rpc.types.ts`

**Evidence**:

- Current interface: `license.service.ts:21-35`
- RPC types: `rpc.types.ts:552-570`

**Implementation Pattern**:

```typescript
// Pattern source: license.service.ts:21-35 (MODIFY)
export interface LicenseStatus {
  valid: boolean;
  tier: 'basic' | 'pro' | 'trial_basic' | 'trial_pro' | 'expired';
  plan?: {
    name: string;
    features: string[];
    isPremium: boolean;
    description: string;
  };
  expiresAt?: string;
  daysRemaining?: number;
  trialActive?: boolean; // NEW: Whether in trial period
  trialDaysRemaining?: number; // NEW: Days left in trial
  reason?: 'expired' | 'revoked' | 'not_found' | 'trial_ended';
}

// Pattern source: rpc.types.ts:552-570 (MODIFY)
export type LicenseTier = 'basic' | 'pro' | 'trial_basic' | 'trial_pro' | 'expired';

export interface LicenseGetStatusResponse {
  valid: boolean;
  tier: LicenseTier;
  isPremium: boolean;
  isBasic: boolean; // NEW: Convenience flag
  daysRemaining: number | null;
  trialActive: boolean; // NEW
  trialDaysRemaining: number | null; // NEW
  plan?: {
    name: string;
    description: string;
    features: string[];
  };
}
```

**Quality Requirements**:

- Remove 'free' and 'early_adopter' from tier union
- Add trial state indicators
- Backward compatibility mapping for existing licenses

**Files Affected**:

- `libs/backend/vscode-core/src/services/license.service.ts` (MODIFY)
- `libs/shared/src/lib/types/rpc.types.ts` (MODIFY)

---

### Component 3: License Enforcement in Extension Activation

**Purpose**: Block extension startup without valid license.

**Pattern**: Early-exit activation pattern (new pattern)

**File**: `apps/ptah-extension-vscode/src/main.ts`

**Evidence**:

- Current activation: `main.ts:16-260`
- License verification: `main.ts:143-161`

**Implementation Pattern**:

```typescript
// Pattern source: main.ts:143-161 (MODIFY - move to BEFORE service init)
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('===== PTAH ACTIVATION START =====');

  try {
    // Step 1: Initialize MINIMAL DI for license check
    console.log('[Activate] Step 1: Minimal DI setup...');
    DIContainer.setupMinimal(context); // NEW: Only license-related services

    // Step 2: CRITICAL - License verification FIRST
    console.log('[Activate] Step 2: License verification (BLOCKING)...');
    const licenseService = DIContainer.resolve<LicenseService>(TOKENS.LICENSE_SERVICE);
    const licenseStatus = await licenseService.verifyLicense();

    if (!licenseStatus.valid) {
      // BLOCK EXTENSION - Show license required UI
      console.log('[Activate] BLOCKED: No valid license');
      await showLicenseRequiredUI(context, licenseStatus);

      // Register ONLY license entry command
      registerLicenseOnlyCommands(context, licenseService);

      // DO NOT continue with normal activation
      return;
    }

    // Step 3: Full DI setup (only if licensed)
    console.log('[Activate] Step 3: Full DI setup (licensed user)...');
    DIContainer.setup(context);

    // ... rest of normal activation flow ...
  }
}

async function showLicenseRequiredUI(
  context: vscode.ExtensionContext,
  status: LicenseStatus
): Promise<void> {
  const message = status.reason === 'expired'
    ? 'Your Ptah subscription has expired. Please renew to continue using the extension.'
    : 'Ptah requires a subscription to use. Start your 14-day free trial today!';

  const actions = ['Start Trial', 'Enter License Key', 'View Pricing'];

  const selection = await vscode.window.showWarningMessage(message, { modal: true }, ...actions);

  if (selection === 'Start Trial') {
    vscode.env.openExternal(vscode.Uri.parse('https://ptah.dev/pricing'));
  } else if (selection === 'Enter License Key') {
    vscode.commands.executeCommand('ptah.enterLicenseKey');
  } else if (selection === 'View Pricing') {
    vscode.env.openExternal(vscode.Uri.parse('https://ptah.dev/pricing'));
  }
}
```

**Quality Requirements**:

- License check MUST occur before any service initialization
- Modal MUST be blocking (cannot be dismissed without action)
- Only license entry command available when blocked
- Retry license verification on license key entry

**Files Affected**:

- `apps/ptah-extension-vscode/src/main.ts` (MODIFY)
- `apps/ptah-extension-vscode/src/di/container.ts` (MODIFY - add setupMinimal)

---

### Component 4: Feature Gate Service

**Purpose**: Centralized feature access control based on license tier.

**Pattern**: Injectable service with feature checking (new service)

**File**: `libs/backend/vscode-core/src/services/feature-gate.service.ts` (CREATE)

**Evidence**:

- Service pattern: `license.service.ts:63-340` (injectable service pattern)
- DI token pattern: `tokens.ts` (TOKENS namespace)

**Implementation Pattern**:

```typescript
// Pattern source: license.service.ts (service pattern)
import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '../';
import type { LicenseService, LicenseStatus } from './license.service';

export type Feature = 'mcp_server' | 'workspace_intelligence' | 'openrouter_proxy' | 'custom_tools' | 'setup_wizard' | 'cost_tracking';

const PRO_ONLY_FEATURES: Feature[] = ['mcp_server', 'workspace_intelligence', 'openrouter_proxy', 'custom_tools', 'setup_wizard', 'cost_tracking'];

@injectable()
export class FeatureGateService {
  private cachedStatus: LicenseStatus | null = null;

  constructor(@inject(TOKENS.LICENSE_SERVICE) private readonly licenseService: LicenseService, @inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Check if a feature is enabled for the current license
   */
  async isFeatureEnabled(feature: Feature): Promise<boolean> {
    const status = await this.getLicenseStatus();

    if (!status.valid) {
      return false;
    }

    // Pro-only features
    if (PRO_ONLY_FEATURES.includes(feature)) {
      return status.tier === 'pro' || status.tier === 'trial_pro';
    }

    // All other features available to Basic and Pro
    return true;
  }

  /**
   * Check if user has any valid license (Basic or Pro)
   */
  async hasValidLicense(): Promise<boolean> {
    const status = await this.getLicenseStatus();
    return status.valid;
  }

  /**
   * Check if user has Pro tier (or Pro trial)
   */
  async isProTier(): Promise<boolean> {
    const status = await this.getLicenseStatus();
    return status.tier === 'pro' || status.tier === 'trial_pro';
  }

  private async getLicenseStatus(): Promise<LicenseStatus> {
    if (!this.cachedStatus) {
      this.cachedStatus = await this.licenseService.verifyLicense();
    }
    return this.cachedStatus;
  }

  /**
   * Invalidate cache (called when license changes)
   */
  invalidateCache(): void {
    this.cachedStatus = null;
  }
}
```

**Quality Requirements**:

- Must use cached license status to avoid repeated API calls
- Must invalidate cache on license changes
- Must be injectable via DI container

**Files Affected**:

- `libs/backend/vscode-core/src/services/feature-gate.service.ts` (CREATE)
- `libs/backend/vscode-core/src/di/tokens.ts` (MODIFY - add FEATURE_GATE_SERVICE token)
- `libs/backend/vscode-core/src/index.ts` (MODIFY - export)
- `apps/ptah-extension-vscode/src/di/container.ts` (MODIFY - register)

---

### Component 5: Paddle Service Plan Mapping Update

**Purpose**: Map new Price IDs to Basic and Pro plans.

**Pattern**: Environment variable mapping (verified from `paddle.service.ts:665-683`)

**File**: `apps/ptah-license-server/src/paddle/paddle.service.ts`

**Evidence**:

- Current mapping: `paddle.service.ts:665-683`
- Environment config pattern: `paddle.service.ts:26-28`

**Implementation Pattern**:

```typescript
// Pattern source: paddle.service.ts:665-683 (MODIFY)
private mapPriceIdToPlan(priceId: string | undefined): string {
  if (!priceId) {
    return 'expired'; // No price ID = no valid plan
  }

  // Basic plan price IDs
  const basicMonthlyPriceId = this.configService.get<string>('PADDLE_PRICE_ID_BASIC_MONTHLY');
  const basicYearlyPriceId = this.configService.get<string>('PADDLE_PRICE_ID_BASIC_YEARLY');

  // Pro plan price IDs
  const proMonthlyPriceId = this.configService.get<string>('PADDLE_PRICE_ID_PRO_MONTHLY');
  const proYearlyPriceId = this.configService.get<string>('PADDLE_PRICE_ID_PRO_YEARLY');

  if (priceId === basicMonthlyPriceId || priceId === basicYearlyPriceId) {
    return 'basic';
  }

  if (priceId === proMonthlyPriceId || priceId === proYearlyPriceId) {
    return 'pro';
  }

  this.logger.warn(`Unknown price ID: ${priceId} - defaulting to 'expired'`);
  return 'expired';
}
```

**Quality Requirements**:

- Support 4 Price IDs (Basic monthly/yearly, Pro monthly/yearly)
- Unknown Price IDs result in 'expired' (not 'free')
- Log warnings for unknown Price IDs

**Files Affected**:

- `apps/ptah-license-server/src/paddle/paddle.service.ts` (MODIFY)

---

### Component 6: License Server Verification Update

**Purpose**: Return correct tier and features for Basic/Pro licenses.

**Pattern**: Database lookup with plan config (verified from `license.service.ts:30-88`)

**File**: `apps/ptah-license-server/src/license/services/license.service.ts`

**Evidence**:

- Current implementation: `license.service.ts:30-88`
- Plan config usage: `license.service.ts:78`

**Implementation Pattern**:

```typescript
// Pattern source: license.service.ts:30-88 (MODIFY)
async verifyLicense(licenseKey: string): Promise<{
  valid: boolean;
  tier: 'basic' | 'pro' | 'trial_basic' | 'trial_pro' | 'expired';
  plan?: (typeof PLANS)[keyof typeof PLANS];
  expiresAt?: string;
  daysRemaining?: number;
  trialActive?: boolean;
  trialDaysRemaining?: number;
  reason?: 'expired' | 'revoked' | 'not_found' | 'trial_ended';
}> {
  const license = await this.prisma.license.findUnique({
    where: { licenseKey },
    include: {
      user: {
        include: { subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 } }
      }
    },
  });

  if (!license) {
    return { valid: false, tier: 'expired', reason: 'not_found' };
  }

  if (license.status === 'revoked') {
    return { valid: false, tier: 'expired', reason: 'revoked' };
  }

  if (license.expiresAt && new Date() > license.expiresAt) {
    return { valid: false, tier: 'expired', reason: 'expired' };
  }

  // Determine trial status from subscription
  const subscription = license.user.subscriptions[0];
  const isInTrial = subscription?.status === 'trialing';

  // Map stored plan to tier
  const basePlan = license.plan as 'basic' | 'pro';
  const tier = isInTrial ? `trial_${basePlan}` : basePlan;

  const daysRemaining = license.expiresAt
    ? Math.ceil((license.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : undefined;

  const planConfig = getPlanConfig(basePlan as PlanName);

  return {
    valid: true,
    tier,
    plan: planConfig,
    expiresAt: license.expiresAt?.toISOString(),
    daysRemaining,
    trialActive: isInTrial,
    trialDaysRemaining: isInTrial ? daysRemaining : undefined,
  };
}
```

**Quality Requirements**:

- Return trial_basic/trial_pro for trial subscriptions
- Include subscription status check for trial detection
- Return correct feature list from plan config

**Files Affected**:

- `apps/ptah-license-server/src/license/services/license.service.ts` (MODIFY)

---

### Component 7: Database Schema Update

**Purpose**: Support new plan values in License model.

**Pattern**: Prisma schema (verified from `schema.prisma:54-71`)

**File**: `apps/ptah-license-server/prisma/schema.prisma`

**Evidence**:

- Current schema: `schema.prisma:54-71`
- Plan field: `schema.prisma:59`

**Implementation Pattern**:

```prisma
// Pattern source: schema.prisma:54-71 (MODIFY comment only - schema is flexible)
// License model - stores license keys with plan, status, and expiration
model License {
  id         String    @id @default(uuid()) @db.Uuid
  userId     String    @map("user_id") @db.Uuid
  licenseKey String    @unique @map("license_key")
  plan       String    // "basic" | "pro" | "trial_basic" | "trial_pro"
                       // Legacy: "free" | "early_adopter" (mapped in code)
  status     String    @default("active") // "active" | "expired" | "revoked" | "paused"
  expiresAt  DateTime? @map("expires_at")
  createdAt  DateTime  @default(now()) @map("created_at")
  createdBy  String    @default("admin") @map("created_by")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([licenseKey])
  @@index([userId])
  @@index([status, expiresAt])
  @@map("licenses")
}

// Subscription model - add trialing status
model Subscription {
  id                   String    @id @default(uuid()) @db.Uuid
  userId               String    @map("user_id") @db.Uuid
  paddleSubscriptionId String    @unique @map("paddle_subscription_id")
  paddleCustomerId     String    @map("paddle_customer_id")
  status               String    // "active" | "trialing" | "paused" | "canceled" | "past_due"
  priceId              String    @map("price_id")
  currentPeriodEnd     DateTime  @map("current_period_end")
  trialEnd             DateTime? @map("trial_end") // NEW: Trial end date
  canceledAt           DateTime? @map("canceled_at")
  createdAt            DateTime  @default(now()) @map("created_at")
  updatedAt            DateTime  @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([paddleSubscriptionId])
  @@index([userId])
  @@map("subscriptions")
}
```

**Quality Requirements**:

- No breaking changes to existing data
- Legacy values ("free", "early_adopter") handled in application code
- Add trialEnd field to Subscription model

**Files Affected**:

- `apps/ptah-license-server/prisma/schema.prisma` (MODIFY)

---

### Component 8: Landing Page Pricing UI

**Purpose**: Display Basic and Pro plans with 14-day trial badges.

**Pattern**: Angular component with signal inputs (verified from `pricing-grid.component.ts`)

**Files**:

- `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts`
- `apps/ptah-landing-page/src/app/pages/pricing/models/pricing-plan.interface.ts`

**Evidence**:

- Current grid: `pricing-grid.component.ts:125-444`
- Plan interface: `pricing-plan.interface.ts:1-48`

**Implementation Pattern**:

```typescript
// Pattern source: pricing-plan.interface.ts (MODIFY)
export interface PricingPlan {
  name: string;
  tier: 'basic' | 'pro';  // Remove 'free'
  price: string;
  priceSubtext?: string;
  savings?: string;
  priceId?: string;
  features: string[];
  standoutFeatures?: string[];
  idealFor?: string;
  ctaText: string;
  ctaAction: 'checkout';  // Remove 'download' - always checkout
  highlight?: boolean;
  badge?: string;
  trialDays?: number;     // NEW: Trial period (14 days)
}

// Pattern source: pricing-grid.component.ts (MODIFY)
public readonly basicMonthlyPlan: PricingPlan = {
  name: 'Basic',
  tier: 'basic',
  price: '$3',
  priceSubtext: 'per month',
  priceId: this.paddleConfig.basicPriceIdMonthly,
  idealFor: 'Perfect for individual developers',
  trialDays: 14,
  features: [],
  standoutFeatures: [
    'Beautiful visual interface',
    'Use your Claude Pro/Max subscription',
    'Native VS Code integration',
    'Real-time streaming responses',
    'Session history & management',
    'Basic workspace context',
  ],
  ctaText: 'Start 14-Day Free Trial',
  ctaAction: 'checkout',
};

public readonly proMonthlyPlan: PricingPlan = {
  name: 'Pro',
  tier: 'pro',
  price: '$5',
  priceSubtext: 'per month',
  priceId: this.paddleConfig.proPriceIdMonthly,
  idealFor: 'For serious developers',
  trialDays: 14,
  features: [],
  standoutFeatures: [
    'All Basic features included',
    'Intelligent Setup Wizard',
    'Code Execution MCP Server',
    'Workspace Intelligence (13+ project types)',
    'OpenRouter proxy (200+ models)',
    'Project-adaptive agent generation',
  ],
  ctaText: 'Start 14-Day Free Trial',
  ctaAction: 'checkout',
  highlight: true,
};
```

**Quality Requirements**:

- Remove Free plan card entirely
- Both plans show "14-day free trial" badge
- CTA text emphasizes trial period
- Pro plan highlighted as "Most Popular"

**Files Affected**:

- `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts` (MODIFY)
- `apps/ptah-landing-page/src/app/pages/pricing/components/plan-card.component.ts` (MODIFY)
- `apps/ptah-landing-page/src/app/pages/pricing/models/pricing-plan.interface.ts` (MODIFY)

---

### Component 9: Environment Configuration

**Purpose**: Configure Paddle Price IDs for all 4 price points.

**Pattern**: Environment files (verified from `environment.ts`)

**Files**:

- `apps/ptah-landing-page/src/environments/environment.ts`
- `apps/ptah-landing-page/src/environments/environment.production.ts`

**Evidence**:

- Current config: `environment.ts:22-30`

**Implementation Pattern**:

```typescript
// Pattern source: environment.ts (MODIFY)
paddle: {
  environment: 'sandbox' as const,
  // Basic plan Price IDs
  basicPriceIdMonthly: 'pri_REPLACE_BASIC_MONTHLY',
  basicPriceIdYearly: 'pri_REPLACE_BASIC_YEARLY',
  // Pro plan Price IDs
  proPriceIdMonthly: 'pri_REPLACE_PRO_MONTHLY',
  proPriceIdYearly: 'pri_REPLACE_PRO_YEARLY',
},
```

**Quality Requirements**:

- All 4 Price IDs required
- Placeholder detection must work for all 4
- Both sandbox and production configs

**Files Affected**:

- `apps/ptah-landing-page/src/environments/environment.ts` (MODIFY)
- `apps/ptah-landing-page/src/environments/environment.production.ts` (MODIFY)

---

### Component 10: Graceful Offline Mode with Cache

**Purpose**: Allow extension to work offline with cached license for grace period.

**Pattern**: Extended cache with grace period (enhance existing cache pattern)

**File**: `libs/backend/vscode-core/src/services/license.service.ts`

**Evidence**:

- Current cache: `license.service.ts:68-74`
- Cache TTL: `license.service.ts:68` (1 hour)

**Implementation Pattern**:

```typescript
// Pattern source: license.service.ts:68-74 (MODIFY)
private static readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
private static readonly GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

private cache: {
  status: LicenseStatus | null;
  timestamp: number | null;
  persistedAt: number | null; // NEW: When cache was persisted to storage
} = { status: null, timestamp: null, persistedAt: null };

async verifyLicense(): Promise<LicenseStatus> {
  try {
    // Check in-memory cache first
    if (this.isCacheValid()) {
      return this.cache.status!;
    }

    // Try network verification
    const status = await this.verifyWithServer();
    this.updateCache(status);
    await this.persistCacheToStorage(status); // NEW: Persist for offline
    return status;

  } catch (error) {
    // Network error - check grace period cache
    const persistedCache = await this.loadPersistedCache();

    if (persistedCache && this.isWithinGracePeriod(persistedCache)) {
      this.logger.warn('Using offline cached license (grace period)');
      return persistedCache.status;
    }

    // No valid cache - return invalid
    return { valid: false, tier: 'expired', reason: 'not_found' };
  }
}

private isWithinGracePeriod(cache: PersistedCache): boolean {
  return Date.now() - cache.persistedAt < LicenseService.GRACE_PERIOD_MS;
}
```

**Quality Requirements**:

- 7-day grace period for offline use
- Cache persisted to VS Code storage (survives restarts)
- Clear warning when using offline cache

**Files Affected**:

- `libs/backend/vscode-core/src/services/license.service.ts` (MODIFY)

---

### Component 11: Webhook Handler Trial Support

**Purpose**: Handle subscription.created with trial status.

**Pattern**: Webhook handler (verified from `paddle.service.ts:258-359`)

**File**: `apps/ptah-license-server/src/paddle/paddle.service.ts`

**Evidence**:

- Current handler: `paddle.service.ts:258-359`

**Implementation Pattern**:

```typescript
// Pattern source: paddle.service.ts:258-359 (MODIFY)
async handleSubscriptionCreated(
  data: PaddleSubscriptionDataDto,
  eventId: string
): Promise<{ success: boolean; duplicate?: boolean; licenseId?: string }> {
  // ... existing code ...

  const plan = this.mapPriceIdToPlan(priceId);

  // Determine if in trial based on subscription status
  const isInTrial = data.status === 'trialing';
  const licensePlan = isInTrial ? `trial_${plan}` : plan;
  const trialEnd = data.trial_end ? new Date(data.trial_end) : null;

  const license = await this.prisma.$transaction(async (tx) => {
    // ... existing user creation ...

    // Create license with trial-aware plan
    const newLicense = await tx.license.create({
      data: {
        userId: user.id,
        licenseKey,
        plan: licensePlan,
        status: 'active',
        expiresAt: periodEnd,
        createdBy: `paddle_${eventId}`,
      },
    });

    // Create subscription with trial info
    await tx.subscription.create({
      data: {
        userId: user.id,
        paddleSubscriptionId: subscriptionId,
        paddleCustomerId: customerId,
        status: data.status, // 'trialing' | 'active'
        priceId: priceId || '',
        currentPeriodEnd: periodEnd,
        trialEnd, // NEW: Trial end date
      },
    });

    return newLicense;
  });

  // ... rest of method ...
}
```

**Quality Requirements**:

- Detect trial status from Paddle webhook
- Store trial_basic/trial_pro as plan value
- Track trial end date in subscription

**Files Affected**:

- `apps/ptah-license-server/src/paddle/paddle.service.ts` (MODIFY)

---

## Integration Architecture

### Data Flow Diagram

```
+------------------+     +------------------+     +------------------+
|   VS Code        |     |  License Server  |     |     Paddle       |
|   Extension      |     |                  |     |                  |
+--------+---------+     +--------+---------+     +--------+---------+
         |                        |                        |
         | 1. Verify License      |                        |
         |----------------------->|                        |
         |                        |                        |
         | 2. License Status      |                        |
         |<-----------------------|                        |
         |                        |                        |
         | [If invalid]           |                        |
         | 3. Open Pricing Page   |                        |
         |------------------------------------------->     |
         |                        |                        |
         |                        | 4. Checkout Complete   |
         |                        |<-----------------------|
         |                        |                        |
         |                        | 5. Create License      |
         |                        |----------------------->|
         |                        |                        |
         |                        | 6. Email License Key   |
         |                        |----------------------->|
         |                        |                        |
         | 7. Enter License Key   |                        |
         |----------------------->|                        |
         |                        |                        |
         | 8. Verified + Features |                        |
         |<-----------------------|                        |
         |                        |                        |
         | 9. Extension Unlocked  |                        |
         |                        |                        |
```

### Component Interaction Matrix

| Component          | Interacts With     | Communication Method              |
| ------------------ | ------------------ | --------------------------------- |
| Extension main.ts  | LicenseService     | DI injection                      |
| LicenseService     | License Server     | HTTP POST /api/v1/licenses/verify |
| License Server     | Prisma DB          | Database queries                  |
| License Server     | Paddle             | Webhook handlers                  |
| Landing Page       | Paddle             | Paddle.js checkout                |
| FeatureGateService | LicenseService     | DI injection                      |
| RPC Handlers       | FeatureGateService | DI injection                      |

---

## Migration Strategy

### Existing User Impact Matrix

| User Type           | Current State           | Target State | Action                    |
| ------------------- | ----------------------- | ------------ | ------------------------- |
| early_adopter (Pro) | Active Pro subscription | Pro          | No change (grandfathered) |
| free (Active Trial) | 14-day trial            | trial_basic  | Map to Basic trial        |
| free (Expired)      | Expired                 | expired      | Block until subscribed    |
| No license          | Extension works         | expired      | Block until subscribed    |

### Data Migration

**No database migration required** - the schema uses String for plan field, so it accepts any value. Migration is handled in application code:

```typescript
// In LicenseService.verifyLicense()
function mapLegacyTier(dbPlan: string): LicenseTier {
  switch (dbPlan) {
    case 'early_adopter':
      return 'pro'; // Grandfathered Pro users
    case 'free':
      return 'trial_basic'; // Map free trials to Basic trial
    case 'basic':
    case 'pro':
    case 'trial_basic':
    case 'trial_pro':
      return dbPlan as LicenseTier;
    default:
      return 'expired';
  }
}
```

---

## Security Architecture

### Bypass Prevention

| Attack Vector        | Mitigation                                      |
| -------------------- | ----------------------------------------------- |
| Skip license check   | License check in main.ts BEFORE service init    |
| Modify cached status | Status verified server-side, cache is secondary |
| Direct RPC calls     | RPC handlers check FeatureGateService           |
| Inject fake license  | HMAC signature verification on server           |
| Replay old license   | Expiration date checked, revocation checked     |
| Tamper with storage  | SecretStorage is encrypted by VS Code           |

### Security Requirements Checklist

- [ ] License verification is server-side (not client-only)
- [ ] License key stored in VS Code SecretStorage (encrypted)
- [ ] 7-day grace period only for network failures (not expired licenses)
- [ ] License removal immediately disables features
- [ ] No "try later" fallback - blocked is blocked
- [ ] HMAC signature verification for webhooks
- [ ] Timing-safe comparison for signatures

---

## Testing Strategy

### Unit Tests

| Component           | Test Focus                      |
| ------------------- | ------------------------------- |
| plans.config.ts     | Plan definitions, feature lists |
| LicenseStatus types | Type compatibility              |
| FeatureGateService  | Feature access logic            |
| mapPriceIdToPlan()  | All 4 price ID mappings         |

### Integration Tests

| Test Scenario          | Components Involved                          |
| ---------------------- | -------------------------------------------- |
| New user trial signup  | Landing page -> Paddle -> Webhook -> License |
| Trial expiration       | License server cron -> License status        |
| License verification   | Extension -> License server -> Response      |
| Plan upgrade/downgrade | Paddle webhook -> License update             |

### E2E Tests

| Test Scenario                 | Expected Behavior                            |
| ----------------------------- | -------------------------------------------- |
| Extension with no license     | Modal blocks, only license command available |
| Extension with Basic license  | Core features enabled, Pro features disabled |
| Extension with Pro license    | All features enabled                         |
| License expires while running | Warning shown, features disabled on restart  |
| Offline with valid cache      | Extension works for 7 days                   |

---

## Risk Mitigation

| Risk                       | Probability | Impact | Mitigation                                          |
| -------------------------- | ----------- | ------ | --------------------------------------------------- |
| Users bypass license check | Low         | High   | Server-side validation, multiple enforcement layers |
| Paddle webhook failures    | Low         | High   | Retry mechanism, manual reconciliation              |
| Cache staleness            | Low         | Medium | 1-hour cache TTL, background revalidation           |
| Price ID misconfiguration  | Medium      | High   | Placeholder detection, validation in checkout       |
| User churn from paid model | High        | High   | 14-day trial, competitive pricing                   |

---

## Files Affected Summary

### CREATE

- `libs/backend/vscode-core/src/services/feature-gate.service.ts`

### MODIFY

- `apps/ptah-license-server/src/config/plans.config.ts` (REWRITE)
- `libs/backend/vscode-core/src/services/license.service.ts`
- `libs/shared/src/lib/types/rpc.types.ts`
- `apps/ptah-extension-vscode/src/main.ts`
- `apps/ptah-extension-vscode/src/di/container.ts`
- `libs/backend/vscode-core/src/di/tokens.ts`
- `libs/backend/vscode-core/src/index.ts`
- `apps/ptah-license-server/src/paddle/paddle.service.ts`
- `apps/ptah-license-server/src/license/services/license.service.ts`
- `apps/ptah-license-server/prisma/schema.prisma`
- `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts`
- `apps/ptah-landing-page/src/app/pages/pricing/components/plan-card.component.ts`
- `apps/ptah-landing-page/src/app/pages/pricing/models/pricing-plan.interface.ts`
- `apps/ptah-landing-page/src/environments/environment.ts`
- `apps/ptah-landing-page/src/environments/environment.production.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/license-rpc.handlers.ts`

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: Both frontend-developer AND backend-developer

**Rationale**:

- Backend work: License server updates, Paddle webhook handling, database schema
- Frontend work: Landing page pricing UI, VS Code extension blocking UI
- Integration work: RPC handlers, feature gating service

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 16-24 hours

**Breakdown**:

- Phase 1: Type system and plan config updates (2-3 hours)
- Phase 2: License server updates (4-6 hours)
- Phase 3: Extension enforcement (4-6 hours)
- Phase 4: Landing page UI (2-4 hours)
- Phase 5: Testing and integration (4-5 hours)

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - `TOKENS.LICENSE_SERVICE` from `@ptah-extension/vscode-core`
   - `LicenseStatus` from `@ptah-extension/vscode-core`
   - `PLANS`, `getPlanConfig` from `apps/ptah-license-server/src/config/plans.config.ts`

2. **All patterns verified from examples**:

   - Injectable service pattern: `license.service.ts:63-340`
   - RPC handler pattern: `license-rpc.handlers.ts`
   - Webhook handler pattern: `paddle.service.ts:258-359`

3. **Library documentation consulted**:

   - `libs/backend/vscode-core/CLAUDE.md`
   - `libs/shared/CLAUDE.md`
   - `apps/ptah-license-server/CLAUDE.md`

4. **No hallucinated APIs**:
   - All DI tokens verified in `libs/backend/vscode-core/src/di/tokens.ts`
   - All service interfaces verified in source files
   - All RPC types verified in `libs/shared/src/lib/types/rpc.types.ts`

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] Security architecture documented
- [x] Migration strategy defined
- [x] Testing strategy outlined
