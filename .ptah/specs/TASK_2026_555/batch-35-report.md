# Batch 35 report: roles table restyle + consumer rows (S6)

Executor: frontend-developer, Orchestration owner (in-process subagent). Date: 2026-10-02. Base: HEAD `7dd06a872`
(Batch 34). Track A worktree only. Nothing is staged or committed.

- I did not use `git stash`, restore, checkout, reset or clean, and I did not edit `batches.md`.
- Before the visual runs I copied all 92 `current-*` captures to `%TEMP%\b35-shots-backup`. Afterwards I copied back
  every non-Orchestration capture (section 6).

## 1. What changed

### `provider-consumer-rows.ts` (NEW, pure, 246 lines)

`makeRow` and its helpers moved out of the component (old `:37-139`), plus the rest of the row logic that was inline:
- `buildConsumerRows(sources, route, scopeOf)`: the six rows in the fixed order.
- `formatResolvedSummary`.
- `consumerPatch(id, provider, model)`: the write patch.
- `providerReadiness(provider, providers, hasActiveProvider)`: the readiness sentences, unchanged and fixed.

Two smaller changes:
- `makeRow` takes a `ScopeLookup` function instead of the state service, so it is pure.
- Each row gains three view fields: `cellLabel`, `followsMain` and `tierLabel`.

`BackgroundConsumerId`, `toPickerModel`, `toBackendJudgeModel` and `formatProviderDisplayName` now live here. Their
importers are re-pointed; no re-export shim:
- `connection-usage.ts`
- the container and its spec

### `ProviderConsumerAssignmentsComponent` (805 → 381 lines)

The inputs and outputs are unchanged: `timeoutNotice`, `disabled`, `initialEditingConsumerId`,
`setupProviderRequested`, `retryEnhancementRequested`, `assignmentSaved`, `timeoutSaved`.
`data-testid="assignments-heading"` is kept.

**Table** (stacked cards → `table-xs`, design-spec §1.2 density):
- Columns are Role, Provider & model, Tier and Scope; the prototype's Purpose column is not used (Deviation 2).
- The table has an sr-only caption, "Background model roles".
- Rows are `<tr data-testid="consumer-row-{id}">` with `<th scope="row">`. The Judging & enhancement helper copy sits
  under its name.

**Provider & model cell** (`consumer-edit-{id}`) is the popover trigger:
- **Own provider:** "{Provider} · {model or Default (tier)}" in mono, with a ⌄ chevron.
- **No provider:** the **"Follows main agent → {driver}" chip** (prototype `.follows-chip`), with the arrow icon in
  `text-primary`. Colour is on the icon only and the text stays `text-base-content` (deviation 6).
- **Accessible name:** "{Role}: {full route}. Reassign", with `aria-haspopup="dialog"` and `aria-expanded`.

**Tier:** a badge reading "{tier} tier" or "direct model", as in the prototype.

**Scope:** the existing `SettingScopeRowComponent` badges for the provider and model keys (D16: nothing for inherited
global). A loaded section whose refresh failed shows the fixed "Could not load this section. Retry." with Retry here.

**Reassignment popover** (`NativePopoverComponent`, `role="dialog"`, `aria-label="Reassign {Role}"`,
`data-testid="consumer-editor-{id}"`). It holds the existing `ProviderModelPickerComponent`, whose header (the role
name) is the visible title; Close sits in that header's corner.

- **Saving:** a picker choice saves at once through `SettingsSaveFeedbackService` with Undo (D2), scope All Ptah apps.
  - The label is "{Role} assignment", so the toast reads "Saved Judge lane assignment to All Ptah apps.".
  - Undo writes the previous provider and model back through the same path.
- **`assignmentSaved`:** emitted from each write's own result (`saveSettings` returns `true` and `commit()` reports
  `saved`). This applies to Undo too. The old `commit()`-status gate is dropped, as the Batch 17 note required
  (`batches.md:1191`).
- **D15:**
  - A write that does not save emits nothing.
  - The toast alerts with fixed sentences.
  - The picker returns to the read-back value.
  - A refused write ("Another change is still saving.") also emits nothing.
