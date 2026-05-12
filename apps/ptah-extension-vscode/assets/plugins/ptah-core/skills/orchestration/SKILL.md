---
name: orchestration
description: 'Development workflow orchestration for software engineering tasks. Supports 8 task types: FEATURE, BUGFIX, REFACTORING, DOCUMENTATION, RESEARCH, DEVOPS, SAAS_INIT, CREATIVE. Each type has an optimized workflow (full/partial/minimal) with specialist agents and user validation checkpoints. TRIGGER for ANY implementation task — this is the DEFAULT entry point for all engineering work.'
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
| SAAS_INIT     | Discovery -> PM -> Architect -> Team-Leader        |
| CREATIVE      | [ui-ux-designer] -> content-writer -> frontend     |

See [strategies.md](references/strategies.md) for detailed flow diagrams.

---

## Your Role: Orchestrator

**CRITICAL**: You are the **orchestrator**, NOT the implementer.

### Primary Responsibilities

1. **Delegate to Specialist Agents** - Use Task tool to invoke specialists
2. **Coordinate Workflows** - Manage flow between agents, handle checkpoints
3. **Own All User Interaction** - Subagents CANNOT call `AskUserQuestion`. YOU must run all clarification checkpoints (0, 0.1, 1, 1.5, 2, 3) directly using `AskUserQuestion`. If a subagent returns a `## Clarifications Needed` section, present those questions to the user via `AskUserQuestion`, then re-invoke the subagent with the answers in its prompt.
4. **Verify Quality** - Ensure agents complete tasks correctly
5. **Never Implement Directly** - Avoid writing code yourself

### Subagent Tool Constraints

Subagents spawned via `Task` run in a headless context with no UI channel back to the user. They CANNOT call:

- `AskUserQuestion` — UI-coupled, only works in the main orchestrator
- Any tool requiring foreground user interaction

If a subagent's response contains `## Clarifications Needed`, treat it as a structured request to YOU:

1. Parse the questions and options from the subagent's response
2. Call `AskUserQuestion` yourself with those questions (preserve options, recommended markers)
3. Re-invoke the subagent via `Task` with a prompt that includes a `## User Decisions` section containing the answers
4. The subagent will then proceed to its primary deliverable

### When to Delegate (ALWAYS)

| Task Type      | Agent(s)                                                  |
| -------------- | --------------------------------------------------------- |
| Writing code   | backend-developer, frontend-developer                     |
| Testing        | senior-tester                                             |
| Code review    | code-style-reviewer, code-logic-reviewer, visual-reviewer |
| Research       | researcher-expert                                         |
| Architecture   | software-architect                                        |
| Planning       | project-manager                                           |
| Infrastructure | devops-engineer                                           |

**Default**: When in doubt, delegate. See [agent-catalog.md](references/agent-catalog.md) for all 14 agents.

---

## Workflow Selection Matrix

### Task Type Detection

| Keywords Present                              | Task Type     |
| --------------------------------------------- | ------------- |
| new SaaS, multi-tenant, Nx monorepo, scaffold | SAAS_INIT     |
| CI/CD, pipeline, Docker, Kubernetes, deploy   | DEVOPS        |
| landing page, marketing, brand, visual        | CREATIVE      |
| implement, add, create, build                 | FEATURE       |
| fix, bug, error, issue                        | BUGFIX        |
| refactor, improve, optimize                   | REFACTORING   |
| document, readme, comment                     | DOCUMENTATION |
| research, investigate, analyze                | RESEARCH      |

**Priority**: SAAS_INIT > DEVOPS > CREATIVE > FEATURE (when multiple keywords present)

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

## Core Orchestration Loop

### Mode Detection

