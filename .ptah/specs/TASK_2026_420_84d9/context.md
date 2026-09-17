# TASK_2026_420 — Context

## User intent

"When sending a message while the agent is working, it doesn't split the agent
bubble while streaming, it only shows when the agent completes the whole round."
The user wants the live transcript to split at their message: output before it
stays above, output after it renders below — while the turn still streams.

Follow-up request: confirm the cause with an external stress review before
committing, then orchestrate the fix in a worktree off latest `main` using CLI
tools and subagents.

## Workspace

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-420-mid-turn-bubble-split`
- Branch: `fix/task-420-mid-turn-bubble-split` (from `origin/main` @ f7b2c1670)
- The fix was first written uncommitted on `fix/task-419-session-worktree-resume`
  in the main checkout and carried over as a patch (applied cleanly, staged).

## Strategy

- Type: BUGFIX, Partial workflow (fix exists and has one external review).
- CLI delegation: enabled (user: "use cli tools and subagents as you see fit").
  Available: `codex`, `antigravity` (cli), `ollama cloud` and `claude cli` (ptah-cli).
- Sequence: code-logic-reviewer + codex review (parallel) → senior-tester
  (full lib suites, gaps) → fix round if needed → team-leader verify + commit.

## Root cause (confirmed by Ollama Cloud review)

1. Mid-turn sends are queued and flushed in
   `StreamingHandlerService.processEventForTab` on any root `message_complete`
   with `stopReason !== 'tool_use'`.
2. The stream path `StreamEventTransformer.onMessageStop`
   (`libs/backend/agent-sdk/src/lib/message-transform/stream-event.transformer.ts`)
   emits `message_complete` with NO `stopReason` for every streamed message, and
   partial messages are on by default — so the flush fires after the first
   streamed message of a turn.
3. `MessageSenderService.runContinueConversation` appends the optimistic user
   bubble to `tab.messages`; the backend `SessionStreamPump` holds the prompt
   until the turn ends, so the SDK's user `message_start` echo only arrives then.
4. `ExecutionTreeBuilderService.buildTree` merges consecutive root assistant
   messages; only a user root breaks the merge. Live state has none, so later
   output merges into the bubble above the prompt.
5. `MessageFinalizationService.finalizeCurrentMessage` appended every new tree
   after existing messages, i.e. after the prompt.

## Fix (staged in the worktree)

- `StreamingAccumulatorCore.recordUserPromptBoundary(state, event)` — stores a
  user `message_start` (id = messageId = optimistic bubble id) without moving
  `currentMessageId` or touching dedup.
- `StreamingHandlerService.recordUserPromptBoundary(tabId, message)` — only for
  a live tree (`currentMessageId != null`); resolves the tab across workspaces;
  active tab → `scheduleUpdate`, background tab → `updateBackgroundTab`.
- `MessageSenderService.runContinueConversation` calls it after `setMessages`.
- `finalizeCurrentMessage`: stats on the last NEW tree; `placeFinalizedTrees`
  splices new messages in root order around the first existing USER anchor.

## Ollama Cloud review (verdict: ACCEPT WITH CHANGES)

- Cause: PARTIAL → mechanism wording corrected (stream path, see step 2).
- F1 stats fold with boundary-only tree: checked — NOT a regression (the fold
  requires the last message to be an assistant; the prompt is last). Pinned by
  a parity spec.
- F2 background-workspace tab got no boundary: FIXED + 3 specs.
- F3 compaction replacement state / F4 event-cap eviction drop the boundary:
  accepted, documented on `recordUserPromptBoundary`.
- Flush-trigger regression test: declined — it would pin the premature flush.
- F5 SDK echo user root may render as an assistant bubble: pre-existing, out
  of scope, needs its own investigation.

## Round 2 reviews (worktree, staged diff)

- `code-logic-review.md` (subagent): NEEDS_REVISION, 5/10 — S1, S2, M1, M2.
- codex (CLI): cause CONFIRMED; ACCEPT WITH CHANGES — rejected `chat:continue`
  leaves a false boundary (same as S1).

Dispositions (orchestrator, checked against code):

- S1 FIX — `runContinueConversation` writes bubble + boundary before the RPC;
  neither failure exit removes them. Roll the boundary back on every failed or
  thrown continue. On a failed QUEUE FLUSH also remove the optimistic bubble,
  because `restoreFailedQueue` returns the text to the queue (retry would
  otherwise show it twice).
- S2 FIX — confirmed: `handleDuplicateMessageStart` matches by messageId only;
  the SDK echo (commit ebbcaa16f, forwarded by `stream-transformer.ts:533`)
  enters `streamingState` as a user root, and the transcript maps every root
  to `role: 'assistant'`. Pre-existing (Ollama F5) but the boundary adds user
  roots too, so handle both: user roots break the assistant merge but are NOT
  emitted by `buildTree`; finalization derives anchors from
  `messageEventIds` order, matching a user root to an existing message by
  `id` OR `nativeUuid`.
- M1 ADD SPEC — boundary + real echo in one state: one split, no extra root,
  no minted message.
- M2 — note only (rewind is UI-gated while streaming).
- codex note: the echo's own `message_complete` (no stopReason) can flush a
  second queued prompt — pre-existing trigger, out of scope.
- Alternative "flush only at real turn end" — rejected: user asked for the
  split while streaming.

## Round 3 — team-leader verify (BATCH REJECTED, see batches.md)

- R1: anchoring on `nativeUuid` misplaces a reply after a failed direct send,
  because `TabManagerService.reconcileUserMessageNativeUuid` stamps the OLDEST
  unstamped optimistic bubble (the failed one). Regression vs round 1.
- Disposition (orchestrator): anchor by `id` ONLY. The `nativeUuid` anchor
  adds nothing — without a boundary it reproduces the plain append; with a
  boundary the boundary already anchors by id; a mid-turn prompt's echo
  normally lands in the next turn's state. The echo stays hidden (S2) and still
  breaks the merge; a non-anchor user root is skipped during placement.
  Remove/replace the nativeUuid-anchor specs and add an R1 regression spec.
- Follow-up (separate task, not this batch): the oldest-first stamping in
  `reconcileUserMessageNativeUuid` also mis-anchors fork/rewind after a failed
  send.
- Separate bug found meanwhile: Codex CLI agents never reach `completed` —
  `CodexCliAdapter.runTurn` waits for the SDK event iterator to end, which only
  happens when `codex.exe` exits; it stays alive with a long-lived PowerShell
  AST-parser child. Fix: return on `turn.completed` / `turn.failed`.
- Contract change (buildTree no longer returns user roots): settled —
  harness-builder and setup-wizard run through `InternalQueryService`, which
  never enables `replay-user-messages`.

## Round 4 — code-logic re-review (NEEDS_REVISION)

- S1, S2, M1, R1: confirmed fixed.
- S3 (queue-flush `chat:continue` fails AFTER the turn finalized → rollback
  drops the prompt bubble from the finalized array): race is real, but the
  current behaviour is ACCEPTED as correct. The prompt was never delivered, so
  it must not sit between reply parts the model produced without it; the user
  sees `showSendFailure` and the text back in the queue chip; the assistant
  messages stay intact and in order. The reviewer's proposed guard (keep the
  bubble AND requeue) reintroduces the duplicate S1 removed. Pin the behaviour
  with a spec.
- Moderate-1 (two mid-turn prompts, two boundaries in one state): code correct
  by trace; ADD a regression spec.

## Open design note

Split-at-send (this fix) vs holding the queue until the real turn end (matches
JSONL reload, delays the bubble). User asked for split-while-streaming; this
task implements that.

## Verification so far (main checkout)

- chat-streaming focused specs: 141 passed
- chat focused specs: 101 passed
- typecheck chat-streaming + chat: passed
- FULL suites via `nx run-many -t test` (main checkout, identical 9-file diff):
  chat-streaming 22 suites / 468 passed, 1 skipped; chat 69 suites / 1051
  passed, 2 skipped. Final re-run belongs in the worktree before commit.
