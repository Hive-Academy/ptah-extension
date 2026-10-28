# Parity Inventory - TASK_2026_719 Phase P6 (account selectors move to the chat and lane forms)

Mode: inventory-only. This file lists what the OLD (P5) code does today. It does not design the replacement.
Source: worktree `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts`, branch
`feat/claude-named-accounts`, head `8e71fb124`. Driver: decisions.md D52; binding rules B-1 / B-2 from D42.

Path abbreviations (all under `libs/frontend/chat/src/lib/settings/providers/` unless stated):

- `AT` = `accounts/accounts-tab.component.ts` · `UF` = `accounts/account-use-for.component.ts`
- `AP` = `accounts/account-presentation.ts` · `AR` = `accounts/ambient-account-row.component.ts`
- `AF` = `accounts/add-account-form.component.ts` · `DV` = `accounts/account-detail-view.component.ts`
- `PS` = `providers-settings.component.ts` · `CD` = `connection-detail-drawer.component.ts`
- `CC` = `provider-connection-card.component.ts` · `CK` = `connection-drawer/connection-kind.ts`
- `ST` = `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts`
- `RT` = `libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts` · `PT` = `libs/shared/src/lib/types/provider-account.types.ts`
- `MP` = `main-agent-reassign-popover.component.ts` (provider select `MP:97-104`)
- `LM` = `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts` (Claude entry `LM:113-117`)
- Specs: same name + `.spec.ts` (`AT.spec`, `UF.spec`, `AP.spec`, `AR.spec`, `AF.spec`, `DV.spec`, `CC.spec`, `PS.spec`, `CD.spec`, `ST.spec`).

Decision legend: `keep` = stays in the Accounts tab; `move` = goes to `MP` / `LM` (D52); `remove-proposed` =
proposed removal, copy only unless stated, needs user approval at Gate 1.7. No row here is approved removal.
"New location" for moved rows names only the host file D52 fixes; exact placement is design work (TBD).

