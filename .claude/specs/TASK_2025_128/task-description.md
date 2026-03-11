# Requirements Document - TASK_2025_128

## Freemium Model Conversion: Two-Tier Paid to Community + Pro

---

## Introduction

### Business Context

The current two-tier paid licensing model (Basic $3/month + Pro $5/month) implemented in TASK_2025_121 creates an unnecessary barrier to entry for new users. Market analysis and user feedback indicate that a freemium model with a generous free tier would:

1. **Increase adoption**: Users can experience Ptah immediately without payment friction
2. **Simplify pricing**: Reduce decision paralysis with only two clear options
3. **Improve conversion**: Users who experience value are more likely to upgrade
4. **Reduce support burden**: No trial expiration issues or "blocked extension" complaints

### Value Proposition

Transform from a "pay-to-try" model to a "try-then-pay" model:

| Current State               | Target State                         |
| --------------------------- | ------------------------------------ |
| Basic: $3/mo (14-day trial) | Community: FREE forever              |
| Pro: $5/mo (14-day trial)   | Pro: $5/mo or $50/yr                 |
| Expired = Extension BLOCKED | Community = Full basic functionality |

### Project Scope

This conversion impacts 4 major codebases:

- **VS Code Extension**: License verification, feature gating, UI messaging
- **License Server**: Plan definitions, tier mapping, webhook handlers
- **Landing Page**: Pricing UI, subscription state, profile display
- **Shared Types**: Type definitions used across all codebases

---

## Requirements

### Requirement 1: Community Tier Type System

**User Story:** As a developer integrating with the Ptah type system, I want consistent Community tier type definitions across all codebases, so that type safety is maintained and tier checks compile correctly.

#### Acceptance Criteria

1. WHEN `LicenseTier` type is defined THEN it SHALL include `'community' | 'pro' | 'trial_pro' | 'expired'` values
2. WHEN `'basic'` or `'trial_basic'` tier values exist in code THEN they SHALL be removed or migrated to `'community'`
3. WHEN `LicenseGetStatusResponse` interface is used THEN it SHALL include `isCommunity: boolean` flag
4. WHEN `LicenseGetStatusResponse` interface is used THEN it SHALL NOT include `isBasic` flag
5. WHEN TypeScript compilation is run across all projects THEN zero type errors SHALL occur

#### Technical Specifications

**File: `libs/shared/src/lib/types/rpc.types.ts`**

```typescript
// REPLACE existing LicenseTier
export type LicenseTier =
  | 'community' // FREE forever - always valid
  | 'pro'
  | 'trial_pro'
  | 'expired'; // Revoked or payment failed only

// UPDATE LicenseGetStatusResponse
export interface LicenseGetStatusResponse {
  valid: boolean;
  tier: LicenseTier;
  isPremium: boolean; // Pro or trial_pro
  isCommunity: boolean; // NEW: Community tier
  // REMOVE: isBasic
  expiresAt?: string;
  daysRemaining?: number;
  plan?: string;
  email?: string;
}
```

---

### Requirement 2: VS Code Extension - Community User Experience

**User Story:** As a Community tier user, I want to use the Ptah extension immediately without any login, license key, or payment, so that I can experience the core functionality with zero friction.

#### Acceptance Criteria

1. WHEN extension activates with no license key stored THEN `valid: true` with `tier: 'community'` SHALL be returned
2. WHEN extension activates with no license key THEN no blocking welcome page SHALL be displayed
3. WHEN extension activates with no license key THEN full core functionality (visual interface, session history, SDK access) SHALL be available
4. WHEN Community user opens extension THEN status bar SHALL display "Ptah Community" badge with upgrade link
5. WHEN Community user attempts Pro-only features THEN soft upsell message SHALL be shown (not blocking)

#### Technical Specifications

**File: `libs/backend/vscode-core/src/services/license.service.ts`**

```typescript
// CHANGE: Lines 210-222 - No license key = Community (valid)
if (!licenseKey) {
  return {
    valid: true, // CHANGED from false
    tier: 'community', // CHANGED from 'expired'
    isPremium: false,
    isCommunity: true,
  };
}

// ADD to LicenseTierValue type (Line 50-55)
export type LicenseTierValue =
  | 'community' // NEW: Free tier, always valid
  | 'pro'
  | 'trial_pro'
  | 'expired'; // Only for revoked/explicitly expired
```

**File: `apps/ptah-extension-vscode/src/main.ts`**

```typescript
// CHANGE: Lines 251-264 - Community tier bypasses blocking
// Community tier has valid: true, so blocking logic won't trigger
// Only explicit 'expired' (revoked licenses) should block
```

