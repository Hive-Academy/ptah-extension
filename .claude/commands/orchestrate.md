# Orchestrate Development Workflow

Intelligent multi-phase development workflow with dynamic task-type strategies, user validation checkpoints, and optional QA agents. **You (the main Claude Code session) are the orchestrator** - you handle all coordination, state management, and agent invocation directly.

## Usage

`/orchestrate [task description or TASK_ID]`

Examples:

- `/orchestrate implement real-time messaging for user notifications`
- `/orchestrate fix authentication token expiration bug`
- `/orchestrate refactor user service to use repository pattern`
- `/orchestrate TASK_2025_001` (continue existing task)

---

## 🎯 Your Role: The Orchestrator

**You ARE the orchestrator.** There is no separate orchestrator agent. When the user runs `/orchestrate`, you:

1. **Initialize** the task (Phase 0)
2. **Analyze** task type and complexity
3. **Choose** the appropriate execution strategy
4. **Invoke** specialist agents directly
5. **Manage** validation checkpoints with user
6. **Track** progress through completion
7. **Verify** deliverables at each stage

You maintain all workflow state in your context and make all orchestration decisions directly.

---

## 📋 Execution Protocol

### Step 1: Mode Detection & Task Initialization

When `/orchestrate` is invoked with arguments, first detect the mode:

```javascript
// Check if argument is a TASK_ID (format: TASK_2025_XXX)
if ($ARGUMENTS matches /^TASK_2025_\d{3}$/) {
  MODE = "CONTINUATION"
  TASK_ID = $ARGUMENTS
} else {
  MODE = "NEW_TASK"
  TASK_DESCRIPTION = $ARGUMENTS
}
```

---

### MODE 1: NEW_TASK - Initialize Fresh Workflow

#### Phase 0: Task Initialization (You Execute This Directly)

**IMPORTANT**: No separate orchestrator agent. You perform these steps:

1. **Read Registry**:
   ```typescript
   const registryContent = await Read('D:\\projects\\ptah-extension\\task-tracking\\registry.md');

   // Find highest TASK_2025_XXX number
   const taskPattern = /TASK_2025_(\d{3})/g;
   const matches = [...registryContent.matchAll(taskPattern)];
   const highestNum = Math.max(...matches.map((m) => parseInt(m[1], 10)), 0);
   const nextNum = String(highestNum + 1).padStart(3, '0');
   const TASK_ID = `TASK_2025_${nextNum}`;
   const BRANCH_NAME = `feature/${nextNum}`;
   ```

2. **Create Context File**:
   ```markdown
   # Task Context for TASK_2025_XXX

   ## User Intent

   [USER_REQUEST from command arguments]

   ## Conversation Summary

   [If there was prior conversation, summarize:
   - Key decisions made
   - Technical constraints discussed
   - Specific requirements mentioned
   - Referenced files or components]

   ## Technical Context

   - Branch: feature/XXX
   - Created: [TIMESTAMP]
   - Task Type: [Determined by your analysis]
   - Complexity: [Determined by your analysis]
   - Estimated Duration: [X hours]

   ## Execution Strategy

   [Your chosen strategy based on task type analysis - see strategies below]
   ```

3. **Analyze Task Type & Complexity**:

   **Task Type Classification**:
   - **FEATURE**: New functionality, enhancements, capabilities
   - **BUGFIX**: Error corrections, issue resolutions
   - **REFACTORING**: Code improvements, architecture changes (no new functionality)
   - **DOCUMENTATION**: Documentation updates, README improvements
   - **RESEARCH**: Technical investigation, proof of concepts

   **Complexity Assessment**:
   - **Simple**: Single file/component, clear requirements, <2 hours
   - **Medium**: Multiple files, some research needed, 2-8 hours
   - **Complex**: Multiple modules, architecture decisions, research required, >8 hours

   **Research Needs**:
   - Does this require technical research before architecture?
   - Are there unknowns that need investigation?

4. **Choose Execution Strategy** (see strategies section below)

5. **Present Initial Status to User**:
   ```markdown
   # 🎯 Orchestrating Workflow - TASK_2025_XXX

   ## Task Information
   - **Task ID**: TASK_2025_XXX
   - **Branch**: feature/XXX
   - **Type**: [FEATURE|BUGFIX|REFACTORING|DOCUMENTATION|RESEARCH]
   - **Complexity**: [Simple|Medium|Complex]
   - **Estimated Duration**: [X hours]

   ## Phase 0: Initialization ✅ COMPLETE
   - Task ID generated: TASK_2025_XXX
   - Context file created: task-tracking/TASK_2025_XXX/context.md
   - NO git operations (user handles git when ready)

   ## Execution Strategy: [STRATEGY_NAME]

   **Planned Agent Sequence**:
   [List the agent sequence based on chosen strategy]

   ## 📍 Starting Phase 1: [First Agent Name]

   Invoking [agent-name] now...
   ```

