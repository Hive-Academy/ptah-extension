# Electron visual review 3 — TASK_2026_593

## Summary

| Metric | Result |
| --- | --- |
| Verdict | **REJECTED** |
| Score | **6/10** |
| Findings | 1 visual breaking; 0 serious; 0 moderate; 0 minor |
| Capture | 22/22 PNGs, 0 script errors; Electron 1440×900 dark/light and 800×900 dark/light |

The live routed permission now carries its session and workspace context, and the panel style changes match the approved prototype. The score exceeds the 5/10 band because the routed request, both themes, Clear all, and 800 px captures now work. It does not reach 7/10 because the three-card stack covers a substantial part of the Stats pane. Under the visual-review severity definition, overlapping content is visual breaking, so the verdict is REJECTED.

## Environment and source of expectations

`NX_DAEMON=false npx nx build ptah-electron --parallel=1` completed successfully, then `node apps/ptah-electron/scripts/copy-renderer.js` copied the fresh webview build into the Electron renderer. `node .ptah/specs/TASK_2026_593_7c2e/visual-check/shoot-populated.cjs` launched that Electron entry (`dist/apps/ptah-electron/main.mjs`) and captured the states. There was no standalone URL; the surface was the built Electron renderer. The capture result is [`visual-check/capture-results-2.json`](visual-check/capture-results-2.json).

The comparison target is the approved [`prototype/screenshots/`](prototype/screenshots/) set, especially `dark-panel.png`, `light-panel.png`, `dark-800.png`, `light-800.png`, and the snackbar shots. The viewport and theme scope came from the task's Electron visual-run instruction. The panel uses `surface-3` and DaisyUI classes in `libs/frontend/notification-center/src/lib/notification-center.component.ts:38-42`; the snackbar uses `surface-3` in `notification-snackbar.component.ts:31-35`.

## Requested checks

**(a) Live permission, the main proof — pass.** In [`dark-panel-permission-live.png`](visual-check/dark-panel-permission-live.png) and [`light-panel-permission-live.png`](visual-check/light-panel-permission-live.png), the actual `permission:request` row reads `Permission: Bash`, `Attention capture · Tool: Bash`, then **`workspace`**. It does not say `Unknown workspace`. `Allow`, `Deny`, and **`Show in canvas` are enabled**. The script routed the request to the canvas tab before capture (see the `live permission` shot notes in `capture-results-2.json`). The earlier projected, null-target rows still say `Unknown workspace` and have disabled `Show in canvas`; those are fixture-limited states, visible in [`dark-panel.png`](visual-check/dark-panel.png) and [`light-panel.png`](visual-check/light-panel.png), not the live proof.

**(b) Light theme — pass.** All 11 light PNGs exist and visibly show light chrome, panel, cards, and canvas. [`light-snackbar-permission.png`](visual-check/light-snackbar-permission.png), [`light-panel-permission-live.png`](visual-check/light-panel-permission-live.png), and [`light-800.png`](visual-check/light-800.png) provide direct evidence. The capture JSON reports light card background `oklch(0.919214 0.00614 54.5612)` and opacity 1. This is a visual/theme check, not a measured text contrast audit.

**(c) Panel style — pass.** Needs you rows use a neutral `border-base-300` border while the request icons stay orange (`libs/frontend/notification-center/src/lib/notification-center.component.ts:65-74`). In [`dark-panel.png`](visual-check/dark-panel.png) and [`light-panel.png`](visual-check/light-panel.png), `NEEDS YOU` and `RECENT NOTICES` are uppercase and their counts sit at the right edge, as in the approved panel prototype. The light neutral border is subtle but present.

**(d) Clear all, empty state, 800 px — pass within captured states.** [`dark-panel.png`](visual-check/dark-panel.png) shows Needs you 5 and Recent notices 1; [`dark-panel-clear-all.png`](visual-check/dark-panel-clear-all.png) shows Needs you 5 and Recent notices 0 after Clear all. [`dark-panel-empty.png`](visual-check/dark-panel-empty.png) and [`light-panel-empty.png`](visual-check/light-panel-empty.png) show `All clear` and `Nothing needs your attention` after resolving requests. [`dark-800.png`](visual-check/dark-800.png) and [`light-800.png`](visual-check/light-800.png) show the 800×900 layout without horizontal escape or cropped snackbar. The light panel already had Recent notices 0 when opened, so its Clear all image demonstrates that Needs you persists, but not a light-theme Recent removal.

## Shot table

All links below are 1440×900 except the 800 rows, which are 800×900. Each linked file was opened and compared with the corresponding approved prototype state where one exists.

