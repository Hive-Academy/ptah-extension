# Batch 4 - Glm review

Verdict: **ACCEPT**
Score: **9/10**
Numbered findings: 3 (0 BLOCKING, 0 MAJOR, 3 MINOR)

Evidence base: full read of `electron-shell.component.ts` (post-change, 391 lines), `electron-shell.config-gate.spec.ts` (310 lines), the activity-placement spec diff, the committed context (`app-state.service.ts` openConfigurationSurface / configurationSurfaceRemountTick / switchWorkspace stay-branch / settlement effect / setCurrentView / canSwitchViews; `surface-router.service.ts` pendingSurface / remountActiveSurface / navigateToSurface; `global-config-menu.component.ts`; `electron-layout.service.ts` coordinateWorkspaceSwitch / coordinateWorkspaceCleared; `app.routes.ts`; `app.html` + `app.ts` shell gating). Orchestrator-provided evidence: chat typecheck/test/lint PASS (no cache), harness e2e 71/71 PASS on a fresh worktree bundle.

## Contract verification

**Three-branch gate** — `electron-shell.component.ts:205-212`. Branch 1: `!hasWorkspaceFolders() && openConfigurationSurface() === null` → welcome. Branch 2: `@else if (!hasWorkspaceFolders())` → `<div class="h-full w-full"><router-outlet /></div>` (line 211). Branch 3: `@else` → the existing 3-panel area. The branches are mutually exclusive by construction, so exactly one primary outlet exists at any time: branch 2 holds the shell's own outlet, branch 3 holds the one inside `ptah-app-shell` (`app-shell.component.ts`), and no other `router-outlet` exists in the shell template. `RouterOutlet` is imported and registered (lines 29, 67).

- Flip 2 → 3 (first folder): the bare outlet is destroyed and `ptah-app-shell` is created; the stored route re-activates in the app-shell outlet. Pinned by case 6 (`electron-shell.config-gate.spec.ts:233-242`): no throw, no leftover bare outlet, configuration state retained.
- Flip 3 → 2 (last workspace closed): `coordinateWorkspaceCleared` calls only `coordinator.clearWorkspace()` — no `switchWorkspace`, no tick bump (`electron-layout.service.ts:540-551`), so the gate flip is a pure re-render and the bare outlet re-activates the stored route. Pinned by case 7 (`config-gate.spec.ts:244-250`).
- Welcome returns: the back button calls `appState.setCurrentView('chat')` (`electron-shell.component.ts:189`); `setCurrentView` → `requestSurface` → navigation to the componentless `/chat` route (`app.routes.ts:61-70`) → the AppStateManager settlement effect writes `openSurface = null` unconditionally from Router truth (`app-state.service.ts:484-496`) → branch 1. Pinned by case 5 (`config-gate.spec.ts:221-231`).

**Remount effect** — `electron-shell.component.ts:327-342`.

- Tracks only the tick: the sole tracked read is `configurationSurfaceRemountTick()` (line 328). `pendingSurface()`, the `viewChild` host, and `document.activeElement` are all read inside `untracked` (lines 330-334). Correct.
- Skips 0 (line 329). Pinned by case 9 (`config-gate.spec.ts:264-274`).
- Skips while `pendingSurface()` is non-null, without deferral (line 331). Pinned by case 11 (`config-gate.spec.ts:298-309`), which also proves that clearing pending state alone does NOT schedule a deferred remount.
- Focus rules (lines 333-340): records `activeElement` and `host.contains(active)` before the remount, then focuses the host in a `queueMicrotask` only when `active === document.body`, or `!active?.isConnected`, or `wasInside` — byte-for-byte the override-3 contract. Pinned by the two case-10 tests (`config-gate.spec.ts:276-296`): body focus moves to the host; a live navbar tab keeps focus.
- Sole caller: `remountActiveSurface` has exactly one production call site in the repo — `electron-shell.component.ts:335` (grep over `apps/` + `libs/`, specs excluded). No synchronous handler or `switchWorkspace` call was added. Binding rules 1-4 hold.
- Runs after `workspaceInfo` updates: the tick is bumped synchronously inside `coordinator.switchWorkspace` and `setWorkspaceInfo` runs in the same synchronous block before the coordinator returns (`electron-layout.service.ts:486-503`); the effect runs at the next change-detection flush, so the re-created component reads the new workspace. Binding rule 2 holds.
- Errors from the re-created component propagate uncaught (no try/catch at the call site) — binding rule 3 permits this ("if you add a boundary, do not swallow silently"; the implementer added none).

