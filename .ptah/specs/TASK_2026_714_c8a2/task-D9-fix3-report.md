# D9 fix batches 3+4 — native sub-agent card

## Summary

Native `spawnAgent` is translated into the existing Claude Task/agent event contract. A live context admits only child threads linked by that spawn's `receiverThreadIds`; child events carry the spawn tool ID as `parentToolUseId`. The chat mapper keeps child turn state separate from the root turn and holds a successful spawn's `tool_result` until the child terminal arrives. History uses the same translator and mapper, links child messages, and orders the spawn result after the first linked child completion. A completed `wait` still emits its matching `tool_result` in both paths. No frontend code or MCP translation was changed.

## Files changed

1. `libs/backend/codex-runtime/src/lib/codex-event-translator.ts` — Task input from native prompt; child IDs on spawn start/completion.
2. `libs/backend/codex-runtime/src/lib/codex-runtime.types.ts` — optional child linkage and parent tool ID in runtime events.
3. `libs/backend/codex-runtime/src/lib/codex-context.ts` — admit linked child threads, nest their events, preserve root turn lifecycle.
4. `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.ts` — Task and `agent_start` mapping, per-child projections, delayed spawn result.
5. `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.ts` — use shared agent mapping and align spawn result time with child completion.
6. `libs/backend/codex-runtime/src/lib/codex-event-translator.spec.ts` — spawn metadata and completed wait case.
7. `libs/backend/codex-runtime/src/lib/codex-context.spec.ts` — linked child, nested grandchild, and foreign thread admission cases.
8. `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.spec.ts` — live/history contract parity, card completion timing, root lifecycle, wait result.

Other concurrent changes shown by `git status` in `auth-providers`, `sdk-query-options-builder`, protocol process/validator, and session history were not made or reverted by this lane.

## Emitted contract

For a native `spawnAgent` with tool ID `spawn` and child thread `child`, live and history emit:

1. Root `message_start`, then `tool_start` with `toolCallId:'spawn'`, `toolName:'Task'`, `isTaskTool:true`, and `toolInput:{subagent_type:'codex', description, prompt?}`. `description` is the first line of the real prompt, or the neutral label `Codex sub-agent`; `prompt` is included only when present. This follows Claude's Task `tool_start` in `libs/backend/agent-sdk/src/lib/message-transform/stream-event.transformer.ts:401-428` and the frontend card gate in `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts:710-744`.
2. `agent_start` with `toolCallId:'spawn'`, `agentId:'child'`, `agentType:'codex'`, the same description and optional prompt, and `parentToolUseId:'spawn'`. This matches Claude's `task_started` event shape in `libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.ts:284-301`. It is emitted once even if both native start and completion report the child ID.
3. Child `message_start`, `text_delta`/`thinking_delta`, nested tool events, and `message_complete`, each carrying `parentToolUseId:'spawn'`. A child terminal does not invoke the root result callback. Claude's stream transformer also propagates `parentToolUseId` on tool events (`stream-event.transformer.ts:415-425`). Grandchild events carry their own spawning tool ID.
4. The root spawn `tool_result` follows the first linked child `message_complete`, closing the agent card at child completion. A root terminal flushes an unresolved result so the card does not remain Running indefinitely. History applies the same child-completion order to its timestamped events.
5. A native `wait` remains an ordinary `tool_start` (`isTaskTool:false`) followed, when Codex reports it completed, by a `tool_result` with the same `toolCallId`. `sendInput` likewise remains an ordinary tool pair; neither creates another agent card.

History `agent_start` has `source:'history'`; live has `source:'stream'`. The parity spec compares the semantic event list, IDs, inputs, parent links, result values, and statuses while excluding source, generated event IDs, and timestamps. History user messages remain handled separately by the existing projector.

## Decisions

- Used `codex` as the neutral agent type because the native item has `prompt` and `model` but no validated agent-role field (`codex-protocol-schemas.ts:351-386`). A model name is not an agent type. No prompt text is synthesized or logged.
- Delayed a successful root spawn result until its child turn completes; failed/cancelled spawn calls still return their result immediately. Follow-up `wait` and `sendInput` never create duplicate agent starts.
- Kept child result callbacks separate from the root callback. `codex-chat-turn-stream.ts` settles the root only after that callback sets terminal status; its `message_complete` check is inert for a child completion while the root is active.
- Stayed within eight allowed source/spec files and the backend translation layer. No connected matching backend skill was available through local Ptah skill discovery; no skill was applied. The Ptah symbol index was empty and `rg` was access-denied, so source lookup used PowerShell as the fallback.

## Open risks

- The task prohibited test, typecheck, lint, build, and live Electron commands. Specs were added but not executed; a live Electron spawn/reload check is still needed to confirm native notification order, agents-panel rendering, and history hydration.
- If a child event arrives before Codex has reported its ID in the spawn item, the live context still drops it as foreign. The spawn completion can supply IDs when the start item did not.
- If the root turn terminates before a linked child turn, the root-terminal fallback flushes the pending spawn result; that unusual background ordering can close the card before the child's eventual terminal. The live turn stream may also end before the later child event is delivered. The observed spawn/sendInput/wait sequence should be checked live.
- A nested spawn inside a child projects its grandchild messages correctly, but its own `tool_result` is not delayed by the live nested mapper. This needs a live nested-agent check if strict completion timing is required at every depth.
- The historical `thread/list` rejection described in the diagnosis remains outside this batch; a failed history read would prevent the projector from running.

## Degradation audit

`npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` exited 0: 4,343 files scanned, 281 unsuppressed sites at or below directory baselines. No baseline was changed. `git diff --check` passed. All eight edited TypeScript files were checked for CR and UTF-8 BOM; none were present.

