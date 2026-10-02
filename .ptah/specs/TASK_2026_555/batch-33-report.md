# Batch 33 report: policy bar + roles `<details>`

Executor: frontend-developer, Orchestration owner (in-process subagent). Date: 2026-10-02. Base: HEAD `b1ef5eb50`
(Batch 32b). Track A worktree only. Nothing is staged or committed.

- I did not use `git stash`, restore, checkout, reset or clean.
- Before the visual runs I copied all 84 `current-*` captures to `%TEMP%\b33-shots-backup`. Afterwards I copied back
  every non-Orchestration capture (section 5).

## 1. What changed

**`AgentOrchestrationConfigComponent` is now the policy bar** (`data-testid="orchestration-policy-bar"`). The class,
the selector and the barrel export are unchanged.
- **Max concurrent:** a range from 1 to 20 (`#agent-max-concurrent`). A badge shows the live value while the thumb is
  dragged. The value saves when the thumb is released.
  - The write is `state.saveSettings({orchestration:{maxConcurrentAgents}})`, sent through
    `SettingsSaveFeedbackService` with Undo.
  - Afterwards the thumb and the badge show the read-back value, so a failed save reverts them (D15).
- **Preferred order (changed in visual revise round 1, see the end of this report):**
  - The bar shows compact read-only chips, as in the prototype: `1. Codex → 2. Antigravity → …`.
  - A 24×24 "Edit order" button (pencil) opens a `NativePopoverComponent` dialog titled "Preferred order". It lists
    one row per agent, each with ▲/▼ icon buttons of 24×24 px:
    - aria-labels read "Move {name} up" / "Move {name} down";
    - ▲ is disabled on the first row and ▼ on the last;
    - no grip and no drag (deviation 5);
    - the `moveAgentUp`/`moveAgentDown` swap logic is kept.
  - A move writes the whole order as `preferredAgentOrder`, with Undo.
- **Chip source:** the chips are the CLI matrix's installed rows (`cliMatrixRows`, the same rank rule), so the bar and
  the matrix always show one order.
