# TASK_2025_170: Rename customAgent → ptahCli, Unify with CLI Agent Orchestration

## Task Type: REFACTORING

## Workflow: Partial (Architect → Team-Leader → Developers)

## Status: ARCHITECTURE_PHASE

## User Request

Rename customAgent to ptahCli and include it as part of the CLI list alongside Gemini/Codex/Copilot. The two systems are currently separate but custom agents are already treated as CLIs (`CliType = 'custom'`).

## Bugs Reported

1. Adding a new custom agent doesn't update the Agent Orchestration panel
2. Previously saved custom agent (moonshot) disappeared from orchestration after adding new one (z.ai)

## Root Cause

Two parallel systems that don't sync:

- **CliDetectionService** (auto-detects gemini/codex/copilot) → feeds Agent Orchestration panel
- **CustomAgentRegistry** (user-configured agents) → feeds separate Custom Agent settings panel

## Architecture Research Complete

- See explore agents for full research on both systems
- CliType already has `'custom'` value
- SdkHandle interface is shared between both systems
- CustomAgentRegistry.spawnAgent() already returns SdkHandle
- AgentProcessManager.trackSdkHandle() can track any SdkHandle
