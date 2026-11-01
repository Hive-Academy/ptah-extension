# Batch D9-12c-1 projection report

## Changed files

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.ts` — deterministic snapshot projection with `events`, `stats: null`, and recorded skip reasons.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.spec.ts` — hand-built pinned-schema fixture covering two root turns, a child turn, mapping parity, stable IDs, absent usage, and unsupported items.
- `libs/backend/codex-runtime/src/index.ts` — strictly required public export of the existing `CodexEventTranslator`, so agent-sdk can reuse it without a cross-project deep import.
- `.ptah/specs/TASK_2026_714_c8a2/batch-D9-12c1-report.md` — this report.

## Design

The projector replays `item/started` and `item/completed` through `CodexEventTranslator`, then passes its runtime events through `CodexChatEvents`. This retains the live text, reasoning, tool input, tool result, and ID logic. User messages are projected separately, as in the live turn stream. The projector uses snapshot thread/turn/item IDs and timestamps, sorts all root and child events chronologically, and links child messages to their spawning collaboration tool with `parentToolUseId`. A synthetic terminal closes each assistant turn. Unsupported native items are recorded in `skippedItems`; no protocol payload is included in that record. `stats` is `null`, and no usage event is fabricated.

| Native item | Flat event projection |
| --- | --- |
| `userMessage` text | `message_start(user)`, `text_delta`, `message_complete`; `clientId` becomes `clientMessageId` |
| `userMessage` image/localImage | `message_start.imageCount`; no image bytes or URL are invented |
| `agentMessage` | `message_start(assistant)`, `text_delta`, `message_complete` |
| `reasoning`, `plan` | `message_start(assistant)`, callback-derived `thinking_delta`, `message_complete` |
| `commandExecution` | `tool_start`, `tool_result` via live presentation mapper |
| `fileChange` | `tool_start`, `tool_result` via live presentation mapper |
| `mcpToolCall` | `tool_start`, `tool_result` via live presentation mapper |
| `dynamicToolCall` | `tool_start`, `tool_result` via live presentation mapper |
| `collabAgentToolCall` | `tool_start`, `tool_result`; `spawnAgent` also yields an `agent_start` card per receiver child thread |
| child-thread items | normal user/assistant/tool events with `parentToolUseId` pointing to the spawn tool |
| unsupported item/content | omitted from UI and recorded with a reason in `skippedItems` |

## Checks

- Hand-built spec added but **not executed**. The coordinator explicitly owns tests, lint, typecheck, Nx, and diagnostics.
- `git diff --check`: passed for tracked changes.
- `tr -cd '\r' < file | wc -c`: **0** for the projector, spec, and public index. BOM checks were false for all three. The report was written with LF by `apply_patch` and is checked below before handoff.
- The worktree also has a concurrent modification to `.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`; this batch did not edit it.
- Skill search found no local matching skill for this backend projection task.

## UNCONFIRMED

- The fixture follows the pinned schema; no authorized pinned-binary `thread/read` capture was available. Its paginated and child-thread runtime shape remains unconfirmed.
- The live path currently emits a generic collaboration tool card. The replay `agent_start` child card and child nesting have no captured live parity evidence.
- Historical usage is unavailable in `thread/read`, so both `stats` and usage events are absent by design.
- User attachment payload rendering beyond image count has no existing flat event contract in the live user path. Other known attachment kinds are recorded as unsupported content rather than silently dropped.
