# Lane C: test console hygiene

## Files changed

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts`: return `rpcOk({ cliSessions: [] })` for `session:cli-sessions` in the existing RPC mock.
- `libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts`: return a successful empty CLI-session response for that RPC.
- `libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts`: return a successful empty CLI-session response for that RPC.
- `libs/frontend/chat/src/lib/components/templates/chat-view.session-enter.spec.ts`: return a successful empty CLI-session response for that RPC.
- `libs/frontend/chat/src/lib/components/templates/chat-view.memo.spec.ts`: add a readonly `activeTabSessionId` signal containing `session-1`, matching the stub tab.

No production code, test setup, settings specs, existing test cases, assertions, or console behavior changed. The final component harness returns a successful empty RpcResult for otherwise unhandled methods. The follow-up also completes auth and tab streaming mocks and config:autopilot-get in chat-view.component.spec.ts.

## Cause confirmation

`session-loader.service.ts:1593-1616` awaits `session:cli-sessions`, reads `result?.data?.cliSessions`, and warns/re-enables retry when `result?.success` is false or absent. The test mocks returned undefined. A successful response with an empty cliSessions array accurately represents no saved CLI sessions.

`libs/frontend/chat-state/src/lib/tab-manager.service.ts:516` exposes activeTabSessionId as a computed signal. The memo stub omitted that callable property; its existing tab is bound to session-1.

## NG0101 baseline under zoneless

Before any lane C edit, all four requested suites ran with `setupZonelessTestEnv`. NG0101 was **gone**: 0 occurrences in each of chat-view.component, chat-view.keepalive, agent-orchestration-config.component, and settings.component (0 total). No NG0101 changes were made. This establishes that the reported recursion does not reproduce in this zoneless run; it does not establish a production recursion defect.

Baseline: 3 suites passed, 1 failed; 166 tests passed, 5 failed, 171 total. CLI-session warning messages: 14 (excluding repeated source excerpts).

## Initial verification (superseded by the final component verification below)

One heavy check at a time; only the seven authorized specs were tested. PowerShell equivalents of the requested grep pipeline saved full output to TEMP, then used `Select-String 'cli-sessions|activeTabSessionId|NG0101|Tests:|Test Suites:|?|^FAIL' | Select-Object -First 40`. Failed-suite details were read from the saved log with context 20, not by rerunning.

Baseline command:

```powershell
npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.spec.ts libs/frontend/chat/src/lib/settings/settings.component.spec.ts --coverage=false --maxWorkers=2
```

Final command:

```powershell
npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts libs/frontend/chat/src/lib/components/templates/chat-view.session-enter.spec.ts libs/frontend/chat/src/lib/components/templates/chat-view.memo.spec.ts libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.spec.ts libs/frontend/chat/src/lib/settings/settings.component.spec.ts --coverage=false --maxWorkers=2
```

Filtered final results:

```text
Test Suites: 1 failed, 6 passed, 7 total
Tests:       5 failed, 198 passed, 203 total
Exit code: 1
session:cli-sessions failed warnings: 0
activeTabSessionId is not a function errors: 0
NG0101: 0
```

The remaining failure bullets all concern five chat-view.component branch timeout/late-settlement tests: hung tile load, late failed load, late rejected load, newer notice, and late successful load. They failed in the initial zoneless run before lane C edits, but pass on main with Zone.js according to the orchestrator. They are zoneless migration regressions, not pre-existing main-branch failures.

Logs:

- `C:\Users\abdal\AppData\Local\Temp\ptah-lane-c-before.log`
- `C:\Users\abdal\AppData\Local\Temp\ptah-lane-c-after.log`

Scoped `ptah_get_diagnostics` was called with the five changed absolute spec paths. It reported 255 errors / 0 warnings across the owning project and sibling files; none reported on the changed mock lines. Requested-file diagnostics concern unchanged SubagentRecord mismatches (1657, 1669-1686), protected resolvedResumableSubagents accesses (1827-1850), and private panelResizeService accesses (2302-2401). This is not a clean typecheck.

## Follow-up: zoneless migration mock completion

Changed only chat-view.component.spec.ts further:

- Added `loadAuthStatus: jest.fn(async (): Promise<void> => undefined)`, matching AuthStateService at libs/frontend/core/src/lib/services/auth-state.service.ts:575.
- Added readonly `authMethodLabel` signal<string | null>(null), matching the computed at auth-state.service.ts:417 and consumed by chat-input.component.ts:651.
- Added method-specific `config:autopilot-get` response `rpcOk({ enabled: false, permissionLevel: 'ask' })`. rpc.types.ts:947-949 maps to ConfigAutopilotGetResult in rpc/rpc-config.types.ts:80-89. Optional live session permission is omitted because this request has no session.
- After the permitted rerun exposed another missing mock, added isTabStreaming(tabId: string): boolean backed by the same streamingTabIds signal as the existing property. Source signature/behavior: libs/frontend/chat-state/src/lib/tab-manager.service.ts:3359-3360.

Ran the seven-suite command above exactly once for this follow-up, saved to `C:\Users\abdal\AppData\Local\Temp\ptah-lane-c-followup.log`. Results: 6 suites passed / 1 failed; 198 tests passed / 5 failed / 203 total. All five failures now report `this.tabManager.isTabStreaming is not a function` at chat-input.component.ts:675. Auth and autopilot failure causes no longer occur. The final isTabStreaming mock was added after this run and has NOT been rerun, respecting the explicit single-rerun instruction.

NG0101, session:cli-sessions warnings, and activeTabSessionId errors remain at zero. Existing async timer advancement already flushes branch promises before assertions; no additional flush or assertion changes were made.

Follow-up scoped diagnostics returned unavailable: compiler check exceeded 45 seconds; no clean diagnostic result is claimed. Earlier diagnostic findings above remain relevant, with line numbers shifted by mock additions.

## Final component audit and verification

Completed the follow-up audit of `this.tabManager` / `this._tabManager` references across chat components and services. Checked ChatViewComponent, ChatInputComponent, AgentMonitorPanelComponent, ChatTranscriptComponent, compact-session-card, send-to-messaging, model-selector, effort-selector, previous-sessions-modal, peer-session-send, and ChangeSetStore against the harness. References in unrelated app-shell/session-embed surfaces do not belong to this rendered harness.

Added all missing members found in the relevant component audit:

- findTabBySessionIdAcrossWorkspaces(string): TabLookupResult | null, returning null for no registered cross-workspace tab (production signature tab-manager.service.ts:677).
- switchTab(string): void, updates the harness active-tab signal (source:1669).
- setOverrideModel and setOverrideEffort, with argument tuples taken from their real TabManagerService signatures (source:2791/2796).
- workflowForSession, with production parameter/return types and null for no workflow (source:1075).

Completed RPC results for config:models-list (`{ models: [] }`), config:pricing-get (`{ pricing: {}, hydrated: false }`), and config:effort-get (`{ effort: undefined }`). The latter is called by EffortStateService.loadEffort and matches ConfigEffortGetResult at rpc/rpc-config.types.ts:47. Otherwise unhandled methods now resolve rpcOk({}), never undefined. Existing cli-sessions and autopilot responses remain intact.

Run 1 removed all console output and service-mock errors, but exposed jsdom's absent window.matchMedia in AuroraEffectComponent's afterNextRender callback (libs/frontend/ui/src/lib/native/aurora/aurora-effect.component.ts:97). Added a complete MediaQueryList mock scoped to the branch describe block, restoring the original property descriptor in afterAll. No production code changed.

Ran ONLY chat-view.component.spec.ts twice (below the three-run ceiling):

```powershell
npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts --coverage=false --maxWorkers=2
```

Full output saved to TEMP, filtered with `Select-String 'Tests:|?|console\.' | Select-Object -First 40`. The first failure was read with context 20 from its saved log, not rerun to inspect it.

| Run | Result | Console entries |
| --- | --- | --- |
| 1 | 5 failed, 85 passed, 90 total; matchMedia missing | 0 |
| 2 | 90 passed, 90 total; exit 0 | 0 |

Final log: `C:\Users\abdal\AppData\Local\Temp\ptah-lane-c-component-final-2.log`.
Run 1 log: `C:\Users\abdal\AppData\Local\Temp\ptah-lane-c-component-final-1.log`.

The final isTabStreaming/auth/autopilot/session lookup additions are now verified by the passing component suite. All five branch timeout/late-settlement tests pass with their original assertions and timing. No extra promise flushing was necessary beyond their existing awaited branch promises and advanceTimersByTimeAsync calls.

Final scoped ptah_get_diagnostics returned 255 project errors / 0 warnings. Reported requested-file errors concern unchanged SubagentRecord and protected/private-member accesses; no diagnostics reported on new mock lines. This remains an unclean project typecheck, not a green diagnostic claim.

## Findings

No production defect established. The failures came from incomplete test doubles and jsdom's missing matchMedia, exposed by zoneless scheduling. The five failures were migration regressions relative to main's old Zone.js setup; the initial attribution to pre-existing main failures was incorrect.

NG0101 was absent before lane C changes under zoneless: zero in each of all four requested suites. No recursion fix or console suppression was needed.

## Decisions

- Complete the existing harness rather than replace rendered child components. Evidence: verified service APIs and call-site audit. Reversible: yes.
- Return contract-shaped model/pricing/effort results plus a successful empty RpcResult fallback, as instructed, instead of undefined. Evidence: service consumers call isSuccess(). Reversible: yes.
- Provide matchMedia only within the branch describe and restore its original descriptor. Evidence: Aurora afterNextRender uses the browser API absent in jsdom; no production defect. Reversible: yes.
- Keep all test cases, assertions and existing async flushing; the final 90-test run passes unchanged expectations. Reversible: yes.
- Stop after the passing second component-only run; latest instruction scoped verification to that file. No need for the third permitted run.

## Not done / limits

No final seven-suite rerun after the latest component-only fixes, per latest verification scope. The earlier other six suites passed. Project diagnostics still contain 255 errors outside new mock lines. No production/setup/settings edits, git actions, broad tests, test deletions/skips/weakened assertions, or console suppression. Other writers' changes were not reverted.
