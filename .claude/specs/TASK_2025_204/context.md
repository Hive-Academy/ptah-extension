# TASK_2025_204 — Enhanced Prompt Engineering Overhaul

## User Request

Fix 8 prompt engineering issues identified in a comprehensive review of the enhanced-prompt system that assembles the system prompt for Ptah's Claude Agent SDK sessions.

## Task Type

REFACTORING

## Workflow

Partial: Architect -> Team-Leader -> Developers -> QA

## Issues to Fix

### Issue 1: Three Conflicting Tool Routing Layers (HIGH)

- PTAH_CORE "Tool Usage Policy" line 160: "file search → use Task tool (subagent)"
- PTAH_CORE "MCP Tool Preference" line 170: "file search → use ptah.search.findFiles()"
- MCP "Required Substitutions" line 274: "file search → use ptah_search_files"
- Need: Single tool routing hierarchy with clear priority

### Issue 2: execute_code Framed as "Advanced Fallback" (HIGH)

- Line 331: "Advanced: execute_code Tool — power-user fallback"
- ptah.ast, ptah.dependencies, ptah.context only accessible via execute_code
- Framing discourages use of these critical capabilities
- Need: Reframe as primary IDE-access tool

### Issue 3: Token Budget Inversion (HIGH)

- Rare-use sections (git, PR, agent delegation, AskUserQuestion): ~1,716 tokens (24.5%)
- Project-specific guidance (the premium feature value): ~1,509 tokens (21.5%) and TRUNCATED
- Need: Compress boilerplate, give project guidance more room

### Issue 4: Primacy/Recency Misalignment (MEDIUM)

- Beginning: Identity, tone, emoji policy (low-value)
- Middle (attention trough): MCP tools, AST, dependencies (high-value)
- End: Project guidance (high-value, truncated)
- Need: Restructure to put tool routing and project context in prime positions

### Issue 5: Cached PTAH_SYSTEM_PROMPT Staleness (MEDIUM)

- PTAH_SYSTEM_PROMPT is hard-concatenated into cached enhanced prompt
- Cache invalidates only on project config changes, not prompt constant changes
- Need: Include prompt version in cache dependency hash

### Issue 6: No Conditional Loading (MEDIUM)

- Every session gets full 7k tokens regardless of task type
- User asking "what does X do?" gets 600 tokens of agent delegation instructions
- Need: Move low-frequency sections to tool descriptions (loaded on-demand)

### Issue 7: 59 Headers Cognitive Fragmentation (LOW-MEDIUM)

- 59 markdown headers across 471 lines (1 header every ~8 lines)
- Instructions pretending to be headers, example labels as H3s
- Need: Merge small sections, reduce header count

### Issue 8: Project Guidance Truncation (MEDIUM)

- maxTokens: 2000 in DEFAULT_ENHANCED_PROMPTS_CONFIG
- LLM-generated project guidance truncated with "..."
- 1,716 tokens of boilerplate could be reclaimed
- Need: Increase budget AND compress boilerplate to make room

## Files Involved

1. `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts` — Core behavioral prompt
2. `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts` — MCP tool mandates
3. `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.service.ts` — Prompt assembly + cache
4. `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.types.ts` — Config types
5. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts` — execute_code tool description
6. `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts` — Help registry

## Current Token Budget Breakdown

| Category                         | Tokens     | %        |
| -------------------------------- | ---------- | -------- |
| PTAH_CORE (behavioral)           | ~3,665     | 52%      |
| PTAH_SYSTEM_PROMPT (MCP)         | ~1,823     | 26%      |
| Project Guidance (LLM-generated) | ~1,509     | 22%      |
| **Total**                        | **~7,000** | **100%** |

## Target Token Budget

| Category                           | Tokens     | %        | Change   |
| ---------------------------------- | ---------- | -------- | -------- |
| Core + Tool Routing (restructured) | ~2,500     | 36%      | -1,165   |
| MCP Tools (compressed)             | ~1,200     | 17%      | -623     |
| Project Guidance (expanded)        | ~3,300     | 47%      | +1,791   |
| **Total**                          | **~7,000** | **100%** | net zero |
