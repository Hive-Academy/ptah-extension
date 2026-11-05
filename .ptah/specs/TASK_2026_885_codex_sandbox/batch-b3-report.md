# B3 backend implementation report

## Files changed

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.ts`: queue receipts, bound session IDs, terminal status history, explicit steer, and serialized flush.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/tracked-agent.ts`: pending entry type.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`: delivery parameter and status lookup.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts`: awaitable steer signature.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts`: steer capability and acknowledged active-turn steer.
- `libs/shared/src/lib/types/agent-process.types.ts`: optional message ID in routing outcome.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`, `namespace-builders/agent-namespace.builder.ts`: API delivery and status contracts.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`, `tool-description.builder.ts`, `mcp-response-formatter.ts`: HTTP tool schema, dispatch, and receipt formatting.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts`, `tool-builders.ts`: stdio tool schema and dispatch.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.spec.ts`: updated queue fixture and status/session regression.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.spec.ts`, `codex-lane-parity.spec.ts`: steer capability expectations and acknowledged/stale-turn regression.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`, `tool-description.builder.spec.ts`, `mcp-stdio/agent-tool.dispatcher.spec.ts`, `stdio-mcp-server.service.spec.ts`: delivery/status tool surface expectations.

## Contracts

`ptah_agent_message`: `agentId` and `message` required; `delivery?: 'queue' | 'steer'` defaults to queue. Queued receipts carry `mode: 'queue-next-turn'`, `messageId`, and pending detail. Explicit steer is Codex-only and returns `mode: 'steer'` only after the app-server acknowledges the expected active turn. Others return unsupported.

`ptah_agent_message_status`: required `agentId` and UUID `messageId`; response contains those IDs and `status: pending | delivered | failed | unknown`, with a safe `reason` for failed. Stdio names omit `ptah_`.

Pending entries hold `{ messageId, cliSessionId, text }`; flush fails a mismatched session, rejected continuation, or released subprocess, and teardown fails all remaining entries. Terminal history is capped at 64 entries.

## Verification

- `npm run verify -- -p @ptah-extension/cli-agent-runtime`: failed because Nx plugin loading hit `spawn EPERM`; the header selected one project.
- `node node_modules/typescript/bin/tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.lib.json`: failed initially on the pending entry type in `tracked-agent.ts` (subsequently fixed) and duplicate `codexSandboxMode` in `codex-lane-profile.ts` (another executor's file).
- `node node_modules/typescript/bin/tsc --noEmit -p libs/backend/vscode-lm-tools/tsconfig.lib.json`: failed on `codex-context.ts` requiring the concurrent profile field `codexSandboxMode`; no B3 file errors were reported.
- `node node_modules/jest/bin/jest.js --runInBand -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.spec.ts --coverage=false`: 11 passed, 1 failed on an old string queue assertion; assertion updated after the run.
- The same router command rerun: **13 passed**.
- `node node_modules/typescript/bin/tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.spec.json`: **passed**.
- `node node_modules/typescript/bin/tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.lib.json` rerun: **passed**.
- `node node_modules/typescript/bin/tsc --noEmit -p libs/backend/vscode-lm-tools/tsconfig.spec.json`: **passed** (before the final stdio test addition).
- `node node_modules/typescript/bin/tsc --noEmit -p libs/backend/vscode-lm-tools/tsconfig.lib.json` rerun: **passed**.
- `node node_modules/jest/bin/jest.js --runInBand -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.spec.ts --coverage=false`: 61 passed, 2 failed: one stale queue capability assertion (fixed), one concurrent profile policy expectation (`networkAccess: false` versus actual `true`).
- The adapter command with `-t "acknowledges explicit steer"`: **1 passed**, 62 skipped.
- `node node_modules/jest/bin/jest.js --runInBand -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.spec.ts --coverage=false -t "ptah_agent_message|buildAgentMessageTool"`: dispatcher suite passed (4 tests; 355 skipped); builder suite failed to compile on a new index-signature assertion, now fixed.
- `node node_modules/jest/bin/jest.js --runInBand -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/agent-tool.dispatcher.spec.ts --coverage=false -t "forwards explicit steer"`: first run failed to compile on a new result assertion; after fixing it, **1 passed**, 54 skipped.
- Scoped `ptah_get_diagnostics`: unavailable after a 45-second timeout.

## Decisions

- Keep the queue on the tracked agent and terminal receipts in the router. The existing manager already owns the flush point; a bounded in-memory history matches the in-memory queue. Reversible.
- Reserve native Codex steer for `delivery: 'steer'`; the live findings show busy `turn/start` folds into the running turn. Reversible.

## Open issues

- The named `implementation-plan.md` was absent from this task folder. B3 followed the supplied scope and `findings.md`.
- The full adapter suite has a concurrent profile policy expectation failure in a line owned by the other executor. The fixed tool-description assertion and full stdio surface suite were not rerun. The coordinator should run official verify after the concurrent profile work is complete.
