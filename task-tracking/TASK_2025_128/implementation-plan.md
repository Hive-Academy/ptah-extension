# Implementation Plan - TASK_2025_128

## Freemium Model Conversion: Two-Tier Paid to Community + Pro

---

## Architecture Overview

```
                    ┌─────────────────────────────────────────────────────────────┐
                    │                    FREEMIUM MODEL FLOW                       │
                    └─────────────────────────────────────────────────────────────┘

                    ┌──────────────────┐     ┌──────────────────┐
                    │   New User       │     │  Returning User  │
                    │  (No License)    │     │  (Pro License)   │
                    └────────┬─────────┘     └────────┬─────────┘
                             │                         │
                    ┌────────▼─────────┐     ┌────────▼─────────┐
                    │  Community Tier  │     │    Pro Tier      │
                    │  valid: true     │     │  valid: true     │
                    │  tier: community │     │  tier: pro       │
                    └────────┬─────────┘     └────────┬─────────┘
                             │                         │
                    ┌────────▼─────────────────────────▼─────────┐
                    │          EXTENSION ACTIVATES               │
                    │          Full Core Functionality           │
                    └────────────────────┬───────────────────────┘
                                         │
                    ┌────────────────────▼───────────────────────┐
                    │               FEATURE GATING               │
                    │  Community: Core features (6)              │
                    │  Pro: All features (6 core + 6 premium)    │
                    └────────────────────────────────────────────┘

    ┌─────────────────────────────────────────────────────────────────────────────┐
    │                         DEPENDENCY GRAPH                                     │
    └─────────────────────────────────────────────────────────────────────────────┘

    Phase 1 ────────► Phase 2 ────────► Phase 3 ────────► Phase 4 ────────► Phase 5
    (Types)           (Server)          (Extension)       (Landing)          (Chat)

    ┌─────────┐      ┌─────────┐       ┌─────────┐      ┌─────────┐       ┌─────────┐
    │ Shared  │─────►│ License │──────►│ License │─────►│ Pricing │──────►│ Welcome │
    │ Types   │      │ Server  │       │ Service │      │ Grid    │       │Component│
    └─────────┘      └─────────┘       └─────────┘      └─────────┘       └─────────┘
         │                │                 │                │                 │
         │                │                 │                │                 │
         ▼                ▼                 ▼                ▼                 ▼
    LicenseTier       PLANS           main.ts          Subscription      Context-
    Response          config          RPC handlers     StateService      aware UI
```

---

## Codebase Investigation Summary

### Libraries Discovered

| Library/File | Purpose | Key Exports |
|--------------|---------|-------------|
| `@ptah-extension/shared` | Foundation types | `LicenseTier`, `LicenseGetStatusResponse` |
| `@ptah-extension/vscode-core` | Infrastructure | `LicenseService`, `FeatureGateService`, `TOKENS` |
| `ptah-license-server` | Backend API | `PLANS`, `LicenseTier`, `mapPlanToTier` |
| `ptah-landing-page` | Marketing site | `SubscriptionStateService`, pricing components |

### Patterns Identified

**Pattern 1: License Tier Type System**
- **Evidence**: `libs/shared/src/lib/types/rpc.types.ts:562-567`
- **Current**: `'basic' | 'pro' | 'trial_basic' | 'trial_pro' | 'expired'`
- **Target**: `'community' | 'pro' | 'trial_pro' | 'expired'`

**Pattern 2: License Verification Logic**
- **Evidence**: `libs/backend/vscode-core/src/services/license.service.ts:210-222`
- **Current**: No license key = `{ valid: false, tier: 'expired' }`
- **Target**: No license key = `{ valid: true, tier: 'community' }`

**Pattern 3: RPC Response Mapping**
- **Evidence**: `apps/ptah-extension-vscode/src/services/rpc/handlers/license-rpc.handlers.ts:129-181`
- **Current**: Returns `isBasic` and `isPremium` flags
- **Target**: Returns `isCommunity` and `isPremium` flags

**Pattern 4: Landing Page Tier Display**
- **Evidence**: `apps/ptah-landing-page/src/app/services/subscription-state.service.ts:50-58`
- **Current**: Returns `'basic' | 'pro' | null`
- **Target**: Returns `'community' | 'pro' | null`

---

## Phase 1: Type System Foundation

**Goal**: Update shared type definitions to support Community tier

### File 1.1: `libs/shared/src/lib/types/rpc.types.ts`

**Current Implementation** (Lines 552-598):
```typescript
export type LicenseTier =
  | 'basic'
  | 'pro'
  | 'trial_basic'
  | 'trial_pro'
  | 'expired';

export interface LicenseGetStatusResponse {
  valid: boolean;
  tier: LicenseTier;
  isPremium: boolean;
  isBasic: boolean;  // TO REMOVE
  daysRemaining: number | null;
  trialActive: boolean;
  trialDaysRemaining: number | null;
  plan?: { name: string; description: string; features: string[]; };
  reason?: 'expired' | 'trial_ended' | 'no_license';
}
```

**Changes Required**:

