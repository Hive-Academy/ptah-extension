# Evaluation report - TASK_2026_659_cec4: is skill synthesis worth what it costs?

Date: 2026-10-14. Author: child session "Skills trajectory evaluation" (read-only research).

Data source for every SQL number: a COPY of `C:\Users\abdal\.ptah\state\ptah.sqlite` (+ `-wal`), taken
2026-10-14 01:08 UTC to `%TEMP%\ptah-eval-659\`, queried with Node 24 `node:sqlite`. The live DB was not
opened. The queries are in the worktree scratch files `.eval-tmp/main.sql` and `.eval-tmp/b2.sql`
(not committed); each table below repeats the query in short form. `ptah-dev.sqlite` (the dev host DB) was
copied but NOT analyzed: the Thoth panel numbers match `ptah.sqlite` exactly, so that is the production store.

---

## Verdict

**The user's feeling is correct: skill synthesis is a monster that produces toys.** In 113 days
(first candidate 2026-06-23) it created 2,694 candidates from 2,000+ sessions and ran 3,078 background job
runs, and it produced **zero recorded uses of any generated skill**. Every one of the 2,692 non-promoted
candidates comes from exactly **one** session, so the system never found a *repeated* routine, which is the
only thing a skill is for. 97.8% of the "Rejected" count (2,227 of 2,278) is housekeeping (missing
transcripts, merges, purges), not a quality judgement. The pipeline's own judge scored candidates 7.8-8.4
that a human rubric scored 1.25-2.38 (TASK_2026_471), so the "Recommended" list is ranked by a judge with no
measured validity. The "Enhance now" path rewrote 2 agents with no quality metric before or after, and the
"Success 100%" figure is 100% by construction. The recorded model spend is small ($31.83 notional since
2026-08-25), but it is under-recorded, and the real cost is the code: about **54,100 source lines + 78,500
spec lines, 47 RPC methods, 26 UI components, 5 background schedulers and ~87 settings keys**, plus a stream
of tasks that exist only to keep it alive. **Recommendation: switch the synthesis pipeline off now, keep the
per-agent telemetry and harness sync, and rebuild skill learning only on top of the TASK_2026_646_136a lane
outcome record, behind a value metric that must pass first.**

---

## Cost

### 1. Recorded model spend (the `skill_synthesis_budget` table)

Writer: `LaneRunner.recordUsage` (`libs/backend/skill-synthesis/src/lib/lanes/lane-runner.service.ts:699-702,839-846`)
→ `SkillBudgetStore.record` (`skill-budget.store.ts:281-290`). Granularity: per day and per stage. No
per-call rows exist.

Query: `SELECT stage, SUM(input_tokens), SUM(output_tokens), SUM(cost_usd), COUNT(*) days, MIN(day_key), MAX(day_key) FROM skill_synthesis_budget GROUP BY stage`

| Stage | Input tok | Output tok | cost_usd | Days with spend | First day | Last day |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| archaeology | 117,000 | 508,000 | 11.05 | 22 | 2026-08-25 | 2026-10-09 |
| prefilter | 46,000 | 413,000 | 7.54 | 16 | 2026-08-25 | 2026-10-13 |
| judge-panel | 3,000 | 438,000 | 6.89 | 5 | 2026-08-30 | 2026-10-04 |
| trigger-eval | 2,000 | 298,000 | 4.00 | 5 | 2026-08-30 | 2026-10-04 |
| `''` (un-staged rows, pre-0035 key) | 223,000 | 49,000 | 2.34 | 6 | 2026-09-04 | 2026-10-07 |
| **Total** | **392,000** | **1,707,000** | **31.83** | | | |

Windows (query: `SUM(CASE WHEN day_key >= date('now','-30 day') ...)`):

| Window | cost_usd | Tokens (in+out) |
| --- | ---: | ---: |
| Last 30 days | 18.94 | 1,334,677 |
| Last 90 days | 31.83 | 2,098,645 |
| All recorded (2026-08-25 → 2026-10-13) | 31.83 | 2,098,645 |

Spend peaks on drain days: 2026-08-30 ($8.18), 2026-09-20 ($5.20), 2026-10-04 ($7.72). The per-day rows
are in `.eval-tmp/main.out` (query `SELECT day_key, stage, ... ORDER BY day_key DESC`).

**What these dollars mean.** The lanes run on subscription or flat-rate providers: `archaeologist` =
ollama-cloud `kimi-k2.7-code:cloud`, `synthesis`/`replay` = `claude-cli`, `judge` = ollama-cloud
`glm-5.3:cloud`, `judgeProvider` = `openai-codex` `gpt-5.6-terra` (`~/.ptah/settings.json:196-214`).
`cost_usd` is the figure the SDK reports at list price, so it is a **notional** cost, not invoice money. The
real cost is subscription quota and rate-limit room taken from the user's interactive work. That was not
measured (no quota log exists).

**What is NOT recorded (so the $31.83 is a floor):**

| Gap | Evidence |
| --- | --- |
| Everything before 2026-08-25. 2,260 of 2,694 candidates (83.9%) were created before the budget table has any row. | `SELECT COUNT(*) FROM skill_candidates WHERE created_at < 2026-08-25` = 2,260 |
| "Enhance now" calls. The enhancer streams through `internalQuery.execute` and never reads `usage` or `total_cost_usd`. | `skill-enhancer.service.ts:885,897-907` |
| Cached input tokens. Rows such as 2026-10-13 prefilter show 2 input vs 1,044 output tokens, so cache reads are not counted. Input token totals are understated. | budget rows above |
| Per-call counts. Only a debug log line exists per call. | `skill-budget.store.ts:291` |

**Estimate (labelled, weak):** the post-2026-08-25 period cost $31.83 for 434 candidates, which is
$0.073 per candidate created. If the earlier 2,260 candidates cost the same per unit, the unrecorded spend is
about **$166 notional**, so the lifetime total is about **$200 notional**. The earlier pipeline had different
stages, so this estimate can be wrong by a factor of 2 or more.

### 2. Model calls and stage work (the `skill_synthesis_queue` table)

Query: `SELECT stage, status, COUNT(*) FROM skill_synthesis_queue GROUP BY 1,2` and
`SUM(finished_at - claimed_at), SUM(attempt_count) ... WHERE finished_at IS NOT NULL`.
The queue spans 2026-08-17 → 2026-10-14: 3,497 rows over 2,000 distinct sessions.

| Stage | Done | Queued (backlog) | Skipped | Unscored | Attempts | Wall time (h) | Avg (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| prefilter | 499 | 1,243 | 212 | – | 712 | 1.96 | 9.9 |
| archaeology | 262 | 237 | – | – | 321 | 1.78 | 24.4 |
| judge-panel | 204 | 257 | 24 | 14 | 343 | 1.60 | 23.8 |
| trigger-eval | 175 | 257 | 45 | 22 | 364 | 1.31 | 19.4 |
| embedding (local, no LLM) | 45 | 1 | – | – | 45 | 0.00 | 0.1 |
| **Total LLM stages** | | **1,994** | | | **1,740** | **6.65** | |

- Model calls: **at least 1,740 lane attempts** (sum of `attempt_count` for LLM stages). A judge-panel row
  can make more than one call, so the true count is higher. The exact count was not recorded.
- Failures that cost a call and gave nothing: 12 "no parseable JSON", 2 "timed out", 22
  "trigger-eval-prompt-lane-failed" (query on `status IN ('skipped','failed','unscored')`).
- The backlog is 1,994 queued LLM-stage rows, so a full drain would spend more than everything recorded so far.

### 3. Background job runs (the `job_runs` table)

Query: `SELECT j.name, r.status, COUNT(*), SUM(ended_at-started_at) FROM job_runs r JOIN scheduled_jobs j ... GROUP BY 1,2`.
3,078 skill job runs between 2026-08-17 and 2026-10-14.

| Job (cron) | Succeeded | Skipped | Failed | Stuck "running" | Wall time (h) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Skill Synthesis Drain frequent (`*/15 * * * *`) | 1,275 | 1,377 | 0 | 1 | 0.73 |
| Skill Synthesis Drain nightly (`0 3 * * *`) | 38 | 10 | 0 | 1 | 1.53 |
| Skill Synthesis Drain weekly (`0 4 * * 0`) | 3 | 1 | 0 | 3 | 8.84 |
| Skills Backlog Cleanup (`41 * * * *`) | 13 | 319 | 37 (`unexpected-error`) | 0 | 0.00 |

Last 30 days: frequent 657 ok / 1,043 skipped, nightly 21 ok, weekly 3 ok, cleanup 13 ok / 37 failed.
Weekly results: "claimed 286, done 99", "claimed 359, done 243", "claimed 328, done 147".
Other timers outside `job_runs`: the curator `setInterval` every 24 h (`skill-curator.service.ts:264-268`),
idle and boot-scan triggers (`triggers/skill-trigger.service.ts:309,376,400,441`) and a queue heartbeat
(`queue/stage-handlers.service.ts:969`). Their runs are not recorded.

---

## Value

### 1. Panel counters, verified against the DB

Query: `SELECT status, COUNT(*) FROM skill_candidates GROUP BY status`; `SELECT COUNT(*) FROM skill_invocations`.

| Panel counter | Panel | DB | Match |
| --- | ---: | ---: | --- |
| Candidates | 414 | 414 | yes |
| Rejected | 2,278 | 2,278 | yes |
| Promoted | 2 | 2 | yes |
| Active skills | 2 | 2 (`residency='resident'`, promoted) | yes |
| Invocations | 0 | 0 rows in `skill_invocations` | yes |

### 2. Every candidate is a single-session candidate

Query: `SELECT json_array_length(source_session_ids), status, COUNT(*) FROM skill_candidates GROUP BY 1,2`.

| Source sessions | candidate | rejected | promoted |
| ---: | ---: | ---: | ---: |
| 1 | 414 | 2,278 | 1 |
| 57 | 0 | 0 | 1 |

A skill is a reusable routine. A routine seen once is not evidence of reuse. The design rule that
TASK_2026_588 wrote down ("cluster routines across at least two sessions; delete the single-session
auto-candidate") was cancelled into TASK_2026_620 and never implemented (see Prior planning session).

Created per month (query on `substr(datetime(created_at/1000,'unixepoch'),1,7)`): Jun 314, Jul 909,
Aug 1,176, Sep 56, Oct 239.

### 3. What "Rejected" really means

Query: `SELECT substr(rejected_reason,1,60), COUNT(*) FROM skill_candidates WHERE status='rejected' GROUP BY 1`.

| Reason | Count | Kind |
| --- | ---: | --- |
| backlog-cleanup: no transcript found for any session | 1,552 | housekeeping |
| merged-into (2 targets) | 358 | dedup |
| backlog-cleanup: transcript unreadable and no verdict | 317 | housekeeping |
| backlog-purge: unclustered > 30 d | 29 | housekeeping |
| below-judge-score | 16 | quality |
| user rejections with a typed reason ("not important as a skill, it happens only once", ...) | 2 | quality (human) |
| null | 4 | unknown |

Only 18 of 2,278 rejections (0.8%) are quality decisions. The two human reasons say the same thing as this
report: one-off work is not a skill.

### 4. The judge

Query: `SELECT judge_status, COUNT(*), AVG(judge_score), MIN, MAX FROM skill_candidates GROUP BY 1`.

| judge_status | Count | Avg score | Min | Max |
| --- | ---: | ---: | ---: | ---: |
| scored | 204 | 5.22 | 1.2 | 8.4 |
| unscored | 38 | – | – | – |
| never judged | 2,452 | – | – | – |

- 91% of candidates were never judged.
- Validity: TASK_2026_471 scored 10 top candidates with an 8-criterion human rubric: **1.25-2.38/10, where
  the pipeline judge gave 7.8-8.4**. 16 cluster suggestions scored 1.5-2.8 against exemplars 8.5-9.8
  (`TASK_2026_620_a13e/ground-truth-sources.md:38,79,154`; `context.md:226`).
- TASK_2026_620 forensics: "Judge is saturated and un-controlled: 11/18 suggestions scored exactly 10.0"
  (`TASK_2026_620_a13e/benchmark-design.md:252`).
- The current "Recommended" top items (`map-oauth-translation-proxy` 8.4, `review-generator-integration` 8.4,
  `audit-service-adapter-integration` 8.0, `build-interactive-guided-tour` 7.1) all have `cluster_size = 1`
  (query on `skill_suggestions ORDER BY created_at DESC`).

### 5. Suggestions ("Recommended")

Query: `SELECT status, COUNT(*), AVG(cluster_size), MAX(cluster_size) FROM skill_suggestions GROUP BY 1`.

| Status | Count | Avg cluster | Max cluster |
| --- | ---: | ---: | ---: |
| accepted | 2 | 56.5 | 111 |
| dismissed | 9 | 26.9 | 108 |
| pending | 14 | 23.7 | 265 |

The large clusters are generic process descriptions (`execute-formal-agent-task` 265 sessions, judge 6.8;
`sanitize-templates-to-stack-agnostic` 98). The small ones are one-off investigations. Neither type is a
reusable routine that the authored skills do not already cover.

### 6. The two promoted skills

Query: `SELECT ... FROM skill_candidates WHERE status='promoted'`; usage via
`SELECT skill_slug, COUNT(*) FROM skill_invocation_events WHERE skill_slug IN (promoted names)` → **0 rows**.

| Skill | Source sessions | Created | Promoted | Judge | Recorded uses | Last used |
| --- | ---: | --- | --- | --- | ---: | --- |
| `extract-and-relocate-angular-component-feature` | 1 | 2026-06-30 15:37 | 2026-10-04 11:05:24 | null | 0 | never |
| `execute-phase-gated-task` | 57 | 2026-10-04 11:05:24 | 2026-10-04 11:05:24 | null | 0 | never |

- Both were promoted in the same second, through accepted suggestions (`skill_suggestions` accepted = 2).
  Neither has a judge, replay or trigger score.
- Both ARE delivered: they appear in this session's own Claude Code skill list, from `~/.ptah/skills/<slug>/SKILL.md`.
  So the model sees them in every session, and **no session has loaded either one in 10 days**.
- `execute-phase-gated-task` duplicates the shipped `orchestrate` / `orchestration` skills, which were loaded
  98 + 3 times in the same data.

### 7. Invocation telemetry and why "Success" is always 100%

`skill_invocation_events`: 6,376 rows, 30 slugs, 2026-06-10 → 2026-10-14.

Query: `SELECT source, verdict_source, COUNT(*), SUM(succeeded), SUM(is_error) FROM skill_invocation_events GROUP BY 1,2`.

| Source | Graded? | Rows | succeeded = 1 |
| --- | --- | ---: | ---: |
| subagent | no (`verdict_source` null) | 6,093 | 6,093 |
| prompt-expansion | no | 202 | 202 |
| subagent | yes (spec reconciliation, 14 tasks) | 81 | 79 |

The cause, in code:

1. `successRate = stats.succeeded / stats.total` (`libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:2305`).
2. `getInvocationStats` sums `succeeded` over all rows, with no filter on grading (`libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts:1430-1459`).
3. The SubagentStop writer hard-codes `succeeded: true` (`libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:510`), and the prompt-expansion writer does the same (`:675`).
4. The only path that can write 0 is the spec harvester, for `.ptah/specs` batches (`spec-harvester.service.ts:103-112`). It graded 81 rows in total, and nothing after 2026-09-17 (query: `MAX(reconciled_at)` per slug).

So numerator = denominator by construction. A reconciled-only rate exists only in the scorecard query
(`skill-candidate.store.ts:1484-1488`).

The automatic promotion path is dead code: `SkillInvocationTracker.recordInvocation`
(`skill-invocation-tracker.ts:48-84`) is the only writer to `skill_invocations` and the only caller of
`incrementSuccess`. It is registered in DI (`di/register.ts:83,132`) and resolved by no production code
(grep: only specs and an e2e comment reference it). TASK_2026_620 marks `skill.funnel.promote` as
"fail (tracker has no caller)" (`benchmark-design.md:274`). The backlog cleanup deleted 2,433 earlier
`skill_invocations` rows (`skill_backlog_cleanup_state.invocations_deleted = 2433`).

### 8. "Enhance now", agent snapshots and per-agent metrics

Query: `SELECT kind, slug, clone_status, last_enhanced_at FROM skill_registry WHERE kind='agent'`.

| Agent | Change | When | Quality metric before | Quality metric after |
| --- | --- | --- | --- | --- |
| frontend-developer | Enhanced (`clone_status = diverged`) | 2026-10-02 13:07:19 | 0 graded runs | 0 graded runs |
| team-leader | Enhanced (`diverged`) | 2026-10-02 13:08:21 | 0 graded runs | 0 graded runs |

No other agent has `last_enhanced_at`. 14 agents are `authored` with no enhancement.

Raw telemetry, 30 days before vs after the enhancement (query in `.eval-tmp/b2.sql`, window 2026-09-02 → now):

| Agent | Period | Runs | Avg duration (s) | Avg tools | Avg output tokens |
| --- | --- | ---: | ---: | ---: | ---: |
| frontend-developer | before | 451 | 3,268 | 101.2 | 74,643 |
| frontend-developer | after | 194 | 1,892 | 94.4 | 61,617 |
| team-leader | before | 605 | 7,512 | 77.3 | 68,802 |
| team-leader | after | 359 | 1,525 | 34.8 | 21,207 |

The runs became shorter. **This does not show that the agents got better.** No run in either period has a
graded outcome. In the same weeks the lanes-first rules (TASK_2026_441, PR #718) moved implementation work
from subagents to CLI lanes, which alone shortens subagent runs. The model and task mix also changed. With no
outcome signal and no control group, the effect of "Enhance now" is **not measurable** with the current data.

Snapshots: 832 `.md` files under `~/.ptah/user/**/.history/` (Glob). Agent snapshots carry the same
timestamps across all agents (for example `1787151829717`-`1787151830633` for 17 agents), so they come from
bulk seed, sync and rebase operations, not from per-agent improvement. The panel's "History 5 snapshots"
counts these. No snapshot directory exists at the 2026-10-02 enhancement times (not located).

Per-agent cost columns (`cost_usd` in `skill_invocation_events`) give implausible values, for example
$17,450 for backend-developer and $41,166 for all subagents in 30 days. They were not verified and are not
used in this report (see Unknowns).

---

## Maintenance cost

Counted with the Grep tool (`pattern="^"`, count mode; all lines incl. blank), by the inventory subagent,
cross-checked for the key files.

| Area | Source LOC (files) | Spec LOC (files) |
| --- | ---: | ---: |
| `libs/backend/skill-synthesis` | 30,414 (77) | 45,599 (88) |
| `libs/frontend/skill-synthesis-ui` | 13,614 (42) | 13,760 (36) |
| `rpc-handlers/.../skills-synthesis-rpc.handlers.ts` + `.schema.ts` | 3,875 (2) | 8,197 (5) |
| `agent-generation/.../services/user-layer` (clones, history, quarantine) | 4,671 (7) | 5,510 (10) |
| `persistence-sqlite` skill migrations | 850 (19) | 5,245 (17) |
| `thoth-runtime` skill jobs | 153 (2) | 170 (1) |
| `shared` skill types and constants | 532 (3) | 50 (1) |
| settings-core skill schema | 18 (2) | – |
| **Skills trajectory total** | **~54,100** | **~78,500 (158 spec files)** |
| Shared, counted separately: `libs/backend/harness-sync` | 13,284 (52) | 15,240 (57) |

Not counted: the `skillSynthesis:*` block in `libs/shared/src/lib/types/rpc.types.ts:1935-2119,4020-4075`,
CLI Thoth bootstrap and repropagation, and the e2e Thoth scenarios.

| Surface | Count | Source |
| --- | ---: | --- |
| RPC methods (`skillSynthesis:*`) | 47 | `skills-synthesis-rpc.handlers.ts:298-346` |
| UI components | 26 | `libs/frontend/skill-synthesis-ui/**/*.component.ts` |
| Thoth tabs | 5 (Recommended, Sessions, Library, Activity, Settings) | `skill-synthesis-tab.component.ts:930-934` |
| Cron jobs | 4 (drain ×3, backlog cleanup) | `skill-drain-jobs.ts:40-65`, `skill-backlog-cleanup-job.ts:23-26` |
| Other timers | curator 24 h, idle/boot triggers, heartbeat | see Cost §3 |
| Settings keys | ~55 + 32 lane keys | `libs/backend/platform-core/src/file-settings-keys.ts:255-401,569-692`; `lanes/skill-lane-config.ts:34-149` |
| DB tables | 12 `skill_*` tables + vector tables | `.eval-tmp/schema.out` |
| LLM stages | 6 (prefilter, archaeology, synthesis, judge/judge-panel, replay, trigger-eval) + enhance | Cost §2 |

Defaults: synthesis, judge, judge panel, curator, replay, trigger-eval, boot scan and both hook triggers are
all **on by default** (`file-settings-keys.ts:569,580,586,631,642,643,684,689-690`). The daily budget is
2,000,000 tokens (`:621`).

Open tasks that exist mainly to keep this trajectory running: TASK_2026_245 (replay gate producer),
TASK_2026_536 (synthesis on lane sessions), TASK_2026_624_d671 (skills half of the first scored bench run),
and the dead or unfinished items that TASK_2026_620 recorded (promotion tracker, archaeology order, cluster
rule). See `task-triage.md`.

---

## Hermes comparison

Sources: Hermes docs (https://hermes-agent.nousresearch.com/docs/user-guide/features/skills,
.../features/curator, .../features/memory), repo files `agent/prompt_builder.py` (`SKILLS_GUIDANCE`) and
`agent/background_review.py` (`_SKILL_REVIEW_PROMPT`), issues #18369 and #114107, and
https://github.com/NousResearch/hermes-agent-self-evolution. Collected by a research subagent with
`ptah_web_search` and the Ptah browser on 2026-10-14. Items marked "uncertain" were not confirmed in source.

| Stage | Hermes Agent | Ptah | Consequence here |
| --- | --- | --- | --- |
| Who writes a skill | The live agent, in the task, when it "works out a non-trivial workflow"; plus a background review fork that replays the conversation every ~10-15 tool iterations (uncertain which); plus `/learn` | A batch pipeline that reads finished transcripts hours or days later | Ptah's writer lacks the live context: what failed, what the user corrected, what was reused |
| Preferred action | **Patch an existing skill** first (loaded skill, then class-level umbrella skill), create a new one last | Always create a new candidate per session | 2,694 near-unique candidates; 0 patches to the skills that are used |
| Evidence of repetition | None required, but the patch-first rule merges into existing skills | Single session per candidate (2,692 of 2,694) | Toys: one-off investigations |
| Judge / score | **None.** Prompt rules, an advisory linter, optional human approval (off by default) | Judge, judge panel, replay gate, trigger eval (4 LLM stages) | Ptah pays for gates whose judge disagrees with humans (7.8-8.4 vs 1.25-2.38) |
| Clustering | None in the loop; optional weekly LLM consolidation (off by default, 50-100 calls) | Local embeddings + cosine, suggestions with cluster sizes up to 265 | Large clusters become generic process text |
| Usage feedback | `.usage.json` per skill: use, view and patch counts and timestamps; used only for staleness | `skill_invocation_events` (works for agents), `skill_invocations` (0 rows, writer dead) | Ptah cannot see whether a generated skill is used, so it cannot retire or improve it |
| Pruning | Deterministic, **no LLM**: unused 14 d → stale, 30 d → archived (docs also say 30/90) | Backlog cleanup and purge on transcript availability, not on use | Ptah prunes by data hygiene, not by value |
| Agent rewriting | Not part of the core loop. The separate self-evolution repo (DSPy + GEPA) must pass a test suite and goes to a human PR, about $2-10 per run | "Enhance now" rewrites agent files with no test or metric | Ptah's rewrite has a weaker gate than Hermes's offline one |
| Published value evidence | **None from Nous Research.** One unsourced third-party claim ("~40% faster after ~20 reuses"); docs warn the review fork "can burn a meaningful share of total tokens" | None | Neither system has shown value. Ptah copied an unproven idea and added cost |

**What Ptah copied:** the SKILL.md format, the idea of learning skills from sessions, a curator.
**What differs:** Ptah moved skill writing out of the live agent into a background batch, replaced
"patch the skill you used" with "create a new candidate per session", and added four LLM gates.
**Why it underperforms here:** (1) single-session candidates; (2) no link from a skill to a task outcome;
(3) a dead usage path, so nothing can be promoted or retired on evidence; (4) a judge that measures the
wrong thing; (5) the authored skill library (30 slugs in use) already covers the user's routines, so the
headroom for generated skills is small.

---

## Prior planning session

**The session:** Claude transcript `e7247e76-5943-429e-8727-d012cccb0c93.jsonl` (2026-10-12), found by
the transcript-search subagent. The user asked for a report of all memory and skills tasks (transcript
line 366), then to "sort them out ... combine the related ones together, put proper priorities and link
dependancies properly" (line 504). Three CLI lanes audited every task against `main`; codex reviewed the
structure (REVISE, 12 findings applied; grok failed with HTTP 402, line 734). Outcome: commit `22decbe5a`
"docs(task-specs): organize the memory and skills backlog into six epics", PR #711.

**What it decided:** it was a backlog triage, not a redesign. It created epics 635-640 (37 children, P1-P4,
dependency edges), merged 8 tasks into 641-644, closed 321 and 574 as done, 569 as superseded and the 439
umbrella as done, and re-scoped 560, 619, 280 and 284. For skills (639 context): 644 first, then 435, then
245 ("run the gate on accepted candidates"); 536 is P4 and waits on 535. For distribution (640): fix 564
first, then 279; 276 and 289 became owner scope decisions. 624 (first scored bench run) is P2 and "needs
approval for paid live recordings".

**What it did NOT decide:** it did not question whether synthesis should exist. "Kill single-session
candidates" and "cross-session clustering" come from TASK_2026_588, which was cancelled on 2026-10-06 as a
duplicate of TASK_2026_620. TASK_2026_620 listed 588 as "Not started" when it absorbed it
(`620/context.md:202`). The 10-12 triage did not re-file the 588, 473 Track B or 471 items 4-7 fixes.

**Status of each plan item** (git log since 2026-10-12, task frontmatter):

| Item | Status | Evidence |
| --- | --- | --- |
| Epics and merged tasks filed | done | `22decbe5a` |
| 644 lane-first half | done (through 441) | PR #718 `5e5187255`, `c1b9d898a` |
| 644 Council messaging half | open | `644_f03f/context.md` item 2 |
| 435, 245, 536 | open, no commits | `status: backlog` |
| 564, 279, 560, 280, 313, 284, 276, 289 | open, no commits | `status: backlog` |
| 624 recordings and first scored run | open | `status: backlog` |
| 588 fixes (archaeology first, ≥2-session clusters, delete single-session candidate) | abandoned | 588 `status: cancelled`, never re-filed |
| 473 Track B (generator and judge rewrite) | abandoned | absorbed into 620, never implemented |

Since 2026-10-09 the only `skill-synthesis` commits are 620's pause switches and start/stop fixes
(`feb688ccb`, `dc48896f3`, `d47dc783c`, `12a536883`) and provenance reporting (`038a26aef`). None is a
quality fix.

**TASK_2026_620 benchmark, skills arm:** it designed 16 skills suites (`HANDOFF.md:302`): a 105-document
labelled set, the 471 8-criterion rubric (pass ≥ 64/80, no criterion < 6), judge agreement (κ ≥ 0.6,
ρ ≥ 0.7, judge must beat score-by-length by ρ ≥ 0.2), and funnel suites. **No skills run has been scored.**
The U1 labels are model-panel labels ("xAI+Google; adjudicator=GLM", `HANDOFF.md:142`). Fixture verdicts
(`code-logic-review-phase3-6.md:316-331`): archaeology fail 15/15, cluster fail 15/15 "single-session
auto-candidates", promote fail "tracker has no caller", retire fail. Forensics numbers: 2,347 of 2,587
candidates never judged, replay never produced, `skill_invocations` = 0 rows.

---

## What to keep, retire, rethink

| Component | Decision | Evidence |
| --- | --- | --- |
| Per-agent invocation telemetry (`skill_invocation_events`: tokens, duration, tool count, task id) | **Keep**, feed it into the 646 outcome record | 6,174 subagent rows; 4,543 carry `task_id`, 5,442 carry duration; 646 Req 5.4 already names it as the subagent source |
| "Success" percentage on agent cards | **Retire** (646 Proposed Removal) | 100% by construction (Value §7) |
| Spec harvester reconciliation | **Keep, re-point** to write 646 outcome verdicts | Only producer of graded rows (81) |
| Harness sync of skills and agents to CLIs | **Keep** | Delivers the authored skills that are used (30 slugs); not part of the synthesis cost |
| User-layer clones, manual edit, history, revert | **Keep** (manual editing of skills and agents) | Needed for user-authored content; drop the auto-snapshot noise later |
| Prefilter, archaeology, synthesis, judge, judge panel, replay, trigger eval | **Retire (switch off now, delete later)** | $31.83+ notional, ≥ 1,740 calls, 0 uses of output |
| Drain crons (3), curator interval, idle/boot triggers, backlog cleanup/purge | **Retire** | 3,078 runs; 37 cleanup failures; 4 runs stuck in `running` |
| Candidates, suggestions, Recommended and Sessions tabs | **Retire** | 2,692 single-session candidates; 2 accepted suggestions, 0 uses |
| Promotion path and `SkillInvocationTracker` | **Retire** | Dead code: no production caller |
| "Enhance now" automatic agent rewrite | **Retire, or keep only as a manual draft with a diff and no auto-apply** | 2 agent rewrites, untracked cost, no measurable effect |
| `getAgentModels` RPC (timeout in the screenshot) | Retire with "Enhance now" | Only used by the enhance model picker (not investigated further) |
| The 2 promoted skills | **Proposal: remove** `execute-phase-gated-task` (duplicates `orchestrate`); keep or delete `extract-and-relocate-angular-component-feature` at the user's choice | 0 loads in 10 days while delivered to every session |
| Skill load counting (Skill tool, prompt expansion) | **Rethink**: make it reliable and per skill | Needed for the value metric below |

---

## Rethink proposal

### Principle

Measure first. No skill-learning code is written until the metric below can be computed from data that
Ptah already records, and until it shows headroom on the authored skills.

### Step 0: switch off (settings only, reversible)

Set `skillSynthesis.enabled = false` and turn off the triggers and curator. TASK_2026_620 already added
pause switches. Expected effect: $0 synthesis spend, 0 drain runs. Proof: `skill_synthesis_budget` gets no
new rows and `job_runs` shows only skipped drains for 14 days.

### Step 1: one outcome record (TASK_2026_646_136a Requirement 5)

Use the 646 lane outcome record as the single fact table for lanes AND subagents (Req 5.4 already takes
subagent tokens, cost and duration from the per-agent telemetry). Add one field to the record, proposed
for 646: **`skillsLoaded: string[]`**, the skill slugs loaded during the run (from the Skill tool and
prompt-expansion events with the same session or context id). Without this field no skill can ever be
linked to an outcome.

### Step 2: the value metric (defined before any code)

For a skill S and task kind K (646 task kinds: plan, implement, review, research, tests, docs), over a
rolling 30-day window of 646 outcome records:

- **Use(S)** = number of runs with S in `skillsLoaded`.
- **Lift(S, K)** = review pass rate of runs of kind K that loaded S, minus the review pass rate of runs of
  kind K that did not load S. Use the review verdict that 646 Req 5.3 attaches. Secondary signals:
  revise-round count and delivered rate (Req 5.2, 5.3).
- **Value proven** when Use(S) ≥ 10, at least 5 runs on each side, and Lift ≥ +10 percentage points, or
  revise rounds go down by ≥ 0.5 at the same pass rate.

**Gate 0 (no code):** compute Use and Lift for the authored skills after 646 has collected 30 days of
records. If NO authored skill shows value proven, generated skills will not either: stop the skills
rethink and keep only manual authoring. If some do, the routines they cover show where learning can help.

### Step 3: learning, Hermes-style but cheaper (only after Gate 0 passes)

- **Write in context, not in batch.** At the end of an orchestration run, when the outcome record shows a
  revise round or a failure class that ALSO appears in ≥ 2 earlier records of the same task kind, the
  orchestrator proposes a **patch to a skill that was loaded in the run** (Hermes's patch-first rule). It
  proposes a new skill only if no loaded skill fits. The user accepts or rejects in the chat. Cost: at most
  one model call per proposal, inside a run the user already started. No background calls.
- **Retire deterministically.** A generated skill with Use = 0 for 30 days is archived. A skill whose Lift
  is negative after 10 uses is reverted to its previous history snapshot. No LLM.
- **Capability matrix (646 Req 6).** Skill Lift per task kind can become one more data column next to the
  lane strength values, with `source = local outcomes` and `asOf`, so routing and skills read the same
  evidence.

### Budget for the rethink

Code: the outcome record and matrix are in 646 already. The skills addition is the `skillsLoaded` field, a
Use/Lift query, one orchestration-skill step and a retire rule. Target: under 2,000 source lines, against
~54,100 today.

---

## Unknowns

| Unknown | Why not measured |
| --- | --- |
| Real money and subscription quota spent | Lanes run on subscriptions; `cost_usd` is notional; no quota log exists |
| Spend before 2026-08-25 | `skill_synthesis_budget` has no earlier rows; estimate only (~$166 notional) |
| "Enhance now" spend | Enhancer does not read usage (`skill-enhancer.service.ts:897-907`) |
| Exact model call count | Only daily aggregates and attempt counts are stored |
| Whether every Skill-tool load is recorded | The data has only `subagent` and `prompt-expansion` sources; no Skill-tool source rows exist. The two promoted skills have 0 rows on every source, but a missing recorder path cannot be excluded |
| Plausibility of per-agent `cost_usd` | Values such as $41,166 for 30 days of subagents look like a cumulative or parent-session figure; not verified |
| Effect of "Enhance now" | No graded outcomes before or after; confounded by the lanes-first change |
| Dev DB (`ptah-dev.sqlite`) contents | Copied, not analyzed; the panel numbers match the production DB |
| Cause of the `getAgentModels` RPC timeout | Not investigated; it belongs to the component proposed for retirement |
| Wall time of curator and trigger timers | Not recorded in `job_runs` |

---

## Decisions

1. Used `ptah.sqlite` (production) as the measured store, because its counts match the panel exactly.
2. Reported `cost_usd` as notional money, because every configured lane is a subscription or flat-rate provider.
3. Counted model calls as `attempt_count` sums (a lower bound), because per-call rows do not exist.
4. Did not use the per-agent `cost_usd` totals, because they are implausible and unverified.
5. Treated "Enhance now" as unproven, not as harmful: the data cannot separate its effect from other changes.
6. Kept the proposal inside TASK_2026_646_136a (outcome record and matrix) instead of a new store, to avoid a second telemetry system.
7. All removals are proposals. No code, setting, task status or data was changed. Scratch query files stay in the worktree (`.eval-tmp/`) and are not committed.
