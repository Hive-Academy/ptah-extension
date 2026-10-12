# Batch 3 code logic review — round 2

Score: **8/10**. The round-1 rollback is eliminated at both direct background writers. The code covers both deferred return and forced flush; the tests cover the summary path and the background handler separately. This is a sound result rather than a 9–10 because the background-handler test mocks the queue and the summary test simulates the subsequent message start; neither is a full integration test of that sequence. No blocking logic defect was found.

Verdict: APPROVED

## Round-1 defect

**RESOLVED.** The background summary takes the queued state before the partition snapshot, appends to it, clears the queue, then writes the result (`D:\projects\ptah-wt-628\libs\frontend\chat\src\lib\services\chat-store\chat-lifecycle.service.ts:221-236`). The background stream path applies the same ordering (`D:\projects\ptah-wt-628\libs\frontend\chat-streaming\src\lib\streaming-handler.service.ts:527-566`). The queued object's pre-switch scalar fields and shared Map changes are carried into the direct write, while `clearPendingUpdates` removes pending, deferred, and pendingFlush entries (`D:\projects\ptah-wt-628\libs\frontend\chat-streaming\src\lib\batched-update.service.ts:332-348`). Consequently neither a return drain (`:223-253`) nor `flushSync` (`:298-323`) has that old entry to republish. The summary test checks the retained pre-switch message ID and summary, empty queue, return, and forced flush (`D:\projects\ptah-wt-628\libs\frontend\chat\src\lib\services\chat-store\chat-lifecycle.service.spec.ts:669-748`). The handler test checks that accumulation uses the queued object and clear precedes the partition write (`D:\projects\ptah-wt-628\libs\frontend\chat-streaming\src\lib\streaming-handler.background.spec.ts:322-343`).

## New defects

None found. The store-only scratch-state return occurs only when there is no queued or published base, so it cannot strand a queued entry (`D:\projects\ptah-wt-628\libs\frontend\chat-streaming\src\lib\streaming-handler.service.ts:533-558`). The compaction replacement reaches the same clear before write (`:550-565`); the active route retains its separate clear and publish path (`:465-514`). There is no `await` between queue read, clear, and direct write in either background writer (`chat-lifecycle.service.ts:221-236`; `streaming-handler.service.ts:527-566`), so another event-loop task cannot interleave there. A workspace switch inside that synchronous span would require a synchronous callback from a dependency; the accumulator's background context has no workspace-switch callback (`streaming-handler.service.ts:542-550`).

## Five logic questions

1. **Silent failure:** the former stale-scalar overwrite would look successful; its queue entry is now cleared before publication (`chat-lifecycle.service.ts:234-236`; `batched-update.service.ts:344-348`). No new silent rollback was found.
2. **User action:** switch away with a queued summary, receive a background summary and message start, then return or force a flush. The test asserts the newer ID survives both endings (`chat-lifecycle.service.spec.ts:669-748`).
3. **Wrong-answer data:** a queued object whose `currentMessageId` differs from the partition's shallow copy is selected as the base, preserving the pre-switch value before the next event (`streaming-handler.service.ts:527-540`; `chat-lifecycle.service.spec.ts:674-718`).
4. **Dependency failure or malformed shape:** a failed background lookup returns without writing (`streaming-handler.service.ts:521-525`); a missing background summary state warns and returns (`chat-lifecycle.service.ts:221-233`). The background update can return false if its tab disappears (`tab-workspace-partition.service.ts:372-404`), but the round-2 synchronous changes add no new disappearance window.
5. **Requirement gap:** no end-to-end spec drives a real background `message_start` after the summary; the current test mutates its message ID directly (`chat-lifecycle.service.spec.ts:720-724`). The separate handler spec verifies its queued-state selection and write ordering (`streaming-handler.background.spec.ts:322-343`). This is a coverage limit, not a demonstrated defect.

Verification: read the round-2 diff, notes, round-1 review, the changed service paths, relevant tests, and the workspace partition writer. No checks were run under the task's strict verification rule. `ptah_get_diagnostics` returned TypeScript checking unavailable after its 45-second limit, so diagnostics provide no positive evidence.