```typescript
// Line 552-567: REPLACE LicenseTier
/**
 * License tier values for RPC communication
 *
 * TASK_2025_128: Freemium model conversion
 * - 'community': FREE forever - always valid, no license required
 * - 'pro': Active Pro subscription ($5/month)
 * - 'trial_pro': Pro plan during 14-day trial
 * - 'expired': Revoked or payment failed only (NOT for unlicensed users)
 */
export type LicenseTier =
  | 'community'   // FREE - always valid
  | 'pro'
  | 'trial_pro'
  | 'expired';    // Only for revoked/failed payment

// Line 575-598: UPDATE LicenseGetStatusResponse
export interface LicenseGetStatusResponse {
  /** Whether the license is valid (Community = always true) */
  valid: boolean;
  /** License tier (community, pro, trial_pro, or expired) */
  tier: LicenseTier;
  /** Whether the user has premium features enabled (Pro tier) */
  isPremium: boolean;
  /** Whether the user has Community tier (convenience flag) */
  isCommunity: boolean;  // RENAMED from isBasic
  /** Days remaining before subscription expires (null if not applicable) */
  daysRemaining: number | null;
  /** Whether user is currently in trial period */
  trialActive: boolean;
  /** Days remaining in trial period (null if not in trial) */
  trialDaysRemaining: number | null;
  /** Plan details (if has valid license) */
  plan?: {
    name: string;
    description: string;
    features: string[];
  };
  /** Reason for invalid license (for context-aware welcome messaging) */
  reason?: 'expired' | 'trial_ended' | 'no_license';
}
```

**Files Affected**:
- `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` (MODIFY)

---

## Phase 2: License Server Backend

**Goal**: Update server-side plan configuration and tier mapping

### File 2.1: `apps/ptah-license-server/src/config/plans.config.ts`

**Current Implementation** (Lines 14-49):
```typescript
export const PLANS = {
  basic: {
    name: 'Basic',
    features: [...],
    monthlyPrice: 3,
    yearlyPrice: 30,
    isPremium: false,
  },
  pro: {
    name: 'Pro',
    features: [...],
    monthlyPrice: 5,
    yearlyPrice: 50,
    isPremium: true,
  },
} as const;
```

**Changes Required**:

```typescript
// Line 14-49: REPLACE entire PLANS object
/**
 * Plan Configuration for Ptah License Server
 *
 * TASK_2025_128: Freemium model conversion
 *
 * Pricing Model:
 * - community: FREE forever - no subscription required
 * - pro: $5/month or $50/year (14-day trial)
 */
export const PLANS = {
  community: {
    name: 'Community',
    features: [
      'basic_cli_wrapper',
      'session_history',
      'permission_management',
      'sdk_access',
      'real_time_streaming',
      'basic_workspace_context',
    ],
    expiresAfterDays: null,  // Never expires
    monthlyPrice: 0,
    yearlyPrice: 0,
    isPremium: false,
    description: 'Free visual editor for Claude Code',
  },
  pro: {
    name: 'Pro',
    features: [
      'all_community_features',  // RENAMED from all_basic_features
      'mcp_server',
      'workspace_intelligence',
      'openrouter_proxy',
      'custom_tools',
      'setup_wizard',
      'cost_tracking',
      'priority_support',
    ],
    expiresAfterDays: null,  // Subscription-based
    monthlyPrice: 5,
    yearlyPrice: 50,
    isPremium: true,
    description: 'Full workspace intelligence suite',
  },
} as const;

// Line 54: UPDATE PlanName type
export type PlanName = keyof typeof PLANS;  // 'community' | 'pro'
```

**Files Affected**:
- `D:\projects\ptah-extension\apps\ptah-license-server\src\config\plans.config.ts` (REWRITE)

### File 2.2: `apps/ptah-license-server/src/license/services/license.service.ts`

**Current Implementation** (Lines 16-61):
```typescript
export type LicenseTier =
  | 'basic'
  | 'pro'
  | 'trial_basic'
  | 'trial_pro'
  | 'expired';

function mapPlanToTier(dbPlan: string, isInTrial: boolean): LicenseTier {
  switch (dbPlan) {
    case 'basic':
      return isInTrial ? 'trial_basic' : 'basic';
    case 'pro':
      return isInTrial ? 'trial_pro' : 'pro';
    // ...
  }
}
```

**Changes Required**:

```typescript
// Line 16-21: REPLACE LicenseTier
/**
 * License Tier type for TASK_2025_128
 *
 * Tier values:
 * - 'community': FREE forever, no subscription required
 * - 'pro': Paid Pro plan (active subscription)
 * - 'trial_pro': Pro plan in trial period
 * - 'expired': License expired, revoked, or payment failed
 */
export type LicenseTier =
  | 'community'   // FREE - always valid
  | 'pro'
  | 'trial_pro'
  | 'expired';

// Line 44-61: REPLACE mapPlanToTier function
/**
 * Map database plan to tier value with trial support
 *
 * TASK_2025_128: Migration compatibility
 * - 'community' -> 'community'
 * - 'basic' -> 'community' (migration compatibility)
 * - 'trial_basic' -> 'community' (migration compatibility)
 * - 'pro' -> 'pro' or 'trial_pro'
 */
function mapPlanToTier(dbPlan: string, isInTrial: boolean): LicenseTier {
  switch (dbPlan) {
    case 'pro':
      return isInTrial ? 'trial_pro' : 'pro';

    case 'community':
    case 'basic':        // Migration compatibility
    case 'trial_basic':  // Migration compatibility
      return 'community';

    case 'trial_pro':
      return 'trial_pro';

    default:
      return 'expired';
  }
}
```

