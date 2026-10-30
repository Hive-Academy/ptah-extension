# Task Context - TASK_2026_663_50d4

## Source

Carried from `.ptah/specs/TASK_2026_535/task.md` sections D (role contract vs declared deliverables) and E
(OpenCode MCP reporting via `--standalone`, real adapter errors, quota classification) when TASK_2026_535 was
merged into TASK_2026_646_136a on 2026-10-14. Read those two sections in full; they hold the evidence and
acceptance criteria.

## Addition

In TASK_2026_646_136a research (2026-10-14) the grok lane reported that `ptah_web_search` was not registered
("tool search returned only the `tasks` server"; `TASK_2026_646_136a/research-routing-landscape.md:5`). Find
why grok lanes do not get the full Ptah MCP tool set.

## Why it matters

Lane evaluation (TASK_2026_646_136a) learns from lane outcomes. A lane that reports `no-deliverable` for done
work, cannot report, or hides a quota error as "Unknown error" writes wrong outcome data.

## Triage 2026-10-30

Backlog audit after the October refactors: partly delivered, still open.

- Still open: §D: declared deliverables must win over a role's default file name (or spawn rejects the conflict) with role-conflict verdict/failure_kind recorded. Re-check whether OpenCode quota errors now reach lane outcomes as a quota failure kind.
- Evidence on main: OpenCode --standalone delivered by b33535508 (2026-09-24, main:.../cli-adapters/opencode-cli.adapter.ts:40-52 documents it). Grok lane MCP attachment fixed by b0e9a54d7 (2026-10-21, 'verify lane MCP attachment'). Usage-limit classification exists (cli-agents/limits/lane-limit-classifier, used by agent-process-manager.service.ts and sdk-error-summary.ts). No role-conflict handling: git grep 'role-conflict' in libs/**/*.ts = 0 hits. opencode-cli.adapter.ts:201 still falls back to 'Unknown error'.

## Retired sources (2026-10-30)

This task cites `TASK_2026_535`. That folder was retired from `.ptah/specs`. Read it in git history: `git show ff531866f:.ptah/specs/<folder>/<file>`.
