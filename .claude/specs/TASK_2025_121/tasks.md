# Development Tasks - TASK_2025_121

**Total Tasks**: 22 | **Batches**: 5 | **Status**: 5/5 COMPLETE

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

1. **LicenseStatus interface exists and is modifiable**: Verified at `libs/backend/vscode-core/src/services/license.service.ts:21-35`
2. **PLANS config is a const object with getPlanConfig helper**: Verified at `apps/ptah-license-server/src/config/plans.config.ts:12-60`
3. **Paddle webhook handling exists with mapPriceIdToPlan**: Verified at `apps/ptah-license-server/src/paddle/paddle.service.ts:665-683`
4. **RPC types exist with LicenseTier and LicenseGetStatusResponse**: Verified at `libs/shared/src/lib/types/rpc.types.ts:552-570`
5. **Extension main.ts has license verification pattern**: Verified at `apps/ptah-extension-vscode/src/main.ts:143-161`
6. **DI tokens exist in TOKENS namespace**: Verified at `libs/backend/vscode-core/src/di/tokens.ts:110-111`
7. **Pricing grid component uses PricingPlan interface**: Verified at `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts`
8. **Environment config has paddle section**: Verified at `apps/ptah-landing-page/src/environments/environment.ts:22-30`

### Risks Identified

| Risk                                                                                    | Severity | Mitigation                                                      |
| --------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------- |
| Current tier values 'free' and 'early_adopter' need backward compatibility mapping      | MEDIUM   | Add mapLegacyTier() function in license verification - Task 2.2 |
| Prisma schema uses String type (flexible) but comments reference old values             | LOW      | Update comments only, no migration needed - Task 2.4            |
| Current main.ts license check is at Step 7.5 (late), needs to move earlier for blocking | HIGH     | Task 3.1 will move check to BEFORE service initialization       |
| PricingPlan interface tier only has 'free' and 'pro' - needs 'basic'                    | MEDIUM   | Task 4.1 will update interface                                  |
| Environment has only proMonthly/proYearly, needs basic plan IDs                         | MEDIUM   | Task 4.4 will add new price IDs                                 |

### Edge Cases to Handle

- [ ] Existing 'early_adopter' users should be mapped to 'pro' -> Handled in Task 2.2
- [ ] Existing 'free' trial users should be mapped to 'trial_basic' -> Handled in Task 2.2
- [ ] License key not found should return 'expired' tier, not 'free' -> Handled in Task 2.2
- [ ] Network failure during license check should use grace period cache -> Handled in Task 3.4
- [ ] Extension should block without valid license -> Handled in Task 3.1

---

## Batch 1: Type System and Plan Configuration (Foundation) - COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None
**Commit**: 4763649

### Task 1.1: Update Plan Configuration

**Status**: COMPLETE
**File(s)**: `D:\projects\ptah-extension\apps\ptah-license-server\src\config\plans.config.ts`
**Spec Reference**: implementation-plan.md:169-231
**Pattern to Follow**: Current PLANS object structure at lines 12-45

**Quality Requirements**:

- Remove 'free' plan entirely
- Define 'basic' plan with: $3/month, $30/year, core features list
- Define 'pro' plan with: $5/month, $50/year, all premium features
- Both plans have expiresAfterDays: null (subscription-based via Paddle)
- Update PlanName type to 'basic' | 'pro'
- Update getPlanConfig and calculateExpirationDate functions

**Validation Notes**:

- Feature arrays must match tier feature matrix from implementation plan
- isPremium: false for basic, true for pro

**Implementation Details**:

- Imports: No new imports needed
- Exports: PLANS, PlanName, getPlanConfig, calculateExpirationDate
- Key Logic: Complete rewrite of PLANS const with new Basic/Pro structure

---

### Task 1.2: Update LicenseStatus Interface (vscode-core)

