import { HttpErrorResponse } from '@angular/common/http';

/**
 * The one place the community admin surface turns a failure into a sentence.
 *
 * ⚠️ NEVER SURFACES A RAW TRANSPORT MESSAGE. `HttpErrorResponse` implements
 * `Error` but does not extend it, so an HTTP failure falls through to
 * `fallback` and its "Http failure response for /api/…: 500" never reaches the
 * screen. A boundary-parse failure from `validate()` IS a real `Error` and its
 * message names the endpoint and the field, which is exactly what an operator
 * wants.
 *
 * ⚠️ ONE EXCEPTION, AND IT IS NARROW: {@link refusalSentence}.
 */
export function describeFailure(failure: unknown, fallback: string): string {
  const refusal = refusalSentence(failure);
  if (refusal !== null) return refusal;
  return failure instanceof Error && failure.message
    ? failure.message
    : fallback;
}

/**
 * The statuses whose body carries a sentence a person wrote.
 *
 * A `400` and a `409` on this surface are both REFUSALS the API composes from
 * caller-supplied values — "Unknown cohort key(s): alumni — create the member
 * group first", "ids must list every category exactly once (expected 4,
 * received 3)", "This category still contains topics and cannot be deleted.
 * Move or delete its topics first." — never a raw Prisma message (NFR-S7).
 * Every other status is masked: a 500's body is not a sentence anyone wrote.
 */
const REFUSAL_STATUSES: readonly number[] = [400, 409];

/**
 * The server's own sentence for a refusal, or `null`.
 *
 * ⚠️ A STRING `message` ONLY. A `ValidationPipe` rejection answers 400 with
 * `message: string[]` — a list of decorator names an operator cannot act on —
 * so the array shape falls through to the caller's fallback. The client guards
 * in `community-limits.ts` exist so that shape is not reached in the first
 * place.
 */
export function refusalSentence(failure: unknown): string | null {
  if (
    !(failure instanceof HttpErrorResponse) ||
    !REFUSAL_STATUSES.includes(failure.status)
  ) {
    return null;
  }
  const message: unknown = (failure.error as { message?: unknown } | null)
    ?.message;
  return typeof message === 'string' && message !== '' ? message : null;
}
