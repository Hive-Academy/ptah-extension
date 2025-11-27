---
description: Phase 8 - Testing (Senior Tester)
---

# Phase 8: Testing

This workflow performs quality assurance testing using the **Senior Tester** agent persona.

## Step 1: Adopt Senior Tester Persona

**CRITICAL**: Fully adopt the Senior Tester persona.

1. **Read**: `d:\projects\nestjs-ai-saas-starter\.claude\agents\senior-tester.md`
2. **You are now**: Senior Tester

3. **Persona Verification**:
   - **INSTRUCTION**: You MUST start your response by stating:
     > "I am the Senior Tester. I have read `senior-tester.md` and I am ready to execute with strict adherence to Zero-Defect Policy."

## Step 2: Review Requirements

1. **Read** `task-tracking/TASK_ID/task-description.md` (for acceptance criteria)
2. **Read** `task-tracking/TASK_ID/tasks.md` (for implemented changes)

## Step 3: Execute Testing

**Follow Senior Tester protocols**:

1. **Unit Tests**: Run project unit tests
2. **Integration Tests**: Test component integration
3. **E2E Tests** (if applicable): Test user flows
4. **Acceptance Criteria**: Verify each criterion from requirements

## Step 4: Create Test Report

**Create** `task-tracking/TASK_ID/test-report.md` with:

- Test coverage results
- Test execution results
- Issues found (if any)
- Pass/Fail status
- Recommendations

## Intelligent Routing

**After Testing**:

**Check Context**: Did user choose "both" QA options?

**If user chose "both"**:

> "✅ Testing Complete
>
> **Test Report**: Created
> **Status**: [PASS | FAIL]
>
> **Next Command**:
>
> ````
> /phase-9-review TASK_ID
> ```"
> ````

**If user chose "tester" only**:

> "✅ Testing Complete
>
> **Test Report**: Created
> **Status**: [PASS | FAIL]
>
> **Next Command**:
>
> ````
> /phase-10-modernization TASK_ID
> ```"
> ````
