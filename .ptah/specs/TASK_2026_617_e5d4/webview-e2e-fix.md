# Webview E2E fix — PR #665 (TASK_2026_617, Grok CLI lane)

Worktree `D:\projects\ptah-extension\.claude-worktrees\task-617-grok-acp`, base HEAD 04a75511c. Nothing committed.

## Shared root cause

Batch 8 added an **installed** Grok entry to the shared settings fixture:
`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts:161`
(`{ cli: 'grok', installed: true, version: '1.0.46', messagingMode: 'queue' }`).
Grok is not in the fixture's `preferredAgentOrder` (`settings.fixtures.ts:171`), so `byPreferredOrder`
(`libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.ts:384-415`) ranks it after every ranked id. That is
intended behaviour. The orderable set grows from 5 (codex, antigravity, glm-instance-1, copilot, opencode) to 6. A
move writes the whole order (`agent-orchestration-config.component.ts:339-349`), so it now ends in `'grok'`. Several
specs still hard-coded the 5-agent set.

No product bug: the UI writes the correct whole order. Only the test expectations were stale.

## Failure 1 — order popover (`settings-orchestration.e2e.spec.ts:270`)

- **Cause:** `settings-orchestration.e2e.spec.ts:282` expected
  `preferredAgentOrder: ['antigravity','codex','glm-instance-1','copilot','opencode']`. `expectCall`
  (`settings-drawer.reach.ts:152-156`) uses `toContainEqual`, which needs an exact match. The real write is
  `[..., 'opencode', 'grok']`, so the poll ran out after about 5 s. That is the ~8 s failure, and it repeated on retry.
- **Fix:** add `'grok'` to the expected whole order (line 282). The Undo expectation (`['codex','antigravity','glm-instance-1','copilot']`)
  is the stored previous order, so it does not change.

## Failure 2 — reachability (`settings-reachability.e2e.spec.ts:79`, both hosts, 10.4 min)

- **Cause:** entry `#73` in `settings-reachability.table.ts:556` had the same stale 5-agent expectation, so `#73` threw.
  The backstop in the `finally` block only recovers a stuck **wizard** (`settings-reachability.e2e.spec.ts:94-111`). It
  does not close the order popover or the toast that `#73` left open. The remaining entries then use up their 10 s
  action timeouts and 5 s expect timeouts against that state, and the test hits its 600 s `test.setTimeout`.
  - Reproduced: with only the `:556` expectation put back, the electron run timed out at **10m03s**
    ("Test timeout of 600000ms exceeded"). This matches the CI behaviour that breaks the 20-minute job.
  - The step-by-step timeout cascade after `#73` is inferred from the recovery code; I did not trace it per step.
- **Fix:** add `'grok'` to the `#73` expectation (`settings-reachability.table.ts:556`). The capability count, the
  64 frozen baseline ids and the guard rules are unchanged. Grok needs no new capability row: it is a system CLI row
  that uses the existing matrix cells.

## Further regression found in the settings folder run (not in the CI log, because the job timed out first)

`settings-visual.e2e.spec.ts` was asserting the same 5-agent set:

| Location                                                                                                                                | Was | Now     |
| --------------------------------------------------------------------------------------------------------------------------------------- | --- | ------- |
| `settings-visual.e2e.spec.ts:504` and `:795` — `assertOrderStripWhole(..., total)` (the strip and the Edit button name the whole order) | 5   | **6**   |
| `settings-visual.e2e.spec.ts:362` — Orchestration fold reference set                                                                    | 5+2 | **6+2** |

With these changes all vscode cases and the `live-shaped values` cases pass. **2 tests still fail**:
`baseline smoke — Orchestration order strip, fold, roles and order popover (electron, anubis | anubis-light)`
(`settings-visual.e2e.spec.ts:501`). The enforced Electron fold budget fails:

```
B36 fold orchestration electron/anubis: ... roles summary 689 (budget 660); reference set 6+2 ... grok:43
Error: rolesSummary bottom  Expected: <= 660  Received: 689
```

The sixth installed row (43 px on Electron) pushes the background-roles summary 29 px below the 660 px fold that Batch 36b
set as the ratchet (`ORCHESTRATION_ELECTRON_ROLES_FOLD_ENFORCED = true`, `:316`). On VS Code it still fits (627 px).
This is a real layout result. I did **not** weaken the gate. It needs a decision:

1. **(Recommended)** A product layout change that fits a 6-installed set on Electron, for example a tighter policy bar or
   matrix header on Electron, or no more than N rows above the roles summary. Frontend scope, outside this fix.
2. Keep Grok **uninstalled** in the shared fixture. This restores the 5-installed reference set, but the uninstalled count
   goes from 2 to 3 (`settings-cli-matrix.entries.ts:484-485`, `settings-visual.e2e.spec.ts:362`), and the fixture no
   longer matches the intended installed Grok row from Batch 8.
