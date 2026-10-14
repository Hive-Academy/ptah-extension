# Context — non-last Task owner moves to the bottom after finalization

Source: PR #727 (TASK_2026_655_5c1e), review `code-logic-review-F-r3.md`, defect 2 (moderate).

## Problem

The resync repair in `session-history-replayer.service.ts` (about lines 354-390) removes the
owner row O from `tab.messages` and installs a live state that holds only O and its subagent
descendants. Root user prompts after O are not in that state.

While the subagent streams, `mergeByTime` (`chat-transcript.component.ts`) places O by its
`startTime`, so the order is right. At turn end, `message-finalization.service.ts:69-80` looks for
a user anchor in the filtered state, finds none, and `placeFinalizedTrees` returns
`[...existing, ...newMessages]`. O is appended after the rows that followed it.

## Reproduction

History rows: `[user-1, O, user-2, assistant-2]`. The live seed's `agent_start` parents to O's
Task. Switch workspace away and back, and let the subagent finish. During streaming the order is
correct. After the terminal `turn_state` it becomes `[user-1, user-2, assistant-2, O]`.
O's content shows once. Nothing is lost. Only the order is wrong.

## Suggested fix

Remember O's index among the frozen rows and pass it to the finalization placement, or keep an
anchor in the live state's `messageEventIds` so `placeFinalizedTrees` can place O. Do not append
when a frozen row with a later `startTime` exists.

## Acceptance

- A spec with the history above asserts the finalized `tab.messages` order is
  `[user-1, O, user-2, assistant-2]` and O appears once.
- The A-2 spec (O is the last row) still passes.
- Checks: `npx nx test @ptah-extension/chat --parallel=1`, typecheck, lint (scoped, serial).
- Can ship together with TASK_2026_674_fa33, which touches the same block.
