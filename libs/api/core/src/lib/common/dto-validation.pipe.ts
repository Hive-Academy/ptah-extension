import { ValidationPipe, type Type } from '@nestjs/common';

/**
 * Build a `ValidationPipe` bound to an EXPLICIT DTO class.
 *
 * ⚠️ WHY THIS EXISTS — the global ValidationPipe does not currently validate
 * anything in this application.
 *
 * `main.ts` registers `new ValidationPipe({ whitelist: true,
 * forbidNonWhitelisted: true, transform: true })` globally, and every DTO in
 * the repo carries `class-validator` decorators. Despite that, requests are
 * neither validated nor transformed at runtime. Verified live against
 * PRE-EXISTING endpoints (not this task's code):
 *
 *   POST /api/v1/admin/groups  { key: 'INVALID KEY WITH SPACES!!' }  -> 201
 *   POST /api/v1/admin/groups  { bogusField: 'x' }                   -> 201
 *
 * …both of which the decorators on `CreateMemberGroupDto` should reject.
 *
 * ROOT CAUSE: Nest resolves a handler parameter's DTO class from the
 * `design:paramtypes` metadata emitted by TypeScript's `emitDecoratorMetadata`.
 * `tsconfig.app.json` sets `emitDecoratorMetadata: true`, but this app is
 * bundled by `@nx/esbuild`, and **esbuild does not implement
 * `emitDecoratorMetadata`**. Without that metadata `metadata.metatype` is
 * `undefined`, and `ValidationPipe.transform` short-circuits:
 *
 *   if (!metatype || !this.toValidate(metadata)) return value;
 *
 * So every DTO decorator in the server is inert unless a pipe supplies the
 * type explicitly — including the length/range caps, the `@IsUUID` checks, and
 * `forbidNonWhitelisted`.
 *
 * THE FIX APPLIED HERE: `ValidationPipe`'s `expectedType` option overrides the
 * metatype rather than inferring it (`validation.pipe.js` `transform()` applies
 * `expectedType` BEFORE the short-circuit above), so binding the DTO class
 * explicitly at the parameter restores full validation and transformation
 * without any build-system change.
 *
 * SCOPE — `dtoPipe` is the SERVER-WIDE input-validation mechanism.
 * TASK_2026_169 introduced it for the admin packs / sessions / community /
 * member-groups endpoints. TASK_2026_170 then bound every remaining controller
 * in the server, so the rule is now unconditional:
 *
 *   ⚠️ EVERY `@Body()` / `@Query()` payload param MUST bind `dtoPipe(TheDto)`.
 *      A bare `@Body() dto: X` is SILENTLY UNVALIDATED.
 *
 * This is enforced structurally by
 * `apps/ptah-license-server/src/common/controller-validation.spec.ts`, which
 * enumerates every controller in the server and fails the build on an unbound
 * payload param.
 *
 * DOCUMENTED EXCEPTIONS (all three are asserted, not merely commented):
 *  - Webhook receivers (`/webhooks/resend`, `/webhooks/paddle`) — third-party
 *    payload shapes change without notice. See the `EXCLUDED` list in
 *    `controller-validation.spec.ts`.
 *  - Named-primitive query params (`@Query('code') code: string`) bind a
 *    string, not a DTO; `dtoPipe` is meaningless there. The structural spec
 *    carves them out by route-args `data`, and asserts the carve-out's size so
 *    it cannot silently grow.
 *  - `AdminRecordsController.update` uses `passthroughDtoPipe` (see below).
 *
 * END STATE: Option B — an esbuild plugin that emits `design:paramtypes` — would
 * make the global pipe in `main.ts` live and render per-param binding
 * unnecessary. It is deliberately deferred; see
 * `.ptah/specs/TASK_2026_170/future-enhancements.md`. Until then the global pipe
 * is retained as the safety net for the day that lands, and `dtoPipe` is the
 * only thing actually validating input.
 */
export function dtoPipe<T>(expectedType: Type<T>): ValidationPipe {
  return new ValidationPipe({
    expectedType,
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
}

/**
 * Transport-envelope variant of `dtoPipe` for handlers whose body shape is
 * genuinely dynamic and whose allowlist lives elsewhere in the server.
 *
 * ⚠️ ONLY legitimate use today: `AdminRecordsController.update`
 * (`src/admin/admin-records.controller.ts`). `UpdateRecordDto` is an index-signature
 * class (`{ [key: string]: unknown }`) with NO class-validator metadata, and
 * class-validator's whitelist step rejects EVERY property of a zero-metadata
 * class when `forbidNonWhitelisted` is on:
 *
 *   // class-validator/cjs/validation/ValidationExecutor.js  whitelist()
 *   Object.keys(object).forEach(propertyName => {
 *     if (!groupedMetadatas[propertyName] || groupedMetadatas[propertyName].length === 0)
 *       notAllowedProperties.push(propertyName);
 *   });
 *   // …then, when forbidNonWhitelisted: `property ${property} should not exist`
 *
 * So plain `dtoPipe(UpdateRecordDto)` would 400 EVERY non-empty admin PATCH.
 * The real allowlist for that handler is `AdminService.filterEditable()`
 * against `ADMIN_MODELS[key].editableFields` — a single source of truth that
 * must not be duplicated into the DTO layer.
 *
 * This pipe still carries `expectedType`, so the param is explicitly and
 * honestly bound: the structural guard in `controller-validation.spec.ts` sees
 * a real `ValidationPipe` with a real expected type, and the policy difference
 * is deliberate and documented rather than an accidental gap.
 *
 * 🔴 Do NOT reach for this to silence a 400. If the DTO has decorators, the 400
 * is the DTO doing its job — use `dtoPipe` and fix the caller. A second call
 * site for `passthroughDtoPipe` should be rejected in review unless it comes
 * with the same "the allowlist provably lives elsewhere" argument.
 */
export function passthroughDtoPipe<T>(expectedType: Type<T>): ValidationPipe {
  return new ValidationPipe({
    expectedType,
    whitelist: false,
    forbidNonWhitelisted: false,
    transform: true,
  });
}
