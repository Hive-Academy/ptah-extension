# Implementation Plan — TASK_2026_170

**Make `class-validator` actually run on every endpoint in `ptah-license-server`.**

Type: BUGFIX (security-adjacent) · Strategy: **Hybrid — Option A now, Option B deferred**
Author: software-architect · Date: 2026-08-01

---

## 0. Headline

Nine controllers and sixteen DTO files currently have **zero** runtime input validation. The fix
(`dtoPipe`) already exists and is proven. The work is **not** the binding — it is knowing, per DTO,
whether turning validation on breaks a caller.

**Three findings dominate this plan. Read these before anything else.**

| #      | Finding                                                                                                                                                                                                                                                                                                                                                                                                                 | Severity             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **F1** | `dtoPipe(UpdateRecordDto)` on `AdminController.update` would **400 every admin record edit**. `UpdateRecordDto` is `{ [key: string]: unknown }` — zero validation metadata — and `whitelist + forbidNonWhitelisted` rejects _every_ property of a zero-metadata class. Verified against installed `class-validator` source. A naive rollout breaks the entire admin edit surface.                                       | 🔴 BLOCKER-IF-MISSED |
| **F2** | `VerifyLicenseDto` enforces `^ptah_lic_[a-f0-9]{64}$` on a **public, unauthenticated** endpoint that every installed extension calls. `license.service.ts:216` documents a **second, legacy key format** (`PTAH-XXXX-XXXX-XXXX`). If any such row exists, those users get a 400 instead of a verdict. Must be settled by SQL before binding.                                                                            | 🔴 DATA-GATED        |
| **F3** | The structural test that is supposed to make this stay fixed lives in `src/admin/admin-guards.spec.ts` — an **admin-named** spec — and its param enumerator cannot distinguish `@Query()` (whole object) from `@Query('code')` (named primitive). Bolting `WaitlistController` / `AuthController` onto it would both misfile them and produce false failures. G7 needs restructuring **before** the rollout, not after. | 🟠 STRUCTURAL        |

Everything else is either SAFE or a desirable, recordable behaviour change.

---

## 1. Root cause — re-verified against installed source, not taken on faith

The handoff's diagnosis is **correct**. I re-derived it rather than trusting it:

- `node_modules/@nestjs/common/pipes/validation.pipe.js` `transform()`:
  ```js
  if (this.expectedType) {
    metadata = { ...metadata, metatype: this.expectedType };
  }
  const metatype = metadata.metatype;
  if (!metatype || !this.toValidate(metadata)) {
    return this.isTransformEnabled ? this.transformPrimitive(value, metadata) : value;
  }
  ```
  `expectedType` is applied **before** the short-circuit. `dtoPipe` is mechanically sound.
- Same file, constructor: `this.validatorOptions = { forbidUnknownValues: false, ...validatorOptions }`.
  **Nest disables class-validator's `forbidUnknownValues` by default.** This matters for F1 — a reader
  diagnosing the PATCH breakage might "fix" it by toggling that flag. It is not the mechanism.
- `node_modules/class-validator/cjs/validation/ValidationExecutor.js` `whitelist()`:
  ```js
  Object.keys(object).forEach((propertyName) => {
    if (!groupedMetadatas[propertyName] || groupedMetadatas[propertyName].length === 0) notAllowedProperties.push(propertyName);
  });
  // …then, when forbidNonWhitelisted: `property ${property} should not exist`
  ```
  **This** is the F1 mechanism. Zero metadata ⇒ every key is "not allowed".
- Installed versions: `@nestjs/common` 11.1.23, `class-validator` 0.15.1.
- `apps/ptah-license-server/src/common/dto-validation.pipe.ts:49-56` — `dtoPipe` sets
  `{ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true }`.

### `main.ts` stays as-is

`main.ts:41-47` keeps its global `ValidationPipe`. It is inert today, but it is the safety net the day
Option B lands, and removing it would be a real behavioural change disguised as cleanup. **Add a
docblock** at that call site explaining why it is inert and pointing at `dtoPipe`. That is the only
edit to `main.ts` in this task.

---

## 2. Verified controller / DTO inventory

Derived from `Grep '@(Body|Query)\('` across `apps/ptah-license-server/src`, then reading every hit.
**The handoff's table is materially wrong in five places** — all corrected below and itemised in §2.3.

### 2.1 In scope — 9 controllers, 16 DTO files, 20 payload params

| #   | Controller (path under `apps/ptah-license-server/src/`)  | Handler                     | Param      | DTO                            | DTO file                                         | Auth posture                                | Tier |
| --- | -------------------------------------------------------- | --------------------------- | ---------- | ------------------------------ | ------------------------------------------------ | ------------------------------------------- | ---- |
| 1   | `waitlist/waitlist.controller.ts:37`                     | `join`                      | `@Body()`  | `JoinWaitlistDto`              | `waitlist/dto/join-waitlist.dto.ts`              | **public** (`@Throttle 5/min`)              | 1    |
| 2   | `license/controllers/license.controller.ts:101`          | `verify`                    | `@Body()`  | `VerifyLicenseDto`             | `license/dto/verify-license.dto.ts`              | **public** (`@Throttle 10/min`)             | 1    |
| 3   | `app/auth/auth.controller.ts:424`                        | `requestMagicLink`          | `@Body()`  | `MagicLinkDto`                 | `app/auth/dto/magic-link.dto.ts`                 | **public**                                  | 1    |
| 3   | `app/auth/auth.controller.ts:604`                        | `loginWithEmail`            | `@Body()`  | `LoginDto`                     | `app/auth/dto/login.dto.ts`                      | **public**                                  | 1    |
| 3   | `app/auth/auth.controller.ts:656`                        | `signup`                    | `@Body()`  | `SignupDto`                    | `app/auth/dto/signup.dto.ts`                     | **public**                                  | 1    |
| 3   | `app/auth/auth.controller.ts:702`                        | `verifyEmail`               | `@Body()`  | `VerifyEmailDto`               | `app/auth/dto/verify-email.dto.ts`               | **public**                                  | 1    |
| 3   | `app/auth/auth.controller.ts:756`                        | `resendVerification`        | `@Body()`  | `ResendVerificationDto`        | `app/auth/dto/resend-verification.dto.ts`        | **public**                                  | 1    |
| 4   | `contact/contact.controller.ts:28`                       | `sendMessage`               | `@Body()`  | `ContactMessageDto`            | `contact/dto/contact-message.dto.ts`             | **authenticated** (`JwtAuthGuard`)          | 2    |
| 5   | `session/session.controller.ts:39`                       | `requestSession`            | `@Body()`  | `SessionRequestDto`            | `session/dto/session-request.dto.ts`             | authenticated                               | 2    |
| 6   | `subscription/subscription.controller.ts:109`            | `validateCheckout`          | `@Body()`  | `ValidateCheckoutDto`          | `subscription/dto/subscription.dto.ts`           | authenticated                               | 2    |
| 7   | `admin/admin.controller.ts:96`                           | `bulkEmailUsers`            | `@Body()`  | `BulkEmailDto`                 | `admin/admin.dto.ts`                             | admin (JWT+`AdminGuard`)                    | 3    |
| 7   | `admin/admin.controller.ts:138`                          | `deleteUser`                | `@Body()`  | `DeleteUserDto`                | `admin/dto/delete-user.dto.ts`                   | admin                                       | 3    |
| 7   | `admin/admin.controller.ts:170`                          | `issueComplimentaryLicense` | `@Body()`  | `IssueComplimentaryLicenseDto` | `license/dto/issue-complimentary-license.dto.ts` | admin                                       | 3    |
| 7   | `admin/admin.controller.ts:217`                          | `inviteWaitlist`            | `@Body()`  | `InviteWaitlistDto`            | `admin/admin.dto.ts`                             | admin                                       | 3    |
| 7   | `admin/admin.controller.ts:259`                          | `list`                      | `@Query()` | `ListQueryDto`                 | `admin/admin.dto.ts`                             | admin                                       | 3    |
| 7   | `admin/admin.controller.ts:283`                          | `update`                    | `@Body()`  | `UpdateRecordDto`              | `admin/admin.dto.ts`                             | admin                                       | 3    |
| 8   | `marketing/controllers/admin-marketing.controller.ts:44` | `saveTemplate`              | `@Body()`  | `SaveTemplateDto`              | `marketing/dto/save-template.dto.ts`             | admin                                       | 3    |
| 8   | `marketing/controllers/admin-marketing.controller.ts:70` | `sendCampaign`              | `@Body()`  | `SendCampaignDto`              | `marketing/dto/send-campaign.dto.ts`             | admin                                       | 3    |
| 9   | `license/controllers/admin.controller.ts:60`             | `createLicense`             | `@Body()`  | `CreateLicenseDto`             | `license/dto/create-license.dto.ts`              | **`AdminApiKeyGuard`** (`x-api-key` header) | 3    |

