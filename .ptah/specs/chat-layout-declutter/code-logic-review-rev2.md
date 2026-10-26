# Code logic review — Revision 2 (chat layout declutter)

Review family: Glm (Ollama Cloud)
Implementer families: codex (items 1–8), Claude (item 9 + canvas test/split fixes)
Scope: uncommitted diff vs `HEAD` in this worktree (24 modified files + `lane-detail.ts`/`lane-detail.spec.ts`), reviewed against `design-spec.md` `## Revision 2`.
Method: full reads of the changed canvas/chat/chat-ui sources and the key spec diffs; static analysis only. The orchestrator's verify run (chat-ui 1606, chat 4708+2 skipped, canvas 467 tests pass; typecheck pass ×3) was not re-run. Geometry findings below are CSS-reasoned, not screenshot-proven; the planned Electron visual review has not run yet.

**Score: 6/10 — REVISE**

The data work (item 7) and the lane-detail rebuild (item 9) are correct and well tested. Items 1, 5, 8 are met. The compact rail — the default state below 1200px board width — has one unusable control (defect 1) and a broken keyboard contract (defect 3), and the split sidebar defeats item 3's identity-follows-focus requirement (defect 2).

## Defects

1. **blocking — The compact rail's `⋯` menu is clipped by the rail's scroll container.**
   `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts:103` renders the menu `absolute right-10 top-10` inside a `relative` 56px column, which the rail aside scrolls: `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.html:4` (`overflow-y-auto` — CSS computes `overflow-x` to `auto` when `overflow-y` is not `visible`, so descendants are clipped to the 56px box).
   Failure: board width < 1200px → rail is the default state. Click `⋯` in the rail → the ~200px menu gets a 16px visible sliver and the rail grows a horizontal scrollbar; "Send to" / split actions are unusable by pointer. The rail agent hover card escapes this because it is `position: fixed` (`agent-dock-card.component.ts:31`); only the menu is `absolute`.
   Fix: position the menu like the hover card (fixed, via the shared FloatingUI service with `left`/`bottom-start` placement), or make the menu render `fixed` in rail mode.
   jsdom specs cannot catch this (no layout). Needs a screenshot check after the fix.

2. **major — In split, switching the focused pane collapses an open sidebar.**
   `canvas-inspector-dock.component.ts:81-92`: the `dockOpen` linkedSignal source returns `false` on every re-run while `splitDisplayed()`, and it re-runs on `focusedId()` change. A user expansion (`setDockExpanded(true)`) survives only until the next source change.
   Failure: split view → expand the sidebar from the rail → click the other pane → the sidebar overlay collapses back to the rail; the user must expand again to see the second pane's identity. Spec item 3: "The sidebar shows the identity and strip of the focused pane" — the overlay should follow focus, not close.
   Fix: while `splitDisplayed()`, keep the current value on a focused-pane change (return the last dock state instead of `false`, or persist a split-expanded flag), or reset only on entering split.
   The same source also re-fires on any `focusedTab()` object change; in split that means ordinary tab updates can also close an open sidebar mid-read.