---

### Requirement 3: VS Code Extension - License RPC Handler Updates

**User Story:** As a frontend developer consuming license status via RPC, I want accurate tier flags returned from the backend, so that UI can display correct tier information and gate features appropriately.

#### Acceptance Criteria

1. WHEN `license:getStatus` RPC is called THEN response SHALL include `isCommunity` boolean flag
2. WHEN `license:getStatus` RPC is called THEN response SHALL NOT include `isBasic` boolean flag
3. WHEN tier is `'community'` THEN `isCommunity: true` and `isPremium: false` SHALL be returned
4. WHEN tier is `'pro'` or `'trial_pro'` THEN `isCommunity: false` and `isPremium: true` SHALL be returned

#### Technical Specifications

**File: `apps/ptah-extension-vscode/src/services/rpc/handlers/license-rpc.handlers.ts`**

```typescript
// CHANGE: Lines 130-143
const isPremium = status.tier === 'pro' || status.tier === 'trial_pro';
const isCommunity = status.tier === 'community';  // NEW

return {
  valid: status.valid,
  tier: status.tier,
  isPremium,
  isCommunity,  // NEW
  // REMOVE: isBasic
  ...
};
```

---

### Requirement 4: VS Code Extension - Feature Gate Service Updates

**User Story:** As a developer implementing feature gating, I want clear tier-checking methods that distinguish Community from Pro, so that premium features can be properly restricted.

#### Acceptance Criteria

1. WHEN `isCommunityTier()` method is called THEN `true` SHALL be returned for Community tier users
2. WHEN `isBasicTier()` method exists THEN it SHALL be removed from the codebase
3. WHEN Pro-only feature is accessed by Community user THEN feature gate SHALL prevent access with upgrade prompt
4. WHEN Community user accesses core features THEN full functionality SHALL be provided

#### Technical Specifications

**File: `libs/backend/vscode-core/src/services/feature-gate.service.ts`**

```typescript
// REMOVE: isBasicTier() method (Lines 192-238)

// ADD: isCommunityTier() method
async isCommunityTier(): Promise<boolean> {
  const status = await this.getLicenseStatus();
  return status.tier === 'community';
}

// UPDATE: Feature gating logic - Community has same access as old Basic
```

---

### Requirement 5: VS Code Extension - License Command Messaging

**User Story:** As a user managing my license, I want clear messaging about tier changes when removing or changing my license key, so that I understand what functionality I will have.

#### Acceptance Criteria

1. WHEN user removes license key THEN message SHALL say "You will be downgraded to the Community tier"
2. WHEN user removes license key THEN message SHALL NOT say "Premium features will be disabled"
3. WHEN license status is displayed THEN tier SHALL show "Community" or "Pro" (not "Basic")

#### Technical Specifications

**File: `apps/ptah-extension-vscode/src/commands/license-commands.ts`**

```typescript
// CHANGE: Lines 121-141 - Update messaging
const message = 'Removing your license will downgrade you to the Community tier. ' + 'You will retain full access to core features. Continue?';
```

---

### Requirement 6: License Server - Plan Configuration

**User Story:** As a system administrator, I want the license server to recognize Community tier as the default for users without subscriptions, so that free users are properly identified and served.

#### Acceptance Criteria

1. WHEN `PLANS` configuration is loaded THEN `'community'` plan SHALL exist with `monthlyPrice: 0`
2. WHEN `PLANS` configuration is loaded THEN `'basic'` plan SHALL NOT exist
3. WHEN Community plan features are listed THEN they SHALL include: basic_cli_wrapper, session_history, permission_management, sdk_access, real_time_streaming, basic_workspace_context
4. WHEN Community plan expiration is checked THEN `expiresAfterDays: null` SHALL indicate never expires

#### Technical Specifications

**File: `apps/ptah-license-server/src/config/plans.config.ts`**

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
    // Keep existing pro plan unchanged
    name: 'Pro',
    features: [
      /* existing pro features */
    ],
    monthlyPrice: 5,
    yearlyPrice: 50,
    isPremium: true,
  },
} as const;

// REMOVE: basic plan definition entirely
```

---

### Requirement 7: License Server - Tier Mapping Service

**User Story:** As a license service developer, I want the tier mapping logic to correctly identify Community users, so that API responses return accurate tier information.

#### Acceptance Criteria

1. WHEN `LicenseTier` type is defined THEN it SHALL be `'community' | 'pro' | 'trial_pro' | 'expired'`
2. WHEN database plan is `'community'` THEN tier `'community'` SHALL be returned
3. WHEN database plan is `'basic'` or `'trial_basic'` THEN tier `'community'` SHALL be returned (migration compatibility)
4. WHEN no license record exists THEN implicit `'community'` tier SHALL be assumed (no database record needed)

#### Technical Specifications

**File: `apps/ptah-license-server/src/license/services/license.service.ts`**

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
    case 'basic': // Migration compatibility
    case 'trial_basic': // Migration compatibility
      return 'community';
    default:
      return 'expired';
  }
}
```

