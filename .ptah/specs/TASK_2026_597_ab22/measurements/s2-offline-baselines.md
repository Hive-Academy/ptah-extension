# S2 offline baselines — TASK_2026_597_ab22 (Task 10.3)

Recorded 2026-10-03 by Batch 10 with measurement tool M (`scripts/agent-usage-report.ts`). Regenerated after the
fix round 1 changes (G1-G6). Every run was read-only on the local stores: no model call, no quota. This file holds
numbers, model names, tool names and config keys only. It holds no prompt or tool content.

Commands (worktree root):

- `npx ts-node --project scripts/tsconfig.json scripts/agent-usage-report.ts --date=2026-10-03 --lanes --resumed`
- `... --date=2026-10-03 --opencode-config` and `... 30 --lanes --opencode-config`
- `... --date=2026-10-03` (aggregate headlines)

Stores read:

| Vendor          | Location                                                                                          | State                                          |
| --------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Codex           | `~/.codex/sessions` (`CODEX_HOME` unset)                                                          | present, 9 rollouts on 2026-10-03, 0 bad lines |
| OpenCode        | `~/.local/share/opencode/opencode.db` (+ `-wal`, `-shm`; read through a temp copy, removed after) | present                                        |
| OpenCode config | `~/.config/opencode`                                                                              | present (`opencode.jsonc`)                     |
| Claude          | `~/.claude/projects`                                                                              | present (aggregate only, below)                |

No source was skipped. No `ptah-usage-opencode-*` temp directory was left behind (count 0 after the runs).

## Lane identification limit (G4)

A lane is recognised by the lane completion contract heading (`## Before you exit`, at a line start) in its first
request. Codex lanes must also carry `originator=codex_sdk_ts` and `source=exec`. OpenCode and Claude lanes are
recognised by the marker alone. The contract has existed since 2026-09-21 (TASK_2026_515). Lanes started before that
date, or spawned by a path that does not append the contract, are invisible to M. Every lane count below covers lanes
since 2026-09-21 only.

First date the marker is seen (UTC, from `--lanes`):

| Window       | Codex                       | OpenCode                                           | Claude                     |
| ------------ | --------------------------- | -------------------------------------------------- | -------------------------- |
| 2026-10-03   | 9 lanes, first 2026-10-03   | 2 lanes, first 2026-10-03                          | 0 lanes                    |
| last 30 days | 187 lanes, first 2026-09-22 | 33 lanes with at least 1 request, first 2026-09-22 | 97 lanes, first 2026-09-22 |

## R1.1 — Codex Ptah lanes on 2026-10-03 (`--lanes`)

All 9 rollouts match R1.2. "Started" is the UTC instant: Codex names its rollouts in local time (UTC+3 on this
machine), and `--lanes` now converts that to UTC and sorts every vendor on it. "Total" is the rollout's final
`total_token_usage.input_tokens`. It is larger than context.md's figure for lanes resumed after that measurement (for
example 13:22:35 local is now 3.06M, was 2.48M). Largest tool output counts text characters only; inline base64
images are excluded.

| Started (UTC) | Session (local file name) | Model       | Effort | First      | Peak        | Total     | Cached | Output | Requests | Largest tool output | Compactions |
| ------------- | ------------------------- | ----------- | ------ | ---------- | ----------- | --------- | ------ | ------ | -------- | ------------------- | ----------- |
| 10:07         | 13-07-41                  | gpt-6-astra | medium | 27,041     | 37,764      | 0.10M     | 63%    | 759    | 3        | 40,096 (exec)       | 0           |
| 10:08         | 13-08-30                  | gpt-6-astra | medium | 24,623     | 126,276     | 1.60M     | 92%    | 8,402  | 19       | 40,090 (exec)       | 0           |
| 10:22         | 13-22-35                  | gpt-6-astra | medium | 24,595     | 151,658     | 3.06M     | 95%    | 13,482 | 31       | 40,103 (exec)       | 0           |
| 10:25         | 13-25-58                  | gpt-6-astra | medium | 27,954     | 116,087     | 3.34M     | 96%    | 14,329 | 37       | 40,085 (exec)       | 0           |
| 10:26         | **13-26-45**              | gpt-6-astra | medium | **27,464** | **183,759** | **9.59M** | 98%    | 35,764 | 74       | 40,091 (exec)       | 0           |
| 10:26         | 13-26-56                  | gpt-6-astra | medium | 27,298     | 106,786     | 2.50M     | 96%    | 10,467 | 29       | 40,094 (exec)       | 0           |
| 10:27         | 13-27-42                  | gpt-6-astra | medium | 24,546     | 82,272      | 0.77M     | 89%    | 9,333  | 14       | 40,140 (exec)       | 0           |
| 10:56         | 13-56-10                  | gpt-6-astra | medium | 24,678     | 204,011     | 4.21M     | 95%    | 22,898 | 34       | 40,053 (exec)       | 0           |
| 11:06         | 14-06-50                  | gpt-6-astra | medium | 26,913     | 66,832      | 0.43M     | 84%    | 4,966  | 8        | 40,119 (exec)       | 0           |

