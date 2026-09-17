# PR #527 fix report — round 4

## Status

FIXED

## Reason

`parseIsoDate` now validates the parsed UTC year, month, and day before accepting either supported ISO form, preventing JavaScript date rollover from accepting impossible calendar dates. Date-time values also validate hour, minute, second, and numeric offset bounds. The existing `ISO_DATE_ONLY_PATTERN` and `ISO_DATE_TIME_PATTERN` are unchanged, and the validation is split into small named helpers to keep cognitive complexity bounded.

## Files and lines

- `libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:247` — added numeric date-part extraction.
- `libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:251` — added explicit UTC calendar validation with leap-year behavior.
- `libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:264` — added hour, minute, and second range validation.
- `libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:272` — added offset hour and minute range validation.
- `libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:282` — updated `parseIsoDate` to require explicit component validity.
- `libs/web/admin/src/lib/waitlist/waitlist-query-state.spec.ts:20` — expanded invalid-value fallback and canonicalization coverage.
- `libs/web/admin/src/lib/waitlist/waitlist-query-state.spec.ts:40` — expanded valid ISO date/date-time coverage.

## Tests added

- Reject and canonicalize `2026-02-30`.
- Reject and canonicalize `2026-04-31`.
- Reject and canonicalize non-leap-day `2026-02-29`.
- Reject and canonicalize hour `24` in `2026-09-17T24:00:00Z`.
- Reject and canonicalize minute `60` in `2026-09-17T12:60:00Z`.
- Accept leap-day `2028-02-29`.
- Accept date-only `2026-09-17`.
- Confirm acceptance of `2026-09-17T14:30:45+02:00`.
- Accept millisecond form `2026-09-17T14:30:45.123Z`.

## Verification counts

Command: `npx nx run-many -t typecheck,test,lint -p web-admin`

- Test: 301 passed, 0 failed across 24 suites.
- Typecheck: 1 project target passed, 0 errors.
- Lint: 1 project target passed, 0 errors and 8 existing warnings in unrelated files.
