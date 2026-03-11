# Implementation Plan - TASK_2025_172: Right Sidebar Resizer

## Codebase Investigation Summary

### Libraries Verified

- **@angular/cdk@^20.2.14**: Installed and available
  - `CdkDrag` directive: standalone=true, selector `[cdkDrag]` (verified: `node_modules/@angular/cdk/drag-drop/index.d.ts:773`)
  - `cdkDragLockAxis` input: accepts `'x' | 'y'` (verified: line 655-656)
  - `cdkDragMoved` output: emits `CdkDragMove<T>` with `pointerPosition: { x, y }` (verified: lines 522-547)
  - `source.element`: `ElementRef<HTMLElement>` (verified: line 638)
  - CDK drag is NOT currently used anywhere in the project (grep confirmed)

### Patterns Identified

- **Signal-based state**: All component state uses Angular signals, not BehaviorSubject
  - Evidence: `AgentMonitorStore._panelOpen = signal(false)` (agent-monitor.store.ts:52)
  - Evidence: `AppShellComponent._sidebarOpen = signal(false)` (app-shell.component.ts:120)
- **ChangeDetectionStrategy.OnPush**: All components use OnPush
  - Evidence: app-shell.component.ts:101, agent-monitor-panel.component.ts:21
- **Inline templates and styles**: AgentMonitorPanelComponent uses inline template+styles
  - Evidence: agent-monitor-panel.component.ts:22-102
- **DaisyUI + Tailwind CSS**: All styling uses utility classes
  - Evidence: app-shell.component.html throughout

### Current Layout Architecture

- **App Shell** (app-shell.component.html:38): `<div class="flex h-full">`
  - Left sidebar `<aside>`: toggles between `w-0` and `w-56` (224px) via signal
  - Main content `<div class="flex-1 flex flex-col min-w-0">`: flexbox grows to fill
  - Right sidebar `<ptah-agent-monitor-panel />`: fixed responsive widths via CSS classes
- **Agent Monitor Panel** (agent-monitor-panel.component.ts:22-36): CSS-based responsive widths
  - `.agent-panel-open { width: 460px }` (default)
  - `@media (min-width: 1280px) { .agent-panel-open { width: 540px } }` (xl)
  - `@media (min-width: 1536px) { .agent-panel-open { width: 640px } }` (2xl)
  - Panel close: toggles `w-0` class, has `transition-all duration-300`
  - Internal `min-width: 460px` on header and agent list (lines 47, 79)
- **Panel open/close**: controlled by `AgentMonitorStore._panelOpen` signal
  - `togglePanel()`, `openPanel()`, `closePanel()` methods (store lines 108-119)
  - `_userExplicitlyClosed` flag prevents auto-reopen (store line 54)

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: CDK drag-based resize handle placed in the app-shell template, with width state managed in `AgentMonitorStore`.

**Rationale**:

1. The resize handle logically belongs between the main content and the panel -- this boundary lives in `app-shell.component.html` (line 301-304).
2. Width state belongs in `AgentMonitorStore` because it already owns the panel open/close state and is injected by both app-shell and the panel component.
3. Using `CdkDrag` with `cdkDragLockAxis="x"` and manual `transform: none` reset follows the proven pattern from the reference article while using a verified CDK API.

### Key Design Decisions

**1. Handle Placement: In app-shell, not inside agent-monitor-panel**

The resize handle is a divider between two siblings in the flex layout. Placing it inside the panel component would require the panel to "reach outside itself" to affect layout. Instead, the handle is a sibling element in app-shell.component.html between the main content div and `<ptah-agent-monitor-panel />`.

**2. Width calculation: `viewport - pointerX - leftSidebarWidth` is wrong; use `viewport - pointerX` directly**

Since the right sidebar is flush against the right edge of the viewport, the width is simply `window.innerWidth - event.pointerPosition.x`. The left sidebar width does not factor in because we want the right panel to extend from the drag position to the right edge. (The flex layout handles the remaining space automatically.)

