# Removal A, step A5 — retired Codex proxy cleanup

## Result

Removed the proxy-named owner interface and policy, and removed the unreachable `codexProxy` compaction state, idle lane, and associated spec cases. Preserved native Codex account usage and the A3 refusal of historical SDK proxy routes. No DI token or registration changed in A5; A4 had already removed the two proxy tokens. No app or MCP implementation changed.

## Files changed or deleted

| File | Change and reason |
| --- | --- |
| `libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.ts` | Deleted the proxy policy; its native-intent condition now lives with the native-runtime refusal. |
| `libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.spec.ts` | Deleted policy-only cases; existing AuthManager and OAuth strategy specs cover native intent and legacy refusal. |
| `libs/backend/auth-providers/src/lib/auth/codex-native-runtime-refusal.ts` | Added `isNativeCodexAuthIntent` with the former policy's exact condition, including the `legacy-session-start` exception. |
| `libs/backend/auth-providers/src/lib/auth/auth-manager.ts` | Uses the native-intent predicate for mismatch validation and native authentication return. |
| `libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.ts` | Uses the same predicate; historical Codex route still returns the A3 native-runtime-required error. |
| `libs/backend/auth-providers/src/index.ts` | Removed exports of the deleted policy and owner interface. |
| `libs/backend/auth-providers/src/lib/providers/codex/codex-provider.types.ts` | Moved `currentOwnerKey` into `ICodexAccountUsageService`, removed `ICodexOwnerKeySource`, and clarified the retained historical placeholder comment. |
| `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts` | Implements only the account usage interface; its native owner-key behavior remains. |
| `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts` | Injects `ICodexAccountUsageService` directly for native Codex home ownership. |
| `libs/backend/auth-providers/src/lib/quota/provider-owner.accounts.spec.ts` | Updated the account service fixture type after the interface merge. |
| `libs/backend/auth-providers/src/lib/auth/model-resolver.spec.ts` | Replaced historical Codex proxy pricing and subscription fixtures with live Copilot fixtures; removed the duplicate Codex classification case. The SDK classifier spec still covers stale Codex envs. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-state.types.ts` | Removed the `codexProxy` session-class field. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.ts` | Acting eligibility now depends on E2 alone. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.spec.ts` | Removed the Codex-only observe case and used E2-only classes for remaining observe/claim behavior. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.types.ts` | Removed the Codex field from signals and state and the `codex-proxy` no-arm reason; retained native-Anthropic evidence. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.helpers.ts` | Removed the dead state initializer field. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.ts` | Removed the dead signal field and argument while continuing to pass native-Anthropic evidence. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-session.reducer.ts` | Removed the unreachable Codex no-arm branch and state copy. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-session.reducer.spec.ts` | Removed the Codex no-arm case and fields in fixtures. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-fire-gate.ts` | Removed the unreachable Codex fire gate. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-fire-gate.spec.ts` | Removed the Codex fire-gate case and fixture field. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.spec.ts` | Updated class fixtures and session-bound calls to the new signal shape. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.coalesce.spec.ts` | Updated class fixtures and session-bound calls; coalescing cases remain. |
| `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts` | Removed the fixed-false Codex class option, log field, and idle argument; uses the shared idle signal interface directly. |
| `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts` | Updated coordinator class and session-bound expectations for native Anthropic and Kimi proxy runs. |
| `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.idle-signals.spec.ts` | Updated binding expectation to the new signal arguments. |
| `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.idle.spec.ts` | Updated coordinator fixtures and binding calls. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.spec.ts` | Updated coordinator fixtures and binding call. |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-adapter-events.service.spec.ts` | Updated class fixtures and converted the Codex-only observe case to an E2-unpassed case. |
| `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.idle-coalesce.spec.ts` | Updated its coordinator port and fixture to the E2-only session class. |
| `libs/shared/src/lib/providers/proxy-token-placeholders.ts` | Clarified that the retained Codex marker is historical and exists for explicit stale-route refusal. |
| `.ptah/specs/TASK_2026_714_c8a2/task-A5-report.md` | This A5 inventory and handoff. |

## Items kept and why

- `ICodexAccountUsageService.currentOwnerKey`, `CodexAccountUsageService`, `CodexAccountUsageClient`, and `ProviderOwnerResolver.ownerForCodexHome` remain for native account ownership and quota. The proxy-only **interface name** was removed; its method was not.
- `CODEX_PROXY_TOKEN_PLACEHOLDER` remains in shared and auth-providers surfaces because persisted proxy envs can still be read. SDK model probes, route classification, one-shot runner, CLI connection/spawn, RPC fixtures, and quota credential checks use it to refuse or reject historical routes. The SDK classifier's direct stale-env spec remains in `sdk-query-options-builder.spec.ts`; the A3 refusal specs remain in `sdk-query-runner.service.spec.ts` and `ptah-cli-registry-spawn-model.spec.ts`.
- `legacy-session-start` remains in auth operation schemas and callers so old SDK sessions receive the explicit A3 refusal even on a native host. AuthManager and OAuth strategy specs cover this condition.
- The CLI registry's reserved-placeholder set and the quota owner's placeholder filter retain the Codex marker so it cannot be accepted as a user credential. These are historical-input guards, not proxy producers.
- `windows-hide-spawn.guard.spec.ts` was reviewed and left unchanged. Its `@openai/codex-sdk` mention concerns third-party child-process window handling and the dependency patch, not the deleted translation proxy; A6 owns native binary path work.
- Other provider proxies, MCP assembly, native Codex usage/plan reads, all host UI contracts, and `@openai/codex-sdk` dependencies remain. `codex-native-binary-path.ts`, package manifests, lockfile, and `tools/mcp-bench` were not edited.
- The four DI guard specs/lists were checked by symbol search. None listed `ICodexOwnerKeySource`, the policy, or the previously removed proxy DI tokens, so no DI guard edit was needed.

## Verification handoff and risk

Changed Nx projects (exact names): `@ptah-extension/agent-sdk`, `@ptah-extension/auth-providers`, `@ptah-extension/rpc-handlers`, and `@ptah-extension/shared`. The coordinator should verify those projects and downstream `ptah-electron` first, then `ptah-extension-vscode`, `ptah-cli`, and `ptah-tui` under the task's check policy.

Static review only: `git grep` found no remaining `codexProxy`, `ICodexOwnerKeySource`, `resolveCodexProxyPolicy`, `codex-proxy-policy`, `SDK_CODEX_PROXY`, or `SDK_CURATOR_CODEX_PROXY` references under `libs` or `apps`; `git diff --check` was clean. Spot Tree-sitter analysis reported clean parses for the changed reducer spec, model resolver spec, and native-refusal source. All changed files were checked for LF/no BOM. `ptah_get_dependents` remained in its background-building state, so `git grep` was the dependency-search fallback. Skill discovery was available, but no matching local code-removal skill was installed. No tests, typecheck, lint, build, Nx, npm, Jest, tsc, or diagnostics ran, per the task rule. Residual risk is an untested type or behavior regression; the coordinator's scoped verification is required.
