# Electron visual review Ã¢â‚¬â€ run 3

**Verdict: REVISE Ã¢â‚¬â€ 4/10.** The refreshed renderer fixes the detached Needs you block, kind order, and floating permission badge. Two material behaviors still fail the approved design: permission cards lack one filled primary action, and snackbars obscure active UI. The score fits the 3Ã¢â‚¬â€œ4 band because these require another visual pass; it is above 1Ã¢â‚¬â€œ2 because the approved rail placement and lifecycle surfaces now render coherently, and below 5Ã¢â‚¬â€œ6 because a primary action and active content remain obscured.

## Evidence and scope

The orchestrator copied the fresh webview renderer before this run. No build was run here. The single authorized `shoot-populated.cjs` invocation exited 0 and recorded **24/24 shots, zero errors, `portFreeAfter=true`, `tempRemoved=true`** in `visual-check/capture-results-2.json`. An independent `Get-NetTCPConnection -LocalPort 9347 -State Listen` returned no listener. Electron is closed. All 24 PNGs below were opened. Reference: `rail-redesign/design-spec.md` and approved `rail-redesign/prototype/attention.html` with `prototype/screenshots/full.png`.

Required absolute evidence paths:

- Dark rail: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-rail-needs-you.png`
- Light rail: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-rail-needs-you.png`
- Best dark snackbar: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-stack.png`
- Best light snackbar: `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-stack.png`

## Prior defect status

| Defect | Run-3 status |
| --- | --- |
| Run 1 #1: no filled primary action in rail | **Partly fixed, still open.** The session card has one filled Allow in both rail shots, but the Needs you permission queue has five plain text actions and no filled Allow. The live bell row repeats this. `libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:16-26` gives all actions `btn-ghost`; `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:200-201` and `libs/frontend/notification-center/src/lib/notification-center.component.ts:56,84` use that shared control. |
| Run 1 #2: Needs you outside session card frame | **Fixed.** Both rail shots show the status, preview and actions inside the blue/teal framed session card through its bottom edge. |
| Run 1 #3: snackbar covers Stats | **Open.** Both stack shots at 1440Ãƒâ€”900 place three cards across Stats, covering Agents, Todos and Git, including the Git action. `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:20` fixes the stack to bottom/right with z-index 60 and no reserved region. |
| Run 2 new #1: round floating warning-triangle badge | **Fixed.** Neither theme's rail, bell, snackbar nor panel shots show it. The bell count remains in the header. |
| Run 2 new #2: session title before kind in queue | **Fixed.** The kind label precedes Ã¢â‚¬Å“Attention captureÃ¢â‚¬Â in both rail shots; source order is `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:194-199`. |

## Remaining and new defects

1. **Visual breaking Ã¢â‚¬â€ permission request lacks the approved filled primary action in the queue and bell.** In the [dark rail](../visual-check/dark-rail-needs-you.png), [light rail](../visual-check/light-rail-needs-you.png), [dark live bell](../visual-check/dark-panel-permission-live.png) and [light live bell](../visual-check/light-panel-permission-live.png), 1440Ãƒâ€”900, Allow, Always allow, Deny and Deny with message all look like plain text controls. This weakens the action hierarchy and differs from the approved prototype's single filled Allow. Source: `libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:16-26` hardcodes `btn-ghost` for every decision; rail uses it at `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:200-201`. The card's separate Allow is filled, so the request is inconsistent across surfaces.
2. **Visual breaking Ã¢â‚¬â€ snackbar stack still covers Stats at 1440Ãƒâ€”900.** The [dark stack](../visual-check/dark-snackbar-stack.png) and [light stack](../visual-check/light-snackbar-stack.png) start near y=364 and cover the Agents/Todos/Git area. A single [dark permission snackbar](../visual-check/dark-snackbar-permission.png) also covers Git. Stats text and actions cannot be viewed or clicked while the overlays are present. Source: `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:20` fixes 348 px cards at bottom 5rem/right 1rem, z-index 60, without avoiding Stats.
3. **Serious Ã¢â‚¬â€ at 800Ãƒâ€”900 the snackbar covers the message composer.** The [dark 800](../visual-check/dark-800.png) and [light 800](../visual-check/light-800.png) shots place the permission card over the composer from about x=437Ã¢â‚¬â€œ784 and y=677Ã¢â‚¬â€œ820, covering the prompt text/input area. The collapsed Stats pane no longer provides the desktop overlap described above, but the same fixed snackbar rule crosses a different active target. Source: `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:20`. At this width the visible rail is collapsed to its compact strip as designed; this finding concerns the overlay, not rail clipping.

## Screenshot review

Pass means no additional visible defect in the pictured state; it does not override defects cited above. Every path is absolute.

| Screenshot path | Theme | Viewport | Result | Note |
| --- | --- | --- | --- | --- |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-permission.png` | dark | 1440Ã—900 | Fail | Snackbar overlaps Stats; card content otherwise legible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-question.png` | dark | 1440Ã—900 | Fail | Snackbar overlaps Stats; card content otherwise legible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-lane.png` | dark | 1440Ã—900 | Fail | Snackbar overlaps Stats; card content otherwise legible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-failure.png` | dark | 1440Ã—900 | Fail | Snackbar overlaps Stats; card content otherwise legible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-snackbar-stack.png` | dark | 1440Ã—900 | Fail | Snackbar overlaps Stats; card content otherwise legible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-bell-badge.png` | dark | 1440Ã—900 | Fail | Snackbar overlaps Stats; card content otherwise legible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel.png` | dark | 1440Ã—900 | Pass | Pending rows and panel scroll contained. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel-clear-all.png` | dark | 1440Ã—900 | Pass | Recent cleared; pending rows retained. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel-empty.png` | dark | 1440Ã—900 | Pass | All clear state visible; no badge or overflow. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-800.png` | dark | 800Ã—900 | Fail | Single snackbar covers composer prompt/input region. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-rail-needs-you.png` | dark | 1440Ã—900 | Fail | Queue permission Allow lacks filled primary; card frame and kind order pass. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/dark-panel-permission-live.png` | dark | 1440Ã—900 | Fail | Live permission bell row lacks filled primary; preview and decisions visible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-permission.png` | light | 1440Ã—900 | Fail | Snackbar overlaps Stats; card content otherwise legible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-question.png` | light | 1440Ã—900 | Fail | Snackbar overlaps Stats; card content otherwise legible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-lane.png` | light | 1440Ã—900 | Fail | Snackbar overlaps Stats; card content otherwise legible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-failure.png` | light | 1440Ã—900 | Fail | Snackbar overlaps Stats; card content otherwise legible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-snackbar-stack.png` | light | 1440Ã—900 | Fail | Snackbar overlaps Stats; card content otherwise legible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-bell-badge.png` | light | 1440Ã—900 | Fail | Snackbar overlaps Stats; card content otherwise legible. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel.png` | light | 1440Ã—900 | Pass | Pending rows and panel scroll contained. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel-clear-all.png` | light | 1440Ã—900 | Pass | Recent cleared; pending rows retained. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel-empty.png` | light | 1440Ã—900 | Pass | All clear state visible; no badge or overflow. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-800.png` | light | 800Ã—900 | Fail | Single snackbar covers composer prompt/input region. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-rail-needs-you.png` | light | 1440Ã—900 | Fail | Queue permission Allow lacks filled primary; card frame and kind order pass. |
| `D:/projects/ptah-extension/.claude-worktrees/attention-rail-redesign/.ptah/specs/TASK_2026_593_7c2e/visual-check/light-panel-permission-live.png` | light | 1440Ã—900 | Fail | Live permission bell row lacks filled primary; preview and decisions visible. |