---

### Requirement 8: License Server - Paddle Webhook Cleanup

**User Story:** As a payment integration developer, I want the Paddle webhook handler to only recognize Pro price IDs, so that Basic price ID mappings don't cause errors or confusion.

#### Acceptance Criteria

1. WHEN Paddle webhook receives Basic monthly price ID THEN it SHALL be treated as invalid/ignored
2. WHEN Paddle webhook receives Basic yearly price ID THEN it SHALL be treated as invalid/ignored
3. WHEN `mapPriceIdToPlan` function is called THEN only Pro price IDs SHALL map to `'pro'`
4. WHEN environment variables are configured THEN `PADDLE_PRICE_ID_BASIC_MONTHLY` and `PADDLE_PRICE_ID_BASIC_YEARLY` SHALL be removed

#### Technical Specifications

**File: `apps/ptah-license-server/src/paddle/paddle.service.ts`**

```typescript
// CHANGE: Lines 799-845
private mapPriceIdToPlan(priceId: string | undefined): string {
  const proMonthlyPriceId = this.configService.get('PADDLE_PRICE_ID_PRO_MONTHLY');
  const proYearlyPriceId = this.configService.get('PADDLE_PRICE_ID_PRO_YEARLY');

  // REMOVE: All Basic price ID mappings
  if (priceId === proMonthlyPriceId || priceId === proYearlyPriceId) {
    return 'pro';
  }

  return 'expired';  // Unknown price ID
}
```

---

### Requirement 9: Landing Page - Pricing Grid Redesign

**User Story:** As a potential customer visiting the pricing page, I want to see Community (free) and Pro ($5) tiers displayed side-by-side, so that I can easily compare features and understand the value of upgrading.

#### Acceptance Criteria

1. WHEN pricing page loads THEN two tier cards SHALL be displayed: Community and Pro
2. WHEN Community card is displayed THEN it SHALL show features with "Free forever" badge
3. WHEN Community card is displayed THEN no purchase CTA SHALL be shown (already free)
4. WHEN Pro card is displayed THEN monthly ($5) and yearly ($50) pricing options SHALL be shown
5. WHEN Pro card is displayed THEN "Upgrade to Pro" CTA SHALL be shown
6. WHEN `BasicPlanCardComponent` exists THEN it SHALL be deleted from codebase

#### Technical Specifications

**Files to modify:**

- `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts`
- DELETE: `apps/ptah-landing-page/src/app/pages/pricing/components/basic-plan-card.component.ts`

```typescript
// NEW: Community tier display (no pricing, just features)
communityPlan = {
  name: 'Community',
  tier: 'community' as const,
  price: 0,
  period: 'forever',
  features: ['Visual Claude Code interface', 'Session history', 'Permission management', 'Real-time streaming'],
  cta: null, // No CTA needed - already free
};

// KEEP: Pro plan cards unchanged
// REMOVE: Basic plan card references
```

---

### Requirement 10: Landing Page - Environment Configuration Cleanup

**User Story:** As a DevOps engineer configuring the landing page, I want environment variables to only include Pro price IDs, so that Basic price IDs don't cause confusion or errors.

#### Acceptance Criteria

1. WHEN environment configuration is loaded THEN `basicPriceIdMonthly` SHALL NOT exist
2. WHEN environment configuration is loaded THEN `basicPriceIdYearly` SHALL NOT exist
3. WHEN environment configuration is loaded THEN `proPriceIdMonthly` and `proPriceIdYearly` SHALL exist

#### Technical Specifications

**File: `apps/ptah-landing-page/src/environments/environment.ts`**

```typescript
export const environment = {
  // REMOVE: basicPriceIdMonthly
  // REMOVE: basicPriceIdYearly
  proPriceIdMonthly: 'pri_...',
  proPriceIdYearly: 'pri_...',
  // ... other config
};
```

---

### Requirement 11: Landing Page - Subscription State Service

**User Story:** As a logged-in user on the landing page, I want my subscription status to correctly show "Community" or "Pro", so that I understand my current tier.

#### Acceptance Criteria

