# Onboarding live Electron e2e report

## Commands run

1. `node scripts/verify.mjs --exec --task onboarding-live-e2e -- npx nx run ptah-electron-e2e:e2e --output-style=static -- src/specs/onboarding/onboarding.spec.ts src/specs/harness/new-project.spec.ts src/specs/harness/new-project-dotnet.spec.ts src/specs/harness/new-project-question-routing.spec.ts src/specs/config-menu/config-menu-welcome-gate.spec.ts src/specs/config-menu/config-menu-keyboard.spec.ts src/specs/config-menu/config-menu-remount.spec.ts` — exit 1; 18 passed, 3 failed (7.4m Playwright; 12m11s total including build).
2. `node scripts/verify.mjs --exec --task onboarding-live-e2e -- npx nx run ptah-electron-e2e:e2e --output-style=static -- src/specs/onboarding/zz-live-restore.spec.ts` — exit 1; 1 failed (20.2s).
3. Same command, one rerun after adding a poll for persistence — exit 1; 1 failed (49.7s).

All commands used the machine-wide verify lock, sequentially. Logs were captured at `/tmp/onboarding-live-e2e.log`, `/tmp/onboarding-restore-e2e.log`, and `/tmp/onboarding-restore-rerun.log`.

## Results

| Spec                                                     | Test                                                                                                                                                                      | Result | Duration |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- |
| `src/specs/config-menu/config-menu-keyboard.spec.ts`     | Global configuration actions — keyboard operation › Enter on the focused Setup tab opens it and marks it current                                                          | pass   | 19.4s    |
| `src/specs/config-menu/config-menu-keyboard.spec.ts`     | Global configuration actions — keyboard operation › Space on the focused Settings icon button opens Settings and marks it current                                         | pass   | 11.4s    |
| `src/specs/config-menu/config-menu-remount.spec.ts`      | Global configuration menu — remount on workspace switch › Thoth: the surface stays and its component is re-created on a workspace switch                                  | pass   | 18.4s    |
| `src/specs/config-menu/config-menu-remount.spec.ts`      | Global configuration menu — remount on workspace switch › Setup: the surface stays and its component is re-created on a workspace switch                                  | pass   | 22.1s    |
| `src/specs/config-menu/config-menu-remount.spec.ts`      | Global configuration menu — remount on workspace switch › Marketplace: the surface stays and its component is re-created on a workspace switch                            | pass   | 22.2s    |
| `src/specs/config-menu/config-menu-remount.spec.ts`      | Global configuration menu — remount on workspace switch › Settings: the surface stays and its component is re-created on a workspace switch                               | pass   | 22.8s    |
| `src/specs/config-menu/config-menu-remount.spec.ts`      | Global configuration menu — remount on workspace switch › switching workspace while on a code-workspace surface (Chat) does not bump the remount tick or touch the router | pass   | 12.6s    |
| `src/specs/config-menu/config-menu-welcome-gate.spec.ts` | Global configuration menu — welcome gate › no folder open: Settings via the menu, then Back to welcome returns to the welcome screen                                      | pass   | 10.7s    |
| `src/specs/config-menu/config-menu-welcome-gate.spec.ts` | Global configuration menu — welcome gate › no folder open, no auth: Settings via the menu, then Back to welcome still returns to welcome                                  | pass   | 20.3s    |
| `src/specs/config-menu/config-menu-welcome-gate.spec.ts` | Global configuration menu — welcome gate › closing the last workspace while on Settings keeps Settings open and shows Back to welcome                                     | pass   | 15.5s    |
| `src/specs/config-menu/config-menu-welcome-gate.spec.ts` | Global configuration menu — welcome gate › opening the first folder while a configuration surface is open moves the surface into the 3-panel area                         | pass   | 24.0s    |
| `src/specs/harness/new-project-dotnet.spec.ts`           | New project intake offers a .NET platform and matching stack                                                                                                              | pass   | 24.2s    |
| `src/specs/harness/new-project-question-routing.spec.ts` | a workflow question opens in the proposal Details log and can be answered                                                                                                 | pass   | 18.3s    |
| `src/specs/harness/new-project.spec.ts`                  | New project onboarding › Home opens the intake and requires a brief                                                                                                       | pass   | 14.9s    |
| `src/specs/harness/new-project.spec.ts`                  | New project onboarding › submits the new intake and opens the proposal workspace                                                                                          | pass   | 18.8s    |
| `src/specs/harness/new-project.spec.ts`                  | New project onboarding › submits the .NET platform and stack in the wire payload                                                                                          | pass   | 15.1s    |
| `src/specs/harness/new-project.spec.ts`                  | New project onboarding › requires free text when Other stack is chosen                                                                                                    | pass   | 25.9s    |
| `src/specs/harness/new-project.spec.ts`                  | New project onboarding › reload restores the proposal route and its tab                                                                                                   | fail   | 15.6s    |
| `src/specs/harness/new-project.spec.ts`                  | New project onboarding › continues the same draft after a direct view switch                                                                                              | fail   | 25.6s    |
| `src/specs/harness/new-project.spec.ts`                  | New project onboarding › foreign-session question does not take the proposal panel (TASK_2026_317)                                                                        | pass   | 21.5s    |
| `src/specs/onboarding/onboarding.spec.ts`                | first run reaches Ready, can be skipped, and the menu reopens Home                                                                                                        | fail   | 51.1s    |
| `src/specs/onboarding/zz-live-restore.spec.ts`           | restores a new-project onboarding tab after an Electron restart (initial)                                                                                                 | fail   | 20.2s    |
| `src/specs/onboarding/zz-live-restore.spec.ts`           | same test (single rerun)                                                                                                                                                  | fail   | 49.7s    |