- **When reordering is blocked:** it is disabled until both `orchestration` and `cliAgents` have been read (an order
  built from one list would drop the other list's ids), and while any save runs (D3).
- **Focus:**
  - After a move, focus stays on the moved row's button (or its other button once it reaches an end).
  - Esc, the backdrop and Close return focus to the Edit button.
- **Re-detect CLIs** calls `state.redetectClis()`. While it runs, the button shows a spinner and "Detecting…". A
  polite status announces "CLI agents re-detected."
- **Re-detect failure:** a failed detection, or a thrown command, shows one fixed sentence: "Could not re-detect CLI
  agents. Your saved settings have not changed." Host error text is never shown.
- **Removed:** `ClaudeRpcService`, the private `agentConfig`, every private `agent:*` call, the system-CLI cards, the
  duplicate Copilot toggle (it lives in the matrix since Batch 31), the "Manage … in Providers" buttons (RUX-9) and the
  install-help box (#77 is covered by the matrix's Uninstalled group). The file went from 625 to 227 lines.

**`OrchestrationSettingsComponent`**
- The order is now: policy bar, then CLI matrix (`@defer`), then section read states, then
  `<details data-testid="background-roles-details">` (closed by default, deviation 4), then the old `ptah-cli-config`
  (until Batch 34), then commit feedback.
- The `<summary data-testid="background-roles-summary">` holds:
  - a chevron that rotates when open;
  - the heading "Background Model Roles";
  - a "6 roles" badge;
  - a truncated list of the role names.
- Its content is the existing `section[data-focus="background-models"]` around `ProviderConsumerAssignmentsComponent`.
- The deep-link effect now sets `details.open = true` before it focuses the section, for every background target
  (`background-models` and the 6 role ids). `cli-agents` leaves the details closed.

## 2. Files

All paths are under `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\`.

- REWRITTEN `libs\frontend\chat\src\lib\settings\ptah-ai\agent-orchestration-config.component.ts` (227 lines)
- REWRITTEN `libs\frontend\chat\src\lib\settings\ptah-ai\agent-orchestration-config.component.spec.ts` (17 tests).
  It covers:
  - structure;
  - RUX-9 absence, and no Copilot toggle or CLI cards;
  - aria-labels, and no grip or drag;
  - the 1-20 range and the live value;
  - save and Undo;
  - D15 revert on failure;
  - the chip order and its disabled states;
  - Re-detect success, loading, and failure with a fixed sentence and no host text.

  No `ClaudeRpcService` is provided in this spec.
- MODIFIED `libs\frontend\chat\src\lib\settings\ptah-ai\orchestration-settings.component.ts` (131 lines)
- MODIFIED `libs\frontend\chat\src\lib\settings\ptah-ai\orchestration-settings.component.spec.ts`. It covers the order,
  the details closed by default with its summary, the details open plus focus for each of the 6 role targets and for
  `background-models`, and the details closed for `cli-agents`.
- MODIFIED `libs\frontend\chat\src\lib\settings\settings.component.spec.ts`. In the landing suite, the real container
  is rendered: the 7 background-role deep links assert that `background-roles-details` is `open` and the section is
  focused, and the plain Orchestration landing and `cli-agents` assert that it is closed.
- MODIFIED `libs\frontend\webview-e2e-harness\src\lib\scenarios\settings\settings-reachability.table.ts`:
  - #72: clicks Re-detect.
  - #73: a ▲/▼ move followed by the toast's Undo; asserts both `agent:setConfig` writes.
  - #74: fills the range with 5, then Undo back to 3; asserts both writes.
  - #75-#78: re-pointed to the matrix. #77 uses a variant boot with nothing installed and checks Codex's install guide.
  - #79: no `[data-read-loading]` or `[data-read-error]` left, and the bar shows 3.
  - #83: the routing map's Background roles action while Settings is open opens the details and focuses the section.
  - New `RUX-9` entry. `EXPECTED_CAPABILITY_COUNT` goes from 96 to 97.
  - `KeptSelector.reveal` added: `assignments-heading` is now revealed by clicking the summary.
- MODIFIED `libs\frontend\webview-e2e-harness\src\lib\scenarios\settings\settings-reachability.e2e.spec.ts`
  (3 lines: the kept-selector loop clicks `reveal` first). See Deviation 1.
- MODIFIED `libs\frontend\webview-e2e-harness\src\lib\scenarios\settings\settings-visual.e2e.spec.ts`. New
  `captureRolesOpen`: it logs the B33 fold, opens the details, captures `orchestration-roles-open`, closes the details
  and scrolls back. See Deviation 1.
- 36 captures (section 5) and this report.

## 3. Verification

| Command | Result |
| --- | --- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview` (no passthrough) | "Successfully ran targets typecheck, lint for 5 projects". Run twice: before and after the layout fix in Deviation 2. |
| `npx nx run-many -t test -p (same 5) -- --maxWorkers=2` | 4 projects have a test target. **chat 2201 passed + 2 skipped** (131 suites; 32b: 2179, so +22). **core 1109/1109** (36). **ui 624/624** (31). **webview 224/224** (11). |
| `npx nx build ptah-extension-webview --skip-nx-cache` | Success, no budget error. Initial total **3.48 MB** (976.60 kB over the 2.5 MB warning; Batch 31 was 981.03 kB over). `cli-orchestration-matrix-component` lazy chunk 64.56 kB. |
| `settings-orchestration.e2e.spec.ts` (`--workers=2`, run alone) | 14/14 |

## 4. Gate G (`--reporter=list --workers=2 --repeat-each=3`, cwd `libs\frontend\webview-e2e-harness`)

- **Run 1** (before the layout fix): **27/27 passed** (6.1 m).
- **Run 2** (final code, after rebuilding): **27/27 passed** (7.6 m). No failure, so nothing needed diagnosing.

## 5. Captures

Spec: `settings-visual.e2e.spec.ts --workers=2`, run together with `settings-orchestration.e2e.spec.ts`.

The final run gave 16/18. Both failures were timeouts while CPU was at 100% (`Win32_Processor.LoadPercentage` = 100):
1. `orchestration scenes (vscode) › tier-mapping modal: a backdrop click …`: `page.goto: Timeout 15000ms exceeded`
   at `settings-orchestration.e2e.spec.ts:50`. The page never booted.
2. `baseline smoke (electron, anubis-light)`: the 30 s test timeout, after its B33 fold line had been logged.

**Re-runs:**
- `--grep "electron, anubis-light" --workers=1`: 1/1 passed (18.8 s). All of that host and theme's captures were
  re-taken.
- `settings-orchestration.e2e.spec.ts --workers=2`: 14/14 passed.

**Kept captures.** All 36 are `current-orchestration-*` files in `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\.ptah\specs\TASK_2026_555\screenshots\angular\`:
- **Tab smoke (4):** `current-orchestration-{vscode,electron}-{anubis,anubis-light}-1024x768.png`.
- **NEW roles open (4):** `current-orchestration-roles-open-{vscode,electron}-{anubis,anubis-light}-1024x768.png`. The
  details are open and scrolled so the summary is at the top.
- **Popovers and modals (28):** `current-orchestration-popover-{model,effort,permission,copilot,cursor}-*` and
  `current-orchestration-modal-{add,tiers}-*`. They were re-taken because the matrix moved down below the new bar, so
  every one of these images changed.

**Restore.** I copied every non-Orchestration `current-*` file back from the backup. The capture `git status` then
shows:
- 32 modified, all `current-orchestration-*`;
- 4 new, the `roles-open` captures;
- no modified `baseline-*`;
- no modified non-Orchestration `current-*`.

## 6. Measured fold (bottoms in px from the viewport top, 1024×768; budget 660)

| Host / theme | policy bar | cli-matrix header | first row | background-roles-summary |
| --- | --- | --- | --- | --- |
| vscode / anubis | 125 | 206 | 247 | **643 (fits)** |
| vscode / anubis-light | 125 | 206 | 247 | **643 (fits)** |
| electron / anubis | 189 | 294 | 337 | **803 (143 px over)** |
| electron / anubis-light | 189 | 294 | 337 | **803 (143 px over)** |

- **VS Code:** the bar is one row (about 33 px tall).
- **Electron:**
  - The page is narrower beside the shell sidebar, so the bar wraps to 2 rows (about 66 px).
  - The matrix's narrow layout makes its rows taller: 43-61 px, and 113 px for Glm.
  - The handoff projected 104 px over budget. The measured overrun is 143 px. About 33 px of the difference is the
    bar's second row; the rest is the matrix.
  - This is Gate V 36 item 4 (options: collapse the Uninstalled group, accept the Gate V 28 precedent, or a denser
    narrow layout). Nothing in this batch can recover it without changing the matrix.
- The first attempt was a 3-line bar (95 px). It put the VS Code summary at 697 px. It was fixed before this run (see
  Deviation 2).

## 7. Deviations

1. **Two harness files beyond the batch's file list.**
   - `settings-reachability.e2e.spec.ts` (3 lines): the kept selector `assignments-heading` is now inside the closed
     details. Gate G's "kept selectors survive" test would fail unless it clicks the summary first. The batch rule
     "reachability/e2e selectors updated in the same batch" applies.
   - `settings-visual.e2e.spec.ts`: needed for the requested `roles-open` captures and the fold numbers. The fold is
     logged only; the assertion stays with Batch 36 (the header comment says so).
2. **Policy bar copy (revised in round 1).**
   - The visible label is "Order:".
   - Screen readers get the whole order from the Edit button: "Preferred order: 1. Codex, …, 4. Copilot (off),
     5. OpenCode. Edit order". The popover title is "Preferred order".
   - The prototype's "lanes" suffix is dropped. The slider's `aria-valuetext` reads "N agents at once".
   - The "→" separators are back.
   - The reordering is in the popover, with 24×24 targets (see "Visual revise round 1").
3. **Chip set.** The chips use the matrix's installed rows. Instances come from `cliAgents()` (disabled instances
   included); the old code used `detectedClis` with `ptahCliId`. In the fixture both give the same 5 agents. A move
   writes only the shown ids, as the old code did; Undo writes back the exact previous array.
4. **Unit-spec gap.** In the container spec the CLI matrix's `@defer` block does not render under TestBed. The order
   test therefore checks the bar, then the details, then `ptah-cli-config`. Playwright covers the matrix's position:
   the bar bottom is above the matrix header in every host.
5. **Live scripts left as they are.**
   - `apps/ptah-electron-e2e/src/docs-screenshots/workspace-settings.shot.ts` and
     `apps/ptah-electron-e2e/src/specs/settings/settings.spec.ts` still look for `assignments-heading` on the
     Providers tab.
   - They have been stale since Batch 18 moved the roles. They now also need to open the details.
   - These live scripts belong to Batch 37. I did not touch them.

## 8. Out of scope, noted

- The Electron fold is 143 px over (section 6). This is Gate V 36 item 4.
- The 100% CPU from other sessions caused the two timeouts in section 5.

## Visual revise round 1

From the orchestrator's capture check.

- **R1 (accessibility, blocking):** the stacked 14×10 px ▲/▼ failed WCAG 2.5.8. Do not shrink controls to fit the fold.
- **R2:** the bar must be one row in VS Code, and should be one row in Electron.

Sections 1-7 above are partly superseded by this round. Where they differ, this section is current.

### Change

`agent-orchestration-config.component.ts` (now 292 lines).

**The bar**
- The chips are compact and read-only, as in the prototype: `1. Codex → 2. Antigravity → 3. Glm → 4. Copilot →
  5. OpenCode`. The "→" separators are back.
- The chip strip fades out over its last 0.75 rem when the box is too narrow, as in Electron.
- Next to the chips sits a 24×24 "Edit order" button (pencil, `data-testid="policy-order-edit"`):
  - its `aria-label` is the whole order, for example "Preferred order: 1. Codex, 2. Antigravity, 3. Glm,
    4. Copilot (off), 5. OpenCode. Edit order";
  - it has `aria-haspopup="dialog"` and `aria-expanded`;
  - the chip strip is `aria-hidden`, so screen readers hear the order once.
- The slider is `w-16` and the gap is `gap-2.5`, so all 5 chips fit in VS Code.

**The popover** (`NativePopoverComponent` from `@ptah-extension/ui`, `role="dialog"`, title "Preferred order",
`data-testid="policy-order-popover"`)
- One row per agent: "N. Name" ("off" for a disabled agent).
- Each row has ▲ and ▼ icon buttons of 24×24 px (`btn-xs btn-square h-6 w-6`), labelled "Move Codex up" /
  "Move Codex down".
  - ▲ is disabled on the first row and ▼ on the last.
  - No grip and no drag (deviation 5 holds).
- The footer note reads "The first available agent is used when no CLI is specified."
- **Writes:** each move saves through the feedback service with Undo. The write is unchanged:
  `saveSettings({orchestration:{preferredAgentOrder}})` with the whole order.
- **Failure:** if the commit does not save, the rows keep the read-back order (D15). The popover shows the fixed
  sentence "Could not save the preferred order. The order shown is the saved one." with `role="alert"`. The toast
  carries the details. Host text is never shown.
- **Focus:**
  - On open, focus goes to the first enabled move button.
  - After a move, focus stays on the moved row's button, or its other button once the row reaches an end.
  - Esc, the backdrop and Close all close the popover. The popover then returns focus to the Edit button.

**Other files**
- Spec: 22 tests.
  - New for the popover: rows and 24 px classes, disabled ends, move down and up with Undo, focus kept on the moved row,
    D15 failure with the fixed sentence and no host text, Esc returning focus to the trigger, reorder blocked before
    both reads, reorder blocked while saving.
  - Updated: the bar has read-only chips and no move buttons, and the trigger's accessible name.
- Reachability #73: opens the popover, checks that "Move Codex up" is disabled, clicks "Move Codex down" and expects
  the `agent:setConfig` write, checks focus is still on that button, then Esc (popover gone, focus on the trigger),
  then Undo writes the previous order.
- Visual spec `captureOrderPopover`. It asserts:
  - the bar is at most 48 px tall (one row) in both hosts;
  - the Edit button and every move button are at least 24 px;
  - the popover is on screen and painted on top;
  - Esc returns focus.

  It captures `orchestration-order-popover`.

### New fold table (bottoms in px from the viewport top, 1024×768; budget 660)

| Host / theme | policy bar | cli-matrix header | first row | background-roles-summary | bar size |
| --- | --- | --- | --- | --- | --- |
| vscode / anubis | 125 | 206 | 247 | **643 (fits)** | 832×42, one row |
| vscode / anubis-light | 125 | 206 | 247 | **643 (fits)** | 832×42, one row |
| electron / anubis | 165 | 270 | 313 | **779 (119 over)** | 670×42, one row |
| electron / anubis-light | 165 | 270 | 313 | **779 (119 over)** | 670×42, one row |

- The Electron bar is now one row: it was 2 rows ending at 189, now one row ending at 165. In Electron the chips
  clip after "3. Glm" behind the fade; the Edit button names the whole order.
- The rest of the Electron overrun is the matrix's narrow layout (Glm row 113 px, other rows 43-61 px). That is Gate V
  36 item 4, for the user. Not attempted here.
- Order popover: 256×239 px in every host and theme. The smallest target is 24 px.

### Deviations (current)

- **Deviation 2 (bar copy) as revised:** the visible label is "Order:". The full "Preferred order" reaches screen
  readers through the Edit button's name and the popover title. "lanes" is still dropped.
- **The 14×10 px note is withdrawn:** every reorder target is 24×24.
- **Reorder is one extra click:** it moved into the "popover for short choices" save model, as directed.
- **In Electron the chips clip behind a fade.** The full order is in the trigger's accessible name and in the popover.

### Verification (final code)

| Command | Result |
| --- | --- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview` | Successfully ran for 5 projects. After the last two class-only tweaks (disabled-button background, slider width), `-p @ptah-extension/chat` was re-run and passed again. |
| `npx nx run-many -t test -p (same 5) -- --maxWorkers=2` | **chat 2206 passed + 2 skipped** (131 suites; +27 against 32b). **core 1109**, **ui 624**, **webview 224**. The policy bar spec was re-run on the final code: 22/22. |
| `npx nx build ptah-extension-webview --skip-nx-cache` | Success, no budget error. Initial total **3.48 MB**. |
| `settings-visual.e2e.spec.ts --workers=1` (final build) | 4/4. Fold and target-size assertions green; the numbers are in the table above. |
| `settings-orchestration.e2e.spec.ts --workers=1` (final build) | 14/14 |

### Gate G record (`--reporter=list`, `--repeat-each=3`, cwd `libs\frontend\webview-e2e-harness`)

CPU was at 99-100% from other sessions for the whole round (`Win32_Processor.LoadPercentage`). No run failed on an
assertion. Every failure was a timeout before or between entries, and none was on an entry this round touches
(#72-#79, #83, RUX-9). #73's new flow passed in every run.

| Run | Build | Workers | Result | Failures |
| --- | --- | --- | --- | --- |
| R1-a | fade 90% | 2 | 24/27 | The 180 s test budget ran out during **RUX-4** (vscode) and **#47** (electron), then `locator.count: Target page … closed` at `settings-reachability.e2e.spec.ts:89`. A Windows worker crash `0xC0000409` (code 3221226505, known pre-existing) in the vscode pass. |
| R1-b | same | 2 | 24/27 | The 180 s budget ran out during **RUX-5** (vscode) and **#28** (electron); the same worker crash. The repeats that were not starved passed in about 1.8 m each. |
| R1-c | final | 2 | 22/27 | `route.fetch: Timeout 10000ms`, and `page.goto: Timeout 15000ms` at boot in "kept selectors survive" (both hosts). The 180 s budget ran out during **RUX-4** (electron) and **RUX-8** (vscode). |
| R1-d | final | 1 | 26/27 | `route.fetch: Timeout 10000ms exceeded` on `GET https://fonts.gstatic.com/…/inter…woff2`, an external font request during boot. |
| **R1-e** | **final** | **2** | **27/27 passed (6.4 m)** | none |

Suspected cause for R1-a to R1-d: CPU starvation, plus a slow external font fetch. This matches the known
pre-existing flakes (watcher timeouts under load, Windows worker crash `0xC0000409`). The final build passes
`--repeat-each=3` with all repeats green (R1-e).

The scene runs before the final build also had boot timeouts (`page.goto` 15 s, `ECONNRESET`, one worker crash).
Re-run alone on the final build: 14/14.

### Captures (final build, both hosts, both themes)

All in `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\.ptah\specs\TASK_2026_555\screenshots\angular\`:
- `current-orchestration-{vscode,electron}-{anubis,anubis-light}-1024x768.png`
- `current-orchestration-roles-open-*`
- **NEW** `current-orchestration-order-popover-{vscode,electron}-{anubis,anubis-light}-1024x768.png`
- the matrix popover and modal captures (`current-orchestration-popover-*`, `current-orchestration-modal-*`),
  re-taken because the matrix moved with the bar.

**Restore:** every non-Orchestration `current-*` was copied back from `%TEMP%\b33-shots-backup`. The capture
`git status` shows:
- 32 modified, all `current-orchestration-*`;
- 8 new (4 `roles-open`, 4 `order-popover`);
- 0 non-Orchestration files changed;
- no `baseline-*` changed.
