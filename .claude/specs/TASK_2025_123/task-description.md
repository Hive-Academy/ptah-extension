# Requirements Document - TASK_2025_123

## Introduction

This document defines the requirements for implementing a **Reliable Paddle Subscription Management System** for the Ptah Extension. The current Paddle integration has critical reliability gaps that result in data inconsistencies between Paddle's system and our local database, duplicate subscriptions, and missing webhook handling.

**Business Value**: Ensure users who pay for subscriptions always have accurate license status, eliminate subscription-related support tickets, and provide self-service reconciliation capabilities.

**Project Context**: Ptah Extension is a VS Code extension with a two-tier paid subscription model (Basic at $3/month, Pro at $5/month) with 14-day trial support. Subscriptions are managed via Paddle Billing v2, with licenses stored in PostgreSQL and verified by both the Angular landing page and VS Code extension.

---

## Requirements

### Requirement 1: Centralized Subscription Verification API

**User Story:** As a user accessing Ptah from either the landing page or VS Code extension, I want a single backend API that verifies my subscription status from Paddle, so that I always see accurate subscription information regardless of which client I use.

#### Acceptance Criteria

1. WHEN a user requests subscription status THEN the backend SHALL query Paddle API directly for current subscription state
2. WHEN Paddle returns subscription details THEN the API SHALL return subscription ID, status (active/trialing/canceled/past_due/paused), current plan, and expiration date
3. WHEN the user has multiple subscriptions THEN the API SHALL return the most recent active subscription
4. WHEN Paddle API is unreachable THEN the API SHALL fall back to local database state with a `source: 'local'` indicator
5. WHEN the user has no Paddle customer record THEN the API SHALL return `{ hasSubscription: false, source: 'paddle' }`
6. WHEN a subscription exists in Paddle but not locally THEN the response SHALL include `requiresSync: true` flag

**Endpoint Specification:**

```
GET /api/v1/subscriptions/status
Authorization: Required (JWT)

Response:
{
  hasSubscription: boolean,
  subscription?: {
    id: string,               // Paddle subscription ID (sub_xxx)
    status: string,           // active | trialing | canceled | past_due | paused
    plan: string,             // basic | pro
    billingCycle: string,     // monthly | yearly
    currentPeriodEnd: string, // ISO 8601
    canceledAt?: string,      // ISO 8601 (if canceled)
    trialEnd?: string,        // ISO 8601 (if trialing)
  },
  source: 'paddle' | 'local', // Where data was fetched from
  requiresSync?: boolean,     // True if local DB differs from Paddle
  customerPortalUrl?: string, // Link to Paddle customer portal
}
```

---

### Requirement 2: Pre-Checkout Duplicate Subscription Prevention

**User Story:** As a user attempting to purchase a subscription, I want to be prevented from creating duplicate subscriptions, so that I don't accidentally pay twice for the same product.

#### Acceptance Criteria

1. WHEN a user initiates checkout THEN the frontend SHALL call a pre-checkout validation endpoint BEFORE opening Paddle overlay
2. WHEN the validation endpoint detects an existing active/trialing/past_due subscription in Paddle THEN it SHALL return `{ canCheckout: false, reason: 'existing_subscription', customerPortalUrl: string }`
3. WHEN `canCheckout: false` THEN the frontend SHALL NOT open Paddle checkout and SHALL display a message with link to customer portal
4. WHEN the user has no existing subscription THEN validation SHALL return `{ canCheckout: true }` and checkout proceeds normally
5. WHEN a subscription exists only locally (not in Paddle) THEN validation SHALL return `{ canCheckout: true }` (local-only records are orphaned)
6. WHEN the user has a canceled subscription that has NOT expired THEN validation SHALL return `{ canCheckout: false }` with message about waiting until current period ends

**Endpoint Specification:**

