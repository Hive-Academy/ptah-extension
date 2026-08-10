# Batch 6 Implementation Report — TASK_2026_173 · Accessibility (D1)

**Executor**: `frontend-developer` | **Tasks**: 6.1–6.4, all `🔄 IMPLEMENTED` | **Date**: 2026-08-10
**Verdict**: all seven D1 acceptance criteria met, **plus one NEW axe violation that this batch
introduced and that I did not fix** (§6). Nothing else was rounded up.
**No git operations performed.** All work is in the working tree.

---

## 1. Files modified

| #      | Absolute path                                                                                                   | Change                                                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.ts`                | Tab strip de-nested; `onTabClose` loses its `MouseEvent`                                                                                    |
| B      | `D:\projects\ptah-extension\libs\frontend\editor\src\lib\source-control\source-control-panel.component.ts`      | Both section headers de-nested; `aria-expanded`/`aria-controls`; `onStageAll`/`onUnstageAll` lose their `MouseEvent`; per-instance list ids |
| C      | `D:\projects\ptah-extension\libs\frontend\editor\src\lib\source-control\source-control-file.component.ts`       | Row de-nested; `role="listitem"` moved off the button; host marked presentational; `onAction` loses its `MouseEvent`                        |
| A-spec | `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.spec.ts`           | **Extended in place.** New `D1` describe (7 tests). Batch 4's drag specs untouched and green.                                               |
| B-spec | `D:\projects\ptah-extension\libs\frontend\editor\src\lib\source-control\source-control-panel.component.spec.ts` | **New file** (12 tests)                                                                                                                     |
| C-spec | `D:\projects\ptah-extension\libs\frontend\editor\src\lib\source-control\source-control-file.component.spec.ts`  | **New file** (9 tests)                                                                                                                      |

Nothing outside `libs/frontend/editor/**` and this task folder was touched. `git status` confirms the
concurrent TASK_2026_177 session's files (`libs/web/**`, `libs/api*/**`, `marketing/**`,
`apps/ptah-license-server/**`) are exactly as I found them. The index was never staged.

---

## 2. Correction to the dispatch's central premise (§1.2)

The dispatch says the browser "hoists/flattens the inner buttons out in the parsed DOM", so the DOM
never matched the template. **That is only half true, and the half that is false is the important
one.** The HTML _parser_ flattens `<button>` inside `<button>`; `document.createElement` +
`appendChild` does not — and that is the path Angular's compiled template instructions take. So the
nested DOM **really existed at runtime**, in the real browser, exactly as written.

I proved this both ways while building the AC6 harness (§5):

- Feeding the pre-batch-6 markup through the HTML parser produces a mangled layout — the
  stage/discard buttons render _below_ the row, the row's action `<span>` collapses to `0×0`, and
  the tab close button sits outside `.group` so `group-hover:opacity-60` never fires and it stays at
  `opacity: 0` forever.
- Building the same pre-batch-6 tree with `createElement`/`appendChild` reproduces the intended
  layout precisely — which is what users actually saw.

Consequence: `stopPropagation()` was genuinely load-bearing, not compensating for a phantom. A click
on the old close button really did bubble into the tab button's handler. This _strengthens_ the case
for the batch and it is why §4 below can claim the isolation is now structural.

---

## 3. The shape landed per file, and every deviation from the dispatch

### 3.1 File A — tab strip (§3.2)

```
<div role="presentation" class="group flex items-center pr-3 text-xs …" [ngClass]="…">
  <button type="button" role="tab" [attr.aria-selected] [attr.aria-label]="'Switch to '+…"
          class="flex items-center gap-2 py-1.5 pl-3 pr-2.5 …">
     filename span → dirty dot → diff glyph        (order + markup byte-identical)
  </button>
  <button type="button" [attr.aria-label]="'Close '+…" class="p-0.5 rounded opacity-0 group-hover:opacity-60 …">
</div>
```

