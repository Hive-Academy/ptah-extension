# Requirements — TASK_2026_540_0940 — Global configuration menu and code-workspace tab set (Electron shell)

## Summary

Revision 5 step 2, Electron webview shell only. Three outcomes:

1. The four configuration surfaces — Thoth (`thoth`), Setup hub (`setup-hub`), Marketplace (`marketplace`), Settings (`settings`) — move out of the Electron tab row into one global configuration menu: one icon button in the navbar global-actions cluster next to the theme toggle, opening a `ptah-native-dropdown` that lists the four destinations. The menu is reachable before any workspace is open.
2. The view state of these four surfaces stops being workspace-partitioned: one global "open configuration surface" state, on the precedent of the `layoutMode` signal.
3. The Electron tab row shows the code-workspace navigation set: Chat, Apps, Tasks, Tribunal, Analytics, in that order. The Apps tab itself belongs to TASK_2026_494; this task only reserves its slot between Chat and Tasks.

Classification: FEATURE. Estimate: M (matches `context.md`). Priority: not defined here — the Revision 5 step order in `TASK_2026_490_583c/research-report.md` is the only sequencing authority.

## Current state

**Tab row.** `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:122-213` renders eight tabs inside `@if (layout.hasWorkspaceFolders())`: Canvas (chat) `:124-134`, Dashboard (analytics) `:135-145`, Thoth `:146-156`, Tribunal `:157-167`, Tasks `:168-178`, Setup (setup-hub) `:179-189`, Marketplace `:190-200`, Settings `:201-211`. Click handlers: `:381-415` (`onCanvasTab` `:381-384`, `openSettings` `:386-388`, `openDashboard` `:390-392`, `openThoth` `:394-399` — which also dismisses the Thoth first-run hint, `openSetupHub` `:401-403`, `openMarketplace` `:405-407`, `openTribunal` `:409-411`, `openTasks` `:413-415`).

**Global actions cluster.** `electron-shell.component.ts:218-227` — theme toggle and notification center in a `no-drag` container, rendered regardless of `layout.hasWorkspaceFolders()`. The workspace gate `@if (!layout.hasWorkspaceFolders())` is at `:232`. The `no-drag` CSS class (`:88-94`) escapes the macOS title-bar drag region.

**View state partition.** `libs/frontend/core/src/lib/services/app-state.service.ts:277-287` holds `_viewSlices`, a map keyed by workspace path; each slice carries a `currentView` memory (`:195-225`). On a workspace switch the shell navigates to the new slice's remembered view, or `DEFAULT_SURFACE_ID` for a fresh workspace (`:715`). The precedent for a signal that must NOT be workspace-partitioned is `_layoutMode`, commented "Deliberately NOT workspace-partitioned" (`:292-302`). The live `currentView` is a computed off the Router (`:481-483`).

**Surface ids and routes.** The single id list is `libs/shared/src/lib/types/webview-surface.types.ts` — `ViewType` union `:39-50`, `SURFACE_ROUTE_IDS` `:60-71`. Routes for all four surfaces already exist: `apps/ptah-extension-webview/src/app/app.routes.ts:80-85` (settings, eager), `:106-115` (setup-hub), `:117-123` (thoth), `:125-133` (marketplace).

**Dropdown primitive.** `libs/frontend/ui/src/lib/native/dropdown/native-dropdown.component.ts` — `isOpen` input `:118`, `closed` output `:168`, `panelRole` input `:155-157` (listbox, or null for a panel of action buttons), backdrop click-outside `:223-228`.

**Other production entry points that navigate to the four surfaces today** (every one must keep working):

| Entry point | Goes to |
| ----------- | ------- |
| `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:386-407` | settings, thoth, setup-hub, marketplace (the tab handlers this task replaces with menu items) |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:318-319` | settings (boot auth check) |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:336-338, 352-357, 362-364` | settings, thoth (incl. first-run dismissal), marketplace |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:226` | settings |
| `libs/frontend/chat/src/lib/components/molecules/mcp-status-chip.component.ts:365, 392` | settings, marketplace |
| `libs/frontend/chat/src/lib/components/molecules/setup-plugins/chat-empty-state.component.ts:281` | marketplace |
| `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts:419` | settings |
| `libs/frontend/setup-wizard/src/lib/components/welcome.component.ts:338` | settings |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-settings-panel.component.ts:423` | settings |
| `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.ts:304` | settings |
| `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:761` | setup-hub |
| `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:583` | thoth |
| `libs/frontend/core/src/lib/services/app-state.service.ts:835-840` | thoth (`openSkillsDivergedClones`) |
| `libs/frontend/core/src/lib/services/app-state.service.ts:1110-1114` | settings (`openSettingsTab`) |
| Host wire: `SWITCH_VIEW` messages (`app-state.service.ts:258-268`) and `initialView` values (`webview-surface.types.ts:94-97`) | any of the four |

