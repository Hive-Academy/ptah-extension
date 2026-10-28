## Frontend implementation — `TASK_2026_719_4f64`, batch F4 (P5)

**Tasks completed**: plan §12 `AccountsTabComponent`, plan §13 connection drawer Accounts tab.

**Files** (worktree `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts`):

- CREATED `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-tab.component.ts`: `ptah-accounts-tab`. On init it calls `accounts.open('claude')` and `ambient.read(true)` at the same time. The region is labelled by `USE_FOR_HEADING_ID` (it falls back to an `aria-label` before the first snapshot) and has `aria-busy` while the list loads or the ambient status is checking. It shows the first-load error / loading / stale notices with "Try again", `ptah-account-use-for`, a polite toast (`tabindex=-1`), an alert line, the `h3` "Accounts" and a `role=list` "Claude accounts" list: the ambient row first, then named rows from `orderedAccounts`. Each row has an avatar, name, dot + state, "Run binding · N active runs", chips, a failed/disconnected spine, a `role=button` body with Enter/Space, "Sign in" for not-signed-in/failed/cancelled, and "Manage <name>". After the list comes "Add another account" or `ptah-add-account-form` (created and destroyed with `@if`). The list/detail switch is one `tabView` signal. Every write goes through `ProviderAccountsStateService`, and its outcomes map to toast / alert / scope message / detail feedback.
- CREATED `.../accounts/accounts-tab.component.spec.ts`: 25 cases (listed below).
- MODIFIED `.../connection-drawer/connection-kind.ts`: `ConnectionDrawerTabId` gains `'accounts'`. Adds `ACCOUNTS`. `claude-cli` → `[OVERVIEW, ACCOUNTS, CREDENTIALS, MODELS]`.
- MODIFIED `.../connection-drawer/connection-kind.spec.ts`: checks the claude-cli order with Accounts second; the other kinds have no Accounts tab.
- MODIFIED `.../providers/connection-detail-drawer.component.ts`: adds `accountsAvailable = input(false)`, and `tabs` drops `accounts` when it is false. `SETUP_COPY` is now typed over `Exclude<…, 'overview' | 'accounts'>`, and `setupCopy`/`setupFallback` are empty/false on Accounts. Adds `@case ('accounts') { <ptah-accounts-tab /> }`. Host `whitespace-nowrap` (and the body's `whitespace-normal`) are replaced by `[&_[role=tablist]]:flex-wrap` (P5-D6). The reset-to-Overview effect is unchanged.
- MODIFIED `.../providers/connection-detail-drawer.component.spec.ts`: fakes for the two account services, plus 4 cases: the tab is absent when not available; it is second when available and absent for other kinds; it renders with no setup copy or Edit in setup and resets to Overview on connection change; the strip wraps and has no `whitespace-nowrap`.

**Stack observed**: Angular standalone + OnPush + signals (`copy-button`, the F2/F3 siblings), Tailwind/DaisyUI (prototype, siblings), and the root services `ProviderAccountsStateService` and `ClaudeAmbientStatusService` from `@ptah-extension/core`.

**Binding rules in code**
- B-1: `remove()` only calls `removeAccount` and never `setSelection`. Selects and chips come from `useForModel`/`assignmentChips` over the authoritative snapshot. Specs: removal with a host snapshot that omits the selection shows "Existing Claude login"; a host snapshot that still names the removed id shows the `unavailable` placeholder; `setSelection` is never called.
- Busy in the same handler: `select()`, `run()` (all detail actions) and `add()` set `pendingScopes` / `busy` / `addPending` synchronously before their first `await`. The specs check the signal immediately after `emit`, with no tick.
- B-2 (tab-owned focus): when the open account leaves the snapshot, the tab goes back to the list. The "Accounts" heading gets focus only if focus was inside the detail area (or was lost to `body`). After Add, the new account opens on Access only if focus is still in the add area; otherwise the tab stays on the list and the toast announces. Cancel focuses Add another account. "All accounts" focuses that row's Manage button. The children keep their own B-2 for selects, detail actions, the ambient row and the add form. Specs cover both branches for removal.
- The row "Sign in" uses `aria-disabled`, not `disabled`, while that account is busy. It stays focusable, and a second click does nothing (spec).

**Spec cases** (`accounts-tab.component.spec.ts`): init calls both reads; region label/busy; S1 shows the ambient row + Add with no empty copy; Add is disabled without a snapshot and first-load error has Try again; ordering, text-only names (`<b>` stays literal) and the spine; detail opens on Overview vs Access (Manage and Enter on the row body); All accounts → Manage focus; select busy is per scope and set in the same handler; a saved select toast names the account from the host snapshot; a refused select uses the fallback for an unsafe summary and the value reverts; an unconfirmed select keeps the select and chips, shows the warning and no toast; a detail action is busy in the same handler and `busy` reaches the detail; the row Sign in stays focusable and does not start twice; a saved rename gives "Name saved."; removal B-1 omitted case + heading focus; removal B-1 still-named case → unavailable; removal B-2 with focus moved elsewhere keeps focus + toast; a push that removes the open account → list; Add success → detail on Access + toast with no select or sign-in; Add refusal keeps the form + alert; Add Cancel → focus on Add; Check again → `read(true)`.

**Verification**
- `node D:/projects/ptah-extension/scripts/verify.mjs --exec --task f4-jest -- npx jest -c libs/frontend/chat/jest.config.ts <accounts-tab spec> <connection-kind spec> <connection-detail-drawer spec>` → `Test Suites: 3 passed, 3 total; Tests: 71 passed, 71 total`.
- `ptah_get_diagnostics` (scoped to the 3 source/spec files) could not run: the TS check timed out after 45 s. Typecheck and lint were **not** run (verify is not allowed in this batch). The orchestrator's batch verify should confirm typecheck. One item to watch: the specs use `code: 'conflict'` in `ProviderAccountActionResult` fixtures. If that is not a member of the closed code union, typecheck flags it; replace it with any valid failed code.

**Design fidelity**: design-spec-p5 §2, §3.1-3.7 and §5, plus the F2/F3 handoff notes. Copy used: "Accounts could not be loaded." / "Showing the last loaded accounts. The latest refresh failed." / "Try again" / "Loading accounts…" / "Accounts load when a workspace is open." (§3.7). The add toast and selection toasts are from §3.5 and §3.7.

**Plan deviations**
- The Use-for block stays visible above the detail view; only the lower list area swaps between list and detail. Evidence: busy rule (b) says "both selects stay usable" during a detail action, and the region's `aria-labelledby` needs the Use-for heading. Reversible.
- Check status (detail) calls `refreshAccountStatus` without a busy entry, because `ProviderAccountActionKind` has no check kind and the read returns no outcome. The detail returns focus at once. See the open points.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Removal toast "<name> was removed." (fallback "The account was removed.") | old "Local profile metadata removed."; new sentence | §4 retires "profile"; plan §12 "toast from the removal result" gives no copy | yes |
| After Add, open the detail only when focus is still in the add area; otherwise stay on the list with the toast | always open the detail; B-2 gate | D42 rule 2; the detail focuses its heading unconditionally on open | yes |
| Row Sign in uses `aria-disabled` while busy instead of `disabled` | disable + move focus to the toast; `aria-disabled` | §3.7(c): a focused control is never left disabled without moving focus | yes |
| A failed or unavailable action started from the list (not in the detail) goes to the tab's `role=alert` line; unconfirmed goes to the toast | toast only; alert | §5: refusals are `role=alert` | yes |
| `unavailable` select outcome → alert with the §3.7 fixed fallback | generic action fallback; §3.7 fallback | §3.7 Refused copy | yes |

**Open points for F5 (and later)**
- F5 must pass `[accountsAvailable]="accountsState.state('claude')().status !== 'inert'"` (or the equivalent gate) to `ptah-connection-detail-drawer` on the providers page. Until then the Accounts tab never shows (the default is false).
- F5 badge: `connectedAccountCount(accountsView, ambientView)`. The page-show ambient read is `read(false)` (P5-D10). The tab already calls `read(true)` on open.
- Check status has no busy state (no `ProviderAccountActionKind` for it). If review wants the detail's actions disabled during a status read, add a `'check'` kind in core or a separate `checking` input on the detail view (F3-owned).
- `AccountDetailViewComponent` focuses its heading unconditionally when an account opens. The tab avoids calling this after an async Add when focus has moved. Any other async-driven open would need the same guard.
- F6 deletes `accounts-section`, whose `STATE_LABEL`/`ATTENTION` copies are still duplicated. The tab keeps its own `ROW_DOT` map because the detail's `STATE_DOT` is private. They could merge into `account-presentation.ts` later.
- Visual review in Electron: the wrapping tab strip at 245-360px, the row layout with long names, and the nested `ptah-native-modal` inside `ptah-native-drawer`.

**Out-of-scope observations**: jsdom has no `HTMLDialogElement.showModal/close`. The spec polyfills them in `beforeAll` because `ptah-native-modal` (inside the detail) calls `close()` on render.