16 DTO **files**; 20 payload params; 9 controllers.

### 2.2 Explicitly excluded

| Item                                                                                                                                                | Why                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marketing/controllers/resend-webhook.controller.ts:38` `@Body() payload: ResendWebhookPayload`                                                     | Webhook — locked decision. **And it is structurally impossible anyway**: `ResendWebhookPayload` is an `interface`, not a class (`marketing/dto/resend-webhook.dto.ts`), so it cannot be an `expectedType` (`Type<T>`). |
| `paddle/paddle.controller.ts`                                                                                                                       | **Has no `@Body()` at all** — it reads `req.rawBody` via `@Req()`. Nothing to bind. The handoff implies a Paddle DTO risk that does not exist.                                                                         |
| Named-primitive query params: `auth.controller.ts:246,247,478,858,859`; `discourse/discourse.controller.ts:48,49`; `events/events.controller.ts:78` | `@Query('code') code: string` binds a _string_, not a DTO. `dtoPipe` is meaningless here. See §6 non-goals.                                                                                                            |
| Already protected (TASK_2026_169)                                                                                                                   | `packs/dto/pack.dto.ts`, `member-groups/dto/member-group.dto.ts`, `discourse/dto/admin-community.dto.ts`, `google-sessions/dto/admin-session.dto.ts`                                                                   |
| Do-not-touch (TASK_2026_169 security invariant)                                                                                                     | `discourse/builders-membership.service.ts`, `discourse/community.controller.ts`, `google-sessions/members.controller.ts`                                                                                               |
| `marketing/controllers/public-marketing.controller.ts`                                                                                              | Read in full — `@Param()` only, no `@Body()`/`@Query()`. Correctly absent from the handoff.                                                                                                                            |

### 2.3 Where my reading contradicts the handoff — five corrections

The handoff is a previous session's write-up. These are stated with evidence so a reviewer can check
me rather than take my word:

1. **`contact/contact.controller.ts` is NOT public.** The handoff files it under
   "🔴 Tier 1 — unauthenticated / public". `contact.controller.ts:25` is `@UseGuards(JwtAuthGuard)`.
   → **Reclassified to Tier 2.**
2. **`license/controllers/license.controller.ts` IS public.** The handoff files it under
   "🟡 Tier 2 — authenticated but not admin". `license.controller.ts:34` has no guard, and its own
   docblock (line 80) says _"Authentication: None (public endpoint)"_.
   → **Reclassified to Tier 1**, and it is the single highest-exposure endpoint in this task (every
   installed extension calls it — `libs/backend/vscode-core/src/services/license/license-fetcher.ts`).
3. **`create-license.dto.ts` is on the wrong row.** The handoff lists it under
   `license/controllers/license.controller.ts` (Tier 2). It is actually used by
   `license/controllers/admin.controller.ts:60` (Tier 3, `AdminApiKeyGuard`).
4. **`issue-complimentary-license.dto.ts` is on the wrong row.** The handoff lists it under
   `license/controllers/admin.controller.ts`. It is actually used by `admin/admin.controller.ts:170`.
5. **`admin/admin.controller.ts` has six payload params, not two.** The handoff says
   "`admin.dto.ts`, `dto/delete-user.dto.ts`". It is `BulkEmailDto`, `InviteWaitlistDto`,
   `ListQueryDto`, `UpdateRecordDto`, `DeleteUserDto`, **and** `IssueComplimentaryLicenseDto`.
   This is the controller carrying F1.

Two smaller drifts, both in the folded-in item:

6. `jwt-auth.guard.ts` — the handoff cites line 66. The actual `catch (error: any)` is **line 57**
   and the raw-message interpolation is **lines 58-60**.
7. `license/controllers/admin.controller.ts:18` docblock says `X-API-Key`; `main.ts:55` advertises
   `X-Admin-API-Key` in CORS `allowedHeaders`; the guard reads `request.headers['x-api-key']`
   (`license/guards/admin-api-key.guard.ts:51`). The **guard is authoritative**; the CORS entry is
   dead. Cosmetic — fix the comment while in the file, do not change the guard.

---

## 3. Per-DTO risk assessment — the core deliverable

Method, per the handoff §"Method" and TASK_2026_169's `member-groups` precedent: read the decorators,
then trace the **actual payload literal** in the calling component (not the TypeScript interface).
Caller tracing was delegated to three CLI agents and **every literal below was re-verified by me
against the source file**.

Legend: **SAFE** = no-op for valid traffic · **BEHAVIOUR CHANGE** = some silently-working input now
400s (expected, recorded) · **RISK** = would reject legitimate current traffic.

> **Cross-cutting fact that makes most of this safe:** Angular `HttpClient` JSON-serializes bodies,
> and `JSON.stringify` **drops keys whose value is `undefined`**. Several callers write
> `foo: cond ? x : undefined`; those keys never reach the wire, so `@IsOptional()` behaves. Verified
> in every literal below.

---

### Tier 1 — public

#### 3.1 `JoinWaitlistDto` — **BEHAVIOUR CHANGE** (this is the handoff's own repro)

`email` `@IsEmail() @MaxLength(320)`; `source?` `@IsOptional() @IsString() @MaxLength(50)`.

Caller: `apps/ptah-landing-page/src/app/sections/builders/waitlist-form.component.ts:195-197` →
`{ email: trimmed, source: this.source() }`. Plain literal, no spread, `source` is a required
`input()` so always a concrete short string.

- Changes: `{"email":"not-an-email","bogusField":"x"}` goes 201 → **400**. That is the exact repro in
  the handoff and the whole point of the task.
- Residual: an **out-of-repo** caller (embed, ops script) tagging with a `source` longer than 50 chars
  would now 400. Settled by data check D5 (§4).

#### 3.2 `VerifyLicenseDto` — 🔴 **RISK (DATA-GATED)** + **BEHAVIOUR CHANGE**

`licenseKey` `@IsString() @Matches(/^ptah_lic_[a-f0-9]{64}$/)`.

Caller: `libs/backend/vscode-core/src/services/license/license-fetcher.ts:103-111` →
`axios.post('${url}/api/v1/licenses/verify', { licenseKey })`. Single shorthand property, no spread.
This is the **only** call shape across VS Code, Electron and CLI — all three funnel through
`LicenseService`/`LicenseFetcher`; no second implementation exists (grepped `apps/ptah-electron`,
`apps/ptah-cli`, `libs/`).

**The risk is not the caller, it is the key corpus.**
`license/services/license.service.ts:216` documents the parameter as
_"format: `ptah_lic_{64-hex}` **or `PTAH-XXXX-XXXX-XXXX`**"_. The generator
(`license.service.ts:354-362`) only ever produces the `ptah_lic_` form today, but the docblock asserts
a legacy format exists. **If one row in `licenses.license_key` is legacy, that user's extension gets a
400 instead of a licence verdict, on a public endpoint, in production.**

- **Gate:** data check D1 (§4) must return `0` before this batch may bind.
  - If `0` → bind as written, and **fix the stale docblock** at `license.service.ts:216` in the same
    commit (it is the thing that made this look dangerous).
  - If `> 0` → **do not weaken the regex to `@IsString()`**. Widen it to a union that matches the two
    _documented_ formats, or migrate the legacy rows. Both are "make the DTO match reality", not
    "weaken it to make a caller pass". Escalate the choice to the orchestrator.
- **Behaviour change even at zero legacy rows:** a malformed key currently returns a signed
  `{ valid: false, tier: 'expired', reason: 'not_found' }` (200). It will now return **400**.
  `LicenseFetcher` uses `axios`, which throws on 4xx → `FetchResult { ok: false, error }` → the
  caller falls back to the **cached** status rather than recording a clean "invalid licence". For a
  genuinely malformed key that is arguably better (it is a client bug, not a licence verdict), but it
  is a real semantic change on the extension's hot path and must be recorded, not discovered.

#### 3.3 `SignupDto` — **SAFE** (with a desirable behaviour change)

`email` `@IsEmail`; `password` `@IsString @MinLength(8)`; `firstName?`/`lastName?` optional strings.

Caller: `apps/ptah-landing-page/src/app/pages/auth/auth-page.component.ts:475` →
`this.authApi.signup({ email, password })`. `firstName`/`lastName` are **never sent at all**.
The form gates submit on `isStrongPasswordValid()` (`auth-form.component.ts:326-329`), so a <8-char
password cannot leave the UI.

- Newly enforced against **non-UI** callers only: short password → 400 instead of a WorkOS-side reject.

#### 3.4 `LoginDto` — **SAFE for known callers** (residual is out-of-repo)

`email` `@IsEmail`; `password` `@IsString @MinLength(8)`.

I initially flagged `@MinLength(8)` on a _login_ DTO as over-strict — a legacy account with a
<8-char password would get a 400 instead of a 401. **I checked, and it is not reachable:** the login
form's submit is gated by `isPasswordValid()` → `isValidPassword()` →
`password.length >= MIN_PASSWORD_LENGTH` where `MIN_PASSWORD_LENGTH = 8`
(`apps/ptah-landing-page/src/app/pages/auth/utils/auth-validation.utils.ts:57-58`,
`apps/ptah-landing-page/src/app/pages/auth/models/auth.types.ts:184`). Such a user is _already_ unable
to submit the web form. The DTO adds nothing new.

- Recorded residual: an out-of-repo scripted caller now gets 400 rather than 401. **UNVERIFIED** and
  unverifiable from this repo. No action; noted so it is not a surprise.

#### 3.5 `MagicLinkDto` — **SAFE**

`email` `@IsEmail`; `returnUrl?`/`plan?` `@IsOptional @IsString`.

Caller: `auth-page.component.ts:600-606` →
`{ email, returnUrl: returnUrl ?? undefined, plan: plan ?? undefined }`. The `undefined` branches are
dropped by `JSON.stringify`; the real absent-case body is `{"email":"…"}`.
The loose `@IsString()` is correct — `validateReturnUrl()` / `validatePlanKey()`
(`auth.controller.ts:427-428`) do the semantic work downstream and stay authoritative.

#### 3.6 `VerifyEmailDto` — **SAFE** (behaviour change)

`userId` `@IsString`; `code` `@IsString @Length(6,6)`.
Caller: `auth-page.component.ts:503-508` → `{ userId: this.pendingUserId(), code }`. Both always
present. `userId` is a WorkOS `user_…` id, so `@IsString()` (not `@IsUUID`) is right.

- Changes: a wrong-length code now 400s locally instead of round-tripping to WorkOS. Strictly better
  (it also stops burning the 10/min throttle budget on obvious garbage).

#### 3.7 `ResendVerificationDto` — **SAFE**

`userId` `@IsString`. Caller: `auth-page.component.ts:534-538` → `{ userId }`. Nothing to say.

---

### Tier 2 — authenticated

#### 3.8 `ContactMessageDto` — **SAFE** (exact client/server agreement)

`subject` `@MinLength(3) @MaxLength(200)`; `message` `@MinLength(10) @MaxLength(5000)`;
`category?` `@IsEnum(ContactCategory)`.

Caller: `apps/ptah-landing-page/src/app/pages/contact/components/contact-form.component.ts:178-182` →
`{ subject: this.subject, message: this.message, category: this.category }` (plain `public` string
fields with `[(ngModel)]`, **not** signals — so these are real strings on the wire, not functions).
The template caps them at exactly the server's numbers: `minlength="3" maxlength="200"` (line 74-75)
and `minlength="10" maxlength="5000"` (line 114-115), and `onSubmit()` re-checks 3/10 in TS (line 167).
The `<select>` options (lines 92-96) are `general|billing|technical|feature-request|other` —
**byte-identical to the `ContactCategory` enum**. Zero risk.

#### 3.9 `SessionRequestDto` — **SAFE**, one field to confirm

`sessionTopicId` `@IsString`; `additionalNotes?` `@MaxLength(2000)`; `paddleTransactionId?` `@IsString`.

Callers: `apps/ptah-landing-page/src/app/pages/sessions/components/sessions-grid.component.ts:173-177`
(free) and `:235-240` (paid) → `{ sessionTopicId, additionalNotes: notes || undefined,
paddleTransactionId? }`. `undefined` keys dropped. No spread.

- Confirm the notes textarea caps at ≤2000 during implementation; if it does not, existing rows settle
  it — data check D6 (§4).

#### 3.10 `ValidateCheckoutDto` — **SAFE**

`priceId` `@IsString`. Caller:
`apps/ptah-landing-page/src/app/services/paddle-checkout.service.ts:224-229` → `{ priceId }`, sourced
from a required `CheckoutOptions.priceId: string`. Single property. Nothing to break.

---

### Tier 3 — admin

#### 3.11 `UpdateRecordDto` — 🔴 **OVER-STRICT / CRITICAL — CONFIRMED, NOT SPECULATIVE**

```ts
// admin/admin.dto.ts:78-80
export class UpdateRecordDto {
  [key: string]: unknown;
}
```

Zero validation metadata. `dtoPipe` sets `whitelist: true, forbidNonWhitelisted: true`.
`ValidationExecutor.whitelist()` (quoted in §1) pushes
`property <key> should not exist` for **every** key with no grouped metadata — i.e. every key in the
body. Binding plain `dtoPipe(UpdateRecordDto)` **400s every non-empty PATCH**.

The DTO's own docblock (`admin.dto.ts:68-76`) says the opposite — _"we accept any shape here and rely
on `AdminService.filterEditable()`"_. That comment describes intended behaviour under a **working**
pipe and has never been executed, because the pipe has never run. It is wrong, and it is exactly the
kind of never-enforced intent the handoff predicts we would find.

**Callers that break** (all real, all verified):

- `apps/ptah-landing-page/src/app/pages/admin/admin-detail/admin-detail.ts:352-361` —
  `buildDirtyPatch()` builds `patch[f.key] = this.toApiValue(f, v)` in a loop. **Computed keys**, one
  per dirty editable field, across all 9 admin models.
- `apps/ptah-landing-page/src/app/pages/admin/failed-webhooks/webhooks-triage.ts:325-329` and `:363` —
  `{ resolved: true, resolvedAt: iso }`.

**Recommended resolution — bind a deliberately non-whitelisting pipe, do not weaken a real DTO.**
There is no real DTO here to weaken; the authoritative allowlist is
`AdminService.filterEditable()` against `ADMIN_MODELS[key].editableFields`. Add a sibling helper next
to `dtoPipe` in `apps/ptah-license-server/src/common/dto-validation.pipe.ts`:

```ts
/**
 * Transport-envelope variant of `dtoPipe` for handlers whose body shape is
 * genuinely dynamic and whose allowlist lives elsewhere in the server.
 *
 * ⚠️ ONLY legitimate use today: AdminController.update. `UpdateRecordDto` is an
 * index-signature class with NO class-validator metadata, and class-validator's
 * whitelist step rejects EVERY property of a zero-metadata class when
 * forbidNonWhitelisted is on (ValidationExecutor.whitelist()). The real
 * allowlist is AdminService.filterEditable() / ADMIN_MODELS[key].editableFields.
 *
 * Do NOT reach for this to silence a 400. If the DTO has decorators, use dtoPipe.
 */
