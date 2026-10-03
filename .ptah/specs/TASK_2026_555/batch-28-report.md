# Batch 28: Providers composition, fold gate, stacking fix, scenes

The Providers page now follows the prototype order:

- **Routing map** first.
- **Connections header:** "Connections", the count pill "N configured · M available in catalog", a filter, and a primary "Connect provider".
- **Grid:** columns come from the container width, and every card is 80 px.
- **Tile and hint strip:** "+ Connect another provider" sits in the grid. The hint strip is directly under the grid on one row: truncated names on the left, "Browse catalog →" on the right.

Also in this batch:

- The page `<h1>`, "Refresh settings" and the page-level loading and error lines are gone. Each region shows its own "Retry {label}".
- #22 is one `text-[11px]` line.
- The Batch 27b stacking defect is fixed and asserted.
- The drawer scrim matches the prototype.
- Gate G gained the three routing-map node actions (88 → 91).
- The new `settings-providers.e2e.spec.ts` holds the interaction scenes.
- The fold gate runs in both hosts and both themes.

Results:

- **VS Code passes the fold in both themes:** the 5th card ends at 590/592 px, every card is 80 px, 3 columns at 1024 px and 3 at 800 px.
- **Electron fails the fold** (card 5 at 831 px, and 1 column at 800 px). As instructed, I did not bend the budget; it is **escalated** below (Q-extra-1).
- Build: no budget error.
- Gate G: 27/27 with `--repeat-each=3`.
- Full settings folder: 36 passed, 4 skipped (`fixme`), and 2 failed (the Electron fold, both themes).

Nothing is committed; the working tree is dirty for the team-leader.

## Changed files

| Change | Path | Lines | What |
| --- | --- | --- | --- |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts` | 612 (≤ 700) | Composition (described below) |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.spec.ts` | | 5 new composition specs. The route-retry spec now uses the node's Retry. The control-size spec lists "Clear filter" as an inline `btn-xs` control. |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/routing-map-node.component.ts` | 104 | Stacking fix: `has-[.popover-panel]:z-30` on the node |
| MODIFIED | `libs/frontend/chat/src/lib/settings/settings.component.html` | | #22 as one `text-[11px]` truncated line (dot + text; the custom variant keeps the full sentence in `title`). `data-testid="settings-tabs"` on the tab `<nav>`, which the fold gate measures (plan :1045). |
| MODIFIED | `libs/frontend/chat/src/lib/settings/settings.component.spec.ts` | | Pins the one-line form (`text-[11px]`, `truncate`) |
| MODIFIED | `libs/frontend/ui/src/lib/native/drawer/native-drawer.component.ts` | 307 | The one allowed ui file. Backdrop `bg-black/50` → `bg-black/60 backdrop-blur-[2px]`, the prototype's `.drawer-overlay` (`prototypes/final/assets/app.css:445-451`). Its spec is unchanged and green (ui 610/610). |
| CREATED | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-providers.e2e.spec.ts` | | The Validation-notes scenes in both hosts (next section) |
| CREATED | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-routing-map.entries.ts` | 42 | Gate G RM-1, RM-2, RM-3, spread into `REACHABILITY_TABLE`. They are in their own file because the table is at its `max-lines` budget. |
| MODIFIED | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts` | 700 counted | Spreads `ROUTING_MAP_ENTRIES`; `EXPECTED_CAPABILITY_COUNT` 88 → 91. RUX-3 keeps its reachability (hint strip, open with search focused, empty search, Clear, Esc → focus back); its Tab-trap and backdrop checks moved to the Providers spec. |
| MODIFIED | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-visual.e2e.spec.ts` | | `assertProvidersFold` (both hosts, both themes) and `assertPopoverOnTop` (scope popover and Main Agent popover). Popover positions are logged. A fold failure is thrown only after every capture is taken. |

The composition changes in `providers-settings.component.ts`:

- Removed: the `<h1>Providers</h1>` block (count, workspace name and path), "Refresh settings", and the page-level list of "Loading X…" / error lines.
- Added: the Connections header, the filter (`filter`, `shownConnections`), the grid `grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]`, and the one-row hint strip directly under the grid.
- Per-region reads: `mainReadErrors` sit under the map, and the connections error sits inside the Connections section.
- The clear-override review moved to under the map.
- `aria-busy` is set on the main-agent region while its reads load.

`provider-setup-wizard.component.ts`: `git diff --stat` is empty.

## Validation-notes scenes (`settings-providers.e2e.spec.ts`, vscode + electron)

