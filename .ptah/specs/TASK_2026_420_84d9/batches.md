# Batches - TASK_2026_420_84d9

Total tasks: 3 | Batches: 1 | Complete: 1/1

Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-420-mid-turn-bubble-split`
(branch `fix/task-420-mid-turn-bubble-split`, base `origin/main` f7b2c1670).

## Plan validation

Status: PASSED WITH RISKS (no implementation-plan.md; the plan is `context.md` "Fix" plus the
"Round 2 reviews", Round 3 and Round 4 dispositions)

Assumptions:

- The SDK echoes a live prompt as a root user `message_start` (id = SDK uuid) with a text delta.
  Verified: `libs/backend/agent-sdk/src/lib/message-transform/user-message.transformer.ts:117-151`,
  enabled by `replay-user-messages` in `sdk-query-options-builder.ts:889-892`.
- `nativeUuid` on a bubble identifies THAT bubble's echo. FALSE in one reachable case (R1).
  Resolved: finalization no longer reads `nativeUuid`.

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| Failed continue leaves a false boundary or a duplicate bubble (S1) | HIGH | Task 1.1. Verified addressed |
| SDK echo renders as an empty assistant bubble (S2) | HIGH | Task 1.2. Verified addressed |
| `buildTree` no longer returns user roots (contract change) | MEDIUM | Consumer trace, see verification item 2 |
| `nativeUuid` anchor trusts `reconcileUserMessageNativeUuid`, which stamps the OLDEST unstamped bubble (R1) | HIGH | RESOLVED. Anchor by `id` only; R1 regression spec |
| Queue-flush failure after the turn finalized drops the prompt bubble (S3) | MEDIUM | ACCEPTED as correct by the orchestrator (context.md Round 4); pinned by spec |
| Two mid-turn prompts in one state (Moderate-1) | LOW | Two-boundary regression spec |
| Compaction or the event cap drops the boundary (F3/F4) | LOW | Accepted, documented on `recordUserPromptBoundary` |

Edge cases:

- Boundary and SDK echo in one state: handled in Tasks 1.2 and 1.3
- Queue-flush failure (rejected or thrown): handled in Task 1.1
- Idle send after an earlier failed direct send (R1): handled in Task 1.2, pinned in Task 1.3
- Queue-flush failure after finalization (S3): accepted behavior, pinned in Task 1.3
- Two boundaries in one state: pinned in Task 1.3

Follow-ups (separate tasks, not this batch):

- `TabManagerService.reconcileUserMessageNativeUuid` stamps the oldest unstamped bubble; this
  also mis-anchors fork/rewind after a failed send.
- M2: rewind while a boundary is live is untested (UI-gated while streaming).

## Batch 1: mid-turn bubble split + review revision — COMPLETE (commit bba7b30f1)

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer (a fresh instance) with this record as input
- Execution mode: sequential
- Rationale: tightly coupled changes across the streaming write path, finalization and the
  sender. One contract (user roots) spans every file.
- Tasks: 3 | Depends on: none

Files (10, committed in bba7b30f1):

- `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts`
- `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts`
- `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.spec.ts`
- `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts`
- `libs/frontend/chat-streaming/src/lib/message-finalization.service.spec.ts`
- `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts`
- `libs/frontend/chat-streaming/src/lib/streaming-handler.service.spec.ts`
- `libs/frontend/chat/src/lib/services/message-sender.service.ts`
- `libs/frontend/chat/src/lib/services/message-sender.service.spec.ts`
- `libs/frontend/chat/src/lib/services/message-sender.session-identity.spec.ts`

### Task 1.1: boundary record + rollback on failed continue (S1) — COMPLETE

- Verified in the diff:
  - `accumulator-core.service.ts`: `recordUserPromptBoundary` and `removeUserPromptBoundary`.
    Removal is shape-guarded and bumps `structuralRevision`.
  - `streaming-handler.service.ts`: both are workspace-aware and publish to the active or
    background tab.
  - `message-sender.service.ts`: the boundary is written and `sentPromptId` set after
    `setMessages`; the structural-failure exit and the catch both call `rollBackUnsentPrompt`;
    the queue flush passes `dropBubbleOnFailure = true`; the bubble is dropped only on that flag.

### Task 1.2: user roots break the merge, not emitted; finalization anchors by id (S2, R1) — COMPLETE

- Verified in the diff:
  - `execution-tree-builder.service.ts`: a user root resets `lastAssistantNode` and
    `continue`s.
  - `message-finalization.service.ts` `placeFinalizedTrees`: walks `messageEventIds`; a user
    root anchors only through `promptById.get(messageId)`, a map keyed by existing USER message
    `id`. A non-anchor user root (the SDK echo) is skipped.
  - `nativeUuid` appears in the file only in the doc comment that explains why it is not used.
    No `nativeUuid` anchor path remains.
  - `finalizeCurrentMessage` puts stats on the last NEW tree.

### Task 1.3: specs (M1, R1, S3 pin, Moderate-1) — COMPLETE

- Verified on disk:
  - `message-finalization.service.spec.ts:390` boundary + echo: [before, prompt, after].
  - `message-finalization.service.spec.ts:429` `never anchors on the SDK echo through a stamped
    nativeUuid`: no boundary gives the plain append [earlier, user-bubble, before, after].
  - `message-finalization.service.spec.ts:471` R1 regression: existing
    [earlier, msg_1_failed(nativeUuid = echo uuid), notice, msg_2_retry], roots [echo, reply],
    expects [earlier, msg_1_failed, notice, msg_2_retry, reply] with stats on the reply.
    Matches context.md Round 3.
  - `message-finalization.service.spec.ts:530` two boundaries: existing [msg0, prompt-a,
    prompt-b], roots [before, boundary a, mid, boundary b, after], expects
    [msg0, before, prompt-a, mid, prompt-b, after], stats only on `after`. Matches Round 4
    Moderate-1.
  - `message-sender.service.spec.ts:427` S3 pin: a deferred `chat:continue`; the tab is
    finalized to [before, bubble, after] with `streamingState: null` while the RPC is pending;
    the RPC rejects; expects `success: false`, boundary removal called with the bubble id, and
    messages exactly [before, after] as the same objects. Matches Round 4 S3 acceptance.
  - Earlier M1 and S1 specs (builder boundary+echo, removal, sender rollback, handler removal)
    unchanged from round 2.

### Batch 1 verification

1. Dispositions:
   - S1 FIX: addressed.
   - S2 FIX: addressed.
   - M1 ADD SPEC: addressed.
   - M2: note only, unchanged, as disposed.
   - R1 (Round 3): FIXED. Anchor by `id` only; confirmed in code and by the code-logic
     re-review (`code-logic-review.md`, R1 row).
   - S3 (Round 4): ACCEPTED by the orchestrator as correct behavior; pinned by spec. Not a
     defect for this gate.
   - Moderate-1 (Round 4): regression spec added.
2. Contract change (`buildTree` omits user roots): harness-builder and setup-wizard run through
   `InternalQueryService`, which never enables `replay-user-messages`; subagent user messages
   carry `parentToolUseId`. CONCLUSIVE (unchanged from the first verification).
3. Gates, re-run by team-leader from the worktree root on 2026-09-11 (no `nx reset`):
   - `npx nx run-many -t test -p @ptah-extension/chat-streaming @ptah-extension/chat
     @ptah-extension/chat-execution-tree --skip-nx-cache`: header "Running target test for 3
     projects". Exit 0.
     - chat-execution-tree: 2 suites, 22 passed.
     - chat-streaming: 22 suites, 479 passed, 1 skipped (480).
     - chat: 69 suites, 1057 passed, 2 skipped (1059).
     - The timing-budget spec passed on the first run; no re-run needed.
   - `npx nx run-many -t typecheck -p @ptah-extension/chat-streaming @ptah-extension/chat
     --skip-nx-cache`: 2 projects. Exit 0.
   - `npx nx run-many -t lint -p @ptah-extension/chat-streaming @ptah-extension/chat
     --skip-nx-cache`: 2 projects, 0 errors, 2 + 17 warnings, exit 0. No warning names a staged
     file, so no new lint findings.
   - `npx prettier --check` on the 10 staged files: all clean.
4. `git status` before commit: exactly the 10 staged files; nothing unstaged or untracked.
5. Commit: `bba7b30f1 fix(chat-streaming): split the live bubble at a mid-turn prompt`.
   Hooks ran (no `--no-verify`), exit 0, no reformat, working tree clean after commit.
   Conforms to `.commitlintrc.json` (type `fix`, scope `chat-streaming`, subject under 72).
   Not pushed, no PR.

### R1 — history (rejected in Round 3, resolved)

- Trigger was a failed direct send followed by a successful idle retry. The retry's SDK echo was
  stamped onto the failed bubble by `reconcileUserMessageNativeUuid`, and the `nativeUuid`
  anchor then placed the reply above its own prompt.
- Resolution: the `nativeUuid` match was removed from `placeFinalizedTrees`; a user root anchors
  only on an existing user message `id`. Pinned by the R1 regression spec
  (`message-finalization.service.spec.ts:471`).

Batch state: COMPLETE. Task carrier moved to `in_review`.
