# FU-13 code re-review — TASK_2026_693_5e0e

## Summary

| Metric | Result |
| --- | --- |
| Score | **7/10** |
| Verdict | **REVISE** |
| Findings | 0 Critical, 1 Serious, 0 Moderate, 0 Minor |
| Failure modes | 1 |

The prior two Serious findings are fixed for ordinary pages: a completed warm sends a metadata push, and a stalled read releases its worker slot after five seconds. One large-page scheduling case still leaves real message counts at zero indefinitely. This merits 7 rather than 5–6 because the normal refresh and deadline paths are now present and covered; it does not merit 8 because the remaining case affects valid requests and gives a success-looking wrong answer.

## Finding

### Serious — A page with more than 68 cold transcripts can permanently skip its middle rows

`peekAndWarm` enqueues every row, then removes the **oldest queued** jobs until only 64 remain (`libs/backend/rpc-handlers/src/lib/handlers/session-message-count.ts:217-234`). `pump()` starts four jobs only after that pruning (`:234,238-249`). For a 69-row cold page, rows 1–5 are dropped, while rows 6–69 warm. The resulting push makes the frontend reload **the same loaded page** (`libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:485-502,1702-1713`; `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:209-211,509-521`; `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:523-555`). That reload again enqueues all 69 in the same order and drops rows 1–5. The cache has no entry for them, so their `messageCount` remains zero (`session-message-count.ts:218-223`; `session-rpc.handlers.ts:541`). No changed count means no subsequent push (`session-message-count.ts:252-258`). The public `SessionListParams.limit` has no maximum (`libs/shared/src/lib/types/rpc/rpc-session.types.ts:79-85`), and the frontend refresh grows its limit to its loaded offset (`session-loader.service.ts:523-527`). Thus this is a valid list shape, especially after many pages are loaded. The new counter spec checks five jobs after four stalled ones, but not an oversized page (`session-message-count.spec.ts:94-120`).

**Fix:** retain progress across repeated large-page calls, or enqueue only missing/stale paths with a policy that eventually services every row; add a 69-plus-row test that follows the push-driven reload and verifies every count becomes visible. A fixed-size tail queue alone cannot guarantee progress for an unchanged page order.

## Five logic questions

1. **Silent failure:** the handler returns `messageCount: 0` with a successful list response for every dropped cold job (`session-message-count.ts:218-232`; `session-rpc.handlers.ts:541`).
2. **User action:** loading many session pages and then receiving a metadata refresh requests `limit = currentOffset`; beyond 68 cold rows, the skipped rows can keep their hidden count labels (`session-loader.service.ts:523-555`; `session-message-count.ts:228-234`).
3. **Wrong answer from valid input:** `session:list` accepts an uncapped `limit`; a 69-row page with nonempty transcripts can report zero for its first five rows (`rpc-session.types.ts:79-85`; `session-message-count.ts:217-234`).
4. **Dependency failure:** an unresponsive stat or stream is raced against the deadline, its slot is released, and a late result is barred from cache (`session-message-count.ts:166-188,266-292,299-323`). A rejected read keeps the previous count and logs at debug level (`:279-287`).
5. **Missing requirement:** the queue cap lacks a fairness or eventual-completion rule for pages larger than its capacity (`session-message-count.ts:35-42,226-234`).

## Fixes verified and limits

- The whole warm, including `fs.stat`, is raced against an abort signal; `projectJsonlLines` receives that signal, the timer is cleared and unref'd, and the underlying promise has both fulfillment and rejection handlers, so late rejection is handled (`session-message-count.ts:166-188,266-323`). The new fake-timer tests exercise stalled stream and stat paths (`session-message-count.spec.ts:94-138`).
- The notification uses a valid `updated` kind and the shared `sessionId`/`workspaceId` shape (`session-rpc.handlers.ts:1702-1713`; `libs/shared/src/lib/types/rpc/rpc-editor.types.ts:15-26,36-43`). The chat handler receives this message and debounces `loadSessions()` (`chat-message-handler.service.ts:153,209-211,509-521`). The loader fetches from offset zero with the current loaded count as its limit and does not reset the offset first (`session-loader.service.ts:523-555`). On an unchanged small page, cached file metadata makes the warm return false, so the refresh does not loop (`session-message-count.ts:301-309,252-258`).
- The optional manager token is injected when `SessionRpcHandlers` is resolved (`session-rpc.handlers.ts:241-248`). Electron registers its manager in bootstrap before `wireRuntimePreWindow` calls `registerRpcSurface` (`apps/ptah-electron/src/activation/bootstrap.ts:412-416`; `apps/ptah-electron/src/main.ts:177-180,284-292`; `apps/ptah-electron/src/activation/wire-runtime.ts:331-335`). VS Code and CLI have manager registrations (`apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:548`; `libs/backend/cli-engine/src/lib/container.ts:413`); the optional injection also permits a host without one.
- The orchestrator reports rpc-handlers typecheck, lint and tests green. My scoped `ptah_get_diagnostics` returned **unavailable** after its 45-second compiler timeout; it adds no independent pass claim. I ran no additional Jest suite. The 69-row failure follows directly from the queue order and cap, and is not covered by the existing five-job spec.

## Decisions

**REVISE.** The deadline and push fixes can stand; the queue needs an eventual-progress rule before FU-13 is accepted. Keeping the 64-item memory bound while changing selection order is reversible. No source files were changed in this review.
