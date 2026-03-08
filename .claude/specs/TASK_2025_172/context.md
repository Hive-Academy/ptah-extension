# TASK_2025_172: Fix Ptah CLI Agent Failures + Premium SDK Parity

## Type: BUGFIX + ENHANCEMENT

## Strategy: Minimal (researcher-expert -> direct implementation)

## Complexity: Simple fix, complex root cause analysis + premium feature parity

## Branch: feature/sdk-only-migration

## Status: COMPLETE

## User Request

1. Fix all 4 CLI agent failure modes identified in `agent-failure-analysis.md`
2. Audit configuration parity between interactive sessions and headless spawnAgent()
3. Bring headless spawn to full parity with interactive sessions, gated behind Pro subscription

## Phase 1: Core Fixes

### Root Cause

All 4 failures traced to a single root cause: `PtahCliRegistry.spawnAgent()` was missing 3 critical SDK query options:

- `cwd` - Sets working directory and security sandbox
- `canUseTool` - Routes permissions/questions to VS Code webview
- `settingSources` - Loads CLAUDE.md project settings

### Fix Applied (3 files, ~30 lines)

1. **`libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts`**

   - Updated `spawnAgent()` signature: `projectGuidance?: string` -> `options?: { projectGuidance, workingDirectory }`
   - Added `cwd`, `canUseTool`, `settingSources`, `stderr` to SDK query options

2. **`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`**

   - Updated `PtahCliRegistryLike` interface to match new signature
   - Moved `workingDirectory` resolution before `spawnAgent()` call

3. **`libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`**
   - Updated inline type for `spawnAgent()` to match new signature

## Phase 2: Premium SDK Parity

### Gap Analysis

Compared 4 SDK query option builders and found headless spawnAgent() was missing:

- System prompt assembly (identity + enhanced/core + MCP docs)
- MCP servers (Ptah CodeExecution MCP)
- Plugins (workspace plugin config)
- Hooks (subagent tracking + compaction lifecycle)
- Compaction control
- Premium gating via LicenseService

### Enhancement Applied (1 file, ~120 lines)

**`libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts`**:

- 3 new DI injections: `LicenseService`, `EnhancedPromptsService`, `PluginLoaderService`
- `assembleSystemPromptAppend()` for full system prompt (identity + enhanced/core + MCP docs)
- `mcpServers` with Ptah MCP (premium only, lazy DI via `require('tsyringe')`)
- `plugins` loaded from `PluginLoaderService` (premium only)
- `hooks` for subagent tracking and compaction lifecycle
- `compactionControl` from `CompactionConfigProvider`
- 4 helper methods: `isPremiumTier()`, `isMcpServerRunning()`, `resolveEnhancedPromptsContent()`, `resolvePluginPaths()`
- All premium features gated behind `LicenseService.verifyLicense()` + `isPremiumTier()`

## Created: 2026-03-03
