# Batch 6 Dispatch — TASK_2026_173 · Accessibility (D1)

**Executor**: `frontend-developer` sub-agent
**Execution Mode**: sequential (one agent, all four tasks, in order)
**Tasks**: 6.1, 6.2, 6.3, 6.4 | **Satisfies**: D1 | **Depends on**: Batch 5 (`6df1984a7`), complete
**Dispatched**: 2026-08-10 by team-leader (MODE 2)

> **You do NOT create git commits.** Leave all work in the working tree. The team-leader stages,
> commits and updates `tasks.md`. Your job is 100% code quality. This is not a formality — a
> developer who is also worrying about the commit is a developer who writes stubs to make the
> commit happen.

---

## 1. Read this section before you touch anything

Three things about this batch are not obvious from `tasks.md`, and all three will cost you a
rewrite if you discover them late.

### 1.1 Every line number in `tasks.md` Tasks 6.1–6.4 is STALE

Batch 4 (`06b900d85`) substantially rewrote `editor-panel.component.ts` — three drag blocks
collapsed into one `startDragTracking` helper, three listener quartets into one — and batches 2
and 3 moved the other two files. **Every citation in the task bodies predates that.** They have
all been re-verified against the working tree; §3, §4 and §5 below carry the corrected offsets and
the verbatim current source. **Use this dispatch, not `tasks.md`, for locations.**

| `tasks.md` says                                | Actually at                                     |
| ---------------------------------------------- | ----------------------------------------------- |
| A: tab element `:206`                          | **`:211`** (`@for` at `:210`)                   |
| A: close button `:229`                         | **`:246`**                                      |
| A: `onTabClose` / `stopPropagation` `:672`     | method **`:744`**, call **`:745`**              |
| B: staged header `:78` / nested `:92`          | **`:79`** / **`:93`**                           |
| B: changes header `:126` / nested `:140`       | **`:127`** / **`:141`**                         |
| B: `onStageAll` `:228` / `onUnstageAll` `:233` | **`:229`** / **`:234`** (calls `:230` / `:235`) |
| C: row `:39`, buttons `:68`/`:79`/`:91`        | **`:40`**, **`:69`** / **`:80`** / **`:92`**    |
| C: `onAction` / `stopPropagation` `:175`       | method **`:195`**, call **`:199`**              |

Re-verify anything you are about to `Edit` — the Edit tool needs an exact match, and this is a
shared checkout with a **concurrent session active on another task** (see §8).

### 1.2 The actual defect is worse than "nested interactive elements"

In **all three** files the outer clickable is already a `<button>`, and the action controls are
`<button>` elements nested **inside** it. Nested interactive content inside a `<button>` is invalid
HTML: the browser does not render the nesting you wrote — it hoists/flattens the inner buttons out
in the parsed DOM. So the DOM the user's screen reader and the browser's hit-testing actually see
does not match the template.

**This is why the `stopPropagation()` calls exist.** They are compensating for the flattening. That
makes Task 6.4 structurally dependent on 6.1–6.3: you cannot delete `stopPropagation` until the
nesting is gone, and once it is gone you must not need it. D1 AC5 is explicit that the fix must hold
**without** relying on event-propagation suppression as the mechanism. **If a test fails after you
remove `stopPropagation`, the de-nesting is incomplete — do not put it back.**

### 1.3 AC6 is the binding constraint: visual appearance must be UNCHANGED

This is a semantics fix, not a redesign. Every one of these is a trap:

- The outer `<button>` in File A carries **`group`**, which drives `group-hover:opacity-60` on the
  close button. If `group` does not move to the new container, the close button stops appearing on
  hover. Same pattern in File C (`group` → `group-hover:opacity-100` on the action wrapper).
- The `[ngClass]` active/inactive tab styling must move to the container, not stay on the label
  button, or the active tab loses its background.
- **Preserve the batch-2 stale/error diff glyph and the dirty-dot slot verbatim**, including their
  DOM order relative to the filename (§3.3). `data-testid="diff-tab-status-glyph"` is asserted by
  existing tests.
- Layout classes (`flex items-center gap-2 px-3 py-1.5`) belong on whichever element is now the flex
  container. Moving them wholesale to a wrapper without re-checking the inner elements' box model is
  the usual way this regresses.

---

## 2. Standing gates (apply to this batch, no exceptions)

