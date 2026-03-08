# Research Findings - TASK_2025_128

## Freemium Model Conversion Research Report

**Research Classification**: STRATEGIC_BUSINESS_MODEL_CHANGE
**Confidence Level**: 95% (based on comprehensive code analysis)
**Key Insight**: The current two-tier paid model (Basic $3 + Pro $5) is deeply integrated across 4 major components - VS Code extension, license server, landing page, and shared type system.

---

## Executive Summary

### Current State (Two-Tier Paid Model)

Implemented in TASK_2025_121:

| Tier    | Price              | Trial       | Access                                                               |
| ------- | ------------------ | ----------- | -------------------------------------------------------------------- |
| Basic   | $3/month, $30/year | 14-day free | Core features (visual interface, session history, SDK access)        |
| Pro     | $5/month, $50/year | 14-day free | Basic + MCP server, workspace intelligence, OpenRouter, setup wizard |
| Expired | N/A                | N/A         | Extension BLOCKED - no access                                        |

### Target State (Freemium Model)

| Tier      | Price              | Trial       | Access                                                                   |
| --------- | ------------------ | ----------- | ------------------------------------------------------------------------ |
| Community | FREE forever       | N/A         | Core features (visual interface, session history, SDK access)            |
| Pro       | $5/month, $50/year | 14-day free | Community + MCP server, workspace intelligence, OpenRouter, setup wizard |

### Impact Summary

- **VS Code Extension**: 5 files require changes
- **License Server**: 3 files require changes
- **Landing Page**: 8+ files require changes
- **Shared Types**: 2 files require changes

---

## 1. VS Code Extension Changes

### 1.1 License Service (`libs/backend/vscode-core/src/services/license.service.ts`)

**Current Implementation**:

- Line 50-55: `LicenseTierValue` type defines: `'basic' | 'pro' | 'trial_basic' | 'trial_pro' | 'expired'`
- Line 62-85: `LicenseStatus` interface expects tier-based response
- Line 210-222: No license key = `expired` tier (extension blocked)
- Line 387-393: `clearLicenseKey` sets to `expired` (extension blocked)

**Changes Needed**:

1. Add `'community'` to `LicenseTierValue` type
2. When no license key found, return `tier: 'community'` with `valid: true` instead of `expired`
3. Add `isCommunity` convenience flag to `LicenseStatus`

```typescript
// NEW tier type
export type LicenseTierValue =
  | 'community' // NEW: Free tier, always valid
  | 'pro'
  | 'trial_pro'
  | 'expired'; // Only for revoked/explicitly expired

// When no license key found:
if (!licenseKey) {
  return {
    valid: true, // CHANGED: Community tier is valid
    tier: 'community', // CHANGED: Not 'expired'
  };
}
```

### 1.2 License RPC Handlers (`apps/ptah-extension-vscode/src/services/rpc/handlers/license-rpc.handlers.ts`)

**Current Implementation**:

- Line 130-143: Maps `isPremium` (Pro tier) and `isBasic` (Basic tier) convenience flags

**Changes Needed**:

1. Remove `isBasic` flag (no Basic tier in freemium)
2. Add `isCommunity` flag
3. Update tier mapping logic

```typescript
// REMOVE isBasic
const isPremium = status.tier === 'pro' || status.tier === 'trial_pro';
const isCommunity = status.tier === 'community'; // NEW
```

### 1.3 Main Extension Activation (`apps/ptah-extension-vscode/src/main.ts`)

**Current Implementation**:

- Line 251-264: License verification blocks if `!licenseStatus.valid`
- Line 388-409: MCP server only starts for Pro tier

**Changes Needed**:

1. Community tier should be `valid: true`, so extension activates normally
2. Feature gating logic already handles Pro-only features
3. Remove "blocking" flow for Community users (they get valid: true)

**Critical Change**: Lines 251-264 will need modification:

```typescript
// CURRENT: Blocks if invalid
if (!licenseStatus.valid) {
  await handleLicenseBlocking(context, licenseService, licenseStatus);
  return;
}

// NEW: Community tier is valid, no blocking needed
// Only block for explicitly expired/revoked licenses
```

### 1.4 Feature Gate Service (`libs/backend/vscode-core/src/services/feature-gate.service.ts`)

**Current Implementation**:

- Line 57-64: `PRO_ONLY_FEATURES` array lists Pro-only features
- Line 136-174: `isFeatureEnabled` checks tier for Pro-only features
- Line 192-238: `isBasicTier()`, `isProTier()` methods