```
POST /api/v1/subscriptions/validate-checkout
Authorization: Required (JWT)
Body: { priceId: string }

Response:
{
  canCheckout: boolean,
  reason?: 'existing_subscription' | 'subscription_ending_soon' | 'none',
  existingPlan?: string,
  currentPeriodEnd?: string,
  customerPortalUrl?: string,
  message?: string,
}
```

**Frontend Integration:**

- `PaddleCheckoutService.openCheckout()` must call validation before `paddle.Checkout.open()`
- If `canCheckout: false`, show modal with explanation and customer portal link
- Add loading state during validation (show "Checking subscription status...")

---

### Requirement 3: User-Initiated Subscription Reconciliation

**User Story:** As a user who notices my subscription status doesn't match what I see in Paddle, I want to trigger a sync operation from my profile page, so that my local license status matches my actual Paddle subscription.

#### Acceptance Criteria

1. WHEN a user clicks "Sync with Paddle" on their profile page THEN the backend SHALL fetch their subscription status from Paddle API
2. WHEN Paddle has an active subscription but local database shows none/expired THEN the reconciliation SHALL create or update the local subscription and license records
3. WHEN Paddle has a canceled subscription THEN reconciliation SHALL update local records to match (status, canceledAt, currentPeriodEnd)
4. WHEN local database has a subscription that doesn't exist in Paddle THEN reconciliation SHALL mark local subscription as `orphaned` and log warning
5. WHEN reconciliation succeeds THEN the API SHALL return summary of changes made
6. WHEN reconciliation encounters errors THEN specific error messages SHALL be returned (not generic failures)
7. WHEN reconciliation completes THEN the profile page SHALL automatically refresh to show updated status

**Endpoint Specification:**

```
POST /api/v1/subscriptions/reconcile
Authorization: Required (JWT)

Response:
{
  success: boolean,
  changes: {
    subscriptionUpdated: boolean,
    licenseUpdated: boolean,
    statusBefore: string,
    statusAfter: string,
    planBefore?: string,
    planAfter?: string,
  },
  errors?: string[],
  paddleSubscription?: { id: string, status: string, ... },
}
```

**UI Requirements:**

- Add "Sync with Paddle" button in profile-details.component.ts
- Show button only when user has subscription record OR `requiresSync: true`
- Display reconciliation results in a toast/alert
- Disable button during sync with loading indicator

---

### Requirement 4: Comprehensive Webhook Event Handling

**User Story:** As the system administrator, I want all Paddle subscription lifecycle events to be properly handled, so that user license status is always synchronized with Paddle.

#### Acceptance Criteria

1. WHEN `subscription.created` webhook fires THEN the handler SHALL create user (if new), subscription record, and active license
2. WHEN `subscription.activated` webhook fires (trial to active) THEN the handler SHALL update license plan from `trial_X` to `X` and clear trial end date
3. WHEN `subscription.updated` webhook fires THEN the handler SHALL update subscription status, plan, and license expiration
4. WHEN `subscription.canceled` webhook fires THEN the handler SHALL update subscription status to `canceled` and set license expiration to period end
5. WHEN `subscription.past_due` webhook fires THEN the handler SHALL update subscription status and emit SSE event warning user
6. WHEN `subscription.paused` webhook fires THEN the handler SHALL update subscription and license status to `paused`
7. WHEN `subscription.resumed` webhook fires THEN the handler SHALL reactivate subscription and license
8. WHEN `transaction.completed` webhook fires (renewal) THEN the handler SHALL extend license expiration to new period end
9. WHEN any webhook processing fails THEN the failure SHALL be logged with full payload for manual investigation

**New Event Handler Required:**

- `transaction.completed` - Handle subscription renewals (extends license expiration)

---

### Requirement 5: Failed Webhook Recovery Storage

**User Story:** As a system administrator, I want failed webhook processing attempts to be stored for later investigation and manual recovery, so that no subscription events are lost.

#### Acceptance Criteria

