# Requirements Document - TASK_2025_121

## Introduction

This document defines the requirements for transitioning the Ptah VS Code extension from a "Free + Pro" pricing model to a "Basic (paid) + Pro (paid)" model. This is a fundamental business model change where the entire extension becomes paid, with two subscription tiers.

### Business Context

**Current State:**

- Free tier: $0 forever - Visual interface, session history, basic workspace context
- Pro tier: $8/month (or $80/year) - All premium features including MCP server, workspace intelligence, OpenRouter

**Target State:**

- Basic tier: $3/month with 14-day trial - Core visual editor functionality (current "free" features)
- Pro tier: $5/month with 14-day trial - Basic + MCP server + all premium features

### Value Proposition

This pricing change:

1. Establishes sustainable revenue from all users
2. Creates clear feature differentiation between tiers
3. Provides accessible entry point with Basic plan
4. Maintains premium value with Pro features at reduced price

---

## Requirements

### Requirement 1: Paddle Product and Price Configuration

**User Story:** As a business owner, I want new Paddle products and prices configured for Basic and Pro plans, so that customers can subscribe to either tier through the checkout flow.

#### Acceptance Criteria

1. WHEN configuring Paddle products THEN the system SHALL have:

   - Product: "Ptah Basic" with description "Visual Claude Code interface"
   - Product: "Ptah Pro" with description "Full workspace intelligence suite"

2. WHEN configuring Basic plan prices THEN the system SHALL have:

   - Basic Monthly: $3 USD/month with 14-day trial
   - Basic Yearly: $30 USD/year with 14-day trial (~17% savings)

3. WHEN configuring Pro plan prices THEN the system SHALL have:

   - Pro Monthly: $5 USD/month with 14-day trial
   - Pro Yearly: $50 USD/year with 14-day trial (~17% savings)

4. WHEN trial period ends without payment THEN subscription SHALL be canceled and license revoked

5. WHEN environment configuration is updated THEN both sandbox AND production Price IDs SHALL be documented

---

### Requirement 2: License Server Plan Configuration Updates

**User Story:** As a system administrator, I want the license server to recognize both Basic and Pro plans, so that license verification returns correct feature entitlements.

#### Acceptance Criteria

1. WHEN updating `plans.config.ts` THEN the system SHALL define:

   ```
   basic: { name: "Basic", features: [...], monthlyPrice: 3, yearlyPrice: 30 }
   pro: { name: "Pro", features: [...], monthlyPrice: 5, yearlyPrice: 50 }
   ```

2. WHEN a Basic plan license is verified THEN response SHALL include:

   - `tier: "basic"`
   - `features: ["basic_cli_wrapper", "session_history", "permission_management", "sdk_access"]`
   - `isPremium: false`

3. WHEN a Pro plan license is verified THEN response SHALL include:

   - `tier: "pro"`
   - `features: ["all_basic_features", "mcp_server", "workspace_intelligence", "openrouter_proxy", "custom_tools", "priority_support"]`
   - `isPremium: true`

4. WHEN the "free" plan type is referenced THEN it SHALL be removed from the codebase (no free tier exists)

5. WHEN `mapPriceIdToPlan()` in PaddleService receives a Price ID THEN it SHALL correctly map to "basic" or "pro" based on environment configuration

---

### Requirement 3: VS Code Extension License Enforcement

**User Story:** As a product owner, I want the VS Code extension to require a valid license to function, so that the extension cannot be used without a paid subscription.

#### Acceptance Criteria

1. WHEN extension activates without a valid license THEN the system SHALL:

   - Display a blocking UI requiring subscription
   - Disable all extension commands except license entry
   - Show clear messaging about trial/subscription options

2. WHEN extension activates with a valid Basic license THEN the system SHALL:

   - Enable core visual editor features
   - Enable session history and management
   - Enable SDK access (Claude CLI integration)
   - Disable MCP server functionality
   - Disable workspace intelligence
   - Disable OpenRouter proxy

3. WHEN extension activates with a valid Pro license THEN the system SHALL:

   - Enable all Basic features
   - Start MCP server on activation
   - Enable workspace intelligence
   - Enable OpenRouter proxy
   - Enable all premium features