1. **NFR-1 cross-project invariant** — `nx test ptah-electron` and `nx test rpc-handlers`: the
   **sum must never decrease**. Current floor after Batch 5: `145 + 1718`. Converting a failing test
   to skipped is a regression, not a fix.
2. **Typecheck** clean for every changed project.
3. **Lint, standalone per project** — `nx lint <project>` individually. Do **not** trust a batched
   `nx run-many -t lint`; it has masked a real error in this repo before.
4. **Affected unit tests** — `nx test` for each changed project.
5. **Three-runtime build** — not required here (no `libs/shared` or `libs/backend` change expected).
   If you find yourself editing either, stop and report: that is out of scope for D1.
6. **Scope discipline (NFR-9)** — confine work to the three files in §3–§5 plus their specs. Failures
   originating outside this task's scope are **reported and the batch stopped**, never fixed
   opportunistically. **`--no-verify` is forbidden.**
7. **NFR-2** — all three components are already `ChangeDetectionStrategy.OnPush` (A `:499`, B `:177`,
   C `:109`) and `standalone: true`. Keep them that way; use signals + `inject()`.

> **On lint**: `nx affected --target=lint` was **green (exit 0, 69 projects)** as of this dispatch.
> A concurrent session on TASK_2026_177 can transiently break it. **A lint failure originating in
> `libs/api/**`, `apps/ptah-license-server/**`, `libs/api-contracts/**`, `libs/web/**`or`marketing/**` is NOT yours to fix\*\* — report it and proceed. Only failures in the three files you
> touched are yours.

---

## 3. Task 6.1 — De-nest the tab close button

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.ts`
**Requirement**: D1 AC1, AC2, AC4, AC6 | File is **1109 lines**, OnPush at `:499`

### 3.1 Current source, verbatim (`:204`–`:256`)

```html
204 @if (editorService.openTabs().length > 0) { 205
<div 206 class="flex items-center bg-base-300/50 border-b border-base-content/5 flex-shrink-0 overflow-x-auto scrollbar-thin" 207 role="tablist" 208 aria-label="Open editor tabs" 209>
  210 @for (tab of editorService.openTabs(); track tab.filePath) { 211
  <button
    212
    class="group flex items-center gap-2 px-3 py-1.5 text-xs whitespace-nowrap select-none transition-colors"
    213
    [ngClass]="
214	                        tab.filePath === editorService.activeFilePath()
215	                          ? 'bg-base-100 text-base-content'
216	                          : 'bg-transparent text-base-content/50 hover:text-base-content/70 hover:bg-base-200/50'
217	                      "
    218
    role="tab"
    219
    [attr.aria-selected]="
220	                        tab.filePath === editorService.activeFilePath()
221	                      "
    222
    [attr.aria-label]="'Switch to ' + tab.fileName"
    223
    (click)="onTabClick(tab.filePath)"
    224
  >
    225 <span class="truncate max-w-[120px]">{{ 226 tab.fileName 227 }}</span> 228 @if (tab.isDirty) { 229 <span 230 class="w-1.5 h-1.5 rounded-full bg-primary/70 flex-shrink-0" 231 title="Unsaved changes" 232></span> 233 } 234 @if (tab.diff && tab.diff.status !== 'fresh') { 235 <lucide-angular 236 [img]="AlertTriangleIcon" 237 class="w-3 h-3 flex-shrink-0" 238 [class.text-error]="tab.diff.status === 'error'" 239 [class.text-warning]="tab.diff.status === 'stale'" 240 [class.opacity-50]="tab.diff.status === 'refreshing'" 241 data-testid="diff-tab-status-glyph" 242 [attr.title]="diffStatusTitle(tab)" 243 [attr.aria-label]="diffStatusTitle(tab)" 244 /> 245 } 246 <button 247 class="ml-0.5 p-0.5 rounded opacity-0 group-hover:opacity-60 hover:opacity-100 hover:bg-base-content/10 transition-all" 248 [attr.aria-label]="'Close ' + tab.fileName" 249 (click)="onTabClose($event, tab.filePath)" 250>251 <lucide-angular [img]="XIcon" class="w-3 h-3" /> 252</button> 253
  </button>
  254 } 255
</div>
256 }
```

### 3.2 Target shape

Container `<div role="presentation">` carrying the tab chrome, with the label button and the close
button as **siblings** inside it:

```
<div role="presentation" class="group flex items-center gap-2 px-3 py-1.5 …" [ngClass]="…">
  <button type="button" role="tab" [attr.aria-selected]="…" [attr.aria-label]="'Switch to ' + …"
          (click)="onTabClick(tab.filePath)">
    <span class="truncate max-w-[120px]">{{ tab.fileName }}</span>
    …dirty dot…            ← keep inside the tab button (they label the tab)
    …diff status glyph…
  </button>
  <button type="button" [attr.aria-label]="'Close ' + tab.fileName"
          (click)="onTabClose(tab.filePath)">…</button>