**Files Affected**:
- `D:\projects\ptah-extension\apps\ptah-license-server\src\license\services\license.service.ts` (MODIFY)

### File 2.3: `apps/ptah-license-server/src/paddle/paddle.service.ts`

**Current Implementation** (Lines 799-845):
```typescript
private mapPriceIdToPlan(priceId: string | undefined): string {
  // Maps to 'basic' or 'pro'
  const basicMonthlyPriceId = this.configService.get('PADDLE_PRICE_ID_BASIC_MONTHLY');
  // ...
  if (priceId === basicMonthlyPriceId || priceId === basicYearlyPriceId) {
    return 'basic';
  }
  // ...
}
```

**Changes Required**:

```typescript
// Line 799-845: REPLACE mapPriceIdToPlan
/**
 * Map Paddle price ID to internal plan name
 *
 * TASK_2025_128: Freemium model - only Pro plan has price IDs
 * Community tier is FREE and has no Paddle integration.
 *
 * @param priceId - Paddle price ID from SDK notification
 * @returns Internal plan name ('pro' | 'expired')
 */
private mapPriceIdToPlan(priceId: string | undefined): string {
  if (!priceId) {
    this.logger.warn('No price ID provided - returning expired tier');
    return 'expired';
  }

  // Pro plan price IDs (only paid plan)
  const proMonthlyPriceId = this.configService.get<string>(
    'PADDLE_PRICE_ID_PRO_MONTHLY'
  );
  const proYearlyPriceId = this.configService.get<string>(
    'PADDLE_PRICE_ID_PRO_YEARLY'
  );

  // Map to pro plan
  if (priceId === proMonthlyPriceId || priceId === proYearlyPriceId) {
    return 'pro';
  }

  // MIGRATION: Handle legacy Basic price IDs gracefully
  // These should not appear in new subscriptions, but may exist in old webhooks
  const basicMonthlyPriceId = this.configService.get<string>(
    'PADDLE_PRICE_ID_BASIC_MONTHLY'
  );
  const basicYearlyPriceId = this.configService.get<string>(
    'PADDLE_PRICE_ID_BASIC_YEARLY'
  );

  if (priceId === basicMonthlyPriceId || priceId === basicYearlyPriceId) {
    this.logger.warn(
      `Received legacy Basic price ID: ${priceId} - treating as expired. ` +
      `Basic plan is now free Community tier.`
    );
    return 'expired';
  }

  this.logger.warn(
    `Unknown price ID: ${priceId} - returning 'expired'.`
  );
  return 'expired';
}
```

**Files Affected**:
- `D:\projects\ptah-extension\apps\ptah-license-server\src\paddle\paddle.service.ts` (MODIFY)

---

## Phase 3: VS Code Extension

**Goal**: Update extension to treat unlicensed users as Community tier

### File 3.1: `libs/backend/vscode-core/src/services/license.service.ts`

**Current Implementation** (Lines 50-55, 210-222):
```typescript
export type LicenseTierValue =
  | 'basic'
  | 'pro'
  | 'trial_basic'
  | 'trial_pro'
  | 'expired';

// Line 210-222
if (!licenseKey) {
  const expiredStatus: LicenseStatus = {
    valid: false,
    tier: 'expired',
    reason: 'not_found',
  };
  // ...
}
```

**Changes Required**:

```typescript
// Line 50-55: REPLACE LicenseTierValue
/**
 * License tier values for the freemium model
 *
 * TASK_2025_128: Freemium model conversion
 * - 'community': FREE forever, always valid, no license required
 * - 'pro': Active Pro subscription ($5/month)
 * - 'trial_pro': Pro plan during 14-day trial
 * - 'expired': Revoked or payment failed only
 */
export type LicenseTierValue =
  | 'community'   // FREE tier, always valid
  | 'pro'
  | 'trial_pro'
  | 'expired';    // Only for revoked/explicitly expired

// Line 210-222: REPLACE no-license-key handling
if (!licenseKey) {
  // TASK_2025_128: No license key = Community tier (FREE, valid)
  const communityStatus: LicenseStatus = {
    valid: true,           // CHANGED from false
    tier: 'community',     // CHANGED from 'expired'
    // No reason field - Community is a valid state, not an error
  };
  this.updateCache(communityStatus);
  this.logger.info(
    '[LicenseService.verifyLicense] No license key found, returning Community tier'
  );
  return communityStatus;
}

// Line 387-393: UPDATE clearLicenseKey method
async clearLicenseKey(): Promise<void> {
  await this.context.secrets.delete(LicenseService.SECRET_KEY);
  this.logger.info('[LicenseService.clearLicenseKey] License key removed');

  // TASK_2025_121: Clear persisted cache (no grace period for manual removal)
  await this.clearPersistedCache();

  // TASK_2025_128: Downgrade to Community tier (not expired)
  const communityStatus: LicenseStatus = {
    valid: true,           // CHANGED from false
    tier: 'community',     // CHANGED from 'expired'
  };
  this.updateCache(communityStatus);
  this.emit('license:updated', communityStatus);
}
```

