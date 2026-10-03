# Batch 24 report: compact connection card (card actions move into the drawer; whole-card trigger)

Executor: Providers owner (in-process frontend-developer). Worktree
`D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign`, on top of 65b8a9fa0.

- Nothing committed; no git stash / restore / checkout / reset / clean.
- No `libs/frontend/ui`, `core`, `shared` or backend edits.
- `ProviderSetupWizardComponent` is untouched: `git diff HEAD --stat` on it is empty.

Paths are relative to `libs/frontend/chat/src/lib/settings/providers/` unless prefixed `HARNESS/`
(`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/`).

| Abbreviation | File |
|---|---|
| `C` | `provider-connection-card.component.ts` |
| `S` | `provider-connection-card.state.ts` |
| `PS` | `providers-settings.component.ts` |

## Files

| Status | File | Lines | Role |
|---|---|---|---|
| REWRITE | `provider-connection-card.component.ts` (+ spec, rewritten) | 248 (was 852) | Compact two-row card, whole-card trigger, one inline action |
| CREATE | `provider-connection-card.state.ts` (+ spec) | 219 | Pure state derivations (moved from the card), the one-action rule, and the avatar helpers shared with the drawer |
| MODIFY | `providers-settings.component.ts` (+ spec) | 691 | Grid classes, `detailsRequested` → drawer, `usedByCount`, removal of the duplicated container padding, shorter provenance, "Custom" badge |
| MODIFY | `connection-detail-drawer.component.ts` (+ spec import) | 243 | Imports `connectionInitials` / `connectionAvatarTone` from the state file; its local copies are deleted |
| MODIFY | `connection-drawer/overview-tab.component.ts` | — | One type-import line: `ProviderConnectionCardStatus` now lives in the state file |
| MODIFY | `HARNESS/settings-drawer.reach.ts` | — | `openCardDrawer` (a click on the card); `drawerTabOf` uses it |
| MODIFY | `HARNESS/settings-reachability.table.ts` | — | `throughCard` opens via the card; #15 re-pointed to the drawer |
| MODIFY | `HARNESS/settings-visual.e2e.spec.ts` | — | Card height / width / column measurement; drawers opened by a card click |

Files outside the batch list: the drawer, its spec import, the overview-tab import, the harness reach helper and the
visual spec. They changed because the moved types and helpers, and the removed Manage button, were used there. No shim
or re-export is left behind.

## Old card action → new place (D14)

Before this batch the card rendered, per state (`C` at 2cb… / 65b8a9fa0 `:187-410`), the actions below. None was
removed without a place that offers it in this same batch.

| State | Old card action (testid → handler) | New place |
|---|---|---|
| active | Change main provider (`btn-change-main` → `requestFocus('connections')`) | The main-agent block's own "Change main provider" button (`PS:96`, same handler). It was a duplicate on the card |
| active, connected, needs-key, unauthenticated, not-checked, check-unavailable | Manage (`btn-manage` → `openDrawer`) | **The whole card** (`C:64-65`, `activated` → `detailsRequested` → `PS:181 openDrawer`), for every state (RUX-4) |
| connected | Use for main agent (`btn-activate-main` → `beginActivation`) | **Kept inline**: the state's one action (`S primaryConnectionAction`) |
| needs-key | Add API key (`btn-add-key` → wizard) | **Kept inline**. Also in the drawer: Credentials "Add key" (`credentials-tab.component.ts:189`, verify-then-save) |
| unauthenticated | Replace key / Sign in (`btn-replace-key` → wizard / `btn-sign-in` → sign-in) | **Kept inline**. Also in the drawer: Credentials Replace (api-key), Open login (OAuth / Codex) |
| unreachable | Retry (`btn-retry` → `checkConnection`) | **Kept inline**. Also in the drawer: Overview "Check connection" |
| unreachable | Edit connection (`btn-edit-connection` → wizard) | Drawer (card click). api-key: Credentials Replace plus Models & Tiers, which is everything the wizard edits for api-key. local: Credentials footer "Edit in setup". custom: Advanced plus "Edit in setup". oauth: Credentials Open login plus Models & Tiers |
| not-installed | Installation instructions (`btn-install-instructions` → `cli-login`, which only publishes the two commands) | Drawer Credentials: `claude login` and the npm install command, each with Copy (`credentials-cli`) |
| not-installed | Check again (`btn-check-again` → `cli-check`) | **Kept inline**. Also in the drawer: Credentials "Check again" (`credentials-cli-check`) |
| not-configured | Set up (`btn-setup` → wizard) | **Kept inline** |
| not-checked | Check connection (`btn-check-connection` → `checkConnection`) | **Kept inline** when checkable. Otherwise: drawer Overview "Check connection" |
| not-checked / check-unavailable (not checkable) | Use for main agent | **Kept inline** as the one action (not checkable is not failed) |
| check-unavailable | Retry | **Kept inline** when checkable. Otherwise: drawer Overview "Check connection" |
| (scope row) | Override for this workspace (`scopeOverrideRequested`) | Already removed in Batch 23 (badge renders nothing when inherited); the parent passes no scope to the card |