## In scope

1. One global configuration menu in the Electron navbar: an icon button in the global-actions cluster (`electron-shell.component.ts:223-227`), next to the theme toggle, opening a `ptah-native-dropdown` listing Thoth, Setup hub, Marketplace, Settings. Reachable before any workspace is open.
2. Removal of the four configuration tabs from the Electron tab row.
3. Un-partitioning the four surfaces' view state: one global open-configuration-surface state in `AppStateManager`, on the `_layoutMode` precedent (`app-state.service.ts:292-302`); no `_viewSlices` tracking for these four surfaces.
4. The Electron tab row shows the code-workspace set in order: Chat, [Apps — slot reserved between Chat and Tasks], Tasks, Tribunal, Analytics.
5. Every other navigation entry point listed in Current state keeps working, in both the Electron and VS Code shells.

## Out of scope

- Spaces, Home, Schedules and the space nav set — TASK_2026_541_9deb (Revision 5 step 3, separate task).
- The Apps page, the `apps` id, route and tab — TASK_2026_494. This task reserves the slot and order only.
- Router batch 3 (`data: { retain: true }` / `RouteReuseStrategy`) — not needed and not added: the design mount policy (TASK_2026_492 design-spec.md:37-49) marks all four configuration surfaces "Stays mounted: No". No new `[class.hidden]` block.
- VS Code webview changes — the global menu and the navigation sets are Electron only; VS Code behaviour stays as today.
- Surface id renames and wire-contract changes — `libs/shared/src/lib/types/webview-surface.types.ts` stays verbatim; `SWITCH_VIEW` and `initialView` unchanged.
- Route eagerness changes — `app.routes.ts` keeps settings eager and the other three lazy.
- Settings/Marketplace content work — TASK_2026_523 (Providers & Auth surface), TASK_2026_529 (contrast audit).

## Acceptance criteria

### Global configuration menu

1. When the Electron navbar renders, the global-actions cluster (`electron-shell.component.ts:223-227`) shall contain one icon button next to the theme toggle that opens a `ptah-native-dropdown` listing exactly four items, in order: Thoth, Setup hub, Marketplace, Settings.
2. When the user activates a menu item, the system shall navigate to that surface's route.
3. When the user opens Thoth through the menu, the system shall dismiss the Thoth first-run hint, exactly as the removed tab handler did (`electron-shell.component.ts:394-399`).
4. When `layout.hasWorkspaceFolders()` is false, the configuration menu button shall render and open — the button sits above the `@if (!layout.hasWorkspaceFolders())` gate at `electron-shell.component.ts:232`, not inside it.
5. When no workspace is open and the user selects a configuration destination, the system shall show that configuration surface; when the user leaves it without opening a workspace, the welcome screen shall show again. The menu shall be available in both states.
6. When the user operates the menu by keyboard: the trigger shall be a focusable button with an accessible name; Enter and Space shall open it; arrow keys shall move between items; Enter shall activate the focused item; Escape shall close the menu and return focus to the trigger. The panel shall use an ARIA role consistent with the repository's dropdown pattern (`panelRole` input, `native-dropdown.component.ts:155-157`).
7. When the user selects an item, clicks the backdrop, or presses Escape, the dropdown shall close (the `closed` output wired to the open state).
8. The trigger shall sit inside a `no-drag` element (macOS title-bar drag region, `electron-shell.component.ts:88-94`) so macOS does not swallow the click.

### Tab row

9. The Electron tab row shall contain no tab for `thoth`, `setup-hub`, `marketplace` or `settings`.
10. When a workspace is open, the tab row shall render the code-workspace set in this order: Chat, [Apps — slot reserved between Chat and Tasks, not rendered in this task], Tasks, Tribunal, Analytics. Labels follow the design's names (`TASK_2026_492_0bcc/design-spec.md:37-44`): Chat and Analytics replace the current "Canvas" and "Dashboard" tab labels.
11. When the user clicks the Chat tab, the system shall activate the canvas grid chat surface exactly as the current Canvas tab does (`setLayoutMode('grid')` plus chat view, `electron-shell.component.ts:381-384`).
12. When the user clicks Tasks, Tribunal or Analytics, the system shall navigate to that surface, as the current handlers do (`:390-392`, `:409-415`).
13. The tab row shall keep `role="tablist"`, `role="tab"` and `aria-selected` bindings, and shall render only when a workspace is open (unchanged gate at `:122`).

