# Batch 8m-5 report

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-turn-stream.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-turn-lifecycle.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-chat-native-contract.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.native.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\session\chat-slash-command-router.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\session\chat-slash-command-router.native.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8m-5-report.md`

## Per-task result

- **A / D17:** Native Stop marks the active turn, sends one interrupt, cancels its approval through `endTurn`, and retains the context when a matching terminal arrives. Idle Stop is a no-op. An open in progress is still cancelled through the existing opening guard. A rejected interrupt, exhausted stream, or failed synthetic terminal closes the context. The next ordinary send uses the existing `autoResumeIfInactive` path; native `/compact` now opens the stored thread before invoking runtime controls when inactive.
- **B:** The host contract expects `turn/interrupt`, no normal context close, `cancel` through the approval bridge, the original wire-id prompt cancellation, and idle / `aborted_streaming` UI state. The lifecycle spec covers stream exhaustion and rejection after Stop.
- **C:** Added adapter specs for idle Stop, Stop during approval followed by send and compact on the same context, rejected interrupt and missing terminal followed by a stored-thread resume. Added router coverage for inactive `/compact` resume before compaction. Existing opening cancellation specs remain.
- **D / D14a:** Adapter preserves `resume-profile-changed`; session RPC returns the runtime's clear instruction to start a new chat. Specs cover adapter classification and start, activated resume, and continue responses. A dedicated RPC code could not be added within the allowed files: `RpcUserErrorCode` in `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts` lacks it. The current wire code remains `CODEX_RUNTIME_FAILED`, so code-level distinctness is incomplete.
- **E:** This report records decisions, limits, and follow-up work.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Retain the context after a successful Stop; close it on failed interrupt or absent terminal | Close on every Stop; retain even after failure | `interruptSession` previously called `close`; the turn stream already tracks terminal delivery and the runtime has a 30 s interrupt timer that emits a failed terminal on context failure | Yes, in adapter and stream |
| Reopen an inactive native thread before `/compact` without consuming the returned turn stream | Let compact fail unavailable; start a dummy turn | `resumeSession` opens with stored identity before the returned iterable is consumed; `runtimeControls.compact` needs the active context | Yes, in slash router |
| Use the existing RPC code with the precise profile-change message | Add a new shared code; reuse an unrelated existing code | `RpcUserErrorCode` is a closed union and `libs/shared` is outside this lane; the runtime refusal class is also not exported by the package index | Yes, after a shared type addition |

## Risks and work not done

- **Shared code follow-up:** Add `CODEX_RESUME_PROFILE_CHANGED` to `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts` and map the adapter refusal to it. This lane could not edit that path.
- **Adjacent `/clear` path:** `ChatSlashCommandRouterService` calls `interruptSession` for native `/clear`. With D17, an idle Stop is deliberately a no-op, so `/clear` will report success while retaining the thread. An explicit awaited close operation on the adapter or routing interface is needed; it is outside this batch's Stop and compact contract.
- No tests, lint, typecheck, build, verification, diagnostics, or git state-changing commands were run, per task rules. The team leader must verify the changed projects.

## Review fix 1

- **Root cause:** D17 made idle native `interruptSession` a no-op, so `/clear` sent its completion while the Codex context remained open. `IAgentAdapter.endSession` returns `void`, and the routing adapter discards the native close promise; awaiting that interface method would not await the context. The native adapter now exposes `closeSession` (`codex-chat-adapter.ts:581`), and the slash router injects it and uses native ownership to select the native path (`chat-slash-command-router.service.ts:184,233-242`). Native `/clear` interrupts the current turn, awaits explicit close in `finally`, then broadcasts completion. Claude `/clear` still calls only `interruptSession` and keeps its existing completion payload. The existing frontend `CHAT_COMPLETE` clear handler resets the tab's session binding (`libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:410-420`), so the next send starts a fresh session/thread after this awaited close.
- **Specs added:** `codex-chat-adapter.spec.ts:189` checks that explicit close waits for `context.close` and deactivates the old session. `chat-slash-command-router.native.spec.ts:119,138,148` checks idle native clear waits before completion, busy native clear interrupts before close, and Claude clear stays on its original interrupt path. The existing frontend clear handler spec at `libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts:715` covers the fresh-tab reset; that file was read only.
- **Profile refusal review:** `libs/backend/codex-runtime/src/index.ts` does not export `CodexResumeProfileChangedError`. The adapter and session service retain their existing name/code detection as requested. The specific user-facing message remains; the team leader deferred a distinct shared RPC code (Minor), superseding the shared-code follow-up above.
- **Limits:** No checks or diagnostics were run, as required. The earlier `/clear` risk is resolved by this section. The direct native close is selected for sessions owned by the native adapter; a session already closed after a failed interrupt has no live context to close and still follows the clear completion path.