## Checks and limitations

- The live permission state appears in both rail shots and both live bell shots. Its tool input preview (Ã¢â‚¬Å“Input: git status Ã‚Â· Description: Run git statusÃ¢â‚¬Â) wraps inside the cards without clipping. Allow, Always allow, Deny and Deny with message are visible; their hierarchy defect is above. The shots do not include keyboard focus on those decision buttons, the expanded denial field, or a submitted response, so focus ring, field contrast and layout after expansion remain unverified.
- Dark and light ordinary card text and state icons appear legible in the opened images; no numerical resolved-color contrast measurement was captured. Disabled Ã¢â‚¬Å“Show in canvasÃ¢â‚¬Â looks muted in both themes; WCAG ratio is unverified. No screenshot shows a horizontal overflow or shifting card frame. Static captures cannot establish layout shift under interaction.
- Only 1440Ãƒâ€”900 and 800Ãƒâ€”900 were opened, matching this run's authorization. The approved prototype also depicts a narrow comparison, but this run did not capture Ã¢â€°Ë†400 px or other browsers. No viewport is claimed to pass outside the table.
- The built-in Ptah symbol index returned zero hits with unknown coverage when queried for the relevant components; source citations were checked directly in targeted ranges afterward. No application source was edited.

## Decisions

- **Decision:** Keep run-1 #1 open because the filled Allow exists only in the session card. **Options:** count the card as sufficient, or require the queue and bell to match the approved shared action hierarchy. **Evidence:** both rail and live bell shots; `design-spec.md:23,40-44`; shared ghost buttons at `attention-permission-actions.component.ts:16-26`. **Reversible:** yes.
- **Decision:** Treat 800 px composer occlusion as a separate impact of the snackbar placement rule. **Options:** merge it into the Stats finding or report it separately. **Evidence:** paired 800 px shots show the composer under the card while Stats is collapsed. **Reversible:** yes.