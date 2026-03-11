# TASK_2025_135: Prompt Harness System

## User Intent

Design and implement a "Prompt Harness" system that allows full system prompt customization with user-configurable power-ups. The system preserves Anthropic's Claude Code prompt as an immutable foundation while enabling layered enhancements.

## Original Request

> "actually i do like the idea of having a full prompt customization options and allow users to change as well and include our own harness that we need to make a new task about utilizing our orchestration skills (so basically i want you to intelligently check our main CLAUDE.md file and our @.claude/agents\ to come up with some power ups that elevate on the provided system prompt by Claude Code) we need to make this architecturally sounds so we can have iterations and more importantly don't loose what Anthropic have done already with their original prompt beside all of that we already have a way to append some system prompts enhancements and specially the MCP server premium feature enhancements all of these if they went through a proper workflow for generating our own prompt harness would be a killer"

## Strategy

**Type**: FEATURE
**Complexity**: Complex (>8h) - Multi-layer architecture with UI, backend, persistence
**Flow**: PM -> Research -> Architect -> Team-Leader -> QA

## Key Requirements

1. **Preserve Anthropic's Foundation**

   - Keep Claude Code's original system prompt as immutable base layer
   - Reference at: `docs/claude-code-system-prompt.md` (already extracted)
   - Never modify base - only layer on top

2. **Layer Architecture**

   - Base Layer: Anthropic's `claude_code` preset (read-only reference)
   - Project Layer: CLAUDE.md instructions (already working)
   - Agent Layer: Power-ups from `.claude/agents/` definitions
   - User Layer: Custom user prompt modifications
   - Premium Layer: MCP server feature enhancements

3. **Power-Up System**

   - Analyze existing `.claude/agents/` and `CLAUDE.md`
   - Extract reusable "power-ups" that enhance the base prompt
   - Intelligent recommendations based on project type

4. **User Customization UI**

   - Enable/disable power-ups
   - Add custom prompt sections
   - Preview assembled prompt
   - Save/load configurations

5. **Integration Points**

   - Connect with existing append functionality in `sdk-query-options-builder.ts`
   - Premium gating for advanced features
   - Persist settings via VS Code configuration or SecretStorage

6. **Iteration Support**
   - Design for easy updates when Anthropic changes their base prompt
   - Versioning of user customizations
   - Migration path for prompt changes

## Files to Research

- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` - Current prompt building
- `CLAUDE.md` - Project-level instructions
- `.claude/agents/` - Agent definitions with potential power-ups
- `docs/claude-code-system-prompt.md` - Extracted base prompt
- MCP server premium feature integration
- Existing append system mechanics

## Dependencies

- TASK_2025_108 (Premium Feature Enforcement) - For premium gating patterns
- Existing SDK integration (TASK_2025_088)

## Created

2026-02-03 by orchestrator
