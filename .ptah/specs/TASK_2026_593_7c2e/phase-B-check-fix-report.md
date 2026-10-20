# Phase B scoped Jest correction

All listed suites except the real Git watcher spec passed in isolated single-spec Jest runs. The Git watcher run exceeded three minutes and was stopped.

| Suite | Cause | Fix with file:line | Result `Tests:` line |
| --- | --- | --- | --- |
| agent-sdk `sdk-permission-handler.spec.ts` | Missing signal and index-signature payload access | `libs/backend/agent-sdk/src/lib/sdk-permission-handler.spec.ts:87-113` | `Tests: 42 passed, 42 total` |
| agent-sdk `ask-user-question.service.spec.ts` | Index-signature payload access | `libs/backend/agent-sdk/src/lib/permission/ask-user-question.service.spec.ts:91-109` | `Tests: 20 passed, 20 total` |
| agent-sdk `register.compaction-boundary-registry.smoke.spec.ts` | Missing host attention port in test container | `libs/backend/agent-sdk/src/lib/di/register.compaction-boundary-registry.smoke.spec.ts:95` | `Tests: 10 passed, 10 total` |
| agent-sdk `host-attention-coordinator.spec.ts` | Incomplete lane metadata fixture and malformed-setting fixture | `libs/backend/agent-sdk/src/lib/permission/host-attention-coordinator.spec.ts:198-205,305-311` | `Tests: 36 passed, 36 total` |
| agent-sdk `session-query-executor.idle-signals.spec.ts` | Already passing | none | `Tests: 4 passed, 4 total` |
| rpc-handlers `register-shared-rpc-handlers.activation.spec.ts` | Missing host attention port in test container | `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.activation.spec.ts:89` | `Tests: 3 passed, 3 total` |
| rpc-handlers `rpc-allowlist.spec.ts` | Manifest union did not expose `handler` on every member | `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts:47` | `Tests: 10 passed, 10 total` |
| vscode-core `host-attention-ingress.spec.ts` | Scanner treated coordinator comparisons as emissions | `libs/backend/vscode-core/src/api-wrappers/host-attention-ingress.spec.ts:40` | `Tests: 3 passed, 3 total` |
| platform-electron `electron-host-attention-notifications.spec.ts` | Click fixture inferred an undefined return type | `libs/backend/platform-electron/src/implementations/electron-host-attention-notifications.spec.ts:21` | `Tests: 13 passed, 13 total` |
| platform-electron `registration.workspace-state-storage.spec.ts` | Already passing after earlier production null narrowing | none | `Tests: 3 passed, 3 total` |
| platform-vscode `vscode-host-attention-notifications.spec.ts` | Mock Promise resolver type, missing reflect polyfill, shared mock call history | `libs/backend/platform-vscode/src/implementations/vscode-host-attention-notifications.spec.ts:1,15-38,78-85` | `Tests: 10 passed, 10 total` |
| platform-vscode `ptah-view-visibility.spec.ts` | Missing reflect polyfill before tsyringe import | `libs/backend/platform-vscode/src/implementations/ptah-view-visibility.spec.ts:1` | `Tests: 1 passed, 1 total` |
| cli-agent-runtime `agent-events.spec.ts` | Direct MockLogger cast | `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.spec.ts:45` | `Tests: 23 passed, 23 total` |
| cli-agent-runtime `register.agent-process-manager.smoke.spec.ts` | Missing host attention port in test container | `libs/backend/cli-agent-runtime/src/lib/di/register.agent-process-manager.smoke.spec.ts:47` | `Tests: 8 passed, 8 total` |
| vscode-lm-tools `protocol-dispatcher.spec.ts` | Partial mocks directly cast to service types | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts:2990-3005` | `Tests: 350 passed, 350 total` |
| vscode-lm-tools `permission-prompt.service.spec.ts` | Direct MockLogger cast | `libs/backend/vscode-lm-tools/src/lib/permission/permission-prompt.service.spec.ts:287` | `Tests: 24 passed, 24 total` |
| ptah-electron `container.smoke.spec.ts` | Shared minimal DI container lacked host attention port | `apps/ptah-electron/src/di/container.smoke.spec.ts:123` | `Tests: 30 passed, 30 total` |
| ptah-electron `boot-order.spec.ts` | No remaining failure | none | `Tests: 20 passed, 20 total` |
| ptah-electron `surface-composition.spec.ts` | No remaining failure | none | `Tests: 4 passed, 4 total` |
| ptah-electron `phase-2-diagnostics-override.spec.ts` | No remaining failure | none | `Tests: 6 passed, 6 total` |
| ptah-electron `workspace-state-storage-single-instance.spec.ts` | No remaining failure | none | `Tests: 6 passed, 6 total` |
| ptah-electron `webview-manager-adapter.spec.ts` | Partial IpcBridge mock directly cast to the full type | `apps/ptah-electron/src/ipc/webview-manager-adapter.spec.ts:45` | `Tests: 12 passed, 12 total` |
| ptah-electron `bootstrap.network.spec.ts` | No remaining failure | none | `Tests: 14 passed, 14 total` |
| ptah-electron `git-watcher.real-git.spec.ts` | Stalled in this environment; no task-specific defect established | none | No `Tests:` line; stopped after about three minutes |
| ptah-extension-vscode `angular-webview.provider.spec.ts` | Incomplete host attention fixture; restored-panel expectation did not account for the visibility wrapper | `apps/ptah-extension-vscode/src/providers/angular-webview.provider.spec.ts:39,133-138,155` | `Tests: 8 passed, 8 total` |

## Production changes

None in this correction. The platform-electron null-narrowing edit was already present before this work.

## Decisions

- Kept changes within the listed specs and their DI test containers.
- Used a complete `CliSessionReference` with a valid branded `AgentId` and bracket access for index-signature payloads.
- Ran each Jest invocation with one spec path, `--coverage=false`, and `--maxWorkers=2`.
- Stopped the real Git watcher spec after its three-minute stall, as requested. It remains unverified; no production change was made for it.

## Suite not verified

`apps/ptah-electron/src/services/git-watcher.real-git.spec.ts` did not produce a `Tests:` line before the three-minute limit. Its cause remains unknown.
