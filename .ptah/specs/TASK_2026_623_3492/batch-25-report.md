# Frontend implementation — `TASK_2026_623_3492`, batch 25

Verdict: COMPLETE. Both tasks are implemented. Every Batch 25 verification command passes. Chat lint shows 0 errors and
34 warnings, the same as the baseline.

**Tasks completed**: 25.1 (display dock component), 25.2 (ChatView mounts the dock; the monitor becomes the Agents
tabpanel). This includes the Batch 21, 23 and 24 follow-ons (#84, #89, #100, #101, #102, #108).

## Files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\display-dock\display-dock.component.ts`
  — `ptah-display-dock`: `Displays | Agents` tablist, pin and close, two tabpanels that are always present, display
  panel bindings, and the summary actions.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\display-dock\display-dock.component.spec.ts`
  — 18 cases, including axe.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`
  — store providers, the panel state on the store, `_userExplicitlyClosed` deleted, separator keys, per-tab width.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\templates\chat-view.component.html`
  — Electron branch (Display toggle, keyboard separator, `@defer (when panelOpen())` dock with `@error` alert). The VS
  Code branch is unchanged apart from `agentPanelOpen()` becoming `panelOpen()`.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\templates\chat-view.dock.spec.ts`
  — 14 cases.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\organisms\agent-monitor-panel.component.ts`
  — new `docked` input. When set, the panel fills its parent, hides its own close button, and its empty state reads
  "No agents in this session".

Six files in one lib, within the batch limit. Nothing in chat-ui changed.

## Task 25.1 — evidence

- **Lazy import (#84, #89, instruction 6)**: `DisplayPanelComponent`, `DISPLAY_PANEL_SUMMARY_KEY` and the type
  `DisplayPanelViewStateChange` come from `@ptah-extension/chat-ui/display-panel` in `display-dock.component.ts` only.
  - ChatView imports `DisplayDockComponent` in its own import declaration (`chat-view.component.ts:30`).
  - That declaration is referenced only in `imports` (`:216`) and inside `@defer (when panelOpen())` in the template.
  - So the dock and the display-panel entry form one lazy chunk.
  - Grep: no other non-type import of the entry exists in chat, except the transcript's existing `@defer`-only sync.
- **Panel inputs** are bound to the store:
  - `surfaces`, `pinned` and `viewStates` come from `tab(tabId)`;
  - `summary` is `summaryFor(tabId)?.model ?? null`;
  - `selectedKey` maps as `{kind:'summary'}` → `DISPLAY_PANEL_SUMMARY_KEY`, `{kind:'surface'}` → `surfaceKey`, and
    `null` → `null`;
  - `actionError` is dock-local and kept per chat tab.
- **Panel outputs**:
  - `selectedKeyChange` → `dock.select(...)`, mapped both ways;
  - `viewStateChange` → `setViewState(tabId, surfaceKey, viewState)`;
  - `openFile(path)` and `review()` act on `summaryFor(tabId)?.changeSet` through `ChangeSetActionsService`;
  - a `null` change set sets `actionError` ("This turn has no recorded file changes to open.") and the service is not
    called;
  - a rejection shows its `Error.message`, or "The review action failed." as today;
  - there is no `openScm` wiring (#84).
- **Tablist (design assertions 6-9)**:
  - Roving tabindex, wrapping arrows, Home and End, automatic activation, with focus following the selection.
  - The tabs read "Displays (n)", where n comes from `tab(tabId).surfaces` (#102 deviation 5), and "Agents (n)" with a
    visually hidden ", N running".
  - The new-content dot is `aria-hidden` and comes with a visually hidden "New: " prefix. Displays is marked new when a
    surface's `updatedSeq` passes the last one seen on that tab; Agents is marked new when it is not shown and an agent
    is running.
- **Pin** uses `aria-pressed` and `setPinned`. **Close** has a name and emits `closed`; ChatView closes the store
  and returns focus.
- **Agents tabpanel (R1.13, #11)** is always present and labelled by its tab, and it contains "No agents in this
  session". Spec: `display-dock.component.spec.ts`, "always has the Agents tabpanel…".
- **Focus**: the close button takes focus only on a user open in overlay mode (`focusRequest`), never on an auto-open
  (R1.7).
- **Chunk failure**: ChatView's `@defer` `@error` block shows a one-line `role="alert"` "Display panel failed to load"
  in the dock slot while the dock is open. See deviation 2.

## Task 25.2 — evidence

- **Providers (#59, #60, #108)**:
  - `DisplayDockState` uses `useFactory`, which returns an instance only when `VSCodeService.isElectron` is true and
    `HIDE_AGENT_SIDEBAR` is not set; otherwise it returns `null`.
  - `PTAH_UI_DISPLAY_DOCK` and `PTAH_UI_DISPLAY_DOCK_SYNC` are both provided with `useExisting: DisplayDockState`,
    imported from the `@ptah-extension/chat-ui` main barrel.
  - Spec: in Electron both tokens resolve to the same instance. VS Code and HIDE_AGENT_SIDEBAR resolve `null`, so the
    transcript's live-turn effect stays inert (#108(d)).
- **Agent rule moved onto the store (#100)**:
  - Running agents or a pending permission → `requestAgentsOpen(key)`.
  - Settled agents, with at least one present → `releaseAgentsUserClose(key)`.
  - `panelOpenRequest` → `selectTab(key,'agents')`, then `open`, then `releaseAgentsUserClose`.
  - `toggleAgentPanel` and `closeAgentPanel` → `toggle` and `close`.
  - `_userExplicitlyClosed` is deleted (grep: 0 hits).
  - The three sequences are covered in `chat-view.dock.spec.ts`, "agent auto-open on the store".
- **Toggle**: `ptah-sidebar-tab label="Display"` with `[newCount]="panelTab().newCount"`, `[isOpen]` and the agent
  badge. Spec asserts the names "Toggle Display panel" and "Toggle Display panel, 1 new", plus `aria-expanded`.
- **Separator (R1.5, assertions 10-11)**:
  - Focusable, with `aria-valuemin` 300, `aria-valuemax` 960 at a 1280 px host, `aria-valuenow`, and `aria-valuetext`
    "Panel width N pixels".
  - ArrowLeft adds 16 px and ArrowRight removes 16 px. Home goes to the minimum and End to the maximum. Enter or
    double-click resets to 400 px.
  - `PanelResizeService` clamps every value. The existing pointer drag is reused.
- **Per-tab width (R1.5)**: a tab switch restores the tab's `widthPx`, and a width change is stored for the current
  tab with the key read untracked. The spec covers the round trip.
- **R1.3**:
  - Spec, with running agents and a surface, selecting each tab in turn:
    - exactly one `ptah-display-dock`;
    - the only `ptah-agent-monitor-panel` sits inside the Agents tabpanel;
    - exactly one visible tabpanel;
    - dock inline width 300 px at a 1280 px host, outside the flex-1 chat column.
  - The chat width is therefore host minus one dock, as with the monitor alone.
- **R1.2**: at 500 px the dock is the single overlay, and the toggle and separator are hidden. Escape closes it, and
  focus returns to the toggle through the existing `afterRenderEffect`. **R1.7**: auto-open leaves focus where it was.
  **R1.1/R1.9**: a tab switch shows that tab's state and does not open it.

## Hard checks

- **#81**: `display-dock.state.ts` is unmodified.
  - `hasSeen`/`markSeen` stay synchronous over the per-tab `Map<tabId, Set>`.
  - `setSurfaces` still applies `retainedViewStateIds`.
  - The sync stays in the transcript under its own `PTAH_UI_HOST_SOURCES` provider. Nothing was moved, and the
    transcript files are untouched.
  - The dock reads the store only, and every write is synchronous; the only `await` is inside the summary-action
    handler.
- **#94**: no added code reads `vm().messages`. The dock reads only `DisplayDockState`.
- **#108**: nothing was added to `chat-transcript.component.ts`. The store is provided only where the dock mounts.

## Stack observed

- Angular standalone components with signals, `input()`/`output()`, OnPush and `@defer`. Read from
  `agent-monitor-panel.component.ts` and `chat-transcript.component.ts`.
- DaisyUI/Tailwind classes and lucide-angular, as in `sidebar-tab.component.ts` and `display-panel.component.ts`.
- Jest with TestBed `DeferBlockBehavior.Playthrough`, following `chat-transcript.display.spec.ts`.

## Design fidelity

- I followed design-spec.md section 2 (anatomy, overlay, the 400 px default) and section 8 (assertions 6-11).
- The toggle name follows batches.md ("Toggle Display panel, 1 new") rather than the design table's "Displays, 1 new".

## States covered

- Displays empty: from the panel ("Nothing to show yet").
- Agents empty: "No agents in this session".
- Closed dock: `hidden` host.
- Overlay.
- Load failure: alert line.
- Action error: inline.
- Pinned: `aria-pressed`.
- New content: text plus `aria-hidden` dot.
- Axe: no violations, with contrast and target-size disabled as in the display-panel spec.

## Verification (bash, command-line mapper override, per CLAUDE.md)

- `npx jest -c libs/frontend/chat/jest.config.ts …/organisms/display-dock …/chat-view.dock.spec.ts
  …/chat-view.component.spec.ts …/chat-view.keepalive.spec.ts --coverage=false --maxWorkers=2 --moduleNameMapper=…` →
  **4 suites, 103 tests passed**.
- `npx jest -c libs/frontend/chat/jest.config.ts execution-node.ptah-ui.spec.ts …` → **1 suite, 27 passed**.
- `npx nx typecheck @ptah-extension/chat --parallel=1` → **Successfully ran target typecheck**.
- `npx nx lint @ptah-extension/chat --parallel=1` → **0 errors, 34 warnings**, the same as the baseline.
  - `chat-view.component.ts` was already over `max-lines` (1734 lines before this batch).
- Extra check, because I changed the monitor: `jest … organisms/agent-monitor-panel` → 2 suites, 40 passed.
- Not run:
  - chat-ui checks: not applicable, nothing in chat-ui changed.
  - `canvas-tile.component.spec.ts`: the canvas lib was not changed (CLAUDE.md scope).
  - No build, serve or e2e targets were run.

## Risks and how they were handled

- **VS Code inertness (#108(d))**: the factory returns `null` outside Electron and with HIDE_AGENT_SIDEBAR. A spec
  asserts the `null` resolution.
- **Eager growth**: the dock file is only `@defer`-reachable. Its display-panel import adds nothing eager. The eager
  ChatView adds only the `DisplayDockState` import (already eager through the transcript feed) and the main-barrel
  tokens.
- **VS Code parity**: the VS Code branch keeps its template, one panel state per view and the same toggle semantics.
  The existing 76 `chat-view.component.spec.ts` cases pass unchanged, including the overlay and Escape cases.
- **Cross-tab state**: every store call takes the panel key, which is the tab id in Electron.

## Deviations (numbered for a ruling)

1. **One store mechanism for the VS Code monitor.**
   - Deleting `_userExplicitlyClosed` (#100) means the store must own the user-close rule. #108 also forbids
     providing the store in VS Code.
   - So when no dock store is injected, ChatView holds a view-private `new DisplayDockState()` that is never provided
     to DI, keyed by the constant `VIEW_PANEL_KEY`.
   - VS Code therefore keeps exactly one panel state per view, as before. Nothing in the transcript or the chips can
     see it, so no live-turn writes happen.
   - Electron with no tab yet uses the same key on the real store.
2. **The chunk-failure alert sits in ChatView's `@defer` `@error`, not inside the dock.**
   - The dock must use `DISPLAY_PANEL_SUMMARY_KEY` as a value (follow-on #102), which makes the display-panel module a
     static dependency of the dock file.
   - An inner `@defer` in the dock would therefore load nothing new, and its `@error` could never fire.
   - The dock and the panel load as one lazy chunk. If it fails, the dock slot shows "Display panel failed to load"
     (plan component 8, failure behaviour).
   - Consequence: if that chunk fails, the Agents view is also unavailable in Electron.
3. **The separator's Enter and double-click reset to `null` (the 400 px default) rather than storing 400.**
   - `dockWidth = clamp(customWidth ?? 400)`, so the value the user sees is 400 px.
   - The tab's `widthPx` goes back to `null` (the responsive default), which matches the store's contract.
4. **Agent badge on the Display toggle.** The toggle keeps `[badgeType]="agentBadgeType()"`, so agent status is still
   visible when the monitor moves into the dock. Neither the plan nor the design names it.
5. **New-content dots on the dock tabs.**
   - Displays: a dock-local, per-tab "highest `updatedSeq` seen" signal. The store has no field for this, and Batch 23
     closed the store.
   - Agents: marked new while it is not shown and an agent is running.

## Out-of-scope observations

- `chat-view.component.ts` is now 1886 lines (it was 1734, already over the 700 `max-lines` warning). The dock logic
  (provider, separator keys, width sync) could move to a `chat-view-dock.ts` helper in the same folder, but Batch 25
  was at its 6-file limit.
- The Batch 32 eager allow-list should name `display-dock.component.ts` as a lazy-only file, and the eager-closure
  gate should confirm it stays out of the eager closure.
