# Electron visual review - run 6

**Verdict: REVISE - 6/10.** The narrow snackbar is higher than in run 5 but still crosses the composer frame in both themes. The overlap is smaller and does not cover the prompt text or toolbar controls, so this scores above the prior 5/10; the explicit composer-clearance requirement still prevents a 7-8 sound verdict. No new defect beyond that remaining run-5 issue was found in the captured states.

## Build and capture evidence

`npx nx build ptah-extension-webview --parallel=1` exited 0. `node apps/ptah-electron/scripts/copy-renderer.js` then copied the built webview; `dist/apps/ptah-electron/renderer/main.js` has fresh 2026-10-21 01:43:49 UTC mtime. Existing `dist/apps/ptah-electron/main.mjs` was present. One `shoot-populated.cjs` run captured 24/24 PNGs with zero errors. Its result says `portFreeAfter=true` and `tempRemoved=true`; an independent listener check returned no process on port 9347. Electron was closed by the capture. All 24 PNGs were visually inspected through four contact sheets; the decisive 800, rail, desktop snackbar, and live bell shots were opened at original resolution. The approved rail prototype is `rail-redesign/prototype/screenshots/full.png`; later user decisions govern the compact bottom-right snackbar and the lower session card actions.

## Key absolute paths

- Dark rail: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-rail-needs-you.png`
- Light rail: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-rail-needs-you.png`
- Dark desktop snackbar single / stack: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-permission.png`; `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-stack.png`
- Light desktop snackbar single / stack: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-permission.png`; `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-stack.png`
- Dark narrow: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-800.png`
- Light narrow: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-800.png`

## Shot table

| Shot (absolute path) | Theme | Viewport | Result | Observation |
| --- | --- | --- | --- | --- |
| [dark-snackbar-permission](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-permission.png) | dark | 1440x900 | PASS | Bottom-right single card about 320x71; composer clear. |
| [dark-snackbar-question](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-question.png) | dark | 1440x900 | PASS | Compact question card; close and action visible. |
| [dark-snackbar-lane](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-lane.png) | dark | 1440x900 | PASS | Compact lane card; close and action visible. |
| [dark-snackbar-failure](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-failure.png) | dark | 1440x900 | PASS | Compact failure card; close and action visible. |
| [dark-snackbar-stack](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-stack.png) | dark | 1440x900 | PASS | Two cards; +4 more inside stack; Git text and composer clear. |
| [dark-bell-badge](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-bell-badge.png) | dark | 1440x900 | PASS | Bell count visible; no round floating rail badge. |
| [dark-panel](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel.png) | dark | 1440x900 | PASS | Item titles visible in populated list; scroll contained. |
| [dark-panel-clear-all](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel-clear-all.png) | dark | 1440x900 | PASS | Clear-all state visible, no clipping. |
| [dark-panel-empty](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel-empty.png) | dark | 1440x900 | PASS | Empty state legible and centered. |
| [dark-800](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-800.png) | dark | 800x900 | FAIL | Single card 320x71; overlaps composer top strip by about 260x21 px. |
| [dark-rail-needs-you](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-rail-needs-you.png) | dark | 1440x900 | PASS | Queue has one filled Allow, Deny, More; framed session chip retained. |
| [dark-panel-permission-live](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel-permission-live.png) | dark | 1440x900 | PASS | Item title visible; Allow, Deny, More fit one row. |
| [light-snackbar-permission](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-permission.png) | light | 1440x900 | PASS | Bottom-right single card about 320x71; composer clear. |
| [light-snackbar-question](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-question.png) | light | 1440x900 | PASS | Compact question card; close and action visible. |
| [light-snackbar-lane](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-lane.png) | light | 1440x900 | PASS | Compact lane card; close and action visible. |
| [light-snackbar-failure](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-failure.png) | light | 1440x900 | PASS | Compact failure card; close and action visible. |
| [light-snackbar-stack](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-stack.png) | light | 1440x900 | PASS | Two cards; +4 more inside stack; Git text and composer clear. |
| [light-bell-badge](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-bell-badge.png) | light | 1440x900 | PASS | Bell count visible; no round floating rail badge. |
| [light-panel](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel.png) | light | 1440x900 | PASS | Item titles visible in populated list; scroll contained. |
| [light-panel-clear-all](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel-clear-all.png) | light | 1440x900 | PASS | Clear-all state visible, no clipping. |
| [light-panel-empty](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel-empty.png) | light | 1440x900 | PASS | Empty state legible and centered. |
| [light-800](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-800.png) | light | 800x900 | FAIL | Single card 320x71; overlaps composer top strip by about 260x21 px. |
| [light-rail-needs-you](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-rail-needs-you.png) | light | 1440x900 | PASS | Queue has one filled Allow, Deny, More; framed session chip retained. |
| [light-panel-permission-live](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel-permission-live.png) | light | 1440x900 | PASS | Item title visible; Allow, Deny, More fit one row. |

## Run-5 defect status and requested checks

1. **Narrow snackbar / composer overlap: still open, reduced.** At 800x900, card bounds are approximately x=464-784, y=677-748. Composer frame begins around x=320-724, y=727; intersection is about **260x21 px** at the upper strip in [dark 800](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-800.png) and [light 800](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-800.png). The prompt area and toolbar are clear, but the card still paints over the composer frame. The narrow host offset is at `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:18`; fixed position and right offset are at line 20.
2. **Lower rail session card omits More: accepted by instruction.** This is intended: the lower framed Needs-you chip keeps Allow / Deny / Show in canvas, and the queue above contains the full permission set. Both [dark rail](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-rail-needs-you.png) and [light rail](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-rail-needs-you.png) show the required single filled primary and Allow / Deny / More in one queue row. No round floating badge appears.

At 1440x900, the snackbar is bottom-right (about x=1104-1424, bottom 16 px); its card is about 320x71 px. The row-one kind/title/close and row-two metadata/right action are balanced and legible in both themes. The two-card stack reaches about y=738-884, covering about 320x146 px of the lower Stats/Git panel, but not the Git heading or branch near y=650-690; composer overlap is 0 px. `+4 more` sits just above both cards within the stack. The live bell row retains the item title `Permission: Bash` and the queue uses one filled primary with Deny and More. No visible clipping or contrast failure was observed in these screenshots.

## Findings

1. **Serious - narrow snackbar still overlaps the composer frame.** At 800x900, both [dark](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-800.png) and [light](D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-800.png) show approximately **260x21 px** of overlap. The fixed `bottom: 9.5rem` chosen for a one-card narrow state at `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:18`, combined with the fixed host at line 20, places the card bottom at y?748 while this composer starts at y?727. The offset therefore does not meet the required zero composer overlap for the captured layout. This is the continuing run-5 finding, not a newly introduced defect.

## Limitations

The capture uses synthetic `attention:changed` projections for snackbar variety; a live permission request was also sent for queue and bell states. The snapshots do not exercise hover, keyboard focus, opening More, notification actions, or a real agent target; those outcomes and contrast ratios were not measured. Only Electron at 1440x900 and 800x900 was reviewed. No app source was changed.

## Decisions

- Treat the lower session card's direct Show in canvas as intended, per the run-6 instruction; the queue card above contains More. Reversible: yes.
- Mark the 800 px composer clearance as failed because the screenshot shows physical overlap with its frame, even though the input and controls remain usable. Evidence: paired 800 PNGs and snackbar source lines 18-20. Reversible: yes.
