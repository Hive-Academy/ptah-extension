# Design spec P5 (revision 1): Claude accounts inside the connection drawer

Prototype: `prototype/p5/index.html` (state switcher, theme switcher, launch-result and write-result simulators; `?s=<state>&t=dark|light` deep links; `compare.html?s=a,b,c` renders dark and light side by side). Screenshots in `prototype/p5/` (dark left, light right in every row): `sheet1-ambient-states.png` (a1 connected, a2 not signed in, a3 unknown, a4 connected-after-check), `sheet2-named-states.png` (n1 signed out, n3 fallback, n4 signed in with selections, n5 failed), `sheet3-selection-add-remove.png` (sr refused, sm unavailable stored selection, ae add duplicate-name error, rc remove confirmation), `sheet4-pending-rename-narrow-zoom.png` (a4 Checking, sp selection pending, rename error, 360px). `sheet5-add-error-remove-reflow.png` (ae and rc after a focus fix, 245px and 320px reflow). Known artefacts: in sheet4 the rename row shows a stray word "false" and the last row is a bad zoom attempt; both were fixed in `index.html` afterwards and sheet5 supersedes them. States n2, n6, su, st, le, nr are in the switcher and were not photographed.

Tokens: the app's DaisyUI themes in `apps/ptah-extension-webview/tailwind.config.js`: dark = `anubis`, light = `anubis-light`. The prototype uses their real values (oklch converted to hex). Developers use the existing classes (`surface-2`, `btn`, `badge`, `text-state-*`, `base-content-muted`).

## 1. What changes

| Today | P5 |
|---|---|
| "Accounts" section on the base Providers page | Removed from the base page. It is a new **Accounts** tab of the "Claude (Subscription)" drawer. The base card is unchanged (no count link; see Decision 9) |
| Two routing cards both reading "Use existing default" plus Change dialogs | One **Use for** block with two labelled native selects: "New chats", "Claude lanes". Row chips show "Used for: ..." |
| Ambient login not listed | **Existing Claude login** is the first row, with a real read-only status (Connected, Not signed in, Could not check, Checking) |
| Separate account drawer; Manage always opens Overview | Account detail is a view inside the same drawer. It opens on Access unless the account is signed in, then Overview (account Manage only; connection-card Manage still opens connection Overview) |
| Separate "Set as default" action | Removed by user decision (D40.2). The two selects replace it |
| Profile UUID, "Unknown owner", "Verified identity", UUID suffixes | Removed everywhere (D40.3, D40.4). Names are unique, so rows are told apart by name |
| Add dialog | Inline add form with uniqueness and safe-label validation. Add never signs in and never selects |

## 2. Component mapping and tabs

- `connection-kind.ts` (`connectionDrawerTabs`): for kind `claude-cli` add tab id `accounts` after Overview & Used By. Resulting tabs: Overview & Used By, Accounts, Credentials, Models & Tiers. No Advanced tab. Existing tab bodies (Used By, Credentials, Models & Tiers) are unchanged. Electron only: the tab is absent when the state owner is inert (same gate as today).
- Labels are the existing full labels. The tab strip uses `flex-wrap`: at 520px it fits on one line; below that (prototype checked at 360px, 320px and 245px) tabs wrap onto a second line; no label is truncated or ellipsised. At 200% text zoom (effective 245-260 CSS px) the drawer reflows the same way and the body scrolls vertically; there is no horizontal scroll.
- Existing "reset connection tab on connection change" effect stays. Opening the drawer from the card always starts on Overview. No deep link from the card.
- New `accounts-tab.component` hosts: `use-for` (two native selects, reworked from `account-chooser`), the ambient row, the account rows (reworked `accounts-section` card), the inline add form (replaces `add-account-dialog`) and the in-drawer detail view (body of `account-details-drawer`; its own `ptah-native-drawer` wrapper is dropped).
- The Accounts tab is a labelled region (`aria-labelledby` the "Use for" heading, `aria-busy` while any read is in flight). The accounts state service subscription lives for the drawer's lifetime, not the view's, so host pushes keep arriving across list/detail switches.
- Load: opening the Accounts tab calls the existing `provider:listAccounts` (via `accounts.open`), and the ambient status read in parallel. Nothing loads before the drawer opens. That is why the card has no count.

