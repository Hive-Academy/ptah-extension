# Orchestrate Development Workflow

Orchestrates clean, sequential agent workflow with validation gates and trunk-based development.

## Usage

`/orchestrate [task description or TASK_ID]`

Examples:

- `/orchestrate implement real-time messaging for user notifications`
- `/orchestrate TASK_CMD_009`
- `/orchestrate continue` (continues last incomplete task)

---

## 🎯 WORKFLOW OVERVIEW

```pseudocode
Phase 0: Task Initialization (Registry + Git Setup)
    ↓
Phase 1: project-manager → business-analyst → [CONTINUE/REWORK]
    ↓
Phase 2: researcher-expert → business-analyst → [CONTINUE/REWORK]
    ↓
Phase 3: software-architect → business-analyst → [CONTINUE/REWORK]
    ↓
Phase 4: backend/frontend-developer → business-analyst → [CONTINUE/REWORK]
    ↓
Phase 5: senior-tester → business-analyst → [CONTINUE/REWORK]
    ↓
Phase 6: code-reviewer → business-analyst → [CONTINUE/REWORK]
    ↓
Phase 7: Task Completion (PR Creation + Registry Update)
    ↓
Phase 8: Future Work Consolidation (project-manager)
```

---

## Phase 0: Task Initialization

### Task Setup & Git Operations

```bash
# Task initiation
USER_REQUEST="$ARGUMENTS"
echo "=== ORCHESTRATOR INITIATED ==="
echo "User Request: $USER_REQUEST"
echo "Timestamp: $(date '+%Y-%m-%d %H:%M:%S')"

# Git status check
git branch --show-current
git status --short

# Clean git state (commit any pending work)
if ! git diff --quiet; then
    echo "Committing pending work before new task..."
    git add .
    git commit -m "chore: checkpoint before starting new task"
fi

# Generate TASK_ID
DOMAIN=$(determine_domain "$USER_REQUEST")  # CMD, INT, FE, BE, DOC, BUG
TASK_NUMBER=$(get_next_task_number "$DOMAIN")
TASK_ID="TASK_${DOMAIN}_${TASK_NUMBER}"

# Create feature branch (trunk-based development)
BRANCH_NAME="feature/${TASK_ID}-$(echo "$USER_REQUEST" | sed 's/[^a-zA-Z0-9]/-/g' | cut -c1-30)"
git checkout -b "$BRANCH_NAME"
git push -u origin "$BRANCH_NAME"

# Update task registry
echo "| $TASK_ID | $USER_REQUEST | 🔄 In Progress | orchestrator | $(date '+%Y-%m-%d') | $(date '+%Y-%m-%d %H:%M:%S') |" >> task-tracking/registry.md

# Create task folder structure
mkdir -p "task-tracking/$TASK_ID"
echo "User Request: $USER_REQUEST" > "task-tracking/$TASK_ID/context.md"

# Commit task setup
git add .
git commit -m "feat($TASK_ID): initialize task - $USER_REQUEST"
git push origin "$BRANCH_NAME"

echo "✅ Task $TASK_ID initialized on branch $BRANCH_NAME"
```

---

## Phase 1: Project Manager → Validation

### 1.1 Invoke Project Manager

```bash
Use the Task tool to invoke the project-manager agent:

**Prompt:**
```

You are the project-manager for $TASK_ID.

## ORIGINAL USER REQUEST

The user has requested: "$USER_REQUEST"

## YOUR SINGLE RESPONSIBILITY

Create comprehensive task-description.md that directly addresses the user's request above.

## DELIVERABLES

1. Save analysis to: task-tracking/$TASK_ID/task-description.md
2. Return delegation to next agent (researcher-expert OR software-architect)

Focus ONLY on what the user actually asked for. No scope expansion.

### 1.2 Validate Project Manager Work

```bash
Use the Task tool to invoke the business-analyst agent:

**Prompt:**
```

You are the business-analyst for $TASK_ID - Project Manager Validation Phase.

## VALIDATION TARGET

**Agent**: project-manager
**Deliverable**: task-tracking/$TASK_ID/task-description.md

## ORIGINAL USER REQUEST

"$USER_REQUEST"

## VALIDATION DECISION REQUIRED

- APPROVE ✅: Proceed to next phase
- REJECT ❌: Re-delegate to project-manager with corrections

Return validation decision with specific evidence.

### 1.3 Process Validation Result