R1.1 check: the 74-turn lane reproduces first 27,464, peak 183,759 and total 9,586,716 (9.59M) exactly. The sanitized
fixture spec (`scripts/agent-usage/codex-rollout.reader.spec.ts`) pins the same three numbers.

Codex aggregate for the day: 9 sessions, 249 requests, average context 103k per request, 3 requests over 200k, 0
compactions, 25.60M input, 96% cached, 0.12M output. First-request input across the 9 lanes: 24,546 to 27,954.

## AS6 — resumed Ptah Codex lanes (`--resumed`)

A role part is any developer or user message part that holds the `## Role: <name>` header `renderRoleBlock` emits.
The header is pinned by a spec against the renderer's source. Verdicts:

- `once`: the role was recorded, kept in history, and not recorded again on resume.
- `twice`: the role was recorded again in a resumed turn while an earlier copy was still in history.
- `absent`: the lane had a role, but a resumed turn started without it in history (a compaction dropped it).
- `inconclusive`: no role block in any message, or the lane was not resumed. The reason says whether an unrecognised
  developer part could hold the role.

6 of the 9 lanes were resumed (more than one `task_started` in the rollout).

| Session  | Turns | Role parts | In resumed turns | Duplicates | Verdict      | Reason                                                 |
| -------- | ----- | ---------- | ---------------- | ---------- | ------------ | ------------------------------------------------------ |
| 13-08-30 | 2     | 0          | 0                | 0          | inconclusive | no role block anywhere, no unrecognised developer part |
| 13-22-35 | 4     | 0          | 0                | 0          | inconclusive | same                                                   |
| 13-25-58 | 2     | 1          | 0                | 0          | once         | role in first-turn `developer_instructions`            |
| 13-26-45 | 2     | 1          | 0                | 0          | once         | role in first-turn `developer_instructions`            |
| 13-27-42 | 3     | 0          | 0                | 0          | inconclusive | no role block anywhere, no unrecognised developer part |
| 13-56-10 | 5     | 0          | 0                | 0          | inconclusive | same                                                   |

Why 4 lanes are `inconclusive` (formerly `absent`), checked by G6: none of the 4 holds a `## Role:` header in any
developer or user part, in any turn. None has a developer part other than Codex's own `<tag>` blocks. None has a
compaction. So the earlier `<`-prefix heuristic did not hide a role: these lanes were spawned without a role, and they
cannot answer AS6.

Result: both resumed lanes that carried a role hold it in history once, and no resumed turn recorded it again. This
supports AS6 (the role survives in history on resume). It does not prove it: C2 (live) still decides before S5 flips
`CODEX_RESUME_RESENDS_ROLE`.

Side note from a read-only structure probe (lengths only, not an M mode): 6 resumed turns across 13-08-30, 13-22-35,
13-25-58 and 13-56-10 recorded a new `<skills_instructions>` developer part (21,070 to 22,176 chars) at the start of
the resumed turn.

## R1.3 — OpenCode baseline

### Declared config (`--opencode-config`)

