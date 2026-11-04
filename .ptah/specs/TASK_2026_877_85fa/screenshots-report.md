# Ptah v2 screenshot report

| Shot | Captured | What it shows | Problems |
| --- | --- | --- | --- |
| `v2-thoth-memory.png` | Yes | Electron Thoth Memory page with three fake memories and the memory stats cards. Visually inspected: populated, legible, no error screen. | The memory status reads “Checking…”; this PNG predates this lane. |
| `v2-voice-stage.png` | No | Intended Command Center voice stage. | Prior run timed out clicking Voice. Replaced the click with the `command-center` view event after canvas initialization; Playwright worker spawn was blocked before this could be tested. |
| `v2-session-rail.png` | No | Intended three session tiles. | Prior run found fewer than three `canvas-tile` elements. The selector exists in `canvas-rail-board.component.ts`; session seeding and layout remain unresolved. |
| `v2-apps.png` | No | Intended Apps page with a Revenue surface. | Prior tab click timed out. Replaced navigation with the `apps` view event after canvas initialization. A Revenue surface still needs a valid conversation and surface update fixture. |
| `v2-attention-bell.png` | No | Intended notification panel with a pending permission. | Added a fake `permission:request` event with a future deadline; worker spawn blocked validation. |
| `v2-display-panel.png` | No | Intended Display sheet with a Revenue artifact. | Prior run could not find `display-sheet`; no artifact fixture was established. |

## Commands and results

- `npx playwright test --config=docs-screenshots.config.ts --grep "Voice stage"` in `apps/ptah-electron-e2e`: **failed before test execution** with `Error: spawn EPERM` at Playwright `WorkerHost.startRunner`.
- `npm run verify -- -t lint,typecheck -p ptah-electron-e2e`: **failed** because Nx default and ESLint/Jest plugins could not spawn (`EPERM`).
- `ptah_get_diagnostics` for the changed spec: **0 errors, 0 warnings**.
- PNG inspection: `v2-thoth-memory.png` exists (1,400,278 bytes) and shows a populated Electron memory page. No other `v2-*.png` files exist.

## Files changed

- `apps/ptah-electron-e2e/src/docs-screenshots/v2-surfaces.shot.ts`: view event navigation for Voice and Apps; pending permission fixture for the attention bell.
- `.ptah/specs/TASK_2026_877_85fa/screenshots-report.md`: this report.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Navigate Voice and Apps by their routed view names after initializing canvas. | Title bar click; `switchView` event. | `app.routes.ts` defines `command-center` and `apps`; `UiDriver.goto` already uses `switchView` and canvas initialization. | Yes. |
| Seed the bell through the normal permission renderer event. | Direct UI manipulation; `permission:request` event. | Existing Electron e2e streaming test uses that event and payload structure; notification center labels permission items “Permission required”. | Yes. |
| Leave unverified tests active for a runner that can spawn workers. | Skip them; leave active. | This sandbox stops before any test body, so their current behavior cannot be determined. Skipping would hide the missing captures. | Yes. |

## Unmet requirements

Five new PNGs were not captured or visually checked. A runner with child process spawn permission must execute the five direct Playwright cases individually. The rail, Apps Revenue surface, and Display artifact fixtures still need implementation after those runs expose their actual state. The requested lint and typecheck gate could not run in this sandbox.