```bash
if [VALIDATION_RESULT == "APPROVE"]; then
    echo "✅ Project Manager validation passed - proceeding to next phase"
    NEXT_PHASE="Phase 2"
else
    echo "❌ Project Manager validation failed - re-delegating"
    # Re-invoke project-manager with business-analyst feedback
    NEXT_PHASE="Phase 1 (retry)"
fi
```

---

## Phase 2: Researcher Expert → Validation

### 2.1 Invoke Researcher Expert (if needed)

```bash
# Only invoke if project-manager delegation specified researcher-expert
if [PM_DELEGATION == "researcher-expert"]; then

Use the Task tool to invoke the researcher-expert agent:

**Prompt:**
```

You are the researcher-expert for $TASK_ID.

## ORIGINAL USER REQUEST

$USER_REQUEST

## PROJECT MANAGER REQUIREMENTS

[Content of task-tracking/$TASK_ID/task-description.md]

## YOUR SINGLE RESPONSIBILITY

Create research-report.md with findings directly applicable to user's request.

## DELIVERABLES

1. Save to: task-tracking/$TASK_ID/research-report.md
2. Return delegation to software-architect

Focus research on user's specific technical needs.

```pseudocode
else
    echo "⏭️ Skipping research phase - proceeding to architecture"
    NEXT_PHASE="Phase 3"
fi

```

### 2.2 Validate Researcher Work

```bash
Use the Task tool to invoke the business-analyst agent:

**Prompt:**
```

You are the business-analyst for $TASK_ID - Researcher Expert Validation Phase.

## VALIDATION TARGET

**Agent**: researcher-expert
**Deliverable**: task-tracking/$TASK_ID/research-report.md

## CONTEXT

**Original User Request**: "$USER_REQUEST"
**Project Requirements**: [task-tracking/$TASK_ID/task-description.md]

## VALIDATION DECISION REQUIRED

- APPROVE ✅: Proceed to software-architect
- REJECT ❌: Re-delegate to researcher-expert

Return validation decision with architect guidance.

---

## Phase 3: Software Architect → Validation

### 3.1 Invoke Software Architect

```bash
Use the Task tool to invoke the software-architect agent:

**Prompt:**
```

You are the software-architect for $TASK_ID.

## ORIGINAL USER REQUEST

$USER_REQUEST

## PROJECT CONTEXT

**Requirements**: [task-tracking/$TASK_ID/task-description.md]
**Research**: [task-tracking/$TASK_ID/research-report.md] (if exists)

## YOUR SINGLE RESPONSIBILITY

Create implementation-plan.md for user's request. Move any large-scope work (>1 week) to task-tracking/registry.md as future tasks.

## DELIVERABLES

1. Save to: task-tracking/$TASK_ID/implementation-plan.md
2. Update task-tracking/registry.md with future tasks (if any)
3. Return delegation to appropriate developer

Keep timeline under 2 weeks for user's immediate needs.

### 3.2 Validate Architect Work

```bash
Use the Task tool to invoke the business-analyst agent:

**Prompt:**
```

You are the business-analyst for $TASK_ID - Software Architect Validation Phase.

## VALIDATION TARGET

**Agent**: software-architect
**Deliverable**: task-tracking/$TASK_ID/implementation-plan.md

## VALIDATION FOCUS

1. **Scope Discipline**: Timeline under 2 weeks for user's request?
2. **Registry Usage**: Large work moved to registry.md as future tasks?
3. **User Focus**: Plan directly addresses user's request?

## VALIDATION DECISION REQUIRED

- APPROVE ✅: Proceed to development phase
- REJECT ❌: Re-delegate to software-architect with scope corrections

Return validation decision with developer assignment.

---

## Phase 4: Development → Validation

### 4.1 Invoke Developer(s)

```bash
# Determine developer type from architect delegation
DEVELOPER_TYPE=[backend-developer|frontend-developer|both]

Use the Task tool to invoke the $DEVELOPER_TYPE agent:

**Prompt:**
```

You are the $DEVELOPER_TYPE for $TASK_ID.

## ORIGINAL USER REQUEST

$USER_REQUEST

## IMPLEMENTATION PLAN

[task-tracking/$TASK_ID/implementation-plan.md]

## YOUR SINGLE RESPONSIBILITY

Implement the user's requested functionality following the architecture plan.

## DELIVERABLES

1. Implement code changes
2. Update task-tracking/$TASK_ID/progress.md with completion status

Focus on user's functional requirements only.

### 4.2 Validate Development Work

```bash
Use the Task tool to invoke the business-analyst agent:

**Prompt:**
```

You are the business-analyst for $TASK_ID - Development Validation Phase.

## VALIDATION TARGET

