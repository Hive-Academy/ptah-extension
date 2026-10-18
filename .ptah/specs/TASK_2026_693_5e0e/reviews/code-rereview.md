# Code re-review — TASK_2026_693_5e0e

## Summary

| Metric | Result |
| --- | --- |
| Score | **6/10** |
| Verdict | **REVISE** |
| Findings | 2 Serious; 0 Moderate; 0 Minor |
| Failure modes | 2 |

The fix removes transcript I/O from the `session:list` response and clears the canvas hold on hide and destroy. The SDK text predicate extraction preserves the previous `isSkillOrMetaContent` checks. Two counter behaviors still prevent a reliable visible count. This is a 6 rather than a 5 because repeated requests after completed warms produce the tested count; it is below 7 because an ordinary first load and a stalled reader can both leave the feature absent.

## Findings

### Serious — A completed cold warm never updates the displayed list

`peekAndWarm` returns only counts already in its cache and starts the read afterward (`libs/backend/rpc-handlers/src/lib/handlers/session-message-count.ts:158-171`); the RPC turns every miss into `messageCount: 0` (`libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:470-487,527`). Completion only writes the backend cache (`session-message-count.ts:201-211`); it sends no update and schedules no second list. The frontend stores that zero snapshot on a successful list (`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:529-556`), and closing and reopening Previous Sessions deliberately preserves loaded pages without another request (`libs/frontend/chat/src/lib/components/organisms/previous-sessions/previous-sessions-modal.component.ts:5-10`; `libs/frontend/chat/src/lib/services/session-list/session-list-view.store.ts:5-11`). The row displays the label only above zero (`libs/frontend/chat/src/lib/components/molecules/session-list-row/session-list-row.component.ts:231-232`). Thus an existing session on a cold first load can keep showing no “N msgs” label indefinitely until an unrelated action triggers `session:list`. The new test explicitly makes a second RPC after settling the warm (`libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts:993-1004`), so it does not cover the open-list path. Arrange one coalesced refresh or push an enrichment update after page warms complete, while preserving the fast first response.

### Serious — Four stalled reads permanently starve later pages

The shared counter runs four warms and starts the next only from each warm's `.finally` (`libs/backend/rpc-handlers/src/lib/handlers/session-message-count.ts:174-184`). The reader receives no abort signal or deadline (`:202-206`), although `projectJsonlLines` supports a signal (`libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:633-654`). If four reads hang, `activeWarms` stays at four, the queue and `warming` set retain every newly requested path (`session-message-count.ts:142-146,165-168`), and later pages can never obtain a count. The performance spec deliberately uses a reader that never resolves (`libs/backend/rpc-handlers/src/lib/handlers/session-list.perf.spec.ts:175-179`) but checks response latency and only that a read started (`:355-360`), not whether a later page can warm. A timeout/cancellation path and bounded pending queue, with a test that requests another page after stalled reads, would prevent permanent starvation and unbounded retained paths.

## Five logic questions

1. **Silent failure:** a successful cold response carries `messageCount: 0`, and its eventual warm changes only backend state (`session-rpc.handlers.ts:527`; `session-message-count.ts:207-211`).
2. **User action:** opening Previous Sessions for the first time, then closing and reopening it, can keep the count label hidden because reopening reuses the loaded page (`previous-sessions-modal.component.ts:5-10`; `session-list-row.component.ts:231-232`).
3. **Wrong answer from valid input:** an existing nonempty transcript on a cold page is reported as zero until another list request (`session-message-count.ts:158-171`; `session-rpc.handlers.ts:527`).
4. **Dependency failure:** a rejecting read is caught and leaves zero or the prior count (`session-message-count.ts:212-220`); a nonsettling read holds one of four slots forever (`:174-184,202-206`).
5. **Missing requirement:** the asynchronous design has no trigger to make completed counts visible in the current list, and no recovery rule for stalled background reads (`session-message-count.ts:179-183,207-211`; `session-loader.service.ts:529-556`).

## Fixes checked and verification

- Canvas cleanup clears `holdTabId` after removing listeners and pointer IDs (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:438-445`). The hide/show and destroy specs assert null immediately (`canvas-rail-board.component.spec.ts:896-943`). No regression found in this fix.
- `isSkillOrMetaContent` still performs its source-tool check and text extraction before delegating to `isSkillOrMetaText` (`libs/backend/agent-sdk/src/lib/message-transform/message-transform-helpers.ts:48-106`); the marker comparisons are unchanged in the diff. The counter imports the shared predicates from the SDK barrel (`libs/backend/rpc-handlers/src/lib/handlers/session-message-count.ts:25-30`; `libs/backend/agent-sdk/src/index.ts:98-104`). No behavior change found in the helper extraction.
- The orchestrator reports agent-sdk, rpc-handlers, and canvas typecheck, lint, and tests green. My scoped `ptah_get_diagnostics` returned **unavailable** after its 45-second compiler timeout, so it adds no independent pass claim. I ran no additional Jest suite; the two gaps follow directly from the control flow and the existing tests' explicit second request and never-settling reader.

## Decision

**REVISE.** Preserve the accepted fast list response, but make a completed warm visible without requiring an unrelated user event and let stalled warms release capacity. Both fixes are reversible. The remaining risk is concentrated in the counter; the canvas and shared-filter fixes satisfy the issues raised in the first review.
