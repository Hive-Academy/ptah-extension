---
id: TASK_2026_559_8ca9
status: done
type: BUGFIX
title: Restore every ptah MCP tool to its token-saving contract and guard it against regression
description: >-
  The ptah_* MCP tools degraded silently. The shipped prompts promise fewer tokens with no quality
  loss, but the token audit measured the opposite: context_enrich_file returns the whole file
  (36/36), code_search_symbols misses exact names (0/7), get_diagnostics is unfiltered (max 1.08M
  chars), workspace_analyze is 96% directory tree and misdetects the project. Fix every tool so it
  keeps the prompt's promise, find the commit that broke each one, and add regression guards.
depends_on: []
created: 2026-09-25T00:00:00.000Z
updated: 2026-09-25T00:00:00.000Z
---

## Description

Evidence: `.ptah/specs/TASK_2026_557_tokaudit/research-report.md` (RC5, RC6, Wave 1, and the
Delta section against TASK_PROMPT_EFFICIENCY).

The prompts are correct and stay as the contract. The tools must be brought back to it. Every
tool in `tools/list` gets a verdict (works / degraded / broken), a root cause with the regressing
commit where one exists, a fix, and a benchmark or spec that fails if it degrades again.