export function passthroughDtoPipe<T>(expectedType: Type<T>): ValidationPipe {
  return new ValidationPipe({ expectedType, whitelist: false, forbidNonWhitelisted: false, transform: true });
}
```

It still carries `expectedType`, so the structural test's "a `ValidationPipe` with `expectedType` is
bound" assertion is satisfied honestly — the param _is_ explicitly bound, with a documented,
deliberate policy.

**Rejected alternative:** per-model update DTOs (9 classes mirroring `editableFields`). Correct in the
abstract, but it duplicates a single source of truth into nine places and is a feature-sized change
outside this task's remit. Record it in `future-enhancements.md` alongside Option B.

#### 3.12 `ListQueryDto` — **SAFE**, but the transform semantics genuinely change

`page?`/`pageSize?` `@Type(() => Number) @IsInt @Min(1)` (+ `@Max(100)` on `pageSize`);
`sortBy?` `@MaxLength(64)`; `sortOrder?` `@IsIn(['asc','desc'])`; `search?` `@MaxLength(256)`;
`filter?` `@MaxLength(128)`. Defaults declared inline (`page = 1`, `pageSize = 25`, `sortOrder = 'desc'`).

**This is the transform-dependent case the task brief asks to call out specifically.**
`apps/ptah-landing-page/src/app/services/admin-api.service.ts:380-386` sends everything through
`HttpParams`, explicitly `String(...)`-ing the numerics — so `page`/`pageSize` arrive as **strings**
today. And `AdminService.list` is **already silently coping**:

```ts
// admin/admin.service.ts:157-158
const page = Number(q.page ?? 1) || 1;
const pageSize = Number(q.pageSize ?? 25) || 25;
```

After the fix, `q.page` / `q.pageSize` become real numbers. `Number()` is idempotent, so the service
is unaffected — but the **runtime type of the DTO changes**, and `admin.service.spec.ts` fixtures that
pass strings may now be lying about production shape. Have the developer scan that spec.

Newly enforced caps, checked against every call site — all pass:
`admin-list.ts:126-132`, `webhooks-triage.ts:131-143`, `licenses-list.ts:117-123`,
`waitlist-pipeline.ts:176-182`, `issue-comp-license-modal.ts:100`, `user-profile.ts:169`,
`template-picker.ts:42` (`pageSize: 100` — exactly at `@Max(100)`, passes),
`admin-auth.guard.ts:33` (`{ pageSize: 1 }`), `marketing-hub.ts:200` (`RATE_WINDOW = 10`), `:232` (5),
`groups-list.ts:172` (25). `data-table.ts:102` offers `[10, 25, 50, 100]` — **the UI cannot exceed the
server cap.** Defaults now materialize where they previously stayed `undefined`; the service's own
defaults are identical, so no behaviour delta.

#### 3.13 `BulkEmailDto` — **SAFE, and zero blast radius**

`userIds` `@IsArray @ArrayMinSize(1) @ArrayMaxSize(500) @IsUUID('4',{each:true})`;
`subject` `@MaxLength(200)`; `html` `@MaxLength(50000)`.

`AdminApiService.bulkEmail()` exists (`admin-api.service.ts:432-440`) but **has no caller anywhere in
the repo** — `grep -rn "\.bulkEmail(" apps/ptah-landing-page/src/app` returns nothing. The admin UI's
"bulk email modal" (`bulk-email-modal.ts:122-133`) actually posts to `/marketing/send`.
`POST /api/v1/admin/users/bulk-email` is dead surface from the UI.

- The handoff's "a marketing send currently has no enforced ceiling" is true of `SendCampaignDto`
  (§3.16), not of this one. Depends on data check D2 only insofar as it shares `@IsUUID('4')`.

#### 3.14 `DeleteUserDto` — **SAFE** (cosmetic behaviour change)

`confirmEmail` `@IsEmail`; `acknowledgePaidSubscription?` `@IsBoolean`.
Caller: `apps/ptah-landing-page/src/app/pages/admin/components/delete-user-modal/delete-user-modal.ts:91-94`
→ `{ confirmEmail: this.typedEmail(), acknowledgePaidSubscription: this.acknowledgePaid() }` — a
signal-backed boolean, always a real boolean.

- Changes: an admin typing a non-email now gets `400 confirmEmail must be an email` instead of the
  service's own "does not match" refusal. Both refuse; the message differs.

#### 3.15 `IssueComplimentaryLicenseDto` — **BEHAVIOUR CHANGE** + one RISK edge

`userId?` `@IsUUID('4')`; `email?` `@IsEmail @MaxLength(320) @Transform(trim+lowercase)`;
`durationPreset` `@IsIn(PRESETS)` **+ the custom `IsExactlyOneRecipientIdentifier()` XOR rule**;
`customExpiresAt?` `@ValidateIf(preset==='custom') @IsISO8601`; `plan` `@IsIn(['builders'])`;
`reason` `@Length(1,500)`; `sendEmail?`/`stackOnTopOfPaid?` `@IsBoolean`.

**None of this has ever executed.** The bespoke XOR validator, the `@ValidateIf` gate, the
`@Transform` lowercase-and-trim — all inert. This is the single richest "intent that was never
enforced" find in the task. In particular the `@Transform` means the service has been receiving
**untrimmed, un-lowercased** emails and find-or-creating users from them; after the fix it receives
normalized ones. Worth a look at whether any duplicate-by-case user rows exist (data check D7).

Caller: `apps/ptah-landing-page/src/app/pages/admin/components/issue-comp-license-modal/issue-comp-license-modal.ts:203-221`.
**It uses a spread** — `{ ...target, durationPreset, customExpiresAt, plan, reason, sendEmail, stackOnTopOfPaid }`
— but `target` is `Pick<…,'userId'|'email'>` assigned from exactly three literal branches
(`{ userId: searchRecipient.id }` / `{ email: emailTarget }` / `{ userId: this.userId() }`), so the
spread can only ever contribute `userId` **or** `email`. No undeclared key can reach the wire.

- ⚠️ **RISK edge:** the third branch is `{ userId: this.userId() }`. If the modal is opened without a
  bound user and with no email typed, that is `{ userId: '' }` — which fails `@IsUUID('4')` **and**
  fails the XOR rule (empty string counts as absent → _neither_ identifier). Today it reaches the
  service. Verify the modal's submit guard forbids that state; **if it does not, fix the caller**
  (omit `userId` when empty) — the DTO is correct.

#### 3.16 `SendCampaignDto` — **BEHAVIOUR CHANGE** + one reachable RISK

`name` `@IsNotEmpty @Length(1,100)`; `templateId?` `@IsUUID()` (version `'all'`);
`subject?` `@Length(1,200)`; `htmlBody?` `@Length(1,50000)`;
`segment?` `@IsIn(['all','buildersActive','communityActive','subscriptionPastDue'])`;
`userIds?` `@IsUUID('4',{each:true}) @ArrayMaxSize(5000)`.

Three callers, all plain literals with `undefined` branches (dropped from the wire):

- `pages/admin/components/bulk-email-modal/bulk-email-modal.ts:122-133`
- `pages/admin/marketing/marketing-compose/marketing-compose.ts:294-299` (test-send)
- `pages/admin/marketing/marketing-compose/marketing-compose.ts:337-346` (real send)

- ⚠️ **RISK — reachable, with a confusing symptom.** `marketing-compose.ts:295` builds the test-send
  name as `` `${this.name()} (test)` `` — **+7 chars**. There is no client-side cap on `name`.
  An admin who types a 94-character campaign name gets: **real send succeeds, test send 400s.**
  Recommended resolution: cap the `name` input client-side at 93 characters (`maxlength="93"` plus the
  matching signal guard). **Do not raise `@Length(1,100)` to make the caller pass** — the caller is
  the thing that is wrong.
  `bulk-email-modal.ts:123` is `` `Bulk Email: ${subject.substring(0,80) || 'Untitled'}` `` = 12 + ≤80
  = ≤92 chars. Passes, but with 8 characters of headroom — call it out in the commit message.
- **Behaviour change (desirable):** `marketing-compose.ts` `parsedUserIds()` hand-parses pasted text
  with no format check. Malformed ids currently flow through; they now 400. Same class as
  TASK_2026_169's `assign-members` finding, and the same verdict: strictly better.
- **The unbounded-send concern is real and this closes it:** `@ArrayMaxSize(5000)` and the segment
  allowlist have never been enforced.
- Data checks D2 (`users.id` v4) and D3 (`marketing_campaign_templates.id` uuid) apply.

#### 3.17 `SaveTemplateDto` — **SAFE**, one UNVERIFIED

`name` `@IsNotEmpty @Length(1,100)`; `subject` `@IsNotEmpty @Length(1,200)`;
`htmlBody` `@IsNotEmpty @Length(1,50000)`; `variables?` `@IsString({each:true})`.
Caller: `pages/admin/marketing/template-create/template-create.ts:96-102` → all three trimmed,
`variables` omitted when empty.

- **UNVERIFIED:** whether the HTML editor can exceed 50 000 characters. Settled by data check D4
  (`max(length(html_body))` over existing templates). If an existing template already exceeds it, the
  _save_ path was never the constraint — the DTO is aspirational and needs a product decision, not a
  silent widening.

#### 3.18 `CreateLicenseDto` — **SAFE, zero blast radius**

`email` `@IsEmail`; `plan` `@IsIn(['community','builders'])`; `sendEmail?` `@IsBoolean`.
**No caller anywhere in the repo** — confirmed independently by two CLI traces plus my own grep. The
route is `AdminApiKeyGuard`-gated (`x-api-key`) ops/manual-curl surface. Binding here is pure upside.

---

### 3.19 Summary table

| DTO                                                                                                                                                                             | Class                            | Notes                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------- |
| `UpdateRecordDto`                                                                                                                                                               | 🔴 **OVER-STRICT (confirmed)**   | Breaks all admin edits → use `passthroughDtoPipe`                                       |
| `VerifyLicenseDto`                                                                                                                                                              | 🔴 **RISK (data-gated)**         | Legacy key format; SQL D1 gates the batch                                               |
| `SendCampaignDto`                                                                                                                                                               | 🟠 **RISK (reachable)** + change | `name + " (test)"` overflow → cap the caller at 93                                      |
| `IssueComplimentaryLicenseDto`                                                                                                                                                  | 🟠 change + edge                 | XOR/ValidateIf/Transform never ran; `{userId:''}` edge                                  |
| `JoinWaitlistDto`                                                                                                                                                               | 🟡 change                        | The handoff's own repro; out-of-repo `source` residual                                  |
| `SignupDto`, `VerifyEmailDto`, `DeleteUserDto`, `InviteWaitlistDto`                                                                                                             | 🟡 change                        | All desirable, all UI-unreachable                                                       |
| `LoginDto`                                                                                                                                                                      | 🟢 SAFE                          | Checked, not assumed — client already enforces ≥8                                       |
| `MagicLinkDto`, `ResendVerificationDto`, `ContactMessageDto`, `SessionRequestDto`, `ValidateCheckoutDto`, `ListQueryDto`, `BulkEmailDto`, `SaveTemplateDto`, `CreateLicenseDto` | 🟢 SAFE                          | `ListQueryDto` changes runtime types; `BulkEmailDto`/`CreateLicenseDto` have no callers |

#### `InviteWaitlistDto` (completing the list) — **SAFE** + change

`ids?` `@ArrayMaxSize(1000) @IsString({each:true}) @MaxLength(64,{each:true})`;
`batchSize?` `@Type(()=>Number) @IsInt @Min(1) @Max(1000)`.
Caller: `pages/admin/components/waitlist-invite-modal/waitlist-invite-modal.ts:90-93` →
`{ ids: [...] }` **or** `{ batchSize: n }`, and `canSubmit()` (line 54-58) already guarantees
`Number.isInteger(batchSize) && batchSize > 0`. `batchSize` is sent as a real JSON number, so
`@Type(()=>Number)` is a no-op. Newly enforced: `@Max(1000)` — there is no client cap, so a
hand-typed 5000 now 400s. Desirable.

---

## 4. Data-reality checks — run these BEFORE the batches they gate

Run via the same mechanism `scripts/community-gate-smoke.mjs` uses:

```bash
docker exec -i ptah_postgres psql -U ptah -d ptah_db -tAc "<SQL>"
```

Column names below are taken from `apps/ptah-license-server/prisma/schema.prisma` (`@map` values), not
guessed.

| ID     | Gates                                                                  | SQL                                                                                                                                                                                                | Pass condition                                                                                                                      |
| ------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | 🔴 **B2 (`VerifyLicenseDto`)** — blocking                              | `SELECT count(*) FROM licenses WHERE license_key !~ '^ptah_lic_[a-f0-9]{64}$';` <br> if `>0`: `SELECT left(license_key, 20) FROM licenses WHERE license_key !~ '^ptah_lic_[a-f0-9]{64}$' LIMIT 5;` | `0`. Otherwise **stop and escalate** — do not bind, do not weaken.                                                                  |
| **D2** | B7 (`BulkEmailDto`), B8 (`SendCampaignDto`)                            | `SELECT count(*) FROM users WHERE substring(id::text,15,1) <> '4';`                                                                                                                                | `0` (all `@IsUUID('4')` targets are genuinely v4). TASK_2026_169 checked 3 rows; this counts all.                                   |
| **D3** | B8 (`SendCampaignDto.templateId`)                                      | `SELECT count(*) FROM marketing_campaign_templates WHERE id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';`                                                            | `0` (column is `@db.Uuid`, so this should be structurally impossible — cheap confirmation).                                         |
| **D4** | B8 (`SaveTemplateDto.htmlBody`)                                        | `SELECT coalesce(max(length(html_body)),0) FROM marketing_campaign_templates;`                                                                                                                     | `≤ 50000`. If exceeded, the 50k cap is aspirational → product decision, not a silent widen.                                         |
| **D5** | B1 (`JoinWaitlistDto.source`)                                          | `SELECT coalesce(max(length(source)),0) FROM waitlist;`                                                                                                                                            | `≤ 50`. Catches an out-of-repo caller tagging with a long source.                                                                   |
| **D6** | B5 (`SessionRequestDto.additionalNotes`)                               | `SELECT coalesce(max(length(additional_notes)),0) FROM session_requests;`                                                                                                                          | `≤ 2000`.                                                                                                                           |
| **D7** | B7 (`IssueComplimentaryLicenseDto.email` `@Transform`) — informational | `SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;`                                                                                                                         | Empty. Non-empty means the un-normalized email path already created case-duplicate users — a real finding to report, not a blocker. |

