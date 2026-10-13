# Batch 4F report

## Changes

| Task | File:line evidence | Result |
| --- | --- | --- |
| 4F.1 | `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/git-standards.md:86-100` | Restored the `Ask first` rule, seven-row destructive-command table, equivalent-command catch-all, and inspect-state instruction. The existing `Quiet commit window` and `Hook Failure Protocol` headings remain at lines 43 and 49, preserving their anchors. |
| 4F.2 | `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md:117-130` | Added a bounded no-push path: at most 5 status checks per lane, at least 60 s apart, followed by an end-of-turn notice or `ptah_agent_stop` and §5 non-limit recovery. The per-turn signal and queued-message rules remain. |
| 4F.3 | `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/checkpoints.md:195-203` | Set the `"use lanes more"` approval cell to `` `lane-review` with a spawnable lane, unless "gate me" was given; otherwise `user` ``. Lane mode remains `enabled`. |
| 4F.4 | `scripts/validate-orchestration-skill.ts:625-675` | Added four marker checks for the template's prose `Batch` section, bounded no-push path, approval response, and destructive-command list. Existing checks remain, including the `Mode 1 — Decomposition` fenced-schema check at line 637. The template's `### Batch` prose begins at `libs/backend/agent-generation/templates/agents/team-leader.template.md:145`; its new markers occur at lines 157 and 163, before the next heading at line 178 and outside any fence. |

## Validator

Command run once: `npm run validate-skill 2>&1 | Select-Object -Last 30` (PowerShell command propagated npm's exit code). Exit code: `0`.

```text
> @ptah-extension/source@0.0.0 validate-skill
> npx ts-node scripts/validate-orchestration-skill.ts

========================================
  Orchestration Skill Validation
========================================
Found 9 markdown files to validate

========================================
  Validation Summary
========================================
  Files checked: 9
  Errors: 0
  Warnings: 0

  VALIDATION PASSED
```

## Changed source files

`git diff --name-only` output:

```text
apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md
apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/checkpoints.md
apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/git-standards.md
scripts/validate-orchestration-skill.ts
```

Absolute paths of the four modified source files:

- `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\agent-lanes\SKILL.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\references\checkpoints.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\references\git-standards.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\scripts\validate-orchestration-skill.ts`

The report itself is `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8\.ptah\specs\TASK_2026_441_7825\batch-4f-report.md`. No git write was performed.
