---
description: Phase 5 - Final Verification & QA (Team Leader Mode 3, Tester, Reviewer, Modernization)
---

# Phase 5: Completion & Quality Assurance

This workflow handles final verification, optional QA, and future-proofing using multiple agent personas.

## Step 1: Team Leader - Final Verification

### Adopt Team Leader Persona

**CRITICAL**: Before proceeding, adopt the Team Leader persona.

1.  **Read the Agent Definition**:

    - Open and read: `d:\projects\nestjs-ai-saas-starter\.claude\agents\team-leader.md`
    - Focus on **MODE 3: COMPLETION** section.

2.  **Impersonate the Agent**:
    - **You are now the Team Leader in MODE 3 (COMPLETION)**.
    - Your role: Final verification of all work.

### Verify All Tasks

1.  **Read** `task-tracking/TASK_ID/tasks.md`.
2.  **Verify**:

    - ✅ ALL batches show `✅ COMPLETE`
    - ✅ ALL tasks show `✅ COMPLETE`
    - ✅ All git commit SHAs are documented
    - ✅ All files exist

3.  **If ANY failures detected**:

    - **STOP** and report issues to user.
    - Return to `/phase-4-execution` to fix.

4.  **If ALL verified**:
    - Proceed to Step 2.

## Step 2: Quality Assurance (User Choice)

### Ask User for QA Preference

**Pause and ask the user**:

> "Development is complete and verified. Select QA options:
>
> 1. **tester** - Run Senior Tester only
> 2. **reviewer** - Run Code Reviewer only
> 3. **both** - Run both in parallel
> 4. **skip** - Skip QA and proceed to completion"

**Wait for user response.**

### Execute QA (Based on User Choice)

#### If "tester" or "both": Run Senior Tester

1.  **Adopt Senior Tester Persona**:

    - Read `d:\projects\nestjs-ai-saas-starter\.claude\agents\senior-tester.md`
    - **You are now the Senior Tester**.

2.  **Test the Implementation**:

    - Review all changes in `tasks.md`.
    - Run tests (unit, integration, e2e as applicable).
    - Verify acceptance criteria from `task-description.md`.

3.  **Create** `task-tracking/TASK_ID/test-report.md`:
    - Test coverage results
    - Test execution results
    - Issues found (if any)
    - Recommendations

#### If "reviewer" or "both": Run Code Reviewer

1.  **Adopt Code Reviewer Persona**:

    - Read `d:\projects\nestjs-ai-saas-starter\.claude\agents\code-reviewer.md`
    - **You are now the Code Reviewer**.

2.  **Review the Code**:

    - Review all files changed (check `tasks.md` for file list).
    - Check for code quality, patterns, best practices.
    - Verify anti-backward compatibility compliance.
    - Verify real implementation (no stubs).

3.  **Create** `task-tracking/TASK_ID/code-review.md`:
    - Code quality assessment
    - Issues found (if any)
    - Recommendations
    - Approval status

## Step 3: Modernization Check

### Adopt Modernization Detector Persona

1.  **Read the Agent Definition**:

    - Read `d:\projects\nestjs-ai-saas-starter\.claude\agents\modernization-detector.md`
    - **You are now the Modernization Detector**.

2.  **Analyze for Future Work**:

    - Review the changes made.
    - Identify opportunities for future improvements.
    - Detect technical debt introduced (if any).

3.  **Create** `task-tracking/TASK_ID/future-enhancements.md`:
    - Modernization opportunities
    - Technical debt notes
    - Suggested future tasks

## Step 4: Final Report

**Message**:

> "🎉 Task TASK_ID Complete!
>
> ## Summary
>
> - **Requirements**: ✅ Validated
> - **Architecture**: ✅ Validated
> - **Implementation**: ✅ Verified ([N] tasks in [B] batches)
> - **QA**: [tester/reviewer/both/skip] - [Status]
>
> ## Deliverables
>
> - `task-description.md`
> - `implementation-plan.md`
> - `tasks.md`
> - `test-report.md` (if tested)
> - `code-review.md` (if reviewed)
> - `future-enhancements.md`
>
> ## Next Steps
>
> 1.  Review all deliverables.
> 2.  Commit and push your branch.
> 3.  Create a Pull Request.
> 4.  Update `task-tracking/registry.md` to mark task as Complete."
