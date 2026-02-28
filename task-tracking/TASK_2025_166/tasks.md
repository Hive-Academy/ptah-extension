# Development Tasks - TASK_2025_166

**Total Tasks**: 7 | **Batches**: 4 | **Status**: PLANNED

## Batch 1: Database + Backend Foundation (parallel with Batch 2)

### Task 1.1: Prisma Schema + Migration

**Developer**: backend-developer
**Files**:

- MODIFY `apps/ptah-license-server/prisma/schema.prisma` (add SessionRequest model + User relation)
- Run `npx prisma migrate dev --name add-session-requests`
  **Status**: PENDING

### Task 1.2: Backend SessionModule + Email Templates

**Developer**: backend-developer
**Depends on**: Task 1.1
**Files**:

- CREATE `apps/ptah-license-server/src/session/session.module.ts`
- CREATE `apps/ptah-license-server/src/session/session.controller.ts`
- CREATE `apps/ptah-license-server/src/session/session.service.ts`
- CREATE `apps/ptah-license-server/src/session/dto/session-request.dto.ts`
- MODIFY `apps/ptah-license-server/src/app/app.module.ts` (import SessionModule)
- MODIFY `apps/ptah-license-server/src/email/services/email.service.ts` (add 2 email methods + templates)
- MODIFY `apps/ptah-license-server/src/app/auth/auth.controller.ts` (add /sessions to ALLOWED_RETURN_PATHS)
  **Status**: PENDING

## Batch 2: Paddle Integration (parallel with Batch 1)

### Task 2.1: Paddle Config + Checkout Service Enhancement

**Developer**: frontend-developer
**Files**:

- CREATE `apps/ptah-landing-page/src/app/config/sessions.config.ts` (session topics + pricing)
- MODIFY `apps/ptah-landing-page/src/app/config/paddle.config.ts` (add sessionPriceId)
- MODIFY `apps/ptah-landing-page/src/environments/environment.ts` (add sessionPriceId)
- MODIFY `apps/ptah-landing-page/src/environments/environment.production.ts` (add sessionPriceId)
- MODIFY `apps/ptah-landing-page/src/app/app.config.ts` (pass sessionPriceId)
- MODIFY `apps/ptah-landing-page/src/app/services/paddle-checkout.service.ts` (add onComplete callback)
  **Status**: PENDING

### Task 2.2: Paddle Webhook — Handle One-Time Session Payments

**Developer**: backend-developer
**Files**:

- MODIFY `apps/ptah-license-server/src/paddle/paddle.service.ts` (handle session price in handleTransactionCompletedEvent)
  **Status**: PENDING

## Batch 3: Frontend Components (depends on Batch 2)

### Task 3.1: Sessions Page Components

**Developer**: frontend-developer
**Depends on**: Task 2.1
**Files**:

- CREATE `apps/ptah-landing-page/src/app/pages/sessions/sessions-page.component.ts`
- CREATE `apps/ptah-landing-page/src/app/pages/sessions/components/sessions-hero.component.ts`
- CREATE `apps/ptah-landing-page/src/app/pages/sessions/components/session-card.component.ts`
- CREATE `apps/ptah-landing-page/src/app/pages/sessions/components/sessions-grid.component.ts`
- CREATE `apps/ptah-landing-page/src/app/pages/sessions/components/session-registration-modal.component.ts`
  **Status**: PENDING

## Batch 4: Wiring + Verification (depends on Batch 3)

### Task 4.1: Route + Navigation Updates

**Developer**: frontend-developer
**Depends on**: Task 3.1
**Files**:

- MODIFY `apps/ptah-landing-page/src/app/app.routes.ts` (add /sessions route)
- MODIFY `apps/ptah-landing-page/src/app/components/navigation.component.ts` (add Sessions link)
  **Status**: PENDING

### Task 4.2: Build Verification

**Developer**: any
**Depends on**: All tasks
**Commands**:

- `npx prisma migrate dev` (verify migration)
- `nx build ptah-license-server`
- `nx build ptah-landing-page`
- `nx lint ptah-license-server`
- `nx lint ptah-landing-page`
  **Status**: PENDING
