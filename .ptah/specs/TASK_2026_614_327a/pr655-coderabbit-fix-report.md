# PR #655 CodeRabbit fixes

## 1. `tool-output-capper.ts:322` — FIXED

Removed the terminal empty split element when an outline ends in a newline, so `numLines` describes actual outline lines. Added `tool-output-capper.spec.ts` coverage for a terminal-newline outline.

## 2. `session-query-executor.service.ts:371` — FIXED

Replaced opaque last-owner tokens with monotonic run order. An older run now preserves a rekeyed id owned by a newer run and cannot release its state. Added a focused rekey ownership regression spec.

## 3. `stream-transformer.ts:347` — FIXED

Promise-like observer callback results now have a rejection handler that logs through the existing Logger; synchronous errors retain the same behavior. Added async `onMessage` rejection coverage.

## 4. `subagent-registry.service.ts:856` — FIXED

Held-start deletion now accepts an optional parent session id and registry binding passes the relevant parent session. This preserves starts with the same agent id from other sessions. Added a state-store spec proving scoped deletion.

Strictly required extra sibling: `libs/backend/vscode-core/src/services/subagent-registry/subagent-state-store.ts`. The optional public service parameter preserves the existing unscoped stop-first caller outside this scope.

## 5. `stdio-mcp-server.service.ts:234` — FIXED

`session_submit` now rejects ids already present in either in-flight map before it registers submit state, using the established logger and JSON-RPC invalid-request response. Added duplicate-submit coverage.

## 6. `agent-monitor.store.ts:2119` — FIXED

An unmatched usage entry now adopts a later known parent session id without overwriting an existing one. Added coverage for an empty initial session id followed by a known session id.

## Checks

- `npx nx run-many -t typecheck,lint,test -p agent-sdk vscode-core vscode-lm-tools @ptah-extension/chat-streaming --outputStyle=static 2>&1 | tail -25` — exit 1: PowerShell has no `tail`, so Nx did not run.
- `npx nx run-many -t typecheck,lint,test -p agent-sdk vscode-core vscode-lm-tools @ptah-extension/chat-streaming --outputStyle=static 2>&1 | Select-Object -Last 25` — exit 1. Tail reported `2806 passed, 2806 total`, but Nx named `@ptah-extension/vscode-lm-tools:test` as failed without a failed test in the tail. Nx Cloud also reported disabled organization (401).

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\compaction\tool-output-capper.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\compaction\tool-output-capper.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-query-executor.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-query-executor.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\subagent-hook-handler.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\subagent-hook-handler.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-core\src\services\subagent-registry.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-core\src\services\subagent-registry\subagent-state-store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-core\src\services\subagent-registry\subagent-state-store.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-stdio\stdio-mcp-server.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-stdio\stdio-mcp-server.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\frontend\chat-streaming\src\lib\agent-monitor.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\frontend\chat-streaming\src\lib\agent-monitor.store.spec.ts`

## Revise round 1

## Revise round 2

`libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts:249,429,463,508,571` — Extracted `resolveParentSessionId`, the payload-first parent-session resolver used by SubagentStart's held-start path and SubagentStop's identity, discard, and notification paths. A stop now discards using the same payload-resolved parent id as the held start; when neither source supplies an id, it passes `undefined` to retain the registry's established agent-wide cleanup fallback rather than leaving a held start behind.

`libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.spec.ts:627-718` — Updated the two-parent-session regression to assert the payload parent id and that the other parent's held start remains. Added empty-closure and undefined-closure cases that hold under the payload session, discard that exact held start on stop, and verify no later Task result can bind it.

### Revise round 2 checks

- `npx nx run-many -t typecheck,lint,test -p agent-sdk vscode-core --outputStyle=static 2>&1 | Select-Object -Last 25` — exit 0. Nx Cloud 401 was non-fatal.
- `npx nx run degradation-audit:lint 2>&1 | Select-Object -Last 25` — exit 0. Nx Cloud 401 was non-fatal.

1. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/stdio-mcp-server.service.spec.ts:821` — Typed the duplicate-submit mock's `dispatch` parameters as `MCPRequest` and `unknown`, and supplied the required `cancel` method. The spec now satisfies `ISessionSubmitHandler` and the complete stdio suite runs.
2. `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:361` — Replaced `.catch(logCallbackFailure)` with an inline rejection handler that visibly invokes the injected `logger.warn`; degradation-audit now accepts the catch path. Normalized this file to LF line endings.
3. `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts:461` — Passed the captured `parentSessionId` to `discardHeldUnboundStarts`. Added `subagent-hook-handler.spec.ts` coverage that pins the forwarded scope for a shared agent id; together with the state-store two-session regression, the other session's held start is preserved.
4. `libs/backend/agent-sdk/src/lib/helpers/compaction/tool-output-capper.spec.ts:201` — Changed the mocked outline to retain an actual terminal newline before the trailer separator. The old `split('\n').length` implementation would return 3 while the regression expects 2; the new code passes.
5. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/stdio-mcp-server.service.spec.ts:821` — The repaired mock includes `cancel`, the second required `ISessionSubmitHandler` member found after fixing the dispatch signature.

### Revise round 1 checks

- `npx nx run-many -t typecheck,lint,test -p agent-sdk vscode-core vscode-lm-tools @ptah-extension/chat-streaming --outputStyle=static 2>&1 | Select-Object -Last 25` — exit 0; 2,859 tests passed.
- `npx nx run degradation-audit:lint 2>&1 | Select-Object -Last 25` — exit 0.
- `npx nx run di-lint:lint 2>&1 | Select-Object -Last 25` — exit 0.
