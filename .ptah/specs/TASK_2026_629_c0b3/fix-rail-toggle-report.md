# Fix report: Rail toggle, empty-board overflow, landmark test (PR #730, fix round 1)

Source: `code-logic-review-ci-fix-canvas.md` findings 1, 2 and 5. Paths below are relative to
`libs/frontend/canvas/src/lib/canvas-rail/`.

| Finding | Fix file:line | Test spec:line | Result |
| --- | --- | --- | --- |
| 1 Serious: toggle is dead while auto-collapsed and rewrites the persisted `railCollapsed` | `canvas-rail-board.component.ts:299` (new `autoCollapsed` computed: width `0 < w < RAIL_AUTO_COLLAPSE_PX`, or sm band + details open, not split); `:305` (`effectiveCollapsed = railCollapsed \|\| autoCollapsed()`); `:84` (`[autoCollapsed]` passed to `ptah-canvas-rail`); `:684` (`toggleCollapse` returns early). `canvas-rail.component.ts:27` (reason text), `:249` (`autoCollapsed` input), `:111-128` (toggle: `data-testid`, `opacity-60`, `aria-expanded`, `aria-disabled`, `aria-describedby`, `title`, sr-only reason span), `:301-302` (`onCollapseToggle` refuses the emit) | `canvas-rail-board.component.spec.ts:746` (width 639: click does not call `store.setRailCollapsed`, persisted stays false, Rail still collapsed); `:759` (width 640: click calls `setRailCollapsed('workspace', true)` as before); `:772` (sm band + details open: no write). `canvas-rail.component.spec.ts:70` (`aria-expanded` follows `collapsed`, click emits); `:84` (auto-collapsed: not `disabled`, `aria-disabled="true"`, `title` and `aria-describedby` reason "Widen the canvas to expand the Rail", focusable, click does not emit) | Pass |
| 2 Moderate: empty-board section clips the setup card on short panes | `canvas-rail-board.component.ts:108-148`: section is now `flex min-h-0 min-w-0 flex-1 flex-col items-center overflow-y-auto p-6 text-center` (no `justify-center`); its content moved into an inner `my-auto flex w-full flex-col items-center gap-3` wrapper (`:114-117`), following `main:canvas-empty-state.component.ts` lines 27-30 | `canvas-rail-board.component.spec.ts:784` (section has `overflow-y-auto` and `min-h-0`, no `justify-center`; direct child wrapper has `my-auto` and holds the heading and the setup card) | Pass |
| 5 Minor: "no nested landmark" board test is vacuous | `canvas-rail-board.component.spec.ts` `mount()` gains a `realFocus` flag that renders the real `CanvasFocusAreaComponent` (its header, lane tabs and lane view inert via `imports: []` + `NO_ERRORS_SCHEMA`; `ChatStore`, `laneKeyFor` and `isSessionRunning` stubs provided). The vacuous assertion on the `FocusStub` pane (old `:1292`) is removed | `canvas-rail-board.component.spec.ts:1370`: single pane and split; each labelled pane contains the real `ptah-canvas-focus-area section` (asserted non-null), that section has no `aria-label`/`aria-labelledby`, and the pane has no labelled descendant. It fails if the inner section regains an `aria-label` | Pass |

## Decisions

- **Disable whenever the auto condition holds, not only when the persisted value is false.** If the
  persisted value is `true` and the board is narrow, a click would write `false` with no visible
  change, which is the same silent rewrite. `autoCollapsed` is therefore the pure width/details
  condition, and `toggleCollapse` returns early on it regardless of the persisted value. Every
  case the brief named (persisted false) is covered.
- **`aria-disabled`, not the native `disabled` attribute.** This file and its siblings keep refused
  controls focusable (`canvas-rail.component.ts` footer New session; `canvas-rail-card.component.ts`
  Open beside / Move up / Move down): `aria-disabled="true"`, `opacity-60`, a `title`, an
  `aria-describedby` reason, and a click guard. The toggle follows that pattern, so keyboard and
  screen-reader users still reach it and hear why it does nothing; a native `disabled` button would
  also suppress the `title` tooltip in most engines. The click is refused twice: in the Rail
  (`onCollapseToggle`) and in the board (`toggleCollapse`).
- **`aria-expanded` added** (the file had none): `!collapsed()`, the visible state, alongside the
  existing changing `aria-label`. No `aria-controls`, because the Rail list has no id and adding
  one was outside the brief.
- **Reason text:** "Widen the canvas to expand the Rail" (the brief's wording). It is a module
  constant in `canvas-rail.component.ts`; it is not shared, because only this control uses it.
- **Empty board:** `min-h-0` added to the section so it never grows past the row in a flex parent;
  `justify-center` removed because, with overflow, it clips the top. `my-auto` on the inner wrapper
  keeps the content vertically centred while it fits.
- **Landmark test:** a `realFocus` flag on the shared `mount()` instead of a second setup function,
  so the new test reuses the same store, layout and tab stubs. The default (`FocusStub`) path is
  unchanged; the `CanvasDetailService` and `ChatStore` stubs apply only when `realFocus` is set.
- **Not done (outside ownership):** the focus-area spec (`canvas-focus-area.component.spec.ts:276`)
  is unchanged. No mutation run edited `canvas-focus-area.component.ts`, because that file is
  outside this fix's ownership. The new assertion reads the real component's `<section>` directly.

## Checks

All checks went through `node .ptah/tmp/check-run.mjs <label> -- <command>`, one at a time.

- `rail-spec` / `rail-spec2`: `npx nx test canvas --testFile=libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `Test Suites: 1 passed, 1 total` / `Tests: 12 passed, 12 total`. The second run followed a
    lint-only spec edit.
- `board-spec`: `npx nx test canvas --testFile=libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts ...`
  - `Test Suites: 1 passed, 1 total` / `Tests: 83 passed, 83 total`, no `●` lines.
- `canvas-full`: `npx nx test canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `Test Suites: 23 passed, 23 total` / `Tests: 367 passed, 367 total`, no `●` lines.
- `canvas-typecheck`: `npx nx typecheck canvas --parallel=1 --skip-nx-cache`
  - `Successfully ran target typecheck for project @ptah-extension/canvas`.
- `canvas-lint2`: `npx nx lint canvas --parallel=1 --skip-nx-cache`
  - `✖ 31 problems (0 errors, 31 warnings)`, `Successfully ran target lint`.
  - My two new non-null assertions were removed.
  - The remaining warnings in the touched files existed before this fix:
    - `max-lines` on `canvas-rail-board.component.ts` (767 lines; the file is already over 700,
      and this fix adds about 12 lines).
    - `no-non-null-assertion` in older spec lines.
