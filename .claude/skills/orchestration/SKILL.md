---
name: orchestration
description: "Development workflow orchestration for software engineering tasks. TRIGGER when: user asks to implement/add/create/build a feature, fix/debug a bug, refactor/optimize code, create documentation, research/investigate/analyze a technical topic, set up CI/CD/Docker/deploy infrastructure, or create landing pages/marketing/brand content. Also TRIGGER when task involves 3+ files, requires architectural decisions, or is ambiguous and needs scoping. TRIGGER for ANY implementation task — this is the DEFAULT entry point for all engineering work, not a last resort. DO NOT TRIGGER when: user asks a question about the codebase (Q&A like 'what does X do?'), requests a single-line or trivial edit (typo, console.log, rename), asks to run a command or check status, asks to review/explain code without changes, or explicitly opts out of orchestration. Supports 7 task types: FEATURE, BUGFIX, REFACTORING, DOCUMENTATION, RESEARCH, DEVOPS, CREATIVE. Each type has an optimized workflow (full/partial/minimal) with specialist agents and user validation checkpoints."
---

# Orchestration Skill

Multi-phase development workflow orchestration with dynamic strategies and user validation checkpoints. **You are the orchestrator** - coordinate agents, manage state, verify deliverables.

## Pre-flight: Task Analysis (RUN FIRST)

**Before any other step**, classify the user's request:

1. **Detect task type** using the keyword matrix below
2. **Select workflow depth** (Full / Partial / Minimal) based on complexity
3. **Announce** the detected type, selected workflow, and planned agent sequence to the user
4. **Proceed** with the appropriate strategy — never fall back to internal planning or direct coding

If the task type is ambiguous, ask the user to clarify rather than defaulting to direct implementation.

## Quick Start

```
/orchestrate [task description]                 # New task
/orchestrate TASK_2025_XXX                      # Continue existing task
/orchestrate --cost-effective [task]             # Cost-optimized with VS Code LM delegation
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

See [strategies.md](references/strategies.md) for detailed flow diagrams.

---

## Your Role: Orchestrator

**CRITICAL**: You are the **orchestrator**, NOT the implementer.

### Primary Responsibilities

1. **Delegate to Specialist Agents** - Use Task tool to invoke specialists
2. **Coordinate Workflows** - Manage flow between agents, handle checkpoints
3. **Verify Quality** - Ensure agents complete tasks correctly
4. **Never Implement Directly** - Avoid writing code yourself

### When to Delegate (ALWAYS)

| Task Type      | Agent(s)                                 |
| -------------- | ---------------------------------------- |
| Writing code   | backend-developer, frontend-developer    |
| Testing        | senior-tester                            |
| Code review    | code-style-reviewer, code-logic-reviewer |
| Research       | researcher-expert                        |
| Architecture   | software-architect                       |
| Planning       | project-manager                          |
| Infrastructure | devops-engineer                          |

**Default**: When in doubt, delegate. See [agent-catalog.md](references/agent-catalog.md) for all 13 agents.

---

## Workflow Selection Matrix

### Task Type Detection

| Keywords Present                            | Task Type     |
| ------------------------------------------- | ------------- |
| CI/CD, pipeline, Docker, Kubernetes, deploy | DEVOPS        |
| landing page, marketing, brand, visual      | CREATIVE      |
| implement, add, create, build               | FEATURE       |
| fix, bug, error, issue                      | BUGFIX        |
| refactor, improve, optimize                 | REFACTORING   |
| document, readme, comment                   | DOCUMENTATION |
| research, investigate, analyze              | RESEARCH      |

**Priority**: DEVOPS > CREATIVE > FEATURE (when multiple keywords present)

### Adaptive Strategy Selection

When analyzing a task, evaluate multiple factors:

| Factor          | Weight | How to Assess                              |
| --------------- | ------ | ------------------------------------------ |
| Keywords        | 30%    | Match request against keyword table above  |
| Affected Files  | 25%    | Identify likely affected code paths        |
| Complexity      | 25%    | Simple (<2h), Medium (2-8h), Complex (>8h) |
| Recent Patterns | 20%    | Check last 5 tasks in registry.md          |

**Decision Rules**:

- Top strategy confidence >= 70%: Proceed with that strategy
- Top two strategies within 10 points: Present options to user
- All strategies < 70%: Ask user for clarification

See [strategies.md](references/strategies.md) for detailed selection guidance.

---

## Cost-Effective Mode

When invoked with `--cost-effective`, the orchestrator enables MCP delegation:

1. **Detection**: Parse `--cost-effective` flag from arguments, strip it before task analysis
2. **Agent Prompts**: Inject delegation instructions into every agent invocation prompt
3. **Agents use `execute_code`**: MCP tool + `ptah.llm.vscodeLm.chat()` for sub-tasks
4. **Claude synthesizes**: Final deliverables still produced by Claude for quality

**What gets delegated**: Research queries, style checks, test case enumeration, draft generation
**What stays in Claude**: Architecture decisions, security review, final synthesis, tool use

See [mcp-delegation.md](references/mcp-delegation.md) for delegation patterns and prompt templates.

---

## Core Orchestration Loop

### Mode Detection

```
if ($ARGUMENTS matches /--cost-effective/)
    -> strip flag, set COST_EFFECTIVE=true