## 1. "Use for" block (the moved capability)

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| Mount of the Use-for block in the tab list view; hidden while the detail is open | `AT:179-188`, `AT:405` (`useForShown`) | none | move (D52) | `MP` (scope `main`), `LM` (scope `lane`) | `AT.spec:221` (must be rewritten: block no longer in tab) |
| Per-scope select model: stored value only, never pending/attempted (R2, B-1) | `AP:84-118` (`useForModel`), `AT:368-371` | snapshot `selections.main/lane` from `provider:listAccounts` | move (pure fn reusable; one call per scope) | `MP`, `LM` | `AP.spec:92`, `AP.spec:118`; `UF.spec:148`, `UF.spec:153` |
| Option "Existing Claude login" (ambient) first, always enabled; `omitted` and `ambient` both show it | `AP:89-93`, `AP:103-106` | `setAccountSelection` with `{kind:'ambient'}` (`ST:543-548`) | move | `MP`, `LM` | `AP.spec:92`; `UF.spec:140`, `UF.spec:198` |
| Ambient option suffix from a ready host answer: " (not signed in)" / " (status unknown)" | `AP:73-77`, `AP:91` | `provider:getAmbientClaudeStatus` via `ClaudeAmbientStatusService.view` | move (selector needs the ambient read too) | `MP`, `LM` | `AP.spec:108` |
| Named options: signed-in enabled; others disabled with "(sign in first)"; signed-in first | `AP:94-101`, `AP:144-150` | snapshot `accounts[].state` | move | `MP`, `LM` | `AP.spec:99`; `UF.spec:140` |
| Selected account absent from snapshot -> disabled placeholder "Unavailable account - choose another" + message "The stored account is no longer available. Choose another account. Ptah does not switch to the existing login for you." | `AP:50-52`, `AP:107-116`; shown `UF:100-106` | snapshot | move (placeholder: keep). Message line: remove-proposed as inline line -> toast or option text only (copy) | `MP`, `LM` | `AP.spec:124`, `AP.spec:135`; `UF.spec:160`, `UF.spec:174` |
| Change emits only for a different enabled value; `unavailable` never written | `UF:45-50` (`choiceOf`), `UF:206-` (`onChange`) | none | move | `MP`, `LM` | `UF.spec:189` |
| Write one scope against that scope's revision (`expectedSelectionRevision`) and the named profile's revision (`expectedProfileRevision`) | `AT:543-566` -> `ST:384-410`, `ST:543-558`; params `RT:235-243` | `provider:setAccountSelection` (`RT:45`, `RT:316-318`) | move (unchanged RPC, no backend change) | `MP`, `LM` | `ST.spec:781`; `AT.spec:258` |
| Busy rule (a): only the writing scope disabled + `aria-busy`, set before the first await; repeat write ignored | `AT:545-547`, `UF:83-84`, `UF:193` | none | move | `MP`, `LM` | `AT.spec:258`; `UF.spec:205` |
| DOM value re-asserted to stored selection after refuse/unconfirmed | `UF:163-190` (`afterRenderEffect`) | none | move | `MP`, `LM` | `UF.spec:214`, `UF.spec:225` |
| B-2 focus: focus moves to the scope status line before disable; returns to the select only if still there | `UF:163-190`, `UF:107-115` | none | move (waiting target must be re-chosen if the inline status line is removed, see row below) | `MP`, `LM` | `UF.spec:234`, `UF.spec:244`, `UF.spec:256` |
| Saved toast "New chats / Claude lanes will use <name> for new sessions." | `AT:553-555`, `AT:74-77`, `AT:705-712` | none | move (toast) | `MP`, `LM` | `AT.spec:268` |
| Refusal: safe host sentence or fallback "Could not change this setting. That account is not available for Claude lanes right now." as per-scope inline alert | `AT:556-564`, `AT:62-63`, `UF:116-123` | `PT:38-53` result codes (`conflict`, `missing-profile`, `busy`, ...) via `isSafeProviderAccountSummary` | move (feedback kept). Inline alert placement: remove-proposed -> toast/alert per D52 | `MP`, `LM` | `AT.spec:278`; `UF.spec:214` |
| Unconfirmed: "This action may not have completed. Accounts were reloaded." as per-scope inline line; snapshot refreshed | `AT:559-561`, `DV:44`, `ST:591-598` | `provider:listAccounts` re-read | move (feedback kept). Inline line: remove-proposed -> toast | `MP`, `LM` | `AT.spec:286`; `UF.spec:225` |
| Per-scope inline status line "Saving…" (polite live region) | `UF:107-115`, `UF:152-160` | none | remove-proposed (inline status line; D52 "short toasts"). Note: it is today's B-2 waiting target | `MP`, `LM` (replacement TBD) | `UF.spec:205`, `UF.spec:234` |
| Heading "Use for"; tab region labelled by it | `UF:66`, `UF:18`, `AT:140-141` | none | remove-proposed (heading leaves with the block; tab keeps `aria-label="Claude accounts"` fallback `AT:141`) | none | `AT.spec:165`, `UF.spec:125` |
| Helper "Pick which account each kind of session uses. Changes apply to new sessions only. Credentials stay on this computer." | `UF:67-70` | none | remove-proposed (copy) | none | `UF.spec:125` |
| Helper "This applies only while Claude sign-in is your main route. If you chose another provider as the main route, that provider stays in effect." | `UF:71-74` | none | remove-proposed (copy; placement in `MP` makes it implicit) | none | `UF.spec:125` |
| Per-select hints "The account your next main chat uses." / "The account the next Claude lane uses." | `UF:37-38`, `UF:97-99` | none | remove-proposed (copy) | none | `UF.spec:125` |
| Select labels "New chats" / "Claude lanes" | `UF:37-38`, `UF:78` | none | move (label wording TBD by design: e.g. "Account") | `MP`, `LM` | `UF.spec:125` |

## 2. Accounts tab shell, load and feedback (stays)

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| Tab exists only for `claude-cli` drawer and only where accounts are served | `CK:19`, `CK:26`; `CD:85-86`, `CD:162-163`, `CD:189-192`; `PS:478`, `PS:561-568` | none | keep | same | `CD.spec:248`; `PS.spec:1179`, `PS.spec:1196` |
| Inert host renders nothing, no RPC | `AT:135`; `ST:45-46`, `ST:147`, `ST:170` | none | keep | same | `ST.spec:108`; `PS.spec:1196` |
| On open: list read + forced ambient read in parallel | `AT:449-453` | `provider:listAccounts`, `provider:getAmbientClaudeStatus` | keep | same | `AT.spec:160` |
| Region `aria-busy` while list or ambient read runs | `AT:142`, `AT:376-378` | none | keep | same | `AT.spec:165` |
| First-load error "Accounts could not be loaded." + Try again | `AT:144-154`, `AT:455-457` | `provider:listAccounts` | keep | same | `AT.spec:183`; `ST.spec:176` |
| Loading line "Loading accounts…" / "Accounts load when a workspace is open." | `AT:155-159` | none | keep (status, not helper) | same | `AT.spec:183` |
| Stale banner "Showing the last loaded accounts. The latest refresh failed." + Try again | `AT:161-177` | `provider:listAccounts` | keep (inline status; could become toast - designer to confirm, no removal proposed) | same | `ST.spec:176` |
| Polite toast region + alert line for list actions | `AT:190-200`, `AT:700-703` | none | keep | same | `AT.spec:268`, `AT.spec:395` |
| Toast "Account added. It is not selected for any new chat or lane." | `AT:61`, `AT:530` | none | keep (second sentence: remove-proposed copy, or re-word to point at the chat/lane selects) | same | `AT.spec:486` |
| Toast "That account is no longer in the list." (open account removed by push) | `AT:66`, `AT:429-446` | `provider:accountsChanged` push | keep | same | `AT.spec:475` |
| Live updates by push; revision-ordered apply | `ST:153-160`, `ST:489-492` | `provider:accountsChanged` | keep (also feeds the new selectors) | same + `MP`, `LM` | `ST.spec:194` |

