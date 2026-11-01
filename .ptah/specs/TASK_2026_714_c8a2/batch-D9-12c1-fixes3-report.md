# Batch D9-12c1 fixes 3

## Changes

- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\codex-history-projector.ts:34`: Reject tool links from a receiver's own thread or a descendant. At :63-95, link only threads with a parent, keep cross-thread lookup and `spawnAgent` preference, never scope the root, and preserve `unresolvedParentTool` fallback.
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\codex-history-projector.spec.ts:219`: Add root/self receiver regression. At :240, add descendant-to-ancestor cycle regression. Existing cross-thread and unresolved-parent cases remain at :207 and :182.
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-events.ts:9`: Export the one `CODEX_FAILURE_NOTICE` literal; reuse it at :307 and :356.
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-turn-stream.ts:25`: Import the shared notice; use it at :82 and :405.
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\codex-history-projector.ts:226`: Use the same notice in replayed failed turns.

## Files touched and line endings

| File | CR count | UTF-8 BOM |
| --- | ---: | --- |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\codex-history-projector.ts` | 0 | No |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\codex-history-projector.spec.ts` | 0 | No |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-events.ts` | 0 | No |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-turn-stream.ts` | 0 | No |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\.ptah\specs\TASK_2026_714_c8a2\batch-D9-12c1-fixes3-report.md` | 0 | No |

## UNCONFIRMED

- Tests, typecheck, lint, and runtime replay were not run because the task forbids them. Assertions and TypeScript syntax were reviewed in source only.
- Pinned-binary `thread/read` shape and UI handling of synthetic unresolved-parent IDs remain unconfirmed from the re-review.
- No matching Codex CLI skill mechanism was exposed in this lane; `.codex` contains agent definitions but no skills. `rg` was unavailable (access denied), so source searches used PowerShell.
