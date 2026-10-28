# Implementation Plan - TASK_2026_719 Phase P6 (account selectors in the chat and lane forms, calm Accounts tab)

Worktree: `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts` (branch `feat/claude-named-accounts`, head
`8e71fb124`). Every path below is relative to that root unless written in full. Abbreviations:
`ACC/` = `libs/frontend/chat/src/lib/settings/providers/accounts/`, `PRV/` = `libs/frontend/chat/src/lib/settings/providers/`,
`PAI/` = `libs/frontend/chat/src/lib/settings/ptah-ai/`, `FB/` = `libs/frontend/chat/src/lib/settings/feedback/`.
Short names follow `parity-inventory-p6.md`: AT accounts-tab, UF account-use-for, AP account-presentation,
AR ambient-account-row, AF add-account-form, DV account-detail-view, MP main-agent-reassign-popover,
LM cli-orchestration-matrix, PS providers-settings, CD connection-detail-drawer, ST provider-accounts-state.service.

## Inputs and constraints

- Requirements used: `decisions.md` D42 (B-1, B-2), D52, D53, D54; `design-spec-p6.md` (approved, incl. Revision 1 and the
  D53 correction of State contract 4); `prototype/p6/index.html` and `README.md`; `parity-inventory-p6.md`;
  `design-spec-p6-review-r1.md` (PARTIAL items become acceptance criteria); `implementation-plan-p5.md` (format).
- Corrections applied: D53 (ambient `{kind:'ambient'}` is a valid write; `unconfirmed` never reads "not saved").
  D54 (all `remove-proposed` copy rows approved except the two flagged existing-login cues, which become a short tooltip
  on the ambient status word that a screen reader also reaches).
- Design handoff used: `design-spec-p6.md` + prototype. Component names below are the designer's surface names; the two new
  units (`ClaudeLaneAccountCellComponent`, the toast announcer inside `SettingsToastComponent`) are named here because the
  handoff names no unit for them.
- Missing decision-critical input: none. Two design-vs-source conflicts are resolved in **Decisions** (P6-A1, P6-A4).
- Backend: **no backend, shared-type or `core` change** (confirmed, see evidence rows 1-5). Only `@ptah-extension/chat` changes.

## Codebase evidence

| # | Evidence | Location | Architectural implication |
|---|---|---|---|
| 1 | One write per scope: `setSelection(provider, scope, choice)` reads the held snapshot **when it is called** (`:390`) and sends that snapshot's `expectedSelectionRevision` (`:407`) and, for `named`, the account's `revision` as `expectedProfileRevision` (`:555`); `unavailable` without a snapshot. It takes **no** caller-supplied revision (three arguments only) | `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts:384-410`, `:543-558` | Both selectors call this; no new service method. A caller that awaits something before calling it must guard the revision itself (Revision 1, P6-A12) |
| 1a | The host rejects a selection write as `conflict` when the scope revision or the named profile revision differs from the expected one | `libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts:376-380` | A local revision mismatch is the same outcome the host would give for a stale write: treat it as a confirmed refusal |
| 2 | `{kind:'ambient'}` is written as is; `named` adds `expectedProfileRevision`; an absent named id yields `null` -> `unavailable` | same file `:543-558` | Ambient is a valid write (D53); only disabled/removed values are never written |
| 3 | Transport loss or host `timeout` -> `unconfirmed` + automatic `refresh` | same file `:586-591` | Selector shows the re-read; never "not saved" |
| 4 | RPC contract `provider:setAccountSelection`, params `scope`, `selection`, `expectedSelectionRevision` | `libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts:234-240`, `:316-318` | Unchanged |
| 5 | Host handler registered; Claude CLI lane reads scope `lane` | `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts:279-280`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:335` | Designer's "no backend change" is **confirmed** |
| 6 | `ProviderAccountSelection` = `omitted \| ambient \| named` (no `removed`) | `libs/shared/src/lib/types/provider-account.types.ts:251-254` | "Removed" is derived: named id absent from `snapshot.accounts` |
| 7 | View `status: inert\|idle\|loading\|ready\|error`, `snapshot`, `stale`; inert when not Electron | `provider-accounts-state.service.ts:44-50`, `:140-146`, `:414-417` | Selector absent unless `snapshot !== null`; VS Code/TUI get nothing |
| 8 | `open()` = mark opened + one list read; `refresh()`; workspace reset re-reads opened slots | same file `:220-230`, `:427-439` | Selectors call `open('claude')` on open/mount |
| 9 | Ambient view `inert\|idle\|checking\|ready`, `read(refresh)` never throws; `read(false)` lets the host answer from cache | `libs/frontend/core/src/lib/services/claude-ambient-status.service.ts:25-29`, `:66-79` | Selectors read `read(false)` only (no forced probe per open) |
| 10 | Existing select model `useForModel` (ambient first, `(sign in first)` disabled, unavailable placeholder) and suffixes | `ACC/account-presentation.ts:48-118`, `:68-77` | Replaced by a per-scope selector model with signed-out vs removed states |
| 11 | `orderedAccounts`, `validateAccountName`, `connectedAccountCount`, `STATE_LABEL`, `ATTENTION_STATES` | `ACC/account-presentation.ts:24-41`, `:144-150`, `:168`, `:263-278` | Reused unchanged |
| 12 | DOM re-assert + B-2 pattern on a select | `ACC/account-use-for.component.ts:163-190`, `:206-225` | Pattern reused in MP; UF itself is deleted |
| 13 | Page toast: `announce(message, tone)`, 8 s auto-clear, provided by `SettingsComponent` | `FB/settings-save-feedback.service.ts:52`, `:65-66`, `:208-210`, `:219-227` | The one feedback path for P6 |
| 14 | `ptah-settings-toast` renders its `role` element inside `@if (feedback.toast())`, i.e. **created already filled** | `FB/settings-toast.component.ts:31-56` | Conflicts with design principle "persistent regions" and review-r1 item; fixed here (P6-A1) |
| 15 | `SettingsSaveRequest.successMessage` replaces the default "Saved {label} to {scope}." | `FB/settings-save-feedback.service.ts:20-21`, `:121` | Lets one model/effort toast also carry the account confirmation (P6-A2) |
| 16 | `ptahBusyDisabled` sets `aria-disabled`, keeps focus, blocks click/mousedown/keydown/change/input in capture | `FB/busy-disabled.directive.ts:33-41`, `:59-70` | Busy select/cell/buttons stay focusable: the B-2 waiting target |
| 17 | MP: provider field `PRV/main-agent-reassign-popover.component.ts:96-132`; `SELECT`/`LABEL` constants `:27`, `:32`; `save()` provider-then-model/effort with `session` guard `:485-510`; `busy`/`saveReady` `:358-366`; open effect resets drafts `:369-377`; output `closed` `:238` | listed | Account field inserted after the provider block; save sequence extended |
| 18 | Claude CLI connection = `connectionKind(c) === 'claude-cli'` | `PRV/connection-drawer/connection-kind.ts:36-40`; PS `isClaudeCli` `PRV/providers-settings.component.ts:578-580` | Same predicate gates the main Account field (consistent with the card badge) |
| 19 | PS gates account services on Electron: `accountsAvailable = inject(VSCodeService).isElectron`, conditional injects | `PRV/providers-settings.component.ts:562-569` | MP and the lane cell copy this pattern |
| 20 | PS mounts MP with `(closed)`; `openDrawer(id)` stores `drawerOpener`; close restores focus only if `isConnected` | `PRV/providers-settings.component.ts:114-119`, `:1161-1172`, `:975`, `:1216` | Sign-in route needs a connected opener |
| 21 | CD resets `activeTab` to `'overview'` on every connection change; tabs filtered by `accountsAvailable` | `PRV/connection-detail-drawer.component.ts:184-196`, `:259-265`; Accounts tab body `:85-86` | Needs an `initialTab` input for the Sign-in route |
| 22 | LM row: name line `PAI/cli-orchestration-matrix.component.ts:321-341`; `CELL` constant `:152`; model cell popover pattern `:447-492`; `SystemCliMatrixRow.cli/installed` `PAI/cli-matrix-rows.ts:74-77` | listed | Lane cell goes under the Claude row's name line |
| 23 | Popover styling (`surface-3 ... rounded-xl p-3 text-xs`, h3 title, Close) | `PAI/cli-model-effort-popover.component.ts:111-130` | Lane menu body copies it |
| 24 | `NativePopoverComponent` inputs `isOpen`, `placement`, `hasBackdrop`, `backdropClass`, `keepInViewport`; outputs `opened`, `closed`; Escape emits `closed` | `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:162-215`, `:447-455` | Lane menu host |
| 25 | AT B-2 helpers `captureWait`/`stillWaiting`/`focusAfterRender`/`untouchedSince` | `ACC/accounts-tab.component.ts` (end of class, `captureWait` .. `untouchedSince`) | Kept; fallback target changes from the old toast `<p>` to the heading |
| 26 | DV inputs `account, accounts, operation, fallback, busy, refusal, feedback, initialTab`; outputs `back, signIn, cancelSignIn, signOut, checkStatus, rename, remove`; `release-held` derived from refusal code | `ACC/account-detail-view.component.ts:337-361`, `:412-418` | New flat contract below drops `refusal`, `feedback`, `initialTab` |
| 27 | The webview e2e harness serves no `provider:listAccounts`/`getAmbientClaudeStatus` and has no Use-for selector; only the drawer tab list mentions Accounts | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-providers.e2e.spec.ts:62-65` (grep of `scenarios/` for `account`, `listAccounts`, `use-for`) | Selectors stay absent in e2e; harness not in the verify list |
| 28 | Specs that assert the toast card `role` | `FB/settings-toast.component.spec.ts:66-67,90,122,134,362`; `PRV/connection-drawer/models-tiers-tab.component.spec.ts:126,158` | Move those assertions to the persistent regions |