## 3. Account list (stays)

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| Heading "Accounts" (focus target after detail closes) | `AT:224-229` | none | keep | same | `AT.spec:214` |
| Ambient row "Existing Claude login": avatar E, dot + status, Check again | `AT:231-237`; `AR:46-108` | `provider:getAmbientClaudeStatus` | keep | same | `AR.spec:66`, `AR.spec:104`, `AR.spec:115`; `AT.spec:548` |
| Ambient subtitle "The Claude login already on this computer. Ptah only reads its status here." | `AR:58-60` | none | remove-proposed (copy) | none | none asserts it |
| Ambient help "Sign in with the Claude CLI in a terminal. Ptah does not manage this login." (signed-out) | `AP:199-200`, `AR:85` | none | remove-proposed (copy) - flag: only cue for how to fix a signed-out existing login | none | `AR.spec:78`; `AP.spec:218` |
| Ambient help "The status could not be read. The Claude CLI may be missing ... does not mean you are signed out." | `AP:201-202`, `AR:85` | none | remove-proposed (copy) - flag: prevents a false "signed out" reading | none | `AR.spec:86`; `AP.spec:225` |
| Ambient age line "Last checked …" / "Last check failed …", 30 s refresh timer with release | `AR:88`, `AR:20`, `AR:135-137`; `AP:208-218` | host `checkedAt` | keep (inline status line; remove-proposed only if design drops it) | same | `AR.spec:157`; `AP.spec:254` |
| Ambient B-2 focus on Check again / status | `AR:63-67`, `AR:160-` | none | keep | same | `AR.spec:126`, `AR.spec:142` |
| Named rows: initial, name as text, dot + state label, attention spine for failed/disconnected, signed-in first | `AT:238-281`, `AT:379-398`; `AP:25-45`, `AP:144-150` | snapshot | keep | same | `AT.spec:192`, `AT.spec:237`; `AP.spec:79`, `AP.spec:167` |
| "Used by" chips "Used for: New chats" / "Used for: Claude lanes" on ambient and named rows (from snapshot selections only) | `AT:270-279`, `AT:372-375`, `AR:90-96`; `AP:120-141` | snapshot `selections` | keep (D52: list + "Used by" chips; chip wording TBD) | same | `AP.spec:146`, `AP.spec:152`, `AP.spec:159`; `AR.spec:169` |
| Row run line "Run binding · N active runs" | `AT:267-269`, `AT:394` | snapshot `activeRunCount` | keep (status) | same | `AT.spec:192` (verify) |
| Row "Sign in" (not-signed-in/failed/cancelled), `aria-disabled` while busy, no double start | `AT:283-291`, `AT:81-85`, `AT:571-574` | `provider:startAccountSignIn` via `ST.startSignIn` (`ST:299`) | keep | same | `AT.spec:307`, `AT.spec:395` |
| Row "Manage" + row body click/Enter/Space opens detail (Overview if signed in, else Access) | `AT:244-252`, `AT:292-299`, `AT:465-479` | none | keep | same | `AT.spec:203` |
| "Add another account" button; disabled without snapshot | `AT:305-332`, `AT:492-502` | none | keep | same | `AT.spec:175`, `AT.spec:183`, `AT.spec:538` |

