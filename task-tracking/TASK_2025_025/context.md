# TASK_2025_025: MCP Registration Refactoring & Cleanup

**Created**: 2025-11-27
**Type**: REFACTORING
**Complexity**: Medium
**Estimated Time**: 3-4 hours
**Related Task**: TASK_2025_016 (Code Execution API - completed but registration broken)

## User Intent

Refactor the MCP server registration approach and clean up unused code:

1. **Fix MCP Registration**: Replace broken `claude mcp add` CLI command approach with `.mcp.json` file-based registration
2. **Simplify Port Management**: Use hardcoded port with user override setting instead of random port
3. **Remove Unused Code**: Delete `languageModelTools` (6 tools) that only work with GitHub Copilot, not Claude CLI
4. **Keep Working Code**: Preserve HTTP MCP server and PtahAPIBuilder that provide full VS Code API access

## Business Problem

The current MCP registration in TASK_2025_016 is broken:

```typescript
// CURRENT - BROKEN
const command = 'claude mcp add --scope local --transport http ptah "http://localhost:${PTAH_MCP_PORT}"';
await execAsync(command);
// Problem: ${PTAH_MCP_PORT} is a literal string, NOT expanded!
```

Additionally, 6 `languageModelTools` were created but are only usable by GitHub Copilot, not Claude CLI, making them dead code for our use case.

## Solution Approach

### 1. Fix Registration with .mcp.json File Approach

Replace CLI command with direct file manipulation:

```typescript
// NEW - WORKING
const config = {
  mcpServers: {
    ptah: {
      command: 'http',
      args: [`http://localhost:${actualPort}`],
    },
  },
};
// Read existing .mcp.json, merge, write back
await fs.writeFile(path.join(workspaceRoot, '.mcp.json'), JSON.stringify(config, null, 2));
```

### 2. Hardcode Port with User Override

```typescript
// Default port (unlikely to conflict)
const DEFAULT_PTAH_MCP_PORT = 51820;

// User can override in settings
const port = vscode.workspace.getConfiguration('ptah').get('mcpPort', DEFAULT_PTAH_MCP_PORT);
```

### 3. Remove Unused languageModelTools

Delete these files (only work with Copilot, not Claude CLI):

- `tools/analyze-workspace.tool.ts`
- `tools/search-files.tool.ts`
- `tools/get-relevant-files.tool.ts`
- `tools/get-diagnostics.tool.ts`
- `tools/find-symbol.tool.ts`
- `tools/get-git-status.tool.ts`
- `lm-tools-registration.service.ts`
- `package.json` → `languageModelTools` section

### 4. Keep Working Components

Preserve (they work correctly):

- `code-execution-mcp.service.ts` - HTTP server running in extension host
- `ptah-api-builder.service.ts` - 8 namespaces with full VS Code API access
- `types.ts` - Type definitions

## Architecture Overview

### Current (Broken Registration)

```
Extension Host
├── CodeExecutionMCP (HTTP server on random port) ✅ Working
├── PtahAPIBuilder (8 namespaces, VS Code APIs) ✅ Working
├── MCPRegistrationService
│   └── claude mcp add ... "${PTAH_MCP_PORT}" ❌ BROKEN (literal string)
└── LMToolsRegistrationService
    └── 6 languageModelTools ❌ Not used by Claude CLI
```

### Target (Fixed Registration)

```
Extension Host
├── CodeExecutionMCP (HTTP server on port 51820) ✅ Keep
├── PtahAPIBuilder (8 namespaces, VS Code APIs) ✅ Keep
├── MCPConfigManagerService (NEW)
│   └── Write .mcp.json with actual port ✅ Fix
└── [DELETED: LMToolsRegistrationService and tools/*]
```

## Files to Modify

### DELETE (6 tool files + registration service):

1. `libs/backend/vscode-lm-tools/src/lib/tools/analyze-workspace.tool.ts`
2. `libs/backend/vscode-lm-tools/src/lib/tools/search-files.tool.ts`
3. `libs/backend/vscode-lm-tools/src/lib/tools/get-relevant-files.tool.ts`
4. `libs/backend/vscode-lm-tools/src/lib/tools/get-diagnostics.tool.ts`
5. `libs/backend/vscode-lm-tools/src/lib/tools/find-symbol.tool.ts`
6. `libs/backend/vscode-lm-tools/src/lib/tools/get-git-status.tool.ts`
7. `libs/backend/vscode-lm-tools/src/lib/lm-tools-registration.service.ts`
8. `libs/backend/vscode-lm-tools/src/lib/types/tool-parameters.ts` (if only used by deleted tools)

### REPLACE:

1. `libs/backend/claude-domain/src/cli/mcp-registration.service.ts` → `mcp-config-manager.service.ts`

### MODIFY:

1. `apps/ptah-extension-vscode/src/main.ts` - Remove LM tools registration, update MCP config step
2. `apps/ptah-extension-vscode/package.json` - Remove `languageModelTools` section, add `ptah.mcpPort` setting
3. `libs/backend/vscode-lm-tools/src/index.ts` - Remove tool exports
4. `libs/backend/vscode-core/src/di/tokens.ts` - Remove LM tool tokens, update MCP token
5. `apps/ptah-extension-vscode/src/di/container.ts` - Remove LM tool registrations
6. `libs/backend/vscode-lm-tools/src/lib/code-execution/code-execution-mcp.service.ts` - Use hardcoded port

## Success Criteria

- ✅ HTTP MCP server starts on fixed port (51820 default, configurable)
- ✅ `.mcp.json` file created/updated with correct server URL
- ✅ Claude CLI can discover and connect to MCP server
- ✅ `execute_code` tool works end-to-end
- ✅ All 6 unused languageModelTools deleted
- ✅ Build passes with no errors
- ✅ No dead code remaining

## Technical Constraints

1. **Port Conflict Handling**: Show clear error if port in use, instruct user to change setting
2. **Preserve User Config**: When updating .mcp.json, preserve user's other MCP servers
3. **Cleanup on Deactivate**: Remove ptah entry from .mcp.json when extension deactivates
4. **No Breaking Changes**: PtahAPIBuilder and execute_code functionality unchanged

---

**Next Steps**: Invoke project-manager to create detailed requirements, then software-architect for implementation plan.
