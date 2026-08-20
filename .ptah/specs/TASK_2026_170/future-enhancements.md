# TASK_2026_170 — Future Enhancements

Deferred work recorded during TASK_2026_170 ("make `class-validator` actually run on every endpoint in
`ptah-license-server`"). Nothing here is in scope for that task; each item is written so it can be
picked up cold.

Source of the analysis: `implementation-plan.md` §1, §3.11, §6.3.

---

## 1. Option B — an esbuild plugin that emits `design:paramtypes`

**Status:** deferred, deliberately. **Prerequisite:** TASK_2026_170 (Option A) — see "Why Option A
first" below.

### The defect Option B would fix at the root

`main.ts` registers a global
`new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`, and every DTO
in the server carries `class-validator` decorators. **None of it runs.** Verified live against
pre-existing endpoints:

```
POST /api/v1/admin/groups  { "key": "INVALID KEY WITH SPACES!!" }  ->  201
POST /api/v1/admin/groups  { "bogusField": "x" }                   ->  201
```

Both should be rejected by `CreateMemberGroupDto`.

**Mechanism, re-verified against installed source rather than taken on faith:**

- `node_modules/@nestjs/common/pipes/validation.pipe.js` — `transform()`:
  ```js
  if (this.expectedType) {
    metadata = { ...metadata, metatype: this.expectedType };
  }
  const metatype = metadata.metatype;
  if (!metatype || !this.toValidate(metadata)) {
    return this.isTransformEnabled ? this.transformPrimitive(value, metadata) : value;
  }
  ```
  Nest resolves a handler parameter's DTO class from the `design:paramtypes` metadata emitted by
  TypeScript's `emitDecoratorMetadata`. `apps/ptah-license-server/tsconfig.app.json` sets
  `emitDecoratorMetadata: true`, but the app is bundled by `@nx/esbuild`, and **esbuild does not
  implement `emitDecoratorMetadata`**. Without it `metadata.metatype` is `undefined` and the pipe
  short-circuits before validating anything.
- Note that `expectedType` is applied **before** the short-circuit. That is precisely why the Option A
  workaround (`dtoPipe`) works with no build-system change.
- `node_modules/@nestjs/common/pipes/validation.pipe.js` — constructor:
  `this.validatorOptions = { forbidUnknownValues: false, ...validatorOptions }`. **Nest disables
  class-validator's `forbidUnknownValues` by default.** Recorded here because someone diagnosing a
  related symptom is likely to reach for that flag; it is not the mechanism.
- Installed versions at time of writing: `@nestjs/common` **11.1.23**, `class-validator` **0.15.1**.

### What the work looks like

Add an esbuild plugin (or switch the `ptah-license-server` build executor) that emits
`design:paramtypes` for decorated class methods — either by delegating decorated files to `tsc`/SWC
with `emitDecoratorMetadata` enabled, or by using an existing community plugin that does the same.
`apps/ptah-license-server/project.json` is the entry point; the build is `@nx/esbuild`, CJS, `node20`,
with a `generatePackageJson` step and an explicit externals list.

### 🔴 The blast radius, which is the reason it is deferred

The day the plugin lands, **every `class-validator` decorator in the server starts enforcing at once**
— 16 DTO files, ~20 payload params, including caps and `forbidNonWhitelisted` that have never
executed. Anything a caller has been silently getting away with becomes a 400 in production
simultaneously, with no per-endpoint rollback.

Two specific landmines that must be resolved before Option B is safe:

1. **`UpdateRecordDto`** (`admin/admin.dto.ts`) is `{ [key: string]: unknown }` — zero
   `class-validator` metadata. `ValidationExecutor.whitelist()` pushes `property <key> should not
exist` for **every** property of a zero-metadata class when `forbidNonWhitelisted` is on:
   ```js
   // class-validator/cjs/validation/ValidationExecutor.js  whitelist()
   Object.keys(object).forEach((propertyName) => {
     if (!groupedMetadatas[propertyName] || groupedMetadatas[propertyName].length === 0) notAllowedProperties.push(propertyName);
   });
   ```
   Under a global whitelisting pipe this would **400 every admin record edit**. TASK_2026_170 handles
   it per-param with `passthroughDtoPipe`; a global pipe has no such escape hatch, so Option B needs a
   real answer here (see item 2 below).
2. **Webhooks.** `/webhooks/resend` and `/webhooks/paddle` are deliberately excluded from validation
   (third-party payload shapes change without notice). A global whitelisting pipe would re-include
   them. `ResendWebhookPayload` is an `interface`, not a class, so it cannot even be validated;
   `PaddleController` reads `req.rawBody` via `@Req()` and has no payload param at all. Both would need
   explicit `@UsePipes()` overrides.

### Why Option A first

Option A is Option B's prerequisite, not its competitor:

- Option A forces someone to read all 16 DTO files and trace every caller's actual payload literal.
  That reading **is** the risk assessment Option B needs, and it is now written down in
  `implementation-plan.md` §3.
- Option A lands as one commit per controller, each independently `git revert`-able, so a bad
  behaviour change costs minutes and one file. Option B is one commit that flips everything.
- After Option A, the global pipe becomes redundant belt-and-braces rather than a big-bang switch — the
  day Option B lands, every endpoint is already validating with known-good semantics, so the plugin
  should be a **no-op**. That is a far better test than "turn it on and watch production".

`main.ts`'s global pipe is retained for exactly this reason and carries a docblock saying so. Do not
delete it as dead code.

---

## 2. Rejected alternative — per-model admin update DTOs

**Status:** considered and rejected for TASK_2026_170. Recorded so it is not re-proposed without the
counter-argument.

The proposal: replace `UpdateRecordDto`'s index signature with **nine** concrete DTO classes, one per
entry in `ADMIN_MODELS`, each declaring exactly that model's `editableFields` with real decorators.
Then `AdminController.update` could use ordinary `dtoPipe` and the whitelist would be meaningful.

**Why it was rejected:**

- The authoritative allowlist already exists and is enforced: `AdminService.filterEditable()` against
  `ADMIN_MODELS[key].editableFields`. Nine DTO classes would **duplicate a single source of truth into
  nine places**, and the duplicate would be the one that 400s when it drifts.
- `AdminController.update` is a single generic handler dispatched by a `:model` path param. Selecting
  one of nine DTOs per request is not something a param-level pipe does naturally; it needs a custom
  pipe that reads the route param, which is a larger change than the fix it enables.
- It is feature-sized work well outside a bugfix task's remit.

**What was done instead:** `passthroughDtoPipe(UpdateRecordDto)` — an explicitly bound
`ValidationPipe` with `whitelist: false, forbidNonWhitelisted: false, transform: true`. The param is
honestly bound (the structural guard sees a real `expectedType`), the policy difference is deliberate
and documented, and the allowlist stays in the one place that owns it.

**If this is revisited**, the right shape is probably a _generated_ DTO per model derived from
`ADMIN_MODELS` at build time, so there is still one source of truth — not nine hand-written classes.

---

## 3. Harden named-primitive query params

**Status:** out of scope for TASK_2026_170 (explicit non-goal, plan §6.3). Small, self-contained.

`dtoPipe` binds a DTO **class**. It is meaningless on a param like `@Query('code') code: string`, which
binds a bare string. There are **8** such params in the server today, and
`src/common/controller-validation.spec.ts` carves them out by route-args `data` and asserts that count
**exactly**, so the carve-out cannot silently grow:

| File                                | Lines                   | Params                                        |
| ----------------------------------- | ----------------------- | --------------------------------------------- |
| `app/auth/auth.controller.ts`       | 246, 247, 478, 858, 859 | `code`, `state`, `token`, `returnUrl`, `plan` |
| `discourse/discourse.controller.ts` | 48, 49                  | `sso`, `sig`                                  |
| `events/events.controller.ts`       | 78                      | `ticket`                                      |

**None of these is currently unchecked** — each has a downstream check that remains authoritative:
`validateReturnUrl()` / `validatePlanKey()` in `auth.controller.ts`, Discourse SSO HMAC verification in
`discourse.controller.ts`, and ticket verification in `events.controller.ts`. This item is
defence-in-depth, not a hole.

**The work:** wrap each with an appropriate built-in pipe — `ParseUUIDPipe`, a
`ValidationPipe({ expectedType: String })`, or a small `@MaxLength`-style custom pipe — so malformed
input is rejected at the boundary instead of inside a handler. Where a param is genuinely optional
(`returnUrl`, `plan`, `sso`, `sig` are typed `string | undefined`), the pipe must tolerate `undefined`
rather than 400 on a legitimately absent value — that is the one subtlety in an otherwise mechanical
change.

When these are bound, the `NAMED_PRIMITIVE_PARAM_COUNT` literal in
`src/common/controller-validation.spec.ts` comes down accordingly, and the enumerator's `named` carve-out
can eventually be narrowed or dropped.
