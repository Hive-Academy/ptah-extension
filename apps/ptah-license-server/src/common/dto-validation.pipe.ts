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
 * So every DTO decorator in the server is currently inert — including the
 * length/range caps, the `@IsUUID` checks, and `forbidNonWhitelisted`.
 *
 * THE FIX APPLIED HERE: `ValidationPipe`'s `expectedType` option overrides the
 * metatype rather than inferring it (`validation.pipe.js:51-52`), so binding
 * the DTO class explicitly at the parameter restores full validation and
 * transformation without any build-system change.
 *
 * SCOPE: this is applied to the endpoints added by TASK_2026_169 only, because
 * two of their requirements depend on validation actually running — the
 * `repoUrl` GitHub-URL regex (leak risk L4, a stored-XSS mitigation that is
 * worthless if inert) and numeric query coercion (an untransformed `pageSize`
 * reaches Prisma as a string and 500s).
 *
 * The app-wide defect is deliberately NOT fixed here: repairing decorator
 * metadata for the whole server would make ~9 existing admin models start
 * rejecting input they currently accept, which is a behavioural change well
 * beyond this task and needs its own review. It is escalated in the
 * implementation report as a follow-up.
 */
export function dtoPipe<T>(expectedType: Type<T>): ValidationPipe {
  return new ValidationPipe({
    expectedType,
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
}
