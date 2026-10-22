# Electron visual review — run 5

**Verdict: REVISE — 5/10.** Desktop snackbar placement fixes the blocked composer and Git text from run 4. At 800×900, the fixed bottom-right card again covers the composer. The lower rail session card also misses the requested More disclosure. This is above the 3–4 band because the desktop and queue/bell states are usable, and below 7–8 because an active input is obscured in a captured viewport and the visible rail actions differ from the decision.

## Build and evidence

`npx nx build ptah-extension-webview --parallel=1` exited 0. `node apps/ptah-electron/scripts/copy-renderer.js` then copied the current build; `dist/apps/ptah-electron/renderer/main.js` was refreshed on 2026-10-21. The existing `dist/apps/ptah-electron/main.mjs` was present. The single `shoot-populated.cjs` run exited 0 with 24/24 successful shots, zero errors, `portFreeAfter=true`, and `tempRemoved=true` in `visual-check/capture-results-2.json`; an independent listener check found port 9347 free. All 24 PNGs were opened via four contact sheets, with the four decisive PNGs also inspected at original resolution. The approved comparison is `rail-redesign/prototype/screenshots/full.png`; the user's later bottom-right and compact-card decisions govern snackbar placement and size.

Key absolute evidence paths:

- Dark rail: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-rail-needs-you.png`
- Light rail: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-rail-needs-you.png`
- Dark snackbar single / stack: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-permission.png`; `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-stack.png`
- Light snackbar single / stack: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-permission.png`; `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-stack.png`

## Run-4 defects and user decisions

| Item | Status |
| --- | --- |
| Desktop snackbar blocks composer | **Fixed at 1440×900.** Card is at approximately x=1104–1424; composer ends near x=1028. [Dark single](../visual-check/dark-snackbar-permission.png), [light single](../visual-check/light-snackbar-permission.png). |
| Two-card stack obscures Git heading/branch | **Fixed for Git text.** Stack spans roughly x=1104–1424, y=738–884, covering about **320×146 px** of the lower Git/Stats panel, but the heading and branch above y≈690 remain visible. A single card covers about **320×70 px** of its lower blank area. [Dark stack](../visual-check/dark-snackbar-stack.png), [light stack](../visual-check/light-snackbar-stack.png). |
| Compact size and balance | **Fixed in captured desktop states.** Cards are ~320×70 px, with icon/kind/title/close on row one, metadata left and action right on row two. Dark and light text is readable. `notification-snackbar.component.ts:35-67`. |
| Bottom-right placement and card limits | **Partly met.** Host uses `right: 1rem; bottom: 1rem; width: min(20rem, …)` at `notification-snackbar.component.ts:20`. Two desktop cards and one 800 px card appear, per `:97-105`. Desktop composer is clear; the 800 px composer overlap is finding 1. |
| `+N more` inside stack and opens bell | **Placement met in captured stack.** `+4 more` sits above the cards within their flex container, around x=1375, y=720, and does not cross Todos text. Source wires it to `openNotifications.emit()` at `notification-snackbar.component.ts:28-34`; click outcome was not exercised. |
| Permission action hierarchy everywhere | **Partly met.** Queue and live bell show one filled Allow, Deny, More on one row. The lower rail session card still shows Show in canvas instead of More; see finding 2. |
| Command preview | The live rail and bell show `Input: git status · Description: Run git status`; `notification-snackbar.component.ts:51` will show `permissionPreview` when supplied. The synthetic snackbar projection has no preview, so its row-two fallback reads `Workspace unavailable`; actual live snackbar preview is unverified. |

## Findings

