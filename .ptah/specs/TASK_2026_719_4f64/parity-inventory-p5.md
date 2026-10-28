# Parity Inventory - TASK_2026_719 Phase P5 (named Claude accounts UI redesign)

Mode: inventory-only. This file lists what the OLD code does today. It does not design the replacement.
Source: worktree `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts`, branch
`feat/claude-named-accounts`. Driver: decisions.md D39, the "User UX feedback" bullet (decisions.md:230).

Path abbreviations:

- `AS` = `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-section.component.ts`
- `AD` = `libs/frontend/chat/src/lib/settings/providers/accounts/account-details-drawer.component.ts`
- `AC` = `libs/frontend/chat/src/lib/settings/providers/accounts/account-chooser.component.ts`
- `AA` = `libs/frontend/chat/src/lib/settings/providers/accounts/add-account-dialog.component.ts`
- `PS` = `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts`
- `CD` = `libs/frontend/chat/src/lib/settings/providers/connection-detail-drawer.component.ts`
- `CK` = `libs/frontend/chat/src/lib/settings/providers/connection-drawer/connection-kind.ts`
- `ST` = `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts` (`ProviderAccountsStateService`)
- `RT` = `libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts`
- Spec files are the same names with `.spec.ts` (`AS.spec`, `AD.spec`, `AC.spec`, `AA.spec`, `ST.spec`).

"New location" for the moved surface is TBD until design. D39 item 1 fixes only the host: the right-side
drawer of the "Claude (Subscription)" connection (`CD`, kind `claude-cli`, tabs today
Overview / Credentials / Models, `CK:24`). The designer decides tab or panel placement.

## 1. Mount point and section shell

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| Accounts section mounted on the base Providers page, after the Connections grid, `@defer (on immediate)` | `PS:356-362`, import `PS:50`, `PS:89` | none (composition) | move (D39 item 1) | Claude (Subscription) connection drawer (`CD`, kind `claude-cli` at `CK:24`, `CK:38`); exact tab TBD by design | missing: no `PS.spec` test asserts the mount (grep for `accounts-section` in `providers-settings.component.spec.ts` finds nothing) |
| Electron-only gate: section and state owner never created on other hosts | `PS:562-563` (`accountsAvailable = VSCodeService.isElectron`); `ST:159` (`enabled`), `ST:45`, `ST:136` (inert view); `AS:137` (`view().status !== 'inert'`) | none | keep | same gate at the new mount in `CD` | `AS.spec:172` (inert renders nothing, no RPC); `ST.spec:108` |
| Load the Claude slot on first render | `AS:549` (`accounts.open`) -> `ST:209` | `provider:listAccounts` (`RT:36`, `RT:268`; called `ST:466`) | keep | inside the drawer; load trigger moves with the mount (opening the drawer) | `AS.spec:172`; `ST.spec:126` |
| Live snapshot updates by host push | `ST:142` (push via `MESSAGE_HANDLERS`) | `provider:accountsChanged` push, `ProviderAccountsChangedNotification` (`RT:120-122`) | keep | unchanged (state owner is not UI) | `ST.spec:119`, `ST.spec:143` |
| Section heading "Accounts" and intro sentence "Use a named local profile ... Credentials stay local." | `AS:139-156` (heading id `providers-accounts-heading`) | none | keep (copy may be re-worded by design) | drawer region | missing: no spec asserts the intro copy |
| Loading copy "Loading accounts…" / "Accounts load when a workspace is open."; Add disabled without snapshot | `AS:184-193`, `AS:160-162` | `provider:listAccounts` | keep | drawer region | `AS.spec:181` |
| First-read failure alert with Retry | `AS:168-182`, `AS:552-553` (`refresh`) -> `ST:216` | `provider:listAccounts` | keep | drawer region | `AS.spec:189`; `ST.spec:176` |
| Stale snapshot status "Showing the last loaded accounts..." with Retry | `AS:197-215` | `provider:listAccounts` | keep | drawer region | `AS.spec:199`; `ST.spec:176` |
| Section `aria-busy` while loading; `aria-labelledby` heading | `AS:139-142` | none | keep | drawer region | missing: no spec asserts `aria-busy` |
| Toast region (`accounts-toast`) for add, selection, default, remove, unconfirmed | `AS:357-362`, `AS:595-599`, `AS:627-631`, `AS:676`, `AS:685`, `AS:709`, `AS:749-756` | none | keep | drawer region | `AS.spec:313`, `AS.spec:275`, `AS.spec:414` |

