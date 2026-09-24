# Batch 4 Report - TASK_2026_540_0940

## Files changed

- MODIFY: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\chat\src\lib\components\templates\electron-shell.component.ts`
- MODIFY: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\chat\src\lib\components\templates\electron-shell.activity-placement.spec.ts`
- CREATE: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\chat\src\lib\components\templates\electron-shell.config-gate.spec.ts`
- CREATE: `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\.ptah\specs\TASK_2026_540_0940\batch-4-report.md`

Only these four files were authored. No git commands were run.

## Task 4.1

Line references are in `electron-shell.component.ts`.

- Tab row, lines 121-168: preserves the workspace gate, `electron-tabs`, tablist/tab roles and aria-selected; now Chat, Tasks, Tribunal, Analytics in order. The Apps insertion comment is at line 134. Labels and titles match; Chat uses LayoutGrid and Analytics uses BarChart3.
- Deletions: removed Thoth, Setup, Marketplace and Settings tabs from the row; removed their four handlers (remaining navigation handlers at lines 375-390 retain their bodies). Removed Settings, Wrench, Store, RadioTower, Zap, Bot, GitBranch and Sparkles imports/fields (remaining icons at lines 30-38 and 367-372). ArrowLeft supplies the back icon.
- Menu: direct sibling import at line 48, standalone imports at line 69, mount at line 198 inside the existing no-drag global-actions div, immediately before the theme toggle at line 199.
- Three-branch gate, lines 204-212: welcome when no workspace and no configuration surface; a real bare RouterOutlet when configuration is open without a workspace; otherwise the existing three-panel area. RouterOutlet import at line 29 and standalone registration at line 68.
- Center wrapper, lines 239-245: adds `#configurationSurfaceHost`, `tabindex="-1"` and `outline-none`; the app-shell remains un-keyed. The typed ElementRef viewChild signal is at lines 303-305.
- Back button, lines 180-197: appears only for pre-workspace configuration, calls `appState.setCurrentView('chat')`, and carries the exact type, aria-label and data-test contract.
- Remount effect, lines 327-343: reads the tick, ignores zero, skips pending navigation inside untracked, records focus, remounts once, and conditionally focuses the wrapper in a microtask. SurfaceRouterService injection is at line 302. The existing dock-loading effect remains alongside it.

## Task 4.2

`electron-shell.activity-placement.spec.ts`: imports signal and SurfaceRouterService; `hasWorkspaceFolders` is writable at line 75; the configuration-surface and tick signals are at lines 90-91; the remount/pending provider is at lines 121-124. The three existing test cases and assertions are unchanged (lines 141, 146, 153).

## Task 4.3

`electron-shell.config-gate.spec.ts` uses signal-backed state/layout stubs, a mocked remount service, `provideRouter([])`, the real RouterOutlet and real GlobalConfigMenuComponent. Other children remain shallow through CUSTOM_ELEMENTS_SCHEMA, following the existing activity test. Outlet assertions also check the actual RouterOutlet directive. Menu lookup starts only from its public data-test trigger hook. Twelve tests cover the eleven requested cases:

1. `shows only welcome content without a workspace or configuration surface` (line 155).
2. `shows one real bare outlet and a back button for pre-workspace settings` (line 162).
3. `shows the workspace app shell and Chat, Tasks, Tribunal, Analytics tabs in order` (line 169).
4. `keeps the configuration menu and back button in global no-drag actions without a workspace` (line 200).
5. `returns to welcome after Back to welcome requests chat and configuration settles to null` (line 221).
6. `opens the first workspace with a tick bump without retaining the bare outlet or throwing` (line 233).
7. `restores the bare outlet and back button when the last workspace closes on settings` (line 244).
8. `shows welcome when Setup hub settles on a non-configuration surface without a workspace` (line 252).
9. `ignores tick zero and remounts exactly once for a tick bump without replacing the app shell` (line 264).
10. `focuses the configuration host after remount when focus was on the body` (line 276); `preserves focus on a live navbar button after remount` (line 288).
11. `skips a pending navigation tick without deferral and remounts once on the next settled tick` (line 298).

Case 9 additionally checks effect timing and stable app-shell DOM identity. Case 11 uses a signal behind the pendingSurface mock to prove clearing pending state does not schedule a deferred remount.

## Binding rules