## 4. Add form (stays)

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| Name field, trim, safe-label + case-insensitive unique incl. reserved name, re-read at submit | `AF:48-65`, `AF:150-177`; `AP:153-185` | none | keep | same | `AF.spec:97`, `AF.spec:104`, `AF.spec:110`, `AF.spec:116`; `AP.spec:178-198` |
| Hint "For example: Work, or Team plan. Only you see this name. Each name must be different." | `AF:49-51` | none | remove-proposed (copy; the duplicate error still explains uniqueness) | none | none asserts it |
| Pending "Adding…" status line + disabled controls + B-2 focus | `AF:75-82`, `AF:100`, `AF:144-157` | `provider:addAccount` (`ST:260-266`) | keep (button label "Adding…" keeps busy cue; the separate status line is the B-2 target: remove-proposed only with a replacement target) | same | `AF.spec:124`, `AF.spec:138`, `AF.spec:151` |
| Refusal alert (safe host sentence / fallback) keeps value | `AF:67-73`, `AF:22`; `AT:515-522` | `PT:38-53` | keep | same | `AF.spec:138`, `AF.spec:163`; `AT.spec:530` |
| Escape/Cancel close only the form | `AF:179-187` | none | keep | same | `AF.spec:172`, `AF.spec:191` |
| On success: open new account on Access, select nothing | `AT:530-537`, `AT:715-719` | none | keep | same | `AT.spec:486`, `AT.spec:502`, `AT.spec:518` |

## 5. Account detail view (stays)

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| "All accounts" back, heading focus, dot + state, tablist Overview / Access / Profile (roving keys) | `DV:50-54`, `DV:89-135`, `DV:484-487`; `AT:482-488` | none | keep | same | `DV.spec:138-194`; `AT.spec:214` |
| Detail live status line (`account-detail-live`): "Sign-in started.", "Signed out.", "Status checked.", "Name saved.", "Working…" | `DV:139-144`, `DV:42-48`; `AT:68-71`, `AT:73` | none | keep (B-2 waiting target of every detail action, `AT:73`). Converting to toast: remove-proposed only with a replacement target | same | `AT.spec:374`, `AT.spec:386`; `DV.spec:415-451` |
| Refusal alert / release-held block "Named accounts are not available on this host." | `DV:146-160`, `DV:417` | `PT:38-53` | keep | same | `DV.spec:295` |
| Overview: State, "Running now" with run text | `DV:164-182`, `DV:388` | snapshot | keep | same | `DV.spec:214` |
| Overview empty "No runs are bound to this account." | `DV:180` | none | remove-proposed (copy) | none | `DV.spec:214` (verify) |
| Overview "Resume unavailable / Runs bound to this account cannot resume until it is signed in again." | `DV:183-187` | snapshot | keep (state warning, not helper) | same | `DV.spec:214` |
| Access signed-in copy "Signed in. Credentials stay on this computer and are never shown here." | `DV:193` | none | remove-proposed (copy; header already shows Signed in) | none | `DV.spec:248` (verify text assertion) |
| Access pending "Finish sign-in in the Claude window / Waiting for you. This page updates when you are done." | `DV:223-232` | none | keep heading line; second sentence remove-proposed (copy) | same | `DV.spec:257` |
| Access fallback "Sign in from a terminal" + script + Copy script + copy status | `DV:196-221`, `DV:406-410` | `provider:startAccountSignIn` fallback | keep (instructions are functional) | same | `DV.spec:266`, `DV.spec:284` |
| Access failed / cancelled / disconnected / not-signed-in copy | `DV:234-251` | snapshot state | keep (state copy; design may shorten) | same | `DV.spec:231` |
| Sign out / Cancel sign-in / Sign in (Try again) / Check status; busy rule (b) | `DV:254-265`; `AT:576-592`, `AT:615-676` | `provider:signOutAccount`, `provider:cancelAccountSignIn`, `provider:startAccountSignIn`, `provider:refreshAccountStatus` (via `ST`) | keep | same | `DV.spec:248`, `DV.spec:402`; `AT.spec:298`, `AT.spec:338-362` |
| Profile: rename (validated, case-only allowed), locked while pending | `DV:266-294`; `AT:594-601` | `provider:renameAccount` | keep | same | `DV.spec:320`, `DV.spec:333`, `DV.spec:339`, `DV.spec:347`; `AT.spec:318` |
| Profile lock note "Sign-in is in progress. Name and removal are locked until it finishes or is cancelled." | `DV:269-272` | none | keep (explains disabled controls) | same | `DV.spec:339` |
| Rename hint "Only you see this name. Each name must be different." | `DV:290` | none | remove-proposed (copy) | none | none asserts it |
| Remove section text "Removes this account from Ptah. Running work is not changed." | `DV:296-298` | none | remove-proposed (copy; modal repeats it) | none | none asserts it |
| Remove confirm modal, Cancel focused, Escape; never assigns a selection (B-1) | `DV:312-327`; `AT:604-609` | `provider:removeAccount` (`ST:286-291`) | keep | same | `DV.spec:361`, `DV.spec:377`, `DV.spec:389`; `AT.spec:418-475`; `ST.spec:815` |

