# Batch 32b report: tier field shows the saved model ID

Executor: frontend-developer, Orchestration owner (in-process subagent). Date: 2026-10-02. Base: HEAD `b4c512eb3`
(Batch 32). Track A worktree only. Nothing is staged or committed.

- I did not use `git stash`, restore, checkout, reset or clean.
- Before the visual run I copied every `current-*` capture (84 files) to `%TEMP%\b32b-shots-backup`. Afterwards I
  copied back every capture except the 12 this batch owns.

## 1. Fix (orchestrator decision: shared field, compact mode)

**Defect:** when a saved model ID is missing from the provider's catalogue, the host pins it as
`{id, name: 'saved, not in the current list'}`. The closed compact field showed that `name` instead of the ID. This hit
all three Glm tiers in `CliTierMappingModalComponent` and the Batch 30 `cli-model-effort-popover`.

**Fix:** in `ProviderModelSearchFieldComponent`, `selectedLabel` now returns `compactLabel(option)` when `compact()` is
true, so the closed field matches the compact rows:
- a catalogue entry shows its ID;
- the `''` sentinel (and the pinned action row) keep their label;
- an ID with no matching option still falls back to the raw ID (unchanged).

Non-compact behaviour is unchanged (`option.name`). That covers the full picker and the Main Agent popover
(`main-agent-reassign-popover` does not set `compact`).

The open list is unchanged in both modes. Compact rows still show the ID in mono with the hint
"saved, not in the current list" after it. `placeholder() ?? selectedLabel()` now also shows the ID in compact mode when
a host passes no placeholder. Both compact hosts pass one, so nothing visible changes there.

Consumers checked:
- `cli-tier-mapping-modal` (compact): the closed field now shows `glm-5.3:cloud`.
- `cli-model-effort-popover` (compact): the closed field shows the model ID. Its capture is taken with the list open,
  so the image is unchanged.
- `main-agent-reassign-popover` (not compact): unchanged.
- No chat spec asserted the closed label, so no chat spec needed changing. I added one assertion to the tier modal
  spec.

## 2. Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\frontend\ui\src\lib\native\provider-model-picker\provider-model-search-field.component.ts`
  (`selectedLabel` uses `compactLabel` when compact; 313 lines)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\frontend\ui\src\lib\native\provider-model-picker\provider-model-search-field.component.spec.ts`
  (+1 test: a closed compact field shows the saved ID, a catalogue ID and the sentinel label; a non-compact field still
  shows the name)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\frontend\chat\src\lib\settings\providers\cli-tier-mapping-modal.component.spec.ts`
  (+1 test: the closed tier fields read `glm-5.3`, `glm-old` (not in the catalogue) and "Inherited: provider default")
- 12 captures (section 5)
- CREATED this report

## 3. Verification

