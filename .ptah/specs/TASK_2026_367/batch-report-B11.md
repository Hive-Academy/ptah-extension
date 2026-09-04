# Batch B11 Report — Mojibake Sweep

## Scope

Repair double-encoded UTF-8 punctuation in TypeScript source files. The corruption converted characters like em dash and right arrow into three-byte mojibake sequences when UTF-8 text passed through a CP1252 pipe.

## Dry-run counts

- Files: 68
- Replacements: 462
- Mode: --dry-run, no files modified

## Real-run per-file table

| File                                                                                              | Replacements |
| ------------------------------------------------------------------------------------------------- | ------------ |
| apps/ptah-cli/src/cli/commands/auth.spec.ts                                                       | 9            |
| apps/ptah-cli/src/cli/commands/auth.ts                                                            | 33           |
| libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts                                       | 21           |
| libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts                               | 20           |
| libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts                                | 6            |
| libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.spec.ts                          | 36           |
| libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts                               | 5            |
| libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts               | 15           |
| libs/backend/agent-sdk/src/lib/helpers/stream-transformer.spec.ts                                 | 9            |
| libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts                                      | 1            |
| libs/backend/agent-sdk/src/lib/sdk-message-transformer.spec.ts                                    | 11           |
| libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts                             | 15           |
| libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.spec.ts                      | 6            |
| libs/backend/auth-providers/src/lib/auth/strategies/local-native.strategy.spec.ts                 | 16           |
| libs/backend/auth-providers/src/lib/auth/strategies/local-native.strategy.ts                      | 1            |
| libs/backend/auth-providers/src/lib/auth/strategies/local-proxy.strategy.spec.ts                  | 10           |
| libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts                  | 10           |
| libs/backend/auth-providers/src/lib/provider-models.service.ts                                    | 7            |
| libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.spec.ts                    | 5            |
| libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.ts                         | 6            |
| libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.ts                    | 5            |
| libs/backend/auth-providers/src/lib/providers/copilot/copilot-auth.service.spec.ts                | 16           |
| libs/backend/auth-providers/src/lib/providers/copilot/copilot-auth.service.ts                     | 6            |
| libs/backend/auth-providers/src/lib/providers/copilot/copilot-provider.types.ts                   | 3            |
| libs/backend/auth-providers/src/lib/providers/copilot/copilot-translation-proxy.ts                | 2            |
| libs/backend/auth-providers/src/lib/providers/local/local-model-translation-proxy.ts              | 1            |
| libs/backend/auth-providers/src/lib/providers/local/ollama-model-discovery.service.ts             | 7            |
| libs/backend/auth-providers/src/lib/providers/openrouter/openrouter-auth.service.spec.ts          | 2            |
| libs/backend/auth-providers/src/lib/providers/openrouter/openrouter-auth.service.ts               | 3            |
| libs/backend/auth-providers/src/lib/providers/openrouter/openrouter-translation-proxy.ts          | 12           |
| libs/backend/auth-providers/src/lib/providers/register-providers.ts                               | 2            |
| libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts                              | 5            |
| libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts               | 5            |
| libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts                               | 10           |
| libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts                                          | 1            |
| libs/backend/vscode-core/src/logging/logger.console-encoding.spec.ts                              | 2            |
| libs/backend/vscode-core/src/logging/logger.ts                                                    | 1            |
| libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.spec.ts      | 45           |
| libs/frontend/chat-streaming/src/lib/agent-monitor.store.spec.ts                                  | 4            |
| libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts                                       | 7            |
| libs/frontend/chat-streaming/src/lib/batched-update.service.spec.ts                               | 1            |
| libs/frontend/chat-streaming/src/lib/message-finalization.service.spec.ts                         | 1            |
| libs/frontend/chat-streaming/src/lib/message-finalization.service.ts                              | 1            |
| libs/frontend/chat-streaming/src/lib/permission-handler.service.spec.ts                           | 9            |
| libs/frontend/chat-streaming/src/lib/permission-handler.service.ts                                | 2            |
| libs/frontend/chat-streaming/src/lib/streaming-handler.service.spec.ts                            | 11           |
| libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts                                 | 1            |
| libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts           | 8            |
| libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts                | 7            |
| libs/frontend/chat/src/lib/components/molecules/chat-input/model-selector.component.ts            | 1            |
| libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts | 1            |
| libs/frontend/chat/src/lib/components/templates/app-shell.component.ts                            | 2            |
| libs/frontend/chat/src/lib/components/templates/chat-view.component.ts                            | 2            |
| libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.spec.ts                     | 2            |
| libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts                          | 2            |
| libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.spec.ts               | 2            |
| libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts                    | 1            |
| libs/frontend/chat/src/lib/services/chat-store/completion-handler.service.spec.ts                 | 1            |
| libs/frontend/chat/src/lib/services/chat-store/conversation.service.spec.ts                       | 2            |
| libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.spec.ts                   | 1            |
| libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts                        | 1            |
| libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts                     | 4            |
| libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts           | 2            |
| libs/frontend/chat/src/lib/services/chat.store.ts                                                 | 9            |
| libs/frontend/chat/src/lib/services/message-sender.service.spec.ts                                | 2            |
| libs/frontend/chat/src/lib/services/message-sender.service.ts                                     | 1            |
| libs/frontend/chat/src/lib/services/workspace-coordinator.service.spec.ts                         | 3            |
| libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-config.component.ts                          | 1            |

**Real-run total: 68 files, 462 replacements.**

## Diff review result

Reviewed the full diff produced by the script. Every hunk is a punctuation change inside a string literal or a comment. No hunk touches an identifier, import path, regular expression, or template-literal expression. No file needed reversion.

## Verification outputs

### Prescribed grep for em-dash family

Command: `git grep -c $'\xc3\xa2\xe2\x82\xac' -- 'libs/**/*.ts' 'apps/**/*.ts'`

Result:

```
apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:2
libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:3
libs/backend/vscode-core/src/logging/console-text.ts:10
```

Only the excluded set is listed. Counts drift from the pre-measured snapshot (3 vs 4 and 10 vs 13) because other batches landed between measurement and repair.

### Post-repair dry-run

Command: `node tmp-mojibake-repair.cjs --dry-run`

Result:

```
TOTAL	0	FILES	0
DRY RUN: no files were modified.
```

### Typecheck

Command: `npm run typecheck:all`

Result: `Successfully ran target typecheck for 70 projects` — 0 errors.

### Lint

Command: `npx nx run-many -t lint -p @ptah-extension/vscode-core @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers`

Result: `Successfully ran target lint for 4 projects` — 0 errors, warnings only (pre-existing).

- vscode-core: 11 warnings
- cli-agent-runtime: 36 warnings
- agent-sdk: 38 warnings
- rpc-handlers: 19 warnings

### Test

Command: `npm run test`

Result: `Successfully ran target test for 3 projects` — all passed.

- @ptah-extension/shared: 51 suites, 1231 tests passed
- ptah-extension-webview: 7 suites, 141 tests passed
- ptah-extension-vscode: 4 suites, 36 tests passed

## Cleanup

- Deleted `tmp-mojibake-repair.cjs`
- Deleted `tmp/mojibake-bak/` backup directory (no files were reverted)

DONE: B11 — 68 files, 462 mojibake replacements, typecheck/lint/test all green
