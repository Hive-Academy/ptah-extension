# Orchestrate Development Workflow

Intelligent multi-phase development workflow orchestration with dynamic task-type strategies, validation gates, and sequential agent execution managed through an iterative coordinator-executor pattern.

## Usage

`/orchestrate [task description or TASK_ID]`

Examples:

- `/orchestrate implement real-time messaging for user notifications`
- `/orchestrate fix authentication token expiration bug`
- `/orchestrate refactor user service to use repository pattern`
- `/orchestrate TASK_2025_001` (continue existing task)

---

## Architecture: Hybrid Orchestrator-Executor Pattern

This command implements a sophisticated orchestration pattern where:

1. **workflow-orchestrator agent** = Intelligent GPS Coordinator

   - Analyzes task type and complexity
   - Executes Phase 0 (git operations, task setup)
   - Creates dynamic execution strategy based on task type
   - Provides turn-by-turn guidance for each phase
   - Validates outputs and adapts strategy as needed

2. **You (main Claude Code thread)** = Execution Engine

   - Invokes workflow-orchestrator initially
   - Follows orchestrator's step-by-step guidance
   - Invokes recommended specialist agents sequentially
   - Returns agent results to orchestrator for next step
   - Handles PR creation when orchestrator signals complete

3. **Specialist agents** = Domain Experts
   - Execute specific tasks (requirements, architecture, development, testing, review)
   - Return results to main thread
   - No awareness of orchestration context

---

## Your Instructions (Main Thread Execution Loop)

You are executing the orchestrate command. Follow this iterative pattern:

### Step 1: Initial Invocation

Invoke the **workflow-orchestrator** agent using the Task tool with this prompt:

```
You are the workflow-orchestrator agent. I'm invoking you to coordinate a development task.

## Task Request
$ARGUMENTS

## Your Responsibilities

**Phase 0** - Execute immediately:
1. Check git status and clean state (commit & push any pending work)
2. Generate sequential TASK_YYYY_NNN ID
3. Create feature branch and push to remote
4. Create registry entry in task-tracking/registry.md
5. Initialize task folder structure
6. Create context.md with user intent

**Task Analysis**:
- Analyze task type (FEATURE, BUGFIX, REFACTORING, DOCUMENTATION, RESEARCH)
- Assess complexity (Simple, Medium, Complex)
- Determine if technical research is needed

**Execution Strategy**:
- Choose appropriate agent sequence based on task type:
  - FEATURE: Full workflow (PM → Research → Architect → Dev → Test → Review)
  - BUGFIX: Streamlined (Dev → Test → Review, skip planning)
  - REFACTORING: Focused (Architect → Dev → Test → Review)
  - DOCUMENTATION: Minimal (PM → Dev → Review)
  - RESEARCH: Investigation (Researcher → [conditional implementation])

**Return Format**:
Provide your initial guidance using the structured format defined in your agent definition:
- Task information (ID, branch, type, complexity)
- Phase 0 completion confirmation
- Chosen execution strategy
- **NEXT ACTION: INVOKE AGENT** with specific agent name and full prompt
- What you need back from me after agent invocation

I will then follow your guidance to invoke the recommended agent.
```

### Step 2: Follow Orchestrator Guidance

The orchestrator will return structured guidance containing:

- **Current Status**: Phase progress, task ID, branch name
- **Validation Result**: Assessment of last agent's work (if applicable)
- **NEXT ACTION**: One of:
  - **INVOKE_AGENT**: Specific agent to call with full prompt
  - **VALIDATION**: business-analyst validation with criteria
  - **COMPLETE**: Ready for PR creation

**Your Actions**:

#### If NEXT ACTION = INVOKE_AGENT:

1. Use the **Task tool** to invoke the specified agent
2. Use the **exact prompt** provided by orchestrator
3. Wait for agent to complete and return results
4. Go to **Step 3**

#### If NEXT ACTION = VALIDATION:

1. Use the **Task tool** to invoke **business-analyst**
2. Use the validation prompt provided by orchestrator
3. Wait for validation decision (APPROVE ✅ or REJECT ❌)
4. Go to **Step 3**

#### If NEXT ACTION = COMPLETE:

1. Execute **Phase 7** bash commands provided by orchestrator:
   - Final commit with conventional commit message
   - Push to remote
   - Create pull request via `gh pr create`
2. Capture PR URL from output
3. Go to **Step 3** with PR URL for Phase 8

### Step 3: Return to Orchestrator

Invoke the **workflow-orchestrator** agent again using the Task tool with this prompt:

```
You are the workflow-orchestrator agent. I'm returning with results from the previous step.

## Previous Agent Invoked
[agent-name]

## Agent Results
[Copy the complete response from the agent, including any files created, decisions made, or delegation recommendations]

## Context
- Task ID: [TASK_ID from previous guidance]
- Current Phase: [Phase name from previous guidance]

[If this is after validation]
## Validation Decision
[business-analyst's APPROVE/REJECT decision with reasoning]

[If this is after PR creation]
## Pull Request Created
- PR URL: [URL from gh pr create command]

## What I Need
Provide next step guidance:
- Validation result for the work completed
- NEXT ACTION (INVOKE_AGENT | VALIDATION | COMPLETE)
- Specific agent and prompt if another invocation is needed

I will continue following your guidance until workflow is complete.
```

### Step 4: Repeat Steps 2-3

Continue the loop:

- Orchestrator provides next guidance
- You invoke recommended agent
- You return results to orchestrator
- Repeat until orchestrator status = **WORKFLOW COMPLETE**

### Step 5: Final Report to User

When orchestrator returns **WORKFLOW COMPLETE**, summarize for the user:

```markdown
🎉 Task [TASK_ID] completed successfully

## Summary

- **Task**: [Original user request]
- **Task ID**: [TASK_ID]
- **Branch**: [feature/XXX]
- **Pull Request**: [PR_URL]
- **Strategy**: [Execution strategy used]

## Completed Phases

[List of all phases completed with checkmarks]

## Deliverables

[List of all files created in task-tracking/TASK_ID/]

## Quality Gates

- All phases validated by business-analyst ✅
- Real implementation (no stubs) ✅
- Full stack integration ✅

## Next Steps

1. Review pull request: [PR_URL]
2. Merge PR if approved
3. Deploy changes if applicable
4. Consider future enhancements from future-work-dashboard.md
```

---

## Key Execution Principles

1. **Iterative Coordination**: Always return to orchestrator after each agent invocation
2. **Exact Prompts**: Use the prompts provided by orchestrator verbatim
3. **Full Results**: Return complete agent responses to orchestrator, not summaries
4. **Sequential Execution**: One agent at a time, never parallel
5. **Trust the GPS**: Orchestrator adapts strategy based on task type and results
6. **Context Preservation**: Maintain task ID and phase info across iterations

---

## Dynamic Task Type Handling

The orchestrator intelligently chooses the workflow based on task analysis:

### FEATURE (Full Workflow)

- Project manager for requirements
- Researcher for technical investigation (if needed)
- Software architect for design
- Developer for implementation
- Senior tester for testing
- Code reviewer for quality
- Modernization detector for future work

### BUGFIX (Streamlined)

- Skip project manager (requirements already clear)
- Optional researcher (if complex bug)
- Developer for fix
- Senior tester for verification
- Code reviewer for quality

### REFACTORING (Focused)

- Software architect for refactoring plan
- Developer for implementation
- Senior tester for regression testing
- Code reviewer for quality

### DOCUMENTATION (Minimal)

- Project manager to scope documentation
- Developer for implementation
- Code reviewer for accuracy

### RESEARCH (Investigation)

- Researcher for technical investigation
- Conditional continuation with implementation phases

---

## Benefits of This Architecture

✅ **Dynamic**: Different task types get appropriate workflows
✅ **Intelligent**: Orchestrator adapts strategy based on complexity
✅ **Validated**: Every phase checked by business-analyst
✅ **Traceable**: Full progress tracking in registry
✅ **Flexible**: Strategy adjusts based on agent outputs
✅ **Standards-Enforced**: Real implementation mandate, anti-backward compatibility
✅ **Agent Pattern Compliant**: All agents return to main thread (you)

---

## Troubleshooting

### If orchestrator doesn't provide clear guidance:

- Return to orchestrator with: "Please provide NEXT ACTION with specific agent and prompt"

### If validation fails multiple times (>3):

- Orchestrator will escalate to manual review
- Update registry to "❌ Failed (Manual Review Needed)"

### If you're unsure which agent to invoke:

- Always follow orchestrator's guidance exactly
- Return to orchestrator if guidance is unclear

---

## Example Execution Flow

**User**: `/orchestrate implement user notifications`

1. **You** → Invoke workflow-orchestrator
2. **Orchestrator** → Returns: "INVOKE project-manager with [prompt]"
3. **You** → Invoke project-manager
4. **Project-Manager** → Returns requirements document
5. **You** → Return to orchestrator with PM results
6. **Orchestrator** → Returns: "VALIDATION needed, invoke business-analyst"
7. **You** → Invoke business-analyst with validation criteria
8. **Business-Analyst** → Returns: "APPROVED ✅"
9. **You** → Return to orchestrator with validation result
10. **Orchestrator** → Returns: "INVOKE software-architect with [prompt]"
11. **You** → Invoke software-architect
    ... continue until orchestrator returns "WORKFLOW COMPLETE"

---

**This orchestration pattern ensures predictable, validated, high-quality development workflows with intelligent task-type adaptation.**
