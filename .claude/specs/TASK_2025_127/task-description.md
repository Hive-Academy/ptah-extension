# Requirements Document - TASK_2025_127

## Authenticated Pricing Page - Display Current Subscription Status

---

## Introduction

### Business Context

The Ptah Extension pricing page currently shows generic "Start 14-Day Free Trial" buttons for all plans regardless of the user's authentication or subscription status. This creates a confusing user experience where authenticated users with active subscriptions see options to resubscribe to plans they already own. The profile page already correctly displays subscription status, but this context-awareness is missing from the pricing page.

### Problem Statement

**Current Behavior:**

- User is logged in (Profile, Logout visible in navigation)
- Pricing page shows "Start 14-Day Free Trial" buttons for both Basic ($3/mo) and Pro ($5/mo) plans
- No indication of user's current subscription status
- Clicking these buttons could lead to duplicate subscriptions (though backend validation prevents this)

**Desired Behavior:**

- Authenticated users see their current plan highlighted with "Current Plan" badge
- CTA buttons reflect appropriate actions based on subscription state
- Clear visual distinction between owned plan, upgrade options, and downgrade options
- Security-conscious implementation that validates subscription server-side

### Value Proposition

1. **User Experience**: Eliminate confusion by showing users their current subscription context
2. **Conversion Optimization**: Present clear upgrade paths for users on lower tiers
3. **Support Reduction**: Prevent support tickets from confused users trying to resubscribe
4. **Trust Building**: Transparent pricing display builds user confidence

---

## Requirements

### Requirement 1: Subscription State Integration in Pricing Grid

**User Story:** As an authenticated user viewing the pricing page, I want to see my current subscription status reflected in the pricing cards, so that I understand which plan I own and what my options are.

#### Acceptance Criteria

1. WHEN the pricing page loads for an authenticated user THEN the system SHALL fetch subscription status from `/api/v1/subscriptions/status` or reuse data from `/api/v1/licenses/me`

2. WHEN fetching subscription status THEN the pricing grid SHALL display a loading state until data is available

3. WHEN subscription data is available THEN the user's current plan card SHALL display:

   - "Current Plan" badge prominently positioned
   - Modified CTA button showing "Manage Subscription" instead of trial/checkout
   - Visual styling that distinguishes it from other plan cards

4. WHEN the user has an active trial THEN the system SHALL:

   - Show "Trial Active - X days remaining" badge
   - Display "Upgrade Now" CTA to convert trial to paid subscription

5. WHEN subscription fetch fails THEN the pricing page SHALL:
   - Fall back to generic (unauthenticated) view
   - Log error for debugging
   - Not block page rendering

#### Technical Details

**Data Source Options:**

- Primary: `GET /api/v1/subscriptions/status` - Returns live subscription status
- Alternative: `GET /api/v1/licenses/me` - Returns full license data including plan

**Subscription Status Response:**

```typescript
interface SubscriptionStatus {
  hasSubscription: boolean;
  subscription?: {
    id: string;
    status: 'active' | 'trialing' | 'canceled' | 'past_due' | 'paused';
    plan: 'basic' | 'pro';
    billingCycle: 'monthly' | 'yearly';
    currentPeriodEnd: string;
    canceledAt?: string;
    trialEnd?: string;
  };
  source: 'paddle' | 'local';
  customerPortalUrl?: string;
}
```

**License Data Response (from `/api/v1/licenses/me`):**

```typescript
interface LicenseData {
  user: UserInfo;
  plan: 'basic' | 'pro' | 'trial_basic' | 'trial_pro' | null;
  planName: string;
  status: 'active' | 'none' | 'expired';
  expiresAt: string | null;
  daysRemaining?: number;
  subscription: SubscriptionInfo | null;
}
```

---

### Requirement 2: Conditional CTA Button States

**User Story:** As a user on the pricing page, I want the action buttons to reflect appropriate actions based on my subscription state, so that I can take the correct action without confusion.

#### Acceptance Criteria

1. WHEN user is NOT authenticated THEN all plan cards SHALL show:

   - "Start 14-Day Free Trial" CTA
   - Click redirects to login with return URL to pricing page

