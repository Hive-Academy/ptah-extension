# TASK_2026_176 Implementation Report

## Files changed

| Absolute path                                                                                             | What changed                                                                                                            |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `D:/projects/ptah-extension/libs/frontend/chat-ui/src/lib/atoms/electron-resize-handle.component.ts`      | Replaced per-event `ngZone.run()` with rAF coalescing; added blur/Escape teardown and original-width restore.           |
| `D:/projects/ptah-extension/libs/frontend/chat-ui/src/lib/atoms/electron-resize-handle.component.spec.ts` | Updated legacy tests for coalesced behaviour; added B5-shaped coalescing + blur/Escape + destroy tests.                 |
| `D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`       | Moved panel resize `pointermove` outside the zone with rAF coalescing; added blur/Escape teardown and `ngOnDestroy`.    |
| `D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts`  | Added `realPanelResize` harness option and B5-shaped coalescing + blur/Escape + destroy tests.                          |
| `D:/projects/ptah-extension/libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts`          | Added blur/Escape teardown with original-size restore to all three existing coalesced drags (sidebar, terminal, split). |
| `D:/projects/ptah-extension/libs/frontend/editor/src/lib/editor-panel/editor-panel.component.spec.ts`     | Added blur/Escape teardown tests for all three drag surfaces.                                                           |
| `D:/projects/ptah-extension/.ptah/specs/TASK_2026_173/tasks.md`                                           | Marked Task 4.4 as folded into TASK_2026_176 so the work is not duplicated.                                             |
| `D:/projects/ptah-extension/.ptah/specs/TASK_2026_176/task.md`                                            | Status changed from `backlog` to `done`.                                                                                |

## Site audit

### `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts`

Already coalesced in TASK_2026_173 B5. This task added the missing blur/Escape interruption path.

### `libs/frontend/chat-ui/src/lib/atoms/electron-resize-handle.component.ts`

**Before**

```ts
this.ngZone.runOutsideAngular(() => {
  this.mouseMoveHandler = (e: MouseEvent) => {
    const pointerX = e.clientX;
    const width =
      this.direction() === 'left' ? pointerX : window.innerWidth - pointerX;
    this.ngZone.run(() => this.dragMoved.emit(width)); // once per native event
  };
  document.addEventListener('mousemove', this.mouseMoveHandler);
  ...
});
```

The `runOutsideAngular` was ineffective because the inner `ngZone.run()` re-entered on every event.

**After**

```ts
this.ngZone.runOutsideAngular(() => {
  let latestEvent: MouseEvent | null = null;

  const applyLatest = (): void => {
    this.dragFrame = null;
    const e = latestEvent;
    latestEvent = null;
    if (!e) return;
    const pointerX = e.clientX;
    const width =
      this.direction() === 'left' ? pointerX : window.innerWidth - pointerX;
    this.ngZone.run(() => this.dragMoved.emit(width));
  };

  this.mouseMoveHandler = (e: MouseEvent) => {
    latestEvent = e;
    if (this.dragFrame === null) {
      this.dragFrame = requestAnimationFrame(applyLatest);
    }
  };

  const endDrag = (restore = false): void => {
    this.cancelDragFrame();
    if (restore && startWidth !== null) {
      this.ngZone.run(() => this.dragMoved.emit(startWidth));
    } else {
      applyLatest();
    }
    this.cleanup();
    this.ngZone.run(() => this.dragEnded.emit());
  };
  ...
  window.addEventListener('blur', this.blurHandler);
  document.addEventListener('keydown', this.keydownHandler);
});
```

The only `ngZone.run()` is inside `applyLatest`, which runs at most once per animation frame.

### `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`

**Before**

```ts
private readonly onResizeMove = (event: PointerEvent): void => {
  if (event.pointerId !== this.resizePointerId) return;
  const host = this.hostEl.nativeElement;
  const newWidth = host.getBoundingClientRect().right - event.clientX;
  this.panelResizeService.setCustomWidth(newWidth, host.clientWidth);
};
...
handle.addEventListener('pointermove', this.onResizeMove);
```

The listener ran inside the Angular zone and called `getBoundingClientRect()` once per `pointermove`.

**After**

```ts
private readonly onResizeMove = (event: PointerEvent): void => {
  if (event.pointerId !== this.resizePointerId) return;
  this._latestResizeEvent = event;
  if (this._resizeFrame === null) {
    this._resizeFrame = requestAnimationFrame(this._applyResize);
  }
};

private readonly _applyResize = (): void => {
  this._resizeFrame = null;
  const event = this._latestResizeEvent;
  this._latestResizeEvent = null;
  if (!event || this._hostRight === null) return;
  const newWidth = this._hostRight - event.clientX;
  this.ngZone.run(() =>
    this.panelResizeService.setCustomWidth(newWidth, this.hostEl.nativeElement.clientWidth),
  );
};
```

