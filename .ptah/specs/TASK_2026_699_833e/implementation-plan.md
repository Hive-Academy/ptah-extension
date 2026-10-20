# Implementation Plan - TASK_2026_699_833e

Revision: 3 (answers `implementation-plan-review.md` revision 2, verdict REVISE).

## Revision 3 changes

| Finding | Change | Where |
| --- | --- | --- |
| Rev 2 F1 (Serious) live views in one storage scope keep different widths until reload (AC 3.6 rev 3) | `InspectorDockWidthStore` listens to the `window` `storage` event. The browser fires it in every other same-origin document when `localStorage` changes, never in the writer: two VS Code panels of one view type, or two Electron windows if the app opens more than one. The store handles only key `ptah.inspector-dock-width.v1` from `localStorage`. A removed key (another view's reset) sets `null`. Any other value goes through the load parser; malformed values are ignored and the current preference kept; valid values are clamped and set. The event updates only `preference`, never a view's `dockDraftWidth`. An in-progress drag keeps its width; on cancel it falls back to the new preference, and on commit the last writer wins. The listener is removed through `DestroyRef.onDestroy`, following the root-store precedent `change-set.store.ts:250,313`. Without `window` (`typeof window === 'undefined'`), no listener is registered. There is still no RPC and no cross-view-type sync (decision 10). New tests are listed in components 2 and 4 | Component 2 (responsibilities, scope, failure, quality, tests); component 4 tests; data flow 6; state; external boundaries |

Nothing else changes from revision 2.

## Revision 2 changes

| Finding | Change | Where |
| --- | --- | --- |
| F1 (Serious) storage scope vs AC 3.6 | Resolved by `decisions.md` row 10; AC 3.6 amended in `task-description.md` rev 3. The single `localStorage` key stays. Its scope is now stated exactly: Electron = whole install (one renderer origin, every workspace); VS Code = one webview view type (`ptah.main` sidebar, `ptah-angular-spa` editor panels), which may hold different widths. "Per host install" wording removed. No RPC, no cross-view sync. The test is persistence within one view across a reload (fresh store instance reading the key), not cross-view-type sharing | Evidence rows (VS Code view types); D-A; component 2; data flow; QA list |
| F2 (Serious) cancel erased a wider preference | The stored preference and the transient drag width are separate. `InspectorDockWidthStore.preference` changes only in `commit(width)` and `reset()`; `preview()` is removed. The drag/key preview lives in a per-chat-view `dockDraftWidth` signal, cleared on commit, cancel and reset. Cancel is signalled by a new `sizeCancel` output on `ptah-split-handle` (order-independent; `pointerUp` calls `finishDrag()` before `sizeCommit`, so `draggingChange(false)` cannot be used to clear the draft). Cancel restores the pre-drag preference. New test: stored 560 → shell 960 (renders 336) → drag canceled → shell widens → renders 560 | D-G; components 2, 3, 4; data flow; failure paths |
| F3 (Moderate) `console.*` | No `console.*` in new code. The store injects the existing root `LoggingService` from `@ptah-extension/core` and calls `warn('InspectorDockWidth', …)` once per failure kind. The read `catch` that returns `null` carries the `// degradation-audit: reported - …` marker the audit ratchet requires. Throwing-storage test asserts the logger spy and no `console.warn` | D-H; component 2; observability |
| F4 (Moderate) no measured overflow check | jsdom (jest-preset-angular) has no layout, so `scrollWidth`/`clientWidth` are 0 and a component assertion would be vacuous. The measured check moves to QA: in the Electron dev app, at dock 300 px, dock 560 px and the 760 px window sheet, evaluate `scrollWidth <= clientWidth` on every `ptah-plan-limit-tile` card and its rows, and capture a screenshot at each (3 new screenshots, dark theme). The component spec keeps the class-level guards (`min-w-0`, `break-words`, no `pl-[4.5rem]`) | D-I; component 5; QA handoff |

No other approved decision (D-B to D-F, design rev 3, decisions 1-9) changes.

Paths are relative to the worktree `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock`
unless absolute. `chat/` = `libs/frontend/chat/src/lib/`, `chat-ui/` = `libs/frontend/chat-ui/src/lib/`.

## Inputs and constraints

- Requirements used: `context.md`, `decisions.md` (rows 1-10), `task-description.md` (rev 3; AC 3.6
  amended per row 10), `implementation-plan-review.md` (rev 1), `parity-inventory.md` (rev 2), `design-spec.md` (rev 3, approved, decision 9),
  `prototype/README.md` (all `[lane-proposed]` constraints accepted by decision 9).
- Corrections applied: none. No approved decision is changed. Three points the design left open are settled
  below (D-A width store, D-B handle appearance, D-C opener tracking). They do not conflict with the design.
- Design handoff used: `design-spec.md` sections 1-3 and the widths table. Constants and class strings
  are taken verbatim.
- Missing decision-critical input: none.
- Peer constraint (`context.md`): do not edit `chat-transcript.component.*`, `message-bubble.component.*`,
  `chat-input.component.ts` (branch `fix/chat-column-alignment`). This plan touches none of them.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Band thresholds and band logic; `applyWidth` already receives the measured shell width but stores only the band | `chat/services/session-inspector/inspector-shell.controller.ts:22-25,312-316` | Expose the last real shell width as a signal here; no second ResizeObserver |
| `toggle()` records an opener only for the sheet, and prefers the header toggle (`this.opener() ?? active`); docked open records none | `inspector-shell.controller.ts:216-235` | AC 1.6 (focus returns to the tab) needs an explicit opener argument |
| `closeInsp` → `restoreFocus(target)` candidates `[target, rememberedOpener, opener()]`, then the title | `inspector-shell.controller.ts:243-254,351-368` | Focus routine is reused unchanged once the remembered opener is set correctly |
| Controller is also provided by the Rail board | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:17,74` | Controller changes must stay additive (default parameters); Rail board behaviour unchanged |
| Shell is `.cs-shell flex h-full w-full relative`; inspector `@defer` + placeholder; Agents tab, agent separator and agent panel live inside the shell | `chat/components/templates/chat-view.component.html:2,283-316,318-355` | Session tab goes after `.cs-shell` (design D2), so the host must become a flex row |
| `:host { display:block }`; `.cs-inspector` fixed `width:336px`; sheet `min(336px,100%)`; reduced-motion block | `chat-view.component.css:1-5,17-40,192-201` | Docked width becomes an inline style. Sheet CSS stays authoritative because the style is bound only when docked |
| Shell attach and opener lookup `[aria-controls="inspector"]` | `chat-view.component.ts:980-1002` | Unchanged; the tab opener is passed per toggle |
| `hostsInspector = !bareChrome && !_sessionContext && !showCompactCard()` | `chat-view.component.ts:1102-1104` | One condition hides the tab and the handle in tile, bare, compact and forced-card views (AC 1.7) |
| `inspectorDot = limitAwareDot(shell.showDot(), shell.isOpen(), limitSummary)` returns `'need'|'err'|'sel'|null` | `chat-view.component.ts:1143-1149`; `chat-ui/molecules/session/plan-limits/session-limit-summary.ts:56-62` | Tab `badgeType` is derived from this one signal (AC 1.8) |
| `agentSidebarTab = viewChild(SidebarTabComponent)` (type query) used for Agents focus restore; button found by `'ptah-sidebar-tab button'` | `chat-view.component.ts:480,1399-1411` | A second `ptah-sidebar-tab` makes the type query and the selector ambiguous. Both must target the Agents tab by template ref |
| `ptah-split-handle`: keyboard, aria value attrs, rAF drag, Esc/blur/lost-capture restore, dblclick `sizeReset`, `sizeCommit` on drag end and every key step; no `inverted`, no drag-state output, no Shift step, no body cursor; no spec file | `chat-ui/atoms/split-handle.component.ts:14,28-212` | Extend this atom (design D3). It needs a new spec |
| `ptah-split-handle` consumers | `chat/components/organisms/agent-monitor/agent-lane-grid.component.ts:17,62`; `chat-ui/molecules/compact-session/compact-session-activity.component.ts:31,559` | New inputs default to today's behaviour. Shared additions (Shift step, body cursor) are additive |
| `SplitHandleComponent` and `SidebarTabComponent` already exported from chat-ui and imported by chat | `libs/frontend/chat-ui/src/index.ts:18-20`; `chat-view.component.ts:38-49` | No new cross-library import. Both projects are tagged `scope:webview, type:feature` (`libs/frontend/chat/project.json`, `libs/frontend/chat-ui/project.json`) |
| `ptah-sidebar-tab`: `label`, `side`, `isOpen`, `size`, `badgeType`, `toggled`; `aria-expanded`; title `Hide/Show <label>` | `chat-ui/atoms/sidebar-tab.component.ts:113-150` | Used as is; no atom change |
| Electron Git dock width persists through `VSCodeService.setState('electron-layout', …)`, restored only when `isElectron` | `libs/frontend/core/src/lib/services/electron-layout.service.ts:37,130-140,708-719,730-765` | Electron-only. Not usable from the VS Code webview |
| Electron `setState` writes to `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE`, i.e. per active workspace | `apps/ptah-electron/src/ipc/ipc-bridge.ts:136-138,556-590` | Webview state is not install-wide in Electron. AC 3.6 (rev 3) requires install-wide in Electron, so it is unusable |
| VS Code `getState/setState` are per webview instance (`window.vscode`) | `libs/frontend/core/src/lib/services/vscode.service.ts:216-276` | Not shared between the sidebar and editor-panel webviews |
| VS Code registers the sidebar as view type `ptah.main` and editor panels as `ptah-angular-spa`; webview storage is partitioned per view type | `apps/ptah-extension-vscode/src/core/ptah-extension.ts:121-123`; `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts:123-127`; review F1 | One `localStorage` key is shared within a view type only. AC 3.6 (rev 3) accepts that (decision 10) |
| `split-handle` `pointerUp` runs `flushPendingMove` → `finishDrag()` → `sizeCommit.emit()`; `cancelDrag` emits `sizeChange(startSize)` then `finishDrag()`; keys emit `sizeChange` then `sizeCommit` | `chat-ui/atoms/split-handle.component.ts:100-105,149-162,179-183` | Anything emitted from `finishDrag` precedes the commit. Cancel needs its own signal (`sizeCancel`) to clear a draft safely |
| Root `LoggingService` with `warn(context, message, data?)` / `error(...)`; exported via `export * from './lib/services'`; already injected by chat services | `libs/frontend/core/src/lib/services/logging.service.ts:71-74,173-182`; `libs/frontend/core/src/index.ts:1`; `libs/frontend/core/src/lib/services/index.ts:1`; `chat/services/session-list/session-row-actions.service.ts:6-10,40,62` | Use it instead of `console.*` (F3). chat → core is an existing dependency (`chat-view.component.ts:112`) |
| Degradation audit flags a `catch` that returns a literal without `throw`/`.error(` unless it has `// degradation-audit: <optional-capability\|reported> - <reason>` directly above or as the first lines inside the catch; scans `libs/**/src/**/*.ts`, specs excluded | `tools/degradation-audit/check-degradation.ts:5-8,27-44,88-105,186-192`; precedent `chat/components/molecules/session-organization-editor/session-organization-editor.component.ts:701-703` | The store's read `catch` (returns `null`, logs with `.warn`) needs the `reported` marker |
| Chat-ui specs run on `jest-preset-angular` (jsdom: no layout engine) | `libs/frontend/chat-ui/jest.config.ts:3,8` | A measured `scrollWidth` overflow test cannot run in Jest; it goes to QA (F4) |
| Webview UI state that must survive reloads in both hosts already uses guarded `localStorage` | `libs/frontend/chat-state/src/lib/tab-manager.service.ts:2957-3111`; `libs/frontend/chat-state/src/lib/workflow-session-index.service.ts:8,104-139`; `libs/frontend/canvas/src/lib/canvas-layout-persistence.service.ts:192,327` | Reuse this pattern for the width (D-A) |
| Plan tile template: label, centre, chip in one row; reset/caption `pl-[4.5rem]`; absolute chevron; disabled button for `status`/`local-usage`; panel always a sibling `div` | `chat-ui/molecules/session/plan-limits/plan-limit-tile.component.ts:45-168,189-194` | Inspector branch gets a card template; the strip branch is kept verbatim |
| `ROW_ACCENT` is module-private; `planRowClass` = `ROW_FACE` + accent; `ROW_PANEL` box | `chat-ui/molecules/session/plan-limits/stats-tile.styles.ts:22-27,48-58` | Add one exported card-class helper that reuses `ROW_ACCENT` |
| Lane link focuses `ptah-plan-limit-tile[data-tile-id] button` | `chat-ui/molecules/session/inspector-stats/inspector-limits-lanes.component.ts:96-107` | Expandable cards must keep a `button`. Lane links target plan windows, which are expandable |
| Tile hooks used by e2e: `ptah-plan-limit-tile[data-tile-id]`, `[data-testid="plan-limit-tile"]` click | `libs/frontend/webview-e2e-harness/src/lib/scenarios/plan-limits/plan-limits-visual.e2e.spec.ts:156-169` | `data-testid="plan-limit-tile"` stays on the clickable face |
| Specs that query `ptah-sidebar-tab` / `[role="separator"]` generically | `chat-view.component.spec.ts:2238-2250,2315,2508,2521,2539`; `chat-view.dock.spec.ts:514-516` | These selectors must be scoped once the Session tab and the dock separator exist |

## Architecture decision

- **Chosen approach.**
  1. `InspectorShellController` gains the shell-width signal, the width constants and pure width functions (next to
     `INSPECTOR_DOCKED_MIN_WIDTH`, as AC 3.1 requires), plus an optional opener on `toggle()`.
  2. A new root store, `InspectorDockWidthStore`, owns the committed width preference only. It is backed by guarded
     `localStorage` and works the same in both hosts (scope: Electron install; VS Code view type).
  3. `ChatViewComponent` keeps the transient drag/key width in its own `dockDraftWidth` signal and computes the
     rendered docked width from `draft ?? preference` and the shell width. It renders a
     zero-width slot holding `ptah-split-handle` (`inverted`, `appearance="grip"`) and the Session
     `ptah-sidebar-tab` after `.cs-shell`.
  4. `ptah-plan-limit-tile` gets a card template for `variant="inspector"` only.
- **Rationale.**
  - Requirement fit: one width source serves Electron and the VS Code webview (AC 3.4). It is install-wide in
    Electron and per view type in VS Code, which is exactly AC 3.6 rev 3. Keeping the draft out of the store means
    a canceled drag never touches the preference (AC 2.4, 3.3).
  - The controller already measures the shell, so clamping (AC 3.2, 3.3) needs no new observer.
  - The inverted split-handle measures from the handle's start position, not from the window edge. Drags stay correct
    with the Git dock open (AC 2.2, design D3).
  - No RPC and no new cross-library dependency.
- **Rejected alternatives.**
  - `ElectronLayoutService` + a VS Code twin: Electron-only (`electron-layout.service.ts:131-139`). Its storage is
    per workspace (`ipc-bridge.ts:136-138`), so AC 3.6 fails. A twin would duplicate the store for one value.
  - `VSCodeService.setState`: per-webview in VS Code and per-workspace in Electron (evidence above).
  - A new RPC/host setting (would give VS Code cross-view-type sharing): rejected by `decisions.md` row 10. Every
    host would need a handler, and the RPC guard specs would have to change for one integer.
  - Draft width inside the root store (`preview()` writing the preference signal): rev 1 design; a cancel wrote the
    clamped start width over the preference for the session (review F2). A root draft would also leak between two
    chat views.
  - Width state inside `InspectorShellController`: the controller is per host instance and is also used by the Rail
    board. A per-instance preference breaks AC 3.6, and the Rail board would carry width state it never uses.
  - `ptah-electron-resize-handle`: computes `innerWidth - clientX` and has no keyboard support (risk table in
    `task-description.md`; design D3).
  - A separate `ptah-plan-limit-card` component: the task scopes the change to the tile's inspector variant. A
    second component would duplicate chip, caption, source and panel logic.
- **Assumptions.**
  - A1: Webview `localStorage` survives an Electron restart and a VS Code webview reload. Evidence: tab restore
    already depends on it (`tab-manager.service.ts:2957-3111`). Check: with the dock resized, reload the VS Code
    webview and restart Electron, and the width returns (the QA visual pass).
  - A2: Tailwind 3.4 (`package.json` `tailwindcss ^3.4.18`) may not generate `bg-base-content/8` from the
    default opacity scale. Check: if the class is missing from the built CSS, use `bg-base-content/[0.08]`.
  - A3: The design's "tab dimmed" in the open-sheet band has no numeric value. Use `opacity-50` and confirm it in
    the visual review.
- **Effect on existing code.**
  - Fixed `width:336px` stays as the CSS fallback; docked width becomes an inline style.
  - The Agents-tab focus query moves to a template ref.
  - `ptah-split-handle` gets five additive inputs/outputs (`inverted`, `appearance`, `draggingChange`,
    `sizeCancel`, plus the grip markup) plus two shared behaviours: Shift×3 key step and body
    cursor while dragging.
  - The plan tile's strip branch is untouched. The header toggle, open-state service, sheet and focus trap are
    unchanged.

### Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D-A | Width persists in `localStorage` key `ptah.inspector-dock-width.v1` via a root `InspectorDockWidthStore` in `chat`. Scope: Electron install; VS Code webview view type (rev 2, decision 10) | ElectronLayoutService + VS Code twin / VSCodeService state / RPC | AC 3.6 rev 3; `ipc-bridge.ts:136-138`; `vscode.service.ts:216-276`; `ptah-extension.ts:121-123`; `angular-webview.provider.ts:123-127`; localStorage precedent `workflow-session-index.service.ts:104-139` | yes (one file) |
| D-B | `ptah-split-handle` gets `appearance: 'line' \| 'grip'` (default `line`). `grip` renders the design's 4x32 grip, readout pill and solid focus outline, and leaves sizing to the parent | Host-side `::ng-deep` overrides / projected content | Design §2 handle table gives states that need drag/focus state the atom owns; `::ng-deep` is used only for legacy scrollbars in `chat-view.component.css:64-102` | yes |
| D-C | `toggle(opener?: HTMLElement \| null)`. The tab passes its button. Docked and sheet both remember it | Query `document.activeElement` / tab-specific method | `inspector-shell.controller.ts:216-235` prefers the header for the sheet and records nothing docked, so AC 1.6 fails today for a tab opener | yes |
| D-D | Double-click reset clears the stored preference (key removed), so the default follows the current shell tier | Store the current default as a number | AC 2.5 "default for the current shell size"; AC 4.1-4.2 defaults apply when nothing is stored | yes |
| D-E | Shift step (×3 = 48 px) and `document.body.style.cursor` during drag apply to every `ptah-split-handle` | Gate behind `appearance` | Design §2 Keyboard and Active rows. Additive for `agent-lane-grid` and `compact-session-activity` (Shift+Arrow is unhandled there today; there is no body cursor today) | yes |
| D-F | Stored values: finite number → rounded and clamped to [300, 560]; anything else → `null` (default) | Reject out-of-range | AC 3.5 allows "default or clamped" | yes |
| D-G | Transient width = per-chat-view `dockDraftWidth` signal; the store's `preference` changes only on `commit(width)`/`reset()`. Cancel arrives as a new `sizeCancel` output; the draft clears on commit, cancel and reset | Snapshot pre-drag preference in the store and restore on cancel / clear draft on `draggingChange(false)` | Review F2; `split-handle.component.ts:100-105` (`finishDrag` precedes `sizeCommit`, so a `draggingChange(false)` emitted from `finishDrag` would clear the draft before the commit reads it); a per-view draft dies with the view and never leaks to a second chat view | yes |
| D-H | Storage failures → injected `LoggingService.warn('InspectorDockWidth', …)`, once per failure kind (read / write / remove); read `catch` carries `// degradation-audit: reported - …`. No public error signal | Store `persistError` signal; suppression comment without logging | Task rule "no `console.*`"; `logging.service.ts:71-74,173-175`; audit rule `check-degradation.ts:27-44,186-192`. A signal with no consumer would be a speculative surface; the logger exists, so the fallback the orchestrator named does not apply | yes |
| D-I | AC 7.9 overflow is measured in QA (Electron dev app, `scrollWidth <= clientWidth`) at dock 300, dock 560 and the 760 px sheet, each with a screenshot | Jest layout assertion | jsdom has no layout (`chat-ui/jest.config.ts:3,8`); the e2e harness target is barred by CLAUDE.md unless the user asks | yes |

## Component specifications

### 1. Inspector width constants, pure functions and shell width (`InspectorShellController`)

- Purpose: the one source for docked-width arithmetic and the measured shell width. Also records the opener of
  every toggle.
- Responsibilities:
  - Add exported constants next to `INSPECTOR_DOCKED_MIN_WIDTH` (`inspector-shell.controller.ts:22-25`). Values are
    verbatim from `design-spec.md` §2 Widths:
    - `INSPECTOR_MIN_WIDTH = 300`, `INSPECTOR_MAX_WIDTH = 560`, `INSPECTOR_MAIN_MIN_WIDTH = 624`.
    - `INSPECTOR_LARGE_SHELL_MIN_WIDTH = 1100`, `INSPECTOR_WIDE_SHELL_MIN_WIDTH = 1500`.
    - `INSPECTOR_DEFAULT_WIDTH = 336`, `INSPECTOR_LARGE_DEFAULT_WIDTH = 400`, `INSPECTOR_WIDE_DEFAULT_WIDTH = 448`.
    - The 1500 tier constant name is new. The design lists the value only.
  - Add exported pure functions:
    - `inspectorMaxWidthFor(shellWidth)`: `shellWidth > 0 ? max(MIN, min(MAX, shellWidth - MAIN_MIN)) : MAX`.
    - `inspectorDefaultWidthFor(shellWidth)`: `< 1100` (including 0 = unmeasured) → 336; `< 1500` → 400; else 448.
    - `inspectorDockWidth(preference: number | null, shellWidth)`: clamps `preference ?? default` to
      `[MIN, maxFor(shellWidth)]` and rounds the result.
  - Add `readonly shellWidth: Signal<number>` (initial 0). Set it in `applyWidth` only for `width > 0` (same
    guard as today, line 314). The no-ResizeObserver branch of `attach` seeds it from
    `shell.getBoundingClientRect().width` when > 0.
  - Change `toggle()` to `toggle(opener: HTMLElement | null = null)`.
    - Docked open: `rememberedOpener = opener`.
    - Docked close through toggle: `rememberedOpener = null`. Focus stays on the control that was activated.
    - Sheet open: `rememberedOpener = opener ?? this.opener() ?? active` (today's fallback order after the
      explicit opener).
    - `closeInsp`/`restoreFocus` stay unchanged and now return focus to the tab when the tab opened the inspector.
  - Export the new constants and functions from `chat/services/session-inspector/index.ts`.
- Verified contracts and entry points: `applyWidth` (`:312-316`), `attach` (`:194-214`), `toggle` (`:216-235`),
  `restoreFocus` (`:351-368`), barrel (`index.ts`, last export block).
- Dependencies: none new.
- Integration points: `ChatViewComponent` (component 4). The Rail board keeps calling `toggle()` with no
  argument, and its behaviour is identical.
- Failure behaviour: `shellWidth` 0 (unmeasured, jsdom, detached) → default tier 336 and max 560, with no throw.
  Non-finite inputs to the pure functions → `inspectorDockWidth` falls back to the default
  (`Number.isFinite` guard).
- Quality requirements: no extra observer or timer.
- Verification seam: new `inspector-shell.controller.spec.ts` (stub `ResizeObserver`, `TabManagerService`,
  `InspectorOpenStateService`, `SessionInspectorStore`). Cover:
  - band thresholds 959/960/639/640 and the zero-width keep;
  - docked↔sheet transitions (AC 5.4);
  - sheet open focuses close / `closeReady`, Tab trap, Esc and `defaultPrevented` (AC 5.3);
  - tab/session switch closes the sheet (AC 5.5);
  - `toggle(tabButton)` then `closeInsp('opener')` focuses `tabButton` in both docked and sheet (AC 1.6);
  - fallback to the title, never `body`;
  - `shellWidth` updates;
  - the pure functions at 960 (max 336, default 336), 1099/1100/1124 (default 400, max 500), 1499/1500 (448), and
    preference 900 → max, 100 → 300, NaN → default.
- Files: MODIFY `libs/frontend/chat/src/lib/services/session-inspector/inspector-shell.controller.ts`, MODIFY
  `libs/frontend/chat/src/lib/services/session-inspector/index.ts`, CREATE
  `libs/frontend/chat/src/lib/services/session-inspector/inspector-shell.controller.spec.ts`.

### 2. `InspectorDockWidthStore` (persisted width preference)

- Purpose: hold the user's committed docked-width preference for its storage scope, and persist it. It never
  holds a drag or key preview (D-G).
- Responsibilities:
  - `@Injectable({ providedIn: 'root' })`; `private readonly logger = inject(LoggingService)` from
    `@ptah-extension/core` (D-H).
  - `readonly preference: Signal<number | null>` (read-only view of a private writable signal); `null` = no stored
    preference. It changes only in `commit`, `reset` and the cross-document `storage` handler (rev 3).
  - `commit(width: number)`: ignores non-finite values; rounds and clamps to `[INSPECTOR_MIN_WIDTH,
    INSPECTOR_MAX_WIDTH]`; sets the preference; writes the key.
  - `reset()`: sets `null` and removes the key.
  - Restore runs once in the constructor (pattern: `workflow-session-index.service.ts:54-56,104-127`).
  - There is no `preview()` method (removed in rev 2).
  - Live sync in one storage scope (rev 3, AC 3.6 rev 3):
    - The constructor adds a `storage` listener to `window` after restore.
    - When `typeof window === 'undefined'`, no listener is added and the store works without it.
    - Cleanup: `inject(DestroyRef).onDestroy(() => window.removeEventListener('storage', handler))`. This is the
      root-service pattern at `chat/services/change-set/change-set.store.ts:250,313`.
    - The handler takes no action when `event.key !== 'ptah.inspector-dock-width.v1'`. This covers other keys and
      `key === null`, which `clear()` sends. It also takes no action when `event.storageArea` is not
      `window.localStorage`.
    - `event.newValue === null` means another view reset the width or removed the key, so the handler sets
      `preference` to `null`.
    - Any other `newValue` goes through the same private parser as restore. That parser is extracted once and
      used by both paths. A malformed value (`"abc"`, `""`, `"NaN"`) is ignored and the current preference
      kept. A valid value is rounded, clamped to [300, 560], and set.
    - The handler never writes to `localStorage`, so it cannot echo. Browsers do not fire `storage` in the
      writing document, so a view's own commit does not loop back to it.
    - It touches only `preference`. It never touches a view's `dockDraftWidth`, so a drag in progress keeps its
      draft width (D-G).
- Write-path trace:
  - Key: `ptah.inspector-dock-width.v1`. Naming follows `ptah.workflow-sessions.v1`.
  - Scope (AC 3.6 rev 3, decision 10): `window.localStorage` of the renderer/webview origin.
    - Electron: one renderer origin → one value for the whole install, every workspace and chat view.
    - VS Code: storage is partitioned per webview view type → one value for the sidebar (`ptah.main`) and one for
      editor panels (`ptah-angular-spa`). The two types may differ, and no sync runs between view types.
    - Inside one Angular app instance, every chat view shares the root signal.
    - Between live documents in one scope, the `storage` listener keeps them in step (rev 3). This covers two
      open `ptah-angular-spa` panels, and two Electron windows if the app opens more than one.
  - Value format: base-10 integer string, e.g. `"400"`.
  - Writer: `ptah-split-handle (sizeCommit)` → `ChatViewComponent.commitInspectorWidth()`: read `draft =
    dockDraftWidth()`, clear the draft, and call `store.commit(draft)` only when `draft !== null` and it differs
    from `inspectorDockWidth(store.preference(), shell.shellWidth())` (a click on the handle without movement at a
    shell-clamped width must not overwrite a wider stored preference) → `localStorage.setItem(key,
    String(width))`. This fires at most once per drag end and once per key step, never per frame.
  - Reset: `ptah-split-handle (sizeReset)` → `store.reset()` → `localStorage.removeItem(key)`; the view clears its
    draft.
  - Reader: the `InspectorDockWidthStore` constructor → `localStorage.getItem(key)` → parse:
    - `null`, an empty or whitespace string, or a non-finite `Number(raw)` → `null`;
    - otherwise → rounded and clamped to [300, 560] (D-F).
    - The result feeds `ChatViewComponent.dockWidth = inspectorDockWidth(dockDraftWidth() ?? store.preference(),
      shell.shellWidth())`.
    - Shell-based clamping is applied only at render and never written back (AC 3.3). A canceled drag never
      reaches the store, so the pre-drag preference is what renders after cancel (D-G).
- Verified contracts and entry points: new file. Pattern cited above; `LoggingService.warn`
  (`logging.service.ts:173-175`), exported from `@ptah-extension/core` (`core/src/index.ts:1`,
  `services/index.ts:1`).
- Dependencies: the constants from component 1 (same library, same folder); `LoggingService` (chat → core, an
  existing direction, `chat-view.component.ts:112`). No VSCodeService dependency.
- Integration points: `ChatViewComponent` only.
- Failure behaviour:
  - `getItem`/`setItem`/`removeItem` throwing (SecurityError, QuotaExceeded, storage disabled) is caught and never
    rethrown. The in-memory preference stays usable for the session; only reload persistence is lost.
  - Each failure kind (`read`, `write`, `remove`) logs once through
    `logger.warn('InspectorDockWidth', '<kind> failed; width kept in memory only', error)`; a private set of
    already-reported kinds prevents repeats. No `console.*` anywhere in the file.
  - The read path's `catch` returns `null` (a literal), which the degradation audit flags as
    `catch-return-sentinel`. It must carry, as the first lines inside the `catch` block or the comment lines
    directly above it, `// degradation-audit: reported - storage read failure is logged via LoggingService.warn;`
    `// the default width is used`. The write/remove catches return nothing and need no marker. Do not add
    the file to `tools/degradation-audit/baseline.json`.
  - A malformed stored width → default + clamp (AC 3.5).
- Quality requirements: synchronous, O(1). One `window` `storage` listener per app instance, not per chat view.
  It is released on destroy. Live sync covers documents in one storage scope only. Sync between VS Code view
  types stays out of scope (decision 10).
- Verification seam: new `inspector-dock-width.store.spec.ts`. Provide `{ provide: LoggingService, useValue:
  { warn: jest.fn() } }`; seed `localStorage`, then `TestBed.inject`. Cover:
  - stored `"420"` → 420; `"9999"` → 560; `"12"` → 300; `"abc"`, `""`, `"NaN"`, missing → `null`;
  - `commit(448)` writes `"448"` and sets `preference` to 448; `commit(NaN)` changes nothing;
  - `reset` removes the key and sets `null`;
  - reload persistence within one view (AC 3.4, 3.6 rev 3): `commit(480)`, then `TestBed.resetTestingModule()` and
    inject a fresh store over the same `localStorage` → `preference()` is 480;
  - a throwing `Storage.prototype.setItem` (spy) is swallowed: `commit(500)` does not throw, `preference()` is 500,
    `logger.warn` is called exactly once across two failing commits with context `'InspectorDockWidth'`, and a
    `jest.spyOn(console, 'warn')` sees no call;
  - a throwing `getItem` at construction → `preference()` is `null`, one `logger.warn`.
  - Live sync (rev 3) dispatches `window.dispatchEvent(new StorageEvent('storage', { key, newValue,
    storageArea: localStorage }))` on an injected store:
    - valid `"480"` → `preference()` 480; `"9999"` → 560 (same clamp as load);
    - malformed `"abc"` (with preference 420 set beforehand) → still 420;
    - `newValue: null` for the key → `null`;
    - another key (`'ptah.workflow-sessions.v1'`, `"480"`) and `key: null` → unchanged;
    - the handler makes no `Storage.prototype.setItem`/`removeItem` call (spy);
    - after `TestBed.resetTestingModule()` destroys the injector, dispatching on the old instance → unchanged,
      because the listener was removed.
- Files: CREATE `libs/frontend/chat/src/lib/services/session-inspector/inspector-dock-width.store.ts`, CREATE
  `libs/frontend/chat/src/lib/services/session-inspector/inspector-dock-width.store.spec.ts`, MODIFY
  `libs/frontend/chat/src/lib/services/session-inspector/index.ts` (export the store; shared with component 1).

### 3. `ptah-split-handle` extensions (`SplitHandleComponent`)

- Purpose: one keyboard- and pointer-operable separator for panes on either side of the handle.
- Responsibilities (all additive; defaults keep today's behaviour):
  - `inverted = input(false)`: `size` is the pane AFTER the handle.
    - Drag: `startSize - (pos - startPos)`.
    - Keys: the increase/decrease keys swap. Vertical inverted: ArrowLeft grows and ArrowRight shrinks.
    - Home = `min()` and End = `max()` are unchanged.
  - `appearance = input<'line' | 'grip'>('line')`.
    - `line`: today's markup and host size classes, verbatim.
    - `grip`: host size classes `w-1.5`/`h-1.5` are not applied, because the parent positions the handle. Separator
      classes: `focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1
      focus-visible:outline-base-content focus-visible:bg-base-content/8` (A2); `group-active:bg-primary/20`.
    - Decorative 1 px line at the leading edge: `bg-base-content/15 group-hover:bg-primary/60
      group-active:bg-primary`.
    - Centred grip `w-1 h-8 rounded-full bg-base-content/60 group-hover:bg-base-content/80`, solid
      `bg-base-content` while dragging.
    - Readout pill, `aria-hidden="true"`, at the top: `bg-base-300 text-base-content text-[11px] tabular-nums`,
      text `{roundedSize} px`. It is visible while dragging and on `group-focus-visible`.
    - Every value comes from the `design-spec.md` §2 handle table.
  - `draggingChange = output<boolean>()`: `true` on pointerdown capture; `false` in `finishDrag` (commit and cancel
    paths). An internal `dragging` signal drives the grip/readout state. It is a visual flag only; consumers must
    not use it to commit or discard a width, because on `pointerUp` `finishDrag` runs before `sizeCommit`
    (`split-handle.component.ts:100-105`).
  - `sizeCancel = output<void>()` (rev 2, D-G): emitted by `cancelDrag` after `sizeChange(startSize)` and
    `finishDrag()`, i.e. on Escape, window blur, `pointercancel`, lost capture and destroy during a drag. Never
    emitted on a commit path or for key steps. Existing consumers ignore it.
  - Shift + arrow = `KEYBOARD_STEP * 3` (48) (D-E).
  - While dragging: `document.body.style.cursor` = `col-resize` (vertical) / `row-resize` (horizontal). It is
    cleared in `finishDrag` next to the existing `userSelect` reset (D-E).
- Verified contracts and entry points: inputs/outputs `split-handle.component.ts:68-76`; drag `:88-143`; keys
  `:149-162`; `finishDrag` `:185-207`; `clamp` `:209-211`. Public export `libs/frontend/chat-ui/src/index.ts:18-20`.
- Dependencies: none new.
- Integration points:
  - `ChatViewComponent` (new usage).
  - `agent-lane-grid.component.ts:62` and `compact-session-activity.component.ts:559` (default `line`, not inverted).
- Failure behaviour:
  - Every drag exit (pointerup, pointercancel, lost capture, window blur, Escape, destroy) runs `finishDrag`. It
    restores `userSelect` and `cursor`, removes every listener and emits `draggingChange(false)`.
  - Cancel emits `sizeChange(startSize)` then `sizeCancel`, with no `sizeCommit`, so nothing is persisted and the
    consumer can drop its draft (AC 2.4).
- Quality requirements: at most one `sizeChange` per animation frame (unchanged). All document/window listeners are
  released on every exit path.
- Verification seam: new `split-handle.component.spec.ts` (host test component). Cover:
  - aria attrs;
  - non-inverted drag (+40 px → +40) and inverted drag (+40 px → −40);
  - inverted ArrowLeft grows by 16; Shift+ArrowLeft grows by 48; Home/End;
  - clamp at min/max;
  - Esc during drag emits the start size, then `sizeCancel`, and no commit;
  - window blur cancels (emits `sizeCancel`);
  - pointerup emits `sizeCommit` and no `sizeCancel`; a key step emits no `sizeCancel`;
  - dblclick emits `sizeReset`;
  - `draggingChange` true/false;
  - body cursor and `userSelect` restored after drag;
  - `appearance="grip"` renders the grip and an `aria-hidden` readout, and the host has no `w-1.5`;
  - default `line` markup is unchanged.
  - Regression: existing `agent-lane-panel.spec.ts` (chat) and the compact-session-activity specs (chat-ui) pass.
- Files: MODIFY `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.ts`, CREATE
  `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.spec.ts`.

### 4. Chat-view host: Session tab, dock slot and handle, width binding

- Purpose: mount the tab, handle and variable-width dock around the existing inspector.
- Responsibilities:
  - **Host layout** (`chat-view.component.css`):
    - `:host` becomes `display: flex` (keep `height:100%; position:relative`).
    - `.cs-shell` swaps `w-full` for `flex-1 min-w-0` (in `chat-view.component.html:2`). The ResizeObserver still
      measures only the shell, so the 32 px tab never counts toward the band (design D2).
  - **Session tab** (after the closing `</div>` of `.cs-shell`, i.e. the last host child):
    `@if (hostsInspector() && shell.tab())` → `<ptah-sidebar-tab #inspectorTab data-inspector-tab label="Session"
    side="right" [isOpen]="shell.isOpen()" [badgeType]="inspectorTabBadge()" [attr.inert]="shell.isModal() ? '' :
    null" [class.opacity-50]="shell.isModal()" (toggled)="toggleInspectorFromTab()" />`.
    - `inspectorTabBadge = computed(...)` maps `inspectorDot()`: `'sel'` → `'info'`; `'need'`/`'err'` →
      `'warning'`; `null` → `null` (design §1 Badge dot).
    - `toggleInspectorFromTab()` calls `shell.toggle(button)`. `button` comes from
      `viewChild('inspectorTab', { read: ElementRef })` → `.nativeElement.querySelector('button')`.
    - The header toggle keeps `(inspectorToggled)="shell.toggle()"`.
  - **Dock slot and handle** (inside `.cs-shell`, between the main column and the inspector `@if`):
    `@if (hostsInspector() && shell.isOpen() && shell.tab() && !shell.isModal())` → a `div.cs-dock-slot` (0 px
    flex item, `relative z-10 shrink-0`). It contains `<ptah-split-handle class="cs-dock-handle" orientation="vertical"
    appearance="grip" [inverted]="true" label="Resize session details" [size]="dockWidth()"
    [min]="inspectorMinWidth" [max]="dockMaxWidth()" (sizeChange)="dockDraftWidth.set($event)"
    (sizeCommit)="commitInspectorWidth()" (sizeCancel)="dockDraftWidth.set(null)"
    (sizeReset)="resetInspectorWidth()" (draggingChange)="dockResizing.set($event)" />`.
    - `dockDraftWidth = signal<number | null>(null)`: transient, per chat view, never persisted (D-G).
    - `commitInspectorWidth()`: as in the component 2 write-path trace (clear the draft; commit only a changed,
      non-null draft).
    - `resetInspectorWidth()`: `dockDraftWidth.set(null)`; `widthStore.reset()`.
    - CSS: `.cs-dock-slot { width:0; position:relative; z-index:10; flex-shrink:0 }` and
      `.cs-dock-handle { position:absolute; inset-block:0; left:0; width:12px }`. The hit area lies entirely over
      the dock's border and padding (design rev 3 item 1).
  - **Width binding**:
    - `dockWidth = computed(() => inspectorDockWidth(dockDraftWidth() ?? widthStore.preference(),
      shell.shellWidth()))`.
    - `dockMaxWidth = computed(() => inspectorMaxWidthFor(shell.shellWidth()))`.
    - On both `ptah-session-inspector` and the `@placeholder` div:
      `[style.width.px]="shell.isModal() ? null : dockWidth()"` and
      `[class.cs-inspector--resizing]="dockResizing()"`.
    - CSS `.cs-inspector--resizing { animation: none; }`. The sheet classes keep `min(336px,100%)` / 100% because
      no inline width is set in the sheet.
  - **Agents tab disambiguation**:
    - Add `#agentsTab` to the Agents `ptah-sidebar-tab` (`html:321`).
    - Replace `viewChild(SidebarTabComponent)` with `viewChild('agentsTab', { read: ElementRef })`.
    - Replace the `'ptah-sidebar-tab button'` query (`ts:1403-1406`) with the ref's `querySelector('button')`.
  - Inject `InspectorDockWidthStore` with `inject()`; `dockResizing = signal(false)`;
    `dockDraftWidth = signal<number | null>(null)`.
  - Expose `inspectorMinWidth = INSPECTOR_MIN_WIDTH`. `SplitHandleComponent` joins `imports`.
- Verified contracts and entry points:
  - `shell.isOpen/isModal/tab/band/toggle/closeInsp` (`inspector-shell.controller.ts:131-145,216-254`);
  - `hostsInspector` (`chat-view.component.ts:1102`);
  - `inspectorDot` (`:1143`);
  - template anchors `chat-view.component.html:2,283-316,321`;
  - `SidebarTabComponent` inputs (`sidebar-tab.component.ts:115-137`);
  - split-handle contract (component 3).
- Dependencies: chat → chat-ui (existing direction; `chat-view.component.ts:38-49`); chat → own services
  (components 1-2).
- Integration points:
  - Electron: `electron-shell.component.ts:330-385` hosts `ptah-app-shell` between the Workspaces tab and the Git
    dock/tab. It is **not modified**. The Session tab renders inside the chat panel, so the row reads main | dock |
    Session tab | (Git dock) | Git tab (design D2).
  - VS Code webview: the same `ptah-chat-view`. The Agents tab and agent panel stay inside `.cs-shell`, so the row
    reads main | dock | Agents tab | agent panel | Session tab. The visual reviewer should note it. It is not
    a design conflict: D2 only fixes "last child of the chat-view host".
- Failure behaviour:
  - No tab (tile/bare/compact/forced) → neither the tab nor the slot renders.
  - Sheet band → no slot (AC 2.7); the tab is inert and dimmed (AC 1.4).
  - Unmeasured shell → 336 px.
  - Tab button missing at click → `toggle(null)`, which falls back to today's opener order.
- Quality requirements:
  - Keyboard: tab `Enter/Space` (native button); separator arrow/Home/End/Shift.
  - Visible focus on both.
  - Reduced motion: existing block (`css:192-201`) still disables `.cs-inspector` animation.
  - No per-frame persistence.
- Verification seam: extend `chat-view.component.spec.ts`:
  - The tab renders in the full panel with `aria-expanded` equal to `shell.isOpen()`. A tab click toggles, and
    header and tab show the same state after one `detectChanges` (AC 1.1, 1.2, 1.5).
  - No tab or handle in compact, forced-card and `'bare'` views (AC 1.7).
  - Tab `badgeType` mirrors the dot (AC 1.8).
  - With a stubbed shell width ≥ 960:
    - the separator renders with `aria-valuenow` = 336 (no storage) and `aria-valuemax` = effective max;
    - seeded `localStorage` `"480"` at shell 1124 → width 480 → inline style `480px`;
    - ArrowLeft on the separator → 496 and the key is persisted (AC 2.3, 3.4);
    - dblclick → key removed and the default restored (AC 2.5).
  - Cancel keeps the wider preference (review F2; AC 2.4, 3.3): seed `"560"`; set the stubbed shell width to 960
    → separator `aria-valuenow` 336 and inline width `336px`; emit `sizeChange(320)` from the handle (inline
    width 320px), then cancel (`sizeChange(336)` + `sizeCancel`, or a real Escape keydown during a pointer drag) →
    `localStorage` still `"560"`, `store.preference()` still 560; set the shell width to 1500 → inline width
    `560px`.
  - Click without movement at a clamped width (`sizeChange(336)` + `sizeCommit` with preference 560 at shell 960)
    → nothing written; `"560"` kept.
  - Reload persistence within one view (AC 3.4, 3.6 rev 3): commit 480 via a key step, destroy the fixture,
    reset TestBed, create a new chat view over the same `localStorage` → inline width `480px`. No cross-view-type
    test (decision 10).
  - Live sync from another document (rev 3, AC 3.6 rev 3) at a stubbed shell width of 1500:
    - with no drag in progress, dispatch a `StorageEvent` (key `ptah.inspector-dock-width.v1`, `"520"`,
      `storageArea: localStorage`) → inline width `520px` after `detectChanges`;
    - during a drag, emit `sizeChange(400)` from the handle without a commit (inline width `400px`), then dispatch
      the event with `"520"` → inline width still `400px` and `store.preference()` 520;
    - then cancel (`sizeChange(startSize)` + `sizeCancel`) → inline width `520px`, and `localStorage` is
      unchanged by this view.
  - Sheet band: the tab has `inert`, there is no separator, and the inspector has no inline width (AC 1.3, 1.4,
    2.7, 5.1).
  - Docked close via the inspector close button after a tab open focuses the tab button (AC 1.6).
  - The Agents-tab focus restore still targets the Agents tab.
  - Scope the existing selectors: `chat-view.component.spec.ts:2238-2250,2315` (`ptah-sidebar-tab` →
    `ptah-sidebar-tab:not([data-inspector-tab])`; `[role="separator"]` → the agent separator, e.g.
    `[role="separator"][title]:not(ptah-split-handle *)`, or add a `data-testid="agent-resize-handle"` to the agent
    separator) and `chat-view.dock.spec.ts:514-516`. They only need updating where the harness hosts the inspector;
    the implementer runs them and narrows the failing ones.
  - Regression: `chat-view.keepalive.spec.ts` and `chat-view.session-enter.spec.ts` pass.
- Files: MODIFY
  `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`,
  `libs/frontend/chat/src/lib/components/templates/chat-view.component.css`,
  `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`,
  `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts`,
  `libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts` (selectors only, if they fail).

### 5. PLAN LIMITS card (`PlanLimitTileComponent`, `variant="inspector"`)

- Purpose: render each plan window as a card whose centre item has its own full-width row (requirement 7).
- Responsibilities:
  - Template: `@if (variant() === 'inspector') { card } @else { today's markup verbatim }`.
    - The strip branch (`plan-limit-tile.component.ts:47-168`) is not edited apart from moving it under `@else`.
    - Shared fragments (chip, caption/source footer, panel body) may be `ng-template`s used by the card branch
      only. Do not refactor the strip branch.
  - Card container: `div` with `planCardClass(tone)`. That helper is new in `stats-tile.styles.ts`:
    `block w-full relative overflow-hidden rounded-md border border-surface-border bg-surface-1 border-l-2` +
    `ROW_ACCENT[tone]`. It drops `min-h-[56px]` and `pr-5`.
  - Expandable kinds (`expandable()` true):
    - A `<button type="button" class="block w-full text-left p-2.5 border-0 bg-transparent hover:bg-base-content/5
      focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2
      focus-visible:outline-base-content">` with `aria-expanded`, `aria-controls`,
      `data-testid="plan-limit-tile"` and `(click)="toggled.emit()"`.
    - Then a sibling panel `div` with `[id]=panelId`, `[hidden]="!open()"`, `data-testid="plan-limit-panel"` and
      class `border-t border-surface-border px-2.5 pt-2 pb-2.5 text-xs` (replaces `ROW_PANEL` for this variant).
    - The panel content is unchanged: `ptah-plan-window-detail [showSummary]="false"` + detail lines.
  - Non-expandable kinds (`status`, `local-usage`): a face `div.p-2.5` with `data-testid="plan-limit-tile"`.
    It has no button, chevron, `aria-expanded`/`aria-controls` or panel (design rev 3 item 2).
  - Face rows, all phrasing `span`s with block/flex classes so they stay valid inside a button:
    - **Header**: label `min-w-0 flex-1 truncate text-xs text-base-content` + `title`; chip
      `chipClass(tone) shrink-0` with an `aria-hidden` glyph; chevron `size-3 shrink-0 text-base-content-muted` in
      flow, `aria-hidden`, expandable only.
    - **Centre** (`mt-2`). One of:
      - `status` → `block text-[11px] leading-snug text-base-content-muted break-words`, text
        `value · resetLine`, `title`=`statusTitle()`, `data-testid="plan-limit-status"`;
      - `hasBar()` → `flex items-center gap-2`: the bar `h-2 flex-1 rounded-full bg-base-content/10` keeps every
        current aria/title/testid; the value `shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums`
        (`plan-limit-tile-value`);
      - otherwise (for example the unknown 5-hour window, decision 8) → the same block style as `status`, with the
        value span still carrying `data-testid="plan-limit-tile-value"`, followed by ` · resetLine` when present.
    - **Reset line** (`hasBar() && resetLine`): `block mt-1 text-[11px] leading-tight text-base-content-muted`,
      with no indent.
    - **Footer** (`!captionShared() || ownSources().length`): `mt-1.5 flex flex-wrap items-center gap-1 text-[10px]
      text-base-content-muted`. It holds the caption (`truncate` while closed, `plan-limit-caption`, `title`) and
      `sourceChipClass` chips. Same omission logic as today.
  - Host bindings (`block min-w-0`, `data-tile-id`) are unchanged.
- Verified contracts and entry points: inputs/outputs `plan-limit-tile.component.ts:173-180`; computeds `:189-215`;
  styles `stats-tile.styles.ts:22-58`; consumer `inspector-limits-lanes.component.ts:39-45`; strip consumer
  `session-stats-summary.component.html:442-448` (task-description).
- Dependencies: within chat-ui only.
- Integration points:
  - `InspectorLimitsLanesComponent` is unchanged. `openPlanTile` (`:96-107`) still finds `button` on expandable
    cards.
  - The e2e harness click `[data-testid="plan-limit-tile"]` still lands on the button.
- Failure behaviour: a non-finite percent → no bar (existing `progressPercent`). Unknown is never drawn as 0 (AC 7.4).
- Quality requirements: no horizontal overflow at 300 px dock and in the 336 px sheet (AC 7.9). Use `min-w-0` on
  the header and `break-words` on the status text. No semantic colour on text (`stats-tile.styles.ts` rule).
- Verification seam: extend `plan-limit-tile.component.spec.ts` with an `inspector` describe block:
  - a card container wraps the face and the panel;
  - the header holds the label and chip, and the centre is a separate row (AC 7.2);
  - the status text is in its own row with no `pl-[4.5rem]` (AC 7.3);
  - the bar row keeps `role=progressbar` and aria values, and the bar has `h-2` (AC 7.4);
  - caption and sources are inside the card and omitted when shared (AC 7.5);
  - the expandable card toggles, `aria-controls` points to the panel inside the container, and the panel is hidden
    while closed (AC 7.6);
  - a `status`/`local-usage` card has no `button`, `aria-expanded` or panel (AC 7.6);
  - all testids and `data-tile-id` are present (AC 7.7);
  - class-level overflow guards (AC 7.9, structural only): header has `min-w-0`, label `truncate`, status/unknown
    centre `break-words`, value `whitespace-nowrap` only in the bar row, no `pl-[4.5rem]`.
  - Measured overflow (AC 7.9, D-I) is not provable in Jest (jsdom has no layout). It is a QA check: see the
    team-leader handoff, QA item.
  - The existing strip cases (`:70-340`) pass unchanged (AC 7.8). `session-stats-summary.component.spec.ts` passes
    unchanged.
- Files: MODIFY
  `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.ts`,
  `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-tile.styles.ts`,
  `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.spec.ts`.

### 6. `InspectorOpenStateService` spec (parity row 27)

- Purpose: pin the unchanged per-tab, per-view-mode docked choice before the host changes around it.
- Responsibilities: test only. There is no code change to `inspector-open-state.service.ts`.
- Verified contracts: `inspector-open-state.service.ts:17-60` (`dockedOpen`, `setDocked`, `onTabClosed` forget);
  `inspector-shell.controller.ts:134-136,220`.
- Failure behaviour: not applicable.
- Verification seam: new spec covering:
  - default `initialOpen ?? mode === 'full'`;
  - a workflow tab defaults to open;
  - `setDocked` per tab and per mode;
  - a closed tab is forgotten.
- Files: CREATE `libs/frontend/chat/src/lib/services/session-inspector/inspector-open-state.service.spec.ts`.

## Integration architecture

- **Data flow.**
  1. The ResizeObserver on `.cs-shell` → `InspectorShellController.applyWidth` → `band` + `shellWidth`.
  2. `InspectorDockWidthStore.preference` (restored from `localStorage`) + `shellWidth` → `ChatViewComponent.dockWidth`
     / `dockMaxWidth` → the inline width on `.cs-inspector` and `ptah-split-handle [size]/[max]`.
  3. A drag or key → `sizeChange` → `ChatViewComponent.dockDraftWidth` → `dockWidth` re-renders (once per frame).
     The store is not touched.
  4. Drag end or key step → `sizeCommit` → `commitInspectorWidth()` → draft cleared → `store.commit(draft)` (when
     changed) → `localStorage.setItem`.
  4a. Drag cancel → `sizeChange(startSize)` + `sizeCancel` → draft cleared → render falls back to the untouched
     preference.
  5. Tab/header → `shell.toggle(opener?)` → `InspectorOpenStateService` (docked) or `sheetOpen` (sheet) →
     `shell.isOpen()` → the tab's `aria-expanded` and the header's `aria-pressed`.
  6. Another same-origin document commits or resets → `window` `storage` event →
     `InspectorDockWidthStore` handler (key and area filter, shared parser) → `preference` → `dockWidth`
     re-renders unless a draft is active (rev 3).
- **State or persistence.**
  - Width preference: root singleton, app lifetime, persisted in `localStorage` (one key). Scope: Electron install;
    VS Code webview view type (decision 10). Live documents in one scope converge through the `storage` event
    (rev 3); the listener lives as long as the root injector.
  - Draft width: per chat-view signal, lifetime of one gesture/key step; never persisted.
  - Open state: unchanged (in memory, per tab and mode; decision 5).
  - Drag flag: per chat-view signal, reset by `draggingChange(false)`.
- **External boundaries.** The `localStorage` value is untrusted input. It is parsed with `Number`, checked with
  `Number.isFinite`, then rounded and clamped. A `StorageEvent.newValue` is untrusted too. It goes through the same
  parser; a malformed value is ignored rather than reset. Nothing else crosses a boundary, and there is no RPC.
- **Failure and rollback.**
  - Storage failure → in-memory width plus one `LoggingService.warn` per failure kind.
  - Drag cancel → draft dropped; the pre-drag preference renders (clamped to the current shell) and nothing is
    persisted.
  - A shell too narrow → the rendered clamp only; the preference is intact.
  - The deferred inspector chunk failing to load → the placeholder keeps the same width (existing `@defer`).
- **Observability.** `LoggingService.warn('InspectorDockWidth', …)` on storage failure (`logging.service.ts:173-175`),
  once per failure kind; the read catch carries the `degradation-audit: reported` marker. No `console.*` in new
  code (task rule). Nothing else applies.

## Architecture-level quality requirements

- Functional: AC 1.1-1.8, 2.1-2.7, 3.1-3.6 (rev 3), 4.1-4.3, 5.1-5.5, 7.1-7.8 each map to a spec case above.
  AC 7.9 is structural in the spec and measured in QA (D-I). AC 6.1-6.2 is covered by the QA visual review
  (Electron dark/light at 1440 and 760; the Electron dev app is shared, so announce per `context.md`).
- Performance: one width update per animation frame while dragging; one storage write per gesture or key step; no
  new observers, timers or listeners outside an active drag.
- Security: the stored width is validated (finite, clamped). No other input.
- Maintainability:
  - no new cross-library import;
  - `scope:webview`/`type:feature` boundaries are untouched;
  - standalone + OnPush + `input()`/`output()`/signals + `inject()` only;
  - `electron-shell.component.ts` and `ElectronLayoutService` are not modified;
  - the strip tile variant is not modified;
  - the Rail board inspector is unaffected.
- Testability: every new behaviour has a unit or component spec. There are new spec files for the controller, the
  width store, the open-state service and the split-handle. The chat-view and plan-limit-tile specs are extended.

## Team-leader handoff

- Recommended executors: frontend-developer for every component (all Angular UI/state). Per `decisions.md` row 3,
  Claude subagents implement and a codex lane reviews.
- Complexity: MEDIUM. Two libraries and one atom API extension. The riskiest part is the chat-view template and the
  spec selector fallout.
- Dependencies and ordering:
  - Component 4 depends on components 1, 2 and 3 (it uses their APIs).
  - Components 1 and 2 share `services/session-inspector/index.ts`, so put them in the same batch.
  - Components 3, 5 and 6 are independent.
- Parallel-safe work (file-disjoint): {3} ∥ {5} ∥ {1+2+6}. After those, {4}.
- Suggested batches (the team-leader re-derives them):
  1. chat-ui atom: component 3 (`@ptah-extension/chat-ui`).
  2. chat-ui card: component 5 (`@ptah-extension/chat-ui`).
  3. chat services: components 1, 2 and 6 (`@ptah-extension/chat`; canvas rail-board spec as regression).
  4. chat-view host: component 4, after batches 1 and 3 (`@ptah-extension/chat`).
  5. QA: code-logic review plus the visual review with 11 Electron screenshots: the 8 for AC 6.1 + 6.2, plus 3
     for AC 7.9 (rev 2, D-I), dark theme, PLAN LIMITS section expanded with at least one card open:
     - dock at 300 px (drag or Home on the separator) on a shell ≥ 1100;
     - dock at 560 px (End on the separator) on a shell ≥ 1184 so the effective max is 560;
     - window 760 px wide, sheet open.
     At each of the three, evaluate in the renderer that every `ptah-plan-limit-tile` and every direct row inside
     it satisfies `scrollWidth <= clientWidth`, and record the max overflow (must be 0) in `visual-review.md`
     next to the screenshot. Also re-capture the `plan-limits-visual.e2e.spec.ts` baseline drift note
     (task-description risk table). Reload persistence (A1) is checked in the same pass: resize, reload, width
     returns (Electron restart; VS Code webview reload within the same view type).
- Files affected:
  - CREATE:
    - `libs/frontend/chat/src/lib/services/session-inspector/inspector-dock-width.store.ts`
    - `libs/frontend/chat/src/lib/services/session-inspector/inspector-dock-width.store.spec.ts`
    - `libs/frontend/chat/src/lib/services/session-inspector/inspector-shell.controller.spec.ts`
    - `libs/frontend/chat/src/lib/services/session-inspector/inspector-open-state.service.spec.ts`
    - `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.spec.ts`
  - MODIFY:
    - `libs/frontend/chat/src/lib/services/session-inspector/inspector-shell.controller.ts`
    - `libs/frontend/chat/src/lib/services/session-inspector/index.ts`
    - `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`
    - `libs/frontend/chat/src/lib/components/templates/chat-view.component.css`
    - `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
    - `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts`
    - `libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts` (selectors only, if needed)
    - `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.ts`
    - `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.ts`
    - `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-tile.styles.ts`
    - `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.spec.ts`
  - REWRITE: none.
  - Not touched: `electron-shell.component.ts`, `electron-layout.service.ts`, `sidebar-tab.component.ts`,
    `session-inspector.component.*`, `inspector-open-state.service.ts`, `inspector-limits-lanes.component.ts`,
    `plan-window-detail.component.ts`, the peer-owned transcript/bubble/input files.
- Verification points (memory-safe, per CLAUDE.md; one heavy check at a time; `--parallel=1`, `--maxWorkers=2`):
  - Nx projects: `@ptah-extension/chat-ui`, `@ptah-extension/chat`. Regression only: `@ptah-extension/canvas`
    (the controller is shared). For canvas, run only
    `npx jest -c libs/frontend/canvas/jest.config.ts libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts --coverage=false --maxWorkers=2`.
  - Per batch: `npx jest -c <lib>/jest.config.ts <changed specs> --coverage=false --maxWorkers=2`, then
    `npx nx typecheck <project>` and `npx nx lint <project>`.
  - Before review: `npx nx run-many -t test -p @ptah-extension/chat-ui @ptah-extension/chat --parallel=1`. Confirm
    the header says "Running target test for 2 projects".
  - No `build`, `serve` or `e2e`. The QA screenshots use the shared Electron dev app with the announce protocol in
    `context.md`.
  - Contracts to honour:
    - split-handle defaults unchanged for existing consumers;
    - `data-testid`/`data-tile-id` hooks;
    - `[aria-controls="inspector"]` stays on the header toggle only;
    - the sheet keeps `min(336px,100%)` (no inline width when modal);
    - the storage key `ptah.inspector-dock-width.v1` holds an integer string;
    - the store preference changes only on commit/reset; the draft lives in the chat view (D-G);
    - no `console.*` in new code; the store's read catch carries the `degradation-audit: reported` marker (D-H).

## Clarifications Needed

None. No user-reserved question is open. D-A to D-F are reversible implementation choices inside the approved design.