Record the actual output of every check in the implementation report. "I ran it and it was fine" is
not evidence; the number is.

---

## 5. Component specifications

### C1 — `passthroughDtoPipe` helper (new)

**File:** `apps/ptah-license-server/src/common/dto-validation.pipe.ts` (MODIFY)
**Purpose:** bind an explicit `expectedType` **without** whitelisting, for handlers whose body shape is
genuinely dynamic and whose allowlist lives elsewhere.
**Pattern evidence:** sibling of the existing `dtoPipe` (`dto-validation.pipe.ts:49-56`); the same
`expectedType` mechanism verified at `validation.pipe.js` `transform()`.
**Quality requirements:** exactly one legitimate consumer today (`AdminController.update`); the
docblock must state the mechanism (`ValidationExecutor.whitelist()` rejects zero-metadata classes) and
forbid its use as a 400-silencer. Also **update `dtoPipe`'s own docblock** — its "SCOPE: TASK_2026_169
endpoints only" paragraph (lines 37-47) becomes stale the moment this task lands.

### C2 — Generalized structural test (new) + G7 removal

See §7. **File:** `apps/ptah-license-server/src/common/controller-validation.spec.ts` (CREATE);
`apps/ptah-license-server/src/admin/admin-guards.spec.ts` (MODIFY — remove G7, keep G1/G3/G4/G5/G6).