Actually, more precisely: since we're in a flex container, and the panel is the rightmost child, the panel width = `containerRight - pointerX`. We use `this.hostElement.nativeElement.closest('.flex')` or simply compute from the bounding rect of the flex container. However, in a VS Code webview the flex container IS the full width, so `window.innerWidth - pointerX` is correct in practice. To be robust, we compute from the flex container's right edge.

**3. Drag overrides responsive CSS: Yes**

When the user drags, a pixel width signal takes over via `[style.width.px]`. This inline style has higher specificity than the `.agent-panel-open` class-based widths. When width is `null` (no drag has occurred, or user double-clicks to reset), the responsive CSS classes apply again.

**4. Panel reopen behavior: Restore last dragged width**

When the panel is closed and reopened, it should use the last user-set width (if any). The `customWidth` signal persists across open/close cycles. Only double-click resets it to `null` (falling back to responsive CSS).

**5. Min/Max constraints**

- Min width: 300px (enough to show agent cards usably)
- Max width: 60% of viewport (prevents chat area from becoming unusable)
- Enforced in the `onResizeMoved` handler via `Math.min(Math.max(...))` clamping

**6. Double-click to reset**

A `(dblclick)` handler on the resize handle sets `customWidth` back to `null`, re-enabling the responsive CSS classes.

---

## Component Specifications

### Component 1: AgentMonitorStore -- Add width state

**Purpose**: Extend the existing store to hold the user's custom panel width.

**Pattern**: Signal-based store (matches existing pattern)
**Evidence**: agent-monitor.store.ts lines 51-53, same `signal()` + `computed()` pattern

**Changes**:

- Add `_customWidth = signal<number | null>(null)` -- `null` means "use responsive CSS defaults"
- Add `customWidth = computed(() => this._customWidth())` public readonly
- Add `setCustomWidth(width: number | null): void` method
- Add `resetWidth(): void` method (sets to null)

**Quality Requirements**:

- `null` width means responsive CSS takes precedence (no inline style)
- Non-null width is clamped between MIN_PANEL_WIDTH (300) and maxWidth (computed at drag time)
- Width persists across panel open/close (not reset when panel closes)
- Width resets to null on explicit double-click reset

**Files Affected**:

- `libs/frontend/chat/src/lib/services/agent-monitor.store.ts` (MODIFY)

---

### Component 2: AgentMonitorPanelComponent -- Accept width override

**Purpose**: Modify the panel to accept and apply a custom pixel width, overriding responsive CSS when set.

**Pattern**: Signal input + conditional inline style binding
**Evidence**: Panel already uses class-based width toggle (agent-monitor-panel.component.ts:40-41)

**Changes**:

- Inject `AgentMonitorStore` (already injected as `store`)
- Bind width via `[style.width.px]="store.customWidth()"` on the `<aside>` element
  - When `customWidth()` is `null`, Angular does not apply the style, so the `.agent-panel-open` CSS class governs width
  - When `customWidth()` is a number, the inline style overrides the class-based width
- The `agent-panel-open` class STAYS applied (it handles the non-dragged responsive case)
- Update internal `min-width: 460px` on header/list to `min-width: 300px` to allow narrower panel when dragged
- The `transition-all duration-300` class should be conditionally removed during active drag to prevent laggy resizing, then restored after drag ends. This can be done via a `dragging` signal.

**Files Affected**:

- `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts` (MODIFY)

---

### Component 3: Resize Handle in AppShellComponent

**Purpose**: Add a draggable resize handle between the main content area and the agent monitor panel.

**Pattern**: CdkDrag directive on a thin handle element
**Evidence**: CdkDrag verified as standalone directive (CDK index.d.ts:773), not used elsewhere in project yet

**Responsibilities**:

- Render a 6px-wide vertical handle bar between main content and panel
- Use `cdkDrag` with `cdkDragLockAxis="x"` to constrain to horizontal movement
- On `(cdkDragMoved)`: compute new width, clamp, update store, reset transform
- On `(dblclick)`: reset width to null (responsive default)
- Show `col-resize` cursor on handle and during drag
- Show subtle visual indicator (grip dots or line) on hover
- Only visible when panel is open

**Implementation Pattern** (verified CDK API):

