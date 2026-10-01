# Batch 30 report: CLI matrix + model/effort popover (S6)

Executor: frontend-developer, Orchestration owner (in-process subagent). Date: 2026-10-01. Base: HEAD `41b85393c` (29).
Nothing is staged or committed. No `git stash`, restore, checkout, reset or clean was used. Captures were written only
to `current-*`; `git status` shows 0 modified `baseline-*` files.

| Requirement | State |
| --- | --- |
| `CliOrchestrationMatrixComponent`: on/off, status, provider, model/effort cells, permissions ℹ, Test/Delete | Done |
| `CliModelEffortPopoverComponent`: system model, system effort, instance model; save on selection with Undo | Done |
| Matrix mounted in the interim container above the old AOC/PtahCliConfig (D14), in `@defer` | Done |
| `table table-xs`, `@for … track id`, testids `cli-matrix`, `cli-matrix-row-<id>`, `cli-matrix-uninstalled` | Done |
| Disabled or not-installed rows render plain text | Done |
| Install-guide ℹ holds the #77 copy (+ new copy for the other four CLIs) | Done |
| No Tiers / Edit / Credentials / Add buttons (no dead controls) | Done (spec asserts it) |
| Gate G: #43, #44, #54, #70, #71 flipped to `restored`; RUX-8 and RUX-11 added (count 94 → 96) | Done |
| Every `save({write, undo})` is a `state.saveSettings` call (Batch 17 constraint) | Done (specs assert the calls) |

Paths below are relative to `libs/frontend/chat/src/lib/settings/ptah-ai/` unless they start with `libs/`.

---

## 1. Matrix (`cli-orchestration-matrix.component.ts`, 443 lines)

### Structure

- **Table:** `<table class="table table-xs …">` at `:81`, with the prototype's eight columns.
- **Row groups (`groups`, `:321`):** a typed `@for` over two groups.
  - The installed group renders a `@empty` row: "Loading CLI agents…" before any read, otherwise "No CLI agent is
    installed…".
  - The `<tbody data-testid="cli-matrix-uninstalled">` (`:90`) is rendered only when it has rows, under a group
    header "Uninstalled CLI agents (kept visible with install guides)".
- **Row data:** from `cliMatrixRows` (Batch 29), over `orchestration`, `cliAgents`, `cliModels` and `cliTest`.

### Cells

- **On:** a checkbox with `aria-label` "{name} enabled". It is disabled for uninstalled CLIs, while a save runs (D3),
  and while the scopes are not loaded.