1. WHEN a webhook fails signature verification THEN the raw payload SHALL be stored in `FailedWebhook` table with reason `invalid_signature`
2. WHEN a webhook fails processing (exception) THEN the raw payload, error message, and stack trace SHALL be stored
3. WHEN storing a failed webhook THEN the record SHALL include: event_id, event_type, raw_payload, error_message, stack_trace, attempted_at, retry_count
4. WHEN a webhook is stored as failed THEN it SHALL be available for manual review in admin tools
5. WHEN the same event_id is received again (Paddle retry) THEN the system SHALL process it normally (idempotency still applies)
6. WHEN a failed webhook is retried manually THEN the retry attempt SHALL update retry_count and last_attempted_at

**Database Schema Addition:**

```prisma
model FailedWebhook {
  id           String   @id @default(uuid()) @db.Uuid
  eventId      String   @map("event_id")
  eventType    String   @map("event_type")
  rawPayload   Json     @map("raw_payload")
  errorMessage String   @map("error_message")
  stackTrace   String?  @map("stack_trace")
  attemptedAt  DateTime @map("attempted_at") @default(now())
  retryCount   Int      @default(0) @map("retry_count")
  resolved     Boolean  @default(false)
  resolvedAt   DateTime? @map("resolved_at")

  @@index([eventId])
  @@index([eventType])
  @@index([resolved])
  @@map("failed_webhooks")
}
```

---

### Requirement 6: Customer Portal URL Generation

**User Story:** As a user with an existing subscription, I want to easily access Paddle's customer portal to manage my subscription, so that I can update payment methods, change plans, or cancel.

#### Acceptance Criteria

1. WHEN a user requests their customer portal URL THEN the backend SHALL generate a session URL via Paddle API
2. WHEN the portal URL is generated THEN it SHALL be valid for 60 minutes (Paddle default)
3. WHEN the user has no Paddle customer record THEN the API SHALL return `{ error: 'no_customer_record' }`
4. WHEN the profile page loads and user has subscription THEN a "Manage Subscription" link SHALL be displayed
5. WHEN user clicks "Manage Subscription" THEN they SHALL be redirected to Paddle customer portal in new tab

**Endpoint Specification:**

```
POST /api/v1/subscriptions/portal-session
Authorization: Required (JWT)

Response:
{
  url: string,     // Customer portal URL
  expiresAt: string, // ISO 8601
}

Error Response:
{
  error: 'no_customer_record' | 'paddle_api_error',
  message: string,
}
```

---

## Non-Functional Requirements

### Performance Requirements

- **Subscription Status API**: 95th percentile response time < 500ms (includes Paddle API call)
- **Pre-Checkout Validation**: 95th percentile response time < 300ms
- **Reconciliation**: Maximum execution time < 10 seconds
- **Webhook Processing**: 99th percentile < 1 second
- **Paddle API Fallback**: If Paddle API times out after 3 seconds, fall back to local data

### Security Requirements

- **Authentication**: All subscription APIs require valid JWT (existing JwtAuthGuard)
- **Authorization**: Users can only access their own subscription data (user ID from JWT)
- **Webhook Security**: Continue using HMAC SHA256 signature verification with timing-safe comparison
- **Customer Portal**: Portal URLs are single-use and time-limited (Paddle handles this)
- **Rate Limiting**: Paddle API calls limited to 240/minute per IP (well within our usage)
- **Audit Logging**: All reconciliation actions logged with user ID and changes made
- **Sensitive Data**: Never log full license keys, only prefixes (existing pattern)

### Reliability Requirements

- **Webhook Idempotency**: Continue using `createdBy: paddle_{eventId}` pattern for duplicate detection
- **Failed Webhook Recovery**: All failed webhooks stored for manual investigation
- **Graceful Degradation**: If Paddle API unavailable, fall back to local data with warning
- **Transaction Safety**: All database operations in transactions (existing pattern)
- **Error Messages**: User-facing errors must be actionable, not generic

### Scalability Requirements

- **Concurrent Users**: Support 1000 concurrent subscription checks without degradation
- **Webhook Throughput**: Handle 100 webhooks/minute without queuing
- **Database Indexes**: Ensure indexes on `paddleSubscriptionId`, `paddleCustomerId`, `userId`