**Changes Needed**:

1. Remove `isBasicTier()` method
2. Add `isCommunityTier()` method
3. Update feature gating: Community users have same features as old Basic users

```typescript
// REMOVE
async isBasicTier(): Promise<boolean> { ... }

// ADD
async isCommunityTier(): Promise<boolean> {
  const status = await this.getLicenseStatus();
  return status.tier === 'community';
}
```

### 1.5 License Commands (`apps/ptah-extension-vscode/src/commands/license-commands.ts`)

**Current Implementation**:

- Line 121-141: `removeLicenseKey` shows "Premium features will be disabled"

**Changes Needed**:

1. Update messaging: "You will be downgraded to the Community tier"
2. Update status display to show Community vs Pro

---

## 2. License Server Changes

### 2.1 Plans Configuration (`apps/ptah-license-server/src/config/plans.config.ts`)

**Current Implementation**:

- Lines 14-48: Defines `basic` and `pro` plans with features and pricing

**Changes Needed**:

1. REMOVE `basic` plan entirely
2. ADD `community` plan (free, no subscription required):

```typescript
export const PLANS = {
  community: {
    name: 'Community',
    features: ['basic_cli_wrapper', 'session_history', 'permission_management', 'sdk_access', 'real_time_streaming', 'basic_workspace_context'],
    expiresAfterDays: null, // Never expires
    monthlyPrice: 0,
    yearlyPrice: 0,
    isPremium: false,
    description: 'Free visual editor for Claude Code',
  },
  pro: {
    // Keep existing pro plan
  },
} as const;
```

### 2.2 License Service (`apps/ptah-license-server/src/license/services/license.service.ts`)

**Current Implementation**:

- Line 16-21: `LicenseTier` type includes `'basic' | 'pro' | 'trial_basic' | 'trial_pro' | 'expired'`
- Line 44-61: `mapPlanToTier` function maps database plan to tier

**Changes Needed**:

1. Update `LicenseTier` type: Remove `'basic' | 'trial_basic'`, add `'community'`
2. Update `mapPlanToTier` function
3. When no license found, consider returning Community tier instead of "not_found"

```typescript
export type LicenseTier =
  | 'community' // FREE - always valid
  | 'pro'
  | 'trial_pro'
  | 'expired';

function mapPlanToTier(dbPlan: string, isInTrial: boolean): LicenseTier {
  switch (dbPlan) {
    case 'pro':
      return isInTrial ? 'trial_pro' : 'pro';
    case 'community':
      return 'community';
    default:
      return 'expired';
  }
}
```

### 2.3 Paddle Service (`apps/ptah-license-server/src/paddle/paddle.service.ts`)

**Current Implementation**:

- Line 799-845: `mapPriceIdToPlan` maps Paddle price IDs to `'basic' | 'pro' | 'expired'`
- Lines 806-823: Maps Basic monthly/yearly price IDs

**Changes Needed**:

1. REMOVE Basic price ID mapping (Basic plan no longer exists)
2. REMOVE environment variables: `PADDLE_PRICE_ID_BASIC_MONTHLY`, `PADDLE_PRICE_ID_BASIC_YEARLY`
3. Update function to only recognize Pro price IDs

```typescript
private mapPriceIdToPlan(priceId: string | undefined): string {
  // REMOVE all Basic price ID mappings
  // Only Pro monthly/yearly remain
  if (priceId === proMonthlyPriceId || priceId === proYearlyPriceId) {
    return 'pro';
  }
  return 'expired';
}
```

---

## 3. Landing Page Changes

### 3.1 Pricing Grid Component (`apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts`)

**Current Implementation**:

- Lines 333-377: `basicMonthlyPlan` and `basicYearlyPlan` definitions
- Lines 382-428: `proMonthlyPlan` and `proYearlyPlan` definitions
- Template shows 2-column grid with Basic and Pro cards

**Changes Needed**:

1. REMOVE `basicMonthlyPlan` and `basicYearlyPlan`
2. REMOVE `BasicPlanCardComponent` import
3. Update grid to single column with Pro card only
4. Consider adding Community "tier display" (no pricing, just features)

### 3.2 Pricing Plan Interface (`apps/ptah-landing-page/src/app/pages/pricing/models/pricing-plan.interface.ts`)

**Current Implementation**:

- Line 14: `tier: 'basic' | 'pro'`

**Changes Needed**:

1. Update tier type: `tier: 'community' | 'pro'` (Community for display only, not checkout)