</div>
```

**Decisions to honour:**

- `role="presentation"` on the wrapper is deliberate — it keeps the wrapper transparent to ARIA so
  `role="tab"` stays effectively a child of `role="tablist"` (`:207`). Do not use a bare `<div>`.
- **`group` moves to the wrapper.** The close button's `group-hover:opacity-60` depends on it.
- **`[ngClass]` and the layout classes move to the wrapper.** The label button should carry no
  background of its own so the active-tab chrome is unchanged.
- The dirty dot and the diff glyph **stay inside the tab button** — they are part of what the tab
  announces, and `[attr.aria-label]` on the tab already carries the name. Keep their DOM order:
  filename span → dirty dot → diff glyph.
- Add **`type="button"`** to both. Neither has it today (`:211`, `:246`); they default to `submit`.
- `onTabClose` no longer needs the event — see §6.

### 3.3 Must survive byte-identical (AC6)

- Dirty dot `:228`–`:233`: `@if (tab.isDirty)` → `<span class="w-1.5 h-1.5 rounded-full bg-primary/70 flex-shrink-0" title="Unsaved changes"></span>`
- Diff glyph `:234`–`:245`: including `data-testid="diff-tab-status-glyph"`, the three status-driven
  classes, and both `[attr.title]`/`[attr.aria-label]` bound to `diffStatusTitle(tab)` (method at
  `:718`–`:725`).

---

## 4. Task 6.2 — De-nest the section headers

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\source-control\source-control-panel.component.ts`
**Requirement**: D1 AC1, AC3, AC4, AC6 | File is **253 lines**, OnPush at `:177`

### 4.1 Staged Changes header, verbatim (`:77`–`:103`)

```html
77
<!-- Staged Changes section -->
78
<div class="flex-shrink-0">
  79
  <button
    80
    type="button"
    81
    class="flex items-center gap-1 w-full px-2 py-1 text-[10px] font-semibold
82	                 uppercase tracking-wider opacity-70 hover:opacity-100
83	                 bg-base-200 transition-opacity cursor-pointer"
    84
    (click)="stagedExpanded.set(!stagedExpanded())"
    85
    aria-label="Toggle staged changes section"
    86
  >
    87 <lucide-angular 88 [img]="stagedExpanded() ? ChevronDownIcon : ChevronRightIcon" 89 class="w-3 h-3 flex-shrink-0" 90 /> 91 <span>Staged Changes ({{ stagedFiles().length }})</span> 92 @if (stagedFiles().length > 0) { 93 <button 94 type="button" 95 class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0 ml-auto" 96 title="Unstage all" 97 aria-label="Unstage all files" 98 (click)="onUnstageAll($event)" 99>100 <lucide-angular [img]="MinusIcon" class="w-3.5 h-3.5" /> 101</button> 102 } 103
  </button>
</div>
```

The controlled region follows at `:104`–`:122`: `@if (stagedExpanded())` wrapping
`<div role="list" aria-label="Staged files">` at `:105`.

### 4.2 Changes (unstaged) header, verbatim (`:125`–`:151`)

```html
125
<!-- Unstaged Changes section -->
126
<div class="flex-shrink-0">
  127
  <button
    128
    type="button"
    129
    class="flex items-center gap-1 w-full px-2 py-1 text-[10px] font-semibold
130	                 uppercase tracking-wider opacity-70 hover:opacity-100
131	                 bg-base-200 transition-opacity cursor-pointer"
    132
    (click)="unstagedExpanded.set(!unstagedExpanded())"
    133
    aria-label="Toggle changes section"
    134
  >
    135 <lucide-angular 136 [img]="unstagedExpanded() ? ChevronDownIcon : ChevronRightIcon" 137 class="w-3 h-3 flex-shrink-0" 138 /> 139 <span>Changes ({{ unstagedFiles().length }})</span> 140 @if (unstagedFiles().length > 0) { 141 <button 142 type="button" 143 class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0 ml-auto" 144 title="Stage all" 145 aria-label="Stage all files" 146 (click)="onStageAll($event)" 147>148 <lucide-angular [img]="PlusIcon" class="w-3.5 h-3.5" /> 149</button> 150 } 151
  </button>
</div>
```

