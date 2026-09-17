# TASK_2026_420 — Implementation notes (revision for S1, S2, M1)

Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-420-mid-turn-bubble-split`
(branch `fix/task-420-mid-turn-bubble-split`). All changes staged, not committed.

Note: `implementation-notes.md` is not in the set of documents the Tasks board reads
from a task folder. It was written because the orchestrator asked for it.

## S1: a failed send left a false boundary

- `StreamingAccumulatorCore.removeUserPromptBoundary(state, messageId): boolean`
  (`libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts`).
  - It removes the event from `events`, the bucket from `eventsByMessage`, the id from
    `messageEventIds` and the entry from `messageRevisions`, then calls
    `markStructuralChange`.
  - It removes only the boundary's own shape: a user `message_start` whose event id is
    its messageId. An SDK message with that id is never touched.
  - It bumps only `structuralRevision`. The boundary insert already defined that counter,
    so the builder's index memo keys on it. The root order change forces the tree rebuild.
- `StreamingHandlerService.removeUserPromptBoundary(tabId, messageId)`
  (`streaming-handler.service.ts`).
  - Tab resolution is workspace-aware, the same as `recordUserPromptBoundary`.
  - Active tab: `scheduleUpdate`. Background tab: `updateBackgroundTab`. Nothing is
    published when there was no boundary to remove.
  - Both methods now share two private helpers: `findTabStreamingState` and
    `publishBoundaryChange`.
- `MessageSenderService.runContinueConversation` (`message-sender.service.ts`).
  - New parameter `dropBubbleOnFailure = false`.
  - `sentPromptId` is set right after the bubble and boundary are written.
  - Both failure exits after that point call `rollBackUnsentPrompt`: the structural
    `chat:continue` failure branch, and the `catch`.
  - `rollBackUnsentPrompt` always removes the boundary. It removes the optimistic bubble
    only when `dropBubble` is true.
  - `continueExistingSessionForQueueFlush` passes `true`. The queue caller re-queues the
    text through `restoreFailedQueue`, so a retry now shows it once.
  - The direct send (`continueConversation`) passes nothing, so its bubble stays as before.
- If the turn finalizes before the RPC fails, the state has already been replaced. The
  boundary removal is then a no-op. On the queue path the bubble is still removed.

## S2: user roots are no longer tree output

- `ExecutionTreeBuilderService.buildTreeWithIndexes`
  (`execution-tree-builder.service.ts`).
  - A root whose `message_start.role === 'user'` sets `lastAssistantNode = null` and
    `continue`s. It is never built and never pushed.
  - Memo and identity reuse stay correct:
    - User ids stay in `rootOrder` and `digestByRoot`, so inserting or removing a
      boundary or echo still breaks the whole-tree reuse and re-runs the merge.
    - `nodeByRoot`, `ownerByRootIndex` and `reusedRoots` only ever see built,
      non-user nodes.
- `MessageFinalizationService.placeFinalizedTrees(existing, stateCopy, newMessages)`
  (`message-finalization.service.ts`).
  - Placement order walks `stateCopy.messageEventIds` over root messages
    (`findMessageStartEvent`, skipping `parentToolUseId`).
  - A user root is an anchor when its messageId is an existing user message's `id` or
    `nativeUuid`. The boundary and the SDK echo therefore land on the same bubble,
    deduplicated.
  - An assistant root maps to the message whose id is its `message_start` event id. A
    message merged into an earlier node has no slot of its own.
  - Unchanged:
    - Plain append when there is no anchor.
    - Stats go on the last new message.
    - Existing assistant ids are not anchors.
    - Existing messages after the first anchor that were not placed keep their order at
      the end.
  - Addition not asked for: a new message whose node matches no root is appended after
    the placed root order instead of being dropped. This cannot happen today, because
    every tree node comes from a root; it guards against silent loss.
- The `recordUserPromptBoundary` doc comment is updated. The boundary renders nothing
  itself; its id is what finalization anchors on.

### `buildTree` consumers checked

| Consumer | Result |
| --- | --- |
| `ChatTranscriptComponent.streamingMessages` / `_executionTrees` (chat; canvas tiles use the same component with the `tile-` key) | Fixed by this change. Every root is mapped to `role: 'assistant'`, so the SDK echo no longer renders as an empty assistant bubble. |
| `ChatStore.currentExecutionTrees` / `currentExecutionTree` (deprecated) | No consumers outside `chat.store.ts`. `[0]` is now the first assistant root instead of a possible user root. |
| `MessageFinalizationService.finalizeCurrentMessage` | Adjusted, see above. |
| `MessageFinalizationService.finalizeSessionHistory` | Unaffected. User messages are built from state events; assistant messages look up the tree node by `message_start.id`. |
| `harness-builder-view.component.ts`, `setup-wizard` `analysis-transcript.component.ts` | Unaffected as far as the frontend shows: neither source handles a user `message_start`. The backend streams were not traced. If one does emit a user root, it used to render as a message node and is now omitted. |
| `AgentMonitorTreeBuilderService` / `ptah-cli-output.component.ts` | Different builder. Unaffected. |
| chat-routing `StreamRouter` | Does not call `buildTree`. Unaffected. |
| `session-loader.service.spec.ts`, `chat-transcript.component.spec.ts` | Mock `buildTree`. Unaffected. |

### Existing specs moved to the new contract

All in `execution-tree-builder.service.spec.ts`:

- The 1 000-delta test now uses an assistant, user, assistant sequence. It still asserts
  only the changed message is rebuilt and the other root keeps its identity.
- The mid-turn boundary split test expects 2 roots, not 3.
- The prune identity test now feeds assistant roots separated by user turns. 400 user-only
  messages would build an empty tree.
- The resumed-history test expects 1 root, not 2.

In `message-finalization.service.spec.ts`, the three staged boundary tests are rewritten to
use a real root-order state (`makeRootsState`). The mocked tree no longer contains user
nodes.

## M1: new specs

- (a) `execution-tree-builder.service.spec.ts`, real accumulator and builder:
  - `splits once when the SDK echo of the prompt joins the boundary`: boundary, then the
    echo under the SDK uuid with its text, then a later assistant message. The tree has
    exactly the two assistant roots, split at the prompt.
  - `merges the turn back together once the boundary is removed`: checks the
    structural revision bump and that `messageEventIds`, `events` and `eventsByMessage`
    are cleared.
  - `never removes an SDK message through removeUserPromptBoundary`.
- (b) `message-finalization.service.spec.ts`. The tree builder is mocked, as in the rest
  of the file; the state carries real root starts.
  - `places the turn once around a prompt the boundary AND the SDK echo both mark`: the
    bubble has `nativeUuid` set to the SDK uuid. Result is before, prompt, after, with no
    extra message.
  - `anchors on the SDK echo alone through the stamped nativeUuid`.
  - `gives a message merged into an earlier node no slot of its own`.
- (c) S1:
  - `message-sender.service.spec.ts`, describe `a continue whose prompt never reaches
    the backend`:
    - Rejected direct send removes the boundary and keeps the bubble.
    - Thrown direct send does the same.
    - Rejected queue flush (`data.success === false`) removes the boundary and the bubble.
    - Thrown queue flush does the same.
    - A delivered continue rolls nothing back.
  - `streaming-handler.service.spec.ts`: removal on the active tab (scheduled update),
    removal through the background partition, and nothing published when no boundary
    exists.
  - `message-sender.session-identity.spec.ts`: the stub gains `removeUserPromptBoundary`.

## Files (staged)

- `D:/projects/ptah-extension/.claude-worktrees/task-420-mid-turn-bubble-split/libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-420-mid-turn-bubble-split/libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-420-mid-turn-bubble-split/libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-420-mid-turn-bubble-split/libs/frontend/chat-streaming/src/lib/message-finalization.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-420-mid-turn-bubble-split/libs/frontend/chat-streaming/src/lib/message-finalization.service.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-420-mid-turn-bubble-split/libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-420-mid-turn-bubble-split/libs/frontend/chat-streaming/src/lib/streaming-handler.service.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-420-mid-turn-bubble-split/libs/frontend/chat/src/lib/services/message-sender.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-420-mid-turn-bubble-split/libs/frontend/chat/src/lib/services/message-sender.service.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-420-mid-turn-bubble-split/libs/frontend/chat/src/lib/services/message-sender.session-identity.spec.ts`

## Verification (worktree root)

- `npx nx run-many -t test -p @ptah-extension/chat-streaming @ptah-extension/chat @ptah-extension/chat-execution-tree --skip-nx-cache`
  - Header: `Running target test for 3 projects`. Final run: `Successfully ran target test
    for 3 projects`, exit 0.
  - chat-execution-tree: 2 suites passed; 22 tests passed.
  - chat-streaming: 22 suites passed; 477 tests passed, 1 skipped (478 total).
  - chat: 69 suites passed; 1056 tests passed, 2 skipped (1058 total).
- Earlier runs during the revision, recorded for honesty:
  - Run 1: 4 failures in `message-finalization.service.spec.ts`. The spec's node ids did
    not match its root start ids. The spec was fixed; production code was unchanged apart
    from the fallback append described under S2.
  - Run 2, after prettier: 1 failure in the timing guard `builds ~5 000 deltas across 50
    tool calls well under a second` (871 ms against a 528 ms budget; that suite took
    180 s). That test streams a single assistant message and never reaches the user-root
    branch. The spec alone passed (23/23), and so did the final full run above. This is
    load-sensitive flakiness, not a regression.
- `npx nx run-many -t typecheck -p @ptah-extension/chat-streaming @ptah-extension/chat --skip-nx-cache`:
  2 projects passed.
- `npx prettier --check` on the 10 changed files flagged 3 spec files. They were formatted
  with `--write` before the final run.
- `npx nx reset` was not run.

## Observations (not changed)

- Stamping quirk in `TabManagerService.reconcileUserMessageNativeUuid` (chat-state,
  outside this batch). It stamps the FIRST user bubble that has an optimistic id and no
  `nativeUuid`. If an older bubble was never stamped, the echo's uuid lands on that older
  bubble instead.
  - With a boundary present, placement is still correct: the older bubble is already in
    the preserved prefix, so it is skipped.
  - Without a boundary (no live tree at send), the echo would anchor on the older bubble
    and move the messages after it to the end.
  - This is worth its own follow-up.
- M2 (rewind while a boundary is live) is untouched, as the disposition says.
- Out of scope, per the brief: the premature queue flush trigger (including the echo's
  own `message_complete`), and compaction or the event cap dropping the boundary.

## R1 revision (team-leader rejection): anchor by `id` only

This section replaces the `nativeUuid` anchor described under S2 above.

### Change

`placeFinalizedTrees` in `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts`:

- A user root is an anchor ONLY when its messageId equals an existing USER message's `id`.
  The `nativeUuid` match is gone.
- A user root that is not an anchor, such as the SDK echo, is skipped during placement.
- The doc comment explains why. `reconcileUserMessageNativeUuid` stamps the OLDEST
  unstamped bubble, so after a failed direct send the echo's uuid lands on the failed bubble
  and the reply was placed above its own prompt.
- Unchanged from round 2:
  - `buildTree` does not emit user roots, and they still break the merge.
  - Placement walks `messageEventIds`.
  - Stats go on the last new message.
  - Existing assistant ids are not anchors.
  - The plain append applies when there is no anchor.
  - The fallback append for a new message whose node matches no root stays.
- `reconcileUserMessageNativeUuid` (chat-state) is untouched. It is a follow-up.

### Spec changes (`message-finalization.service.spec.ts`)

- `places the turn once around a prompt the boundary AND the SDK echo both mark`: kept.
  Its comment now says the boundary anchors by id and the echo root is skipped. The
  expected order is still [before, prompt, after], with no extra message.
- `anchors on the SDK echo alone through the stamped nativeUuid` is inverted and renamed
  `never anchors on the SDK echo through a stamped nativeUuid`. With no boundary, the
  result is the plain append: [earlier, user-bubble, before, after].
- New R1 regression: `appends the reply after its own prompt when the echo uuid was
  stamped on an older failed bubble (R1)`.
  - Existing messages: earlier assistant, failed prompt (`msg_1_failed`, with
    `nativeUuid` = SDK uuid), failure notice, retry prompt (no `nativeUuid`).
  - State roots: echo(SDK uuid), then the reply assistant root. No boundary.
  - Expected: [earlier, msg_1_failed, notice, msg_2_retry, reply], with the stats on the
    reply.

### Verification (worktree root)

- `npx nx run-many -t test -p @ptah-extension/chat-streaming @ptah-extension/chat @ptah-extension/chat-execution-tree --skip-nx-cache`
  - Header: `Running target test for 3 projects`. Exit 0.
  - chat-execution-tree: 2 suites passed; 22 tests passed.
  - chat-streaming: 22 suites passed; 478 tests passed, 1 skipped (479 total).
  - chat: 69 suites passed; 1056 tests passed, 2 skipped (1058 total).
- `npx nx run-many -t typecheck -p @ptah-extension/chat-streaming @ptah-extension/chat --skip-nx-cache`:
  2 projects passed.
- `npx prettier --check` on `message-finalization.service.ts` and
  `message-finalization.service.spec.ts`: clean.
- Staged: those 2 files. The other 8 staged files from round 2 are unchanged. `npx nx reset`
  was not run.

## Round 4 specs (spec-only; no production code changed)

- Moderate-1: `message-finalization.service.spec.ts` gains `splits one turn around two
  prompts sent mid-turn, in root order`.
  - Existing messages: [msg0, prompt-a, prompt-b].
  - State roots, in order: [before, boundary prompt-a, mid, boundary prompt-b, after].
  - Expected: [msg0, before, prompt-a, mid, prompt-b, after]. Stats land only on `after`;
    `before` and `mid` have none.
- S3 behavior pin (the current behavior is accepted as correct): `message-sender.service.spec.ts`,
  inside `a continue whose prompt never reaches the backend`, gains `drops the undelivered
  prompt from a turn that finalized before the flush failed`.
  - A deferred `chat:continue` promise holds the RPC open after the queue flush writes the
    bubble and the boundary.
  - While the RPC is pending, the tab is replaced with a finalized
    [before, bubble, after] and `streamingState: null`.
  - The RPC then rejects.
  - Expected: the outcome resolves with `success: false` and nothing throws. The boundary
    removal is called. The messages are exactly [before, after], the same objects in order.

### Verification (worktree root)

- `npx nx run-many -t test -p @ptah-extension/chat-streaming @ptah-extension/chat --skip-nx-cache`
  - Header: `Running target test for 2 projects`. Exit 0.
  - chat-streaming: 22 suites passed; 479 tests passed, 1 skipped (480 total).
  - chat: 69 suites passed; 1057 tests passed, 2 skipped (1059 total).
- `npx prettier --write` then `--check` on the two spec files: clean. Prettier reformatted
  only `message-sender.service.spec.ts`.
- Staged: the two spec files. Not committed. `npx nx reset` was not run.
