# Design spec P6: account selectors in chat and lane forms, calm Accounts tab (D52) - revision 1

Prototype: `prototype/p6/index.html` (`?theme=light` for ptah-glass-light; `?solo=<key>` for real-viewport frames). Three LIVE frames are interactive.
Screenshots: `prototype/p6/shots/<id>-dark.png` / `-light.png` (ids M1-M8, L1-L6, A1-A19; real-viewport `r-<key>-<width>[z200]-<theme>.png`).
Harnesses: `capture.mjs` (frames, `--solo` real viewports), `contrast.mjs` (pairs), `smoke.mjs` (keyboard/focus checks). Static mock, no source edited. Lane-introduced constraints: `prototype/p6/README.md`.
Tokens: `apps/ptah-extension-webview/tailwind.config.js:225-313` (ptah-glass, ptah-glass-light). Status ink: `--state-ink-*` via `bg-state-*` (same lines).

## Principles

- Account choice lives where work starts (main chat form, Claude CLI lane). The Accounts tab lists and manages.
- A selector exists only when there is a choice. Only the existing login: no select, no cell, zero text.
- Prefer labels, icons with `aria-label`/`title`, `sr-only` text, disabled states and toasts over sentences. Zero visible helper sentences in any normal state.
- Confirmations and errors are the existing toast (`SettingsSaveFeedbackService` / `ptah-settings-toast`: `role=status` polite, `role=alert` for errors, `settings-toast.component.ts:46-56`). The toast regions are persistent elements whose text changes (that is what makes the announcement happen); they are never created already filled.
- Spacing: drawer tabs use `space-y-4 text-sm` (`connection-drawer/overview-tab.component.ts:156`); P6 uses `text-sm`, `space-y-6` between blocks, `space-y-3` between rows, row `px-4 py-3`. The block gap must reach the list: no inline `margin` on the `ul` (the `space-y-6` top margin is the 24 px under the heading row).

## Decisions

| # | Decision | Options | Evidence | Reversible |
|---|---|---|---|---|
| P6-1 | Main-chat Account select appears only when a signed-in named account exists OR the stored selection is named (including absent/removed). Otherwise absent. | always; hide | D52 zero noise | yes |
| P6-2 | (Revised) Options: ambient first, signed-in named accounts enabled, other named accounts listed **disabled** as "{name} (sign in first)" (parity `AP:94-101`). Option text is the only copy; no sentence. | omit unusable | parity-inventory-p6 §1 "Named options" says keep; a native `<select>` shows them only when opened | yes |
| P6-3 | Stored selection that is not usable stays visible and selected, disabled, never auto-reassigned (B-1). Two distinct states: **signed out** (profile exists, state not signed in): "{name} (not signed in)" plus a `Sign in` text link; **removed** (named id absent from the snapshot): "⚠ Removed account", `aria-invalid="true"`, `aria-describedby` to an `sr-only` sentence. No visible helper sentence in either. | one merged state | `provider-account.types.ts:251-254`: selection is `omitted | ambient | named`; there is no `removed` variant, so "removed" is derived: `named.profileId` not in `snapshot.accounts` | yes |
| P6-4 | Main popover Save is two sequential writes, provider first, then account (contract below). | account first; one RPC | service has only `setSelection(provider, scope, choice)` (revision-checked, `provider-accounts-state.service.ts:383-409`); no atomic provider+account call exists | yes |
| P6-5 | Lane Account cell opens a `role="menu"` of `menuitemradio` buttons (not native radios). Arrow keys move focus only; Enter, Space or click saves and closes. | native radios | native radios select on arrow, which would save on every arrow press; menuitemradio separates move from commit | yes |
| P6-6 | Accounts detail is one flat panel; Profile panel dropped; every retained capability is placed (table below). | 3 tabs | D52 flatten; parity §§3,5 | yes |
| P6-7 | Ambient "Existing Claude login" stays the first list row, "Check" only when not Signed in; its suffix in the selectors comes from the cached ambient read. | hide | D42/B-1 | yes |
| P6-8 | Every named row has an icon-only Manage chevron (`aria-label="Manage {name}"`), always. `Sign in` (`btn-primary`) is added only for not-signed-in/failed/cancelled rows. | Sign in replaces Manage | review finding 1: failed and signed-out accounts must reach rename, remove and terminal fallback | yes |
| P6-9 | After a successful Add, the new account's detail opens (so Sign in and the fallback are one click away), only if the Add form still owns focus and the view is active; otherwise the list shows and the toast announces. | stay on list | parity capability "access controls after add"; B-2 | yes |