2. WHEN user is authenticated WITHOUT subscription THEN plan cards SHALL show:

   - "Start 14-Day Free Trial" CTA for all plans
   - Clicking opens Paddle checkout (existing behavior)

3. WHEN user has ACTIVE Basic subscription THEN:

   - Basic card: "Current Plan" badge + "Manage Subscription" CTA
   - Pro card: "Upgrade to Pro" CTA (opens Paddle checkout for upgrade)

4. WHEN user has ACTIVE Pro subscription THEN:

   - Pro card: "Current Plan" badge + "Manage Subscription" CTA
   - Basic card: "Downgrade to Basic" CTA OR hide/disable with "Included in your Pro plan"

5. WHEN user has TRIAL subscription THEN:

   - Current trial plan card: "Trial Active" badge + "Upgrade Now" CTA
   - Higher tier card: "Upgrade to [Plan]" CTA

6. WHEN user has CANCELED subscription (still in period) THEN:

   - Current plan card: "Canceling on [date]" badge + "Reactivate" CTA
   - Other plans: "Switch to [Plan]" CTA

7. WHEN user has PAST_DUE subscription THEN:
   - Current plan card: "Payment Issue" badge + "Update Payment Method" CTA (links to Paddle portal)

#### Technical Details

**CTA State Matrix:**

| User State            | Basic Card CTA               | Pro Card CTA                 |
| --------------------- | ---------------------------- | ---------------------------- |
| Not authenticated     | Start Trial → Login          | Start Trial → Login          |
| Authenticated, no sub | Start Trial → Checkout       | Start Trial → Checkout       |
| Active Basic          | Manage Subscription → Portal | Upgrade to Pro → Checkout    |
| Active Pro            | Included in Pro (disabled)   | Manage Subscription → Portal |
| Trial Basic           | Upgrade Now → Checkout       | Upgrade to Pro → Checkout    |
| Trial Pro             | Downgrade? (edge case)       | Upgrade Now → Checkout       |
| Canceled Basic        | Reactivate → Portal          | Switch to Pro → Checkout     |
| Past Due              | Update Payment → Portal      | Update Payment → Portal      |

---

### Requirement 3: Visual Differentiation for Current Plan

**User Story:** As a user viewing pricing options, I want my current plan to be visually distinct from other options, so that I can immediately identify my subscription status.

#### Acceptance Criteria

1. WHEN the user's current plan card renders THEN it SHALL display:

   - "Current Plan" badge in a prominent position (top-right or replacing trial badge)
   - Border color changed to indicate "owned" state (e.g., success/green accent)
   - Checkmark icon or similar visual confirmation
   - CTA button styled differently (e.g., outline/secondary instead of primary)

2. WHEN the user's plan is on trial THEN it SHALL display:

   - "Trial - X days left" badge with countdown
   - Subtle warning styling if trial ending soon (< 3 days)

3. WHEN displaying an upgrade option THEN it SHALL:

   - Maintain prominent CTA styling (gradient button)
   - Show "Upgrade" language in CTA
   - Optionally show price difference or value proposition

4. WHEN displaying a downgrade option THEN it SHALL:
   - Use muted/secondary CTA styling
   - Show "Downgrade" or "Switch" language
   - Consider showing warning about lost features

#### Technical Details

**Badge Component Variants:**

```typescript
type PlanBadgeVariant =
  | 'current' // "Current Plan" - success styling
  | 'trial' // "Trial - X days" - info styling
  | 'trial-ending' // "Trial ends in X days" - warning styling
  | 'canceling' // "Cancels on [date]" - warning styling
  | 'past-due' // "Payment Issue" - error styling
  | 'popular'; // "Most Popular" - accent styling (existing)
```

**Styling Approach (DaisyUI/Tailwind):**

```css
/* Current Plan Card */
.plan-card-current {
  @apply border-success/50 shadow-success/20;
}

/* Current Plan Badge */
.badge-current-plan {
  @apply badge badge-success text-success-content;
}

/* Upgrade CTA - keep prominent */
.cta-upgrade {
  @apply bg-gradient-to-r from-amber-500 to-secondary;
}

/* Manage/Downgrade CTA - secondary */
.cta-manage {
  @apply btn-outline btn-secondary;
}
```