**Files Affected**:
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\license.service.ts` (MODIFY)

### File 3.2: `apps/ptah-extension-vscode/src/main.ts`

**Current Implementation** (Lines 251-264):
```typescript
if (!licenseStatus.valid) {
  // BLOCK EXTENSION - License is invalid
  await handleLicenseBlocking(context, licenseService, licenseStatus);
  return;
}
```

**Changes Required**:

```typescript
// Line 251-264: UPDATE license check logic
// TASK_2025_128: Community tier has valid: true, so this only blocks
// users with explicitly expired/revoked licenses (payment failures)
if (!licenseStatus.valid) {
  // BLOCK EXTENSION - Only for revoked/payment-failed licenses
  console.log(
    `[Activate] BLOCKED: License invalid (reason: ${
      licenseStatus.reason || 'unknown'
    })`
  );

  await handleLicenseBlocking(context, licenseService, licenseStatus);
  return;
}

// Community and Pro users both reach here
console.log(
  `[Activate] Step 2: License verified (tier: ${licenseStatus.tier})`
);
```

**Note**: The `handleLicenseBlocking` function (Lines 97-222) should only be triggered for `expired` tier, not for Community users. Since Community users have `valid: true`, they bypass this block automatically.

**Files Affected**:
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts` (MODIFY - minimal change)

### File 3.3: `apps/ptah-extension-vscode/src/services/rpc/handlers/license-rpc.handlers.ts`

**Current Implementation** (Lines 129-181):
```typescript
private mapLicenseStatusToResponse(status: LicenseStatus): LicenseGetStatusResponse {
  const isPremium = status.tier === 'pro' || status.tier === 'trial_pro';
  const isBasic = status.tier === 'basic' || status.tier === 'trial_basic';
  // ...
  return {
    valid: status.valid,
    tier: status.tier as LicenseTier,
    isPremium,
    isBasic,  // TO REMOVE
    // ...
  };
}
```

**Changes Required**:

```typescript
// Line 129-181: REPLACE mapLicenseStatusToResponse
/**
 * Map internal LicenseStatus to RPC response format
 *
 * TASK_2025_128: Freemium model conversion
 * - isPremium: true for 'pro' and 'trial_pro' (has Pro features)
 * - isCommunity: true for 'community' (free tier)
 */
private mapLicenseStatusToResponse(
  status: LicenseStatus
): LicenseGetStatusResponse {
  // Determine if user has premium (Pro) features
  const isPremium = status.tier === 'pro' || status.tier === 'trial_pro';

  // Determine if user has Community tier
  const isCommunity = status.tier === 'community';

  // Determine trial status from tier
  const trialActive =
    status.trialActive ?? status.tier === 'trial_pro';

  // Map reason field for context-aware welcome messaging
  let reason: 'expired' | 'trial_ended' | 'no_license' | undefined;
  if (status.reason) {
    switch (status.reason) {
      case 'expired':
      case 'revoked':
        reason = 'expired';
        break;
      case 'trial_ended':
        reason = 'trial_ended';
        break;
      case 'not_found':
        reason = 'no_license';
        break;
    }
  }

  return {
    valid: status.valid,
    tier: status.tier as LicenseTier,
    isPremium,
    isCommunity,  // RENAMED from isBasic
    daysRemaining: status.daysRemaining ?? null,
    trialActive,
    trialDaysRemaining: status.trialDaysRemaining ?? null,
    plan: status.plan
      ? {
          name: status.plan.name,
          description: status.plan.description,
          features: status.plan.features,
        }
      : undefined,
    reason,
  };
}
```

**Files Affected**:
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\license-rpc.handlers.ts` (MODIFY)

### File 3.4: `libs/backend/vscode-core/src/services/feature-gate.service.ts`

**Current Implementation** (Lines 192-238):
```typescript
async isBasicTier(): Promise<boolean> {
  const status = await this.getLicenseStatus();
  return status.tier === 'basic' || status.tier === 'trial_basic';
}
```

**Changes Required**:

```typescript
// Line 235-238: REPLACE isBasicTier with isCommunityTier
/**
 * Check if user has Community tier (free tier)
 *
 * TASK_2025_128: Replaces isBasicTier
 *
 * Community tier includes core features:
 * - Visual chat interface
 * - Session history
 * - Permission management
 * - SDK access
 * - Real-time streaming
 * - Basic workspace context
 *
 * @returns true if user has Community tier, false otherwise
 */
async isCommunityTier(): Promise<boolean> {
  const status = await this.getLicenseStatus();
  return status.tier === 'community';
}

// Line 244-248: UPDATE isTrialActive (remove trial_basic)
/**
 * Check if user is in trial period (Pro trial only)
 *
 * TASK_2025_128: Only Pro has trials (Community is free)
 *
 * @returns true if user is in trial, false otherwise
 */
async isTrialActive(): Promise<boolean> {
  const status = await this.getLicenseStatus();
  return status.tier === 'trial_pro';
}
```

**Files Affected**:
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\feature-gate.service.ts` (MODIFY)