6. **Invoke First Agent** (proceed directly to Phase 1)

---

### MODE 2: CONTINUATION - Resume Existing Workflow

When invoked with a TASK_ID (e.g., TASK_2025_017):

#### Phase 0 (Continuation): Analyze Existing Work

1. **Check Task Exists**:
   ```bash
   Read(D:\projects\ptah-extension\task-tracking\TASK_2025_XXX\context.md)
   # If file doesn't exist → ERROR: Invalid TASK_ID
   ```

2. **Discover All Documents**:
   ```bash
   Glob(task-tracking/TASK_2025_XXX/**.md)
   ```

3. **Check Registry Status**:
   ```bash
   Read(D:\projects\ptah-extension\task-tracking\registry.md)
   # Find the line with TASK_ID to see current status
   ```

4. **Determine Completed Phases** (Phase Detection Logic):

   | Document Exists                   | Phase Completed         | Next Action                                                      |
   | --------------------------------- | ----------------------- | ---------------------------------------------------------------- |
   | ❌ context.md missing             | Task doesn't exist      | ERROR: Invalid TASK_ID                                           |
   | ✅ context.md only                | Initialized             | Invoke project-manager                                           |
   | ✅ task-description.md            | PM complete             | Ask user to validate (if not done) OR invoke next agent          |
   | ✅ visual-design-specification.md | UI/UX Designer complete | Invoke software-architect (references design specs)              |
   | ✅ implementation-plan.md         | Architect complete      | Ask user to validate (if not done) OR invoke team-leader MODE 1  |
   | ✅ tasks.md (all ⏸️ PENDING)      | Decomposition complete  | Invoke team-leader MODE 2 (first assignment)                     |
   | ✅ tasks.md (has 🔄 IN PROGRESS)  | Development in progress | Invoke team-leader MODE 2 (verify completed + assign next)       |
   | ✅ tasks.md (all ✅ COMPLETE)     | All tasks complete      | Invoke team-leader MODE 3 OR ask user for QA choice              |
   | ✅ test-report.md                 | Tester complete         | Continue based on user's QA choice                               |
   | ✅ code-review.md                 | Reviewer complete       | Provide COMPLETE guidance (PR + modernization)                   |
   | ✅ future-enhancements.md         | All done                | Workflow already complete                                        |

5. **Read Existing Context**:
   ```bash
   Read(task-tracking/TASK_2025_XXX/context.md)        # Original intent
   Read(task-tracking/TASK_2025_XXX/task-description.md)  # If exists
   Read(task-tracking/TASK_2025_XXX/implementation-plan.md) # If exists
   Read(task-tracking/TASK_2025_XXX/tasks.md)          # If exists (check status)
   ```

6. **Present Continuation Status to User**:
   ```markdown
   # 🎯 Resuming Workflow - TASK_2025_XXX

   ## Task Information
   - **Task ID**: TASK_2025_XXX (EXISTING TASK)
   - **Original Request**: [from context.md]
   - **Registry Status**: [from registry.md]
   - **Mode**: CONTINUATION

   ## Completed Phases
   ✅ Phase 0: Initialization (context.md exists)
   ✅ Phase 1: Requirements (task-description.md exists) [if exists]
   ✅ Phase 2: Architecture (implementation-plan.md exists) [if exists]
   ✅ Phase 3: Task Decomposition (tasks.md exists) [if exists]
   ✅ Phase 4: Development (X tasks completed) [if exists]
   ⏸️ **PAUSED HERE** - Resuming workflow

   ## Existing Deliverables
   [List all .md files found in task folder]

   ## 📍 Next Action: [Phase Name]

   Resuming with [agent-name]...
   ```

7. **Invoke Appropriate Agent** (based on phase detection)

---

## 🎨 Execution Strategies (Dynamic Task-Type Handling)

Based on task type and complexity analysis, choose one of these strategies:

### Strategy 1: FEATURE (Comprehensive)

