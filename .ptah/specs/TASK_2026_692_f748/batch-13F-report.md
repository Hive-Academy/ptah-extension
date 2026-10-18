# Batch 13F report

## Findings

| Finding | Result | Evidence |
| --- | --- | --- |
| Logic S1: optional idle factory can break chat DI | Fixed. The factory delegates construction to a named helper, catches construction failures, converts non-Error throws to Error, logs once through the injected Logger, caches failure, and returns `undefined`. Constructor registration now disposes earlier subscriptions if a later subscription throws. | `libs/backend/agent-sdk/src/lib/di/register.ts:139,544-559`; `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.ts:102-136` |
| Style S1: concrete service dependencies | Fixed. The lifecycle facade uses `IdleCompactionFacadePort` (signals, boundary notice, disposal); the hook handler uses only `Pick<IdleCompactionSignals, 'rekey'>`. | `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.types.ts:254-257`; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:424`; `libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts:164` |
| Style M2: factory size and SessionId cast | Fixed. Construction is extracted and the factory calls the lifecycle manager's string-accepting sender without a cast. The unavoidable branded conversion is at the stream-pump boundary. | `libs/backend/agent-sdk/src/lib/di/register.ts:139-179,544-559`; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:732-735` |
| Logic M2: coalesced manual /compact result | Fixed with the orchestrator's expanded scope. `ChatContinueResult` has an optional `settled` flag. Both no-stream router returns set it; MessageSender removes the prompt boundary, returns the tab to loaded/idle, and does not mark it streaming. The normal success path remains streaming. | `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:172-173`; `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:140,183`; `libs/frontend/chat/src/lib/services/message-sender.service.ts:778-785` |

## Specs and checks

- `register.compaction-boundary-registry.smoke.spec.ts`: new `caches construction failure and lets both consumers resolve` case checks undefined token twice, one constructor attempt, one logged real Error, and real DI resolution of SessionLifecycleManager and CompactionHookHandler. Jest: 1 suite, 10 tests passed.
- `session-lifecycle-manager.idle.spec.ts`, `compaction-hook-handler.spec.ts`, `idle-compaction.service.spec.ts`: Jest 3 suites, 62 tests passed.
- CLI, Electron, VS Code `container.smoke.spec.ts`: respectively 18, 28, 43 tests passed; each run separately with its own Jest config.
- `NX_NO_CLOUD=true npx nx typecheck @ptah-extension/agent-sdk --parallel=1`: passed.
- `chat-slash-command-router.idle-coalesce.spec.ts`: coalesced before/after provider resolution and deduped returns assert `settled: true` (`:137,157,169`). Jest: 1 suite, 10 tests passed.
- `message-sender.service.spec.ts`: `leaves a settled continue idle without starting a stream` and `starts streaming for a normal successful continue` (`:361,389`). Jest: 1 suite, 50 tests passed.
- `NX_NO_CLOUD=true npx nx typecheck @ptah-extension/shared --parallel=1`: passed.
- `NX_NO_CLOUD=true npx nx typecheck @ptah-extension/chat --parallel=1`: passed with unrelated Angular NG8107 warnings in chat-ui and peer-session-send.
- `NX_NO_CLOUD=true npx nx typecheck @ptah-extension/rpc-handlers --parallel=1`: passed.
- `ptah_get_diagnostics` scoped to original agent-sdk changes: 0 errors, 0 warnings, clean coverage. A later scoped request for shared/router/frontend changes timed out twice while its compiler check continued; the required Nx typechecks above completed successfully.
- ESLint on changed TypeScript files: exit 0, 0 errors, 2 warnings (`register.ts` max-lines; existing non-null assertion in `idle-compaction.service.ts`).
- `prettier --check` on changed TypeScript files: passed.

## Later items

- Logic M1: user input can overtake an in-flight idle send; deliberately untouched.
- Logic M3: hung coalesced claim depends on Phase 1 timers; deliberately untouched.
- 700-line warning: deliberately untouched. The current lint warning in `register.ts` is included above.

## Decisions

- Keep coalesced /compact success semantics with an additive settled result signal. Options considered: return an error result; add an optional settled field. Evidence: the frontend success branch otherwise marks streaming without a stream. The orchestrator authorized the shared/router/frontend change. Reversible.
- Cache construction failure in the registration closure because `instanceCachingFactory` does not cache `undefined`; the next resolve must not retry or log again. Reversible.

## Changed files

- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\di\register.ts
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\di\register.compaction-boundary-registry.smoke.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.service.ts
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.types.ts
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction-hook-handler.ts
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\shared\src\lib\types\rpc\rpc-chat.types.ts
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\rpc-handlers\src\lib\chat\session\chat-slash-command-router.service.ts
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\rpc-handlers\src\lib\chat\session\chat-slash-command-router.idle-coalesce.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\frontend\chat\src\lib\services\message-sender.service.ts
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\frontend\chat\src\lib\services\message-sender.service.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\.ptah\specs\TASK_2026_692_f748\batch-13F-report.md
