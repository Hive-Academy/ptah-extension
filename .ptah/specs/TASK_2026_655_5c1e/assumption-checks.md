# Assumption checks — TASK_2026_655

Recorded 2026-10-14 (session 3). Source of each assumption in brackets.

| Id | Assumption | Check run | Result |
| --- | --- | --- | --- |
| A-1 (`implementation-plan.md:172-186`) | A block reaches the JSONL when (not long before) its `source: 'complete'` batch is emitted. | **Not run.** It needs a live multi-block agent turn with a coordinator log next to JSONL tail reads. That needs the running app (serve or a packaged build), which the project rules exclude unless the user asks. | Open. Residual B no longer depends on it (`implementation-plan-addendum.md` B.9): a block is dropped only when the delivered history page shows it. If A-1 fails as "persists later", more content is kept (possible duplicate, no loss). |
| A-2 (`implementation-plan.md:190-193`) | A seeded subagent anchor nests under its Task tool node. | Regression spec R-F4 subagent variant (`session-loader.resync-live-seed.spec.ts`, written in this session). | Holds (session 4). The R-F4 spec passed 3/3 in an orchestrator run (`jest ... session-loader.resync-live-seed.spec.ts`), including the subagent nesting case, and in the full `nx test @ptah-extension/chat` run (199 suites, 3,688 passed, 2 skipped). The Batch F fix made it pass: the replayer rebuilds the historical Task tree from the applied seed (`session-history-replayer.service.ts:332-370`). |
| A-3 (`implementation-plan.md:194-196`) | `SessionManager.setStatus('loaded')` does not drive the tab spinner. | Grep of non-spec files under `libs/` for `sessionManager.status` readers. | Holds: no reader outside `chat-streaming`. The 19 `.status()` matches in `libs/frontend` belong to other objects. |
| RA-A1 (`implementation-plan-addendum.md:178-182`) | After an auto `compact_boundary`, the SDK continues the same turn with a new assistant message. | **Not run.** It needs a live turn that crosses the auto-compact window. | Open. The fix does not depend on the answer: when no message follows, the early claim buffers nothing and costs one fence span. |
| A-B2 (`implementation-plan-addendum.md:1814-1818`) | For one message, live complete block events and history block events have the same order and strings. | Static: both come from the same content blocks (`assistant-message.transformer.ts:119-150`; `session-replay.service.ts:283-330`), verified by the round-1 and round-3 document reviews. | Holds statically. Runtime evidence: the filter's mismatch `console.warn`. A failure gives a pass-through (duplicate), never a loss. |
| RB2-A3 (`implementation-plan-addendum.md`, B.10 point 7) | A later live finalization does not overwrite the history tool-result patch. | Code read: `message-finalization.service.ts:176` reads `tab.messages` in the same synchronous pass that writes at `:249-251`. | Holds (also confirmed by the round-3 reviewer). |

## Follow-up for the user

A-1 and RA-A1 can be observed in one manual session of the Electron app: run a multi-block turn
(thinking, text, tool use), switch workspace while it streams, and switch back; then run a turn
long enough to cross the auto-compact window. The new code logs a `console.warn` on every filter
mismatch, which shows how often A-B2 fails in practice.
