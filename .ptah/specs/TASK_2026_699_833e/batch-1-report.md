# Batch 1 report: split-handle atom extensions (TASK_2026_699_833e)

Executor: Claude `frontend-developer` subagent. No git commands run. `batches.md` and `task.md` are unchanged.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat-ui\src\lib\atoms\split-handle.component.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat-ui\src\lib\atoms\split-handle.component.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\.ptah\specs\TASK_2026_699_833e\batch-1-report.md` (this report)

No peer-owned file was touched (`chat-transcript.component.css/html`, `message-bubble.component.css/html`,
`chat-input.component.ts`).

## Task 1.1: extend `SplitHandleComponent`: COMPLETE

- `inverted = input(false)`: the drag size is `startSize - (pos - startPos)` (shared `dragSize()` used by the rAF
  move and the pointerup flush). The arrow keys swap: for a vertical inverted handle, ArrowLeft grows and ArrowRight
  shrinks. For a horizontal inverted handle, ArrowUp grows. Home = `min()` and End = `max()` do not change.
- `appearance = input<SplitHandleAppearance>('line')`. `SplitHandleAppearance = 'line' | 'grip'` is exported from the
  component file.
  - `line`: the separator and line markup are copied unchanged into the `@else` branch. The host size bindings are
    the same, gated by `appearance() === 'line'`.
  - `grip`: no host `w-1.5`/`h-1.5`. The separator classes are `focus-visible:outline focus-visible:outline-2
    focus-visible:-outline-offset-1 focus-visible:outline-base-content focus-visible:bg-base-content/[0.08]`, with
    `bg-primary/20` while dragging.
  - `grip` also renders:
    - A decorative 1 px line at the leading edge: `bg-base-content/15 group-hover:bg-primary/60`, solid
      `bg-primary` while dragging. It sits at `left-0` when inverted, so it is on the dock edge.
    - A centred `w-1 h-8 rounded-full` grip: `bg-base-content/60 group-hover:bg-base-content/80`, solid
      `bg-base-content` while dragging.
    - An `aria-hidden="true"` readout pill: `bg-base-300 text-base-content text-[11px] tabular-nums`, text
      `{roundedSize} px`, placed at the top. It is shown while dragging, otherwise `hidden group-focus-visible:block`.
      It opens toward the sized pane, so it is inside the dock when inverted.
    - 150 ms colour transitions with `motion-reduce:transition-none`. All values come from design-spec.md §2.
  - The dragging state is applied through computed `[class]` strings driven by the `dragging` signal. This avoids
    conflicting `group-active`/`group-hover` variant order, and pointer capture stays reliable.
- `draggingChange = output<boolean>()` and an internal `dragging` signal:
  - `true` on pointerdown;
  - `false` from `finishDrag` on the commit and cancel paths.
- `sizeCancel = output<void>()`:
  - `cancelDrag` runs `sizeChange(startSize)`, then `finishDrag()` (which emits `draggingChange(false)`), then
    `sizeCancel`.
  - The cancel triggers are Escape, window blur, `pointercancel` and lost capture.
  - It is never emitted on pointerup or for key steps.
- Shift+Arrow = `KEYBOARD_STEP * 3` (48) for every consumer.
- Body cursor: `document.body.style.cursor` is `col-resize` (vertical) or `row-resize` (horizontal) during a drag.
  It is cleared in `finishDrag` together with `userSelect`.
- At most one `sizeChange` per frame. The rAF logic is unchanged, and the spec covers it.
- Hygiene: standalone, OnPush, `input()`/`output()`/`signal`/`computed`, `inject()`. No `any` and no `console.*`.

## Task 1.2: `split-handle.component.spec.ts`: COMPLETE (30 tests)

The spec uses a standalone OnPush host component that binds every input and output. It stubs `setPointerCapture` and
`releasePointerCapture` (missing in jsdom) and drives `requestAnimationFrame`/`cancelAnimationFrame` with spies.
Pointer events are `MouseEvent`s with a defined `pointerId`.

Coverage:

- aria attributes and the rounded `aria-valuenow`;
- drag +40 → 440, and inverted → 360;
- one emit per frame;
- clamping during a drag;
- pointerup emits commit and no cancel, with the exact event order;
- events from other pointers are ignored;
- cursor and userSelect are set and restored, including `row-resize` for a horizontal handle;
- pointer capture and release;
- listeners are removed after the drag;
- Escape emits the start size, `dragging:false`, then `cancel`, and no commit;
- window blur, `pointercancel` and lost capture cancel;
- Escape outside a drag does nothing;
- key step of 16 commits with no cancel;
- inverted ArrowLeft gives +16, and Shift+ArrowLeft gives +48;
- Shift for a non-inverted handle;
- horizontal keys;
- Home and End when inverted;
- clamping of key steps;
- unrelated keys are ignored;
- dblclick → `sizeReset`;
- default `line` markup is pinned by exact class strings;
- the grip renders the grip, line and `aria-hidden` readout with no host size class;
- the grip dragging state (separator fill, solid grip, visible readout `440 px`), then the rest state again;
- R1 destroy mid-drag;
- destroy outside a drag leaves body styles alone.

## Risks and edge cases

- **R1 (destroy mid-drag)**:
  - The destroy hook is now `destroyRef.onDestroy(() => this.finishDrag(false))`. It releases the listeners, rAF,
    capture, `userSelect` and `cursor`, and resets `dragging`. It emits no output.
  - Spec `destroy mid-drag (R1)` covers it:
    - it hides the handle through `@if` during a drag;
    - it asserts body styles are restored, `releasePointerCapture(1)` is called and no output fires;
    - it asserts `console.warn` is never called;
    - later move/up/blur events do nothing.
  - Mutation check: with the hook reverted to `cancelDrag()`, this spec fails with three
    `NG0953: Unexpected emit for destroyed OutputRef` warnings. With the fix, it passes. The `sizeCancel` in
    plan line 316 ("and destroy during a drag") is superseded by R1 on purpose. Batch 3 must clear its draft through
    the slot condition, as batches.md Task 3.1 already states.
  - Body styles are now reset only when a drag was active. Before, the destroy path also skipped them when idle. So
    destroying an idle handle can no longer clear the cursor that another handle set. A spec covers this.
- **R4 (defaults unchanged)**:
  - The `line` template and host binding keys are unchanged.
  - Shift step and body cursor are additive (D-E).
  - Spec "keeps the default line markup" pins the exact separator and line class strings.
  - The full chat-ui suite passes, including the compact-session-activity specs.
- **A2**: the grip uses `focus-visible:bg-base-content/[0.08]` (an arbitrary value, because Tailwind 3.4 has no `/8`
  step). A spec asserts the class.

## Verification

Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui --parallel=1`