**Tab row** — `electron-shell.component.ts:121-168`. Kept: the `:122` gate (`@if (layout.hasWorkspaceFolders())`), `role="tablist"`, `electron-tabs` class, `role="tab"`, `[attr.aria-selected]`. Order: Chat (label/title "Chat", `LayoutGrid`, `onCanvasTab()`) at 123-133, the exact Apps comment at line 134, Tasks at 135-145, Tribunal at 146-156, Analytics (`openDashboard()`, `BarChart3`) at 157-167. Thoth/Setup/Marketplace/Settings tabs, their four handlers, and the eight unused lucide imports/fields are deleted (imports at 31-37 contain only what the template uses). Pinned by case 3 (`config-gate.spec.ts:169-198`): exactly four `role="tab"` buttons, titles and labels in order, aria-selected `true,false,false,false`, inside `[role="tablist"].electron-tabs`.

**Menu mount** — `electron-shell.component.ts:198-199`: `<ptah-global-config-menu />` immediately left of `<ptah-theme-toggle />`, inside the existing `no-drag` global-actions div (line 179). Relative sibling import at line 48, standalone registration at line 68, no barrel edit. Case 4 (`config-gate.spec.ts:200-219`) resolves the menu host only from `data-test="config-menu-trigger"` and asserts the host's next sibling is `ptah-theme-toggle` — binding rule 8 holds. No duplication of the menu's `canSwitchViews` gate, Thoth-dismiss order, or focus return.

**Back button** — `electron-shell.component.ts:180-197`: rendered only when `!hasWorkspaceFolders() && openConfigurationSurface() !== null`, `type="button"`, `aria-label="Back to welcome"`, `data-test="config-back-to-welcome"`, click → `setCurrentView('chat')`, inside the `no-drag` cluster.

**Forbidden edits** — none. `git diff HEAD` is empty for `app-shell.component.*`, `app.routes.ts`, `webview-surface.types.ts`. The component contains no `[class.hidden]` and no keyed `@for` around `ptah-app-shell` (un-keyed at line 244); no `retain: true` anywhere in the shell or routes. The activity-placement spec's three existing cases are untouched — only the stub extensions the contract names (signal-backed `hasWorkspaceFolders`, `openConfigurationSurface`, `configurationSurfaceRemountTick`, the `SurfaceRouterService` provider).

**Cases 1-11** — all eleven pinned, twelve tests: mapping at `config-gate.spec.ts:155, 162, 169, 200, 221, 233, 244, 252, 264, 276/288, 298`. Case 8 pins the designed non-configuration settlement (setup-hub → tasks → welcome).

## Five logic questions

1. **Silent failure.** The back button is a silent no-op while `canSwitchViews()` is false (finding 3). `remountActiveSurface` also returns silently when no outlet is activated (componentless route) — that is the designed RC chat case and is harmless. A skipped tick (pending navigation that later cancels) is accepted risk RJ, recorded in `batches.md:86`.
2. **Unexpected user action.** A disconnected user clicks "Back to welcome" and nothing happens (finding 3). All other user paths (tabs, menu, back button, gate flips) trace to the designed behaviour.
3. **Wrong answer input.** Matrix-parameter URLs (`/settings;panel=auth`) are handled by `surfaceOf` in core, not by the shell. No shell-level input produces a wrong answer.
4. **Dependency failure.** `remountActiveSurface` deliberately does not catch constructor/`ngOnInit` errors of the re-created component; such an error propagates out of the effect and is visible, not swallowed (binding rule 3). The `pendingSurface()` read makes a mid-flight navigation skip rather than tear down — the residual cancel case is RJ.
5. **Missing requirements.** Nothing material. The manual Electron checks (no-auth back button, RD fresh-data, RG macOS drag) are outside a lane's reach and are recorded as carried to orchestrator/QA in `batch-4-report.md:67`.

