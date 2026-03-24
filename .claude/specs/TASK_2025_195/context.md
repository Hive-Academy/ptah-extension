# TASK_2025_195: Add Orchestration Workflow to PTAH_CORE_SYSTEM_PROMPT

## User Request

Add orchestration workflow instructions to `PTAH_CORE_SYSTEM_PROMPT` so the AI agent inside the Ptah extension follows orchestration-like workflows when end users ask it to do implementation tasks.

## Task Type: FEATURE

## Complexity: Medium

## Workflow: Partial (Architect → Developer → QA)

## Context

- `PTAH_CORE_SYSTEM_PROMPT` is in `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts`
- The extension's AI agent uses `claude_code` preset which includes Task tool with subagent types
- Available subagent types: backend-developer, frontend-developer, software-architect, senior-tester, code-style-reviewer, code-logic-reviewer, researcher-expert, devops-engineer, project-manager, team-leader, ui-ux-designer, technical-content-writer, modernization-detector
- Current token budget: ~2,500-3,000 tokens
- Need to add a condensed orchestration section (~500-800 tokens)

## Key Design Decisions

1. Adapt orchestration concepts for end-user context (not internal dev workflow)
2. Keep within token budget - condensed version of the full SKILL.md
3. Use Task tool with subagent_type for delegation
4. Define task type detection and workflow depth selection
5. Include validation checkpoints concept