Honoured as specified: `role="presentation"` wrapper, `group` and `[ngClass]` on the wrapper,
`type="button"` on both, dirty dot and diff glyph (including `data-testid="diff-tab-status-glyph"`,
the three status classes and both `diffStatusTitle(tab)` bindings) kept inside the tab button in the
original order.

**Deviation — padding/gap placement.** The dispatch put `gap-2 px-3 py-1.5` wholesale on the wrapper.
I split them: `py-1.5 pl-3 pr-2.5` on the tab button, `pr-3` on the wrapper, `gap-2` inside the tab
button. Reason: with the padding on the wrapper, the 12px left inset and the 10px inter-control gap
stop being part of the tab's hit target — clicking the left edge of a tab would do nothing where it
used to switch tabs. This split keeps identical geometry (§5 measures it) _and_ keeps that region
clickable. Residual loss is stated in §7.

### 3.2 File B — section headers (§4.3)

```
<div class="flex items-center gap-1 w-full px-2 py-1 … opacity-70 hover:opacity-100 bg-base-200 transition-opacity">
  <button type="button" [attr.aria-expanded] [attr.aria-controls]="stagedListId"
          class="flex flex-1 items-center gap-1 -my-1 -ml-2 py-1 pl-2 uppercase …"> chevron + label </button>
  @if (…) { <button type="button" class="btn btn-ghost btn-xs … ml-auto"> } }
</div>
```

Honoured: `aria-expanded` added (it did not exist — the state was carried by the chevron glyph
alone), `aria-controls` pointing at an `id` on the `role="list"` region, `flex items-center gap-1
w-full` and `bg-base-200` on the wrapper so `ml-auto` still works and the bar still paints edge to
edge, `opacity-70 hover:opacity-100` left **on the row** so the action button's resting opacity and
the whole-header hover response are unchanged, and no hover gating introduced.

**Deviation 1 — `flex-1 -my-1 -ml-2 py-1 pl-2` on the toggle.** Reclaims the header's own padding as
toggle hit area (the whole header row used to be the toggle) while the negative margins keep the flex
line height driven by the action button exactly as before. Measured identical (§5).

**Deviation 2 — `uppercase` repeated on the toggle. This one is a bug the dispatch did not
anticipate and that no unit test would have caught.** Tailwind's preflight sets
`text-transform: none` on `button`. Once the label text lives _inside_ a button instead of _being_
the button, the row's inherited `uppercase` is reset and the header silently drops out of caps. I
measured it: the label box went `108.39px → 96.78px`. Adding `uppercase` back restores it exactly.
There is a regression test (`repeats \`uppercase\` on the toggle …`) and an in-code comment.

