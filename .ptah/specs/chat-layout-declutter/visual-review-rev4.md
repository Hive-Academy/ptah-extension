# Visual review rev4 - chat layout declutter (PR #829, head 90aa82ea8)

Verdict: PASS WITH NOTES (Electron only; dist built from this worktree, driven over CDP 9334).

Method: Playwright over CDP. `Browser.getWindowForTarget` is unsupported in this Electron build, so widths were set with
`Emulation.setDeviceMetricsOverride` (cleared at the end) instead of window bounds. Themes `anubis` / `anubis-light` were applied by
setting `data-theme` on `<html>`; the stored `ptah-theme` was `dark` (not `nord`) and was left untouched, `data-theme` restored to `dark`.
Git dock opened for the 800px check and closed again. No messages sent, no session stopped, closed or handed off.

## Screenshots (rev4/, all under .ptah/specs/chat-layout-declutter/screenshots/rev4/)

| File | Theme | Width | Shows |
| --- | --- | --- | --- |
| dark-1600-card-menu.png | anubis | 1600 | Card "Session actions" menu: Open beside (disabled), Rename, Move up/down, Switch to compact view, Hand off session to..., Close session (no Stop: session is done) |
| dark-1600-sidebar-expanded.png | anubis | 1600 | B+ sidebar: SESSION Context / Tokens / Cost, AGENTS list, Orchestrator row expanded into dock |
| light-1600-sidebar-lane-selected.png | anubis-light | 1600 | Lane row "claude" selected, dock with Context, In/out, Duration, Open thread |
| dark-1600-sidebar-collapsed-rail.png | anubis | 1600 | Collapsed 56px rail (Ctx, Tok, Cost, Time) |
| dark-900-handoff-picker.png | anubis | 900 | Hand off picker (error state "Couldn't load messaging bindings." + Retry) beside the menu |
| light-800-sidebar-overlay-open.png | anubis-light | 800 | Overlay sidebar (300px) inside board, truncation visible |
| dark-800-git-dock-open.png / light-800-git-dock-max.png | both | 800 | Git dock open: board 384px, so details become compact sheet inside board |
| light-1600-card-menu.png | anubis-light | 1600 | Menu open in light; whole app paints blank behind it (finding 1) |
| light-1600-card-menu-kbd.png | anubis-light | 1600 | Keyboard open (Enter, ArrowDown): 2px focus ring on Rename |
| dark/light-{900,800}-base, -card-menu-kbd, -handoff-picker | both | 900/800 | Same sweep at narrower widths (sidebar auto rail 56px) |
| dark/light-{900,800}-sidebar-overlay-open, -sidebar-rail | both | 900/800 | Overlay open and rail states |
| dark-1600-sidebar-lane-selected, light-1600-sidebar-expanded, light-1600-sidebar-collapsed-rail, light-1600-base, dark-1600-base | | 1600 | Remaining combos |
| dark-800-git-dock-max.png, light-800-git-dock-compact-sheet.png | | 800 | Git dock states |

## Verified
- Card menu items match spec (Switch view, Hand off, Close; Stop absent because session not running - Stop-while-running NOT verified).
- Right sidebar header has only the expand/collapse button; no session actions there.
- Keyboard: Enter opens, ArrowDown skips disabled "Open beside" and lands on Rename with a 2px outline + 5px offset ring (dark and light, 1600/900/800).
- B+ layout: totals row with vertical dividers, dotted-underline labels, no tiles, single AGENTS list, no hover card / "N agents" chip / ACTIVE SUBAGENTS.
- No layout shift: selecting the lane row moved the dock; rows above (Orchestrator y=413, header, totals y=154) unchanged; only rows below shift (in-place expand).
- Collapsed rail = 56px (measured 56). Overlay at 900 (363px, x 489-852) and 800 (300px, x 452-752) stays inside board (48-852 / 48-752); no horizontal scroll (scrollWidth == width at all widths).
- Board < 400px (Git dock at 800, board 384): details render as a compact sheet exactly filling the board box.
- Numbers: 706.7k, $0.87, 703.5k / 3.2k, 1m 53s, >=2.6k - formatted.
- Light contrast: body ink oklch .236 and muted oklch .49 on .978 (>7:1 and ~6:1); status green and +8/-0 use darker light-theme tokens.

## Findings
1. Light theme, any popover open: the whole app paints blank (cream) behind the menu/picker (light-1600-card-menu.png, light-1600-handoff-picker.png, repeatable with direct CDP capture; dark is fine). The `fixed inset-0 z-40` backdrop is transparent (rgba 0,0,0,0) so DOM is intact; may be a compositor artifact of switching `data-theme` by attribute rather than the settings UI. Severity: Serious if reproducible via the real theme picker, otherwise ignore. Needs human confirmation.
2. Truncated numbers/names in the AGENTS table at narrow overlay width 300px (light-800-sidebar-overlay-open.png): "Orchestr...", "703.5k / ...", lane cost "~$0....", LANES "C.." and "K" prefixes; also at 363px/1600 the lane cost "~$0...." is clipped (light-1600-sidebar-lane-selected.png). Severity: Moderate (information lost; add title/tooltip or wrap).
3. Mouse-opened menu in light: initial focus ring lands on the disabled "Open beside" row (light-1600-card-menu.png). Moderate; focus should start on first enabled item.
4. Tiny type: 9px "Restored · completed" lane select, 10px labels. Minor/Moderate.
5. "1 turns" pluralization in the SESSION meta line. Minor.
6. Hand off picker shows "Couldn't load messaging bindings." in this environment (backend state, not a layout issue); the picker layout itself is fine in dark. Info.
7. Known follow-ups seen/not blocking: light "Review changes" is gold rgb(212,175,55) on cream (low contrast); white artifacts beside workspace tabs not specifically examined; split-pane overflow not reproducible because no split exists.