## Architecture decision

- **Chosen approach.** Frontend-only change in `@ptah-extension/chat`, in four slices:
  1. Pure rules in AP: a per-scope **selector model** (absent / options / stored state: ambient, named, signed-out, removed),
     the outcome-to-toast mapping, the 40-char toast name, "Used by" chips, the ambient status word + tooltip, and every P6
     string. Added first, old exports deleted last, so every commit compiles.
  2. **Selectors where work starts**: an `Account` select inside MP (draft, saved by MP's Save after the provider write)
     and a new `ClaudeLaneAccountCellComponent` (cell + `role="menu"` of `menuitemradio`, saves on commit) rendered on the
     LM Claude row. Both read `ProviderAccountsStateService` + `ClaudeAmbientStatusService` and write `setSelection`.
  3. **Calm Accounts tab**: AT without Use-for, flat DV, AR/AF without helper copy; all confirmations and errors through
     `SettingsSaveFeedbackService.announce`.
  4. **Persistent announcer** in `SettingsToastComponent` (always-present `role=status`/`role=alert` regions; clear, then set
     after a tick), so every toast in P6 (and the rest of Settings) is announced reliably.
- **Rationale.** D52 places choice at MP/LM and asks for toasts instead of inline lines; ST already exposes the exact write
  (evidence 1-3); the page toast already exists and is reachable from the drawer (the drawer is a manual popover, not a
  modal: `libs/frontend/ui/src/lib/native/drawer/native-drawer.component.ts:69`, `:291`).
- **Rejected alternatives.**
  - Keep AT's own `accounts-tab-toast` region and add regions to MP/LM: three announcer implementations, and MP/LM already
    use the page toast (`PAI/cli-orchestration-matrix.component.ts:1251`). Loses.
  - One shared "selection controller" service for MP and LM: MP is a draft saved with other fields, LM saves on commit; only
    the pure model and copy are common, which AP carries. A service would be a single-caller abstraction. Loses.
  - Account field as a separate child component of MP: MP's save sequence owns the draft and the partial-save rule; a child
    would need two-way draft binding plus a focus contract for one select. Inline, using MP's own `SELECT`/`LABEL`, matches
    the spec text and the model/effort fields. Chosen inline.
  - Account write after model/effort: its status toast would replace the model/effort toast and drop its Undo. Loses (P6-A2).
- **Assumptions** (each with its check):
  - A-1: Only one connection has `connectionKind === 'claude-cli'`. Check: `PRV/providers-settings.component.ts` badge path
    already assumes it (`:323-325`); implementer confirms with `state.connections()` fixtures in PS.spec.
  - A-2: MP and the lane cell render only inside `SettingsComponent`, so `SettingsSaveFeedbackService` resolves. Check: MP
    already injects it (`PRV/main-agent-reassign-popover.component.ts:219`); LM too (`PAI/cli-orchestration-matrix.component.ts:30`).
  - A-3: The Main Agent node in `PRV/routing-map.component.ts` exposes a focusable element PS can use as the drawer opener
    for the Sign-in route. Check: read the node template before wiring; if none, use the element focused when MP opened.
- **Effect on existing code.** Replaced: UF (deleted), AT's Use-for/select/scope state, DV's three tabs and live line, AR
  subtitle/help/age lines, AF hint and status line, the toast card's own live role. Unchanged: ST, ClaudeAmbientStatusService,
  RPC/backend, card badge (`connectedAccountCount`), CD tabs list, all VS Code/TUI code paths (selectors absent on inert hosts).

## Decisions

| # | Decision | Options | Evidence | Reversible |
|---|---|---|---|---|
| P6-A1 | Make `ptah-settings-toast` announce through two always-present `sr-only` regions (`role=status aria-live=polite aria-atomic=true`, `role=alert aria-atomic=true`); the visual card keeps its look, testids, Undo/Dismiss but loses `role`/`aria-live`. New text: clear both, then set the toned one after a 50 ms timer (re-announces a repeated message). Timer cleared on change and destroy. | keep card roles; per-surface regions | Design principle 4 states the toast region is persistent, but source creates it filled (evidence 14); review-r1 "live-region persistence" | yes |
| P6-A2 | MP Save order: provider (existing) -> account -> model/effort. Account failure/unconfirmed/unavailable stops the sequence (model/effort not written). When account saved and model/effort follows, the account confirmation rides on that save's `successMessage` ("Saved {label} to {scope}. Chat uses {name}.") so Undo survives. | account last; account before provider | Spec contract 4 (provider first); evidence 15; single toast slot | yes |
| P6-A3 | After a confirmed account refusal in MP (failed, unavailable, or the P6-A12 local conflict), the P6-A13 lock makes Save natively disabled even while model/effort drafts remain; if focus was still on Save (B-2 waiting target), focus moves to the Account select (the control to change next). Otherwise no focus move. `unconfirmed` sets no lock and moves no focus. | leave focus to body | `[disabled]="!saveReady()"` drops focus (`PRV/main-agent-reassign-popover.component.ts:206`); B-2 | yes |
| P6-A4 | Ambient "Last checked …/Last check failed …" (parity §3 keep; absent from the design) moves into the ambient status word's tooltip + `sr-only` text, together with the two D54 cues. The 30 s timer stays (it updates that text). | drop; keep visible | parity §3 "keep"; design copy list has no age line; D54 tooltip mechanism | yes |
| P6-A5 | Row "N active runs" (parity §3 keep) lives in the detail as the `{n} running` badge only; the row has no run line. | row badge too | design capability map row "Active runs"; D52 low noise | yes |
| P6-A6 | Row body is no longer a `role=button`; Manage chevron (every named row) is the open-detail control. | keep clickable row | design list "One row is not itself a button"; parity capability (open detail) kept via Manage | yes |
| P6-A7 | Lane menu: Tab and Shift+Tab close the menu, `preventDefault`, focus the cell trigger. | let Tab escape the top layer | spec keyboard "Tab closes"; review-r1 "no Tab-close handler"; popover content sits in the top layer so native Tab order is undefined | yes |
| P6-A8 | `release-held`: AT remembers that any write in this tab instance was refused with code `release-held`; then Add is `aria-disabled`, `title="Not available on this host"`, and activating it announces the host sentence (or "Named accounts are not available on this host.") as an alert toast. | probe the host | release-held is only knowable from a refusal (`ACC/account-detail-view.component.ts:412-418`); no new RPC | yes |
| P6-A9 | Leaf components announce their own synchronous results through `SettingsSaveFeedbackService.announce`: AF name validation, DV copy result and rename validation. AT announces every async write outcome. | route all through AT outputs | fewer cross-batch contracts; announce is the documented path for writes outside `save()` (`FB/settings-save-feedback.service.ts:204-210`) | yes |
| P6-A10 | The M4a `Sign in` link opens the Claude (Subscription) drawer on its **Accounts tab** (not the account detail). MP output `accountSignInRequested`; PS closes MP and calls `openDrawer(claudeCliId, 'accounts')`; CD gets `initialTab`. | open the detail | spec contract 9 allows either; detail deep-link would need a new AT input | yes |
| P6-A12 | (Revision 1) MP captures an **account intent** synchronously at the start of `save()`, before any await: `{ value, choice, selectionRevision: snapshot.selections.main.revision, profileRevision: named ? account.revision : null }`. After the provider await, and with no further await before the call, MP re-reads `accounts.state('claude')()`; if the snapshot is gone, the scope revision differs, the named account is absent, its revision differs, or the captured value is no longer an enabled option of `accountModel()`, it does **not** call `setSelection` and handles the step as a confirmed refusal (`selectionFeedback({status:'unavailable'},'main',{providerSaved:true})` = "Provider saved. Account not saved.", draft cleared, P6-A13 lock). Otherwise it calls the unchanged three-argument `setSelection` synchronously, whose snapshot read then equals the checked one. | add a revision parameter to ST (core change, public contract); call `setSelection` before the provider write (breaks the approved provider-first order, contract 4) | evidence 1, 1a; `save()` awaits `runDrawerWrite` first (`PRV/main-agent-reassign-popover.component.ts:490-499`); review finding 1 | yes |
| P6-A13 | (Revision 1) MP holds `accountRefused = signal(false)`. Set true on every confirmed account refusal (failed, unavailable, P6-A12 conflict), never on `unconfirmed` or `saved`. While true, `saveReady()` is `false` regardless of provider/model/effort drafts. Reset only by (a) a user `change` event on the Account select that sets a new enabled draft, or (b) the open effect (`:367-376`, new session). Model/effort drafts are kept while locked. | clear only the account draft (review finding 2: the model/effort OR-branch re-enables Save); discard the model/effort drafts (loses user input) | design contract 4 "Save is disabled until the account changes again"; `saveReady` OR-branch `PRV/main-agent-reassign-popover.component.ts:360-364` | yes |
| P6-A11 | AP is changed additively in wave 1 and its superseded exports are removed in a last cleanup batch, so each commit compiles and passes its tests. | change in place in wave 1 | AT/UF/AR import the old exports until waves 2 land | yes |

## Component specifications

### 1. Account presentation rules (AP, pure)

- Purpose: every P6 derivation and string, from the host snapshot and the ambient view only (B-1).
- Responsibilities (new exports; names are the contract other batches code against):
  - `accountSelectorModel(view: ProviderAccountsView, ambient: ClaudeAmbientStatusView, scope: ProviderAccountScope): AccountSelectorModel | null`.
    `null` when `view.status === 'inert'` or `view.snapshot === null` (not ready; spec contract 2). Otherwise
    `{ visible, value, stored, options, selectedText }`:
    - `stored`: `{kind:'ambient'}` for `omitted`/`ambient`; `{kind:'named', profileId, label}` when that account is `signed-in`;
      `{kind:'signed-out', profileId, label}` when present but any other state; `{kind:'removed', profileId}` when absent.
    - `visible` (P6-1): some account is `signed-in`, or `stored.kind` is `named`/`signed-out`/`removed`.
    - `options` (P6-2/P6-3), each `{ value: AccountSelectorValue, label, disabled }`, `AccountSelectorValue = 'ambient' | 'stored' | \`named:${string}\``:
      first, only for signed-out/removed, the selected disabled `stored` option ("{name} (not signed in)" / "⚠ Removed account");
      then ambient (`Existing Claude login` + suffix from a ready ambient answer: ` (not signed in)` / ` (status unknown)`,
      none for `connected`, none while checking/idle or on local failure, spec contract 7); then signed-in named
      accounts (enabled, label); then the other named accounts disabled "{name} (sign in first)", excluding the stored
      signed-out profile. Order inside groups = `orderedAccounts`.
    - `value`: `'ambient'`, `named:{id}` or `'stored'`. `selectedText`: the selected option's label (cell text, `title`).
  - `accountChoiceOf(value): ProviderAccountChoice | null` (`'stored'` -> null).
  - `toastName(label): string` - 40 characters, then `…`.
  - `selectionFeedback(outcome: ProviderAccountActionOutcome, scope, opts: { providerSaved: boolean }): { message, tone } | null`:
    `saved` -> status "Chat uses {name}" (main) / "Lanes use {name}" (lane), name from `outcome.snapshot` (ambient ->
    `PROVIDER_ACCOUNT_RESERVED_LABEL`); `failed` -> alert, `providerSaved` ? "Provider saved. Account not saved." :
    (safe host summary via `isSafeProviderAccountSummary` else "Could not save the account. Try again."); `unavailable` ->
    as failed; `unconfirmed` -> alert "May not have saved. Accounts reloaded." (never "not saved").
  - `usedByChips(snapshot): ReadonlyMap<string, readonly ('Chat' | 'Lanes')[]>` (same keys as today's `assignmentChips`).
  - `ambientStatusModel(view, now): { tone, word, checking, hint: string | null }`: words `Signed in` (connected),
    `Not signed in`, `Status unknown` (unknown or local failure), `Checking…`, `Not checked yet` (idle/inert).
    `hint` = cue + age: signed-out "Sign in with the Claude CLI in a terminal." / unknown "The status could not be read.
    This does not mean you are signed out."; then "Last checked {age}." / "Last check failed {age}." from `ambientAge`.
  - `ACCOUNT_COPY`: every toast and fixed aria string of `design-spec-p6.md` "Copy" (status: `Account added`, `Signed in`,
    `Signed out`, `Sign-in cancelled`, `Status checked`, `Name saved`, `Account removed`, `Copied`, `Account changed elsewhere`,
    `That account is no longer in the list`; alert: `That did not work. Try again.`, `That name is already used.`,
    `Could not copy`, `Named accounts are not available on this host.`; aria/sr-only: removed-account sentence, lock sentence,
    resume sentence, `Not available on this host`).
- Verified contracts: evidence 6, 7, 9, 10, 11; `isSafeProviderAccountSummary` `libs/shared/src/lib/types/provider-account.types.ts:151`;
  `PROVIDER_ACCOUNT_RESERVED_LABEL` `:168`.
- Dependencies: `@ptah-extension/core` types, `@ptah-extension/shared` (as today, `ACC/account-presentation.ts:1-16`).
- Failure behaviour: pure; malformed input impossible (typed host snapshot).
- Verification seam: `ACC/account-presentation.spec.ts` table tests per state (incl. removed vs signed-out, suffix only from a
  ready answer, `{kind:'ambient'}` choice, 40-char truncation, unconfirmed never "not saved").
- Files: MODIFY `ACC/account-presentation.ts`, `ACC/account-presentation.spec.ts` (wave 1, additive); cleanup batch removes
  `useForModel`, `UseFor*` types, `UNAVAILABLE_ACCOUNT_*`, `assignmentChips`, `ambientRowModel`/`AmbientRowModel`,
  `SIGNED_OUT_HELP`, `UNKNOWN_HELP` and their spec cases.

### 2. Persistent toast announcer (`SettingsToastComponent`)

- Purpose: reliable announcements for every Settings toast (P6-A1).
- Responsibilities: two `sr-only` live regions rendered unconditionally (outside the `@if`), testids `settings-toast-live-status`
  / `settings-toast-live-alert` (`-inline` suffix via `testId()` for the inline variant); text = '' then message after 50 ms;
  cleared on dismiss; card markup unchanged except `role`/`aria-live` removed.
- Verified contracts: evidence 13, 14, 28.
- Failure behaviour: none new; a destroyed component clears its timer.
- Quality: one timer at most per toast instance; no observer.
- Verification seam: spec asserts both regions exist and are empty before any toast; text appears only after the tick
  (fake timers); identical consecutive messages clear then set again; dismiss clears. models-tiers-tab spec assertions move to
  the inline live regions.
- Files: MODIFY `FB/settings-toast.component.ts`, `FB/settings-toast.component.spec.ts`,
  `PRV/connection-drawer/models-tiers-tab.component.spec.ts`.

### 3. Drawer initial tab (CD)

- Purpose: let PS open the Claude drawer on Accounts (P6-A10).
- Responsibilities: `readonly initialTab = input<ConnectionDrawerTabId | null>(null)`; the connection-change effect
  (`:259-265`) sets `activeTab` to `untracked(this.initialTab) ?? 'overview'`; a tab not in `tabs()` still falls back to
  Overview through `activeTabId` (`:195-196`).
- Failure: inert host -> Accounts not in `tabs()` -> Overview.
- Verification seam: CD spec - `initialTab='accounts'` opens Accounts for a claude-cli connection with `accountsAvailable`;
  without it, Overview; changing connection re-applies.
- Files: MODIFY `PRV/connection-detail-drawer.component.ts`, `PRV/connection-detail-drawer.component.spec.ts`.

### 4. Main popover Account field (MP) and the Sign-in route (PS)

- Purpose: Surface 1 of the design, State contract 1-4, 7-9.
- Responsibilities:
  - Gated injection like PS (evidence 19): `accountsAvailable`, `accounts`, `ambient` may be null.
  - On open (existing open effect, `:369-377`): `void accounts?.open('claude')`, `void ambient?.read(false)`; reset
    `accountDraft = signal<AccountSelectorValue | null>(null)` and the "changed elsewhere" latch.
  - `accountModel = computed(() => accountSelectorModel(view, ambientView, 'main'))`; field shown when
    `accountModel()?.visible` and the draft provider (`providerId()`) is the Claude CLI connection (`connectionKind` of the
    `state.connections().data` entry, evidence 18).
  - Template: after the provider `grid gap-1` block, `<label for="main-agent-account">Account</label>` + `<select id="main-agent-account">`
    with MP's `label`/`select` classes, `[ptahBusyDisabled]="busy()"` (focusable, value changes blocked), `[title]="selectedText"`,
    testid `main-agent-account`. Signed-out: label row `flex items-center justify-between` with `Sign in` text button
    (`aria-label="Sign in to the saved account"`, testid `main-agent-account-sign-in`) emitting `accountSignInRequested`.
    Removed: `aria-invalid="true"`, `aria-describedby` to an `sr-only` "The saved account no longer exists. Choose another account."
  - DOM re-assert (pattern evidence 12): after render, the select's DOM value = draft ?? stored value; a disabled or `stored`
    choice is never kept (reset to the previous value).
  - Draft vs pushed (contract 3): draft set on change; while draft is null the select follows the stored value; when the
    stored value changes while a draft exists, announce status "Account changed elsewhere" once per draft.
  - `accountChanged = computed(() => field visible && draft !== null && draft !== stored value && accountChoiceOf(draft) !== null)`.
  - Refusal lock (P6-A13): `accountRefused = signal(false)`; the open effect resets it with the drafts; the select's `change`
    handler resets it when it stores a new enabled draft (a disabled/`stored` value is re-asserted and does not reset it).
  - `saveReady` = `!accountRefused()` AND ((existing main-agent condition, `:360-364`, when provider/model/effort are dirty)
    OR (`accountChanged` and nothing else dirty and not `awaitingConfirm`)); account-only saves need no Save-to target.
  - `save()`:
    1. Synchronously, before the first await (next to `session` at `:486`): if `accountChanged()` and the draft provider is
       Claude CLI, capture `accountIntent` per P6-A12 from `accounts.state('claude')()` (evidence 1, 7). No intent -> no
       account step.
    2. Provider write (unchanged, `:490-499`) -> if it did not save, stop (existing).
    3. Account step, only with an intent: if a provider write ran, re-check the intent against the current snapshot and
       `accountModel()` (P6-A12); on mismatch handle as a confirmed refusal (step 5) without calling the service. Then call
       `accounts.setSelection('claude','main', intent.choice)` **synchronously after the check** (no await in between, so
       ST's call-time snapshot read `:390` is the checked snapshot). An account-only save has no preceding await, so the
       check is trivially the click-time snapshot.
    4. `saved`: clear the draft; if model/effort dirty, continue with `successMessage` (P6-A2), else announce the
       `selectionFeedback` status toast and close.
    5. `failed` / `unavailable` / P6-A12 conflict (confirmed refusal): announce `selectionFeedback(outcome,'main',{providerSaved})`
       once, clear the account draft (select re-asserts the stored value, B-1), set `accountRefused` (Save disabled although
       model/effort drafts remain, P6-A13), stop (model/effort not written), apply the P6-A3 focus rule after render.
    6. `unconfirmed`: announce only "May not have saved. Accounts reloaded.", clear the account draft (select follows the
       re-read), **no lock, no focus move**, stop. Model/effort drafts stay; Save follows the normal predicate.
    The `session` guard applies after every await; a closed/reopened popover discards the intent and moves no focus.
  - PS: `(accountSignInRequested)` -> `mainPopover.set(null)`, `openDrawer(claudeCliId, 'accounts')`, opener per A-3;
    `openDrawer(providerId, tab: ConnectionDrawerTabId = 'overview')` stores a `drawerTab` signal bound to CD `[initialTab]`.
- Verified contracts: evidence 1, 1a, 2, 3, 13, 15-21.
- Failure behaviour: not ready/inert/VS Code -> field absent; `unavailable` and the P6-A12 conflict = failed; partial save
  stays open with one alert and the P6-A13 lock;
  unconfirmed shows only the uncertainty toast; closing the popover mid-write -> no focus move, toast still announces.
- Quality: no extra reads beyond one list read and one cached ambient read per open.
- Verification seam: MP.spec with stub `ProviderAccountsStateService`/`ClaudeAmbientStatusService`/`SettingsSaveFeedbackService`
  and `VSCodeService {isElectron}`; PS.spec for the route and `initialTab` binding. Required MP.spec cases (Revision 1):
  - Race (P6-A12): provider + account drafts; the stub's `activateConnection` promise stays pending, the test replaces the
    stub `state('claude')` snapshot with a higher `selections.main.revision` (and, separately, a bumped named-account
    `revision`, and the account removed), then resolves -> `setSelection` **not** called, one alert "Provider saved. Account
    not saved.", draft cleared, Save disabled. Control case: no push during the await -> `setSelection('claude','main',choice)`
    called once, and the stub sees the click-time snapshot.
  - Lock (P6-A13), provider + account + model/effort drafts together: account refused -> `feedback.save` not called, Save
    `disabled` although model/effort are still dirty; a second click does nothing; choosing another enabled account
    re-enables Save and the next Save writes account then model/effort; reopening the popover clears the lock.
  - B-2 with the lock: focus on Save at refusal -> focus lands on `#main-agent-account`; focus moved elsewhere during the
    await -> no focus move; popover closed mid-write -> no focus move.
  - `unconfirmed` with model/effort drafts -> no lock, Save enabled, no focus move, no "not saved" text.
  - Account saved + model/effort failed -> account draft cleared, popover stays open, model/effort failure toast from
    `feedback.save` only; account saved + model/effort saved -> one toast whose `successMessage` carries "Chat uses {name}"
    and whose Undo restores only model/effort (`:557-561`).
- Files: MODIFY `PRV/main-agent-reassign-popover.component.ts`, `.spec.ts`, `PRV/providers-settings.component.ts`, `.spec.ts`.

### 5. `ClaudeLaneAccountCellComponent` (`ptah-claude-lane-account-cell`, new) and LM wiring

- Purpose: Surface 2 (lane scope), State contract 5-8.
- Responsibilities:
  - Gated injection (evidence 19); on construction `void accounts?.open('claude')`, `void ambient?.read(false)` (once per mount).
  - Renders nothing unless `accountSelectorModel(...,'lane')?.visible`. Otherwise the design markup: `Account` muted label +
    trigger (LM `CELL` classes copied, chevron), `aria-label="Claude account: {selectedText}. Change"`, `aria-haspopup="menu"`,
    `aria-expanded`, `[title]`, `ptahBusyDisabled` while saving, text "Saving…" while saving, `max-w-[13rem]` truncation.
  - Menu in `ptah-native-popover placement="bottom-start" hasBackdrop backdropClass="transparent"`; body classes of evidence 23,
    width 17rem, `max-w-[calc(100vw-2rem)]`; h3 `Account` + Close; `role="menu" aria-labelledby`; one `menuitemradio` per option,
    `aria-checked` on the stored value, disabled items `aria-disabled="true"` (focusable, not activatable), removed item carries
    the `sr-only` sentence; roving tabindex (checked = 0).
  - Keys: ArrowUp/Down wrap, Home/End move focus only; Enter/Space/click on an enabled, different item commits; Escape closes
    and focuses the trigger; Tab/Shift+Tab per P6-A7.
  - Commit: close menu, focus the trigger (it is the waiting target), set saving before the first await, ignore repeats,
    `setSelection('claude','lane', choice)`, announce `selectionFeedback(outcome,'lane',{providerSaved:false})`. No local value
    change: the cell text always comes from the snapshot (B-1). After the result no focus move (focus is either still on the
    trigger or the user moved it).
  - LM: `@if (row.kind === 'system' && row.cli === 'claude' && row.installed) { <ptah-claude-lane-account-cell /> }` directly
    under the `cli-name-line` div; add the import.
- Failure behaviour: as MP without the provider step; inert host/VS Code -> nothing rendered and no RPC.
- Quality: one instance per matrix; no timers; long names never push the model/effort cells (wraps under the name).
- Verification seam: new cell spec (state matrix, keyboard, outcomes, B-2); LM.spec: cell present only on the installed Claude row,
  absent elsewhere and on non-Electron (stub services inert).
- Files: CREATE `PAI/claude-lane-account-cell.component.ts`, `PAI/claude-lane-account-cell.component.spec.ts`; MODIFY
  `PAI/cli-orchestration-matrix.component.ts`, `PAI/cli-orchestration-matrix.component.spec.ts`.

### 6. Accounts tab (AT) and deletion of UF

- Purpose: Surface 3 list (A1-A9, A16, A18, A19), owner of all tab writes and B-2.
- Responsibilities:
  - Remove UF import/mount, `select()`, `pendingScopes`, `scopeMessages`, `scopeAlerts`, `SELECTION_REFUSED_FALLBACK`,
    `SCOPE_NAME`, `USE_FOR_HEADING_ID`, the local toast `<p>` and alert `<p>`, `DETAIL_WAITING_TARGET`. Region always
    `aria-label="Claude accounts"`, `space-y-6 text-sm`, `aria-busy` as today.
  - Header row: `h3` `Accounts` (`tabindex=-1`, testid `accounts-tab-heading`) + [stale: `Out of date` badge `role=status` with
    warning icon + `Try again`] + `Add account` (`btn-outline btn-sm min-h-8`, testid `accounts-tab-add`; `aria-disabled` while no
    snapshot or P6-A8 held).
  - Body states: first-load failure `role=alert` row "Could not load accounts" + Try again (A9); loading row spinner `Loading…`
    (`Open a workspace` when idle) with list `aria-busy` (A19); Add form replaces the list (A6).
  - `ul role=list aria-label="Claude accounts" class="space-y-3"` (no inline margin); ambient row first; named rows
    `px-4 py-3`, avatar, name (truncate + `title`), dot + `STATE_LABEL` word, "Used by" + chips (`usedByChips`), pending spinner +
    "Signing in…"; actions: `Sign in` (`btn-primary`, not-signed-in/failed/cancelled, `ptahBusyDisabled` when busy/pending),
    Manage icon chevron on every named row (`aria-label="Manage {name}"`, `title="Manage"`, 32x32, testid `accounts-tab-row-manage`).
  - Feedback: every outcome -> `SettingsSaveFeedbackService.announce` with `ACCOUNT_COPY`/safe host sentence; no inline lines.
  - B-2 (D42): capture the focused element at intent (existing `captureWait`); on completion focus only if `untouchedSince`;
    target = the element itself if connected, else the detail heading (detail actions) or the `Accounts` heading (list actions,
    Remove). Add success opens the new account detail only when focus is still inside the Add form and the view is unchanged
    (P6-9), focusing the detail heading. Open account removed by push: status toast; heading focus only if focus was inside the
    removed detail. A closed/destroyed tab gets no programmatic focus.
  - DV binding: only the inputs/outputs of component 7.
- Verified contracts: evidence 1-3, 13, 25, 26; ST methods `addAccount :260`, `renameAccount :271`, `removeAccount :286`,
  `startSignIn :299`, `signOut :311`, `cancelSignIn :324`, `refreshAccountStatus :343`.
- Failure: refused -> alert toast; unconfirmed -> "May not have saved. Accounts reloaded."; release-held -> P6-A8; removal never
  assigns a selection (B-1).
- Verification seam: AT.spec with service stubs (as today, `ACC/accounts-tab.component.spec.ts:106-110`) plus a
  `SettingsSaveFeedbackService` stub; tests moved from UF/AT listed under Deletions.
- Files: MODIFY `ACC/accounts-tab.component.ts`, `ACC/accounts-tab.component.spec.ts`; DELETE `ACC/account-use-for.component.ts`,
  `ACC/account-use-for.component.spec.ts`.

### 7. Account detail, one flat panel (DV)

- Purpose: Surface 3 detail (A10-A15, A17), presentational.
- Public contract (binding for AT): inputs `account` (required), `accounts`, `operation`, `fallback`, `busy:
  ProviderAccountActionKind | null`; outputs `back`, `signIn`, `cancelSignIn`, `signOut`, `checkStatus`, `rename:
  AccountRenameRequest`, `remove`. Removed: `refusal`, `feedback`, `initialTab`, `AccountDetailTab`, the three copy exports.
  Kept testids: `account-detail`, `-back`, `-heading` (h3 `tabindex=-1`), `-state`, `-runs`, `-resume-unavailable`,
  `-sign-in`, `-cancel-sign-in`, `-sign-out`, `-check-status`, `-rename-input`, `-rename-submit`, `-locked`, `-remove`,
  `-remove-confirm`, `-remove-cancel`, `-fallback`, `-fallback-script`, `-copy-script`. New: `-terminal-toggle`.
  Removed: `-tablist`, `-live`, `-access-copy`, `-no-runs`, `-held`, `-refusal`, `-copy-status`, `-overview-state`,
  `-remove-copy`, `-pending` (folded into the state word "Waiting for Claude window").
- Responsibilities: capability map of the design (state word + dot; `{n} running` badge; `Cannot resume` badge with `title`
  + `sr-only` resume sentence; `Use terminal` disclosure (`aria-expanded`, only when `fallback` set) with `pre tabindex=0
  aria-label="Sign-in script"` and icon `Copy script`; action row labels unchanged, `Try again` for failed; `Name` input +
  `Save` only when edited, validation via `validateAccountName` announced as alert toast on Save; pending lock: Name `readonly
  aria-disabled`, Remove `aria-disabled`, both `aria-describedby` an `sr-only` lock sentence, lock icon with `title`; `Remove
  account` opens `NativeModalComponent` "Remove {name}?" with Cancel focused, Escape closes the dialog only, focus back to
  `Remove account`). Busy actions use `ptahBusyDisabled` (focusable). Copy result announced directly (P6-A9).
- Failure: copy failure -> alert "Could not copy"; host refusals are announced by AT.
- Verification seam: DV.spec (states, lock, disclosure, dialog focus/Escape, outputs, no visible helper sentences).
- Files: REWRITE `ACC/account-detail-view.component.ts`, `ACC/account-detail-view.component.spec.ts`.

### 8. Ambient row (AR) and Add form (AF)

- AR contract (binding for AT): input `ambient`, input `chips: readonly string[]`, output `checkRequested` (unchanged names).
  Markup per design row: avatar E, `Existing Claude login`, dot + `ambientStatusModel().word` with `[title]=hint` and an
  `sr-only` copy of `hint` right after the word (D54: reachable by screen readers); "Used by" + chips; `Check` only when the
  word is not `Signed in` (`ptahBusyDisabled` while checking, spinner word `Checking…`). Remove the subtitle, the extra/age
  `<p>`s and the status `role=status` (toast "Status checked" is announced by AT). B-2: if the Check button disappears
  (result connected) while focused, focus moves to the row name (`tabindex=-1`); otherwise no move. Keep the 30 s timer
  (released on destroy, `ACC/ambient-account-row.component.ts:131-135`).
- AF contract (binding for AT): inputs `accounts`, `pending`; outputs `submitted(label)`, `cancelled`. Remove the `refusal`
  input, hint and "Adding…" status line. `Account name` label + input + `Add` (`aria-disabled` until non-empty, label "Adding…"
  while pending via `ptahBusyDisabled`) + `Cancel`; invalid/duplicate on submit -> alert toast (`validateAccountName` message or
  "That name is already used."), focus stays in the input; Escape/Cancel close only the form.
- Files: MODIFY `ACC/ambient-account-row.component.ts`, `.spec.ts`, `ACC/add-account-form.component.ts`, `.spec.ts`.

## Deletions, removed copy and moved tests

- DELETE `ACC/account-use-for.component.ts` and `.spec.ts` (only importer is AT, `ACC/accounts-tab.component.ts:43-48`).
- Removed copy (D54-approved): UF heading, both helper paragraphs, both per-select hints, the unavailable message line, the
  three per-scope inline lines (Saving…, refusal, unconfirmed); "It is not selected for any new chat or lane."; ambient subtitle;
  Add hint; "No runs are bound…"; signed-in credentials sentence; "Waiting for you…" sentence; rename hint; Remove section text;
  the stale/loading sentences (replaced by `Out of date`/`Loading…`/`Open a workspace`); DV tabs and live line.
  Kept as tooltip + `sr-only`: the two flagged ambient cues (D54) and the age (P6-A4).
- Tests that move (sources from `parity-inventory-p6.md` §1):
  - `UF.spec:140,148,153,160,174,198` (options, stored value, removed) -> `AP.spec` selector-model tables + one render case each in MP.spec and the cell spec.
  - `UF.spec:189` (emit only enabled different value) -> MP.spec (draft ignore) and cell spec (disabled item not activatable).
  - `UF.spec:205,214,225` (busy, re-assert after refuse/unconfirmed) -> MP.spec and cell spec.
  - `UF.spec:234,244,256` (B-2) -> MP.spec (P6-A3, popover closed mid-write) and cell spec (focus moved away during save).
  - `AT.spec:221,258,268,278,286` (Use-for mount, write, saved/refused/unconfirmed feedback) -> MP.spec and cell spec as toast assertions.
  - `AT.spec:374,386` and `DV.spec:415-451` (detail live line) -> AT.spec toast + B-2 assertions.
  - `UF.spec:125`, `DV.spec:214` empty-runs text, `AR.spec:78,86` help text -> deleted or rewritten as tooltip/sr-only assertions.

## Acceptance criteria

Main popover (MP)
1. Field absent when: not Electron, snapshot null (idle/loading-first/error-first), draft provider not Claude CLI, or P6-1 false (M1).
2. Options/order/labels exactly per component 1; ambient suffix only from a ready ambient answer (M2, M3, M8).
3. Signed-out stored: selected disabled "{name} (not signed in)" + `Sign in` link -> drawer opens on Accounts (M4a). Removed:
   "⚠ Removed account", `aria-invalid`, `sr-only` sentence; nothing reassigned (M4b, B-1).
4. Save order provider -> account -> model/effort; `{kind:'ambient'}` is written. The account write is made only against
   the selection revision (and named-profile revision) captured when Save was clicked: if either changed during the
   provider write, `setSelection` is not called and the step is a confirmed refusal (P6-A12). Tested with a push during a
   pending provider write.
5. Outcomes: saved -> close + "Chat uses {name}" (or merged successMessage, Undo restores only model/effort); account saved +
   model/effort failed -> stays open with the model/effort failure only; failed/unavailable/conflict after a provider save ->
   stays open, one alert "Provider saved. Account not saved.", model/effort not written, select shows stored, Save
   **disabled even with model/effort drafts** until the user picks another enabled account or reopens (P6-A13);
   unconfirmed -> only "May not have saved. Accounts reloaded.", select shows the re-read value, no lock (M5-M7).
6. Pushed stored change during a draft keeps the draft and announces "Account changed elsewhere" once.
7. B-2: no programmatic focus when the popover closed or focus moved; P6-A3 only when focus is still on Save at a confirmed
   refusal (tested with provider + account + model/effort drafts, and again with focus moved away during the await).

Lane cell (LM)
8. Rendered only on the installed Claude system row, only when visible per P6-1; absent on VS Code (no RPC) (L1).
9. Cell text/aria/title per spec; long names truncate and never push model/effort cells at 360/320/260/245 px (L2-L4b).
10. Menu keyboard: arrows/Home/End move focus only; Enter/Space/click commits enabled different items; disabled items focusable,
    not activatable; Escape closes + focuses trigger; **Tab/Shift+Tab close** (P6-A7) (review-r1 item).
11. Busy: "Saving…", `aria-disabled`, focusable, repeat ignored; outcomes as toasts "Lanes use {name}" / alert texts; cell keeps
    the stored value (L5, L6, B-1).
12. **Async focus discard** (review-r1): when focus left the trigger during the save, or the component was destroyed, no focus move.

Accounts tab (AT, DV, AR, AF)
13. Zero visible helper sentences in every state; spacing `space-y-6`/`space-y-3`, row `px-4 py-3`, no inline `ul` margin.
14. Manage chevron on every named row incl. failed/signed-out; Sign in only for not-signed-in/failed/cancelled; pending keeps Manage.
15. Stale `Out of date` + Try again keeps rows; load failure row; `Loading…`/`Open a workspace`; release-held Add (P6-A8).
16. Add: duplicate/invalid -> alert toast, focus stays in input; success -> "Account added" and detail opens only under B-2 (P6-9).
17. Detail capability map complete (running badge, Cannot resume + sr-only sentence, waiting word, Use terminal + script + Copy,
    rename, lock with sr-only reason, Remove dialog Cancel-focused, Escape closes dialog only).
18. B-1: remove never assigns a selection; chips change only from a host snapshot. B-2: Remove -> `Accounts` heading only if
    focus is on the Remove origin or body; detail action whose button vanished -> detail heading only if focus fell to body;
    a replaced/closed view gets no programmatic focus (**async focus discard**, review-r1).
19. Ambient row: word + tooltip with the D54 cues and age, both also in `sr-only` text; Check only when not Signed in.

Shared
20. **Live-region persistence** (review-r1): `settings-toast-live-status` and `-alert` exist and are empty before the first
    toast; text set after a tick; a repeated identical message is re-announced. **No duplicate mutation-feedback
    announcer** in P6 surfaces: write outcomes (save, sign-in/out, rename, remove, add, copy, check) are announced only
    through these two regions (no inline `role=status`/`role=alert`/`aria-live` line for them in MP, the lane cell, AT, DV,
    AR or AF; AT's `accounts-tab-toast`/`accounts-tab-alert` lines `ACC/accounts-tab.component.ts:192-199` are removed).
    **Retained** non-mutation regions, required by the design (`design-spec-p6.md:102-103`) and present today
    (`ACC/accounts-tab.component.ts:146`, `:163`): the AT first-load failure row `role=alert` and the `Out of date` badge
    `role=status`. MP's existing provider/model regions (`PRV/main-agent-reassign-popover.component.ts:118`, `:154`, `:184`,
    `:190`, `:198`, and the provider outcome line) are outside the account feature and unchanged.
21. Card badge "N connected" unchanged (`PS.spec:1124-1172`, `CC.spec:296-319` still pass).
22. **Real 200% zoom** (review-r1): Electron visual review with browser zoom 200% (`webContents.setZoomFactor(2)` or Ctrl+=,
    not `deviceScaleFactor`) for MP (`w-[19rem]` popover), the lane menu and the Accounts tab; no clipping, no horizontal
    scroll; dark and light themes.

## Integration architecture

- Data flow: open/mount -> `open('claude')` + `read(false)` -> `accountSelectorModel` -> select/menu -> intent ->
  `setSelection(scope)` (revision from the held snapshot at call time; MP captures it at Save intent and calls only if it is
  unchanged after the provider write, P6-A12; the lane cell calls before any await) -> host commit -> response snapshot applied by ST
  (`provider-accounts-state.service.ts:605`) and `provider:accountsChanged` push -> every selector, chip and row re-derives.
- State: ST owns snapshots/revisions; MP owns one draft per open session; the lane cell owns only `saving`/`open`; AT owns busy,
  view and held flag; the page toast owns announcement text and timers.
- External boundaries: host replies are already validated in ST/ClaudeAmbientStatusService; host sentences shown only when
  `isSafeProviderAccountSummary`; labels rendered as text, toasts truncate to 40 chars.
- Failure and rollback: no optimistic state; refused/unconfirmed writes re-assert the stored value; a partial MP save is
  reported, never rolled back, and a confirmed account refusal locks MP's Save until the account changes (P6-A13).
- Observability: toasts (status/alert) are the user-facing evidence; no new logging.

## Architecture-level quality requirements

- Functional: acceptance criteria 1-22.
- Performance: no per-row timers or observers; one 30 s timer (AR) and one ≤50 ms announce timer per toast instance, both released.
- Security: no new RPC, no IDs or paths shown; only safe host summaries displayed.
- Maintainability: chat lib only; no new `vscode-core` import; existing `scope:`/`type:` tags unchanged; old AP exports removed
  in the cleanup batch; no `V2` copies.
- Testability: each component's states, keyboard and B-1/B-2 rules covered at its spec; toasts asserted through a
  `SettingsSaveFeedbackService` stub (`announce` jest.fn) except in the toast spec itself.

## Batches

Executor note for every batch (repeat in lane prompts): work only in the worktree above; Electron first, no TUI/VS Code
feature work; no `npm ci`/`install`, builds, `serve`, `e2e` or `npm run verify` by executors - run only the batch's focused
jest command from the worktree root, foreground, long timeout, filter output; report changed files and results; never commit,
push or run git writes. Specs: no `process.cwd()`, no `jest.spyOn` on module namespaces; stub `ProviderAccountsStateService`,
`ClaudeAmbientStatusService`, `SettingsSaveFeedbackService` and `VSCodeService` where a component injects them.

Waves (file-disjoint inside a wave): **W1** = P1, P2, P3 (parallel). **W2** = P4, P5, P6, P7, P8 (parallel; need P2; P4 also
needs P3). **W3** = P9 (needs P6 and P8). Commit order inside W2: P4, P5 any time; P6 before P7 and P8 (P7/P8 remove inputs
that only the old AT binds); run P6's jest once P7 and P8 files are in the tree.

### P1 - Persistent toast announcer (frontend-developer; W1)
Files (3): MODIFY `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/feedback/settings-toast.component.ts`,
`D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/feedback/settings-toast.component.spec.ts`,
`D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/connection-drawer/models-tiers-tab.component.spec.ts`.
Jest: `node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- "--testPathPatterns=settings-toast|models-tiers-tab"`

### P2 - Presentation additions (CLI lane or frontend-developer; W1)
Files (2): MODIFY `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/account-presentation.ts`,
`D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/account-presentation.spec.ts`.
Additive only (component 1 exports); old exports untouched.
Jest: `node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- --testPathPatterns=account-presentation`

### P3 - Drawer initial tab (CLI lane; W1)
Files (2): MODIFY `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/connection-detail-drawer.component.ts`,
`D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/connection-detail-drawer.component.spec.ts`.
Jest: `node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- --testPathPatterns=connection-detail-drawer`

### P4 - Main popover Account field and Sign-in route (frontend-developer; W2, after P2 and P3)
Files (4): MODIFY `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts`,
`D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.spec.ts`,
`D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts`,
`D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/providers-settings.component.spec.ts`.
Jest: `node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- "--testPathPatterns=main-agent-reassign-popover|providers-settings.component"`

### P5 - Lane account cell (frontend-developer; W2, after P2)
Files (4): CREATE `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/ptah-ai/claude-lane-account-cell.component.ts`,
`D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/ptah-ai/claude-lane-account-cell.component.spec.ts`;
MODIFY `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts`,
`D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.spec.ts`.
Jest: `node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- "--testPathPatterns=claude-lane-account-cell|cli-orchestration-matrix"`

### P6 - Accounts tab list; delete Use-for (frontend-developer; W2, after P2; commit before P7/P8)
Files (4): MODIFY `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/accounts-tab.component.ts`,
`D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/accounts-tab.component.spec.ts`;
DELETE `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/account-use-for.component.ts`,
`D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/account-use-for.component.spec.ts`.
Codes against the DV/AR/AF contracts of components 7 and 8.
Jest: `node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- --testPathPatterns=accounts-tab`

### P7 - Flat account detail (frontend-developer; W2, after P2)
Files (2): REWRITE `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/account-detail-view.component.ts`,
`D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/account-detail-view.component.spec.ts`.
Jest: `node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- --testPathPatterns=account-detail-view`

### P8 - Ambient row and Add form (frontend-developer or CLI lane; W2, after P2)
Files (4): MODIFY `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/ambient-account-row.component.ts`,
`D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/ambient-account-row.component.spec.ts`,
`D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/add-account-form.component.ts`,
`D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/add-account-form.component.spec.ts`.
Jest: `node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- "--testPathPatterns=ambient-account-row|add-account-form"`

### P9 - Presentation cleanup (CLI lane; W3, after P6 and P8)
Files (2): MODIFY `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/account-presentation.ts`,
`D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/account-presentation.spec.ts`.
Remove the superseded exports listed in component 1; grep `libs/frontend` for each removed name first (must be zero importers).
Jest: `node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- --testPathPatterns=account-presentation`

### Final verify (team-leader/orchestrator, once after P9)
`npm run verify -- -t lint,test,typecheck -p @ptah-extension/chat,ptah-extension-webview,ptah-electron,ptah-extension-vscode`
(N = 4; header must say "Running target ... for 4 projects"). `@ptah-extension/core` is not touched (no file in `libs/frontend/core`
changes). `@ptah-extension/webview-e2e-harness` is not listed: no scene references the Use-for block, the account selectors or
the toast `role` (evidence 27, 28); add it only if a batch ends up editing a harness file. Then: codex code review, Electron
visual review (acceptance 9, 13, 22 incl. real 200% zoom, dark + light), live Haiku test (D52).

## Team-leader handoff

- Recommended executors: frontend-developer subagents for P1 (a11y timing), P4 (save sequence), P5 (menu keyboard), P6 and P7
  (B-2 and rewrite); CLI lanes for P2, P3, P9 (pure functions, one input, mechanical cleanup); P8 either.
- Complexity: MEDIUM-HIGH - no backend, but four interacting focus/announcement contracts and a DV rewrite.
- Dependencies and ordering: P2 before every W2 batch; P3 before P4; P6 committed before P7 and P8; P9 last.
- Parallel-safe work: W1 = P1, P2, P3; W2 = P4, P5, P6, P7, P8 (file-disjoint, contracts fixed in components 1, 7, 8).
- Files affected: CREATE `PAI/claude-lane-account-cell.component.ts` + spec. DELETE `ACC/account-use-for.component.ts` + spec.
  REWRITE `ACC/account-detail-view.component.ts` + spec. MODIFY `ACC/account-presentation.ts` + spec, `ACC/accounts-tab.component.ts`
  + spec, `ACC/ambient-account-row.component.ts` + spec, `ACC/add-account-form.component.ts` + spec,
  `PRV/main-agent-reassign-popover.component.ts` + spec, `PRV/providers-settings.component.ts` + spec,
  `PRV/connection-detail-drawer.component.ts` + spec, `PRV/connection-drawer/models-tiers-tab.component.spec.ts`,
  `PAI/cli-orchestration-matrix.component.ts` + spec, `FB/settings-toast.component.ts` + spec (25 files).
- Verification points: evidence 1-5 (no backend change); B-1/B-2 checked in code review against acceptance 3-7, 11-12, 16-18;
  review-r1 items = acceptance 10, 12, 18, 20, 22; the final verify above; the Electron visual review.

## Revision 1

Answers `implementation-plan-p6-review.md` (codex, REVISE 7/10). Still frontend-only, still `@ptah-extension/chat` only:
every fix lives in MP and MP.spec, which are already batch P4 (4 files). No batch, wave, file list or executor changed; no
change to `design-spec-p6.md` or D52-D54. Decisions recorded as D56-D58 in `decisions.md`.

| # | Finding | Fix | Plan sections changed |
|---|---|---|---|
| 1 (serious) | The Save-click revision is lost: ST reads the snapshot when `setSelection` is called (`provider-accounts-state.service.ts:390`, `:407`, `:555`), and MP awaits the provider write first (`main-agent-reassign-popover.component.ts:490-499`), so a push during that await becomes the expected revision. | P6-A12: MP captures the account intent (choice, scope revision, named-profile revision) synchronously at Save, re-checks it against the current snapshot and the selector model after the provider await, and calls the unchanged three-argument `setSelection` synchronously only when unchanged. A mismatch is a confirmed refusal (same as the host `conflict`, `provider-account.store.ts:376-380`): "Provider saved. Account not saved.", lock. The plan no longer claims the service accepts a captured revision. Race test with a pending provider write. | Codebase evidence rows 1, 1a; Decisions P6-A12; component 4 `save()` steps 1-3 and verification seam; acceptance 4; Integration data flow |
| 2 (moderate) | The partial-save lock contradicts the Save predicate: clearing only the account draft leaves the model/effort OR-branch (`:360-364`) enabling Save, so the next click writes model/effort without a new account choice and Save never becomes disabled for P6-A3. | P6-A13: explicit `accountRefused` signal, set only on confirmed refusal (failed/unavailable/conflict), never on `unconfirmed`; `saveReady` is gated by it before the OR-branch; reset only by a new enabled Account choice or reopening. Model/effort drafts kept. P6-A3 now rests on this lock. Tests with provider + account + model/effort drafts together, B-2 with focus moved away, unconfirmed staying unlocked, account-saved/model-failed, Undo scope. | Decisions P6-A3, P6-A13; component 4 lock/`saveReady`/`save()` steps 5-6, failure behaviour, verification seam; acceptance 5, 7; Integration failure and rollback |
| 3 (minor) | Acceptance 20 forbade every other live region, but the design requires the stale `role=status` badge and the load-error `role=alert` row (`design-spec-p6.md:102-103`, `accounts-tab.component.ts:146`, `:163`). | Acceptance 20 now forbids only duplicate mutation-feedback announcers and explicitly retains the load/stale regions and MP's existing provider/model regions. | Acceptance 20 |

Also noted from the review's limits: P6's isolated commit cannot pass its own jest run before P7/P8 land (contract
removal order). Unchanged by design (wave note "run P6's jest once P7 and P8 files are in the tree"); the team-leader
commits P6, P7 and P8 after one combined P6 jest run, or accepts that P6 is verified at integration.