4. WHEN extension activates during trial period THEN the system SHALL:

   - Enable all features for the subscribed tier
   - Display trial status with days remaining
   - Show non-intrusive reminder as trial end approaches (3 days, 1 day)

5. WHEN license verification fails (network error) THEN the system SHALL:
   - Use cached license status if valid within grace period (7 days)
   - If no valid cache exists, display offline mode message
   - Retry verification in background every hour

---

### Requirement 4: License Status Types Update

**User Story:** As a developer, I want the LicenseStatus interface to support Basic and Pro tiers, so that feature gating works correctly throughout the codebase.

#### Acceptance Criteria

1. WHEN updating LicenseStatus interface THEN the `tier` field SHALL accept:

   - `"basic"` - Active Basic subscription
   - `"pro"` - Active Pro subscription
   - `"trial_basic"` - Basic plan during trial
   - `"trial_pro"` - Pro plan during trial
   - `"expired"` - No valid subscription

2. WHEN the tier is `"free"` or `"early_adopter"` THEN these values SHALL be deprecated and mapped to appropriate new tiers for backward compatibility

3. WHEN license status is returned THEN it SHALL include:
   - `valid: boolean` - License is currently valid
   - `tier: string` - Current license tier
   - `plan: object` - Plan details with features array
   - `trialActive: boolean` - Whether in trial period
   - `trialDaysRemaining: number | undefined` - Days left in trial
   - `expiresAt: string | undefined` - Subscription/trial expiration
   - `reason?: string` - Reason for invalid status

---

### Requirement 5: Landing Page Pricing UI Updates

**User Story:** As a potential customer, I want to see clear pricing options for Basic and Pro plans, so that I can choose the right subscription for my needs.

#### Acceptance Criteria

1. WHEN viewing the pricing page THEN the system SHALL display:

   - Basic plan card: $3/month, $30/year with feature list
   - Pro plan card: $5/month, $50/year with feature list (highlighted as "Most Popular")
   - Both cards showing "14-day free trial" badge

2. WHEN updating `PricingPlan` interface THEN it SHALL support:

   - `tier: "basic" | "pro"` (remove "free")
   - Trial badge display
   - Updated feature lists per tier

3. WHEN clicking "Start Basic Trial" THEN checkout SHALL:

   - Open Paddle checkout with Basic Monthly price ID
   - Pre-fill email if user is authenticated
   - Include 14-day trial configuration

4. WHEN clicking "Start Pro Trial" THEN checkout SHALL:

   - Open Paddle checkout with Pro Monthly price ID (default)
   - Allow toggle to yearly billing
   - Pre-fill email if user is authenticated
   - Include 14-day trial configuration

5. WHEN the "Free" plan card is referenced THEN it SHALL be removed from the UI

---

### Requirement 6: Paddle Webhook Handling Updates

**User Story:** As a system administrator, I want Paddle webhooks to correctly provision licenses for both Basic and Pro subscriptions, so that customers receive appropriate access immediately.

#### Acceptance Criteria

1. WHEN `subscription.created` webhook is received THEN the system SHALL:

   - Map Price ID to correct plan ("basic" or "pro")
   - Create license with appropriate features
   - Mark license as `trial_basic` or `trial_pro` if in trial period
   - Send welcome email with license key

2. WHEN `subscription.activated` webhook is received (trial converted) THEN the system SHALL:

   - Update license tier to "basic" or "pro" (remove trial prefix)
   - Update license expiration to subscription billing period end
   - Send confirmation email

3. WHEN `subscription.updated` webhook indicates plan change THEN the system SHALL:

   - Update license tier to new plan
   - Adjust features immediately
   - If downgrade from Pro to Basic, disable Pro-only features

4. WHEN `subscription.canceled` webhook is received THEN the system SHALL:

   - Set license to expire at current billing period end
   - User retains access until expiration
   - Send cancellation confirmation with access end date

5. WHEN trial expires without conversion THEN the system SHALL:
   - Mark license as "expired"
   - Revoke access to extension features
   - Send trial expired email with resubscription link

---

### Requirement 7: Graceful Expiration Behavior

**User Story:** As an expired subscriber, I want clear messaging about my expired status and easy resubscription options, so that I can regain access quickly.

