# Implementation Batches: TASK_2026_416_2060

## Batch 1: Shell Activity Notification Clearance

- **Target**: `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`
- **Goal**: Fix activity toast placement from `top-6` (24px, overlapping the 40px `h-10` navbar) to `top-11` (44px, clearing navbar by 4px) as verified in `electron-shell.activity-toast.spec.ts`.
- **Verification**: Run `npx nx test @ptah-extension/chat --testFile=electron-shell.activity-toast.spec.ts`.

## Batch 2: Expandable Icon Layout Controls

- **Target**: `libs/frontend/canvas/src/lib/canvas-layout-controls.component.ts`, `libs/frontend/canvas/src/lib/canvas-layout-controls.component.spec.ts`
- **Goal**:
  - Replace numeric buttons ('Auto', '1', '2', '3') with a floating-looking layout trigger that expands into four icon actions:
    1. 1 Column (`Square` icon)
    2. 2 Columns (`Columns2` icon)
    3. 3 Columns (`Columns3` icon)
    4. Lock / Unlock (`Lock`/`Unlock` icon)
  - Accessible labels, tooltips (`title`), active states (`btn-active`, `aria-pressed`).
  - Keyboard accessible, Escape key and outside click dismiss.
  - Preserve responsive Auto default internally without a 5th button (clicking active column resets to Auto).
  - Support disabled states when locked or inapplicable (singleton).

## Batch 3: Canvas Reserved Control Dock & Viewport Measurement

- **Target**: `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts`
- **Goal**:
  - Remove absolute overlay controls: layout controls (top-right overlapping close '×'), lock button (bottom-right), and new-session FAB (bottom-right overlapping composer send).
  - Reserve a slim control dock rail (`canvas-dock`) outside the session viewport.
  - Place layout trigger and New Session button in the reserved control dock.
  - Re-target `ResizeObserver` to observe `#sessionViewport` (usable space after dock rail allocation) instead of full outer canvas.

## Batch 4: Singleton Fill & Handle Suppression

- **Target**: `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts`, `libs/frontend/canvas/src/lib/canvas-layout.service.ts`
- **Goal**:
  - When a single tile is present (`tiles.length === 1`), disable drag and resize handles (`noMove: true, noResize: true`, CSS hide resize handles and default cursor on header).
  - Singleton tile fills 100% of usable viewport without gaps or rounding loss.
  - Multi-session preserves weighted horizontal resizing and header dragging when unlocked.
  - Singleton immobility is separate from `locked` state (`locked` is not forced to true).
  - Keep-alive contract preserved: 1 -> 2 -> 1 tile transitions do not remount existing chat instances.

## Batch 5: Regression Tests, Verification & Reporting

- **Target**: Canvas and Chat test suites, `implementation-report.md`, `agent-output-antigravity.md`
- **Goal**:
  - Add focused unit tests covering non-overlapping reserved dock, singleton geometry/handle suppression, and 1->2->1 keep-alive.
  - Run scoped tests via `npx nx run-many --targets=test --projects=@ptah-extension/canvas,@ptah-extension/chat`.
  - Check diagnostics and attempt e2e checks if environment permits.
  - Produce comprehensive implementation report.
