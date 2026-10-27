# Code logic review — Revision 2, fix round 1

Review family: Glm (Ollama Cloud)
Implementer family: Claude

Inputs: `fix-round-rev2-1-report.md` (claims treated as unverified), `design-spec.md` `## Revision 2`,
the uncommitted diff vs `HEAD`, and the orchestrator cleanup made after the report.
Method: full reads of `canvas-focus-header.component.ts`, `canvas-inspector-dock.component.ts`,
`canvas-lane-tabs.component.ts`, `session-inspector.component.html`, `floating-ui.service.ts`,
`session-agent-roster.service.ts`; targeted diffs of `canvas-focus-area.component.ts` and
`canvas-rail-board.component.ts`; reads of the new spec tests; a repo-wide sweep for stale members.
No checks were re-run; the orchestrator's verification stands (chat-ui 1607, chat 4709 + 2 skipped,
canvas 474 pass; typecheck ×3; lint: only the 2 pre-existing chat errors).

**Score: 9/10 — APPROVED**

All 10 defects are fixed at the root cause, not patched around, and each fix has a regression test
that asserts the behaviour, not just the classes. The dead split-Details path is removed, the
cleanup left no dangling member (checked by sweep), and the fix round also wired the dock's
`closeRequested` output into the board — at round 1 that Close control emitted into the void.
One minor defect remains, listed below.

## Status of the 10 earlier defects

| # | Earlier defect | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Rail `⋯` menu clipped by the rail's scroll box | FIXED | Rail menu is `fixed` + `z-50`, starts hidden, becomes visible once placed: `canvas-focus-header.component.ts:99-105`; `toggleMenu()` positions it with `placement: 'left-start'` via `afterNextRender` (`:216-230`); outside press closes (`:233-238`); `closeMenu()` runs `floatingUI.cleanup()` (`:250-253`). `floating-ui.service.ts:180-188,210,234` writes `position: fixed`, `visibility: visible` and installs `autoUpdate`, so the menu also follows the trigger on scroll. Tests: header spec 118-138 (fixed layer, outside press), dock spec 309-326 (rail menu `fixed`, not `absolute`). |
| 2 | In split, switching the focused pane collapsed an open sidebar | FIXED | `canvas-inspector-dock.component.ts:73-90`: the source short-circuits on `splitDisplayed()` (reads no id while split), and `computation(source, previous)` keeps `previous.value` while split stays on; entering split gives `false`, leaving it the persisted value. `setDockExpanded` skips `InspectorOpenStateService` while split (`:428-434`). Test: board spec 2356-2400 — overlay stays open across a pane switch, `tabId` follows focus, leaving split restores the collapsed single-view state. |
| 3 | Rail avatar strip: arrow keys auto-expanded the sidebar; no roving tab stop | FIXED | `canvas-lane-tabs.component.ts:436-438`: rail arrows/Home/End set `railFocusKey` only, no `laneSelected` emit; roving `railTabStop` (`:355-362`) drives `[tabIndex]` (`:195`); `+N` sits outside the tablist (`:237-242`); the host is a centred flex column in rail (`:88-93`). Enter is left to native button activation. Test: lane-tabs spec 180-220 (one tab stop, roving `tabIndex` array, no emit on arrows, click selects). |
| 4 | Resize grip unmounted mid-drag when `overlay()` flipped at the 560 px threshold | FIXED | `canvas-inspector-dock.component.ts:21` names `CHAT_MIN_BESIDE_DOCK`, used by both `overlay()` (`:295-297`) and `dockedMaxWidth()` (`:302-307`); the grip's `[max]="dockedMaxWidth()"` (`:167`) keeps 560 px of chat, so a drag cannot flip `overlay()`. A host resize that still flips it cancels the draft (`:327-329`, `untracked`). Tests: dock spec 328-342 (End-key drag to 536 keeps `overlay()` false and the grip mounted) and 344-357 (draft dropped on flip, width back to 336, nothing persisted). |
| 5 | Hand off rendered twice in the expanded sidebar | FIXED | New `embedded` input (`canvas-focus-header.component.ts:161`); the dock passes `[embedded]="!(rail ?? false)"` (`canvas-inspector-dock.component.ts:114`); `sendToInMenu = !floating && !embedded` and `hasMenu` gate the `⋯` trigger and the menu (`:178-180`, `:75`, `:107`). The rail keeps Hand off in its menu; the expanded sidebar and sheet show it once beside the title (`inspectorActions`, dock `:208`, `:255`). Tests: dock spec 309-326 (exactly one `ptah-send-to-messaging`, no `⋯` in the dock), header spec 104-116 (embedded drops the empty menu, split actions still render). |
| 6 | Dead split-Details path with a stale focus query | FIXED | Whole path removed: `detailsRequested` output, board binding, `#splitInspector`/`splitTemplate`, `openSplitDetails`/`closeSplitDetails`, `detailsFocusReturn`, `activeSide` — a repo-wide sweep finds no reference in `libs/` or `apps/`. `collapseSplit` resets `detailsOpen` directly (`canvas-rail-board.component.ts:898-901`). Rewritten tests: board spec 2402-2423 (Escape on the overlay collapses to the rail and focuses the expand control). |
| 7 | Needs-you aggregate not announced (bare `span` with `aria-label`) | FIXED | `session-inspector.component.html:56` adds `role="img"`. Assertion: `session-inspector.component.spec.ts:189-192` (label text, `role` attribute). |
| 8 | `inspectorActions` lost when the identity block is empty | FIXED | The actions row renders outside the identity condition; the heading and status stay conditional; an empty row collapses via `empty:hidden` (`session-inspector.component.html:122-140`). Test: spec 244-250 (no `h2`, projected actions survive). |
| 9 | `stopSession` dropped the rejection | FIXED | `canvas-inspector-dock.component.ts:339-346` wraps `abortWithConfirmation()` in `try/catch` and logs through `LoggingService`; the focus-area twin uses the same logger now (`canvas-focus-area.component.ts`, `logger.error('CanvasFocusArea', …)`). Test: dock spec 301-307. |
| 10 | Test gaps that hid the defects | FIXED | Verified present and meaningful: dock spec 285-299 (projected rail controls: Stop aborts, view toggle switches, Close emits the id), 328-357 (grip cap + draft drop), board spec 2356 (split persistence), lane-tabs spec 180 (rail keyboard), session-inspector spec 192 and 244. The four e2e files that used the removed `ptah-canvas-focus-header [data-details]` / `[data-stats-tab]` toggles now open the sidebar through `[data-inspector-rail] [data-inspector-expand]`: `plan-limits-visual.e2e.spec.ts:118`, `canvas-orchestra.scene.ts:151`, `chat-code-edit.scene.ts:122`, `compaction-duplicate-session.spec.ts:280`. |

