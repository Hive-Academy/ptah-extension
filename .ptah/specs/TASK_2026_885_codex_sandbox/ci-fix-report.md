# CI fix report — TASK_2026_885

## Scope and extracted criteria

The task requires the visible Codex sandbox setting to default to `danger-full-access` on every OS, while an explicitly chosen workspace-write mode remains available. Chat/gateway `plan` stays read-only. Queue receipts must be tied to a live CLI session and queryable through both MCP transports. The branch's added tool must appear in the served catalogs and contract coverage. The frontend degradation audit may not exceed its baseline.

## Suites

| Suite | Cause | Change and evidence |
| --- | --- | --- |
| `cli-agent-runtime` `codex-lane-profile` | (a) Old workspace-write and unproved-disabled default | Updated default expectations to full access, network enabled and `fullAccessStatus: explicit` in `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-profile.spec.ts:205-227`. Local Jest: 28 passed. |
| `cli-agent-runtime` `codex-lane-parity` | (a) Old lane policy default | Updated both lane profile expectations in `libs/backend/cli-agent-runtime/src/lib/cli-agents/codex-lane-parity.spec.ts:292,347-351`. Chat isolation expectation remains read-only. |
| `cli-agent-runtime` `codex-app-server-lane.adapter` | (a) Old default in preflight arguments and profile assertions | Updated expected full-access mode and policy in `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.spec.ts:215,243,302,736`. Local Jest suite passed. |
| `cli-agent-runtime` `agent-process-manager.guard/service` | (b) Test handles omitted the CLI session ID now required for safe queued delivery; one steer case omitted explicit delivery | Added session IDs and explicit `steer` in `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.guard.spec.ts:123` and `agent-process-manager.service.spec.ts:2963,2988`. Local Jest suites passed. |
| `cli-engine` `codex-lane-runtime-composition` | (a) Old Codex capability expectation | Updated detection expectation to `messagingMode: steer` in `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.spec.ts:35`. |
| `codex-runtime` `codex-runtime.spec` | (a) Existing permission-level cases expected workspace-write; explicit full access is now valid | Pinned those cases to `workspace-write-no-network` in `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:69-74`, and removed full access from unsupported lane cases at `:2635`. The local Windows fixture hits `CodexHomeMismatchError` before most assertions; CI rerun is needed. |
| `ptah-electron` `codex-lane-composition` and `container.smoke` | (b) Workspace test doubles lacked the new config return value | Added explicit workspace-write setting to the WRITE_DAC fixture in `apps/ptah-electron/src/di/codex-lane-composition.spec.ts:60`; made the smoke test return the provided default in `apps/ptah-electron/src/di/container.smoke.spec.ts:256`. |
| `vscode-lm-tools` `protocol-dispatcher` | (b) Added HTTP tool changed pinned catalog count and name set | Updated count and catalog in `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts:1372,8174`. Local Jest suite passed. |
| `vscode-lm-tools` `mcp-contract.sweep` | (b) Missing oversized and prose drivers, stdio name, count, and description budget for `ptah_agent_message_status` | Added both drivers and coverage entries in `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts:406,1127,1523,1931,1958,1998,2047-2066,2417,3105`. Focused Jest rerun: 72 passed, 3 skipped. |
| `vscode-lm-tools` `stdio-mcp-server.service` | (b) New status tool expanded the stdio list and budget map | Updated `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/stdio-mcp-server.service.spec.ts:164-183,204-209,230`. Local Jest suite passed. |
| `vscode-lm-tools` `agent-namespace.builder` | (b) Delegation now passes optional delivery as third argument | Updated the mock call assertion in `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.spec.ts:1015-1019`. Local Jest suite passed. |
| `libs/frontend/chat` degradation audit | (b) New catch/return sentinels were not annotated | Added `degradation-audit: reported` comments to `libs/frontend/chat/src/lib/settings/advanced/codex-sandbox-setting.component.ts:462,484`; both paths log the failure and return an explicit unknown result. Focused degradation audit passed with zero violations. |
| `rpc-handlers` local typecheck | (b) TS4111 requires indexed access | Changed the fixture's config property access to `absent['codexSandboxMode']` in `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.spec.ts:692`. |
| `cli-agent-runtime` `mcp-install.service` | Pre-existing/unrelated listing, but **passed** in supplied CI output | Supplied log shows `PASS` at lines 5441 and 11535; branch diff does not touch this suite. No change. |

## Verification and limits

`git diff --check` found no whitespace errors. Local targeted Jest: `codex-lane-profile` 28/28; four CLI agent runtime suites 297/298 before the last parity assertion was corrected; four MCP suites 577/580 before the remaining sweep expectations were corrected; focused MCP sweep rerun 72 passed, 3 skipped. The focused frontend degradation audit passed. Further CLI parity and CLI engine Jest runs stalled in this sandbox and were stopped. The Codex runtime fixture fails locally with `CodexHomeMismatchError` on Windows before most assertions; CI rerun is needed. `ptah_get_diagnostics` was invoked after edits but reported TypeScript compiler unavailable after its 45-second timeout. No Nx command or full verification was run.

## Decisions

- Retain workspace-write coverage in the Codex runtime permission-level tests by selecting that mode explicitly. Evidence: the branch has separate new profile tests for the full-access default. This is reversible.
- Treat the `mcp-install.service` listing as passing, based on the supplied CI log, and avoid unrelated changes. This is reversible.
