# P5 frontend fix round A: F1, F4, F5

Worktree: `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts`. I touched four files only. I did not touch F2 or F3, and I did not commit.

## Files

- MODIFIED `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts`
- MODIFIED `libs/frontend/core/src/lib/services/provider-accounts-state.service.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-tab.component.ts`
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-tab.component.spec.ts`

## F1: Check status gets a busy latch and reports an outcome

**Service changes:**
- `provider-accounts-state.service.ts:61` adds `'check-status'` to `ProviderAccountActionKind`. This lets the tab's per-account busy map and the detail's `busy` input carry the check. It is never recorded as a write action.
- `:91` adds the new type `ProviderAccountStatusReadOutcome` = `read` | `failed` (with a safe result) | `unavailable`.
- `refreshAccountStatus` (`:343`) now returns that outcome:
  - Inert or disposed service, or a transport failure: `unavailable`.
  - Host refusal: `failed`, with `safeResult(...)`. An unsafe sentence is replaced with the fallback.
  - Accepted reply: `read`. A superseded reply also returns `read`, because the host answered and newer state already holds.
  - Every existing state effect is unchanged.
- The only other caller was the tab, which used `void`. The existing service tests still pass unchanged.

**Tab changes:**
- `checkStatus` (`accounts-tab.component.ts:605`) now does this, in order:
  1. Rejects the call if the account is already busy.
  2. Calls `startBusy(profileId, 'check-status')` synchronously in the receiving handler.
  3. Awaits the read inside `try/finally`, clearing busy in `finally`.
  4. Announces the result:
     - `read`: "Status checked." in the detail live region.
     - `failed`: the host refusal in the detail alert slot.
     - `unavailable`: the existing `ACCOUNT_STATUS_UNAVAILABLE` text.
     - Outside the detail, the result goes to the tab toast or alert.
- `run()` now shares the same `startBusy`/`endBusy` helpers (`:669`) and clears busy in `finally`.
- The detail's existing focus effect now sees a real busy period. Focus returns from the live status only if it is still there.

**New spec cases:**
- `accounts-tab.component.spec.ts`, describe "Check status (F1 …)":
  - Busy is `check-status` in the same handler, and the detail `busy` input reflects it.
  - A second Check status and a Sign out during the check are rejected.
  - A successful read shows "Status checked." and clears busy.
  - A refused read shows the refusal and clears busy.
  - A transport failure shows the unavailable text.
- `provider-accounts-state.service.spec.ts`, describe "status read outcome (F1)":
  - The read, failed and unavailable outcomes are each returned, and state is left alone on failure.
  - An unsafe refusal sentence is sanitised.
  - An inert host returns `unavailable` with no RPC call.

## F4: focus returns only to the exact waiting target

**New helpers:**
- `interface FocusWait { target; view }` (`:110`) records the exact element and the `TabView` object identity.
- `captureWait(area)` (`:716`) takes the active element when the operation starts. The document body never counts, and the element must lie inside the given area.
- `stillWaiting(wait)` is true only if all of these hold: same view object, target still connected, `activeElement === target`, and the tab is not destroyed.
- `focusAfterRender(target, wait?)` (`:737`) checks again just before the render-time move. It moves focus only if the view is unchanged and focus is still on the target. The one exception is when this render removed the target and focus fell to the body.
- The area-based `focusWithin` is deleted.

**Add flow (`:501`, `:513`):**
- The form focuses its own status before it emits, so the waiting target is that status element.
- On success, the tab opens the new detail only if `stillWaiting` holds. Otherwise focus stays where it is and the existing `ACCOUNT_ADDED_TOAST` announces the result.
- The unconfirmed and missing-account paths move focus to Add only under the same guard.

**Account disappearance (effect, `:425`):**
- The waiting target is the detail's live status (`[data-testid="account-detail-live"]`). Every detail action focuses that element before it emits.
- Focus moves to the "Accounts" heading only if focus is exactly on that status in the current detail view.
- Otherwise focus is left alone. If no toast is set yet, a fixed "That account is no longer in the list." is announced. A removal's later "<name> was removed." toast still replaces it.

**New spec cases:**
- Add: focus moved from the waiting status to the document body stays on the body, the list stays, and the toast announces.
- Add: focus moved to another control is left there.
- Removal: focus on a different enabled control inside the detail does not move to the heading, and the removal toast announces.
- Removal: focus lost to the body stays on the body.

The existing tests still pass: focus on the live status goes to the heading, and focus on an outside select stays.

## F5: completion announcements

- Sign in, cancel and sign out now pass completion text to `run()`. The new constants are at `:68`ff:
  - `SIGN_IN_STARTED_FEEDBACK` = "Sign-in started." This states that sign-in started, not that it finished, as the reviewer asked.
  - `SIGN_IN_CANCELLED_FEEDBACK` = "Sign-in cancelled."
  - `SIGNED_OUT_FEEDBACK` = "Signed out."
  - `STATUS_CHECKED_FEEDBACK` = "Status checked."
- All of these are fixed text, with no names, emails or paths. `account-presentation.ts` had no matching copy.
- `run()` (`:651`) shows the feedback in the detail live region. When the account's detail is not shown (for example a row Sign in), it puts the same sentence in the tab toast.

**New spec cases (real parent and child wiring, checking the DOM text in `account-detail-live`):**
- Saved sign-out with focus moved to the Claude lanes select: the live text is "Signed out." and focus stays on the select.
- Saved cancel: the live text is "Sign-in cancelled."
- Row Sign in from the list: the tab toast is "Sign-in started."

## Verification

Both commands ran in the foreground under the verify lock.

- `node scripts/verify.mjs --exec --task fixA-jest -- npx jest -c libs/frontend/core/jest.config.ts libs/frontend/core/src/lib/services/provider-accounts-state.service.spec.ts`: **38 passed, 38 total**.
- `node scripts/verify.mjs --exec --task fixA-jest -- npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/settings/providers/accounts/accounts-tab.component.spec.ts`: **32 passed, 32 total**.
- `ptah_get_diagnostics` scoped to the four files: **no diagnostics in the requested files**. Other spec files in the same projects already have type errors; I did not touch them.
- Not run, as instructed: `npm run verify`, lint, the typecheck target, and builds.

Each new case was written to fail without its fix:
- The F1 busy and announcement cases fail because the old `checkStatus` was fire-and-forget with no busy state and no feedback.
- The F4 body and other-control cases fail because the old `focusWithin` accepted the body and any descendant.
- The F5 live-text cases fail because the old `run()` stored `feedback: null`.

I did not run the suites against the old code to prove this.

## Decisions

- **Outcome shape.** Options were a new `read | failed | unavailable` union or reusing `ProviderAccountActionOutcome`. I chose the new union because a read has no snapshot to return and is never "unconfirmed". Reversible.
- **Busy kind.** Options were adding `'check-status'` to `ProviderAccountActionKind` or making a tab-local union. I added it to the core union because the detail's `busy` input is typed with that union, and the detail is outside this round's files. Reversible.
- **Waiting target for disappearance.** The tab finds the detail's live status by its `data-testid`, because the detail does not expose a reference to it. Reversible if the detail later exposes the element.

## Open points

- `ProviderAccountStatusReadOutcome` is not re-exported from the `@ptah-extension/core` barrel. The barrel block is in `providers-settings-state.service.ts`, which is outside my files. The tab infers the type through `Awaited<ReturnType<ProviderAccountsStateService['refreshAccountStatus']>>`. Add the type to that re-export block if a named import is wanted.
- The detail's Check status button is on its Access tab. I drove the F1 cases through the detail's `checkStatus` output after focusing the live status, which matches what the detail's `act()` does, instead of clicking the button.
- "That account is no longer in the list." is new copy, used only when an open account disappears while focus is elsewhere. Design should confirm the wording.
