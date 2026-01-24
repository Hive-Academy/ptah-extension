# Requirements Document - TASK_2025_114

## Paddle Subscription Integration - Frontend Implementation

---

## Introduction

### Business Context

The Ptah VS Code extension requires a complete frontend subscription flow to enable users to subscribe to Pro Monthly ($8/month) or Pro Yearly ($80/year) plans. The backend license server (TASK_2025_112) already implements Paddle webhook processing and license provisioning. This task focuses on the frontend integration to create a seamless checkout experience.

### Value Proposition

1. **User Experience**: Enable frictionless subscription flow directly from the pricing page
2. **Revenue Enablement**: Convert free trial users to paid subscribers
3. **Security**: Ensure PCI-compliant payment handling via Paddle.js overlay
4. **Flexibility**: Support both monthly and yearly billing with 14-day trial periods

### Reference Documentation

- **Primary**: `docs/PADDLE_SETUP_SIMPLIFIED.md` - Complete setup instructions
- **Backend**: `apps/ptah-license-server/src/paddle/` - Webhook processing implementation

---

## Requirements

### Requirement 1: Environment Configuration for Paddle Integration

**User Story:** As a developer deploying the landing page, I want Paddle configuration stored in environment files, so that I can easily switch between sandbox and production environments without code changes.

#### Acceptance Criteria

1. WHEN the application builds THEN environment configuration SHALL include:
   - `paddle.environment`: 'sandbox' | 'production'
   - `paddle.priceIdMonthly`: Paddle price ID for monthly plan
   - `paddle.priceIdYearly`: Paddle price ID for yearly plan
   - `paddle.clientToken`: Client-side token for Paddle.js initialization (optional, for enhanced features)

2. WHEN `environment.ts` (development) is configured THEN all Paddle IDs SHALL use sandbox values with clear TODO comments for replacement

3. WHEN `environment.production.ts` is configured THEN all Paddle IDs SHALL use production values with validation that they are not placeholder values

4. WHEN building for production THEN the build SHALL fail if Paddle price IDs contain 'REPLACE' or placeholder patterns

#### Technical Details

**Files to Modify:**
- `apps/ptah-landing-page/src/environments/environment.ts`
- `apps/ptah-landing-page/src/environments/environment.production.ts`

**Updated Interface:**
```typescript
interface PaddleEnvironmentConfig {
  environment: 'sandbox' | 'production';
  priceIdMonthly: string;  // pri_XXXXX format
  priceIdYearly: string;   // pri_YYYYY format
  clientToken?: string;    // Optional: pdl_ctk_XXXXX
}
```

---

### Requirement 2: Paddle.js SDK Integration Service

**User Story:** As a user viewing the pricing page, I want the Paddle checkout to open seamlessly when I click a subscription button, so that I can complete my purchase without leaving the site.

#### Acceptance Criteria

1. WHEN the pricing page loads THEN Paddle.js SDK SHALL be initialized with correct environment (sandbox/production)

2. WHEN Paddle.js initialization succeeds THEN the service SHALL emit a ready signal that components can observe

3. WHEN Paddle.js initialization fails THEN the service SHALL:
   - Log the error for debugging
   - Display a user-friendly error message
   - Provide a retry mechanism

4. WHEN a user is authenticated THEN the checkout SHALL pre-fill customer email from authentication state

5. WHEN checkout completes successfully THEN the user SHALL be redirected to a success page with license activation instructions

6. WHEN checkout is canceled THEN the user SHALL remain on the pricing page without disruption

#### Technical Details

**New Service:** `apps/ptah-landing-page/src/app/services/paddle-checkout.service.ts`

**Service Interface:**
```typescript
@Injectable({ providedIn: 'root' })
export class PaddleCheckoutService {
  // Signals for reactive state
  readonly isReady: Signal<boolean>;
  readonly isLoading: Signal<boolean>;
  readonly error: Signal<string | null>;

  // Methods
  initialize(): void;
  openCheckout(options: CheckoutOptions): void;
  closeCheckout(): void;
}

interface CheckoutOptions {
  priceId: string;
  customerEmail?: string;
  successUrl?: string;
  customData?: Record<string, string>;
}
```