## Failures

- **Spec defect:** `apps/ptah-electron-e2e/src/specs/harness/new-project.spec.ts:123` asserts `new URL(page.url()).pathname === '/onboarding/new-project/workspace'`. Electron's window URL is `file://.../renderer/index.html`; the failure snapshot shows the New project proposal page rendered. Evidence: `dist/apps/ptah-electron-e2e/test-results/harness-new-project-New-pr-9fa40--proposal-route-and-its-tab/trace.zip` and `test-failed-1.png`.
- **Spec defect:** `apps/ptah-electron-e2e/src/specs/harness/new-project.spec.ts:150` asserts `new URL(page.url()).searchParams.get('tab')` is truthy. The Electron window URL has no Angular query string; the failure occurs before the view-switch assertion. Evidence: `dist/apps/ptah-electron-e2e/test-results/harness-new-project-New-pr-69e73--after-a-direct-view-switch/trace.zip` and `test-failed-1.png`.
- **Spec defect:** `apps/ptah-electron-e2e/src/specs/onboarding/onboarding.spec.ts:25` asserts `page` URL matches `/onboarding/ready`; the window URL remains `file://.../renderer/index.html`. The failure snapshot shows “Check Claude Code” (the Ready step). Evidence: `dist/apps/ptah-electron-e2e/test-results/onboarding-onboarding-firs-0a804-d-and-the-menu-reopens-Home/trace.zip` and `test-failed-1.png`.
- **Spec defect in throwaway probe:** `apps/ptah-electron-e2e/src/specs/onboarding/zz-live-restore.spec.ts:35` expects a saved `/onboarding/new-project/workspace?tab=` route. `rpcBridge.getState()` stayed at `ptahRoute.route === '/chat'` for 30 seconds. `libs/frontend/core/src/lib/routing/surface-route-persistence.ts:75-81` deliberately skips onboarding routes unless they have a valid generation binding; this new-project route does not qualify. Evidence: `dist/apps/ptah-electron-e2e/test-results/onboarding-zz-live-restore-9e842-b-after-an-Electron-restart/trace.zip` and `test-failed-1.png`. The test stopped before closing or relaunching the app.

## Restart-restore scenario

The fixture can relaunch with persisted state: `launchPtah({ userDataDir, env: { PTAH_DB_PATH } })` accepts both values. The throwaway spec opens a workspace through the existing fixture and reaches the New project proposal page. It does **not** reach Generate agents or Project guidance, and it does **not** exercise a restart. The chosen new-project route is excluded from route persistence, so its precondition fails. No cold-start conclusion can be drawn for the recent `workspaceResolved` fix.

## Not run

- A valid Generate agents or Project guidance `?tab=` cold-restart flow. Those pages require a bound generation tab and workflow state; the throwaway probe did not establish them.
- Optional e2e lint/typecheck. The coordinator's concurrent verify command included the e2e project; no separate check was launched here.

## Decisions

- No matching CLI skill discovery mechanism was available for this e2e-only task; native file reads and the prescribed verify wrapper were used. Ptah workspace analysis was available and used.
- Retained `apps/ptah-electron-e2e/src/specs/onboarding/zz-live-restore.spec.ts` for coordinator review, as requested.
- Did not edit product code or existing specs, rerun the original three failures, or make git changes.
- No product defect was established by these runs. The original three failures are stale URL assertions; the new probe has an invalid persistence precondition.

## Round 2

### Commands run

1. `node scripts/verify.mjs --exec --task onboarding-live-e2e -- npx nx run ptah-electron-e2e:e2e --output-style=static -- src/specs/onboarding/onboarding.spec.ts src/specs/harness/new-project.spec.ts` — exit 1, 7 passed and 1 failed; log: `/tmp/onboarding-round2-e2e.log`.

### Results

| Spec                  | Test                                                                      | Result | Duration |
| --------------------- | ------------------------------------------------------------------------- | ------ | -------- |
| `new-project.spec.ts` | Home opens the intake and requires a brief                                | pass   | 15.1s    |
| `new-project.spec.ts` | submits the new intake and opens the proposal workspace                   | pass   | 13.5s    |
| `new-project.spec.ts` | submits the .NET platform and stack in the wire payload                   | pass   | 11.6s    |
| `new-project.spec.ts` | requires free text when Other stack is chosen                             | pass   | 13.5s    |
| `new-project.spec.ts` | reload offers to resume the proposal from Home                            | pass   | 24.7s    |
| `new-project.spec.ts` | continues the same draft after a direct view switch                       | pass   | 18.7s    |
| `new-project.spec.ts` | foreign-session question does not take the proposal panel (TASK_2026_317) | pass   | 21.8s    |
| `onboarding.spec.ts`  | first run reaches Ready, can be skipped, and the menu reopens Home        | fail   | 47.6s    |

