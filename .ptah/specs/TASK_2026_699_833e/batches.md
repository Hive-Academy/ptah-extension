# Batches - TASK_2026_699_833e

Total tasks: 10 | Batches: 4 | Complete: 4/4

Worktree: `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock` (branch `feat/inspector-side-dock`).
All paths below are absolute. `W` = the worktree root above.

## Execution defaults (recorded)

- Order re-derived from `implementation-plan.md` "Team-leader handoff" (which invites it) so the dock
  dependency chain lands first and the independent card closes the phase: Batch 1 split-handle atom,
  Batch 2 chat services, Batch 3 chat-view host, Batch 4 PLAN LIMITS card. Batches 1, 2 and 4 are file-disjoint and independent; Batch 3 depends on 1 and 2. They run one at a
  time because CLAUDE.md allows one heavy check at a time and 1 and 4 share `@ptah-extension/chat-ui`.
- Executor (decisions.md row 12): every batch is a Claude `frontend-developer` subagent. CLI lanes are not
  used for implementation.
- One phase ("inspector-side-dock") = Batches 1-4. Phase review after Batch 4 commits: code-logic (codex lane,
  different family from the Claude implementer) + style (new public API on the exported
  `SplitHandleComponent`: `inverted`, `appearance`, `draggingChange`, `sizeCancel`) + visual (rendered UI,
  11 Electron screenshots per plan QA item 5).
- Peer-owned files never touched: `chat-transcript.component.css/html`, `message-bubble.component.css/html`,
  `chat-input.component.ts` (branch `fix/chat-column-alignment`). No batch lists them.
- Commits: foreground, `.commitlintrc.json` scopes (`chat-ui`, `chat`), subject <= 72, body lines <= 100,
  never pushed by team-leader.

## Notes: later tasks (out of scope, not fixed here)

- Pre-existing `SplitHandleComponent` host-class bug (found in Batch 1): Angular parses the host keys
  `'[class.w-1.5]'` / `'[class.h-1.5]'` at the dot, so the class applied is `w-1` / `h-1` (4 px, not 6 px) for
  every `line` handle (`agent-lane-grid`, `compact-session-activity`). Left unchanged per R4; Batch 1 spec pins
  the classes that actually render. Fix in a later task (e.g. computed `host: { class }` string or `w-[6px]`),
  accepting the 2 px visual change for both existing consumers.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- Every CREATE file is absent and every MODIFY file exists on disk (checked 2026-10-19: 5 missing, 12 present)
  — verified.
- `SidebarTabComponent.badgeType` accepts `'warning' | 'info' | 'neutral' | null`
  (`sidebar-tab.component.ts:127`) — verified; the `inspectorDot` mapping fits.
- `InspectorShellController.tab`/`isModal` are public computeds (`inspector-shell.controller.ts:116,140`) and
  `toggle()` has no parameter today (`:216`); the Rail board calls it with none — verified; default parameter is
  additive.
- `LoggingService.warn(context, message, data?)` exists (`logging.service.ts:173`) — verified.
- `pointerUp` calls `finishDrag()` before `sizeCommit.emit()` (`split-handle.component.ts:100-105`) — verified;
  this is why cancel needs its own `sizeCancel`.
- A1 (webview `localStorage` survives Electron restart / VS Code reload) — unverified; checked in the QA visual
  pass.
- A2 Tailwind 3.4 has no `/8` opacity step and the webview tailwind config does not extend opacity
  (`apps/ptah-extension-webview/tailwind.config.js`), and no `bg-base-content/8` exists in `libs` — decided:
  use `bg-base-content/[0.08]` (Task 1.1).