### 3.3 Environment Configuration (`apps/ptah-landing-page/src/environments/environment.ts`)

**Current Implementation**:

- Lines 35-42: `basicPriceIdMonthly`, `basicPriceIdYearly`, `proPriceIdMonthly`, `proPriceIdYearly`

**Changes Needed**:

1. REMOVE `basicPriceIdMonthly` and `basicPriceIdYearly`
2. Keep only Pro price IDs

### 3.4 Subscription State Service (`apps/ptah-landing-page/src/app/services/subscription-state.service.ts`)

**Current Implementation**:

- Line 50-58: `currentPlanTier` computed signal normalizes `trial_basic -> basic`, `trial_pro -> pro`

**Changes Needed**:

1. Update normalization: No more Basic tier
2. Return `'community' | 'pro' | null`

```typescript
public readonly currentPlanTier = computed<'community' | 'pro' | null>(() => {
  const data = this._licenseData();
  if (!data?.plan) return 'community';  // No subscription = Community
  if (data.plan.includes('pro')) return 'pro';
  return 'community';  // Default to Community
});
```

### 3.5 License Data Interface (`apps/ptah-landing-page/src/app/pages/profile/models/license-data.interface.ts`)

**Current Implementation**:

- Line 47: `plan: 'basic' | 'pro' | 'trial_basic' | 'trial_pro'`

**Changes Needed**:

1. Update to: `plan: 'community' | 'pro' | 'trial_pro'`

### 3.6 Basic Plan Card Component (TO BE REMOVED)

**File**: `apps/ptah-landing-page/src/app/pages/pricing/components/basic-plan-card.component.ts`

**Action**: DELETE this component entirely (no Basic plan in freemium model)

### 3.7 Profile Page Components

**Files to Update**:

- `apps/ptah-landing-page/src/app/pages/profile/components/profile-details.component.ts`
- `apps/ptah-landing-page/src/app/pages/profile/components/profile-header.component.ts`
- `apps/ptah-landing-page/src/app/pages/profile/components/profile-features.component.ts`

**Changes Needed**:

1. Update tier display logic to show "Community" instead of "Basic"
2. Update feature lists for Community tier

---

## 4. Shared Types Changes

### 4.1 RPC Types (`libs/shared/src/lib/types/rpc.types.ts`)

**Current Implementation**:

- Lines 562-567: `LicenseTier` type definition
- Lines 575-598: `LicenseGetStatusResponse` interface

**Changes Needed**:

1. Update `LicenseTier` type:

```typescript
export type LicenseTier =
  | 'community' // NEW: Free forever
  | 'pro'
  | 'trial_pro'
  | 'expired'; // Revoked or payment failed
```

2. Update `LicenseGetStatusResponse`:

- REMOVE `isBasic` flag
- ADD `isCommunity` flag

```typescript
export interface LicenseGetStatusResponse {
  valid: boolean;
  tier: LicenseTier;
  isPremium: boolean;    // Pro tier
  isCommunity: boolean;  // NEW: Community tier
  // Remove isBasic
  ...
}
```

### 4.2 Frontend Chat Welcome Component (`libs/frontend/chat/src/lib/components/templates/welcome.component.ts`)

**Current Implementation**:

- Lines 135-160: Context-aware messaging based on license reason

**Changes Needed**:

1. Community users should see normal welcome, not "subscription required" messaging
2. Update `getHeadline()` and `getSubheadline()` for Community tier

---

## 5. Paddle Dashboard Changes

**NOT code changes** - Paddle product configuration:

1. DEACTIVATE/ARCHIVE Basic Monthly product (pri_01kfxq4wv28cj0p5h57qevhj1n)
2. DEACTIVATE/ARCHIVE Basic Yearly product (pri_01kfxq67q4sd3zsh6fc20a0een)
3. Keep Pro Monthly and Yearly products active

---

## 6. Database Migration Considerations

**Current Database State**:

- `licenses` table has `plan` column with values: `'basic'`, `'pro'`, `'trial_basic'`, `'trial_pro'`

**Migration Strategy**:

1. Existing `'basic'` and `'trial_basic'` licenses should be mapped to `'community'`
2. Create migration script to update existing records:

```sql
UPDATE licenses
SET plan = 'community'
WHERE plan IN ('basic', 'trial_basic');
```

---

## 7. Files To Modify - Complete List

### VS Code Extension (5 files)