| State | Dark capture | Light capture | Observation |
| --- | --- | --- | --- |
| Permission snackbar | [PNG](visual-check/dark-snackbar-permission.png) | [PNG](visual-check/light-snackbar-permission.png) | Null-target projection; disabled navigation |
| Question snackbar | [PNG](visual-check/dark-snackbar-question.png) | [PNG](visual-check/light-snackbar-question.png) | Visible and themed |
| Lane snackbar | [PNG](visual-check/dark-snackbar-lane.png) | [PNG](visual-check/light-snackbar-lane.png) | Visible and themed; no live lane agent |
| Failure snackbar | [PNG](visual-check/dark-snackbar-failure.png) | [PNG](visual-check/light-snackbar-failure.png) | Voice failure and `Switch to local` action |
| Three-card stack | [PNG](visual-check/dark-snackbar-stack.png) | [PNG](visual-check/light-snackbar-stack.png) | Three cards plus `+3 more`; Stats pane overlap |
| Bell badge | [PNG](visual-check/dark-bell-badge.png) | [PNG](visual-check/light-bell-badge.png) | Five attention items |
| Populated panel | [PNG](visual-check/dark-panel.png) | [PNG](visual-check/light-panel.png) | Neutral rows, uppercase headers, right counts |
| Clear all | [PNG](visual-check/dark-panel-clear-all.png) | [PNG](visual-check/light-panel-clear-all.png) | Needs you retained; dark Recent cleared |
| Empty panel | [PNG](visual-check/dark-panel-empty.png) | [PNG](visual-check/light-panel-empty.png) | All clear message |
| Narrow layout | [PNG](visual-check/dark-800.png) | [PNG](visual-check/light-800.png) | 800×900, snackbar fits window |
| Live permission panel | [PNG](visual-check/dark-panel-permission-live.png) | [PNG](visual-check/light-panel-permission-live.png) | Session and workspace context; active actions |

## Finding

### Visual breaking — snackbar stack obscures the Stats pane

- **Evidence:** [`dark-snackbar-stack.png`](visual-check/dark-snackbar-stack.png) and [`light-snackbar-stack.png`](visual-check/light-snackbar-stack.png), 1440×900. The three cards occupy roughly x=1076–1424 and y=65–426, covering the Stats pane's Session and Agents sections. The approved [`prototype/screenshots/dark-snackbar-stack.png`](prototype/screenshots/dark-snackbar-stack.png) places the stack at the upper right over an otherwise clear board.
- **Cause:** `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:20` fixes the host to the window's right edge (`right: 1rem`), regardless of the Electron shell's Stats pane. The 800 px rule at line 25 only changes the right margin.
- **Impact:** Users cannot see or interact with the covered Stats content while several attention items are present. The `+3 more` control appears below the stack but does not recover the obscured pane.
- **Fix direction:** Anchor the snackbar to the canvas region or reserve enough space for it in the shell at wide widths; retain the 800 px fit. Verify the stack in a populated session with the Stats pane open.

## Limits, cleanup, and script changes

The projected permission/question/lane cards use `target: null`; their disabled navigation is expected for those fixture rows. The raw lane event has no live agent, and the script records that limitation. The git status warning was not captured because no routed git-status warning source was found. The failed-turn stand-in was a real `voice:providerError` because this new canvas tab had no backend Claude failed turn. These limits are recorded in `capture-results-2.json` and do not weaken the live permission proof.

No script locator failed. **No changes were made to `shoot-populated.cjs` in run 3**, and no app code was edited. The script reported `portFreeAfter: true` and `tempRemoved: true`; a separate final `netstat -ano | findstr 9347` and `%TEMP%/ptah-attention-populated-*` directory check returned no entries. Port 9347 is free and no matching temp directory remains.

## Three best result PNGs

1. `D:/projects/ptah-extension/.claude-worktrees/attention-context-label/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel-permission-live.png`
2. `D:/projects/ptah-extension/.claude-worktrees/attention-context-label/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel-permission-live.png`
3. `D:/projects/ptah-extension/.claude-worktrees/attention-context-label/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-stack.png`

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Classify the Stats overlap as visual breaking and reject | The visual-review severity definition includes overlapping elements; both stack PNGs show covered Session/Agents content. Calling it serious would understate the blocked pane. | Yes |
| Treat null-target disabled actions as fixture-limited | The script projects `target: null`, while both live permission PNGs show enabled actions with proper context. Filing a product defect from the projected state would contradict the routed request evidence. | Yes |
| Keep light Clear all coverage limited | `light-panel.png` already shows Recent 0, while dark before/after PNGs prove removal. | Yes |