### File 3.5: `apps/ptah-extension-vscode/src/commands/license-commands.ts`

**Current Implementation** (Lines 121-141):
```typescript
async removeLicenseKey(): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    'Remove your license key? Premium features will be disabled.',
    'Remove',
    'Cancel'
  );
  // ...
}
```

**Changes Required**:

```typescript
// Line 121-141: UPDATE removeLicenseKey messaging
/**
 * Remove License Key Command
 *
 * TASK_2025_128: Updated messaging for freemium model
 */
async removeLicenseKey(): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    'Remove your license key? You will be downgraded to the Community tier. ' +
    'Core features will remain available.',
    'Remove',
    'Cancel'
  );

  if (confirm !== 'Remove') {
    return;
  }

  await this.licenseService.clearLicenseKey();

  const action = await vscode.window.showInformationMessage(
    'License key removed. You are now on the Community tier. ' +
    'Reload window to apply changes.',
    'Reload Window'
  );
  if (action === 'Reload Window') {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}

// Line 160-179: UPDATE checkLicenseStatus display
async checkLicenseStatus(): Promise<void> {
  const status = await this.licenseService.verifyLicense();

  if (status.valid) {
    const tierName = status.tier === 'community' ? 'Community (Free)' :
                     status.tier === 'trial_pro' ? 'Pro (Trial)' : 'Pro';
    const expiresText = status.expiresAt
      ? new Date(status.expiresAt).toLocaleDateString()
      : status.tier === 'community' ? 'Never' : 'N/A';
    const daysText = status.daysRemaining
      ? `${status.daysRemaining} days`
      : status.tier === 'community' ? 'Unlimited' : 'N/A';

    vscode.window.showInformationMessage(
      `Plan: ${status.plan?.name || tierName}\n` +
      `Tier: ${tierName}\n` +
      `Expires: ${expiresText}\n` +
      `Days Remaining: ${daysText}`
    );
  } else {
    vscode.window.showWarningMessage(
      `License Status: Expired\n` +
      `Reason: ${status.reason || 'License revoked or payment failed'}\n\n` +
      'Renew at https://ptah.dev/pricing'
    );
  }
}
```

**Files Affected**:
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\commands\license-commands.ts` (MODIFY)

---

## Phase 4: Landing Page

**Goal**: Update pricing UI to show Community (free) + Pro

### File 4.1: `apps/ptah-landing-page/src/app/pages/pricing/models/pricing-plan.interface.ts`

**Current Implementation** (Line 14):
```typescript
tier: 'basic' | 'pro';
```

**Changes Required**:

```typescript
// Line 14: UPDATE tier type
/** Tier identifier for programmatic use */
tier: 'community' | 'pro';
```

**Files Affected**:
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\models\pricing-plan.interface.ts` (MODIFY)

### File 4.2: `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts`

**Current Implementation** (Lines 16-17, 333-428):
```typescript
import { BasicPlanCardComponent } from './basic-plan-card.component';
// ...
public readonly basicMonthlyPlan: PricingPlan = {...};
public readonly basicYearlyPlan: PricingPlan = {...};
```

**Changes Required**:

This file requires significant changes to:
1. Replace `BasicPlanCardComponent` with `CommunityPlanCardComponent`
2. Update plan definitions from Basic to Community
3. Remove checkout CTA from Community (it's free)

```typescript
// Line 16: REPLACE import
import { CommunityPlanCardComponent } from './community-plan-card.component';

// Lines 333-377: REPLACE basicMonthlyPlan and basicYearlyPlan with communityPlan
/**
 * Community plan data (FREE - no pricing options)
 */
public readonly communityPlan: PricingPlan = {
  name: 'Community',
  tier: 'community',
  price: 'Free',
  priceSubtext: 'forever',
  priceId: undefined,  // No checkout - it's free
  idealFor: 'Perfect for getting started',
  trialDays: undefined,  // No trial - always free
  features: [],
  standoutFeatures: [
    'Beautiful visual interface',
    'Use your Claude Pro/Max subscription',
    'Native VS Code integration',
    'Real-time streaming responses',
    'Session history & management',
    'Basic workspace context',
  ],
  ctaText: 'Install Free',
  ctaAction: 'download',  // NEW action type - opens VS Code marketplace
};

// Keep proMonthlyPlan and proYearlyPlan unchanged (lines 382-428)

// UPDATE template (lines 143-177)
// Replace BasicPlanCardComponent with CommunityPlanCardComponent
```

**Files Affected**:
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts` (REWRITE)

### File 4.3: Create `apps/ptah-landing-page/src/app/pages/pricing/components/community-plan-card.component.ts`

**New File**: Create a simplified Community plan card without checkout.

```typescript
import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { LucideAngularModule, Check, Download, Crown } from 'lucide-angular';
import { PricingPlan, PlanSubscriptionContext } from '../models/pricing-plan.interface';

/**
 * CommunityPlanCardComponent - Free tier display card
 *
 * TASK_2025_128: Freemium model conversion
 *
 * This component displays the Community (free) tier:
 * - No pricing or checkout (it's free)
 * - CTA: "Install Free" -> Opens VS Code marketplace
 * - Shows "Current Plan" badge for authenticated Community users
 * - Shows "Included" badge for Pro users
 */
@Component({
  selector: 'ptah-community-plan-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, LucideAngularModule],
  template: `
    <div
      class="relative rounded-2xl p-6 lg:p-8 h-full flex flex-col
             bg-base-200/40 border transition-all duration-500 group"
      [ngClass]="cardBorderClass()"
    >
      <!-- Badge -->
      @if (isCurrentPlan()) {
        <div
          class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                 bg-success rounded-full
                 text-xs font-bold text-success-content uppercase tracking-wider
                 shadow-lg shadow-success/30 flex items-center gap-1.5"
        >
          <lucide-angular [img]="CrownIcon" class="w-3 h-3" />
          Current Plan
        </div>
      } @else if (isProUser()) {
        <div
          class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                 bg-base-300 rounded-full
                 text-xs font-bold text-base-content/60 uppercase tracking-wider"
        >
          Included in Pro
        </div>
      } @else {
        <div
          class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
                 bg-gradient-to-r from-green-500 to-emerald-500 rounded-full
                 text-xs font-bold text-white uppercase tracking-wider
                 shadow-lg shadow-green-500/30"
        >
          Free Forever
        </div>
      }

      <!-- Plan Header -->
      <div class="mb-4 mt-2">
        <h3 class="font-display text-xl lg:text-2xl font-semibold text-base-content tracking-wide uppercase mb-1">
          {{ plan().name }}
        </h3>
        <p class="text-sm text-base-content/50">{{ plan().idealFor }}</p>
      </div>

      <!-- Price Section -->
      <div class="mb-6">
        <div class="flex items-baseline gap-2">
          <span class="text-5xl lg:text-6xl font-bold text-base-content">
            {{ plan().price }}
          </span>
          <span class="text-base-content/50 text-sm">
            / {{ plan().priceSubtext }}
          </span>
        </div>
      </div>

      <!-- Divider -->
      <div class="h-px bg-base-content/10 mb-6"></div>

      <!-- Features Section -->
      <div class="flex-1">
        <h4 class="text-xs font-semibold text-base-content/40 uppercase tracking-wider mb-3">
          Core Features
        </h4>
        <ul class="space-y-2.5">
          @for (feature of plan().standoutFeatures; track feature) {
            <li class="flex items-start gap-2.5">
              <lucide-angular
                [img]="CheckIcon"
                class="flex-shrink-0 w-4 h-4 text-green-400 mt-0.5"
              />
              <span class="text-sm text-base-content/80">{{ feature }}</span>
            </li>
          }
        </ul>
      </div>

      <!-- CTA Button -->
      <button
        class="mt-8 w-full py-3.5 px-6 rounded-xl font-semibold text-sm
               flex items-center justify-center gap-2 transition-all duration-300
               bg-gradient-to-r from-green-600 to-emerald-600
               hover:from-green-500 hover:to-emerald-500
               text-white shadow-lg shadow-green-500/20
               group-hover:gap-3"
        [disabled]="isProUser()"
        (click)="handleClick()"
      >
        @if (isProUser()) {
          <span>Included in Your Plan</span>
        } @else {
          <lucide-angular [img]="DownloadIcon" class="w-4 h-4" />
          <span>{{ plan().ctaText }}</span>
        }
      </button>
    </div>
  `,
})
export class CommunityPlanCardComponent {
  readonly CheckIcon = Check;
  readonly DownloadIcon = Download;
  readonly CrownIcon = Crown;

  readonly plan = input.required<PricingPlan>();
  readonly subscriptionContext = input<PlanSubscriptionContext | null>(null);
  readonly ctaClick = output<void>();

  readonly isCurrentPlan = computed(() => {
    const ctx = this.subscriptionContext();
    return ctx?.currentPlanTier === 'community' || (!ctx?.currentPlanTier && ctx?.isAuthenticated);
  });

  readonly isProUser = computed(() => {
    const ctx = this.subscriptionContext();
    return ctx?.currentPlanTier === 'pro';
  });

  readonly cardBorderClass = computed(() => {
    if (this.isCurrentPlan()) {
      return 'border-success/50 shadow-lg shadow-success/10';
    }
    if (this.isProUser()) {
      return 'border-base-content/5 opacity-75';
    }
    return 'border-base-content/10 hover:border-base-content/20';
  });

  handleClick(): void {
    if (!this.isProUser()) {
      // Open VS Code marketplace
      window.open(
        'https://marketplace.visualstudio.com/items?itemName=ptah.ptah-extension',
        '_blank'
      );
    }
  }
}
```

**Files Affected**:
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\community-plan-card.component.ts` (CREATE)

### File 4.4: DELETE `apps/ptah-landing-page/src/app/pages/pricing/components/basic-plan-card.component.ts`

**Action**: DELETE entire file (517 lines)

**Files Affected**:
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\basic-plan-card.component.ts` (DELETE)

### File 4.5: `apps/ptah-landing-page/src/app/services/subscription-state.service.ts`

**Current Implementation** (Lines 50-58):
```typescript
public readonly currentPlanTier = computed<'basic' | 'pro' | null>(() => {
  const data = this._licenseData();
  if (!data?.plan) return null;
  if (data.plan.includes('basic')) return 'basic';
  if (data.plan.includes('pro')) return 'pro';
  return null;
});
```

**Changes Required**:

```typescript
// Line 50-58: REPLACE currentPlanTier computation
/**
 * Computed: Current plan tier (normalized)
 *
 * TASK_2025_128: Freemium model conversion
 * - Maps trial_pro -> pro
 * - Maps basic, trial_basic -> community (migration compatibility)
 * - No subscription = community (free tier)
 *
 * @returns 'community' | 'pro' | null
 */
public readonly currentPlanTier = computed<'community' | 'pro' | null>(() => {
  const data = this._licenseData();

  // No subscription = Community (free tier)
  if (!data?.plan) return 'community';

  // Pro tier (including trial)
  if (data.plan.includes('pro')) return 'pro';

  // Community tier (including migrated basic)
  if (data.plan.includes('basic') || data.plan.includes('community')) {
    return 'community';
  }

  // Default to community for unknown plans
  return 'community';
});
```

**Files Affected**:
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\subscription-state.service.ts` (MODIFY)

### File 4.6: `apps/ptah-landing-page/src/environments/environment.ts`

**Current Implementation** (Lines 35-42):
```typescript
paddle: {
  basicPriceIdMonthly: 'pri_...',
  basicPriceIdYearly: 'pri_...',
  proPriceIdMonthly: 'pri_...',
  proPriceIdYearly: 'pri_...',
}
```

**Changes Required**:

```typescript
// Lines 35-42: REMOVE Basic price IDs
/**
 * Paddle configuration
 *
 * TASK_2025_128: Freemium model - only Pro has checkout
 * Community tier is FREE with no Paddle integration.
 */
paddle: {
  environment: 'sandbox' as const,
  token: 'test_4cc7e17dbf1a71a998fa7e12e31',

  // Pro plan price IDs (only paid plan)
  proPriceIdMonthly: 'pri_01kfr72reygmkapd0vtynrswm4',
  proPriceIdYearly: 'pri_01kfr76e7fz41sp05w74jy4fx6',

  // NOTE: Basic price IDs removed - Community tier is FREE
},
```

**Files Affected**:
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\environments\environment.ts` (MODIFY)
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\environments\environment.production.ts` (MODIFY - same changes)

### File 4.7: `apps/ptah-landing-page/src/app/pages/profile/models/license-data.interface.ts`

**Current Implementation** (Line 47):
```typescript
plan: 'basic' | 'pro' | 'trial_basic' | 'trial_pro';
```

**Changes Required**:

```typescript
// Line 47: UPDATE plan type
/** License plan identifier (Community or Pro, with optional trial prefix) */
plan: 'community' | 'pro' | 'trial_pro';
```

**Files Affected**:
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\models\license-data.interface.ts` (MODIFY)

---

## Phase 5: Frontend Chat

**Goal**: Update welcome component for Community tier messaging

### File 5.1: `libs/frontend/chat/src/lib/components/templates/welcome.component.ts`

**Current Implementation** (Lines 135-160):
```typescript
getHeadline(): string {
  const reason = this.licenseReason();
  switch (reason) {
    case 'expired':
      return 'Your subscription has expired';
    case 'trial_ended':
      return 'Your trial has ended';
    default:
      return 'Welcome to Ptah';
  }
}
```

**Changes Required**:

The welcome component is shown to unlicensed users via `handleLicenseBlocking` in main.ts. With the freemium model, Community users have `valid: true` and will NOT see this component. Only users with `valid: false` (expired/revoked) will see it.

Therefore, minimal changes are needed - the existing messaging is appropriate for expired users.

**Optional Enhancement** (if desired):
```typescript
// Line 135-160: Keep existing implementation
// The welcome component is only shown to expired/revoked users
// Community users bypass this entirely (valid: true)

// Optional: Add more context for expired users
getSubheadline(): string {
  const reason = this.licenseReason();
  switch (reason) {
    case 'expired':
      return "Renew your subscription to continue using Ptah's premium features, or downgrade to Community (free).";
    case 'trial_ended':
      return 'Subscribe to Pro for premium features, or continue with Community (free).';
    default:
      return 'Transform your Claude Code experience with a native VS Code interface.';
  }
}
```

**Files Affected**:
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\welcome.component.ts` (MODIFY - minimal)
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\welcome.component.html` (MODIFY - if updating messaging)

---

## Files Affected Summary

### CREATE (1 file)
| File | Lines Est. |
|------|------------|
| `apps/ptah-landing-page/.../community-plan-card.component.ts` | ~180 |

### MODIFY (15 files)
| File | Lines Changed Est. |
|------|-------------------|
| `libs/shared/src/lib/types/rpc.types.ts` | ~30 |
| `apps/ptah-license-server/src/config/plans.config.ts` | ~50 |
| `apps/ptah-license-server/src/license/services/license.service.ts` | ~40 |
| `apps/ptah-license-server/src/paddle/paddle.service.ts` | ~60 |
| `libs/backend/vscode-core/src/services/license.service.ts` | ~50 |
| `apps/ptah-extension-vscode/src/main.ts` | ~10 |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/license-rpc.handlers.ts` | ~60 |
| `libs/backend/vscode-core/src/services/feature-gate.service.ts` | ~30 |
| `apps/ptah-extension-vscode/src/commands/license-commands.ts` | ~40 |
| `apps/ptah-landing-page/.../pricing-plan.interface.ts` | ~5 |
| `apps/ptah-landing-page/.../pricing-grid.component.ts` | ~100 |
| `apps/ptah-landing-page/.../subscription-state.service.ts` | ~20 |
| `apps/ptah-landing-page/src/environments/environment.ts` | ~10 |
| `apps/ptah-landing-page/src/environments/environment.production.ts` | ~10 |
| `apps/ptah-landing-page/.../license-data.interface.ts` | ~5 |

### DELETE (1 file)
| File | Lines |
|------|-------|
| `apps/ptah-landing-page/.../basic-plan-card.component.ts` | 517 |

### Total Estimated Changes
- **Files**: 17 (1 create, 15 modify, 1 delete)
- **Lines Changed**: ~520
- **Lines Deleted**: ~517

---

## Testing Strategy

### Phase 1 Verification
```bash
# After Phase 1 changes, run TypeScript compilation
nx run-many --target=build --projects=shared,vscode-core,agent-sdk --parallel=3

# Expected: Zero type errors
# If errors: Fix usages of LicenseTier, LicenseGetStatusResponse
```

### Phase 2 Verification
```bash
# After Phase 2 changes
nx build ptah-license-server

# Manual test: Start license server and verify /api/v1/licenses/verify returns correct tiers
```

### Phase 3 Verification
```bash
# After Phase 3 changes
nx build ptah-extension-vscode

# Manual test in VS Code:
# 1. Remove license key -> Should show "Community" tier, extension works
# 2. Enter Pro license key -> Should show "Pro" tier
# 3. Check status command -> Shows correct tier info
```

### Phase 4 Verification
```bash
# After Phase 4 changes
nx build ptah-landing-page

# Manual test:
# 1. Visit /pricing -> Shows Community (free) + Pro cards
# 2. Community card has "Install Free" button (no checkout)
# 3. Pro card has checkout flow
# 4. Authenticated user sees correct "Current Plan" badges
```

### Phase 5 Verification
```bash
# After Phase 5 changes
nx build chat

# Manual test:
# 1. Expired license user sees welcome page with renewal messaging
# 2. Community user bypasses welcome page (valid: true)
```

### Full Integration Test
```bash
# Run all tests
nx run-many --target=test --all

# Run typecheck across all projects
npm run typecheck:all

# Lint all projects
npm run lint:all
```

---

## Rollback Plan

### Phase-by-Phase Rollback

Each phase can be rolled back independently by reverting the specific commits:

```bash
# Identify commits for each phase
git log --oneline --since="YYYY-MM-DD"

# Rollback specific phase
git revert <commit-hash>
```

### Full Rollback

```bash
# Create rollback branch before starting
git checkout -b feature/freemium-model-rollback

# After identifying issues, revert to previous state
git checkout main
git reset --hard <pre-task-commit>
```

### Critical Rollback Points

1. **Type System** (Phase 1): If type errors propagate, revert Phase 1 first
2. **License Server** (Phase 2): If webhooks fail, revert Phase 2 independently
3. **Extension** (Phase 3): If extension breaks, revert Phase 3 + Phase 1
4. **Landing Page** (Phase 4): Can be reverted independently (isolated frontend)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer (primary) + frontend-developer (Phase 4-5)

**Rationale**:
- Phase 1-3: TypeScript backend changes (license service, RPC handlers)
- Phase 4-5: Angular frontend changes (landing page, chat)

**Alternative**: Single full-stack developer can handle all phases sequentially.

### Complexity Assessment

**Complexity**: MEDIUM-HIGH
**Estimated Effort**: 8-12 hours

**Breakdown**:
- Phase 1 (Types): 1 hour
- Phase 2 (Server): 2 hours
- Phase 3 (Extension): 3 hours
- Phase 4 (Landing): 3 hours
- Phase 5 (Chat): 1 hour
- Testing: 2 hours

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports verified from codebase**:
   - `LicenseTier` from `@ptah-extension/shared`
   - `LicenseService` from `@ptah-extension/vscode-core`
   - `PLANS` from `apps/ptah-license-server/src/config/plans.config.ts`

2. **All patterns verified from examples**:
   - License status mapping: `license-rpc.handlers.ts:129-181`
   - Plan configuration: `plans.config.ts:14-49`
   - Subscription state: `subscription-state.service.ts:50-58`

3. **Library documentation consulted**:
   - `libs/shared/CLAUDE.md`
   - `libs/backend/vscode-core/CLAUDE.md`
   - `apps/ptah-landing-page/CLAUDE.md`

4. **No hallucinated APIs**:
   - All decorators verified in source files
   - All interfaces verified in type definition files
   - All methods verified in service implementations

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] Testing strategy defined
- [x] Rollback plan documented

---

_Implementation Plan created by Software Architect Agent - TASK_2025_128_
_Date: 2025-01-28_
