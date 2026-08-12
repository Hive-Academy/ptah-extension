---
id: TASK_2026_178
status: done
type: BUGFIX
title: Drag handlers re-enter the Angular zone on every pointer event
description: Three drag implementations call ngZone.run() (or run inside the zone) once per native mousemove/pointermove, forcing a change-detection pass and a layout write per event instead of per frame. editor-panel was fixed in TASK_2026_173 B5; electron-resize-handle and chat-view still have it. All drag handlers also leak their document-level listeners on window blur. Apply the rAF-coalescing pattern uniformly and add blur teardown.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-04T00:00:00.000Z
updated: 2026-08-04T00:00:00.000Z
---

## Description

### The defect, in one sentence

A native `mousemove` fires far more often than the browser paints. Every one of those events currently triggers Angular change detection and a layout write, when at most one per animation frame is useful.

### Where it is

| #   | File                                                                             | Shape                                                       | Status                                              |
| --- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| 1   | `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts`            | 3 handlers: terminal `:951`, sidebar `:1018`, split `:1086` | ✅ **FIXED** — TASK_2026_173 B5, commit `16da79d2f` |
| 2   | `libs/frontend/chat-ui/src/lib/atoms/electron-resize-handle.component.ts:68-84`  | `runOutsideAngular` then `ngZone.run()` per event           | ❌ open — identical to what B5 fixed                |
| 3   | `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:304-338` | `pointermove`, **never leaves the zone at all**             | ❌ open — different shape, same cost                |
| 4   | `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts`           | imports `NgZone` — **not yet audited**                      | ❓ audit                                            |

### Site 2 — `electron-resize-handle.component.ts`

```ts
this.ngZone.runOutsideAngular(() => {
  this.mouseMoveHandler = (e: MouseEvent) => {
    const pointerX = e.clientX;
    const width = this.direction() === 'left' ? pointerX : window.innerWidth - pointerX;
    this.ngZone.run(() => this.dragMoved.emit(width));   // <- once per native event
  };
  document.addEventListener('mousemove', this.mouseMoveHandler);
  ...
});
```

The `runOutsideAngular` accomplishes nothing: the inner `ngZone.run()` re-enters on every event. This is byte-for-byte the pattern B5 removed from `editor-panel`.

### Site 3 — `chat-view.component.ts`

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

Different shape, same cost. There is no `runOutsideAngular` here at all, so the listener runs **inside** the zone and every `pointermove` schedules change detection. It also calls `getBoundingClientRect()` per event, which forces synchronous layout — a second per-event cost the other sites do not have.

Note this site does one thing **better** than the others: it uses pointer capture and tears down on `pointercancel` and `lostpointercapture`. Preserve that. Do not "unify" it into the mouse-event shape.

### The fix — the pattern B5 established

From `editor-panel.component.ts` (read it before writing; it is the reference implementation):

```ts
// One shared handle on the class. Only one drag can be active — one pointer,
// all drags start from a mousedown/pointerdown.
private _dragFrame: number | null = null;

private cancelDragFrame(): void {
  if (this._dragFrame !== null) {
    cancelAnimationFrame(this._dragFrame);
    this._dragFrame = null;
  }
}
```

Inside the drag start, within `runOutsideAngular`:

```ts
let latestEvent: MouseEvent | null = null;

const applyLatest = () => {
  this._dragFrame = null;
  const e = latestEvent;
  latestEvent = null;
  if (!e) return; // redundant flush costs nothing
  /* ...existing clamping arithmetic, verbatim... */
  this.ngZone.run(() => {
    /* the single signal write / emit */
  });
};

const onMove = (e: MouseEvent) => {
  latestEvent = e;
  if (this._dragFrame === null) {
    this._dragFrame = requestAnimationFrame(applyLatest);
  }
};
```

Teardown, on mouseup/pointerup **and** on destroy:

```ts
this.cancelDragFrame(); // drop the pending frame
applyLatest(); // apply the release position synchronously
cleanupListeners(); // then unhook
```

**Order matters.** Cancel, then apply, then unhook. Applying after unhooking loses the final position; unhooking before applying can drop it entirely.

