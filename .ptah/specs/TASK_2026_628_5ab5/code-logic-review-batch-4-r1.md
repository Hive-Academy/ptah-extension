# Batch 4 code logic review — round 1

Round 0 baseline: `D:\projects\ptah-wt-628\.ptah\specs\TASK_2026_628_5ab5\code-logic-review-batch-4.md`.

Score: 8/10. Both demonstrated blocking paths are closed, and the queue, fold, and suspended-frame tests support the intended behavior. The remaining uncapped applied prose segment and lack of a real hidden-webview exercise keep this below the exemplary 9–10 band; no material new failure supports the 5–6 band.

Verdict: APPROVED

| Round 0 defect | Status | Evidence |
| --- | --- | --- |
| 1. Queued output lost on destroy | RESOLVED | `D:\projects\ptah-wt-628\libs\frontend\chat-streaming\src\lib\agent-monitor.store.ts:1038-1045` calls `flushPendingOutput()` before clearing the maps. The flush cancels the frame, snapshots and clears the queue, and applies each pending delta in one `_agents.update` (`:1376-1400`). `agent-monitor.store.spec.ts:2598-2613` asserts the final stdout and that a second flush is inert. Closing the view after a final delta now leaves that delta in the store. |
| 2. Coalesced structured output grows while frames are suspended | RESOLVED | `agent-monitor.store.ts:1311-1323,1339-1367` initializes and increments `segmentChars`, records each usage before prose merge, and flushes at the segment, event, usage, or character threshold. `agent-output-frame.ts:94-115` folds each queued usage once, preserves a restored card's null total, then applies the segments. `agent-monitor.store.ts:1382-1385` clears both queue maps after each flush. `agent-monitor.store.spec.ts:2616-2683` suspends frames, checks the queue bounds, all 1300 usage reports, and all ten 20 KiB content deltas. |

## New defects

None established in the round 1 changes. The diff adds only `flushPendingOutput()` to the public `AgentMonitorStore` surface (`agent-monitor.store.ts:1376`); the queue fields and writer helper are private. `onAgentStatus` and `onAgentCompleted` still update `_subagents` synchronously (`agent-monitor.store.ts:2129-2161,2163-2190`). The existing one-fold stdout/stderr accounting remains in `agent-output-retention.ts:129-159`.

## Existing minor observation

`D:\projects\ptah-wt-628\libs\frontend\chat-streaming\src\lib\agent-output-frame.ts:110-115`; `agent-output-retention.ts:293-295` — **Minor, outside Batch 4.** A long run of adjacent text can leave one large applied card segment because `capSegments` checks count, not content length. Scenario: repeated early flushes under a suspended frame keep the *queue* bounded while the card's final merged prose continues growing. A future retention change could bound or chunk applied prose while preserving visible content and usage. This behavior predates Batch 4 and does not change the verdict.

## Five failure questions

1. **Silent success-looking failure:** the previous destroy loss is closed by the synchronous flush (`agent-monitor.store.ts:1038-1045,1376-1400`). No new silent loss was established in the reviewed paths.
2. **User action:** closing the view immediately after output is covered by the updated destroy assertion (`agent-monitor.store.spec.ts:2598-2613`).
3. **Wrong answer from input data:** adjacent usage-bearing prose retains exact totals and content across early flushes (`agent-monitor.store.spec.ts:2627-2661`); the existing unbounded applied segment is noted above.
4. **Slow or absent dependency:** a suspended animation-frame clock triggers early queue flushes at the usage and character bounds (`agent-monitor.store.ts:1354-1367`; `agent-monitor.store.spec.ts:2616-2683`). The simulated clock does not prove browser visibility behavior.
5. **Requirement gap:** the plan bounds queued data but does not cap the content length of one already-applied prose segment (`agent-output-retention.ts:293-295`).

Verification: read the round 1 diff, batch notes, and changed store, frame, retention, and store-spec paths. No commands for tests, typecheck, lint, build, serve, e2e, or package were run here. The author reports 159 Jest tests and scoped typecheck/lint passing in `batch-4-notes.md` under “Review round 1”; those results were not independently reproduced.