---

### Requirement 4: Manage Subscription Action

**User Story:** As a subscribed user, I want to easily access subscription management from the pricing page, so that I can update billing, cancel, or modify my plan.

#### Acceptance Criteria

1. WHEN user clicks "Manage Subscription" CTA THEN the system SHALL:

   - Call `POST /api/v1/subscriptions/portal-session` to get Paddle portal URL
   - Show loading state on button during API call
   - Open Paddle customer portal in new tab
   - Handle errors gracefully with user feedback

2. WHEN portal session creation fails THEN the system SHALL:

   - Display error message to user
   - Suggest contacting support
   - Log error for debugging

3. WHEN user has no Paddle customer record THEN:
   - Handle edge case where subscription exists but no portal access
   - Provide alternative contact method

#### Technical Details

**Portal Session Endpoint:**

```typescript
// POST /api/v1/subscriptions/portal-session
// Response (success):
{
  url: string; // Paddle customer portal URL
  expiresAt: string; // URL expiry time (60 minutes)
}

// Response (error):
{
  error: 'no_customer_record' | 'paddle_api_error';
  message: string;
}
```

**Integration with Existing Profile Page Pattern:**
Reference: `ProfilePageComponent.handleManageSubscription()` (lines 360-386)

---

### Requirement 5: Upgrade Flow Integration

**User Story:** As a Basic subscriber viewing the Pro plan, I want to upgrade seamlessly, so that I can access premium features without complex processes.

#### Acceptance Criteria

1. WHEN a Basic subscriber clicks "Upgrade to Pro" THEN the system SHALL:

   - Validate checkout eligibility via `POST /api/v1/subscriptions/validate-checkout`
   - If eligible, open Paddle checkout with Pro price ID
   - Pre-fill customer information (email, Paddle customer ID)
   - After successful checkout, redirect to profile page

2. WHEN validation returns `existing_subscription` THEN:

   - Show informative message explaining upgrade path
   - Provide link to Paddle portal for subscription changes
   - Do NOT open Paddle checkout (prevents duplicate subscriptions)

3. WHEN checkout completes successfully THEN:
   - License is automatically updated via webhook (backend handles)
   - User redirected to profile page showing new plan

#### Technical Details

**Existing Checkout Flow (Reference):**
The `PaddleCheckoutService` already handles:

- `validateCheckoutBeforeOpen()` - Prevents duplicate subscriptions
- `fetchCheckoutInfo()` - Gets existing Paddle customer ID
- `openCheckout()` - Opens Paddle overlay with correct config

**Upgrade-Specific Considerations:**

- Use same Paddle price IDs as new subscriptions
- Paddle handles prorated billing automatically
- Backend webhook updates license when subscription changes

---

## Non-Functional Requirements

### Performance Requirements

- **Data Fetch**: Subscription status SHALL load within 500ms on 4G connection
- **Render**: Pricing grid SHALL render immediately, then update with subscription context
- **Caching**: Consider caching subscription status for duration of page visit (signal-based state)
- **Loading States**: Show skeleton/spinner only briefly; avoid layout shift

### Security Requirements

- **Server-Side Validation**: NEVER trust client-side subscription state for checkout eligibility
- **Authentication Check**: Always verify JWT token before showing subscription-aware UI
- **No Sensitive Data Exposure**: Paddle customer IDs and subscription IDs for display only
- **Rate Limiting**: Respect existing rate limits on `/api/v1/subscriptions/*` endpoints
- **CORS**: Subscription endpoints already protected by backend CORS configuration

### Scalability Requirements

- **State Management**: Use Angular signals for reactive subscription state
- **API Efficiency**: Single API call to get subscription status (not multiple)
- **Future Plans**: Design supports adding more plan tiers without component rewrites

### Reliability Requirements