| Item                                                          | Value                     |
| ------------------------------------------------------------- | ------------------------- |
| Config files                                                  | `opencode.jsonc`          |
| MCP servers declared (`mcp`)                                  | 0                         |
| Plugins declared (`plugin` key, `plugin/`, `plugins/`)        | 0                         |
| Other user content in the config dir (not a server or plugin) | `skills/` with 13 entries |

Do lanes load user servers or plugins? No. No user MCP server and no user plugin is declared, so there is nothing of
the user's for an OpenCode lane to load. Ptah's own MCP server reaches lanes through `OPENCODE_CONFIG_CONTENT`, not
through this directory. Lanes can see the user's 13 skills: lanes in the last 30 days called the `skill` tool 3 times.
Component 11 therefore needs no user-server disables on this machine, and its `userServerNames` input stays empty here.

### OpenCode lanes (`--lanes`)

2026-10-03: 2 sessions, both Ptah lanes.

| Started (UTC) | Session       | Model                      | Effort | First  | Peak   | Total | Cached | Output | Requests | Largest tool output | Compactions |
| ------------- | ------------- | -------------------------- | ------ | ------ | ------ | ----- | ------ | ------ | -------- | ------------------- | ----------- |
| 10:02         | ses_efec9514… | opencode/fledge-alpha-free | -      | 19,713 | 22,812 | 0.07M | 65%    | 1,164  | 3        | 7,893 (execute)     | 0           |
| 10:02         | ses_efec8b5b… | opencode/fledge-alpha-free | -      | 23,562 | 58,679 | 1.15M | 90%    | 11,170 | 26       | 17,676 (read)       | 0           |

Day aggregate: 2 sessions, 29 requests, average context 42k, 0 over 200k, 0 compactions, 1.22M input, 88% cached.
Tool calls in those lanes: shell 22, execute 2, read 2, grep 2.

Last 30 days (marker-carrying lanes since 2026-09-21 only, see G4): 49 sessions in `opencode.db` carry the marker, and
33 of them have at least one request. Their tool calls: glob 11,791, read 496, grep 283, shell 257, edit 170, write
59, execute 57, skill 3, bash 2, subagent 1, websearch 1, webfetch 1. The glob count has not been attributed to a
session here. First-request input of the 33 lanes: 14,943 to 23,562.

Request accounting: one assistant `session_message` row with `data.tokens` counts as one request. Context is
`tokens.input + cache.read + cache.write`. AS7 (per-step vs cumulative) is still open for Task 13.4.

## R3.4 — per-item "before" characters (cited, not measured by M)

The capture entry can only run on post-S1a code (review N-C), so these figures are cited from the task documents.

| Item                                                       | context.md § Evidence        | research-report.md (74-turn lane `13-26-45`) |
| ---------------------------------------------------------- | ---------------------------- | -------------------------------------------- |
| Role block (`developer_instructions`)                      | 34,608 (`backend-developer`) | 12,173 (role text differs by lane)           |
| Codex base instructions                                    | 21,428                       | 21,420                                       |
| Project-Specific Guidance                                  | 12,474                       | 12,416 (user message)                        |
| `<skills_instructions>`                                    | —                            | 21,070                                       |
| Agent blocks (`<multi_agent_role>` + `<multi_agent_mode>`) | —                            | 2,429 + 271 = 2,700                          |
| Permissions / collaboration / recommended plugins / env    | —                            | 363 / 920 / 876 / 474                        |

M's structure read agrees with the research-report column for `13-26-45`: role 12,173, skills 21,070, multi-agent
2,429 and 271, guidance-bearing user message 12,416. QA confirms the "before" row against the S3 capture.

## Claude (aggregate only, for context)

2026-10-03, corrected by G1: 53 transcripts, 2,555 requests, average context 165k, 762 over 200k, 421.25M input, 97%
cached, **2.27M output**. Each request is counted once per `message.id`, using the last line's usage, because
`output_tokens` grows across a response's per-block lines. The first version of this file reported 0.51M output (51
transcripts, 2,383 requests): it took the first line's partial `output_tokens`. The extra transcripts and requests
come from sessions that kept running between the two runs.
