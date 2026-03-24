# TASK_2025_218: Early Adopter 2-Month Free Subscription

## User Request

Offer early adopters a 2-month free Pro subscription (credit card required) as an alternative to the existing 14-day no-credit-card trial. Users who want to commit directly skip the trial and get 2 months free before billing starts.

## Task Type

FEATURE

## Strategy

Partial: Architect -> Team-Leader -> Developers (known requirements, scoped changes)

## Complexity

Medium

## Key Context

### Current Pricing Model

- **Community**: FREE forever, no Paddle integration
- **Pro Monthly**: $5/month with 14-day free trial (no credit card, backend-managed)
- **Pro Yearly**: $50/year with 14-day free trial (no credit card, backend-managed)
- 14-day trial uses synthetic Paddle IDs (`trial_customer_*`, `auto_trial_pro`)
- Trial auto-downgrade cron runs daily at 9:00 AM UTC with email reminders at 7/3/1 days

### How Paddle Trials Work

Paddle prices can include a built-in trial period. When configured:

1. User enters credit card during checkout
2. Paddle creates subscription with `status: trialing`, `trialEnd: +N days`
3. After trial ends, Paddle auto-charges the card → fires `subscription.activated`
4. If payment fails → fires `subscription.past_due`

### Existing Webhook Handlers (no changes needed)

- `subscription.created` with `status: trialing` → already handled
- `subscription.activated` → already upgrades to `pro`
- `subscription.canceled` / `subscription.past_due` → already handled
- Trial reminder cron already reads `trialEnd` from subscription record

## Recommended Approach

### Step 1: Paddle Dashboard (Manual)

Create 2 new prices under existing "Ptah Pro" product:

| Price Name              | Amount   | Billing | Trial Period |
| ----------------------- | -------- | ------- | ------------ |
| Early Adopter - Monthly | $5/month | Monthly | **60 days**  |
| Early Adopter - Yearly  | $50/year | Yearly  | **60 days**  |

Copy the new price IDs (e.g., `pri_XXXXX`).

### Step 2: Frontend Environment Config

**Files**: `environment.ts`, `environment.production.ts`

Add new price IDs:

```typescript
paddle: {
  // ... existing
  earlyAdopterPriceIdMonthly: 'pri_NEW_MONTHLY_ID',
  earlyAdopterPriceIdYearly: 'pri_NEW_YEARLY_ID',
}
```

### Step 3: New Early Adopter Plan Card

**Location**: `apps/ptah-landing-page/src/app/pages/pricing/components/`

Create `early-adopter-plan-card.component.ts` — similar to `pro-plan-card.component.ts` but with:

- Badge: "Early Adopter" or "Limited Time Offer"
- Price display: "$0 for 2 months, then $5/mo" (or yearly equivalent)
- CTA: "Claim 2 Months Free" (requires credit card)
- Same feature list as Pro
- Monthly/yearly toggle (like Pro card)

### Step 4: Update Pricing Grid

**File**: `pricing-grid.component.ts`

- Add early adopter plan data (new `PricingPlan` objects with new price IDs)
- Update grid layout: 3 columns (Community | Early Adopter | Pro) or keep 2 columns with Early Adopter as a highlighted variant
- Wire up `handleCtaClick` for new plan (reuses existing checkout flow — just different price IDs)

### Step 5: Backend Guard (Minor)

**File**: `apps/ptah-license-server/src/trial-reminder/services/trial-reminder.service.ts`

Add guard to exclude Paddle-managed trials from the internal auto-downgrade cron:

- Check if subscription has a real Paddle subscription ID (not starting with `trial_customer_` or `auto_trial_`)
- If it's a real Paddle subscription, skip — let Paddle handle the trial→paid transition via webhooks
- This prevents a race condition where the cron downgrades before Paddle's `subscription.activated` webhook arrives

### Step 6: Time-Box the Offer (Future)

When the early adopter window closes:

- Disable the prices in Paddle dashboard (zero code changes)
- Optionally hide the card via a feature flag or environment variable

## Files to Modify

### Frontend

- `apps/ptah-landing-page/src/environments/environment.ts` — add price IDs
- `apps/ptah-landing-page/src/environments/environment.production.ts` — add price IDs
- `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts` — add card
- **NEW**: `apps/ptah-landing-page/src/app/pages/pricing/components/early-adopter-plan-card.component.ts`

### Backend

- `apps/ptah-license-server/src/trial-reminder/services/trial-reminder.service.ts` — guard clause
- `apps/ptah-license-server/src/config/plans.config.ts` — optionally add early_adopter plan metadata

### Shared (optional)

- `libs/shared/src/lib/constants/trial.constants.ts` — add `EARLY_ADOPTER_TRIAL_DAYS = 60`

## Key Decisions

1. **3 cards vs 2 cards**: Recommend 3 cards (Community | Early Adopter | Pro) for clarity
2. **Highlight which card**: Early Adopter should be the highlighted/featured card
3. **Auto-checkout from login**: Reuse existing `autoCheckout` query param flow with new plan key (`early-adopter-monthly`, `early-adopter-yearly`)
4. **Sunsetting**: Disable in Paddle dashboard when offer ends — no code change needed

## Risks & Mitigations

| Risk                                            | Mitigation                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| Trial cron downgrades Paddle trial early        | Guard clause to skip real Paddle subscriptions                               |
| User confused by two "free" options             | Clear messaging: "14-day trial (no card)" vs "2 months free (card required)" |
| Early adopter price left active too long        | Set reminder to disable in Paddle when offer ends                            |
| Paddle sandbox price IDs differ from production | Test with sandbox first, update production env separately                    |
