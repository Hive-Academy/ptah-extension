## Frontend implementation — `TASK_2026_699_833e`, rev 4 (all batches: chat batch = components 1, 2, 5; canvas batch = components 3, 4)

**Tasks completed**: components 1-5 of `implementation-plan-rev4.md` (APPROVED; decisions rows 13-19). Component 6 (chat-ui atoms, PLAN LIMITS card, lane-limits timeout) left untouched as specified. Nothing committed or staged.

### Chat batch

**Component 1: dock width math**
- CREATED `libs/frontend/chat/src/lib/services/session-inspector/inspector-dock-width.ts`: constants MIN 300 / MAX 560 / `INSPECTOR_MAIN_MIN_WIDTH` **360** (`:15`, comment cites decisions.md row 18 and the split-pane `min-w-[360px]`), tiers 1100/1500 → 336/400/448, `INSPECTOR_TAB_WIDTH` 32 (`:32`, names the canvas Stats tab). `inspectorMaxWidthFor` / `inspectorDefaultWidthFor` / `inspectorDockWidth` bodies copied unchanged from the branch shell controller. The parameter is renamed to `availableWidth` and the doc comments say "the width the tile area and the dock share".
- CREATED `.../inspector-dock-width.spec.ts`: the "width functions" cases from the deleted shell spec, with values recomputed for the 360 floor: max 552→300, 672→312, 880→520, 880.5→520, 1064→560; dock (560, 672.5)→312, (519.6, 880.9)→520, etc. Also one case pinning the floor at 360.
- MODIFIED `.../inspector-dock-width.store.ts:3-6`: only the import path changed (`./inspector-dock-width`).

**Component 2: decoupled `InspectorDockController`**
- MODIFIED `.../inspector-dock.controller.ts`: `bind(shown, availableWidth)` (`:65`) replaces `bindHosted`. `slotShown = shown()`. `width`/`maxWidth`/`commit` read `availableWidth()`. Removed: the `InspectorShellController` injection, `toggleFromTab`, `resizing`/`setResizing` (D-8). The draft still resets through `linkedSignal` on `slotShown`.
- REWROTE `.../inspector-dock.controller.spec.ts` (10 cases): unbound default tier with nothing written; `shown` source; default per tier (880/1124/1500); clamp as the width shrinks with the preference kept and restored; preview/cancel; commit once; commit at a clamped width writes nothing; fractional max floored; reset; draft cleared when `shown` goes false then true.
- MODIFIED `.../session-inspector/index.ts`: exports the controller, plus every constant and function from `inspector-dock-width`. The shell-controller export block is back to main's list. `git diff main` on this file shows only the new dock exports.

**Component 5: chat-view revert**
- REVERTED to main: `chat-view.component.{ts,html,css,spec.ts}` and `inspector-shell.controller.ts`. I ran `git checkout main -- …`, then `git reset -q` so the index stays untouched; only the working tree changed.
- DELETED `inspector-shell.controller.spec.ts` and `inspector-open-state.service.spec.ts`. Neither exists on main (`git cat-file -e main:…` fails), so no main coverage is lost.
- Check: `git diff main --stat -- libs/frontend/chat/src/lib/components/templates/ …/inspector-shell.controller.ts` is **empty**.

### Canvas batch

**Component 3: `railWidthPx`**
- MODIFIED `libs/frontend/canvas/src/lib/canvas-board-mode.ts:30`: `railWidthPx(collapsed, band)` returns 56 / 304 / 304 / 288 / 272.
- MODIFIED `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.spec.ts:262`: a parity `it.each` over xl/lg/md/sm and collapsed (lg, sm). It asserts that the rail `aside` has exactly one `w-[Npx]` class, equal to `railWidthPx(...)`.