## Could not check
- Pane actions menu (Swap panes / Close pane / Close split): no split exists and none was created (would change user state).
- Stop session item (session not running); "Show N more" (only 2 agents, never shown); compact sheet below 400px at other widths.
- Real window resize (Browser.getWindowForTarget unsupported) - emulated viewport used; DevTools is docked so real inner width was 1589.
- Original theme was `dark`, not `nord`; restored `data-theme=dark`.

## Rev5 (relaunched build, right "Session details" sidebar rework)

Verdict: PASS WITH NOTES. Screenshots: `.ptah/specs/chat-layout-declutter/screenshots/rev5/`. Session under test: "Branch" (Orchestrator + one CLI lane).
The relaunched app opened on Analytics; I switched to Chat for the capture and switched back to Analytics at the end.
`data-theme` and the stored `ptah-theme` were `dark` and are restored; the viewport override was cleared.

Verified
- SESSION rows align: Context | Tokens | Cost and Time | Model | Cache share the same column x positions (1066 / 1230 / 1384) and the same dividers; value text is 16px in both rows, labels 10.5px. Cache bar replaces the ring and is thin.
- AGENTS: columns Agent | Tokens | Cost | Status; no dock detail or "Open thread" link. Clicking the lane row moves the selected-row left border and loads the lane thread in the chat (`dark-1600-agent-row-clicked.png`). Clicking Orchestrator returned to the original thread.
- LANES: compact `#`, link and status icons, header `LANES ⓘ  1 · 1 run`, Σ subtotal row, lane card expands in place with a "Completed" chip, timestamp and "Unknown owner" button. The ⓘ and Σ buttons reveal a visible explanation line on mouse click (`dark-1600-lanes-sigma-open.png`).
- Focus ring: 2px outline on the ⓘ button (dark and light, `*-lanes-info-focused.png`).
- Contrast (light): same tokens as rev4 (muted oklch .49 on .978, ink .236); no new low-contrast pairs seen. Status "done" green is fine in dark; in light it is a darker token.

Findings
1. Serious (keyboard): pressing Enter or Space on the ⓘ "Lanes note" button does NOT open the explanation (aria-expanded stays false). Event log shows the keydown arrives with `defaultPrevented = true` before it reaches the document and the first listener that sees it prevented is the "Session details" aside, so no click is synthesized. Mouse click works (`dark-1600-lanes-note-open-click.png`). Same on the lane row and Context buttons (the lane row opened only because it was already expanded). The `(click)` handler in `inspector-limits-lanes.component.ts:58` is correct, so something above it swallows Enter/Space; I did not find the handler in the files I searched. The Σ and "Unknown owner" buttons were checked by click only, not by keyboard.
2. Moderate: truncation. Cache line "estimated · idle compaction…" is cut at 1600 and "estimated · idl…" at 800 (`light-800-overlay.png`). At the 800px overlay (300px) agent names and models clip: "Orch…", "Opus …", "CLI la…". Add a title tooltip or let the second line wrap. The "Completed" lane status touches the chevron in the lane header at every width.
3. Moderate: text size. Many labels are 9-10.5px (AGENTS header row, "Completed" chip, lane numbers); the 10.5px labels are the floor for the redesign. Not a WCAG failure but dense; keep the minimum at 10.5px or larger.
4. Minor: "Time" shows an em dash while the session is done (data state, not layout). The explanation line for the Σ and ⓘ can both be open at once, pushing the lanes down about 20px (expected).
5. Pre-existing, root-caused (light-theme blank app behind popovers, rev4 finding 1): reproduced again in `light-1600-card-menu.png`. The cause is in `apps/ptah-extension-webview/src/styles.css:2361-2365`: the rule `[class*='popover']:not(.popover-trigger)` (inside the anubis-light block) also matches the full-viewport `.ptah-popover-layer` and gives it an opaque `background-color: oklch(var(--b1))` and a border, overriding the component's `background: transparent` (`native-popover.component.ts:136`). The layer covers 1600x900, so the whole app disappears while any popover is open in light. Dark is unaffected (layer background is transparent). Not introduced by this PR (the files are unchanged against main), but it is a Serious user-visible bug. Fix: exclude `.ptah-popover-layer` in that selector (add `:not(.ptah-popover-layer)`).
   I did not switch themes through Settings: the DOM evidence above settles it, and a real theme switch rewrites stored settings.

Not checked
- The 800px width with the Git dock (not repeated this round), the pane actions menu, "Show N more", Stop while running, keyboard operation of Σ and "Unknown owner".
