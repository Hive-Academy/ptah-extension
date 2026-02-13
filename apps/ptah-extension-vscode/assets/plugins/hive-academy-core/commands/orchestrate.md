# Orchestrate Development Workflow

Invoke the orchestration skill for development workflows.

## Usage

```
/orchestrate [task description]     # New task
/orchestrate TASK_2025_XXX          # Continue existing task
```

## Execution

1. Load `.claude/skills/orchestration/SKILL.md`
2. Follow the Workflow Selection Matrix to determine strategy
3. Execute the chosen strategy (invoke agents, handle checkpoints)
4. Load references as needed during execution:
   - `references/strategies.md` - Strategy details and flows
   - `references/agent-catalog.md` - Agent profiles and invocation
   - `references/team-leader-modes.md` - MODE 1/2/3 integration
   - `references/task-tracking.md` - Folder structure and registry
   - `references/checkpoints.md` - User validation templates
   - `references/git-standards.md` - Commit rules and hook handling

## Quick Reference

**Strategies**: FEATURE, BUGFIX, REFACTORING, DOCUMENTATION, RESEARCH, DEVOPS, CREATIVE

**Agents** (13): project-manager, software-architect, team-leader, backend-developer, frontend-developer, devops-engineer, senior-tester, code-style-reviewer, code-logic-reviewer, researcher-expert, modernization-detector, ui-ux-designer, technical-content-writer

**Checkpoints**: Scope Clarification, Requirements Validation, Architecture Validation, QA Choice

## Skill Path

`.claude/skills/orchestration/SKILL.md`