```
Phase 1: project-manager → Creates task-description.md
         ↓
         USER VALIDATION ✋ (Ask: "APPROVED ✅ or provide feedback")
         ↓
Phase 2: [CONDITIONAL] researcher-expert → Creates research-report.md
         (Only if technical unknowns exist)
         ↓
Phase 3: [CONDITIONAL] ui-ux-designer → Creates visual-design-specification.md, design-assets-inventory.md, design-handoff.md
         (Only if UI/UX work - landing pages, visual redesigns, 3D enhancements)
         ↓
Phase 4: software-architect → Creates implementation-plan.md
         ↓
         USER VALIDATION ✋ (Ask: "APPROVED ✅ or provide feedback")
         ↓
Phase 5a: team-leader MODE 1 (DECOMPOSITION) → Creates tasks.md with atomic tasks
         ↓
Phase 5b: team-leader MODE 2 (ITERATIVE LOOP) → For each task:
         - Assigns task to developer (backend-developer OR frontend-developer)
         - You invoke developer with task details
         - Developer implements, commits git, updates tasks.md
         - team-leader MODE 2 verifies (git commit + file + tasks.md)
         - Repeat for next task
         (This is N iterations where N = number of tasks)
         ↓
Phase 5c: team-leader MODE 3 (COMPLETION) → Final verification of all tasks
         ↓
         USER CHOICE ✋ (Ask: "tester, reviewer, both, or skip?")
         ↓
Phase 6: [USER CHOICE] senior-tester and/or code-reviewer
         (Can run in PARALLEL if user chose "both")
         ↓
Phase 7: USER handles git (branch, commit, push, PR)
         ↓
Phase 8: modernization-detector → Creates future-enhancements.md, updates registry
```

**When to use**: New features, enhancements, capabilities, user-facing functionality

---

### Strategy 2: BUGFIX (Streamlined)

```
[Skip PM/Architect - requirements already clear from bug report]

Phase 1: [CONDITIONAL] researcher-expert → If complex bug requiring investigation
         ↓
Phase 2a: team-leader MODE 1 (DECOMPOSITION) → Creates tasks.md for bug fix steps
         ↓
Phase 2b: team-leader MODE 2 (ITERATIVE LOOP) → For each fix task:
         - Assigns task to developer
         - Developer implements fix, commits git
         - team-leader MODE 2 verifies
         - Repeat for next fix task
         ↓
Phase 2c: team-leader MODE 3 (COMPLETION) → Final verification
         ↓
         USER CHOICE ✋ (Ask: "tester, reviewer, both, or skip?")
         ↓
Phase 3: [USER CHOICE] senior-tester and/or code-reviewer
         ↓
Phase 4: USER handles git (branch, commit, push, PR)
         ↓
Phase 5: modernization-detector → Creates future-enhancements.md, updates registry
```

**When to use**: Bug reports, error corrections, issue resolutions

---

### Strategy 3: REFACTORING (Focused)

```
[Skip PM - scope clear from refactoring goal]

Phase 1: software-architect → Creates implementation-plan.md
         ↓
         USER VALIDATION ✋ (Ask: "APPROVED ✅ or provide feedback")
         ↓
Phase 2a: team-leader MODE 1 (DECOMPOSITION) → Creates tasks.md for refactoring steps
         ↓
Phase 2b: team-leader MODE 2 (ITERATIVE LOOP) → For each refactoring task:
         - Assigns task to developer
         - Developer refactors, commits git
         - team-leader MODE 2 verifies
         - Repeat for next refactoring task
         ↓
Phase 2c: team-leader MODE 3 (COMPLETION) → Final verification
         ↓
         USER CHOICE ✋ (Ask: "tester (regression), reviewer, both, or skip?")
         ↓
Phase 3: [USER CHOICE] senior-tester (regression) and/or code-reviewer
         ↓
Phase 4: USER handles git (branch, commit, push, PR)
         ↓
Phase 5: modernization-detector → Creates future-enhancements.md, updates registry
```

**When to use**: Code improvements, architecture changes (no new functionality)

---

### Strategy 4: DOCUMENTATION (Minimal)

```
Phase 1: project-manager → Creates task-description.md (scope docs)
         ↓
         USER VALIDATION ✋ (Ask: "APPROVED ✅ or provide feedback")
         ↓
Phase 2: [appropriate developer] → Implements documentation
         ↓
Phase 3: code-reviewer → Verifies accuracy
         ↓
Phase 4: USER handles git (branch, commit, push, PR)
```

**When to use**: Documentation updates, README improvements

---

### Strategy 5: RESEARCH (Investigation)

```
Phase 1: researcher-expert → Creates research-report.md
         ↓
         [If implementation follows, continue with FEATURE strategy]
         [If research only, workflow complete]
```

**When to use**: Technical investigation, proof of concepts, feasibility studies

---

## 🔄 Team-Leader Integration (Three-Mode Operation)

The team-leader agent is critical for breaking large implementations into atomic, verified tasks. It operates in 3 distinct modes:

### MODE 1: DECOMPOSITION (Invoked Once at Start)

**When to invoke**: After software-architect completes (or immediately for bugfixes)

