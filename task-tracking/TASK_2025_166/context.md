# TASK_2025_166: Sessions Showcase & Registration with Paddle One-Time Payments

## Strategy: FEATURE

## Flow: PM → Architect → Team-Leader → Developers → QA

## Status: Planned (Future)

## User Intent

Add a "Sessions" page to the landing page where authenticated users can browse and register for 2-hour Ptah training sessions (NX monorepo, orchestration workflow, Ptah usage). Community members get ONE free session; subsequent sessions cost $100 via Paddle one-time payment. Registration is request-based: user submits interest, team responds by email with available dates/slots.

## Problem Statement

There is no way for users to discover or register for Ptah training sessions. The team offers consulting/training on NX monorepo workflows, orchestration, and Ptah usage, but has no self-service registration flow. Paddle is integrated for subscriptions but NOT for one-time payments (currently explicitly skipped in webhook handler).

## Requirements

### Functional

1. New `/sessions` route protected by AuthGuard + TrialStatusGuard
2. Session showcase with 3 topic cards (configurable via TypeScript config file):
   - **NX Monorepo Mastery** — Setting up Ptah for NX workspaces, agent orchestration
   - **Orchestration Workflow Deep Dive** — PM→Architect→Dev pipeline, task tracking, custom agents
   - **Getting the Most Out of Ptah** — Setup wizard, chat tips, MCP integration, cost tracking
3. Each card shows: title, description, topics checklist, difficulty badge, duration (2h), price
4. **Free session**: Community members get ONE free session (tracked in DB via SessionRequest table)
5. **Paid session**: $100 via Paddle one-time payment (pre-configured price ID)
6. **Registration flow**: User submits interest request → team responds via email with available dates
7. Eligibility check: GET /api/v1/sessions/eligibility (has free session used or not)
8. Registration: POST /api/v1/sessions/request (creates DB record, sends emails to team + user)
9. Paddle webhook handles one-time payment confirmation (update SessionRequest.paymentStatus)

### Non-Functional

- Follow existing Angular 20 patterns: standalone components, OnPush, signals
- Anubis dark theme styling (matching pricing cards visual language)
- Session topics in a static config file (no DB for catalog — easy to add/modify)
- Rate limited: 5 requests/minute for registration
- Navigation link visible only for authenticated users

## Key Files

### New Files (Frontend — 6 components + config)

