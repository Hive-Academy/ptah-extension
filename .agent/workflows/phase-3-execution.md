---
description: Phase 3 of the orchestration workflow. Handles iterative development (Team Leader Mode 2 & Developers).
---

# Phase 3: Execution

This workflow executes the development tasks one batch at a time.

## Step 1: Batch Assignment (Team Leader)

1.  **Action**: Identify and Assign Batch.
2.  **Instructions**:
    - Read `task-tracking/TASK_ID/tasks.md`.
    - Find the first Batch that is **NOT** marked `COMPLETE`.
    - **If the batch is PENDING**:
      - Mark it as `IN PROGRESS`.
      - Identify the assigned developer type (e.g., `backend-developer`).
    - **If the batch is IN PROGRESS**:
      - It means a previous run failed or was interrupted. Resume it.

## Step 2: Implementation (Developer)

1.  **Action**: Write Code.
2.  **Instructions**:

    - Act as the **Assigned Developer** (Backend or Frontend) for the current Batch.
    - **Prompt**:

      ```markdown
      You are the Assigned Developer.
      Read `task-tracking/TASK_ID/tasks.md`.
      Identify the current `IN PROGRESS` batch.

      **Execute the tasks in this batch**:

      1.  Read the file paths and descriptions.
      2.  Implement the changes.
      3.  **CRITICAL**: Ensure the code is real, production-ready, and compiles.
      4.  **CRITICAL**: Do NOT use stubs.

      After implementation:

      - Verify the files exist.
      - Verify the build passes (if applicable).
      ```

## Step 3: Verification (Team Leader)

1.  **Action**: Verify and Commit.
2.  **Instructions**:

    - Act as the **Team Leader**.
    - Verify the work done in Step 2.
    - **Prompt**:

      ```markdown
      You are the Team Leader.
      Verify the current `IN PROGRESS` batch.

      1.  **Check Files**: Do the files exist?
      2.  **Check Content**: Does the code look correct?
      3.  **Check Build**: (Optional) Run a build check if possible.

      **If Verified**:

      - Update `task-tracking/TASK_ID/tasks.md`:
        - Mark all tasks in the batch as `COMPLETE`.
        - Mark the batch as `COMPLETE`.

      **If Failed**:

      - Fix the issues immediately (invoke Developer again) or mark as FAILED and stop.
      ```

## Step 4: Loop Control

1.  **Action**: Check for remaining batches.
2.  **Instructions**:
    - Read `task-tracking/TASK_ID/tasks.md`.
    - Are there any remaining `PENDING` batches?
    - **YES**:
      - **Message**:
        > "Batch Complete.
        > There are more batches remaining.
        >
        > Please run the following command to execute the next batch:
        > `/phase-3-execution TASK_ID`"
    - **NO**:
      - **Message**:
        > "All Batches Complete!
        >
        > Please run the following command to finalize the task:
        > `/phase-4-completion TASK_ID`"
