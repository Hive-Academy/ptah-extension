# Implementation Plan - TASK_2025_166: Sessions Showcase & Registration

## Architecture Design

### Phase 1: Database + Backend Foundation

#### Prisma Migration

Add `SessionRequest` model to schema.prisma (see context.md for full schema). Add `sessionRequests SessionRequest[]` to User model. Run `npx prisma migrate dev --name add-session-requests`.

#### SessionModule (NestJS)

**GET /api/v1/sessions/eligibility**

- Auth: `@UseGuards(JwtAuthGuard)`
- Response: `{ hasFreeSession: boolean, usedFreeSession: boolean }`
- Logic: Query `SessionRequest WHERE userId = ? AND isFreeSession = true` — if count > 0, `usedFreeSession = true`

**POST /api/v1/sessions/request**

- Auth: `@UseGuards(JwtAuthGuard)`
- Rate: `@Throttle({ default: { limit: 5, ttl: 60000 } })` — 5 req/min
- Body (class-validator):
  ```typescript
  class SessionRequestDto {
    @IsString() @MinLength(1) sessionTopicId: string;
    @IsOptional() @IsString() @MaxLength(1000) additionalNotes?: string;
    @IsOptional() @IsString() paddleTransactionId?: string;
  }
  ```
- Logic:
  1. Check free eligibility (no prior isFreeSession=true record for this user)
  2. If free eligible + no paddleTransactionId → create with `isFreeSession=true, paymentStatus='none'`
  3. If paddleTransactionId provided → create with `isFreeSession=false, paymentStatus='pending'`
  4. If not free eligible + no paddleTransactionId → reject (400: payment required)
  5. Send notification email to team + confirmation to user
- Response: `{ success: true, message: "...", isFreeSession: boolean }`

#### Email Templates (2 new methods in email.service.ts)

**sendSessionRequestNotification** (to team):

- Subject: `[Session Request] ${topicTitle} - ${userEmail}`
- Body: Session details, user info, free/paid badge, additional notes, payment status

**sendSessionConfirmation** (to user):

- Subject: `Your Ptah Session Request Has Been Received`
- Body: Session topic, free/paid confirmation, "what happens next" section

#### Paddle Webhook Modification

In `paddle.service.ts` `handleTransactionCompletedEvent()`:

- Replace early return for non-subscription transactions with session price ID check
- If matches `PADDLE_PRICE_ID_SESSION`: update `SessionRequest.paymentStatus` to 'completed'
- Otherwise: skip as before

---

### Phase 2: Frontend — Session Config + Paddle Config

#### sessions.config.ts

Static TypeScript config with `SessionTopic[]` interface:

```typescript
interface SessionTopic {
  id: string;
  title: string;
  description: string;
  icon: string; // Lucide icon name
  duration: string;
  topics: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}
```

3 pre-defined sessions: NX Monorepo Mastery, Orchestration Deep Dive, Getting the Most Out of Ptah.

#### Paddle Config Updates

- Add `sessionPriceId?: string` to `PaddleConfig` interface
- Add to both environment files (sandbox + production placeholders)
- Pass through `providePaddleConfig()` in app.config.ts

#### PaddleCheckoutService Enhancement

Add optional `onComplete` callback to `openCheckout()`:

```typescript
public async openCheckout(
  options: CheckoutOptions & { onComplete?: (transactionId?: string) => void }
): Promise<void>
```

In `handlePaddleEvent` for `checkout.completed`: if callback exists, invoke it with transaction data instead of default license verify + navigate flow.

---

### Phase 3: Frontend — Sessions Page Components

**sessions-page.component.ts** — thin container (same pattern as pricing-page):

```html
<ptah-navigation />
<ptah-sessions-hero />
<ptah-sessions-grid />
<ptah-footer />
```

**sessions-hero.component.ts** — heading + subtitle + pricing model explanation

**session-card.component.ts** — individual session card:

- Inputs: `session: SessionTopic`, `eligibility: SessionEligibility | null`
- Outputs: `registerClick: SessionTopic`
- Displays: icon, title, description, topics checklist, difficulty badge, duration, price (FREE or $100), CTA button
- Computed: `priceDisplay` (FREE if eligible, $100 otherwise), `difficultyClass` (badge color)

**sessions-grid.component.ts** — orchestrator:

- Fetches eligibility on init (GET /api/v1/sessions/eligibility)
- Initializes Paddle SDK for paid sessions
- Handles register click → opens registration modal
- Manages success/error state signals

**session-registration-modal.component.ts** — modal dialog:

