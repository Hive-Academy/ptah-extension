# Batch D9 12d-2 fixes 2

## Changes

- `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts:40-42,55,66,72`: router accepts metadata and legacy-reader getters; metadata resolves for each read, and the legacy reader resolves only for a legacy route. The native port remains a per-read getter.
- `libs/backend/agent-sdk/src/lib/di/register.ts:312-321`: shared `SESSION_HISTORY_ROUTER` factory passes lazy container lookups. Resolving the router no longer constructs `SessionMetadataStore` or `SessionHistoryReaderService` as a side effect. The VS Code smoke spec was not changed because its legacy-only binding should not need a workspace-state storage registration to construct this router.
- `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.spec.ts:92-122,134-143`: fixture uses getters; new assertions check constructor laziness, on-read resolution, and that native history does not resolve the legacy reader.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.spec.ts:9,64,69` and `libs/backend/rpc-handlers/src/lib/handlers/session-native-history.spec.ts:15,74,81`: router fixtures use getters and platform fixtures use the declared enum member `PlatformType.CLI`. Both specs were re-read for other fixture type errors; none were found by inspection.

## Host risk inspection

Electron (`apps/ptah-electron/src/di/phase-2-libraries.ts:222`) and CLI (`libs/backend/cli-engine/src/lib/container.ts:702`) both use the same `registerSdkServices` router factory, so the lazy factory change covers both. Their full compositions register `WORKSPACE_STATE_STORAGE` (`apps/ptah-electron/src/di/phase-1-infra.ts:161`; `libs/backend/cli-engine/src/lib/container.ts:517`). No separate eager router factory was found. `ChatHistoryReadService` still directly injects `SDK_SESSION_METADATA_STORE` at `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts:70-72`; that pre-existing dependency is separate from router construction and was left unchanged as requested.

## Files touched

- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\session-history-router.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\session-history-router.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\di\register.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\rpc-handlers\src\lib\chat\session\chat-history-read.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\rpc-handlers\src\lib\handlers\session-native-history.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\.ptah\specs\TASK_2026_714_c8a2\batch-D9-12d2-fixes2-report.md`

## Static checks

- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`: exit 0. Touched projects: `libs/backend/agent-sdk: 4 ok (baseline 4)`; `libs/backend/rpc-handlers: 1 ok (baseline 1)`. Total repository output: 280 unsuppressed sites within baselines.
- `git diff --check`: exit 0.
- The five touched TypeScript files each have CR count 0 and no UTF-8 BOM. This report is written with LF and no BOM.
- `PlatformType` declaration checked at `libs/backend/platform-core/src/types/platform.types.ts:140-145`; public export checked at `libs/backend/platform-core/src/index.ts:19`.
- Ptah symbol search had no usable index (0 symbols); fallback was `git grep`, PowerShell `Select-String`, and targeted source reads. Ptah workspace analysis and AST inspection were used. This CLI exposed no skill invocation mechanism, so no skill was loaded.

## UNCONFIRMED

Tests, lint, typecheck, and DI smoke runs were not executed, per this lane's explicit command prohibition. The coordinator's earlier 8-project typecheck and lint pass predates these edits. Runtime behavior and final compilation remain UNCONFIRMED until the coordinator runs the permitted checks.