### Also fix: the blur leak

**Every** drag handler in the table above — including the already-fixed `editor-panel` ones — leaks its `document`-level listeners when the window loses focus mid-drag. Release the mouse outside the window and the listeners stay attached with `document.body.style.cursor` and `userSelect` still overridden.

This is TASK_2026_173's Task 4.4 for `editor-panel` specifically. **Do it for all sites here instead**, and delete Task 4.4 from that task's batch 4 so the work is not done twice in two different shapes. Add:

- `window.addEventListener('blur', endDrag)` alongside the move/up listeners
- `Escape` key cancels the drag and restores the pre-drag size

Both must run the same teardown path, including `cancelDragFrame()`.

### What you cannot prove by measurement — read this before reporting results

The e2e harness **cannot** demonstrate this improvement, and you should not tune it until it does.

`apps/ptah-electron-e2e/src/specs/editor/perf-m4-drag-cd.spec.ts` measures style-attribute mutations against a `requestAnimationFrame` frame counter during a synthetic drag. Measured for B5:

|        | mutations median          | mutations max | frames |
| ------ | ------------------------- | ------------- | ------ |
| before | 121                       | 223           | ~121   |
| after  | 63 / 101 (two executions) | 76 / 118      | ~121   |

Two causes were tested and neither could be ruled out: **Chromium coalesces `mousemove` dispatch to roughly one per rendering frame** regardless of input rate, and CDP round-trip latency in `await page.mouse.move()` throttles synthetic input near frame rate. A Playwright-driven harness structurally under-represents what a 1000 Hz mouse produces on real hardware.

**The success criterion is therefore: mutations ≤ frame count, with the max collapsing toward the median.** Before the fix, 2 of 5 runs exceeded their own frame count (223 vs 122 = 1.83×). After, none did. That ratio change is the signal. A flat median is an acceptable and expected result — B5's two executions disagreed on median (63 vs 101) because the sidebar saturates its 480 px clamp partway through the window, and that was reported rather than smoothed.

**Prove it with unit tests instead.** B5 added 6 to `editor-panel.component.spec.ts` asserting the invariant directly — a 4-event burst arms exactly one frame and applies only the latest position; a fresh burst arms a fresh frame; mouseup cancels the pending frame yet still applies the release position; clamps unchanged at both ends; destroy cancels a pending frame. Copy that shape. It is framework-version-proof and does not depend on browser input behaviour.

Zero the `requestAnimationFrame`/`cancelAnimationFrame` spy counters at `mousedown` — Angular's own rendering arms frames via `afterNextRender` and pollutes the count otherwise.

### Constraints

- **Observable behaviour must not change** beyond update frequency: same final sizes, same clamping, same cursor and `user-select` side effects, same persistence on release.
- **Do not unify the three sites into one shared utility in this task.** They have genuinely different teardown requirements (pointer capture vs document listeners). Extracting a shared directive is a reasonable follow-up _after_ all three are correct and tested — not before.
- NFR-2: `ChangeDetectionStrategy.OnPush`, signals, `inject()`. `catch (error: unknown)`. No `@ts-ignore`.

### Acceptance criteria

1. Sites 2 and 3 coalesce to at most one update per animation frame; site 4 audited and fixed if it has the pattern.
2. Every site cancels a pending frame on drag end **and** on component destroy.
3. All sites — including the already-fixed `editor-panel` — tear down on window blur and on `Escape`, restoring cursor and `user-select`.
4. Unit tests assert the burst-to-one-frame invariant directly at each site, in the shape of `editor-panel.component.spec.ts`'s B5 block.
5. Final drag positions and clamp behaviour unchanged — asserted at both ends of each clamp.
6. `@ptah-extension/editor`, `chat`, `chat-ui` suites green; cross-project passed-test sum does not decrease.

### Related

- `TASK_2026_173` B5 (commit `16da79d2f`) — the reference implementation and the M4 measurement discussion.
- `TASK_2026_173` batch 4, Task 4.4 — the blur/Escape teardown for `editor-panel`. **Fold into this task and remove it there.**
- `measurements.md` § M4 — the harness-limitation finding, worth reading before you interpret any number.
