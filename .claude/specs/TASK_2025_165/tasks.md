# Development Tasks - TASK_2025_165

**Total Tasks**: 4 | **Batches**: 2 (parallel) | **Status**: PLANNED

## Batch 1: Backend + Frontend (parallel)

### Task 1.1: Backend ContactModule + Email Template

**Developer**: backend-developer
**Files**:

- CREATE `apps/ptah-license-server/src/contact/contact.module.ts`
- CREATE `apps/ptah-license-server/src/contact/contact.controller.ts`
- CREATE `apps/ptah-license-server/src/contact/contact.service.ts`
- CREATE `apps/ptah-license-server/src/contact/dto/contact-message.dto.ts`
- MODIFY `apps/ptah-license-server/src/app/app.module.ts` (import ContactModule)
- MODIFY `apps/ptah-license-server/src/email/services/email.service.ts` (add sendContactMessage + template)
- MODIFY `apps/ptah-license-server/src/app/auth/auth.controller.ts` (add /contact to ALLOWED_RETURN_PATHS)
  **Status**: PENDING

### Task 1.2: Frontend Contact Page Components

**Developer**: frontend-developer
**Files**:

- CREATE `apps/ptah-landing-page/src/app/pages/contact/contact-page.component.ts`
- CREATE `apps/ptah-landing-page/src/app/pages/contact/components/contact-hero.component.ts`
- CREATE `apps/ptah-landing-page/src/app/pages/contact/components/contact-form.component.ts`
  **Status**: PENDING

## Batch 2: Wiring (depends on Batch 1)

### Task 2.1: Route + Navigation Updates

**Developer**: frontend-developer
**Files**:

- MODIFY `apps/ptah-landing-page/src/app/app.routes.ts` (add /contact route with AuthGuard + TrialStatusGuard)
- MODIFY `apps/ptah-landing-page/src/app/components/navigation.component.ts` (add Contact link, desktop + mobile)
  **Status**: PENDING

### Task 2.2: Build Verification

**Developer**: any
**Commands**:

- `nx build ptah-license-server`
- `nx build ptah-landing-page`
- `nx lint ptah-license-server`
- `nx lint ptah-landing-page`
  **Status**: PENDING