| Command | Result |
| --- | --- |
| `npx jest -c libs/frontend/ui/jest.config.ts libs/frontend/ui/src/lib/native/provider-model-picker --maxWorkers=2` | 2 suites, 95/95 |
| `npx jest -c libs/frontend/chat/jest.config.ts …cli-tier-mapping-modal… …cli-model-effort-popover… …main-agent-reassign-popover… --maxWorkers=2` | 3 suites, 55/55 |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview` | Successfully ran typecheck, lint for 5 projects |
| `npx nx run-many -t test -p (same 5) -- --maxWorkers=2` | 4 projects have a `test` target (the harness has none). chat **2179 passed + 2 skipped** (131 suites; +1). ui **624/624** (31 suites; +1). core 1109/1109 (cache hit, no source change). webview 224/224. |
| `npx nx build ptah-extension-webview --skip-nx-cache` | Success, no budget error. Initial total **3.48 MB** (unchanged; the 2.5 MB warning is pre-existing). `cli-orchestration-matrix-component` lazy chunk 68.87 kB raw / 15.79 kB transfer. |

## 4. Gate G (reachability, `--reporter=list --workers=2 --repeat-each=3`, cwd `libs\frontend\webview-e2e-harness`)

- **Run 1: 25 passed, 2 failed.** Both failures were on the vscode host, repeat 2, while CPU was at 100% from other
  sessions' node processes. I measured this with `Win32_Processor.LoadPercentage` = 100 during the run.
  1. `reachability (vscode) › every present/restored capability is reachable`, entry **#56 Success/error commit
     feedback**: `Test timeout of 180000ms exceeded`, then `locator.count: Target page, context or browser has been
     closed` at `settings-reachability.e2e.spec.ts:89:67`. The vscode pass took 3.0 m against 1.8-2.2 m for the
     electron passes. The test budget ran out; no assertion failed.
  2. `reachability (vscode) › kept selectors survive`: `TimeoutError: page.goto: Timeout 15000ms exceeded` at
     `settings.fixtures.ts:672` (`bootSettings`). This is a boot timeout.

  Suspected cause: CPU starvation (this matches a known pre-existing flake). Neither path touches the model search
  field: #56 is commit feedback, and the second failure happened before the page loaded.
- **Run 2 (`--repeat-each=3`): 27/27 passed (6.2 m).**

## 5. Captures re-taken

Spec run: `npx playwright test --config=playwright.config.ts src/lib/scenarios/settings/settings-visual.e2e.spec.ts --reporter=list --workers=2`.

- The first run gave 2/4. Both dark-theme tests (`(vscode, anubis)`, `(electron, anubis)`) hit the 30 s test timeout
  at `settings-visual.e2e.spec.ts:297` (`routing-map` visible) under the same 100% CPU. The failure screenshot shows the
  routing map rendered, so the budget ran out; nothing was missing.
- I re-ran those two with `--grep "anubis\)" --workers=1`: 2/2 passed.

Kept (this batch's), all in `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\.ptah\specs\TASK_2026_555\screenshots\angular\`:

- `current-orchestration-modal-tiers-vscode-anubis-1024x768.png`
- `current-orchestration-modal-tiers-vscode-anubis-light-1024x768.png`
- `current-orchestration-modal-tiers-electron-anubis-1024x768.png`
- `current-orchestration-modal-tiers-electron-anubis-light-1024x768.png`
- `current-orchestration-popover-model-vscode-anubis-1024x768.png`
- `current-orchestration-popover-model-vscode-anubis-light-1024x768.png`
- `current-orchestration-popover-model-electron-anubis-1024x768.png`
- `current-orchestration-popover-model-electron-anubis-light-1024x768.png`
- `current-orchestration-popover-effort-vscode-anubis-1024x768.png`
- `current-orchestration-popover-effort-vscode-anubis-light-1024x768.png`
- `current-orchestration-popover-effort-electron-anubis-1024x768.png`
- `current-orchestration-popover-effort-electron-anubis-light-1024x768.png`

What they show:
- **Tiers:** the Sonnet, Opus and Haiku fields now read `glm-5.3:cloud` (before: "saved, not in the current list").
- **Model and effort popovers:** captured with the list open or with the effort grid, so the images match Batch 32
  apart from anti-aliasing bytes. Git may report some of them as byte-identical (unmodified).

I restored every other `current-*` file from the backup (see section 6 for the `git status` check).

## 6. Deviations

- None in the code.
- Gate G and the visual run each needed a diagnosed re-run because of CPU load from other sessions (sections 4 and 5).
- `git status -- .ptah/specs/TASK_2026_555/screenshots/angular` after the restore (84 `current-*` files present) shows
  **8 modified, all owned by this batch**:
  - the 4 `current-orchestration-modal-tiers-*` (the actual fix);
  - `current-orchestration-popover-model-{electron-anubis, electron-anubis-light, vscode-anubis-light}` and
    `current-orchestration-popover-effort-electron-anubis-light` (anti-aliasing bytes only; the list is open in the
    capture).

  The other 4 popover captures came out byte-identical. No non-batch `current-*` and no `baseline-*` file is modified.