**Paddle.js Script Loading:**
```typescript
// Load from CDN: https://cdn.paddle.com/paddle/v2/paddle.js
// Initialize with: Paddle.Initialize({ environment, token? })
```

---

### Requirement 3: Pricing Grid Component Update

**User Story:** As a user on the pricing page, I want to see accurate pricing information and clickable subscription buttons, so that I can choose and purchase the plan that suits my needs.

#### Acceptance Criteria

1. WHEN the pricing grid renders THEN price IDs SHALL be sourced from environment configuration, not hardcoded

2. WHEN the "Subscribe Monthly" button is clicked THEN Paddle checkout SHALL open with monthly price ID (`$8/month`)

3. WHEN the "Subscribe Yearly" button is clicked THEN Paddle checkout SHALL open with yearly price ID (`$80/year`)

4. WHEN the "Start Free Trial" button is clicked THEN the user SHALL be navigated to the login page for magic link authentication

5. WHEN Paddle checkout is loading THEN the clicked button SHALL show a loading spinner and be disabled

6. WHEN user is authenticated THEN their email SHALL be pre-filled in the Paddle checkout overlay

7. WHEN price IDs are placeholder values THEN checkout buttons SHALL be disabled with tooltip explaining configuration needed

#### Technical Details

**Files to Modify:**
- `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts`
- `apps/ptah-landing-page/src/app/pages/pricing/models/pricing-plan.interface.ts`

**Updated PricingPlan Interface:**
```typescript
export interface PricingPlan {
  // ... existing fields ...
  priceId?: string;           // Now sourced from environment
  isCheckoutLoading?: boolean; // Track per-plan loading state
}
```

**Integration Pattern:**
```typescript
// Inject environment config
private readonly paddleConfig = environment.paddle;

// Use environment price IDs instead of hardcoded
plans = signal<PricingPlan[]>([
  // ... free trial ...
  {
    name: 'Pro Monthly',
    priceId: this.paddleConfig.priceIdMonthly,
    // ...
  },
  {
    name: 'Pro Yearly',
    priceId: this.paddleConfig.priceIdYearly,
    // ...
  }
]);
```

---

### Requirement 4: Checkout Success/Cancel Handling

**User Story:** As a user who completes checkout, I want clear confirmation that my subscription is active, so that I know my purchase was successful and I can start using Pro features.

#### Acceptance Criteria

1. WHEN Paddle checkout completes successfully THEN the application SHALL:
   - Display a success message/page
   - Inform user that license key will be emailed
   - Provide link to VS Code extension activation instructions

2. WHEN Paddle checkout is canceled THEN the application SHALL:
   - Close the overlay gracefully
   - Return user to pricing page
   - Not show any error messages (cancellation is intentional)

3. WHEN payment fails (card declined, etc.) THEN Paddle's built-in error handling SHALL display the appropriate message within the overlay

#### Technical Details

**New Component (Optional):** `apps/ptah-landing-page/src/app/pages/checkout-success/checkout-success-page.component.ts`

**Paddle Event Callbacks:**
```typescript
Paddle.Checkout.open({
  items: [{ priceId: 'pri_xxxxx', quantity: 1 }],
  customer: { email: 'user@example.com' },
  settings: {
    successUrl: '/checkout/success',
    displayMode: 'overlay',
  }
});

// Or use event callbacks
Paddle.Checkout.on('checkout.completed', (event) => {
  // Handle successful checkout
});

Paddle.Checkout.on('checkout.closed', (event) => {
  // Handle checkout closed (canceled or completed)
});
```

---

### Requirement 5: Plan Card Component Enhancement

**User Story:** As a user comparing plans, I want visual feedback when interacting with subscription buttons, so that I understand the system is responding to my actions.

#### Acceptance Criteria

1. WHEN checkout is in progress for a specific plan THEN only that plan's button SHALL show loading state

2. WHEN checkout is loading THEN the button text SHALL change to "Processing..." with spinner

3. WHEN price ID is invalid or missing THEN the button SHALL be visually disabled with appropriate styling

4. WHEN hovering over a disabled button THEN a tooltip SHALL explain why checkout is unavailable

#### Technical Details

**Files to Modify:**
- `apps/ptah-landing-page/src/app/pages/pricing/components/plan-card.component.ts`

