# Development Tasks - TASK_2025_025: MCP Registration Refactoring & Cleanup

**Task Type**: Backend Refactoring
**Total Tasks**: 17 tasks
**Total Batches**: 5 batches
**Batching Strategy**: Layer-based (Foundation → Core Changes → Infrastructure → Cleanup → Finalization)
**Status**: 0/5 batches complete (0%)

---

## Batch 1: Create MCPConfigManagerService (Foundation) 🔄 IN PROGRESS - Assigned to backend-developer

**Assigned To**: backend-developer
**Tasks in Batch**: 1
**Dependencies**: None (foundation layer)
**Estimated Time**: 1.5 hours

### Task 1.1: Create MCPConfigManagerService with .mcp.json file management 🔄 IMPLEMENTED

**File(s)**: `D:\projects\ptah-extension\libs\backend\claude-domain\src\cli\mcp-config-manager.service.ts`
**Action**: CREATE
**Specification Reference**: implementation-plan.md:99-256
**Pattern to Follow**: `libs/backend/workspace-intelligence/src/autocomplete/mcp-discovery.service.ts:198-233` (file handling pattern)
**Expected Commit Pattern**: `feat(vscode): add mcp config manager service`

**Description**: Create a new injectable service that manages `.mcp.json` file creation, updates, and cleanup for Ptah MCP server registration. This replaces the broken MCPRegistrationService that uses literal strings instead of actual port numbers.

**Implementation Details**:

**Imports to Verify**:

- `import { injectable, inject } from 'tsyringe'`
- `import { TOKENS, Logger } from '@ptah-extension/vscode-core'`
- `import * as vscode from 'vscode'`
- `import * as fs from 'fs/promises'`
- `import * as path from 'path'`

**Required Methods**:

1. **ensurePtahMCPConfig(port: number): Promise<void>**

   - Read workspace root from `vscode.workspace.workspaceFolders[0].uri.fsPath`
   - Check if `.mcp.json` exists, read existing config or create empty
   - Merge Ptah server entry: `{ mcpServers: { ptah: { command: 'http', args: [`http://localhost:${port}`] } } }`
   - Write updated config with `JSON.stringify(config, null, 2)`
   - Handle errors gracefully (log, don't crash)

2. **removePtahMCPConfig(): Promise<void>**

   - Read existing `.mcp.json`
   - Delete `ptah` entry from `mcpServers`
   - Write updated config back
   - Non-blocking cleanup (log errors, don't throw)

3. **getConfigPath(workspaceRoot: string): string**
   - Return `path.join(workspaceRoot, '.mcp.json')`

**Example Files**:

- `libs/backend/workspace-intelligence/src/autocomplete/mcp-discovery.service.ts` - file handling pattern
- `libs/backend/vscode-lm-tools/src/lib/code-execution/code-execution-mcp.service.ts` - injectable service pattern

**Quality Requirements**:

- ✅ MUST use `@injectable()` decorator
- ✅ MUST inject LOGGER via `@inject(TOKENS.LOGGER)`
- ✅ MUST preserve existing MCP server entries when updating
- ✅ MUST write actual port number (not environment variable)
- ✅ MUST handle missing workspace folder gracefully
- ✅ MUST handle file write failures without crashing
- ✅ File operations MUST complete within 500ms

**Verification Commands**:

```bash
# Verify file exists
ls -la D:/projects/ptah-extension/libs/backend/claude-domain/src/cli/mcp-config-manager.service.ts

# Verify no syntax errors
npx nx build claude-domain
```

---

**Batch 1 Verification Requirements**:

- ✅ File created at correct path
- ✅ Service follows injectable pattern (decorator + constructor injection)
- ✅ All methods implemented (ensurePtahMCPConfig, removePtahMCPConfig, getConfigPath)
- ✅ Build passes: `npx nx build claude-domain`
- ✅ No compilation errors

---

## Batch 2: Modify CodeExecutionMCP for Fixed Port (Core Changes) 🔄 IN PROGRESS - Assigned to backend-developer

**Assigned To**: backend-developer
**Tasks in Batch**: 3
**Dependencies**: None (independent from Batch 1)
**Estimated Time**: 1 hour

### Task 2.1: Update CodeExecutionMCP to use fixed port (51820) 🔄 IMPLEMENTED

**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\code-execution-mcp.service.ts`
**Action**: MODIFY (lines 51-88)
**Specification Reference**: implementation-plan.md:281-357
**Pattern to Follow**: Existing HTTP server pattern (code-execution-mcp.service.ts:58-87)
**Expected Commit Pattern**: `feat(vscode): use fixed port for mcp server`

**Description**: Change MCP server from random port (0) to configured port (default 51820). Read port from VS Code settings `ptah.mcpPort` with default 51820.

**Implementation Details**:

**Code Changes** (lines 51-88):

```typescript
// BEFORE (line 62-63):
// Listen on random port (0 = OS assigns available port)
this.server.listen(0, 'localhost', () => {

// AFTER:
// Get configured port (default: 51820)
const configuredPort = vscode.workspace.getConfiguration('ptah').get<number>('mcpPort', 51820);

// Listen on configured port instead of random port
this.server.listen(configuredPort, 'localhost', () => {
```

**Quality Requirements**:

- ✅ MUST read port from `vscode.workspace.getConfiguration('ptah').get<number>('mcpPort', 51820)`
- ✅ MUST default to 51820 if setting not configured
- ✅ MUST bind to `localhost` only (not `0.0.0.0`)
- ✅ MUST maintain existing HTTP server implementation
- ✅ MUST maintain existing health check endpoint

---

### Task 2.2: Add port conflict detection and error handling 🔄 IMPLEMENTED

**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\code-execution-mcp.service.ts`
**Action**: MODIFY (lines 83-86)
**Specification Reference**: implementation-plan.md:340-355
**Expected Commit Pattern**: `feat(vscode): add port conflict error handling for mcp server`

**Description**: Enhance error handling in MCP server to detect port conflicts (EADDRINUSE) and display user-friendly error notifications with remediation steps.

**Implementation Details**:

**Code Changes** (lines 83-86):

```typescript
// BEFORE:
this.server.on('error', (error) => {
  this.logger.error('CodeExecutionMCP server error', error);
  reject(error);
});

// AFTER:
this.server.on('error', (error: NodeJS.ErrnoException) => {
  // Enhanced error handling for port conflicts
  if (error.code === 'EADDRINUSE') {
    const errorMsg = `Failed to start MCP server on port ${configuredPort}. Port is already in use. Please change 'ptah.mcpPort' setting to use a different port.`;
    this.logger.error(errorMsg, error);

    // Show user-friendly notification
    vscode.window.showErrorMessage(errorMsg);

    reject(new Error(errorMsg));
  } else {
    this.logger.error('CodeExecutionMCP server error', error);
    reject(error);
  }
});
```

**Quality Requirements**:

- ✅ MUST detect EADDRINUSE error code
- ✅ MUST include specific port number in error message
- ✅ MUST include remediation steps (change `ptah.mcpPort` setting)
- ✅ MUST display VS Code error notification
- ✅ Port conflicts MUST NOT crash extension

---

### Task 2.3: Update server start logging to include configured port 🔄 IMPLEMENTED

**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\code-execution-mcp.service.ts`
**Action**: MODIFY (lines 75-77)
**Specification Reference**: implementation-plan.md:328-335
**Expected Commit Pattern**: `feat(vscode): improve mcp server start logging`

**Description**: Update logging to reflect that server is using configured port (not random port).

**Implementation Details**:

**Code Changes** (lines 75-77):

```typescript
// Update comment (line 48-50):
/**
 * Start HTTP MCP server on configured localhost port (default: 51820)
 * Stores port in workspace state for Claude CLI discovery
 */

// Keep existing log (no change needed, just verify it logs actual port):
this.logger.info(`CodeExecutionMCP server started on http://localhost:${this.port}`, 'CodeExecutionMCP');
```

**Quality Requirements**:

- ✅ MUST log actual port number used
- ✅ Log message MUST be at INFO level
- ✅ MUST maintain existing workspace state update

**Verification Commands**:

```bash
# Verify no syntax errors
npx nx build vscode-lm-tools

# Verify build passes
npx nx build ptah-extension-vscode
```

---

**Batch 2 Verification Requirements**:

- ✅ CodeExecutionMCP uses configured port (default 51820)
- ✅ Port conflict errors handled with user notifications
- ✅ Error messages include specific port number and remediation
- ✅ Build passes: `npx nx build vscode-lm-tools`
- ✅ Build passes: `npx nx build ptah-extension-vscode`
- ✅ No compilation errors

---

## Batch 3: Update Extension Integration (Infrastructure) 🔄 IN PROGRESS - Assigned to backend-developer

**Assigned To**: backend-developer
**Tasks in Batch**: 4
**Dependencies**: Batch 1 complete (MCPConfigManagerService must exist)
**Estimated Time**: 1 hour

### Task 3.1: Remove Language Model Tools registration from main.ts 🔄 IMPLEMENTED

**File(s)**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts`
**Action**: MODIFY (DELETE lines 76-87)
**Specification Reference**: implementation-plan.md:390-406
**Expected Commit Pattern**: `refactor(vscode): remove language model tools registration`

**Description**: Delete Step 8 (Language Model Tools registration) from extension activation sequence. These tools only work with GitHub Copilot, not Claude CLI.

**Implementation Details**:

**Code to DELETE** (entire block, lines 76-87):

```typescript
// ❌ DELETE THIS ENTIRE BLOCK
// Register Language Model Tools with VS Code
console.log('[Activate] Step 8: Registering Language Model Tools...');
const lmToolsService = DIContainer.resolve(TOKENS.LM_TOOLS_REGISTRATION_SERVICE);
(
  lmToolsService as {
    registerAll: (context: vscode.ExtensionContext) => void;
  }
).registerAll(context);
logger.info('Language Model Tools registered (6 tools)');
console.log('[Activate] Step 8: Language Model Tools registered');
```

**Quality Requirements**:

- ✅ MUST delete entire Step 8 block
- ✅ MUST keep Step 9 (Code Execution MCP Server) unchanged
- ✅ Step numbering can remain as-is (Step 9 stays Step 9, etc.)

---

### Task 3.2: Update MCP registration to use MCPConfigManagerService 🔄 IMPLEMENTED

**File(s)**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts`
**Action**: MODIFY (REPLACE lines 102-133)
**Specification Reference**: implementation-plan.md:426-458
**Dependencies**: Task 1.1 (MCPConfigManagerService must exist)
**Expected Commit Pattern**: `feat(vscode): use mcp config manager for registration`

**Description**: Replace broken MCPRegistrationService with new MCPConfigManagerService. Write actual port number to `.mcp.json` file instead of literal string.

**Implementation Details**:

**Code to REPLACE** (lines 102-133):

```typescript
// BEFORE (broken registration with literal string):
// Register Ptah MCP server with Claude CLI
console.log('[Activate] Step 10: Registering Ptah MCP server...');
try {
  const mcpRegistrationService = DIContainer.resolve(
    TOKENS.MCP_REGISTRATION_SERVICE
  );
  // ... broken registration logic
} catch (error) { ... }

// AFTER (working registration with actual port):
// Register Ptah MCP server with .mcp.json file
console.log('[Activate] Step 10: Writing MCP config to .mcp.json...');

try {
  const mcpConfigManager = DIContainer.resolve(
    TOKENS.MCP_CONFIG_MANAGER_SERVICE
  );

  await (
    mcpConfigManager as { ensurePtahMCPConfig: (port: number) => Promise<void> }
  ).ensurePtahMCPConfig(mcpPort);

  logger.info('MCP server registered in .mcp.json', {
    context: 'Extension Activation',
    status: 'registered',
    port: mcpPort,
    url: `http://localhost:${mcpPort}`,
  });
  console.log('[Activate] Step 10: MCP server registered in .mcp.json');
} catch (error) {
  logger.error(
    'Failed to write MCP config (non-blocking)',
    error instanceof Error ? error : new Error(String(error))
  );
  console.warn(
    '[Activate] Step 10: MCP config write failed (non-blocking)',
    error
  );
  // Don't block extension activation if MCP config fails
}
```

**Quality Requirements**:

- ✅ MUST use `TOKENS.MCP_CONFIG_MANAGER_SERVICE` instead of `TOKENS.MCP_REGISTRATION_SERVICE`
- ✅ MUST pass actual `mcpPort` value (from Step 9)
- ✅ MUST handle errors gracefully (log, don't block activation)
- ✅ MUST log success with port number and URL

---

### Task 3.3: Add MCP config cleanup on extension deactivation 🔄 IMPLEMENTED

**File(s)**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts`
**Action**: MODIFY (ADD to deactivate function, line 164)
**Specification Reference**: implementation-plan.md:463-483
**Dependencies**: Task 1.1 (MCPConfigManagerService.removePtahMCPConfig must exist)
**Expected Commit Pattern**: `feat(vscode): cleanup mcp config on extension deactivation`

**Description**: Add cleanup step to remove Ptah entry from `.mcp.json` when extension deactivates.

**Implementation Details**:

**Code to ADD** (in deactivate function, after line 166):

```typescript
// Add to deactivate() function
export function deactivate(): void {
  const logger = DIContainer.resolve<Logger>(TOKENS.LOGGER);
  logger.info('Deactivating Ptah extension');

  // ✅ ADD THIS BLOCK (after logger.info, before ptahExtension?.dispose()):
  // Stop MCP server and clean up .mcp.json
  try {
    const mcpConfigManager = DIContainer.resolve(TOKENS.MCP_CONFIG_MANAGER_SERVICE);
    (mcpConfigManager as { removePtahMCPConfig: () => Promise<void> }).removePtahMCPConfig();
  } catch (error) {
    // Non-blocking cleanup
    logger.error('Failed to clean up MCP config', error instanceof Error ? error : new Error(String(error)));
  }

  ptahExtension?.dispose();
  ptahExtension = undefined;
  DIContainer.clear();
}
```

**Quality Requirements**:

- ✅ MUST call `removePtahMCPConfig()` on MCPConfigManagerService
- ✅ Cleanup MUST be non-blocking (catch errors, don't throw)
- ✅ MUST log cleanup errors for debugging
- ✅ MUST execute before `ptahExtension?.dispose()`

---

### Task 3.4: Add ptah.mcpPort configuration setting to package.json 🔄 IMPLEMENTED

**File(s)**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json`
**Action**: MODIFY (ADD to contributes.configuration.properties)
**Specification Reference**: implementation-plan.md:512-533
**Expected Commit Pattern**: `feat(vscode): add ptah.mcpPort configuration setting`

**Description**: Add `ptah.mcpPort` setting to VS Code configuration, allowing users to override the default MCP server port (51820).

**Implementation Details**:

**Code to ADD** (in `contributes.configuration.properties`, after existing properties):

```json
{
  "contributes": {
    "configuration": {
      "title": "Ptah",
      "properties": {
        "ptah.mcpPort": {
          "type": "number",
          "default": 51820,
          "minimum": 1024,
          "maximum": 65535,
          "markdownDescription": "Port number for Ptah MCP server (default: 51820). Change if port conflicts occur. **Requires extension reload to take effect.**"
        }
      }
    }
  }
}
```

**Quality Requirements**:

- ✅ MUST have default value of 51820
- ✅ MUST constrain port range (1024-65535)
- ✅ MUST document reload requirement in description
- ✅ MUST use `markdownDescription` for formatting

**Verification Commands**:

```bash
# Verify JSON syntax
npx nx lint ptah-extension-vscode

# Verify build passes
npx nx build ptah-extension-vscode
```

---

**Batch 3 Verification Requirements**:

- ✅ Step 8 (LM tools registration) removed from main.ts
- ✅ Step 10 uses MCPConfigManagerService (not MCPRegistrationService)
- ✅ Deactivation cleanup added (removePtahMCPConfig)
- ✅ `ptah.mcpPort` setting added to package.json
- ✅ Build passes: `npx nx build ptah-extension-vscode`
- ✅ No compilation errors

---

## Batch 4: Cleanup Unused Code (Deletion) 🔄 IN PROGRESS - Assigned to backend-developer

**Assigned To**: backend-developer
**Tasks in Batch**: 6
**Dependencies**: Batch 3 complete (main.ts no longer references these)
**Estimated Time**: 30 minutes

### Task 4.1: Delete 6 unused Language Model Tool files 🔄 IMPLEMENTED

**File(s)**:

- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\tools\analyze-workspace.tool.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\tools\search-files.tool.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\tools\get-relevant-files.tool.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\tools\get-diagnostics.tool.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\tools\find-symbol.tool.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\tools\get-git-status.tool.ts`
  **Action**: DELETE (6 files, ~437 lines)
  **Specification Reference**: task-description.md:109-115
  **Expected Commit Pattern**: `chore(vscode): delete unused language model tools`

**Description**: Delete 6 Language Model Tool files that only work with GitHub Copilot, not Claude CLI. These tools are dead code for our use case.

**Implementation Details**:

**Files to DELETE**:

```bash
rm D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/tools/analyze-workspace.tool.ts
rm D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/tools/search-files.tool.ts
rm D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/tools/get-relevant-files.tool.ts
rm D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/tools/get-diagnostics.tool.ts
rm D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/tools/find-symbol.tool.ts
rm D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/tools/get-git-status.tool.ts
```

**Quality Requirements**:

- ✅ All 6 tool files MUST be deleted
- ✅ `tools/` directory should be empty or non-existent after deletion

---

### Task 4.2: Delete LMToolsRegistrationService 🔄 IMPLEMENTED

**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\lm-tools-registration.service.ts`
**Action**: DELETE (~70 lines)
**Specification Reference**: task-description.md:116
**Expected Commit Pattern**: `chore(vscode): delete lm tools registration service`

**Description**: Delete the LMToolsRegistrationService that registers the 6 deleted tools with VS Code.

**Implementation Details**:

**File to DELETE**:

```bash
rm D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib/lm-tools-registration.service.ts
```

**Quality Requirements**:

- ✅ File MUST be deleted
- ✅ No remaining references to LMToolsRegistrationService

---

### Task 4.3: Delete broken MCPRegistrationService 🔄 IMPLEMENTED

**File(s)**: `D:\projects\ptah-extension\libs\backend\claude-domain\src\cli\mcp-registration.service.ts`
**Action**: DELETE (~115 lines)
**Specification Reference**: implementation-plan.md:760
**Expected Commit Pattern**: `chore(vscode): delete broken mcp registration service`

**Description**: Delete the broken MCPRegistrationService that uses literal string `${PTAH_MCP_PORT}` instead of actual port number.

**Implementation Details**:

**File to DELETE**:

```bash
rm D:/projects/ptah-extension/libs/backend/claude-domain/src/cli/mcp-registration.service.ts
```

**Quality Requirements**:

- ✅ File MUST be deleted
- ✅ No remaining references to MCPRegistrationService

---

### Task 4.4: Remove tool exports from vscode-lm-tools/src/index.ts 🔄 IMPLEMENTED

**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\index.ts`
**Action**: MODIFY (DELETE lines 9-17, 25-32)
**Specification Reference**: implementation-plan.md:627-642
**Expected Commit Pattern**: `refactor(vscode): remove deleted tool exports from library index`

**Description**: Remove exports for deleted tools from library index file.

**Implementation Details**:

**Code to DELETE** (lines 9-17):

```typescript
// ❌ DELETE these exports:
export { AnalyzeWorkspaceTool } from './lib/tools/analyze-workspace.tool';
export { SearchFilesTool } from './lib/tools/search-files.tool';
export { GetRelevantFilesTool } from './lib/tools/get-relevant-files.tool';
export { GetDiagnosticsTool } from './lib/tools/get-diagnostics.tool';
export { FindSymbolTool } from './lib/tools/find-symbol.tool';
export { GetGitStatusTool } from './lib/tools/get-git-status.tool';
export { LMToolsRegistrationService } from './lib/lm-tools-registration.service';
```

**Code to KEEP** (lines 19-22):

```typescript
// ✅ KEEP these exports:
export { PtahAPIBuilder } from './lib/code-execution/ptah-api-builder.service';
export { CodeExecutionMCP } from './lib/code-execution/code-execution-mcp.service';
export type { PtahAPI } from './lib/code-execution/types';
```

**Code to DELETE** (lines 25-32):

```typescript
// ❌ DELETE tool parameter type exports
```

**Quality Requirements**:

- ✅ MUST remove all 6 tool exports
- ✅ MUST remove LMToolsRegistrationService export
- ✅ MUST remove tool parameter type exports
- ✅ MUST keep PtahAPIBuilder and CodeExecutionMCP exports

---

### Task 4.5: Remove DI tokens from tokens.ts ⏸️ PENDING

**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts`
**Action**: MODIFY (DELETE lines 112-120, UPDATE line 125, DELETE from TOKENS constant)
**Specification Reference**: implementation-plan.md:586-611
**Expected Commit Pattern**: `refactor(vscode): remove deleted tool tokens and update mcp service token`

**Description**: Remove 7 DI tokens for deleted tools and update MCP service token name.

**Implementation Details**:

**Code to DELETE** (lines 112-120):

```typescript
// ❌ DELETE these token definitions:
export const ANALYZE_WORKSPACE_TOOL = Symbol.for('AnalyzeWorkspaceTool');
export const SEARCH_FILES_TOOL = Symbol.for('SearchFilesTool');
export const GET_RELEVANT_FILES_TOOL = Symbol.for('GetRelevantFilesTool');
export const GET_DIAGNOSTICS_TOOL = Symbol.for('GetDiagnosticsTool');
export const FIND_SYMBOL_TOOL = Symbol.for('FindSymbolTool');
export const GET_GIT_STATUS_TOOL = Symbol.for('GetGitStatusTool');
export const LM_TOOLS_REGISTRATION_SERVICE = Symbol.for('LMToolsRegistrationService');
```

**Code to UPDATE** (line 125):

```typescript
// BEFORE:
export const MCP_REGISTRATION_SERVICE = Symbol.for('MCPRegistrationService');

// AFTER:
export const MCP_CONFIG_MANAGER_SERVICE = Symbol.for('MCPConfigManagerService');
```

**Code to UPDATE** (in TOKENS constant, lines 262-271):

```typescript
// ❌ DELETE these from TOKENS constant:
// ANALYZE_WORKSPACE_TOOL,
// SEARCH_FILES_TOOL,
// GET_RELEVANT_FILES_TOOL,
// GET_DIAGNOSTICS_TOOL,
// FIND_SYMBOL_TOOL,
// GET_GIT_STATUS_TOOL,
// LM_TOOLS_REGISTRATION_SERVICE,

// ✅ UPDATE in TOKENS constant:
// MCP_REGISTRATION_SERVICE → MCP_CONFIG_MANAGER_SERVICE
```

**Quality Requirements**:

- ✅ MUST remove 7 deleted tool tokens
- ✅ MUST rename MCP_REGISTRATION_SERVICE to MCP_CONFIG_MANAGER_SERVICE
- ✅ MUST update TOKENS constant to reflect changes
- ✅ Build must pass after changes

---

### Task 4.6: Remove DI registrations from container.ts and update imports ⏸️ PENDING

**File(s)**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.ts`
**Action**: MODIFY (DELETE lines 251-272, UPDATE lines 302-305, UPDATE imports)
**Specification Reference**: implementation-plan.md:549-569
**Expected Commit Pattern**: `refactor(vscode): remove deleted tool registrations and update mcp service`

**Description**: Remove 7 tool registrations from DI container, update MCPConfigManagerService registration, and update import statements.

**Implementation Details**:

**Imports to DELETE** (lines 64-71, approximate):

```typescript
// ❌ DELETE these imports:
import { AnalyzeWorkspaceTool, SearchFilesTool, GetRelevantFilesTool, GetDiagnosticsTool, FindSymbolTool, GetGitStatusTool, LMToolsRegistrationService } from '@ptah-extension/vscode-lm-tools';
```

**Import to UPDATE** (line 81, approximate):

```typescript
// BEFORE:
import { MCPRegistrationService } from '@ptah-extension/claude-domain';

// AFTER:
import { MCPConfigManagerService } from '@ptah-extension/claude-domain';
```

**Registrations to DELETE** (lines 251-272):

```typescript
// ❌ DELETE these registrations:
container.registerSingleton(TOKENS.ANALYZE_WORKSPACE_TOOL, AnalyzeWorkspaceTool);
container.registerSingleton(TOKENS.SEARCH_FILES_TOOL, SearchFilesTool);
container.registerSingleton(TOKENS.GET_RELEVANT_FILES_TOOL, GetRelevantFilesTool);
container.registerSingleton(TOKENS.GET_DIAGNOSTICS_TOOL, GetDiagnosticsTool);
container.registerSingleton(TOKENS.FIND_SYMBOL_TOOL, FindSymbolTool);
container.registerSingleton(TOKENS.GET_GIT_STATUS_TOOL, GetGitStatusTool);
container.registerSingleton(TOKENS.LM_TOOLS_REGISTRATION_SERVICE, LMToolsRegistrationService);
```

**Registrations to UPDATE** (lines 302-305):

```typescript
// BEFORE:
container.registerSingleton(TOKENS.MCP_REGISTRATION_SERVICE, MCPRegistrationService);

// AFTER:
container.registerSingleton(TOKENS.MCP_CONFIG_MANAGER_SERVICE, MCPConfigManagerService);
```

**Quality Requirements**:

- ✅ MUST remove all 7 tool imports
- ✅ MUST remove all 7 tool registrations
- ✅ MUST update MCPRegistrationService to MCPConfigManagerService (import + registration)
- ✅ Build must pass after changes

**Verification Commands**:

```bash
# Verify no references to deleted tools
grep -r "AnalyzeWorkspaceTool" --include="*.ts" D:/projects/ptah-extension/libs/ D:/projects/ptah-extension/apps/
grep -r "LMToolsRegistrationService" --include="*.ts" D:/projects/ptah-extension/libs/ D:/projects/ptah-extension/apps/
grep -r "MCPRegistrationService" --include="*.ts" D:/projects/ptah-extension/libs/ D:/projects/ptah-extension/apps/
# All should return 0 results

# Verify build passes
npx nx build ptah-extension-vscode
```

---

**Batch 4 Verification Requirements**:

- ✅ All 6 tool files deleted
- ✅ LMToolsRegistrationService file deleted
- ✅ MCPRegistrationService file deleted
- ✅ All tool exports removed from library index
- ✅ All 7 tokens removed from tokens.ts
- ✅ MCP_REGISTRATION_SERVICE renamed to MCP_CONFIG_MANAGER_SERVICE
- ✅ All 7 tool registrations removed from container.ts
- ✅ MCPConfigManagerService registered in container
- ✅ No remaining references to deleted tools/services
- ✅ Build passes: `npx nx build ptah-extension-vscode`
- ✅ Grep verification passes (0 results for deleted tools)

---

## Batch 5: Update Exports & Remove languageModelTools (Finalization) ⏸️ PENDING

**Assigned To**: backend-developer
**Tasks in Batch**: 3
**Dependencies**: Batch 4 complete (all deletions must be done first)
**Estimated Time**: 30 minutes

### Task 5.1: Update claude-domain exports 🔄 IMPLEMENTED

**File(s)**: `D:\projects\ptah-extension\libs\backend\claude-domain\src\index.ts`
**Action**: MODIFY (ADD MCPConfigManagerService export, REMOVE MCPRegistrationService export)
**Specification Reference**: implementation-plan.md:649-664
**Expected Commit Pattern**: `refactor(vscode): update claude-domain exports`

**Description**: Update library exports to export new MCPConfigManagerService and remove broken MCPRegistrationService.

**Implementation Details**:

**Code to ADD**:

```typescript
// ✅ ADD this export:
export { MCPConfigManagerService } from './cli/mcp-config-manager.service';
```

**Code to REMOVE**:

```typescript
// ❌ REMOVE this export:
export { MCPRegistrationService } from './cli/mcp-registration.service';
```

**Quality Requirements**:

- ✅ MUST export MCPConfigManagerService
- ✅ MUST remove MCPRegistrationService export
- ✅ Build must pass after changes

---

### Task 5.2: Remove languageModelTools from package.json 🔄 IMPLEMENTED

**File(s)**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json`
**Action**: MODIFY (DELETE entire languageModelTools array)
**Specification Reference**: implementation-plan.md:528-530
**Expected Commit Pattern**: `chore(vscode): remove language model tools from package.json`

**Description**: Remove the entire `languageModelTools` contribution from package.json (6 tool definitions that only work with GitHub Copilot).

**Implementation Details**:

**Code to DELETE** (from `contributes` section):

```json
{
  "contributes": {
    // ❌ DELETE entire languageModelTools array (approximately lines 86-233):
    "languageModelTools": [
      {
        "name": "ptah_analyze_workspace"
        // ... tool definition
      },
      {
        "name": "ptah_search_files"
        // ... tool definition
      },
      {
        "name": "ptah_get_relevant_files"
        // ... tool definition
      },
      {
        "name": "ptah_get_diagnostics"
        // ... tool definition
      },
      {
        "name": "ptah_find_symbol"
        // ... tool definition
      },
      {
        "name": "ptah_get_git_status"
        // ... tool definition
      }
    ]
  }
}
```

**Quality Requirements**:

- ✅ MUST delete entire `languageModelTools` array
- ✅ MUST preserve other `contributes` sections (commands, configuration, etc.)
- ✅ JSON syntax must remain valid
- ✅ Build must pass after changes

**Verification Commands**:

```bash
# Verify JSON syntax
npx nx lint ptah-extension-vscode

# Verify languageModelTools removed
grep -n "languageModelTools" D:/projects/ptah-extension/apps/ptah-extension-vscode/package.json
# Should return 0 results
```

---

### Task 5.3: Final build verification and manual testing checklist ⏸️ PENDING

**File(s)**: N/A (verification task)
**Action**: VERIFY
**Specification Reference**: implementation-plan.md:930-993
**Expected Commit Pattern**: N/A (no commit, verification only)

**Description**: Perform final build verification and create manual testing checklist for QA.

**Implementation Details**:

**Build Verification**:

```bash
# Full workspace build
npx nx build ptah-extension-vscode

# Linting
npx nx lint ptah-extension-vscode

# Type checking
npx nx run ptah-extension-vscode:typecheck

# Verify no references to deleted code
grep -r "AnalyzeWorkspaceTool" --include="*.ts" D:/projects/ptah-extension/ | wc -l  # Should be 0
grep -r "LMToolsRegistrationService" --include="*.ts" D:/projects/ptah-extension/ | wc -l  # Should be 0
grep -r "MCPRegistrationService" --include="*.ts" D:/projects/ptah-extension/ | wc -l  # Should be 0
grep -r "languageModelTools" D:/projects/ptah-extension/apps/ptah-extension-vscode/package.json | wc -l  # Should be 0
```

**Manual Testing Checklist** (for QA/User):

**Scenario 1: First-time activation**

- [ ] Delete `.mcp.json` if exists in workspace root
- [ ] Activate Ptah extension
- [ ] Verify `.mcp.json` created with Ptah server entry
- [ ] Verify MCP server running on port 51820
- [ ] Verify GET `http://localhost:51820/health` returns 200 OK
- [ ] Verify `.mcp.json` contains: `{ "mcpServers": { "ptah": { "command": "http", "args": ["http://localhost:51820"] } } }`

**Scenario 2: Port conflict**

- [ ] Bind port 51820 externally (e.g., `nc -l 51820` or any HTTP server)
- [ ] Activate Ptah extension
- [ ] Verify error notification displayed in VS Code
- [ ] Verify notification includes: "Failed to start MCP server on port 51820. Port is already in use. Please change 'ptah.mcpPort' setting..."

**Scenario 3: Custom port**

- [ ] Open VS Code settings
- [ ] Search for "ptah.mcpPort"
- [ ] Verify setting appears with default 51820
- [ ] Set `ptah.mcpPort` to 52000
- [ ] Reload Ptah extension
- [ ] Verify MCP server starts on port 52000 (check logs)
- [ ] Verify `.mcp.json` contains `http://localhost:52000`

**Scenario 4: Config merge (preserve existing MCP servers)**

- [ ] Create `.mcp.json` with existing server:
  ```json
  {
    "mcpServers": {
      "other-server": {
        "command": "node",
        "args": ["server.js"]
      }
    }
  }
  ```
- [ ] Activate Ptah extension
- [ ] Verify `.mcp.json` contains both `other-server` and `ptah`
- [ ] Verify `other-server` entry unchanged

**Scenario 5: Claude CLI integration (END-TO-END)**

- [ ] Ensure Ptah extension activated
- [ ] Verify `.mcp.json` exists with Ptah server entry
- [ ] Open terminal in workspace directory
- [ ] Run `claude` (Claude CLI)
- [ ] In Claude conversation, request code execution (e.g., "analyze the workspace structure")
- [ ] Verify `execute_code` tool is available to Claude
- [ ] Verify code execution succeeds via Ptah API

**Quality Requirements**:

- ✅ All build commands MUST pass
- ✅ All grep verifications MUST return 0 results
- ✅ Manual testing checklist created for QA
- ✅ No compilation errors
- ✅ No linting errors

---

**Batch 5 Verification Requirements**:

- ✅ MCPConfigManagerService exported from claude-domain
- ✅ MCPRegistrationService export removed
- ✅ `languageModelTools` array deleted from package.json
- ✅ JSON syntax valid
- ✅ All builds pass (build, lint, typecheck)
- ✅ No references to deleted code (grep verification)
- ✅ Manual testing checklist ready for QA
- ✅ Final build passes: `npx nx build ptah-extension-vscode`

---

## Batch Execution Protocol

**For Each Batch**:

1. **Team-leader assigns entire batch to developer**
2. **Developer executes ALL tasks in batch** (in order, respecting dependencies)
3. **Developer writes REAL, COMPLETE code** (NO stubs/placeholders)
4. **Developer updates tasks.md** (change task statuses to "🔄 IMPLEMENTED")
5. **Developer returns with implementation report** (list all file paths, NOT commit)
6. **Team-leader verifies files exist** (Read each file)
7. **Team-leader invokes business-analyst** to check for stubs/placeholders
8. **If BA approves**: Team-leader stages files and creates git commit
9. **If BA rejects**: Team-leader returns batch to developer with specific fixes
10. **Team-leader assigns next batch**

**🚨 CRITICAL: Separation of Concerns**:

| Developer Responsibility            | Team-Leader Responsibility |
| ----------------------------------- | -------------------------- |
| Write production-ready code         | Stage files (git add)      |
| Verify build passes                 | Create commits             |
| Update tasks.md to "🔄 IMPLEMENTED" | Invoke business-analyst    |
| Report file paths                   | Handle BA rejections       |
| Focus on CODE QUALITY               | Focus on GIT OPERATIONS    |

**Why?** When developers worry about commits, they create stubs to "get to the commit part". This separation ensures 100% focus on implementation quality.

---

## Completion Criteria

**All batches complete when**:

- ✅ All 5 batch statuses are "✅ COMPLETE"
- ✅ All 5 batch commits verified (created by team-leader)
- ✅ All files exist with REAL implementations
- ✅ Business-analyst approved all batches
- ✅ Final build passes: `npx nx build ptah-extension-vscode`
- ✅ All grep verifications pass (0 results for deleted code)
- ✅ Manual testing checklist ready for QA

---

## Git Commit Message Reference (commitlint rules)

**Allowed Types**: feat, fix, refactor, chore, test, docs
**Allowed Scopes**: vscode, webview, deps, ci, docs, hooks, scripts
**Subject Rules**:

- Lowercase only
- 3-72 characters
- No period at end
- Imperative mood

**Valid Examples**:

- `feat(vscode): add mcp config manager service`
- `feat(vscode): use fixed port for mcp server`
- `refactor(vscode): remove language model tools registration`
- `chore(vscode): delete unused language model tools`

**Invalid Examples** (will fail pre-commit):

- `Feature: Add search` ❌ Wrong type, wrong case
- `feat: Add search` ❌ Missing scope
- `feat(vscode): Add search.` ❌ Period at end, uppercase subject