---

## Out of Scope

The following items are explicitly **NOT** included in this task:

1. **Cron Jobs for Expiration**: License expiration is handled via Paddle webhooks, not scheduled jobs
2. **Automatic Retry of Failed Webhooks**: Failed webhooks are stored for manual review, not auto-retried
3. **Admin Dashboard for Webhook Management**: Storage only, UI/tooling is separate task
4. **Subscription Plan Changes via Our API**: Users manage plans via Paddle customer portal
5. **Payment Method Management**: Handled entirely by Paddle customer portal
6. **Invoice/Receipt Generation**: Paddle handles all billing documents
7. **Refund Processing**: Handled via Paddle dashboard
8. **Multi-Currency Support**: Paddle handles currency conversion
9. **VS Code Extension Changes**: Only backend API changes; VS Code uses existing `/api/v1/licenses/verify`
10. **Subscription Analytics/Reporting**: Metrics and dashboards are separate task

---

## Dependencies

### External Dependencies

| Dependency              | Type             | Risk Level | Mitigation                                           |
| ----------------------- | ---------------- | ---------- | ---------------------------------------------------- |
| Paddle Billing API v2   | External Service | Medium     | Implement fallback to local data; monitor API health |
| Paddle Webhook Delivery | External Service | Medium     | Failed webhook storage for recovery                  |
| Paddle Customer Portal  | External Service | Low        | Generate URLs server-side; handle errors gracefully  |

### Internal Dependencies

| Dependency           | Status | Notes                             |
| -------------------- | ------ | --------------------------------- |
| PaddleService        | Exists | Extend with new methods           |
| PaddleController     | Exists | Add new endpoints                 |
| Subscription model   | Exists | No schema changes needed          |
| License model        | Exists | No schema changes needed          |
| JwtAuthGuard         | Exists | Reuse for new endpoints           |
| EventsService        | Exists | Emit SSE events on reconciliation |
| PaddleClientProvider | Exists | Provides Paddle SDK client        |

### New Dependencies Required

| Dependency                      | Purpose                       |
| ------------------------------- | ----------------------------- |
| FailedWebhook model             | Store failed webhook payloads |
| `transaction.completed` handler | Handle subscription renewals  |

---

## Risk Assessment

### Technical Risks

| Risk                           | Probability | Impact | Mitigation                                | Contingency                    |
| ------------------------------ | ----------- | ------ | ----------------------------------------- | ------------------------------ |
| Paddle API rate limiting       | Low         | Medium | Implement caching; batch requests         | Use local data as fallback     |
| Webhook signature changes      | Low         | High   | Monitor Paddle changelog; test in sandbox | Alert on verification failures |
| Database transaction deadlocks | Low         | Medium | Keep transactions small; proper indexing  | Implement retry logic          |
| Customer portal URL expiration | Medium      | Low    | Generate URL on-demand, not cached        | Show error and retry button    |

### Business Risks

| Risk                              | Probability | Impact | Mitigation                             |
| --------------------------------- | ----------- | ------ | -------------------------------------- |
| Users confused by reconciliation  | Medium      | Low    | Clear UI messaging; help documentation |
| Duplicate subscription edge cases | Medium      | Medium | Comprehensive pre-checkout validation  |
| Support tickets during migration  | Medium      | Low    | Thorough testing; gradual rollout      |

---

## Success Metrics

| Metric                              | Target                | Measurement Method            |
| ----------------------------------- | --------------------- | ----------------------------- |
| Duplicate subscription rate         | < 0.1%                | Count subscriptions per user  |
| Webhook processing success rate     | > 99.5%               | Monitor failed_webhooks table |
| Subscription status accuracy        | 100% (Paddle = Local) | Periodic reconciliation audit |
| Pre-checkout validation latency     | < 300ms p95           | Application metrics           |
| User-initiated reconciliation usage | < 5% of users monthly | Track endpoint calls          |

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder             | Impact | Involvement      | Success Criteria                                   |
| ----------------------- | ------ | ---------------- | -------------------------------------------------- |
| End Users (Subscribers) | High   | Testing/Feedback | Accurate subscription status; no duplicate charges |
| Support Team            | High   | Ticket handling  | Reduced subscription-related tickets by 80%        |
| Development Team        | Medium | Implementation   | Clean API design; testable code                    |