**Enhanced Button State:**
```typescript
<button
  class="btn w-full"
  [class.btn-secondary]="plan().highlight"
  [class.btn-disabled]="!plan().priceId || isCheckoutLoading()"
  [disabled]="!plan().priceId || plan().ctaAction === 'checkout' && !plan().priceId"
  (click)="handleClick()"
>
  @if (isCheckoutLoading()) {
    <span class="loading loading-spinner loading-sm"></span>
    Processing...
  } @else {
    {{ plan().ctaText }}
  }
</button>
```

---

### Requirement 6: Error Handling and User Feedback

**User Story:** As a user experiencing checkout issues, I want clear error messages and recovery options, so that I can resolve problems and complete my purchase.

#### Acceptance Criteria

1. WHEN Paddle.js fails to load THEN the application SHALL:
   - Display "Payment system temporarily unavailable" message
   - Log detailed error for debugging
   - Suggest user try again later or contact support

2. WHEN network error occurs during checkout THEN Paddle's built-in retry mechanism SHALL handle it

3. WHEN user is in a restricted region THEN Paddle's built-in geo-restriction handling SHALL apply

4. WHEN checkout session expires THEN user SHALL be able to restart checkout

#### Technical Details

**Toast/Alert Component Integration:**
```typescript
// Use DaisyUI alert classes
@if (checkoutError()) {
  <div class="alert alert-error">
    <span>{{ checkoutError() }}</span>
    <button (click)="retryInitialization()">Retry</button>
  </div>
}
```

---

## Non-Functional Requirements

### Performance Requirements

- **Paddle.js Load Time**: Paddle SDK SHALL load within 2 seconds on 3G connection
- **Checkout Open Time**: Overlay SHALL appear within 500ms of button click
- **Script Loading**: Paddle.js SHALL be loaded asynchronously to not block page render
- **Bundle Impact**: Integration SHALL add less than 50KB to main bundle (service code only, SDK loaded separately)

### Security Requirements

- **PCI Compliance**: Payment data SHALL never touch our servers (Paddle handles all payment data)
- **HTTPS Only**: All API calls and SDK loading SHALL use HTTPS
- **No Client Secrets**: API keys and webhook secrets SHALL never be exposed in frontend code
- **CSP Headers**: Content Security Policy SHALL allow Paddle.js domains:
  - `https://cdn.paddle.com`
  - `https://*.paddle.com`

### Scalability Requirements

- **Concurrent Users**: Checkout flow SHALL handle 100+ concurrent checkouts
- **Environment Switching**: Adding new environments (staging) SHALL require only configuration changes

### Reliability Requirements

- **Graceful Degradation**: If Paddle.js fails to load, pricing page SHALL still display (with disabled checkout)
- **Retry Logic**: SDK initialization SHALL retry 3 times before giving up
- **Offline Handling**: User SHALL see appropriate message if offline during checkout attempt

### Accessibility Requirements

- **Keyboard Navigation**: Checkout buttons SHALL be accessible via keyboard
- **Screen Reader**: Button states (loading, disabled) SHALL be announced to screen readers
- **Focus Management**: Focus SHALL return to appropriate element after checkout closes
- **ARIA Labels**: Loading states SHALL have proper ARIA live regions

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder | Role | Needs | Success Metrics |
|-------------|------|-------|-----------------|
| End Users | Subscribers | Seamless checkout experience | Checkout completion rate > 80% |
| Business | Revenue | Enable paid subscriptions | Subscription conversion from trial |
| Dev Team | Implementers | Clear integration patterns | Clean, testable code |

### Secondary Stakeholders

| Stakeholder | Role | Needs | Success Metrics |
|-------------|------|-------|-----------------|
| Support Team | Issue Resolution | Clear error messages | Low support tickets for payment issues |
| Operations | Deployment | Easy environment switching | Zero-downtime deployments |

---

## Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation | Contingency |
|------|-------------|--------|------------|-------------|
| Paddle.js CDN unavailable | Low | High | Use Paddle's official CDN with fallback | Display "temporarily unavailable" message |
| Environment config mismatch | Medium | High | Build-time validation of price IDs | Clear error messages in console |
| SDK version breaking changes | Low | Medium | Pin to specific Paddle.js version | Document upgrade process |

### Business Risks

