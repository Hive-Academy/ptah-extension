# Implementation Plan - TASK_2025_165: Contact Us Page

## Architecture Design

### Backend: ContactModule

**POST /api/v1/contact**

- Auth: `@UseGuards(JwtAuthGuard)` — user email/id from `req.user`
- Rate: `@Throttle({ default: { limit: 3, ttl: 60000 } })` — 3 req/min
- Body (class-validator):
  ```typescript
  class ContactMessageDto {
    @IsString() @MinLength(3) @MaxLength(200) subject: string;
    @IsString() @MinLength(10) @MaxLength(5000) message: string;
    @IsOptional()
    @IsString()
    @IsIn(['general', 'billing', 'technical', 'feature-request', 'other'])
    category?: string;
  }
  ```
- Response: `{ success: true, message: "Your message has been sent. We will get back to you soon." }`

**ContactService**: Calls `EmailService.sendContactMessage()` with user info + form data.

**Email Template** (`sendContactMessage` in email.service.ts):

- From: `Ptah Team <help@ptah.live>`
- To: `help@ptah.live`
- Reply-To: user's email (so team can reply directly)
- Subject: `[Contact - ${category}] ${subject}`
- HTML body: User info card (email, user ID), category badge, subject, message body, timestamp

### Frontend: Contact Page

3 standalone Angular 20 components with OnPush + signals:

**contact-page.component.ts** — thin container:

```html
<ptah-navigation />
<ptah-contact-hero />
<ptah-contact-form />
<ptah-footer />
```

**contact-hero.component.ts** — heading + subtitle:

- "Get in Touch" with amber gradient text
- Subtitle: "Have a question, feedback, or need help? We'd love to hear from you."

**contact-form.component.ts** — interactive form:

- Signals: `subject`, `message`, `category`, `isSubmitting`, `submitSuccess`, `submitError`
- Computed: `isValid` (subject >= 3 chars, message >= 10 chars)
- DaisyUI form controls: input, select, textarea
- Card container with amber border accent
- POST /api/v1/contact via HttpClient
- Success: green alert + reset form
- Error: red alert with message

### Navigation Update

Add "Contact" link in `navigation.component.ts`:

- Desktop: Inside `@if (isAuthenticated())` block, after "Docs" link
- Mobile: Same position in mobile menu
- Style matches existing links: `text-white/80 hover:text-amber-400 transition-colors text-sm font-medium`

### Route

```typescript
{ path: 'contact', component: ContactPageComponent, canActivate: [AuthGuard, TrialStatusGuard] }
```

---

## Files Affected Summary

### CREATE (7 files)

| File                                                                                | Purpose             |
| ----------------------------------------------------------------------------------- | ------------------- |
| `apps/ptah-license-server/src/contact/contact.module.ts`                            | NestJS module       |
| `apps/ptah-license-server/src/contact/contact.controller.ts`                        | API endpoint        |
| `apps/ptah-license-server/src/contact/contact.service.ts`                           | Email sending logic |
| `apps/ptah-license-server/src/contact/dto/contact-message.dto.ts`                   | Validation DTO      |
| `apps/ptah-landing-page/src/app/pages/contact/contact-page.component.ts`            | Page container      |
| `apps/ptah-landing-page/src/app/pages/contact/components/contact-hero.component.ts` | Hero section        |
| `apps/ptah-landing-page/src/app/pages/contact/components/contact-form.component.ts` | Form component      |

### MODIFY (5 files)

| File                                                                | Change                                   |
| ------------------------------------------------------------------- | ---------------------------------------- |
| `apps/ptah-license-server/src/app/app.module.ts`                    | Import ContactModule                     |
| `apps/ptah-license-server/src/email/services/email.service.ts`      | Add sendContactMessage() + HTML template |
| `apps/ptah-license-server/src/app/auth/auth.controller.ts`          | Add /contact to ALLOWED_RETURN_PATHS     |
| `apps/ptah-landing-page/src/app/app.routes.ts`                      | Add /contact route                       |
| `apps/ptah-landing-page/src/app/components/navigation.component.ts` | Add Contact nav link (auth-only)         |

---

## Team-Leader Handoff

### Developer Type Recommendation

- **Backend work**: backend-developer (ContactModule, email template)
- **Frontend work**: frontend-developer (3 Angular components, route, navigation)
- Can be parallelized: backend and frontend are independent until integration

### Complexity Assessment

**Complexity**: LOW-MEDIUM
**Estimated Effort**: 2-3 hours

### Verification

- `nx build ptah-license-server` — compiles
- `nx build ptah-landing-page` — compiles
- `nx lint ptah-license-server` — passes
- `nx lint ptah-landing-page` — passes
- Manual: Login → /contact → submit form → verify email at help@ptah.live
