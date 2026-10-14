# Task triage - TASK_2026_659_cec4: open tasks in the skills trajectory area

Statuses read from each `task.md` frontmatter (`status:`) on 2026-10-14. Every action is a PROPOSAL. No task
was changed. "Rethink task" = a new task to file only if the user accepts the rethink proposal in
`evaluation-report.md` (Step 0 switch-off, Step 1-2 metric inside TASK_2026_646_136a, Step 3 learning only
after Gate 0 passes).

## Skills synthesis (epic TASK_2026_639_97f0)

| ID | Title | Status | Proposed action | Reason |
| --- | --- | --- | --- | --- |
| TASK_2026_639_97f0 | Skills: shipped skill content and skill synthesis | backlog | **rescope** to "shipped skill content" only | The synthesis half is proposed for retirement; the content half (644, 435) stays useful |
| TASK_2026_245 | Give the replay gate a production producer | backlog | **cancel** | Replay gate never produced a result; gates are proposed for removal; 0 uses of promoted output |
| TASK_2026_536 | Lane trajectories: run synthesis archaeology and judging on CLI lane sessions | backlog | **cancel** (the lane data need moves into 646) | Feeds the retired pipeline; lane outcomes are 646 Req 5 |
| TASK_2026_644_f03f | Close the lane-first and two-way messaging gaps in orchestration and tribunal skills | backlog | **keep** | Shipped skill content that is used (orchestrate 98 loads); not synthesis |
| TASK_2026_435_c8a6 | Apply one prompt-authoring rubric to every other shipped skill | backlog | **keep** | Improves the authored skills, which are the ones that are loaded |

## Skills distribution (epic TASK_2026_640_11a5)

| ID | Title | Status | Proposed action | Reason |
| --- | --- | --- | --- | --- |
| TASK_2026_640_11a5 | Skills distribution to CLIs (harness-sync) and capability controls | backlog | **keep** | Harness sync is proposed to stay |
| TASK_2026_564_87a6 | ptah-cli proxy: remove dead `skill__`/`mcp__` placeholder tools | backlog | **keep** | Correctness fix, independent of synthesis |
| TASK_2026_279 | Provenance marker on harness copies | backlog | **keep** | Distribution hygiene |
| TASK_2026_560_2ae5 | Per-workspace and global on/off for MCP servers and skills | backlog | **keep** | User control over delivered skills |
| TASK_2026_280 | Surface the harness in settings, orphaned clones, doctor paths | backlog | **keep** (re-scoped already) | Distribution UI |
| TASK_2026_313 | Harness disclosure e2e coverage and uncapped blocked list | backlog | **keep** | Test gap in kept code |
| TASK_2026_284 | Harness for opencode and pi | backlog | **keep** | Distribution coverage |
| TASK_2026_276 | ptah-python plugin and its two skills | backlog | **keep** (owner scope decision) | Authored content, not synthesis |
| TASK_2026_289 | Smithery skills provider | backlog | **keep** (owner scope decision) | Not synthesis; low priority |
| TASK_2026_281 | Four harness entry points the reconciler cannot see; split RPC facade | backlog | **keep** | Harness correctness |
| TASK_2026_312 | Harness boot-line scope mismatch between hosts | backlog | **keep** | Harness correctness |

## Outcome records, routing and measurement

| ID | Title | Status | Proposed action | Reason |
| --- | --- | --- | --- | --- |
| TASK_2026_646_136a | Optional decision model for orchestration routing (`ptah_route_decide`) | in_progress | **keep, extend**: add `skillsLoaded` to the Req 5 outcome record and keep Req 9 "Success" removal | The rethink uses its outcome record and matrix (evaluation-report Step 1-2) |
| TASK_2026_535 | Lanes: model discovery in `ptah_agent_list` and a persisted lane outcome ledger | backlog | **merge into TASK_2026_646_136a** | Same outcome ledger as 646 Req 5; two ledgers would split the evidence |
| TASK_2026_537 | Task intake classification: typed intake, gate triggers and routing | backlog | **merge into TASK_2026_646_136a** or rescope after it | 646 Req 2 already returns task kind and routing |
| TASK_2026_624_d671 | Memory and skills bench: recordings and first scored run | backlog | **rescope** to memory only | The skills suites measure a pipeline proposed for removal; memory stays as is |
| TASK_2026_611_8fe7 | TASK_2026_609 follow-ups (subagent setup, model control, harness safety) | backlog | **keep**, drop any item about synthesis | Mostly harness and subagent safety |

## Thoth UI (epic TASK_2026_637_e30b)

| ID | Title | Status | Proposed action | Reason |
| --- | --- | --- | --- | --- |
| TASK_2026_637_e30b | Thoth UI: overview, quarantine restore and storage visibility | backlog | **rescope**: remove synthesis tabs from scope; keep memory, Library, quarantine | Recommended, Sessions, Activity and Settings tabs are proposed for removal |
| TASK_2026_587_bffd | Thoth Overview (Health, Needs your attention, Recent outcomes) and activity ledger | backlog | **rescope**: "Recent outcomes" reads 646 outcome records, not the synthesis queue | Avoid a second activity ledger |

## Done or cancelled, for reference (no action)

| ID | Status | Note |
| --- | --- | --- |
| TASK_2026_620_a13e | done | Built the bench and pause switches; no skills run scored |
| TASK_2026_588_f4f8 | cancelled | Its "≥ 2 sessions, delete single-session candidate" rule was never implemented |
| TASK_2026_578 | done | Candidate on Accept; follow-ups went to 620 |
| TASK_2026_471_b3d1 | done | Human rubric 1.25-2.38 vs judge 7.8-8.4 |
| TASK_2026_473_c9f4 | done | Track B absorbed into 620, never implemented |
| TASK_2026_441_7825 | done | Lanes-first rules (PR #718) |

## New task to file if the user accepts the rethink

| Proposed task | Content |
| --- | --- |
| "Switch off skill synthesis and remove the pipeline" | Step 0 (settings only) now; after 14 quiet days, delete the components marked remove-proposed in `parity-inventory.md`, with DB migrations that drop the skill tables |
| "Skill value metric (Gate 0)" | After 646 Req 5 has 30 days of records with `skillsLoaded`, compute Use and Lift for authored skills; decide go / no-go for Step 3 |