| Risk | Probability | Impact | Mitigation | Contingency |
|------|-------------|--------|------------|-------------|
| Sandbox/production price ID mix-up | Medium | Critical | Different env files, build validation | Automated tests for config |
| Checkout abandonment | Medium | Medium | Optimize UX, pre-fill email | Follow up emails (Paddle feature) |

### Integration Risks

| Risk | Probability | Impact | Mitigation | Contingency |
|------|-------------|--------|------------|-------------|
| Auth state not syncing with checkout | Medium | Medium | Test auth flow end-to-end | Allow manual email entry |
| Backend webhook delays | Low | Low | Paddle handles retries | User notification of license delivery time |

---

## Success Metrics

### Quantitative Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Checkout Initiation Rate | 90%+ buttons work | Automated E2E tests |
| Checkout Completion Rate | 70%+ of initiated | Paddle Analytics |
| Page Load Impact | < 200ms added | Lighthouse performance |
| Error Rate | < 1% of checkout attempts | Error logging |

### Qualitative Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| User Experience | Seamless flow | User feedback |
| Code Quality | Clean, documented | Code review |
| Maintainability | Easy to update configs | Developer feedback |

---

## Dependencies

### External Dependencies

| Dependency | Type | Risk Level | Notes |
|------------|------|------------|-------|
| Paddle.js SDK | External CDN | Low | Official Paddle CDN with high availability |
| Paddle Dashboard | Configuration | Low | Required for price ID creation |
| Backend License Server | Internal API | Medium | Must be deployed and accessible |

### Internal Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| TASK_2025_112 (Backend) | In Progress | Paddle webhook handling implemented |
| Auth Service | Complete | Magic link authentication exists |
| Environment Config | Partial | Paddle config structure exists, needs update |

---

## Implementation Phases

### Phase 1: Environment Configuration (1-2 hours)
- Update environment files with new Paddle config structure
- Add build-time validation for price IDs
- Document configuration process

### Phase 2: Paddle Service Implementation (2-3 hours)
- Create `PaddleCheckoutService`
- Implement Paddle.js script loading
- Add initialization and checkout methods
- Implement error handling and retry logic

### Phase 3: Component Integration (2-3 hours)
- Update `pricing-grid.component.ts` to use environment config
- Update `plan-card.component.ts` with loading states
- Integrate `PaddleCheckoutService` with checkout flow
- Add success/cancel handling

### Phase 4: Testing and Validation (1-2 hours)
- Test with Paddle sandbox environment
- Test card success/failure scenarios
- Verify webhook processing creates licenses
- E2E flow validation

---

## Quality Gates

### Pre-Implementation Checklist
- [ ] Paddle sandbox account created
- [ ] Price IDs obtained from Paddle dashboard
- [ ] Backend webhook endpoint accessible
- [ ] Environment configuration documented

### Post-Implementation Checklist
- [ ] All checkout buttons functional (Monthly, Yearly)
- [ ] Paddle.js loads without errors
- [ ] Loading states display correctly
- [ ] Error handling graceful
- [ ] No hardcoded price IDs in component code
- [ ] TypeScript strict mode passes
- [ ] Accessibility requirements met
- [ ] Mobile responsive checkout flow

### Security Checklist
- [ ] No API keys in frontend code
- [ ] All external scripts loaded via HTTPS
- [ ] CSP headers updated if needed
- [ ] Payment data never touches our servers

---

## Out of Scope

The following items are explicitly **NOT** part of this task:

1. **Backend Changes**: Paddle webhook processing (covered by TASK_2025_112)
2. **Subscription Management**: Cancel/upgrade flows (future task)
3. **License Display**: Showing active license in user profile (future task)
4. **Invoice/Receipt**: PDF invoice generation (handled by Paddle)
5. **Promo Codes**: Discount code entry (future enhancement)
6. **Multiple Currencies**: International pricing (Paddle handles automatically)

---

## References

- [Paddle.js Integration Guide](https://developer.paddle.com/paddlejs/overview)
- [Paddle Checkout Events](https://developer.paddle.com/paddlejs/events)
- [Paddle Sandbox Testing](https://developer.paddle.com/getting-started/sandbox)
- Internal: `docs/PADDLE_SETUP_SIMPLIFIED.md`
- Backend: `apps/ptah-license-server/src/paddle/paddle.service.ts`