| Scene | How |
| --- | --- |
| card → drawer for each kind | claude-cli "Claude (Subscription)", api-key "Moonshot", oauth "OpenAI Codex", custom "sovereigneg". The card opens its own drawer (title), and its tab strip is exactly the kind's tabs (`connection-kind.ts` TABS_BY_KIND; Advanced is custom-only). |
| delete key emits `auth:deleteStoredKey` | Moonshot Credentials → Delete → confirm → `{ providerId: 'moonshot' }` |
| Copilot sign-out | `copilotAuthenticated` fixture → GitHub Copilot Credentials → Sign out → confirm → `auth:copilotLogout {}` |
| catalog → wizard | "Connect OpenRouter" closes the modal and opens setup with the provider preselected; Cancel and discard close it |
| catalog focus trap (moved from RUX-3) | 12 Tabs stay in the dialog; a backdrop click closes it and focus returns to "Connect provider" |
| popover model save → toast → Undo | Set model A, then choose B: `config:model-switch` for B and the "Saved main agent model…" toast with Undo. Undo sends a **second** `config:model-switch` with A, and the fixture reads A. |
| provider change needs a confirm | Choosing Moonshot shows the D6 copy "…Changing the provider ends running chat sessions." and "Use for main agent", with no `auth:saveSettings`. Cancel removes the confirm, still with no write. |
| deep-link `main-model` opens the popover | **`test.fixme`** (see below) |
| the popover search filters models | **`test.fixme`**: FLAGGED; the popover's model control is a plain select |

**Why the `main-model` deep link is a `fixme`:**

- Its only in-app trigger is the Setup Wizard's "Manage model in Providers" (`libs/frontend/setup-wizard/src/lib/components/welcome.component.ts:336-339`). That is a separate webview surface (`initialView: 'setup-wizard'`, `apps/ptah-extension-webview/src/app/app.routes.ts:45, 80`), which the settings harness does not boot.
- The harness cannot raise a pending-tab request directly (plan :572-574).
- The behaviour is covered by `settings.component.spec.ts:170` (section routing) and `providers-settings.component.spec.ts:428` ("the %s deep link opens the popover focused on that control").

## Fold numbers (1024×768, from the `B28 fold` log lines)

| Host / theme | scrollY (window/page) | Bottoms: tabs / map / heading / card 5 (≤ 660) | Card heights (≤ 80) | Card widths | Columns 1024 / 800 | Result |
| --- | --- | --- | --- | --- | --- | --- |
| vscode / anubis | 0 / 0 | 83 / 354 / 398 / **590** | 80 ×5 | 269 | **3 / 3** | PASS |
| vscode / anubis-light | 0 / 0 | 83 / 356 / 400 / **592** | 80 ×5 | 269 | **3 / 3** | PASS |
| electron / anubis | 0 / 0 | 123 / 503 / 547 / **831** | 80 ×5 | 329 | 2 / **1** | **FAIL** (card 5; ≥ 2 at 800) |
| electron / anubis-light | 0 / 0 | 123 / 503 / 547 / **831** | 80 ×5 | 329 | 2 / **1** | **FAIL** (card 5; ≥ 2 at 800) |

Routing-map nodes:
- **VS Code:** 3 × 261×169 at y=172 (the light theme is 171 tall).
- **Electron:** 316×143, 316×143, then 316×123 at y=367, in 2 columns.

The D16 badge check (every `scope-badge` has a non-empty `data-field`) passed in all four runs.

### ESCALATION: Electron fold (Q-extra-1)

The orchestrator's default holds in every respect it controls:

- The grid takes its columns from the container width: 2 in Electron.
- Every card is 80 px in both hosts. Before this batch, Electron cards were 100-111 px.

The budget still fails in Electron, for structural reasons:

- **The page is narrow.** Electron's Settings page is about 670 px wide at a 1024 px window, because of the workspace sidebar, the git rail and the shell padding.
- **The routing map is tall.** In that width the map wraps to 2 + 1 nodes (Batch 25), so it ends at 503 px, against 354 px in VS Code.
- **The 5th card is on row 3.** With 2 grid columns it ends at 831 px.
- **At an 800 px window** the content is under 492 px, so the grid has 1 column.

Neither composition change nor density can bring card 5 above 660 px here without changing a decision. The options for the user:

1. Let the Electron routing map use 3 narrow columns (~210 px nodes). My estimate is that card 5 would still end at about 676 px.
2. Give Settings more width in Electron, for example by collapsing the workspace sidebar on Settings. That is a shell change.
3. Take Batch 24 option (3): 3 columns in Electron with 215 px, 100-111 px cards.
4. Accept a different fold budget for the Electron host.

The spec asserts the unchanged budget in both hosts, so Electron's two fold runs are red on purpose. Every Electron capture is still written.

## Popover positions (after the header removal)

| Popover | VS Code (anubis / light) | Electron (anubis / light) | Check |
| --- | --- | --- | --- |
| Main Agent popover | 304×284 at (111, 364) / 304×286 at (111, 366) | 304×284 at (305, 378) / 304×286 at (305, 378) | Fully inside the viewport, and `assertPopoverOnTop` passes, in all four |
| Scope popover ("Reasoning effort") | 288×222 at (232, 244) / 288×224 at (230, 246) | 288×222 at (481, 256) / 288×224 at (479, 258) | `assertPopoverOnTop` passes in all four |
| Catalog modal | 512×461 at y=154 | 512×461 at y=154 | Centred and on screen (unchanged) |

- **Main Agent popover:** the header removal moved the node up, so the popover now opens **below** the node in both hosts. In Batch 26 it was at VS Code y=478, and flipped above the node in Electron at y=190.
- **Stacking fix, and the cause:** the scope popover lives inside the Main node's `relative z-10` badge group, so the CLI node's later `z-10` badge group painted over it.
  - The node now lifts itself to `z-30` while it contains an open `.popover-panel` (`routing-map-node.component.ts:32-34`). This covers both the scope popover and the Main Agent popover.
  - `current-scope-popover-electron-anubis-light-1024x768.png` shows the popover over the CLI node with nothing painted through.
  - `assertPopoverOnTop` checks with `elementFromPoint` that the top-most element at the centre of every popover row belongs to the popover.

## Verification

1. **typecheck, test and lint.** `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview --parallel=2 --output-style=static` exited 0 (`%TEMP%\b28-verify.log`).

   | Project | Tests | Change from 27b |
   | --- | --- | --- |
   | core | 1085/1085 | 0 |
   | ui | 610/610 (drawer spec green) | 0 |
   | chat | **1994 passed + 2 skipped** (1996) | +5 |
   | webview | 224/224 | 0 |

   - That run showed chat at 34 warnings and the harness at 42: four `no-non-null-assertion` warnings in my new filter spec, and the now-unused `connectProviderButton` import in the table. I fixed both.
   - The re-run of `typecheck,lint` on chat and the harness exited 0, back to **chat 30 / harness 41**; core is 11. There is no `max-lines` warning in any file this batch touched (`%TEMP%\b28-lint2.log`). The page spec re-ran at 55/55.
2. **Build.** `npx nx build ptah-extension-webview --skip-nx-cache` exited 0 with **no budget error** (`%TEMP%\b28-build.log`).
   - Initial total: **3.48 MB**, 975.03 kB over the 2.5 MB warning budget. 27b was 973.12 kB over, so this is **+1.91 kB eager**: the header, filter and per-region errors.
   - Lazy chunks: `connection-detail-drawer-component` 63.22 kB, `main-agent-reassign-popover-component` 16.48 kB, `provider-catalog-modal-component` 8.78 kB.
3. **Gate G.** `settings-reachability.e2e.spec.ts --reporter=list --repeat-each=3` gave **27 passed (2.0m)**, exit 0, both hosts. RM-1..3 are included (`%TEMP%\b28-gateG.log`).
4. **Full settings folder, first run** (`%TEMP%\b28-folder.log`): 11 failed / 4 skipped / 27 passed. Each failure was diagnosed before any re-run:
   - **8 × "card → drawer" (both hosts):** my spec looked for the tabs inside `connection-detail-drawer`, but the tab strip belongs to `native-drawer-panel` ("locator resolved to 0 elements"). I re-scoped it. This was a test defect.
   - **1 × "catalog → wizard" (vscode):** `wizard-body` was still present. My instant `isVisible()` on the discard review raced its render, the same race `closeWizard` documents (table :76-89). It now waits up to 2 s for the review. Test defect.
   - **2 × Electron fold:** real, and escalated above.
   - After the fixes, `settings-providers.e2e.spec.ts --repeat-each=3` gave **60 passed, 12 skipped (the two `fixme` × 2 hosts × 3)**, exit 0 (`%TEMP%\b28-providers.log`).
