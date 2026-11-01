# Batch 8r-5 report

## Root cause

In R3, the established Codex process exited during `chat:continue` (`app-run2.log:1135-1159`). The broadcaster logged a rejected stream after four events (`:1159-1185`), and the renderer still showed the tab as running after 35 seconds (`r3-final-state.txt`). The log does not print individual `chat:chunk` payloads; the event sequence below is derived from the source and the four-event count.

For this failure path, `codex-chat-turn-stream.ts:250-260` yields the follow-up user echo, `:59-85,310-313` yields the one assistant notice start and text delta, and `:317-325,348-363` yields the consumed-message `failed` `turn_state` before rejecting. The projection suppresses the failed native `message_complete` as a successful completion (`codex-chat-turn-stream.ts:315-327`). The Codex callback also publishes `SESSION_TURN_FAILED` independently (`codex-chat-event-callbacks.ts:164-174`); the stream does not await it. The renderer treats `CHAT_ERROR` as presentation only (`chat-lifecycle.service.ts:183-250`), while `TurnStateApplier.apply` owns terminal status and spinner (`turn-state-applier.service.ts:91-158`).

The prior broadcaster caught the rejection, saw the registry already in `failed`, and skipped its ordered catch-path idle event (`chat-stream-broadcaster.service.ts:343-352`, before this change). It also suppressed its own `CHAT_ERROR` because the error was `webviewReported` (`:372-383`, before this change). That left no later backend settlement signal after the first failed state. The live run shows the failed state alone did not release this tab; the log cannot establish why that first state was not applied. The renderer's `Chat error` log at `app-run2.log:1157` confirms an error presentation arrived, not a status transition.

For a Claude SDK process error with no result, the assistant transformer emits `generating` (`assistant-message.transformer.ts:338-350`), then the shared broadcaster's catch forces an ordered `idle` and publishes `CHAT_ERROR` (`chat-stream-broadcaster.service.ts:343-383`). A Claude result, when available, has its own terminal `turn_state` (`result-message.transformer.ts:18-36`). The Codex rejection now receives the same catch-path idle settlement without changing Claude's branch.

## Fix

Changed files:

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\streaming\chat-stream-broadcaster.service.ts` — for a webview-reported failure, flush an ordered idle `turn_state` after the failed state and transcript chunks. Keep the reported-error `CHAT_ERROR` suppression, so the assistant notice remains single. Other failed-state and abort handling remain as before.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\streaming\chat-stream-broadcaster.service.spec.ts` — regression sequence and assertions below.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8r-5-report.md` — this report.

The idle event uses the same real session ID and tab ID as the failed event, with a newer registry revision. It is flushed before the stream exits and before the turn-state registry is cleared. The Codex callback remains detached from failure settlement. No frontend, gateway, user-interrupt, Claude, or MCP code was changed.

## Specs added

Updated the existing broadcaster spec at `chat-stream-broadcaster.service.spec.ts:1054` to model R3's four yielded events: user echo, notice start, notice text, and consumed-message failed state, followed by rejection. It now requires a fifth delivered chunk: a newer idle state addressed to the same tab/session. It also requires no `chat:error` or `chat:complete`. The existing unreported stream-error spec at `:1134` covers the Claude-style idle/error ordering.

Per the lane rules, I did not run tests, verification, typecheck, lint, builds, Nx, npm, diagnostics, or the app. The spec and source diff were reviewed only; runtime behavior is not claimed as verified.

## Next turn after the fix

The idle event maps the tab to `loaded` and clears its streaming/abort state in `tab-manager.service.ts:1851-1912`, so Send can be used in place. The failed Codex context is retired by `codex-chat-turn-stream.ts:364-387`. On the next `chat:continue`, `chat-session.service.ts:1213-1224,1746-1812` finds no live stream and attempts the existing resume; its Codex resume delivers the follow-up prompt once (`:1918-1956`). If resume fails, the same path returns a typed Codex failure or a clear unsuccessful RPC result (`:1957-1984` and `codexFailure`). This is a source-based prediction, not a live post-fix result.

## Decisions

- Preserved the single fixed transcript notice and callback-independent cleanup from batch 8r-1.
- Limited the extra idle state to `webviewReported` errors; only Codex creates that marker in backend source. Claude and ordinary abort behavior are unchanged.
- Ptah symbol search had no usable index, so targeted read-only PowerShell searches were the fallback. The CLI exposed no skill invocation/discovery mechanism; no skill was loaded.
- `git status` also showed `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts`, `batch-g5-report.md`, and `review-g5.md` changed by another writer. I did not edit them.
