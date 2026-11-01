# Task Context - TASK_2026_859_b561

## User Request
BUGFIX: The live MCP registry integration is broken, so no user can install a server from the MCP
directory. Evidence: TASK_2026_853 Phase D visual review, finding 8
(/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet-d/.ptah/specs/TASK_2026_853_897f/visual-review-phase-d.md).
- mcp-registry.provider.ts requests `/v0.1/servers/{name}` → 404.
- Registry now serves `/v0.1/servers/{name}/versions/latest` with `packages` / `remotes`.
- Frontend reads `version_detail` in mcp-directory-browser.component.ts (~709).
- Electron: all 14 popular and 8 search results show "Could not auto-detect configuration".

Goals: (1) research live API + spec, record schema in research-report.md; (2) update provider and
shared types, map packages (npm/pypi/oci/nuget...) and remotes (streamable-http/sse) incl. env vars
and headers; (3) update frontend auto-detect; (4) fail loudly with coded, user-safe message on unknown
shape; (5) unit tests with recorded real fixtures (list, detail, remote-only, package-only, env-var).

Constraints: worktree fix/mcp-registry-api; keep to fetch/parse/detect path, no install-scope code
(Phase D conflicts in mcp-directory.types.ts, mcp-install.service.ts, mcp-directory-browser.component.ts);
Electron visual check dark+light; scoped verify; commit/push/PR; independent review by a different
model family before push.

## Task Type
BUGFIX

## Complexity
Medium

## Strategy
BUGFIX, Partial: researcher-expert → team-leader Mode 1 (plan-free) → developers → verify →
code-logic review (codex, different family) → visual before/after (dark + light) → commit/push/PR.
No UI surface added or redesigned → no designer/Gate 1.7; before/after screenshots required.

## CLI Lanes
Gate 0.1: preference source = memory ("use installed CLI implementation lanes proactively, Claude
subagents as fallback or independent reviewers"). Mode: enabled. Approval mode: lane-review.
Spawnable rows: codex (confirmed room, weekly 83%), antigravity, grok, kimi code (limits unknown).
Ollama Code AT LIMIT; copilot/claude disabled. Planned: code-logic review on codex (OpenAI family,
different from Claude implementers).

## Conversation Summary
- Before screenshots: main checkout state = broken behaviour already documented in finding 8.
