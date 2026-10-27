# Visual Review Rev 3 - chat-layout-declutter (PR #829), re-check after fixes

**Verdict (updated by the 800px section below): REJECTED on one extreme combination** (split view + Git dock at max width in an 800px window). Score 7/10.
B2 below is WITHDRAWN: it was found at a 400px viewport, which cannot occur (main window `minWidth: 800`). See `## Realistic narrow layouts (800px window)`.
B1 (nav covering the sheet title row), S1 (Git-rail clipping), M1 and M2 are fixed. One defect remains at exactly 400px:
the overlay sheet and the rail still extend to x=432, past the 400px window.

## Method and environment
- Same as rev 2: Electron dev build (rebuilt) over CDP :9334, Playwright `connectOverCDP`, scripts in `D:/tmp/rev2` (outside the repo),
  viewports by `Emulation.setDeviceMetricsOverride` (1600x950, 900x800, 400x800; audit sample). Themes `anubis` and `anubis-light`.
- Sessions: existing "Reply with the word OK." (error, no lanes) plus one empty session `rev3-review-tmp` that I created and closed.
- Restored: theme `nord` (value at start), viewport override cleared (855x738 as found), sidebar collapsed to the 56px rail as found.

## Checks
| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Split view, expanded sidebar at 1600px: title row and controls visible and clickable | PASS. Sidebar is `aside[role=dialog][aria-label="Session details"]`, `position:absolute`, x1118..1552, y56..942 (below the nav, left of the Git rail). Title and controls visible. View toggle, Close, Compact session details hit-test as themselves. A real mouse click on "Compact session details" inside the dialog collapses it to the 56px rail. Hand off hit-tests to a `SPAN` inside its disabled wrapper (disabled button, not an overlap) | split-expanded-dark.png, split-expanded-light.png |
| 2 | 900px overlay: title row visible, no Git-rail clipping | PASS. Sheet x464..852, y56..792, absolute; no descendant overflows its right edge; Tokens tile and "No todos..." line are fully visible; Git rail sits to the right of the sheet | w900-overlay-expanded-dark.png, w900-overlay-expanded-light.png |
| 3 | 400px sheet: title row and close visible | FAIL (partial), see B2. Title row, view toggle and Close are visible and not covered. The sheet is x48..432, so `Close session details` (x396..424) is almost entirely off-screen (only ~4px visible) and the Tokens tile and todo text are cut at 400 | w400-sheet-dark.png, w400-sheet-light.png |
| 4 | 400px after close: rail and expand fully inside; composer toolbar no overlap | Composer toolbar PASS (wraps to two rows, 0 overlapping buttons). Rail FAIL, see B2: rail x376..432, "Expand session details" x381..428, ~19px inside the window | w400-after-close-dark.png, w400-after-close-light.png |
| 5 | Focus after closing the 400px sheet | PASS. `Expand session details` (focus ring itself is clipped, B2) | w400-after-close-*.png |
| 6 | Split floating `...` menu | PASS (M1 fixed). Menu 144x117, items 127x32 each, single line, no scroll overflow (`w-max min-w-36 whitespace-nowrap`) | split-floating-menu-open-dark.png, split-floating-menu-open-light.png |
| 7 | Rail `...` menu | PASS (M2 fixed). `position:fixed`, x1346..1490, 6px gap left of the rail (rail left 1496), not clipped; Esc closes and returns focus to the trigger | wide-rail-menu-open-dark.png, wide-rail-menu-open-light.png, wide-rail-dark.png, wide-rail-light.png |
| 8 | Wide 1600px expanded layout, no regression | PASS. Docked aside x1118..1552, y56, 434x886 and control group coordinates identical to rev 2 (controls at x1420/1452/1484/1516, y64); no separate icon row; no `...` | wide-expanded-dark.png, wide-expanded-light.png |
| 9 | Focus after Close pane | PASS. Focus = `button[aria-label="Switch to compact view"]` in the sidebar `Session controls` group (not body) | split-after-close-pane-light.png |
| 10 | Floating group on hover (regression) | PASS, visible on hover in both themes | split-compact-hover-right-pane-dark.png, split-compact-hover-right-pane-light.png |

## Remaining defects
**B2 (Visual breaking, at 400px only) Sheet and rail extend past the 400px window.**
Elements: `[role=dialog][aria-label="Session details"]` (x48..432) and `aside[aria-label="Session details"]` rail (x376..432).
At a 400px window the dialog's `Close session details` button is x396..424 (about 4px on-screen), and the sheet's right ~32px is cut.
After closing, the rail's "Expand session details" is x381..428 with about 19px on-screen and its focus ring is cut. A real click on the 4px sliver does close
the sheet, so it is recoverable but not usable. The composer toolbar wrapping and the title row fixes work. Likely cause: the stack of workspace rail (48) +
sessions rail (56) + chat floor + detail rail (56) is wider than 400px; `min-w-[min(400px,calc(100vw-6rem))]` is valid CSS (verified in the built stylesheet) but the
sessions rail and workspace rail are not reduced, so the row still overflows by 32px. Fix: also shrink or hide the sessions rail below ~440px, or cap the chat floor
at `100vw - 9rem` so the rail ends at x<=400, and size the sheet `right-0` relative to the viewport.

**M3 (Moderate, unchanged, out of scope) Hand off is disabled** for the errored session with no visible reason.

