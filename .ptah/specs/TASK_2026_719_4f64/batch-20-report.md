# Frontend implementation — `TASK_2026_719_4f64`, batch 20

**Tasks completed**: 20.0 (lint baseline fix in `attention-permission-actions.component.ts`, to be committed separately), 20.1 (U2 pending copy, U3 fallback block, neutral `HELD_FALLBACK`).

**Verdict**: Complete. Both specs pass, typecheck is clean in the five files, and ESLint shows zero new errors. The one remaining ESLint error in the drawer is the existing D30 module-boundary debt.

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/core/src/lib/components/attention-permission-actions.component.ts`. This is the Task 20.0 change only:
  - `:15` gains `role="group" aria-label="Permission actions"`.
  - `:28` gains `role="group" aria-label="Additional permission actions"`.
  - Nothing else changed.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/core/src/lib/services/provider-accounts-state.service.ts`:
  - It imports `ProviderAccountSignInFallback` (`:21`).
  - `Slot.fallbacks` is new (`:94`), and so is the public `fallbacks(provider)` signal (`:178-182`).
  - `write()` stores the script only for a `sign-in` operation whose profile is `pending`. Any other sign-in result drops a stale script (`:582-590`).
  - `refreshAccountStatus` drops the script when the host reports no operation (`:326`).
  - `apply()` prunes scripts to pending profiles. The `pending` set moved up so that both updaters share it (`:466-484`).
  - `resetForWorkspace` clears the scripts (`:407`) and `createSlot` initialises them (`:392`).
  - `dropFallback` is new (`:597`).
  - `fallbackOf(data)` mirrors `operationOf` (`:645`). It accepts only `platform` `win32`/`posix` and a non-blank string `script`.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/core/src/lib/services/provider-accounts-state.service.spec.ts`. It has two new cases:
  - `:275` keeps the script while the sign-in is pending. It also rejects malformed scripts (wrong platform, blank, non-string, not an object), keeps the script when a status read still has an operation, and drops it when a snapshot shows the profile no longer pending.
  - `:323` drops the script when a status read has no operation.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/account-details-drawer.component.ts`:
  - New exported copy (`:48-54`): `ACCOUNT_PENDING_COPY` "Finish sign-in in the Claude window.", `ACCOUNT_FALLBACK_COPY` "Run it in a new terminal window.", `ACCOUNT_NO_WINDOW_COPY`, and `ACCOUNT_HELD_FALLBACK` "Named accounts are not available on this host." (D-D). The private `HELD_FALLBACK` is gone.
  - The `pending` state detail is now `ACCOUNT_PENDING_COPY` (`:67`).
  - The held heading "Held for release authorization" is now "Not available" (`:161`).
  - The class doc no longer uses "release hold" wording.
  - The Access panel detail is the computed `accessDetail()` (`:218`).
  - The fallback block is at `:220-241`.
  - The new input `fallback` (`:341`), the computed values `fallbackShown`, `accessDetail`, `copyLabel` and `copyStatus`, and `copyScript()` (`:523`) use CDK `Clipboard` through `inject()` (`:328`).
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/account-details-drawer.component.spec.ts`:
  - The Host binds `[fallback]`, and the test injects a fake `Clipboard` instance through TestBed providers.
  - The HELD case is rewritten for neutral copy (`:245`).
  - New cases:
    - unsafe-sentence held fallback (`:267`)
    - U2 pending copy (`:276`)
    - fallback block with script, copy and Check status (`:285`)
    - failed copy with no script in console output, and a new script resets the status (`:314`)
    - busy disables Check status, and a settled sign-in hides the block (`:341`)

## Acceptance evidence

- **Pending copy "Finish sign-in in the Claude window"**: `STATE_COPY.pending.detail = ACCOUNT_PENDING_COPY`, asserted in spec `:276`.
- **Fallback block inside the existing drawer**: the block is in the Access tab panel of `ptah-native-drawer`, so no new surface was added. It contains:
  - the script, read-only, in `<pre>{{ f.script }}</pre>`, which is interpolated as text with no `[innerHTML]`. The spec checks that `children.length === 0`.
  - a "Copy script" button, which changes to "Copied".
  - the line "Run it in a new terminal window."
  - a "Check status" button that emits `refreshStatus(profileId)`, the existing intent for `provider:getAccountStatus`.
- **The state service extracts `fallback` the way `operationOf` does**: `fallbackOf(data: object)` uses the same `'x' in data && isRecord` narrowing (state service `:645`).
- **`HELD_FALLBACK` is neutral**: `ACCOUNT_HELD_FALLBACK` contains no "release" wording, and the spec asserts `not.toMatch(/release/i)` on the constant and on the rendered block.
- **The drawer HELD spec cases are updated** (`:245`, `:267`).
- **The fallback script is never logged**: no `console.*` call exists in either changed file, a failed copy shows a status line only, and spec `:314` checks that no console call contains the script.
- **Theme**: the block uses the same classes as the existing drawer boxes (`surface-2 rounded-box border border-base-300 p-3`, `text-base-content-muted`, `font-semibold`, `btn btn-outline/ghost btn-sm` plus the existing `FOCUS` ring). The script view uses `bg-base-100 text-base-content font-mono text-xs`. All of these are theme tokens, so the block follows dark and light themes.

## DOM selectors (visual reviewer)

Open the drawer, then select the Access tab with `[data-testid="account-tab-access"]`.

- **Pending copy (U2)**: `[data-testid="account-access-detail"]` while the profile is `pending` and there is no fallback. The heading is `[data-testid="account-access-heading"]` ("Signing in").
- **Fallback block (U3)**: `[data-testid="account-fallback"]`, which is a `role="group"` labelled "Sign in from a terminal". Inside it:
  - `account-fallback-copy`: "Run it in a new terminal window."
  - `account-fallback-script`: the `<pre>`, which is focusable and scrolls at `max-h-40`.
  - `account-fallback-copy-button`
  - `account-fallback-check-status`
  - `account-fallback-copy-status`: a polite live region.
- When the fallback block is shown, `account-access-detail` reads "No Claude window could be opened for this sign-in."
- **Held block**: `[data-testid="account-held"]`.

## States covered

- **Pending with a window**: the U2 copy and Cancel only. This is unchanged and the existing state cases still pass.
- **Pending without a window**: the fallback block and Cancel. The DOM order is Copy script, Check status, Cancel sign-in.
- **Busy**: Check status is disabled.
- **Copy outcome**: success shows "Copied" and "Script copied.". Failure shows "Couldn’t copy. Select the script and copy it manually." The outcome is tied to the script it copied, so a new script starts clean.
- **Settled**: once the profile is no longer pending, the block is hidden.
- **Accessibility**:
  - The `<pre>` scrolls and has `tabindex="0"`, `aria-label="Sign-in script"` and `aria-describedby` pointing at the hint.
  - The group is labelled by its title.
  - Copy feedback goes through `role="status" aria-live="polite"`.
  - All buttons have `type="button"` and the shared focus ring.

## Verification

- `npx jest -c libs/frontend/core/jest.config.ts libs/frontend/core/src/lib/services/provider-accounts-state.service.spec.ts --maxWorkers=2`: 1 suite, 17/17 passed.
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/settings/providers/accounts/account-details-drawer.component.spec.ts --maxWorkers=2`: 1 suite, 32/32 passed.
- `npx tsc --noEmit -p libs/frontend/core/tsconfig.lib.json`: 0 errors.
- `npx tsc --noEmit -p libs/frontend/chat/tsconfig.lib.json`: 0 errors.
- `npx tsc --noEmit -p libs/frontend/core/tsconfig.spec.json` and `npx tsc --noEmit -p libs/frontend/chat/tsconfig.spec.json`: these report errors that existed before this batch, all in other files. Examples in core: `electron-layout.service.spec.ts`, `message-router.service.spec.ts`, `mock-rpc-service.ts`, `libs/shared/.../attention-identity.ts`. Examples in chat: `chat-view.component.spec.ts`, `send-message-chip.component.spec.ts`. Filtering both configs for the five batch files returns 0 errors.
- `npx eslint` on the 5 files: 1 error, and it is not new. It is `account-details-drawer.component.ts:19`, `@nx/enforce-module-boundaries` "Static imports of lazy-loaded libraries are forbidden" for `@ptah-extension/shared`. It is the same D30 debt: `artifact.store.ts` and `artifact-message-handler.service.ts` import `@ptah-extension/shared/mcp-apps-contracts` dynamically, so the rule flags every static `@ptah-extension/shared` import in chat. The drawer already imported `@ptah-extension/shared` at HEAD; the line moved from 18 to 19 because a `Clipboard` import was added above it. The other four files have 0 errors, and both `interactive-supports-focus` errors in `attention-permission-actions.component.ts` are gone.
- Not run, by the batch rules: `npm run verify`, builds, and `ptah_get_diagnostics`. Scoped `tsc` was used in place of `ptah_get_diagnostics`.