- A3 "tab dimmed" = `opacity-50` — unverified; confirmed in the visual review.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R1: Handle destroyed mid-drag (shell narrows into the sheet band, tab switch, inspector closes) while chat-view lives. `split-handle` cancels on destroy (`split-handle.component.ts:120`), but its outputs are already destroyed, so Angular 22 drops `sizeChange`/`sizeCancel`/`draggingChange(false)` with an NG0953 warning. `dockDraftWidth` and `dockResizing` would stay set, and a stale draft would render when the dock returns | HIGH | Task 3.1: chat-view clears `dockDraftWidth` and `dockResizing` whenever the slot condition (`hostsInspector() && shell.isOpen() && shell.tab() && !shell.isModal()`) is false (e.g. derive both through the condition or an `effect`), plus a spec. Task 1.1: on the destroy path, release listeners/cursor/userSelect without emitting outputs (no NG0953 warning); spec asserts no console warning on destroy mid-drag |
| R2: A second `ptah-sidebar-tab` and a second `[role="separator"]` break generic selectors in existing specs and the Agents-tab focus restore (`chat-view.component.ts:480,1403-1406`) | HIGH | Task 3.1 (template refs) and Task 3.2 (scope selectors in `chat-view.component.spec.ts`, `chat-view.dock.spec.ts`) |
| R3: Controller change regresses the Canvas Rail board (shared provider) | MEDIUM | Task 2.1 keeps `toggle(opener = null)` additive; Batch 2 verification runs the canvas rail-board spec |
| R4: Shared split-handle behaviours (Shift step, body cursor) regress `agent-lane-grid` / `compact-session-activity` | MEDIUM | Task 1.1 keeps defaults; Batch 1 runs all chat-ui tests (compact-session-activity specs); Batch 3 runs all chat tests (agent-lane-panel spec) |
| R5: Storage `catch` returning `null` trips the degradation audit; `console.*` in new code | MEDIUM | Task 2.2 adds the `// degradation-audit: reported - ...` marker and uses `LoggingService`; lint + spec asserting no `console.warn` |
| R6: Plan card breaks e2e/lane hooks (`data-testid="plan-limit-tile"`, `data-tile-id`, lane link `button` query) | MEDIUM | Task 4.1 keeps the hooks on the clickable face; Task 4.2 asserts them |
| R7: Measured horizontal overflow (AC 7.9) is not provable in jsdom | LOW | Class-level guards in Task 4.2; measured `scrollWidth <= clientWidth` at dock 300/560 and 760 sheet in QA (D-I) |
| R8: Live `storage` sync overwrites an in-progress drag | LOW | Task 2.2 handler touches only `preference`; Task 3.2 spec "drag keeps 400 while preference becomes 520, cancel renders 520" |

Edge cases:

- Unmeasured shell (width 0) → default 336, max 560 — Task 2.1.
- Stored malformed / out-of-range value → `null` or clamped [300, 560] — Task 2.2.
- Click on handle without movement at a shell-clamped width must not overwrite a wider preference — Task 3.1.
- Cancel (Esc, blur, pointercancel, lost capture) restores the pre-drag preference — Tasks 1.1, 3.1.
- Destroy mid-drag (R1) — Tasks 1.1, 3.1.
- Storage throwing on read/write/remove → in-memory only, one `warn` per kind — Task 2.2.
- `typeof window === 'undefined'` → no listener — Task 2.2.
- Tab button missing at click → `toggle(null)` fallback — Task 3.1.
- Sheet band: tab inert + `opacity-50`, no separator, no inline width — Task 3.1.
- Tile / bare / compact / forced-card views: no tab, no slot — Task 3.1.
- `status` / `local-usage` cards: no button, chevron, aria-expanded or panel — Task 4.1.

## Batch 1: split-handle atom extensions — COMPLETE (commit 9d5063f43)

- Recommended executor: subagent `frontend-developer`
- Execution mode: sequential
- Fallback order: other Claude `frontend-developer` subagent (fresh) -> report back to orchestrator
- Subagent reason: decisions.md row 12 pins implementation to Claude frontend-developer subagents (user memory
  agent-lane-review-workflow)