**Status**: COMPLETE
**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\license.service.ts`
**Spec Reference**: implementation-plan.md:237-293
**Pattern to Follow**: Current LicenseStatus interface at lines 21-35

**Quality Requirements**:

- Update tier union to: 'basic' | 'pro' | 'trial_basic' | 'trial_pro' | 'expired'
- Add trialActive?: boolean field
- Add trialDaysRemaining?: number field
- Update reason union to include 'trial_ended'
- Remove 'free' and 'early_adopter' from tier type

**Validation Notes**:

- This is the extension-side interface used by LicenseService
- Must be compatible with server response structure

**Implementation Details**:

- Imports: No new imports
- Key Logic: Interface modification only

---

### Task 1.3: Update RPC Types for License Tier

**Status**: COMPLETE
**File(s)**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
**Spec Reference**: implementation-plan.md:267-283
**Pattern to Follow**: Current LicenseTier type at line 553, LicenseGetStatusResponse at lines 556-570

**Quality Requirements**:

- Update LicenseTier to: 'basic' | 'pro' | 'trial_basic' | 'trial_pro' | 'expired'
- Add isBasic: boolean field to LicenseGetStatusResponse
- Add trialActive: boolean field
- Add trialDaysRemaining: number | null field
- Update plan.features to string[] type

**Validation Notes**:

- This is the shared type used by both frontend and backend
- Must sync with LicenseStatus interface changes

**Implementation Details**:

- Imports: No new imports
- Key Logic: Type definition updates only

---

### Task 1.4: Update vscode-core Index Exports

**Status**: COMPLETE
**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\index.ts`
**Dependencies**: Task 1.2
**Spec Reference**: implementation-plan.md:483
**Pattern to Follow**: Current export pattern in index.ts

**Quality Requirements**:

- Ensure LicenseStatus interface is exported
- Prepare for FeatureGateService export (to be added in Batch 3)

**Validation Notes**:

- Check existing exports for LicenseService, LicenseStatus
- No new service exports in this task (FeatureGateService comes in Batch 3)

**Implementation Details**:

- Key Logic: Verify exports are correct, may be no-op if already exported

---

**Batch 1 Verification**:

- All files exist at paths
- Build passes: `npx nx build vscode-core` and `npx nx build ptah-license-server`
- TypeScript compiles without errors
- No breaking changes to existing code

---

## Batch 2: License Server Updates (Backend) - COMPLETE

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 1
**Commit**: 93d0ccc

### Task 2.1: Update Paddle Service Plan Mapping

**Status**: COMPLETE
**File(s)**: `D:\projects\ptah-extension\apps\ptah-license-server\src\paddle\paddle.service.ts`
**Spec Reference**: implementation-plan.md:490-536
**Pattern to Follow**: Current mapPriceIdToPlan at lines 665-683

**Quality Requirements**:

- Support 4 Price IDs: BASIC_MONTHLY, BASIC_YEARLY, PRO_MONTHLY, PRO_YEARLY
- Unknown Price IDs return 'expired' (not 'free')
- Log warnings for unknown Price IDs
- Read from environment: PADDLE_PRICE_ID_BASIC_MONTHLY, PADDLE_PRICE_ID_BASIC_YEARLY

**Validation Notes**:

- Existing proMonthlyPriceId and proYearlyPriceId env vars remain
- New basicMonthlyPriceId and basicYearlyPriceId env vars needed

**Implementation Details**:

- Imports: No new imports
- Key Logic: Expand mapPriceIdToPlan to check 4 price IDs

---

### Task 2.2: Update License Server Verification Logic