- **Graceful Degradation**: If subscription API fails, show generic (unauthenticated) pricing
- **Offline Handling**: Show cached state if available, graceful error if not
- **Error Recovery**: Retry button for failed subscription fetches

### Accessibility Requirements

- **Badge Announcements**: Screen readers SHALL announce current plan status
- **Button State**: Disabled buttons SHALL have `aria-disabled` and descriptive labels
- **Focus Management**: Focus returns to appropriate element after portal opens
- **Color Contrast**: Badge colors meet WCAG AA contrast requirements

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder      | Role            | Needs                                           | Success Metrics                |
| ---------------- | --------------- | ----------------------------------------------- | ------------------------------ |
| Subscribed Users | Plan Management | Clear view of current plan, easy upgrade/manage | Zero confusion support tickets |
| Trial Users      | Conversion      | Clear upgrade path                              | Trial-to-paid conversion rate  |
| New Users        | Information     | Understand pricing options                      | Time-to-decision               |

### Secondary Stakeholders

| Stakeholder  | Role             | Needs                                    | Success Metrics           |
| ------------ | ---------------- | ---------------------------------------- | ------------------------- |
| Support Team | Issue Resolution | Reduced pricing confusion tickets        | Support ticket reduction  |
| Product Team | Analytics        | Understand user behavior on pricing page | Upgrade funnel visibility |

---

## Risk Assessment

### Technical Risks

| Risk                        | Probability | Impact | Mitigation                           | Contingency               |
| --------------------------- | ----------- | ------ | ------------------------------------ | ------------------------- |
| API response delay          | Medium      | Medium | Loading states, skeleton UI          | Fall back to generic view |
| Race condition with auth    | Low         | Medium | Check auth before subscription fetch | Sequential loading        |
| State desync after checkout | Medium      | Medium | Refresh subscription data on focus   | Manual refresh button     |

### UX Risks

| Risk                        | Probability | Impact | Mitigation                              | Contingency               |
| --------------------------- | ----------- | ------ | --------------------------------------- | ------------------------- |
| Confusing upgrade/downgrade | Medium      | High   | Clear visual hierarchy, explicit labels | User testing, iterate     |
| Layout shift during load    | Medium      | Medium | Skeleton placeholders, fixed heights    | CSS containment           |
| Portal opening in same tab  | Low         | Medium | Always use `target="_blank"`            | Handle portal close event |

### Business Risks

| Risk                          | Probability | Impact   | Mitigation                            | Contingency                   |
| ----------------------------- | ----------- | -------- | ------------------------------------- | ----------------------------- |
| Showing wrong plan as current | Low         | High     | Server-side truth, never trust client | Manual support override       |
| Users unable to upgrade       | Low         | Critical | Thorough testing, error handling      | Direct Paddle portal fallback |

---

## Success Metrics

### Quantitative Metrics

| Metric                                  | Target        | Measurement            |
| --------------------------------------- | ------------- | ---------------------- |
| Support tickets about pricing confusion | 90% reduction | Support analytics      |
| Time to load subscription status        | < 500ms p95   | Performance monitoring |
| Upgrade button click rate (Basic→Pro)   | Increase 20%  | Analytics              |
| Error rate on subscription fetch        | < 1%          | Error logging          |

### Qualitative Metrics

| Metric                             | Target          | Measurement   |
| ---------------------------------- | --------------- | ------------- |
| User understanding of current plan | High confidence | User surveys  |
| Visual clarity of pricing page     | Improved        | Design review |

---

## Assumptions & Constraints

### Assumptions

1. Backend `/api/v1/subscriptions/status` endpoint is stable and performant
2. Paddle customer portal handles plan changes (upgrade/downgrade)
3. Backend webhook processing keeps local subscription state accurate
4. Users have stable internet connection for API calls

### Constraints

1. **No Backend Changes**: This task focuses on frontend; backend APIs already exist
2. **Existing Component Structure**: Build on existing `PricingGridComponent`, `BasicPlanCardComponent`, `ProPlanCardComponent`
3. **Existing Auth Pattern**: Use same `AuthService.isAuthenticated()` pattern as navigation
4. **DaisyUI/Tailwind**: Use existing design system, no new CSS frameworks