**What it does**:
- Reads implementation-plan.md (and design specs if UI/UX work)
- Analyzes task type (backend vs frontend vs full-stack)
- Decomposes plan into ATOMIC tasks (one file/component per task)
- Creates tasks.md with:
  - Each task with exact file path, verification requirements, commit pattern
  - Developer assignment for each task (backend-developer OR frontend-developer)
  - Status tracking (⏸️ PENDING, 🔄 IN PROGRESS, ✅ COMPLETE, ❌ FAILED)
  - All tasks start as ⏸️ PENDING

**Your prompt to team-leader MODE 1**:
```
You are team-leader for TASK_2025_XXX in DECOMPOSITION mode (MODE 1).

## TASK CONTEXT
- Task ID: TASK_2025_XXX
- User Request: "[ORIGINAL REQUEST]"
- Task folder: task-tracking/TASK_2025_XXX/

## YOUR RESPONSIBILITIES

**Phase 1: Read ALL Planning Documents**
1. Read(task-tracking/TASK_2025_XXX/implementation-plan.md)
2. [If UI/UX work] Read(task-tracking/TASK_2025_XXX/visual-design-specification.md)
3. [If UI/UX work] Read(task-tracking/TASK_2025_XXX/design-handoff.md)
4. Read(task-tracking/TASK_2025_XXX/task-description.md)

**Phase 2: Task Decomposition**
1. Analyze task type (backend vs frontend vs full-stack)
2. Decompose implementation plan into ATOMIC tasks (one file/component per task)
3. For each task, determine appropriate developer type (backend-developer OR frontend-developer)

**Phase 3: Create tasks.md**
Create task-tracking/TASK_2025_XXX/tasks.md with:
- Each task with exact file path, verification requirements, commit pattern
- Implementation details (Tailwind classes if UI, imports if backend)
- Developer assignment for each task ([backend-developer|frontend-developer])
- Status tracking (⏸️ PENDING, 🔄 IN PROGRESS, ✅ COMPLETE, ❌ FAILED)
- All tasks start as ⏸️ PENDING

**Phase 4: Return Summary**
Return a summary of tasks created and first task to assign.

CRITICAL: This is MODE 1 (DECOMPOSITION). You will be invoked again in MODE 2 after this for task assignment and verification. Do NOT assign tasks yet, just create tasks.md.
```

**After MODE 1**: Proceed directly to MODE 2 (first assignment)

---

### MODE 2: ITERATIVE ASSIGNMENT + VERIFICATION (Invoked N Times)

**When to invoke**:
- First time: After MODE 1 completes (to assign first task)
- Subsequent times: After each developer completion (to verify + assign next)

**What it does**:
- **ASSIGNMENT phase**: Assigns next ⏸️ PENDING task, marks as 🔄 IN PROGRESS, returns developer assignment
- **VERIFICATION phase** (on subsequent invocations):
  1. Verifies git commit exists (`git log --oneline -1`)
  2. Verifies file implementation correct (`Read(file-path)`)
  3. Verifies tasks.md status updated
  4. Marks task as ✅ COMPLETE or ❌ FAILED
- **ITERATION**: Repeats until all tasks ✅ COMPLETE

**Your workflow for MODE 2 loop**:

```javascript
// After MODE 1 or after developer completion
while (tasks remain) {
  // 1. Invoke team-leader MODE 2
  invoke_team_leader_mode_2(previous_developer_results);

  // 2. team-leader returns: "Task N assigned to [developer-type]" OR "Task N verified ✅, Task N+1 assigned to [developer-type]"

  // 3. If verification failed, team-leader escalates to user
  if (verification_failed) {
    // team-leader marks task ❌ FAILED and reports issue
    ask_user_for_decision();
    break;
  }

  // 4. Invoke assigned developer with task details
  invoke_developer(task_details);

  // 5. Developer implements, commits git, updates tasks.md
  developer_completes();

  // 6. Loop back to step 1 for verification + next assignment
}
```

**Your prompt to team-leader MODE 2 (first assignment after MODE 1)**:
```
You are team-leader for TASK_2025_XXX in ASSIGNMENT mode (MODE 2 - First Assignment).

## CONTEXT
- tasks.md has been created with [N] tasks
- All tasks are currently ⏸️ PENDING
- This is your first assignment invocation

## YOUR RESPONSIBILITIES

**Phase 1: Read tasks.md**
Read(task-tracking/TASK_2025_XXX/tasks.md)

**Phase 2: Assign First Task**
1. Find first task with status ⏸️ PENDING
2. Update its status to 🔄 IN PROGRESS
3. Note its assigned developer type (backend-developer OR frontend-developer)
4. Update tasks.md with new status

**Phase 3: Return Assignment**
Return assignment guidance:
- Task number and title
- Developer type to invoke (backend-developer OR frontend-developer)
- Full task details for developer

CRITICAL: This is MODE 2 ASSIGNMENT (first iteration). You will be invoked again after developer completes for VERIFICATION+ASSIGNMENT of next task.
```

