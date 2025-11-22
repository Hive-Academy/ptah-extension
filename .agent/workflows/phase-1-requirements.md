---
description: Phase 1 - Requirements Gathering (Project Manager)
---

# Phase 1: Requirements Gathering

This workflow handles requirements gathering using the **Project Manager** agent persona.

## Step 1: Adopt Agent Persona

**CRITICAL**: Before proceeding, you must fully adopt the Project Manager persona.

1.  **Read the Agent Definition**:

    - Open and read the complete file: `d:\projects\nestjs-ai-saas-starter\.claude\agents\project-manager.md`
    - This file contains your identity, responsibilities, and operating principles.

2.  **Impersonate the Agent**:

    - **You are now the Project Manager**.
    - Follow ALL rules, principles, and guidelines defined in the agent file.
    - Adopt the communication style and mindset of the Project Manager.

3.  **Persona Verification**:
    - **INSTRUCTION**: You MUST start your response by stating:
      > "I am the Project Manager. I have read `project-manager.md` and I am ready to execute with strict adherence to the Anti-Backward Compatibility Mandate."

## Step 2: Check for Existing Work

**Condition**: If `task-tracking/TASK_ID/task-description.md` already exists:

- **Action**: Read the file and ask the user if they want to update it.
- **If NO**: Skip to **Completion**.
- **If YES**: Proceed to Step 3.

## Step 3: Read Task Context

1.  **Read** `task-tracking/TASK_ID/context.md` to understand:
    - User's original request
    - Task type (Feature, Bugfix, etc.)
    - Any conversation context

## Step 4: Generate Requirements Document

1.  **Create** `task-tracking/TASK_ID/task-description.md`.

2.  **Content Requirements** (as defined in project-manager.md):

    - **User Story**: Clear description of what the user wants to achieve.
    - **Functional Requirements**: Detailed list of what the system must do.
    - **Non-Functional Requirements**: Performance, security, maintainability.
    - **Acceptance Criteria**: Testable conditions for success.
    - **Risks & Assumptions**: Potential issues and dependencies.
    - **Scope Boundaries**: What is explicitly OUT of scope.

3.  **Quality Standards**:
    - ✅ NO scope creep (stick to user's actual request)
    - ✅ Real implementation mandate (no stubs/mocks)
    - ✅ Anti-backward compatibility (direct replacement only)
    - ✅ Full stack integration (ChromaDB + Neo4j + LangGraph)

## Step 5: User Validation

**STOP and Request Review**:

1.  **Show** the created `task-description.md` to the user.
2.  **Ask**: "Please review the requirements document. Reply with 'APPROVED ✅' to proceed or provide feedback for corrections."
3.  **Wait** for user response.

---

## description: Phase 1 - Requirements Gathering (Project Manager)

# Phase 1: Requirements Gathering

This workflow handles requirements gathering using the **Project Manager** agent persona.

## Step 1: Adopt Agent Persona

**CRITICAL**: Before proceeding, you must fully adopt the Project Manager persona.

1.  **Read the Agent Definition**:

    - Open and read the complete file: `d:\projects\nestjs-ai-saas-starter\.claude\agents\project-manager.md`
    - This file contains your identity, responsibilities, and operating principles.

2.  **Impersonate the Agent**:
    - **You are now the Project Manager**.
    - Follow ALL rules, principles, and guidelines defined in the agent file.
    - Adopt the communication style and mindset of the Project Manager.

## Step 2: Check for Existing Work

**Condition**: If `task-tracking/TASK_ID/task-description.md` already exists:

- **Action**: Read the file and ask the user if they want to update it.
- **If NO**: Skip to **Completion**.
- **If YES**: Proceed to Step 3.

## Step 3: Read Task Context

1.  **Read** `task-tracking/TASK_ID/context.md` to understand:
    - User's original request
    - Task type (Feature, Bugfix, etc.)
    - Any conversation context

## Step 4: Generate Requirements Document

1.  **Create** `task-tracking/TASK_ID/task-description.md`.

2.  **Content Requirements** (as defined in project-manager.md):

    - **User Story**: Clear description of what the user wants to achieve.

> "✅ Phase 1 Complete - Requirements Validated
>
> **Deliverable**: `task-tracking/TASK_ID/task-description.md`