| File                                                                           | Lines                   | Change Description                                |
| ------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------- |
| `libs/backend/vscode-core/src/services/license.service.ts`                     | 50-55, 210-222, 387-393 | Add 'community' tier, return valid for no license |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/license-rpc.handlers.ts` | 130-143                 | Add isCommunity, remove isBasic                   |
| `apps/ptah-extension-vscode/src/main.ts`                                       | 251-264, 388-409        | Community tier bypasses blocking                  |
| `libs/backend/vscode-core/src/services/feature-gate.service.ts`                | 57-64, 192-238          | Add isCommunityTier, remove isBasicTier           |
| `apps/ptah-extension-vscode/src/commands/license-commands.ts`                  | 121-141                 | Update messaging                                  |

### License Server (3 files)

| File                                                               | Lines        | Change Description            |
| ------------------------------------------------------------------ | ------------ | ----------------------------- |
| `apps/ptah-license-server/src/config/plans.config.ts`              | 14-48        | Remove basic, add community   |
| `apps/ptah-license-server/src/license/services/license.service.ts` | 16-21, 44-61 | Update LicenseTier type       |
| `apps/ptah-license-server/src/paddle/paddle.service.ts`            | 799-845      | Remove Basic price ID mapping |

### Landing Page (8+ files)

| File                                                                                   | Lines   | Change Description        |
| -------------------------------------------------------------------------------------- | ------- | ------------------------- |
| `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts`    | 333-428 | Remove Basic plan cards   |
| `apps/ptah-landing-page/src/app/pages/pricing/components/basic-plan-card.component.ts` | ALL     | DELETE FILE               |
| `apps/ptah-landing-page/src/app/pages/pricing/models/pricing-plan.interface.ts`        | 14      | Update tier type          |
| `apps/ptah-landing-page/src/environments/environment.ts`                               | 35-42   | Remove Basic price IDs    |
| `apps/ptah-landing-page/src/app/services/subscription-state.service.ts`                | 50-58   | Update tier normalization |
| `apps/ptah-landing-page/src/app/pages/profile/models/license-data.interface.ts`        | 47      | Update plan type          |
| `apps/ptah-landing-page/src/app/pages/profile/components/*.ts`                         | Various | Update tier display logic |

### Shared Types (2 files)

| File                                                                   | Lines   | Change Description                           |
| ---------------------------------------------------------------------- | ------- | -------------------------------------------- |
| `libs/shared/src/lib/types/rpc.types.ts`                               | 562-598 | Update LicenseTier, LicenseGetStatusResponse |
| `libs/frontend/chat/src/lib/components/templates/welcome.component.ts` | 135-160 | Update messaging for Community               |

---

## 8. Recommended Approach

### Phase 1: Type System Updates

1. Update `LicenseTier` in shared types
2. Add `community` tier, remove `basic` and `trial_basic`
3. Update `LicenseGetStatusResponse` (add `isCommunity`, remove `isBasic`)

### Phase 2: Backend Changes

1. Update plans.config.ts (remove basic, add community)
2. Update LicenseService verification logic
3. Update Paddle webhook handlers (remove Basic mapping)
4. Update feature-gate.service.ts

### Phase 3: VS Code Extension Changes

1. Update license.service.ts (community tier = valid)
2. Update main.ts activation flow
3. Update license-rpc.handlers.ts
4. Update welcome component messaging

### Phase 4: Landing Page Changes

1. Remove Basic plan card and pricing
2. Update pricing grid to single Pro card
3. Update subscription state service
4. Update profile components

### Phase 5: Database & Config Migration

1. Migrate existing Basic licenses to Community
2. Update environment variables
3. Archive Basic products in Paddle dashboard

---

## 9. Risk Analysis

| Risk                             | Probability | Impact | Mitigation                               |
| -------------------------------- | ----------- | ------ | ---------------------------------------- |
| Type mismatches across codebase  | Medium      | High   | Compile-time TypeScript checks           |
| Existing Basic users lose access | High        | High   | Migration script to convert to Community |
| Paddle webhook failures          | Low         | Medium | Keep old price ID handlers for 30 days   |
| Welcome/blocking UI confusion    | Medium      | Medium | Clear messaging updates                  |

---

## 10. Success Metrics

1. Community users can use extension without any "license required" blocking
2. Pro users retain all premium features
3. Upgrade flow from Community to Pro works seamlessly
4. Existing Basic subscribers migrated to Community tier
5. Zero TypeScript compilation errors after changes

---

_Research completed by Research Expert Agent - TASK_2025_128_
_Date: 2025-01-28_