Pointer capture, `pointerup`/`pointercancel`/`lostpointercapture`, and the new blur/Escape listeners are registered inside `runOutsideAngular`. `getBoundingClientRect()` moved from every event to the frame callback.

### `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts`

**Before (B5)**

```ts
this._resizeMouseUp = () => {
  this.cancelDragFrame();
  applyLatest();
  this.cleanupResizeListeners();
};
document.addEventListener('mousemove', this._resizeMouseMove);
document.addEventListener('mouseup', this._resizeMouseUp);
```

**After**

```ts
const endDrag = (restore = false): void => {
  this.cancelDragFrame();
  if (restore) {
    this.ngZone.run(() => this.editorService.setTerminalHeight(originalHeight));
  } else {
    applyLatest();
  }
  this.cleanupResizeListeners();
};

this._resizeMouseUp = () => endDrag(false);
this._resizeBlurHandler = () => endDrag(true);
this._resizeKeydownHandler = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    endDrag(true);
  }
};

document.addEventListener('mousemove', this._resizeMouseMove);
document.addEventListener('mouseup', this._resizeMouseUp);
window.addEventListener('blur', this._resizeBlurHandler);
document.addEventListener('keydown', this._resizeKeydownHandler);
```

Same shape applied to the terminal, sidebar, and split-divider drags; each saves its original value and restores it on blur/Escape.

### `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts`

Audited and left unchanged. It imports `NgZone` only for the low-frequency wheel listener and `ResizeObserver` callback; there is no drag/pointer-move handler and therefore no per-event re-entry defect.

## Zone re-entry boundaries

| Site                     | Where listeners run | Where zone is re-entered                                | Why that boundary is sufficient                                                       |
| ------------------------ | ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `electron-resize-handle` | `runOutsideAngular` | `applyLatest` once per rAF                              | `dragMoved` is the only template-observable output.                                   |
| `chat-view` resize       | `runOutsideAngular` | `_applyResize` once per rAF                             | `panelResizeService.customWidth()` and `dragging()` are signals read by the template. |
| `editor-panel` terminal  | `runOutsideAngular` | `applyLatest` once per rAF, plus restore on blur/Escape | `terminalHeight` is written through `editorService.setTerminalHeight`.                |
| `editor-panel` sidebar   | `runOutsideAngular` | `applyLatest` once per rAF, plus restore on blur/Escape | `sidebarWidth` signal is read by the sidebar template.                                |
| `editor-panel` split     | `runOutsideAngular` | `applyLatest` once per rAF, plus restore on blur/Escape | `splitLeftPercent` signal drives the split pane flex style.                           |

## Live drag feedback test

`chat-view.component.spec.ts` uses a real `PanelResizeService` and asserts:

```ts
startDrag(600);
moveTo(700); // width 300 → min 300
moveTo(600); // width 400 → 400
moveTo(500); // width 500 → 500

tickFrame();
expect(service.customWidth()).toBe(500);
```

This proves the template-bound `customWidth` signal still updates during a drag; it just updates once per frame instead of once per event. The analogous `electron-resize-handle` and `editor-panel` tests assert that a burst of input events produces exactly one observable update and that the latest position is the one applied.

## Verification totals

### Baseline (before edits)

| Project                   | Test suites | Tests      | Skipped | Typecheck                        |
| ------------------------- | ----------- | ---------- | ------- | -------------------------------- |
| `@ptah-extension/editor`  | 13 passed   | 172 passed | 0       | green                            |
| `@ptah-extension/chat`    | 50 passed   | 652 passed | 2       | green (one pre-existing warning) |
| `@ptah-extension/chat-ui` | 18 passed   | 79 passed  | 0       | green                            |

### Post-edit

| Project                   | Test suites | Tests      | Skipped | Typecheck                         |
| ------------------------- | ----------- | ---------- | ------- | --------------------------------- |
| `@ptah-extension/editor`  | 13 passed   | 176 passed | 0       | green                             |
| `@ptah-extension/chat`    | 50 passed   | 658 passed | 2       | green (same pre-existing warning) |
| `@ptah-extension/chat-ui` | 18 passed   | 84 passed  | 0       | green                             |

All touched projects are green, and the per-project passed-test counts increased by exactly the number of new assertions added (editor +4, chat +6, chat-ui +5). No existing tests were removed or skipped.
