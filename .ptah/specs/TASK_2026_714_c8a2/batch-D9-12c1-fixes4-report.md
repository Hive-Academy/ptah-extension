# Codex history projector fix

## Root cause

The projector sent `item/started` and `item/completed` with only `threadId`, `turnId`, and `item` (formerly `codex-history-projector.ts:142-146`). The pinned notification schemas require `startedAtMs` and `completedAtMs`, respectively (`codex-protocol-methods.ts:380-385`). The translator parses those schemas before mapping an item (`codex-event-translator.ts:186-213`). On failure, its valid item envelope becomes an `unsupportedItem` error (`codex-event-translator.ts:188-196`), which the projector records as a skipped item. No `turn/started` state or constructor thread binding is required: the translator constructor takes context ID and generation (`codex-event-translator.ts:99-102`), and its item path uses the notification's `threadId` and `turnId` (`codex-event-translator.ts:303-313`). The live chat turn maps runtime events through `CodexChatEvents` (`codex-chat-turn-stream.ts:153-169` and its event loop), matching the history projector's mapper.

The test's direct live translator comparison also omitted these notification timestamps (formerly `codex-history-projector.spec.ts:89-92`). The item fixtures are typed as `CodexHistoryTurn['items']` (`codex-history-projector.spec.ts:11-24`), whose type comes from the `thread/turns/list` result (`codex-runtime.types.ts:305-316`); the modeled item fields match `codex-protocol-schemas.ts:201-335`. The fault was the envelope, not the fixture item shapes.

## Changes

- `codex-history-projector.ts:142-153`: add `startedAtMs` or `completedAtMs` to each translated notification. Both use the current projected item timestamp, which comes from the optional entry timestamp and is clamped to preserve order (`codex-history-projector.ts:29-31,180-181`).
- `codex-history-projector.spec.ts:89-97`: give the direct live translator comparison valid notification timestamps. The spec still starts with `import 'reflect-metadata';` at line 1 and retains every assertion.

## Manual review of all 12 reported failures

1. **Complete ordered turns, child cards, IDs, usage:** valid notifications now produce reasoning, tool, and text events; the existing user events, terminal mapping, parent link, ordering, and null usage paths then satisfy the assertions at `codex-history-projector.spec.ts:55-79`.
2. **Live translator and mapper presentation:** both paths now pass valid envelopes to the same translator and `CodexChatEvents` mapper; the tool shapes and assistant start at `codex-history-projector.spec.ts:82-108` can be compared as intended.
3. **Partial or non-monotonic entries:** each agent message completion now yields its text; `itemTime` clamps the second entry and absent third entry to 120500 ms, preserving A, B, C order (`codex-history-projector.spec.ts:107-122`).
4. **Interrupted settlement:** the valid agent message opens assistant content, so the terminal path emits `message_complete` with `interrupted` (`codex-history-projector.spec.ts:124-135`).
5. **In-progress settlement:** the same path maps `inProgress` history to an `interrupted` terminal (`codex-history-projector.ts:230-237`; `codex-history-projector.spec.ts:124-135`).
6. **Async question, compaction, user content:** the completed async agent item yields question text; the projector's presentation hint maps it to `text_delta`, while the existing three explicit skip reasons remain (`codex-history-projector.ts:157-161,182-189`; `codex-history-projector.spec.ts:167-181`).
7. **Unresolved child scope:** the child answer now maps to text and retains the synthesized parent tool ID and `unresolvedParentTool` record (`codex-history-projector.ts:88-97`; `codex-history-projector.spec.ts:183-190`).
8. **Non-spawn child and grandchild:** valid collaboration tool starts now create both `agent_start` cards, while the grandchild text carries its linked tool ID (`codex-history-projector.ts:70-83,172-177`; `codex-history-projector.spec.ts:192-206`).
9. **Cross-thread collaboration:** the existing parent-tool lookup links `cross-child` to `cross-thread-spawn`; valid agent completion now emits its scoped text (`codex-history-projector.ts:70-97`; `codex-history-projector.spec.ts:208-218`).
10. **Root/child self-link guard:** the root answer now emits events without a parent tool ID; the rejected root/self collaboration link leaves the child answer under the unresolved parent ID (`codex-history-projector.ts:74-76,88-95`; `codex-history-projector.spec.ts:220-239`).
11. **Ancestor/descendant guard:** `createsParentCycle` rejects the grandchild's attempted link to its ancestor; the child answer now emits text under its unresolved parent ID, with no inappropriate `agent_start` (`codex-history-projector.ts:34-46,74-76`; `codex-history-projector.spec.ts:241-254`).
12. **Unsupported item privacy:** valid known items no longer enter `skippedItems`; the future item still fails the item schema and produces one sanitized `unsupportedItem`, without exposing its secret payload (`codex-event-translator.ts:188-196`; `codex-history-projector.spec.ts:256-264`).

## Files touched and verification

- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\codex-history-projector.ts`: CR count 0; no BOM.
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\codex-history-projector.spec.ts`: CR count 0; no BOM.
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\.ptah\specs\TASK_2026_714_c8a2\batch-D9-12c1-fixes4-report.md`: CR count 0; no BOM.

The supplied failure log was read in full. The files are currently untracked in this worktree, so `git diff` does not display their edits. No tests, lint, typecheck, build, Nx, npm, Jest, or diagnostics were run, per task instructions. A CLI skill invocation mechanism was unavailable; the repository skill catalog was inspected and no listed skill covers this focused Codex history envelope fix.

## UNCONFIRMED

- The coordinator has not yet rerun the 12 failing tests after this fix; pass status is a manual trace, not an observed test result.
- The hand-built snapshot's behavior against a pinned live Codex binary remains unconfirmed, as noted in the source fixture.