- **Provider not ready** (needs key, not installed, unreachable, unauthenticated, not set up):
  - nothing is written;
  - the choice stays in the picker;
  - the popover shows the fixed readiness sentence plus " Not saved." with `role="alert"`, and its "Set up {provider}"
    link (`setupProviderRequested`).
- **Provider that cannot be checked** (`unknown`/`skipped`): it only gets the advisory note (`role="status"`) and still
  saves.
- **D3:** the cells are disabled while any save runs.
- **Focus:** Esc, the backdrop and Close return focus to the row's cell. The component focuses the cell after close,
  so this also holds when a deep link opened the popover. `NativePopoverComponent` alone would restore focus to
  whatever had it before.

**Deep link:** `initialEditingConsumerId` opens that role's popover, once per value. That is the "edit state": deep
link `judge` → the container opens the `<details>` → the Judge lane popover is open.

**Enhancement time limit:** a full-width sub-row directly under Judging & enhancement. It holds the same logic (bounds
only from `enhanceTimeoutMs`), the "Time limit: N seconds" badge, Edit limit, the editor, the range helper, the notice
with Retry / Change time limit, and the scope badge.
- `saveTimeout` now also gates on the per-call result.
- The input takes focus via `afterNextRender` instead of `setTimeout`.

### `OrchestrationSettingsComponent`

- `(setupProviderRequested)` calls `appState.requestSettingsTab({ tab: 'providers', providerId })` (plan :772-774).
- Settings is already open, so the pending-tab effect (R2.7) lands on Providers with `requestedProviderId` set, and the
  existing deep-link path opens the setup wizard.
- The container's `providerSetupRequested` output, the `settings.component.html` binding and
  `SettingsComponent.openProviderSetup` became dead code and are deleted (Deviation 1).

## 2. Files

All paths are under `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\`.

| Change | Path |
| --- | --- |
| CREATED | `libs\frontend\chat\src\lib\settings\providers\provider-consumer-rows.ts` (246) |
| CREATED | `libs\frontend\chat\src\lib\settings\providers\provider-consumer-rows.spec.ts` (16 tests) |
| MODIFIED | `libs\frontend\chat\src\lib\settings\providers\provider-consumer-assignments.component.ts` (381) |
| MODIFIED | `libs\frontend\chat\src\lib\settings\providers\provider-consumer-assignments.component.spec.ts` (43 tests, rewritten from section 2 on) |
| MODIFIED | `libs\frontend\chat\src\lib\settings\ptah-ai\orchestration-settings.component.ts` (setup → `requestSettingsTab`) |
| MODIFIED | `libs\frontend\webview-e2e-harness\src\lib\scenarios\settings\settings-reachability.table.ts` (RUX-12; count 97 → 98) |
| MODIFIED (extra) | `libs\frontend\chat\src\lib\settings\ptah-ai\orchestration-settings.component.spec.ts` (AppStateManager stub; setup routing case) |
| MODIFIED (extra) | `libs\frontend\chat\src\lib\settings\settings.component.ts`, `.html`, `.spec.ts` (dead `openProviderSetup` removed; spec case now drives the real path) |
| MODIFIED (extra) | `libs\frontend\chat\src\lib\settings\providers\connection-usage.ts` (type import path) |
| MODIFIED (extra) | `libs\frontend\webview-e2e-harness\src\lib\scenarios\settings\settings-visual.e2e.spec.ts` (role-popover capture: on-screen check, Esc focus check) |
| MODIFIED (extra, orchestrator decision) | `libs\frontend\webview-e2e-harness\src\lib\scenarios\settings\settings-reachability.e2e.spec.ts` (per-host budget 180 s → 600 s, section 5) |
| CAPTURES | 23 modified + 4 new `current-orchestration-*` (section 6) |

- No new `as any` or `@ts-ignore`.
- The component is 381 lines (the requirement was under 700).
- `settings-reachability.table.ts` is 942 lines. It is the already-accepted data table, +36 for RUX-12.

## 3. Verification

| Command | Result |
| --- | --- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview` | Successfully ran typecheck, lint for 5 projects (final code) |
| `npx nx run-many -t test -p (same 5) -- --maxWorkers=2` | Successfully ran test for 4 projects (the harness has no test target). **chat 2228 passed + 2 skipped** (131 suites; Batch 34: 2202 / 130). **core 1109**, **ui 624**, **webview 224**. |
| `npx nx build ptah-extension-webview` | Success, no budget error. Initial total **3.46 MB** (unchanged). Matrix lazy chunk 65.07 kB. |
| `settings-visual.e2e.spec.ts` + `settings-orchestration.e2e.spec.ts`, `--workers=2` | **18/18**; the final visual re-run after the popover-width fix was 4/4 |