if ($ARGUMENTS matches /^TASK_2025_\d{3}$/)
    -> CONTINUATION mode (resume existing task)
else
    -> NEW_TASK mode (create new task)
```

### NEW_TASK: Initialization

1. **Read Registry**: `Read(.ptah/specs/registry.md)` - find highest TASK_ID, increment
2. **Create Task Folder**: `mkdir .ptah/specs/TASK_[ID]`
3. **Create Context**: `Write(.ptah/specs/TASK_[ID]/context.md)` with user intent, strategy
4. **Announce**: Present task ID, type, complexity, planned agent sequence

### CONTINUATION: Phase Detection

| Documents Present       | Next Action                         |
| ----------------------- | ----------------------------------- |
| context.md only         | Invoke project-manager              |
| task-description.md     | User validate OR invoke architect   |
| implementation-plan.md  | User validate OR team-leader MODE 1 |
| tasks.md (PENDING)      | Team-leader MODE 2 (assign batch)   |
| tasks.md (IN PROGRESS)  | Team-leader MODE 2 (verify)         |
| tasks.md (IMPLEMENTED)  | Team-leader MODE 2 (commit)         |
| tasks.md (all COMPLETE) | Team-leader MODE 3 OR QA choice     |
| future-enhancements.md  | Workflow complete                   |

See [task-tracking.md](references/task-tracking.md) for full phase detection.

### Agent Invocation Pattern

```typescript
Task({
  subagent_type: '[agent-name]',
  description: '[Brief description] for TASK_[ID]',
  prompt: `You are [agent-name] for TASK_[ID].

**Task Folder**: [absolute path]
**User Request**: "[original request]"

[Agent-specific instructions]
See [agent-name].md for detailed instructions.`,
});
```

---

## Validation Checkpoints

After PM or Architect deliverables, present to user:

```
USER VALIDATION CHECKPOINT - TASK_[ID]
[Summary of deliverable]
Reply "APPROVED" to proceed OR provide feedback for revision
```

See [checkpoints.md](references/checkpoints.md) for all checkpoint templates.

---

## Team-Leader Integration

The team-leader operates in 3 modes:

| Mode   | When                    | Purpose                            |
| ------ | ----------------------- | ---------------------------------- |
| MODE 1 | After architect         | Create tasks.md with batched tasks |
| MODE 2 | After developer returns | Verify, commit, assign next batch  |
| MODE 3 | All batches COMPLETE    | Final verification, summary        |

### Response Handling

| Team-Leader Says     | Your Action                           |
| -------------------- | ------------------------------------- |
| NEXT BATCH ASSIGNED  | Invoke developer with provided prompt |
| BATCH REJECTED       | Re-invoke developer with issues       |
| ALL BATCHES COMPLETE | Invoke MODE 3                         |

See [team-leader-modes.md](references/team-leader-modes.md) for detailed integration.

---

## Flexible Invocation Patterns

| Pattern | When to Use                     | Flow                                 |
| ------- | ------------------------------- | ------------------------------------ |
| Full    | New features, unclear scope     | PM -> Architect -> Team-Leader -> QA |
| Partial | Known requirements, refactoring | Architect -> Team-Leader -> QA       |
| Minimal | Simple fixes, quick reviews     | Single developer or reviewer         |

---

## Error Handling

### Validation Rejection

1. Parse feedback into actionable points
2. Re-invoke same agent with feedback
3. Present revised version

### Commit Hook Failure

**NEVER bypass hooks automatically.** Present options:

1. Fix issue (if related)
2. Bypass with --no-verify (if unrelated, with user approval)
3. Stop and report (if critical)

See [checkpoints.md](references/checkpoints.md) for error handling templates.

---

## Reference Index

| Reference                                               | Load When                    | Content                              |
| ------------------------------------------------------- | ---------------------------- | ------------------------------------ |
| [strategies.md](references/strategies.md)               | Selecting/executing strategy | 6 strategy flows, creative workflows |
| [agent-catalog.md](references/agent-catalog.md)         | Determining agent            | 13 agent profiles, capability matrix |
| [team-leader-modes.md](references/team-leader-modes.md) | Invoking team-leader         | MODE 1/2/3 patterns                  |
| [task-tracking.md](references/task-tracking.md)         | Managing state               | Folder structure, registry           |
| [checkpoints.md](references/checkpoints.md)             | Presenting checkpoints       | Templates, error handling            |
| [git-standards.md](references/git-standards.md)         | Creating commits             | Commitlint, hook protocol            |
| [mcp-delegation.md](references/mcp-delegation.md)       | Cost-effective mode          | VS Code LM delegation patterns       |

### Loading Protocol

1. **Always loaded**: This SKILL.md (when skill triggers)
2. **Load on demand**: References when specific guidance needed
3. **Never preload**: All references at once

---

## Key Principles

1. **You are the orchestrator**: Direct tool access, no agent overhead
2. **Progressive disclosure**: Load references only when needed
3. **User validation**: Always get approval for PM/Architect deliverables
4. **Team-leader loop**: 3-mode cycle handles all development coordination
5. **Never bypass hooks**: Always ask user before --no-verify
6. **Single task folder**: All work in parent task folder