### C3 — Nine controller bindings

Mechanical: `@Body() x: T` → `@Body(dtoPipe(T)) x: T`; `@Query() q: T` → `@Query(dtoPipe(T)) q: T`.
One exception: `AdminController.update` uses `passthroughDtoPipe(UpdateRecordDto)` (F1).
Each controller gains a short class docblock mirroring `member-groups.controller.ts:60-64`, which is
the established in-repo precedent for this warning.

### C4 — `jwt-auth.guard.ts` hardening (folded-in)

**File:** `apps/ptah-license-server/src/app/auth/guards/jwt-auth.guard.ts` (MODIFY)
**Current (lines 57-60):**

```ts
} catch (error: any) {
  throw new UnauthorizedException(`Authentication failed: ${error.message}`);
}
```

**Required:** `catch (error: unknown)`, narrow via `instanceof Error`, **log** the narrowed message via
the existing logging convention, and return a **fixed, non-revealing** 401 message to the client
(e.g. `'Authentication failed. Please login again.'`). The raw `error.message` here comes from JWT
verification and leaks token-shape/expiry internals. Per `CLAUDE.md`: _"Never expose raw
`error.message` to clients."_
`jwt-auth.guard.spec.ts` exists and will need its assertion on the 401 message updated — that is the
correct place for the change to show up.