**Agent**: $DEVELOPER_TYPE
**Deliverable**: Code implementation + progress.md

## VALIDATION FOCUS

1. **User Requirements**: Does implementation solve user's actual problem?
2. **Scope Adherence**: No unrelated technical improvements?
3. **Critical Issues**: High-priority research findings addressed?

## VALIDATION DECISION REQUIRED

- APPROVE ✅: Proceed to testing phase
- REJECT ❌: Re-delegate to developer with requirement focus

Return validation decision with testing guidance.

---

## Phase 5: Senior Tester → Validation

### 5.1 Invoke Senior Tester

```bash
Use the Task tool to invoke the senior-tester agent:

**Prompt:**
```

You are the senior-tester for $TASK_ID.

## ORIGINAL USER REQUEST

$USER_REQUEST

## IMPLEMENTATION TO TEST

[Code changes from development phase]
[task-tracking/$TASK_ID/implementation-plan.md]

## YOUR SINGLE RESPONSIBILITY

Create tests that verify user's requirements are met.

## DELIVERABLES

1. Implement tests for user's functionality
2. Save test report to: task-tracking/$TASK_ID/test-report.md

Test what the user actually needs, not theoretical edge cases.

### 5.2 Validate Testing Work

```bash
Use the Task tool to invoke the business-analyst agent:

**Prompt:**
```

You are the business-analyst for $TASK_ID - Senior Tester Validation Phase.

## VALIDATION TARGET

**Agent**: senior-tester
**Deliverable**: Tests + test-report.md

## VALIDATION FOCUS

User's acceptance criteria covered by tests?

## VALIDATION DECISION REQUIRED

- APPROVE ✅: Proceed to code review
- REJECT ❌: Re-delegate to senior-tester

Return validation decision.

---

## Phase 6: Code Reviewer → Validation

### 6.1 Invoke Code Reviewer

```bash
Use the Task tool to invoke the code-reviewer agent:

**Prompt:**
```

You are the code-reviewer for $TASK_ID.

## ORIGINAL USER REQUEST

$USER_REQUEST

## COMPLETE CONTEXT

**Requirements**: [task-tracking/$TASK_ID/task-description.md]
**Implementation**: [task-tracking/$TASK_ID/implementation-plan.md]
**Tests**: [task-tracking/$TASK_ID/test-report.md]

## YOUR SINGLE RESPONSIBILITY

Verify implementation meets user's original request with production quality.

## DELIVERABLES

1. Save review to: task-tracking/$TASK_ID/code-review.md
2. Return APPROVED/NEEDS_REVISION decision

Focus on: Does this solve what the user asked for?

### 6.2 Final Validation

```bash
Use the Task tool to invoke the business-analyst agent:

**Prompt:**
```

You are the business-analyst for $TASK_ID - Final Code Review Validation.

## VALIDATION TARGET

**Agent**: code-reviewer
**Deliverable**: task-tracking/$TASK_ID/code-review.md

## FINAL VALIDATION

Does the complete solution address the user's original request: "$USER_REQUEST"?

## VALIDATION DECISION REQUIRED

- APPROVE ✅: Ready for task completion
- REJECT ❌: Re-delegate for corrections

Return final validation decision.

---

## Phase 7: Task Completion

### 7.1 Create Pull Request

```bash
# Final commit
git add .
git commit -m "feat($TASK_ID): complete user request - $USER_REQUEST"
git push origin "$BRANCH_NAME"

# Create PR
gh pr create \
  --title "feat($TASK_ID): $USER_REQUEST" \
  --body "$(cat <<EOF
## Summary
Completes $TASK_ID: $USER_REQUEST

## Implementation
- [List key changes]

## Testing
- [Test coverage summary]

## Validation
All phases validated by business-analyst agent.

🤖 Generated with [Claude Code](https://claude.ai/code)
EOF
)"

PR_URL=$(gh pr view --json url -q .url)
echo "✅ Pull Request created: $PR_URL"
```

### 7.2 Update Registry

```bash
# Update task status in registry
sed -i "s/| $TASK_ID | .* | 🔄 In Progress |/| $TASK_ID | $USER_REQUEST | ✅ Completed | orchestrator |/g" task-tracking/registry.md

# Final commit
git add task-tracking/registry.md
git commit -m "chore($TASK_ID): mark task complete in registry"
git push origin "$BRANCH_NAME"
```

### 7.3 Task Completion Summary

