# Implementation Plan - TASK_2026_699_833e (rev 4: retarget to the canvas rail board)

Supersedes the host placement of `implementation-plan.md` rev 3 (decision 16). Everything rev 3
specified for the chat-ui atoms (split-handle grip, sidebar-tab fixes) and the PLAN LIMITS card
still holds. Rev 4 changes three things: which component hosts the dock, how the width
controller gets its inputs, and what happens to the chat-view wiring.

## Inputs and constraints

- Requirements used: `context.md`, `task-description.md` (rev 3, AC 1-7), `decisions.md` rows 5,
  10, 13-17, `design-spec.md` (rev 3, approved per decision 9), `implementation-plan.md` (rev 3),
  `batches.md` (Batches 1-4, fix round, visual fix round), `TASK_2026_705_9d53/context.md`
  (removal of the single layout).
- Corrections applied: decision 16 (wrong host), decision 13 (tab "Stats" on the dock's inner edge).
- Design handoff used: `design-spec.md` §1-2 (handle, hit area, widths), §3 (cards, unchanged).
- Missing decision-critical input: the canvas tile floor. Resolved: option (A), 360 px
  (`decisions.md` row 18). See D-1.
- AC 3.2 amended for the canvas host (row 18): "When docked at any board width, the system
  shall keep the single-focus tile area at least 360 px wide, lowering the effective maximum on
  narrow boards; the 300 px dock minimum wins below that." This replaces 624 (960 - 336), which
  came from the chat-view shell. The 360 value matches the split-pane minimum
  `[class.min-w-[360px]]="splitDisplayed()"` (`canvas-rail-board.component.ts:174`). That class
  applies only in split, so today the single-focus tile has no floor. 360 is therefore a NEW floor
  for the single-focus tile. It is enforced only through the dock's maximum width
  (`inspectorMaxWidthFor`), not through a CSS `min-w` on the tile.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Canvas already imports `InspectorShellController`, `SessionInspectorStore`, `injectSessionStatsSource` from `@ptah-extension/chat` and `StatsTileExpansionState`, `inspectorToggleDescription` from `@ptah-extension/chat-ui` | `canvas-rail-board.component.ts:17-20` | canvas → chat and canvas → chat-ui are existing edges. No new dependency is needed and no deep import. |
| Tags: canvas, chat and chat-ui are all `scope:webview`, `type:feature`. `type:feature` may depend on `type:feature` | `libs/frontend/canvas/project.json:7`, `libs/frontend/chat/project.json:7`, `libs/frontend/chat-ui/project.json:7`, `eslint.config.mjs:297-298,409-415` | The module boundaries allow the reuse. |
| The board provides `InspectorShellController` but never attaches it. Only `SessionInspectorComponent` injects it, `optional`, for `closeReady` | `canvas-rail-board.component.ts:74`; `session-inspector.component.ts:64,103-109` | The chat-view band model (960/640, open state per tab) does not drive canvas. Canvas has its own bands. |
| Canvas bands: xl >= 1760, lg >= 1280, md >= 1120, else sm. Compact sheet below 400 | `canvas-board-mode.ts:18-23`; `canvas-rail-board.component.ts:306,368` | The dock lives in the md/lg/xl/sm single-focus branches. Below 400 the compact sheet stays. |
| Single-focus md/lg/xl aside: fixed `w-[360px]`/`w-[320px]`/`w-[296px]`, always open, `[&_[data-inspector-close]]:hidden` | `canvas-rail-board.component.ts:249-262` | It becomes the resizable, closable dock. |
| sm aside: `w-[288px]`, closed by default. It is opened by a 44 px "Open details" button (`w-11`, lucide `PanelRight`). The inspector close calls `toggleDetails()` | `canvas-rail-board.component.ts:214-248,872-875` | The button is replaced by the Stats tab. The aside joins the same dock. |
| Split overlay `w-[min(360px,100%)]`, `role="dialog"`, Esc, MutationObserver focus to `[data-inspector-close]`, focus returns to the header "Open details" | `canvas-rail-board.component.ts:200-208,741-785` | It is kept unchanged (D-5). |
| Compact sheet: `fixed inset-0`, `aria-modal`, Tab trap, document Escape, a lane opens it and closes it | `canvas-rail-board.component.ts:264-273,787-830` | It is kept unchanged. |
| A single `detailsOpen` signal on the board serves sm, split and compact. `openBeside` clears it | `canvas-rail-board.component.ts:305,680-683,745,773,790` | The single-focus dock gets its own open state (D-3). The split and compact paths keep `detailsOpen`. |
| The rail auto-collapses while the sm details are open | `canvas-rail-board.component.ts:373-377` | Keep this rule and read the dock's open state instead. |
| Rail rendered width: 56 collapsed, else 304 xl/lg, 288 md, 272 sm | `canvas-rail.component.ts:83-86` | The dock's shared width = board width - rail - tab (D-2). |
| Board width comes from `CanvasLayoutService.containerWidth` (ResizeObserver, floored, once per rAF) | `canvas-layout.service.ts:29-30,50-64` | No new observer. |
| Branch-only width math and constants live in `inspector-shell.controller.ts` (`INSPECTOR_MIN/MAX/MAIN_MIN_WIDTH`, default tiers 1100/1500 → 336/400/448, `inspectorMaxWidthFor`, `inspectorDefaultWidthFor`, `inspectorDockWidth`). The same file also adds `shellWidth`, `attach(..., reservedWidth)` and `toggle(opener)` | `git diff main...HEAD -- .../inspector-shell.controller.ts` (+28 to +120) | Move the pure math out. Revert the controller to main. Its only consumer of the additions was chat-view (D-4). |
| `InspectorDockController` depends on `InspectorShellController` (`shellWidth`, `isOpen`, `tab`, `isModal`) and has the chat-view `toggleFromTab` | `inspector-dock.controller.ts:33-46,66-76,124-126` | Decouple it: the host binds `shown` and `availableWidth`. |
| `InspectorDockWidthStore`: root service, key `ptah.inspector-dock-width.v1`, clamp [300,560], `storage` sync, logged failures. It imports the constants from the shell controller | `inspector-dock-width.store.ts:3-9,42-131` | Reuse it as is. Only its import path changes. |
| `SplitHandleComponent` contract: `size/min/max` required, `inverted`, `appearance: 'line'|'grip'`, outputs `sizeChange/sizeCommit/sizeReset/sizeCancel/draggingChange` | `split-handle.component.ts:93-109`; exported `chat-ui/src/index.ts:24-27` | Reuse it as is. |
| `SidebarTabComponent`: `label`, `side`, `isOpen` required, `badgeType`, output `toggled`. The default size is `w-8` (32 px). Its accessible name is "Toggle {label} panel" with `aria-expanded` | `sidebar-tab.component.ts:58,63-66,120-142,150-153`; exported `chat-ui/src/index.ts:21` | Reuse it. The tab width is 32 = `INSPECTOR_TAB_WIDTH`. |
| PLAN LIMITS card path: `SessionInspectorComponent` → `ptah-inspector-limits-lanes` → `ptah-plan-limit-tile variant="inspector"`. It is not gated on `presentation` | `session-inspector.component.html:63-67`; `inspector-limits-lanes.component.ts:43,68` | The cards already render in every canvas aside (embedded, sheet). No change is needed. |
| Board spec replaces the board imports with `set` (stubs), and stubs `CanvasLayoutService.containerWidth` as a signal (default 1400) | `canvas-rail-board.component.spec.ts:329,362-405` | New atoms must be added to the override list. Specs drive the width through the signal. |
| Board specs pin today's widths and the sm button: `aside.w-[296px]` (698-708), `button.w-11[aria-label="Open details"]` (710-720), auto-collapse via `toggleDetails()` (685-696, 1167-1177), split overlay (1438-1480), compact sheet (1482-1556) | `canvas-rail-board.component.spec.ts` | 698 and 710 are rewritten. The rest must pass unchanged. |
| e2e: the split header "Open details" and the "Session details" dialog. `ptah-session-inspector:visible [data-testid="inspector-session-stats"]` after toggling the header `[data-details]` | `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:149-163`; `specs/chat/compaction-duplicate-session.spec.ts:282-311`; `showcase/canvas-orchestra.scene.ts:159` | Split and compact selectors are untouched. The showcase needs the dock open by default at md+, which is kept. |
| TASK_2026_705 removes the `'single'` layout in every host (VS Code too). Its branch `refactor/remove-single-layout` has no commits yet | `.ptah/specs/TASK_2026_705_9d53/context.md`; `git log main..refactor/remove-single-layout` (empty) | Canvas becomes the only inspector host in both hosts. Keep chat-view and `inspector-shell.controller.ts` identical to main to avoid conflicts. |
| Electron 1440 window: workspace sidebar 220 px | `electron-layout.service.ts:38`; `electron-shell.component.ts:319-335,380` | The board is about 1156 px (md). This drives D-1. |

## Architecture decision

- Chosen approach: the single-focus aside in `CanvasRailBoardComponent` becomes the dock. The
  Stats `ptah-sidebar-tab` sits between the pane container and the dock. A 0 px slot holds the
  inverted grip `ptah-split-handle` over the dock's leading edge. The width comes from a
  decoupled `InspectorDockController` and the existing `InspectorDockWidthStore`, both in
  `@ptah-extension/chat`. The board supplies `shown` and `availableWidth`. Chat-view and
  `InspectorShellController` go back to main.
- Rationale: canvas is the user's real view (decision 16) and, after TASK_705, the only host.
  The width policy (draft, commit-only-if-changed, reset, persisted clamp) is already written
  and tested. Only its input (the chat-view shell measurement) is host-specific.
- Rejected alternatives:
  - Attaching `InspectorShellController` in canvas to reuse `shellWidth`. Its bands (960/640),
    per-tab open state and modal sheet conflict with canvas bands, split overlay and compact
    sheet. It would also keep branch edits in a file TASK_705 may rewrite.
  - Moving the controller into canvas. The width store and math would stay in chat (the
    inspector domain, persisted key), so it would split one policy across two libs and throw
    away the controller spec.
  - Measuring the tile area with a new ResizeObserver. The rail width is a pure function of
    `(collapsed, band)`, so a second observer is not needed.
- Assumptions:
  - A1: the board width at a 1440 px Electron window is about 1156 px. Check: the visual pass
    reads `containerWidth` (via `data-*` or devtools) and confirms the band and default width.
  - A2: `LoggingService` is root-provided, so the real `InspectorDockWidthStore` resolves in the
    board spec (`logging.service.ts:72` shows `providedIn: 'root'`; verified). The spec must clear
    `localStorage` key `ptah.inspector-dock-width.v1` between cases.
- Effect on existing code: the 4 chat-view files and `inspector-shell.controller.ts` revert to
  main. Two branch-only specs are deleted (D-4). The width math moves to a new file. The board's
  aside branches, the sm button and `detailsIcon` are replaced. The chat-ui atoms, the PLAN LIMITS
  card and the lane-limits timeout are unchanged.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D-1 (CLOSED, `decisions.md` row 18) | Tile floor `INSPECTOR_MAIN_MIN_WIDTH` = **360**, not 624. AC 3.2 is amended for the canvas host | (A) 360, the same value as the split-pane minimum (chosen by the coordinator); (B) 624 literal; (C) 480 | At the 1440 window: shared width 836 → 624 gives min = max = 300 (grip cannot move, AC 4.3 fails). Today's single-focus tile there is 572 px (1156-288-296) and has no floor at all. The split-only `min-w-[360px]` is at `canvas-rail-board.component.ts:174` (`splitDisplayed()` only). So 360 is a new single-focus floor, applied only through `max = clamp(floor(availableWidth - 360), 300, 560)`. No tile CSS changes. With 360 at 1440: dock 300-476, default 336 | Yes: one constant value |
| D-2 | `availableWidth = max(0, containerWidth - railWidthPx(effectiveCollapsed, band) - INSPECTOR_TAB_WIDTH)`. The default tiers 1100/1500 → 336/400/448 apply to it | measure the panes; per-band constants | The default comes out wider than today at every band: md 336 > 296, lg >= 336 > 320, xl >= 400 > 360. No new constants | Yes |
| D-3 | Single-focus dock open state = board-level, in-memory `linkedSignal` with source `band() !== 'sm'` and initial value = the source (md+ open, sm closed). It resets to that default only when crossing sm ↔ md. It is not per tab | per tab (decision 5 wording); persisted | Canvas keeps one `detailsOpen` per board today (`:305`), not per tab. This keeps today's defaults per band and adds no persistence, the part of decision 5 the user asked for. Per tab would reopen or close the dock on every focus change | Yes |
| D-4 | Revert `inspector-shell.controller.ts` to main. Move the width math to `inspector-dock-width.ts`. Delete the branch-only `inspector-shell.controller.spec.ts` and `inspector-open-state.service.spec.ts` | keep the trimmed specs | After the chat-view revert, this task no longer changes either service. TASK_705 may delete or rewrite them, which would conflict or break typecheck after merge. Main has no such specs, so no coverage is lost against main. The width-function cases move to the new spec | Yes |
| D-5 | Leave the split overlay unchanged | make it resizable | It is an overlay over one pane, not a push dock. A different max formula would be needed. The e2e (`canvas.spec.ts:149-163`, `compaction-duplicate-session.spec.ts:305-311`) pins it | Yes |
| D-6 | The dock shows the inspector close at every band (drop `[&_[data-inspector-close]]:hidden`). Close sends focus to the Stats tab | keep it hidden at md+ | It was hidden only because md+ could not close (`:249`). It now can, and sm already shows it (`:228`) | Yes: re-add the class |
| D-7 | Deliberate behaviour change: neither the tab nor the dock renders without a focused tile (0-tile board) | keep an empty aside | Today the md+ branch (`:249-262`) renders the `<aside>` outside the tiles `@if/@else`, with its inspector guarded only by `focusedId()`. So a 0-tile board at md+ shows an empty fixed-width aside. No existing spec covers this (spec 574 mounts 2 tiles, `mount(true, 2)`). A resize grip with nothing to show has no use. A new explicit 0-tile spec pins the change | Yes |
| D-8 | No entrance animation for the dock. Drop `resizing`/`setResizing` from the controller | port `csInspectorIn` | The canvas aside has no animation today. A field with no consumer is dead code | Yes |

## Component specifications

### 1. Dock width math (`inspector-dock-width.ts`)

- Purpose: the pure width policy shared by the controller and the store.
- Responsibilities: constants `INSPECTOR_MIN_WIDTH` 300, `INSPECTOR_MAX_WIDTH` 560,
  `INSPECTOR_MAIN_MIN_WIDTH` (value 624 → 360, D-1 / row 18; its comment says "new floor for the
  canvas single-focus tile, same value as the split-pane min-w-[360px]"), the tier constants and defaults, and `INSPECTOR_TAB_WIDTH` 32
  (moved from `inspector-dock.controller.ts:22`, with a comment that names the canvas Stats tab).
  Functions `inspectorMaxWidthFor(availableWidth)`, `inspectorDefaultWidthFor(availableWidth)`,
  `inspectorDockWidth(preference, availableWidth)`, with the bodies moved verbatim from the
  branch's `inspector-shell.controller.ts` (rounding and flooring per fix-round F4). Rename the
  parameter to `availableWidth` and update the doc comments: "the width the tile area and the dock
  share".
- Verified contracts: the current bodies are in the branch diff of `inspector-shell.controller.ts`
  (+70 to +121).
- Dependencies: none (pure).
- Integration points: `InspectorDockWidthStore` (the import moves here), `InspectorDockController`,
  barrel `services/session-inspector/index.ts`.
- Failure behaviour: non-finite or 0 → default tier, and MAX for the maximum (unchanged).
- Verification seam: `inspector-dock-width.spec.ts` gets the "width functions" cases from the
  deleted shell spec (`inspector-shell.controller.spec.ts:432+`). Values follow D-1.
- Files: CREATE `libs/frontend/chat/src/lib/services/session-inspector/inspector-dock-width.ts`,
  CREATE `.../inspector-dock-width.spec.ts`; MODIFY `.../inspector-dock-width.store.ts` (import
  only).

### 2. `InspectorDockController` (decoupled)

- Purpose: one host's docked width: draft, rendered and maximum width, commit policy, reset.
- Responsibilities: `bind(shown: () => boolean, availableWidth: () => number)` replaces
  `bindHosted`. `slotShown` = `shown()`. `width` / `maxWidth` use `availableWidth()`. `preview`,
  `cancel`, `commit` (writes only a draft that differs from what renders now, per `:102-112`) and
  `reset` stay. Remove the `InspectorShellController` injection, `toggleFromTab`, `resizing` and
  `setResizing` (D-8). The draft still resets through `linkedSignal` on `slotShown`.
- Verified contracts: `inspector-dock.controller.ts:31-127`; `InspectorDockWidthStore.preference/
  commit/reset` (`inspector-dock-width.store.ts:49,62,74`).
- Dependencies: `InspectorDockWidthStore` (root) and the width math. No host or shell dependency.
- Integration points: provided in `CanvasRailBoardComponent.providers` (per board, never root).
  The board calls `bind` in its constructor.
- Failure behaviour: an unbound controller (`shown` false, width 0) renders the default tier and
  writes nothing. Storage failures are handled by the store.
- Verification seam: rewrite `inspector-dock.controller.spec.ts` to bind signals instead of a
  shell controller. Cases: default per tier; clamp to max as the available width shrinks, with the
  preference kept; preview then commit persists; commit without movement at a clamped width writes
  nothing; cancel restores; reset removes the key; the draft is cleared when `shown` goes false
  then true.
- Files: MODIFY `.../inspector-dock.controller.ts`, REWRITE `.../inspector-dock.controller.spec.ts`,
  MODIFY `.../services/session-inspector/index.ts` (export the controller, the store,
  `INSPECTOR_TAB_WIDTH`, `INSPECTOR_MIN_WIDTH`, `INSPECTOR_MAX_WIDTH`, `INSPECTOR_MAIN_MIN_WIDTH`, the
  tier constants and the 3 functions from the new file. The shell-controller export block returns
  to main's list).

### 3. Rail width function (`railWidthPx`)

- Purpose: one place for the rail's rendered width so the board can derive `availableWidth`.
- Responsibilities: `railWidthPx(collapsed: boolean, band: 'xl'|'lg'|'md'|'sm'): number` → 56 /
  304 / 304 / 288 / 272, next to `railWidthBand`.
- Verified contracts: `canvas-rail.component.ts:83-86`; `canvas-board-mode.ts:18-23`.
- Dependencies: none. `canvas-rail.component.ts` keeps its literal Tailwind classes (Tailwind needs
  literals).
- Failure behaviour: not applicable.
- Verification seam: `canvas-rail.component.spec.ts` gets one case per band plus collapsed. Each
  asserts that the rendered `aside` class matches `w-[${railWidthPx(...)}px]`, so the two cannot
  drift.
- Files: MODIFY `libs/frontend/canvas/src/lib/canvas-board-mode.ts`, MODIFY
  `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.spec.ts`.

### 4. Canvas dock host (`CanvasRailBoardComponent`)

- Purpose: render the Stats tab, the grip and the resizable dock for the focused tile in single
  focus at bands sm/md/lg/xl. Narrower widths keep the compact sheet. The split keeps its overlay.
- Responsibilities:
  - State: `dockOpen` linkedSignal (D-3). `dockShown = computed(!splitDisplayed() &&
    !compactSheet() && focusedId() !== null)` for the tab. `dockSlotShown = dockShown() &&
    dockOpen()`. `dock.bind(() => dockSlotShown(), () => availableWidth())` with
    `availableWidth` per D-2. `statsTabBadge = computed(dockOpen() ? null :
    inspectorStore.modelFor(id)().needsYouCount > 0 ? 'warning' : null)`, the same mapping as
    `showDot` 'need' (`inspector-shell.controller.ts:227-233`).
  - `autoCollapsed` (`:373-377`) reads `dockOpen()` instead of `detailsOpen()` in its sm term.
  - `toggleDetails()` keeps its name (specs at 685 and 1167 call it), toggles `dockOpen` and calls
    `anchor()`. New `closeDock()`: sets it false, calls `anchor()`, and after the next render
    focuses `[data-stats-tab] button`.
  - Template: replace both single-focus branches (`:214-262`) with one block guarded by
    `dockShown()`, in DOM order:
    1. the tab: `<ptah-sidebar-tab data-stats-tab label="Stats" side="left" [isOpen]="dockOpen()"
       [badgeType]="statsTabBadge()" (toggled)="toggleDetails()" />` in a `shrink-0` 32 px slot;
    2. when `dockSlotShown()`, the 0 px slot `relative z-10 w-0 shrink-0` with
       `<ptah-split-handle class="absolute inset-y-0 left-0 w-3" orientation="vertical"
       appearance="grip" label="Resize session details" [inverted]="true" [size]="dock.width()"
       [min]="dock.minWidth" [max]="dock.maxWidth()" (sizeChange)="dock.preview($event)"
       (sizeCommit)="dock.commit()" (sizeCancel)="dock.cancel()" (sizeReset)="dock.reset()" />`.
       The hit area sits entirely inside the dock's border plus the `pl-4` header, per design-spec
       rev 3 item 1;
    3. the dock `<aside class="flex h-full shrink-0 flex-col border-l border-base-content/10
       bg-base-100" [style.width.px]="dock.width()">`. Inside, the existing `@defer (on idle)`
       `ptah-session-inspector` (`class="min-h-0 flex-1 overflow-auto"`, `presentation="embedded"`,
       `[hasLaneSurface]="true"`, `[stats]="stats.inputs()"`, `(laneRequested)` →
       `detail.selectLaneFor`, `(closeRequested)="closeDock()"`) and the existing "Session
       details" `@placeholder`.
  - Remove the sm "Open details" button, `detailsIcon`, the `PanelRight` import (if it is now
    unused in this file), the band width classes and the close-hiding class (D-6).
  - Imports: add `SidebarTabComponent`, `SplitHandleComponent` (from `@ptah-extension/chat-ui`).
    Add `InspectorDockController` (from `@ptah-extension/chat`) to `providers`.
- Verified contracts: listed in the evidence table. `isTabbable`/`onTabKey` only act on split
  stacked panes (`:980-1007`), so the new tabbables need no change.
- Dependencies: canvas → chat (controller), canvas → chat-ui (atoms). Both edges exist.
- Integration points: `CanvasLayoutService.containerWidth`, `effectiveCollapsed`, `band`,
  `focusedId`, `splitDisplayed`, `compactSheet`, `SessionInspectorStore.modelFor`. The split
  overlay and compact sheet keep `detailsOpen`, `openSplitDetails`, `closeSplitDetails` and
  `closeCompactSheet` unchanged.
- Failure behaviour: an unmeasured board (width 0) → `availableWidth` 0 → default 336, max 560
  until measured. A handle destroyed mid-drag (band → compact, split opened) → the draft resets on
  `slotShown` and the atom restores body styles without emitting (Batch 1 R1). If storage
  failures occur, the width is kept in memory (store).
- Quality requirements: no new timer, observer or listener (width from the existing
  ResizeObserver; the atom's drag listeners are released on every exit). `@defer` still wraps
  every `ptah-session-inspector` reference. The atoms are not inspector references and load
  eagerly. Keyboard: Tab reaches the tab, then the separator (Arrow ±16, Shift ±48, Home/End,
  Esc, dblclick reset from the atom). ARIA: tab `aria-expanded`; separator `role="separator"`,
  `aria-orientation`, `aria-valuenow/min/max`, label "Resize session details". Contrast and focus
  ring come from the already-fixed atoms (V1, V2). Floor: the tile area stays >= D-1 whenever
  `availableWidth - INSPECTOR_MIN_WIDTH >= D-1`. Below that, the 300 px minimum wins (same as the
  rev 3 math).
- Verification seam (`canvas-rail-board.component.spec.ts`; add the two atoms to the `set`
  imports at `:397-403`; clear the storage key in `beforeEach`/`afterEach`):
  - lg (1400, default): the tab renders with `aria-expanded="true"`. The dock's inline width =
    `inspectorDockWidth(null, 1400-304-32)` (336). The separator is present with valuemax =
    `inspectorMaxWidthFor(1064)`.
  - Rewrite 698: md 1200 renders the dock open with the inline default width and the Stats tab.
    No `[aria-label="Open details"]` in single focus.
  - Rewrite 710: sm 760 → dock closed, the Stats tab has `aria-expanded="false"`, no aside,
    no `button.w-11`.
  - Tab click toggles at md+ (the dock closes and the tile widens). The badge is `warning` while
    closed with `needsYou > 0`, and `null` while open.
  - ArrowLeft on the separator → width +16 and `localStorage` holds the value. A remount restores
    it. Shrinking `width` clamps the render and leaves the stored value. Widening restores it.
  - dblclick resets to the default and removes the key. Esc mid-drag keeps the stored width.
  - The inspector close (stub `[data-inspector-close]`) closes the dock, and focus lands on
    `[data-stats-tab] button`, never on `body`.
  - Crossing md → sm closes the dock (D-3). sm → md opens it.
  - The 685 and 1167 auto-collapse cases pass unchanged (they use `toggleDetails()` at 1000 px).
  - split (1438-1480) and compact sheet (1482-1556) cases pass unchanged. The split shows no
    Stats tab and no separator. Compact (< 400) shows neither.
  - Single-focus floor (new, row 18): at lg 1400 (available 1064) the separator's valuemax is
    704 → clamped to 560. At md 1200 (rail 288, available 880) the valuemax is 520. End on the
    separator renders 520, and the tile is then `880 - 520 = 360`. At sm 760 (dock open, rail 56,
    available 672) the valuemax is 312. At sm 640 (available 552) the valuemax is 300: the minimum
    wins and the tile is 252, below the floor by design. No case expects a `min-w-[360px]` class on
    a single-focus tile. The split cases (2190, 2235, 1390) keep pinning it only in split.
  - NEW explicit 0-tile case (D-7, deliberate change): `mount(true, 0)` at lg 1400 → no
    `[data-stats-tab]`, no separator, no `aside` (outside the empty-board section). Today an empty
    aside renders there. The existing 574 case (2 tiles: wide aside plus deferred inspector) must
    still pass with its `aside:not([data-dock])` query, which now hits the dock aside. It is not
    a 0-tile test.
- Files: MODIFY `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`, MODIFY
  `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts`.

### 5. Chat-view revert

- Purpose: remove the dock from the host that TASK_705 deletes, leaving no conflict surface.
- Responsibilities: restore `chat-view.component.{ts,html,css,spec.ts}` byte-identical to `main`
  (`git checkout main -- <4 files>`), including the `:host display`, `agentSidebarTab` viewChild,
  attach call and the stray whitespace edits in the branch diff. Restore
  `inspector-shell.controller.ts` to main. Delete the two branch-only specs (D-4).
- Verified contracts: `git diff --stat main...HEAD` lists exactly these chat-view files and
  `services/session-inspector/*`.
- Failure behaviour: if a later merge of main has changed chat-view in the meantime, take main's
  version (the target is "no diff against main").
- Verification seam: `git diff main...HEAD -- libs/frontend/chat/src/lib/components/templates/
  libs/frontend/chat/src/lib/services/session-inspector/inspector-shell.controller.ts` is empty.
  The chat project tests pass.
- Files: REVERT the 4 chat-view files and `inspector-shell.controller.ts`; DELETE
  `inspector-shell.controller.spec.ts`, `inspector-open-state.service.spec.ts`.

### 6. Kept unchanged (verification only)

- chat-ui: `split-handle.component.ts/.spec.ts`, `sidebar-tab.component.ts/.spec.ts`, the
  `SplitHandleAppearance` export (`chat-ui/src/index.ts:24-27`), `plan-limit-tile.component.*`,
  `stats-tile.styles.ts`, `ptah-ui-lane-limits.source.*` (decision 15).
- The PLAN LIMITS cards render in the canvas dock, split overlay and compact sheet through the
  shared inspector (evidence above). The visual pass confirms that the cards at 300 px and at max
  dock width look like `screenshots/*-cards-*`.

## Integration architecture

- Data flow: ResizeObserver → `CanvasLayoutService.containerWidth` → `band`, `effectiveCollapsed`
  → `availableWidth` → `InspectorDockController.width/maxWidth` (+ `InspectorDockWidthStore.
  preference`) → dock `[style.width.px]` and separator `size/max`. Separator events → `preview`
  (draft) → `commit` → store → `localStorage`. The `storage` event syncs other documents in the
  same scope.
- State: the width preference persists (root store, decision 10 scopes). The draft is per board
  and transient. `dockOpen` is per board, in memory (D-3). `detailsOpen` stays for split/compact.
- External boundaries: `localStorage` values are parsed, rounded and clamped by the store (no
  change).
- Failure and rollback: storage write/read failures → in-memory value plus one `logger.warn` per
  kind. Cancelled drag → back to the preference. The revert is a pure file restore.
- Observability: existing `LoggingService` warnings (`InspectorDockWidth`). Board `data-*`
  attributes are unchanged.

## Architecture-level quality requirements

- Functional: AC 1 (tab, toggle, `aria-expanded`, badge, focus return to the tab) and AC 2-4
  (grip, keyboard, clamp 300-560, tile floor 360 per amended AC 3.2 / row 18, persisted width, wider defaults) hold in the canvas
  single-focus dock at sm/md/lg/xl. AC 5 maps to the canvas compact sheet below 400 px and the
  unchanged split overlay. AC 7 cards are unchanged.
- Performance: no new observer or timer. At most one `sizeChange` per frame (atom).
- Security: not applicable (local UI state only).
- Maintainability: no deep imports. Chat-view and `inspector-shell.controller.ts` have no diff
  against main. One width policy lives in `@ptah-extension/chat`. The canvas owns only its layout
  inputs.
- Testability: controller and math have unit specs. The board has a behaviour spec per seam case
  above. The rail parity spec guards `railWidthPx`.

## Parity check (current canvas inspector capabilities)

| Capability today | Where | After rev 4 |
| --- | --- | --- |
| md/lg/xl: inspector always visible beside the focused tile | `:249-262` | Kept: open by default at md+ (D-3), now resizable and closable |
| Widths 296/320/360 | `:252-254` | Replaced by the persisted width. Default 336/≥336/≥400, wider at every band |
| sm: closed by default, opener control, 288 px aside | `:214-248` | Kept closed by default. The opener is the Stats tab. Dock 300+ px |
| sm open auto-collapses the rail (not persisted) | `:373-377` | Kept, reading `dockOpen` |
| Inspector close button (sm) closes the details | `:228` | Kept at every band (D-6). Focus goes to the Stats tab |
| Lane request opens the lane (`detail.selectLaneFor`) | `:227,262` | Kept |
| `@defer (on idle)` + "Session details" placeholder | `:220-234,257-261` | Kept |
| `stats.inputs()`, `hasLaneSurface`, `presentation="embedded"` | `:224-226,262` | Kept |
| Split overlay (dialog, Esc, focus to close, focus return to the header opener) | `:200-208,741-785` | Unchanged (D-5) |
| Compact sheet < 400 (modal, Tab trap, document Esc, lane closes sheet) | `:264-273,787-830` | Unchanged |
| Header Details toggle description / limit cue / context ring | `:189-191,361-367` | Unchanged |
| Rail anchor on details toggle | `:872-875` | Kept in `toggleDetails`/`closeDock` |
| `openBeside` clears split details | `:680-683` | Unchanged (it does not touch `dockOpen`) |
| Empty aside on a 0-tile board at md+ (untested today; spec 574 uses 2 tiles) | `:249-262` | Deliberately removed (D-7). Pinned by the new explicit 0-tile spec |
| Single-focus tile width: no floor today (`min-w-[360px]` is split-only, `:174`) | `:174` | New 360 floor for the single-focus tile, through the dock max only (row 18). Split unchanged |
| PLAN LIMITS cards in the inspector | `session-inspector.component.html:63-67` | Kept, renders in the dock |

## Risks

- R1 (D-1 closed at 360, row 18): the tile can shrink to 360 px when the user drags the dock wide.
  This is the user's choice, bounded by the canvas pane minimum. The default stays 336 at the
  1440 window. The comment on `INSPECTOR_MAIN_MIN_WIDTH` must cite row 18, not "960 - 336".
- R2: at md+ with the dock closed, the Stats tab sits at the board's right edge next to the
  Electron Git tab (`electron-shell.component.ts:380`). That makes two vertical tabs side by side.
  The visual pass checks the separation and labels. Do not fix it in this task unless it is
  Serious.
- R3: TASK_705 merge order. Chat-view and the shell controller have no diff, so no conflict.
  If 705 deletes `InspectorShellController`, the canvas board's `providers` entry (`:74`, on main)
  is 705's concern, not this task's.
- R4: drift between the rail classes and `railWidthPx`. This is guarded by the parity spec.
- R5: the board spec harness uses `set` imports. Forgetting the atoms makes template errors look
  like test failures.
- R6: the screenshots in `screenshots/` show chat-view. All 20 are retaken from the canvas.

## Team-leader handoff

- Recommended executors: one Claude `frontend-developer` subagent for every component (decision
  12). Review: codex lane (code-logic + style), then visual review in Electron.
- Complexity: MEDIUM. Two projects, one host template rewrite, a controller decoupling and a file
  revert. The atoms are already done.
- Dependencies and ordering: components 1 + 2 + 5 (chat) before component 4 (canvas consumes the
  new `bind` and exports). Component 3 is independent but lives in canvas. Suggested file-disjoint
  split for one developer, run in sequence (one heavy check at a time):
  - Chat batch: components 1, 2, 5.
  - Canvas batch: components 3, 4.
- Parallel-safe work: none (one executor, one heavy check at a time).
- Files affected (all under `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\`):
  - CREATE: `libs/frontend/chat/src/lib/services/session-inspector/inspector-dock-width.ts`,
    `libs/frontend/chat/src/lib/services/session-inspector/inspector-dock-width.spec.ts`
  - MODIFY: `libs/frontend/chat/src/lib/services/session-inspector/inspector-dock.controller.ts`,
    `.../inspector-dock-width.store.ts`, `.../index.ts`,
    `libs/frontend/canvas/src/lib/canvas-board-mode.ts`,
    `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`,
    `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts`,
    `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.spec.ts`
  - REWRITE: `.../session-inspector/inspector-dock.controller.spec.ts`
  - REVERT to main: `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`,
    `.html`, `.css`, `.spec.ts`, `.../session-inspector/inspector-shell.controller.ts`
  - DELETE: `.../session-inspector/inspector-shell.controller.spec.ts`,
    `.../session-inspector/inspector-open-state.service.spec.ts`
  - Untouched: every `libs/frontend/chat-ui` file, `apps/ptah-electron-e2e/**`, peer-owned
    `chat-transcript.*`, `message-bubble.*`, `chat-input.component.ts`.
- Verification points:
  - Chat batch: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat --parallel=1`.
    The empty diff check from component 5.
  - Canvas batch: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/canvas --parallel=1`.
  - Phase close: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui
    @ptah-extension/chat @ptah-extension/canvas --parallel=1`. Confirm the header says 3 projects.
    No build, serve or e2e runs. The e2e selectors are kept by design: split "Open details" /
    "Session details" / "Close session details" and the `[data-details]` header toggle.
  - Grep: no `@ptah-extension/chat/src` or `chat-ui/src` deep imports in canvas, and no
    `toggleFromTab`, `bindHosted` or `reservedWidth` left anywhere.
  - Visual (Electron, canvas, dark + light at 1440 and 760, Git dock closed): Stats tab
    open/closed, grip and drag readout, max dock, cards at 300 and max, sm closed and open with
    rail auto-collapse, compact sheet < 400, split overlay unchanged. This also confirms A1 and R2.