### C5 — `main.ts` docblock (no behaviour change)

**File:** `apps/ptah-license-server/src/main.ts` (MODIFY) — a comment at lines 41-47 explaining that
the global pipe is inert under esbuild, that `dtoPipe` is the live mechanism, and that the global pipe
is retained deliberately as the safety net for a future Option B.

### C6 — `future-enhancements.md` (Option B record)

**File:** `.ptah/specs/TASK_2026_170/future-enhancements.md` (CREATE) — Option B (esbuild
`emitDecoratorMetadata` plugin) with the §1 evidence, plus the rejected "per-model admin update DTOs"
alternative from §3.11.

---

## 6. Explicit non-goals

1. **Option B is not implemented.** Locked decision. Recorded in `future-enhancements.md` only. It
   remains the _right_ end state — and Option A is its prerequisite, because Option A is what forces
   someone to read all 16 DTO files. This plan is that reading.
2. **Webhooks are excluded.** `/webhooks/paddle` and `/webhooks/resend`. Recorded three ways so it
   reads as deliberate: (a) a comment on `ResendWebhookController.handle`'s `@Body()` param stating
   the exclusion and its reason; (b) an entry in the structural test's `EXCLUDED` list carrying the
   same rationale as a string; (c) this section. Reinforcing evidence found while verifying:
   `ResendWebhookPayload` is an **interface**, so it is not a valid `expectedType` at all, and
   `PaddleController` has **no `@Body()`**. The exclusion costs nothing.
3. **Named-primitive query params are out of scope.** `@Query('code') code: string` (and `sso`, `sig`,
   `ticket`, `token`, `returnUrl`, `plan`) bind strings, not DTOs; `dtoPipe` does not apply. Each has
   a downstream check already (`validateReturnUrl`/`validatePlanKey` in `auth.controller.ts`, HMAC
   verification in `discourse.controller.ts`, ticket verification in `events.controller.ts`).
   Hardening them with `ParseUUIDPipe`/`@IsString` wrappers is a separate, smaller task — noted in
   `future-enhancements.md`.
4. **No DTO is weakened to make a caller pass.** Where the caller is wrong (§3.16 `name` overflow,
   §3.15 `{userId:''}`), **the caller is fixed**. The only place a _constraint_ may move is §3.2, and
   only if D1 proves the constraint contradicts documented reality — that is correcting the DTO, not
   weakening it, and it requires escalation first.
5. **Protected files untouched:** `discourse/builders-membership.service.ts`,
   `discourse/community.controller.ts`, `google-sessions/members.controller.ts`. Already-protected
   DTOs not re-done.
6. **No new tests beyond the structural spec + the `jwt-auth.guard.spec.ts` update.** Per-DTO unit
   tests would be nice; the structural test plus the live curl matrix is the proportionate gate, and
   TASK_2026_169 set that precedent.

---

## 7. G7 extension plan — G7 does not generalize; restructure it

**The task brief's suspicion is correct, and there are two independent reasons, not one.**

**Reason 1 — the filename and the framing.** The spec is `src/admin/admin-guards.spec.ts`, top-level
describe _"Admin surface — structural guards"_, sitting next to `admin.guard.ts` and `admin.module.ts`.
Adding `WaitlistController`, `AuthController`, `ContactController`, `SessionController`,
`SubscriptionController` and `LicenseController` to it files six non-admin, mostly-public controllers
under an admin heading. The next contributor looking for "why does my public endpoint's test fail"
will not look there.

**Reason 2 — and this one is a correctness bug, not taste.** `paramBindings()`
(`admin-guards.spec.ts:61-96`) enumerates **every** `@Body()`/`@Query()` param and demands each bind an
`expectedType`. It has no way to tell `@Query()` (whole object → DTO) from `@Query('code')` (named
primitive → string). `AuthController` has **five** named-primitive query params
(`auth.controller.ts:246, 247, 478, 858, 859`). Adding `AuthController` to today's G7 produces five
**false failures** for params that can never legitimately bind a DTO. The discriminator exists —
Nest's route-args metadata value is `{ index, data, pipes }` and `data` holds the key name for a named
param, `undefined` for a whole-object bind (verified at
`node_modules/@nestjs/common/decorators/http/route-params.decorator.js:15-20`) — but today's
implementation ignores it.

### The restructure

**Create `apps/ptah-license-server/src/common/controller-validation.spec.ts`.** Move G7 there and
**delete it from `admin-guards.spec.ts`** (G1/G3/G4/G5/G6 stay — they are genuinely admin-specific).
`src/common/` is the right home: it is where `dto-validation.pipe.ts` already lives, so the guard sits
beside the mechanism it guards.

The new spec has four parts:

1. **A named-primitive carve-out.** Skip params where `data !== undefined`, with the reason in a
   comment. Then **assert the carve-out's size** — e.g. exactly 8 named-primitive params exist across
   the server today. If a contributor adds a ninth, the test fails and they must consciously accept
   it. The carve-out cannot silently grow.

2. **Full-surface coverage with a shrinking debt ledger.** Enumerate _every_ controller in the server
   (an explicit `ALL_CONTROLLERS` import list — deliberately not module-graph reflection, which would
   drag `AppModule` and its Prisma `onModuleInit` into a spec that must stay infra-free; that is the
   same reasoning TASK_2026_169 used for G3, see its report §6(d)). Assert every whole-object payload
   param binds `expectedType`, **except** those on controllers named in:

   ```ts
   /**
    * Controllers whose payload params are not yet bound. This list only ever
    * SHRINKS. TASK_2026_170 empties it, one controller per commit.
    */
   const UNVALIDATED_DEBT: string[] = [
     /* the 9 in-scope controllers */
   ];
   ```

   **The ledger cannot rot in either direction**, because a second assertion checks it is not stale:
   for every name in `UNVALIDATED_DEBT`, assert that controller **still has at least one unbound
   param**. Consequences:
   - Remove a name without doing the work → the main assertion fails.
   - Do the work without removing the name → the staleness assertion fails.
   - Add a new controller with a bare `@Body()` → not in the ledger → the main assertion fails.

   This is strictly stronger than today's opt-in list, which is silent about every controller nobody
   remembered to add.

3. **The webhook exclusion, expressed as data.**

   ```ts
   const EXCLUDED: Array<{ controller: string; reason: string }> = [{ controller: 'ResendWebhookController', reason: 'TASK_2026_170 locked decision: third-party payload shapes change without notice; ' + 'forbidNonWhitelisted would 400 valid webhooks the first time Resend adds a field. ' + 'ResendWebhookPayload is also an interface, not a class, so it cannot be an expectedType.' }];
   ```

   Asserted, not just commented: each excluded controller must still **exist** and still have an
   unbound param (so the exclusion cannot outlive its subject), and `EXCLUDED` and `UNVALIDATED_DEBT`
   must be disjoint (so a controller cannot hide in both). `PaddleController` is deliberately **not**
   listed — it has no payload param, so listing it would be a lie the staleness check would catch.

4. **The anti-vacuity guard, strengthened.** Today's version asserts a per-controller minimum param
   count (`admin-guards.spec.ts:264-271`) — a hand-maintained number per controller, which does not
   scale to 13+ controllers. Replace it with a **server-wide floor**: the enumerator must discover at
   least N payload params in total (N = today's actual count, stated as a literal with a comment
   explaining it is a floor, not a target). If Nest's metadata key format changes underneath us, the
   count collapses to 0 and the floor fails loudly. One number, one place, meaningful at any list size.

**Falsification is mandatory.** As TASK_2026_169 did for G7 (its report, "Proof it actually fails"),
the developer must temporarily revert one binding, capture the failing output showing the offending
handler is **named**, restore it, and paste both in the report. A structural test that has not been
seen to fail is not evidence.

**Sequencing:** the restructure is **B0** — it lands first, with all nine controllers in the ledger, so
the suite is green from the outset and each subsequent batch's diff is one line removed.