3. **major — Rail avatar strip: arrow keys auto-expand the sidebar and break the tablist keyboard model.**
   `canvas-lane-tabs.component.ts:397-419` (`onKeydown` emits `laneSelected` on Arrow/Home/End) + `canvas-inspector-dock.component.ts:199-203, 369-372` (`laneSelected` → `selectRailAgent` → `expandInspector('agents')`).
   Failure: focus a rail avatar, press ArrowRight → the overlay sidebar expands and the rail strip unmounts mid-interaction; `focusTab` (`canvas-lane-tabs.component.ts:463-470`) then looks up a DOM id whose rail element was destroyed (it may find the sidebar strip's same-id chip, or nothing when the agent overflowed into `hidden`). A keyboard user cannot browse rail icons without opening the sidebar.
   Also `[tabIndex]="rail() || chip.selected ? 0 : -1"` (`canvas-lane-tabs.component.ts:190`) makes every rail chip tabbable, which drops the roving-tabindex contract of `role="tablist"`; and the `+N` button (`canvas-lane-tabs.component.ts:212-215`) has no `role` inside the tablist.
   Fix: in rail mode let arrows move focus only (no `laneSelected` emit), or expand with a deterministic focus target; give the strip one tab stop with arrow-key focus movement.

4. **major — The resize grip unmounts mid-drag when the overlay threshold is crossed.**
   `canvas-inspector-dock.component.ts:347` (`overlay()` flips when `availableWidth - dock.width() < 560`) and `:209` (`@if (!overlay())` renders the split handle).
   Failure: docked dock at availableWidth 900, width 336 (564 ≥ 560 → docked). Drag wider past 340 → `overlay()` flips true mid-drag → the grip is removed from the DOM; `sizeCommit` never fires, so `dock.preview`'s draft stays pending (`inspector-dock.controller.ts:71-78` — only `commit`/`cancel`/`reset` clear it), and the drag ends abruptly. The user cannot drag back (the grip is gone in overlay mode) and must close and re-expand.
   Fix: keep the grip mounted in overlay (disabled), or clamp the drag's live `preview` to `availableWidth - 560` while docked so the flip cannot happen mid-drag, and cancel the draft when the handle unmounts.

5. **major — "Send to messaging" (Hand off) is rendered twice in the expanded sidebar.**
   The dock projects it next to the title via `inspectorActions` (`canvas-inspector-dock.component.ts:260`, landing at `session-inspector.component.html:128`) AND inside the projected controls' `⋯` menu (`canvas-focus-header.component.ts:105-109`, `floating()` is false in the dock and sheet). The pre-revision header gated the menu copy with `@if (!inspectorExpanded())` precisely to avoid this duplication; the gate is gone.
   Failure: open the expanded sidebar (single, split overlay or compact sheet) → the same action appears beside the title and inside `⋯`.
   Fix: skip the menu item when the controls render inside an inspector that already shows `inspectorActions` (new input on the focus header, e.g. `embedded`), as the old `!inspectorExpanded()` guard did.

6. **minor — The split Details overlay path is dead, and its close path queries a removed button.**
   `canvas-focus-header.component.ts:212` declares `detailsRequested` but no control emits it; `canvas-rail-board.component.ts:336` still wires `(detailsRequested)="openSplitDetails($event)"`, so `openSplitDetails`/`splitTemplate` (`canvas-inspector-dock.component.ts:132-181`) and `closeSplitDetails` are unreachable in production. `closeSplitDetails` still focuses `[aria-label="Open details"]` (`canvas-inspector-dock.component.ts:433`) — a button that no longer exists; any future caller silently falls into the fallback branch.
   Per item 3 the split Details button is indeed gone, so remove the dead machinery (or keep it and repair the focus query to the rail expand control) rather than leave a half-wired surface.

7. **minor — The rail's needs-you aggregate is no longer announced to assistive tech.**
   `session-inspector.component.html:56`: `<span … [attr.aria-label]="runLabel()">` — `aria-label` on a bare span with no role is ignored. The removed Run tile was a button whose accessible name carried "Running agents: N; M need you". The per-agent icons do expose per-agent status, but the aggregate count is now decorative. Give the span `role="status"` (or move the text into the existing sr-only live region).

8. **minor — `inspectorActions` content disappears when the identity block is empty.**
   `session-inspector.component.html:122-128` moved `<ng-content select="[inspectorActions]" />` inside `@if (sessionTitle() || sessionStatus() || workflow() || branch())`. The canvas dock always passes a non-empty `sessionStatus`, so Electron is safe, but any other consumer of `ptah-session-inspector` that projects actions without title/status/workflow/branch now loses them entirely (before, the slot rendered unconditionally). Keep the slot outside the identity condition.

9. **minor — `stopSession` drops the error handling its twin has.**
   `canvas-inspector-dock.component.ts:376-379` awaits `abortWithConfirmation()` without the `try/catch` the same flow uses in `canvas-focus-area.component.ts:159-166`. The conversation service logs-and-falls-back today, but a rejection here is unhandled. Mirror the focus-area guard.

10. **minor — Test gaps that hide the defects above.**
    No spec drives the rail strip with arrow keys (defect 3), clicks Stop/view/Close inside the dock's projected rail controls (only the component-level outputs are tested in `canvas-focus-header.component.spec.ts:62`), asserts the `⋯` menu geometry (jsdom cannot — defect 1), or checks the two-row wrap capacity against real widths. No Electron screenshot exists yet for any Revision 2 surface; items 2, 3, 5, 6 and 9 are unverified visually.

## Requirement check (items 1–9)

| Item | Verdict | Evidence |
| --- | --- | --- |
| 1. No chat header row; identity only in sidebar | PASS | `canvas-focus-area.component.ts:46-76` renders the focus header only in split, as floating controls; focus-area spec asserts no header/branch/strip in single and split at both inspector states. Title/status/workflow/branch project into the sidebar only (`session-inspector.component.html:122-142`). Dead `detailsRequested` path: defect 6. |
| 2. Controls in the sidebar top bar / rail | PARTIAL | Stop/view/`⋯`/Close projected via `inspectorControls`/`inspectorRailControls` under the expand `‹` (`session-inspector.component.html:27,96`), `size-7`, labels and titles kept. Rail `⋯` menu unusable (defect 1); send-to duplicated (defect 5). |
| 3. Split floating controls + sidebar shows focused pane | PARTIAL | `absolute right-2 top-2`, `opacity-0 … focus-within:opacity-100` (`canvas-focus-area.component.ts:46-49`) — hover/focus visible, keyboard reachable. Overlay never auto-opens in split (linkedSignal source, `canvas-inspector-dock.component.ts:84-85`). But an open sidebar collapses on pane switch (defect 2). |
| 4. Compact rail active-agent icons | PARTIAL | 5 running/waiting icons, `+N` → agents section, orchestrator fallback, shared hover card, click selects + expands (`canvas-lane-tabs.component.ts:294-298,212-215`; dock spec "expands and selects the clicked rail agent"; lane-tabs spec covers 5+2, fallback, tooltip). Needs-you badge and plan-limit mark retained (`session-inspector.component.html:55-57,16-24`). Arrow-key auto-expansion breaks keyboard browsing (defect 3); needs-you aggregate not announced (defect 7). |
| 5. Two-row strip, labelled trigger | PASS | `compact=false` in sidebar → "N agents" + chevron, never a bare count (`agent-dock-menu.component.ts:78-82`); orchestrator first + capacity heuristic for 2 rows (`canvas-lane-tabs.component.ts:299-311`); spec covers label and <16 chips. Geometry unverified (defect 10). |
| 6. Overlay below 560px chat, no clipping at 400px | PARTIAL | `overlay()` (`canvas-inspector-dock.component.ts:347`), 56px flow reservation (`occupiedWidth`, `:361-363` + `w-14` placeholder), `max-width: 100vw`, sub-400 sheet kept; dock spec covers 900/400 overlay + 56px occupation; board spec covers rail entry at 380px. Grip unmounts mid-drag (defect 4). The overlay is now `fixed inset-y-0` (window-relative) where the old narrow overlay was `absolute` (board-relative): if any host chrome sits above/below the board, the sheet covers it — confirm in the visual review. |
| 7. Lane usage mapping | PASS | `session-stats-source.ts:88` reuses `usageTotalsFromSegments` with the `partial` marker; structured totals take precedence; empty segments → `null` (no invented usage); lane tokens/cost/subtotal carry `≥`; session totals stay sourced from session usage (`subtotalTile` and `laneTile` in `lane-tiles.ts:122-160,747-752`). Spec `session-stats-source.spec.ts` covers fallback, precedence, unknown and subtotal. |
| 8. Hand off alignment; popover placement | PASS (one duplication under item 2) | `inspectorActions` sits in the title row (`session-inspector.component.html:128`); the sidebar card renders in flow below the strip (`basis-full`, `agent-dock-card.component.ts:30-33`) so it cannot cover the Session tiles; rail cards open left (`canvas-lane-tabs.component.ts:492`). In-flow card causes hover layout shift inside the strip — acceptable reading of "below/left inside the sidebar". |
| 9. Lane detail as DaisyUI structure | PASS | `collapse collapse-arrow` with host-owned open state (`stats-tile.styles.ts:laneCollapseClass`), shared `LANE_ROW_GRID` incl. the subtotal row, `badge badge-xs` status, `table table-xs` with `#`/Model/Tokens/Cost/Status/Started, `tabular-nums` right-aligned, columns dropped when all-unknown (`lane-detail.ts:96-106`), one muted summary line, footnote dedup without repeating "Limit unavailable" (`lane-detail.ts:113-123`), no "Restored · completed" sentences (`runStatusBadge`, `lane-detail.ts:28-32` — covers the exact `AgentStatus` union, checked). Thorough spec coverage in `lane-usage-tile.component.spec.ts`. Open: DaisyUI arrow `!` overrides and the fixed 7rem status column are flagged by the implementer for the visual review. |

## Decisions

- **Rail `⋯` clipping treated as a defect, not "needs visual confirmation"**: `overflow-y: auto` forcing `overflow-x: auto` is standard CSS, the rail is 56px, and the menu is ~200px. Reversible: if the visual review shows a mitigating factor (e.g., a non-clipping ancestor), downgrade to minor.
- **Arrow-key auto-expansion treated as a defect although the spec names only clicks** (item 4): the strip's preserved capabilities include keyboard navigation, and `role="tablist"` carries the roving contract. Reversible by declaring mouse-only rail icons.
- **Item 3 read as "the sidebar stays open and follows the focused pane"** ("The sidebar shows the identity and strip of the focused pane"). If the intended behavior is "collapse on pane switch", reject defect 2 and state it in the spec.
- **Send-to duplication graded against the removed `!inspectorExpanded()` guard** as evidence that duplication was previously considered a defect, not a preference.
- **Rail rendering below 400px is accepted as intended** (item 6 "the docked state is the compact rail"; board spec updated to expect the rail at 380px) — not a regression of the old sub-400 behavior.
- **"needs-you" read as agent status `waiting`** (per `agent-avatar.types.ts`), so the rail filter's running/waiting matches item 4's "running/waiting/needs-you".
- Verification evidence is the orchestrator's (all tests pass); I ran no checks myself, per the task's memory-safe instruction.

## Remaining uncertainty

- No Electron screenshots for Revision 2 exist: the geometry of the rail menu (defect 1), the fixed overlay vs host chrome, the two-row wrap, the DaisyUI arrow `!` overrides and the 7rem status column are unverified. The visual review planned in `HANDOFF.md` must cover them before merge.
- `LANE_STATE_CHIPS.unknown`'s exact text was not read; if it is "Limit unavailable", a lane with several unknown subgroups would still repeat that phrase in the subgroup heading badges despite the footnote dedup.
- Hosts other than the three verified projects (TUI, VS Code) consume the widened `usageTotals` type; their typechecks were not run in this revision's verification.