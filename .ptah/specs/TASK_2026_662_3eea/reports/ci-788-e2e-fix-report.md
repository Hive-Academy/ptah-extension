# PR #788 e2e failure review

Logs: `C:\Users\abdal\AppData\Local\Temp\j118820266111.log` (Electron) and `C:\Users\abdal\AppData\Local\Temp\j118820267522.log` (Webview). Line numbers below refer to these logs. No checks were run, as instructed.

| Failed test | Root cause and evidence | Caused by branch? | Change or reason for none |
| --- | --- | --- | --- |
| Electron: pause switch writes committed Skills setting | Electron log 2940: `locator.uncheck` rejects the deliberate immediate checkbox reset in `skills-pause-switch.component.ts:139`; the committed value is applied after the RPC readback (`skill-synthesis-state.service.ts:127-153`). Spec: `apps/ptah-electron-e2e/src/specs/thoth/skills.spec.ts:38`. | Yes, new Library spec drives retained switch with the wrong Playwright action. | Use `click()` and retain checked state, Paused label, and exact `settings:set` payload assertions. |
| Electron: telemetry switch writes independent setting | Electron log 2980: same `locator.uncheck` behavior; `skill-synthesis-tab.component.ts:146-150` restores the checkbox synchronously until the state write completes. Spec: `skills.spec.ts:50`. | Yes, new spec action. | Use `click()` and retain state and exact key/value assertions. |
| Electron: Enhancement model picker shows saved provider/model | Electron log 3020-3029: provider select never mounts because the spec clicks the row before its enhancement settings read finishes. `provider-consumer-assignments.component.ts:137-180,695-706` renders a loading row and refuses editing until loaded. Spec: `skills.spec.ts:87-93`. | Yes, this branch moved picker coverage to the retained Enhancement row (decision O34). | Wait for `consumer-summary-enhancement` and then the editor before checking provider/model. |
| Webview: create button triggers sessions:create RPC with user input | Webview log 1040-1065: a `ptah-native-popover` backdrop intercepts the later “Previous sessions” click (`session-create.e2e.spec.ts:56`); `closeOpenPopover` at line 19 already attempts closure. | No evidence: `git diff origin/main...HEAD` has no change in this spec, canvas, native popover, or native dropdown. | None. The failure is in subsequent navigation, not the `sessions:create` assertion; needs separate reproduction or trace to identify the remaining popover. |
| Webview: reachability (vscode), every present/restored capability is reachable | Webview log 1146-1153: GV28-3 cannot find “Used by 2.” The branch changed `providers-settings.component.ts:828-849` to require `enhancement` loaded for `usage().complete`, but `settings.fixtures.ts:244-257` returned a CLI-agent array for each new enhancement key. | Yes. | Add typed fixture values for the three retained `skills.enhancement.*` keys. Enhancement follows main; OpenAI Codex still has Memory curator and Codex CLI, so GV28-3 remains in the preserve list. |
| Webview: reachability (electron), every present/restored capability is reachable | Webview log 1268-1275: same missing “Used by 2”; same `settings.fixtures.ts:244-257` source and `settings-reachability.table.ts:1641-1662` assertion. | Yes. | Same shared fixture change; no capability removed. |
| Webview visual: orchestration order strip, fold, roles and order popover (vscode, anubis) | Webview log 1390-1409: expected 7 rows, received 3. `provider-consumer-rows.ts:22-37` now defines Memory curator, Enhancement and Decision. `settings-visual.e2e.spec.ts:719,732,739-742` still expects 7 and opens the removed Judge picker. | Yes. | Assert three rows and inspect the retained Enhancement picker. |
| Webview visual: orchestration order strip, fold, roles and order popover (vscode, anubis-light) | Webview log 1470-1476: expected 7, received 3; same stale `settings-visual.e2e.spec.ts:719` assertion. | Yes. | Same shared visual spec change. |
| Webview visual: orchestration order strip, fold, roles and order popover (electron, anubis) | Webview log 1550-1556: expected 7, received 3; same stale `settings-visual.e2e.spec.ts:719` assertion. | Yes. | Same shared visual spec change. |
| Webview visual: orchestration order strip, fold, roles and order popover (electron, anubis-light) | Webview log 1630-1636: expected 7, received 3; same stale `settings-visual.e2e.spec.ts:719` assertion. | Yes. | Same shared visual spec change. |
| Webview flaky: blank session name produces client-side validation error | Webview log 1710-1735, summary 1771-1772: retry passed after a native popover backdrop intercepted “Previous sessions” at `session-create.e2e.spec.ts:91`. | No evidence: same unchanged session and popover path as the create case. | None; the reported failure is after the blank-name check and is intermittent. |

## Decisions

- Decision O27 in `decisions.md:40` explicitly preserves the three retained Background roles and removes the Judge lane popover (RUX-12). The four visual variants now check the approved three-row set and use Enhancement for popover coverage.
- Decision O34 in `decisions.md:47` moves Electron provider-picker coverage to Enhancement. Its provider and model are retained settings, so the test still checks the saved values after waiting for the row to load.
- The reachability entry GV28-3 remains: OpenAI Codex still serves Memory curator and Codex CLI. The missing count was a fixture read failure, not an approved removal.
- The pause and telemetry keys are retained Library controls (`skillSynthesis.enabled`, `skills.telemetry.enabled`); the test action now accommodates the controls' committed-value readback.

## Proposed Removals

None.
