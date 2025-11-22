---
description: Phase 1 of the orchestration workflow. Handles requirements gathering (Project Manager) and technical design (Software Architect).
---

# Phase 1: Planning & Architecture

This workflow executes the planning phase, moving from user intent to a validated implementation plan.

## Step 1: Requirements Gathering (Project Manager)

**Condition**: If `task-tracking/TASK_ID/task-description.md` already exists, skip to **Step 2**.

1.  **Action**: Generate Requirements.
2.  **Instructions**:

    - Read `task-tracking/TASK_ID/context.md` to understand the user's request.
    - Act as the **Project Manager**.
    - Create `task-tracking/TASK_ID/task-description.md`.
    - **Prompt**:

      ```markdown
      You are the Project Manager.
      Read the user intent in `task-tracking/TASK_ID/context.md`.
      Create a comprehensive `task-description.md` that includes:

      1.  **User Story**: What is the user trying to achieve?
      2.  **Requirements**: Detailed functional and non-functional requirements.
      3.  **Acceptance Criteria**: Clear, testable criteria for success.
      4.  **Risks & Assumptions**: Any potential pitfalls.

      Ensure the file is saved to `task-tracking/TASK_ID/task-description.md`.
      ```

3.  **User Validation**:
    - **STOP**. Ask the user to review `task-tracking/TASK_ID/task-description.md`.
    - **Command**: `notify_user` (or equivalent manual check).
    - **Message**: "Please review the `task-description.md`. Is it accurate?"
    - **If Approved**: Proceed to **Step 2**.
    - **If Changes Needed**: Edit the file and repeat validation.

## Step 2: Technical Architecture (Software Architect)

**Condition**: If `task-tracking/TASK_ID/implementation-plan.md` already exists, skip to **Completion**.

1.  **Action**: Generate Implementation Plan.
2.  **Instructions**:

    - Read `task-tracking/TASK_ID/task-description.md`.
    - Act as the **Software Architect**.
    - Create `task-tracking/TASK_ID/implementation-plan.md`.
    - **Prompt**:

      ```markdown
      You are the Software Architect.
      Read the requirements in `task-tracking/TASK_ID/task-description.md`.
      Create a detailed `implementation-plan.md` that includes:

      1.  **Goal**: Brief summary.
      2.  **Proposed Changes**:
          - List every file that needs to be created or modified.
          - Group by component/layer.
          - Provide a brief description of the change for each file.
      3.  **Verification Plan**: How will we verify these changes?

      **CRITICAL**:

      - Do NOT use stubs. Plan for real implementation.
      - Follow the project's architecture (NestJS, Nx, etc.).
      - Ensure backward compatibility is NOT a constraint (modernize freely).

      Ensure the file is saved to `task-tracking/TASK_ID/implementation-plan.md`.
      ```

3.  **User Validation**:
    - **STOP**. Ask the user to review `task-tracking/TASK_ID/implementation-plan.md`.
    - **Message**: "Please review the `implementation-plan.md`. Does this look correct?"
    - **If Approved**: Proceed to **Completion**.

## Completion

**Message**:

> "Phase 1 Complete.
> Requirements and Architecture are validated.
>
> Please run the following command to proceed to Decomposition:
> `/phase-2-decomposition TASK_ID`"