1. The tick effect reads pendingSurface inside untracked and returns for non-null; it skips without deferral (case 11).
2. The effect is the sole shell caller of remountActiveSurface; no synchronous handler or workspace-switch call was added.
3. No catch boundary was added around remountActiveSurface; construction/lifecycle errors remain visible.
4. No outlet activate/deactivate output bindings were added.
5. GlobalConfigMenuComponent is imported directly from `../molecules/global-config-menu.component` and registered in standalone imports; no barrel changed.
6. The menu is inside the existing global-actions no-drag div, immediately left of the theme toggle.
7. No menu switching gate, Thoth-hint behavior, or menu focus-return behavior was duplicated; the existing menu files were untouched.
8. Menu selection in the new spec uses `data-test="config-menu-trigger"`; its host is resolved from that trigger rather than queried by tag or text.

No keyed block, class.hidden binding, or retain:true route data was introduced. Standalone/OnPush and the existing Tailwind/daisyui styling are retained. The four remaining navigation method bodies are unchanged.

## Risks and edge cases

- RB: case 6 flips the bare-outlet branch to the workspace branch with a tick bump in the same pass, keeps configuration state, and asserts no throw/no leftover bare outlet. Child components are shallow here; actual route reactivation remains the previously implemented core service's responsibility.
- RC: pending navigation causes the tick to be skipped. Once pending clears, only a new tick can remount (case 11).
- RE: body focus moves to the tabindex=-1 host, while a live navbar control retains focus (two case-10 tests). The effect also implements the prescribed disconnected/previously-inside-host checks.
- RF: activity tests provide SurfaceRouterService; gate tests retain a real RouterOutlet and provideRouter([]), avoiding a schema-only outlet false positive.
- RJ: accepted plan risk remains: a skipped navigation that later fails/cancels can leave the prior configuration instance until navigation occurs. No deferral was added.
- Verification limitation: the harness serves an existing app build; it does not build the changed source. Its upward search found `D:\projects\ptah-extension\dist\apps\ptah-extension-webview\browser`, with `main.js` last modified 2026-09-23 16:16:49, before this shell edit. Consequently the passing browser scenarios are a regression baseline, not proof of this batch's freshly bundled shell. No extra app build was run under the instruction to verify only the named projects.
- Native Electron/manual checks are carried to orchestrator/QA: no-folder configuration/back behavior including no auth; first/last workspace transitions; fresh data on all four configuration surfaces after workspace switches (RD); macOS trigger/items/backdrop and titlebar drag behavior (RG).

## Verification

`npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat` ? **PASS**, exit 0, all three targets executed (0/3 cache hits). Output tail:

```text
NX   Running targets typecheck, test, lint for project @ptah-extension/chat:

- @ptah-extension/chat


√  nx run @ptah-extension/chat:typecheck
√  nx run @ptah-extension/chat:test
√  nx run @ptah-extension/chat:lint



 NX   Successfully ran targets typecheck, test, lint for project @ptah-extension/chat


Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

View logs and investigate cache misses at https://nx.app/runs/nJzRZOtmJt

  Run duration:      1m 11s
  Cache:             0/3 hit (0%)
  Critical path:     50.5s (1 task)
  Recoverable time:  20.0s (28% of the run)

  Recommendation: Increase parallelism to recover up to 20.0s → https://nx.dev/docs/concepts/ci-concepts/parallelization-distribution?utm_source=nx-cli&utm_medium=cli&utm_campaign=performance-report&utm_content=parallelization.
```

`npx nx run @ptah-extension/webview-e2e-harness:e2e` ? **PASS**, exit 0, 71 passed, including boot-progress and activity-ticker. Existing-build limitation is documented above. Output tail plus required-scenario lines:

```text
ok 52 [chromium] › src\lib\scenarios\sessions\session-create.e2e.spec.ts:89:3 › webview > sessions > create › duplicate name surfaces server-side error toast (1.6s)
  ok 54 [chromium] › src\lib\scenarios\sessions\session-delete.e2e.spec.ts:28:3 › webview > sessions > delete › confirming dialog emits sessions:delete RPC with session id (1.3s)
  ok 39 [chromium] › src\lib\scenarios\chat\prompt-input.e2e.spec.ts:109:3 › chat prompt input › Shift+Enter inserts a newline and does NOT submit (3.7s)
  ok 38 [chromium] › src\lib\scenarios\chat\response-render.e2e.spec.ts:93:3 › chat response render › renders headings (h1 / h2) (3.7s)
  ok 56 [chromium] › src\lib\scenarios\sessions\session-delete.e2e.spec.ts:70:3 › webview > sessions > delete › deletion sync: server-confirmed delete removes session from list (924ms)
  ok 44 [chromium] › src\lib\scenarios\chat\response-render.e2e.spec.ts:103:3 › chat response render › renders fenced code blocks with a lang class (4.0s)
  ok 57 [chromium] › src\lib\scenarios\sessions\session-delete.e2e.spec.ts:87:3 › webview > sessions > delete › undo affordance (if present) restores via sessions:restore RPC (1.2s)
  ok 58 [chromium] › src\lib\scenarios\sessions\session-list.e2e.spec.ts:14:3 › webview > sessions > list › webview boots and announces ready (1.1s)
  ok 59 [chromium] › src\lib\scenarios\sessions\session-list.e2e.spec.ts:22:3 › webview > sessions > list › renders session list when extension seeds sessions (1.2s)
  ok 60 [chromium] › src\lib\scenarios\sessions\session-list.e2e.spec.ts:43:3 › webview > sessions > list › switching session emits sessions:switch RPC with target id (1.1s)
  ok 61 [chromium] › src\lib\scenarios\sessions\session-list.e2e.spec.ts:57:3 › webview > sessions > list › empty session list renders empty-state without error (1.0s)
  ok 62 [chromium] › src\lib\scenarios\settings\preferences.e2e.spec.ts:12:3 › webview > settings > preferences › theme toggle emits preferences:update with new theme (949ms)
  ok 55 [chromium] › src\lib\scenarios\sessions\session-delete.e2e.spec.ts:50:3 › webview > sessions > delete › cancelling dialog does NOT emit a delete RPC (2.2s)
  ok 63 [chromium] › src\lib\scenarios\settings\preferences.e2e.spec.ts:37:3 › webview > settings > preferences › changing keymap preference emits preferences:update (896ms)
  ok 65 [chromium] › src\lib\scenarios\settings\preferences.e2e.spec.ts:68:3 › webview > settings > preferences › preferences persist across page reloads (state survives reload) (780ms)
  ok 64 [chromium] › src\lib\scenarios\settings\preferences.e2e.spec.ts:53:3 › webview > settings > preferences › inbound preferences:hydrate seeds UI without errors (829ms)
  ok 67 [chromium] › src\lib\scenarios\settings\provider-settings.e2e.spec.ts:12:3 › webview > settings > provider › settings page loads after navigation event (756ms)
  ok 66 [chromium] › src\lib\scenarios\settings\preferences.e2e.spec.ts:82:3 › webview > settings > preferences › reset-to-defaults emits preferences:reset RPC (812ms)
  ok 69 [chromium] › src\lib\scenarios\settings\provider-settings.e2e.spec.ts:47:3 › webview > settings > provider › save button persists provider choice to extension host (880ms)
  ok 68 [chromium] › src\lib\scenarios\settings\provider-settings.e2e.spec.ts:23:3 › webview > settings > provider › switching provider emits settings:update RPC with new provider (1.2s)
  ok 70 [chromium] › src\lib\scenarios\settings\provider-settings.e2e.spec.ts:63:3 › webview > settings > provider › blank required field blocks save (no settings:update fired) (1.2s)
  ok 71 [chromium] › src\lib\scenarios\settings\provider-settings.e2e.spec.ts:91:3 › webview > settings > provider › server validation error renders inline without crashing SPA (1.3s)

  71 passed (36.5s)



 NX   Successfully ran target e2e for project @ptah-extension/webview-e2e-harness


View logs and investigate cache misses at https://nx.app/runs/5xQl91B3bz

  Run duration:      45.4s
  Cache:             0/1 hit (0%)
  Critical path:     45.4s (1 task)
  Recoverable time:  <1ms

  Recommendations:
    - Speed up or split the longest tasks on the critical path:
        @ptah-extension/webview-e2e-harness:e2e    45.4s


  ok  3 [chromium] › src\lib\scenarios\thoth\activity-ticker.e2e.spec.ts:117:3 › webview > thoth > activity ticker › 
an activity:event push never disturbs the shell chrome (5.4s)
  ok  8 [chromium] › src\lib\scenarios\chat\error-recovery.e2e.spec.ts:110:3 › chat error & recovery › Retry button 
posts chat:retry referencing the failed request id (3.9s)
  ok  5 [chromium] › src\lib\scenarios\boot\boot-progress.e2e.spec.ts:130:3 › webview > boot > staged boot screen › a 
warming/database push shows the boot headline, then a harness push hands over to the shell (7.0s)
  ok 46 [chromium] › src\lib\scenarios\monitor\agent-status.e2e.spec.ts:43:3 › webview > monitor > status › running → 
failed transition surfaces error metadata (2.3s)
  71 passed (36.5s)
```

Source check: exactly one shell remountActiveSurface call; no removed handlers/icon fields, keyed @for, class.hidden, retain:true, or outlet activation/deactivation bindings. No failing command needed a rerun.

## Open issues

- Fresh-bundle browser verification remains: build this worktree's webview app and rerun the harness before treating the browser pass as validation of these shell edits.
- Native Electron/manual QA listed above remains outside this implementation lane. No implementation/typecheck/unit-test/lint failure remains.

## Revision 1