### Un-partitioned view state

14. The open state of the four configuration surfaces shall be one global state in `AppStateManager`, stored outside `_viewSlices`, following the `_layoutMode` precedent (`app-state.service.ts:292-302`) including its explanatory comment.
15. When the user switches the active workspace, the global configuration-surface state shall not change — no fork, no reset, no per-workspace restore. A test that reads the state before and after a workspace switch shall see the same value.
16. When the user opens one of the four surfaces from any entry point, the same single global state shall be updated, regardless of the active workspace.
17. The workspace-partitioned behaviour of every other surface (chat, analytics, tribunal, tasks, setup-wizard, harness-builder) shall be unchanged: the existing slice tests for those surfaces still pass.

### Other entry points and the host contract

18. Each production entry point listed in Current state shall still navigate to its surface after this change, in both shells. The host wire contract shall behave as today: `SWITCH_VIEW` (`app-state.service.ts:258-268`) and `initialView` values for the four ids land on their routes.

### VS Code unchanged

19. The VS Code webview shall show no configuration menu and no navigation-set change; its shell and behaviour shall be identical to before this change. The `AppShellComponent` navigation VS Code uses keeps its current entry points (`app-shell.component.ts:336-364`).
20. `libs/shared/src/lib/types/webview-surface.types.ts` shall be unchanged — no id renamed, added or removed — and `app.routes.ts` route paths and eagerness shall be unchanged.

### Implementation guards

21. The change shall add no new `[class.hidden]` block and no `data: { retain: true }` route entry (checkable by grep over the diff).

## Non-functional constraints

- Angular rules: standalone components, `ChangeDetectionStrategy.OnPush`, signals; no NgModules.
- UI rules: the menu uses `ptah-native-dropdown` from `libs/frontend/ui` (Native* family); Tailwind/daisyui tokens only; no new CDK usage; cross-lib imports only through package barrels.
- macOS title bar: the trigger lives inside a `no-drag` element (criterion 8).
- Accessibility: full keyboard operation and ARIA per criterion 6; the menu works with the platform screen readers the repository already supports.
- No wire-contract, shared-id or route-eagerness changes (criterion 20).
- The four surfaces keep their "Stays mounted: No" behaviour — destroyed on navigate-away, as today; no retention or hiding work.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Unit specs pin per-workspace behaviour using the four ids as fixtures (`app-state.service.spec.ts:289-408, 542-813`; e.g. `:735-751` asserts workspace B does not remember A's `'settings'`). Un-partitioning invalidates those fixtures. | HIGH | MEDIUM | Re-pin the fixtures to still-partitioned surfaces (analytics, tribunal, tasks) inside the implementation batch. Owner: implementing developer with senior-tester. |
| Electron e2e and webview-e2e specs may click the removed tabs. `ui-driver.ts:392` navigates by `switchView` messages, so `ui.goto` survives; direct tab-row selectors break. | MEDIUM | MEDIUM | senior-tester greps `apps/ptah-electron-e2e` and `libs/frontend/webview-e2e-harness` for tab-row selectors and updates them to the menu. |
| Showing a configuration surface with no workspace open crosses the workspace gate: the router outlet lives in `AppShellComponent`, rendered only behind `@if (layout.hasWorkspaceFolders())` (`electron-shell.component.ts:232-265`). The requirement fixes the outcome; the mechanism is not chosen. | MEDIUM | HIGH | software-architect resolves the pre-workspace render path in `implementation-plan.md` before batches are cut. |
| What the user sees after a workspace switch while a configuration surface is open (stay on it, or land on the new workspace's view) is not fixed by the design. | LOW | MEDIUM | software-architect states the choice in `implementation-plan.md`; criteria 14-16 bind the state only. |
| The new navbar button sits in the macOS title-bar drag region; a missing `no-drag` class swallows clicks. | LOW | MEDIUM | Criterion 8, plus a manual macOS check in review. |

## Open questions

None blocking. Two mechanism decisions are the architect's, not the user's: the pre-workspace render path (risk 3) and the visible surface after a workspace switch (risk 4).

## Handoff

- Next specialist: software-architect — the state model (where the global signal lives and how the pre-workspace render path works) is the open shape; the ids, routes, entry points and scope are fixed here.
- Why: every requirement above is outcome-level; two mechanism choices remain and both belong in `implementation-plan.md`.