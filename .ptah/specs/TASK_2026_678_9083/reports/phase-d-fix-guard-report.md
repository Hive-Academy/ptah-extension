# Phase D Tribunal answer guard fix

## Findings

| Finding | Change | Regression spec |
| --- | --- | --- |
| N-1 | `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:82,121,443` uses the same active Tribunal predicate for ordinary choices and typed/voice answers. Ordinary Confirm and yes work when no request is outstanding. | `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts:515` — “offers Confirm and accepts Confirm or yes on an ordinary question without Tribunal”; the existing outstanding-request denial remains at `:472`. |
| N-2 | `command-center-page.controller.ts:239,304,318,496,503,511,518,528,544` clears the request after successful invalid decline, invalid proposal, a terminal pulse without a proposal, failed send, confirm result, decline, timeout, and exit. Pulse sequence is captured when the request is sent. | `command-center-page.controller.spec.ts:634` — “restores ordinary Confirm after a proposal resolves”; `:650` — “restores ordinary Confirm after a request turn ends without a proposal”. The prior invalid-roster spec at `:827` now starts a new request after each invalid proposal. |
| N-3 | `libs/frontend/command-center/src/lib/components/command-pending-input.component.ts:169,189,199,209,258` holds a response in flight until the page reports success, re-enables a rejected card, and shows a short safe message. `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:133,162` binds and reports the answer result. Duplicate clicks still emit once; roster Confirm remains on its roster card. | `command-pending-input.component.spec.ts:138` — “re-enables a rejected answer with feedback, then sends a valid answer once”; `command-center-page.component.spec.ts:273` — “passes a rejected ordinary answer result back to the pending card”. |
| M-1 | `command-center-page.controller.ts:86` treats every untagged question on the root tab or root session as invalid while a Tribunal request is outstanding, regardless of option labels. | `command-center-page.controller.spec.ts:674` — “declines deviating untagged output on the root session while Tribunal is outstanding”. |
| M-2 | `command-center-page.controller.ts:225` checks the transport result before marking the question handled; failure gets an accurate toast and a later request update can retry. | `command-center-page.controller.spec.ts:705` — “retries a failed automatic Decline and reports success only after answer succeeds”. |

## Verification

- Final Jest run after the last source edit: `Test Suites: 32 passed, 32 total`; `Tests: 227 passed, 227 total`.
- `npx tsc -p libs/frontend/command-center/tsconfig.lib.json --noEmit` filtered with `grep -E "src/"`: no output.
- `npx eslint` on all six changed source/spec files: passed with no warnings or errors.
- `npx prettier --write` then `npx prettier --check` on all six changed source/spec files: passed; all matched files use Prettier code style.

## Decisions

- The voice loop uses the controller callback, so no voice-loop file change was needed.
- A failed automatic Decline keeps the question unhandled and hidden from affirmative answers. A later question-request update retries it; the toast does not claim a decline until the transport returns true.
- The review's M-3 exact-answer-form refinement was outside the two Moderate findings requested. The touched guard expressions use word boundaries to avoid prefix matches.

## Anything not done

- No changes outside the six scoped source/spec files and this report. No build, serve, e2e, Nx, or Git operation was run, per task limits.
