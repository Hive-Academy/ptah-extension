# TASK_2025_127: Authenticated Pricing Page Views

## User Request (Verbatim)

> Let's orchestrate a new workflow where we show the current plan and make those pricing pages reflect on the current user subscription. It works very well in our profile page, but in pricing, it always says this or actively shows us buttons that could lead to an desired behavior for users resubscribing again for their current plans. So we need to properly implement authenticated views for those plans and make sure to take regard to the security and proper user checking similar to our profile page.

## Strategy Selection

- **Detected Type**: FEATURE (implement, authenticated views, security)
- **Confidence**: 90%
- **Complexity**: Medium (2-8h) - integrating existing auth patterns to pricing UI
- **Task ID Format**: TASK_2025_127

## Reference Context

- **Related Tasks**:
  - TASK_2025_121: Two-Tier Paid Extension Model (completed)
  - TASK_2025_114: Paddle Subscription Integration (completed)
  - TASK_2025_075: Simplified License Server (in progress)
  - TASK_2025_123: Reliable Paddle Subscription Management (in progress)

## Key Requirements (Initial)

1. Show current subscription plan indicator on pricing page
2. Disable/modify subscribe buttons for existing subscribers
3. Prevent re-subscribing to current plan
4. Implement security checks similar to profile page
5. Handle all subscription states (trial, basic, pro, expired)

## Screenshot Context

User provided screenshot showing:

- Basic plan ($3/mo) with "Start 14-Day Free Trial" button
- Pro plan ($5/mo) with "Start 14-Day Free Trial" button
- Both plans showing monthly/yearly toggle
- User is logged in (shows Profile, Logout in header)
- **Problem**: No indication that user might already have a subscription

---

## Codebase Investigation Summary

### Profile Page Implementation (Working Reference)

- Location: `apps/ptah-landing-page/src/app/pages/profile/`
- Fetches license data from `GET /api/v1/licenses/me`
- Uses SSE for real-time subscription updates
- Displays subscription status, plan details, sync actions
- Profile details component shows upgrade CTAs for trial users

### Current Pricing Page Implementation (Needs Update)

- Location: `apps/ptah-landing-page/src/app/pages/pricing/`
- `PricingGridComponent` - main container
- `BasicPlanCardComponent` and `ProPlanCardComponent` - individual cards
- Currently has NO subscription awareness
- Always shows "Start 14-Day Free Trial" regardless of auth state
- Does check authentication before checkout (redirects to login if needed)

### Existing Backend APIs Available

1. **`GET /api/v1/licenses/me`** - Returns full license data:

   - User info (email, firstName, lastName, memberSince)
   - Plan (basic, pro, trial_basic, trial_pro, null)
   - Status (active, none, expired)
   - Subscription info (status, currentPeriodEnd, canceledAt)

2. **`GET /api/v1/subscriptions/status`** - Returns live subscription from Paddle:

   - hasSubscription
   - subscription (id, status, plan, billingCycle, currentPeriodEnd)
   - customerPortalUrl

3. **`POST /api/v1/subscriptions/portal-session`** - Creates Paddle portal session

4. **`POST /api/v1/subscriptions/validate-checkout`** - Validates checkout eligibility

### Auth Pattern Already Established

- `AuthService.isAuthenticated()` - Used in navigation component
- localStorage hint-based approach to avoid unnecessary API calls
- HTTP-only cookie authentication (ptah_auth)

### Paddle Checkout Service Features

- `validateCheckoutBeforeOpen()` - Already prevents duplicate subscriptions
- `fetchCheckoutInfo()` - Gets existing Paddle customer ID
- Redirects to profile after successful checkout

---

## Files Identified for Modification

### Primary Files

1. `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts`
2. `apps/ptah-landing-page/src/app/pages/pricing/components/basic-plan-card.component.ts`
3. `apps/ptah-landing-page/src/app/pages/pricing/components/pro-plan-card.component.ts`

### Potentially New Files

- Subscription state service for pricing page (or reuse existing pattern)

### Reference Files

- `apps/ptah-landing-page/src/app/pages/profile/profile-page.component.ts`
- `apps/ptah-landing-page/src/app/services/auth.service.ts`
- `apps/ptah-landing-page/src/app/services/paddle-checkout.service.ts`
- `apps/ptah-landing-page/src/app/pages/profile/models/license-data.interface.ts`

---

## Design Decisions

1. **Data Source**: Use `/api/v1/licenses/me` as primary (matches profile page pattern)
2. **State Management**: Angular signals (consistent with codebase patterns)
3. **UI Framework**: DaisyUI/Tailwind (existing design system)
4. **Security**: Server-side validation before any checkout operations
5. **UX Pattern**: Similar to SaaS pricing pages (show "Current Plan" badge)

## Next Step

Requirements document created in `task-description.md`. Ready for architectural design.