## 3. States and layout

### 3.1 Accounts tab, top to bottom
1. `h3` "Use for" + muted line "Pick which account each kind of session uses. Changes apply to new sessions only. Credentials stay on this computer." + muted line "This applies only while Claude sign-in is your main route. If you chose another provider as the main route, that provider stays in effect."
2. Stale or error notice when present (3.7).
3. Select "New chats" (hint: "The account your next main chat uses.") and select "Claude lanes" (hint: "The account the next Claude lane uses.") with a per-select live message line.
4. Polite live toast region.
5. `h3` "Accounts"; list (`role=list`, label "Claude accounts"): the ambient row first, then named rows signed-in first, then others in host order.
6. "Add another account" button or the add form.

Select options: Existing Claude login first (always enabled; suffix " (not signed in)" or " (status unknown)" when the ambient status says so, never inferred), then signed-in named accounts, then other named accounts disabled with " (sign in first)". The selected value is exactly the stored value.

### 3.2 Ambient row ("Existing Claude login")
Avatar "E", bold name, line "The Claude login already on this computer. Ptah only reads its status here.", status line, "Last checked ..." hint, assignment chips, button "Check again" (aria-label "Check the existing Claude login again"). No class word, email, organization, path or action other than Check again. No Manage, Sign in, Sign out, rename or remove.

| Ambient state | Status text and dot | Extra text | Check again |
|---|---|---|---|
| Connected | "Connected", `state-done` dot | "Last checked 2 minutes ago" | enabled |
| Not signed in | "Not signed in", `state-need` dot | "Sign in with the Claude CLI in a terminal. Ptah does not manage this login." | enabled |
| Could not check (unknown: CLI missing, timeout, unreadable) | "Could not check", `state-idle` dot | "The status could not be read. The Claude CLI may be missing or did not answer in time. This does not mean you are signed out." plus "Last check failed 2 minutes ago" | enabled |
| Checking | spinner + "Checking..." (`role=status`) | no timestamp | disabled |

Never show Connected from CLI presence or from the ambient being selected. A positive result older than the host's freshness window (Backend needs) shows its age in the hint; opening the tab and Check again both request a fresh read. Connected is never shown while Checking.

### 3.3 Named account row
Avatar (first letter of the name, rendered as text), name (semibold), dot + state text, "Run binding . N active runs" when N > 0, assignment chips, actions. Whole row body is `role=button`, `tabindex=0`, `aria-label="Account details for <name>"`, Enter/Space opens details (parity). Buttons: "Sign in" (primary; shown for not signed in, failed, cancelled), "Manage" (aria-label "Manage <name>"). Failed and disconnected rows get the 4px `state-err` left border. State labels: Not signed in, Signing in, Sign-in failed, Sign-in cancelled, Disconnected, Signed out, Signed in (host mapping unchanged).

### 3.4 No named accounts (S1)
Ambient row, then the add area: "Add another account" button. No empty-list copy; the ambient row is the list.