- Review family: different from implementer (codex lane reviews Claude code)
- Rationale: one atom and its first spec in one project; tightly coupled, one executor
- Tasks: 2 | Depends on: none
- Phase: inspector-side-dock | Phase review: deferred to after Batch 4 (code-logic + style + visual)
- Scoped verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui --parallel=1`
  (Jest `--maxWorkers=2` if run directly; never workspace-wide; no build/serve/e2e)

### Task 1.1: Extend `SplitHandleComponent` (inverted, appearance grip, draggingChange, sizeCancel, Shift step, body cursor) — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat-ui\src\lib\atoms\split-handle.component.ts
- Plan reference: implementation-plan.md:291-349 (component 3); decisions D-B, D-E, D-G (lines 125-137)
- Pattern to follow: the file itself (`:68-212`); design-spec.md §2 handle table for grip classes
- Quality requirements: all additions default to today's behaviour (`line`, not inverted); at most one
  `sizeChange` per frame; every exit path releases listeners, `userSelect` and `document.body.style.cursor`;
  `sizeCancel` only on cancel paths (Esc, blur, pointercancel, lost capture), never on commit or key steps;
  Shift+Arrow = 48 for every consumer; readout pill `aria-hidden`.
- Validation notes: A2 — use `focus-visible:bg-base-content/[0.08]` (no `/8` step in Tailwind 3.4). R1 — on the
  destroy path (`destroyRef.onDestroy`, `:120`) release listeners/cursor/userSelect/capture WITHOUT emitting any
  output (outputs are already destroyed; emitting logs NG0953). R4 — `line` markup and host classes verbatim.
- Implementation details: new `inverted = input(false)`, `appearance = input<'line'|'grip'>('line')`,
  `draggingChange = output<boolean>()`, `sizeCancel = output<void>()`, internal `dragging` signal; inverted
  drag = `startSize - (pos - startPos)` and swapped arrow keys; host `w-1.5`/`h-1.5` only for `line`;
  `cancelDrag` emits `sizeChange(startSize)` → `finishDrag()` → `sizeCancel`.

### Task 1.2: Create `split-handle.component.spec.ts` — COMPLETE

- Depends on: Task 1.1
- File: D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat-ui\src\lib\atoms\split-handle.component.spec.ts
- Plan reference: implementation-plan.md:333-346 (component 3 verification seam)
- Pattern to follow: host-test-component specs in `libs/frontend/chat-ui/src/lib/atoms/*.spec.ts`
- Quality requirements: covers aria attrs; drag +40 (normal +40, inverted -40); inverted ArrowLeft +16,
  Shift+ArrowLeft +48; Home/End; clamp; Esc → start size then `sizeCancel`, no commit; window blur cancels;
  pointerup → `sizeCommit`, no `sizeCancel`; key step → no `sizeCancel`; dblclick → `sizeReset`;
  `draggingChange` true/false; cursor + userSelect restored; `grip` renders grip + aria-hidden readout and no
  host `w-1.5`; default `line` markup unchanged; destroy mid-drag restores body styles and logs no warning (R1).
- Validation notes: jsdom has no `setPointerCapture`/`releasePointerCapture` — stub them; drive rAF with fake
  timers or a `requestAnimationFrame` spy.
- Implementation details: standalone host component binding all inputs/outputs; dispatch `PointerEvent`
  (or `MouseEvent` with `pointerId` polyfill) on the separator and `document`.

### Batch 1 verification

- Both files exist with real implementations; no TODO/stub markers
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui --parallel=1` passes (output tailed);
  includes the compact-session-activity specs (R4 regression)
- No per-batch review: the phase review after Batch 4 covers this batch
- Edge cases R1 (destroy path) and A2 addressed

## Batch 2: chat inspector services (constants, width store, specs) — COMPLETE (commit 309cb2bca)

- Recommended executor: subagent `frontend-developer`
- Execution mode: sequential
- Fallback order: other Claude `frontend-developer` subagent (fresh) -> report back to orchestrator
- Subagent reason: decisions.md row 12 pins implementation to Claude frontend-developer subagents
- Review family: different from implementer (codex lane)
- Rationale: components 1, 2 and 6 share `session-inspector/index.ts` and one folder; 6 files, one project
- Tasks: 4 | Depends on: none (independent of Batch 1; runs after it to keep one heavy check at a time)
- Phase: inspector-side-dock | Phase review: deferred to after Batch 4
- Scoped verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat --parallel=1`, then the
  canvas regression `npx jest -c libs/frontend/canvas/jest.config.ts libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts --coverage=false --maxWorkers=2`
  (sequential, never concurrent)

### Task 2.1: Width constants, pure functions, `shellWidth`, `toggle(opener?)` in `InspectorShellController` + barrel — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\services\session-inspector\inspector-shell.controller.ts
  - D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\services\session-inspector\index.ts
- Plan reference: implementation-plan.md:141-190 (component 1); D-C
- Pattern to follow: existing `INSPECTOR_DOCKED_MIN_WIDTH` constants (`inspector-shell.controller.ts:22-25`),
  `applyWidth` (`:312-316`), `toggle` (`:216-235`)
- Quality requirements: constants verbatim from design-spec.md §2 (300/560/624/1100/1500/336/400/448); no new
  observer or timer; `shellWidth` set only for width > 0; non-finite inputs fall back to default.
- Validation notes: R3 — `toggle(opener: HTMLElement | null = null)` keeps Rail-board behaviour identical.
- Implementation details: export `inspectorMaxWidthFor`, `inspectorDefaultWidthFor`, `inspectorDockWidth` and
  all constants from `index.ts`; docked open remembers the opener, docked close via toggle clears it, sheet open
  uses `opener ?? this.opener() ?? active`.

### Task 2.2: Create `InspectorDockWidthStore` — COMPLETE

- Depends on: Task 2.1 (constants)
- File: D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\services\session-inspector\inspector-dock-width.store.ts
  (+ export from `index.ts`, same file as Task 2.1)
- Plan reference: implementation-plan.md:191-289 (component 2); D-A, D-D, D-F, D-G, D-H
- Pattern to follow: `libs/frontend/chat-state/src/lib/workflow-session-index.service.ts:54-56,104-139`
  (guarded localStorage); `chat/services/change-set/change-set.store.ts:250,313` (DestroyRef listener cleanup);
  `session-organization-editor.component.ts:701-703` (audit marker)
- Quality requirements: root service; key `ptah.inspector-dock-width.v1`, integer string; `preference` changes
  only on `commit`, `reset` and the `storage` handler; one shared parser for restore and the handler; no
  `console.*`; one `logger.warn('InspectorDockWidth', ...)` per failure kind; read catch carries
  `// degradation-audit: reported - ...`; no entry in `tools/degradation-audit/baseline.json`.
- Validation notes: R5, R8; `typeof window === 'undefined'` → no listener; handler ignores other keys,
  `key === null` and non-`localStorage` areas; never writes storage.
- Implementation details: constructor restores then adds the `storage` listener;
  `inject(DestroyRef).onDestroy` removes it; `commit` ignores non-finite, rounds, clamps [300, 560], writes;
  `reset` sets `null` and removes the key.

### Task 2.3: Create `inspector-dock-width.store.spec.ts` and `inspector-shell.controller.spec.ts` — COMPLETE

- Depends on: Tasks 2.1, 2.2
- Files:
  - D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\services\session-inspector\inspector-dock-width.store.spec.ts
  - D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\services\session-inspector\inspector-shell.controller.spec.ts
- Plan reference: implementation-plan.md:270-286 (store seam), 176-186 (controller seam)
- Pattern to follow: existing chat service specs using `TestBed.inject` with `useValue` stubs
- Quality requirements: every case listed in the two seams, including reload persistence via
  `TestBed.resetTestingModule()`, throwing storage (logger once, no `console.warn`), live-sync cases and the
  removed-listener case; controller bands 959/960/639/640, focus trap, AC 1.6 opener focus, pure-function
  table (960, 1099/1100/1124, 1499/1500, 900/100/NaN).
- Validation notes: clear `localStorage` between tests; restore `Storage.prototype` spies.
- Implementation details: stub `ResizeObserver`, `TabManagerService`, `InspectorOpenStateService`,
  `SessionInspectorStore`, `LoggingService`.

### Task 2.4: Create `inspector-open-state.service.spec.ts` — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\services\session-inspector\inspector-open-state.service.spec.ts
- Plan reference: implementation-plan.md:539-551 (component 6; parity row 27)
- Pattern to follow: `inspector-open-state.service.ts:17-60`
- Quality requirements: test only, no change to the service; default `initialOpen ?? mode === 'full'`,
  workflow tab defaults open, `setDocked` per tab and mode, closed tab forgotten.
- Validation notes: pins parity row 27 before Batch 3 changes the host.
- Implementation details: `TestBed.inject(InspectorOpenStateService)` with any required stubs.

### Batch 2 verification

- All 6 files exist with real implementations
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat --parallel=1` passes, then the canvas
  rail-board Jest regression passes
- No `console.` in `inspector-dock-width.store.ts`; audit marker present
- No per-batch review

## Batch 3: chat-view host (Session tab, dock slot + handle, width binding) — COMPLETE (commit 431e7cf75)

- Recommended executor: subagent `frontend-developer`
- Execution mode: sequential
- Fallback order: other Claude `frontend-developer` subagent (fresh) -> report back to orchestrator
- Subagent reason: decisions.md row 12 pins implementation to Claude frontend-developer subagents
- Review family: different from implementer (codex lane)
- Rationale: one component's template, styles, class and specs; tightly coupled; riskiest batch (R1, R2)
- Tasks: 2 | Depends on: Batch 1, Batch 2
- Phase: inspector-side-dock | Phase review: deferred to after Batch 4
- Scoped verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat --parallel=1`
  (includes `chat-view.keepalive.spec.ts`, `chat-view.session-enter.spec.ts`, agent-lane-panel spec)

### Task 3.1: Mount Session tab, dock slot/handle and width binding in `ChatViewComponent` — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\components\templates\chat-view.component.html
  - D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\components\templates\chat-view.component.css
  - D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts
- Plan reference: implementation-plan.md:351-410 (component 4); design-spec.md §1-2; prototype/
- Pattern to follow: existing Agents `ptah-sidebar-tab` + agent separator (`chat-view.component.html:318-355`);
  `hostsInspector` (`chat-view.component.ts:1102`); `inspectorDot` (`:1143`)
- Quality requirements: `:host` flex; `.cs-shell` `flex-1 min-w-0`; tab after `.cs-shell` with
  `data-inspector-tab`, `inert` + `opacity-50` when modal; slot only when docked; inline width only when not
  modal (sheet keeps `min(336px,100%)`); `.cs-inspector--resizing { animation: none }`; commit only a changed
  non-null draft; reset clears draft and calls `widthStore.reset()`; `[aria-controls="inspector"]` stays on the
  header toggle only; no per-frame persistence.
- Validation notes: R1 — clear `dockDraftWidth` and `dockResizing` whenever the slot condition is false (handle
  destroyed mid-drag cannot deliver cancel). Batch 1 as built (commit 9d5063f43): on destroy the handle cleans up
  SILENTLY — it emits no `sizeChange`, no `sizeCancel` and no `draggingChange(false)` (plan line 316 "and destroy
  during a drag" is superseded by R1). Do not rely on any output for the destroy path; the slot-condition
  reset is the only mechanism. `sizeCancel` fires only for Esc, window blur, `pointercancel` and lost capture,
  after `sizeChange(startSize)` and `draggingChange(false)`. `SplitHandleAppearance` is not exported from the
  chat-ui barrel; bind the literal `'grip'` in the template (or add the export in this batch if a typed field
  is needed). R2 — `#agentsTab` template ref replaces
  `viewChild(SidebarTabComponent)` and the `'ptah-sidebar-tab button'` query (`ts:480,1403-1406`). Tab button
  missing → `toggle(null)`. Do not touch peer-owned files.
- Implementation details: inject `InspectorDockWidthStore`; `dockDraftWidth`, `dockResizing` signals;
  `dockWidth`/`dockMaxWidth`/`inspectorTabBadge` computeds; `toggleInspectorFromTab()`;
  `commitInspectorWidth()`; `resetInspectorWidth()`; `SplitHandleComponent` in `imports`;
  `inspectorMinWidth = INSPECTOR_MIN_WIDTH`.

### Task 3.2: Extend `chat-view.component.spec.ts` and scope selectors in `chat-view.dock.spec.ts` — COMPLETE

- Depends on: Task 3.1
- Files:
  - D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\components\templates\chat-view.component.spec.ts
  - D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\components\templates\chat-view.dock.spec.ts (selectors only, if they fail)
- Plan reference: implementation-plan.md:425-460 (component 4 verification seam)
- Pattern to follow: existing inspector cases in `chat-view.component.spec.ts:2238-2250,2315,2508-2539`
- Quality requirements: every seam case (tab render/toggle/sync, hidden in compact/forced/bare, badge mirror,
  336 default, seeded 480 at 1124, ArrowLeft → 496 persisted, dblclick reset, cancel keeps 560, click without
  movement writes nothing, reload persistence, live-sync three cases, sheet band, AC 1.6 focus, Agents-tab
  focus restore); plus R1: slot disappears mid-drag (shell → sheet band) then returns → renders the
  preference, not the stale draft.
- Validation notes: R2 — scope generic selectors (`ptah-sidebar-tab:not([data-inspector-tab])`, agent
  separator by `data-testid="agent-resize-handle"` or equivalent); clear `localStorage` between tests.
- Implementation details: stub shell width via the controller's `shellWidth` source (e.g. trigger the stubbed
  `ResizeObserver` callback); dispatch `StorageEvent` for live sync.

### Batch 3 verification

- All 5 files changed with real implementations (dock spec only if selectors needed)
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat --parallel=1` passes
- `git diff --name-only` shows no peer-owned file
- No per-batch review

### Batch 3 verification notes (team-leader)

- Accepted deviations: computeds named `inspectorWidth` / `inspectorMaxWidth` (plan: `dockWidth` /
  `dockMaxWidth`) because `chat-view.component.ts` already has `dockWidth`/`dockMaxWidth`/`dockMinWidth`
  for the Display dock; template ref `#sessionTab` (plan: `#inspectorTab`) because `as inspectorTab` is
  the inspector `@if` alias. `chat-view.dock.spec.ts` unchanged (its selectors still pass); the agent
  separator got `data-testid="agent-resize-handle"`. R1 via `linkedSignal` reset on `dockSlotShown`.
- Scoped check re-run by team-leader: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat
  --parallel=1 --skip-nx-cache` → success. `chat-view.component.spec.ts` alone: 103/103, 0 NG0953.
- NG0101 baseline: the spec in the main checkout (main 34095a98e; chat-view template files identical
  to base 7267c1f4c) logs the same 15 `NG0101 ApplicationRef.tick is called recursively` lines, 85/85
  pass. The worktree run logs 15 too, so they pre-exist (plan-limits wiring block). Later task, not
  fixed here.
- Peer-owned files (`chat-transcript.*`, `message-bubble.*`, `chat-input.component.ts`): no change in
  `git diff main...HEAD` nor in the working tree.

## Batch 4: PLAN LIMITS card (`variant="inspector"`) — COMPLETE (commit 5fc888d16)

- Recommended executor: subagent `frontend-developer`
- Execution mode: sequential
- Fallback order: other Claude `frontend-developer` subagent (fresh) -> report back to orchestrator
- Subagent reason: decisions.md row 12 pins implementation to Claude frontend-developer subagents
- Review family: different from implementer (codex lane)
- Rationale: one molecule, its style helper and spec in one project; independent of the dock work
- Tasks: 2 | Depends on: none
- Phase: inspector-side-dock (last batch) | Phase review: code-logic (codex) + style (new public API on
  `SplitHandleComponent`) + visual (11 Electron screenshots, dark + light at 1440 and 760, plus dock 300 /
  560 / 760 sheet overflow measurements)
- Scoped verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui --parallel=1`
  (includes `session-stats-summary.component.spec.ts`)

### Task 4.1: Card template for the inspector variant + `planCardClass` — COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\plan-limit-tile.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\stats-tile.styles.ts
- Plan reference: implementation-plan.md:468-537 (component 5); design-spec.md; prototype/index.html
- Pattern to follow: strip branch `plan-limit-tile.component.ts:47-168`; `ROW_ACCENT`/`planRowClass`
  (`stats-tile.styles.ts:22-58`)
- Quality requirements: strip branch only moved under `@else`, not edited; card branch per plan class strings;
  expandable → `button` with `aria-expanded`/`aria-controls`/`data-testid="plan-limit-tile"` + sibling panel;
  `status`/`local-usage` → face `div` with no button/chevron/panel; centre on its own row; no `pl-[4.5rem]`;
  `min-w-0`, `truncate`, `break-words`; no semantic colour on text.
- Validation notes: R6 — hooks `data-testid="plan-limit-tile"`, `data-tile-id`, `plan-limit-tile-value`,
  `plan-limit-status`, `plan-limit-caption`, `plan-limit-panel` kept; lane link still finds `button`. R7 — class
  guards only; unknown 5-hour window renders as expandable plan window (decision 8).
- Implementation details: `@if (variant() === 'inspector') { card } @else { strip }`; optional `ng-template`s
  for card-only fragments; exported `planCardClass(tone)` reusing module-private `ROW_ACCENT`.

### Task 4.2: Extend `plan-limit-tile.component.spec.ts` with an inspector describe block — COMPLETE

- Depends on: Task 4.1
- File: D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\plan-limit-tile.component.spec.ts
- Plan reference: implementation-plan.md:518-532
- Pattern to follow: existing strip cases `plan-limit-tile.component.spec.ts:70-340` (must pass unchanged)
- Quality requirements: AC 7.2-7.7 cases and the class-level overflow guards listed in the plan seam.
- Validation notes: measured overflow stays a QA item (D-I).
- Implementation details: set `variant` to `'inspector'` via the host/`setInput`.

### Batch 4 verification

- All 3 files changed with real implementations
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui --parallel=1` passes
- After commit: phase review due → return NEEDS REVIEW for the combined diff (parent of Batch 1 commit..HEAD)

### Batch 4 verification notes (team-leader)

- Strip branch: HEAD template body vs the new `@else` branch with 2 leading spaces removed — 122 lines
  each, `diff` empty (byte-identical apart from the indent).
- Unknown 5-hour window (kind `window`, no percent): renders a `<button>` face with `aria-expanded`,
  chevron and sibling panel, no progressbar; asserted in the inspector spec (decision 8).
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui --parallel=1` passed (re-run by
  team-leader).
- Process note: the executor ran one read-only `git diff --stat`; no effect on the tree.
- Measured overflow (`scrollWidth <= clientWidth` at dock 300/560 and the 760 sheet) is a visual-review
  QA item (D-I), not covered by Jest.

## Fix round (phase review fixes + decision 13) — COMPLETE (commit 069902dea)

- Trigger: `code-style-review.md` REJECTED (1 Blocking, 1 Serious, 1 Moderate) and
  `code-logic-review.md` REJECTED (1 Moderate, 1 Minor); decision 13 (Stats tab move) joins the round.
- Executor report: `fix-round-report.md`. Re-review: the one re-review, scoped to this commit.

| # | Finding | Status | Verified on disk |
| - | ------- | ------ | ---------------- |
| F1 | Style Blocking: `SplitHandleAppearance` missing from barrel | COMPLETE | `chat-ui/src/index.ts:19` |
| F2 | Style Serious: dock orchestration in ChatView | COMPLETE | new `inspector-dock.controller.ts` (127 lines, no stubs) + spec; ChatView 2135 -> 2062 lines |
| F3 | Style Moderate: duplicated separator branches | COMPLETE | single `role="separator"` + `separatorClass()` in `split-handle.component.ts` |
| F4 | Logic Moderate: fractional max breaks 624 px floor / ARIA | COMPLETE | `inspectorMaxWidthFor` floors; `inspectorDockWidth` rounds before clamp (`inspector-shell.controller.ts:80-120`) |
| F5 | Logic Minor: body inline styles cleared | COMPLETE (fixed although Minor) | prior `userSelect`/`cursor` saved and restored in `split-handle.component.ts` |
| F6 | Decision 13: "Stats" tab on dock's inner edge | COMPLETE | tab inside shell; `attach(..., INSPECTOR_TAB_WIDTH)` reserves 32 px so band/max/floor are unchanged |

- Scoped checks: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui @ptah-extension/chat
  --parallel=1 --skip-nx-cache` passed for 2 projects (orchestrator run; not re-run by team-leader).
- Peer-owned files (`chat-transcript.*`, `message-bubble.*`, `chat-input.component.ts`): unchanged.
- Team-leader note: `applyWidth` subtracts `reservedWidth` after the `measured > 0` guard, so a shell
  measuring exactly 32 px records width 0 (band `full-sheet`); harmless, recorded only.
- Next: re-review of this commit (code-logic + code-style, new public API `InspectorDockController`,
  `INSPECTOR_TAB_WIDTH`, `SplitHandleAppearance`), plus visual review for the moved Stats tab.
