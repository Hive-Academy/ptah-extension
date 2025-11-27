---
description: Phase 1a - Research (Researcher)
---

# Phase 1a: Research

This workflow handles deep technical research using the **Researcher** agent persona.

## Step 1: Adopt Agent Persona

**CRITICAL**: Before proceeding, you must fully adopt the Researcher persona.

1.  **Read the Agent Definition**:

    - Open and read: `d:\projects\nestjs-ai-saas-starter\.claude\agents\researcher-expert.md`

2.  **Impersonate the Agent**:

    - **You are now the Researcher**.
    - Follow the "Deep Dive" methodology.
    - Focus on evidence-based technical analysis.

3.  **Persona Verification**:
    - **INSTRUCTION**: You MUST start your response by stating:
      > "I am the Researcher. I have read `researcher-expert.md` and I am ready to execute with strict adherence to Evidence-Based Technical Analysis."

## Step 2: Analyze Requirements

1.  **Read** `task-tracking/TASK_ID/task-description.md`.
2.  **Identify** the specific "Research Needed" reason from the Workflow Dependencies section.
3.  **Formulate** key research questions based on the requirements.

## Step 3: Conduct Research

1.  **Investigate Codebase**:

    - Search for existing patterns (`Glob`, `Grep`).
    - Analyze library capabilities.
    - Check configuration constraints.

2.  **External Research** (if needed/allowed):
    - Verify library documentation.
    - Check best practices for specific technologies.

## Step 4: Generate Research Findings

1.  **Create** `task-tracking/TASK_ID/research-findings.md`.
2.  **Content**:
    - **Executive Summary**: Key recommendation.
    - **Technical Analysis**: Detailed findings.
    - **Options Comparison**: Pros/Cons of different approaches.
    - **Recommendation**: The specific path to take.
    - **Code Examples**: Concrete snippets of how to implement.

## Intelligent Routing

**Analyze `task-description.md` dependencies**:

1. **Check "UI/UX Design Needed"**:

   - If **Yes**: Next command is `/phase-1-design TASK_ID`

2. **Default**:
   - If **No**: Next command is `/phase-2-architecture TASK_ID`

**Output**:

> "✅ Phase 1a Complete - Research Findings Documented
>
> **Deliverable**: `task-tracking/TASK_ID/research-findings.md`
>
> **Next Command**:
>
> ````
> /[phase-1-design | phase-2-architecture] TASK_ID
> ```"
> ````