### 3.5 Add and rename
- Add: button opens an inline form. Focus moves to the name input. Label "Name this account"; hint "For example: Work, or Team plan. Only you see this name. Each name must be different."; Cancel and "Add account". "Add account" is disabled until the name passes validation (as the current dialog does). Escape or Cancel closes the form and returns focus to "Add another account". Each open starts empty.
- Validation (shared by Add and Rename): the existing `isSafeProviderAccountLabel` rule plus uniqueness. Uniqueness is case-insensitive after trim, against all named accounts (excluding the one being renamed) and the reserved name "Existing Claude login". Inline errors (`aria-invalid`, `aria-describedby`, `role=alert`): duplicate "That name is already used. Names must be different."; unsafe "Use up to 40 letters, numbers, spaces or simple punctuation (no slashes or angle brackets)." (the real unsafe-label message is reused from the validator; the prototype's wording is a stand-in). Host refusal (including a host-side duplicate) shows the safe host sentence in the same alert slot, input keeps its value.
- Add pending: button reads "Adding...", form inputs disabled, `aria-busy`.
- Add success: the new account's detail view opens on Access (state Not signed in) with a "Sign in" button, focus on the account heading, toast "Account added. It is not selected for any new chat or lane." The account is never selected for either scope and sign-in is never started automatically.
- Rename (Profile tab): same field rules, "Save name" disabled until valid and changed; result "Name saved." in the live region; refusal in the alert slot.

### 3.6 Account detail
Header: "All accounts" back link, `h3` account name (tabindex -1, receives focus on open), dot + state. Inner tabs (roles, 3 tabs): Overview, Access, Profile.
- Overview: State; "Running now": "N active runs use this account. Signing out or removing it does not change running work. Resuming those runs may be unavailable." or "No runs are bound to this account."; resume-unavailable notice when applicable. No UUID, owner or identity.
- Access (per state):
  - Not signed in / signed out: "This account is not signed in yet." Primary "Sign in", "Check status".
  - Signing in, window opened: note "Finish sign-in in the Claude window" (spinner, `role=status`), "Cancel sign-in", "Check status". The link "Window did not open?" is not shown.
  - Signing in, fallback available: only when the host returned a fallback script for this operation (response-only contract, while pending). Note "Sign in from a terminal" with the script as text in a focusable (`tabindex=0`, `role=region`, label "Sign-in script") `pre`, "Copy script" (result "Copied" in a polite live region), "Check status", "Cancel sign-in". Once the operation is terminal or the script is absent, the block disappears; the UI never invents or rebuilds a script.
  - Failed: alert "Sign-in did not finish" + the safe host reason, "Try again", "Check status".
  - Cancelled: note "Sign-in was cancelled. The account is still saved but not signed in." "Sign in".
  - Disconnected: alert "This account was disconnected. Sign in again to use it." "Sign in".
  - Signed in: "Signed in. Credentials stay on this computer and are never shown here." "Sign out" (destructive style), "Check status".
  - Neutral unavailable result (host returns no usable state): "The status is not available right now." with Check status; actions stay visible.
- Profile: rename form; "Remove account". While Signing in, name and removal are locked with text "Sign-in is in progress. Name and removal are locked until it finishes or is cancelled." Busy rule: see 3.7 (one rule for the whole tab). While an account-detail action runs, a polite status says "Working..." and the result is announced. The notice "Resume unavailable..." appears only for bound runs on an account that is not signed in (inventory row 55); it does not appear for rename or for signed-in accounts.
- Remove: opens a modal `alertdialog` "Remove <name>?" with copy "This removes the account from Ptah. Running work is not changed. You can add it again later and sign in again." Buttons Cancel (initial focus) and Remove. Tab/Shift+Tab cycle only these two, Escape and Cancel close and return focus to the "Remove account" button. After removal: list view, focus on "Add another account", toast "Account removed."; any scope that pointed at it shows the unavailable state until the host's new selection arrives.

### 3.7 Selection and snapshot states
- **Busy rule (single, applies to rows 68 and the whole tab).** (a) A selection write disables only that scope's select (`disabled`, `aria-busy`, message "Saving..." in its status text); the other select and every account action stay usable. (b) An account-detail action (Sign in, Cancel sign-in, Check status, Sign out, Save name, Remove) disables all account-detail actions of that account while it runs; other accounts and both selects stay usable. (c) The control holding focus is never left disabled without moving focus: focus moves to a stable element (the select's status text, or the detail's live status; both `tabindex=-1`) and returns to the originating control, or its replacement, when the write finishes.
- Selection pending: see the busy rule; message "Saving..." (polite).
- Saved: value kept, chip moves, toast "<New chats | Claude lanes> will use <name> for new sessions." Shown only after the host reports success.
- Refused: select reverts to the stored value; alert with the safe host reason, or the fixed fallback "Could not change this setting. That account is not available for Claude lanes right now."
- Unconfirmed: the select and the "Used for" chips keep showing the last authoritative host snapshot; the attempted value is never applied. The existing unconfirmed-write warning is shown (not "Saved"): "This action may not have completed. Accounts were reloaded." (existing state-service wording; the service starts an automatic refresh). When the next host snapshot arrives, select, chips and warning reconcile to what it reports. If that read fails, the stale-snapshot note with "Try again" applies. No "reload" instruction is shown.
- Omitted or explicit ambient selection (a supported wire value, `provider-account.types.ts:214-220`): the select shows "Existing Claude login" selected and the chip "Used for" sits on that row, matching `accounts-section.component.ts:720`. Nothing is written implicitly and no choice is forced; a never-configured scope behaves as in state S1.
- Stored selection unavailable (only a named selection whose account no longer exists, or an invalid value): select shows a disabled placeholder "Unavailable account - choose another" selected, message "The stored account is no longer available. Choose another account. Ptah does not switch to the existing login for you." Routing behaviour is unchanged by this copy.
- Stale snapshot: note "Showing the last loaded accounts. The latest refresh failed." + "Try again". First-load failure: alert "Accounts could not be loaded." + "Try again" (existing copy preserved where it exists). Loading: "Loading accounts..." / "Accounts load when a workspace is open." with Add disabled until a snapshot exists.

## 4. Copy table

Tabs: Overview & Used By . Accounts . Credentials . Models & Tiers. Accounts tab: Use for . New chats . Claude lanes . hints in 3.1 . Existing Claude login . "The Claude login already on this computer. Ptah only reads its status here." . Connected . Not signed in . Could not check . Checking... . "Check again" . "Last checked <relative>" . "Last check failed <relative>" . CLI sign-in help (3.2) . "Used for: New chats" . "Used for: Claude lanes" . "Add another account" . "Name this account" . hint and errors (3.5) . "Add account" / "Adding..." . "Cancel" . "All accounts" . Overview / Access / Profile . "Sign in" . "Try again" . "Sign out" . "Cancel sign-in" . "Check status" . "Copy script" / "Copied" . "Finish sign-in in the Claude window" . "Sign in from a terminal" . "Save name" . "Name saved." . "Remove account" . dialog copy . toasts in 3.5-3.7 . selection messages in 3.7.
Retired from user copy: profile id, UUID suffix, owner, "Unknown owner", "Verified identity", "Use existing default", "Set as default", "profile", "route" (only the plain-words qualification above remains), "One extra account for now", "Nothing was changed", "No changes were made", "Add and sign in".
Rule for outcomes: say what the host returned (saved, refused with the safe reason, unconfirmed). Never promise that nothing changed.

## 5. Accessibility (demonstrated in the prototype unless marked)
- Drawer keeps `ptah-native-drawer` (trap, Escape, return focus to the opener). Prototype checked: on open focus is on the drawer title.
- Both tab strips: `role=tablist` with label ("Connection sections", "Account sections"), tabs `role=tab` with `aria-selected`, `aria-controls` -> panel, panel `role=tabpanel` `aria-labelledby` its tab, roving tabindex (only the selected tab has `tabindex=0`), ArrowLeft/ArrowRight wrap, Home/End, automatic activation. Checked in prototype: ArrowRight, Home, End move focus and selection.
- Focus: Manage / row open -> focus on the account `h3` heading (checked). All accounts -> focus returns to that account's Manage button (checked). Add open -> name input; Cancel/Escape -> "Add another account". Add success -> new account heading. Select write -> focus stays on that select. Remove: dialog opens with focus on Cancel, Tab cycles Cancel/Remove, Escape returns to "Remove account" (all checked).
- Live regions: status text and toasts `role=status` / `aria-live=polite`; refusals and validation `role=alert`. Spinner `aria-hidden`, stops under `prefers-reduced-motion`. Status is dot + text, never colour alone.
- Labels, names and scripts are rendered as text nodes only (the prototype builds DOM with `textContent`; no `innerHTML` with user text). The developer must use Angular text binding, never `[innerHTML]`.
- Focus ring: 2px `base-content` outline, 2px offset. Targets at least 30px high (rows 34px).
- Contrast measured on the real theme tokens (WCAG 2.2 AA, 4.5:1 text, 3:1 non-text; the project states none). Dark (anubis): body 14.86 on base-100, 13.89 on base-200; muted 6.05 / 5.65 / 5.00 on base-300; primary button text 4.82; state ink dots on base-100/200: done 5.62/5.25, need 6.61/6.18, err 4.92/4.60, run 5.04/4.71. Light (anubis-light): body 15.92 / 14.21; muted 6.04 / 5.39 / 5.01; primary button text 6.81; ink dots: done 5.71/5.09, need 5.83/5.21, err 6.12/5.47, run 6.07/5.42. All pass. Raw `success`/`warning`/`error` are NOT used for dots or text (they fail: light success 2.37, error 3.57 on base-100). Status and error text use `base-content`; colour lives in the dot and the border spine. Contrast was computed with a script from the oklch/hex values in `tailwind.config.js`; the muted tier uses the config's `--bcm`.
- Not verified (state honestly): native `select` open-list styling under Electron, screen-reader announcement order, `ptah-native-drawer` internal trap with the nested modal. The visual-reviewer should check these in Electron.

## 6. Parity disposition (74 rows, numbered as in the review)

K = kept, M = moved (new place), R-D39/R-D40 = removed by user decision. Anything not marked R is kept.

| # | Capability | Disposition |
|---|---|---|
| 1 | Base-page mount | M: Accounts tab (D39.1) |
| 2 | Electron-only gate | K: tab absent and no RPC when state owner inert |
| 3 | First-render load | M: loads when the drawer's Accounts tab opens; card makes no read |
| 4 | Host-pushed snapshots | K: subscription lives for the drawer lifetime |
| 5 | Heading and credentials-stay-local intro | M: "Use for" intro line and "Accounts" heading carry it |
| 6 | Loading copy; Add disabled without snapshot | K, 3.7 |
| 7 | First-read failure + Retry | K, 3.7 |
| 8 | Stale snapshot + Retry | K, 3.7 (state `st`) |
| 9 | aria-busy, labelled region | K, 2 |
| 10 | Toast region for add/select/remove/unconfirmed | K (default toast removed with the action) |
| 11 | Two scope cards | M: two selects + chips |
| 12 | Duplicate ambient card copy | R-D40/D39.2: replaced by one ambient row |
| 13 | Main API-route note | K, plain words under "Use for" |
| 14 | Routing UUID suffix | R-D40.3 |
| 15 | Unavailable named selection; omitted/ambient shows Existing Claude login | K, 3.7 (placeholder only for a missing named account) |
| 16 | Per-scope Change buttons | M: each select |
| 17 | Chooser modal + "changes only the selected future route" | M: select hint "Changes apply to new sessions only" |
| 18 | Ambient option always available | K |
| 19 | Signed-in first ordering, disabled unsigned | K |
| 20 | Chooser UUID suffix | R-D40.3 |
| 21 | Current selection, nothing implicit | K: selected value is the last authoritative stored value; omitted/ambient = Existing Claude login, never forced (3.7) |
| 22 | Chooser empty copy | M: S1 ambient row + add area |
| 23 | One-scope write, pending, refusal, unconfirmed | K, 3.7 (unconfirmed keeps authoritative value) |
| 24 | Selection success toast | K, after host result only |
| 25 | Chooser keyboard / cancel / focus | M: native select; focus stays on select |
| 26 | Empty-list explanation | R-D39.2: the ambient row is always listed |
| 27 | Labelled list, one card per account | K |
| 28 | Ambient row | New (D39.2), with real status (D40.1) |
| 29 | Initials avatar | K, text-rendered |
| 30 | Label | K |
| 31 | Full card UUID | R-D39.4 |
| 32 | State dot + text, all states | K, 3.3 |
| 33 | Attention spine failed/disconnected | K |
| 34 | Owner badge (Unknown owner / Verified identity) | R-D39.4 / R-D40.3 |
| 35 | Next main / Next lane badges | M: "Used for" chips |
| 36 | Active-run count badge on list | K |
| 37 | Whole-card keyboard button | K |
| 38 | Manage button, one open | K |
| 39 | Add button | M: Accounts tab; no count cap (D40) |
| 40 | Add validation, max length, disabled until valid | K + uniqueness |
| 41 | Add writes label only, never selects | K (D40: no chained sign-in) |
| 42 | Add pending / refusal | K, 3.5 |
| 43 | Add focus, empty on open, close | K, 3.5 |
| 44 | Native account drawer with account name | M: in-drawer detail with heading focus |
| 45 | Account tabs keyboard, hidden panels | K, 5 |
| 46 | Overview on every open | Changed: Access unless signed in (D39.3, account Manage only) |
| 47 | Return focus, Escape; close does not cancel | K: closing the drawer never cancels a sign-in |
| 48 | Polite feedback for action/rename | K, "Name saved." etc.; default feedback removed with the action |
| 49 | Safe refusal alert for all actions | K for rename, remove, select, add, sign in/out |
| 50 | Neutral unavailable result | K, 3.6 |
| 51 | Overview UUID | R-D39.4 |
| 52 | Overview state row | K |
| 53 | Overview owner block / explainer | R-D39.4 / R-D40.3 |
| 54 | Active-run count + unchanged-work note | K |
| 55 | Resume-unavailable notice | K |
| 56 | No-bound-runs notice | K |
| 57 | Access state heading/detail | K, all states in 3.6 |
| 58 | Sign in / again / retry | K |
| 59 | Pending window instructions | K |
| 60 | Cancel sign-in | K |
| 61 | Sign out (signed-in only) | K |
| 62 | Non-pending status refresh | K: "Check status" on every Access state |
| 63 | Host fallback script, copy, status | K, only when the host returned a script |
| 64 | Pending profile lock | K |
| 65 | Rename + result | K |
| 66 | Atomic both-scope "Set as default" | R-D40.2 (user decision; two selects replace it) |
| 67 | Metadata-only remove with confirmation | K, modal confirmation |
| 68 | Busy: per-scope select write; per-account detail actions; focus moved to stable status | K, single busy rule in 3.7 |
| 69 | No identity or secrets in detail | K |
| 70 | Unconfirmed write warning | K, never "Saved"; last authoritative selection/chips kept; reconcile on next snapshot |
| 71 | Connection tabs by kind | Changed: Accounts added; no Advanced; other tabs unchanged |
| 72 | Reset connection tab on connection change | K |
| 73 | CLI detection / login command / Check again | K (Credentials tab unchanged). CLI detection is not account authentication |
| 74 | Open drawer from Providers | K: Manage opens Overview; no count link |

Inventory section 8 (missing fixtures/reachability) are test needs, unchanged. Section 9 (lane header/session labels, state-service RPC contracts) is out of scope and intact.

## 7. Lane-introduced constraints (all tagged `[lane-proposed]`)

1. Accounts is the second tab, not a section of Overview; detail is inside the same drawer; add is inline; selects are native `select`.
2. Names must be case-insensitively unique and cannot equal "Existing Claude login" (consequence of D40.3; user-approved concept, wording ours).
3. Ambient row shows no management actions; it is read-only by user wording ("Ptah does not manage this login").
4. Options for unsigned or unavailable choices are disabled with a reason (inherited, not new).
All other earlier lane proposals (Advanced tab, count cap, chained sign-in, card count link, "Set as default" removal as our idea) are withdrawn or now come from D39/D40.

## 8. Backend needs

1. **Ambient status read (new, read-only).** A dedicated host read, not a call to `ClaudeAccountCommand.status()` with a fake profile (its reserved-route guard stays). Suggested RPC `provider:getAmbientClaudeStatus` with params `{ refresh?: boolean }`, result `{ state: 'connected' | 'signed-out' | 'unknown'; checkedAt: string /* ISO */; reason?: 'cli-missing' | 'timeout' | 'unreadable' }`. Bounded by a timeout, results cached for a short freshness window; `refresh: true` bypasses the cache (the "Check again" button; also sent on opening the tab). The UI-only `Checking` state is local. Returns no raw CLI output, email, organization, account class, config path or credentials. A failed or timed-out probe must return `unknown`, never `signed-out`, and never reuse a previous Connected as a new check.
2. **Names unique.** The host must enforce uniqueness (case-insensitive, trimmed, reserved name) in `provider:addAccount` and the rename operation, returning a safe refusal sentence; the UI check is only a convenience.
3. **Fallback script.** No change: the script stays response-only while the operation is pending.
4. **Selections.** No change to `provider:setAccountSelection` (single scope per call). The removed "Set as default" RPC can stay unused or be deleted by the architect.
5. No account-count cap and no list pre-load for the card.

## Decisions

1. **Accounts as a connection-drawer tab** (not Overview, not Advanced). Evidence: D39.1, `connection-kind.ts` tab mapping. Reversible.
2. **Detail inside the same drawer** (no stacked drawers): one focus trap. Reversible.
3. **Two native selects** with chips. Evidence: D39.2 confusion over two identical cards. Reversible.
4. **"Set as default" removed.** Source: D40.2 (user). Two selects write each scope; no atomic both-scope action remains.
5. **Ambient row with a real status** from a new read-only host check (D40.1). Unknown is its own state and is never shown as signed out; "Not signed in" shows help only, no management.
6. **Verified identity, UUIDs, Unknown owner removed** (D40.3, D40.4); names unique and validated inline.
7. **No account-count cap; Add does not chain sign-in** (D40 orchestrator): after Add the new account opens on Access with a Sign in button and is never selected.
8. **Manual terminal fallback only when the host returned a script** (D40). Evidence: response-only contract, review finding 4.
9. **No count link on the base card.** Options: link with pre-load count; no link. Counts would need accounts to load before the drawer opens, which the review said not to invent; the card stays as is. Reversible.
10. **No "Nothing was changed" copy.** Outcomes use the host result (saved / refused with reason / unconfirmed).
11. **Status uses the app's `state-*` ink tokens for dots**, text in `base-content`; raw semantic colours fail contrast in the light theme.
12. **Remove uses a modal confirmation** with Cancel as initial focus; chosen for destructive-action safety. Reversible.
14. **Revision 2 (final round).** R1: omitted/ambient show "Existing Claude login"; only a missing named account is unavailable (fixture `om`). R2: unconfirmed writes keep the authoritative selection and chips, reuse "This action may not have completed. Accounts were reloaded.", reconcile on the next snapshot. R3: one busy rule in 3.7 with focus moved to a status element. R4: prototype rename re-reads and re-validates at submit. R5: prototype shows "Resume unavailable" only for non-signed-in bound runs (fixture `nu`). Rows 21 and 23 follow 3.7 as revised.
13. **Unsafe-label wording in the prototype is a stand-in**; the developer reuses the real `isSafeProviderAccountLabel` and its messages.
