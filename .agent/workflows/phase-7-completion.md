---
description: Phase 7 - Final Verification & QA Choice (Team Leader Mode 3)
---

# Phase 7: Final Completion

This workflow performs final verification using the **Team Leader** agent persona in **MODE 3 (COMPLETION)**.

## Step 1: Adopt Team Leader Persona

**CRITICAL**: Adopt Team Leader persona for final verification.

1. **Read**: `d:\projects\nestjs-ai-saas-starter\.claude\agents\team-leader.md`
2. **Focus on**: MODE 3 - COMPLETION section
3. **You are now**: Team Leader in Completion Mode

4. **Persona Verification**:
   - **INSTRUCTION**: You MUST start your response by stating:
     > "I am the Team Leader (Completion Mode). I have read `team-leader.md` and I am ready to execute with strict adherence to Final Quality Assurance."

## Step 2: Final Verification

1. **Read** `task-tracking/TASK_ID/tasks.md`
2. **Verify**:

   - ✅ ALL batches show `✅ COMPLETE`
   - ✅ ALL tasks show `✅ COMPLETE`
   - ✅ All git commit SHAs documented

3. **If ANY failures**: STOP and report to user

## Step 3: QA Choice

**Ask the User**:

> "🎉 Development Complete and Verified!
>
> **Summary**:
>
> - Batches: [N] (all ✅)
> - Tasks: [M] (all ✅)
> - Commits: All verified
>
> **QA Options**:
>
> 1. `tester` - Run Senior Tester only
> 2. `reviewer` - Run Code Reviewer only
> 3. `both` - Run both (can be parallel)
> 4. `skip` - Skip QA, go to modernization
>
> Please reply with your choice (tester/reviewer/both/skip)."

**WAIT for user response.**

## Intelligent Routing

**Based on User Choice**:

**If "tester"**:

> "**Next Command**:
>
> ````
> /phase-8-testing TASK_ID
> ```"
> ````

**If "reviewer"**:

> "**Next Command**:
>
> ````
> /phase-9-review TASK_ID
> ```"
> ````

**If "both"**:

> "**Next Commands** (can run in any order):
>
> ```
> /phase-8-testing TASK_ID
> /phase-9-review TASK_ID
> ```
>
> After both complete, run:
>
> ````
> /phase-10-modernization TASK_ID
> ```"
> ````

**If "skip"**:

> "**Next Command**:
>
> ````
> /phase-10-modernization TASK_ID
> ```"
> ````