## 4. Gate G record (cwd `libs\frontend\webview-e2e-harness`, `--reporter=list`, `--repeat-each=3`)

The CPU was at 74-100% (`Win32_Processor.LoadPercentage`) from other sessions throughout.

| Run | Code | Workers | Result | Failures, diagnosed |
| --- | --- | --- | --- | --- |
| B35-G1 | first draft | 2 | **20/27** | **Real, reproducing:** RUX-12 failed in all 6 main runs with `expect(locator).toHaveAttribute(expected)` on `[data-testid="background-roles-details"]`: expected `""`, the value was `null`. **Cause:** the roles `<details>` was already open when RUX-12 clicked the summary, so the click closed it. #83 deep-links `background-models` earlier in the run, and the container keeps that `focusTarget`. On the next visit to the tab its focus effect runs again and re-opens the roles. This deep-link stickiness predates this batch (Batch 33, out of scope, section 8). **Fix:** RUX-12 opens the details only when they are closed, and closes them only if it opened them. **Also:** "kept selectors survive" (electron, repeat 2): `assignments-heading` was not visible after the reveal click (`settings-reachability.e2e.spec.ts:114`). It did not reproduce in any later run (24/24 passes). |
| B35-G2 | final | 2 | **24/27** | 3 × the 180 s per-host budget ran out (vscode #57, electron unnamed, vscode #63). The only error was `locator.count: Target page, context or browser has been closed` at `settings-reachability.e2e.spec.ts:89:67` (the backstop). **No assertion failed** (RUX-12 passed in all 6). The first pair ran 3.0 m; later repeats 2.2-2.9 m. |
| B35-G3 | final | 2 | **25/27** | 2 × budget (vscode #47, electron #57), same error, no assertion failure. The passing runs took 2.3-2.9 m. |
| B35-G4 | final | 1 | **26/27** | 1 × budget (vscode repeat 1, #8, a Providers drawer entry this batch does not touch), same error, no assertion. The unstarved runs took 1.2-1.6 m. |
| B35-G5 | final | 1 | **27/27** (7.8 m) | none; 1.1-1.4 m per host |
| **Decision** | | | | Orchestrator: stop re-running after G5. G2-G4 fail only by running out of the 180 s per-host budget, not on assertions, so re-runs cannot fix it. Apply track B's change (commit `d0b6c6f39`): `test.setTimeout(600_000)`, with the same comment. **Applied with identical text** (lines 66-72 diff-identical to track B), so the merge needs no resolution. |
| **B35-G6** | **final + 600 s** | **2** | **27/27 passed (5.4 m)** | none. CPU 96% at start. |

**Measured duration of each host's test in B35-G6** (from the JSON reporter):

| Host | Repeat 0 | Repeat 1 | Repeat 2 |
| --- | --- | --- | --- |
| vscode | 97.8 s | 98.8 s | 100.8 s |
| electron | 99.5 s | 98.8 s | 102.4 s |

**Per-entry cost** (median of the 6 runs per `test.step`; 98 entries, medians sum to 98.5 s):
- **The new RUX-12 is cheap:** 0.57 s. It needs no extra page, because it uses the shared session's Judge lane.
- **The slowest entries all predate this batch:**
  - #58: 8.8 s (catalog → setup wizard);
  - #29: 3.1 s;
  - #20, #26, #19: about 2.8 s each;
  - #49: 2.6 s.
- **Batch 34's variant-page entries:** #57 1.2 s, #47 2.2 s, #77 2.0 s.

No Batch 35 entry is unusually slow, so none needed making cheaper.

## 5. Gate G entry added

**RUX-12** "Background role reassigned in place: a popover from its cell (or 'Follows main agent →' chip), saved on
selection" (`settings-reachability.table.ts`, in `regressedUx`). The steps:
1. Opens Agent Orchestration, then the roles `<details>` if closed.
2. Checks the table and Archaeologist's chip, "Follows main agent → Claude (Subscription)".
3. Clicks the Judge lane cell ("Moonshot (Kimi) · kimi-k2.5") → the popover.
4. Chooses "follow the main agent" (provider `''`) → asserts the `skillSynthesis:setLanes {lanes:{judge:{provider:''}}}`
   write.
5. Asserts the toast is shown and does not claim "Saved Judge lane". The fixture's `getLanes` is static, so the
   read-back cannot confirm the write (D15, the #53 precedent).
6. Esc → the popover is gone and **focus is back on the cell**.
7. Closes the details only if it opened them.

`EXPECTED_CAPABILITY_COUNT` goes from 97 to 98. `BASELINE_PRESENT_IDS` is untouched.

No existing entry targeted the old cards, so nothing needed re-pointing. #83, RM-2 and the kept selector
(`assignments-heading` behind the summary) pass unchanged.

## 6. Captures and fold

All in `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\.ptah\specs\TASK_2026_555\screenshots\angular\`:
- `current-orchestration-roles-open-{vscode,electron}-{anubis,anubis-light}-1024x768.png`: the roles table.
- **NEW** `current-orchestration-role-popover-{vscode,electron}-{anubis,anubis-light}-1024x768.png`: the Judge lane popover
  open.
  - The visual spec asserts it is fully on screen and that Esc returns focus to the cell.
  - It measures 432×257-259 px. It sits at 428,328-330 in VS Code and 552,308-310 in Electron, flipped above its
    trigger.
- The other `current-orchestration-*` (tab, order popover, matrix popovers and modals) were re-taken by the same runs.

**Restore:** every non-Orchestration `current-*` was copied back from `%TEMP%\b35-shots-backup`. The capture
`git status` shows:
- 23 modified, all `current-orchestration-*`;
- 4 new (`role-popover`);
- 0 others;
- no `baseline-*` changed.

**Fold** (bottoms in px, 1024×768, budget 660): the roles summary did not move.

| Host / theme | policy bar | cli-matrix header | first row | background-roles-summary |
| --- | --- | --- | --- | --- |
| vscode / anubis, anubis-light | 125 | 206 | 247 | **643** (fits; Batch 34: 643) |
| electron / anubis, anubis-light | 165 | 270 | 313 | **779** (Batch 34: 779; Gate V 36 item 4) |

**Visual revise (in-batch, before capture):** the first popover capture had two defects.
- It repeated the title ("Reassign Judge lane" above the picker's own "Judge lane" header).
- At 20rem it truncated the selects ("Moonshot (K", "Kimi K2.5 · tc").

**Fix:**
- The picker header is now the only visible title, and the dialog is named `aria-label="Reassign {Role}"`.
- Close sits in the header's empty corner.
- The popover is 27rem wide (`max-w-[calc(100vw-2rem)]`).
- The spec pins one visible title.

## 7. Deviations

1. **Files beyond the batch's six:**
   - `settings.component.ts`, `.html` and `.spec.ts`: the dead `openProviderSetup`, output and binding were removed
     after the rewire (the plan's "re-wired by the container").
   - The container spec.
   - `connection-usage.ts` (import path).
   - The visual spec (for the requested `role-popover` capture).
   - The reachability spec's timeout (orchestrator decision).
2. **No Purpose column.** The prototype's per-role purpose texts are prototype copy with no source in the product.
   Only Judging & enhancement keeps its existing helper copy, under its name.
3. **The Scope column is often empty.** D16 shows no badge for an inherited global value. In the harness fixture
   every role is inherited global, so the column is blank (visible in the captures). It fills with "· Mixed sources"
   or override badges when they apply (unit-tested).
4. **A provider change saves at once with the model reset** to the tier default (the picker's own rule). Choosing a
   model is then a second save, with its own Undo. This is the D2 save-on-selection model; each choice is one toast.
5. **New copy for Gate V 36:**
   - "Follows main agent → {driver}";
   - "Reassign {Role}" (dialog name);
   - "Each choice saves at once, with Undo. No provider follows the main agent.";
   - the " Not saved." suffix on blocking readiness sentences;
   - the toast label "{Role} assignment";
   - "direct model" / "{tier} tier".
6. **The popover flips above its trigger** when there is no room below (Floating UI flip). In the capture it covers
   the rows above the Judge lane while open.

## 8. Out of scope, noted

- **Sticky Orchestration deep link** (pre-existing, Batch 33). **Fixed in Visual revise round 1 (R3) below.**
  `SettingsComponent.orchestrationTarget` was never cleared after use. After a `background-models` (or role) deep link, every later visit to Agent Orchestration re-runs the
  container's focus effect: it re-opens the roles `<details>`, focuses the section, and for a role target re-opens
  that role's popover. This is what broke RUX-12 in G1. I recommend clearing the target once it is applied, for the
  Gate V 36 review.
- **Run time:** the reachability spec now takes about 100 s per host unstarved and up to 3+ minutes under 90-100% CPU.
  The 600 s budget covers both tracks after the merge.

## Visual revise round 1 (orchestrator capture check)

### R1: role cells stay on one line in both hosts

**Problem:** in Electron, "Follows main agent → Claude (Subscription)" wrapped to 2 lines, with the arrow pushed to
the cell's right edge.

**Fix** (`provider-consumer-assignments.component.ts`):
- The cell button is `inline-flex max-w-[15rem] whitespace-nowrap`.
- The label `<span>` is `min-w-0 truncate`, so the icon (→ or ⌄) follows the text directly. The `<td>` is
  `whitespace-nowrap`.
- The full route is in the button's `title` and still in its accessible name ("{Role}: {route}. Reassign").
- This holds for both cell kinds: the chip and "{Provider} · {model}".

**Measured** (new visual-spec assertion, all four host/theme runs): every role cell is **16 px tall (one line)**. The
assertion requires ≤ 24 px. Row heights are 25 px each; Judging & enhancement is 68 px because it carries its helper
copy (unchanged). In Electron the chip reads "Follows main agent → Claude (Subs…" →.

**Specs:**
- Assignments spec, +1 test: the nowrap and max-width classes, `truncate` on the label, the icon right after it, and
  the `title` for both cell kinds.
- RUX-12 also asserts the chip's `title`.

### R2: coloured words in the light-theme roles summary

**Cause, measured** (pixel averages of each word in `current-orchestration-roles-open-electron-anubis-light`):
- No word was highlighted. The summary is one static string in one `<span>`, with no per-word markup and no meaning
  attached to colour.
- Every word had the same colour, about RGB 125,90,125. That is `base-content-muted` in anubis-light: `--bcm` is
  `oklch(53.26% 0.041 354.46)` (`tailwind.config.js`), a **rose-tinted grey by theme design** (TASK_2026_186).
- At 10 px the antialiasing of "j"/"g" makes "judge" and "judging" read warmer (135,92,109).

**Fix** (`orchestration-settings.component.ts`, summary): the span is now `text-base-content`, as deviation 6 asks.
- The words now measure the same purple hue as the body text: about 120,86,121 against the Role column's 82,64,90.
  Both are the theme's `base-content` `oklch(23.6% 0.066 313)`, and the summary is lighter only because 10 px strokes
  cover fewer pixels.
- Any remaining warmth on "j"/"g" is glyph antialiasing, not a colour.
- Container spec: the list is `text-base-content`, not `text-base-content-muted`.

### R3: the sticky deep link (Batch 33 origin)

**Fix** (`settings.component.ts`, `setActiveTab`): when the active tab changes, both deep-link targets are cleared.
- `orchestrationTarget` and `providersTarget` are cleared; Providers had the same latent stickiness.
- A deep link is applied on the visit it opened. A tab is torn down when left and rebuilt on return, so a later visit
  finds no target: the roles stay closed, no role popover opens and nothing takes focus.
- `applyPendingTab` sets the new target after calling `setActiveTab`, so deep links still work, including while
  Settings is open (R2.7).

**Why not clear it the moment it is applied:** the role popover opens only once its section has loaded (async). The
container focuses the section first, so clearing on application would race the load and lose the popover.

`ProviderConsumerAssignmentsComponent` resets its "applied" marker when the input becomes `null`, so the same role can
be deep-linked again on a later visit.

**Specs:**
- `settings.component.spec`, +2 tests:
  - the target survives within the visit and is cleared by a tab change (both targets);
  - landing suite: after a `judge` deep link, leaving Orchestration and coming back leaves the roles closed and the
    section unfocused.
- Assignments spec, +1 test: a role is deep-linked, closed, cleared and deep-linked again → its popover opens again.

**RUX-12:** the `wasOpen` workaround from B35-G1 is removed. The entry now **asserts the roles are closed on arrival**,
after #83's `background-models` deep link earlier in the same session, which makes R3 a Gate G check. It then clicks
the summary as a user would.

### Files (this round)

- `libs\frontend\chat\src\lib\settings\providers\provider-consumer-assignments.component.ts` (R1 classes and `title`;
  deep-link marker reset)
- `libs\frontend\chat\src\lib\settings\providers\provider-consumer-assignments.component.spec.ts` (+2)
- `libs\frontend\chat\src\lib\settings\ptah-ai\orchestration-settings.component.ts` (summary colour)
- `libs\frontend\chat\src\lib\settings\ptah-ai\orchestration-settings.component.spec.ts` (+1 assertion)
- `libs\frontend\chat\src\lib\settings\settings.component.ts` (`setActiveTab` clears the targets)
- `libs\frontend\chat\src\lib\settings\settings.component.spec.ts` (+2)
- `libs\frontend\webview-e2e-harness\src\lib\scenarios\settings\settings-reachability.table.ts` (RUX-12)
- `libs\frontend\webview-e2e-harness\src\lib\scenarios\settings\settings-visual.e2e.spec.ts` (one-line cell assertion
  and height log)

### Verification (this round)

| Command | Result |
| --- | --- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/webview-e2e-harness` | Successfully ran for 2 projects |
| Specs (settings, assignments, container, rows) | **119/119** |
| `npx nx build ptah-extension-webview` | Success; initial total **3.46 MB** |
| `settings-visual.e2e.spec.ts --workers=2` | 3/4. vscode/anubis-light hit its 30 s test timeout in `locator.evaluate` at `settings-visual.e2e.spec.ts:85` (the Providers drawer tab-strip check). That runs after the Orchestration steps, which had all passed and logged, with CPU at 100%. **Re-run alone** (`--grep "vscode, anubis-light" --workers=1`): **1/1** (37 s). |
| **Gate G** `--repeat-each=3 --workers=2` (600 s budget), CPU 100% at start | **27/27 passed (5.6 m)**. Per-host test 1.5-2.2 m. No failure. |

### Captures (this round)

Re-taken only: `current-orchestration-roles-open-{vscode,electron}-{anubis,anubis-light}-1024x768.png` and
`current-orchestration-role-popover-{vscode,electron}-{anubis,anubis-light}-1024x768.png`. All are in
`D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\.ptah\specs\TASK_2026_555\screenshots\angular\`.

Every other `current-*` was restored from `%TEMP%\b35r-shots-backup`. A byte comparison against the backup shows
exactly those 8 files changed, and no `baseline-*` changed.

The fold is unchanged: roles summary at 643 (VS Code) and 779 (Electron).

### For Gate V 36 (carried; the sticky deep link is fixed and removed from this list)

1. New copy:
   - "Follows main agent → {driver}" (now truncated, with the full route in the title);
   - "Reassign {Role}";
   - "Each choice saves at once, with Undo. No provider follows the main agent.";
   - the " Not saved." suffix;
   - the toast label "{Role} assignment";
   - "direct model" / "{tier} tier".
2. No Purpose column (the prototype's purpose texts have no product source).
3. The Scope column is blank for inherited global values (D16), which is every role in the fixture.
4. A provider change saves with the model reset to the tier default; a model choice is then a second save with its
   own Undo.
5. The role popover flips above its cell when there is no room below.
6. The reachability per-host budget is now 600 s, identical to track B's `d0b6c6f39`.