1. WHEN user has no subscription THEN `currentPlanTier` computed signal SHALL return `'community'`
2. WHEN user has Pro subscription THEN `currentPlanTier` SHALL return `'pro'`
3. WHEN `currentPlanTier` normalizes tiers THEN `'trial_pro'` SHALL map to `'pro'`
4. WHEN `currentPlanTier` normalizes tiers THEN `'basic'` or `'trial_basic'` SHALL map to `'community'`

#### Technical Specifications

**File: `apps/ptah-landing-page/src/app/services/subscription-state.service.ts`**

```typescript
public readonly currentPlanTier = computed<'community' | 'pro' | null>(() => {
  const data = this._licenseData();
  if (!data?.plan) return 'community';  // No subscription = Community
  if (data.plan.includes('pro')) return 'pro';
  if (data.plan.includes('basic')) return 'community';  // Migration
  return 'community';  // Default to Community
});
```

---

### Requirement 12: Landing Page - Profile Components

**User Story:** As a logged-in user viewing my profile, I want to see my tier displayed as "Community" or "Pro" with appropriate feature lists, so that I understand what I have access to.

#### Acceptance Criteria

1. WHEN profile displays tier THEN it SHALL show "Community" or "Pro" (not "Basic")
2. WHEN Community tier is displayed THEN feature list SHALL match Community plan features
3. WHEN Pro tier is displayed THEN feature list SHALL include all premium features

#### Technical Specifications

**Files to modify:**

- `apps/ptah-landing-page/src/app/pages/profile/components/profile-details.component.ts`
- `apps/ptah-landing-page/src/app/pages/profile/components/profile-header.component.ts`
- `apps/ptah-landing-page/src/app/pages/profile/components/profile-features.component.ts`
- `apps/ptah-landing-page/src/app/pages/profile/models/license-data.interface.ts`

---

### Requirement 13: Frontend Chat - Welcome Component Updates

**User Story:** As a Community tier user opening the chat, I want to see a welcoming message that acknowledges my tier without blocking functionality, so that I feel welcomed rather than restricted.

#### Acceptance Criteria

1. WHEN Community user opens chat THEN welcome message SHALL NOT say "subscription required"
2. WHEN Community user opens chat THEN welcome message SHALL highlight available features
3. WHEN Community user opens chat THEN subtle "Upgrade to Pro" option SHALL be visible but not intrusive

#### Technical Specifications

**File: `libs/frontend/chat/src/lib/components/templates/welcome.component.ts`**

```typescript
// UPDATE: Lines 135-160 - Context-aware messaging
getHeadline(): string {
  if (this.isCommunity) {
    return 'Welcome to Ptah';  // Not "Subscription Required"
  }
  return 'Welcome back';
}

getSubheadline(): string {
  if (this.isCommunity) {
    return 'Start chatting with Claude Code';
  }
  return 'Continue your conversation';
}
```

---

## Non-Functional Requirements

### Performance Requirements

- **License Check Latency**: License status check SHALL complete in < 50ms for Community tier (no API call needed)
- **UI Responsiveness**: Pricing page SHALL render within 200ms on standard connection
- **Memory Footprint**: No increase in extension memory usage for Community tier

### Security Requirements

- **No License Key for Community**: Community users SHALL NOT be required to provide any license key or authentication
- **Pro Feature Protection**: Pro-only features SHALL remain gated and inaccessible to Community users
- **No Bypass Vectors**: Extension SHALL NOT expose Pro features through dev tools or configuration

### Accessibility Requirements

- **Clear Tier Indication**: Users SHALL always know which tier they are on via visible UI indicators
- **Upgrade Path Clarity**: Upgrade options SHALL be visible but not intrusive (WCAG 2.1 AA compliance)

### Maintainability Requirements

- **Type Safety**: All tier-related code SHALL pass TypeScript strict mode compilation
- **Single Source of Truth**: `LicenseTier` type SHALL be defined once in shared types
- **Zero Backward Compatibility**: No code SHALL maintain support for `'basic'` or `'trial_basic'` tiers beyond migration mapping

---

## Out of Scope

The following items are explicitly excluded from this task:

1. **Database Migration Script**: While documented, actual SQL migration is out of scope (not live yet, no subscribers)
2. **Paddle Dashboard Configuration**: Deactivating Basic products in Paddle dashboard (manual admin task)
3. **Email Communication**: No user notification emails about tier changes
4. **Analytics/Telemetry**: No changes to usage tracking or analytics
5. **Documentation Updates**: No README or user documentation updates
6. **Marketing Copy Changes**: Landing page copy beyond pricing/tier display (see TASK_2025_122 for reference)
7. **Trial Period for Pro**: No changes to Pro trial mechanics (still 14-day trial)
8. **Refund Handling**: No changes to refund or chargeback logic