## 6. Providers page / card badge (stays)

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| Badge "N connected" on the Claude CLI card only; hidden at 0 / loading / stale / failed | `CC:123-125`, `CC:186-189`; `PS:328-329`, `PS:570-576`; `AP:269-278` | `provider:listAccounts` + cached ambient read | keep (counts sign-in state, not selections; unaffected by the move) | same | `CC.spec:296-319`; `PS.spec:1124-1172`; `AP.spec:285-298` |
| Page-level reads on show; re-read on drawer close | `PS:1038-1040`, `PS:1171-1173` | same | keep | same | `PS.spec:1116`, `PS.spec:1179` |
| Claude CLI card kept visible where accounts exist (Manage -> Accounts reachable) | `PS:772-779` | none | keep | same | `PS.spec:1109-1124` (verify) |

## 7. Edge states the new selectors (`MP`, `LM`) must still cover

| Edge state | Today's behaviour and evidence | Required in new location |
| --- | --- | --- |
| Selected named account removed / absent from snapshot | Disabled "Unavailable account - choose another" placeholder; nothing reassigned locally; host snapshot decides (B-1). `AP:107-116`, `ST.spec:815`, `UF.spec:174` | Same placeholder logic in both selects; no local fallback to ambient |
| Account not signed in | Option disabled with "(sign in first)". `AP:94-101` | Same; plus a path to sign in (link/Manage to the Accounts tab) is design work |
| Write in flight (busy / pending) | Only that scope's select disabled, `aria-busy`, repeat ignored. `AT:545-547`, `UF:83-84` | Per-form busy; `MP` already has its own `busy()` (`MP:98`) - account write must not block or be blocked by the provider Save without a stated rule |
| B-2 focus after async | Focus returns to the select only if still on the waiting target and view active. `UF:163-190` | `MP` is a popover that can close mid-write; `LM` rows re-render. Waiting target must exist in each form |
| Host without account support (inert, non-Electron) | No RPC, nothing rendered. `ST:170`, `ST:147`, `PS:561-568` | Selector absent (not disabled) in `MP` and `LM` on inert hosts; VS Code/TUI must keep compiling |
| No workspace open / snapshot not loaded / first read failed | Tab shows idle/loading/error; `setSelection` returns `unavailable` without snapshot `ST:391-393` | Selector hidden or disabled until a snapshot exists; the forms must trigger `ST.open('claude')` themselves (today only the tab and `PS:1039` call it) |
| Only the ambient login exists (no named accounts) | Select still shows with one option. `AP:89-106` | D52 asks: hidden or single read-only value. Design decision; chips/badge unaffected |
| Ambient status unknown / signed out / checking | Option suffix only from a ready answer. `AP:68-77` | Forms need `ClaudeAmbientStatusService.read(false)` (cached) to show the suffix; no forced probe per open (D41 rule) |
| Revision conflict / stale selection revision | Host refuses (`conflict`), safe sentence or fallback shown; stored value re-asserted. `ST:407`, `PT:48`, `UF.spec:214` | Same refusal handling; value never shows the attempted choice |
| Unconfirmed write (transport loss) | Warning + snapshot re-read. `ST:591-598`, `AT:559-561` | Same, as toast per D52 |
| Selection changed elsewhere while a form is open | Push `provider:accountsChanged` updates the snapshot. `ST:153-160` | Selects bind to the live snapshot, so a second open form (popover + matrix) stays consistent |
| Main route is not Claude subscription | Helper sentence only (`UF:71-74`); selection still writable | Select shown only when Claude subscription/CLI is the chosen provider in `MP`; `LM` only on the Claude CLI entry |

## Notes

- No backend change is implied: both scopes use `provider:setAccountSelection` (`RT:45`, `RT:316-318`).
- After the move, `UF`, `USE_FOR_HEADING_ID`, `pendingScopes` / `scopeMessages` / `scopeAlerts` / `select()` in `AT`
  (`AT:355-357`, `AT:543-566`, `AT:695-698`) and `SELECTION_REFUSED_FALLBACK` lose their only caller in the tab;
  `useForModel` (`AP:84`) is the reusable piece. `UF`, `AP`, `AT` are referenced nowhere else in source.
- `PT` / `RT` still declare `ProviderSetAccountDefaultParams` (`RT:246-`) after the UI "Set as default" was deleted
  in `05f459308`; out of scope here, noted only.