```bash
echo "🎉 TASK $TASK_ID COMPLETED SUCCESSFULLY"
echo "📋 User Request: $USER_REQUEST"
echo "🔗 Pull Request: $PR_URL"
echo "🌿 Branch: $BRANCH_NAME"
echo "📊 Registry Updated: ✅ Completed"
echo ""
echo "Next Steps:"
echo "1. Review and merge PR: $PR_URL"
echo "2. Deploy changes if approved"
echo "3. Close task branch after merge"
```

---

## Phase 8: Future Work Consolidation

### 8.1 Invoke Project Manager for Future Work Scanning

```bash
Use the Task tool to invoke the project-manager agent:

**Prompt:**
```

You are the project-manager for $TASK_ID - Future Work Consolidation Phase.

## ORIGINAL USER REQUEST

$USER_REQUEST

## YOUR SINGLE RESPONSIBILITY

Scan ALL task deliverables and extract future work recommendations into consolidated, visible format.

## DOCUMENTS TO SCAN

- task-tracking/$TASK_ID/task-description.md
- task-tracking/$TASK_ID/research-report.md (if exists)
- task-tracking/$TASK_ID/implementation-plan.md
- task-tracking/$TASK_ID/progress.md
- task-tracking/$TASK_ID/test-report.md
- task-tracking/$TASK_ID/code-review.md

## DELIVERABLES

1. Create: task-tracking/$TASK_ID/future-enhancements.md
2. Update: task-tracking/registry.md with properly categorized future tasks
3. Create/Update: task-tracking/future-work-dashboard.md (project-wide view)

## OUTPUT FORMAT REQUIREMENTS

**future-enhancements.md structure:**

- **Immediate Opportunities** (1-2 weeks effort)
- **Strategic Enhancements** (3-8 weeks effort)
- **Advanced Architecture** (2-6 months effort)
- **Research & Innovation** (exploratory)

Each item must include: Priority, Effort, Dependencies, Business Value, Implementation Notes

Focus on making future work highly visible and actionable.

### 8.2 Validate Future Work Consolidation

```bash
Use the Task tool to invoke the business-analyst agent:

**Prompt:**
```

You are the business-analyst for $TASK_ID - Future Work Consolidation Validation Phase.

## VALIDATION TARGET

**Agent**: project-manager
**Deliverable**: task-tracking/$TASK_ID/future-enhancements.md

## VALIDATION FOCUS

1. **Completeness**: All future recommendations from task deliverables captured?
2. **Visibility**: Future work properly categorized and prioritized?
3. **Actionability**: Each item has clear effort estimates and business value?

## VALIDATION DECISION REQUIRED

- APPROVE ✅: Future work properly consolidated and visible
- REJECT ❌: Re-delegate to project-manager with consolidation improvements

Return validation decision confirming future work visibility.

### 8.3 Process Future Work Validation

```bash
if [VALIDATION_RESULT == "APPROVE"]; then
    echo "✅ Future work consolidation complete - highly visible for planning"
    echo "📋 Future enhancements documented in: task-tracking/$TASK_ID/future-enhancements.md"
    echo "🎯 Registry updated with prioritized future tasks"
else
    echo "❌ Future work consolidation failed - re-delegating"
    # Re-invoke project-manager with business-analyst feedback
fi
```

---

## Error Handling

### Re-delegation Protocol

```bash
if [VALIDATION_RESULT == "REJECT"]; then
    echo "❌ Validation failed - re-delegating to $AGENT_NAME"

    # Get specific feedback from business-analyst
    FEEDBACK="[Business analyst feedback]"

    # Re-invoke agent with corrections
    # (Repeat agent invocation with feedback)

    # Retry validation
fi
```

### Failure Recovery

```bash
# If multiple validation failures occur:
if [RETRY_COUNT > 3]; then
    echo "🚨 Task $TASK_ID failed after multiple attempts"

    # Update registry with failed status
    sed -i "s/🔄 In Progress/❌ Failed/g" task-tracking/registry.md

    # Create issue for manual review
    gh issue create \
      --title "Task $TASK_ID failed: $USER_REQUEST" \
      --body "Multiple validation failures - requires manual review"
fi
```

---

## Workflow Principles

1. **Trunk-Based Development**: Each task gets its own feature branch
2. **Sequential Agent Execution**: No parallel execution to prevent conflicts
3. **Validation Gates**: Every agent validated by business-analyst
4. **User Focus**: Original request drives all decisions
5. **Scope Discipline**: Large work goes to registry.md as future tasks
6. **Clean Git History**: Proper commits and PR creation
7. **Registry Management**: Single source of truth for all tasks

**Remember**: This is workflow orchestration only. All implementation details live in individual agent definitions.
