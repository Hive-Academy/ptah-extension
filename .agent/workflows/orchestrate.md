---
description: Main entry point for the orchestration workflow. Routes to specific phases based on task status.
---

# Orchestration Router

This workflow acts as the central router for the development process. It analyzes the current state of the task and directs you to the appropriate phase.

## Step 1: Determine Context

1.  **Analyze the Input**:

    - Is the user asking to start a **NEW** task? (e.g., "Implement feature X", "Fix bug Y")
    - Is the user asking to **CONTINUE** an existing task? (e.g., "TASK_2025_001", "Continue working on...")

2.  **If NEW Task**:

    - **Action**: Initialize the task.
    - **Procedure**:
      1.  Read `task-tracking/registry.md` to find the next available `TASK_ID` (increment the highest number).
      2.  Create a new directory: `task-tracking/TASK_ID/`.
      3.  Create `task-tracking/TASK_ID/context.md` with:
          - User Intent (the original request)
          - Task Type (Feature, Bugfix, Refactor, etc.)
          - Creation Date
      4.  Update `task-tracking/registry.md` with the new task and status "Active (Planning)".
    - **Next Step**: Proceed to **Step 2 (Routing)** with the new `TASK_ID`.

3.  **If CONTINUATION**:
    - **Action**: Identify the `TASK_ID` from the user's request.
    - **Procedure**:
      1.  Verify `task-tracking/TASK_ID/context.md` exists.
    - **Next Step**: Proceed to **Step 2 (Routing)**.

## Step 2: Intelligent Routing

Analyze the contents of the `task-tracking/TASK_ID/` directory to determine the next phase.

**Phase Detection Logic**:

1. **Read Directory Contents**: Check which files exist in `task-tracking/TASK_ID/`
2. **Read `task-description.md`** (if exists): Check "Workflow Dependencies" section for "Research Needed: Yes" or "UI/UX Design Needed: Yes"
3. **Analyze State**: Determine current phase based on file existence and content
4. **Provide Command**: Give exact command for next phase

**Routing Table**:

| Condition                                                                    | Current Phase                        | Target Workflow  | Command                           |
| :--------------------------------------------------------------------------- | :----------------------------------- | :--------------- | :-------------------------------- |
| `task-description.md` is MISSING                                             | Initialization                       | Requirements     | `/phase-1-requirements TASK_ID`   |
| `task-description.md` has "Research: Yes" AND `research-findings.md` MISSING | Requirements Done                    | Research         | `/phase-1-research TASK_ID`       |
| `task-description.md` has "UI/UX: Yes" AND `design-spec.md` MISSING          | Req/Research Done                    | UI/UX Design     | `/phase-1-design TASK_ID`         |
| `implementation-plan.md` is MISSING                                          | Pre-Arch Done                        | Architecture     | `/phase-2-architecture TASK_ID`   |
| `tasks.md` is MISSING                                                        | Architecture Done                    | Decomposition    | `/phase-3-decomposition TASK_ID`  |
| `tasks.md` exists, has PENDING batches                                       | Decomposition Done or Batch Complete | Batch Assignment | `/phase-4-assignment TASK_ID`     |
| `tasks.md` latest batch is IN PROGRESS                                       | Batch Assigned                       | Implementation   | `/phase-5-implementation TASK_ID` |
| `tasks.md` latest batch shows COMPLETE (verified), more PENDING exist        | Batch Verified                       | Next Assignment  | `/phase-4-assignment TASK_ID`     |
| `tasks.md` all batches COMPLETE                                              | All Development Done                 | Final Completion | `/phase-7-completion TASK_ID`     |
| `future-enhancements.md` exists                                              | Workflow Complete                    | -                | Task Complete ✅                  |

## Step 3: Execution

**INSTRUCTION**: Based on the table above, read the task directory and explicitly tell the user which workflow to run next.

**Example Output**:

> "📍 Task `TASK_2025_005` Status Analysis
>
> ✅ `task-description.md` exists (Flags: Research=No, UI/UX=Yes)
> ❌ `design-spec.md` missing
>
> **Current Phase**: UI/UX Design
>
> **Next Command**:
>
> ````
> /phase-1-design TASK_2025_005
> ```"
> ````