5. **Full settings folder, final run** (`%TEMP%\b28-folder2.log`): **36 passed, 4 skipped, 2 failed**. The 2 failures are `baseline smoke — both tabs (electron, anubis | anubis-light) › fold`: "Expected ≥ 2, Received 1" at 800 px, and card 5 at 831 px.
   - Everything else is green, including the stacking checks, the Main Agent popover in-viewport check, the D16 check, the catalog measurements and every drawer capture.
   - No 0xC0000409 worker crash in any run.
6. **Baselines.** `git status --short -- .ptah/specs/TASK_2026_555/screenshots/angular/ | grep -c baseline` gives **0**. Nothing is staged.

## Captures

All are `current-*` files in `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\.ptah\specs\TASK_2026_555\screenshots\angular\`. Each name comes in four copies, for `vscode` and `electron` × `anubis` and `anubis-light`, as `current-<name>-<host>-<theme>-1024x768.png`.

- `current-providers-*` and `current-orchestration-*` (smoke, both tabs)
- `current-main-agent-popover-*` and `current-main-agent-save-to-*`
- `current-scope-popover-*` (the stacking fix is visible in `…-electron-anubis-light`)
- `current-provider-catalog-*`
- `current-drawer-moonshot-*`, `current-drawer-sovereigneg-*`, `current-drawer-moonshot-credentials-*`, `current-drawer-claude-cli-credentials-*`, `current-drawer-moonshot-models-*`, `current-drawer-sovereigneg-models-*`, `current-drawer-sovereigneg-advanced-*` (the new scrim)

For example: `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\.ptah\specs\TASK_2026_555\screenshots\angular\current-providers-vscode-anubis-1024x768.png`.

I compared `current-providers-vscode-anubis` with `prototypes/final/screenshots/index-anubis-1024x768.png`:

- **Same structure and order:** map, "Connections" + pill + filter + primary "Connect provider", a 3-column grid of 2-row cards with the dashed tile, and a one-row hint strip with "Browse catalog →" right-aligned.
- **Differences:** the #22 line above the map (the prototype has none), and the grid is 832 px wide rather than about 976 px (the shell's `max-w-4xl`, recorded in Batch 24).

## FLAGGED items, not implemented (they wait for the user at Gate V 28)

1. **Compact searchable model picker in the Main Agent popover.** The popover model control is still a plain `<select>` with no search (Batch 26 carry-forward 1). The "popover search filters models" scene is a `fixme`.
2. **Key hint "•••• 8f21"** in the drawer. It is not implemented, because it would send part of the secret across RPC (Batch 21, no contract change).
3. **Overview latency "92ms".** It is not shown; draft-probe latency appears only in the Credentials Replace check (Batch 21).
4. **Codex CLI under "Used by"** for OpenAI Codex. It is not listed (HANDOFF open item 3).
5. From 27b: **the "VS Code" App-layer label** (the App target is kept in VS Code), and the inconsistent Global wording across surfaces.
6. **New in this batch: the Electron fold** (escalation above).

## Deviations for the visual review

1. **#22 stays in the Settings shell,** above the routing map. The plan's order puts it inside the page between the header and the grid (:580-583). The line needs `AuthStateService`, which the shell already injects. Moving it would add that service to the Providers page and to about ten page specs' doubles, and the fold cost is the same. The shell files (`settings.component.html` and its spec) are outside the batch's file list.
2. **Control heights:** "Connect provider" (`btn-primary btn-sm`) and the filter input are 36 px (`min-h-9`), not the prototype's 32 px `btn-sm`, to keep the page's 36 px control rule (page spec "uses native controls with 36px height"). The "+" is an inline SVG, so no icon module goes into the eager bundle.
3. **Read states:**
   - The route's error and Retry stay in the Main Agent node (Batch 25).
   - "Retry setting sources", "Retry main-agent model", "Retry model and effort sources" and "Retry main-agent reasoning effort" sit under the map.
   - "Retry providers" sits in the Connections section.
   - The "Loading X…" lines are gone. Loading is the nodes' skeletons plus `aria-busy` on the main-agent region and the Connections section, and `waitForSettled` still waits on them.
4. **The clear-override review moved** from under the grid to under the routing map, next to the badges that start it. This keeps the hint strip directly under the grid.
5. **Removed with the header block:**
   - "N providers · M configured": replaced by the pill.
   - The workspace name and path: the shell header shows "Workspace: …".
   - **"No workspace open. Workspace overrides are unavailable."** No longer shown on the page. The Save-to lists still omit "This workspace" when no workspace is open (`writeScopes`). Flag for the user if the sentence should come back, for example in the pill row.
6. **The filter is new.** It matches connection name or id, case-insensitive. "No connections match “x”." comes with "Clear filter", and the tile stays visible.
7. **Batch size:** 10 paths (8 modified, 2 created) across 3 libs, against the batch's list of 5.
   - The extras are the allowed ui drawer file, `routing-map-node.component.ts` (the stacking fix), the shell html and spec (#22 and `settings-tabs`), and the routing-map entries file (table `max-lines`).
8. **Harness moves:**
   - The catalog Tab-trap and backdrop checks moved from RUX-3 to the Providers spec. RUX-3 keeps open, search empty state, Clear, and Esc → focus return, and the count is unchanged.
   - RM-1..3 live in `settings-routing-map.entries.ts`.
   - RUX-5 / #16 / #18 host-awareness (27b) are unchanged. They stay in Gate G, where they already run per host, rather than being duplicated in the Providers spec.
9. **Accepted deltas carried forward** (not defects, per batches.md Batch 20/24/25/26/27/22 carry-forwards):
   - Drawer width `max-w-lg`; computed initials.
   - The Overview has no footer action.
   - Container-width node grid; no quota pill.
   - Openers always enabled; modal `md`.
   - Base-content text on outlined buttons.
   - Models & Tiers row density; inline Models toast with the drawer at `z-[60]`. This is still above the page toast after this composition.
10. **Out of scope, observed and not touched:**
    - `ptah_get_diagnostics` reports the long-standing spec type-check gap in untouched chat specs.
    - The `NativeModalComponent` backdrop button's accessible name and focus ring (Batch 27 note) are unchanged.

## Visual revise (Gate V 28)

Inputs: task.md "Gate V 28 (2026-10-01, user)", `visual-review.md` "## Providers (Gate V 28)" defects 1-5, and the
combined Glm review `providers-21-28-code-logic-review.md` (M1, m1, m2). Nothing is committed; baselines are untouched
(`git status … | grep -c baseline` gives 0).

**Result:**

- **Full settings folder: fully green.** 114 passed and 12 skipped over `--repeat-each=3 --workers=2`. The skips are
  the 2 expected `fixme` scenes × 2 hosts × 3.
- **Gate G:** 27/27 with `--repeat-each=3`.
- **Electron now passes its fold budget** (task.md decision).

### A. Electron layout (task.md "Gate V 28", orchestrator choice)

1. **Container-width card grid, unchanged.** Electron keeps 2 columns of 80 px cards (329 px wide).
2. **The third node spans the full row.**
   - `routing-map.component.ts:129` (`routing-map-nodes`) and `:200-212` (component styles).
   - The map is a CSS container (`:host { container-type: inline-size }`). Below 32rem it has 1 column; from 32rem it has
     2 columns, and `:nth-child(3)` gets `grid-column: 1 / -1`; from 48rem it has 3 columns.
   - VS Code (832 px) shows 3 nodes of 261 px. Electron (~670 px) shows 316 + 316, then the CLI node at **644 px, the
     full row**. The visual spec asserts that its width equals the grid width, in both themes.
   - The full-width CLI node reads well: "Execution priority: Codex → Antigravity → Glm → Copilot" on one line, and
     the footer "3 CLIs · 1 Ptah instance … Manage matrix ›" spread across the row. The node is 123 px tall.
3. **Per-host fold budget in one place.**
   - `FOLD_BUDGET`, `settings-visual.e2e.spec.ts:94-111`, with a comment that cites task.md "Gate V 28".
   - **VS Code:** tabs, map, heading and card 5 ≤ 660 px; 3 columns at 1024 px; ≥ 2 at 800 px.
   - **Electron:** tabs, map and heading ≤ 660 px; 2 columns; ≥ 1 at 800 px.
   - **Both hosts:** scrollY 0, every card ≤ 80 px, and **no horizontal overflow at 800 px**. The overflow check is the
     document and the Providers scroll box, with `scrollWidth - clientWidth ≤ 0`.

**Fold numbers after the revise** (1024×768; the logged `B28 fold` lines, identical across the three repeats):

| Host / theme | scroll | tabs / map / heading / card 5 | cards | cols 1024 / 800 | overflow at 800 | Result |
| --- | --- | --- | --- | --- | --- | --- |
| vscode / anubis | 0 / 0 | 83 / 338 / 382 / **574** | 80 ×5 (269 w) | 3 / 3 | 0 px | PASS |
| vscode / anubis-light | 0 / 0 | 83 / 338 / 382 / **574** | 80 ×5 (269 w) | 3 / 3 | 0 px | PASS |
| electron / anubis | 0 / 0 | 123 / 503 / **547** / (831, not budgeted) | 80 ×5 (329 w) | 2 / 1 | 0 px | PASS |
| electron / anubis-light | 0 / 0 | 123 / 503 / **547** / (831, not budgeted) | 80 ×5 (329 w) | 2 / 1 | 0 px | PASS |

In VS Code the map is 16 px shorter than in the first Batch 28 run (it ended at 354, now 338), because the header and
model rows no longer wrap (B2).

### B. Visual defects

1. **Stray square outline around "Effort · Workspace" (light theme).**
   - **Root cause, measured in a throwaway DOM probe** (deleted, never committed):
     - The badge `<button>` itself was clean: rounded 16 px, no outline.
     - Its wrapper `div.popover-trigger` (NativePopover) had a **1 px solid square border**.
     - That border came from the app's light-theme rule `[class*='popover'] { background…; border: 1px solid … }`
       (`apps/ptah-extension-webview/src/styles.css:1934-1940`), whose substring match also hits `popover-trigger`.
   - **Fix:** `styles.css:1939` is now `[class*='popover']:not(.popover-trigger)`, with the reason in a comment. This is
     one selector in the app stylesheet, outside the batch's file list, and it fixes the same stray border on every
     NativePopover trigger in the light theme app-wide.
   - **Also changed:** the Batch 28 stacking class `has-[.popover-panel]:z-30` itself contained "popover", so it matched
     the same rule. It is now `has-[[role=dialog]]:z-30` (`routing-map-node.component.ts:32-35`); both popovers are
     `role="dialog"`.
   - **Focus ring:** keyboard focus only, as before (`focus-visible:outline-2`, `setting-scope-row.component.ts:204`).
   - **Asserted:** the visual spec checks that the trigger's computed `border-top-width` is `0px`, in all four
     host/theme runs.
2. **Main Agent node header and label rows.**
   - `routing-map-node.component.ts:37-45`: the title block is `min-w-0 flex-1`, and the title may wrap. The status pill
     and badge group is `flex-none max-w-[70%]` (`data-testid="routing-node-badges"`), so the badges stay in the header
     beside the title, as in the prototype ("MAIN / AGENT").
   - `routing-map.component.ts:138-145`: "PROVIDER:" and "MODEL:" are each label + value on **one line**; a long value
     truncates, with the full text in `title`.
   - **Measured:**
     - VS Code: the title spans 183-215 (two lines); the pill and badge tops are 183 and 211, both inside the title
       band, and each label row is ≤ 22 px.
     - Electron: all on one line (tops 223/223).
   - **Deviation:** at the 261 px VS Code node width, the pill and "Effort · Workspace" **stack** in the header column
     rather than sit side by side. I tried a 75 % cap: it pushes the title to three lines (48 px, "AGEN/T"), so I kept
     70 %. At 261 px the value reads "Default (chosen by Clau…", with the full value in `title`.
   - **Asserted:** the visual spec checks that every badge top < title bottom, titles are ≤ 2 lines, and label rows are
     one line. The routing-map spec pins the structure.
3. **Active card spine is primary.**
   - `provider-connection-card.state.ts:96-100` (`case 'active': return 'primary'`); `ConnectionCardTone` is updated.
     Failure tones stay warning (unreachable, needs key) and error (unauthenticated).
   - Specs updated: `provider-connection-card.state.spec.ts:41` and `provider-connection-card.component.spec.ts:208-213`.
   - Capture: the Claude card has a teal/blue spine; Ollama keeps the orange warning spine.
4. **The Main Agent popover is fully visible in every state.**
   - The height is capped at the space below its top edge: `fitToViewport()`, `main-agent-reassign-popover.component.ts:411-420`.
   - It is recomputed when the panel is positioned (`:405`), after every height-changing state through
     `afterRenderEffect` (`:305-310`: confirm, outcome, manual field, catalogue, targets), and on window resize
     (`host (window:resize)`, `:53`, owned and released by Angular).
   - Only the body scrolls (`data-testid="main-agent-popover-body"`); the header stays.
   - **Asserted in the confirm state** in the visual spec (`B28 popover confirm`):

     | Host / theme | Size | Position |
     | --- | --- | --- |
     | vscode / anubis | 304×406 | (111, 348) |
     | vscode / anubis-light | 304×408 | (111, 348) |
     | electron / anubis and anubis-light | 304×382 | (305, 378) |

     All four are fully inside 768 px, and `assertPopoverOnTop` passes on the confirm buttons.
   - The default state is 304×284/286 at y=348 (VS Code) and y=378 (Electron).
5. **Card "Use for main agent" removed**, to match the prototype.
   - **Parity check:** parity-inventory #3 ("Switch main provider") and :190 ("hidden until Check connection passes") are
     met by the Main Agent popover. Its provider select offers only activatable connections (`ACTIVATABLE`: connected /
     reachable / unknown / skipped). It is reached through Reassign (RM-1, #16) and the `main-agent` deep link, with the
     same D6 confirm. No drawer path is needed.
   - **Removed code:**
     - The `'activate-main'` action and the `canActivateMain` option (`provider-connection-card.state.ts:128-163`).
       Connected → no inline action; a not-checkable Not checked → none; Check unavailable → Retry.
     - The card's `canActivateMain` input and `activateMainRequested` output.
     - The page bindings (`providers-settings.component.ts:146-148`).
     - `mainPopover.provider` and `openMainPopover(provider, …)` (now `openMainPopover(focus)`).
     - The popover's `requestedProvider` input and its preselect.
   - **Harness #3** now goes Reassign → provider select "moonshot" → "Use for main agent" visible → Cancel
     (`settings-reachability.table.ts:287-294`).
   - **Specs updated:** the card state and card component (no link on connected or not-checkable cards) and the page (the
     old card-link test became "no link on any card; Reassign → select → D6 confirm"). The popover preselect spec was
     removed.

### Code review findings (`providers-21-28-code-logic-review.md`)

1. **M1 (moderate): no write before a Save-to target exists.**
   - **Fix:** `main-agent-reassign-popover.component.ts:231-244`. `target()` is `SettingScope | null` and is never
     defaulted to `'global'`; `targetReady` is `target() !== null`.
   - **Disabled until ready:** the model select, manual "Use", effort buttons and Save-to.
   - **Guarded:** `saveModel`, `saveEffort` and `activate` return without a target.
   - **Provider confirm:** it says "Where to save is not loaded yet." and "Use for main agent" is disabled.
   - **The region's state is shown:** "Loading where the model and effort are saved…", or, on error, "Where the model and
     effort are saved could not be loaded. Nothing was changed." with "Retry model and effort sources" →
     `state.refreshMainSources()` (template `:158-167`).
   - **Specs:** `main-agent-reassign-popover.component.spec.ts`, "while the model and effort sources are not loaded (M1)".
     They cover loading (controls disabled, no `saveSettings` even when a handler is reached) and error (Retry, and no
     confirmable provider change). Both fail on the old code, which enabled the controls and wrote `'global'`.
   - The page spec that activates through the popover now loads the sources first.
2. **m1 (minor): Undo kept while another save is in flight.**
   - **Fix:** `settings-save-feedback.service.ts:98-114`. `undo()` checks `saving()` first. If a save is in flight, it
     keeps the toast **with its Undo** and shows "Another change is still saving." It dismisses only when the Undo write
     starts.
   - **Spec:** "m1: Undo while another save is in flight…". It fails on the old code, where the Undo was lost.
3. **m2 (minor): the filter never hides a new connection.**
   - **Rule chosen:** a **confirmed wizard save clears the filter** (`providers-settings.component.ts:540-542`). Every new
     connection is added through the wizard, whether opened from the catalog, a card or a deep link, so this covers the
     reported case without clearing the user's filter on unrelated background reloads.
   - A failed or unconfirmed save keeps the filter as typed.
   - **Specs:** "m2: a connection saved through the wizard clears the filter…" (fails on the old code) and "m2: a failed
     wizard save keeps the filter".

### Changed files in this revise (on top of the Batch 28 set)

| Change | Path | What |
| --- | --- | --- |
| MODIFIED | `apps/ptah-extension-webview/src/styles.css` (`:1934-1940`) | The light-theme `[class*='popover']` rule skips `.popover-trigger` (B1). **Outside the batch's file list.** |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/routing-map.component.ts` (288 lines) + spec | Container-query node grid (A2); one-line label rows (B2) |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/routing-map-node.component.ts` | Header layout (B2); `has-[[role=dialog]]:z-30` (B1/stacking) |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/provider-connection-card.state.ts` + spec | Primary active tone (B3); no activate action (B5) |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.ts` (245) + spec | `canActivateMain` / `activateMainRequested` removed (B5) |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts` (431) + spec | `fitToViewport` (B4), M1, `requestedProvider` removed (B5) |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts` (614) + spec | B5 bindings, m2 |
| MODIFIED | `libs/frontend/chat/src/lib/settings/feedback/settings-save-feedback.service.ts` + spec | m1 |
| MODIFIED | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-visual.e2e.spec.ts` | `FOLD_BUDGET`, overflow check, B1/B2/B4 and A2 assertions |
| MODIFIED | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts` | #3 via the popover; still 700 counted lines, no `max-lines` warning |

Every non-spec file is ≤ 700 lines. `provider-setup-wizard.component.ts` is unchanged (`git diff --stat` empty).

### Verification (revise)

1. **Batch 17 command.** `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview --parallel=2`.
   - **First run: 2 red specs, both diagnosed** (`%TEMP%\b28r-verify.log`):
     - The page control-size spec needed a card in a repair state, because a connected card has no inline action now.
       I set one route provider to `unreachable`.
     - My new routing-map CSS-rule spec read `<style>` tags, but Jest does not attach component styles, so it received
       `""`. I removed that spec; the Playwright check (the third node spans the grid in Electron) is the real proof.
   - The settings specs then ran 655/655.
   - **Final:** `typecheck,test,lint` for chat, harness and webview exited 0: chat **1995 passed + 2 skipped**, webview
     224 (`%TEMP%\b28r-verify2.log`). core 1085 and ui 610 are from the same-day run (their sources did not change since).
     Lint: 0 errors; warnings chat 30 / harness 41 / core 11, unchanged.
2. **Build.** `npx nx build ptah-extension-webview --skip-nx-cache` exited 0 with **no budget error**.
   - Initial total: 3.48 MB, **975.78 kB** over the 2.5 MB warning budget (+0.75 kB eager against the first Batch 28
     run).
   - The popover chunk is 18.11 kB (was 16.48).
   - `%TEMP%\b28r-build3.log` is the last build, after the final node-header change.
3. **Gate G.** `--reporter=list --repeat-each=3` gave **27 passed (1.8m)**, exit 0, on the final build
   (`%TEMP%\b28r-gateG2.log`).
4. **Full settings folder: one diagnosed failure, then all green.**
   - The first folder run after the final build had 36 passed, 4 skipped and **2 failed**: reachability in both hosts,
     both at `#77 ("No CLI agents found" install help): browserContext.newPage: Target crashed`
     (`%TEMP%\b28r-folder2.log`).
   - `#77` boots a second page (`throughVariantBoot`). The error is a Chromium renderer crash while opening that page,
     not an assertion. It is an Orchestration entry this revise did not touch, and it had just passed 3/3 in the
     standalone Gate G on the same build.
   - **Suspected cause:** memory pressure from parallel workers.
   - **Re-run per execution default 7:** the whole folder with `--repeat-each=3 --workers=2` gave **114 passed, 12
     skipped, 0 failed (5.5m)**, exit 0 (`%TEMP%\b28r-folder3.log`). The crash did not reproduce, and there was no
     0xC0000409.
   - An earlier intermediate run (the 75 % header cap, reverted) failed the title-height check (48 px) and is recorded
     under B2.