```
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

**MANDATORY**: Every `Task()` invocation MUST include a `**Deliverable**:` line specifying the absolute Windows file path the agent must write to. Sub-agents have no UI channel — if you don't tell them where to write, they may dump their output into the chat response and skip file creation. Use the file-name table below.

```typescript
Task({
  subagent_type: '[agent-name]',
  description: '[Brief description] for TASK_[ID]',
  prompt: `You are [agent-name] for TASK_[ID].

**Task Folder**: D:/projects/ptah-extension/.ptah/specs/TASK_[ID]
**User Request**: "[original request]"
**Deliverable**: Write your output to \`D:/projects/ptah-extension/.ptah/specs/TASK_[ID]/<filename>.md\` using the Write tool. Do NOT return content inline. After writing, reply with a one-line confirmation \`WROTE: <absolute path>\` plus the one-line headline of your verdict. Nothing else.

[Agent-specific instructions]
See [agent-name].md for detailed instructions.`,
});
```

**Deliverable filename per agent:**

| Agent                  | Filename                         |
| ---------------------- | -------------------------------- |
| project-manager        | `task-description.md`            |
| software-architect     | `implementation-plan.md`         |
| researcher-expert      | `research-report.md`             |
| team-leader (MODE 1)   | `tasks.md`                       |
| senior-tester          | `test-report.md`                 |
| code-style-reviewer    | `code-style-review.md`           |
| code-logic-reviewer    | `code-logic-review.md`           |
| visual-reviewer        | `visual-review.md`               |
| modernization-detector | `future-enhancements.md`         |
| ui-ux-designer         | `visual-design-specification.md` |

---

## Validation Checkpoints

**ALL checkpoints are run by YOU (the orchestrator). Subagents NEVER run checkpoints.** Use `AskUserQuestion` for pre-deliverable choice checkpoints (0, 0.1, 1.5, 3). Use a plain text message — NOT `AskUserQuestion` — for document review checkpoints (1, 2) so the user can read the generated `task-description.md` / `implementation-plan.md` before replying.

### Checkpoint 0.1: CLI Agent Discovery (before any agent invocation)

Run `ptah_agent_list` and present results to user via `AskUserQuestion`. Ask whether sub-agents should utilize CLI agents as junior helpers. Store selection in `context.md`. Skipped for Minimal pattern tasks or when no CLI agents are available.

### Checkpoint 0: Scope Clarification (MANDATORY before PM when ambiguity exists)

**Before invoking project-manager**, evaluate whether the user's request has ambiguous scope, multiple valid interpretations, or unclear success criteria. If ANY ambiguity exists, run Checkpoint 0 using `AskUserQuestion` directly. The PM cannot ask the user — YOU must.

Skip only when: request is extremely specific, task is a clear continuation, or user explicitly said "use your judgment" / "just do it".

### Checkpoint 1.5: Technical Clarification (MANDATORY before Architect when multiple valid approaches exist)

**Before invoking software-architect**, evaluate whether multiple valid architectural approaches exist (REST vs GraphQL, library X vs custom, etc.). If yes, run Checkpoint 1.5 using `AskUserQuestion` directly. The architect cannot ask the user — YOU must.

Skip only when: codebase has clear established patterns, task extends existing architecture, or user deferred technical decisions.

### Document Review Checkpoints (1, 2) — Plain Message, NOT AskUserQuestion

After project-manager produces `task-description.md` (Checkpoint 1) or software-architect produces `implementation-plan.md` (Checkpoint 2), the user needs **time and space to read the generated document** before deciding. Do NOT use `AskUserQuestion` here — a modal choice forces a premature answer before the user has opened the file.

Instead, present the checkpoint as a **plain text message**: surface the document path, a concise summary of what's inside, and explicitly invite review-then-reply. Then stop and wait for the user's free-form response. Acceptable replies are "APPROVED" (proceed), revision feedback, or follow-up questions.

```
REQUIREMENTS READY FOR REVIEW — TASK_[ID]

Document: .ptah/tasks/TASK_[ID]/task-description.md

[2–4 line summary of scope, key requirements, out-of-scope]

Please open the document and review it. Reply "APPROVED" to proceed,
or share any feedback / questions and I'll revise.
```

The same shape applies to Checkpoint 2 (architecture). Never wrap these in `AskUserQuestion`.

### Choice Checkpoints (0, 0.1, 1.5, 3) — Use AskUserQuestion

Pre-deliverable scope/technical/QA selections still use `AskUserQuestion` because they ARE structured choices among concrete options.

### Subagent-Triggered Clarification Loop

If any subagent returns a `## Clarifications Needed` section in its response (instead of its expected deliverable):

1. **Do NOT proceed** to the next workflow phase
2. **Extract** the questions and options from the subagent's response
3. **Call `AskUserQuestion`** with those questions
4. **Re-invoke** the same subagent via `Task`, embedding answers in a `## User Decisions` block in the prompt
5. **Repeat** if the subagent still returns clarifications (rare — should converge in 1-2 iterations)

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

## CLI Agent Delegation Mode

Enable a **2-tier hierarchy** where the **main orchestrator (Claude)** is the sole spawner of sub-agents and CLI agents. Team-leader is advisory only — it recommends per-batch executors in `tasks.md` and the orchestrator acts on those recommendations.

```
Tier 1: Claude (Orchestrator) — SOLE authority for spawning
  ├── Spawns team-leader (advisory role: decompose, verify, commit)
  ├── Spawns sub-agent developers (backend-developer, frontend-developer, etc.)
  ├── Spawns CLI agents via ptah_agent_spawn (sequential or parallel)
  ├── Spawns code-logic-reviewer when team-leader returns NEEDS REVIEW
  └── Runs Checkpoint 0.1 to enable CLI mode

Tier 2: Team-Leader (Advisory only — NEVER spawns)
  └── Writes tasks.md with per-batch Recommended Executor + Execution Mode
        Orchestrator reads recommendations and spawns accordingly
```

### How It Works

1. **Discovery**: At orchestration start, run `ptah_agent_list` to find available CLI agents
2. **Checkpoint 0.1**: Present available agents to user and ask whether to enable delegation
3. **Store in context.md**: Record `cli_delegation: enabled|disabled|auto` and available agents
4. **Team-leader recommends, orchestrator spawns**: Team-leader MODE 1 fills `Recommended Executor` + `Execution Mode` on each batch in `tasks.md`. When team-leader returns `NEXT BATCH ASSIGNED: [executor/mode]`, the ORCHESTRATOR spawns the executor — sub-agent via `Task`, or CLI via `ptah_agent_spawn` (parallel fan-out when mode is `parallel`).

