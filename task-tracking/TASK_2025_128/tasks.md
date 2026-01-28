# Development Tasks - TASK_2025_128

**Total Tasks**: 22 | **Batches**: 5 | **Status**: 5/5 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- LicenseTier type location: `libs/shared/src/lib/types/rpc.types.ts:562-567` - Verified
- LicenseGetStatusResponse.isBasic field exists at line 583 - Verified
- License blocking logic at `main.ts:251` checks `licenseStatus.valid` - Verified
- Plan configuration at `plans.config.ts` uses basic/pro structure - Verified
- clearLicenseKey returns expired status at `license.service.ts:387-393` - Verified

### Risks Identified

| Risk | Severity | Mitigation |
|------|----------|------------|
| PricingPlan interface has `tier: 'basic' | 'pro'` - needs update | MEDIUM | Task 4.1 updates interface first |
| PlanSubscriptionContext type has `'basic' | 'pro' | null` | MEDIUM | Task 4.1 updates all related types |
| ctaAction type is only `'checkout'` - Community needs `'download'` | LOW | Task 4.1 adds new action type |

### Edge Cases to Handle

- [x] Legacy 'basic' and 'trial_basic' database values -> Map to 'community' in Task 2.2
- [x] Legacy Basic Paddle price IDs in webhooks -> Handle gracefully in Task 2.3
- [ ] Existing cached license status with 'basic' tier -> Handled by verifyLicense refresh

---

## Batch 1: Type System Foundation (Phase 1)

**Developer**: backend-developer
**Tasks**: 1 | **Dependencies**: None
**Status**: COMPLETE
**Verified**: 2026-01-28
**Commit**: 02cdac9

### Task 1.1: Update LicenseTier type and LicenseGetStatusResponse interface

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
**Spec Reference**: implementation-plan.md:91-167
**Pattern to Follow**: Current type definition at lines 552-598

**Quality Requirements**:
- Replace `'basic' | 'trial_basic'` with `'community'` in LicenseTier union
- Rename `isBasic` to `isCommunity` in LicenseGetStatusResponse
- Update JSDoc comments to reflect freemium model semantics
- Maintain backward compatibility note in comments for 'expired' tier