```
NX  Running targets typecheck, test, lint for project @ptah-extension/chat-ui:
NX  Successfully ran targets typecheck, test, lint for project @ptah-extension/chat-ui
```

The test summary was read from the Nx cache replay of that same run
(`npx nx test @ptah-extension/chat-ui --parallel=1`, "existing outputs match the cache"):
`Test Suites: 76 passed, 76 total`, `Tests: 1465 passed, 1465 total`.

Targeted run earlier: `npx jest -c libs/frontend/chat-ui/jest.config.ts
libs/frontend/chat-ui/src/lib/atoms/split-handle.component.spec.ts --coverage=false --maxWorkers=2` gave 30/30 passed.
Both files were formatted with prettier. Nothing was run workspace-wide, and no build, serve or e2e target was run.

## Out-of-scope observations

- **Pre-existing host-class quirk.** Angular parses the host key `'[class.w-1.5]'` as the class `w-1`, because it
  stops at the dot. The same happens to `'[class.h-1.5]'`, which gives `h-1`. So today's `line` handles in
  `agent-lane-grid` and `compact-session-activity` render 4 px wide or tall, not 6 px.
  - I kept that behaviour unchanged (R4), and the spec pins the classes that actually render.
  - The fix is a later choice, for example `host: { class: ... }` through a computed string, or `w-[6px]`. It would
    change the rendered size for both existing consumers.
- `SplitHandleAppearance` is not re-exported from `libs/frontend/chat-ui/src/index.ts`, which is outside this batch.
  Consumers bind the literal `'grip'` in templates, so no export is needed. Add it if Batch 3 wants the type.