---

## 8. Batching plan for the team-leader

**Ordering principle: Tier 1 first — that is the live, unauthenticated exposure.** One commit per
controller. Every batch is file-disjoint **except** for one line in
`src/common/controller-validation.spec.ts` (its ledger entry). That is a deliberate, trivial
serialization point: each batch deletes exactly its own line, so a rebase conflict is resolved by
keeping both deletions.

| Batch  | Controllers / files                                                                                                                                                                                | Parallel with siblings?              | Executor                                               | Justification                                                                                                                                                                                                    |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B0** | `common/dto-validation.pipe.ts` (+`passthroughDtoPipe`), `common/controller-validation.spec.ts` (CREATE), `admin/admin-guards.spec.ts` (remove G7), `main.ts` (docblock), `future-enhancements.md` | **No — must land first**             | **sub-agent** (`backend-developer`)                    | Requires reading Nest metadata semantics correctly and proving the test fails. Not delegable.                                                                                                                    |
| —      | **Data checks D1–D7**                                                                                                                                                                              | Run concurrently with B0             | orchestrator / sub-agent                               | **D1 blocks B2.** Cheap; do them while B0 is in flight.                                                                                                                                                          |
| **B1** | `waitlist/waitlist.controller.ts`                                                                                                                                                                  | ✅ with B2, B3                       | **CLI agent** + sub-agent review                       | One param, one DTO, SAFE, caller verified. Textbook delegation.                                                                                                                                                  |
| **B2** | `license/controllers/license.controller.ts` (+ docblock fix at `license.service.ts:216`)                                                                                                           | ✅ with B1, B3 — **but gated on D1** | **sub-agent**                                          | 🔴 Highest-exposure endpoint in the task; the binding decision depends on a data outcome and may require escalation. Judgement, not typing.                                                                      |
| **B3** | `app/auth/auth.controller.ts` (5 DTOs) + `app/auth/guards/jwt-auth.guard.ts` + `jwt-auth.guard.spec.ts`                                                                                            | ✅ with B1, B2                       | **sub-agent**                                          | Five params plus a security fix that changes a 401 body and an existing spec. Public auth surface.                                                                                                               |
| **B4** | `contact/contact.controller.ts`                                                                                                                                                                    | ✅ with B5, B6                       | **CLI agent** + review                                 | One param; client/server constraints verified byte-identical. Lowest risk in the task.                                                                                                                           |
| **B5** | `session/session.controller.ts`                                                                                                                                                                    | ✅ with B4, B6                       | **CLI agent** + review                                 | One param, SAFE, D6 already run.                                                                                                                                                                                 |
| **B6** | `subscription/subscription.controller.ts`                                                                                                                                                          | ✅ with B4, B5                       | **CLI agent** + review                                 | One param, single string field.                                                                                                                                                                                  |
| **B7** | `admin/admin.controller.ts` (6 params, incl. F1)                                                                                                                                                   | ✅ with B8, B9                       | **sub-agent**                                          | 🔴 Carries F1. Must use `passthroughDtoPipe` for `update`, must correct the wrong `UpdateRecordDto` docblock, must check `admin.service.spec.ts` fixtures for string-vs-number drift. Highest judgement density. |
| **B8** | `marketing/controllers/admin-marketing.controller.ts` **+** the caller fix in `pages/admin/marketing/marketing-compose/marketing-compose.ts` (cap `name` at 93)                                    | ✅ with B7, B9                       | **sub-agent** (`backend-developer` + a frontend touch) | Spans backend and landing page; involves fixing a caller rather than the DTO.                                                                                                                                    |
| **B9** | `license/controllers/admin.controller.ts` (+ `X-API-Key` comment fix)                                                                                                                              | ✅ with B7, B8                       | **CLI agent** + review                                 | Zero blast radius (no caller).                                                                                                                                                                                   |

**Concurrency ceiling: 3 CLI agents.** B1/B4/B5/B6/B9 are the five CLI-eligible batches; run them at
most three at a time. **CLI agents must not commit** — a sub-agent or the orchestrator reviews the diff
against the source and commits.

**CLI agent prompt template** (each must be fully self-contained — CLI agents share no context):
absolute Windows paths; the exact `@Body(dtoPipe(X)) `/`@Query(dtoPipe(X)) ` edit; the import line to
add (`import { dtoPipe } from '<relative>/common/dto-validation.pipe';`); the class-docblock text to
copy from `member-groups.controller.ts:60-64`; the one ledger line to delete from
`controller-validation.spec.ts`; "do not touch the DTO file"; "do not commit"; and "output the diff".

**Suggested wall-clock shape:** B0 (+ data checks) → {B1, B2, B3} → {B4, B5, B6} → {B7, B8, B9}.
The tier boundaries are hard gates: do not start Tier 2 until Tier 1 is committed and its curl matrix
is green, because Tier 1 is the exposure this task exists to close.

---

## 9. Per-controller verification recipe

### 9.1 Environment

```bash
npm run docker:up                      # postgres + license-server :3000 (+ Discourse :3001)
bash scripts/discourse-dev-up.sh       # only if :3001 refuses connections — Rails does not survive a restart
```

### 9.2 Minting a `ptah_auth` cookie (mirrors `scripts/community-gate-smoke.mjs:40-45`)

```js
import { createHmac } from 'node:crypto';
const b64url = (s) => Buffer.from(s).toString('base64url');
const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const now = Math.floor(Date.now() / 1000);
const p = b64url(
  JSON.stringify({
    sub: '<uuid>',
    email: 'abdallah@miramarstaffing.com', // must be in dev ADMIN_EMAILS
    tenantId: 'user_<uuid>',
    roles: ['user'],
    permissions: ['read:docs'],
    tier: 'community',
    iat: now,
    exp: now + 600,
  }),
);
const s = createHmac('sha256', process.env.JWT_SECRET).update(`${h}.${p}`).digest('base64url');
const cookie = `ptah_auth=${h}.${p}.${s}`;
```

`JWT_SECRET` is read from `.env` the way that script does. **Never hard-code it in a committed file.**
For B9 use the `x-api-key: $ADMIN_SECRET` header instead — that controller uses `AdminApiKeyGuard`
(`admin-api-key.guard.ts:51`), **not** the cookie.

### 9.3 The curl matrix — both directions, every controller

For each param, four cases. A batch is not done until all four are demonstrated:

| Case                                                                                             | Expect                                                                     | Why it matters                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Valid payload — the exact literal the real caller sends**                                   | unchanged status (200/201/…)                                               | Proves nothing regressed. Copy the literal from §3, do not invent one.                                                                                                                                                          |
| **B. Constraint violation** (bad email / short code / oversize array / out-of-range number)      | **400**, with the DTO's message                                            | Proves validation is live.                                                                                                                                                                                                      |
| **C. Unknown field** — add `"bogusField":"x"` to case A                                          | **400** `property bogusField should not exist`                             | Proves `forbidNonWhitelisted` is live. **Exception: `AdminController.update` must still return 200** — that is `passthroughDtoPipe` working as designed, and it is the assertion that proves F1 was handled rather than missed. |
| **D. Transform** (only where `@Type(() => Number)` exists — `ListQueryDto`, `InviteWaitlistDto`) | numeric string coerced; `pageSize=101` → **400**, `pageSize=100` → **200** | Proves transform runs, and that the cap the UI respects is now actually enforced.                                                                                                                                               |