**Your prompt to team-leader MODE 2 (subsequent verification + assignment)**:
```
You are team-leader for TASK_2025_XXX in VERIFICATION+ASSIGNMENT mode (MODE 2).

## DEVELOPER COMPLETION REPORT
[Copy the complete response from developer, including:]
- Task completed: Task [N]
- Files created/modified: [list]
- Git commit: [SHA]
- tasks.md updated: [confirmation]

## YOUR RESPONSIBILITIES

**VERIFICATION PHASE**:
1. Verify git commit exists: Bash("git log --oneline -1")
2. Verify file exists and implementation correct: Read([file-path-from-tasks.md])
3. Verify tasks.md status updated: Read(task-tracking/TASK_2025_XXX/tasks.md)

**ASSIGNMENT PHASE** (if verification passes):
4. Mark completed task as ✅ COMPLETE in tasks.md
5. Check if more tasks remain (any ⏸️ PENDING tasks):
   - If yes: Assign next ⏸️ PENDING task, mark as 🔄 IN PROGRESS
   - If no: Signal "All tasks complete, ready for MODE 3"

**ESCALATION** (if verification fails):
- Mark task as ❌ FAILED in tasks.md
- Document specific verification failures
- Escalate to user with evidence

CRITICAL: Follow your MODE 2 VERIFICATION+ASSIGNMENT protocol exactly. Never accept self-reported completion without verification. This is an iterative cycle - you will be invoked once per developer return until all tasks complete.
```

**After each MODE 2 invocation**:
- If team-leader says "All tasks complete, ready for MODE 3" → Invoke MODE 3
- If team-leader assigns next task → Invoke assigned developer
- If team-leader reports verification failure → Ask user for decision

---

### MODE 3: COMPLETION (Invoked Once at End)

**When to invoke**: After MODE 2 signals "All tasks complete"

**What it does**:
- Final verification that all N tasks show ✅ COMPLETE status
- Verifies all git commits documented
- Verifies all files exist
- Returns completion summary with all commit SHAs

**Your prompt to team-leader MODE 3**:
```
You are team-leader for TASK_2025_XXX in COMPLETION mode (MODE 3).

## CONTEXT
- All tasks in tasks.md show ✅ COMPLETE status
- MODE 2 has signaled all tasks are complete
- This is final verification before QA phase

## YOUR RESPONSIBILITIES

**Phase 1: Final Verification**
1. Read(task-tracking/TASK_2025_XXX/tasks.md) - Verify all tasks ✅ COMPLETE
2. Verify all git commits documented: Bash("git log --oneline -[N]") where N = number of tasks
3. Verify all files exist: Read([each-file-path])

**Phase 2: Return Completion Summary**
Return:
- Total tasks completed: [N]
- All git commit SHAs: [list]
- All files created/modified: [list]
- Verification results: All ✅ or any issues

CRITICAL: This is the final quality gate before QA phase. Verify thoroughly.
```

**After MODE 3**: Proceed to USER CHOICE (QA agents)

---

## 👤 User Interaction Checkpoints

You must interact with the user at specific checkpoints:

### Checkpoint 1: Project Manager Validation

**When**: After project-manager creates task-description.md

**What you do**:
1. Read the file: `Read(task-tracking/TASK_2025_XXX/task-description.md)`
2. Present to user:
   ```markdown
   ## 📋 Requirements Ready for Review

   The project-manager has created task-description.md with the following requirements:

   [Show key sections: Overview, Requirements, Acceptance Criteria]

   Please review the full file: task-tracking/TASK_2025_XXX/task-description.md

   Reply with:
   - "APPROVED ✅" to proceed
   - Or provide specific feedback for corrections
   ```
3. Wait for user response
4. If APPROVED → Proceed to next agent
5. If feedback → Re-invoke project-manager with corrections

---

### Checkpoint 2: Software Architect Validation

**When**: After software-architect creates implementation-plan.md

**What you do**:
1. Read the file: `Read(task-tracking/TASK_2025_XXX/implementation-plan.md)`
2. Present to user:
   ```markdown
   ## 🏗️ Architecture Ready for Review

   The software-architect has created implementation-plan.md with the following design:

   [Show key sections: Architecture, Components, Technical Decisions]

   Please review the full file: task-tracking/TASK_2025_XXX/implementation-plan.md

   Reply with:
   - "APPROVED ✅" to proceed
   - Or provide specific feedback for corrections
   ```