## 2. Selection for next main session and next Claude lane

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| Two routing cards, "Next main session" and "Next Claude lane", each with title, name, state, scope sentence | `AS:219-262`, `SCOPE_COPY` `AS:53-69`, `routing` `AS:476-482`, `cell()` `AS:714-741` | snapshot `selections.main/lane` (`RT:107-112`, `RT:94-97`) | keep | drawer | `AS.spec:208`, `AS.spec:232` |
| Ambient cell copy "Use existing default" / "Existing Claude login", initials "CL" (both cards read the same when neither scope is named) | `AS:720-727` | snapshot selection kind `omitted`/`ambient` (`RT:85-86`; shared `provider-account.types.ts:219`) | remove-proposed (D39 item 2: the two cards must not both read this; reason: user feedback). Replacement wording/model is design work | drawer | `AS.spec:208` (asserts today's copy; must change with the decision) |
| Main-card API note "Used only when Claude sign-in is the main route..." | `AS:70-71` (`ACCOUNT_API_NOTE`), shown `AS:246-250` | none | keep | drawer (main card or equivalent) | missing: no spec asserts the note |
| Named cell profile-ID suffix `…abcd` (last 4 of profile UUID) | `AS:114-116` (`suffix`), rendered `AS:236-240`, set `AS:738` | snapshot `profileId` | keep - flagged. Not named in D39 item 4 (which covers card and Overview). Designer to confirm whether "remove the UUID" extends here; a removal must be recorded as remove-proposed | drawer | missing: no spec pins the suffix in the routing cell |
| Unavailable named selection: "Unavailable profile" / "This profile is no longer available." | `AS:729-737` | snapshot | keep | drawer | `ST.spec:782` (store clears); missing: no `AS.spec` test for the UI copy |
| "Change" button per card opens the chooser for that scope only (aria-label "Change account for <title>") | `AS:252-259`, `AS:255` | none | keep | drawer | `AS.spec:275` |
| Chooser modal: title per scope, "This changes only the selected future route." | `AC:72-93`, `AC:48` (`TITLE`), `AC:207` | none | keep | opened from the drawer (modal over drawer: stacking is a design/a11y check) | `AC.spec:153`, `AC.spec:167` |
| Chooser "Use existing default · Existing runner resolution" first option, always enabled | `AC:96-113` | `provider:setAccountSelection` with `{kind:'ambient'}` (`RT:44`, `RT:85-86`, `RT:233-238`) | keep the capability (writing ambient). Copy under review with D39 item 2 (ambient shown as a connected account) | drawer chooser | `AC.spec:97`, `AC.spec:153` |
| Chooser named rows: signed-in first, then others with state; "Sign in before using this profile." for not-signed-in | `AC:115-139`, `AC:52`, `AC:211-226` | snapshot | keep | drawer chooser | `AC.spec:112` |
| Chooser row suffix `<state> · abcd` (last 4 of profile UUID) | `AC:126-128`, `AC:218` | snapshot `profileId` | keep - flagged (same as routing suffix above) | drawer chooser | `AC.spec:112` (verify whether it asserts the suffix) |
| "Current" badge and `aria-current` for the stored selection; nothing chosen implicitly | `AC:100`, `AC:110-112`, `AC:120`, `AC:135-137`, `AC:208-210` | snapshot | keep | drawer chooser | `AC.spec:131`, `AC.spec:144` |
| Chooser empty copy "No named Claude accounts yet." | `AC:140-145` | none | keep (may change if ambient becomes a listed account) | drawer chooser | `AC.spec:97` |
| Write one scope only; pending "Saving selection…"; safe refusal sentence or fixed copy; stays open on refusal | `AS:611-638` -> `ST:370-387`; `AC:148-163`, `AC:53-54` | `provider:setAccountSelection` (`RT:44`, `RT:300`, params `RT:233-238`) | keep | drawer | `AS.spec:275`, `AS.spec:300`; `AC.spec:221`, `AC.spec:235`; `ST.spec:740` |
| Selection toast "<Next main session> account saved. <sentence>" | `AS:625-631` | none | keep | drawer | `AS.spec:275` |
| Chooser keyboard and focus: native buttons, Cancel / Escape / parent close return focus to opener | `AC:167-176`, `AC:181-182` | none | keep | drawer chooser (focus return target now inside a drawer) | `AC.spec:180`, `AC.spec:190`, `AC.spec:200`, `AC.spec:209` |

## 3. Account list (cards)

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| Empty state "No named Claude accounts yet. The existing Claude login is used until you add and choose one." | `AS:264-271` | snapshot `accounts` | remove-proposed (D39 item 2: the ambient login is shown as one connected account, so the list is never empty of it; reason: user feedback). Keep an equivalent when the ambient state is unknown/unavailable - design decides | drawer list | `AS.spec:208` |
| List `aria-label="Claude account profiles"`, one card per profile | `AS:273-353`, `cards` `AS:484-504` | `provider:listAccounts` snapshot `accounts` (`RT:109`) | keep | drawer list | `AS.spec:219` |
| Ambient (existing Claude login) as a list entry | does not exist today | see section 7 (no RPC reports ambient login state) | keep-new (D39 item 2) - not a parity row; listed so the gap is visible | drawer list | missing |
| Card initials avatar | `AS:290-294`, `initials()` `AS:103-113` | none | keep | drawer list | missing: no direct assertion |
| Card label | `AS:296-298` | snapshot `label` | keep | drawer list | `AS.spec:219` |
| Card full profile ID (UUID) line, mono | `AS:299-301` | snapshot `profileId` | **remove-proposed** (D39 item 4, user asked) | none | `AS.spec:219` region; update the spec with the removal |
| Card state dot + state text (`STATE_LABEL`: Not signed in, Signing in…, Sign-in cancelled, Sign-in failed, Disconnected, Signed in, Signed out); only `signed-in` shown as signed in | `AS:303-314`, `AS:38-46`, `AS:496-497` | snapshot `state` | keep | drawer list | `AS.spec:219` |
| Attention spine (4px error left border) for `failed` / `disconnected` | `AS:47-51`, `AS:280-281`, `AS:498` | snapshot `state` | keep | drawer list | missing: no spec asserts the spine |
| Owner badge "Verified identity" / "Unknown owner" | `AS:319-323` | snapshot `owner` | **remove-proposed** for "Unknown owner" (D39 item 4, user asked). "Verified identity" is the other branch of the same badge: designer to state whether it stays; if it goes, record it here as remove-proposed | none for "Unknown owner" | `AS.spec:219` ("shows owner evidence"); must change |
| Assignment badges "Next main" / "Next lane" | `AS:324-328`, `AS:499-502` | snapshot selections | keep | drawer list | `AS.spec:232` |
| Run-binding badge "Run binding · N active run(s)" (count only; there is no per-run list) | `AS:329-339` | snapshot `activeRunCount` | keep | drawer list | `AS.spec:219` |
| Card is a keyboard button (`role="button"`, Enter/Space), aria-label "Account details for <label>" | `AS:276-288`, `AS:564-569` | none | keep | drawer list | `AS.spec:248` |
| Nested "Manage" button, aria-label "Manage <label>", one open only | `AS:341-349`, `AS:572-575` | none | keep | drawer list | `AS.spec:262` |

## 4. Add account

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| "Add Claude account" button | `AS:157-165` | none | keep (copy may become "add a second account" per D39 item 2) | drawer | `AS.spec:181`, `AS.spec:313` |
| Add dialog: "Add a named Claude account", "Enter a local label only.", label field with max length, Add disabled until valid | `AA:28-120`, `AA:143-157` | none | keep | opened from the drawer | `AA.spec:77`, `AA.spec:93`, `AA.spec:104`, `AA.spec:112` |
| Add writes label only, never selects; toast "Profile added. It is not selected for any route." | `AS:584-600` -> `ST:249-255` | `provider:addAccount` (`RT:37`, `RT:272`, params `RT:155-160`) | keep | drawer | `AS.spec:313`; `ST.spec:208` |
| Add refusal alert (safe host sentence, e.g. duplicate directory) or fixed copy; pending "Adding profile…" | `AA:22-23`, `AA:88-101`, `AA:153-157`; `AS:590-593` | `provider:addAccount` result | keep | drawer | `AA.spec:122`, `AA.spec:136`, `AA.spec:145`; `AS.spec:326` |
| Add dialog focus: Cancel / Escape / committed close return focus; each open starts empty | `AA:110`, `AA:170` | none | keep | drawer | `AA.spec:158`, `AA.spec:168`, `AA.spec:177`, `AA.spec:191` |

## 5. Account details drawer

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| Drawer on `NativeDrawerComponent`, accessible name "Account details for <label>"; renders only with an account | `AD:124-132`, `AD:375-378` | none | keep (nesting a drawer inside the connection drawer is a design/a11y decision) | TBD | `AD.spec:121`, `AD.spec:131` |
| Tabs Overview / Access / Profile, WAI-ARIA keyboard (arrows, Home, End), hidden panels out of tab order | `AD:56-60`, `AD:136-154`, `AD:472-493` | none | keep | TBD | `AD.spec:137`, `AD.spec:159` |
| Each open starts on Overview | `AD:446-458` (effect sets `'overview'` at `AD:452`) | none | keep for signed-in accounts; change for not-signed-in (D39 item 3: open on Access when the account is not signed in) | TBD | `AD.spec:492` (must change) |
| Focus return to opener, Escape closes, closing never cancels a sign-in | `AD:124-128`, `AS:577-580` | none | keep | TBD | `AD.spec:172`, `AD.spec:181`, `AD.spec:188` |
| Polite status line: pending action text (`PENDING_TEXT`), "Local label saved.", default toast | `AD:156`, `AD:90-99`, `AD:421-432` | none | keep | TBD | `AD.spec:358`, `AD.spec:425`, `AD.spec:465` |
| Refusal alert: safe sentence, else fixed copy | `AD:158-172`, `AD:415-420`, `AD:101` | action results from every write | keep | TBD | `AD.spec:373` |
| `release-held` result: "Not available" block, neutral fallback copy, actions stay visible | `AD:159-166`, `AD:53-54`, `AD:414` | action result code `release-held` | keep | TBD | `AD.spec:245`, `AD.spec:267` |
| Overview: "Local profile ID" row (full UUID, mono) | `AD:178-181` | snapshot `profileId` | **remove-proposed** (D39 item 4, user asked) | none | `AD.spec:383` region; update spec |
| Overview: State row | `AD:182-185` | snapshot `state` | keep | TBD | `AD.spec:200-216` (`it.each` states) |
| Overview: "Usage owner: Verified identity / Unknown owner" block and "Owner evidence is separate..." sentence | `AD:187-192` | snapshot `owner` | **remove-proposed** for "Unknown owner" and its explainer (D39 item 4, user asked). "Verified identity" branch: designer to decide; record any further removal here | none | `AD.spec:397` ("shows Unknown owner"); must change |
| Overview: run binding "Run binding — N current run(s)" with "does not move started work" sentence (count only, no run list) | `AD:193-199` | snapshot `activeRunCount` | keep | TBD | `AD.spec:419` |
| Overview: "Can’t resume this run" notice when bound and not signed in | `AD:200-208` | snapshot | keep | TBD | `AD.spec:404`, `AD.spec:419` |
| Overview: "No current runs are bound to this profile." | `AD:209-211` | snapshot | keep | TBD | `AD.spec:397` |
| Access: state heading and detail per state (`STATE_COPY`) | `AD:62-77`, `AD:215-219`, `AD:395-399` | snapshot `state` | keep | TBD | `AD.spec:200-216` |
| Sign in / Sign in again / Try again (by state) | `AD:79-88`, `AD:254-258`; `AS:646-650` -> `ST:288-293` | `provider:startAccountSignIn` (`RT:41`, `RT:288`, params `RT:189-190`, result `RT:206-210`) | keep | TBD | `AD.spec:200-216`; `AS.spec:338`; `ST.spec:239` |
| Pending copy "Finish sign-in in the Claude window." | `AD:47-48`, `AD:67` | snapshot `pending` | keep | TBD | `AD.spec:276` |
| Cancel sign-in (explicit only) | `AD:244-248`; `AS:652-656` -> `ST:313-323` | `provider:cancelAccountSignIn` (`RT:42`, `RT:292`, params `RT:214-218`) | keep | TBD | `AD.spec:221`; `ST.spec:239` |
| Sign out (signed-in only) | `AD:249-253`; `AS:658-662` -> `ST:300-305` | `provider:signOutAccount` (`RT:43`, `RT:296`, params `RT:223-224`) | keep | TBD | `AD.spec:200-216`; `ST.spec:652` |
| Refresh status (not while pending) | `AD:260-264`; `AS:642-643` -> `ST:332-340` | `provider:getAccountStatus` (`RT:40`, `RT:284`, params `RT:179-186`) | keep | TBD | `AD.spec:238`; `ST.spec:652`, `ST.spec:549-623` |
| Fallback script block (no login window): "Sign in from a terminal", "Run it in a new terminal window.", "No Claude window could be opened for this sign-in.", read-only `<pre>` (aria-label "Sign-in script"), Copy script / Copied, copy status, Check status | `AD:220-241`, `AD:49-52`, `AD:390-413`; source `AS:520-525` -> `ST:203` | `provider:startAccountSignIn` result `fallback` (`RT:201-210`); Check status = `provider:getAccountStatus` | keep | TBD | `AD.spec:285`, `AD.spec:314`, `AD.spec:341`; `AS.spec:378`, `AS.spec:403`; `ST.spec:275`, `ST.spec:323`, `ST.spec:341-532` |
| Profile: pending lock "Finish or cancel sign-in before changing this profile." | `AD:270-274`, `AD:381-383` | snapshot `state` | keep | TBD | `AD.spec:221` |
| Profile: rename form "Local label", hint `ACCOUNT_RENAME_HINT`, "Save local label", "Local label saved." | `AD:275-293`, `AD:45-46`, `AD:433-440`; `AS:664-668` -> `ST:260-266` | `provider:renameAccount` (`RT:38`, `RT:276`, params `RT:164-168`) | keep | TBD | `AD.spec:465`; `ST.spec:652` |
| Profile: "Set as default" (both scopes, future unbound starts) and toast `ACCOUNT_DEFAULT_TOAST` | `AD:295-297`, `AD:39-40`; `AS:670-678` -> `ST:398-414` | `provider:setAccountDefault` (`RT:45`, `RT:300`ff; selection type `ST:560`) | keep (workspace default) | TBD | `AD.spec:425`; `ST.spec:740` |
| Profile: "Remove profile" with metadata-only confirmation (`ACCOUNT_REMOVE_CONFIRMATION`), Cancel / "Remove local profile", focus moves to Cancel and back | `AD:298-317`, `AD:42-43`, `AD:504`, `AD:511`; `AS:680-687` -> `ST:275-280` | `provider:removeAccount` (`RT:39`, `RT:280`, params `RT:173-176`) | keep | TBD | `AD.spec:442`; `ST.spec:782` |
| Busy: any in-flight action disables every action and is announced | `AD:379`, `AD:358`-region | none | keep | TBD | `AD.spec:358` |
| Never shows a path, email, organization or token | `AD:115-116` (doc), template | none | keep (constraint) | TBD | `AD.spec:383` |
| Unconfirmed write: "This action may not have completed. Accounts were reloaded." | `AS:73-74`, `AS:749-756` | host timeout/transport | keep | drawer | `AS.spec:414`; `ST.spec:689` |

## 6. Target host: Claude (Subscription) connection drawer (today)

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| Connection drawer tabs by kind; `claude-cli` = Overview & Used By / Credentials / Models & Tiers | `CK:17-24`, `CK:50`; `CD:178-186` | none | keep (receives Accounts per D39 item 1) | `CD` | `connection-drawer/connection-kind.spec.ts` (verify); `connection-detail-drawer.component.spec.ts` |
| Active tab resets to Overview on connection change | `CD:254` | none | keep | `CD` | `connection-detail-drawer.component.spec.ts` |
| Credentials tab for `claude-cli`: "CLI subscription session", "Claude CLI detected / not found", `claude login` copy command, Check again | `connection-drawer/credentials-tab.component.ts:93`, `:107-122`, `:355` | `auth:checkConnection` -> `connection-check.ts:193-196` (detection only) | keep | `CD` | `credentials-tab.component.spec.ts`; harness `settings-reachability.table.ts:417-421` |
| Drawer opened from Providers page | `PS:454` | none | keep | `PS` | harness `settings-reachability.table.ts:332`, `:364` |

## 7. Ambient ("existing Claude login") data available today

Question: is there an RPC that reports the ambient login state (signed in or not, class word) without
secrets? **None exists.** Evidence:

- `provider:listAccounts` snapshot carries only named `accounts` and the two scope selections; no ambient
  login field (`RT:107-112`). An `ambient` selection is a sentinel with no state (`RT:85-86`).
- `auth:getAuthStatus` reports `claudeCliInstalled?: boolean` only - installed, not signed in
  (`libs/shared/src/lib/types/rpc/rpc-auth.types.ts:208-209`).
- `auth:checkConnection` for `claude-cli` is CLI detection only: `cliDetector.performHealthCheck().available`
  -> `verified` or `not-installed` (`libs/backend/rpc-handlers/src/lib/handlers/connection-check.ts:193-196`;
  reasons `rpc-auth.types.ts:268-271`). It does not run `claude auth status`.
- The secret-free parser that yields `loggedIn` and the class word exists in the backend:
  `ClaudeAccountStatus` = `{loggedIn:false}` or `{loggedIn:true, accountClass:'P'|'O', identityReference, configDirectoryMatches}`
  (`libs/backend/auth-providers/src/lib/accounts/claude-account-status.ts:14-23`, `:8`, `:118`). It is only run for a
  named profile's reserved route: `ClaudeAccountCommand.status()` refuses unless `claudeAccountRouteHolds(route)`
  (`libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:322-329`). No handler runs it for the
  ambient `~/.claude` directory.
- Consequence for D39 item 2: showing the ambient login with a real signed-in/not-signed-in state needs a new
  host read (a new RPC or a new snapshot field). Showing it as "Existing Claude login" without a state needs
  no new RPC. This is a design/scope decision for the next step, not resolved here.

## 8. Electron e2e harness

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| Settings fixtures stub for account RPCs | none: `settings.fixtures.ts` has no `provider:*Account*` handler (grep); only `claude-cli` connection data (`settings.fixtures.ts:53`, `:290-300`, `:340`) | n/a | missing coverage | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts` | missing |
| Reachability rows for Accounts | none: `settings-reachability.table.ts` has no account row; the Claude (Subscription) drawer is reached at `:332`, `:364`, `:417-421` | n/a | missing coverage | `settings-reachability.table.ts` | missing |

## 9. Out-of-surface consumers (unchanged by P5, listed so nothing is dropped)

- Lane header "Account: <label>" / "Default" / "Removed account" badge (D36, decisions.md:207) and session row label:
  they read run bindings, not this section. Keep; P5 does not touch them.
- `ProviderAccountsStateService` (`ST`) is UI-agnostic; every RPC above keeps its contract. No RPC is removed.

## Summary of removals

| Item | Decision | Reason |
| --- | --- | --- |
| Card full profile ID line (`AS:299-301`) | remove-proposed | user asked (D39 item 4) |
| Card "Unknown owner" badge (`AS:319-323`) | remove-proposed | user asked (D39 item 4) |
| Overview "Local profile ID" row (`AD:178-181`) | remove-proposed | user asked (D39 item 4) |
| Overview "Usage owner: Unknown owner" block (`AD:187-192`) | remove-proposed | user asked (D39 item 4) |
| Routing cards both reading "Use existing default / Existing Claude login" (`AS:720-727`) | remove-proposed | user asked (D39 item 2) |
| Empty list copy (`AS:264-271`) | remove-proposed | ambient login becomes a listed account (D39 item 2) |
| Base-page mount (`PS:356-362`) | move | user asked (D39 item 1) |
| Always-Overview initial tab (`AD:452`) | change for not-signed-in | user asked (D39 item 3) |

Open for design (not removed here): profile-ID suffixes in routing cells (`AS:236-240`) and chooser rows
(`AC:126-128`); the "Verified identity" branch of the owner badge/block.