## Specs that mock or pin changed members (rule 5)

- `accounts-section.component.spec.ts` (owned by B21) uses `ProviderAccountsStateService` and the drawer. The new members (`fallbacks()`, the `fallback` input) are additive and optional. No existing member's signature changed.
- `session-list-row.component.spec.ts` uses the state service. It is not affected for the same reason.
- No spec outside this batch pins `HELD_FALLBACK`, "awaiting release authorization" or "Held for release authorization".
- None of the ambient-path pins changed.

## Decisions

- **The Task 20.0 fix is `role="group"` plus an `aria-label` on the two Escape-delegating containers.**
  - Options: `tabindex` with a handler (adds an extra Tab stop to a container), a `<button>` (would nest buttons), or `role="group"`.
  - Evidence: the rule source in `@angular-eslint/eslint-plugin-template/dist/rules/interactive-supports-focus.js` exempts non-interactive roles, and the containers really are groups of buttons that catch Escape bubbling from their children.
  - The second label is "Additional permission actions" so that it does not collide with `[aria-label="More permission actions"]`, which `canvas-rail.component.spec.ts` queries.
  - Reversible.
- **The fallback is stored per profile in a new `fallbacks(provider)` signal next to `operations(provider)` and passed to the drawer through a new optional `fallback` input.** The drawer stays presentational. Reversible.
- **"Check status" reuses the existing `refreshStatus` output.** No new intent was added. Reversible.
- **Clipboard access uses `@angular/cdk/clipboard`.** It is already used by `chat-ui` `copy-button.component.ts`, so no new library was added.
- **The held heading is now "Not available".** Batch 21 requires that no "release authorization" wording appears in the drawer.

## Plan deviations

- None in scope.
- The planned "drawer spec HELD cases" were rewritten rather than deleted, because `release-held` stays in the union (D-D).

## Out-of-scope observations

- **The parent binding is missing (Batch 21 owner).** `accounts-section.component.ts:398-404` must bind `[fallback]="…fallbacks('claude')()[profileId] ?? null"` to the drawer. Until it does, the U3 block never shows in Electron. Neither the state service nor the drawer can do this: the section file belongs to the other frontend developer this run.
- **The backend must return the `fallback` field.** It has to come back on `provider:startAccountSignIn` (Batch 17) for the block to show at runtime.
