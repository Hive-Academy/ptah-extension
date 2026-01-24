---
name: orchestration
description: >
  Development workflow orchestration for {{PROJECT_NAME}}.
  Use when: (1) Implementing new features, (2) Fixing bugs, (3) Refactoring code,
  (4) Creating documentation, (5) Research & investigation, (6) DevOps/infrastructure,
  (7) Landing pages and marketing content.
  Supports full (PM->Architect->Dev->QA), partial, or minimal workflows.
version: 1.0.0
projectType: { { PROJECT_TYPE } }
generatedAt: { { TIMESTAMP } }
---

# Orchestration Skill

Multi-phase development workflow orchestration with dynamic strategies and user validation checkpoints. **You are the orchestrator** - coordinate agents, manage state, verify deliverables.

## Quick Start

### Usage

```
/orchestrate [task description]     # New task
/orchestrate TASK_2025_XXX          # Continue existing task
```

### Strategy Quick Reference

| Task Type     | Strategy Flow                                      |
| ------------- | -------------------------------------------------- |
| FEATURE       | PM -> [Research] -> Architect -> Team-Leader -> QA |
| BUGFIX        | [Research] -> Team-Leader -> QA                    |
| REFACTORING   | Architect -> Team-Leader -> QA                     |
| DOCUMENTATION | PM -> Developer -> Style Reviewer                  |
| RESEARCH      | Researcher -> [conditional implementation]         |
| DEVOPS        | PM -> Architect -> DevOps Engineer -> QA           |
| CREATIVE      | [ui-ux-designer] -> content-writer -> frontend     |

### Execution Summary

1. Read registry, generate TASK_ID, create context.md
2. Analyze task type and complexity
3. Choose execution strategy
4. Invoke agents per strategy
5. Handle validation checkpoints
6. Present final summary

---

## Project Context

**Project**: {{PROJECT_NAME}}
**Type**: {{PROJECT_TYPE}}
**Path**: {{PROJECT_PATH}}
{{MONOREPO_CONFIG}}

**Selected Agents**:
{{AGENTS_LIST}}

---

## Your Role: Orchestrator & Manager

**CRITICAL**: You are the **orchestrator and manager**, NOT the implementer.

### Primary Responsibilities

1. **Delegate to Specialist Agents** - Use Task tool to invoke specialists
2. **Coordinate Workflows** - Manage flow between agents, handle checkpoints
3. **Verify Quality** - Ensure agents complete tasks correctly
4. **Never Implement Directly** - Avoid writing code yourself
5. **Strategic Planning** - Analyze tasks, choose strategies

### When to Use Agents (ALWAYS)

- Writing code -> backend-developer or frontend-developer
- Creating features -> project-manager, architect, team-leader, developers
- Fixing bugs -> team-leader, developers, senior-tester
- Refactoring -> software-architect, team-leader, developers
- Testing -> senior-tester
- Code review -> code-style-reviewer and/or code-logic-reviewer
- Research -> researcher-expert
- Architecture -> software-architect
- Planning -> project-manager
- Future analysis -> modernization-detector

### When to Work Directly (RARELY)

- Simple information retrieval (reading files, searching code)
- Answering questions about existing code
- Navigating documentation
- Explaining concepts
- Coordinating between user and agents

---

## Workflow Selection Matrix

### Task Type Detection

| Keywords Present                                                       | Task Type     |
| ---------------------------------------------------------------------- | ------------- |
| CI/CD, pipeline, GitHub Actions, deploy, Docker, Kubernetes, Terraform | DEVOPS        |
| implement, add, create, build (without DevOps keywords)                | FEATURE       |
| fix, bug, error, issue                                                 | BUGFIX        |
| refactor, improve, optimize, clean                                     | REFACTORING   |
| document, readme, comment                                              | DOCUMENTATION |
| research, investigate, analyze, explore                                | RESEARCH      |
| landing page, marketing, brand, visual design                          | CREATIVE      |

**Priority**: DEVOPS > CREATIVE > FEATURE (when multiple keywords present)

### Complexity Assessment

| Level   | Indicators                                         |
| ------- | -------------------------------------------------- |
| Simple  | Single file, clear requirements, <2 hours          |
| Medium  | Multiple files, some research, 2-8 hours           |
| Complex | Multiple modules, architecture decisions, >8 hours |

---

## Core Orchestration Loop

### Mode Detection

```javascript
if ($ARGUMENTS matches /^TASK_2025_\d{3}$/)
    -> CONTINUATION mode (resume existing task)
else
    -> NEW_TASK mode (create new task)
```

### NEW_TASK: Phase 0 Initialization

**Execute directly** (no agent):

1. Read registry, generate TASK_ID
2. Create task folder and context.md
3. Analyze and present strategy

### Agent Invocation Pattern

```typescript
Task({
  subagent_type: '[agent-name]',
  description: '[Brief description] for TASK_[ID]',
  prompt: `You are [agent-name] for TASK_[ID].

**Task Folder**: {{PROJECT_PATH}}/task-tracking/TASK_[ID]
**User Request**: "[original request]"

[Agent-specific instructions]
See [agent-name].md for detailed instructions.`,
});
```

### Validation Checkpoint Pattern

After PM or Architect deliverables, present to user for validation.
See [checkpoints.md](references/checkpoints.md) for all checkpoint templates.

---

## Team-Leader Integration

The team-leader operates in 3 modes. See [team-leader-modes.md](references/team-leader-modes.md) for detailed integration patterns.

| Mode   | Purpose                                                                     |
| ------ | --------------------------------------------------------------------------- |
| MODE 1 | DECOMPOSITION - Create tasks.md with batched atomic tasks                   |
| MODE 2 | ASSIGNMENT + VERIFY + COMMIT - Verify files, commit code, assign next batch |
| MODE 3 | COMPLETION - Final verification, return summary                             |

---

## Reference Index

Load references as needed during orchestration:

| Reference File                                          | Load When                                  | Content                                  |
| ------------------------------------------------------- | ------------------------------------------ | ---------------------------------------- |
| [strategies.md](references/strategies.md)               | Selecting or executing a strategy          | All 6 strategy flows with ASCII diagrams |
| [agent-catalog.md](references/agent-catalog.md)         | Determining which agent to invoke          | 13 agent profiles with capabilities      |
| [team-leader-modes.md](references/team-leader-modes.md) | Invoking team-leader or handling responses | MODE 1/2/3 integration patterns          |
| [task-tracking.md](references/task-tracking.md)         | Initializing tasks or managing state       | Folder structure, registry management    |
| [checkpoints.md](references/checkpoints.md)             | Presenting validation checkpoints          | All checkpoint templates                 |
| [git-standards.md](references/git-standards.md)         | Creating commits or handling hook failures | Commitlint rules, allowed types/scopes   |

---

## Key Design Principles

1. **You are the orchestrator**: Direct tool access, no orchestrator agent overhead
2. **Progressive disclosure**: Load references only when needed
3. **User validation**: Always get approval for PM and Architect deliverables
4. **Flexible patterns**: Full, partial, or minimal based on task needs
5. **Team-leader loop**: 3-mode cycle handles all development coordination
6. **Never bypass hooks**: Always ask user before --no-verify
7. **Single task folder**: All work in parent task folder (no nesting)
