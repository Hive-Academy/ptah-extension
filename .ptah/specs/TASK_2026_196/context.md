# Context — TASK_2026_196

## Reported symptoms

Observed in Electron (`npm run electron:serve`) during TASK_2026_187 Batch 1 manual
testing:

1. **The terminal panel can no longer be resized vertically.** Dragging the
   separator up/down does nothing. The user states this worked previously.
2. **With the terminal open, opening a diff view makes the diff content bleed
   over the terminal area.** The `TERMINAL` header bar and the
   `Click + to open a terminal` placeholder remain visible _underneath_ the
   overflowing diff text.

These are one bug, not two.

## Root cause

`libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts:280-303`:

```html
<div class="flex-1 min-h-0 relative">
  <ptah-diff-view class="absolute inset-0" [class.invisible]="…" … />
  <ptah-code-editor class="absolute inset-0" [class.invisible]="…" … />
</div>
```

- Neither surface carries a `z-index`.
- There is **no `overflow-hidden` anywhere in the editor content region** —
  verified across `diff-view/`, `code-editor/`, `editor-panel/` and `terminal/`.
  The nearest clipping ancestor is `electron-shell.component.ts:262`
  (`min-w-[300px] … overflow-hidden`), which sits _below_ the terminal, which is
  why the bleed stops at the panel edge instead of reaching the chat pane.

Per CSS 2.1 paint order (Appendix E), in-flow non-positioned block descendants
paint in layer 4 while positioned descendants with `z-index: auto` paint in layer
8 — **above them, irrespective of document order**. Hit-testing follows paint
order. So wherever a Monaco surface overflows its `relative` container it paints
over the terminal panel _and_ over the 4 px separator that follows it in the DOM:

```html
<!-- editor-panel.component.ts:373-381 -->
<div class="h-1 bg-base-300 cursor-row-resize … flex-shrink-0" role="separator" aria-label="Resize terminal" (mousedown)="onTerminalResizeStart($event)"></div>
```

The separator is static and in-flow, so it never receives the `mousedown`.

The diff root is `class="w-full h-full flex flex-col bg-base-100"`
(`diff-view.component.ts:87`) — an **opaque** background that ends at the correct
boundary. Past that edge only the Monaco _text_ paints, with no background. That
is exactly the reported visual.

## Introducing commit

`3a73a037d` — _"perf: keep the diff editor mounted and update its models in
place"_, 2026-08-04. It converted both Monaco surfaces from in-flow children into
permanently-mounted absolute overlays. Its own comment states the intent:

> THREE ALWAYS-MOUNTED LAYERS, not a structural @if chain. Both Monaco surfaces
> stay in the DOM for the life of the panel and are only visually hidden;
> whichever one is not in use is absolutely positioned, so it occupies no layout.
> … Neither surface is unmounted any more.

The change is correct in intent — it fixes a real Monaco model/view-state cache
teardown (TASK_2026_154 Serious #2, TASK_2026_173 N1). It simply omitted the clip
and stacking guard that positioning requires. **Do not revert it.**

Note that the sibling image branch at `editor-panel.component.ts:304-306` _does_
carry `overflow-auto` and `bg-base-100`, so it is clipped and opaque — the two
Monaco surfaces are the outliers.

## Why the overflow happens at all

`DiffViewComponent` creates its editor with `automaticLayout: false` and installs
a hand-rolled observer (`diff-view.component.ts:518-523`):

```ts
this.resizeObserver = new ResizeObserver(() => {
  this.editor?.layout();
});
this.resizeObserver.observe(container);
```

`CodeEditorComponent` by contrast uses `automaticLayout: true`
(`code-editor.component.ts:302`) and self-heals. Monaco writes an inline pixel
height onto its own DOM; when that is stale relative to `#editorContainer` — the
container shrank as the terminal opened and the observer's correction did not land,
or landed against a stale measurement — the line content paints past the container.
Because the surfaces are now permanently mounted, a stale layout **persists**
instead of being discarded by the old teardown-and-recreate cycle.

That is why the diff is the surface that misbehaves and the code editor is not.

## Proposed fix

Two parts. The clip is the correctness fix; the layout parity is the robustness fix.

1. **Clip and isolate** — `editor-panel.component.ts:280`, add `overflow-hidden`
   (and `isolate` for a clean stacking context) to
   `class="flex-1 min-h-0 relative"`. Consider `overflow-hidden` on
   `#editorContainer`'s parent in `diff-view.component.ts` as well.
2. **Stop generating the overflow** — either switch the diff editor to
   `automaticLayout: true` for parity with `CodeEditorComponent`, or call
   `scheduleLayout()` when `terminalVisible` / `terminalHeight` change.

Do part 1 first and confirm it resolves both symptoms before deciding whether
part 2 is needed.

## Verification

- Terminal resize drag works with a diff open, with the terminal open, and in
  split mode.
- Diff content is clipped at the editor region boundary; the terminal panel is
  never painted over.
- `document.elementFromPoint` over the centre of `[aria-label="Resize terminal"]`
  returns that `div[role="separator"]`, not a `.monaco-*` node.
- Monaco model/view-state caching still survives tab switches — do not regress
  what `3a73a037d`, TASK_2026_154 and TASK_2026_173 fixed. Those regression specs
  live in `diff-view.component.spec.ts`, `editor-panel.component.spec.ts`,
  `specs/editor/diff-view-state.spec.ts` and
  `specs/editor/perf-m1-diff-redisplay.spec.ts`.
- Add a regression test asserting the container clips, so the next time someone
  positions a child here the guard is already in place.

## Relationship to TASK_2026_187

None causally. Surfaced during that task's Batch 1 manual gate, and Batch 1 was
investigated and **exonerated by direct evidence**, not by argument:

- zero files under `libs/frontend/editor/src/**` were modified by Batch 1;
- the built output contains exactly one `EditorService` class definition (the
  duplicate-`providedIn: 'root'`-instance theory, which would have reproduced
  symptom 1 exactly, was checked in the chunks and eliminated);
- `createGlobPatternsForDependencies` was executed against the live Nx graph with
  the new `libs/frontend/editor/package.json` present — the editor lib is still in
  Tailwind's content globs, and `cursor-row-resize` / `h-1` / `invisible` /
  `absolute` are all present in the built `styles.css`;
- the style-injection-order theory is structurally impossible here — no component
  in the webview uses `ViewEncapsulation.None` and every `::ng-deep` is
  `:host`-scoped.

Full analysis: `.ptah/specs/TASK_2026_187/batch-1-regression-investigation.md`.