**Implementation Details**:
- LicenseTier: `'community' | 'pro' | 'trial_pro' | 'expired'`
- Remove 'trial_basic' (Community has no trial - it's always free)
- Add `isCommunity: boolean` to replace `isBasic: boolean`
- Update documentation comment for TASK_2025_128

**Acceptance Criteria**:
- [x] LicenseTier type has exactly 4 values: community, pro, trial_pro, expired
- [x] LicenseGetStatusResponse has `isCommunity` field (not `isBasic`)
- [x] TypeScript compilation succeeds (expect errors in downstream files - that's expected)
- [x] JSDoc comments updated with freemium model explanation

---

**Batch 1 Verification**:
- File exists at path: `libs/shared/src/lib/types/rpc.types.ts`
- Build: `npx nx build shared` (may have errors - downstream files not yet updated)
- This batch MUST complete before Batches 2, 3, 4, 5

---

## Batch 2: License Server Backend (Phase 2)

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1 complete
**Status**: COMPLETE
**Verified**: 2026-01-28
**Commit**: 717646f

### Task 2.1: Update PLANS configuration for Community tier

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\config\plans.config.ts`
**Spec Reference**: implementation-plan.md:174-248
**Pattern to Follow**: Current PLANS object at lines 14-49

**Quality Requirements**:
- Replace `basic` plan with `community` plan
- Set `monthlyPrice: 0` and `yearlyPrice: 0` for community
- Set `expiresAfterDays: null` (never expires)
- Keep `pro` plan unchanged except rename feature `all_basic_features` to `all_community_features`

**Implementation Details**:
```typescript
community: {
  name: 'Community',
  features: ['basic_cli_wrapper', 'session_history', 'permission_management',
             'sdk_access', 'real_time_streaming', 'basic_workspace_context'],
  expiresAfterDays: null,
  monthlyPrice: 0,
  yearlyPrice: 0,
  isPremium: false,
  description: 'Free visual editor for Claude Code',
}
```

**Acceptance Criteria**:
- [x] PLANS object has 'community' key (not 'basic')
- [x] Community plan has `monthlyPrice: 0` and `yearlyPrice: 0`
- [x] Pro plan features array has 'all_community_features' (not 'all_basic_features')
- [x] PlanName type is `'community' | 'pro'`

---

### Task 2.2: Update LicenseTier and mapPlanToTier in license service

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\services\license.service.ts`
**Spec Reference**: implementation-plan.md:253-324
**Pattern to Follow**: Current implementation at lines 16-61

**Quality Requirements**:
- Update LicenseTier type to match shared types
- Add migration compatibility for 'basic' and 'trial_basic' database values
- Map all legacy basic values to 'community'

**Implementation Details**:
- LicenseTier: `'community' | 'pro' | 'trial_pro' | 'expired'`
- mapPlanToTier: 'basic' -> 'community', 'trial_basic' -> 'community'
- Keep 'pro' and 'trial_pro' mappings unchanged

**Acceptance Criteria**:
- [x] LicenseTier has 4 values: community, pro, trial_pro, expired
- [x] mapPlanToTier('basic', false) returns 'community'
- [x] mapPlanToTier('trial_basic', true) returns 'community'
- [x] mapPlanToTier('community', false) returns 'community'

---

### Task 2.3: Update mapPriceIdToPlan in Paddle service

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\paddle\paddle.service.ts`
**Spec Reference**: implementation-plan.md:326-398
**Pattern to Follow**: Current implementation at lines 799-845

**Quality Requirements**:
- Only map Pro price IDs to 'pro' plan
- Handle legacy Basic price IDs gracefully (log warning, return 'expired')
- Add clear migration comment explaining why Basic IDs are ignored

**Implementation Details**:
- Remove Basic price ID mapping (Community is free, no Paddle)
- Keep Pro price ID mappings unchanged
- Legacy Basic price IDs: log warning and return 'expired'

**Acceptance Criteria**:
- [x] Only Pro monthly and yearly price IDs map to 'pro'
- [x] Legacy Basic price IDs trigger warning log and return 'expired'
- [x] Unknown price IDs return 'expired' with warning
- [x] No references to 'basic' plan in return values

---

**Batch 2 Verification**:
- [x] Build passes: `npx nx build ptah-license-server`
- [x] All files modified at specified paths
- [x] Migration compatibility for legacy 'basic' values

---

## Batch 3: VS Code Extension Backend (Phase 3)

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 1 complete
**Status**: COMPLETE
**Verified**: 2026-01-28
**Commit**: a3e9e15

### Task 3.1: Update LicenseTierValue and verifyLicense for Community tier

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\license.service.ts`
**Spec Reference**: implementation-plan.md:406-481
**Pattern to Follow**: Current implementation at lines 50-55 and 210-222

**Quality Requirements**:
- Update LicenseTierValue type to match shared types
- Change no-license-key handling: return `valid: true, tier: 'community'`
- Update clearLicenseKey to return community status (not expired)

**Critical Change - No License Key Handling (lines 210-222)**:
```typescript
if (!licenseKey) {
  const communityStatus: LicenseStatus = {
    valid: true,           // CHANGED from false
    tier: 'community',     // CHANGED from 'expired'
    // No reason field - Community is valid state
  };
  this.updateCache(communityStatus);
  return communityStatus;
}
```

**Critical Change - clearLicenseKey (lines 386-394)**:
```typescript
const communityStatus: LicenseStatus = {
  valid: true,           // CHANGED from false
  tier: 'community',     // CHANGED from 'expired'
};
```

**Acceptance Criteria**:
- [x] LicenseTierValue has 4 values: community, pro, trial_pro, expired
- [x] verifyLicense() with no license key returns `{valid: true, tier: 'community'}`
- [x] clearLicenseKey() sets cache to `{valid: true, tier: 'community'}`
- [x] No 'basic' or 'trial_basic' references in type or code

---

### Task 3.2: Update main.ts license check (minimal change)

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts`
**Spec Reference**: implementation-plan.md:483-520
**Pattern to Follow**: Current implementation at lines 251-269

**Quality Requirements**:
- Existing logic is correct - Community users have `valid: true` and bypass blocking
- Add clarifying comment about freemium model
- Update log message to reflect new model

**Implementation Details**:
- The blocking check `if (!licenseStatus.valid)` remains unchanged
- Community users have `valid: true` so they automatically bypass
- Only users with `valid: false` (expired/revoked) are blocked

**Acceptance Criteria**:
- [x] Blocking logic unchanged (only blocks `valid: false`)
- [x] Comments updated to explain freemium model
- [x] Log message reflects tier correctly

---

### Task 3.3: Update license RPC handler response mapping

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\license-rpc.handlers.ts`
**Spec Reference**: implementation-plan.md:523-603
**Pattern to Follow**: Current implementation at lines 129-181

**Quality Requirements**:
- Replace `isBasic` with `isCommunity` in response
- Update tier detection logic to use 'community' instead of 'basic'
- Maintain reason field mapping unchanged

**Implementation Details**:
```typescript
const isPremium = status.tier === 'pro' || status.tier === 'trial_pro';
const isCommunity = status.tier === 'community';

return {
  ...
  isPremium,
  isCommunity,  // RENAMED from isBasic
  ...
};
```

**Acceptance Criteria**:
- [x] Response includes `isCommunity` field (not `isBasic`)
- [x] `isCommunity` is true only when tier is 'community'
- [x] `isPremium` logic unchanged (pro or trial_pro)
- [x] No references to 'basic' or 'trial_basic' in tier checks

---

### Task 3.4: Update FeatureGateService tier methods

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\feature-gate.service.ts`
**Spec Reference**: implementation-plan.md:605-655
**Pattern to Follow**: Current implementation at lines 192-248

**Quality Requirements**:
- Replace `isBasicTier()` with `isCommunityTier()`
- Update `isTrialActive()` to only check for 'trial_pro'
- Update JSDoc comments

**Implementation Details**:
```typescript
async isCommunityTier(): Promise<boolean> {
  const status = await this.getLicenseStatus();
  return status.tier === 'community';
}

async isTrialActive(): Promise<boolean> {
  const status = await this.getLicenseStatus();
  return status.tier === 'trial_pro';  // Only Pro has trial
}
```

**Acceptance Criteria**:
- [x] Method `isCommunityTier()` exists (replaces `isBasicTier()`)
- [x] `isBasicTier()` method removed or deprecated
- [x] `isTrialActive()` only checks for 'trial_pro' (not 'trial_basic')
- [x] JSDoc comments updated for freemium model

---

### Task 3.5: Update license commands messaging

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\commands\license-commands.ts`
**Spec Reference**: implementation-plan.md:656-735
**Pattern to Follow**: Current implementation at lines 121-181

**Quality Requirements**:
- Update removeLicenseKey message to mention "Community tier"
- Update checkLicenseStatus to show correct tier names
- No user-facing references to "Basic" tier

**Implementation Details**:
- removeLicenseKey: "You will be downgraded to the Community tier. Core features will remain available."
- checkLicenseStatus: Display "Community (Free)" for community tier
- Show "Never" for expires and "Unlimited" for days remaining for Community

**Acceptance Criteria**:
- [x] removeLicenseKey warning mentions "Community tier"
- [x] checkLicenseStatus shows "Community (Free)" for community users
- [x] No "Premium features will be disabled" messaging (misleading for freemium)
- [x] Community tier shows "Never" expires and "Unlimited" days

---

**Batch 3 Verification**:
- [x] Build passes: `npx nx build ptah-extension-vscode`
- [x] Build passes: `npx nx build vscode-core`
- [x] All 5 files modified at specified paths
- [x] code-logic-reviewer approved (spot-check verification)

---

## Batch 4: Landing Page Frontend (Phase 4)

**Developer**: frontend-developer
**Tasks**: 7 | **Dependencies**: Batch 1 complete
**Status**: COMPLETE
**Verified**: 2026-01-28
**Commit**: 442bd43

### Task 4.1: Update pricing plan interface types

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\models\pricing-plan.interface.ts`
**Spec Reference**: implementation-plan.md:742-758
**Pattern to Follow**: Current interface at lines 1-222

**Quality Requirements**:
- Update `tier` type from `'basic' | 'pro'` to `'community' | 'pro'`
- Add `'download'` to ctaAction type for Community (opens VS Code marketplace)
- Update PlanSubscriptionContext.currentPlanTier type

**Implementation Details**:
```typescript
tier: 'community' | 'pro';  // Line 14
ctaAction: 'checkout' | 'download';  // Add download for free tier

// PlanSubscriptionContext (line 97)
currentPlanTier: 'community' | 'pro' | null;
```

**Acceptance Criteria**:
- [x] PricingPlan.tier is `'community' | 'pro'`
- [x] PricingPlan.ctaAction includes `'download'` option
- [x] PlanSubscriptionContext.currentPlanTier is `'community' | 'pro' | null`
- [x] All JSDoc comments reference Community (not Basic)

---

### Task 4.2: Create CommunityPlanCardComponent

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\community-plan-card.component.ts`
**Spec Reference**: implementation-plan.md:815-986
**Pattern to Follow**: `basic-plan-card.component.ts` structure (to be deleted)

**Quality Requirements**:
- Create new component for free Community tier display
- No checkout integration (it's free!)
- CTA: "Install Free" button opens VS Code marketplace
- Show "Free Forever" badge
- Handle isCurrentPlan for authenticated Community users
- Handle isProUser to show "Included in Pro" badge

**Implementation Details**:
- Copy structure from basic-plan-card.component.ts
- Remove all Paddle/checkout logic
- CTA click: `window.open('https://marketplace.visualstudio.com/items?itemName=ptah.ptah-extension', '_blank')`
- Badge variants: "Free Forever" (default), "Current Plan", "Included in Pro"

**Acceptance Criteria**:
- [x] Component renders Community plan with "Free forever" pricing
- [x] CTA button says "Install Free" and opens VS Code marketplace
- [x] Pro users see "Included in Pro" badge and disabled button
- [x] Community users see "Current Plan" badge
- [x] No Paddle checkout references

---

### Task 4.3: Update pricing-grid.component.ts for Community tier

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts`
**Spec Reference**: implementation-plan.md:760-813
**Pattern to Follow**: Current implementation at lines 325-448

**Quality Requirements**:
- Replace BasicPlanCardComponent import with CommunityPlanCardComponent
- Replace basicMonthlyPlan/basicYearlyPlan with single communityPlan
- Update template to use community-plan-card
- Keep Pro plan cards unchanged

**Implementation Details**:
- Remove: `import { BasicPlanCardComponent }`
- Add: `import { CommunityPlanCardComponent }`
- Replace basicMonthlyPlan and basicYearlyPlan with single communityPlan
- Community has no monthly/yearly toggle (always free)

```typescript
public readonly communityPlan: PricingPlan = {
  name: 'Community',
  tier: 'community',
  price: 'Free',
  priceSubtext: 'forever',
  priceId: undefined,
  idealFor: 'Perfect for getting started',
  trialDays: undefined,
  features: [],
  standoutFeatures: [...],
  ctaText: 'Install Free',
  ctaAction: 'download',
};
```

**Acceptance Criteria**:
- [x] Imports CommunityPlanCardComponent (not BasicPlanCardComponent)
- [x] Template renders `<ptah-community-plan-card>` (not basic)
- [x] communityPlan has `ctaAction: 'download'`
- [x] Pro plans unchanged
- [x] Billing toggle only affects Pro cards

---

### Task 4.4: Delete BasicPlanCardComponent

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\basic-plan-card.component.ts`
**Action**: DELETE

**Quality Requirements**:
- Remove entire file (517 lines)
- Ensure no remaining imports reference this component

**Acceptance Criteria**:
- [x] File deleted from filesystem
- [x] No compilation errors from missing import
- [x] pricing-grid.component.ts uses CommunityPlanCardComponent instead

---

### Task 4.5: Update subscription-state.service.ts tier computation

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\subscription-state.service.ts`
**Spec Reference**: implementation-plan.md:995-1043
**Pattern to Follow**: Current implementation at lines 50-58

**Quality Requirements**:
- Update return type from `'basic' | 'pro' | null` to `'community' | 'pro' | null`
- No subscription = Community (free tier), not null
- Map 'basic' and 'trial_basic' to 'community' for migration

**Implementation Details**:
```typescript
public readonly currentPlanTier = computed<'community' | 'pro' | null>(() => {
  const data = this._licenseData();
  if (!data?.plan) return 'community';  // No subscription = Community
  if (data.plan.includes('pro')) return 'pro';
  if (data.plan.includes('basic') || data.plan.includes('community')) {
    return 'community';
  }
  return 'community';  // Default to community for unknown
});
```

**Acceptance Criteria**:
- [x] Return type is `'community' | 'pro' | null`
- [x] No subscription returns 'community' (not null)
- [x] 'basic' and 'trial_basic' map to 'community'
- [x] 'pro' and 'trial_pro' map to 'pro'

---

### Task 4.6: Update environment files to remove Basic price IDs

**Status**: COMPLETE
**Files**:
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\environments\environment.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\environments\environment.production.ts`
**Spec Reference**: implementation-plan.md:1044-1080

**Quality Requirements**:
- Remove `basicPriceIdMonthly` and `basicPriceIdYearly` properties
- Keep Pro price IDs unchanged
- Add comment explaining Community is free (no Paddle)

**Implementation Details**:
```typescript
paddle: {
  environment: 'sandbox' as const,
  token: '...',
  // Pro plan price IDs (only paid plan)
  proPriceIdMonthly: 'pri_01kfr72reygmkapd0vtynrswm4',
  proPriceIdYearly: 'pri_01kfr76e7fz41sp05w74jy4fx6',
  // NOTE: Basic price IDs removed - Community tier is FREE
},
```

**Acceptance Criteria**:
- [x] No `basicPriceIdMonthly` property in either environment file
- [x] No `basicPriceIdYearly` property in either environment file
- [x] Pro price IDs unchanged
- [x] Both environment.ts and environment.production.ts updated

---

### Task 4.7: Update license-data.interface.ts plan type

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\models\license-data.interface.ts`
**Spec Reference**: implementation-plan.md:1082-1099
**Pattern to Follow**: Current interface at line 47

**Quality Requirements**:
- Update `plan` field type to include 'community'
- Remove 'trial_basic' (Community has no trial)
- Add migration note in comment

**Implementation Details**:
```typescript
// Line 47
plan: 'community' | 'pro' | 'trial_pro';
```

**Acceptance Criteria**:
- [x] LicenseData.plan type is `'community' | 'pro' | 'trial_pro'`
- [x] No 'basic' or 'trial_basic' in type
- [x] JSDoc comment explains Community is free tier

---

**Batch 4 Verification**:
- [x] Build passes: `npx nx build ptah-landing-page`
- [x] All files modified/created/deleted at specified paths
- [x] No remaining references to BasicPlanCardComponent in active code
- [x] Spot-check verification: all acceptance criteria met

---

## Batch 5: Frontend Chat (Phase 5)

**Developer**: frontend-developer
**Tasks**: 1 | **Dependencies**: Batch 1 complete
**Status**: COMPLETE
**Verified**: 2026-01-28
**Commit**: e3b8521

### Task 5.1: Update welcome component messaging (minimal)

**Status**: COMPLETE
**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\welcome.component.ts`
**Spec Reference**: implementation-plan.md:1106-1152
**Pattern to Follow**: Current implementation at lines 135-160

**Quality Requirements**:
- Minimal changes - Community users bypass this component entirely
- This component only shows for `valid: false` (expired/revoked)
- Optionally enhance messaging to mention Community fallback option

**Implementation Details**:
The welcome component is shown via `handleLicenseBlocking` in main.ts, which only triggers when `licenseStatus.valid === false`. Since Community users have `valid: true`, they never see this component.

Optional enhancement to getSubheadline:
```typescript
case 'expired':
  return "Renew your subscription to continue using Ptah's premium features, or downgrade to Community (free).";
case 'trial_ended':
  return 'Subscribe to Pro for premium features, or continue with Community (free).';
```

**Acceptance Criteria**:
- [x] No blocking changes to existing logic
- [x] Optional: Messaging mentions Community as free fallback option
- [x] Component continues to work for expired/revoked license users

---

**Batch 5 Verification**:
- [x] Build passes: `npx nx build chat`
- [x] Welcome component still renders for expired license users
- [x] Messaging mentions Community (free) as fallback for expired/trial_ended
- [x] No blocking changes to existing logic

---

## Execution Order Summary

```
Batch 1 (Type System) ─────┬─────> Batch 2 (License Server)
                           │
                           ├─────> Batch 3 (VS Code Extension)
                           │
                           ├─────> Batch 4 (Landing Page)
                           │
                           └─────> Batch 5 (Frontend Chat)
```

**Parallelization**: After Batch 1 completes, Batches 2-5 can theoretically run in parallel since they only depend on Batch 1. However, for safer verification:
- Run Batch 2 and Batch 3 sequentially (both backend)
- Run Batch 4 after Batch 3 (frontend depends on backend types)
- Run Batch 5 last (minimal changes)

---

## Final Verification Checklist

After all batches complete:
- [x] `npx nx build shared` passes
- [x] `npx nx build chat` passes
- [x] `npx nx build ptah-landing-page` passes
- [x] All files modified/created/deleted across 5 commits
- [x] All 5 batch commits verified in git log
- [x] No remaining references to 'basic' tier in active code paths
- [ ] Extension works with no license key (Community tier) - manual test required
- [ ] Pro license key still works correctly - manual test required

---

_Tasks created by Team-Leader Agent - TASK_2025_128_
_Date: 2026-01-28_
_Final verification completed: 2026-01-28_
