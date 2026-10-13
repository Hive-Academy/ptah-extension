# Batch 2, Task 2.1 report

## Quality requirements and evidence

| Requirement | Change and file:line evidence |
| --- | --- |
| Gate 0.1 preference decision | `SKILL.md:82,90-96` and `checkpoints.md:167-180` call `ptah_memory_search` before mode selection, give the current explicit instruction priority, resolve stale/conflicting memory by the most recent unambiguous preference or ask, default to `enabled` with a capable spawnable lane, retain `auto`, record `preference unknown` on memory failure, and choose `disabled` plus `Approval: user` when a stored lane preference has no spawnable lane. `checkpoints.md:205-206` and `lane-assignment.md:20-22` require source, mode, approval and live rows in `context.md`. |
| Document gate integrity | `SKILL.md:98-115` labels `Document gates` and keeps cross-side APPROVED for Gates 1/1.7/2. `checkpoints.md:94-113,130-151` applies Approval mode only to document gates, keeps opposite-side review and all five escalations, and excludes shipping-code review from that protocol. `lane-assignment.md:93,118-119` retains the opposite-side document-review row and sends same-side document reviews to the user. |
| Fleet entry and ID validation | `SKILL.md:47-50,186` routes multi-ID `/orchestrate TASK_A TASK_B ...` or an explicit fleet request to `references/fleet.md` after ID validation; one ID remains ordinary continuation. The referenced file is scheduled for Task 3.1. |
| Lane assignment and boundaries | `lane-assignment.md:35-38,78-93,113-119` defaults bounded batches, tests, research and reviews to capable lanes, including sequential coupled files; retains the ≤6-file/≤2-lib cap and document-review distinction; uses independent different-family review for shipping code, with reason and weaker-evidence label for same-family/subagent fallback. `team-leader-modes.md:92-96` now includes a sequential CLI-lane executor. `lane-assignment.md:60-72` keeps UI/browser, user-contact and git restrictions. |
| Generic live roster | `lane-assignment.md:95-111` replaces named vendors and hardcoded spawn arguments with placeholders filled from current `ptah_agent_list` rows. User pins are resolved against those rows. |
| Phase review and reporting | `SKILL.md:103-105,166-171` and `team-leader-modes.md:36-43,64-68,80` require one eligible independent phase code-logic review of the combined diff, prefer a different-family capable lane, and record actual executor, author/reviewer families, same-family reason, weaker-evidence label and `Subagent reason` when used. The existing review cap stays at `team-leader-modes.md:42-43`. |

## Grep self-check

- Fixed vocabulary found: `Document gates` (`SKILL.md:98`), `Shipping code` (`SKILL.md:103`), `other family same capability` and `same family other provider/model` (`lane-assignment.md:113`), `subagent` (`lane-assignment.md:114`), `Subagent reason` (`lane-assignment.md:115`), `Review family` (`lane-assignment.md:101`), `reset unknown` and `AT LIMIT` (`lane-assignment.md:38`, `checkpoints.md:171-172`).
- All five escalation sentences remain at `checkpoints.md:107-111`: capped REVISE, same-side/no reviewer, proposed removal, Clarifications Needed, and user request/feedback. The cross-side document protocol remains at `checkpoints.md:130-151`.
- Grep found no `Codex`, `Claude provider`, `Ollama Cloud`, `CLI-authored`, or `opposite execution side from the implementer` in the four assigned files. The old named-vendor example and CLI-author-to-subagent rule are gone.
- Verification was limited to `rg -n` checks as instructed. No validator, build, test, workspace-wide command or diagnostics run.

## Listed risks and handling

| Risk | Handling |
| --- | --- |
| R2-1, quota authority | `checkpoints.md:171-172` and `lane-assignment.md:38` treat a live `ptah_agent_list` `AT LIMIT` row, including `reset unknown`, as unavailable. This lane does not present `failureKind` as model-visible. Task 2.2 owns detailed fallback behavior. |
| Queued message after delivered signal | Task 2.2 owns the completion-signal rule; no conflicting rule added here. |
| R2-2, escalation regression | Preserved all five escalation sentences at `checkpoints.md:107-111`; grep confirmed them. Batch 1 validator work owns automated markers. |
| R2-3, split marker form | `SKILL.md:98,103` uses exact `Document gates` and `Shipping code` labels; Task 2.2 and Batch 1 own agent-lanes bullets and validator coverage. |
| R2-4, example roster removal | Replaced only example content with live-row placeholders at `lane-assignment.md:95-111`; no review rule was dropped. |
| Parallel text drift | Used every fixed-vocabulary string above exactly; grep confirmed their presence. |
| No spawnable preferred lane / stale memory / memory outage | Explicit Gate 0.1 branches at `checkpoints.md:167-180`; source and outcome recorded at `checkpoints.md:205-206`. |
| Manifest fixture, workflow status ownership, expected-red validator, manifest bump | Owned by Batches 6, 5, 1 and 7 respectively; outside these four assigned files. No related file was changed. |

## Modified files (absolute paths)

- `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\SKILL.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\references\checkpoints.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\references\lane-assignment.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\references\team-leader-modes.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\.ptah\specs\TASK_2026_441_7825\batch-2-task-2.1-report.md`