**Status**: COMPLETE
**File(s)**: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\services\license.service.ts`
**Spec Reference**: implementation-plan.md:539-618
**Pattern to Follow**: Current verifyLicense method at lines 30-88

**Quality Requirements**:

- Return new tier values: 'basic' | 'pro' | 'trial_basic' | 'trial_pro' | 'expired'
- Detect trial status from subscription.status === 'trialing'
- Include subscription lookup via user relation
- Add mapLegacyTier() function for backward compatibility
- Return trialActive and trialDaysRemaining fields

**Validation Notes**:

- Legacy 'early_adopter' maps to 'pro'
- Legacy 'free' maps to 'trial_basic' if trial active, else 'expired'
- Include subscription in prisma query for trial detection

**Implementation Details**:

- Imports: Add subscription include in prisma query
- Key Logic: Update verifyLicense return type and add trial detection

---

### Task 2.3: Update Webhook Handler for Trial Support

**Status**: COMPLETE
**File(s)**: `D:\projects\ptah-extension\apps\ptah-license-server\src\paddle\paddle.service.ts`
**Spec Reference**: implementation-plan.md:890-953
**Pattern to Follow**: Current handleSubscriptionCreated at lines 258-359

**Quality Requirements**:

- Detect trial from data.status === 'trialing'
- Store licensePlan as 'trial_basic' or 'trial_pro' when in trial
- Store trialEnd date from data.trial_end in subscription
- Handle subscription.activated to remove trial prefix

**Validation Notes**:

- Trial detection comes from Paddle webhook status field
- Must coordinate with Task 2.4 for trialEnd field in schema

**Implementation Details**:

- Imports: No new imports
- Key Logic: Add trial detection in handleSubscriptionCreated, update subscription.create to include trialEnd

---

### Task 2.4: Update Prisma Schema

**Status**: COMPLETE
**File(s)**: `D:\projects\ptah-extension\apps\ptah-license-server\prisma\schema.prisma`
**Spec Reference**: implementation-plan.md:620-682
**Pattern to Follow**: Current License model at lines 54-71, Subscription model at lines 35-52

**Quality Requirements**:

- Add trialEnd DateTime? field to Subscription model
- Update License model comment to reflect new plan values
- No breaking schema changes (String type is flexible)
- Add paused status to subscription status comment

**Validation Notes**:

- No migration needed for plan field (already String)
- trialEnd field addition requires migration

**Implementation Details**:

- Key Logic: Add trialEnd field with @map("trial_end"), update comments

---

### Task 2.5: Generate Prisma Migration

**Status**: COMPLETE
**File(s)**: N/A (command execution)
**Dependencies**: Task 2.4
**Spec Reference**: implementation-plan.md:679-681

**Quality Requirements**:

- Generate migration for trialEnd field
- Migration should be additive (no data loss)
- Migration name should be descriptive: add_trial_end_to_subscription

**Validation Notes**:

- Run prisma migrate dev --name add_trial_end_to_subscription
- Verify migration SQL is correct

**Implementation Details**:

- Command: `cd apps/ptah-license-server && npx prisma migrate dev --name add_trial_end_to_subscription`
- Prisma client generated successfully
- Migration to be run against database when deployed (requires DATABASE_URL)

---

**Batch 2 Verification**:

- All files exist at paths
- Build passes: `npx nx build ptah-license-server`
- Prisma migration runs successfully
- code-logic-reviewer approved

---

## Batch 3: Extension Enforcement (Backend) - COMPLETE

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 1
**Commit**: 93c1fe0

### Task 3.1: Update Extension Activation with License Blocking

**Status**: COMPLETE
**File(s)**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts`
**Spec Reference**: implementation-plan.md:299-377
**Pattern to Follow**: Current activation at lines 16-260, license check at lines 143-161

**Quality Requirements**:

- Move license verification to BEFORE full DI setup (after minimal DI)
- Block extension if license is invalid (show modal, return early)
- Only register license entry command when blocked
- Call showLicenseRequiredUI() helper function
- Valid license continues with normal activation flow

**Validation Notes**:

- HIGH RISK: This changes activation order significantly
- Must handle case where license service itself fails to initialize
- Retry license verification when user enters license key

**Implementation Details**:

- Imports: May need vscode.window for modal
- Key Logic: Add early license check with blocking modal, separate minimal DI setup

---

### Task 3.2: Add DIContainer.setupMinimal Method

**Status**: COMPLETE
**File(s)**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.ts`
**Dependencies**: Task 3.1
**Spec Reference**: implementation-plan.md:318-320, 375-376
**Pattern to Follow**: Current setup method at lines 106-301

**Quality Requirements**:

- Create setupMinimal() method that only registers license-related services
- Register: EXTENSION_CONTEXT, OUTPUT_MANAGER, LOGGER, LICENSE_SERVICE
- This is called BEFORE full setup() when checking license
- Full setup() only called after license is validated

**Validation Notes**:

- Minimal setup must be fast and reliable
- Don't register services that depend on license status

**Implementation Details**:

- Key Logic: Extract minimal DI setup into new method

---

### Task 3.3: Create FeatureGateService

**Status**: COMPLETE
**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\feature-gate.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md:379-486
**Pattern to Follow**: Current LicenseService pattern at license.service.ts:63-340

**Quality Requirements**:

- Injectable service with LicenseService dependency
- isFeatureEnabled(feature: Feature) method
- hasValidLicense() method
- isProTier() method
- Cache license status to avoid repeated API calls
- invalidateCache() method for license changes

**Validation Notes**:

- Feature type should enumerate Pro-only features
- Pro-only: mcp_server, workspace_intelligence, openrouter_proxy, custom_tools, setup_wizard, cost_tracking

**Implementation Details**:

- Imports: inject from tsyringe, TOKENS, Logger, LicenseService
- Decorators: @injectable()
- Key Logic: Feature checking based on cached license tier

---

### Task 3.4: Update LicenseService with Offline Grace Period

**Status**: COMPLETE
**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\license.service.ts`
**Spec Reference**: implementation-plan.md:818-881
**Pattern to Follow**: Current cache pattern at lines 68-74

**Quality Requirements**:

- Add GRACE_PERIOD_MS constant (7 days)
- Persist cache to VS Code storage (survives restarts)
- On network error, use persisted cache if within grace period
- Add persistCacheToStorage() and loadPersistedCache() methods
- Log warning when using offline cached license

**Validation Notes**:

- Grace period is for network failures only, not expired licenses
- Use context.globalState for persistence

**Implementation Details**:

- Imports: No new imports needed
- Key Logic: Add persistence layer with grace period check

---

### Task 3.5: Register FeatureGateService in DI Container

**Status**: COMPLETE
**File(s)**:

- `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\index.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.ts`
  **Dependencies**: Task 3.3
  **Spec Reference**: implementation-plan.md:481-484

**Quality Requirements**:

- Add FEATURE_GATE_SERVICE token to tokens.ts
- Add to TOKENS namespace export
- Export FeatureGateService from vscode-core index.ts
- Register in container.ts after LICENSE_SERVICE

**Validation Notes**:

- Follow existing token pattern for LICENSE_SERVICE

**Implementation Details**:

- Key Logic: Token definition, export, and registration

---

**Batch 3 Verification**:

- All files exist at paths
- Build passes: `npx nx build vscode-core` and `npx nx build ptah-extension-vscode`
- Extension activates correctly with valid license
- Extension blocks correctly without valid license
- code-logic-reviewer approved

---

## Batch 4: Landing Page UI (Frontend) - COMPLETE

**Developer**: frontend-developer
**Tasks**: 5 | **Dependencies**: None (can run parallel with Batch 2/3)
**Commit**: 2b91218

### Task 4.1: Update PricingPlan Interface

