# Implementation report — TASK_2026_712, Batch 32

Native account details drawer with complete access actions (Task 32.1). Executor: frontend-developer subagent (Claude). No git, no build/test command run (orchestrator runs scoped checks).

## Changed files

- CREATED `libs/frontend/chat/src/lib/settings/providers/accounts/account-details-drawer.component.ts`
- CREATED `libs/frontend/chat/src/lib/settings/providers/accounts/account-details-drawer.component.spec.ts`

No other file touched. `NativeDrawerComponent` (`libs/frontend/ui/src/lib/native/drawer/native-drawer.component.ts`) is reused unchanged through the `@ptah-extension/ui` barrel, like `system-prompt-drawer.component.ts`.

## API — `ptah-account-details-drawer` (standalone, OnPush, presentational)

Inputs:

| Input | Type | Meaning |
| --- | --- | --- |
| `open` (required) | `boolean` | Parent-owned visibility. |
| `account` (required) | `ProviderAccountSummary \| null` | Authoritative summary from the committed snapshot; drawer renders only when `open && account`. |
| `pending` | `ProviderAccountActionKind \| null` | This profile's in-flight action (busy state): disables every action, announces `Starting sign-in…` etc. |
| `result` | `ProviderAccountActionResult \| null` | Last refusal for this profile; safe sentence only (`isSafeProviderAccountSummary`), fixed copy otherwise. `release-held` gets its own explanation block. |
| `saved` | `ProviderAccountActionKind \| null` | Last committed action: `default` shows the exact toast in the drawer's `role="status"` region; `rename` shows "Local label saved." |

Outputs (names follow `ProviderAccountsStateService` methods): `refreshStatus(profileId)` (status), `signIn(profileId)` (login), `cancelSignIn(profileId)` (cancel), `signOut(profileId)` (logout), `rename({profileId,label})`, `setDefault(profileId)` (default), `remove(profileId)` (only after confirmation), `closed()`.

Exported constants: `ACCOUNT_DEFAULT_TOAST`, `ACCOUNT_REMOVE_CONFIRMATION`, `ACCOUNT_RENAME_HINT`; types `AccountRenameIntent`, `AccountDrawerTab`.

No RPC, no state-service injection (only `Injector` for `afterNextRender` focus moves). No `[innerHTML]`, no `any`, no `@Input/@Output`.

## Design copy used

- §3.4: accessible name and header "Account details for [label]"; tabs Overview / Access / Profile; Overview = local profile ID (mono), state, owner evidence ("Usage owner: Verified identity" / "Unknown owner" + prototype owner sentence), conditional Run binding ("Run binding — N current run(s)" + prototype sentence) or "No current runs are bound to this profile."; Profile rename hint exact: "Changes the local label only. Existing runs keep the profile ID they started with."; "Set as default" `btn-outline`; "Remove profile" `btn-error btn-outline`.
- §3.5: headings Not signed in / Signing in / Sign-in cancelled / Sign-in failed / Disconnected / Signed in / Signed out; controls Sign in / Cancel sign-in only / Sign in again / Try again / Sign in again / Sign out (`btn-error btn-outline`) / Sign in again. Detail lines from the prototype `accessMarkup` (pending detail drops the word "mocked"). No "Mock next outcome" control.
- §3.6: exact default toast "Default changed for future unbound starts. Existing runs are unchanged."; exact metadata-only removal confirmation; unavailable resume copy from prototype `#resumeDialog` ("Can’t resume this run", "The profile originally used by this run is unavailable or no longer proves the same identity.", "Choose neither another profile nor the current default to continue this conversation.") with no chooser or button.
- Release hold: host sentence (`claude-account-command.ts:20`, "Named account commands are awaiting release authorization.") + "Nothing changed on this profile. Existing provider settings stay available." (prototype notice line 26).

## Specs written (`account-details-drawer.component.spec.ts`, 25 cases incl. 7 `it.each`)

Accessible name/dialog role and focus moves in; no render without account; tabs + Arrow/End keys + `aria-selected`/roving tabindex; hidden panels excluded from focus (only one `tabpanel` in DOM, no Access/Profile controls focusable); opener focus restored on close; Escape requests close; closing during pending emits only `closed` (no cancel); every state (not-signed-in, pending, cancelled, failed, disconnected, signed-in, signed-out) heading + exact controls + emitted intent; pending Cancel only and profile locked; status intent; release-held explained with actions still enabled; busy (in-flight) disables everything and announces; `busy` refusal safe sentence vs unsafe fallback; no path/email/org/token text across all tabs; owner markers; unavailable resume without chooser; signed-in bound run has no notice; exact default toast; metadata-only removal confirmation (cancel and confirm); rename emits trimmed label, hint exact, label resets after commit and accessible name follows; reopen resets to Overview.

## Diagnostics

`ptah_get_diagnostics` scoped to the 2 files: **no diagnostics in the requested files** (TypeScript compiler, coverage clean). Sibling chat spec errors reported by the tool are pre-existing and outside this batch. Angular template type-check and Jest not run here (forbidden for this lane): orchestrator should run `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/chat') -Hosts $H`.

## Decisions

- **Output names** follow the state-service methods (`refreshStatus/signIn/cancelSignIn/signOut/rename/setDefault/remove`) instead of the brief's words status/login/cancel/logout/default (`default` is a keyword-like member). Evidence: `provider-accounts-state.service.ts` method names. Reversible.
- **Hidden-panel exclusion** by rendering only the active panel (`@switch`), because `NativeDrawerComponent` filters only the element's own `hidden` attribute, not an ancestor's. Shared drawer unchanged (plan: "Shared drawer remains untouched"). Reversible.
- **Removal confirmation inline** in the Profile panel (`role="group"`, focus moves to Cancel) rather than a nested `NativeModalComponent` inside the drawer's popover layer, avoiding a second top-layer/focus trap. Reversible.
- **Release-held copy**: design gives no drawer-specific held copy; uses the host's safe sentence + existing prototype notice sentence, heading "Held for release authorization". Never claims subscription authorization. Explanation appears once a `release-held` result arrives (the webview cannot know the hold earlier). Reversible; flag for Batch 35 review.
- **Pending locks Profile actions** (rename/default/remove disabled with "Finish or cancel sign-in before changing this profile.") to honour "pending Cancel only" and "busy/live-route action explains exclusion". Reversible.
- **Unavailable resume** shown in Overview when `activeRunCount > 0` and state is not `signed-in`; no chooser. Reversible.
- **Refresh status** (`btn-ghost`) added in every non-pending state as the status intent; design table lists only the primary control. Reversible.
- Toast is rendered inside the drawer's live region (drawer has no toast service); Batch 33 may additionally show a page toast with `ACCOUNT_DEFAULT_TOAST`.

Open: light-theme focus-ring token (D35 carry-over) stays with Batch 33; rendered Electron dark/light evidence remains held.
