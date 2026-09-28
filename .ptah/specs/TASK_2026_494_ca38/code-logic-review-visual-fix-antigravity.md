# Code Logic Review: Apps Page & Declarative Dashboard Visual Fix (R10)

Score: 10/10
Verdict: APPROVED

---

## Executive Summary

The uncommitted changes across `libs/frontend/mcp-apps-page`, `libs/frontend/declarative-dashboard`, and task documentation resolve all R10 visual review findings cleanly and robustly. The implementation establishes a single source of truth for Apps page column stacking via CSS container queries, fixes accessibility tree duplication on the splitter, matches the compact stat tile design from the visual prototype, and maintains full type safety, test coverage, and performance bounds.

---

## Scope & Intent Verification

### 1. Stacking Boundary at 606px (`CONVERSATION_MIN_WIDTH 240 + SPLIT_HANDLE_WIDTH 6 + SURFACE_MIN_WIDTH 360`)
- **Evidence**: `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts:50-54`, `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts:99-117`
- **Verification**:
  - `APPS_STACK_BELOW_WIDTH` is computed from `CONVERSATION_MIN_WIDTH (240) + SPLIT_HANDLE_WIDTH (6) + SURFACE_MIN_WIDTH (360) = 606`.
  - The CSS container query `@container apps-page (width < 606px)` handles column stacking:
    - At `width = 605px`: `width < 606px` evaluates to `true`; columns collapse to single-column vertical flow (`grid-template-columns: minmax(0, 1fr)`), the splitter is hidden (`display: none`), and conversation column height is capped at 260px.
    - At `width = 606px`: `width < 606px` evaluates to `false`; side-by-side layout activates. `splitMaxWidth` computes `Math.max(240, 606 - 6 - 360) = 240px`, ensuring conversation column is 240px, handle is 6px, and surface panel receives exactly 360px. Both minimum width requirements are satisfied simultaneously without fractional rounding tears.

### 2. Single Source of Truth for Stacking (Zero Frame Tear)
- **Evidence**: `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts:253-282`, `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts:305-316`
- **Verification**:
  - The previous `@if (!stacked())` Angular conditional has been eliminated from the template. The splitter element `.apps-split-handle-slot` remains permanently in the DOM and its visibility is strictly governed by CSS (`display: none` inside `@container apps-page (width < 606px)`).
  - The `containerWidth` signal driven by `ResizeObserver` is decoupled from DOM presence and now solely calculates `splitMaxWidth`. Because layout transitions are synchronous within the CSS engine, the grid layout and splitter visibility can never tear or disagree across macrotask ticks.

### 3. Assistive Technology & WCAG Compliance
- **Evidence**: `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts:258-282`, `libs/frontend/mcp-apps-page/src/lib/components/apps-page-splitter.spec.ts:389-402`
- **Verification**:
  - The parent slot `div.apps-split-handle-slot` exposes the single `role="separator"` with complete ARIA attributes (`tabindex="0"`, `aria-orientation="vertical"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-label`, `aria-controls`).
  - The nested child component `<ptah-electron-resize-handle>` is explicitly marked with `aria-hidden="true"`.
  - Under `ptah-electron-resize-handle`, the inner grip is a plain `<div class="resize-handle">` that carries no `tabindex`, `<button>`, `<a>`, or `<input>`. Therefore, no focusable elements exist under an `aria-hidden` subtree, satisfying WCAG 4.1.2.
  - When stacked (`width < 606px`), `display: none` automatically removes the separator from the accessibility tree and sequential tab navigation. `AppsFocusMemoryDirective.canFocus` verifies `getComputedStyle(node).display !== 'none'` before restoring focus, cleanly preventing attempted focus restoration to the hidden splitter.

### 4. Splitter Persistence and Clamping Immunity
- **Evidence**: `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts:305-316`, `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts:370-425`
- **Verification**:
  - When the page width drops below 606px (e.g. 500px), `splitMaxWidth` computes `Math.max(240, 500 - 6 - 360) = 240px`, and `splitWidth()` clamps the rendered CSS variable `--apps-conversation-width` to 240px.
  - However, neither `splitMaxWidth` nor `splitWidth` mutates `ElectronLayoutService.appsSplitWidth()`. The stored user preference (e.g. 450px) remains intact in the service.
  - When the container expands back above 606px (e.g. 1000px), `splitMaxWidth` expands to 634px and `splitWidth` immediately restores the stored 450px. No state loss or unintended persistence clamping occurs.
  - Drag and keyboard commit handlers (`onSplitDragEnded`, `commitKeyResize`) only persist when active gesture state (`this.drag`, `this.keyRunStartStored`) is non-null and differs from the stored value, ensuring window resizing while idle never triggers spurious writes.