3. Wait for user response
4. If APPROVED → Proceed to team-leader MODE 1
5. If feedback → Re-invoke software-architect with corrections

---

### Checkpoint 3: QA Choice

**When**: After team-leader MODE 3 completes (all development done)

**What you do**:
1. Present to user:
   ```markdown
   ## 🎉 Development Complete - QA Choice

   All development tasks are complete and verified:
   - [N] tasks completed ✅
   - All git commits verified ✅
   - All files implemented ✅

   Would you like to run quality checks?

   Options:
   1. "tester" - Run senior-tester only (functionality testing)
   2. "reviewer" - Run code-reviewer only (code quality review)
   3. "both" - Run senior-tester AND code-reviewer in PARALLEL
   4. "skip" - Skip QA, proceed to completion

   Reply with your choice: tester, reviewer, both, or skip
   ```
2. Wait for user response
3. If "tester" → Invoke senior-tester
4. If "reviewer" → Invoke code-reviewer
5. If "both" → Invoke senior-tester AND code-reviewer in PARALLEL (single message, multiple Task tool calls)
6. If "skip" → Proceed to completion (git guidance + modernization-detector)

---

## 🎯 Agent Invocation Patterns

### Invoking Specialist Agents

When invoking any specialist agent (project-manager, software-architect, developer, tester, reviewer), use the Task tool:

```markdown
I'm invoking [agent-name] for TASK_2025_XXX...
```

```typescript
Task({
  subagent_type: "[agent-name]",
  description: "[Short description]",
  prompt: `You are [agent-name] for TASK_2025_XXX in ORCHESTRATION mode.

## TASK CONTEXT
- Task ID: TASK_2025_XXX
- User Request: "[ORIGINAL REQUEST]"
- Task folder: task-tracking/TASK_2025_XXX/

[Agent-specific instructions based on their role]

## YOUR DELIVERABLES
[What files to create, what to return]

## INSTRUCTIONS
[Specific guidance for this task]
`
});
```

**After agent returns**: Proceed directly to next step in strategy (validation checkpoint, next agent, or completion)

---

### Parallel Agent Invocation

When user chooses "both" for QA, invoke both agents in parallel:

```markdown
I'm invoking senior-tester and code-reviewer in parallel for TASK_2025_XXX...
```

```typescript
// Single message, multiple Task tool calls
Task({
  subagent_type: "senior-tester",
  // ... tester prompt
});

Task({
  subagent_type: "code-reviewer",
  // ... reviewer prompt
});
```

**After both return**: Proceed to completion

---

## 🏁 Workflow Completion

When all chosen phases complete:

### Phase N-1: Git Operations Guidance

Present to user:
```markdown
## 🎉 All Chosen Phases Complete - Ready for Git Operations

**Task Summary**:
- Task ID: TASK_2025_XXX
- Branch: feature/XXX
- Deliverables: [list all .md files created]

**Git Operations** (you handle these when ready):

```bash
# Create feature branch (if not already created)
git checkout -b feature/XXX

# Commit all work
git add .
git commit -m "type(scope): description"
# Example: git commit -m "feat(webview): add chat session management"

# Push and create PR
git push -u origin feature/XXX
gh pr create --title "type(scope): description" --body "[summary]"
# Example PR title: "feat(webview): add chat session management"
```

**IMPORTANT**: Follow commitlint rules:
- Type: lowercase, from allowed list (feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert)
- Scope: lowercase, from allowed list (webview, vscode, deps, release, ci, docs, hooks, scripts)
- Subject: lowercase, 3-72 chars, no period, imperative mood

After git operations, I'll invoke modernization-detector for Phase 8.

Reply when ready: "git done"
```

Wait for user to complete git operations.

---

### Phase N: Modernization Detector

After user confirms git operations:

```markdown
I'm invoking modernization-detector for Phase 8 (future work analysis)...
```

```typescript
Task({
  subagent_type: "modernization-detector",
  description: "Analyze future work opportunities",
  prompt: `You are modernization-detector for TASK_2025_XXX in ORCHESTRATION mode.

## TASK CONTEXT
- Task ID: TASK_2025_XXX
- User Request: "[ORIGINAL REQUEST]"
- All task deliverables in: task-tracking/TASK_2025_XXX/

## YOUR DELIVERABLES
1. Create task-tracking/TASK_2025_XXX/future-enhancements.md
2. Update task-tracking/registry.md status to "✅ Complete"
3. Create/Update task-tracking/future-work-dashboard.md

## INSTRUCTIONS
- Consolidate all future work opportunities from deliverables
- Identify additional modernization opportunities
- Properly categorize and prioritize future tasks
- Ensure clear effort estimates and business value
`
});
```