#### Acceptance Criteria

1. WHEN license expires THEN extension activation SHALL:

   - Display modal with expiration message
   - Show "Resubscribe" button linking to pricing page
   - Show "Enter License Key" button for manual entry
   - Disable all extension features except these buttons

2. WHEN viewing expired status in extension THEN the system SHALL:

   - Show last active tier (e.g., "Your Pro subscription expired on [date]")
   - Display pricing comparison (Basic vs Pro)
   - Provide one-click resubscription flow

3. WHEN resubscribing after expiration THEN the system SHALL:
   - Provision new license immediately on successful payment
   - Restore previous session history if within 30 days
   - Send reactivation confirmation email

---

### Requirement 8: Database Schema Updates

**User Story:** As a database administrator, I want the license schema to support the new tier values, so that data integrity is maintained.

#### Acceptance Criteria

1. WHEN updating the License model THEN the `plan` field SHALL accept:

   - "basic" - Basic subscription
   - "pro" - Pro subscription
   - "trial_basic" - Basic trial
   - "trial_pro" - Pro trial
   - Legacy values ("free", "early_adopter") remain readable but new licenses use new values

2. WHEN running database migration THEN the system SHALL:
   - NOT break existing licenses (backward compatible)
   - Map existing "early_adopter" licenses to "pro" tier
   - Map existing "free" trial licenses to "trial_basic"

---

### Requirement 9: Environment Configuration Updates

**User Story:** As a developer, I want clear environment configuration for all plan Price IDs, so that checkout flows work correctly in sandbox and production.

#### Acceptance Criteria

1. WHEN configuring landing page environment THEN it SHALL include:

   ```typescript
   paddle: {
     environment: 'sandbox' | 'production',
     basicPriceIdMonthly: string,
     basicPriceIdYearly: string,
     proPriceIdMonthly: string,
     proPriceIdYearly: string,
   }
   ```

2. WHEN configuring license server environment THEN it SHALL include:

   ```
   PADDLE_PRICE_ID_BASIC_MONTHLY=pri_xxx
   PADDLE_PRICE_ID_BASIC_YEARLY=pri_xxx
   PADDLE_PRICE_ID_PRO_MONTHLY=pri_xxx
   PADDLE_PRICE_ID_PRO_YEARLY=pri_xxx
   ```

3. WHEN Price IDs are placeholders THEN checkout buttons SHALL be disabled with informative tooltip

---

## Non-Functional Requirements

### Security Requirements

- **License Enforcement**: Extension MUST NOT function without valid license verification
- **Tamper Prevention**: License validation must occur server-side, not client-side only
- **Grace Period**: 7-day offline grace period with cached license to handle network issues
- **Key Security**: License keys stored in VS Code SecretStorage (encrypted)
- **API Security**: License verification endpoint requires valid license key format
- **No Bypass**: Removing license key must immediately disable features (no "try later" fallback)

### Performance Requirements

- **Activation Time**: License verification must complete within 2 seconds
- **Cache Strategy**: 1-hour cache TTL for license status to reduce API calls
- **Background Revalidation**: 24-hour background revalidation cycle
- **Checkout Load**: Paddle checkout must load within 3 seconds

### Reliability Requirements

- **Uptime**: License server must maintain 99.9% availability
- **Webhook Processing**: All Paddle webhooks must be processed within 30 seconds
- **Idempotency**: Webhook handlers must be idempotent (duplicate events safe)
- **Graceful Degradation**: Network failures use cached status, not hard failure

### Compliance Requirements

- **Trial Transparency**: Clear disclosure of trial terms (14 days, auto-cancel without payment)
- **Cancellation**: Easy cancellation via Paddle customer portal
- **Refund Policy**: 30-day refund policy honored via Paddle

---

## Feature Mapping by Tier

### Basic Tier ($3/month, $30/year)

| Feature                 | Included |
| ----------------------- | -------- |
| Visual Chat Interface   | Yes      |
| Session History         | Yes      |
| Session Management      | Yes      |
| SDK Access (Claude CLI) | Yes      |
| Permission Management   | Yes      |
| Real-time Streaming     | Yes      |
| Basic Workspace Context | Yes      |
| MCP Server              | No       |
| Workspace Intelligence  | No       |
| OpenRouter Proxy        | No       |
| Custom Tools            | No       |
| Priority Support        | No       |

