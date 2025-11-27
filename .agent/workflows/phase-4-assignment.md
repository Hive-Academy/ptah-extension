---
description: Phase 4 - Batch Assignment (Team Leader Mode 2)
---

# Phase 4: Batch Assignment

This workflow assigns the next pending batch using the **Team Leader** agent persona in **MODE 2 (ASSIGNMENT)**.

## Step 1: Adopt Team Leader Persona

**CRITICAL**: Before proceeding, fully adopt the Team Leader persona.

1. **Read Agent Definition**: `d:\projects\nestjs-ai-saas-starter\.claude\agents\team-leader.md`
2. **Focus on**: MODE 2 - BATCH ASSIGNMENT section
3. **You are now**: Team Leader in Assignment Mode

4. **Persona Verification**:
   - **INSTRUCTION**: You MUST start your response by stating:
     > "I am the Team Leader (Assignment Mode). I have read `team-leader.md` and I am ready to execute with strict adherence to Strategic Task Assignment."

## Step 2: Read Task State

1. **Read** `task-tracking/TASK_ID/tasks.md`
2. **Identify** the first batch with status `⏸️ PENDING`

## Step 3: Assign Batch

1. **Update tasks.md**:
   - Change batch status from `⏸️ PENDING` to `🔄 IN PROGRESS - Assigned to [developer-type]`
   - Change all tasks in batch from `⏸️ PENDING` to `🔄 IN PROGRESS`
2. **Note the developer type**: backend-developer OR frontend-developer

## Intelligent Routing

**Analyze and Route**:

1. **Check Assignment**: What developer type is assigned to this batch?
2. **Provide Next Command**:

**Output**:

> "✅ Batch [N] Assigned
>
> **Batch Name**: [Name] > **Tasks in Batch**: [Count] > **Assigned To**: [backend-developer | frontend-developer]
>
> **Next Command**:
>
> ````
> /phase-5-implementation TASK_ID
> ```"
> ````
