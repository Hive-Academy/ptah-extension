# Batch 3 report — TASK_2026_699_833e (chat-view host: Session tab, dock slot + handle, width binding)

Executor: Claude frontend-developer subagent. Worktree
`D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock` (branch `feat/inspector-side-dock`).
No git commands were run. The working tree is left dirty for the team-leader.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\components\templates\chat-view.component.html`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\components\templates\chat-view.component.css`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat\src\lib\components\templates\chat-view.component.spec.ts`

`chat-view.dock.spec.ts` was not changed. It passes as is, because the Agents tab sits inside `.cs-shell`
and so comes before the Session tab in document order. Its generic `ptah-sidebar-tab button` query
(`:514-516`) still finds the Agents tab, and the Electron dock path renders no Agents tab at all.
No peer-owned file was touched (chat-transcript css/html, message-bubble css/html, chat-input.component.ts).

## Task 3.1 — Session tab, dock slot and handle, width binding — done

- CSS: `:host` is now `display: flex` and keeps `height:100%` and `position:relative`.
  `.cs-inspector--resizing { animation: none }` comes after `.cs-inspector`, so it wins at equal specificity.
  The reduced-motion block is unchanged.
  `.cs-dock-slot` sets `position:relative; z-index:10; width:0; flex-shrink:0`.
  `.cs-dock-handle` sets `position:absolute; inset-block:0; left:0; width:12px`.
- HTML:
  - `.cs-shell` swaps `w-full` for `flex-1 min-w-0`.
  - The dock slot renders inside the shell, between the main column and the inspector `@if`, under
    `@if (dockSlotShown())`. It holds `<ptah-split-handle class="cs-dock-handle" orientation="vertical"
    appearance="grip" label="Resize session details" [inverted]="true" ...>`, with sizeChange, sizeCommit,
    sizeCancel, sizeReset and draggingChange wired as in the plan. The literal `'grip'` is bound, so
    `SplitHandleAppearance` is not exported.
  - Both `ptah-session-inspector` and the `@placeholder` div get
    `[class.cs-inspector--resizing]="dockResizing()"` and `[style.width.px]="shell.isModal() ? null : inspectorWidth()"`.
    The sheet therefore keeps `min(336px,100%)` / 100%.
  - The Session tab is the last host child, after `.cs-shell`, under `@if (hostsInspector() && shell.tab())`.
    It is a `ptah-sidebar-tab` with `#sessionTab`, `data-inspector-tab`, `label="Session"`, `side="right"`,
    `[isOpen]`, `[badgeType]="inspectorTabBadge()"`, `[attr.inert]` and `[class.opacity-50]` (both when modal),
    and `(toggled)="toggleInspectorFromTab()"`.
  - The header toggle keeps `(inspectorToggled)="shell.toggle()"` and remains the only
    `[aria-controls="inspector"]`.
  - The Agents tab gets `#agentsTab`. The agent separator gets `data-testid="agent-resize-handle"`.
- TS:
  - Injects `InspectorDockWidthStore` with `inject()`. `SplitHandleComponent` is added to `imports`.
  - New members: `sessionTab`, a `viewChild('sessionTab', { read: ElementRef })`;
    `inspectorTabBadge`, which maps `sel → 'info'`, `need`/`err → 'warning'` and `null → null`;
    `dockSlotShown`; `dockDraftWidth`; `dockResizing`; `inspectorMinWidth = INSPECTOR_MIN_WIDTH`;
    `inspectorWidth`; `inspectorMaxWidth`; `toggleInspectorFromTab()`; `commitInspectorWidth()`;
    `resetInspectorWidth()`.
  - `commitInspectorWidth()` reads the draft and clears it. It returns on `null`, and it returns when
    `Math.round(draft)` equals `inspectorDockWidth(store.preference(), shell.shellWidth())`. Otherwise it
    calls `store.commit(draft)`. Writes happen only on `sizeCommit` (drag end or key step), never per frame.
  - `resetInspectorWidth()` clears the draft and calls `store.reset()`.
  - `toggleInspectorFromTab()` passes the Session tab's `button` as the opener. When that button is
    missing it calls `toggle(null)`.
  - R2: `agentSidebarTab` is now `viewChild('agentsTab', { read: ElementRef })`, and the focus restore
    queries `button` inside that ref. The old `'ptah-sidebar-tab button'` host query is gone.

## Task 3.2 — specs — done

`chat-view.component.spec.ts`:

- Harness:
  - New `renderInspectorTemplate` option: real `AgentMonitorPanelComponent`, `SidebarTabComponent` and
    `SplitHandleComponent`, with `NO_ERRORS_SCHEMA`.
  - New `embedChrome: 'bare'` option.
  - The `InspectorOpenStateService` stub is now reactive (`dockedOpenSig`; `setDocked` writes it), so a
    toggle re-renders. Every existing case still passes.
- Existing overlay-describe selectors are scoped to `ptah-sidebar-tab:not([data-inspector-tab])` and
  `[data-testid="agent-resize-handle"]`.
