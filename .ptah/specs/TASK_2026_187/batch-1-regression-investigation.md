# Batch 1 regression investigation — terminal resize + diff overflow

**Task**: TASK_2026_187 Batch 1
**Date**: 2026-08-09
**Constraint**: no GUI session. Every conclusion below is tagged **VERIFIED** (checked
against source, the built bundle, or an executed command) or **INFERENCE** (reasoned
from source/CSS semantics, not observed).

---

## Executive summary

**Batch 1 caused neither defect.** Both are pre-existing, and both trace to a single
root cause introduced by commit `3a73a037d` (_"perf: keep the diff editor mounted and
update its models in place"_, 2026-08-04) — **five days before Batch 1**.

That commit changed `<ptah-diff-view>` and `<ptah-code-editor>` from in-flow children
of the editor content region into `position: absolute` overlays. Neither element gets
a `z-index`, and there is **no `overflow-hidden` anywhere in the editor lib**. Under
CSS paint order, a positioned element with `z-index: auto` paints _above_ every static,
in-flow sibling regardless of document order. So the same Monaco overflow that
previously disappeared _behind_ the terminal now paints _on top of_ it — and on top of
the 4 px terminal resize separator, which then stops receiving `mousedown`.

One root cause, two symptoms.

---

## Part 0 — What Batch 1 can and cannot physically change

**VERIFIED** — `git status --porcelain` on the working tree:

```
 M apps/ptah-extension-webview/eslint.config.mjs
 M apps/ptah-extension-webview/src/app/app.config.ts
 M apps/ptah-extension-webview/src/app/editor-message-routing.spec.ts
 M marketing/scripts/01-open-source-announcement.md   (pre-existing, not ours)
?? libs/frontend/editor/package.json
```

**Zero files under `libs/frontend/editor/src/**`are modified.** Every template,`styles`block, drag handler and Monaco call in the editor lib is byte-identical to`HEAD`. Batch 1 therefore cannot change editor behaviour except through one of four
indirect channels. All four are eliminated below.

### Channel A — Tailwind purge (editor classes dropped from `styles.css`)

This was a real risk worth checking: `apps/ptah-extension-webview/tailwind.config.js:8`
builds its content globs with `createGlobPatternsForDependencies(__dirname)`, which
derives them from the **Nx project graph**. Adding a `package.json` to a lib is exactly
the kind of change that can flip how Nx classifies a project.

**VERIFIED** — executed `createGlobPatternsForDependencies` against the real graph with
`libs/frontend/editor/package.json` present. 25 globs returned, including:

```
libs/frontend/editor/src/**/!(*.stories|*.spec).{ts,html}
```

**VERIFIED** — every editor-only utility is present in the built
`dist/apps/ptah-extension-webview/browser/styles.css`:

| Class               | Emitted rule                           |
| ------------------- | -------------------------------------- |
| `cursor-row-resize` | `cursor-row-resize{cursor:row-resize}` |
| `min-h-[100px]`     | `min-h-\[100px\]{min-height:100px}`    |
| `h-1`               | `.h-1{height:.25rem}`                  |
| `invisible`         | `.invisible{visibility:hidden}`        |
| `absolute`          | `.absolute{position:absolute}`         |

Channel A is **eliminated**.

### Channel B — service identity (two `EditorService` instances)

The hypothesis: `app.config.ts` now imports `EditorService` from
`@ptah-extension/editor/services` while `EditorPanelComponent` imports it via a relative
path; if those resolved to two modules, the drag would write `terminalHeight` on one
`providedIn: 'root'` instance while the template read the other — which would reproduce
symptom 1 exactly.

**VERIFIED** by grepping the built chunks in
`dist/apps/ptah-extension-webview/browser/` (build dated Aug 9 19:07; lazy chunk
`chunk-TZPGF4YO.js` is 539,356 bytes, matching the developer's post-`package.json`
measurement, so this is the Batch 1 build):

| Chunk                                          | `_terminalHeight` | `setTerminalHeight` | Meaning                                                  |
| ---------------------------------------------- | ----------------- | ------------------- | -------------------------------------------------------- |
| `chunk-IAAJME6G.js` (initial, modulepreloaded) | **3**             | 1                   | the single class definition + its setter                 |
| `chunk-TZPGF4YO.js` (lazy)                     | **0**             | 2                   | call sites only — the two `endDrag`/`applyLatest` writes |
| all other chunks                               | 0                 | 0                   | —                                                        |

The class body exists in exactly one chunk. The lazy chunk holds only references.
**One module, one class identity, one `ɵprov`.** Channel B is **eliminated**.

### Channel C — component style injection order

This was the stated primary hypothesis. It is **eliminated** on three independent
grounds:

1. **VERIFIED** — `grep -rn "ViewEncapsulation.None" libs/frontend/ apps/ptah-extension-webview/src`
   returns **nothing**. Every component in the webview uses emulated encapsulation, so
   every rule carries a unique `[_nghost-*]` / `[_ngcontent-*]` attribute. Two different
   components' rules **cannot** collide on the same element, in either order.
2. **VERIFIED** — every `::ng-deep` in the webview (`chat`, `chat-ui`, `tribunal-panel`)
   is written as `:host ::ng-deep …`, which keeps the left-hand scoping attribute and
   confines the rule to that component's subtree. No unscoped global leak exists that
   could reach an editor component.
3. **VERIFIED** — `dist/.../index.html` loads the global sheet as
   `<link rel="stylesheet" href="styles.css">` inside `<head>`. Angular's shared styles
   host appends component `<style>` elements to `<head>`, i.e. _after_ that link — both
   before and after Batch 1. The win/lose relationship between editor `:host` rules and
   global Tailwind utilities is therefore unchanged.

Additionally, the editor `:host` blocks declare only `display / height / width`
(`diff-view.component.ts:244`, `code-editor.component.ts:125`,
`editor-panel.component.ts:492`, `terminal-panel.component.ts:47`,
`terminal.component.ts:37`). None of those properties conflicts with `.absolute` or
`.inset-0`, so even an order flip would be a no-op for the elements in question.

### Channel D — `sideEffects: false`

Ruled out upstream (539.36 kB before and after — byte-identical). Not re-investigated.

**Conclusion**: Batch 1's only true runtime delta is _when_ the editor chunk is
evaluated. `EditorPanelComponent` was **already** dynamically imported before Batch 1
(`libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:306`);
the static import in `app.config.ts` merely hoisted it into an initial chunk. Batch 1
makes that existing `import()` genuinely deferred. That shifts mount timing, not layout
semantics.

---

## Defect 1 — Terminal vertical resize is gone

### Verdict

**PRE-EXISTING. Not caused by Batch 1.** Confidence: **high** that Batch 1 is not the
cause (VERIFIED — the drag code and the handle markup are byte-identical, and the
`EditorService` singleton is verified single). Confidence **medium** on the specific
mechanism below, which is INFERENCE and needs one DevTools check to confirm.

### Mechanism

The handle is a 4 px static, in-flow separator
(`libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts:373-381`):

```html
<div class="h-1 bg-base-300 cursor-row-resize … flex-shrink-0" role="separator" aria-label="Resize terminal" (mousedown)="onTerminalResizeStart($event)"></div>
```

Its sibling — earlier in the document — is the editor area, whose content region now
contains two **absolutely positioned** Monaco surfaces
(`editor-panel.component.ts:279-303`, introduced by `3a73a037d`):

```html
<div class="flex-1 min-h-0 relative">
  <ptah-diff-view class="absolute inset-0" [class.invisible]="…" … />
  <ptah-code-editor class="absolute inset-0" [class.invisible]="…" … />
</div>
```

**VERIFIED**: neither carries a `z-index`, and `grep` for `overflow-hidden` across
`diff-view/`, `code-editor/`, `editor-panel/` and `terminal/` returns **nothing**. The
nearest ancestor that clips is the Electron shell wrapper,
`electron-shell.component.ts:262` (`class="min-w-[300px] … overflow-hidden"`), which
sits _below_ the terminal.

**INFERENCE**: by CSS 2.1 paint order (Appendix E), in-flow non-positioned block
descendants paint in layer 4; positioned descendants with `z-index: auto` paint in
layer 8 — above them, _irrespective of document order_. Hit-testing follows paint
order. So wherever a Monaco surface's box overflows its `relative` container, it paints
over and swallows the `mousedown` for the separator that follows it in the DOM.

Before `3a73a037d` those surfaces were static and in-flow, so an identical overflow
painted **beneath** the later in-flow handle and terminal. This is precisely the "worked
before" the user reports.

Note the asymmetry that determines which surface overflows: `CodeEditorComponent` is
created with `automaticLayout: true` (`code-editor.component.ts:302`) and self-heals;
`DiffViewComponent` is created with `automaticLayout: false`
(`diff-view.component.ts:~505`) and relies on a hand-rolled `ResizeObserver`
(`diff-view.component.ts:520-523`). The diff surface is the fragile one — consistent
with the user seeing the breakage with a diff open.

### Proposed fix

Add the missing clip and stacking guard. Both are one-liners in the editor lib:

- `editor-panel.component.ts:279` — `class="flex-1 min-h-0 relative"` →
  add `overflow-hidden` (and, for belt and braces, `isolate`).
- `diff-view.component.ts` — add `overflow-hidden` to the `#editorContainer` parent.

**Where it belongs**: a **new BUGFIX task**. Not Batch 1 — Batch 1 is a bundle-splitting
refactor and must not absorb an unrelated layout fix, and the fix is in a lib Batch 1
does not touch. Not TASK_2026_195 either: that task is about workspace-partitioned view
state and is unrelated.

### How the user can confirm

1. `npm run electron:serve`, open the editor panel, open the terminal, open a diff.
2. DevTools console — check what actually owns the pixel over the resize separator:
   ```js
   const h = document.querySelector('[aria-label="Resize terminal"]');
   const r = h.getBoundingClientRect();
   document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
   ```
   If this returns anything other than that `div[role="separator"]` — e.g. a
   `.monaco-…` node or `ptah-diff-view` — the overlay is swallowing the drag and the
   diagnosis is confirmed.
3. Cross-check: close every diff tab. If the drag starts working again, the overlay is
   the cause.
4. Elements panel — select `<ptah-diff-view>`, confirm Computed shows
   `position: absolute` and `z-index: auto`, then walk up to
   `div.flex-1.min-h-0.relative` and confirm `overflow: visible`.

---

## Defect 2 — Diff view overflows over the terminal panel

### Verdict

**PRE-EXISTING. Not caused by Batch 1.** Confidence: **high** that Batch 1 is not the
cause (VERIFIED, same evidence as Defect 1). Confidence **medium-high** on the
mechanism — the paint-order half is VERIFIED from source; the reason Monaco's inner box
exceeds its container is INFERENCE.

### Mechanism

Same root cause. Two layers:

**Layer 1 — the overflow itself.** `DiffViewComponent` creates its editor with
`automaticLayout: false` and installs its own observer
(`diff-view.component.ts:518-523`):

```js
this.resizeObserver = new ResizeObserver(() => {
  this.editor?.layout();
});
this.resizeObserver.observe(container);
```

Monaco writes an inline pixel height onto its own DOM. Whenever that inline size is
stale relative to `#editorContainer` — the container shrank when the terminal opened and
the observer's correction did not land, or landed against a stale measurement — Monaco's
line content paints past the container. `3a73a037d` also made both surfaces
**permanently mounted**, so a stale layout now persists instead of being discarded by
the old `@if/@else` teardown that recreated the editor on every switch. The commit
message states this explicitly: _"Neither surface is unmounted any more."_

**Layer 2 — where the overflow lands.** Nothing clips it (VERIFIED: no `overflow-hidden`
anywhere in the editor lib), and because `<ptah-diff-view>` is now positioned, the
overflow paints in the positioned layer, i.e. **above** the static terminal panel.

This matches the screenshot exactly. The diff-view root is
`class="w-full h-full flex flex-col bg-base-100"` (`diff-view.component.ts:87`) — an
**opaque** background that ends at the correct boundary. Beyond it, only the overflowing
Monaco _text_ paints, with no background. Hence "diff scroll content bleeding over" with
the `TERMINAL` header bar and the `Click + to open a terminal` placeholder
(`terminal-panel.component.ts:38-42`) **visible underneath** it. The whole thing is
finally clipped by `electron-shell.component.ts:262`'s `overflow-hidden`, which is why
the bleed stops at the panel edge rather than running into the chat pane.

### Proposed fix

Same two `overflow-hidden` additions as Defect 1. Consider additionally switching the
diff editor to `automaticLayout: true` for parity with `CodeEditorComponent`, or calling
`scheduleLayout()` when `terminalVisible` / `terminalHeight` change. The clip is the
correctness fix; the layout parity is the robustness fix.

**Where it belongs**: the same **new BUGFIX task** as Defect 1 — they are one bug.

### How the user can confirm

1. With the terminal open and a diff showing, in DevTools select `<ptah-diff-view>` and
   read its `getBoundingClientRect()`. Then read the rect of the Monaco root inside it:
   ```js
   const host = document.querySelector('ptah-diff-view');
   const mon = host.querySelector('.monaco-diff-editor');
   console.log(host.getBoundingClientRect(), mon.getBoundingClientRect());
   ```
   If `mon.bottom > host.bottom`, the Monaco surface is laid out taller than its host —
   confirming the stale-layout half.
2. Confirm nothing clips: walk from `#editorContainer` up to
   `div.min-w-[300px].overflow-hidden` in the Elements panel and read Computed
   `overflow` at each level. Expect `visible` all the way until the shell wrapper.
3. Live-test the fix without editing code — in the Styles pane add
   `overflow: hidden` to `div.flex-1.min-h-0.relative` (the diff-view's parent in
   `editor-panel`). The bleed should stop immediately and the resize handle should become
   draggable again. That single edit confirms both defects share one cause.
4. Toggle the terminal closed and open again. If the bleed disappears and returns, the
   `ResizeObserver` correction is the timing-sensitive part.

---

## Verified vs inferred — summary

| Claim                                                                                 | Status                                                  |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| No editor lib source changed by Batch 1                                               | VERIFIED (`git status`)                                 |
| `EditorService` defined exactly once in the built output                              | VERIFIED (chunk grep)                                   |
| Editor lib still in Tailwind content globs with `package.json` present                | VERIFIED (executed `createGlobPatternsForDependencies`) |
| All editor-only Tailwind classes present in built `styles.css`                        | VERIFIED (grep of `styles.css`)                         |
| No `ViewEncapsulation.None`; all `::ng-deep` are `:host`-scoped                       | VERIFIED (grep)                                         |
| Global `styles.css` is a `<head>` link; component styles appended after               | VERIFIED (`index.html`)                                 |
| No `overflow-hidden` / `z-index` in the editor content region                         | VERIFIED (grep)                                         |
| `3a73a037d` made both Monaco surfaces `position: absolute` and permanently mounted    | VERIFIED (`git show`)                                   |
| Positioned overlay paints above and steals hit-testing from the static handle         | INFERENCE (CSS paint order)                             |
| Monaco's inner box exceeds its container due to stale `automaticLayout: false` layout | INFERENCE (not observed)                                |

---

## RECOMMENDATION

**Commit Batch 1 as-is.** It is exonerated on both defects by direct evidence, not by
argument: the editor lib source is untouched, the built bundle contains exactly one
`EditorService`, the Tailwind output is complete, and Angular's emulated encapsulation
makes the style-order hypothesis structurally impossible. Reverting Batch 1 would not
move either symptom, and would give back the 539 kB of deferral the task exists to
achieve.

**Open a new BUGFIX task** for the shared root cause — _"Absolutely positioned Monaco
surfaces paint over the terminal panel and swallow the resize handle"_ — scoped to
`libs/frontend/editor`, citing `3a73a037d` as the introducing commit. Do **not** fold it
into TASK_2026_195 (unrelated: workspace-partitioned view state).

**Before committing Batch 1**, have the user run step 3 of the Defect 2 confirmation
(the live `overflow: hidden` edit in DevTools). It costs a minute, requires no rebuild,
and either confirms the whole diagnosis at once or sends the new task back for a second
look.
