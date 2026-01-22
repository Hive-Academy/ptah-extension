---
name: orchestration
description: >
  Development workflow orchestration for software engineering tasks.
  Use when: (1) Implementing new features, (2) Fixing bugs, (3) Refactoring code,
  (4) Creating documentation, (5) Research & investigation, (6) DevOps/infrastructure,
  (7) Landing pages and marketing content.
  Supports full (PM->Architect->Dev->QA), partial, or minimal workflows.
  Invoked via /orchestrate command or directly when task analysis suggests delegation.
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

| Task Type       | Strategy Flow                                    |
|-----------------|--------------------------------------------------|
| FEATURE         | PM -> [Research] -> Architect -> Team-Leader -> QA |
| BUGFIX          | [Research] -> Team-Leader -> QA                  |
| REFACTORING     | Architect -> Team-Leader -> QA                   |
| DOCUMENTATION   | PM -> Developer -> Style Reviewer                |
| RESEARCH        | Researcher -> [conditional implementation]       |
| DEVOPS          | PM -> Architect -> DevOps Engineer -> QA         |
| CREATIVE        | [ui-ux-designer] -> content-writer -> frontend   |

### Execution Summary

1. Read registry, generate TASK_ID, create context.md
2. Analyze task type and complexity
3. Choose execution strategy
4. Invoke agents per strategy
5. Handle validation checkpoints
6. Present final summary

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

**Default**: When in doubt, delegate via `/orchestrate` or direct Task invocation.

---

## Workflow Selection Matrix

### Task Type Detection

Analyze the user request to determine task type:

| Keywords Present                                      | Task Type       |
|------------------------------------------------------|-----------------|
| CI/CD, pipeline, GitHub Actions, deploy, Docker, Kubernetes, Terraform, publish, monitoring | DEVOPS |
| implement, add, create, build (without DevOps keywords) | FEATURE |
| fix, bug, error, issue                               | BUGFIX          |
| refactor, improve, optimize, clean                   | REFACTORING     |
| document, readme, comment                            | DOCUMENTATION   |
| research, investigate, analyze, explore              | RESEARCH        |
| landing page, marketing, brand, visual design        | CREATIVE        |

**Priority**: DEVOPS > CREATIVE > FEATURE (when multiple keywords present)

### Complexity Assessment

| Level   | Indicators                                        |
|---------|--------------------------------------------------|
| Simple  | Single file, clear requirements, <2 hours        |
| Medium  | Multiple files, some research, 2-8 hours         |
| Complex | Multiple modules, architecture decisions, >8 hours |

### Strategy Selection

After detecting task type, select the appropriate strategy:

```
if DEVOPS keywords present:
    → DEVOPS strategy (always use devops-engineer)
elif CREATIVE keywords present:
    → Check design system exists
    → CREATIVE strategy (ui-ux-designer + content-writer)
elif FEATURE keywords present:
    → FEATURE strategy (full workflow)
elif BUGFIX keywords present:
    → BUGFIX strategy (streamlined)
elif REFACTORING keywords present:
    → REFACTORING strategy (architect-led)
elif DOCUMENTATION keywords present:
    → DOCUMENTATION strategy (minimal)
elif RESEARCH keywords present:
    → RESEARCH strategy (investigation)
else:
    → Ask user for clarification
```

---

## Core Orchestration Loop

### Mode Detection

```javascript
if ($ARGUMENTS matches /^TASK_2025_\d{3}$/)
    → CONTINUATION mode (resume existing task)
else
    → NEW_TASK mode (create new task)
```

### NEW_TASK: Phase 0 Initialization

**Execute directly** (no agent):

#### Step 1: Read Registry & Generate TASK_ID

```bash
Read(task-tracking/registry.md)
# Find highest TASK_2025_XXX number, increment by 1
```

#### Step 2: Create Task Folder & Context

```bash
mkdir task-tracking/TASK_[ID]

Write(task-tracking/TASK_[ID]/context.md)
# Include: User Intent, Technical Context, Execution Strategy
```

#### Step 3: Analyze & Present

```markdown
# Orchestrating Workflow - TASK_[ID]

**Task ID**: TASK_[ID]
**Type**: [FEATURE|BUGFIX|...]
**Complexity**: [Simple|Medium|Complex]

## Execution Strategy: [STRATEGY_NAME]

**Planned Agent Sequence**:
[List agents based on chosen strategy]

## Starting Phase 1...
```

### CONTINUATION: Phase Detection

Read task folder contents to determine current phase:

| Documents Present              | Next Action                      |
|-------------------------------|----------------------------------|
| context.md only               | Invoke project-manager           |
| task-description.md           | User validate OR invoke architect |
| implementation-plan.md        | User validate OR team-leader MODE 1 |
| tasks.md (all PENDING)        | Team-leader MODE 2 (first batch) |
| tasks.md (has IN PROGRESS)    | Team-leader MODE 2 (verify)      |
| tasks.md (has IMPLEMENTED)    | Team-leader MODE 2 (commit)      |
| tasks.md (all COMPLETE)       | Team-leader MODE 3 OR QA choice  |
| test-report.md                | Continue QA or complete          |
| future-enhancements.md        | Workflow already complete        |

See [task-tracking.md](references/task-tracking.md) for full phase detection table.

### Agent Invocation Pattern

```typescript
Task({
  subagent_type: '[agent-name]',
  description: '[Brief description] for TASK_[ID]',
  prompt: `You are [agent-name] for TASK_[ID].

**Task Folder**: [absolute path to task folder]
**User Request**: "[original request]"

[Agent-specific instructions]
See [agent-name].md for detailed instructions.`
});
```

### Validation Checkpoint Pattern

After PM or Architect deliverables, present to user:

```markdown
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[REQUIREMENTS|ARCHITECTURE] READY FOR REVIEW - TASK_[ID]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Summary of deliverable]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
USER VALIDATION CHECKPOINT
Reply "APPROVED" to proceed
OR provide feedback for revision
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

See [checkpoints.md](references/checkpoints.md) for all checkpoint templates.

---

## Flexible Invocation Patterns

### Pattern 1: Full Workflow

**When**: New features with unclear scope, complex requirements

```
PM → USER VALIDATES → [Research] → [UI/UX] → Architect → USER VALIDATES
    → Team-Leader (3 modes) → USER CHOOSES QA → [QA agents]
    → Git → Modernization
```

**Agents**: project-manager, researcher-expert (optional), ui-ux-designer (optional), software-architect, team-leader, developers, senior-tester, code-style-reviewer, code-logic-reviewer, modernization-detector

### Pattern 2: Partial Workflow

**When**: Refactoring with known requirements, extensions of existing features

```
Architect → USER VALIDATES → Team-Leader (3 modes) → USER CHOOSES QA → [QA agents]
```

**Skip**: project-manager (requirements already clear)

### Pattern 3: Minimal Workflow

**When**: Simple fixes, quick reviews, documentation updates

```
Developer OR Reviewer (single agent)
```

**Skip**: PM, Architect, Team-Leader overhead

### Pattern Selection Guidance

| Situation                              | Pattern      |
|---------------------------------------|--------------|
| New feature, vague requirements        | Full         |
| New feature, clear requirements        | Full         |
| Bug fix, unclear cause                 | Full (with research) |
| Bug fix, known cause                   | Minimal      |
| Refactoring, architectural changes     | Partial      |
| Refactoring, localized changes         | Minimal      |
| Documentation only                     | Minimal      |
| Code review only                       | Minimal      |

---

## Team-Leader Integration

The team-leader operates in 3 modes. See [team-leader-modes.md](references/team-leader-modes.md) for detailed integration patterns.

### MODE 1: DECOMPOSITION

**When**: After architect completes (or immediately for bugfix)
**Purpose**: Create tasks.md with batched atomic tasks

### MODE 2: ASSIGNMENT + VERIFY + COMMIT

**When**: After developer returns OR need to assign first/next batch
**Purpose**: Verify files, commit code, assign next batch
**Loop until**: "ALL BATCHES COMPLETE"

### MODE 3: COMPLETION

**When**: All batches show COMPLETE
**Purpose**: Final verification, return summary

### Response Handling

| Team-Leader Says      | Your Action                      |
|----------------------|----------------------------------|
| NEXT BATCH ASSIGNED  | Invoke developer with provided prompt |
| BATCH REJECTED       | Re-invoke developer with issues  |
| ALL BATCHES COMPLETE | Invoke MODE 3                    |

---

## Error Handling

### Validation Rejection

If user provides feedback instead of "APPROVED":

1. Parse feedback into actionable points
2. Re-invoke same agent with feedback
3. Present revised version to user

### Team-Leader Verification Failure

Present options to user:

1. "retry" - Re-invoke developer to fix
2. "manual" - User fixes with guidance
3. "skip" - Mark as failed, continue (NOT RECOMMENDED)

### Commit Hook Failure

**NEVER bypass hooks automatically.** Present options:

1. Fix issue (if related to current work)
2. Bypass with --no-verify (if unrelated)
3. Stop and report (if critical)

See [checkpoints.md](references/checkpoints.md) for error handling templates.

---

## Reference Index

Load references as needed during orchestration:

| Reference File | Load When | Content |
|---------------|-----------|---------|
| [strategies.md](references/strategies.md) | Selecting or executing a strategy | All 6 strategy flows with ASCII diagrams, creative workflows |
| [agent-catalog.md](references/agent-catalog.md) | Determining which agent to invoke | 13 agent profiles with capabilities and invocation patterns |
| [team-leader-modes.md](references/team-leader-modes.md) | Invoking team-leader or handling responses | MODE 1/2/3 integration patterns, response handling |
| [task-tracking.md](references/task-tracking.md) | Initializing tasks or managing state | Folder structure, registry management, phase detection |
| [checkpoints.md](references/checkpoints.md) | Presenting validation checkpoints | All checkpoint templates, error handling patterns |
| [git-standards.md](references/git-standards.md) | Creating commits or handling hook failures | Commitlint rules, allowed types/scopes, hook failure protocol |

### Loading Protocol

1. **Always loaded**: This SKILL.md body (when skill triggers)
2. **Load on demand**: Reference files when specific guidance needed
3. **Never preload**: All references at once (context bloat)

---

## Workflow Completion

### Final Summary Template

```markdown
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WORKFLOW COMPLETE - TASK_[ID]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Summary**:
- Task: [Original request]
- Branch: feature/[XXX]
- PR: [URL]
- Status: COMPLETE

**Deliverables**:
- task-description.md
- implementation-plan.md
- tasks.md ([N] tasks completed)
- [QA reports if any]
- future-enhancements.md

**Files Created/Modified**: [N] files
**Git Commits**: [B] commits

**Next Steps**:
1. Monitor PR review
2. Address feedback if any
3. Merge when approved
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Key Design Principles

1. **You are the orchestrator**: Direct tool access, no orchestrator agent overhead
2. **Progressive disclosure**: Load references only when needed
3. **User validation**: Always get approval for PM and Architect deliverables
4. **Flexible patterns**: Full, partial, or minimal based on task needs
5. **Team-leader loop**: 3-mode cycle handles all development coordination
6. **Never bypass hooks**: Always ask user before --no-verify
7. **Single task folder**: All work in parent task folder (no nesting)