- Session details (read-only)
- Additional notes textarea (optional)
- Price display (FREE or $100)
- For free: "Submit Request" button → POST /api/v1/sessions/request
- For paid: "Proceed to Payment" → Paddle checkout → on complete → POST with transactionId
- Success/error states

---

### Phase 4: Route + Navigation

- Add `/sessions` route with `[AuthGuard, TrialStatusGuard]`
- Add "Sessions" link in navigation (auth-only, desktop + mobile, before "Contact" if TASK_2025_165 exists)

---

## Files Affected Summary

### CREATE (10 files)

| File                                                                                               | Purpose               |
| -------------------------------------------------------------------------------------------------- | --------------------- |
| `apps/ptah-license-server/src/session/session.module.ts`                                           | NestJS module         |
| `apps/ptah-license-server/src/session/session.controller.ts`                                       | API endpoints         |
| `apps/ptah-license-server/src/session/session.service.ts`                                          | Business logic        |
| `apps/ptah-license-server/src/session/dto/session-request.dto.ts`                                  | Validation DTO        |
| `apps/ptah-landing-page/src/app/config/sessions.config.ts`                                         | Session topics config |
| `apps/ptah-landing-page/src/app/pages/sessions/sessions-page.component.ts`                         | Page container        |
| `apps/ptah-landing-page/src/app/pages/sessions/components/sessions-hero.component.ts`              | Hero section          |
| `apps/ptah-landing-page/src/app/pages/sessions/components/session-card.component.ts`               | Session card          |
| `apps/ptah-landing-page/src/app/pages/sessions/components/sessions-grid.component.ts`              | Grid orchestrator     |
| `apps/ptah-landing-page/src/app/pages/sessions/components/session-registration-modal.component.ts` | Registration modal    |

### MODIFY (12 files)

| File                                                                 | Change                                   |
| -------------------------------------------------------------------- | ---------------------------------------- |
| `apps/ptah-license-server/prisma/schema.prisma`                      | Add SessionRequest model + User relation |
| `apps/ptah-license-server/src/app/app.module.ts`                     | Import SessionModule                     |
| `apps/ptah-license-server/src/email/services/email.service.ts`       | 2 new email methods + templates          |
| `apps/ptah-license-server/src/paddle/paddle.service.ts`              | Handle one-time session payments         |
| `apps/ptah-license-server/src/app/auth/auth.controller.ts`           | Add /sessions to ALLOWED_RETURN_PATHS    |
| `apps/ptah-landing-page/src/app/config/paddle.config.ts`             | Add sessionPriceId to interface          |
| `apps/ptah-landing-page/src/environments/environment.ts`             | Add sessionPriceId (sandbox)             |
| `apps/ptah-landing-page/src/environments/environment.production.ts`  | Add sessionPriceId (production)          |
| `apps/ptah-landing-page/src/app/app.config.ts`                       | Pass sessionPriceId                      |
| `apps/ptah-landing-page/src/app/services/paddle-checkout.service.ts` | Add onComplete callback                  |
| `apps/ptah-landing-page/src/app/app.routes.ts`                       | Add /sessions route                      |
| `apps/ptah-landing-page/src/app/components/navigation.component.ts`  | Add Sessions nav link                    |

---

## Team-Leader Handoff

### Developer Type Recommendation

- **Backend work**: backend-developer (SessionModule, Prisma, email templates, Paddle webhook)
- **Frontend work**: frontend-developer (6 Angular components, config, Paddle service enhancement)
- **Parallelizable**: Backend (Phase 1) and Frontend config/Paddle (Phase 2) can run in parallel

### Complexity Assessment

**Complexity**: MEDIUM-HIGH
**Estimated Effort**: 5-7 hours

**Breakdown**:

- Prisma schema + migration: 20 min
- SessionModule (controller, service, DTO): 1 hour
- Email templates (2 methods): 45 min
- Paddle webhook modification: 30 min
- sessions.config.ts + Paddle config: 30 min
- PaddleCheckoutService enhancement: 30 min
- 5 frontend components: 2-3 hours
- Route + navigation: 20 min
- Verification: 30 min

### Prerequisites

1. Create Paddle one-time product ($100 session) in sandbox dashboard
2. Get the price ID → add to environment.ts + backend .env
3. Create matching product in production dashboard when ready

### Verification

- `npx prisma migrate dev` — migration applies
- `nx build ptah-license-server` — compiles
- `nx build ptah-landing-page` — compiles
- `nx lint ptah-license-server` — passes
- `nx lint ptah-landing-page` — passes
- Manual: Login → /sessions → verify eligibility → register free session → verify emails
- Manual: Register paid session → Paddle overlay → complete → verify session request + emails
