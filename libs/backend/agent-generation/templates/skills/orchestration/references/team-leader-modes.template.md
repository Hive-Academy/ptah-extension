# Team-Leader Integration Reference

This reference documents the three operational modes of the team-leader agent and how the orchestrator integrates with each mode during development workflows.

---

## Mode Overview

| Mode | Name | When to Invoke | Purpose | Output |
|------|------|----------------|---------|--------|
| **MODE 1** | DECOMPOSITION | After architect completes (or immediately for BUGFIX) | Break implementation-plan.md into atomic, batched tasks | Creates `tasks.md` with batched task assignments |
| **MODE 2** | ASSIGNMENT + VERIFY + COMMIT | After developer returns OR to assign first/next batch | Verify work, commit code, assign next batch | Git commits, batch status updates, developer prompts |
| **MODE 3** | COMPLETION | All batches show COMPLETE status | Final verification and QA handoff | Completion summary with all commits and files |

---

## MODE 1: DECOMPOSITION

### When to Invoke

- **FEATURE workflow**: After architect creates `implementation-plan.md` and user approves
- **BUGFIX workflow**: Immediately after task initialization (skips PM/Architect)
- **REFACTORING workflow**: After architect approval

### Invocation Template

```typescript
Task({
  subagent_type: 'team-leader',
  description: 'Decompose TASK_[ID] into batches',
  prompt: `You are team-leader in MODE 1: DECOMPOSITION for TASK_[ID].

**Task Folder**: {{PROJECT_PATH}}\\task-tracking\\TASK_[ID]\\
**User Request**: "[original request from context.md]"

Read implementation-plan.md and create tasks.md with batched tasks.
See team-leader.md for detailed MODE 1 instructions.`
});
```

### Expected Output

Team-leader creates `tasks.md` with the following structure:

```markdown
# Development Tasks - TASK_[ID]

**Total Tasks**: N | **Batches**: B | **Status**: 0/B complete

## Batch 1: [Name] - PENDING
**Developer**: [backend-developer|frontend-developer]
**Tasks**: N | **Dependencies**: None

### Task 1.1: [Description]
**File**: [absolute path]
**Status**: PENDING

### Task 1.2: [Description]
**File**: [absolute path]
**Status**: PENDING

## Batch 2: [Name] - PENDING
**Developer**: [type]
**Tasks**: N | **Dependencies**: Batch 1
...
```

### After MODE 1 Completes

1. Team-leader returns with tasks.md created
2. Team-leader provides prompt template for first developer
3. Orchestrator invokes the specified developer with the provided prompt

---

## MODE 2: ASSIGNMENT + VERIFY + COMMIT (Loop)

### When to Invoke

- **After developer returns**: To verify work and assign next batch
- **To assign first batch**: After MODE 1 completes
- **To reassign rejected batch**: After developer fixes issues

### Invocation Template (After Developer Returns)

```typescript
Task({
  subagent_type: 'team-leader',
  description: 'Verify and commit batch for TASK_[ID]',
  prompt: `You are team-leader in MODE 2 for TASK_[ID].

**Developer Report**:
${developer_response}

Verify files exist, invoke code-logic-reviewer, commit if approved, assign next batch.
See team-leader.md for detailed MODE 2 instructions.`
});
```

### MODE 2 Loop Flow

```
+-------------------------------------------------------+
|  Orchestrator invokes team-leader MODE 2               |
+-------------------------+-----------------------------+
                          |
                          v
+-------------------------------------------------------+
|  Team-leader verifies:                                |
|  - All files exist at specified paths                 |
|  - Task status updated to IMPLEMENTED                 |
|  - Code quality (via code-logic-reviewer)             |
+-------------------------+-----------------------------+
                          |
            +-------------+-------------+
            |                           |
            v                           v
    +---------------+           +---------------+
    |  APPROVED     |           |  REJECTED     |
    +-------+-------+           +-------+-------+
            |                           |
            v                           v
    +---------------+           +---------------+
    |  Git commit   |           |  Return issues|
    |  Update tasks |           |  to developer |
    +-------+-------+           +---------------+
            |
            v
+-------------------------------------------------------+
|  Check: More batches pending?                          |
+-------------------------+-----------------------------+
            |
    +-------+-------+
    |               |
    v               v
+---------+   +-------------------+
|  YES    |   |  NO               |
+----+----+   +---------+---------+
     |                  |
     v                  v
"NEXT BATCH       "ALL BATCHES
 ASSIGNED"         COMPLETE"
```

