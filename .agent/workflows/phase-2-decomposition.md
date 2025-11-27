---
description: Phase 2 of the orchestration workflow. Handles task decomposition (Team Leader Mode 1).
---

# Phase 2: Decomposition

This workflow breaks down the implementation plan into atomic, verifiable tasks grouped into batches.

## Step 1: Task Decomposition (Team Leader)

**Condition**: If `task-tracking/TASK_ID/tasks.md` already exists, skip to **Completion**.

1.  **Action**: Create Task List.
2.  **Instructions**:

    - Read `task-tracking/TASK_ID/implementation-plan.md`.
    - Act as the **Team Leader**.
    - Create `task-tracking/TASK_ID/tasks.md`.
    - **Prompt**:

      ```markdown
      You are the Team Leader.
      Read the `implementation-plan.md`.
      Decompose the plan into **Atomic Tasks**.
      Group these tasks into **Batches** (3-5 tasks per batch) based on dependencies and developer type (Backend vs Frontend).

      Create `task-tracking/TASK_ID/tasks.md` with the following structure:

      # Development Tasks - TASK_ID

      ## Batch 1: [Batch Name] (PENDING)

      **Assigned To**: [backend-developer | frontend-developer]

      ### Task 1.1: [Task Name] (PENDING)

      - **File**: [Absolute Path]
      - **Description**: [Brief description]
      - **Verification**: [How to verify]

      ### Task 1.2: ...

      ## Batch 2: ...

      **CRITICAL**:

      - Ensure tasks are atomic (one file or closely related files).
      - Ensure dependencies are respected (Task 1.1 must be done before 1.2 if dependent).
      - All tasks start as PENDING.
      ```

## Completion

**Message**:

> "Phase 2 Complete.
> Tasks have been decomposed and batched in `tasks.md`.
>
> Please run the following command to start Execution:
> `/phase-3-execution TASK_ID`"