**Binding rules D42.** B-1: nothing in these surfaces assigns or changes a selection locally; the select shows the stored value of the last authoritative snapshot, a refused or unconfirmed write re-asserts it, removal never reassigns. B-2: after any async result, focus is restored to the waiting trigger **only if focus is still on it and its view/popover is still active**; otherwise focus stays where the user put it and the toast announces. Specifically: Add moves focus to the new detail heading only when focus is inside the Add form; Remove moves focus to the `Accounts` heading only when focus is on the Remove origin button or the page body (dialog just closed), never when the user has moved to another control; a closed/replaced view gets no programmatic focus. The prototype's LIVE frames implement and `smoke.mjs` exercises these conditions.

## State contract for the selectors (main popover and lane cell)

Source of truth: `ProviderAccountsStateService` (`libs/frontend/core/src/lib/services/provider-accounts-state.service.ts`) and `rpc-provider-accounts.types.ts`. Nothing here needs a backend change; the items marked **frontend** need a small UI-side addition.

1. **Initialisation.** On opening the popover (and when the lane row mounts) call `open('claude')` (idempotent per slot, `:220`) and read the cached ambient view (`ClaudeAmbientStatusService.view`, non-forced). Read `view().status`/`snapshot`/`stale`.
2. **Not ready.** Inert host, no workspace, `idle`/loading, or first read failed (`snapshot === null`): the Account control is absent. The write API returns `unavailable` without a snapshot (`:386-388`), so a visible control could not save. A stale snapshot (`stale: true`) keeps the control and writes against its revision; a conflict is recovered by the refusal path below. The Accounts tab, not the popover, shows load failure (A9/A16).
3. **Draft vs pushed.** Draft account is `dirty` once the user changes the select. While not dirty the select follows the pushed stored selection. While dirty, a pushed change of the stored selection does not overwrite the draft; Save stays enabled when draft differs from the **current** stored value, and one status toast "Account changed elsewhere" is announced. The write sends the snapshot's `selections.main.revision` at click time.
4. **Save sequence (main popover).** Provider write first (existing behaviour). Only if it succeeds, the draft provider is the Claude CLI connection, and the account differs from stored, call `setSelection('claude','main',choice)`. Outcomes: `saved`: close, status toast "Chat uses {name}" (name truncated to 40 chars). `failed` with a safe summary: alert toast with the host sentence, otherwise "Could not save the account. Try again." `unconfirmed` (transport loss or host `timeout`, `:586-598`): the service already re-reads; alert toast "May not have saved. Accounts reloaded." and the select re-asserts the reloaded stored value. `unavailable`: same as failed. Because the provider write already committed, a confirmed failed (or `unavailable`) account write is a **partial success**: the popover stays open, the provider select shows the saved provider, the select re-asserts the stored account (B-1), Save is disabled until the account changes again, and the single alert toast says "Provider saved. Account not saved." (M7). An `unconfirmed` account write is NOT reported as "not saved": only the uncertainty toast "May not have saved. Accounts reloaded." shows, and the select shows whatever the authoritative re-read returns. `named` choices send `expectedProfileRevision` (`:546-558`); `{kind:'ambient'}` is a valid write (the way back to the existing login); only unavailable/disabled options are never written. (Orchestrator correction after `design-spec-p6-review-r1.md`.)
5. **Lane cell.** Same read and outcomes; no provider step. Choosing saves at once; busy shows "Saving…" in the cell (`aria-disabled`, focusable); outcomes as in 4 with toasts "Lanes use {name}" / the alert texts.
6. **Disappearance.** If the stored named profile vanishes from the snapshot, the control shows the removed state (P6-3), nothing is reassigned, and no new toast is needed (the Accounts tab already announces "That account is no longer in the list" when its open detail disappears).
7. **Ambient suffix.** From a ready ambient answer: `Existing Claude login (not signed in)` or `(status unknown)`; `connected` has no suffix; while checking, no suffix.
8. **Release-held / unsupported host.** Inert host: control absent. A refusal with a safe sentence is shown verbatim in the alert toast; the unsafe fallback is "Could not save the account. Try again."
9. **Frontend addition (no backend).** The `Sign in` link in M4a must open the Claude drawer on its Accounts tab (or the account's detail). If the popover has no such navigation output today, add one event on the form; no RPC change.

## Surface 1: main chat provider form (`main-agent-reassign-popover.component.ts`)

Insert after the provider `<div class="grid gap-1">` (line 96-117), only when the draft provider is the Claude CLI connection AND accounts are ready/supported AND P6-1.
Field pattern as Provider: `<label for="main-agent-account" class="block text-[11px] font-semibold text-base-content-muted">Account</label>` and `<select id="main-agent-account" class="select select-bordered select-sm min-h-8 w-full border-base-content-muted bg-base-100 text-xs text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content">` (the file's `SELECT`/`LABEL` constants, lines 27, 32). When the saved account is signed out, the label row becomes `flex items-center justify-between` with a `btn-link`-style `Sign in` (`aria-label="Sign in to the saved account"`, `min-h-6 text-[11px] font-semibold underline`).

| State | Select | Frames |
|---|---|---|
| Only existing login, not Claude, host unsupported, not ready | absent | M1 |
| 2+ accounts | ambient (+suffix), signed-in names, unsigned names disabled "(sign in first)" | M2, M3, M8 |
| Stored account signed out | extra selected disabled option "{name} (not signed in)", `Sign in` link | M4a |
| Stored account removed | selected disabled "⚠ Removed account", `aria-invalid`, `sr-only` description | M4b |
| Busy | `aria-disabled="true"` (stays focusable: the B-2 waiting target; value changes are ignored); Save "Saving…" via `ptahBusyDisabled` | M5 |
| Refused/unconfirmed | select re-asserts stored value; one alert toast | M6 |
| Provider saved, account failed | partial save, see contract 4 | M7 |

`title` on the select carries the full selected name; option text truncates natively.

## Surface 2: Claude CLI lane (`cli-orchestration-matrix.component.ts`, Claude row)

Under the name line (`cli-name-line`, line 321), only for the `claude` row, same visibility rule:
`<div class="mt-0.5 flex flex-wrap items-center gap-1"><span class="text-[11px] text-base-content-muted">Account</span><button class="CELL" ...>`; `CELL` = the file's constant (line 152) with chevron like the Model cell (line 472).
Trigger: `aria-label="Claude account: {value}. Change"`, `aria-haspopup="menu"`, `aria-expanded`, `[title]` = full name, `ptahBusyDisabled` while busy (focusable). Cell text `max-w-[13rem]` truncates; **long names must not push the model/effort cells off the row** (checked at 360/320/260, shots `r-lane*`).
Popover: `ptah-native-popover placement="bottom-start" hasBackdrop backdropClass="transparent"`; body `surface-3 max-w-[calc(100vw-2rem)] rounded-xl p-3 text-xs` width 17rem; header as the Model popover (title `Account`, close button `aria-label="Close"`).
Content: `role="menu" aria-labelledby=<title id>`; each item `<button role="menuitemradio" aria-checked class="mi flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-base-300">` with a 14 px check slot, roving tabindex (checked item `tabindex=0`, others `-1`). Keys: ArrowUp/Down (wrap), Home/End move focus only; Enter, Space, click saves and closes; Escape closes and returns focus to the cell trigger; Tab closes. Disabled items use `aria-disabled="true"` (focusable, not activatable).

| State | Behaviour | Frames |
|---|---|---|
| Only existing login / unsupported / not ready | cell absent | L1 |
| 2+ accounts | cell "Existing Claude login ▾" or name | L2, L3 |
| Stored signed out | cell "{name} (not signed in)"; item checked + disabled; others selectable | L4a |
| Stored removed | cell "⚠ Removed account"; item checked + disabled, `sr-only` explanation in the item | L4b |
| Busy | cell "Saving…", `aria-disabled`, menu closed | L5 |
| Error | alert toast; cell keeps stored value | L6 |
| 360 / 320 / 260 / 245 real viewport, long name | cell wraps under the name, truncates | `r-lane`, `r-lane-open` |

## Surface 3: Accounts tab (Claude (Subscription) drawer)

Card keeps "N connected" (unchanged, `badge badge-ghost badge-sm`).

### List (A1-A5, A16, A18, A19)

```
<div role="region" aria-label="Claude accounts" class="space-y-6 text-sm text-base-content">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h3 tabindex="-1" class="text-[15px] font-semibold outline-none">Accounts</h3>
    <span class="flex items-center gap-2"> [stale: badge "Out of date" + Try again] <button class="btn btn-outline btn-sm min-h-8 FOCUS">Add account</button></span>
  </div>
  <ul role="list" aria-label="Claude accounts" class="space-y-3">   <!-- no inline margin: space-y-6 supplies the 24px gap -->
    <li class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-box border border-base-300 bg-base-100 px-4 py-3 [attention: border-l-4 border-l-state-err]">
      avatar, name block (truncate, title, dot+word, "Used by" chips), actions: [Sign in] [Check] [icon Manage chevron]
```

- Actions: named rows always have the Manage chevron (`icon` button 32x32, `aria-label="Manage {name}"`, `title="Manage"`); `Sign in` (`btn-primary`) precedes it for not-signed-in, failed, cancelled. Ambient row: no Manage; "Check" only when not Signed in. One row is not itself a button.
- "Used by" label/chips omitted when unused. Dot colours `ROW_DOT` (`account-presentation.ts`); dot plus word always.
- Pending: spinner + "Signing in…"; Sign in `aria-disabled`; Manage still works (the fallback and Cancel live in the detail).
- Empty: ambient row and Add; no paragraph.
- Load failure (A9): `role=alert` row "Could not load accounts" + Try again.
- Stale (A16): `Out of date` badge (`role=status`, warning icon) + `Try again` next to Add; the rows stay. Replaces the stale sentence.
- Loading (A19): `aria-busy` list, spinner row "Loading…", Add `aria-disabled`. No workspace: same row, label "Open a workspace". Both replace the two loading sentences.
- Host without named accounts / release-held (A18): Add is `aria-disabled` with `title="Not available on this host"`; activating it shows the host's safe sentence as an alert toast.
- Add (A6): list replaced by label + input + `Add` (`aria-disabled` until non-empty) + `Cancel`. Duplicate/refused: alert toast ("That name is already used." or host sentence), focus stays in input. Success: status toast "Account added" and P6-9. The "not selected for any chat or lane" sentence is dropped: the toast "Account added" plus the select defaults (a new account is never selected) make it implicit.
- Open account disappears by push: status toast "That account is no longer in the list"; the list shows; heading focus only if focus was inside the removed detail.

### Detail (A10-A15, A17), one flat panel

Capability map (every retained parity item, with its minimal-copy home):

| Parity capability | Home | Frame |
|---|---|---|
| Account state | dot + word in the header | all |
| Active runs ("Running now" + count) | `{n} running` `badge badge-ghost badge-sm` next to the state; absent at 0 | A10 |
| Resume unavailable warning | warning-icon `Cannot resume` badge when not signed in and bound runs exist; `title` and `sr-only` carry the full sentence "Runs bound to this account cannot resume until it is signed in again." | A11 |
| Pending completion instruction | state word "Waiting for Claude window" (spinner); completion announced by the toast "Signed in" | A12 |
| Terminal fallback (instructions, script, Copy script, copy status) | `Use terminal` ghost button (`aria-expanded`, shown only when the service holds a fallback script, i.e. pending/failed sign-in) toggles a block: scrollable `pre` (`tabindex=0`, `aria-label="Sign-in script"`) and an icon button `Copy script` (`aria-label`); copy result = toast "Copied" / alert "Could not copy" | A17 |
| Sign in / Try again / Cancel sign-in / Sign out / Check status, busy rule | action row, labels unchanged (`Try again` for failed) | A10-A12 |
| Rename (validated, case-only allowed), `Save` only when edited | `Name` input + Save | A13 |
| Rename and Remove locked while sign-in pending | Name input `readonly aria-disabled` and Remove `aria-disabled`, both focusable, `aria-describedby` an `sr-only` "Locked while sign-in is in progress."; small lock icon (`title`) in the Name label | A12 |
| Remove confirm, Cancel focused, Escape, never reassigns (B-1) | native `<dialog>` (`NativeModalComponent`) "Remove {name}?" Cancel / Remove | A14 (LIVE: real `showModal`) |
| Failed / cancelled / disconnected state | word + attention bar; Manage reachable from the row | A4 |

`← Accounts`, avatar and `h3` name (`title`, truncate), `Name`, actions, `Remove account` (`btn btn-outline btn-sm`, error border). Container `space-y-6 text-sm`. Remove returns focus per B-2.

### Copy (every visible string)

- Main popover: `Account`; `Existing Claude login` (+ ` (not signed in)` / ` (status unknown)`); `{name}`; `{name} (sign in first)`; `{name} (not signed in)`; `⚠ Removed account`; `Sign in`; `Save`; `Saving…`. `sr-only`: "The saved account no longer exists. Choose another account."; aria "Sign in to the saved account".
- Lane: `Account`; `Existing Claude login`; `{name}`; `{name} (not signed in)`; `⚠ Removed account`; `Saving…`; `Close` (aria); aria `Claude account: {value}. Change`.
- Accounts tab: `Accounts`; `Add account`; `Existing Claude login`; `Signed in`; `Not signed in`; `Signing in…`; `Waiting for Claude window`; `Sign-in failed`; `Disconnected`; `Checking…`; `Loading…`; `Open a workspace`; `Out of date`; `Used by`; `Chat`; `Lanes`; `{n} running`; `Cannot resume`; `Sign in`; `Try again`; `Check`; `Account name`; `Add`; `Cancel`; `← Accounts`; `Name`; `Save`; `Sign out`; `Cancel sign-in`; `Check status`; `Use terminal`; `Remove account`; `Remove {name}?`; `Remove`; `Could not load accounts`. Aria/title/sr-only: `Manage {name}`, `Manage`, `Copy script`, `Sign-in script`, `Locked while sign-in is in progress.`, `Not available on this host`, the resume sentence.
- Toasts (status): `Account added`; `Signed in`; `Signed out`; `Sign-in cancelled`; `Status checked`; `Name saved`; `Account removed`; `Copied`; `Chat uses {name}`; `Lanes use {name}`; `Account changed elsewhere`; `That account is no longer in the list`.
- Toasts (alert): `Could not save the account. Try again.`; `Provider saved. Account not saved.`; `May not have saved. Accounts reloaded.`; `That did not work. Try again.`; `That name is already used.`; `Could not copy`; host safe sentences verbatim.
- Removed from P5: Use-for heading and paragraphs, both select helper lines, "Account added. It is not selected...", the ambient description, Overview/Access/Profile tabs and body text, the Rename hint, the Remove explanation, "Overview empty", the signed-in credentials sentence, the stale and loading sentences (replaced by `Out of date` / `Loading…`).

## Widths and zoom (real viewports)

`capture.mjs --solo` loads the page at the real viewport width, so layout is the production-like flow, not a fixed-width frame. Verified `scrollWidth == clientWidth` (no horizontal scroll) for list, detail, main popover, lane row and lane menu with long names (`LONG` = 56 chars) at 360, 320, 245 and 260 css px at device scale 2 (= 200% zoom of the 520 px drawer; `r-*-260z200-*.png`).
Rules: name column `basis-36`, actions wrap under the name left-aligned; every control `min-h-8` (32 px); lane cell wraps under the name and truncates; menus `max-w-[calc(100vw-2rem)]`. Real production popover constraints (the `w-[19rem]` main popover inside the Electron window) are not reproduced by a static page; the visual-reviewer must confirm the main popover and the lane `ptah-native-popover` clipping in the running Electron build at 200% zoom.

## Keyboard and screen reader

- Every select/cell has a `label` or an `aria-label` with the current value. Native select keeps arrow/typeahead. Lane menu: roving tabindex, arrows move focus only, Enter/Space/click commits, Escape and Tab close, focus returns to the cell on Escape and after a save only if focus is still in the menu/cell (B-2).
- Busy is `aria-disabled` (focusable), set before the first await; a repeat activation is ignored; the waiting target is the select or cell itself (it replaces the removed inline "Saving…" line, parity row "Per-scope inline status line").
- Announcements: the persistent `role=status` / `role=alert` regions. The prototype updates their text on each result (cleared, then set after a tick so repeated messages re-announce); 4 s auto-clear. No other live regions.
- Row: Manage has `aria-label`; dot is `aria-hidden`; the word carries state. Remove modal is a real `dialog`: focus on Cancel, Escape closes the dialog only (not the drawer), focus returns to the originating `Remove account` button; after Remove it goes to the heading only under B-2.
- IDs are unique per rendered frame (the gallery generates them), so every label association resolves.

## Contrast (WCAG 2.2 AA: 4.5:1 text, 3:1 UI/non-text and focus indicators)

Measured with `prototype/p6/contrast.mjs` (canvas-resolved colours from the real token values, relative-luminance formula). All PASS.

| Pair (use) | ptah-glass | ptah-glass-light | Need |
|---|---|---|---|
| base-content on base-100 (body) | 15.71 | 15.39 | 4.5 |
| base-content on base-200 (popover) | 14.05 | 14.05 | 4.5 |
| base-content on base-300 (badge, toast, menu) | 12.17 | 12.45 | 4.5 |
| base-content-muted on base-100 (labels, meta) | 13.07 | 6.49 | 4.5 |
| base-content-muted on base-200 | 11.70 | 5.93 | 4.5 |
| base-content-muted on base-300 | 10.13 | 5.25 | 4.5 |
| primary-content on primary (Sign in) | 9.88 | 6.16 | 4.5 |
| state-ink done / idle / run / err on base-100 (dots, bar) | 10.61 / 13.07 / 9.19 / 8.43 | 6.63 / 6.09 / 7.23 / 6.90 | 3 |
| error border on base-100 (Remove, invalid select) | 6.34 | 4.44 | 3 |
| select/input/outline border (base-content-muted) on base-100 / base-200 | 13.07 / 11.70 | 6.49 / 5.93 | 3 |
| focus ring (base-content) on base-100 / base-200 / base-300 | 15.71 / 14.05 / 12.17 | 15.39 / 14.05 / 12.45 | 3 |

Disabled controls (`opacity .55`) are exempt as inactive components; their label stays discoverable via `aria-disabled` and the `sr-only` reason. Status is never colour alone (dot plus word).

## Not in scope / open

- RPC unchanged (D52). No backend change is required by this spec. Frontend-only additions: the sign-in navigation output (contract 9), the removed-state derivation (contract P6-3), the `Out of date`/`Loading…` presentation of states the tab already tracks.
- Toast names interpolate the user's label as text; truncate to 40 characters with an ellipsis.

## Revision 1

Maps `design-spec-p6-review.md` (REVISE 6/10) to fixes.

| # | Finding | Fix |
|---|---|---|
| 1 Serious | Retained capabilities have no destination (fallback script/Copy, active runs, resume-unavailable, pending instruction); Rename/Remove not locked; failed/signed-out rows unreachable; Add stops at list | Capability map under Detail: `{n} running` badge, `Cannot resume` icon badge (+ `sr-only`/`title` sentence), "Waiting for Claude window", `Use terminal` disclosure with script `pre` and `Copy script` icon, Name/Remove `aria-disabled` + `sr-only` lock reason + lock icon (A12). P6-8: Manage chevron on every named row incl. failed/signed-out (A3, A4). P6-9: Add opens the new account's detail under B-2. Loading/stale/host sentences replaced by `Loading…`, `Out of date`, disabled Add (A16, A18, A19). |
| 2 Serious | Prototype is fixtures only; Add never enables; remove "modal" is a div; duplicate IDs; M5 native `disabled`; B-2 unconditional; no toast demo; radio arrow vs save; no README | `index.html` rewritten: LIVE accounts (Add enables on input, Manage navigates, real `<dialog>.showModal`, conditional focus), LIVE main popover (two-step save, failure toggle), LIVE lane (menu, arrows move only, Enter saves, Escape returns focus), persistent live regions with dynamic text, unique generated IDs (smoke test: 0 duplicates), M5/A12 use `aria-disabled`. P6-5 resolves radio vs save with `menuitemradio`. `prototype/p6/README.md` added. `smoke.mjs` verified Add enable, post-Add focus, dialog open/Cancel focus, Escape restore, locked Name/Remove, arrow-no-save, Enter save + focus + toast with 0 page errors. Not verified: real screen-reader speech. |
| 3 Serious | Selector state contract incomplete (ordering, partial success, init, loading, reconciliation, conflict, unconfirmed, ambient suffix, disabled unavailable options, sign-in path, removed vs signed-out) | New "State contract" section (items 1-9) from the service and RPC types; P6-2 revised (disabled "(sign in first)" options); P6-3 splits signed-out (M4a, `Sign in` link) from removed (M4b, derived because `ProviderAccountSelection` has no `removed` variant); M7 partial-save frame; M8 ambient suffix; M4's inaccurate "Sign in again" sentence deleted. Only backend-free frontend additions listed (contract 9). |
| 4 Moderate | Responsive evidence not real; contrast not measured | `capture.mjs --solo` captures real 245/260(z200)/320/360 viewports and asserts no horizontal overflow; long lane names covered (`r-lane`, `r-lane-open`). `contrast.mjs` measures all pairs in both themes (table above). Residual: production popover clipping must be confirmed in Electron. |
| 5 Minor | Inline `margin:0` removed the 24 px heading gap | `ul.rows` has no top margin override; A2 re-captured. |
| Copy audit | M4 had one sentence; failure row is a justified exception | Sentence removed (zero visible helper sentences in any state); A9 retained as the persistent failure row. |

## Decisions (revision 1)

| Decision | Options | Evidence | Reversible |
|---|---|---|---|
| Provider write first, account second | account first | the account selection is stored independently, but a failed provider write must not leave an unexplained account change | yes |
| Failed account write re-asserts stored value (not the draft) | keep draft | parity `UF:163-190` and B-1 | yes |
| Select absent until a snapshot exists | disabled "Loading…" select | a select that cannot save is noise; write API returns `unavailable` without a snapshot | yes |
| Lane menu uses `menuitemradio` | native radios | avoids saving on every arrow press | yes |
