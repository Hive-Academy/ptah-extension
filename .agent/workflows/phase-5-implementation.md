---
description: Phase 5 - Implementation (Developers)
---

# Phase 5: Implementation

This workflow implements the assigned batch using **Backend Developer** or **Frontend Developer** agent personas.

## Step 1: Identify Developer Type

1. **Read** `task-tracking/TASK_ID/tasks.md`
2. **Find** the batch marked `🔄 IN PROGRESS - Assigned to [developer-type]`
3. **Note** which developer type is assigned

## Step 2: Adopt Developer Persona

**CRITICAL**: Read and adopt the correct developer persona.

**If Backend Developer**:

- **Read**: `d:\projects\nestjs-ai-saas-starter\.claude\agents\backend-developer.md`
- **You are now**: Backend Developer

**If Frontend Developer**:

- **Read**: `d:\projects\nestjs-ai-saas-starter\.claude\agents\frontend-developer.md`
- **You are now**: Frontend Developer

3.  **Persona Verification**:
    - **INSTRUCTION**: You MUST start your response by stating:
      > "I am the [Backend/Frontend] Developer. I have read `[agent-file].md` and I am ready to execute with strict adherence to Real Implementation Mandate."

## Step 3: Read Requirements

1. **Read** the current `IN PROGRESS` batch in `tasks.md`
2. **Read** `implementation-plan.md` (reference for specifications)
3. **If UI/UX work**: Read design specifications

## Step 4: Implement Batch

**Execute ALL tasks in the batch IN ORDER**:

1. For each task in the batch:

   - Read file path and description
   - Implement the code
   - Stage with `git add [files]`

2. **Quality Standards** (from agent file):

   - ✅ Real, production-ready code (NO stubs)
   - ✅ Full stack integration
   - ✅ Type-safe (no `any` types)
   - ✅ Follow existing patterns

3. **Create ONE commit** for entire batch:

   ```bash
   git commit -m "type(scope): batch [N] - description

   - Task X.1: [description]
   - Task X.2: [description]
   - Task X.3: [description]"
   ```

## Intelligent Routing

**After Implementation**:

1. **Verify** commit was created (check `git log --oneline -1`)
2. **Provide Next Command**:

**Output**:

> "✅ Batch [N] Implemented
>
> **Commit**: [SHA] > **Files Changed**: [Count] > **Tasks Completed**: [Count]
>
> **Next Command**:
>
> ````
> /phase-6-verification TASK_ID
> ```"
> ````