**Status**: COMPLETE
**File(s)**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\models\pricing-plan.interface.ts`
**Spec Reference**: implementation-plan.md:704-719
**Pattern to Follow**: Current interface at lines 9-48

**Quality Requirements**:

- Update tier to: 'basic' | 'pro' (remove 'free')
- Add trialDays?: number field
- Update ctaAction to: 'checkout' (remove 'download' - both plans require checkout)
- Keep highlight and badge optional fields

**Validation Notes**:

- This interface is used by both PlanCardComponent and PricingGridComponent

**Implementation Details**:

- Key Logic: Interface field updates

---

### Task 4.2: Update PricingGridComponent Plan Data

**Status**: COMPLETE
**File(s)**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts`
**Dependencies**: Task 4.1
**Spec Reference**: implementation-plan.md:723-776
**Pattern to Follow**: Current plan definitions at lines 180-249

**Quality Requirements**:

- Replace freePlan with basicMonthlyPlan ($3/month)
- Add basicYearlyPlan ($30/year)
- Update proMonthlyPlan to $5/month
- Update proYearlyPlan to $50/year
- Both Basic and Pro show "14-Day Free Trial" badge
- CTA text: "Start 14-Day Free Trial"
- Update template to show Basic cards (may need layout change)

**Validation Notes**:

- Current layout is 2 columns (Free + Pro toggle)
- New layout: 2 columns (Basic + Pro) each with monthly/yearly toggle
- Or: 4 cards in grid

**Implementation Details**:

- Imports: Update paddleConfig references
- Key Logic: Replace free plan data with basic plan data, update features lists

---

### Task 4.3: Update PlanCardComponent for Trial Badge

**Status**: COMPLETE
**File(s)**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\plan-card.component.ts`
**Dependencies**: Task 4.1
**Spec Reference**: implementation-plan.md:775
**Pattern to Follow**: Current component structure

**Quality Requirements**:

- Show trial badge if plan.trialDays is set
- Badge text: "14-day free trial"
- Position badge prominently (near price or CTA)

**Validation Notes**:

- May need to read existing plan-card.component.ts first

**Implementation Details**:

- Key Logic: Add conditional trial badge display

---

### Task 4.4: Update Environment Configuration

**Status**: COMPLETE
**File(s)**:

- `D:\projects\ptah-extension\apps\ptah-landing-page\src\environments\environment.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\environments\environment.production.ts`
  **Spec Reference**: implementation-plan.md:779-815
  **Pattern to Follow**: Current paddle config at lines 22-30

**Quality Requirements**:

- Add basicPriceIdMonthly and basicPriceIdYearly
- Keep proPriceIdMonthly and proPriceIdYearly (rename from priceIdMonthly/Yearly)
- Use placeholder values for now (pri_REPLACE_BASIC_MONTHLY, etc.)
- Update both development and production environments

**Validation Notes**:

- Production file may not exist - check first
- Placeholder detection should work with new IDs

**Implementation Details**:

- Key Logic: Add 4 price IDs to paddle config

---

### Task 4.5: Update Pricing Page Layout

**Status**: COMPLETE
**File(s)**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts`
**Dependencies**: Task 4.2
**Spec Reference**: implementation-plan.md:768-776

**Quality Requirements**:

- Decide layout: 2 cards with toggles OR 4 cards grid
- Recommended: Keep 2 column layout with Basic (left) and Pro (right)
- Each column has its own monthly/yearly toggle
- Pro card highlighted as "Most Popular"
- Remove reference to Free plan entirely

**Validation Notes**:

- May need to create BasicPlanCardComponent similar to ProPlanCardComponent
- Or adapt existing PlanCardComponent to handle toggle

**Implementation Details**:

- Key Logic: Template restructuring for new plan layout

---

**Batch 4 Verification**:

- All files exist at paths
- Build passes: `npx nx build ptah-landing-page`
- Pricing page displays Basic and Pro plans
- Both plans show trial badge
- code-logic-reviewer approved

---

## Batch 5: Integration and Testing - COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batches 1-4
**Commit**: 996f970

### Task 5.1: Update License RPC Handler