### Failures

- **Spec defect:** `apps/ptah-electron-e2e/src/specs/onboarding/onboarding.spec.ts:35` asserts that `onboarding-shell` is visible after `page.reload()`. The route is Home (`/onboarding`), which `SurfaceRoutePersistence` excludes at `libs/frontend/core/src/lib/routing/surface-route-persistence.ts:66-81`; after reload the screenshot shows Chat selected. Evidence: `dist/apps/ptah-electron-e2e/test-results/onboarding-onboarding-firs-0a804-d-and-the-menu-reopens-Home/trace.zip` and `test-failed-1.png`. The rerun reproduced the failure.

### Restart probe outcome

The throwaway spec uses the UI's **Only generate agents** entry, which creates a bound generation tab in `libs/frontend/onboarding/src/lib/analyze/choose-agents.page.ts:150-177`. A mocked running run sends it to the persisted Generate agents route. The spec owns a stable user data directory and database across both launches because `launchPtah()` removes fixture-owned profiles on exit (`apps/ptah-electron-e2e/src/support/electron-launcher.ts:124-141`). The runs and outcomes are recorded below.

The single allowed rerun of `onboarding.spec.ts` used the same locked command with only that spec (`/tmp/onboarding-round2-rerun.log`): exit 1, same assertion at line 35, 49.3s. This confirms the first-run failure is stable. Its trace and screenshot use the evidence paths above.

The first revised probe run used the locked e2e command with `src/specs/onboarding/zz-live-restore.spec.ts` (`/tmp/onboarding-round2-restore.log`): exit 1, 55.5s. **Spec defect** at `zz-live-restore.spec.ts:61`: it expected `?tab=` to be the first query parameter. The live saved state was `/onboarding/analyze/generate?source=catalog&tab=e0479716-d5bf-46ea-bc5d-b8b8f85fa496&run=e2e-run`, proving the UI established a persisted route. The probe stopped before relaunch. Evidence: `dist/apps/ptah-electron-e2e/test-results/onboarding-zz-live-restore-a47ca-b-after-an-Electron-restart/trace.zip` and `test-failed-1.png`. The query-order assertion was corrected for the single rerun below.

The single allowed probe rerun used the same locked command (`/tmp/onboarding-round2-restore-rerun.log`): exit 1, 1 failed in 1.0m. It reached a real close and relaunch with the same `userDataDir` and `PTAH_DB_PATH`. The saved route before close was `/onboarding/analyze/generate?source=catalog&tab=76fde3c4-c4a7-4a1f-877f-759f8b53eaba&run=e2e-run`; after relaunch, `rpcBridge.getState()` returned `/chat/76fde3c4-c4a7-4a1f-877f-759f8b53eaba`. The assertion at `apps/ptah-electron-e2e/src/specs/onboarding/zz-live-restore.spec.ts:76` failed after 30s. Evidence: `dist/apps/ptah-electron-e2e/test-results/onboarding-zz-live-restore-a47ca-b-after-an-Electron-restart/trace.zip`, `test-failed-1.png`, and `test-failed-2.png`.

**Classification: spec setup defect / unverified product behavior.** The Electron log says `No persisted workspaces and no CLI arg — starting without workspace`. `UiDriver.goto()` only injects a `workspaceChanged` event (`apps/ptah-electron-e2e/src/support/ui-driver.ts:552-553`), while the probe mocks `workspace:getInfo` (`zz-live-restore.spec.ts:10-13`). This creates a renderer workspace for the first launch but does not persist a real host workspace for cold startup. The restarted app reaches the renderer before the probe installs RPC mocks (`zz-live-restore.spec.ts:69-75`), then `driver.prepare()` reloads it. That sequence does not test the requested real workspace reopen. The route's `tab` is present in the saved state, so generation route persistence itself was observed. The exact point where Chat overwrote it was not isolated. No product defect can be concluded from this probe.

| Spec                      | Test                                                                        | Result                                                     | Duration |
| ------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- | -------- |
| `zz-live-restore.spec.ts` | restores a generation onboarding tab after an Electron restart, initial run | fail: spec query-order assertion, before restart           | 55.5s    |
| `zz-live-restore.spec.ts` | restores a generation onboarding tab after an Electron restart, rerun       | fail: mocked workspace not persisted across actual restart | 1.0m     |

### Not run and decisions

- A valid cold restart with a **real persisted host workspace** remains unverified. The two allowed probe runs were exhausted. To make the probe valid, a follow-up must open a real workspace in the Electron host before saving the route and arrange RPC mocks before the restarted renderer's initial navigation, then run the resulting spec under the verify lock.
- No source code or existing spec was edited. The throwaway `zz-live-restore.spec.ts` is retained for coordinator review; it currently fails by design in this fake-workspace setup.
- No additional checks were run. The two original updated spec files were covered by the locked e2e invocation; the failing onboarding spec was rerun once and the throwaway spec was rerun once.