---

## Dependencies

### Internal Dependencies

| Dependency    | Description                        | Impact                                  |
| ------------- | ---------------------------------- | --------------------------------------- |
| TASK_2025_121 | Two-Tier Paid Model Implementation | Direct reversal of this implementation  |
| TASK_2025_126 | Embedded Welcome Page              | Must update for Community tier handling |
| TASK_2025_127 | Authenticated Pricing Views        | Subscription state logic affected       |

### External Dependencies

| Dependency          | Description           | Impact                                    |
| ------------------- | --------------------- | ----------------------------------------- |
| Paddle Dashboard    | Product configuration | Basic products need deactivation (manual) |
| TypeScript Compiler | Type checking         | All type changes must compile             |

---

## Risk Assessment

### Technical Risks

| Risk                                       | Probability | Impact | Mitigation                                                | Contingency                               |
| ------------------------------------------ | ----------- | ------ | --------------------------------------------------------- | ----------------------------------------- |
| Type mismatches across 4 codebases         | Medium      | High   | Compile-time TypeScript checks, update shared types first | Incremental rollout per codebase          |
| Paddle webhook receives old Basic price ID | Low         | Medium | Keep price ID handlers for 30 days returning 'expired'    | Manual license fix via admin API          |
| Feature gate bypass for Pro features       | Low         | High   | Code review, integration testing                          | Hotfix capability within 24h              |
| UI/UX confusion about tier status          | Medium      | Medium | Clear messaging, visual indicators                        | User feedback collection, rapid iteration |

### Business Risks

| Risk            | Probability | Impact | Mitigation                   |
| --------------- | ----------- | ------ | ---------------------------- |
| None - Not live | N/A         | N/A    | No existing users to migrate |

---

## Success Metrics

### Functional Success

1. Community users can activate and use extension with zero friction (no login/license required)
2. Pro users retain all premium features unchanged
3. Upgrade flow from Community to Pro works seamlessly
4. Zero TypeScript compilation errors after all changes

### Technical Success

1. All 18+ affected files updated with correct tier logic
2. All tests pass (existing + new tier-specific tests)
3. No `'basic'` or `'trial_basic'` references remain in active code paths
4. License check returns `valid: true` for Community tier in < 50ms

### User Experience Success

1. Extension activates immediately for new users (Community tier)
2. Status bar clearly shows "Ptah Community" or "Ptah Pro"
3. Pricing page displays clear comparison of Community vs Pro
4. Profile page shows correct tier with feature list

---

## Implementation Notes

### Recommended Implementation Order

**Phase 1: Type System Foundation**

1. Update `LicenseTier` in `libs/shared/src/lib/types/rpc.types.ts`
2. Run TypeScript compilation to identify all affected files

**Phase 2: Backend License Server**

1. Update `plans.config.ts` (remove basic, add community)
2. Update `license.service.ts` tier mapping
3. Update `paddle.service.ts` price ID mapping

**Phase 3: VS Code Extension**

1. Update `license.service.ts` (community = valid)
2. Update `license-rpc.handlers.ts` (isCommunity flag)
3. Update `feature-gate.service.ts` (isCommunityTier method)
4. Update `main.ts` (activation flow)
5. Update `license-commands.ts` (messaging)

**Phase 4: Landing Page**

1. Delete `basic-plan-card.component.ts`
2. Update `pricing-grid.component.ts`
3. Update `subscription-state.service.ts`
4. Update profile components
5. Update environment configuration

**Phase 5: Frontend Chat**

1. Update `welcome.component.ts` messaging

### Files Affected Summary

| Codebase          | Files   | Lines Changed (Est.) |
| ----------------- | ------- | -------------------- |
| Shared Types      | 1       | ~30                  |
| VS Code Extension | 5       | ~150                 |
| License Server    | 3       | ~80                  |
| Landing Page      | 8+      | ~200                 |
| Frontend Chat     | 1       | ~20                  |
| **Total**         | **18+** | **~480**             |

---

## Stakeholder Sign-off

### Primary Stakeholders

- **Product Owner**: Approves business model change from paid to freemium
- **Development Lead**: Approves technical approach and implementation order
- **QA Lead**: Confirms test coverage requirements

### Approval Checklist

- [ ] Product Owner approves freemium business model
- [ ] Technical approach reviewed and approved
- [ ] Risk mitigations accepted
- [ ] Implementation timeline agreed

---

_Requirements Document created by Project Manager Agent - TASK_2025_128_
_Date: 2026-01-28_