## Not checked
- Stop button, long-title wrap, avatar stack with `+N`, lane detail table (no running or lane data; no messages sent).
- Keyboard Tab traversal (Playwright `Tab` does not advance focus in this Electron window); focus rings verified earlier by programmatic focus.
- Sizes between 400 and 900px other than those listed.

## Realistic narrow layouts (800px window)

Window-bounds API is not available in this Electron CDP (`Browser.getWindowForTarget` / `setWindowBounds` are not found, on both the page and the browser session),
so the 800x600 window is emulated with `Emulation.setDeviceMetricsOverride` at exactly 800x600, which gives the same CSS layout as a real 800x600 window.
Git dock opened via "Toggle Git panel" and dragged left to its cap (separator x=433, so the Git panel is about 313px wide and the board 48..432).
Sessions rail: the Git-max state keeps it at 56px; its "Expand rail" button is inert there (click does nothing, even with a real mouse click), so
"sessions expanded" could not be forced at Git-max. With the Git dock closed it is expanded (320px) automatically. Details sidebar tested compact and expanded.

| # | Layout (800x600, Git dock max unless noted) | Result | Evidence |
|---|---|---|---|
| 1a | Single session, sessions rail, details compact rail | PASS. Chat column x112..368 (256px, so below 400). Details rail x376..432 and "Expand session details" x381..428 fully inside; Git panel starts at 433. Composer x124..356, toolbar wrapped, 0 overlapping buttons, 0 buttons outside the composer; no horizontal scroll | w800-git-max-sessions-collapsed-rail-dark.png, w800-git-max-sessions-collapsed-rail-light.png |
| 1b | Same, details expanded | PASS. Board is below 400px so the compact sheet is used: `[role=dialog][aria-label="Session details"]` absolute x48..432, y56..592. Title row visible; view toggle x300, Close x364, "Close session details" x396..424, none covered, nothing overflows the sheet. Tokens tile and todo text fully visible. Closing it with a real click returns focus to "Expand session details" | w800-git-max-sessions-collapsed-details-expanded-dark.png, w800-git-max-sessions-collapsed-details-expanded-light.png |
| 1c | Overlay tier (board 400..560) | Not reachable at 800px with Git max: board is 256px. Overlay tier already verified at 900px in the previous section | - |
| 2a | Split (Open beside), details compact rail | FAIL, see W1. Panes stack top/bottom but each is x112..472 wide while the board ends at 368 | w800-split-git-max-details-rail-dark.png, w800-split-git-max-details-rail-light.png |
| 2b | Split, details expanded sheet | PASS for the sheet (x48..432, controls visible, not covered, nothing overflowing); panes behind it are still the oversized ones from W1 | w800-split-git-max-details-sheet-dark.png, w800-split-git-max-details-sheet-light.png |
| 2c | Split with the Git dock closed (800x600, Sessions rail auto-expanded to 320px) | PASS. Panes x328..688, details rail x696..752; floating controls (x588 view toggle, x652 close) are not covered; composers 340..676 with no overlap | w800-split-git-closed-details-rail-dark.png, w800-split-git-closed-details-rail-light.png |

### Defects found at 800px
**W1 (Visual breaking, extreme combination: split view + Git dock at max width in the minimum 800px window).** The split panes have a floor of about 360px
(x112..472) but the board there is only 256px (112..368). The panes extend underneath the details rail (x376..432) and the Git dock (starts x433); a
horizontal scrollbar appears at the bottom of the chat area; composers are cut off ("Ask the orchestrator to plan, build or r"), and the pane floating control
groups (view toggle at x372..400, Close at x436..464) are covered by the rail and the Git dock, so they are not reachable without scrolling the board
(`elementFromPoint` reports COVERED for both panes). Elements: `section[aria-label^="Top session"]`, `section[aria-label^="Bottom session"]`, their floating
`absolute right-2 top-2` control groups. Fix options: limit the Git dock max so the board stays at least about one pane floor (about 360px plus both rails) when split is on,
or auto-close the split or switch to a single pane below that width, or make the floating group `sticky` to the visible edge of the board scroll area.
Screenshots: w800-split-git-max-details-rail-dark.png, w800-split-git-max-details-rail-light.png.

**M4 (Moderate) The Sessions rail "Expand rail" button is inert at 800px with Git dock at max**, with no visible feedback (it expands automatically once the Git dock is closed).
This is probably the intended auto-collapse for narrow boards but gives no hint; consider disabling the button or showing a tooltip.

### Updated verdict
Everything outside W1 passes at the realistic minimum width: single-session rail and compact sheet fit entirely inside the board (no clipping, no overlap) in both themes, and
the composer toolbar wraps without overlap. Rev-2 defects B1, S1, M1, M2 stay fixed. Because W1 is a cut-off/overflow case, by the severity rules the verdict is
**REJECTED** until W1 is addressed; if the team considers split view with the Git dock at its cap an unsupported combination, the remaining state is APPROVE with M3 and M4.
Not checked: Git dock at intermediate widths (board 400..560 overlay tier at 800px), lane detail table, Stop.

State restored after this section: theme `nord`, viewport override cleared (855x738), Git dock closed (as found), sidebar rail 56px, `ptah.sessionSidebarWidth=282` and
`ptah.inspector-dock-width.v1=434` unchanged (no Git dock width key was written), temp session `w800-review-tmp` closed.