### Handling Team-Leader Responses

| Response Pattern | Meaning | Orchestrator Action |
|-----------------|---------|---------------------|
| `NEXT BATCH ASSIGNED: [developer-type]` | Current batch committed, next batch ready | Invoke specified developer with provided prompt |
| `BATCH REJECTED: [issues]` | Verification failed | Re-invoke same developer with issues to fix |
| `ALL BATCHES COMPLETE` | All tasks done, ready for QA | Invoke team-leader MODE 3 |

### Response Detection Logic

```
IF response contains "NEXT BATCH ASSIGNED":
    -> Extract developer type from response
    -> Extract developer prompt from response
    -> Invoke developer with extracted prompt

ELSE IF response contains "BATCH REJECTED":
    -> Extract rejection reasons
    -> Re-invoke developer with fix instructions

ELSE IF response contains "ALL BATCHES COMPLETE":
    -> Proceed to MODE 3
```

---

## MODE 3: COMPLETION

### When to Invoke

- All batches in `tasks.md` show COMPLETE status
- Team-leader signals "ALL BATCHES COMPLETE" from MODE 2

### Invocation Template

```typescript
Task({
  subagent_type: 'team-leader',
  description: 'Final verification for TASK_[ID]',
  prompt: `You are team-leader in MODE 3: COMPLETION for TASK_[ID].

Verify all batches complete, cross-check git commits, return summary.
See team-leader.md for detailed MODE 3 instructions.`
});
```

### Expected Output

Team-leader returns comprehensive completion summary:

```markdown
## TASK_[ID] COMPLETION SUMMARY

### Development Complete
- **Total Tasks**: N tasks in B batches
- **All Batches**: COMPLETE
- **Git Commits**: B commits verified

### Commits Created
| Batch | Commit Hash | Message |
|-------|-------------|---------|
| 1 | abc1234 | type(scope): batch 1 description |
| 2 | def5678 | type(scope): batch 2 description |
| 3 | ghi9012 | type(scope): batch 3 description |

### Files Implemented
- path/to/file1.ts
- path/to/file2.ts
- ...

### Ready for QA
Development phase complete. Proceed to QA checkpoint.
```

### After MODE 3 Completes

1. Orchestrator presents **Checkpoint 3: QA Choice** to user
2. User selects QA option (tester, style, logic, reviewers, all, skip)
3. Orchestrator invokes selected QA agents

---

## Task Status Legend

| Status | Symbol | Meaning |
|--------|--------|---------|
| PENDING | - | Not started, awaiting assignment |
| IN PROGRESS | - | Developer actively working |
| IMPLEMENTED | - | Code done, awaiting team-leader verification |
| COMPLETE | - | Verified and git committed |
| FAILED | - | Verification failed, needs rework |

---

## Common Issues and Resolutions

### Issue: Developer Reports Missing Files

**Detection**: Team-leader MODE 2 cannot find expected files
**Resolution**: Team-leader responds with `BATCH REJECTED` and specific missing file paths
**Orchestrator Action**: Re-invoke developer with clear instructions about missing files

### Issue: Commit Hook Failure

**Detection**: Team-leader MODE 2 git commit fails
**Resolution**: See `git-standards.md` for hook failure protocol
**Orchestrator Action**: Present 3-option choice to user (Fix, Bypass, Stop)

### Issue: Batch Dependencies Not Met

**Detection**: Team-leader MODE 2 detects previous batch incomplete
**Resolution**: Team-leader reports dependency issue
**Orchestrator Action**: Return to previous batch verification

---

## Integration with Other References

- **strategies.md**: Determines when team-leader is invoked in each workflow
- **agent-catalog.md**: Developer types available for assignment
- **checkpoints.md**: QA Choice checkpoint follows MODE 3
- **git-standards.md**: Commit format rules enforced in MODE 2
- **task-tracking.md**: tasks.md document format and status tracking
