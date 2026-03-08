# TASK_2025_177: Codex SDK Migration Research

## Task Type: RESEARCH

## Strategy: Researcher → [conditional architecture/implementation plan]

## Complexity: Medium-High

## User Request

Migrate Codex CLI adapter from spawn-based to SDK-based integration using the official OpenAI Codex TypeScript SDK (https://github.com/openai/codex/tree/main/sdk/typescript), following the same pattern as our Copilot SDK adapter.

## Context

- Current Codex adapter (`codex-cli.adapter.ts`) uses the Codex SDK already but via an older pattern
- Copilot SDK adapter (`copilot-sdk.adapter.ts`) is the gold standard pattern to follow
- The official Codex TypeScript SDK has been published at https://github.com/openai/codex/tree/main/sdk/typescript
- Goal: structured event streaming, session management, permission hooks — same as Copilot

## Research Goals

1. Analyze the official Codex TypeScript SDK API surface
2. Compare with our Copilot SDK adapter pattern
3. Identify mapping: SDK events → CliOutputSegment types
4. Assess session management, auth, permission hooks
5. Produce a migration feasibility report with implementation plan
