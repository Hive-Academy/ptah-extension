---
description: Orchestrate development workflows with specialist agents, including fleets of existing tasks.
argument-hint: '[task description] or TASK_YYYY_NNN[_xxxx] [TASK_YYYY_NNN[_xxxx] ...] or fleet request'
---

# Orchestrate Development Workflow

Invoke the orchestration skill for development workflows.

## Usage

```
/orchestrate [task description]     # New task
/orchestrate TASK_YYYY_NNN[_xxxx]  # Continue one existing task
/orchestrate TASK_A TASK_B ...      # Coordinate several existing tasks as a fleet
/orchestrate fleet [task IDs]       # Explicit fleet request
```

## Select the workflow

Resolve every supplied task ID against an existing `.ptah/specs/<id>/task.md` and reject missing, malformed, or duplicate IDs before any agent spawn. Do not create a task for an invalid ID. A single resolved ID continues the ordinary task workflow, including when the request says “fleet.” Multiple resolved IDs or an explicit fleet request covering several tasks selects fleet mode; load `references/fleet.md` from the orchestration skill directory and reconstruct progress from disk artifacts. If an explicit fleet request has no usable task set, resolve it before spawning. A task description without existing IDs starts the normal new-task workflow.

## Execution

1. Invoke the `orchestration` skill (Skill tool) — do not Read it by relative path
2. Follow the Workflow Selection Matrix to determine strategy
3. Execute the chosen strategy (invoke agents, handle checkpoints)
4. Load references as needed during execution, resolving them relative to the
   orchestration skill's own directory:
   - `references/strategies.md` - Strategy details and flows
   - `references/agent-catalog.md` - Agent profiles and invocation
   - `references/team-leader-modes.md` - MODE 1/2/3 integration
   - `references/task-tracking.md` - Folder structure and registry
   - `references/checkpoints.md` - User validation templates
   - `references/git-standards.md` - Commit rules and hook handling
   - `references/lane-assignment.md` - CLI lanes: who spawns, per-role hand-offs, phases on lanes
   - `references/fleet.md` - Multi-task scheduling, artifact checkpoints, resume, and judge rounds

## Quick Reference

**Strategies**: FEATURE, BUGFIX, REFACTORING, DOCUMENTATION, RESEARCH, DEVOPS, CREATIVE

**Agents** (13): project-manager, software-architect, team-leader, backend-developer, frontend-developer, devops-engineer, senior-tester, code-style-reviewer, code-logic-reviewer, researcher-expert, modernization-detector, ui-ux-designer, technical-content-writer

**Checkpoints**: Scope Clarification, Requirements Validation, Architecture Validation, QA Selection

**Fleet**: several validated task IDs, disjoint batches, disk-based resume, independent judge, quiet commit window

## Skill

`orchestration` — invoke it with the Skill tool. Its location on disk varies by
host and install method, so never hardcode a workspace-relative path to it.