### 5. Declarative Dashboard: Compact Stat Tiles & Root Grid
- **Evidence**:
  - `libs/frontend/declarative-dashboard/src/lib/components/dashboard-stat.component.ts:15-32`
  - `libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.ts:187-198`
- **Verification**:
  - Top-level `surface-root` is converted to `grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-2 gap-y-4`.
  - Direct children: `header` carries `col-span-full`. Each child `<ptah-surface-node>` conditionally binds `[class.col-span-full]="node.kind !== 'stat'"`.
  - Root `stat` components flow several across (at 9rem min-width, 2 tiles fit within the 360px surface minimum, expanding up to 4+ on wider viewports).
  - All non-stat root nodes (`chart`, `table`, `list`, `section`, `card`, `stack`, `grid`, etc.) receive `col-span-full` and span the entire grid row, preserving standard vertical stack layout.
  - Nested components inside container nodes (`section`, `card`, `grid`) are rendered by `SurfaceLayoutComponent` via template outlet and remain completely unaffected by the root grid.
  - Delta is formatted inline in the stat header line: decorative `&Delta; ` is marked `aria-hidden="true"`, paired with `<span class="sr-only">Change </span>` and `signedDelta()` (explicit `+` for gains, e.g. `+2`, `0`, `-2`).
  - B9 render budget constraints (`budget-render.spec.ts`) pass with zero regressions, retaining exactly one expand button per stat card.

### 6. Stylesheet Const Export & View Encapsulation
- **Evidence**: `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts:69-122`, `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts:134`
- **Verification**:
  - Moving the stylesheet to exported constant `APPS_PAGE_STYLES` allows test suites to verify container query syntax directly (since Jest/JSDOM strips `<style>` blocks).
  - Angular's compiler processes `styles: [APPS_PAGE_STYLES]` with standard `ViewEncapsulation.Emulated`, generating identical scoped attributes `[_nghost-...]` and `[_ngcontent-...]`.
  - `:host` carries `container-type: inline-size; container-name: apps-page;`, correctly establishing the query container for its child layout elements.

### 7. Documentation & Revision Note
- **Evidence**: `.ptah/specs/TASK_2026_494_ca38/prototype/README.md:154`, `.ptah/specs/TASK_2026_494_ca38/batches.md:32-72`
- **Verification**:
  - `prototype/README.md` explicitly records the 2026-09-26 user decision updating the stacking breakpoint from 480px to 606px (`CONVERSATION_MIN_WIDTH 240 + SPLIT_HANDLE_WIDTH 6 + SURFACE_MIN_WIDTH 360`).
  - `batches.md` contains the complete audit trail and R10 visual review rulings.

---

## Verification Results

1. **Unit & Spec Tests**:
   - `mcp-apps-page`: 16 test suites passed, 288 tests passed.
   - `declarative-dashboard`: 17 test suites passed, 216 tests passed (including all budget-render and trust-boundary cases).
2. **Linting**:
   - `mcp-apps-page`: 0 errors, 0 warnings.
   - `declarative-dashboard`: 0 errors.
3. **Type Checking**:
   - `mcp-apps-page`: Passed cleanly (0 errors; baseline TS2352 errors in mock-rpc-service/monaco-loader preserved).
   - `declarative-dashboard`: Passed cleanly (0 errors).
4. **Production Build**:
   - `ptah-extension-webview`: Built successfully in production mode (`apps-page.component` lazy chunk: 61.50 kB raw / 17.84 kB transfer).
5. **Line Limits**:
   - `apps-page.component.ts`: 482 lines (soft ceiling 700).
   - `apps-page-splitter.spec.ts`: 532 lines.
   - `surface-renderer.component.ts`: 394 lines.
   - `dashboard-stat.component.ts`: 70 lines.
   - All files are well within architectural limits.

---

## Findings

### Blocking
None.

### Serious
None.

### Minor
None.