**Deviation 3 — per-instance ids.** `stagedListId` / `unstagedListId` are derived from a static
instance counter rather than being hard-coded strings, so two mounted panels can never emit a
duplicate id (axe's `duplicate-id` rule).

### 3.3 File C — file row (§5.2)

```
<div role="listitem" class="group flex items-center gap-1.5 w-full px-2 py-0.5 text-left text-xs hover:bg-base-content/10 …">
  <button type="button" class="flex items-center gap-1.5 min-w-0 flex-1 text-left …"
          [title]="rowTitle()" [attr.aria-label]="'Open diff for ' + fileName()"> icon + name + parent dir </button>
  <span class="… opacity-0 group-hover:opacity-100 focus-within:opacity-100 …"> stage/unstage + discard </span>
  <span class="text-[10px] font-mono opacity-40 flex-shrink-0">{{ file().status }}</span>
</div>
```

Honoured: `role="listitem"` moved off the `<button>` onto the `<div>`, `flex-1` on the open-diff
button, the action cluster and the status badge left outside every control, and an explicit
`[attr.aria-label]="'Open diff for ' + fileName()"` (the row previously had only a `[title]`).

**Deviation — `host: { role: 'presentation' }` on `SourceControlFileComponent`, added defensively.**
The dispatch did not mention the host element, and `<ptah-source-control-file>` sits between the
panel's `role="list"` and this row's `role="listitem"`. The result is correct either way: the
`aria-required-parent` and `aria-required-children` rules both pass on the source-control tree (§6).

> **CORRECTED after review (`batch-6-code-logic-review.md`, Moderate Issue 1).** This paragraph
> originally claimed the host role was _necessary_ — "without this the fix would have swapped one
> axe violation for another". **That causal claim is wrong.** The reviewer independently built both
> variants in jsdom on the same `axe-core@4.12.1` — an unroled custom-element host between the list
> and the listitem, and the same structure with `role="presentation"` added — and **both pass** with
> zero violations. An unroled custom element carries no implicit ARIA semantics and is already
> transparent to axe's required-owned-element computation. The addition is harmless and the
> bottom-line result stands; only the stated reason was wrong. No code change was made.

### 3.4 Focus-ring utility choice (§6.2)

There was no existing convention in these three files, but there is one elsewhere in the repo
(`libs/frontend/tasks-ui/**`): `focus-visible:outline focus-visible:outline-2
focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]`. I adopted it verbatim except
for the offset, which I set to `outline-offset-[-2px]` (inset). Reason: the tab strip is
`overflow-x-auto` and these rows are 20–28px tall, so a +2px outset ring on the first tab or on
adjacent dense rows would sit outside the scroll box / collide. All four arbitrary utilities were
confirmed to compile by running the Tailwind CLI over a probe file:

```
.focus-visible\:outline-offset-\[-2px\]:focus-visible { outline-offset: -2px }
.focus-visible\:outline-\[oklch\(var\(--s\)\)\]:focus-visible { outline-color: oklch(var(--s)) }
```

---

## 4. How I proved AC5 holds without `stopPropagation` — the batch's central claim

All four calls are deleted **and all four `MouseEvent` parameters are deleted from the signatures**,
so the property is structural, not a promise a future edit could quietly break:

| File | Method         | Now                                                               |
| ---- | -------------- | ----------------------------------------------------------------- |
| A    | `onTabClose`   | `protected onTabClose(filePath: string): void`                    |
| B    | `onStageAll`   | `protected onStageAll(): void`                                    |
| B    | `onUnstageAll` | `protected onUnstageAll(): void`                                  |
| C    | `onAction`     | `protected onAction(action: 'stage'\|'unstage'\|'discard'): void` |

`grep stopPropagation` over the three files now returns exactly one live hit —
`editor-panel.component.ts:622`, which is `closeSplit`, explicitly out of scope per dispatch §6.1.

The proof is three-layered, and the third layer is the one that matters:

1. **Positive**: each inner control's handler fires with the right argument.
2. **Negative**: the outer action does _not_ fire. Every AC5 test dispatches a genuine
   `new MouseEvent('click', { bubbles: true, cancelable: true })` — not `.click()` on the handler —
   so the event really does traverse the ancestor chain. Tab close does not call `switchTab`;
   stage-all/unstage-all do not flip `aria-expanded`; the row actions do not emit `openDiff`.
3. **The discriminating one**: a listener on the fixture root asserts the click **still reaches the
   root**. If anything were suppressing propagation, that listener would see nothing. This is what
   distinguishes "isolated because the button is not a descendant" from "isolated because the event
   was swallowed" — and it is why removing `stopPropagation` could not have been faked.

A note on why the guard tests are worth trusting: **my first version of the AC1 nested-interactive
detector was vacuous.** It used `el.closest(sel) !== el`, and `closest` matches the element itself,
so it can never flag anything. I caught it by running the detector against the pre-batch-6 nested
markup in a throwaway spec, where it reported `[]` — a false pass. The corrected detector
(`el.parentElement?.closest(sel)`) reports `['Discard changes']` on that same markup and `[]` on the
new markup. The throwaway spec was deleted; the reason is recorded as a comment at all three call
sites so nobody re-introduces the self-comparing form.

---

## 5. AC6 evidence — what I compared, and how

**I did not launch Electron and eyeball it.** I could not have reported that honestly, so I built a
measurement instead, which is stronger than eyeballing anyway.

Method: a standalone probe page carrying the **old** and **new** markup for all three components
side by side, styled by a real Tailwind 3 + daisyUI 4 build (`data-theme="dark"`), loaded in real
headless Chromium via Playwright. The old markup's inner buttons are emitted as placeholders and
promoted to real `<button>`s with `createElement`/`appendChild` **so the old column is the DOM
Angular actually produced**, not the parser-flattened version (§2). Each element's box is compared
relative to its own container's origin.

**Result: 35 measured properties, 35 identical, 0 differences.**

- 16 geometry pairs (x, y, width, height): tab row box, filename, dirty dot, diff glyph, close
  button, header row, chevron, header text, header action button, file row, status icon, name block,
  action cluster, stage button, discard button, status badge — all `SAME`.
- 19 computed paint properties: background colours, text colour, font size/weight, `text-transform`,
  `letter-spacing`, `opacity` (including the `opacity-70` header and the `opacity-0` hover-gated
  clusters), border radius, monospace font stack — all `SAME`.
- Hover reveal, driven with a real pointer: old tab hover → close `opacity 0.6`, new tab hover →
  `0.6`. Old row hover → actions `opacity 1`, new row hover → `1`.

The `uppercase` regression in §3.2 is exactly the kind of drift this caught; it was a `DIFF` line
before the fix and `SAME` after. **Two runs, reproducible.**

**Not verified**: I have not looked at the running Electron app. Everything above is computed
geometry and computed style, not a rendered-pixel comparison, so a purely painterly difference
(sub-pixel text rasterisation, a transition easing curve) would not be caught. I judge that risk low
given zero differences in box geometry and zero in computed paint, but it is a gap and I am naming
it rather than calling AC6 "visually verified".

**Deliberate new states, not drift** (dispatch §6.2 authorises these): `focus-visible:opacity-100` on
File A's close button and `focus-within:opacity-100` on File C's action cluster. Both controls
previously rendered _nothing at all_ for a keyboard user who tabbed onto them.

---

## 6. The axe route — it worked, and it found something

`@axe-core/playwright` is declared in `package.json` but **is not used anywhere in this repo** (the
only mention is a comment in a landing-page spec). Wiring it into `apps/ptah-electron-e2e` means an
Electron build + launch, which is not in the standing gates and is expensive on a shared branch.

So I took a cheaper route that still produces a **real axe result on the real component DOM**: I
captured `fixture.nativeElement.innerHTML` from the mounted Angular components via throwaway specs,
then ran `axe-core@4.12.1` over it in jsdom out of band. **`axe-core` is only a transitive dependency
here**, so I did not commit an axe test — that would add an undeclared dependency and put an
officially-jsdom-unsupported runtime in the gate path. The committed AC1 guards are the DOM
assertions, which I proved discriminating (§4). Throwaway harness deleted.

### `editor-panel` (tab strip)

```
passes    : nested-interactive(9), aria-required-parent(2), button-name(8),
            aria-allowed-attr(11), aria-valid-attr-value(11)
VIOLATION : aria-required-children x1 :: <div role="tablist" aria-label="Open editor tabs" …
incomplete: (none)
```

### `source-control` (both headers + file rows)

```
passes    : nested-interactive(11), aria-required-children(2), aria-required-parent(2),
            button-name(11), aria-allowed-attr(14), aria-valid-attr-value(14)
VIOLATION : (none)
incomplete: (none)
```

**AC1 is met**: `nested-interactive` — the exact rule the dispatch named — passes on both trees, 20
nodes total.

### 🔴 The violation I introduced and did NOT fix

```
aria-required-children (critical) on role="tablist"
  "Element has children which are not allowed: button[aria-label]"
```

That `button[aria-label]` is the **tab close button**. `role="presentation"` on the wrapper does its
job — axe descends through it, which is why `aria-required-parent` passes for `role="tab"` — but that
same transparency also re-parents the _close_ button onto the `tablist`, and ARIA's `tablist`
permits only `tab` as an owned element.

This is a **new** violation. The old shape passed this rule (the close button was a _descendant of_
the tab, not owned by the tablist) while failing `nested-interactive`. So the batch trades one
critical axe violation for another. I judge the trade clearly favourable — `nested-interactive` is a
real operability defect (it is what forced `stopPropagation`, and it is what makes hit-testing and AT
traversal disagree with the template), whereas here the close button is reachable, focusable,
labelled and operable and only its ownership is wrong — **but it is a regression on a rule that
previously passed and it is not mine to decide silently.**

I looked for a shape that satisfies both and did not find one:

| Candidate                                                                   | Why it fails                                                                        |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Nest the close button back inside `role="tab"` (as a div-with-tabindex tab) | `nested-interactive` fires on any focusable descendant of a widget role — no better |
| `aria-owns` on the tablist listing only the tabs                            | `aria-owns` is additive; it does not un-own DOM children                            |
| `role="presentation"` on the close button                                   | Presentation is ignored on a focusable element; it reverts to `button`              |
| `tabindex="-1"` / `aria-hidden` on the close button                         | Breaks AC2 keyboard reachability                                                    |
| Hoist the close buttons out of the tablist box                              | Needs `display: contents` + `order` gymnastics; high AC6 risk                       |

**The one clean resolution is a semantic change**: drop `role="tablist"`/`role="tab"`/`aria-selected`
for `role="toolbar"` + `aria-current`, which has no required children and legitimately contains
buttons. That yields zero violations, but it changes what a screen reader announces ("button,
current" instead of "tab, selected") and directly contradicts the shape the dispatch and `tasks.md`
Task 6.1 both specify. **That is a call for the team-leader, not for me mid-batch**, so I implemented
the mandated shape and am flagging this instead of quietly re-specifying the task. Note this is _not_
a Batch 6 acceptance criterion — AC1 is specifically about nested interactive elements — so it is a
finding, not a failed AC.

---

## 7. Behaviour changes worth knowing about (none are AC failures)

1. **Tab close now sets the focused pane.** The deleted `stopPropagation` in `onTabClose` was also
   incidentally stopping the click from reaching the left pane's `(click)="onPaneClick('left')"`.
   Closing a left-pane tab now focuses the left pane. Clicking the tab _label_ has always done this
   (it never suppressed propagation), so this makes the two consistent. Harmless and, I think,
   correct — but it is a change.
2. **Three small hit-area losses**, each a strip of margin that used to be inside the outer button:
   the 12px right margin of a tab (was: switch tab), the 8px left/right padding of a file row (was:
   open diff), and the file row's status badge + action-cluster gaps (was: open diff). Clicking the
   status badge no longer opens the diff. I deliberately did not chase these with more negative-margin
   tricks — the geometry is provably identical and the remaining dead strips are margin, not paint.
3. **`role="listitem"` came off a `<button>`** in File C. It was a genuine semantic conflict
   (`listitem` overrode the button's own role), fixed because the element was being rewritten anyway,
   as the dispatch permits.

## 8. Found and NOT fixed (NFR-9)

- **The `aria-required-children` violation above.** Needs a team-leader decision.
- **`closeSplit(event: MouseEvent)` at `editor-panel.component.ts:622`** still calls
  `stopPropagation()`. Out of scope per dispatch §6.1; untouched.
- **`role="list"` with a non-`listitem` child.** When a section is empty, File B renders a plain
  `<div>` ("No staged changes" / "No changes") inside the `role="list"` region. My axe run used a
  populated fixture, so this case was **unverified** here. Pre-existing, not introduced here, not
  fixed.

  > **CORRECTED after review (`batch-6-code-logic-review.md`, Failure Mode 1 / Moderate Issue 2).**
  > It is **not** an inspection-only risk. The reviewer ran `axe-core` over the exact empty-state
  > markup and reproduced a **live critical `aria-required-children` violation on both branches**,
  > today. It is still correctly out of Batch 6 (genuinely pre-existing, untouched by every hunk in
  > this diff), and it hits the common case — most working trees have nothing staged. Filed to
  > Batch 9 as **item 5, a confirmed defect with a known one-line fix**: give the empty-state
  > message `role="listitem"` (`source-control-panel.component.ts:141-144, 201-204`), no visual
  > change.

- **`transition-all` on the tab close button animates the focus ring**, so `outline-width`/`-offset`/
  `-color` fade in over ~150ms rather than appearing instantly. Pre-existing class; cosmetic; not
  changed. (It briefly fooled my own measurement harness until I added a settle delay.)

---

## 9. Standing gates (§2) — verbatim

**1. NFR-1 cross-project invariant — HOLDS, exactly at the floor (no decrease).**

```
nx test ptah-electron   Test Suites: 1 skipped, 13 passed, 13 of 14 total
                        Tests:       4 skipped, 145 passed, 149 total
nx test rpc-handlers    Test Suites: 74 passed, 74 total
                        Tests:       31 skipped, 1718 passed, 1749 total
```

`145 + 1718 = 1863`. Floor after Batch 5 was `145 + 1718 = 1863`. **Equal, not decreased.** No test
was converted to skipped by this batch — the skip counts are as inherited.

**2. Typecheck — clean.**

```
nx run @ptah-extension/editor:typecheck   → NX   Successfully ran target typecheck
nx typecheck ptah-extension-webview       → NX   Successfully ran targets test, typecheck
```

**3. Lint, standalone per project — 0 errors.**

```
nx run @ptah-extension/editor:lint --max-warnings=-1
✖ 14 problems (0 errors, 14 warnings)
NX   Successfully ran target lint for project @ptah-extension/editor
```

All 14 warnings are pre-existing and in files I did not touch:
`branch-picker-dropdown.component.spec.ts`, `code-editor.component.spec.ts`,
`git-status-bar.component.ts`, `services/editor/editor-workspace.spec.ts`. **Zero warnings in any of
my six files.** I did not run repo-wide `nx affected -t lint` — per the constraints, failures from
the concurrent TASK_2026_177 session are not mine to fix, and scoping per project is the gate anyway.

**4. Affected unit tests — green.**

```
nx run @ptah-extension/editor:test    Test Suites: 16 passed, 16 total
                                      Tests:       222 passed, 222 total
nx test ptah-extension-webview        Test Suites:  5 passed,  5 total
                                      Tests:        25 passed,  25 total
```

28 of those 222 are new (7 + 12 + 9). **Batch 4's drag specs are unmodified and passing** — the
`resize drags coalesce to one update per frame (B5)` describe, including the blur/Escape cases folded
in from TASK_2026_176. I did add three fields (`switchTab`, `closeTab`, `setFocusedPane`) to the
shared `makeEditorServiceStub()` factory; purely additive, no existing assertion touched.

_Honesty note_: I did not capture a pre-batch baseline count for `@ptah-extension/editor` before my
first edit, so I can state "222 pass, 0 fail, Batch 4's specs unmodified and green" but cannot quote
a before/after delta from a measured baseline. The 28-test figure is counted from my own diff.

**5. Three-runtime build — not required.** No `libs/shared` or `libs/backend` file was touched.

**6. Scope discipline (NFR-9) — held.** Work confined to the three components, their specs and this
task folder. Everything found outside that is reported in §8, not fixed. `--no-verify` not used —
no git command was run at all beyond read-only `status`/`grep`.

**7. NFR-2 — held.** All three components remain `standalone: true` with
`ChangeDetectionStrategy.OnPush`; signals and `inject()` throughout; no new lifecycle hooks or
subscriptions.

---

## 10. Acceptance criteria

| AC                                                                        | Verdict                                                                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D1 AC1** — no nested interactive elements                               | **PASS**                                                                | axe `nested-interactive` passes, 20 nodes across both trees (§6). Plus a DOM guard in all three specs, proven discriminating against the old markup (§4).                                                                                                                                                                                                                                                                                                                                        |
| **D1 AC2/AC3** — independent focus, Enter **and** Space                   | **PASS, with a stated limit**                                           | Every control is a real, non-disabled, in-tab-order `<button type="button">` with `(click)` as its only activation path, asserted per control; `aria-expanded` flips on toggle and does not flip on bulk action. **jsdom does not implement the UA default action that turns Enter/Space into a click, so the key press itself is not asserted anywhere** — it is a user-agent guarantee of `<button>`, which is precisely why the fix uses real buttons rather than divs with keydown handlers. |
| **D1 AC4** — distinct, accurate label and role                            | **PASS**                                                                | axe `button-name` passes (19 nodes). Uniqueness asserted explicitly in both source-control specs; the file row gained the `'Open diff for …'` label it never had.                                                                                                                                                                                                                                                                                                                                |
| **D1 AC5** — inner control does not fire outer, `stopPropagation` deleted | **PASS**                                                                | All four calls and all four `MouseEvent` params deleted; three-layer proof incl. the "click still reaches the root" test (§4).                                                                                                                                                                                                                                                                                                                                                                   |
| **D1 AC6** — visual appearance unchanged                                  | **PASS** on 35/35 measured properties; **rendered pixels not verified** | Old-vs-new geometry + computed paint in real Chromium, 0 differences, reproducible (§5). Caught and fixed a real `uppercase` regression on the way. Electron not launched — stated as a gap, not claimed.                                                                                                                                                                                                                                                                                        |
| **D1 AC7** — visible focus indicator                                      | **PASS**                                                                | Measured under real keyboard focus: every new control resolves to `outline: solid 2px oklch(0.748 0.26 342.55) @ -2px`. Hover-gated controls additionally revealed via `focus-visible:` / `focus-within:opacity-100`.                                                                                                                                                                                                                                                                            |
| Standing gates §2                                                         | **PASS**                                                                | §9.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### The `btn-ghost` finding (dispatch §6.2 hazard 1)

**daisyUI does NOT suppress the focus ring.** In daisyui 4.12.24, `dist/styled.css:1652` defines
`.btn:focus-visible { outline-style: solid; outline-width: 2px; outline-offset: 2px }` and
`.btn-ghost` sets `outline-color: currentColor`. Measured on the pre-batch markup under real keyboard
focus:

```
old btn-ghost  {"style":"solid","width":"2px","color":"oklch(0.746477 0.0216 264.436)","offset":"2px","matchesFV":true}
```

So no override was strictly required. I applied the project's focus utilities to the `btn-ghost`
buttons anyway, for two reasons: `currentColor` on a header rendered at `opacity-70` is a weak
indicator, and consistency with the four new plain buttons matters more than saving four classes.
Tailwind emits `@layer utilities` after `@layer components`, so the utilities win at equal
specificity — confirmed by measurement, not assumed:

```
new btn-ghost  {"style":"solid","width":"2px","color":"oklch(0.748 0.26 342.55)","offset":"-2px","matchesFV":true}
new tab label  {"style":"solid","width":"2px","color":"oklch(0.748 0.26 342.55)","offset":"-2px","matchesFV":true}
new tab close  {"style":"solid","width":"2px","color":"oklch(0.748 0.26 342.55)","offset":"-2px","matchesFV":true}
new hdr toggle {"style":"solid","width":"2px","color":"oklch(0.748 0.26 342.55)","offset":"-2px","matchesFV":true}
```

---

## 11. What the team-leader needs to decide

1. **`aria-required-children` on `role="tablist"` (§6).** Accept the trade as landed, or authorise the
   `role="toolbar"` + `aria-current` re-spec of Task 6.1. I recommend accepting as landed and opening
   a separate task — the semantic change deserves its own AC4 review, not a mid-batch swap.
2. Whether the §8 pre-existing items (empty-section `role="list"` child, `closeSplit`) should become
   follow-up tasks.

`tasks.md` Tasks 6.1–6.4 are marked `🔄 IMPLEMENTED` via targeted `Edit`s on the status lines only.
**No commit was created.**