**Status**: COMPLETE
**File(s)**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\license-rpc.handlers.ts`
**Spec Reference**: implementation-plan.md:Component 2 integration
**Pattern to Follow**: Check current handler implementation

**Quality Requirements**:

- Return new tier values in response
- Include isBasic convenience flag
- Include trialActive and trialDaysRemaining
- Map internal LicenseStatus to RPC response format

**Validation Notes**:

- Handler transforms LicenseStatus to LicenseGetStatusResponse

**Implementation Details**:

- Key Logic: Update response mapping for new fields
- Added `mapLicenseStatusToResponse()` method for clean mapping
- Imported `LicenseStatus` type from vscode-core
- Returns 'expired' tier on errors instead of 'free'
- Properly maps trialActive from status or derives from tier

---

### Task 5.2: Add License Server Environment Variables Documentation

**Status**: COMPLETE
**File(s)**: `D:\projects\ptah-extension\apps\ptah-license-server\.env.example` (UPDATED)
**Spec Reference**: implementation-plan.md:809-815

**Quality Requirements**:

- Document all 4 Paddle Price IDs
- Include PADDLE_PRICE_ID_BASIC_MONTHLY
- Include PADDLE_PRICE_ID_BASIC_YEARLY
- Include PADDLE_PRICE_ID_PRO_MONTHLY
- Include PADDLE_PRICE_ID_PRO_YEARLY

**Validation Notes**:

- Check if .env.example exists first
- Add comments explaining each variable

**Implementation Details**:

- Key Logic: Environment variable documentation
- Updated pricing model documentation to reflect two-tier model
- Added separate section for Price IDs with detailed setup instructions
- Documented features for each plan tier
- Added placeholder values for new Basic price IDs

---

### Task 5.3: Verify Build and Type Checking

**Status**: COMPLETE
**File(s)**: N/A (command execution)
**Dependencies**: All previous tasks

**Quality Requirements**:

- Run `npx nx build vscode-core` - must pass
- Run `npx nx build ptah-license-server` - must pass
- Run `npx nx build ptah-extension-vscode` - must pass
- Run `npx nx build ptah-landing-page` - must pass
- Run `npx nx run-many --target=typecheck --all` - must pass

**Validation Notes**:

- All builds must succeed
- No TypeScript errors

**Implementation Details**:

- Commands: Multiple nx build commands
- All 4 builds passed successfully:
  - vscode-core: PASS
  - ptah-license-server: PASS
  - ptah-extension-vscode: PASS
  - ptah-landing-page: PASS

---

**Batch 5 Verification**:

- All builds pass
- Type checking passes
- Integration between components verified
- code-logic-reviewer approved
- All tasks COMPLETE

---

## Files Affected Summary

### CREATE

- `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\feature-gate.service.ts`

### MODIFY (Backend)

- `D:\projects\ptah-extension\apps\ptah-license-server\src\config\plans.config.ts` (REWRITE)
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\license.service.ts`
- `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\index.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\src\paddle\paddle.service.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\src\license\services\license.service.ts`
- `D:\projects\ptah-extension\apps\ptah-license-server\prisma\schema.prisma`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\license-rpc.handlers.ts`

### MODIFY (Frontend)

- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\plan-card.component.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\models\pricing-plan.interface.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\environments\environment.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\environments\environment.production.ts`

---

## Developer Assignment Summary

| Batch   | Developer          | Task Count | Focus Area             |
| ------- | ------------------ | ---------- | ---------------------- |
| Batch 1 | backend-developer  | 4          | Type System Foundation |
| Batch 2 | backend-developer  | 5          | License Server Updates |
| Batch 3 | backend-developer  | 5          | Extension Enforcement  |
| Batch 4 | frontend-developer | 5          | Landing Page UI        |
| Batch 5 | backend-developer  | 3          | Integration & Testing  |

**Note**: Batch 4 (Frontend) can run in parallel with Batches 2-3 (Backend) as they have no dependencies between them.