### Captures (refreshed by the final 3× folder run)

All are in `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\.ptah\specs\TASK_2026_555\screenshots\angular\`,
as `current-<name>-<host>-<theme>-1024x768.png` for `vscode` and `electron` × `anubis` and `anubis-light`:

- Page: `providers`, `orchestration`
- Main Agent popover: `main-agent-popover`, `main-agent-save-to` (the confirm state, now fully visible)
- `scope-popover`, `provider-catalog`
- Drawers: `drawer-moonshot`, `drawer-moonshot-credentials`, `drawer-moonshot-models`, `drawer-sovereigneg`,
  `drawer-sovereigneg-models`, `drawer-sovereigneg-advanced`, `drawer-claude-cli-credentials`

Checked by eye: `current-providers-vscode-anubis-light-1024x768.png` shows:

- no badge outline;
- "MAIN / AGENT" with the pill and badge in the header;
- one-line PROVIDER/MODEL rows;
- a primary spine on Claude;
- no card links;
- card 5 at 574 px.

### Still flagged (not started; Batches 28b-28d)

- A compact searchable model picker in the popover (28b).
- The drawer key hint "•••• 8f21".
- Overview per-connection latency.
- Codex CLI under "Used by".

The "VS Code" App-layer label is accepted as a deviation (task.md).
