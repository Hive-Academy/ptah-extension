# Implementation plan review — round 4

Verdict: APPROVED

Score: 8/10. Both round-three Serious findings are fixed in the operative plan. The remaining synthesized-id duplicate is an explicit fidelity tradeoff, with a regression case, rather than silent data loss. This reaches the sound 7–8 band; it does not reach 9–10 because the plan still permits a visible duplicate for the life of an entry and implementation has not been verified. Review scope was limited to the two fixes and P1–P4 consistency; no tests or source changes were made.

| Round-three finding | Result | Evidence |
| --- | --- | --- |
| 1. Completion cleanup inferred identity from text and ran before complete content existed | **Fixed.** Operative merge matches only equal SDK `messageId` or a shared `tool_start.toolCallId`; unproven text-only copies remain visible. The late alias is expressly removed, and the event-order regression case feeds events one at a time. | Plan lines 590–598, 615–627, 683–689, 1072–1080. The synthesized stream id is deliberately retained at `libs/backend/agent-sdk/src/lib/message-transform/stream-event.transformer.ts:204-216`; stream stop clears it at :315–332. The complete path uses `message.id` at `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:88` and emits start, deltas, complete at :354–363, :413–430. Text enters on deltas at `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:297-321`. These are why content or arrival order cannot prove identity. |
| 2. Page budget omitted the RPC `correlationId` | **Fixed.** The budget measures `{success,data,correlationId}` with a 64-character id and 32-character cursor reservation, then remeasures the page and cuts trailing events with the cursor recomputed. Near-cap and cut-back tests are specified. | Plan lines 455–478, 505–509, 1055. The existing precedent reserves those lengths at `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:260-262`, encodes that wire shape at :342–353, computes the envelope budget at :991–1005, and checks the final page at :1025–1027. |

## User decisions and parity

| Decision | Result | Evidence |
| --- | --- | --- |
| P1 — parent-only tool/file counts | Applied in B5 acceptance and the decision inventory. | Plan lines 975–976, 834–836, 1096–1097. The parity inventory moves subagent content out of the main tree at lines 824–825; no operative instruction adds it back to parent counts. |
| P2 — restored bubble loads on click | Applied in component 9, B5, and the decision inventory. | Plan lines 743–747, 763, 975–977, 837, 1098–1099. The parity inventory moves the old bubble transcript action to the store tree at line 814. |
| P3 — keep `agent:summary-chunk` | Applied, with the duplicate display suppressed when the store tree exists. | Plan lines 750–752, 977–978, 838, 1100–1101. The parity inventory moves subagent execution content at line 824 but does not direct removal of this summary path. |
| P4 — leave generated baseline | Applied in B5, the decision inventory, and removal verification. | Plan lines 789–792, 978–979, 839, 1102–1103. The source guard is described at lines 102–106; the baseline entry is explicitly retained. |

The round-one and round-two revision logs at plan lines 1122–1137 recount earlier open decisions and withdrawn alias rules. The round-three log at lines 1140–1151 explicitly supersedes that history; the operative instructions above are consistent.

## New findings

No new Critical or Serious finding in the round-three edits. The visible two-copy case is specified at plan lines 621–627 and tested at 683–689; it preserves text when source identity is unknowable. The full-envelope check in lines 473–477 closes the boundary that caused the prior page overflow. This is a plan review; it does not assert that the proposed code has been implemented or exercised.

## Failure-mode questions

1. **Silent failure:** An unproven text-only match no longer silently hides live text; both copies remain visible (plan 595–598, 621–627).
2. **User action:** Opening restored output loads on click, while opening a lane loads on open (plan 743–747, 1057); the accepted duplicate can be seen in either view.
3. **Wrong-answer input:** Two distinct messages with identical text remain distinct because text is excluded from identity (plan 595–598, 683–689).
4. **Dependency failure or malformed shape:** The surrounding history contract distinguishes `not-found`, `unresolved`, empty and read errors (plan 483–489); this round changed no such contract. An oversized assembled page is cut back or raises an error (plan 473–477).
5. **Unspecified requirement:** A durable real-id bridge for synthesized stream messages would remove the visible duplicate; it is recorded as a follow-up rather than inferred from text (plan 1072–1080).

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Approve this narrow plan revision. | APPROVED / REVISE. The two Serious causes are removed at plan 595–598, 615–627 and 455–478; P1–P4 are consistent in B5 and the inventories at 829–839, 972–979. | Yes; implementation review can still reject code that diverges from the plan. |
