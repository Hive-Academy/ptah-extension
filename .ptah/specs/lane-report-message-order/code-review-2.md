# Lane report message order — re-review 1

## Verdict

**REVISE — 6/10.** Both earlier concrete failures are fixed. One major ordering race remains in the new queue-record mechanism: absence of a frontend message tree does not establish that a prompt precedes a backend peer turn. Counts: 0 critical/blocking, 1 major/serious, 0 minor/moderate, 1 failure mode.

The explicit queue record and human-provenance guard improve the implementation beyond a foundational failure (3–4). The remaining race still violates live/reload ordering, preventing a sound 7–8 assessment.

This is a targeted logic re-review of the two fixes and their send, insertion, and finalization paths, using the supplied diff, prior review, HANDOFF, fix plan, investigation, and current worktree source. It is not approval of every unchanged implementation or UI path. No tests, builds, installation, or git operations were run; no source was changed.

Verification evidence: HANDOFF reports passing scoped backend/shared and frontend tests/typechecks, including 702 passing chat-streaming tests. Those results were not independently rerun. Scoped `ptah_get_diagnostics` for `queued-prompt-record.service.ts` and `jsonl-reader.service.ts` reported no diagnostics in either requested file, but 136 errors in sibling files, including `accumulator-core.service.spec.ts:351` and `agent-monitor.empty-session-id.spec.ts:152`. Their baseline status was not established here; this is not a clean project typecheck result. No interactive timing reproduction was performed.

## Earlier findings

1. **FIXED — an earlier idle/interrupted prompt was mistaken for a queued prompt.** `libs/frontend/chat-streaming/src/lib/inbound-peer-message.ts:35` now requires membership in the explicit queued-id set. An unstamped client id alone no longer qualifies. `streaming-handler.service.ts:142` does not register idle prompts, `streaming-handler.service.ts:167` removes failed sends, and `message-finalization.service.ts:181` clears the record on aborted finalization. Thus the original `[U]` interrupted-empty-turn scenario becomes `[U, P, reply]`, preserving U ahead of P. The new race below is the inverse case: an actually queued prompt is absent from this set.

2. **FIXED — a human-marked envelope became a peer on reload.** `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:940` preserves string `turnOrigin`, and `:943` preserves a validated `origin.kind`. `session-replay.service.ts:201` recognizes either human marker and `:205` excludes that record before envelope parsing; `:219` supplies a peer label only when an envelope survived those guards. `jsonl-reader.service.ts:939` also preserves true `isSidechain`. This closes the supplied human-record case. Records lacking valid provenance still use content inference; this review does not claim that inference authenticates the sender.

## New findings

1. **Major — a prompt sent before the peer echo arrives misses the queue record and remains above that peer.**

   **Locations:** `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:142` and `:154`; `libs/frontend/chat-streaming/src/lib/inbound-peer-message.ts:35` and `:58`.

   **Concrete scenario:** The previous turn has finalized and the webview has no current streaming message. A lane report P is already accepted ahead of subsequent inputs by the backend, but its echo has not reached the webview. During that delivery gap the person sends Q. The real send path appends Q and calls `recordUserPromptBoundary` before sending `chat:continue` (`libs/frontend/chat/src/lib/services/message-sender.service.ts:722`, `:726`, `:736`). The backend consumes P before Q, but the early return at `streaming-handler.service.ts:142` prevents Q from being recorded at `:154`.

   When P's echo arrives, `streaming-handler.service.ts:592` passes an empty queued-id set to insertion. Q fails the membership condition, so P is appended after Q. Finalization anchors at P (`message-finalization.service.ts:85`) and leaves `[Q, P, P-reply]`, although backend order is `[P, P-reply, Q]`. The persisted transcript therefore differs on reload. This is a deterministic consequence of that event interleaving, not a claim that the timing was reproduced interactively. The FIFO backend admission and asynchronous echo path are documented in the supplied `investigation.md` under “Backend injection path.”

   **Suggested fix:** Separate send/admission tracking from the existence of a renderable streaming boundary. Track outstanding sends immediately and reconcile their position using authoritative backend admission/turn ordering (or a correlated accepted/consumed prompt event). Do not simply mark every idle prompt queued: that would restore earlier finding 1. Add a regression that starts with no current streaming message, records Q, delivers an already-admitted P echo and reply, and verifies P precedes Q, alongside the fixed interrupted-prompt test.

### Five logic questions

1. **Silent failure:** Insertion returns a valid array at `inbound-peer-message.ts:65` even when Q and P are reversed; no error exposes the wrong order.
2. **Unexpected user action:** Sending during the backend-admission/frontend-echo gap reaches the early return at `streaming-handler.service.ts:142` and triggers new finding 1.
3. **Wrong answer from valid input:** An ordinary optimistic Q plus a valid peer P is sufficient; missing queue membership at `inbound-peer-message.ts:35`, rather than malformed text, produces the wrong transcript.
4. **Dependency failure or delay:** Transport delay widens that gap. Failed sends that invoke rollback are removed at `streaming-handler.service.ts:167`; aborted finalization clears records at `message-finalization.service.ts:181`. Malformed origin values are discarded by the guard at `jsonl-reader.service.ts:151`; replay then uses the remaining metadata/content policy. No additional failure is asserted for these paths.
5. **Missing requirement:** The ordering contract needs an authoritative relationship between backend admission and an optimistic prompt before its first stream event. The current presence test at `streaming-handler.service.ts:142` cannot provide that relationship. It must also preserve the fixed older-interrupted-prompt behavior.

## Decisions

- **Treat both earlier concrete cases as fixed, while keeping the new race separate.** Options were reopening finding 1 wholesale or distinguishing the false-positive and false-negative queue classifications. Evidence: the required membership check at `inbound-peer-message.ts:35` fixes the former, while the early return at `streaming-handler.service.ts:142` creates the latter. Reversible if admission ordering is added.
- **Use current source and the freshly supplied diff over stale handoff workflow notes.** HANDOFF calls its earlier diff stale, but the supplied diff contains the queue-record service and human guards present in source. The options-builder replay-flag change remains outside this re-review; no request to restore it.
- **Do not expand this into unrelated known limitations.** HANDOFF already identifies the non-tail mid-turn steering limitation. The new finding explicitly uses a tail prompt and no frontend tree, so it is distinct. No style findings or speculative extra defects are counted.
- **Use one native usage search after an empty Ptah result.** `ptah_code_search_symbols` returned zero hits and an empty index for `recordUserPromptBoundary`; one `rg` search located its send-path caller. That caller was the additional source inspected to establish reachability.
- **Leave runtime verification to the coordinator.** Tests/builds were prohibited. The requested scoped diagnostics were collected, with sibling errors disclosed rather than treated as passing verification. These limitations are reversible through coordinator-run verification and a delayed-echo regression.
