# Batch 8m-8 report — native Codex session title and message count

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\wiring\session-runtime-identity-cache.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\wiring\session-runtime-identity-cache.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\wiring\codex-chat-metadata-port.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\wiring\codex-chat-metadata-port.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\session-metadata-store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\session-metadata-store.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-turn-stream.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\handlers\session-rpc.handlers.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\handlers\session-rpc.handlers.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8m-8-report.md`

## Per-task result

| Task | Result |
| --- | --- |
| Native title end to end | The initialized runtime identity lookup now forwards the fourth `title` argument to `SessionMetadataStore.updateCodexExecution`, while retaining the routing cache update and persisted re-read. The existing store title selection trims the supplied title and preserves user renames. Added wrapper forwarding coverage. |
| Native message count | A completed native turn calls the typed metadata port once. Failed and interrupted turns, opens, resumes, and stop paths do not increment. The store serializes a two-message increment and rejects non-native rows. `session:list` reads the stored native count; Claude rows continue through `SessionMessageCounter` and Claude JSONL. |
| Specs | Added store legacy and concurrent increment cases, port forwarding, adapter completed/failed/interrupted/open cases, and native plus Claude list coverage. |
| Verification | Not run, per instruction. No diagnostics, verify, tests, lint, typecheck, build, install, commit, or push was run. |

## Write-path trace

| Key | Writer | Reader | Value format | Scope | Side effects |
| --- | --- | --- | --- | --- | --- |
| Session detail `name` | Adapter open/resume title → metadata port `save` → identity-cache wrapper → `SessionMetadataStore.updateCodexExecution` | `SessionMetadataStore.getForWorkspace` → `session:list` `name` | Trimmed nonempty title if name is missing or still session id; otherwise existing user name | Native Codex rows | Serialized durable identity write, metadata change event, routing cache refresh |
| Session detail `codexMessageCount` | Native terminal result with `status: completed` and no error → adapter port `completedTurn` → identity-cache store delegation → `incrementCodexMessageCount` | `getForWorkspace` summary → native `session:list` `messageCount` | Optional nonnegative safe integer; Zod validates write input; absent or invalid legacy value reads as zero; each completed turn adds 2 | Native Codex rows only | Serialized metadata write and metadata change event; no Claude JSONL count I/O for native rows |
| Claude JSONL transcript | Existing Claude session writer | Existing `SessionMessageCounter.peekAndWarm` → Claude `session:list` `messageCount` | Count of visible user prompts and assistant reply groups | Claude rows only | Existing background warm and metadata change push when a count changes |

## Decisions and risks

- The count is stored beside the native runtime binding so the existing session summary carries it into the rail. Ordinary metadata saves preserve the stored count and cannot directly replace it.
- The adapter port's `completedTurn` method is optional at the interface boundary to keep existing host test fakes in other files compiling. The production metadata port implements it. The adapter awaits its write before completing the result projection.
- The existing `libs/backend/agent-sdk/src/lib/di/register.codex-runtime.spec.ts` asserts the prior session-id title after a supplied native title. That expectation is stale under the requested behavior and is outside the allowed edit paths. The coordinator should update it before verification.
- Tests and typecheck were intentionally not run; the coordinator owns verification. The count increments for completed native turns observed by this process; it does not backfill historical Codex threads.
