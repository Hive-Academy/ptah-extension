# TASK_2025_167: Custom Agent MCP Integration - Review Fixes

## Type: BUGFIX

## Strategy: Partial (Team-Leader -> Developers -> QA)

## Complexity: Complex (15 issues, 9+ files)

## Branch: feature/sdk-only-migration

## Context

The "Surface Custom Agents in MCP Agent Namespace" implementation (10-step plan) was completed and passed typecheck/lint, but the triple review revealed 15 issues:

- **Business Logic Review**: 6/10 (NEEDS_REVISION)
- **Code Quality Review**: 5.5/10 (NEEDS_REVISION)
- **Security Review**: 4.5/10 (NEEDS_REVISION)
- **Weighted Total**: 5.43/10

## Issues by Priority

### CRITICAL (3)

1. Full process.env exposure to third-party providers (custom-agent-registry.ts:612)
2. bypassPermissions + full claude_code toolset for custom agents (custom-agent-registry.ts:604-609)
3. Working directory validation bypass in spawnFromSdkHandle() (agent-process-manager.service.ts:489)

### BLOCKING (1)

4. ptah_agent_list MCP tool documented but doesn't exist

### SERIOUS (6)

5. 80% code duplication: spawnFromSdkHandle() vs doSpawnSdk()
6. spawnAgent() returns undefined for 4 failure modes
7. container.resolve<any>() bypasses TypeScript strict mode
8. Predictable agent IDs: Date.now() + Math.random()
9. Error messages forward provider internal details unsanitized
10. Race condition in concurrent limit check (TOCTOU gap)

### MODERATE (5)

11. Triple duplicated Symbol.for() DI tokens
12. Shadow type contracts (CustomAgentRegistryLike, CustomAgentListEntry)
13. No task string length validation
14. No cost tracking for custom agent API calls
15. process.cwd() fallback instead of workspace root
