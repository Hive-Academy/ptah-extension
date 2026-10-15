# B6 detail-row spike

**Option (b): non-Gridstack sibling overlay.** The provisional grid hunks are retained. No detail Gridstack node is created.

## Gate result

**Jest gate: GO (provisional). Overall gate: pending manual check.** The focused jsdom spec passed (1 test, 1 suite). It mounts six tiles in three rows, captures all six engine `{id,x,y,w,h}` records, opens the second-row detail with the grid locked, checks the sibling host and lower-row classes, forces an authoritative apply pass, then closes the detail. Geometry stays equal to the captured snapshot throughout. The existing grid suite also passed (75 tests, 1 suite).

The plan's final GO criterion includes a check in a running Electron webview. The user or visual reviewer still needs to confirm that the panel top aligns with the clicked row's bottom within 8 px, rows below remain visible and hit-testable below the panel, and Gridstack scroll height grows by the panel height. No Electron instance was started here. A failure in that check makes this a NO-GO and selects option (c), the fixed bottom panel; the provisional grid hunks would then need removal before B7.

## Gridstack behavior relevant to BL

- `node_modules/gridstack/dist/gridstack.js:621-673`: `load(items, addRemove)` removes nodes absent from `items` only when `addRemove` is truthy. This component calls `grid.load(positioned, false)`, so that call does **not** remove an unrelated detail node if one were added. That corrects the earlier plan's removal claim and reinforces using no detail node.
- `node_modules/gridstack/dist/gridstack.js:675-704`: `load()` filters matching engine nodes out of the active list, then re-adds their existing objects while applying each supplied position. This is why the forced apply pass is covered by the spike.
- `node_modules/gridstack/dist/gridstack-engine.js:448-453`: `locked: true` skips a node during non-floating top-gravity packing. At `:935-938`, `moveNode` has its lock guard commented out, so `locked` is not a blanket prohibition on programmatic movement. The grid's separate `locked` input sets static mode through `canvas-workspace-grid.component.ts`.