Controlled region `:152`–`:170`: `@if (unstagedExpanded())` wrapping
`<div role="list" aria-label="Changed files">` at `:153`.

### 4.3 Target shape (both headers, identically)

```
<div class="flex items-center gap-1 w-full px-2 py-1 … bg-base-200">
  <button type="button" [attr.aria-expanded]="stagedExpanded()" aria-controls="staged-files-list"
          aria-label="Toggle staged changes section"
          (click)="stagedExpanded.set(!stagedExpanded())">
    <lucide-angular … />
    <span>Staged Changes ({{ stagedFiles().length }})</span>
  </button>
  @if (stagedFiles().length > 0) {
    <button type="button" class="btn btn-ghost btn-xs … ml-auto" title="Unstage all"
            aria-label="Unstage all files" (click)="onUnstageAll()">…</button>
  }
</div>
```

**Decisions to honour:**

- **Add `[attr.aria-expanded]`** — it is missing today on both headers, so the disclosure state is
  conveyed only by the chevron icon. D1 AC3/AC4 require the state be announced. Add
  `aria-controls` pointing at an `id` you add to the `role="list"` container (`:105`, `:153`).
- `ml-auto` on the action button only works if the wrapper is the flex container — move
  `flex items-center gap-1 w-full` to the wrapper, and keep `bg-base-200` there too so the header
  bar still paints edge to edge.
- The `opacity-70 hover:opacity-100` currently applies to the whole header including the action
  button. Preserve the rendered result; if you move opacity to the toggle button only, the action
  button's resting opacity changes — that is an AC6 regression.
- Note these two nested action buttons are **always visible** (no hover gating), unlike Files A
  and C. Do not introduce hover gating.

---

## 5. Task 6.3 — De-nest the file row

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\source-control\source-control-file.component.ts`
**Requirement**: D1 AC1, AC4, AC6 | File is **213 lines**, OnPush at `:109`

### 5.1 Current row, verbatim (`:40`–`:107`)

```html
40
<button
  41
  type="button"
  42
  class="group flex items-center gap-1.5 w-full px-2 py-0.5 text-left text-xs
43	             hover:bg-base-content/10 transition-colors cursor-pointer"
  44
  role="listitem"
  45
  [title]="rowTitle()"
  46
  (click)="openDiff.emit(diffRequest())"
  47
