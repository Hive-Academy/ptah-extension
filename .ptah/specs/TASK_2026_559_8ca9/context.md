# Task Context - TASK_2026_559_8ca9

## User Request
"so each and every tool should have a proper fix, we where having those working before, now they are degraded without even knowing that! the prompts are correct and they suppose to be saving token by using our tools without loosing any quality so this is a must fix that should be deeply thought of."

## Task Type
BUGFIX (regression)

## Complexity
Complex — 53 tools in `tools/list`, served to Claude SDK sessions, proxied sessions, CLI lanes and external clients.

## Strategy
BUGFIX, Full depth: researcher-expert (per-tool regression forensics and fix design) → team-leader Mode 1 (plan-free) → implementation batches → QA.

The prompts (`ptah-core-prompt.ts`, `tool-description.builder.ts`, `NATIVE_AGENT_TOOL_POLICY`) are the contract. The user decided they are correct; do not weaken them to match degraded tools. Where a prompt claim cannot be met, report it and ask instead of editing it.

## CLI Lanes
Gate 0.1 (user, 2026-09-25): Subagents + Codex review. Claude subagents do research and implementation; one Codex lane reviews each batch from the other execution side. No other lanes. Roster at the time: codex, antigravity, opencode (cli, installed); Glm (ptah-cli, Ollama Cloud); copilot disabled; cursor and pi not installed.

## User Decisions (2026-09-25, on research-report.md Clarifications Needed)
1. Index refresh: lazy background reindex on the first symbol call of a session when `code_symbols` is empty or older than 24h, through the existing governor; also expose `ptah_code_reindex`.
2. Result budget: default 8k chars. Tools with a natural page unit (task rows, symbol-index entries, agent output lines) get an offset/cursor parameter; others spool the full output to `.ptah/tmp/mcp-out/<toolCallId>.txt` and name the path in a trailer.
3. `ptah_browser_screenshot`: keep the image inline; default to jpeg quality 60 instead of png; remove the duplicate `onToolResult` re-encode.
4. Per-tool descriptions in `tool-description.builder.ts` whose claim is false today may be corrected. The shared prompt constants (`ptah-core-prompt.ts`, `NATIVE_AGENT_TOOL_POLICY`) stay unchanged.
5. Orchestrator decision (low risk): `tools/list` reads caller identity by parsing the URL (option b); it does not move inside `runWithMcpRequestContext` unless TASK_2026_560 needs more.

6. Batch plan (batches.md, 21 batches, sequential) approved as is. No per-caller tool narrowing in this task; every caller keeps the full tool set. TASK_2026_560 adds per-caller / per-workspace tool sets on top of the Batch 3 caller identity.

7. Plan amendment (user, after Batch 1 implementation): extend Batch 2 with a deterministic reducer pipeline that runs before the 8k budget, per content type — HTML → main-content text/Markdown with an in-house extractor (NO new dependencies: readability/turndown/linkedom were not approved), JSON → compact (no pretty-print, drop empty fields, arrays of objects → table), logs/test/diagnostic output → dedupe repeated lines, keep errors with context, head/tail, code → tree-sitter outline, Markdown → heading outline. Budget measured in tokens with the existing `gpt-tokenizer` dependency. The full raw output is always spooled, so no information is lost. Place the reducers in a shared backend library so a later compaction layer (audit Wave 3, post-tool hook for built-in Read/Bash) can reuse them. No LLM summarization. NOT approved: splitting ptah_workspace_analyze into overview + ptah_project_inspect, and new ptah_outline / ptah_read tools — Batch 10 keeps its original scope.

## Conversation Summary
- Source audit: `.ptah/specs/TASK_2026_557_tokaudit/research-report.md` (workflow run wf_5298f8d9-6d9), including the Delta section against TASK_PROMPT_EFFICIENCY / PR #571.
- Audit scripts to reuse for measurement: `C:/Users/abdal/.ptah-token-audit/` (mcp/bench.py, rerun.py, adoption/*).
- Out of scope, tracked separately: per-workspace and global MCP server / skill on/off controls → TASK_2026_560_2ae5.
- Do not touch `~/.codex/config.toml`, `.claude/settings.local.json` or other user-owned settings; Wave 0 settings are the user's to apply.
