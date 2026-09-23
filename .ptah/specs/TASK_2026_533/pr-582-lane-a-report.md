# PR #582 lane A review fixes

All seven comments were verified against plugin-source files and fixed; none skipped.

`P` = `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills`.

| Comment id | File:line | Change or skip reason |
| --- | --- | --- |
| 4085139975 + outside-diff note | `P/agent-lanes/SKILL.md:151` | Fixed: verified the supplied preserve list or parity inventory item by item; retained the block on missing, unapproved capabilities and required explicit user approval for proposed removals before batch acceptance. |
| 4085139986 | `P/orchestration/references/agent-catalog.md:71` | Fixed: designer invocation now names absolute spec-file and prototype-folder paths, requires both on disk, and requires a separate WROTE confirmation for each. |
| 4085139998 | `P/orchestration/references/task-tracking.md:147` | Fixed: after the current revision passes Gate 1.7, continuation follows the type/strategy recorded in context.md; CREATIVE proceeds to the content writer, BUGFIX to Mode 1, and architecture flows to the architect. |
| 4085140006 | `P/orchestration/SKILL.md:42` | Fixed: one rule below the unchanged flow table inserts designer, prototype, cross-side review and Gate 1.7 whenever a flow adds or redesigns UI, before architect/team-leader or the next creative phase. |
| 4085420540 | `P/orchestration/references/team-leader-modes.md:14`, `P/orchestration/references/team-leader-modes.md:41` | Fixed per decision: BUGFIX Mode 1 requires no implementation plan; decomposition uses task.md, context.md and research-report.md when present, while retaining any required design gate. |
| 4085420546 | `P/orchestration/references/team-leader-modes.md:58` | Fixed: obtain the required shipping-code review (reuse eligible evidence), invoke additional named reviewers, and pass every actual report path and verdict to Mode 2, including style and visual reports. |
| 4085420552 | `P/orchestration/references/checkpoints.md:219`, `P/orchestration/references/checkpoints.md:343`, `P/orchestration/references/checkpoints.md:418` | Fixed in all three gate templates: disclose the recorded fallback reason: user pin, lanes disabled at Gate 0.1, or opposite side unavailable. |

Validation:

- `agent-lanes/SKILL.md`: 221 lines (limit: 230).
- All six edited source files are UTF-8 with LF endings and no CR bytes.
- Targeted content assertions passed for all seven fixes, including all three fallback templates.
- `git diff --check`: passed for the current worktree.
- Documentation-only changes; no build or test suite run.
- This lane edited only the six authorized source files and this required report. Concurrent changes by other lanes were left untouched. No commit created.
- Nothing blocked or left undone within this lane.

## Revise round 1

All six assigned defects were verified and closed in plugin source using the orchestrator decisions.

| Defect | File:line | Change |
| --- | --- | --- |
| D1 | `P/orchestration/SKILL.md:50`, `P/orchestration/SKILL.md:42`, `P/orchestration/references/agent-catalog.md:82`, `P/orchestration/references/agent-catalog.md:82`, `P/orchestration/references/task-tracking.md:114` | Closed: the Task folder rule gives no-PM flows an inventory-only software-architect invocation against OLD code before design. A required plan phase follows Gate 1.7; BUGFIX remains plan-free. Flow descriptions, invocation/output contract, profiles and artifact ownership reflect that order. |
| D2 | `P/orchestration/SKILL.md:67`, `P/orchestration/references/agent-catalog.md:97`, `P/orchestration/references/checkpoints.md:304`, `P/orchestration/references/checkpoints.md:354` | Closed: Gate 1.7 precedes the next phase of the recorded flow (architect, team-leader, or content writer), including the approval reply and designer profile. |
| D3 | `P/orchestration/references/task-tracking.md:146`, `P/orchestration/references/task-tracking.md:148`, `P/orchestration/references/task-tracking.md:149`, `P/orchestration/references/agent-catalog.md:135` | Closed: BUGFIX continuation follows planned research when needed, then plan-free Mode 1; an existing research report goes to Mode 1. Required inventory/design still runs first; a parity-only continuation resumes the design gate rather than losing the flow. |
| D4 | `P/orchestration/references/team-leader-modes.md:56` | Closed (skills half): blocked plan-free BUGFIX returns to the orchestrator for Gate SR or researcher-expert, then Mode 1. Architect revision/Gate 2 applies only to planned flows. Template work belongs to the other lane. |
| D9 | `P/agent-lanes/SKILL.md:151`, `P/orchestration/SKILL.md:95` | Closed (skills half): consolidation is explicit in the verification row; the removal guard accepts recorded approval in either the parity inventory or lane preserve list. Template wording belongs to the other lane. |
| D10 | `P/orchestration/SKILL.md:96` | Closed: same-side review discloses its recorded reason: user pin, lanes disabled at Gate 0.1, or opposite side unavailable. |

Validation: targeted content checks passed; `agent-lanes/SKILL.md` remains 221/230 lines; all six edited source files and this report use LF with no CR bytes; `git diff --check` passed. Documentation-only changes; no build/test suite run. No mirrors, templates or manifest edited by this lane; no commit. Nothing blocked within the assigned skills scope.

## Revise round 2

| Item | File:line | Change |
| --- | --- | --- |
| N1 | `P/orchestration/references/agent-catalog.md:48` | Moved Infrastructure directly below Demo video inside the selection table; the conditional-flow paragraph now follows the complete table. |
| N2 | `P/orchestration/references/task-tracking.md:149` | Parity-only continuation explicitly runs any planned research first, then resumes required design and the recorded next phase. |

Validation: selection-table rows are contiguous, Infrastructure immediately follows Demo video, and the paragraph is separated from the table. The parity-only action begins with the required research-first instruction. Both source files and this report use LF with no CR bytes; `git diff --check` passed. Only the two authorized source files and this report were edited in this round. No commit; nothing left undone in scope.
