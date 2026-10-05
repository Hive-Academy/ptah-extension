---
id: TASK_2026_609_c495
status: done
type: BUGFIX
title: Fix subagent setup scope leak and subagent system prompt, then design a Settings silo for subagents
description: >-
  Part A surgical fixes - the setup wizard rewrites subagents of other workspaces (TASK_2026_365 regression), no programmatic model per agent/provider, unused analysis files, subagent system prompt gaps. Part B - Settings sub-routes to manage subagents (design, user gates).
depends_on: []
created: 2026-10-03T00:00:00.000Z
updated: 2026-10-03T00:00:00.000Z
---

## Description

Handoff from TASK_2026_597 (PR #634, not merged yet).

**Part A - surgical fixes (BUGFIX)**

1. Setup wizard in one project changes the subagents of other projects. TASK_2026_365 was meant to scope `~/.ptah/user/agents` by workspace. Treat as an incomplete fix or regression. Also check TASK_2026_534 item 4 (provider connect changed CLI sub-agent tiers).
2. Setup wizard waits for a codebase analysis that writes ~4 files nobody reads, then runs an opaque generation workflow, then writes copies per provider (.claude, .codex, .opencode). The user must set `model:` by hand in each file. No programmatic model per agent type / per provider.
3. Subagent system prompt: subagents get only MCP server instructions + ptah_* schemas; `PTAH_CORE_SYSTEM_PROMPT` reaches the main session only (`sdk-query-options-builder.ts`).

**Part B - Settings silo (FEATURE, goes through user gates)**

Sub-routes in the Settings page where the user manages everything about subagents (from codebase analysis and the skills trajectory). Links to Thoth skills and later content-manifest updates.

**Constraints**: rebase after PR #634 merges; files #634 touches are listed in context.md. Regenerated skill/agent content needs `npm run manifest:generate` + commit.