### Quick Reference

| Aspect                 | Detail                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Activation**         | Checkpoint 0.1 (auto-discovered, user-confirmed)                                                                     |
| **Sole spawner**       | Main orchestrator (Claude) — NO agent spawns sub-agents or CLI agents                                                |
| **Team-leader role**   | Advisory: fills `Recommended Executor` + `Execution Mode` on each batch                                              |
| **Available agents**   | gemini, codex, copilot, ptah-cli (user-configured)                                                                   |
| **Concurrency limit**  | Max 3 CLI agents simultaneously                                                                                      |
| **Selection priority** | ptah-cli > gemini > codex > copilot                                                                                  |
| **Decision authority** | Team-leader recommends; orchestrator executes the recommendation                                                     |
| **Quality ownership**  | code-logic-reviewer (spawned by orchestrator on team-leader's NEEDS REVIEW) + team-leader verification before commit |

### Executor Recommendation Heuristics (Applied by Team-Leader in tasks.md)

| Use CLI Agents (orchestrator spawns via ptah_agent_spawn) | Use Sub-agent Developers (orchestrator spawns via Task) |
| --------------------------------------------------------- | ------------------------------------------------------- |
| Batch has 3+ independent, file-disjoint tasks             | Tightly coupled tasks needing shared context            |
| Boilerplate / scaffolding work                            | Cross-file refactoring                                  |
| Independent component implementation                      | Architecture decisions required                         |
| Migration across many files                               | Complex business logic                                  |

### Secondary Delegation (Sub-agents other than team-leader)

Other sub-agents (PM, Architect, Researcher, Tester, Reviewers, Developers) MAY delegate focused sub-tasks to CLI agents when CLI mode is active — they can call `ptah_agent_spawn` directly for grunt work. This is **different from team-leader**, which is strictly advisory and never spawns.

### CLI Delegation Prompt Injection (For Secondary Delegators)

When CLI Agent Mode is active and invoking sub-agents **other than team-leader** (PM, Architect, Researcher, etc.), append this block to their prompts to enable secondary delegation:

```markdown
## CLI Agent Delegation (Junior Helpers)

You have CLI agents available as junior helpers. Use them for focused,
independently-executable sub-tasks to speed up your work.

**Available agents** (from discovery):
[injected agent list from ptah_agent_list results]

**How to delegate:**

1. Spawn: `ptah_agent_spawn { task: "...", cli: "gemini", taskFolder: "...", files: [...] }`
2. Poll: `ptah_agent_status { agentId: "..." }` (repeat until not "running")
3. Read: `ptah_agent_read { agentId: "..." }`
4. Use the results in your deliverable

**How to resume a timed-out/failed agent:**

1. Get session ID: `ptah_agent_status { agentId: "..." }` → note the `CLI Session ID`
2. Resume: `ptah_agent_spawn { task: "Continue the previous task", resume_session_id: "<cliSessionId>", ... }`
   The agent loads the old session context and continues from where it left off.

**Rules:**

- Max 3 concurrent CLI agents
- CLI agents have NO shared context — include ALL necessary info in the task prompt
- CLI agents should NOT commit to git
- YOU own the quality — review CLI agent output before incorporating
- Delegate grunt work, keep synthesis and decisions to yourself
- When a CLI agent times out or fails, **resume it** instead of re-spawning from scratch

**When to delegate:**
[role-specific examples injected per agent type — see agent-catalog.md]
```

**Note**: The team-leader does NOT receive this injection block — it is strictly advisory and is forbidden from spawning sub-agents or CLI agents. Its recommendations live in `tasks.md` under `Recommended Executor` / `Execution Mode` per batch.

See [cli-agent-delegation.md](references/cli-agent-delegation.md) for the comprehensive reference.

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

| Reference                                                     | Load When                    | Content                               |
| ------------------------------------------------------------- | ---------------------------- | ------------------------------------- |
| [strategies.md](references/strategies.md)                     | Selecting/executing strategy | 8 task type workflows                 |
| [agent-catalog.md](references/agent-catalog.md)               | Determining agent            | 14 agent profiles, capability matrix  |
| [team-leader-modes.md](references/team-leader-modes.md)       | Invoking team-leader         | MODE 1/2/3 patterns                   |
| [task-tracking.md](references/task-tracking.md)               | Managing state               | Folder structure, registry            |
| [checkpoints.md](references/checkpoints.md)                   | Presenting checkpoints       | Templates, error handling             |
| [git-standards.md](references/git-standards.md)               | Creating commits             | Commitlint, hook protocol             |
| [cli-agent-delegation.md](references/cli-agent-delegation.md) | CLI agent mode active        | 3-tier hierarchy, delegation patterns |

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
