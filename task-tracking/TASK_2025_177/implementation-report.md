# TASK_2025_177: Codex SDK Enhancement + UI Consistency

## Status: Complete

## Date: 2026-03-05

## Branch: feature/sdk-only-migration

---

## Summary

Enhanced the Codex SDK adapter with session resume, progressive streaming, and full event coverage. Unified all CLI output components (Codex, Copilot, Gemini) to use ExecutionNode tree rendering with shared stats bars. Added PermissionPolicy system to replace boolean auto-approve in Copilot.

---

## Files Modified (7 files)

| #   | File                                                            | Change                                                                                                                                                        |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `libs/backend/llm-abstraction/.../codex-cli.adapter.ts`         | Session resume, item.started/updated handling, delta tracking with replacement guard, toolCallId, reasoning->thinking, MCP/web_search/todo_list, listModels() |
| 2   | `libs/frontend/chat/.../codex-output.component.ts`              | Rewritten from flat segment rendering to ExecutionNode tree + stats bar                                                                                       |
| 3   | `libs/frontend/chat/.../agent-card.component.ts`                | Updated @case('codex') to pass agentId/segments/isStreaming                                                                                                   |
| 4   | `libs/frontend/chat/.../copilot-output.component.ts`            | Added stats bar (model, tokens, duration)                                                                                                                     |
| 5   | `libs/frontend/chat/.../gemini-output.component.ts`             | Refactored to shared stats utils, unified CliAgentStats type                                                                                                  |
| 6   | `libs/backend/llm-abstraction/.../copilot-permission-bridge.ts` | PermissionPolicy interface, presets (readOnly/safeWrite/fullAuto), removed duplicate tool sets                                                                |
| 7   | **NEW** `libs/frontend/chat/.../stats-bar.utils.ts`             | Shared CliAgentStats, formatTokens, formatDuration, extractCodexStats, extractCopilotStats                                                                    |

Also updated:
| 8 | `libs/frontend/chat/.../gemini-output.utils.ts` | GeminiStats aliased to CliAgentStats, uses shared StatsSegment type |

---

## Part 1: Backend - Codex SDK Adapter

### Session Resume

- `resumeThread(threadId, options)` when `resumeSessionId` provided
- `thread.started` event captures `thread_id` for `getSessionId()` on SdkHandle
- `setAgentId()` added as no-op (Codex has no permission hooks)

### Progressive Streaming

- `item.started`: Emits early `tool-call` segments for `command_execution` (toolName: 'Shell') and `mcp_tool_call`
- `item.updated`: Delta tracking via `itemTextTracker` Map with replacement guard (`startsWith` check)
- `item.completed`: Skip-if-deltas logic to avoid duplicate text emission

### Enhanced Event Coverage

- `reasoning` mapped to `thinking` (was `info`)
- `mcp_tool_call`: Full support with result/error/fallback branches
- `web_search`: Emitted as info segment
- `todo_list`: Formatted as checkbox list info segment
- All relevant segments include `toolCallId: item.id`

### Other

- `listModels()`: Static list (o4-mini, codex-mini, o3, gpt-4.1)
- Thread options: `model`, `approvalPolicy: 'never'`, `codexPathOverride`

---

## Part 2: Frontend - Unified ExecutionNode Rendering

- CodexOutputComponent rewritten to match Copilot/Gemini pattern
- Uses `AgentMonitorTreeBuilderService.buildTreeFromSegments()` for ExecutionNode tree
- agent-card.component.ts passes `agentId`, `segments`, `isStreaming` to Codex (was using `parsedOutput()`)

---

## Part 3: Frontend - Stats Bars

- Created shared `stats-bar.utils.ts` with `CliAgentStats`, `formatTokens`, `formatDuration`
- `extractCodexStats`: Parses "Usage: N input, M output tokens" with multi-turn accumulation
- `extractCopilotStats`: Parses "Usage: model, N input, M output, $cost, Ds" with multi-turn accumulation
- Gemini refactored: `GeminiStats` aliased to `CliAgentStats`, `StatsSegment` derived from `Pick<CliOutputSegment>`
- Stats bars added to Codex and Copilot output components

---

## Part 4: Backend - Permission Policy

- `PermissionPolicy` interface: `autoApproveTools`, `autoApproveKinds`, `autoApproveAll`
- `PERMISSION_PRESETS`: `readOnly`, `safeWrite`, `fullAuto`
- Policy is sole authority for auto-approval (removed duplicate `AUTO_APPROVE_TOOLS`/`AUTO_APPROVE_KINDS`)
- `setAutoApprove(boolean)` backward-compatible: `true->fullAuto`, `false->readOnly`
- `setPolicy()` for fine-grained control

---

## Review Findings & Fixes

Two code reviews (logic + style) scored 6.5/10 initially. All critical/serious issues fixed:

1. **Duplicate tool sets removed** - Policy is sole authority
2. **MCP else branch added** - Handles completed-with-no-result (stuck spinner fix)
3. **Delta replacement guard** - `startsWith` check prevents garbled text on SDK text replacement
4. **Stats types unified** - `GeminiStats` aliased to `CliAgentStats`, shared `StatsSegment`
5. **Multi-turn accumulation** - Token counts accumulated across all turn.completed events
6. **Shell toolName** - `item.started` for `command_execution` uses `'Shell'` instead of full command string
7. **Stale comment fixed** - `parsedOutput()` JSDoc no longer references Codex

---

## Verification

- `npm run typecheck:all` - all 14 affected projects pass (2x: pre-review and post-fix)

---

## Known Limitations (deferred)

- No `cached_input_tokens` display (Codex SDK provides it but not surfaced)
- `web_search`/`todo_list` rendered as info nodes, not tool-call/result pairs
- Three output components share 95% structure - future refactor to shared base or single configurable component
- `handleStreamEvent` is 190+ lines of nested switches - future extract to per-item handlers
