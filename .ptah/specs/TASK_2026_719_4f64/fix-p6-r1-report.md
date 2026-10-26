## Frontend implementation — `TASK_2026_719_4f64`, fix P6 review finding 1

**Tasks completed**: `code-logic-review-p6.md` finding 1 only. A later push that ends a pending sign-in is now announced, and focus left on a pending control that the push removes is repaired.

**Files** (all under `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/`):

- MODIFIED `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-tab.component.ts`: adds a sign-in transition observer and suppresses the push announcement after a Cancel.
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/accounts/account-detail-view.component.ts`: marks the pending controls and repairs focus when a push removes one.
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-tab.component.spec.ts`: 8 new tests.
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/accounts/account-detail-view.component.spec.ts`: 8 new tests.
- `account-presentation.ts` was not edited. It uses `ACCOUNT_COPY.signedIn` and `ACCOUNT_COPY.actionFailed`.

### The fix

**Announcement (tab).** A new constructor `effect` reads `snapshot()` and `busy()` and calls `observeSignIns()` untracked. It keeps `lastStates: Map<profileId, state>`.

- If an account has a write in flight (`busy.has(id)`), it is skipped and keeps its earlier state. The write's response owns that announcement. When busy clears, the effect runs again and compares against the state from before the write. Because of this, a start whose response is already `signed-in` gives one "Signed in" (from the response): the observer sees `not-signed-in → signed-in`, not `pending → signed-in`.
- `pending → signed-in` announces `ACCOUNT_COPY.signedIn` with tone `status`. `pending → failed` announces an `alert`.
- A push that repeats the same state changes nothing, so duplicates are ignored.
- `pending → cancelled` is never announced by the observer. Cancel's own response announces it.
- When a Cancel response is saved, `settledByWrite` gets the profileId. The next terminal transition of that account is then silent, which covers a Cancel response that still reads pending followed by a `cancelled` or `failed` push. The mark is cleared when the account enters pending again or leaves the snapshot.
- The observer covers sign-ins this tab started and pending sign-ins it only saw in a push. It is part of the component's lifetime, so nothing is announced after the tab is destroyed.

**Focus (detail).**
- The pending controls carry `data-pending-control`: Cancel sign-in, Use terminal, the script `<pre>`, and Copy script.
- A `(focusin)` handler on the panel root records the last focused element.
- An effect tracks `{profileId, pending}`. When the same account goes from pending to not pending, `repairPendingFocus()` runs if the last focused element is a pending control and it still holds focus. "Still holds focus" means it is `activeElement`, or it is already detached, which covers either order of effect and render.
- After the next render, if that control is gone and focus is on the body, the detail heading gets focus.
- Nothing happens if the panel was destroyed (navigation), if focus is elsewhere, or if the focused control survives (for example Check status).

### Decisions

- **Failure copy.** Options: a host sentence passed through `isSafeProviderAccountSummary`, or `ACCOUNT_COPY.actionFailed`. Evidence: `ProviderAccountSummary` (`libs/shared/src/lib/types/provider-account.types.ts:296`) and `ProviderAccountOperation` (`rpc-provider-accounts.types.ts:142`) carry no per-account result summary, so a push has no host sentence to check. Decision: `actionFailed` as an alert. Reversible: if the snapshot gains a summary, route it through `isSafeProviderAccountSummary` in `observeSignIns`.
- **"Row's Manage control when the detail is closed."** The list renders no control that exists only while pending. Row "Sign in" is hidden while pending, and the spinner is `aria-hidden` and not focusable. A pending → terminal push therefore removes no focused control from the list, and no repair is needed there. If the detail is closed by navigation, it is destroyed and does nothing, as required.
- **Repair location.** The repair sits in the detail view, which owns the heading and the pending controls, rather than in the tab. Reversible.
- **Status check during a pending sign-in.** If a status check finds that the pending sign-in finished, the user hears "Status checked" from the response and then "Signed in" from the observer. These are two different results, not a duplicate.

### Verification

- Command: `node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- --output-style=static -- "--testPathPatterns=accounts-tab|account-detail-view"`. Result: **Test Suites: 2 passed, 2 total; Tests: 78 passed, 78 total**. I ran it once.
- `ptah_get_diagnostics` on the 4 files: no errors in either component. The one error in the specs, `accounts-tab.component.spec.ts:206` (TS2322 `'x'` vs the error-string literal type), is in the existing "first-load failure" test, which this fix did not touch. All other diagnostics are in sibling files outside this task.

### New tests

- Tab:
  - Start resolves pending, then a `signed-in` push: "Signed in" once, and a duplicate push adds nothing.
  - Same for a `failed` push: the alert once, and a duplicate adds nothing.
  - A start whose response is already signed in: "Signed in" once.
  - A pending sign-in seen only in a push and then ended: announced.
  - Cancel, then a `cancelled` or `failed` push (2 cases): the Cancel toast only.
  - Focus on Cancel sign-in moves to the detail heading.
  - Focus outside the tab stays there.
- Detail:
  - Focus on Cancel moves to the heading, for `signed-in` and `failed` (2 cases).
  - Focus on Use terminal, the script, or Copy moves to the heading (3 cases).
  - Focus moved elsewhere stays.
  - Focus on Check status stays.
  - Once the panel is destroyed, nothing moves.

**Plan deviations**: none.

**Out-of-scope observations**: the error at `accounts-tab.component.spec.ts:206` (existing code). Review finding 2 (duplicate toast live regions) was not touched.
