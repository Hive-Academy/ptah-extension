# Orchestrate Development Workflow

Multi-phase development workflow with dynamic strategies and user validation checkpoints. **You are the orchestrator** - coordinate agents, manage state, verify deliverables.

## Usage

```
/orchestrate [task description]     # New task
/orchestrate TASK_2025_XXX          # Continue existing task
```

---

## Mode Detection

```javascript
if ($ARGUMENTS matches /^TASK_2025_\d{3}$/) → CONTINUATION mode
else → NEW_TASK mode
```

---

## NEW_TASK: Phase 0 Initialization

**You execute directly** (no agent):

### STEP 1: Read Registry & Generate TASK_ID

```bash
Read(D:\projects\ptah-extension\task-tracking\registry.md)

# Find highest TASK_2025_XXX number, increment by 1
# Example: If TASK_2025_028 is highest → new ID is TASK_2025_029
```

### STEP 2: Create Task Folder & Context File

```bash
# Create folder
mkdir task-tracking/TASK_[ID]

# Write context.md
Write(D:\projects\ptah-extension\task-tracking\TASK_[ID]\context.md, `
# Task Context - TASK_[ID]

## User Intent
[Copy exact request from $ARGUMENTS]

## Conversation Summary
[If prior conversation exists, summarize key decisions/constraints]

## Technical Context
- Branch: feature/[XXX]
- Created: [DATE]
- Type: [FEATURE|BUGFIX|REFACTORING|DOCUMENTATION|RESEARCH]
- Complexity: [Simple|Medium|Complex]

## Execution Strategy
[Strategy name based on task type]
`)
```

### STEP 3: Analyze Task Type

**Detection Logic**:

- Contains "implement", "add", "create", "build" → **FEATURE**
- Contains "fix", "bug", "error", "issue" → **BUGFIX**
- Contains "refactor", "improve", "optimize", "clean" → **REFACTORING**
- Contains "document", "readme", "comment" → **DOCUMENTATION**
- Contains "research", "investigate", "analyze", "explore" → **RESEARCH**
- Unclear → Ask user for clarification

**Complexity Assessment**:

- **Simple**: Single file, clear requirements, <2 hours
- **Medium**: Multiple files, some research, 2-8 hours
- **Complex**: Multiple modules, architecture decisions, >8 hours

### STEP 4: Choose Strategy & Present to User

```markdown
# 🎯 Orchestrating Workflow - TASK\_[ID]

**Task ID**: TASK\_[ID]
**Branch**: feature/[XXX]
**Type**: [FEATURE|BUGFIX|...]
**Complexity**: [Simple|Medium|Complex]

## Execution Strategy: [STRATEGY_NAME]

**Planned Agent Sequence**:
[List agents based on chosen strategy]

## Starting Phase 1...

Invoking [first-agent] now...
```

---

## Execution Strategies

### FEATURE (Full Workflow)

```
Phase 1: project-manager → Creates task-description.md
         ↓
         USER VALIDATES ✋ ("APPROVED" or feedback)
         ↓
Phase 2: [IF technical unknowns] researcher-expert → Creates research-report.md
         ↓
Phase 3: [IF UI/UX work] ui-ux-designer → Creates visual-design-specification.md
         ↓
Phase 4: software-architect → Creates implementation-plan.md
         ↓
         USER VALIDATES ✋ ("APPROVED" or feedback)
         ↓
Phase 5: team-leader MODE 1 → MODE 2 (loop) → MODE 3
         ↓
         USER CHOOSES QA ✋ (tester/style/logic/reviewers/all/skip)
         ↓
Phase 6: [QA agents as chosen]
         ↓
Phase 7: User handles git (commits already created)
         ↓
Phase 8: modernization-detector → Creates future-enhancements.md
```

**When to invoke conditional agents**:

- **researcher-expert**: Technical complexity score > 3, unknown libraries/APIs, needs POC
- **ui-ux-designer**: Task involves landing pages, visual redesigns, new UI components

### BUGFIX (Streamlined)

```
[IF complex/unknown cause] researcher-expert
         ↓
team-leader MODE 1 → MODE 2 (loop) → MODE 3
         ↓
USER CHOOSES QA ✋
         ↓
[QA agents] → Git → modernization-detector
```

### REFACTORING (Focused)

```
software-architect → USER VALIDATES ✋
         ↓
team-leader MODE 1 → MODE 2 (loop) → MODE 3
         ↓
USER CHOOSES QA ✋
         ↓
[QA agents] → Git → modernization-detector
```

### DOCUMENTATION (Minimal)