Outputs kept but no longer emitted by the card: `changeMainProviderRequested`, `manageRequested`,
`editConnectionRequested`, `installInstructionsRequested`, `scopeOverrideRequested`. They are documented at `C:52-55`.
The parent no longer binds them. Every input and output is still declared (plan :628).

## Acceptance → file:line → spec

| Acceptance | Implementation | Spec |
|---|---|---|
| Card ≤ 80 px | Two rows in `density="compact"`: row 1 `min-h-7` (28 px avatar, name + provenance at `leading-tight`) and row 2 `min-h-6`, with `gap-0.5`. Only one inline action (`btn-xs`, link style, `!px-0`, `C:96-101`). The full state sentence moved off the face (see deviation 2). Measured (below): **VS Code 80 px for all 5 cards, both themes.** Electron: see "Escalation". | Visual spec: height measurement and assertion (VS Code), `HARNESS/settings-visual.e2e.spec.ts:99-112` |
| Clickable → `detailsRequested` | `C:64-65`: `[clickable]="true"` with an `ariaLabel`, and `(activated)` → `detailsRequested` (`C:168`). `NativeCardComponent` ignores clicks on the nested inline button. `PS:181` → `openDrawer`. | Card spec "a click, Enter or Space on the card emits detailsRequested", "the inline action emits its own output, never detailsRequested"; harness: every drawer reach now opens by a card click (`HARNESS/settings-drawer.reach.ts:41`) |
| At most one inline action | `S:145` `primaryConnectionAction` (table in its doc comment); `C:228-247` maps it to a label, testid, aria-label and output. Active and Checking have none. RUX-7 is unchanged: a checkable Not checked connection gets Check connection, not activation. | State spec `primaryConnectionAction` (15 cases); card spec "one inline action per state" (10 cases, exactly one button each), "Active / Checking carry none", "RUX-7", "no longer renders Manage, Change main provider, Edit connection or Installation instructions" |
| Every existing input and output kept, incl. `manageRequested`; `detailsRequested` and `usedByCount` added | `C:122-178` | typecheck of every consumer |
| Testids kept: `provider-connection-card`, `provider-name`, `status-copy`, `auth-modality` | `C:66`, `:72`, `:94`, `:82`. `status-badge` (harness #2) is kept too (`C:87`). | Card spec (layout block); harness #2 |
| Colour on dot and badge only; text `text-base-content` (D13) | The dot's colour comes from `S:114`. The avatar tone is a border / fill (`S:215`), with initials in `text-base-content`. The modality badge is neutral outline. Status label, name, action and "Used by" are base-content or muted. | Card spec "row 2 holds the status dot…" (`text-base-content`, `.bg-success` on the dot); state spec (dot table) |
| Card file under 700 counted lines | 248 raw lines. The state table and derivations moved to `S` (pure functions). The card's `max-lines` lint warning is gone (chat warnings 31 → 30). | lint |
| Grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3` | `PS:174` (`connections-grid`) | Visual spec asserts 3 columns at 1024 px in both hosts |
| `ResolvedConnectionState` derivations are pure functions in `.state.ts` | `S:42` resolve, `:62` label, `:78` copy, `:94` tone, `:106` spine, `:114` dot, `:145` action, `:165/:182` modality | `provider-connection-card.state.spec.ts` (all derivations, table-driven) |
| Never Connected without confirmed evidence | `S:42-58` (unchanged logic, moved) | State spec (11 cases); card spec "never Connected…" (7 cases) |
| Blocked main route | `C:88-91`: a warning icon plus "Main agent · Needs attention ·", warning tone and spine, and the accessible name says so | Card spec "main agent" block (3 cases) |
| "Used by N" | `C:111-113`, hidden while `usedByCount` is null. `PS:180` passes the Batch 19 `connectionUsage` count only when `complete`, else null, so no guessed 0 is shown. | Card spec "'Used by' is hidden while the count is unknown…" |
| Harness: re-point the card-action entries to the drawer | `openCardDrawer` (`HARNESS/settings-drawer.reach.ts:41`); `throughCard` (`HARNESS/settings-reachability.table.ts:269`) opens via the card, then "Edit in setup". #15 (`:385`) is now drawer Credentials: the optional-key copy and Replace. #2 (`status-badge`) and #3 (`btn-activate-main`) are unchanged and still reach. | Gate G 27/27 |

## Write-path trace

This batch adds and changes **no write**. Every inline action calls the same parent handler it called before this batch:

- Use for main agent → `beginActivation` → the existing review → `state.activateConnection` → `auth:saveSettings {authMethod,
  anthropicProviderId?, applyTo}`, which ends sessions (Batch 23 trace 3).
- Add API key / Replace key / Set up → `openWizard(id)`, the unchanged wizard and its existing writes.
- Sign in → `state.performExternalAuth(id, 'sign-in')` → `auth:codexLogin` / `auth:copilotLogin`. Ptah writes no setting.
- Check again → `performExternalAuth(id, 'cli-check')`, a read.
- Retry / Check connection → `state.checkConnection()`, a read.

The card click → `openDrawer` is a read too: `refreshConnectionSetup`. The drawer's writes are the Batch 21/22 traces,
unchanged.

## Verification

1. `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui
   @ptah-extension/webview-e2e-harness ptah-extension-webview --parallel=2` exited 0 ("Successfully ran targets typecheck, test,
   lint for 5 projects"). This is the final run on the final tree. Log: `%TEMP%\b24-verify.log`.
   - Tests: core 1083/1083; ui 610/610; chat 1914 passed + 2 skipped (1916); webview 224/224.
   - Lint: 0 errors. Warnings core 11, chat **30** (the card's `max-lines` warning is gone), harness 41.
   - Harness lint returned to 41 after one failed edit was corrected: an unused `authModalityBadge` import in the
     state spec, whose `describe` edit had been rejected, now re-applied.
2. **Build.** `npx nx build ptah-extension-webview` exited 0 with **no budget error** (`%TEMP%\b24-gateg-build.log`).
   - The initial total is **3.48 MB** (715.43 kB transfer), about 3.5 kB smaller than Batch 23: the card's template
     shrank, and it drops the vendor mark and eight icons.
   - The 2.5 MB warning budget was already exceeded; the 3.5 MB error budget is met.
3. **Gate G.** `settings-reachability.e2e.spec.ts --reporter=list --repeat-each=3` gave **27 passed** (1.6m), exit 0. Log:
   `%TEMP%\b24-gateG.log`.
4. **Captures.** `settings-visual.e2e.spec.ts --reporter=list --repeat-each=3` gave **12 passed** (33.3s), exit 0
   (`%TEMP%\b24-visual.log`).
   - Measured, every repeat:
     - VS Code, both themes: heights **80,80,80,80,80 px**, width 269 px, 3 columns.
     - Electron, both themes: heights **111,100,100,80,100 px**, width 215 px, 3 columns.
   - `git status --short -- …/screenshots/angular/baseline-*` is **empty**.
   - How the earlier red runs were diagnosed (each recorded, none silently re-run):
     - (a) The first measurement gave 92-158 px. Two causes: the page applied the shell's `max-w-4xl` + `lg:px-8` a
       second time, and row 1 / row 2 wrapped at about 219 px of content width.
     - (b) After the width fix, connected cards were 100 px. A width diagnostic showed row 2 needed 244 px of 243:
       the link's padding was still 4 px, because `px-0` / `px-0.5` lose to daisyUI's `btn-xs`. `!px-0` fixed it.
       Diagnostics removed.

## Escalation (Q-extra-1): Electron card height

- **What is measured:** in Electron at 1024×768 the app shell's workspace sidebar and git rail leave the Settings page
  about 670 px wide. The grid still takes 3 columns (the viewport is at `lg`), so each card is 215 px wide with about
  181-189 px of content. At that width the "Use for main agent" link cannot share row 2 with the status and "Used by",
  and "Claude (Subscription)" plus the "Active for main agent" label wrap. Result: 100-111 px.
- **Why it is not fixed here:**
  - The plan fixes the grid classes to the viewport breakpoints.
  - Tailwind is 3.4 without the container-queries plugin.
  - Batch 28's fold gate requires "3 columns at 1024 px" and says an Electron-only failure is escalated (Q-extra-1).
- **Options for the user at Gate V 28** (measured, not built):
  - (1) A width-driven grid, `grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]`: 3 columns in VS Code, 2 in Electron
    (cards about 320 px, 80 px tall, 3 rows).
  - (2) A shorter visible link label, "Use as main", keeping the full accessible name.
  - (3) Accept 100-111 px cards in Electron.
- **In the spec:** it asserts ≤ 80 px for VS Code only. It logs the Electron numbers and asserts 3 columns in both
  hosts.

## Drift checkpoint: `current-providers-*` vs `prototypes/final/screenshots/index-{anubis,anubis-light}-1024x768.png` (card grid, structure only)

| Aspect | Prototype | Ours (VS Code) | Ours (Electron) | Drift |
|---|---|---|---|---|
| Grid | 3 columns, `gap-3`, 5 cards in 2 rows | 3 columns, `gap-3`, 5 cards in 2 rows | 3 columns, 2 rows | none |
| Card height | 76 px (`.conn-card`, `app.css:236-238`) | 80 px (all) | 80-111 px | Electron only, escalated above |
| Card width | about 317 px (grid about 976 px wide) | 269 px (grid 832 px: the Settings shell's `max-w-4xl`) | 215 px | Narrower page. The shell width is Batch 18's; this batch removed only the duplicated inner padding |
| Row 1 | 28 px initials avatar (tinted), name, grey provenance line, modality badge top-right | Same: "CS / Claude (Subscription) / CLI subscription / CLI", "MK / Moonshot (Kimi) / Key stored locally / API key", "SO / sovereigneg / Key stored locally / Custom" | Same, but "Claude (Subscription)" wraps | Provenance copy differs: ours is honest data ("Key stored locally", or the auth mode), not "CLI login · Anthropic" |
| Row 2 | Status dot + label (+ inline Retry on the failed card), "Used by N (detail)" right | Dot + label ("Active for main agent", "Connected", "Unreachable"), one inline link ("Use for main agent" / "Retry"), "Used by N" right | Link wraps to a third line | Connected cards carry "Use for main agent" (the prototype has none; D14, see the table). "Used by" shows the count only, no role detail |
| Whole card is the trigger | yes (`role=button`, `tabindex=0`, opens the drawer) | yes (`NativeCardComponent` clickable, Enter / Space) | yes | none |
| Active card | Primary border, inset primary spine | Secondary (gold) spine: the design-spec tone mapping ("reuse as-is, no new tone") | same | Tone per design-spec §3.3, not the prototype's primary |
| Failed card | Red spine and border, "Check failed" | Orange (warning) spine, "Unreachable" (fixture status `unreachable`; the state table's tone) | same | Tone and label per the state table |
| Label / text colour | Coloured status text (`text-success`) | Label `text-base-content`, colour on the dot (deviation 6 / D13) | same | Accepted deviation 6 |
| "+ Connect another provider" tile, "Connections · 5 configured" header with filter, catalog hint strip | present | absent | absent | Batch 27 (catalog modal) and Batch 28 (composition, header, hint strip). Out of scope here |

Verdict for the drift checkpoint: the card and grid **structure** matches the prototype (two-row compact cards, 3 × 2 grid,
whole-card trigger, one inline action, "Used by" right). The one structural gap is Electron card height, escalated above.
The rest are page-composition items owned by Batches 27-28, or recorded tone / colour decisions.

## Deviations and open points

1. **Electron card height (escalated, see above).**
2. **The state-table sentence is off the card face.** It is the card's accessible name (with the status label) and its
   tooltip, and the drawer Overview shows the status.
   - Why: there is no room for a sentence in an 80 px card (the prototype shows only a short label).
   - `status-copy` now marks the short label on the face.
   - "Connected · Available" is now "Connected" (the prototype's word). The other labels are unchanged.
3. **Initials avatar instead of the vendor mark.** This matches the prototype and the drawer header. The mark is
   fixed at 32 px, which does not fit 80 px with a 24 px action row. `connectionInitials` / `connectionAvatarTone` moved
   into `S` so the eager card does not import the deferred drawer; the drawer now imports them. `fallbackMark` is kept
   in the API with a doc note.
4. **Duplicated container padding removed (`PS:45`).** The Providers page re-applied the Settings shell's `max-w-4xl`,
   `px` and `lg:px-8`, which cost 64 px of grid width. The page now relies on the shell, which widens the whole
   Providers page by 64 px. This is a composition change; Batch 28 owns the final density.
5. **The inline action is `btn-xs`, 24 px tall**, as the plan requires (:631). That meets the WCAG 2.2 AA target size
   (2.5.8), not the 36 px page rule. The page spec now asserts `min-h-6` for the card action and `min-h-9` for
   everything else. The link uses `!px-0`, because daisyUI's `btn-xs` padding wins over plain `px-*`.
6. **The page passes "Custom" as the modality badge for custom gateways**, as the prototype does, and "Key stored
   locally" as the provenance, which is shorter than the old "Credential: stored on this machine".
7. **Encoding incident, fixed before any gate run.**
   - What happened: a PowerShell `Get-Content -Raw` / `WriteAllText` replace (Windows PowerShell 5.1 reads UTF-8
     without a BOM as ANSI) double-encoded the non-ASCII characters in `settings-reachability.table.ts` (34 lines) and
     the two new card specs.
   - The fix: a line-wise Windows-1252 → UTF-8 reversal.
   - How it was verified: `git diff HEAD` on the table shows only the intended edits, and a search for mojibake
     markers over `libs/frontend` returns nothing (build output excluded).
   - Later edits in this batch used only the edit tool.
