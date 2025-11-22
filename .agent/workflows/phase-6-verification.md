---
description: Phase 6 - Verification (Team Leader Mode 2)
---

# Phase 6: Batch Verification

This workflow verifies batch completion using the **Team Leader** agent persona in **MODE 2 (VERIFICATION)**.

## Step 1: Adopt Team Leader Persona

**CRITICAL**: Re-adopt the Team Leader persona.

1. **Read**: `d:\projects\nestjs-ai-saas-starter\.claude\agents\team-leader.md`
2. **Focus on**: MODE 2 - VERIFICATION section
3. **You are now**: Team Leader in Verification Mode

4. **Persona Verification**:
   - **INSTRUCTION**: You MUST start your response by stating:
     > "I am the Team Leader (Verification Mode). I have read `team-leader.md` and I am ready to execute with strict adherence to Strict Verification Standards."

## Step 2: Verify Batch

**Check all verification requirements**:

1. **Git Commit**:

   ```bash
   git log --oneline -1
   ```

   - ✅ Commit exists
   - ✅ Message references batch tasks

2. **Files Exist**:

   - Read each file path from batch tasks
   - ✅ All files exist and contain expected code

3. **Build Check** (optional but recommended):
   ```bash
   npx nx build [project-name]
   ```
   - ✅ Build passes

## Step 3: Update Task State

1. **Update** `task-tracking/TASK_ID/tasks.md`:
   - Mark all tasks in batch as `✅ COMPLETE`
   - Mark batch as `✅ COMPLETE`
   - Add git commit SHA to batch header

## Intelligent Routing

**Analyze Remaining Work**:

1. **Read** `tasks.md` again
2. **Count** batches with status `⏸️ PENDING`

**If MORE batches remain** (count > 0):

> "✅ Batch [N] Verified and Complete
>
> **Verification Results**:
>
> - Git Commit: ✅ [SHA]
> - Files: ✅ All [count] files exist
> - Build: ✅ Passing
>
> **Remaining Batches**: [count]
>
> **Next Command**:
>
> ````
> /phase-4-assignment TASK_ID
> ```"
> ````

**If ALL batches complete** (count = 0):

> "🎉 All Batches Verified and Complete!
>
> **Summary**:
>
> - Total Batches: [N] (all ✅)
> - Total Tasks: [M] (all ✅)
> - All Git Commits: Verified
>
> **Next Command**:
>
> ````
> /phase-7-completion TASK_ID
> ```"
> ````