Scope: addressed the two internal MODERATE findings and Glm MINOR findings 1-2. Only `electron-shell.component.ts`, `electron-shell.config-gate.spec.ts`, and this report were edited in this revision. The activity-placement spec and the other lane's `apps/ptah-electron-e2e` changes were untouched. No git commands were run.

1. **Internal MODERATE 1 ? focus after the first-workspace render.** In `electron-shell.component.ts:306`, inject the component's Injector. At lines 339-350, retain the pre-remount `active` and `wasInside` capture, then use `afterNextRender` with that injector and re-read the viewChild at line 345. The same three focus conditions apply to the rendered host. This replaces queueMicrotask so focus uses Angular's completed render rather than a host reference captured before the branch flip. The injector also scopes callback cleanup to component destruction. Added `focuses the rendered configuration host when the first workspace opens from body focus` at `electron-shell.config-gate.spec.ts:272`. The existing body/navbar focus tests (lines 331 and 343) now await `fixture.whenStable()` to exercise the real render callback.
2. **Internal MODERATE 2 ? real bare-outlet activation.** Added standalone/OnPush `ConfigurationRouteTestComponent` at `electron-shell.config-gate.spec.ts:54-60` and registered a small settings route at lines 134-136. The test at line 176 navigates the real Router to `/settings` with no workspace, asserts successful activation and the actual component instance, and verifies the marker renders in the bare outlet's content wrapper. Angular inserts the routed component beside the outlet inside that wrapper.
3. **Glm MINOR 1 ? no construction-time remount.** `electron-shell.component.ts:331-336` captures the construction tick and records each observed change before checking zero/pending navigation. An unchanged initial non-zero value does not remount; a pending tick is consumed without deferral. The new test at `electron-shell.config-gate.spec.ts:317` creates the shell at tick 3, asserts no remount, then changes to 4 and asserts exactly one. The existing tick-zero and pending-navigation cases still pass.
4. **Glm MINOR 2 ? stable host hook.** Added `data-test="configuration-surface-host"` at `electron-shell.component.ts:243`. The spec helper at `electron-shell.config-gate.spec.ts:94-98` now selects that hook instead of `[tabindex="-1"]`.

**Accepted without change:** Glm MINOR 3, Back to welcome while `canSwitchViews()` is false. No back-button/menu behavior was changed.

**Verification ? PASS.** Ran the requested scoped verification once, with static output formatting to retain the test summary:

`npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat --output-style=static`

Exit 0; all three targets executed (0/3 cache hits); 98 test suites passed; 1,529 tests passed and 2 existing tests skipped. The gate spec now has 15 cases and adds no skips. Lint reported 0 errors and 20 warnings; the four non-null-assertion sites in this spec already existed before this revision and were not expanded. No verification rerun was needed. The harness was not rerun in this revision, as instructed; the earlier implementation report remains a historical record, and the Glm review records the orchestrator's subsequent fresh-bundle 71/71 harness pass.

Verification tail plus filtered Jest summary:

```text
D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts
  1109:1  warning  File has too many lines (1006). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\chat\src\lib\components\templates\chat-view.keepalive.spec.ts
  204:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  216:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  217:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  225:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\chat\src\lib\components\templates\electron-shell.config-gate.spec.ts
   95:12  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  229:21  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  251:5   warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
  345:20  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts
   995:1   warning  File has too many lines (977). Maximum allowed is 700  max-lines
  1356:43  warning  Unexpected empty async method 'createNewSession'       @typescript-eslint/no-empty-function

D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\chat\src\lib\settings\providers\provider-setup-wizard.component.ts
  808:1  warning  File has too many lines (1994). Maximum allowed is 700  max-lines

✖ 20 problems (0 errors, 20 warnings)

✖ 20 problems (0 errors, 20 warnings)




 NX   Successfully ran targets typecheck, test, lint for project @ptah-extension/chat


View logs and investigate cache misses at https://nx.app/runs/YupFMe5chL

  Run duration:      1m 3s
  Cache:             0/3 hit (0%)
  Critical path:     42.6s (1 task)
  Recoverable time:  20.3s (32% of the run)

  Recommendation: Increase parallelism to recover up to 20.3s → https://nx.dev/docs/concepts/ci-concepts/parallelization-distribution?utm_source=nx-cli&utm_medium=cli&utm_campaign=performance-report&utm_content=parallelization.


Test Suites: 98 passed, 98 total
Tests:       2 skipped, 1529 passed, 1531 total
D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\libs\frontend\chat\src\lib\components\tem
plates\electron-shell.config-gate.spec.ts
```

All four requested revisions are complete. No new open implementation issue was found. Previously carried native Electron/manual QA remains with the orchestrator/QA.