- **Agent / Instance:**
  - Name and version.
  - Instances also show a "Ptah CLI" badge, the key status badge (#44) and tier badges "Sonnet: …" (#54).
- **Status:** a dot carries the colour; the text stays `text-base-content` (deviation 6).
  - System rows show detection states only (D11). There is no quota state and no system-CLI Test.
  - Instances show "Ready (112ms)" after a successful test with a latency (`statusLabel`, `:358`).
- **Provider:** the instance connection; for a system CLI its own account, or its `provider/model` prefix (opencode,
  Pi); "None" when uninstalled.
- **Model and Effort:**
  - On an enabled, installed row: `link link-hover` buttons with a muted chevron (design-spec §3.5). Each sits in a
    `NativePopoverComponent` (transparent backdrop, Esc closes) that creates the popover component only while open.
  - Otherwise: plain text, or "—" for uninstalled rows.
  - Effort shows "n/a" for Cursor, Antigravity and opencode, and "mapped" for instances (as in the prototype).
- **Permissions & Safety (#70):** the Batch 29 badge, with the colour on the badge fill and border, plus an ℹ popover
  "{name} permissions" with the detail copy.
- **Actions:**
  - Instances: Test and Delete. Delete has an inline confirm ("Delete Glm?" → Delete / Cancel).
  - Uninstalled CLIs: "Install guide", an ℹ popover with the command and note from `CLI_INSTALL_GUIDES` (`:21`).
  - Installed system CLIs: none (D11).

### Writes

All three go through `SettingsSaveFeedbackService` with scope `global`:

| Control | Write | Undo |
| --- | --- | --- |
| System CLI on/off | `saveSettings({orchestration:{disabledClis}})` | the previous array |
| Instance on/off | `saveSettings({cli:[{action:'update', params:{id, enabled}}]})` | `enabled: !enabled` |
| Delete (`remove`, `:433`) | `saveSettings({cli:[{action:'delete', params:{id}}]})` | none: a deleted instance's key cannot be written back |

- The on/off handler is `toggle` (`:410`).
- The checkbox goes back to the saved value at once. The read-back after the write moves it (D15: it never shows a
  state that was not saved).

### Test (#52, RUX-11)

`test` (`:395`) calls `state.testCliConnection(id)`. `testResult` (`:382`) shows the outcome inline in the row:

- "Test passed in 112ms." or "Test passed."
- "Test failed: {host's sanitized reason}" as `role="alert"`
- "The test could not run. Try again." when the test RPC itself failed

### Layout

The component is a container (`container-type: inline-size`, `:289`), the routing map's Q-extra-1 rule.

- **Wide box** (VS Code at 1024 px): all eight columns, as in the prototype.
- **Below 48rem** (Electron's ≈640 px page beside the shell sidebar): the Status and Provider columns are hidden and
  shown under the agent name instead (`cli-matrix-status-inline` and the provider).
- **Both:** nothing scrolls sideways. The visual spec asserts overflow ≤ 0.

### Focus

Opening a cell focuses its panel, then its first control (`focusOpened`, `:352`): the model search, which opens its
list, or the pressed effort. Esc and the backdrop close the popover, and focus returns to the cell.

## 2. Popover (`cli-model-effort-popover.component.ts`, 237 lines)

The popover is a titled `role="dialog"` ("Model for Codex" / "Reasoning effort for Codex") with a Close button.

**System model:**

- `ProviderModelSearchFieldComponent` over `agent:listCliModels[cli]` (`modelOptions`, `:149`).
  - A saved id the catalogue lacks stays listed as "{id} (saved)".
  - "Provider default" is the `''` row.
- The catalogue loads on demand (`ngOnInit`, `:185`, only when it is unloaded or failed). While loading, the field is
  disabled with "Loading models…"; on error it shows an alert with Retry.
- The search takes focus once the catalogue is ready, but only if focus is still on the panel (`:174`), so a late load
  never moves the user's focus.
- opencode and Pi show the #67 hint "Model id uses provider/model format (e.g. …)".

**System effort:**

- The CLI's allowlist as a two-column button grid with `aria-pressed`: Codex/Copilot `''`, minimal..xhigh; Pi off..max.
- The labels and lists are moved from `ptah-cli-config.component.ts:13-35` (`:18-26`).
- An unsupported saved value is never offered. It is named in a `role="alert"` (`unsupportedEffort`, `:165`; the old
  guard from `:224-243`).

**Instance model:** `ProviderModelPickerComponent [fixedProvider] [searchable]`. A pick sends
`saveSettings({cli:[{action:'update', params:{id, selectedModel}}]})`, and Undo sends the previous model.

**Saving:**

- One `state.saveSettings` per write and per Undo (`saveSetting` `:216`, `orchestrationPatch` `:233`).
- The edit context is taken on open.
- After the save (`afterSave`, `:225`):
  - `saved`: the popover closes.
  - `blocked`: it takes a fresh context and stays open.
  - failed, unconfirmed or refused: it stays open, and the toast is the alert (D15: never "Saved").

## 3. Container (`orchestration-settings.component.ts`)

`@defer (on immediate) { <ptah-cli-orchestration-matrix /> }` (`:38`) sits above `<ptah-agent-orchestration-config />`,
with an `aria-busy` placeholder of the same footprint. The old AOC and PtahCliConfig stay mounted until Batches 33-34
(D14). Duplicate controls, such as both delete paths, coexist until then, as `batches.md` allows.

## 4. Harness

- **New `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-cli-matrix.entries.ts` (110 lines):**
  - #43: the status reads "Ready".
  - #44: "Key set".
  - #54: the three tier badges.
  - #70: the Codex "Full auto" badge, then ℹ → "Full auto — Codex runs headless with full access."; Esc returns focus
    to ℹ; Copilot reads "Auto-approve: Off".
  - #71: exactly Cursor and Pi in `cli-matrix-uninstalled`, the Pi model as plain text, and Pi's install guide showing
    the package name.
  - **RUX-8:** effort cell → "high" is two clicks and one `agent:setConfig {codexReasoningEffort:'high'}`. The cell
    reads "high". Toast Undo sends a second write `{codexReasoningEffort:'medium'}`, and the cell reads "medium" again.
  - **RUX-11:** Test → `ptahCli:testConnection {id}`, and the row shows "Test passed.".
- **`settings-reachability.table.ts`:**
  - The five pending lines were removed (moved to the entries file) and `CLI_MATRIX_ENTRIES` is spread into the table.
  - `EXPECTED_CAPABILITY_COUNT` 94 → 96.
  - The file is now **712 counted lines, down from 716 at HEAD** (it was already over the 700 warning; following the
    `settings-routing-map.entries.ts` precedent).
- **`settings-visual.e2e.spec.ts`:** `captureMatrixPopovers` runs in every host/theme test.
  - It logs the matrix header bottom, first-row bottom, overflow and row heights.
  - It asserts no horizontal overflow, and that each popover is fully on screen and topmost.
  - It captures the model popover (search focused, list open), the effort popover and the permission popover, each
    closed with Esc.

## 5. Copy for user review (Gate V 36)

Install guides (`CLI_INSTALL_GUIDES`, `cli-orchestration-matrix.component.ts:21`):

| CLI | Command | Note | Status |
| --- | --- | --- | --- |
| Codex | `npm install -g @openai/codex` | Install the Codex CLI, sign in with codex login, then Re-detect. | Command from old #77; **note new** |
| Copilot | `npm install -g @github/copilot` | Install the Copilot CLI, sign in to GitHub Copilot, then Re-detect. | Command from old #77; **note new** |
| Cursor | — | Cursor needs no install: Ptah runs it through the bundled Cursor SDK. It is detected once a Cursor API key is set (the CURSOR_API_KEY environment variable, or the stored Cursor key), then Re-detect. | **New** (`cursor-cli.adapter.ts` detect: key-gated SDK) |
| Antigravity | — | Install Google's Antigravity CLI so the agy command is on your PATH, then Re-detect. | **New** (the adapter names the `agy` binary and no package) |
| opencode | `npm install -g opencode-ai` | Install opencode so the opencode command is on your PATH, then Re-detect. | **New** (adapter: npm package `opencode-ai`) |
| Pi | `npm install -g @earendil-works/pi-coding-agent` | Install the Pi Coding Agent so the pi command is on your PATH, then Re-detect. | **New** (adapter package; not the prototype's `@inflection/pi-cli`) |

UI strings that are also new:

- the popover notes "Provider default uses {name}'s own default. Saved globally; new agents use it." and "Provider
  default uses the instance's tier mappings. Saved globally for this instance."
- the test results
- the empty state

The Batch 29 permission copy (Copilot, Ptah instance) is on screen in `current-orchestration-popover-permission-*` and
in the matrix captures.

## 6. Verification

| Command | Result |
| --- | --- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview --skip-nx-cache` | Successfully ran typecheck, lint for 5 projects |
| `npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui ptah-extension-webview --skip-nx-cache --output-style=static -- --maxWorkers=2` | chat **2126 passed + 2 skipped** (127 suites; Batch 29 2082, +44: popover spec 18, matrix spec 26); core 1109/1109; ui 615/615; webview 224/224 |
| `npx eslint` on the changed files | 0 errors; 1 existing `max-lines` warning on the table (712, was 716) |
| `npx nx build ptah-extension-webview --skip-nx-cache` | **No budget error.** Initial total **3.48 MB** before and after (979.59 kB over the 2.5 MB warning, vs 978.64 kB at Batch 29: +0.95 kB eager for the container's deferred import). The matrix and popover are a lazy chunk, `cli-orchestration-matrix-component`, 33.23 kB raw / 8.92 kB transfer |
| Gate G, `--reporter=list` (final build) | **9/9 passed** (1.7 m) |
| Gate G, `--repeat-each=3`, run 1 | 26 passed, 1 failed. See below |
| Gate G, `--repeat-each=3`, run 2 | **27/27 passed** (2.3 m) |
| `settings-visual.e2e.spec.ts --reporter=list` (final build) | **4/4 passed**; every Providers fold assertion green (ratchet) |

**Repeat run 1 failure, diagnosed before the re-run:**

- Test: `reachability (electron) › every present/restored capability is reachable`, repeat 24, at 0 ms.
- Error: `worker process exited unexpectedly (code=3221226505)`, which is 0xC0000409.
- The test never started, so no entry id is involved. This is the known Windows Playwright worker crash (HANDOFF
  "Known pre-existing failures", #77).
- Per execution default 7 the gate was run again with `--repeat-each=3`, and every repeat passed.

**Measurements logged by the visual spec:**

- **Providers fold (unchanged):**
  - VS Code: tabs 83, map 354, heading 398, card5 590; 3 columns.
  - Electron: tabs 123, map 503, heading 547; 2 columns.
  - Both: cards 80 px, no overflow.
- **Matrix:**
  - VS Code: header bottom 150, first row bottom 191, overflow 0. Rows: Codex, Antigravity, Copilot, OpenCode 41;
    Glm 95 (tier badges, as in the prototype); Cursor, Pi 33.
  - Electron: header bottom 190, first row bottom 233, overflow 0. Rows 43-61; Glm 113.
  - Both are well inside the Batch 36 budget (header and first row ≤ 660).

### Captures (all `current-*`, 1024×768)

The tab captures:

- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-{vscode,electron}-{anubis,anubis-light}-1024x768.png`

The new popover captures:

- `current-orchestration-popover-model-{vscode,electron}-{anubis,anubis-light}-1024x768.png`
- `current-orchestration-popover-effort-{vscode,electron}-{anubis,anubis-light}-1024x768.png`
- `current-orchestration-popover-permission-{vscode,electron}-{anubis,anubis-light}-1024x768.png`

The same smoke run also rewrote these tracked Providers captures:

- `current-providers-electron-*`
- `current-provider-catalog-*`
- `current-scope-popover-electron-*`

Their content follows the unchanged Providers page. The team-leader decides whether to stage them.

### My comparison with the prototype

Compared against `orchestration-anubis(-light)-1024x768.png` and `interactions/orchestration-2/-3.png`.

**Matches:**

- The section card and its heading with the terminal icon and hint.
- The 8-column table: On checkbox, name and version, dot status badge, provider, mono model cell with chevron, effort,
  permission badge with ℹ, Actions.
- The Glm row: tinted, with the Ptah CLI badge, Key set and three tier badges, and Test / Delete.
- The Uninstalled group header and the muted Cursor / Pi rows with "Install guide".
- The model popover: title, close, search, list.
- The effort popover: title, close, two-column grid, current value highlighted.

**Defects found and fixed during the batch:**

1. The model column collapsed to one character per line (`break-all` in auto table layout). Fixed with a minimum width
   and word wrap.
2. The Actions column was clipped in VS Code (3 px) and the Permissions column in Electron (85 px). Fixed with the
   prototype's `badge-xs`, `px-1` cells and the narrow layout.
3. The model search was not focused on first open, because the catalogue was still loading.
4. The open model list covered the popover's own notes. The notes now sit above the search.
5. The effort buttons used a heavy mono face. They now use the default face.

**Remaining differences, intentional:**

- Text colours follow deviation 6: values are `text-base-content` instead of the prototype's blue or red text.
- Status and permission copy comes from D11 and Batch 29: no "Quota reached", no system-CLI Test, "Follows Autopilot"
  instead of "Sandboxed Port".
- System sublines show no prototype data (`~/.codex/auth.json`, "Built-in agent engine").
- The model list is the compact field's floating list below the search, the pattern accepted for the Main Agent
  popover at Gate V 28, instead of a list inside the panel.
- In the interim, the policy bar is still the old AOC, below the matrix (Batch 33). "Add Ptah CLI Instance" is absent
  until Batch 32.

## 7. Deviations

1. **File count: 9 files (5 created, 3 modified, plus this report)** instead of the batch's 6.
   - `settings-visual.e2e.spec.ts`: added for the popover captures the orchestrator asked for.
   - `settings-cli-matrix.entries.ts`: added so the reachability table shrinks instead of growing to 798 counted lines.
2. **Interim placement:** the matrix sits above the old AOC, as the Batch 30 rationale says; the prototype order
   (policy bar first) comes with Batch 33.
3. **Instance effort:** the cell reads "mapped", not interactive, as in the prototype. Instance tiers come in Batch 32.

## 8. Risks

- **Batch 17 constraint:** every `write` and `undo` is a closure that only calls `state.saveSettings`. Both specs
  assert the exact calls and that a refused (`false`) or failed write never shows "Saved".
- **D8 (validation note):** Batch 4 is committed (`50c773767`), so model and effort take effect at the next spawn.
- **Transient duplicates until Batches 33-34:** the old AOC toggles and the PtahCliConfig edit, delete and model
  controls.
- **Gate G names:** my `aria-label`s were chosen so they never match the old entries' substring queries (e.g. "Test
  Glm", not "Test connection"; "Glm enabled", not "Enable Glm for delegated work"). Gate G is green, which confirms it.

## 9. Out-of-scope observations

- The fixture's `ptahCli:testConnection` returns no `latencyMs`, so Gate G can only assert "Test passed.". The latency
  and failure paths are covered by the matrix spec.
- `settings-reachability.table.ts` is still 12 counted lines over 700. Moving the Providers wizard helpers
  (`closeWizard`, `advanceWizardTo`, `throughCatalog`, …) to their own file would fix it. That is out of this batch's
  scope.
- Batch 18 interim notes (header workspace name on a first landing on Advanced; the legacy "Manage … in Providers"
  label) are unchanged, and still tracked for Batches 33/36.

## Visual round 1 (orchestrator comparison, 4 defects)

### Fixes

**V30-1: model list rows oversized, detached and narrower than the field.** The fix is two opt-in inputs in the ui lib.
Both are off by default, so the Main Agent popover and every other consumer are unchanged.

- `NativeAutocompleteComponent`:
  - `matchInputWidth`: the panel width is set to the projected input's width before positioning.
  - `compact`: `!px-2 !py-1` rows.
- `ProviderModelSearchFieldComponent`:
  - `compact`: passes both flags through and uses a compact row template (`text-xs`, about 24 px rows).
- The CLI popover sets `[compact]="true"`. The list now sits directly under the search, at the search's width (VS
  Code: 236 px).

**V30-2: search opened prefilled with "GPT 5.5 Codex", list showed display names.**

- New opt-in `placeholder` input on the field. The CLI popover passes "Search models (e.g. gpt-5, sonnet)...". The
  search opens empty; before, the placeholder was the selection's label.
- Compact rows show:
  - the model **id in mono** first,
  - the catalogue display name muted after it when it differs,
  - a ✓ and an sr-only "(current)" on the current model.
- The sentinel ("Provider default") and the pinned action row keep their labels.
- The out-of-catalogue saved entry's secondary text is now "saved, not in the current list", so the id is not repeated.

**V30-3: rows cramped (41 px).**

- Cells now use `[&_td]:py-3`.
- VS Code: rows **57 px**; Glm 111 (tier badges); Cursor / Pi 49.
- Electron (narrow layout kept: status and provider under the name): 59 / 77; Glm 129.
- Overflow 0 in both hosts.

**V30-4: disabled and uninstalled rows only dimmed their text.**

- Every non-interactive row now has a `bg-base-300/50` row fill (`data-dimmed="true"`) plus muted text, in both themes.
  This covers the disabled Copilot row, the uninstalled Cursor / Pi rows and a switched-off instance.
- An enabled instance keeps `bg-primary/5`.
- The Uninstalled group header is now a full `bg-base-300`, so it stays distinct from the shaded rows.

### Files changed in round 1

- `libs/frontend/ui/src/lib/native/autocomplete/native-autocomplete.component.ts`: `matchInputWidth`, `compact`.
- `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-search-field.component.ts`: `compact`,
  `placeholder`, the compact row template and `compactLabel`.
- `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-search-field.component.spec.ts`: 4 new tests:
  - the defaults are unchanged when not opted in,
  - empty with the placeholder,
  - mono id rows with the name and the current one checked,
  - the list width equals the field width.
- `cli-model-effort-popover.component.ts` and its spec: compact and placeholder wiring, and the saved-entry label.
- `cli-orchestration-matrix.component.ts` and its spec: `py-3`, row shading and the header fill; 1 new test for
  shading and padding.

### Verification

| Command | Result |
| --- | --- |
| typecheck + lint, the 5 projects (`--skip-nx-cache`) | Successfully ran typecheck, lint for 5 projects |
| `nx run-many -t test -p @ptah-extension/chat @ptah-extension/ui -- --maxWorkers=2` | chat **2127 passed + 2 skipped** (127 suites); ui **619/619** (31 suites, +4) |
| `nx build ptah-extension-webview --skip-nx-cache` | no budget error. Initial **3.48 MB** (981.20 kB over the warning; +1.61 kB eager for the two ui inputs and the compact template, since the ui field is on the eager path). Lazy `cli-orchestration-matrix-component` 33.38 kB |
| Gate G `--reporter=list` | **9/9** |
| Gate G `--repeat-each=3` (one run) | **27/27** |
| `settings-visual.e2e.spec.ts` | **4/4**; Providers fold unchanged and green |

### Captures

- Only `current-orchestration-*` were retaken (16 files: tab, model, effort and permission popovers, both hosts, both
  themes).
- The smoke spec writes every `current-*` image, so the other `current-*` files were copied aside before the run and
  copied back after it. They are byte-identical to their state before round 1.
- The 8 Providers captures the round-0 run rewrote are still modified, and were not restored, as instructed.
- 0 `baseline-*` files modified.

### Round 2 (orchestrator): V30-3 reverted

The orchestrator withdrew V30-3. `implementation-plan.md:1049-1052` and `:1080-1082` make the §1.2 fold budget the
pass line ("density follows the spec, not the prototype screenshot"; `table-xs`), so option (b) was chosen.

**Change:** the `[&_td]:py-3` cell padding is removed and the table is back to `table-xs` density
(`cli-orchestration-matrix.component.ts`, with a comment citing the plan). The matrix spec now asserts `table-xs` and no
`py-3`. V30-1, V30-2 and V30-4 are kept exactly as in round 1.

**Measured (round 2):**

| Host | Header bottom | First row bottom | Overflow | Rows |
| --- | --- | --- | --- | --- |
| VS Code | 150 | 191 | 0 | Codex, Antigravity, Copilot, OpenCode 41; Glm 95; Cursor, Pi 33 |
| Electron | 190 | 233 | 0 | 43 / 61; Glm 113; Cursor, Pi 43 |

The 57 px row figures in the round 1 V30-3 note above are superseded.

**Verification (round 2):**

| Command | Result |
| --- | --- |
| `nx run-many -t lint -p @ptah-extension/chat @ptah-extension/ui --skip-nx-cache` | passed |
| chat + ui tests (`-- --maxWorkers=2`) | chat **2127 passed + 2 skipped**; ui **619/619** |
| `nx build ptah-extension-webview --skip-nx-cache` | no budget error. Initial **3.48 MB** (981.10 kB over the warning). Lazy matrix chunk 33.36 kB |
| `settings-visual.e2e.spec.ts` | **4/4** |
| Gate G `--reporter=list` | **9/9** |

**Captures:**

- Only the 16 `current-orchestration-*` files were retaken.
- The other 52 `current-*` files were copied aside and restored after the run.
- The 8 Providers captures modified in round 0 are still modified, as instructed.
- 0 `baseline-*` files modified.

### Open item for Batch 36: Electron Orchestration fold

Batch 36 asserts that the bottoms of `orchestration-policy-bar`, the `cli-matrix` header, the first row and
`background-roles-summary` are ≤ 660 px in both hosts. The projection below assumes Batch 33's policy bar (≈40 px +
16 px gap) above the matrix, and the closed roles `<details>` summary (≈40 px + 16 px gap) below it. These are
projections, not measurements: the policy bar and the roles `<details>` do not exist yet.

| Host | Policy bar | Matrix header | First row | Matrix section ends | Roles summary | Budget 660 |
| --- | --- | --- | --- | --- | --- | --- |
| VS Code (measured matrix + projection) | ≈ 140 | ≈ 206 | ≈ 247 | ≈ 568 | **≈ 624** | passes |
| Electron (measured matrix + projection) | ≈ 180 | ≈ 246 | ≈ 289 | ≈ 690 | **≈ 746** | **≈ 86 px over** |

In Electron the page is ≈640 px wide beside the shell sidebar. The narrow layout keeps every column visible without
horizontal scroll, but stacking status and provider under the name makes rows taller (43-61 px, Glm 113). Batch 30
leaves this as is, as instructed. Options for Batch 36:

1. **Collapse the Uninstalled group** behind a `<details>`/summary row (≈86 px saved; the install guides stay one
   click away). It removes about the whole overrun.
2. **Follow the Gate V 28 Electron precedent:** in Electron the fold asserts the tabs, policy bar, matrix header and
   first row only (all well inside), and the roles summary is allowed below the fold, as card 5 was on Providers.
   This needs the same user decision as Gate V 28.
3. **Compact the narrow layout further:** for example status as a dot only, with the label as a tooltip/sr-only, and
   the provider on the same line as the version. This saves ≈18 px per stacked row, but carries less information.

## Files

- CREATED `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts`
- CREATED `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.spec.ts`
- CREATED `libs/frontend/chat/src/lib/settings/ptah-ai/cli-model-effort-popover.component.ts`
- CREATED `libs/frontend/chat/src/lib/settings/ptah-ai/cli-model-effort-popover.component.spec.ts`
- CREATED `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-cli-matrix.entries.ts`
- MODIFIED `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts`
- MODIFIED `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts`
- MODIFIED `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-visual.e2e.spec.ts`
- MODIFIED (visual round 1) `libs/frontend/ui/src/lib/native/autocomplete/native-autocomplete.component.ts`
- MODIFIED (visual round 1) `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-search-field.component.ts`
- MODIFIED (visual round 1) `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-search-field.component.spec.ts`
- CREATED `.ptah/specs/TASK_2026_555/batch-30-report.md` (this file)