```
project-manager → USER VALIDATES ✋
         ↓
[appropriate developer] → code-style-reviewer
         ↓
Git
```

### RESEARCH (Investigation Only)

```
researcher-expert → Creates research-report.md
         ↓
[IF implementation needed] → Switch to FEATURE strategy
[IF research only] → Complete
```

---

## CONTINUATION: Phase Detection

When resuming with TASK_ID, read documents to determine phase:

```bash
Glob(task-tracking/TASK_[ID]/*.md)
Read(D:\projects\ptah-extension\task-tracking\registry.md)
```

| Document Exists                   | Phase Complete         | Next Action                           |
| --------------------------------- | ---------------------- | ------------------------------------- |
| ❌ context.md                     | Invalid                | ERROR: Task doesn't exist             |
| ✅ context.md only                | Initialized            | Invoke project-manager                |
| ✅ task-description.md            | PM done                | User validate OR next agent           |
| ✅ visual-design-specification.md | Designer done          | Invoke software-architect             |
| ✅ implementation-plan.md         | Architect done         | User validate OR team-leader MODE 1   |
| ✅ tasks.md (all ⏸️ PENDING)      | Decomposition done     | team-leader MODE 2 (first assignment) |
| ✅ tasks.md (has 🔄 IN PROGRESS)  | Dev in progress        | team-leader MODE 2 (verify + next)    |
| ✅ tasks.md (has 🔄 IMPLEMENTED)  | Dev done, await verify | team-leader MODE 2 (verify + commit)  |
| ✅ tasks.md (all ✅ COMPLETE)     | Dev complete           | team-leader MODE 3 OR QA choice       |
| ✅ test-report.md                 | Tester complete        | Continue QA or complete               |
| ✅ code-style-review.md           | Style reviewed         | Continue QA or complete               |
| ✅ code-logic-review.md           | Logic reviewed         | Complete workflow                     |
| ✅ future-enhancements.md         | All done               | Workflow already complete             |

---

## Team-Leader Integration

### MODE 1: DECOMPOSITION

**When**: After architect completes (or immediately for bugfix)

**Invoke**:

```typescript
Task({
  subagent_type: 'team-leader',
  description: 'Decompose TASK_[ID] into batches',
  prompt: `You are team-leader in MODE 1: DECOMPOSITION for TASK_[ID].

**Task Folder**: D:\projects\ptah-extension\task-tracking\TASK_[ID]\
**User Request**: "[original request]"

Read implementation-plan.md and create tasks.md with batched tasks.
See team-leader.md for detailed MODE 1 instructions.`,
});
```

**Result**: Creates tasks.md, assigns first batch, returns developer prompt template

### MODE 2: ASSIGNMENT + VERIFY + COMMIT (Loop)

**When**: After developer returns OR need to assign first/next batch

**Invoke (after developer returns)**:

```typescript
Task({
  subagent_type: 'team-leader',
  description: 'Verify and commit batch for TASK_[ID]',
  prompt: `You are team-leader in MODE 2 for TASK_[ID].

**Developer Report**:
${developer_response}

Verify files exist, invoke code-logic-reviewer, commit if approved, assign next batch.
See team-leader.md for detailed MODE 2 instructions.`,
});
```

**Loop until**: Team-leader signals "All batches complete, ready for MODE 3"

**Handle team-leader response**:

- "NEXT BATCH ASSIGNED" → Invoke developer with provided prompt
- "BATCH REJECTED" → Re-invoke developer with issues
- "ALL BATCHES COMPLETE" → Invoke MODE 3

### MODE 3: COMPLETION

**When**: All batches show ✅ COMPLETE

**Invoke**:

```typescript
Task({
  subagent_type: 'team-leader',
  description: 'Final verification for TASK_[ID]',
  prompt: `You are team-leader in MODE 3: COMPLETION for TASK_[ID].

Verify all batches complete, cross-check git commits, return summary.
See team-leader.md for detailed MODE 3 instructions.`,
});
```

**Result**: Completion summary with all commits and files

---

## User Checkpoints

### Checkpoint 1: After Project Manager

```markdown
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 REQUIREMENTS READY FOR REVIEW - TASK\_[ID]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Overview

[Summary from task-description.md]

## Key Requirements

- [Requirement 1]
- [Requirement 2]

## Acceptance Criteria

- [Criterion 1]
- [Criterion 2]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✋ USER VALIDATION CHECKPOINT
Reply "APPROVED" to proceed to architecture phase
OR provide feedback for revision
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Checkpoint 2: After Architect

```markdown
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏗️ ARCHITECTURE READY FOR REVIEW - TASK\_[ID]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Design Summary

