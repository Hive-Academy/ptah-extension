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

8. Batch 2a review loop (user, after the r3-postcap REVISE): allow ONE more bounded correction plus one more independent review; if that review still finds defects, commit Batch 2a with them recorded as known issues. Outcome: bounded correction #2 (orchestrator-authored) was reviewed by a fresh Codex lane (r4), which APPROVED 8/10 with no defects, so no known issues were carried.

9. Batch 2b Markdown reducer (user, after r2 REVISE 4/10 with 3 new blocking CommonMark edge cases): rebuild the Markdown reducer on the lexer of `marked` (already a runtime dependency, ^18.0.13; NOT a new package) instead of the hand-written parser. Headings are kept; every other block is kept or omitted whole, using the token's exact `raw` text. One more implementation round and one more independent Codex review are authorized. The JSON reducer (Task 2b.1) stays as accepted.

10. Batch 2b Markdown HTML handling (user, after the post-cap r4 REVISE 5/10 with 3 more HTML-context bypasses of the tag tally and a 1,220 ms timing-spec failure): remove the Rule H tag tally. A document with any block-level HTML tag outside code tokens returns unchanged (the text path cuts and spools it). Make the timing spec robust to machine load. One more independent Codex review is authorized.

11. Batch 2b final narrow fix (user, after the r5 Decision 10 REVISE 5/10 with 2 blocking defects): use the full CommonMark type-1 (`pre`, `script`, `style`, `textarea`) plus type-6 block-tag list, and remove the standalone-comment exception so any `html` token returns the input unchanged. Add both literal regressions. One last independent review: commit if it approves; otherwise commit with its defects recorded as known issues.

## Conversation Summary
- Source audit: `.ptah/specs/TASK_2026_557_tokaudit/research-report.md` (workflow run wf_5298f8d9-6d9), including the Delta section against TASK_PROMPT_EFFICIENCY / PR #571.
- Audit scripts to reuse for measurement: `C:/Users/abdal/.ptah-token-audit/` (mcp/bench.py, rerun.py, adoption/*).
- Out of scope, tracked separately: per-workspace and global MCP server / skill on/off controls → TASK_2026_560_2ae5.
- Do not touch `~/.codex/config.toml`, `.claude/settings.local.json` or other user-owned settings; Wave 0 settings are the user's to apply.
