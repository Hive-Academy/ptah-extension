---
description: Phase 4 of the orchestration workflow. Handles final verification, QA, and modernization checks.
---

# Phase 4: Completion

This workflow handles the final steps of the task: verification, QA, and future-proofing.

## Step 1: Final Verification (Team Leader)

1.  **Action**: Verify All Tasks.
2.  **Instructions**:
    - Act as the **Team Leader**.
    - Read `task-tracking/TASK_ID/tasks.md`.
    - Verify that **ALL** batches and tasks are marked `COMPLETE`.
    - Verify that all files exist.
    - **If Verified**: Proceed to Step 2.
    - **If Failed**: Stop and report issues.

## Step 2: Quality Assurance (QA)

1.  **Action**: User Choice.
2.  **Instructions**:

    - **Ask the User**:
      > "Development is complete. Select QA options:
      >
      > 1. **Tester**: Run Senior Tester.
      > 2. **Reviewer**: Run Code Reviewer.
      > 3. **Both**: Run both.
      > 4. **Skip**: Skip QA."
    - **Wait for Response**.

3.  **Execution**:
    - **If Tester/Both**:
      - Act as **Senior Tester**.
      - Run tests and create `task-tracking/TASK_ID/test-report.md`.
    - **If Reviewer/Both**:
      - Act as **Code Reviewer**.
      - Review code and create `task-tracking/TASK_ID/code-review.md`.

## Step 3: Modernization Check

1.  **Action**: Detect Future Work.
2.  **Instructions**:
    - Act as **Modernization Detector**.
    - Analyze the changes.
    - Create `task-tracking/TASK_ID/future-enhancements.md` with any suggestions for future improvements or refactoring.

## Step 4: Final Report

**Message**:

> "🎉 Task TASK_ID Complete!
>
> **Summary**:
>
> - Requirements: Validated
> - Architecture: Validated
> - Implementation: Verified
> - QA: [Status]
>
> **Next Steps**:
>
> 1.  Review the changes.
> 2.  Commit and Push your branch.
> 3.  Create a Pull Request."
