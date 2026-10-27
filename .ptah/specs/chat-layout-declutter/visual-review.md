# Visual Review - chat-layout-declutter

**Verdict: PASS WITH ISSUES** (Electron only, live app at CDP :9334, real dev session "there a session i started on our dev instance that...").

Method: Playwright over CDP, `page.setViewportSize` (Electron rejects `Browser.setWindowBounds`, so sizes are viewport emulation), themes `anubis` (dark) and `anubis-light` (light) via `data-theme`. Original theme `night` restored. Read-only interactions only (expand/compact, hover, click a lane avatar, Tab). Build confirmed: renderer served from the worktree `dist/apps/ptah-electron/renderer`. Viewports are an audit sample (1800x1000, 900x800, 560x800, 400x800), not a support contract.

Screenshots in `.ptah/specs/chat-layout-declutter/screenshots/after/`:

| File | Shows | Issues |
| --- | --- | --- |
| 01-wide-expanded-{dark,light}.png | 1800px, sidebar expanded: thin header (title + compact + close), sidebar identity (title, idle, Hand off), strip, Session tiles, Active subagents, Plan limits, Lanes, Todos, Git. Composer 1100px wide, centred in chat column | D1, D2, D6 |
| 02-wide-compact-{dark,light}.png | Sidebar compact: 56px rail (Ctx/Tok/Cost/Run), strip under header with "12 agents ›", header has `...` menu | D3, D5 |
| 02b-rail-focus-{dark,light}.png | Keyboard focus on rail tile: 2px solid gold ring, clear | none |
| 03-lane-selected-{dark,light}.png | CLI lane selected: chat shows `Details ›` and green Resume ▶ only; no CONTEXT/TOKENS/COST bar in chat | D4 |
| 04-narrow900-{dark,light}.png | 900px: sidebar ~450px, chat pane ~360px | D7 |
| 04-narrow560-{dark,light}.png | 560px | none seen (no horizontal scroll) |
| 04-narrow400-{dark,light}.png | 400px window, sidebar expanded | D8 |
| 05-unknown-usage-lanes-{dark,light}.png | Plan limits "Usage / Unavailable", Lanes rows with `—`, "Known subtotal —" | D2 |

## Passes
- Strip rendered exactly once in every state (sidebar OR under header, never both).
- Header is thin; title/status moved into sidebar "Session details" when expanded.
- No "? Limit unknown" or "0 tokens known" text; unknowns are `—` / "Usage unavailable".
- Chat-area lane view has no stats bar (Details + Resume only). Sidebar lane card keeps CONTEXT/TOKENS/COST chips, which matches the spec (sidebar, not chat).
- Rail is 47px wide tiles in a ~56px column, 40px tall; keyboard focus ring visible in both themes.
- Transcript (156..1260) and composer (161..1260) align at the 1100px column when the sidebar is open; composer 350..1450 when compact.
- No horizontal overflow at 900 and 560; contrast of sidebar body text 5.5 to 8.8:1 (11-12px) in both themes.

## Defects
1. **D1 (Moderate)** Sidebar strip is truncated to 3 avatars plus a bare "12": no "N agents ›" label or affordance, no orchestrator-to-lanes overflow hint (01-wide-expanded-*). Likely `agent-lane-stats` / strip component in `libs/frontend/chat-ui/.../agent-lane-stats`. Spec says "N agents ›".
2. **D2 (Serious)** Data inconsistency: lane card in the sidebar (03-lane-selected-dark) reads "Completed: 20 input, 7921 output, $1.1586", yet Lanes rows show `—`, Known subtotal `—`, Session Cost `—`. "Restored · completed" rows are collapsed with no hint of the known usage. Quiet-unknown logic hides known values. Likely `plan-limits/lane-tiles.ts`, `lane-usage-tile.component.ts`, `inspector-session-stats.component.ts`.
3. **D3 (Moderate)** Compact-sidebar welcome screen: tagline "Ancient Wisdom • Master Craftsman" is half-clipped under the strip/header edge at 1000px height (02-wide-compact-dark/light). Welcome content wrapper has no top padding after the strip is added. Not seen when sidebar expanded.
4. **D4 (Minor)** Hover popover on lane avatar (antigravity) overlays the Session tiles and covers the Tokens tile; it is transient but wide and has no pointer-safe delay (03-lane-selected-dark).
5. **D5 (Moderate)** Rail only shows Ctx/Tok/Cost/Run here; no Time/Todo tiles for this session (spec lists six). Confirm tiles are intentionally hidden when empty. Rail labels are 10px (02-wide-compact-dark): small but contrast is fine.
6. **D6 (Moderate)** "Hand off" label sits as a loose 11px text line between the title and strip with no icon/button styling, misaligned left (x=1340) vs the title (x=1347) (01-wide-expanded-*). It is an action; style as a ghost button. Also the sidebar header `idle` is pinned top-right, not baseline-aligned with the title.
7. **D7 (Serious)** At 900px the expanded sidebar takes ~50% and leaves a ~360px chat pane: composer toolbar icons overlap ("Default (recommended)" collides with the attach/YOLO icons, branch name truncated) (04-narrow900-dark). Sidebar should auto-compact below roughly 1100px, or the composer toolbar should wrap.
8. **D8 (Serious)** At 400px window the expanded sidebar covers the entire chat; its right edge is clipped (title "idle" cut, "Active subagents" count and "3 lanes - 11 runs" clipped) because the shell enforces `min-w-[400px]` while the sidebar plus rail exceed it (04-narrow400-light). Elements overflow the viewport (app shell DIV.min-w-[400px]). Sidebar should become an overlay with max-width 100% or default to compact.
9. **D9 (Moderate, pre-existing area)** Light theme "Review changes" link contrast 1.97:1 (12px) fails WCAG AA 4.5:1 (01-wide-expanded-light). Git panel in the sidebar; dark is 8.8:1.
10. **D10 (Minor)** Light theme: workspace-rail tabs show white tile artifacts to the right of each numbered tab (01/02-*-light, x~62-88). Probably pre-existing.

## Not verified
- Real 400px chat pane inside a wider window (split panes) was not reproduced; only whole-window 400px.
- Time/Todo rail tiles and Resume eligibility states beyond the one session; the dev data had no running agents or todos.
- Before/after pixel compare against 1-5.png was visual only (header 1.png thinned and strip moved as specified).