3. Change the fold budget or turn off Electron roles-summary enforcement. This weakens an assertion, so it was not done.

## Files changed

- `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-orchestration.e2e.spec.ts` (:282)
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts` (:556)
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-visual.e2e.spec.ts` (:362, :504, :795)

No product code changed.

## Local runs (webview bundle built with `npx nx build ptah-extension-webview`; specs run as `npx playwright test --config libs/frontend/webview-e2e-harness/playwright.config.ts ... --workers=2`)

| Run                                                                                           | Result                                                                                       | Wall time |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------- |
| `settings-orchestration.e2e.spec.ts -g "order popover"` (vscode and electron)                 | 2 passed                                                                                     | 3.3 s     |
| `settings-reachability.e2e.spec.ts -g "every present"` (vscode and electron)                  | 2 passed (1.4 m / 1.6 m)                                                                     | 1m38s     |
| Repro: reachability on electron with the old `:556` expectation                               | 1 failed, test timeout 600 s                                                                 | 10m03s    |
| Settings folder, first pass (only failures 1 and 2 fixed)                                     | 116 passed, 8 failed (visual :501 and :754, 4 each), 2 skipped                               | 3m01s     |
| **Settings folder, final**                                                                    | **122 passed, 2 failed (visual :501 electron × 2 themes, the fold budget above), 2 skipped** | **2m56s** |
| `npx nx run-many -t typecheck,lint -p webview-e2e-harness chat`                               | Successfully ran typecheck, lint for 2 projects                                              | —         |
| `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1` | exit 0, TOTAL 294 unsuppressed sites, every lib at or under its baseline                     | —         |

The settings folder now finishes in about 3 minutes instead of hitting the 10-minute reachability timeout, so the CI job
should get back under its 20-minute limit. It will still be red on the two Electron fold cases until one of the options
above is chosen.

## Compact layout (option 1: the user chose to change the layout so the Electron roles summary fits at 1024x768)

The three test-file changes above are kept: the order arrays include `'grok'`, the reference set is 6+2, and the order-strip total is 6. The fold budget (660 px) is unchanged, and Grok stays installed in the fixture.

### Change

There is one file, `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts`. Every new rule sits inside the existing narrow container query `@container (max-width: 47.99rem)`. That query applies to Electron's page beside the shell sidebar; VS Code at 1024 px is the wide layout and does not change.

| Where                                                                                                              | Before                                                          | After                                                             |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| `:223` thead `<tr>` gets the class `cli-head`; `:955-957` `.cli-head > th { padding-block }` (narrow only)         | daisyUI `table-xs` cells: 0.25rem (4 px) above and below        | 0.125rem (2 px)                                                   |
| `:274` each matrix row `<tr>` gets the class `cli-row`; `:955-957` `.cli-row > td { padding-block }` (narrow only) | 0.25rem (4 px) above and below                                  | 0.125rem (2 px)                                                   |
| `:352` the instance sub-line gets the class `cli-instance-subline`; `:959-961` `flex-wrap: nowrap` (narrow only)   | `flex-wrap`: "Key set" and "3 tier models" wrapped onto 2 lines | one line (both badges are still visible and stay inside the cell) |

Nothing is hidden. Controls, labels, badges and focus rings are unchanged. The controls keep their sizes: the On box is 18 px, and the h-6 buttons and popover triggers are 24 px. Only the empty padding around cells shrank, so the 24x24 px hit targets (WCAG 2.5.8) still hold. No component, token or class was added beyond the three hooks above. The component stays standalone with OnPush, and no logic changed.

### Measured (B36 fold log, 1024x768, both themes identical)

| Host     | Roles summary bottom before | After                               | Budget | Row heights after                               |
| -------- | --------------------------- | ----------------------------------- | ------ | ----------------------------------------------- |
| Electron | 689 px (failed)             | **643 px**                          | 660    | 39 px each, Glm 55 (before: 43 px each, Glm 77) |
| VS Code  | 627 px                      | **627 px** (unchanged, wide layout) | 660    | unchanged                                       |

Other Electron values: the matrix header bottom went from 266 to 262 and the first row bottom from 309 to 301. The policy bar stays at 165.

### 400 px narrow check (temporary measuring spec, deleted after use)

At 400 px the matrix already scrolls sideways inside its own `overflow-x-auto` wrapper, and this is not new. Without the nowrap rule the scroll is 282 px; with it, 284 px. The Glm sub-line has no overflow (`scrollWidth - clientWidth = 0`), and both badges sit inside the agent cell. Rows are 39 px with Glm at 55 px; Glm was 73 px when the badges wrapped. The image is saved as `visual/compact/after-matrix-{electron,vscode}-anubis-400w.png`.

