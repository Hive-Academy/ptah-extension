# B4b Round 2 fix report

| Finding | Fix | File:line | Covering spec |
| --- | --- | --- | --- |
| N2 | Remove an existing override and its field metadata when the restored value equals the current agent value; preserve other overrides and `lastApplied`. | `libs/frontend/onboarding/src/lib/proposal/proposal-flow.store.ts:210-226` | `removes a restored name override when the next revision matches the agent value` (`proposal-flow.store.spec.ts:121`) |
| N1 | Emit `applyStarted` after apply guards, clear the page's pending revision on `applied` or `applyFailed`, and remove button text matching and `MutationObserver`. | `libs/frontend/harness-builder/src/lib/components/sidebar/builder-apply-section.component.ts:203-205,295,316`; `libs/frontend/onboarding/src/lib/proposal/review-apply.page.ts:23,51-53` | `emits applyStarted when RPC begins but not on an early exit` (`builder-apply-section.component.spec.ts:56`); `captures apply start from the section output and clears pending state on failure` (`review-apply.page.spec.ts:53`) |
| N3 | Navigate to `/onboarding` after `leaveCurrent('save')` returns `left`, matching the existing Leave → Save destination. | `libs/frontend/onboarding/src/lib/proposal/proposal-workspace.page.ts:71` | `stops the session before saving a draft and reports an uncertain stop` (`proposal-workspace.page.spec.ts:11`, updated navigation assertions) |

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Reset only restored fields already overridden and equal to the folded current value. | Replace the whole snapshot; merge changed fields and remove matching overrides. | `restoreRevision` already merges other overrides and retains `lastApplied`; the new two-restore spec verifies the stale name override is removed. | Yes; the change is local to snapshot construction. |
| Add `applyStarted` and `applyFailed` outputs to the apply section. | Observe button text and DOM mutations; use explicit component outputs. | Apply has guarded early exits and only an `applied` success output; a failure needs a completion signal to release the review gate. | Yes; these are additive outputs. |
| Route Save draft to `/onboarding` after a successful stop and save. | Show a status on the stopped composer; follow Leave → Save navigation. | `HarnessSessionController.leave` returns `left` only after stop and draft replacement; `chooseLeave` already navigates home. | Yes; one page navigation branch. |

## Not fixed

- N4: No change requested; the review rates hidden-element focus after widening as negligible.
- `ptah-extension-webview:lint`: Existing circular dependency in `app.routes.ts` through `@ptah-extension/command-center`; explicitly accepted and outside scope.
- Visual review: Not run because the requested verification rules prohibit launching application or browser targets.

## Verification

- `npm run verify -- -p @ptah-extension/onboarding,@ptah-extension/harness-builder,ptah-extension-webview` (45-minute timeout wrapper; exit 1): `NX   9 tasks: 8 succeeded, 1 failed`; `✖ nx run ptah-extension-webview:lint`. The lint log confirms the accepted circular dependency.
- `npm run verify -- -t lint,typecheck -p ptah-electron` (45-minute timeout wrapper; exit 0): `NX   2 tasks: 2 succeeded`.
- Scoped Ptah diagnostics were unavailable after 45 seconds; the required Nx verification completed instead.
