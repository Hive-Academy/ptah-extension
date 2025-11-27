---
description: Phase 4 - Iterative Execution (Team Leader Mode 2 & Developers)
---

# Phase 4: Iterative Execution

This workflow executes development tasks one batch at a time using **Team Leader** (Mode 2) and **Developer** agent personas.

## Step 1: Team Leader - Batch Assignment

### Adopt Team Leader Persona

**CRITICAL**: Before proceeding, adopt the Team Leader persona.

1.  **Read the Agent Definition**:

    - Open and read: `d:\projects\nestjs-ai-saas-starter\.claude\agents\team-leader.md`
    - Focus on **MODE 2: BATCH ASSIGNMENT** section.

2.  **Impersonate the Agent**:
    - **You are now the Team Leader in MODE 2 (ASSIGNMENT)**.
    - Your role: Identify next pending batch and assign it.

### Identify Next Batch

1.  **Read** `task-tracking/TASK_ID/tasks.md`.
2.  **Find** the first batch that is:

    - NOT marked `✅ COMPLETE`
    - Either `⏸️ PENDING` or `🔄 IN PROGRESS`

3.  **If PENDING**:

    - Mark batch as `🔄 IN PROGRESS`.
    - Mark all tasks in batch as `🔄 IN PROGRESS`.
    - Note the assigned developer type (backend-developer or frontend-developer).

4.  **If IN PROGRESS**:
    - This is a resumed batch (previous run interrupted).
    - Continue with the assigned developer.

## Step 2: Developer - Implementation

### Adopt Developer Persona

**CRITICAL**: Before proceeding, adopt the assigned Developer persona.

1.  **Read the Agent Definition**:

    - **If Backend**: Read `d:\projects\nestjs-ai-saas-starter\.claude\agents\backend-developer.md`
    - **If Frontend**: Read `d:\projects\nestjs-ai-saas-starter\.claude\agents\frontend-developer.md`

2.  **Impersonate the Agent**:
    - **You are now the assigned Developer**.
    - Follow ALL coding standards and patterns from your agent file.

### Execute Batch Tasks

1.  **Read** the current `IN PROGRESS` batch in `tasks.md`.
2.  **Read** referenced specification files (implementation-plan.md, design specs if UI).
3.  **Execute ALL tasks in the batch IN ORDER**:

    - Implement Task 1.1 → `git add [files]`
    - Implement Task 1.2 → `git add [files]`
    - Implement Task 1.3 → `git add [files]`
    - ... continue for all tasks in batch

4.  **Quality Standards**:

    - ✅ Real, production-ready code (NO stubs)
    - ✅ Full stack integration
    - ✅ Type safety (no `any` types)
    - ✅ Follow project patterns

5.  **Create ONE commit for entire batch**:

    ```bash
    git commit -m "type(scope): batch [N] - description

    - Task 1.1: [description]
    - Task 1.2: [description]
    - Task 1.3: [description]"
    ```

## Step 3: Team Leader - Verification

### Re-adopt Team Leader Persona

1.  **Read** `d:\projects\nestjs-ai-saas-starter\.claude\agents\team-leader.md` again.
2.  **You are now Team Leader in MODE 2 (VERIFICATION)**.

### Verify Batch

1.  **Check Git Commit**:

    ```bash
    git log --oneline -1
    ```

    - Verify commit exists with expected message.

2.  **Check Files Exist**:

    - Read each file path from the batch tasks.
    - Verify files exist and contain expected code.

3.  **Check Build** (optional but recommended):

    ```bash
    npx nx build [project-name]
    ```

4.  **Update tasks.md**:
    - Mark all tasks in batch as `✅ COMPLETE`.
    - Mark batch as `✅ COMPLETE`.
    - Add git commit SHA to batch header.

## Step 4: Loop Control

1.  **Read** `task-tracking/TASK_ID/tasks.md`.
2.  **Check** for remaining batches:

**If MORE batches remain (any `⏸️ PENDING` batches exist)**:

> "✅ Batch [N] Complete - Verified
>
> **Remaining Batches**: [M]
>
> **Next Step**: Please run the following command to execute the next batch:
> `/phase-4-execution TASK_ID`"

**If ALL batches complete (all show `✅ COMPLETE`)**:

> "🎉 All Batches Complete!
>
> **Total Batches**: [B] (all verified)
> **Total Tasks**: [N] (all complete)
>
> **Next Step**: Please run the following command to finalize:
> `/phase-5-completion TASK_ID`"