## Findings

1. **MINOR** — `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:327-342`. The effect cannot distinguish "shell created with a non-zero tick" from "tick changed". An Angular effect runs once on creation with the current value, so a shell created after a tick bump would remount the active surface once with no workspace switch behind it: a wasted component rebuild and, under the focus rule (focus is on `body` after creation), a focus steal by the host. Today this is unreachable: `app.ts:62-64` sets `initializationStatus` to `'ready'` exactly once and no path sets it back, and the tick starts at 0 (`app-state.service.ts:380`), bumped only by `switchWorkspace`, which runs after the shell mounts. It is a latent trap for any future change that recreates the shell (an `isLoading` flip, an error-retry remount). Fix: keep an instance field with the last-seen tick (or skip the effect's first run) and remount only on an observed change.
2. **MINOR** — `libs/frontend/chat/src/lib/components/templates/electron-shell.config-gate.spec.ts:91-93`. The `configurationHost()` helper selects the host by the bare selector `[tabindex="-1"]`. Any future element with `tabindex="-1"` earlier in DOM order inside the shell chrome (a dropdown panel, a notification popover) silently becomes the element the focus tests focus and assert on, so case 10 could pass or fail against the wrong node. No other `tabindex="-1"` exists today in the menu, dropdown, theme toggle or notification center (verified by grep), so the tests are currently honest. Fix: give the wrapper a `data-test` (for example `data-test="config-surface-host"`) and select by it.
3. **MINOR** — `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:189`. The back button's click goes through `setCurrentView`, which is gated by `canSwitchViews()` (`app-state.service.ts:902-906`), i.e. `!isLoading && isConnected` (`:639-641`). If the extension disconnects while a pre-workspace configuration surface is open, the click is a silent no-op: no navigation, no disabled state, no feedback. The user stays on the surface until reconnect or a workspace opens. This is the same silent path the menu itself has (`global-config-menu.component.ts:158`), accepted as the Batch 3 outcome, and the "also with no auth" manual check is carried to QA. Fix (optional): bind `[disabled]` or a `title` hint to `canSwitchViews()`.

## Risks confirmed

- **RB** (gate flips): pinned by cases 6 and 7; both flip directions are exercised without throwing.
- **RC** (in-flight navigation): `pendingSurface()` is read inside `untracked` before the remount (line 331); case 11 pins the skip-and-no-deferral contract.
- **RE** (focus): the microtask condition matches the override-3 wording exactly; both focus tests pin it.
- **RF** (spec honesty): the gate spec keeps the real `RouterOutlet` with `provideRouter([])` and asserts the directive via `By.directive(RouterOutlet)`, not just the tag; the activity spec provides the `SurfaceRouterService` stub the new injection requires, with its three cases unchanged.
- **RJ** (skipped tick after a cancelled navigation): accepted by team-leader decision, recorded in `batches.md:86`, and not worked around — correct per binding rule 1.

## Verdict

The implementation matches the binding contract precisely: the three-branch gate, the remount effect (all five sub-rules), the tab row, the menu mount, the back button, and the forbidden-edit list all check out against the code, and all eleven required cases are pinned by tests that assert the real outlets and selectors rather than schema-stubbed stand-ins. The three findings are minor and none blocks acceptance: one latent robustness trap, one test-fragility note, one consistent-with-accepted-design silent edge.

- Recommendation: **ACCEPT**
- Confidence: HIGH
- Top risk: a future change that recreates `ElectronShellComponent` after a tick bump would trigger a spurious remount, because the effect cannot tell creation from change (finding 1).