---

## Out of Scope

The following items are explicitly **NOT** part of this task:

1. **Plan Comparison Feature**: Side-by-side feature comparison (future enhancement)
2. **Promo Code Entry**: Discount codes on pricing page (separate task)
3. **Billing History**: Show past invoices (profile page feature)
4. **Plan Switching via Pricing Page**: Actual downgrades happen in Paddle portal
5. **Email Notifications**: Subscription change emails (backend responsibility)
6. **Backend API Changes**: All required endpoints already exist
7. **VS Code Extension UI**: This is landing page only, not extension webview

---

## UI/UX Considerations for Different States

### State 1: Unauthenticated User

- Both cards show "14-Day Free Trial" badge
- Both CTAs: "Start 14-Day Free Trial" → redirects to login
- Standard pricing page appearance

### State 2: Authenticated, No Subscription

- Same as unauthenticated, but CTAs open Paddle checkout directly
- User email pre-filled in checkout

### State 3: Active Basic Subscriber

- **Basic Card:**
  - "Current Plan" badge (success/green)
  - Border highlight (success color)
  - CTA: "Manage Subscription" (outline button)
- **Pro Card:**
  - "Most Popular" badge (existing)
  - CTA: "Upgrade to Pro" (primary gradient button)
  - Highlight savings/benefits

### State 4: Active Pro Subscriber

- **Basic Card:**
  - Badge: "Included in Pro" or none
  - CTA: Disabled or hidden
  - Muted appearance
- **Pro Card:**
  - "Current Plan" badge (success/green)
  - Border highlight (success color)
  - CTA: "Manage Subscription" (outline button)

### State 5: Trial User

- **Current Trial Plan Card:**
  - "Trial - X days left" badge (info/blue)
  - CTA: "Upgrade Now" (primary button)
- **Other Cards:**
  - Standard appearance with upgrade CTA

### State 6: Canceled (In Period)

- **Current Plan Card:**
  - "Ends [date]" badge (warning/amber)
  - CTA: "Reactivate" → opens Paddle portal
- **Other Cards:**
  - "Switch to [Plan]" CTAs available

---

## Implementation Approach

### Phase 1: Subscription State Service (Frontend)

- Create `SubscriptionStateService` or extend existing service
- Fetch subscription status on pricing page load
- Expose signals for reactive UI updates

### Phase 2: Plan Card Component Updates

- Add inputs for subscription state
- Implement badge variant logic
- Implement CTA variant logic
- Update styling for current plan

### Phase 3: Pricing Grid Integration

- Integrate subscription state service
- Pass subscription context to plan cards
- Handle loading and error states

### Phase 4: Portal/Checkout Actions

- Implement "Manage Subscription" action
- Ensure upgrade flow validates correctly
- Test all subscription states

---

## References

### Existing Implementations to Reference

- **Profile Page**: `apps/ptah-landing-page/src/app/pages/profile/profile-page.component.ts` (lines 206-226, 360-386)
- **Profile Details**: `apps/ptah-landing-page/src/app/pages/profile/components/profile-details.component.ts`
- **Auth Service**: `apps/ptah-landing-page/src/app/services/auth.service.ts`
- **Paddle Checkout Service**: `apps/ptah-landing-page/src/app/services/paddle-checkout.service.ts`
- **License Data Interface**: `apps/ptah-landing-page/src/app/pages/profile/models/license-data.interface.ts`

### Backend API Endpoints

- `GET /api/v1/licenses/me` - Full license details (includes plan, status, subscription)
- `GET /api/v1/subscriptions/status` - Live subscription status from Paddle
- `POST /api/v1/subscriptions/portal-session` - Get Paddle customer portal URL
- `POST /api/v1/subscriptions/validate-checkout` - Validate checkout eligibility

### Related Tasks

- TASK_2025_114: Paddle Subscription Integration (original checkout implementation)
- TASK_2025_121: Two-Tier Paid Model (current pricing structure)
- TASK_2025_123: Reliable Paddle Subscription Management System (backend APIs)