### Pro Tier ($5/month, $50/year)

| Feature                                    | Included |
| ------------------------------------------ | -------- |
| All Basic Features                         | Yes      |
| MCP Server                                 | Yes      |
| Workspace Intelligence (13+ project types) | Yes      |
| OpenRouter Proxy (200+ models)             | Yes      |
| Custom Tools                               | Yes      |
| Project-adaptive Agent Generation          | Yes      |
| Intelligent Setup Wizard                   | Yes      |
| Real-time Cost Tracking                    | Yes      |
| Priority Support                           | Yes      |

---

## Migration Considerations

### Existing User Impact

1. **Existing "early_adopter" (Pro) users**: Continue on Pro tier at existing rate until renewal
2. **Existing "free" trial users**: Convert to Basic trial, notified of new pricing
3. **New users**: Must subscribe to Basic or Pro (no free tier)

### Data Migration

1. Map `plan: "early_adopter"` to `plan: "pro"` in display logic
2. Map `plan: "free"` to `plan: "trial_basic"` for active trials
3. Expired "free" licenses become `tier: "expired"`

### Communication Plan

1. Announce pricing change 30 days before implementation
2. Email existing trial users about transition
3. Grandfather existing paid subscribers at their current rate

---

## Risk Assessment

### Technical Risks

| Risk                      | Probability | Impact | Mitigation                                         |
| ------------------------- | ----------- | ------ | -------------------------------------------------- |
| License bypass attempts   | Medium      | High   | Server-side validation, no client-only gates       |
| Webhook delivery failures | Low         | High   | Paddle retry + manual reconciliation               |
| Cache staleness           | Low         | Medium | 7-day grace period, background revalidation        |
| Price ID misconfiguration | Medium      | High   | Validation in checkout flow, placeholder detection |

### Business Risks

| Risk                            | Probability | Impact | Mitigation                                   |
| ------------------------------- | ----------- | ------ | -------------------------------------------- |
| User churn from paid-only model | High        | High   | 14-day trial, competitive pricing ($3 entry) |
| Negative perception             | Medium      | Medium | Clear communication, value demonstration     |
| Support volume increase         | Medium      | Medium | Self-service license management, clear docs  |

---

## Success Metrics

1. **Trial Conversion Rate**: >15% of trials convert to paid
2. **Plan Distribution**: 40% Basic, 60% Pro (target)
3. **Churn Rate**: <5% monthly churn
4. **License Verification Success**: >99.9% verification requests succeed
5. **Activation Time**: <2 seconds from install to usable (with valid license)

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder      | Impact | Success Criteria                            |
| ---------------- | ------ | ------------------------------------------- |
| End Users        | High   | Clear value at each tier, easy subscription |
| Business         | High   | Sustainable revenue, >15% trial conversion  |
| Development Team | Medium | Clean implementation, minimal tech debt     |

### Secondary Stakeholders

| Stakeholder  | Impact | Success Criteria                                |
| ------------ | ------ | ----------------------------------------------- |
| Support Team | Medium | Self-service license management, clear docs     |
| Operations   | Medium | Reliable license server, automated provisioning |

---

## Dependencies

1. **Paddle Account**: Active Paddle account with Billing v2
2. **License Server**: Deployed and operational
3. **Database**: PostgreSQL with current schema
4. **VS Code Marketplace**: Extension published and updatable

---

## Quality Gates

Before implementation is complete, verify:

- [ ] All Paddle products and prices created (sandbox + production)
- [ ] Plans.config.ts updated with Basic and Pro definitions
- [ ] LicenseStatus interface supports new tier values
- [ ] License enforcement blocks extension without valid license
- [ ] Basic tier enables correct feature subset
- [ ] Pro tier enables all features
- [ ] Trial period works correctly (14 days)
- [ ] Webhook handlers process all subscription events
- [ ] Graceful expiration with clear resubscription path
- [ ] Environment configuration documented
- [ ] Landing page displays new pricing correctly
- [ ] Checkout flows work for all 4 price points
- [ ] Existing user migration plan documented
- [ ] Security requirements validated (no bypass possible)