Worked example (Tier 1, the handoff's own repro):

```bash
# A
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/v1/waitlist \
     -H 'Content-Type: application/json' -d '{"email":"real@example.com","source":"landing"}'   # 201
# B
curl -s -X POST localhost:3000/api/v1/waitlist -H 'Content-Type: application/json' \
     -d '{"email":"not-an-email"}'                                                              # 400
# C
curl -s -X POST localhost:3000/api/v1/waitlist -H 'Content-Type: application/json' \
     -d '{"email":"real2@example.com","bogusField":"x"}'                                        # 400
```

Auth endpoints live at **`/api/auth/...`** — `auth.controller.ts:89` is `@Controller('auth')` with no
`v1` segment, and login is `POST /api/auth/login/email` (`auth.controller.ts:602`), **not**
`/api/v1/auth/login`. Getting this wrong means testing a 404 and declaring victory.

**Clean up test rows.** TASK_2026_169's report closes with a test-data cleanup section; match it —
delete probe waitlist rows, users, and templates, and state the post-state in the report.

### 9.4 Gates that must stay green (every batch)

```bash
npx nx test ptah-license-server --skip-nx-cache        # 617 green at handoff; expect a delta from the new spec
npx eslint apps/ptah-license-server/src/<touched>      # note: the lint target is ptah-license-server:eslint:lint, not `nx lint`
npx tsc -p apps/ptah-license-server/tsconfig.app.json  --noEmit
npx tsc -p apps/ptah-license-server/tsconfig.spec.json --noEmit
node scripts/community-gate-smoke.mjs                  # must exit 0
node scripts/discourse-e2e.mjs                         # must exit 0
```

`scripts/google-calendar-write-smoke.mjs` is unaffected (no in-scope controller) but is cheap
insurance on any batch that touches `src/common/`. Seven pre-existing lint errors are documented in
TASK_2026_169's report §4.1 — none in files this task touches; do not fix them here.

---

## 10. Rollback story

**Why commit-per-controller is the whole safety design.** Every batch touches exactly one controller
file plus one ledger line. `git revert <sha>` on any single commit:

- restores that controller's bare `@Body()`/`@Query()` — i.e. restores the _current_ production
  behaviour for that endpoint and nothing else;
- restores its ledger line, so the structural test goes green again rather than failing on a
  now-unbound controller;
- leaves every other controller's fix in place.

There is no shared runtime state between batches. `dtoPipe`/`passthroughDtoPipe` are pure factories;
binding one param cannot affect another. The only ordering constraint is that **B0 must not be
reverted while any later batch is live** — reverting B0 would delete the ledger the later commits
edited. If B0 itself must go, revert the whole task.

**If a behaviour change breaks a real caller in production:**

1. **Revert that one controller's commit.** Minutes, one file, no build-system risk. Do this first —
   diagnose second.
2. **Classify the break** using §3's taxonomy. Is the caller legitimate?
   - **Caller is wrong** (malformed payload that was silently tolerated) → fix the caller, re-land the
     same commit. This is the expected case and the point of the task.
   - **DTO contradicts documented reality** (the §3.2 legacy-key shape) → correct the DTO to match
     reality, with evidence, and re-land. Not a silent widening — the evidence goes in the report.
   - **DTO is right and the caller is a third party we do not control** → that is a product decision,
     not an engineering one. Escalate.
3. **Add a data check.** Every break of this class should have been catchable by a §4-style query.
   Add the query that would have caught it, so the next rollout is stronger than this one.

**Option B is the reason this discipline matters.** The day someone lands the esbuild plugin, all 16
DTO files start enforcing at once. This task's per-controller commits and recorded findings are the
regression baseline that makes that day survivable.

---

## 11. Team-leader handoff

**Recommended developer:** `backend-developer` for B0, B2, B3, B7, B9; **`backend-developer` + a small
frontend touch** for B8 (`marketing-compose.ts` `name` cap); **CLI agents** for B1, B4, B5, B6, B9
under sub-agent review. No `frontend-developer` batch is needed — the two caller fixes (§3.15, §3.16)
are a `maxlength` attribute and a guard condition.

**Complexity: MEDIUM-HIGH. Estimated 10–16 hours.**

- B0 (helper + spec restructure + falsification proof): 2–3h
- Data checks D1–D7: 0.5h
- Tier 1 (B1–B3): 3–4h — B3 carries five params plus the guard fix
- Tier 2 (B4–B6): 1–2h — genuinely mechanical
- Tier 3 (B7–B9): 3–5h — B7 carries F1, B8 spans two apps
- Curl matrices + report + cleanup: 1.5h

**Files affected**

CREATE (2):

- `apps/ptah-license-server/src/common/controller-validation.spec.ts`
- `.ptah/specs/TASK_2026_170/future-enhancements.md`

MODIFY — backend (13):

- `apps/ptah-license-server/src/common/dto-validation.pipe.ts`
- `apps/ptah-license-server/src/admin/admin-guards.spec.ts` (remove G7)
- `apps/ptah-license-server/src/main.ts` (docblock only)
- `apps/ptah-license-server/src/waitlist/waitlist.controller.ts`
- `apps/ptah-license-server/src/license/controllers/license.controller.ts`
- `apps/ptah-license-server/src/license/services/license.service.ts` (stale docblock, line 216)
- `apps/ptah-license-server/src/app/auth/auth.controller.ts`
- `apps/ptah-license-server/src/app/auth/guards/jwt-auth.guard.ts`
- `apps/ptah-license-server/src/app/auth/guards/jwt-auth.guard.spec.ts`
- `apps/ptah-license-server/src/contact/contact.controller.ts`
- `apps/ptah-license-server/src/session/session.controller.ts`
- `apps/ptah-license-server/src/subscription/subscription.controller.ts`
- `apps/ptah-license-server/src/admin/admin.controller.ts`
- `apps/ptah-license-server/src/admin/admin.dto.ts` (correct the wrong `UpdateRecordDto` docblock)
- `apps/ptah-license-server/src/marketing/controllers/admin-marketing.controller.ts`
- `apps/ptah-license-server/src/license/controllers/admin.controller.ts`
- `apps/ptah-license-server/src/marketing/controllers/resend-webhook.controller.ts` (exclusion comment only)

MODIFY — landing page (1, caller fixes):

- `apps/ptah-landing-page/src/app/pages/admin/marketing/marketing-compose/marketing-compose.ts`
- (conditional, pending §3.15 check) `apps/ptah-landing-page/src/app/pages/admin/components/issue-comp-license-modal/issue-comp-license-modal.ts`

REWRITE: none. No parallel implementations, no compatibility layers, no versioned DTOs.

### Critical verification points the developer must confirm before writing code

1. **`dtoPipe` is imported from `../common/dto-validation.pipe`** (path depth varies by controller:
   `../common/…` from `waitlist/`, `../../common/…` from `license/controllers/` and
   `marketing/controllers/`, `../../../common/…` from `app/auth/`).
2. **`passthroughDtoPipe` is used at `admin.controller.ts:283` and nowhere else.** If a second use
   appears, it is a 400 being silenced — reject it.
3. **D1 returned `0`** before `license.controller.ts` is touched.
4. **The structural test has been seen to fail** (falsification output pasted in the report).
5. **Auth routes are `/api/auth/*`, not `/api/v1/auth/*`**, and login is `/api/auth/login/email`.
6. **No `catch (error: any)` remains** in any touched file; no raw `error.message` reaches a client.
7. **No webhook body is logged**, anywhere, ever.

### Findings that must appear verbatim in the implementation report

F1 (`UpdateRecordDto`), F2 (legacy licence-key format + D1's actual number), F3 (G7 restructure +
falsification proof), the §3.16 `name`-overflow caller fix, the §3.15 `{userId:''}` edge, the
never-enforced XOR/`@ValidateIf`/`@Transform` on `IssueComplimentaryLicenseDto`, the dead
`bulkEmail`/`createLicense` surfaces, and every §2.3 correction to the handoff. Each is a finding, not
a footnote.

---

## 12. Architecture delivery checklist

- [x] All 9 in-scope controllers and 16 DTO files inventoried against source, not the handoff
- [x] Handoff corrected in 7 places, each with file:line evidence
- [x] Every in-scope DTO classified SAFE / BEHAVIOUR CHANGE / RISK with the caller literal traced
- [x] Frontend payload **literals** traced (not interfaces), spreads and computed keys flagged
- [x] Transform-dependent params called out, with the downstream code that is currently coping
- [x] Data-reality checks specified as runnable SQL against real column names, each mapped to a batch
- [x] Batches tier-ordered, file-disjoint, with executor + justification and a stated ceiling of 3 CLI agents
- [x] G7 restructure specified concretely (with the metadata-shape bug that forces it)
- [x] Webhook exclusion recorded three ways, with the interface-vs-class reinforcement
- [x] Curl matrix shape + cookie minting + `x-api-key` variant specified
- [x] Rollback story tied to commit-per-controller
- [x] Non-goals explicit; Option B deferred; no DTO weakened to accommodate a caller
- [x] No step-by-step task decomposition — that is the team-leader's job