```typescript
// In template (between main content div and <ptah-agent-monitor-panel />):
@if (agentMonitorStore.panelOpen()) {
  <div
    class="resize-handle"
    cdkDrag
    cdkDragLockAxis="x"
    (cdkDragMoved)="onResizeMoved($event)"
    (cdkDragStarted)="onResizeStarted()"
    (cdkDragEnded)="onResizeEnded()"
    (dblclick)="onResizeReset()"
  ></div>
}

// In component class:
import { CdkDrag, CdkDragMove, CdkDragStart } from '@angular/cdk/drag-drop';

// Add CdkDrag to imports array

private readonly MIN_PANEL_WIDTH = 300;
private readonly MAX_PANEL_WIDTH_RATIO = 0.6; // 60% of viewport

onResizeMoved(event: CdkDragMove): void {
  // Reset CDK's built-in transform (we don't want the handle to move, we want the panel to resize)
  event.source.element.nativeElement.style.transform = 'none';

  // Panel width = distance from pointer to right edge of viewport
  const newWidth = window.innerWidth - event.pointerPosition.x;
  const maxWidth = window.innerWidth * this.MAX_PANEL_WIDTH_RATIO;
  const clampedWidth = Math.min(Math.max(newWidth, this.MIN_PANEL_WIDTH), maxWidth);

  this.agentMonitorStore.setCustomWidth(clampedWidth);
}

onResizeStarted(): void {
  this.agentMonitorStore.setDragging(true);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none'; // Prevent text selection during drag
}

onResizeEnded(): void {
  this.agentMonitorStore.setDragging(false);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

onResizeReset(): void {
  this.agentMonitorStore.resetWidth();
}
```

**Resize Handle Styles** (in app-shell or via Tailwind utilities):

```css
.resize-handle {
  width: 6px;
  cursor: col-resize;
  background: transparent;
  position: relative;
  flex-shrink: 0;
  z-index: 10;
  transition: background-color 150ms;
}

.resize-handle:hover {
  background-color: oklch(var(--p) / 0.3); /* DaisyUI primary with opacity */
}

.resize-handle:active {
  background-color: oklch(var(--p) / 0.5);
}

/* Grip indicator (3 dots) */
.resize-handle::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 2px;
  height: 24px;
  border-radius: 1px;
  background-color: oklch(var(--bc) / 0.2); /* base-content with opacity */
  transition: background-color 150ms;
}

.resize-handle:hover::after {
  background-color: oklch(var(--bc) / 0.4);
}
```

**Files Affected**:

- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` (MODIFY)
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` (MODIFY)

---

## Integration Architecture

### Data Flow

```
User drags handle
  -> (cdkDragMoved) fires in AppShellComponent
  -> AppShellComponent.onResizeMoved() computes clamped width
  -> AgentMonitorStore.setCustomWidth(width) updates signal
  -> AgentMonitorPanelComponent reads store.customWidth() via [style.width.px]
  -> Panel resizes instantly (no transition during drag)
  -> Main content flex-1 auto-adjusts
```

### Signal Dependencies

```
AgentMonitorStore:
  _customWidth: signal<number | null>  (new)
  _dragging: signal<boolean>           (new)
  customWidth: computed                 (new, public readonly)
  dragging: computed                    (new, public readonly)
  panelOpen: computed                   (existing, unchanged)

AppShellComponent:
  Reads: agentMonitorStore.panelOpen() (existing, for @if on handle)
  Writes: agentMonitorStore.setCustomWidth(), setDragging(), resetWidth()

AgentMonitorPanelComponent:
  Reads: store.customWidth() (new, for [style.width.px])
  Reads: store.dragging() (new, for conditional transition class)
```

### Interaction with Panel Open/Close

1. **Panel closes**: `w-0` class applied, `customWidth` stays in store (not reset)
2. **Panel reopens**: `agent-panel-open` class applied. If `customWidth()` is non-null, inline `style.width.px` overrides the class-based width. Panel reopens at last dragged width.
3. **Panel close transition**: `transition-all duration-300` is always applied when NOT dragging. When dragging, the class is removed to prevent laggy resize. Store's `dragging` signal controls this.

