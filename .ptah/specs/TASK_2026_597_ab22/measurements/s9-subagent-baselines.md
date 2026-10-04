# Decision-9 "before" baselines for Claude subagents (N1, N3, N4) — TASK_2026_597_ab22 (Task 36.2)

Recorded 2026-10-04 by Batch 36 with measurement tool M (`scripts/agent-usage-report.ts --subagents`). Every run was
read-only on `~/.claude/projects` (`CLAUDE_CONFIG_DIR` unset): no model call, no quota. The environment variable
`CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` was not cleared or changed. This file holds numbers, agent type names, session
id prefixes and times only. It holds no prompt or tool content.

## Sessions measured

"This task's Claude session transcripts" are the main-checkout sessions (`~/.claude/projects/D--projects-ptah-extension`)
whose dominant task id is TASK_2026_597 (count of `TASK_2026_NNN` mentions per transcript). No task-597 worktree has
its own Claude project directory.

| Session (prefix) | Started (UTC)    | Role                                                             | Subagents (with requests) |
| ---------------- | ---------------- | ---------------------------------------------------------------- | ------------------------- |
| `8af2d859`       | 2026-10-03 11:21 | first orchestration session (the § Handoff measurement)          | 21                        |
| `cd7a4ebb`       | 2026-10-03 15:38 | second orchestration session (§ Handoff 2)                       | 26                        |
| `20b6ff75`       | 2026-10-04 11:32 | current PR 2 session (after both cut-offs, so "after" data only) | 6                         |

Excluded: `b775aebd` and `f9c4cc72` (TASK_2026_609), `91e1f017` (TASK_2026_555), `6b159806` (TASK_2026_596). They
mention TASK_2026_597 but belong to other tasks.

Cross-check against § Handoff (1,075 requests, 177M cache read, 7.7M cache write, 1.1M output): session `8af2d859`
now holds 145 main-session requests + 942 subagent requests = 1,087 requests (the transcript grew after the
measurement), subagent cache read 148.2M + main 33.25M input at 99% cached, subagent cache write 7.38M, subagent output
1.04M. It is the measured session.

Commands (worktree root; `R` = `npx ts-node --project scripts/tsconfig.json scripts/agent-usage-report.ts --subagents
--session=8af2d859,cd7a4ebb,20b6ff75`):

- N3/N4 before: `R --since=2026-10-02T00:00:00Z --until=2026-10-03T20:17:27Z`
- N1 before (TTL split): `R --since=2026-10-02T00:00:00Z --until=2026-10-03T19:12:17Z` and `R --since=2026-10-03T19:12:17Z`
- Per session: `... --subagents --since=2026-10-02T00:00:00Z --session=<prefix>`

No source was skipped (no unparseable line, no response without usage, no missing `.meta.json` in these sessions).

## Cut-offs

- N3/N4 (shipped in PR 1, #634, merge `f314a4f8a`, committed 2026-10-03T18:38:36Z). The agent files are read from the
  main checkout, which fast-forwarded to `f314a4f8a` at **2026-10-03T20:17:27Z** (`git reflog main`). The "before"
  sample is every subagent started before that instant. The first session started on that build is `f9c4cc72`
  (20:34:57Z, TASK_2026_609); the earlier pull time was used because a session already running can spawn subagents
  from the updated files. No task-597 subagent started between the two instants. Note: `871b0022b` ("chore: update
  subagents and skills", 2026-10-04 11:26Z) also changed agent files, so the 2026-10-04 "after" sample carries both
  changes.
- `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`: value today `1h` (Windows user variable, `HKCU\Environment`). The last write
  of that registry key is **2026-10-03T19:12:17Z**, the latest instant at which the variable can have been set. Both
  orchestration sessions of this task (`8af2d859`, `cd7a4ebb`) started before it, so their processes ran without the
  variable. Only `20b6ff75` started after it (its process has the variable).

## N1 before — resumes after more than 5 minutes

A late resume is a request sent more than 300 s after the previous request of the same subagent. Send time is the
timestamp of the last non-assistant line (prompt or tool result) before the response; requests are deduped by
`message.id`, last line wins.

| Sample                                   | TTL variable | Subagents | Late resumes | cache_creation sum | cache_creation median |
| ---------------------------------------- | ------------ | --------- | ------------ | ------------------ | --------------------- |
| started before 2026-10-03T19:12:17Z      | not set      | 47        | **19**       | **3,544,590**      | **179,935**           |
| — of which session `8af2d859`            | not set      | 21        | 19           | 3,544,590          | 179,935               |
| — of which session `cd7a4ebb`            | not set      | 26        | 0            | 0                  | -                     |
| started at or after 2026-10-03T19:12:17Z | `1h`         | 6         | 0            | 0                  | -                     |

All 19 late resumes are in session `8af2d859` between 11:58Z and 15:08Z, gaps 321-802 s. Each paid a cache write of
61,647-314,337 tokens while reading at most 24,029 cached tokens (the shared system part), i.e. the conversation cache
had expired. By agent type: team-leader 6, backend-developer 4, code-logic-reviewer 4, software-architect 2,
general-purpose 2, project-manager 1. The "after the variable" sample has no late resume, so it says nothing about the
1h TTL yet.

## N3/N4 before — start prefix per agent type

Start prefix = context of the subagent's first request: `input + cache_read + cache_creation`.

All subagents started before 2026-10-03T20:17:27Z: **n=47, min 34,437, median 39,683, max 45,834**.

| Agent type          | n   | min    | median | max    |
| ------------------- | --- | ------ | ------ | ------ |
| backend-developer   | 18  | 39,544 | 39,726 | 40,373 |
| code-logic-reviewer | 9   | 39,317 | 39,557 | 39,885 |
| team-leader         | 6   | 44,189 | 44,505 | 45,834 |
| Explore             | 3   | 34,437 | 34,492 | 34,564 |
| general-purpose     | 3   | 36,238 | 36,366 | 36,388 |
| software-architect  | 3   | 40,354 | 40,517 | 41,021 |
| code-style-reviewer | 1   | 39,255 | 39,255 | 39,255 |
| devops-engineer     | 1   | 38,660 | 38,660 | 38,660 |
| frontend-developer  | 1   | 40,270 | 40,270 | 40,270 |
| project-manager     | 1   | 39,600 | 39,600 | 39,600 |
| researcher-expert   | 1   | 38,486 | 38,486 | 38,486 |

Check against § Handoff (start prefix 34-44k, median 39.6k): session `8af2d859` alone gives n=21, min 34,437, median
**39,600**, max 44,189, an exact match. The two-session "before" median 39,683 is +0.2% from 39.6k, inside the 10%
bound. The max rises to 45,834 because session `cd7a4ebb` started team-leaders with a larger prefix.

## After (QA)

Filled at QA. N1 "after" needs `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` cleared in the run process (explicit user
approval only, decision 6 budget); without it the row reads "not measured (env override active)".

### N1 after

| Sample | TTL source | Subagents | Late resumes | cache_creation sum | cache_creation median |
| ------ | ---------- | --------- | ------------ | ------------------ | --------------------- |
|        |            |           |              |                    |                       |

### N3 after (start prefix per agent type, subagents started after the cut-off)

| Agent type | n   | min | median | max |
| ---------- | --- | --- | ------ | --- |
|            |     |     |        |     |

### N4 after

| Agent type | n   | min | median | max |
| ---------- | --- | --- | ------ | --- |
|            |     |     |        |     |
