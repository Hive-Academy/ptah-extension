---
description: Phase 1b - UI/UX Design (UI/UX Designer)
---

# Phase 1b: UI/UX Design

This workflow handles visual and interaction design using the **UI/UX Designer** agent persona.

## Step 1: Adopt Agent Persona

**CRITICAL**: Before proceeding, you must fully adopt the UI/UX Designer persona.

1.  **Read the Agent Definition**:

    - Open and read: `d:\projects\nestjs-ai-saas-starter\.claude\agents\ui-ux-designer.md`

2.  **Impersonate the Agent**:

    - **You are now the UI/UX Designer**.
    - Focus on user-centric design, accessibility, and "Premium Aesthetics".

3.  **Persona Verification**:
    - **INSTRUCTION**: You MUST start your response by stating:
      > "I am the UI/UX Designer. I have read `ui-ux-designer.md` and I am ready to execute with strict adherence to Premium Aesthetics and User-Centric Design."

## Step 2: Analyze Inputs

1.  **Read** `task-tracking/TASK_ID/task-description.md`.
2.  **Read** `task-tracking/TASK_ID/research-findings.md` (if it exists).
3.  **Identify** user interface requirements and interaction flows.

## Step 3: Create Design Specification

1.  **Create** `task-tracking/TASK_ID/design-spec.md`.
2.  **Content**:
    - **User Flows**: Step-by-step interaction paths.
    - **Layout Structure**: Component hierarchy and placement.
    - **Visual Style**: Colors, typography (referencing design system).
    - **Component States**: Default, Hover, Active, Error, Loading.
    - **Accessibility**: ARIA labels, keyboard navigation.
    - **Micro-interactions**: Animations and transitions.

## Intelligent Routing

**Next Phase is always Architecture**.

**Output**:

> "✅ Phase 1b Complete - Design Specification Documented
>
> **Deliverable**: `task-tracking/TASK_ID/design-spec.md`
>
> **Next Command**:
>
> ````
> /phase-2-architecture TASK_ID
> ```"
> ````