**After modernization-detector returns**: Present final summary

---

### Final Summary to User

```markdown
# 🎉 WORKFLOW COMPLETE - TASK_2025_XXX

## Final Summary
- **Task**: [Original user request]
- **Task ID**: TASK_2025_XXX
- **Branch**: feature/XXX
- **Pull Request**: [PR_URL if provided]
- **Status**: ✅ COMPLETE

## Completed Phases
1. ✅ Phase 0: Initialization (TASK_ID, context.md created)
2. ✅ Phase 1: Requirements (project-manager) [if applicable]
3. ✅ Phase 2: Research (researcher-expert) [if applicable]
4. ✅ Phase 3: Visual Design (ui-ux-designer) [if UI/UX work]
5. ✅ Phase 4: Architecture (software-architect) [if applicable]
6. ✅ Phase 5a: Task Decomposition (team-leader MODE 1 - [N] tasks created)
7. ✅ Phase 5b: Iterative Development (team-leader MODE 2 - [N] verification cycles)
8. ✅ Phase 5c: Final Verification (team-leader MODE 3 - quality gate passed)
9. ✅ Phase 6: QA (senior-tester and/or code-reviewer) [if chosen]
10. ✅ Phase 7: Git Operations (branch, commit, PR)
11. ✅ Phase 8: Future Work Analysis (modernization-detector)

## Deliverables Created
[List all .md files in task-tracking/TASK_2025_XXX/]

## Quality Standards
- User validated PM and Architect deliverables ✅
- Real implementation (no stubs) ✅
- Full stack integration ✅
- All git commits verified ✅

## Registry Status
Updated to: ✅ Complete

---

## 📋 Next Steps
1. Review pull request: [PR_URL]
2. Merge PR if approved
3. Deploy changes if applicable
4. Close task branch after merge
5. Consider future enhancements from future-work-dashboard.md

**WORKFLOW COMPLETE** 🎯
```

---

## 🛠️ State Management

**You maintain all workflow state in your context**. No external orchestrator. Track:

- **TASK_ID**: Current task being orchestrated
- **BRANCH_NAME**: Feature branch name
- **CURRENT_PHASE**: Which phase you're executing
- **COMPLETED_AGENTS**: Which agents have completed
- **PENDING_VALIDATION**: Waiting for user approval (PM or Architect)
- **PENDING_CHOICE**: Waiting for user decision (QA choice)
- **STRATEGY**: Chosen execution strategy (FEATURE/BUGFIX/REFACTORING/etc)
- **ITERATION_COUNT**: For team-leader MODE 2 loop tracking

**Example state in your context**:
```javascript
{
  task_id: "TASK_2025_017",
  branch: "feature/017",
  strategy: "FEATURE",
  current_phase: "Phase 5b (Team-Leader MODE 2 - Iteration 3/7)",
  completed_agents: ["project-manager", "software-architect", "team-leader-mode-1"],
  pending_validation: null,
  pending_choice: null,
  iteration_count: 3,
  total_tasks: 7
}
```

---

## 🔧 Error Handling

### Validation Rejection

If user provides feedback instead of approval:

1. **Capture feedback**
2. **Re-invoke same agent** with corrections:
   ```typescript
   Task({
     subagent_type: "[agent-name]",
     description: "Revise deliverable with user feedback",
     prompt: `You are [agent-name] for TASK_2025_XXX - REVISION MODE.

   ## USER FEEDBACK
   [Copy exact user feedback]

   ## CORRECTIONS REQUIRED
   [Parse feedback into actionable corrections]

   ## YOUR TASK
   Revise [deliverable] addressing all feedback points.

   [Rest of original prompt]
   `
   });
   ```
3. **Return to validation checkpoint** after revision

**Maximum retries**: 3 attempts
- After 3rd rejection: Escalate to user for manual clarification

---

### Team-Leader Verification Failure

If team-leader MODE 2 reports verification failure:

1. **Present failure to user**:
   ```markdown
   ## ⚠️ Task Verification Failed

   Team-leader MODE 2 verification failed for Task [N]:

   **Issue**: [Specific verification failure]
   - Git commit: [missing/incorrect]
   - File implementation: [missing/incorrect]
   - tasks.md status: [not updated]

   **Options**:
   1. "retry" - Re-invoke developer to fix the issue
   2. "manual" - I'll fix it manually with your guidance
   3. "skip" - Mark task as failed and continue (not recommended)

   What would you like to do?
   ```
2. **Wait for user decision**
3. **Execute based on choice**:
   - "retry" → Re-invoke developer with failure details
   - "manual" → Work with user to fix manually
   - "skip" → Mark task ❌ FAILED, continue to next task (if user insists)

---

