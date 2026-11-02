# Batch 8g-3 implementation report

## Files changed (including preserved prior-lane edits)

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/index.ts - Preserved internal composition-spec exports and typed error guard/code exports.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts - Native usage guard, manual request coalescing, success-only manual boundary and failure error callback.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts - Preserved automatic start deduplication and unfinished-stream failure cleanup.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts - Native 7/0/unknown usage, duplicate starts, manual failures/coalescing, stream failures and error guard coverage.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-event-callbacks.ts - No duplicate start; automatic success boundary; CHAT_ERROR on failure.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-event-callbacks.spec.ts - No host start, automatic completion trigger, failed compaction emits error without completion.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8g-3-report.md - This report.

## Decisions

- Keep the adapter setCompactionStartCallback route. The CLI runtime wiring forwards it to compaction_start, shared with Claude. The adapter knows both the manual intent and native usage; the host phase-only callback cannot supply these. Host callbacks never publish starts.
- Shared contracts retain required numeric preTokens. Only session.usage?.lastRequestTotalTokens supplies this number. Undefined usage skips the start callback and logs one debug line; genuine native zero is emitted. Cumulative and turn totals are never substituted.
- Successful manual compact() completion publishes compaction_complete with trigger manual. Successful automatic completion publishes it with trigger auto. Unknown starting usage does not suppress successful completion.
- Failed manual and automatic compactions never publish compaction_complete: there is no successful boundary and execution-tree/dedup reset would be incorrect. Manual rejection calls the existing session-level error callback and rethrows. Automatic failure calls the existing host error publisher. Both reach CHAT_ERROR; frontend ChatLifecycleService.handleChatError clears compaction state. Error text is fixed and does not expose native errors.
- Preserve overlapping manual request coalescing, automatic start deduplication and unfinished-stream cleanup. Stream cleanup forwards failed, which now reaches the same error route rather than a completion boundary.

## Spec evidence (written, not executed)

- Manual native samples 7 and 0 emit exactly one start with the manual trigger and exact count; undefined sample emits no start and logs the skipped-start message. Success publishes a manual boundary.
- Automatic samples 7, 0 and undefined cover repeated native starts. Known counts yield exactly one callback with auto trigger; unknown usage yields none and exactly one skipped-start debug message.
- Automatic failed phase and unexpected stream end forward failed once. Host failure spec asserts no stream publication and exactly one CHAT_ERROR, proving no compaction_complete is emitted.
- Overlapping manual requests call native compact once. Failure asserts no published events and one error callback; success asserts one manual completion and no error callback.
- Existing active-turn rejection and instanceof guard true/false cases remain.

## Verification

No tests, lint, typecheck, build, diagnostics or package operations were run. Verification remains assigned to the team leader under the machine-wide lock. Read-only source inspection and git diff --stat were used; no verification success is claimed.