1. **Visual breaking — 800 px snackbar covers the composer.** In [dark 800](../visual-check/dark-800.png) and [light 800](../visual-check/light-800.png), the single card occupies about x=464–784, y=814–884. The composer occupies about x=320–724, y=727–861, so the card covers roughly **260×47 px** of its right side, including toolbar controls. The bottom-right host rule at `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:20` has no narrow-layout accommodation for the composer. This violates the explicit “never over the composer” decision in both themes.
2. **Serious — lower rail session card omits More and exposes Show in canvas directly.** In [dark rail](../visual-check/dark-rail-needs-you.png) and [light rail](../visual-check/light-rail-needs-you.png), the top Needs you queue card shows Allow, Deny, More, while the lower framed session card shows Allow, Deny, Show in canvas. Its Needs you block remains inside the frame, kind precedes the title, and there is no floating round badge. The lower card's independent action loop at `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:177-187` renders `open` directly and has no More trigger or inline disclosure. The shared implementation at `libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:15-35` provides the requested queue/bell behavior.

## Shot table

Each row gives the absolute screenshot path.

| Screenshot (absolute path = directory above + filename) | Theme | Viewport | Result | Note |
| --- | --- | --- | --- | --- |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-permission.png` | dark | 1440×900 | Pass | Single ~70 px card at bottom-right; composer clear. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-question.png` | dark | 1440×900 | Pass | Two-row card; action and close visible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-lane.png` | dark | 1440×900 | Pass | Action right aligned, no composer overlap. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-failure.png` | dark | 1440×900 | Pass | Failure action and text legible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-stack.png` | dark | 1440×900 | Pass | Two cards, +4 above them; Git text clear, lower panel covered ~320×146 px. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-bell-badge.png` | dark | 1440×900 | Pass | Bell count visible; same stack placement. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel.png` | dark | 1440×900 | Pass | Item titles and Needs you cards visible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel-clear-all.png` | dark | 1440×900 | Pass | Pending items retained after clear. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel-empty.png` | dark | 1440×900 | Pass | All clear feedback visible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-800.png` | dark | 800×900 | Fail | One card overlaps composer ~260×47 px. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-rail-needs-you.png` | dark | 1440×900 | Fail | Queue correct; lower session card lacks More. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel-permission-live.png` | dark | 1440×900 | Pass | Live bell title, Allow/Deny/More and preview visible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-permission.png` | light | 1440×900 | Pass | Single ~70 px card at bottom-right; composer clear. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-question.png` | light | 1440×900 | Pass | Two-row card; action and close visible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-lane.png` | light | 1440×900 | Pass | Action right aligned, no composer overlap. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-failure.png` | light | 1440×900 | Pass | Failure action and text legible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-stack.png` | light | 1440×900 | Pass | Two cards, +4 above them; Git text clear, lower panel covered ~320×146 px. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-bell-badge.png` | light | 1440×900 | Pass | Bell count visible; same stack placement. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel.png` | light | 1440×900 | Pass | Item titles and Needs you cards visible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel-clear-all.png` | light | 1440×900 | Pass | Pending items retained after clear. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel-empty.png` | light | 1440×900 | Pass | All clear feedback visible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-800.png` | light | 800×900 | Fail | One card overlaps composer ~260×47 px. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-rail-needs-you.png` | light | 1440×900 | Fail | Queue correct; lower session card lacks More. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel-permission-live.png` | light | 1440×900 | Pass | Live bell title, Allow/Deny/More and preview visible. |

## Limitations

The capture covers Electron dark/light at 1440×900 and 800×900. It does not cover ~400 px, another browser, keyboard focus, opening the More disclosure, submitting a permission response, or measured color contrast. The snackbar stack uses synthetic projections; the rail and live bell use a real permission request. Still screenshots do not establish animation or layout-shift behavior. No application source was edited.

## Decisions

- **Decision:** Treat the 800 px composer overlap as a blocking defect despite the user's bottom-right corner placement. **Options:** accept the fixed corner at every width, or preserve an uncovered composer. **Evidence:** paired 800 px screenshots and `notification-snackbar.component.ts:20`. **Reversible:** yes.
- **Decision:** Apply the visible-actions instruction to both queue and session card. **Options:** accept the lower card's direct Show in canvas, or require its More disclosure. **Evidence:** paired rail shots, independent lower-card action loop at `canvas-rail-card.component.ts:177-187`, and the user's “everywhere” instruction. **Reversible:** yes.
