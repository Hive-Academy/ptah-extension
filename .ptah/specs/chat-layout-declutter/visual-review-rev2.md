# Visual Review Rev 2 - chat-layout-declutter (PR #829)

**Verdict: REJECTED** (visual breaking 2, serious 2, moderate 3). Score 4/10.
The wide docked layout (title row, rail, split floating controls, focus handling) is correct. Every overlay-sheet
layout hides the new title-row controls behind the app top bar.

## Method and environment
- Electron dev build served from this worktree (`dist/apps/ptah-electron/renderer/index.html`, CDP :9334, Playwright
  `connectOverCDP`). Scripts lived in `D:/tmp/rev2` (outside the repo). Viewports via
  `Emulation.setDeviceMetricsOverride` (1600x950, 900x800, 400x800; an audit sample, not a support contract).
  Themes `anubis` (dark) and `anubis-light` (light) via `data-theme`.
- Data: one real session ("Reply with the word OK.", status error, no lanes). I created one empty session
  `rev2-review-tmp` for split view and closed it afterwards. No messages were sent.
- Restored: viewport override cleared (1376x970), theme restored to `nord` (the value found in `ptah-theme`, not
  `night`), sidebar re-expanded, temp session closed.

## Checks
| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Wide expanded: no icon row; title left; right: view toggle, Hand off icon, Close, collapse ("Compact session details"); status under title; no `...` | PASS. Group at x1420..1544, y64, 28px buttons. Stop not testable (session not running); long-title wrap not testable (short title) | wide-expanded-dark.png, wide-expanded-light.png |
| 1b | Hand off icon | Disabled for this errored session (opacity 0.4, not focusable); about 2.3:1 in light (disabled, so exempt) | same |
| 2 | Compact rail 56px: tiles, avatar, `...` menu fixed and left of rail | PASS. Menu is `position:fixed`, x1431..1506, not clipped, opens left of the button but overlaps the rail edge by about 10px (rail left 1496). Esc closes and returns focus to trigger. Only the orchestrator avatar shown (no active agents, so stack and `+N` not shown). Menu holds only a disabled "Hand off" | wide-rail-dark.png, wide-rail-light.png, wide-rail-menu-open-dark.png, wide-rail-menu-open-light.png |
| 3a | Split: no header row; floating group top-right on hover/focus | PASS. Panes contain 0 headers; group `absolute right-2 top-2`, opacity 0 until pane hover/focus-within, then visible | split-compact-hover-right-pane-dark/light.png, split-compact-hover-left-pane-dark/light.png |
| 3b | Sidebar follows pane focus | PASS (rail/sidebar track the active pane "Reply with the word OK.") | split-compact-hover-right-pane-dark.png |
| 3c | Floating `...` > Close pane: focus | PASS. Focus = `button[aria-label="Switch to compact view"]` inside the sidebar `Session controls` group (not body) | split-after-close-pane-light.png |
| 3d | Split with expanded sidebar | FAIL, see B1 | split-expanded-dark.png, split-expanded-light.png |
| 4a | 900px overlay sidebar, no right-edge clipping | FAIL, see B1 and S1 | w900-expanded-dark/light.png (docked rail OK: w900-compact-rail-dark/light.png) |
| 4b | 400px compact sheet | FAIL, see B1 (`role=dialog aria-modal`; content itself is not clipped) | w400-sheet-dark.png, w400-sheet-light.png |
| 4c | After closing the sheet, focus on rail expand control | PASS (`Expand session details`), but the control is mostly off-screen, see B2 | w400-after-close-light.png |
| 5 | Lane detail table (arrow, 7rem status column) | NOT CHECKED: no session with lanes in the live data; I did not restore history sessions to avoid changing user data | - |
| - | Title-row icon buttons: contrast and focus | PASS. Icon vs background 14.9:1 dark (232,230,225 on 19,19,23), 15.9:1 light (41,19,52 on 250,247,245). Focus ring 2px solid in the icon colour, `:focus-visible` true, clearly visible. Targets 28x28 (AA minimum 24) | titlerow-focus-*-dark/light.png |

## Defects
**B1 (Visual breaking) Overlay-sheet title row is covered by the app top bar.**
Element: `aside[aria-label="Session details"]` with `[aria-label="Session controls"]`, and `[aria-label="Close session details"]`
(sheet class `fixed right-0 z-50 inset-y-0`). The sheet starts at y=0, so its title row (y 8..36) sits under the top nav.
`elementFromPoint` at 900px: view toggle hits Marketplace, Hand off hits Settings, Close hits Change theme. At 400px the modal's
`Close session details` (x364, y8) is covered too. Same in split view with an expanded sidebar at 1600px and in the 1376px window the
app was running in. Effect: title, status, view toggle, Hand off, Close and collapse are invisible and unclickable in every overlay layout; clicks
hit unrelated nav buttons; the 400px modal dialog has no visible close control. Fix: offset the sheet below the nav (top inset) or lift it above
the nav, then verify with `elementFromPoint`.
Screenshots: w900-expanded-dark.png, w900-expanded-light.png, w400-sheet-dark.png, w400-sheet-light.png, split-expanded-dark.png, split-expanded-light.png.

**B2 (Visual breaking) 400px rail clipped off the right edge.** With the sheet closed at 400px the rail `aside[aria-label="Session details"]`
is x376..432 and `Expand session details` is x381..428: about 19px is inside the viewport. The composer toolbar in the 300px chat pane also
collides ("Opu..." over the YOLO icon). Shell `min-w-[400px]` plus two 56px rails exceeds 400. Screenshot: w400-after-close-light.png.

**S1 (Serious) 900px sheet content clipped by the Git rail.** Sheet is x512..900 but the right "GIT" rail floats over its last ~48px: the Tokens tile
is cut and "No todos ... lists its plan her(e)" is truncated. Screenshot: w900-expanded-light.png. Fix: right padding equal to the Git rail width, or stack
the sheet above it.

**S2 (Serious) Expand control hit area at 400px** is mostly off-screen (part of B2); pointer users get a ~19px sliver.

**M1 (Moderate) Floating pane `...` menu is cramped.** `[role=menu]` is about 55px wide, so "Swap panes", "Close pane", "Close split" wrap to two lines in 32px
rows and the third is clipped. Needs `whitespace-nowrap` / `min-w-max`. Screenshot: split-floating-menu-open-light.png.

**M2 (Moderate) Rail `...` menu** overlaps the rail edge by about 10px (right 1506 vs rail left 1496) and contains only a disabled "Hand off".
Screenshots: wide-rail-menu-open-dark.png, wide-rail-menu-open-light.png.

**M3 (Moderate) Hand off disabled** shows no reason (no tooltip observed) in the title row or the menu.

## Not checked
- Stop button (needs a running session; no messages sent to a model).
- Long-title wrapping, multi-avatar stack and `+N`, needs-you badge: no such data.
- Lane detail table (check 5).
- Avatar hover popover. Keyboard Tab traversal (Playwright `Tab` did not advance focus in this Electron window); focus rings were verified by programmatic focus with keyboard modality set.
- Prototype comparison: not requested for this pass.