>
  48
  <!-- Status icon -->
  49 <lucide-angular 50 [img]="statusIcon()" 51 [class]="'w-3.5 h-3.5 flex-shrink-0 ' + statusColor()" 52 aria-hidden="true" 53 /> 54 55
  <!-- File name + parent dir -->
  56 <span class="flex items-center gap-1 min-w-0 flex-1"> 57 <span class="font-medium truncate">{{ fileName() }}</span> 58 @if (parentDir()) { 59 <span class="opacity-40 text-[10px] truncate">{{ parentDir() }}</span> 60 } 61 </span> 62 63
  <!-- Inline actions (visible on hover) -->
  64
  <span 65 class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" 66>
    67 @if (staged()) { 68
    <!-- Unstage button -->
    69 <button 70 type="button" 71 class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0" 72 title="Unstage" 73 aria-label="Unstage file" 74 (click)="onAction($event, 'unstage')" 75>76 <lucide-angular [img]="MinusIcon" class="w-3.5 h-3.5" /> 77</button> 78 } @else { 79
    <!-- Stage button -->
    80 <button 81 type="button" 82 class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0" 83 title="Stage" 84 aria-label="Stage file" 85 (click)="onAction($event, 'stage')" 86>87 <lucide-angular [img]="PlusIcon" class="w-3.5 h-3.5" /> 88</button> 89 } 90 91
    <!-- Discard button -->
    92 <button 93 type="button" 94 class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0" 95 title="Discard changes" 96 aria-label="Discard changes" 97 (click)="onAction($event, 'discard')" 98>99 <lucide-angular [img]="Undo2Icon" class="w-3.5 h-3.5" /> 100</button> 101
  </span>
  102 103
  <!-- Status badge -->
  104 <span class="text-[10px] font-mono opacity-40 flex-shrink-0">{{ 105 file().status 106 }}</span> 107
</button>
```

### 5.2 Target shape

```
<div role="listitem" class="group flex items-center gap-1.5 w-full px-2 py-0.5 text-xs
                            hover:bg-base-content/10 transition-colors">
  <button type="button" class="flex items-center gap-1.5 min-w-0 flex-1 text-left"
          [title]="rowTitle()" [attr.aria-label]="…"
          (click)="openDiff.emit(diffRequest())">
    …status icon, filename, parent dir…
  </button>
  <span class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 …">
    …stage/unstage button…  …discard button…
  </span>
  <span class="text-[10px] font-mono opacity-40 flex-shrink-0">{{ file().status }}</span>
</div>
```

**Decisions to honour:**

- **`role="listitem"` moves to the `<div>`.** It is currently on a `<button>` (`:44`), which is a
  semantic conflict — `listitem` strips the button's own role, and the parent `role="list"` lives in
  File B (`:105`, `:153`). Fixing it is in scope because you are rewriting the element anyway.
- The open-diff button should cover the icon + name region only, so the status badge and the action
  cluster stay outside it. `flex-1` moves onto the open-diff button so the row still fills width.
- The outer row has **no `aria-label`** today, only `[title]`. Give the open-diff button an explicit
  `[attr.aria-label]` (e.g. `'Open diff for ' + fileName()`) — D1 AC4 requires a distinct accurate
  label per control, and three "Stage/Unstage/Discard" siblings with an unlabelled row is exactly
  the case AC4 targets.

---

## 6. Task 6.4 — Delete `stopPropagation`; add focus-visible rings

**Requirement**: D1 AC5, AC7

### 6.1 Delete these four `stopPropagation()` calls

| File | Method         | Current lines | Call at |
| ---- | -------------- | ------------- | ------- |
| A    | `onTabClose`   | `:744`–`:747` | `:745`  |
| B    | `onStageAll`   | `:229`–`:232` | `:230`  |
| B    | `onUnstageAll` | `:234`–`:237` | `:235`  |
| C    | `onAction`     | `:195`–`:212` | `:199`  |

Verbatim today:

```ts
744	  protected onTabClose(event: MouseEvent, filePath: string): void {
745	    event.stopPropagation();
746	    this.editorService.closeTab(filePath);
747	  }
```

```ts
229	  protected onStageAll(event: MouseEvent): void {
230	    event.stopPropagation();
231	    void this.sourceControl.stageAll();
232	  }
233
234	  protected onUnstageAll(event: MouseEvent): void {
235	    event.stopPropagation();
236	    void this.sourceControl.unstageAll();
237	  }
```

```ts
195	  protected onAction(
196	    event: MouseEvent,
197	    action: 'stage' | 'unstage' | 'discard',
198	  ): void {
199	    event.stopPropagation();
200	    const path = this.file().path;
201	    switch (action) { … }
212	  }
```

Once the nesting is gone the `MouseEvent` parameter is dead weight — **drop it from the signature**
and from the template call sites, rather than leaving an unused argument. That makes the "no longer
relies on propagation suppression" property structural instead of a promise. Update the four
template bindings accordingly (`onTabClose(tab.filePath)`, `onStageAll()`, `onUnstageAll()`,
`onAction('stage')` …).

> **Do not touch `closeSplit(event: MouseEvent)` at A `:602`–`:605`** (its `stopPropagation()` is at
> `:603`). It is not part of D1's nested-element defect and is out of scope (NFR-9).

### 6.2 Focus-visible rings (AC7)

**There is no existing focus-ring convention in these three files — zero matches for `focus-visible`,
`focus:` or `tabindex` across all three.** Whatever utility you pick will be the first, so pick one
and apply it consistently to every control you touch.

Two specific hazards:

1. **`btn-ghost` (daisyUI).** Used on B `:95`, `:143` and C `:71`, `:82`, `:94`. Task 6.4 requires you
   to **verify `btn-ghost` does not suppress the focus ring** — daisyUI's `.btn` sets its own
   focus-visible outline behaviour. Check it renders in the real app, not just in a unit test. If it
   suppresses, override explicitly on the element.
2. **Hover-gated controls are invisible to keyboard users.** A's close button is `opacity-0
group-hover:opacity-60` (`:247`) and C's action cluster is `opacity-0 group-hover:opacity-100`
   (`:65`). A keyboard user tabbing to them today sees **nothing**. Add `focus-visible:opacity-100`
   on the control (and `focus-within:opacity-100` on C's wrapper `<span>`).

   **This is not an AC6 violation.** AC6 fixes the appearance of existing states; revealing a control
   on keyboard focus is a _new_ state that had no rendering at all. Call it out in your report so the
   reviewer does not read it as unauthorised visual drift.

---

## 7. Verification — what "done" means

### 7.1 Acceptance criteria (all must pass)

- **D1 AC1** — DOM validation finds **no nested interactive elements** anywhere in the editor and
  source-control panels
- **D1 AC2/AC3** — tab-select, tab-close, section toggle and stage-all/unstage-all each receive focus
  independently and activate via **both Enter and Space**
- **D1 AC4** — a distinct, accurate label and role for each control
- **D1 AC5** — activating an inner control does not fire the outer one, **with `stopPropagation`
  deleted**
- **D1 AC6** — visual appearance unchanged
- **D1 AC7** — visible focus indicator on keyboard focus
- Standing gates §2

### 7.2 Tests

- `editor-panel.component.spec.ts` **exists** — extend it in place. Do not create a parallel spec
  file. It carries Batch 4's drag specs; **they must still pass unmodified.**
- **`source-control-panel.component.ts` and `source-control-file.component.ts` have NO spec files.**
  Create them. At minimum: click-isolation without `stopPropagation` (AC5), Enter and Space
  activation (AC2/AC3), `aria-expanded` reflecting state, and no `button`-inside-`button` in the
  rendered DOM (AC1).
- **`@axe-core/playwright` is available** (`package.json:202`). AC1 is a DOM-validation claim, and a
  nested-interactive-element check is exactly what axe's `nested-interactive` rule covers. Prefer it
  over hand-rolled assertions for AC1 if you can wire it into the existing
  `apps/ptah-electron-e2e/src/specs/editor/` suite; if that is not reachable cheaply, say so plainly
  and assert against the rendered DOM in the Jest specs instead. **Do not claim an axe pass you did
  not run.**
- **AC6 has no automated proof.** Verify visually in Electron and state in your report what you
  compared and how. If you cannot verify a case, report it as unverified — do **not** report it as a
  pass (B0 AC4 discipline applies to every claim in this task, not just measurements).

---

## 8. Concurrency — the branch is shared

**A concurrent session is active on TASK_2026_177** on this branch, working across
`apps/ptah-license-server/**`, `libs/api/**`, `libs/api-contracts/**`, `libs/web/**`,
`tsconfig.base.json` and `marketing/**`. It commits its own work independently (most recently
`54650edee`).

- **Perform ZERO git operations.** No `add`, `commit`, `stash`, `checkout`, `reset`, `restore`,
  `clean`. Read-only `git status` / `git diff` / `git log` are fine.
- **Do not "clean up" any file outside §3–§5.** If `git status` shows unfamiliar modified files, they
  are the other session's. Leave them.
- Re-read before every `Edit`. The tree can change under you.
- Run lint **scoped per project**, not repo-wide (§2).

---

## 9. Report back

Return an implementation report covering:

1. Files modified, with absolute paths
2. The de-nesting shape you landed per file, and any deviation from §3.2/§4.3/§5.2 with reasoning
3. **How you proved AC5 holds without `stopPropagation`** — this is the batch's central claim
4. AC6 evidence: what you compared visually, and anything you could not verify
5. The `btn-ghost` focus-ring finding (suppressed or not, and what you did)
6. Whether the axe route worked, or why you fell back
7. Standing gates §2 with verbatim results
8. Anything found and **not** fixed (NFR-9), stated plainly rather than silently left

Mark each task `⏸️`/`🔄 IN PROGRESS` → `🔄 IMPLEMENTED` in `tasks.md` via `Edit` on the exact status
line. **Do not commit.**