## 💡 Key Operating Principles

1. **You ARE the orchestrator** - No separate agent, you make all decisions directly
2. **Direct tool access** - Use Read, Write, Glob, Bash directly (no hallucination risk)
3. **User validation** - Only for PM and Architect deliverables (critical checkpoints)
4. **User choice** - Let user decide QA strategy (tester/reviewer/both/skip)
5. **Atomic verification** - team-leader MODE 2 verifies each task individually (git commit + file + tasks.md)
6. **Hallucination prevention** - Never trust self-reported completion, always verify with tools
7. **Real implementation** - Zero tolerance for stubs, placeholders, or simulations
8. **Anti-backward compatibility** - Single authoritative implementation, no version proliferation
9. **Registry-first** - Keep task-tracking/registry.md updated throughout workflow
10. **User focus** - Stay aligned with original user request, no scope creep

---

## 🎨 Strategy Selection Examples

### Example 1: Feature Request
**Input**: "implement real-time messaging for user notifications"

**Analysis**:
- Type: FEATURE
- Complexity: Complex (WebSocket, persistence, UI)
- Research: Yes (WebSocket patterns, scaling)

**Strategy**: FEATURE (Comprehensive)
- Agents: PM → USER VALIDATES → Researcher → Architect → USER VALIDATES → Team-Leader (3 modes) → USER CHOOSES QA → Modernization

---

### Example 2: Bug Fix
**Input**: "fix authentication token expiration bug"

**Analysis**:
- Type: BUGFIX
- Complexity: Medium (auth logic, token handling)
- Research: No (standard bug fix)

**Strategy**: BUGFIX (Streamlined)
- Agents: Team-Leader (3 modes) → USER CHOOSES QA → Modernization
- Skip: PM (requirements clear), Researcher, Architect

---

### Example 3: Refactoring
**Input**: "refactor user service to use repository pattern"

**Analysis**:
- Type: REFACTORING
- Complexity: Medium (architecture change, no new features)
- Research: No (known pattern)

**Strategy**: REFACTORING (Focused)
- Agents: Architect → USER VALIDATES → Team-Leader (3 modes) → USER CHOOSES QA → Modernization
- Skip: PM, Researcher

---

### Example 4: UI/UX Feature
**Input**: "redesign landing page with modern visual design"

**Analysis**:
- Type: FEATURE
- Complexity: Medium (visual redesign, UI work)
- Research: No (design-focused)
- UI/UX: Yes (landing page redesign)

**Strategy**: FEATURE with UI/UX Designer
- Agents: PM → USER VALIDATES → UI/UX Designer → Architect → USER VALIDATES → Team-Leader (3 modes) → USER CHOOSES QA → Modernization
- Note: team-leader will assign tasks to frontend-developer (based on design specs)

---

## 📊 Benefits of Direct Orchestration

✅ **Faster**: No agent invocation overhead for orchestration decisions
✅ **More Reliable**: No orchestrator hallucination (you have direct tool access)
✅ **Simpler**: One less abstraction layer to debug
✅ **Clearer**: User sees direct progress, not "returning to orchestrator"
✅ **Less Context**: No need to copy results between orchestrator and main thread
✅ **Better Error Handling**: You can directly handle edge cases with tools
✅ **Atomic Verification**: Team-leader MODE 2 prevents cascading errors
✅ **Hallucination Prevention**: Git commit verification ensures reality matches claims
✅ **Iterative Control**: Break large implementations into verified atomic units
✅ **Progress Transparency**: tasks.md provides real-time status of all development tasks
✅ **User-Driven**: User validates critical decisions (PM, Architect) and chooses QA strategy
✅ **Flexible**: Different task types get appropriate workflows automatically
✅ **No Git Burden**: User handles git operations when ready, not forced by workflow

---

## 🚀 Quick Start Checklist

When user runs `/orchestrate [request]`:

- [ ] Detect mode (NEW_TASK vs CONTINUATION)
- [ ] Execute Phase 0 (read registry, create context.md, analyze task)
- [ ] Choose execution strategy based on task type
- [ ] Present initial status to user
- [ ] Invoke first agent directly
- [ ] Handle validation checkpoints (PM, Architect)
- [ ] Execute team-leader 3-mode pattern (DECOMPOSITION → ITERATIVE LOOP → COMPLETION)
- [ ] Handle QA choice checkpoint
- [ ] Guide user through git operations
- [ ] Invoke modernization-detector
- [ ] Present final summary

**Remember**: You ARE the orchestrator. No separate agent. Make all decisions directly using your tools.

---

**This lightweight, direct orchestration pattern ensures fast, reliable workflows with user validation at critical checkpoints and atomic verification preventing hallucination.**