## Revision 1

This revision supersedes the timing and early-child risks above. It changes only the allowed backend files; the other concurrent workspace changes were left intact.

| Review defect | Fix | Source location | Focused spec |
| --- | --- | --- | --- |
| 1. Duplicate history IDs | Terminal `tool_result` IDs include their own `toolCallId`. | `codex-history-projector.ts:291-296` | `codex-history-projector.spec.ts:55` (two spawns, distinct IDs) |
| 2. Different result timing | Live holds each spawn until **all** receivers terminate. History inserts each held result after its last linked child `message_complete` by event order, without adding a millisecond. Final child text becomes the result output. | `codex-chat-events.ts:145-154,181-190,365-377`; `codex-history-projector.ts:107-147` | `codex-chat-events.spec.ts:26`; `codex-history-projector.spec.ts:55` (multi-receiver live/history contract equality) |
| 3. Untested live loop | The notification-loop spec feeds actual native frames and checks child isolation, foreign-thread exclusion, nested linkage, and cleanup. | `codex-context.ts:384-585` | `codex-context.spec.ts:8` |
| 4. Events before linkage | `thread/started` links a sole pending spawn through `thread.parentThreadId`; otherwise unknown-thread events enter a bounded 64-event/8-thread buffer, replayed when the native receiver ID arrives. Overflow reports an `Error` without payload content. | `codex-context.ts:387-402,456-517` | `codex-context.spec.ts:8` |
| 5. Child terminates first | Terminal child IDs and final text are retained in the turn mapper; spawn completion immediately emits its result if all receivers have already ended. | `codex-chat-events.ts:105-155,365-377` | `codex-chat-events.spec.ts:58` |
| 6. Root terminates first | The stream continues forwarding linked children for up to 30 seconds. On expiry it emits an empty error result to close the card without claiming a child answer. The context retains the root approval scope during this drain. | `codex-chat-turn-stream.ts:383-390`; `codex-context.ts:527-585` | `codex-chat-turn-lifecycle.spec.ts:208`; `codex-context.spec.ts:8` |
| 7. Result content | Live uses each receiver's final assistant text, joined in receiver order; history uses the last assistant message in each linked child snapshot. Missing text yields an empty string. | `codex-chat-events.ts:145-154`; `codex-history-projector.ts:116-124` | `codex-chat-events.spec.ts:26,58`; `codex-history-projector.spec.ts:55` |
| 8. Child compaction/approval | Only root compaction calls `finishCompact()`. Linked child `fileChange` and MCP item starts register approval targets; child turn IDs are accepted by the existing approval bridge through the root context while active. No approval-sink file needed editing: `codex-approval-bridge.ts:252-315,406-413` already resolves the context target. | `codex-context.ts:160-184,296-307,408-455,540-568` | `codex-context.spec.ts:8` (child target and compaction isolation) |
| 9. Child-tool cleanup | Active child links and turn IDs are removed on child terminal, root-turn cleanup, and context close; a bounded 256-entry parent cache permits a later turn on the same child thread to relink. | `codex-context.ts:91-100,438-445,483-501,524-585,1100-1108` | `codex-context.spec.ts:8` |
| 10. Nested spawn timing | Child projections share the pending-result state; grandchild completion releases a nested spawn's result after its own terminal. | `codex-chat-events.ts:101-190,365-377` | `codex-chat-events.spec.ts:76` |
| 11. Missing history receiver | History filters spawn receiver IDs to children actually linked in the snapshot before emitting `agent_start`. | `codex-history-projector.ts:64-89,196-210` | `codex-history-projector.spec.ts:55` and existing unresolved-parent cases |
| 12. Long lines | Revised the new context-loop lines over 100 characters. | `codex-context.ts:384-585` | Formatting inspection |

The emitted sequence for a two-receiver spawn is `tool_start(Task, isTaskTool:true)` → `agent_start` per linked child → child events with `parentToolUseId` equal to the spawn ID → each child's `message_complete` → the spawn `tool_result` after the **last** child completion. A completed `wait` remains its ordinary `tool_start`/`tool_result` pair. This follows the Claude Task/agent event producers at `stream-event.transformer.ts:401-428` and `system-message.transformer.ts:284-301`. Live and history normalize to the same semantic sequence in the multi-receiver spec. If the parent ends first, its `message_complete` precedes late child events while the 30-second drain remains open.

### Decisions and remaining risks

- The same native child thread may run again after `sendInput`; a bounded parent cache restores its card link on the next `turn/started`. Active `childTools` entries are still pruned at terminal.
- The 30-second background bound avoids an indefinitely retained chat stream. A child still running at expiry closes with `output:null` and `isError:true`; a later child completion cannot appear in that finished stream. A live Electron spawn/approval/reload check is still needed to validate native notification order and the visible card.
- The review asked for `degradation-audit` suppression markers on the intentional child result/error no-op callbacks. The audit treats those markers as *orphaned suppressions* because the callbacks contain no catch site, raising `libs/backend/agent-sdk` from its baseline of 4 to 6. Plain explanatory comments preserve the audit ratchet; this exact marker request remains unmet.
- Test, typecheck, lint, build, and live Electron commands were prohibited and were not run. All eight edited TypeScript files parsed with Ptah's AST tool (`ok`, zero error nodes). `git diff --check` passed; the eight edited files had no CR or UTF-8 BOM.

### Degradation audit after Revision 1

`npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` exited 0: 4,344 files scanned; `libs/backend/agent-sdk` 4 against baseline 4; 281 unsuppressed sites total. No baseline was changed.