**Component 4: canvas dock host** (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`)
- Imports: `INSPECTOR_TAB_WIDTH` and `InspectorDockController` from `@ptah-extension/chat` (`:18`); `SidebarTabComponent` and `SplitHandleComponent` from `@ptah-extension/chat-ui`; `railWidthPx`. `InspectorDockController` is added to `providers` (`:75`). `LucideAngularModule`, `PanelRight` and `detailsIcon` are removed because nothing else in the file used them.
- Template `:215-264`: one `@if (dockShown())` + `@if (focusedId(); as id)` block replaces both single-focus branches. In DOM order it holds:
  1. `ptah-sidebar-tab data-stats-tab label="Stats" side="left"`;
  2. when `dockSlotShown()`, the 0 px `relative z-10 w-0 shrink-0` slot with the inverted grip `ptah-split-handle` ("Resize session details");
  3. `<aside class="flex h-full shrink-0 flex-col border-l …" [style.width.px]="dock.width()">`. Inside it is the existing `@defer (on idle)` inspector, with `(closeRequested)="closeDock()"` and the "Session details" placeholder.

  The band width classes, the close-hiding class (D-6) and the sm 44 px "Open details" button are gone. The split overlay and the compact sheet are byte-unchanged.
- State:
  - `dockOpen` (`:379`) is a source-form `linkedSignal` over `computed(band() !== 'sm')`. It resets only when crossing sm ↔ md (D-3), and a closed dock stays closed between md, lg and xl.
  - `dockShown`, `dockSlotShown` (`:387`).
  - `dockAvailableWidth` (`:389`) = `max(0, containerWidth - railWidthPx(effectiveCollapsed, band) - 32)` (D-2).
  - `statsTabBadge` (`:398`) is `'warning'` when the dock is closed and `needsYouCount > 0`, otherwise null.
  - `autoCollapsed` reads `dockOpen()` (`:410`).
  - `dock.bind(...)` runs in the constructor (`:419`).
- Methods: `toggleDetails()` keeps its name and now toggles `dockOpen`, then calls `anchor()`. The new `closeDock()` (`:913`) sets `dockOpen` false, calls `anchor()`, then after the next render focuses `[data-stats-tab] button`.
- Comment on `RAIL_AUTO_COLLAPSE_PX` (value 640 unchanged): it now says 32 px Stats tab instead of 44 px details control.
- MODIFIED `canvas-rail-board.component.spec.ts`:
  - Harness changes:
    - the atoms replace `LucideAngularModule` in the `set` imports;
    - `beforeEach`/`afterEach` clear `ptah.inspector-dock-width.v1`;
    - the real root `InspectorDockWidthStore` resolves (A2 holds).
  - Rewritten: the md 1200 case (dock open, inline 336, valuemax 520, no "Open details") and the sm 760 case (tab `aria-expanded="false"`, no aside, no `button.w-11`).
  - New cases:
    - lg 1400 default: tab expanded, width = `inspectorDockWidth(null, 1064)` = 336, valuemax = `inspectorMaxWidthFor(1064)` = 560, plus valuemin and orientation;
    - the tab toggles and the badge reads warning while closed and null while open;
    - ArrowLeft → 352 is persisted, a remount restores 352, sm 760 clamps the render to 312 with the stored value kept, and widening restores 352;
    - Shift+ArrowLeft → 384, then Esc mid-drag keeps 384, then dblclick → 336 with the key removed;
    - the inspector close shuts the dock and focus lands on the `[data-stats-tab] button`, not on `body`;
    - md → sm closes, sm → md opens;
    - a closed dock stays closed from lg to md to xl;
    - floor `it.each` over 1400/1200/760/640 → valuemax 560/520/312/300, End renders that width, and no single-focus tile has `min-w-[360px]`;
    - explicit 0-tile case `mount(true, 0)`: no `[data-stats-tab]`, no separator, no `aside` (D-7);
    - split and compact sheet: no tab and no separator.
  - Unchanged and passing: the 574 case (two tiles, `aside:not([data-dock])` now hits the dock aside), the 685/1032/1167 auto-collapse cases, and the split overlay and compact-sheet suites.

**Stack observed**: Angular standalone, OnPush, signals, `input()`/`output()`/`inject()`, `linkedSignal` (root `package.json`, `inspector-dock.controller.ts`). Tailwind/DaisyUI classes (`canvas-rail-board.component.ts`). Width source: the existing `CanvasLayoutService.containerWidth` (no new observer, timer or listener).

**Design fidelity**: followed `design-spec.md` rev 3 §1-2 through plan component 4: inverted grip in a 0 px slot over the dock's leading edge, `w-3` hit area, label "Resize session details", widths 300-560, defaults 336/400/448. The atoms are unchanged.

**States covered**:
- Dock open and closed at every single-focus band.
- sm closed by default, with the rail auto-collapsed while the dock is open.
- 0-tile board renders nothing.
- Unmeasured board (width 0): default 336 and max 560.
- Accessibility: tab `aria-expanded` and the name "Toggle Stats panel"; separator `role`, `aria-orientation` and `aria-valuenow/min/max`; keyboard Arrow, Shift, Home, End and Esc, plus dblclick reset, all from the atom; close returns focus to the tab. Every `ptah-session-inspector` reference is still inside `@defer`.

**Verification**:
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/canvas --parallel=1` prints the header "Running targets typecheck, test, lint for 3 projects" (3 = 3 requested). All 9 tasks show √. "Successfully ran targets typecheck, test, lint for 3 projects". Cache 0/9 hit, run duration 5m 57s, exit 0.
- Grep: no `toggleFromTab`, `bindHosted`, `reservedWidth` or `setResizing` anywhere under `libs`/`apps`; no `@ptah-extension/chat/src` or `chat-ui/src` deep imports in canvas.
- e2e selectors in `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:149-163` target only the split header "Open details", which is unchanged.
- Not run, per the rules: build, serve, e2e, and the visual Electron pass. The visual pass belongs to visual-reviewer and also covers assumption A1 and risk R2.

**Plan deviations**:
- `dockOpen` uses the source-form `linkedSignal({ source: computed(band() !== 'sm'), computation })`. The plan's wording ("source `band() !== 'sm'`") could be read as the shorthand form. That form re-runs on every band change (md → lg) and would reopen a dock the user closed. A spec pins the behaviour.
- The Stats tab and dock render inside `@if (focusedId(); as id)` nested in `dockShown()`. That gives the inspector a typed id; the result is the same as the plan, since `dockShown` already requires `focusedId() !== null`.
- Prettier was not run on `canvas-rail-board.component.ts`, its spec or `canvas-rail.component.spec.ts`. On main these files are not prettier-formatted, so formatting them would reformat many unrelated lines. Prettier was run on the new and chat session-inspector files and on `canvas-board-mode.ts`; only `inspector-dock.controller.spec.ts` changed. Note: the lint-staged hook (`nx format:write`) will format those three canvas files in full at commit time unless the committer handles it.
- The plan names `inspector-dock-width.spec.ts` as CREATE. It is created; the existing `inspector-dock-width.store.spec.ts` needed no change.

**Out-of-scope observations**:
- `InspectorShellController` is still provided by the board (`:75`, as on main) and is only consumed by `SessionInspectorComponent` (`optional`). That is TASK_705's concern (R3).
- `.ptah/specs/TASK_2026_699_833e/.electron-userdata/` was not touched.