### Secondary Stakeholders

| Stakeholder | Impact | Involvement | Success Criteria                           |
| ----------- | ------ | ----------- | ------------------------------------------ |
| Finance     | Low    | Reporting   | Accurate revenue tracking (Paddle handles) |
| Operations  | Medium | Monitoring  | Clear error logs; actionable alerts        |

---

## Implementation Phases

### Phase 1: Backend API Foundation

- Create `SubscriptionController` with status and validation endpoints
- Implement Paddle API integration for subscription lookup by customer ID
- Add pre-checkout validation logic
- Create FailedWebhook model and storage

### Phase 2: Reconciliation System

- Implement reconciliation endpoint
- Add Paddle subscription comparison logic
- Handle sync scenarios (create, update, orphan)
- Add comprehensive logging

### Phase 3: Webhook Enhancement

- Add `transaction.completed` handler for renewals
- Implement failed webhook storage
- Add webhook error handling with storage

### Phase 4: Frontend Integration

- Add pre-checkout validation to PaddleCheckoutService
- Add "Sync with Paddle" button to profile page
- Add "Manage Subscription" link with portal URL
- Implement SSE event handling for real-time updates

### Phase 5: Testing & Validation

- Unit tests for all new services
- Integration tests with Paddle sandbox
- E2E tests for checkout flow
- Manual reconciliation testing

---

## Quality Gates

Before delegation, verify:

- [x] All requirements follow SMART criteria
- [x] Acceptance criteria in WHEN/THEN/SHALL format
- [x] Stakeholder analysis complete
- [x] Risk assessment with mitigation strategies
- [x] Success metrics clearly defined
- [x] Dependencies identified and documented
- [x] Non-functional requirements specified
- [x] Performance benchmarks established
- [x] Security requirements documented
- [x] Implementation phases defined
- [x] Out of scope items explicitly listed

---

## Appendix: Existing Code References

### Backend (ptah-license-server)

| File                                            | Purpose          | Changes Needed                               |
| ----------------------------------------------- | ---------------- | -------------------------------------------- |
| `src/paddle/paddle.service.ts`                  | Webhook handling | Add Paddle API calls for subscription lookup |
| `src/paddle/paddle.controller.ts`               | Webhook endpoint | Add transaction.completed handler            |
| `src/paddle/paddle.module.ts`                   | Module config    | Export new services                          |
| `src/paddle/providers/paddle.provider.ts`       | Paddle SDK       | Already provides `customers.get()`           |
| `src/license/controllers/license.controller.ts` | License API      | No changes (uses existing verify)            |
| `src/events/events.service.ts`                  | SSE broadcasting | Emit reconciliation events                   |
| `prisma/schema.prisma`                          | Database schema  | Add FailedWebhook model                      |

### Frontend (ptah-landing-page)

| File                                                            | Purpose              | Changes Needed               |
| --------------------------------------------------------------- | -------------------- | ---------------------------- |
| `src/app/services/paddle-checkout.service.ts`                   | Checkout flow        | Add pre-checkout validation  |
| `src/app/pages/profile/profile-page.component.ts`               | Profile UI           | Add sync button, portal link |
| `src/app/pages/profile/components/profile-details.component.ts` | Subscription display | Add sync UI                  |

### VS Code Extension

| File                                                       | Purpose              | Changes Needed                        |
| ---------------------------------------------------------- | -------------------- | ------------------------------------- |
| `libs/backend/vscode-core/src/services/license.service.ts` | License verification | None (uses existing /verify endpoint) |
