# Code Style Review — `TASK_2026_442_68ba`

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 9/10                                 |
| Assessment      | APPROVED                             |
| Blocking issues | 0                                    |
| Serious issues  | 0                                    |
| Minor issues    | 2                                    |
| Files reviewed  | 18                                   |

## Five style questions

### 1. What breaks in six months?

- **Extending named spans**: Adding a new span (e.g. `'quarter'`) requires updating the discriminated union `TILE_SPANS` and `SPAN_UNITS` in [`canvas-layout-intent.ts:7-16`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L7-L16), the UI menu options `SPAN_OPTIONS` in [`canvas-tile.component.ts:42-55`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-tile.component.ts#L42-L55), and the persistence schema. Because [`canvas-layout-persistence.service.ts:24`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts#L24) derives its enum from `TILE_SPANS`, existing v2 records will accept new spans in newer clients, but an older client reading that localStorage entry will fail validation and safely treat the record as unparseable without overwriting it.
- **Gridstack engine version upgrades**: [`canvas-workspace-grid.component.ts:285`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L285) probes `(grid as unknown as { onResize?: () => void }).onResize?.()`. If an upstream Gridstack upgrade renames internal resize hooks or alters the `batchUpdate(false)` change emission contract ([`canvas-workspace-grid.component.ts:251-256`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L251-L256)), the `_applyingLayout` guard relies on Gridstack continuing to emit its change events synchronously.

### 2. What would a new team member misread?

- **Dual focus models**: A newcomer might easily confuse [`focusedTabId`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas.store.ts#L131) and [`layoutFocusTabId`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas.store.ts#L162). `focusedTabId` represents the active chat session (synchronized with `TabManagerService`), whereas `layoutFocusTabId` is a transient full-width layout override. Calling `focusTile(tabId)` selects the chat tab without resizing, while `toggleLayoutFocus(workspacePath, tabId)` maximizes the tile into a full row without changing active chat selection or modifying stored intent.
- **Rendered width vs stored intent**: In narrow container viewports (`columnsFor(width) < 3`), a tile with stored intent `{ kind: 'span', span: 'third' }` is promoted by [`effectiveUnits`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L154-L162) to 6 or 12 units to maintain `MIN_TILE_WIDTH = 480`. A developer inspecting the DOM might expect stored intent to have changed, but [`isSpanChecked('third')`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-tile.component.ts#L424-L427) still evaluates to `true`, and widening the container restores the 4-unit projection without a store write.

### 3. What does this cost to maintain?

- Maintaining deterministic row packing and gesture projection across 12 grid units requires the pure math in [`canvas-layout-intent.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-layout-intent.ts) (Hamilton-apportionment in [`apportion()`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L260-L291) and ambiguity detection in [`projectDragIntent()`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L337-L447)). A simpler shape (e.g., standard CSS Grid) would require less code, but Gridstack requires explicit coordinate positioning `{x, y, w, h}`. This cost is well-mitigated because the packing logic is pure TypeScript without side-effects or framework dependencies, verified by extensive unit specs.

### 4. Where is this inconsistent with the rest of the repository?

- In [`canvas-layout-persistence.service.ts:141`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts#L141), `DestroyRef` is injected inline inside the `constructor()` body (`inject(DestroyRef).onDestroy(...)`), whereas other Angular services in this library (e.g. [`canvas-layout.service.ts:42`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-layout.service.ts#L42)) declare it as an injected class property `private readonly destroyRef = inject(DestroyRef);`.
- In [`canvas-workspace-grid.component.ts:189-191`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L189-L191), responsive capacity is calculated via `this.layoutService.columnsFor(this.layoutService.containerWidth())`, which duplicates the formula encapsulated within `this.layoutService.computeLayout()`, though here it is needed for the gesture snapshot.

### 5. What would you have done differently?

- In [`canvas-layout-persistence.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts), assign `destroyRef = inject(DestroyRef)` as a class property rather than calling `inject(DestroyRef)` inside constructor logic for uniform DI style.
- In [`canvas-tile.component.ts:491-497`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-tile.component.ts#L491-L497), instead of performing `menu.querySelectorAll<HTMLButtonElement>('button[data-layout-item]')` on every arrow keydown, use an Angular `viewChildren` signal or a static item list to query items declaratively.

---

## Blocking issues

None.

---

## Serious issues

None.

---

## Minor issues

### 1. Inconsistent `DestroyRef` injection pattern

- File: [`libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts:141`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts#L141)
- Problem: `inject(DestroyRef)` is called inline inside the constructor body, whereas sibling services (such as [`canvas-layout.service.ts:42`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-layout.service.ts#L42)) declare it as a class property `private readonly destroyRef = inject(DestroyRef)`.
- Impact: Stylistic inconsistency across services in the same library; both work identically at runtime.
- Fix: Declare `private readonly destroyRef = inject(DestroyRef);` alongside `vscode` at class property declaration level and reference `this.destroyRef.onDestroy(...)`.

### 2. Repeated DOM queries during keyboard navigation in tile layout popover

- File: [`libs/frontend/canvas/src/lib/canvas-tile.component.ts:491-497`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-tile.component.ts#L491-L497)
- Problem: `enabledLayoutItems()` traverses the DOM using `querySelectorAll` on every `ArrowDown`, `ArrowUp`, `Home`, and `End` keystroke.
- Impact: Unnecessary DOM queries for a small static 6-button list, though negligible in runtime cost.
- Fix: Cache the button element references or use an Angular query list when popover opens.

---

## File-by-file

### `libs/frontend/canvas/src/index.ts`
Score 10/10 — [0B, 0S, 0M]. Public API boundary is completely unchanged. Re-exports exact set of existing components and types, preserving `{ x, y, w, h }` for external consumers.

### `libs/frontend/canvas/src/lib/canvas-layout-intent.ts`
Score 10/10 — [0B, 0S, 0M]. Clean, pure functional core (448 lines). Encapsulates `TileWidthIntent`, deterministic 12-unit row packing, preset projections, resize snapping, and row-preserving deletion. Exhaustive discriminants and zero `any`.

### `libs/frontend/canvas/src/lib/canvas-layout.service.ts`
Score 10/10 — [0B, 0S, 0M]. Streamlined to 151 lines. Fully decoupled from Gridstack (0 Gridstack imports). `computeLayout` is a pure total projection safe for `computed()`. Preserves `TileLayout { x, y, w, h }`.

### `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts`
Score 9/10 — [0B, 0S, 1M]. Solid storage boundary (297 lines) using strict Zod 4 schemas. Handles lossless v1 migration to auto-weighted rows, preserves unknown future versions byte-intact, debounces writes with synchronous lifecycle flushes (`pagehide`, `beforeunload`, `visibilitychange`), and isolates error handling with `catch (error: unknown)` and bounded console warnings. Minor inline `DestroyRef` injection.

### `libs/frontend/canvas/src/lib/canvas.store.ts`
Score 9.5/10 — [0B, 0S, 0M]. Exemplary signal facade maintained at 694 lines (safely under the 700-line soft ceiling). Completely purged legacy `ColumnsPreference`, `effectiveCapacity`, and weight mutation methods. State partitioned cleanly by workspace; delegation to persistence service is robust.

### `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts`
Score 9.5/10 — [0B, 0S, 0M]. Standalone OnPush component (640 lines). The sole Gridstack writer in the library. Manages layout synchronization through a guarded effect with synchronous `_applyingLayout` flag in `try...finally`. Gesture transactions validate revision, responsive capacity, and complete membership before calling atomic store mutations.

### `libs/frontend/canvas/src/lib/canvas-tile.component.ts`
Score 9/10 — [0B, 0S, 1M]. Presentational standalone OnPush component (499 lines). Features accessible `NativePopoverComponent` layout menu with full ARIA semantics (`menuitemradio`, `menuitem`, `role="menu"`), keyboard navigation (ArrowDown/Up, Home/End), and lock-disabled buttons. Purely emits outputs (`spanRequested`, `layoutFocusToggled`, `rowBreakToggled`).

### `libs/frontend/canvas/src/lib/canvas-layout-controls.component.ts`
Score 10/10 — [0B, 0S, 0M]. Presentational preset dock (194 lines). Replaced legacy numeric 1/2/3 buttons with 3 descriptive presets (`even-grid`, `one-plus-two`, `focus-plus-stack`). Strict OnPush, signal inputs/outputs, accessible names, and lock state enforcement.

### `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts`
Score 10/10 — [0B, 0S, 0M]. Clean orchestrator (427 lines). Provides `CanvasStore`, `CanvasLayoutService`, and `CanvasLayoutPersistenceService` at panel scope. Replaced eager session tab restoration with authoritative tab-id hydration. Removed destructive teardown (`forceCloseTab`) on destroy in favor of persistence flush.

### `libs/frontend/canvas/CLAUDE.md`
Score 10/10 — [0B, 0S, 0M]. Fully updated documentation (53 lines) precisely describing the new width union, packing/preset/focus contracts, persistence ownership, hydration, lock, and single-writer boundaries.

### Specs (`*.spec.ts`)
Score 10/10 — [0B, 0S, 0M]. Comprehensive, high-fidelity testing across 8 spec suites. Covers mixed spans, auto weights, responsive fallback/restoration, preset projections, resize snapping, drag boundary ambiguity, Zod persistence boundary, v1 lossless migration, future version protection, gesture feedback loops, and keyboard/ARIA interactions. All 440 tests pass across `@ptah-extension/canvas` and `@ptah-extension/tribunal-panel`.

---

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| ------------------------------------ | ------ | -------- |
| Angular Standalone Components (no NgModules) | PASS | [`orchestra-canvas.component.ts:58`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/orchestra-canvas.component.ts#L58), [`canvas-workspace-grid.component.ts:69`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L69), [`canvas-tile.component.ts:81`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-tile.component.ts#L81) |
| Mandatory `ChangeDetectionStrategy.OnPush` | PASS | [`orchestra-canvas.component.ts:56`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/orchestra-canvas.component.ts#L56), [`canvas-workspace-grid.component.ts:68`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L68), [`canvas-tile.component.ts:80`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-tile.component.ts#L80) |
| Signals + `inject()` (no constructor parameter DI) | PASS | [`canvas.store.ts:81-82`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas.store.ts#L81-L82), [`canvas-layout.service.ts:42`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-layout.service.ts#L42), [`canvas-workspace-grid.component.ts:160-162`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L160-L162) |
| Zoneless compatibility (no Zone.js patching dependence) | PASS | Signals, computeds, effects, microtasks, and ResizeObserver used without Zone expectations |
| No `[innerHTML]` bindings | PASS | Verified 0 occurrences across all canvas templates |
| Effect hygiene (sparing usage, untracked where needed) | PASS | [`canvas-tile.component.ts:299-325`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-tile.component.ts#L299-L325), [`canvas-workspace-grid.component.ts:270-327`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L270-L327) |
| Single Gridstack writer boundary | PASS | Only [`canvas-workspace-grid.component.ts:12-20`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts#L12-L20) touches Gridstack; [`canvas-layout.service.ts:1-3`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-layout.service.ts#L1-L3) is completely Gridstack-free |
| Presentational controls (outputs only, no store mutation) | PASS | [`canvas-tile.component.ts:279-284`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-tile.component.ts#L279-L284), [`canvas-layout-controls.component.ts:140-142`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-layout-controls.component.ts#L140-L142) |
| Public API unchanged | PASS | [`libs/frontend/canvas/src/index.ts:1-10`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/index.ts#L1-L10) unchanged; [`canvas-layout.service.ts:24-29`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-layout.service.ts#L24-L29) keeps `TileLayout { x, y, w, h }` |
| Dead code elimination | PASS | `ColumnsPreference`, `effectiveCapacity`, `setTileWeights`, `commitResizeWeights` 100% removed across repo |
| Discriminated union type precision | PASS | [`canvas-layout-intent.ts:26-28`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-layout-intent.ts#L26-L28) discriminated on `kind: 'span' \| 'auto'` |
| Zero `any` and zero `@ts-ignore` | PASS | 0 occurrences in all production code |
| Narrowed `catch (error: unknown)` | PASS | [`canvas-layout-persistence.service.ts:164,173,260,284`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts#L164) |
| Zod validation at storage boundary | PASS | Zod schemas strictly contained in [`canvas-layout-persistence.service.ts:2-65`](file:///D:/projects/ptah-extension/.claude-worktrees/task-442-fluid-canvas-spans/libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts#L2-L65) |
| File size <= 700-line soft ceiling | PASS | `canvas.store.ts` kept to 694 lines; all other files <= 640 lines |
| Keyboard and a11y compliance | PASS | Popover menu ARIA roles (`menuitemradio`, `menuitem`), Arrow/Home/End navigation, Enter/Space activation, Escape return |

---

## Maintenance debt

- Introduced: Structured, discriminated `TileWidthIntent` with clean math separation in `canvas-layout-intent.ts` and explicit persistence in `canvas-layout-persistence.service.ts`.
- Retired: Rigid workspace-wide column capacity (`ColumnsPreference`), un discoverable continuous relative weights as resize output, numeric cap dock buttons, and destructive component teardown that forced closed tabs.
- Net: Significantly negative debt. Replaces legacy ad-hoc weights and global column caps with an intent-driven model that is pure, deterministic, accessible, and resilient to crashes and container resizing.

---

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: Ensure that when future tasks expand tile features (such as tall tile tiers or compact chips), vertical constraints continue to be resolved purely in `canvas-layout-intent.ts` rather than leaking into Gridstack event handlers.
- What a 10/10 version would do differently: Align the `DestroyRef` injection in `CanvasLayoutPersistenceService` to use a property field, and cache button elements in `CanvasTileComponent` to eliminate querySelectorAll traversals during keyboard navigation.
