# CLI Agent Delegation Reference

Comprehensive guide for sub-agents delegating focused sub-tasks to CLI agents (Tier 3 helpers) within the orchestration workflow.

---

## 3-Tier Hierarchy Overview

```
Tier 1: Claude (CTO / Orchestrator)
  ├── Runs orchestration workflow (strategy, checkpoints, agent sequence)
  ├── Spawns sub-agents via Agent tool
  └── Never implements directly
        │
        v
Tier 2: Sub-agents (Senior Leads)
  ├── Spawned by Claude via Agent tool (existing pattern)
  ├── Retain full specialist reasoning (PM, Architect, etc.)
  ├── Can spawn CLI agents for grunt work via ptah_agent_spawn
  └── Own the quality of their output — synthesize CLI results
        │
        v
Tier 3: CLI agents (Junior Helpers)
  ├── Spawned by sub-agents via MCP tools (ptah_agent_spawn)
  ├── Handle focused, independently-executable sub-tasks
  ├── No shared context — fully self-contained prompts
  └── Available: gemini, codex, copilot, ptah-cli (user-configured)
```

**Key Principle**: Sub-agents delegate grunt work downward, but retain ownership of synthesis, decisions, and quality.

---

## Discovery: Finding Available CLI Agents

Before delegating, sub-agents (or the orchestrator) must discover what CLI agents are available.

### Using `ptah_agent_list`

```
ptah_agent_list {}
```

**Response format**:

```json
{
  "agents": [
    { "id": "agent-123", "cli": "gemini", "status": "running", "task": "..." },
    { "id": "agent-456", "cli": "ptah-cli", "status": "completed", "task": "..." }
  ],
  "available_clis": ["gemini", "codex", "copilot", "ptah-cli"]
}
```

The `available_clis` field tells sub-agents which CLI agents the user has configured and can be spawned.

---

## Delegation Pattern: Spawn → Poll → Read

### Step 1: Spawn

```
ptah_agent_spawn {
  task: "Analyze all TypeScript interfaces in libs/shared/src and list their fields with types",
  cli: "gemini",
  taskFolder: "D:/projects/ptah-extension/.claude/specs/TASK_2025_042",
  files: ["libs/shared/src/lib/types/**/*.ts"]
}
```

**Parameters**:

| Parameter    | Required | Description                                                 |
| ------------ | -------- | ----------------------------------------------------------- |
| `task`       | Yes      | Self-contained task prompt (see Task Prompt Template below) |
| `cli`        | Yes      | CLI agent to use: gemini, codex, copilot, ptah-cli          |
| `taskFolder` | No       | Folder for agent to write results                           |
| `files`      | No       | Files/globs the agent should focus on                       |

**Returns**: `{ agentId: "agent-789" }`

### Step 2: Poll Status

```
ptah_agent_status { agentId: "agent-789" }
```

**Response**: `{ status: "running" | "completed" | "failed" | "timeout" }`

Poll until status is not `"running"`. Recommended interval: 5-10 seconds.

### Step 3: Read Results

```
ptah_agent_read { agentId: "agent-789" }
```

**Response**: Agent's stdout/output text containing its findings or work product.

### Step 4: Use Results

Incorporate the CLI agent's output into the sub-agent's own deliverable. Always review and validate before inclusion.

---

## Task Prompt Template

CLI agents have **no shared context** with the parent sub-agent. Every task prompt must be fully self-contained.

### Template Structure

```
You are a junior developer assistant. Complete the following task precisely.

## Context
- Project: [project name/description]
- Working Directory: [absolute path]
- Technology: [relevant tech stack]

## Task
[Clear, specific description of what to do]

## Input Files
[List specific files to read/analyze with absolute paths]

## Expected Output
[Describe exact output format — structured text, list, code, etc.]

## Constraints
- Do NOT commit to git
- Do NOT modify files outside the specified scope
- Output your results to stdout
- If you cannot complete the task, explain why clearly
```

### Good vs Bad Task Prompts

**Good** (self-contained, specific):

```
Analyze the file D:/projects/ptah-extension/libs/shared/src/lib/types/agent-process.types.ts.
List every exported interface and type alias with their field names and types.
Format as a markdown table with columns: Name, Kind (interface/type), Fields.
```

**Bad** (depends on shared context):

```
Look at the types we discussed earlier and tell me what's missing.
```

---

## Parallel Execution

### Concurrency Limit

**Maximum 3 concurrent CLI agents** to avoid resource exhaustion.

