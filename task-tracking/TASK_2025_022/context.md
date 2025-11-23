# Task Context for TASK_2025_022

## User Intent

Create comprehensive documentation and architectural guidance on best practices for preserving the extension's real-time GUI capabilities (thinking state, tool execution, agent tracking, etc.) during the RPC migration (TASK_2025_021).

**Key Requirements**:

- Document the correct message-centric architecture (tools, thinking, agents are content blocks, not separate events)
- Provide streaming best practices to maintain real-time UX (word-by-word typing effect)
- Clarify the distinction between parser output (already correct) vs integration layer (needs simple postMessage forwarding)
- Show how to render unified messages with all content blocks in single component
- Prevent over-engineering (no complex event splitting like old EventBus did)

## Conversation Summary

**Context from Previous Discussion**:

- User correctly identified that EventBus was fundamentally wrong for splitting unified messages into separate events
- Tools, thinking, MCPs, agents are ALL content blocks within messages (not separate event types)
- Claude CLI sends complete message structure with content blocks array
- JSONLStreamParser already preserves this structure (lines 355-363 show tool_use blocks preserved in content array)
- RPC migration (TASK_2025_021) has a streaming gap - needs simple postMessage forwarding, not complex event system
- Solution is much simpler than initially proposed: Direct callback forwarding to frontend

**Technical Insights**:

- Claude CLI outputs two formats:
  1. Real-time streaming (stdout with `--output-format stream-json --include-partial-messages`)
  2. Session file (.jsonl format with complete message objects)
- Frontend can read .jsonl files for historical messages (RPC plan already has this)
- Frontend needs streaming message chunks for real-time UX (missing in current RPC plan)
- Parser callbacks should be forwarded as-is, not transformed/split

**User's Core Philosophy**:
"The whole purpose of this extension is to make a beautiful GUI for Claude's message stream" - render messages that contain tools, thinking, etc. as unified content blocks, not separate event subscriptions.

## Technical Context

- **Branch**: feature/TASK_2025_022
- **Created**: 2025-11-23
- **Task Type**: DOCUMENTATION + ARCHITECTURE GUIDANCE
- **Complexity**: Medium
- **Estimated Duration**: 4-6 hours
- **Related Tasks**:
  - TASK_2025_021: RPC migration (in progress)
  - TASK_2025_009: ContentBlocks migration (complete)
  - TASK_2025_014: Session storage migration (complete)

## Execution Strategy

**Strategy**: DOCUMENTATION (Minimal) with Architecture Guidance

**Phases**:

1. Project Manager → Creates comprehensive documentation scope (preserving GUI capabilities, streaming best practices)
2. Researcher (optional if needed) → Technical research on Claude CLI streaming formats
3. Developer (technical writer) → Implements documentation files with code examples, architecture diagrams
4. Code Reviewer → Verifies accuracy and completeness

## Success Criteria

**Deliverables**:

- ✅ Comprehensive streaming architecture guide (best practices, anti-patterns, code examples)
- ✅ Claude CLI message format documentation (streaming stdout vs .jsonl file)
- ✅ Parser integration patterns (how to forward callbacks without splitting)
- ✅ Frontend rendering examples (unified message component with content blocks)
- ✅ RPC migration streaming gap solution (simple postMessage forwarding)
- ✅ Clear distinction: What's already correct (parser) vs what needs fixing (integration layer)

**Quality Gates**:

- User validates documentation scope (PM deliverable)
- Documentation includes real code examples from codebase
- Shows both WRONG (EventBus splitting) and CORRECT (message-centric) architectures
- Provides copy-paste implementation templates for streaming wiring