| File                                                                                               | Purpose                                                          |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/ptah-landing-page/src/app/config/sessions.config.ts`                                         | Static session topics config (SessionTopic[], pricing constants) |
| `apps/ptah-landing-page/src/app/pages/sessions/sessions-page.component.ts`                         | Page container                                                   |
| `apps/ptah-landing-page/src/app/pages/sessions/components/sessions-hero.component.ts`              | Hero section                                                     |
| `apps/ptah-landing-page/src/app/pages/sessions/components/session-card.component.ts`               | Individual session card (icon, topics, price, CTA)               |
| `apps/ptah-landing-page/src/app/pages/sessions/components/sessions-grid.component.ts`              | Grid orchestrator (eligibility, Paddle checkout, registration)   |
| `apps/ptah-landing-page/src/app/pages/sessions/components/session-registration-modal.component.ts` | Registration modal (notes, price, submit/pay button)             |

### New Files (Backend — 4 files)

| File                                                              | Purpose                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------- |
| `apps/ptah-license-server/src/session/session.module.ts`          | NestJS module (PrismaModule, EmailModule, ConfigModule) |
| `apps/ptah-license-server/src/session/session.controller.ts`      | GET /eligibility + POST /request endpoints              |
| `apps/ptah-license-server/src/session/session.service.ts`         | Free eligibility check, request creation, email sending |
| `apps/ptah-license-server/src/session/dto/session-request.dto.ts` | class-validator DTO                                     |

### Modified Files

| File                                                                 | Change                                                                |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `apps/ptah-license-server/prisma/schema.prisma`                      | Add SessionRequest model + User relation                              |
| `apps/ptah-license-server/src/app/app.module.ts`                     | Import SessionModule                                                  |
| `apps/ptah-license-server/src/email/services/email.service.ts`       | Add sendSessionRequestNotification() + sendSessionConfirmation()      |
| `apps/ptah-license-server/src/paddle/paddle.service.ts`              | Handle one-time session payments in handleTransactionCompletedEvent() |
| `apps/ptah-license-server/src/app/auth/auth.controller.ts`           | Add /sessions to ALLOWED_RETURN_PATHS                                 |
| `apps/ptah-landing-page/src/app/config/paddle.config.ts`             | Add sessionPriceId to PaddleConfig interface                          |
| `apps/ptah-landing-page/src/environments/environment.ts`             | Add sessionPriceId (sandbox)                                          |
| `apps/ptah-landing-page/src/environments/environment.production.ts`  | Add sessionPriceId (production)                                       |
| `apps/ptah-landing-page/src/app/app.config.ts`                       | Pass sessionPriceId to providePaddleConfig()                          |
| `apps/ptah-landing-page/src/app/services/paddle-checkout.service.ts` | Add onComplete callback to openCheckout() for non-subscription flows  |
| `apps/ptah-landing-page/src/app/app.routes.ts`                       | Add /sessions route                                                   |
| `apps/ptah-landing-page/src/app/components/navigation.component.ts`  | Add Sessions nav link (auth-only, desktop + mobile)                   |

## Prisma Schema Addition

```prisma
model SessionRequest {
  id                  String    @id @default(uuid()) @db.Uuid
  userId              String    @map("user_id") @db.Uuid
  user                User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  sessionTopicId      String    @map("session_topic_id")
  additionalNotes     String?   @map("additional_notes")
  isFreeSession       Boolean   @default(false) @map("is_free_session")
  status              String    @default("pending") // pending | scheduled | completed | canceled
  paymentStatus       String    @default("none") @map("payment_status") // none | pending | completed
  paddleTransactionId String?   @map("paddle_transaction_id")
  scheduledAt         DateTime? @map("scheduled_at")
  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime  @updatedAt @map("updated_at")

  @@index([userId])
  @@index([status])
  @@map("session_requests")
}
```

Also add `sessionRequests SessionRequest[]` to the User model.

## Registration Flows

### Free Session (community member, first time)

1. User clicks "Register Interest" on session card
2. Modal opens: session details + "FREE — Your first session is on us"
3. User optionally adds notes → clicks "Submit Request"
4. POST /api/v1/sessions/request → backend checks eligibility, creates record (isFreeSession=true)
5. Backend sends emails: notification to team (help@ptah.live) + confirmation to user
6. Success message: "Request submitted! We'll email you with available dates."

### Paid Session ($100)

1. User clicks "Register Interest" on session card
2. Modal opens: session details + "$100 per 2-hour session"
3. User optionally adds notes → clicks "Proceed to Payment"
4. Paddle checkout overlay opens (one-time $100 price)
5. On checkout.completed: POST /api/v1/sessions/request with paddleTransactionId
6. Backend creates record (paymentStatus='pending'), sends emails
7. Paddle webhook later confirms payment → updates paymentStatus to 'completed'
8. Success message displayed

### Paddle Webhook Change

In `paddle.service.ts` `handleTransactionCompletedEvent()`, instead of skipping all non-subscription transactions:

```typescript
if (!data.subscriptionId) {
  const sessionPriceId = this.configService.get<string>('PADDLE_PRICE_ID_SESSION');
  if (data.items?.[0]?.price?.id === sessionPriceId) {
    await this.prisma.sessionRequest.updateMany({
      where: { paddleTransactionId: data.id, paymentStatus: 'pending' },
      data: { paymentStatus: 'completed' },
    });
    return { success: true };
  }
  return { success: true, skipped: true };
}
```

## Reference Patterns

- **Page/card structure**: `apps/ptah-landing-page/src/app/pages/pricing/` — PricingGridComponent, ProPlanCard
- **Paddle checkout**: `apps/ptah-landing-page/src/app/services/paddle-checkout.service.ts` — openCheckout(), handlePaddleEvent()
- **Email templates**: `apps/ptah-license-server/src/email/services/email.service.ts` — sendWithRetry, HTML templates
- **Webhook handling**: `apps/ptah-license-server/src/paddle/paddle.service.ts` — handleTransactionCompletedEvent()

## Constraints

- Session catalog is static (TS config file), no admin UI needed
- Free session tracking via DB (SessionRequest.isFreeSession) — reliable, auditable
- Paddle price ID must be created in Paddle dashboard (sandbox + production)
- Must add PADDLE_PRICE_ID_SESSION to backend .env
- Must compile: `nx build ptah-landing-page` and `nx build ptah-license-server`

## Dependencies

- TASK_2025_165 (Contact Us Page) — shares navigation update pattern, but not a hard dependency
- Paddle dashboard: Must create a one-time $100 product/price before testing payments
