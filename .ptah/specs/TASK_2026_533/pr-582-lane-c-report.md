# PR #582 lane C report

Applied all 11 items after checking the review claims against the task specs; no skips. PR #581's open status, branch and log fix were accepted as supplied facts.

Paths below are relative to the worktree root.

| Item / comment id | File:line | Change |
| --- | --- | --- |
| 1 / 4085140051 | `.ptah/specs/TASK_2026_535/task.md:27` | Added a blank line after every heading that ran straight into content, including sections A-D, Out of scope, Acceptance and Process. |
| 2 / 4085140058 | `.ptah/specs/TASK_2026_535/task.md:64` | Model selection uses discovered ids only; tiers require a listed ptah-cli mapping. If no id fits, explicitly use the configured default or another lane; never invent ids. |
| 3 / 4085140069 | `.ptah/specs/TASK_2026_535/task.md:48`, `:82`, `:110` | Added the distinct `role-conflict` verdict and an acceptance case excluding it from lane-failure counts. |
| 4 / orchestrator addition | `.ptah/specs/TASK_2026_535/task.md:49`, `:85`, `:112` | Added section E: OpenCode MCP wiring following Codex, per-run availability beside `messaging:`, ledger fields, `report_channel: none` without a missing-report penalty, and real adapter errors. Recorded both shell-tool failures and session `ses_f30756f2affeWVWDVqx2F4ne8S`; added acceptance coverage. |
| 5 / 4085140106 | `.ptah/specs/TASK_2026_537/task.md:55`, `:83` | Null gate-driving flags require a question or conservative gate; null replacement status requires parity inventory and Gate 1.7 unless the user says otherwise. |
| 6 / 4085140115 | `.ptah/specs/TASK_2026_537/task.md:58`, `:85` | Made act/confirm/ask bands disjoint and added boundary acceptance cases. |
| 7 / 4085140124 | `.ptah/specs/TASK_2026_537/task.md:64`, `:80` | Required disjoint training/calibration/holdout sets, task-grouped split assignments with ids and hashes in a versioned manifest, and exclusion of required holdout examples including TASK_2026_523 from training and calibration. |
| 8 / 4085140131 | `.ptah/specs/TASK_2026_537/task.md:46`, `:87` | Reject cross-origin redirects and prohibit sending the BYO key to another host; acceptance checks no key forwarding. |
| 9 / 4085140148 | `.ptah/specs/TASK_2026_538/task.md:5`, `:19`, `:37` | Added TASK_2026_534 dependency, stated that open PR #581 contains the log fix while main does not, required its branch as the base, and retained the exact `agent:setConfig` field-names-only log regression test. |
| 10 / 4085140162 | `.ptah/specs/TASK_2026_538/task.md:23`, `:41` | Added blank lines after Scope and Process headings. |
| 11 / 4085140167 | `.ptah/specs/TASK_2026_538/task.md:30`, `:38` | Named VS Code extension, Electron desktop app and headless CLI; each composition root/settings bootstrap owns startup migration registration. Required idempotence and acceptance through every runtime's registration path. |

Validation: `git diff --check` passed. All three edited specs are UTF-8 with LF; heading spacing checks passed for TASK_2026_535 and TASK_2026_538. No runtime tests were needed for these spec-only edits. Existing unrelated changes were left untouched. No commit was created. Nothing requested was skipped or blocked.

## Revise round 1

| Defect | File:line | Change |
| --- | --- | --- |
| D12 | `.ptah/specs/TASK_2026_535/task.md:50`, `:85` | Added `failure_kind` with task, quota, adapter, timeout and role-conflict values; NULL on success or unknown. Role conflicts explicitly use the matching failure kind. |
| D13 | `.ptah/specs/TASK_2026_535/task.md:56`, `:85`, `:130` | Spawn-time role/deliverable rejection writes a ledger row with status rejected, verdict and failure kind role-conflict, and NULL agent/process fields. Acceptance verifies the row and exclusion from lane-failure counts. |
| D14 | `.ptah/specs/TASK_2026_537/task.md:45` | Local heads train only on the training split defined in item 5, preserving calibration and holdout isolation. |
| D15 | `.ptah/specs/TASK_2026_537/task.md:18`, `:75`, `:81` | Added blank lines after Principles, Research first and Acceptance. |

All four defects closed. Preserved the orchestrator's TASK_2026_535 section E and OpenCode acceptance edits. LF and heading spacing checks passed for both specs; `git diff --check` passed. No commit; no skips or blockers.

## Revise round 2

| Item | File:line | Change |
| --- | --- | --- |
| N3 | `.ptah/specs/TASK_2026_535/task.md:45`, `:88`, `:133` | Added `run_id` as the primary key and made `agent_id` nullable and indexed. Section D and Acceptance require rejected rows to have their own `run_id` with NULL `agent_id`/process fields; acceptance covers multiple rejected rows coexisting. |

N3 closed. LF verified for the spec and report; `git diff --check` passed. Only TASK_2026_535 and this report changed in this round. No commit; no skips or blockers.