### Screenshots (`.ptah/specs/TASK_2026_617_e5d4/visual/compact/`)

- `before-orchestration-{vscode,electron}-{anubis,anubis-light}-1024x768.png`: 4 files
- `after-orchestration-{vscode,electron}-{anubis,anubis-light}-1024x768.png`: 4 files
- `after-matrix-{vscode,electron}-anubis-400w.png`: 2 files

### Results

| Run                                                                                                                                                                                                       | Result                                                | Wall time |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------- |
| `settings-visual.e2e.spec.ts -g "Orchestration order strip"` (2 hosts x 2 themes)                                                                                                                         | 4 passed                                              | 6.9 s     |
| **Settings scenario folder, both hosts** (`npx playwright test --config libs/frontend/webview-e2e-harness/playwright.config.ts libs/frontend/webview-e2e-harness/src/lib/scenarios/settings --workers=2`) | **124 passed, 0 failed, 2 skipped**                   | **3m20s** |
| `npx nx run-many -t typecheck,test,lint -p chat webview-e2e-harness`                                                                                                                                      | Successfully ran typecheck, test, lint for 2 projects | —         |
| `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1`                                                                                                             | exit 0, TOTAL 294 unsuppressed sites (unchanged)      | —         |

During the session, `dist/apps/ptah-extension-webview` was briefly missing once. Another process was probably rebuilding it. After a rebuild, every run above used the current bundle.

### Tracked files changed outside my edit scope (not reverted, as the coordinator asked)

The visual specs overwrote 144 tracked screenshots under `.ptah/specs/TASK_2026_555/screenshots/angular/`, all named `current-*-1024x768.png`:

- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-mcp-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-mcp-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-mcp-localhost-confirm-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-mcp-localhost-confirm-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-mcp-localhost-confirm-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-mcp-localhost-confirm-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-mcp-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-mcp-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-output-style-drawer-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-output-style-drawer-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-output-style-drawer-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-output-style-drawer-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-output-style-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-output-style-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-output-style-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-output-style-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-system-prompt-drawer-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-system-prompt-drawer-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-system-prompt-drawer-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-system-prompt-drawer-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-vscode-lm-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-vscode-lm-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-vscode-lm-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-advanced-vscode-lm-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-claude-cli-credentials-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-claude-cli-credentials-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-claude-cli-credentials-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-claude-cli-credentials-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-moonshot-credentials-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-moonshot-credentials-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-moonshot-credentials-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-moonshot-credentials-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-moonshot-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-moonshot-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-moonshot-models-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-moonshot-models-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-moonshot-models-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-moonshot-models-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-moonshot-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-moonshot-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-sovereigneg-advanced-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-sovereigneg-advanced-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-sovereigneg-advanced-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-sovereigneg-advanced-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-sovereigneg-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-sovereigneg-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-sovereigneg-models-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-sovereigneg-models-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-sovereigneg-models-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-sovereigneg-models-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-sovereigneg-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-drawer-sovereigneg-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-go-vet-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-go-vet-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-live-orchestration-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-live-orchestration-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-live-orchestration-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-live-orchestration-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-live-providers-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-live-providers-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-live-providers-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-live-providers-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-main-agent-model-search-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-main-agent-model-search-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-main-agent-model-search-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-main-agent-model-search-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-main-agent-popover-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-main-agent-popover-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-main-agent-popover-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-main-agent-popover-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-main-agent-save-to-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-main-agent-save-to-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-main-agent-save-to-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-main-agent-save-to-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-modal-add-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-modal-add-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-modal-add-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-modal-add-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-modal-tiers-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-modal-tiers-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-modal-tiers-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-modal-tiers-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-order-popover-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-order-popover-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-order-popover-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-order-popover-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-copilot-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-copilot-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-copilot-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-copilot-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-cursor-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-cursor-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-cursor-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-cursor-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-effort-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-effort-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-effort-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-effort-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-model-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-model-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-model-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-model-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-permission-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-permission-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-permission-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-popover-permission-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-role-popover-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-role-popover-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-role-popover-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-role-popover-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-roles-open-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-roles-open-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-roles-open-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-roles-open-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-orchestration-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-provider-catalog-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-provider-catalog-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-provider-catalog-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-provider-catalog-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-providers-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-providers-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-providers-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-providers-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-scope-popover-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-scope-popover-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-scope-popover-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-scope-popover-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-search-voice-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-search-voice-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-search-voice-vscode-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-search-voice-vscode-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-voice-drawer-elevenlabs-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-voice-drawer-elevenlabs-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-voice-drawer-local-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-voice-drawer-local-electron-anubis-light-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-voice-drawer-local-tts-electron-anubis-1024x768.png`
- `.ptah/specs/TASK_2026_555/screenshots/angular/current-voice-drawer-local-tts-electron-anubis-light-1024x768.png`