### Interaction with Left Sidebar

No interaction needed. The left sidebar toggles `w-0`/`w-56`, the main content is `flex-1`, and the right panel width is absolute. Flexbox handles the space distribution automatically.

---

## Quality Requirements

### Functional Requirements

- Dragging the handle left increases panel width; dragging right decreases it
- Panel width is clamped between 300px and 60% of viewport width
- Handle is only visible when panel is open
- Double-clicking the handle resets to responsive CSS defaults
- Cursor shows `col-resize` on handle hover and during drag
- Handle shows subtle visual indicator (thin line, highlighted on hover)
- Panel reopens at last dragged width
- No text selection during drag

### Non-Functional Requirements

- **Performance**: Transform reset on every `cdkDragMoved` event prevents DOM reflow; signal update is O(1)
- **Accessibility**: Handle should have `role="separator"` and `aria-orientation="vertical"` for screen readers
- **Visual polish**: Smooth hover transition on handle, no jank during resize
- **Edge cases**: Handle window resize (viewport shrink may push custom width beyond max -- clamp reactively)

### Pattern Compliance

- Signal-based state only (no BehaviorSubject) -- matches store pattern (agent-monitor.store.ts:51-52)
- ChangeDetectionStrategy.OnPush on all components (app-shell.component.ts:101)
- DaisyUI/Tailwind classes for styling (entire codebase convention)
- Standalone component imports (CdkDrag is standalone, verified at CDK index.d.ts:773)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: frontend-developer

**Rationale**:

- Pure Angular template + component + store work
- CDK drag-drop directive integration (browser/DOM)
- CSS/Tailwind styling for the resize handle
- No backend or extension host changes needed

### Complexity Assessment

**Complexity**: LOW-MEDIUM
**Estimated Effort**: 1-2 hours

**Breakdown**:

- Store changes (add signals + methods): ~15 min
- Panel component (width binding + transition toggle): ~15 min
- App-shell template (handle element + CdkDrag): ~30 min
- App-shell component (event handlers): ~20 min
- CSS styling for handle: ~15 min
- Testing + edge cases: ~15 min

### Files Affected Summary

**MODIFY**:

- `libs/frontend/chat/src/lib/services/agent-monitor.store.ts` -- Add `_customWidth`, `_dragging` signals and methods
- `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts` -- Add `[style.width.px]` binding, conditional transition, update min-width
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` -- Add resize handle element between main content and panel
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` -- Add CdkDrag import, resize handlers, constants

### Critical Verification Points

**Before implementation, developer must verify**:

1. **CdkDrag import**:

   - `import { CdkDrag } from '@angular/cdk/drag-drop'` (verified: CDK index.d.ts:1409)
   - Add `CdkDrag` to component `imports` array (standalone directive)
   - `CdkDragMove` type: `import type { CdkDragMove } from '@angular/cdk/drag-drop'` (verified: index.d.ts:1410)

2. **CdkDragMove.pointerPosition** is `{ x: number, y: number }` (verified: index.d.ts:526-529)

3. **CdkDrag.element** is `ElementRef<HTMLElement>` (verified: index.d.ts:638) -- used for `event.source.element.nativeElement.style.transform = 'none'`

4. **`[style.width.px]="null"`** in Angular: when bound to `null`, Angular removes the inline style attribute, allowing CSS classes to take effect. This is the mechanism for "responsive fallback".

5. **No hallucinated APIs**: All CDK APIs verified against `node_modules/@angular/cdk/drag-drop/index.d.ts`

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase (signal-based store, OnPush, DaisyUI)
- [x] All imports/decorators verified as existing (CdkDrag standalone, CdkDragMove type)
- [x] Quality requirements defined (functional + non-functional)
- [x] Integration points documented (store -> panel, app-shell -> store)
- [x] Files affected list complete (4 files, all MODIFY)
- [x] Developer type recommended (frontend-developer)
- [x] Complexity assessed (LOW-MEDIUM, 1-2 hours)
- [x] No backward compatibility layers (direct replacement of fixed widths)
- [x] No code duplication
