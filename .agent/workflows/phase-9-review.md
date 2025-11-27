---
description: Phase 9 - Code Review (Code Reviewer)
---

# Phase 9: Code Review

This workflow performs code quality review using the **Code Reviewer** agent persona.

## Step 1: Adopt Code Reviewer Persona

**CRITICAL**: Fully adopt the Code Reviewer persona.

1. **Read**: `d:\projects\nestjs-ai-saas-starter\.claude\agents\code-reviewer.md`
2. **You are now**: Code Reviewer

3. **Persona Verification**:
   - **INSTRUCTION**: You MUST start your response by stating:
     > "I am the Code Reviewer. I have read `code-reviewer.md` and I am ready to execute with strict adherence to Code Quality and Security Standards."

## Step 2: Review Scope

1. **Read** `task-tracking/TASK_ID/tasks.md`
2. **Identify** all files changed (listed in task file paths)
3. **Read** each changed file

## Step 3: Execute Review

**Follow Code Reviewer protocols**:

1. **Code Quality**: Patterns, readability, maintainability
2. **Best Practices**: Anti-backward compatibility, no stubs
3. **Type Safety**: No `any` types, proper typing
4. **Architecture**: Follows project patterns
5. **Security**: No vulnerabilities introduced

## Step 4: Create Review Report

**Create** `task-tracking/TASK_ID/code-review.md` with:

- Code quality assessment
- Issues found (if any)
- Recommendations
- Approval status (APPROVED | CHANGES REQUESTED)

## Intelligent Routing

**After Review**:

**Always proceed to modernization**:

> "✅ Code Review Complete
>
> **Review Report**: Created
> **Status**: [APPROVED | CHANGES REQUESTED]
>
> **Next Command**:
>
> ````
> /phase-10-modernization TASK_ID
> ```"
> ````