### Parallel Spawn Pattern

When multiple independent sub-tasks exist, spawn CLI agents in parallel:

```
# Spawn 3 agents for independent analysis
agent1 = ptah_agent_spawn { task: "Analyze module A...", cli: "gemini" }
agent2 = ptah_agent_spawn { task: "Analyze module B...", cli: "gemini" }
agent3 = ptah_agent_spawn { task: "Analyze module C...", cli: "gemini" }

# Poll all until complete
wait_all(agent1, agent2, agent3)

# Read all results
result1 = ptah_agent_read { agentId: agent1.agentId }
result2 = ptah_agent_read { agentId: agent2.agentId }
result3 = ptah_agent_read { agentId: agent3.agentId }

# Synthesize into deliverable
```

### Sequential Spawn Pattern

When sub-tasks depend on each other:

```
agent1 = ptah_agent_spawn { task: "Find all API endpoints...", cli: "gemini" }
wait(agent1)
result1 = ptah_agent_read { agentId: agent1.agentId }

# Use result1 to inform next task
agent2 = ptah_agent_spawn { task: "For each endpoint: ${result1}, check auth...", cli: "gemini" }
wait(agent2)
result2 = ptah_agent_read { agentId: agent2.agentId }
```

---

## Result Collection and Integration

### Reading Agent Output

CLI agent output comes as unstructured text from stdout. Sub-agents should:

1. **Parse**: Extract structured data from the agent's response
2. **Validate**: Cross-check claims against the codebase when critical
3. **Synthesize**: Merge multiple agent outputs into a coherent deliverable
4. **Attribute**: Note when analysis was performed by a CLI agent (optional)

### Integration Pattern

```
1. Collect all CLI agent results
2. Review each result for quality and accuracy
3. Discard or re-run any low-quality results
4. Merge relevant findings into sub-agent's own deliverable
5. Add sub-agent's own analysis and synthesis on top
```

---

## Error Handling

### Agent Status: `failed`

The CLI agent encountered an error and could not complete the task.

**Action**: Read agent output for error details. Either:

- Retry with a simplified or clarified task prompt
- Complete the sub-task manually (sub-agent does it directly)
- Skip the sub-task if non-critical

### Agent Status: `timeout`

The CLI agent took too long and was terminated. **Always try resuming first** before starting from scratch.

**Action (in order of preference)**:

1. **Resume the session** — use `ptah_agent_status` to get the `CLI Session ID`, then spawn with `resume_session_id` (see [Session Resume](#session-resume-continuing-interrupted-agents) below)
2. Break the task into smaller chunks and retry as a fresh agent
3. Use a different CLI agent (some are faster for certain tasks)
4. Complete the sub-task manually

### Agent Status: `failed` (with partial progress)

The CLI agent failed but may have done useful work before the error.

**Action**: Check `ptah_agent_status` for a `CLI Session ID`. If present, resume the session so the agent can recover and continue from its last checkpoint rather than redoing everything.

### Wrong or Low-Quality Output

The CLI agent completed but produced incorrect or unhelpful results.

**Action**:

- Retry with a more specific prompt and clearer expected output format
- Complete the sub-task manually
- Use the partial results and supplement with own analysis

### Agent Unavailable

The requested CLI agent is not configured or not available.

**Action**:

- Check `ptah_agent_list` for available alternatives
- Fall back to the CLI agent selection priority: ptah-cli > gemini > codex > copilot
- If no CLI agents available, complete the sub-task manually

### Concurrency Limit Reached

Already 3 CLI agents are running.

**Action**:

- Wait for a running agent to complete before spawning new ones
- Queue remaining tasks and spawn as slots become available

---

## Session Resume: Continuing Interrupted Agents

When a CLI agent times out, fails, or is stopped, it may have completed significant work. **Always prefer resuming over re-spawning** to avoid wasting that progress.

### How It Works

Every CLI agent receives a `CLI Session ID` when it starts (visible in `ptah_agent_spawn` and `ptah_agent_status` responses). This ID is the agent's native session identifier that persists on disk. Passing it back via `resume_session_id` tells the new agent to load the previous session's full context and continue from where it left off.

### Resume Flow

```
1. Agent times out or fails
   ↓
2. Check status to get the CLI Session ID:
   ptah_agent_status { agentId: "agent-789" }
   → { status: "timeout", cliSessionId: "abc-123-def", cli: "ptah-cli", ... }
   ↓
3. Resume the session:
   ptah_agent_spawn {
     task: "Continue the previous task",
     ptahCliId: "same-ptah-cli-id",
     resume_session_id: "abc-123-def"
   }
```

### Resume Example (Ptah CLI)

```
# Original spawn
ptah_agent_spawn {
  task: "Investigate the core libs/core/ to identify all TypeScript models...",
  ptahCliId: "openrouter-agent-1"
}
→ { agentId: "agent-100", cliSessionId: "8e3f6fd9..." }

# Agent times out after working for a while...
ptah_agent_status { agentId: "agent-100" }
→ { status: "timeout", cliSessionId: "8e3f6fd9..." }

# Resume — agent picks up where it left off
ptah_agent_spawn {
  task: "Continue the previous task. Pick up where you left off.",
  ptahCliId: "openrouter-agent-1",
  resume_session_id: "8e3f6fd9..."
}
→ { agentId: "agent-101", cliSessionId: "8e3f6fd9..." }
```

### Resume Example (Gemini CLI)

```
# Original spawn
ptah_agent_spawn { task: "Analyze all services...", cli: "gemini" }
→ { agentId: "agent-200", cliSessionId: "gemini-uuid-456" }

# Agent times out
ptah_agent_status { agentId: "agent-200" }
→ { status: "timeout", cliSessionId: "gemini-uuid-456" }

# Resume
ptah_agent_spawn {
  task: "Continue the previous task",
  cli: "gemini",
  resume_session_id: "gemini-uuid-456"
}
```

### When to Resume vs Re-spawn

| Scenario                         | Action                                          |
| -------------------------------- | ----------------------------------------------- |
| Agent timed out mid-work         | **Resume** — it has partial results in context  |
| Agent failed with an error       | **Resume** — it can see the error and recover   |
| Agent produced wrong output      | **Re-spawn** — fresh start with a better prompt |
| Agent completed but missed items | **Resume** — tell it what was missed            |
| Agent was stopped by the user    | **Resume** — if more work is needed             |
| Different task entirely          | **Re-spawn** — new task needs fresh context     |

### Important Notes

- The `resume_session_id` is the **CLI Session ID** from `ptah_agent_status`, NOT the Ptah `agentId`
- When resuming, use a continuation prompt (e.g., "Continue the previous task") — the original task is already in the session context
- The resumed agent gets a new `agentId` but loads the old session's conversation history
- Supported by: **ptah-cli**, **gemini**, **copilot**. Codex does not support resume (ephemeral sessions).

---

## CLI Agent Selection Priority

When multiple CLI agents are available, prefer in this order:

| Priority | CLI Agent | Strengths                             |
| -------- | --------- | ------------------------------------- |
| 1        | ptah-cli  | Best integration, project-aware       |
| 2        | gemini    | Fast, good at analysis and generation |
| 3        | codex     | Strong at code generation             |
| 4        | copilot   | General purpose, widely available     |

Sub-agents should select based on availability and task fit. The priority order is a default — specific tasks may warrant a different choice.

---

## Per-Role Delegation Examples

### project-manager

**Delegate**: Codebase research, dependency surveys, file structure analysis

```
ptah_agent_spawn {
  task: "List all Angular components in libs/frontend/chat/src and categorize them by Atomic Design level (atom/molecule/organism/template/page). Format as a markdown table.",
  cli: "gemini",
  files: ["libs/frontend/chat/src/**/*.component.ts"]
}
```

### software-architect

**Delegate**: Pattern analysis in specific modules, dependency graph checks, POC spikes

```
ptah_agent_spawn {
  task: "Analyze the dependency injection setup in libs/backend/vscode-core/src. List all DI tokens, their types, and where they are provided. Identify any circular dependency risks.",
  cli: "gemini",
  files: ["libs/backend/vscode-core/src/**/*.ts"]
}
```

### team-leader

**Delegate**: Parallel file verification, batch implementation via CLI devs

```
# Spawn CLI devs for independent batch tasks
ptah_agent_spawn {
  task: "Verify that all files listed below exist and are non-empty: [file list]. Report any missing files.",
  cli: "gemini"
}
```

### backend-developer

**Delegate**: Sub-tasks within a batch, test scaffolding, boilerplate generation

```
ptah_agent_spawn {
  task: "Create unit test scaffolding for the class AgentProcessManager in D:/projects/ptah-extension/libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts. Generate test cases for each public method with describe/it blocks and placeholder assertions. Output the test file content to stdout.",
  cli: "codex",
  files: ["libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts"]
}
```

### frontend-developer

**Delegate**: Component scaffolding, style migration, template generation

```
ptah_agent_spawn {
  task: "Generate an Angular standalone component skeleton for 'AgentStatusBadge' following the project's patterns (zoneless, signals, DaisyUI). Include: component class, template, and a basic spec file. Use the existing agent-card.component.ts as a reference for conventions.",
  cli: "gemini",
  files: ["libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts"]
}
```

### devops-engineer

**Delegate**: Config file generation, script writing, Dockerfile creation

```
ptah_agent_spawn {
  task: "Generate a multi-stage Dockerfile for a Node.js 20 application that: 1) Installs dependencies with npm ci, 2) Builds with 'npm run build', 3) Creates a minimal production image. Use Alpine base images.",
  cli: "codex"
}
```

### senior-tester

**Delegate**: Test file generation per module, fixture creation, coverage analysis

```
# Parallel test generation for multiple modules
ptah_agent_spawn {
  task: "Write Jest unit tests for libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts. Cover all public methods with happy path and error cases. Use jest.mock for dependencies.",
  cli: "gemini",
  files: ["libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts"]
}

ptah_agent_spawn {
  task: "Write Jest unit tests for libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts. Cover all public methods.",
  cli: "gemini",
  files: ["libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts"]
}
```

### code-style-reviewer / code-logic-reviewer

**Delegate**: File-level reviews across many files in parallel

```
ptah_agent_spawn {
  task: "Review the file libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts for: naming conventions, consistent error handling, proper TypeScript usage, no any types. Report issues as a numbered list with line references.",
  cli: "gemini",
  files: ["libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts"]
}
```

### researcher-expert

**Delegate**: Parallel deep-dives into different aspects of a technology/codebase

```
# Parallel research
ptah_agent_spawn {
  task: "Research the Claude Agent SDK npm package (@anthropic-ai/claude-agent-sdk). List: main classes, key methods, streaming support, error handling patterns. Focus on version 0.2.x.",
  cli: "gemini"
}

ptah_agent_spawn {
  task: "Analyze how the existing codebase uses @anthropic-ai/claude-agent-sdk. Find all import statements, usage patterns, and integration points. List file paths and key code snippets.",
  cli: "gemini",
  files: ["libs/backend/agent-sdk/src/**/*.ts"]
}
```

### modernization-detector

**Delegate**: Parallel analysis of different modules for improvement opportunities

```
ptah_agent_spawn {
  task: "Analyze libs/backend/vscode-core/src for modernization opportunities: deprecated API usage, outdated patterns, missing TypeScript strict features, potential performance improvements. Format as a prioritized list.",
  cli: "gemini",
  files: ["libs/backend/vscode-core/src/**/*.ts"]
}
```

### technical-content-writer

**Delegate**: Draft sections, research codebase features for content accuracy

```
ptah_agent_spawn {
  task: "Read the source code in libs/backend/agent-sdk/src and produce a technical summary of the Agent SDK's capabilities. Include: key features, supported operations, integration patterns. Write in a tone suitable for developer documentation.",
  cli: "gemini",
  files: ["libs/backend/agent-sdk/src/**/*.ts"]
}
```

---

## When Sub-agents Should NOT Delegate

CLI agents should NOT be used for:

- **Architecture decisions** requiring cross-cutting reasoning across the entire codebase
- **User-facing deliverables** requiring synthesis (task-description.md, implementation-plan.md)
- **Git commits** — team-leader handles these directly
- **Interactive user questioning** — only the orchestrator or sub-agent can ask the user
- **Security-critical review decisions** — require senior-level judgment
- **Tasks requiring shared context** — CLI agents have no memory of previous interactions
- **Cross-file refactoring** that requires understanding relationships between many files
- **visual-reviewer tasks** — requires browser tools (Chrome DevTools Protocol) that CLI agents cannot access
- **ui-ux-designer tasks** — requires interactive design engagement and user dialogue

---

## Integration with Other References

- **SKILL.md**: CLI Agent Delegation Mode activation, Checkpoint 0.1, prompt injection
- **agent-catalog.md**: Per-agent delegation capabilities and prompt injection template
- **strategies.md**: CLI delegation opportunities per strategy phase
- **team-leader-modes.md**: CLI-enhanced MODE 2 for parallel batch implementation
- **checkpoints.md**: Checkpoint 0.1 (CLI Agent Discovery) template