**"Limit unavailable" repetition** — also fixed: the unknown-state subgroup badge is hidden when the
lane has no known limit chip, because the summary already states it once
(`lane-usage-tile.component.ts:144`); spec `lane-usage-tile.component.spec.ts:327,413-415` counts
exactly one occurrence.

**Orchestrator cleanup** — verified: `inspectorToggleDescription` has no source reference left
(`session-limit-summary.ts`, `chat-ui/src/index.ts`); `closedDetailsDescription`, `dockSlotShown` and
the `SessionInspectorStore` inject are gone from `injectCanvasInspectorDockState`
(`canvas-inspector-dock.component.ts:55-100`); the focus-area and board lost their dead bindings and
inputs. The board also gained `(closeRequested)="close($event)"` on the dock — at round 1 the dock's
Close session control emitted an output nothing consumed; it now closes the tab.

## New defects

1. **minor — The rail strip's key-normalization effect auto-expands the sidebar.**
   `canvas-lane-tabs.component.ts:380-384` emits `laneSelected` whenever `laneKey()` differs from the
   normalized `selectedKey()`. In the rail instance the dock routes that output through
   `selectRailAgent`, which calls `expandInspector('agents')` (`canvas-inspector-dock.component.ts:147-151`, `:332-335`).
   Failure: the rail is mounted (sidebar collapsed) and the selected agent's key changes form — the
   `sub:`/`bg:` transition `selectedKey` normalizes (`canvas-lane-tabs.component.ts:273-283`) — or
   leaves the roster. The effect fires, and the sidebar opens to the agents section without user
   action. This path exists since Revision 2; it is not introduced by this fix round (the arrow keys
   no longer reach it, which is why it now stands alone).
   Fix: in the rail instance let the effect select without expanding (a separate normalization
   output routed to `detail.selectLaneFor` only), or have `selectRailAgent` expand only on a genuine
   user activation.

No other new defect was found. The five failure questions were traced on the fixed paths: the
hidden-until-placed menu cannot stay invisible in practice (the placement promise rejects only in
a middleware failure, and an outside press or Escape closes the stale menu); the docked clamp
holds while docked (`availableWidth − width ≥ 560` implies `dockedMaxWidth ≥ dock.minWidth`, so
`[max]` never crosses `[min]`); the cleanup sweep found no dangling selector, input, output or
e2e target.

## Decisions

- **`⋯` hidden in the expanded sidebar — accepted.** With Hand off beside the title (spec item 8)
  and split actions in the pane's floating group (item 3), the expanded top bar's menu has no item
  in single view; an empty `⋯` is worse than none. The rail keeps its `⋯` with Hand off. One
  consequence: in split with the overlay open, the covered pane's floating group sits under the
  `z-50` overlay, and the overlay's own top bar has no `⋯`; board-level split actions remain
  reachable from the uncovered pane's floating group, and collapsing the overlay restores the
  covered pane's controls. The pre-revision Details overlay had the same property; not a defect.
- **560 px clamp canvas-local — accepted.** `dockedMaxWidth` in the dock caps the drag without
  touching the shared `INSPECTOR_MAIN_MIN_WIDTH` policy; only canvas uses the controller.
- **Mixed lanes still repeat "Limit unavailable" per unknown subgroup — accepted.** There the
  badge separates known from unknown subgroups; the report documents it.
- **Roster key transition graded minor, not major.** It needs a `sub:`/`bg:` transition or a roster
  drop while the rail is mounted, and the cost is one unexpected expansion with focus handled by
  `expandInspector`. It does not block approval.
- **Geometry is still jsdom-proven only.** The rail menu, overlay and two-row wrap are verified by
  classes and behaviour, not pixels; the Electron screenshots the report lists under "Left open"
  must still confirm them before merge. That is a visual-review gate, not a code-logic one.