[Summary from implementation-plan.md]

## Components

- [Component 1]: [purpose]
- [Component 2]: [purpose]

## Files to Create/Modify

- [File 1]
- [File 2]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✋ USER VALIDATION CHECKPOINT
Reply "APPROVED" to proceed to development phase
OR provide feedback for revision
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Checkpoint 3: QA Choice (After Development Complete)

```markdown
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 DEVELOPMENT COMPLETE - TASK\_[ID]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Tasks Completed**: [N] tasks in [B] batches ✅
**Git Commits**: [B] commits verified ✅
**Files Implemented**: [N] files ✅

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✋ QA CHOICE CHECKPOINT

Options:

1. "tester" - senior-tester only (functionality testing)
2. "style" - code-style-reviewer only (coding standards)
3. "logic" - code-logic-reviewer only (business logic)
4. "reviewers" - BOTH reviewers in parallel
5. "all" - tester + BOTH reviewers in parallel
6. "skip" - proceed to completion

Reply with your choice: tester, style, logic, reviewers, all, or skip
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**QA Invocation Patterns**:

```typescript
// "tester" - single agent
Task({ subagent_type: 'senior-tester', prompt: `Test TASK_[ID]...` });

// "style" - single agent
Task({ subagent_type: 'code-style-reviewer', prompt: `Review TASK_[ID] for patterns...` });

// "logic" - single agent
Task({ subagent_type: 'code-logic-reviewer', prompt: `Review TASK_[ID] for completeness...` });

// "reviewers" - parallel (BOTH in single message)
Task({ subagent_type: 'code-style-reviewer', prompt: `...` });
Task({ subagent_type: 'code-logic-reviewer', prompt: `...` });

// "all" - parallel (THREE in single message)
Task({ subagent_type: 'senior-tester', prompt: `...` });
Task({ subagent_type: 'code-style-reviewer', prompt: `...` });
Task({ subagent_type: 'code-logic-reviewer', prompt: `...` });
```

---

## Workflow Completion

### Phase 7: Git Operations Guidance

**Note**: Commits already created by team-leader. User handles branch/push/PR.

```markdown
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 READY FOR GIT OPERATIONS - TASK\_[ID]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Commits Created**: [B] batch commits by team-leader

**Your Git Operations**:
git checkout -b feature/[XXX]
git push -u origin feature/[XXX]
gh pr create --title "type(scope): description" --body "..."

**Commitlint Reminder** (see CLAUDE.md for full rules):

- Type: feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert
- Scope: webview|vscode|deps|release|ci|docs|hooks|scripts
- Subject: lowercase, no period, imperative mood

Reply "git done" when PR is created.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Phase 8: Modernization Detector

After user confirms PR:

```typescript
Task({
  subagent_type: 'modernization-detector',
  description: 'Analyze future work for TASK_[ID]',
  prompt: `Analyze TASK_[ID] for future enhancements.

**Task Folder**: D:\projects\ptah-extension\task-tracking\TASK_[ID]\

Create future-enhancements.md and update registry.md with completion status.`,
});
```

### Final Summary

```markdown
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 WORKFLOW COMPLETE - TASK\_[ID]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Summary**:

- Task: [Original request]
- Branch: feature/[XXX]
- PR: [URL]
- Status: ✅ COMPLETE

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

## Error Handling

### Validation Rejection

If user provides feedback instead of "APPROVED":

1. Parse feedback into actionable points
2. Re-invoke same agent with feedback:

```typescript
Task({
  subagent_type: '[same-agent]',
  description: 'Revise deliverable for TASK_[ID]',
  prompt: `Revise your deliverable for TASK_[ID].

**User Feedback**:
${user_feedback}

Address each point and update the file.`,
});
```

3. Present revised version to user again

### Team-Leader Verification Failure

If team-leader reports files missing or code-logic-reviewer rejected:

```markdown
⚠️ VERIFICATION FAILED - TASK\_[ID]

**Issue**: [From team-leader report]

**Options**:

1. "retry" - Re-invoke developer to fix
2. "manual" - You fix with my guidance
3. "skip" - Mark as failed, continue (NOT RECOMMENDED)

What would you like to do?
```

### Commit Hook Failure

If pre-commit hook fails during team-leader git operations:

```markdown
⚠️ PRE-COMMIT HOOK FAILED

**Error**: [specific error]

**Options**:

1. Fix issue (if related to current work)
2. Bypass with --no-verify (if unrelated)
3. Stop and report (if critical)

Which option? (1/2/3)
```

NEVER bypass hooks automatically. Always ask user.
