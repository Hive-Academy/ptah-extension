# TASK_2025_165: Contact Us Page — Authenticated User Messaging

## Strategy: FEATURE

## Flow: Architect → Team-Leader → Developers → QA

## Status: Planned (Future)

## User Intent

Add a "Contact Us" page to the landing page application that allows authenticated users to send messages to the Ptah team. Messages are delivered via email (Resend) to help@ptah.live with the user's email as reply-to. No database storage — email-only delivery.

## Problem Statement

Authenticated users currently have no way to contact the Ptah team from the landing page. There is no contact form, feedback mechanism, or support request flow. Users must rely on external channels (Discord, email) which aren't integrated into the product experience.

## Requirements

### Functional

1. New `/contact` route protected by AuthGuard + TrialStatusGuard
2. Contact form with: subject (required, 3-200 chars), message (required, 10-5000 chars), category (optional dropdown)
3. Categories: General Inquiry, Billing & Payments, Technical Support, Feature Request, Other
4. On submit: POST /api/v1/contact → Resend email to help@ptah.live
5. User's email/name from JWT context (no manual entry needed)
6. Reply-to header set to user's email for easy team responses
7. Success confirmation displayed after submission
8. Rate limited: 3 requests/minute to prevent spam

### Non-Functional

- Follow existing Angular 20 patterns: standalone components, OnPush, signals
- Anubis dark theme styling (amber/gold accents, DaisyUI form controls)
- Navigation links (desktop + mobile) visible only for authenticated users
- No database table — zero persistence overhead

## Key Files

### New Files (Frontend — 3 components)

| File                                                                                | Purpose                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `apps/ptah-landing-page/src/app/pages/contact/contact-page.component.ts`            | Page container (Navigation + Hero + Form + Footer)                  |
| `apps/ptah-landing-page/src/app/pages/contact/components/contact-hero.component.ts` | Hero section: "Get in Touch" heading, subtitle                      |
| `apps/ptah-landing-page/src/app/pages/contact/components/contact-form.component.ts` | Form with validation, category select, submit, success/error states |

### New Files (Backend — 3 files + DTO)

| File                                                              | Purpose                                                     |
| ----------------------------------------------------------------- | ----------------------------------------------------------- |
| `apps/ptah-license-server/src/contact/contact.module.ts`          | NestJS module                                               |
| `apps/ptah-license-server/src/contact/contact.controller.ts`      | POST /api/v1/contact endpoint with JwtAuthGuard + @Throttle |
| `apps/ptah-license-server/src/contact/contact.service.ts`         | Sends contact email via EmailService                        |
| `apps/ptah-license-server/src/contact/dto/contact-message.dto.ts` | class-validator DTO                                         |

### Modified Files

| File                                                                | Change                                               |
| ------------------------------------------------------------------- | ---------------------------------------------------- |
| `apps/ptah-license-server/src/app/app.module.ts`                    | Import ContactModule                                 |
| `apps/ptah-license-server/src/email/services/email.service.ts`      | Add `sendContactMessage()` method + HTML template    |
| `apps/ptah-license-server/src/app/auth/auth.controller.ts`          | Add `/contact` to ALLOWED_RETURN_PATHS               |
| `apps/ptah-landing-page/src/app/app.routes.ts`                      | Add /contact route                                   |
| `apps/ptah-landing-page/src/app/components/navigation.component.ts` | Add "Contact" nav link (auth-only, desktop + mobile) |

## Reference Patterns

- **Page structure**: `apps/ptah-landing-page/src/app/pages/pricing/pricing-page.component.ts` — same Navigation + Hero + Content + Footer pattern
- **Form components**: `apps/ptah-landing-page/src/app/pages/auth/components/auth-form.component.ts` — signal-based form with validation
- **API calls**: `apps/ptah-landing-page/src/app/pages/auth/services/auth-api.service.ts` — HttpClient with apiInterceptor
- **Email templates**: `apps/ptah-license-server/src/email/services/email.service.ts` — sendWithRetry pattern, HTML templates
- **Navigation**: `apps/ptah-landing-page/src/app/components/navigation.component.ts` — auth-aware links

## Constraints

- Email-only delivery (no DB storage)
- Must work with existing Resend provider (help@ptah.live sender)
- Rate limited to prevent abuse (3/min)
- Only accessible to authenticated users
- Must compile cleanly: `nx build ptah-landing-page` and `nx build ptah-license-server`

## Dependencies

- None — fully independent feature, can be implemented on any branch