- New describe block "Session tab and inspector dock", 18 cases. It uses a fake `ResizeObserver` keyed by
  the observed target and drives `.cs-shell` widths. `detect()` is `detectChanges()` followed by
  `TestBed.tick()`, so `afterNextRender` attach and focus run. Cases:
  - The tab is the host's last child, outside the shell, with no `aria-controls`. A tab click toggles, and
    the tab's `aria-expanded`, the header `inspectorOpen` and the dock agree after one detect (AC 1.1, 1.2, 1.5).
  - No tab, handle or slot in compact, forced-card, tile and `'bare'` views (AC 1.7).
  - Badge: needs-you gives a warning dot, and opening clears it. A workflow tab gives an info dot (AC 1.8).
  - Shell 1000: `aria-valuenow` 336, min 300, max 376, inline `336px`. The handle sits inside `.cs-dock-slot`
    inside `.cs-shell`.
  - Seeded `"480"` at 1124 gives 480 / max 500 / `480px`.
  - ArrowLeft gives 496, persisted `"496"` (AC 2.3, 3.4).
  - dblclick removes the key and restores 400 at 1124 (AC 2.5).
  - Cancel keeps `"560"`: at 960 the dock renders 336, a draft 320 renders `320px`, and after cancel the
    stored value is still `"560"`. At shell 1500 the dock renders `560px` (AC 2.4, 3.3).
  - A click without movement at the clamped 336 makes no `setItem` call, and `"560"` is kept.
  - Reload persistence: commit 480, destroy, reset TestBed, new view, `480px`.
  - Live sync without a drag: `520px`.
  - Live sync during a drag (R8): the dock stays at 400 while the preference becomes 520. After cancel it
    renders `520px`, with no `setItem` and no key written.
  - `cs-inspector--resizing` is set only while dragging.
  - R1: covered by the case "drops a stale draft when the handle is destroyed mid-drag (R1)" (see Risks).
  - Sheet band at 800: the tab is visible and not inert. Once the sheet is open, the tab is `inert` and
    `opacity-50`, there is no handle, and the dock has no inline width (AC 1.3, 1.4, 2.7, 5.1).
  - AC 1.6: a tab open followed by the inspector's `closeRequested` puts focus on the Session tab button.
  - The Agents-tab focus restore still targets the Agents tab button, not the Session tab.

## Risks and edge cases

- **R1 (handle destroyed mid-drag).** `dockDraftWidth` and `dockResizing` are `linkedSignal`s with
  `source: dockSlotShown`. They reset to `null` / `false` whenever the slot condition
  (`hostsInspector() && shell.isOpen() && shell.tab() !== null && !shell.isModal()`) changes. This is the
  only destroy-path mechanism, and no handle output is relied on.
  - A flip that is never rendered (false then back to true before a read) does not reset. In that case the
    handle was never destroyed, so its drag is still live and the draft stays valid.
  - Spec: draft 400 plus dragging, then shell 800 (the handle is gone), then 1500. The dock renders the
    448 preference default, has no resizing class, shows `aria-valuenow` 448, and nothing is written.
- **R2 (second tab and second separator).** Handled in the template refs and the spec selectors as
  described above.
- **R4.** The full chat test target passes, including the agent-lane-panel, keepalive, session-enter and
  dock specs.
- **R8.** Covered by the live-sync-during-drag case.
- **Click without movement at a clamped width.** Guarded in `commitInspectorWidth`, with its own spec case.
- **Cancel restores the pre-drag preference.** `sizeCancel` sets `dockDraftWidth` to `null`, and the store
  is untouched.
- **Tab button missing.** `toggle(null)` fallback (`?? null`).
- **Sheet band.** The tab is inert and `opacity-50`; there is no slot and no inline width.
- **Tile, bare, compact and forced card.** No tab and no slot.
- **Unmeasured shell.** Width 336 through `inspectorDockWidth(…, 0)` (Batch 2).

## Verification

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts --coverage=false --maxWorkers=2`:
  103 passed, 103 total, with no NG0953 warnings.
  - The 15 `NG0101 ApplicationRef.tick is called recursively` log lines come from the existing
    "plan limits wiring" block (`TestBed.tick()` at spec `:1755/1771/1791`).
  - I confirmed they are pre-existing: I temporarily put the original chat-view ts/html/css from the main
    checkout in place, ran that block (same 15 lines), then restored my files and checked them with `cmp`.
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat --parallel=1`: "Successfully ran targets
  typecheck, test, lint for project @ptah-extension/chat".
  - The test target was then re-run once with `--skip-nx-cache` and again reported "Successfully ran
    target test".
- `ptah_get_diagnostics` on `chat-view.component.ts`: no errors in the file. The sibling spec errors it
  lists come from files I did not change.
- No build, serve, e2e or package target was run.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Name the width computeds `inspectorWidth` / `inspectorMaxWidth` instead of the plan's `dockWidth` / `dockMaxWidth` | plan names (collide); rename the existing ones | `chat-view.component.ts` already has `dockWidth`, `dockMaxWidth` and `dockMinWidth` for the Display dock / agent panel (`:457-478`), and they are used by `shouldOverlayDock` and the separator keys | yes |
| Template ref `#sessionTab` instead of `#inspectorTab` | plan name | `as inspectorTab` is already the alias of the inspector `@if`; a same-named ref would shadow it | yes |
| R1 through `linkedSignal` reset on `dockSlotShown`, not an `effect` | effect; derive in the computed | no signal writes from effects; reset on the same transition the handle is destroyed on; `linkedSignal` is already used in the repo (git-ui, marketplace) | yes |
| Added `data-testid="agent-resize-handle"` to the agent separator | `:not(ptah-split-handle *)` selector | plan suggests either; the test id is explicit | yes |
| Spec `detect()` calls `TestBed.tick()` after `detectChanges()` | `whenStable` loops (dock spec) | `afterNextRender` attach and focus need an app tick; `TestBed.tick()` is used in existing chat specs | yes |

## Plan deviations

- The names, as listed in Decisions. Behaviour matches the plan.
- `chat-view.dock.spec.ts` was not modified, because its selectors do not fail.

## Out-of-scope observations

- Existing harness noise in `chat-view.component.spec.ts`: the `SessionLoaderService` `console.warn`
  "cli-sessions failed; will retry", and NG0101 in the plan-limits block. Neither is introduced here.
