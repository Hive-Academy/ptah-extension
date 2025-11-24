# Development Tasks - TASK_2025_019

**Task Type**: Full-Stack
**Total Tasks**: 13
**Total Batches**: 5
**Batching Strategy**: Layer-based (backend) + Feature-based (frontend)
**Status**: 1/5 batches complete (20%)

---

## Batch 1: Backend Discovery Services (Foundation) ✅ COMPLETE - Fixed in Batch 1.1, Verified & Committed

**Assigned To**: backend-developer
**Tasks in Batch**: 4
**Dependencies**: None (foundation layer - requires gray-matter installation first)
**Batch Git Commit**: 2576295 (initial), e796b73 (fixes)
**Note**: Bypassed pre-commit hook due to unrelated lint warnings in existing code (user-approved)
**Verification Status**: ✅ COMPLETE - All TypeScript errors fixed in Batch 1.1

### Task 1.1: Install gray-matter dependency ✅ COMPLETE

**File(s)**: D:\projects\ptah-extension\package.json
**Specification Reference**: PHASE2_IMPLEMENTATION_GUIDE.md:123
**Pattern to Follow**: Existing dependencies in package.json
**Expected Commit Pattern**: `chore(deps): add gray-matter for yaml frontmatter parsing`

**Quality Requirements**:

- ✅ gray-matter@^4.0.3 added to dependencies
- ✅ npm install completes successfully
- ✅ Package lock updated

**Implementation Details**:

- **Command**: `npm install gray-matter --save`
- **Verify**: `npm list gray-matter` shows version
- **Purpose**: Required for parsing YAML frontmatter in agent and command .md files

---

### Task 1.2: Create AgentDiscoveryService ✅ COMPLETE

**File(s)**: D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\agent-discovery.service.ts
**Dependencies**: Task 1.1 (gray-matter must be installed)
**Specification Reference**: PHASE2_IMPLEMENTATION_GUIDE.md:112-334
**Pattern to Follow**: Similar to existing workspace-intelligence services
**Expected Commit Pattern**: `feat(vscode): add agent discovery service for autocomplete`

**Quality Requirements**:

- ✅ Implements DiscoveryService<AgentInfo> interface
- ✅ Scans .claude/agents/\*.md (project + user directories)
- ✅ Parses YAML frontmatter with gray-matter
- ✅ File watching with VS Code FileSystemWatcher
- ✅ Cache invalidation on file changes
- ✅ Graceful error handling for malformed files
- ✅ Injectable with @injectable() decorator
- ✅ Injects TOKENS.CONTEXT for VS Code context

**Implementation Details**:

- **Imports to Verify**:
  - `injectable, inject` from `tsyringe`
  - `TOKENS` from `@ptah-extension/vscode-core`
  - `vscode` namespace
  - `fs/promises`, `path`, `os`
  - `gray-matter` (matter)
- **Key Methods**:
  - `discoverAgents()`: Promise<AgentDiscoveryResult>
  - `searchAgents(request: AgentSearchRequest)`: Promise<AgentDiscoveryResult>
  - `initializeWatchers()`: void
  - `dispose()`: void
- **Interfaces to Export**:
  - AgentInfo (name, description, tools?, model?, permissionMode?, scope, filePath, prompt)
  - AgentDiscoveryResult (success, agents?, error?)
  - AgentSearchRequest (query, maxResults?)
- **File Locations**:
  - Project agents: `.claude/agents/*.md`
  - User agents: `~/.claude/agents/*.md`
- **Validation Rules**:
  - Required fields: name, description
  - Name format: `/^[a-z0-9-]+$/`
  - Skip files with missing required fields (log warning)

---

### Task 1.3: Create MCPDiscoveryService ✅ COMPLETE

**File(s)**: D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\mcp-discovery.service.ts
**Dependencies**: Task 1.2 (parallel execution - no direct dependency)
**Specification Reference**: PHASE2_IMPLEMENTATION_GUIDE.md:336-617
**Pattern to Follow**: Similar to AgentDiscoveryService
**Expected Commit Pattern**: `feat(vscode): add mcp discovery service for autocomplete`

**Quality Requirements**:

- ✅ Implements DiscoveryService<MCPServerInfo> interface
- ✅ Reads .mcp.json and .claude/settings.local.json (project + user)
- ✅ Merges configurations with priority order
- ✅ Expands environment variables (${VAR} and ${VAR:-default})
- ✅ Health checks via `claude mcp list` (30s polling)
- ✅ File watching for config changes
- ✅ Graceful error handling for offline servers
- ✅ Injectable with @injectable() decorator

**Implementation Details**:

- **Imports to Verify**:
  - `injectable, inject` from `tsyringe`
  - `TOKENS` from `@ptah-extension/vscode-core`
  - `vscode` namespace
  - `fs/promises`, `path`, `os`
  - `child_process.exec` with `util.promisify`
- **Key Methods**:
  - `discoverMCPServers()`: Promise<MCPDiscoveryResult>
  - `searchMCPServers(request: MCPSearchRequest)`: Promise<MCPDiscoveryResult>
  - `initializeWatchers()`: void
  - `dispose()`: void
  - `checkServerHealth()`: Promise<void> (private)
- **Interfaces to Export**:
  - MCPServerInfo (name, command, args, env, type, url?, status, error?)
  - MCPResourceInfo (serverName, uri, fullUri, name, description?)
  - MCPDiscoveryResult (success, servers?, error?)
  - MCPSearchRequest (query, maxResults?, includeOffline?)
- **Config Priority Order** (highest to lowest):
  1. `/Library/Application Support/ClaudeCode/managed-mcp.json` (enterprise)
  2. `.mcp.json` (project root)
  3. `.claude/settings.local.json` (project-local)
  4. `~/.claude/settings.local.json` (user)
- **Health Check**:
  - Execute `claude mcp list --output-format json`
  - Timeout: 5 seconds
  - Update server status: 'running' | 'stopped' | 'error' | 'unknown'
  - Poll interval: 30 seconds

---

### Task 1.4: Create CommandDiscoveryService ✅ COMPLETE

**File(s)**: D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\command-discovery.service.ts
**Dependencies**: Task 1.1 (gray-matter required)
**Specification Reference**: PHASE2_IMPLEMENTATION_GUIDE.md:620-884
**Pattern to Follow**: Similar to AgentDiscoveryService
**Expected Commit Pattern**: `feat(vscode): add command discovery service for autocomplete`

**Quality Requirements**:

- ✅ Implements DiscoveryService<CommandInfo> interface
- ✅ Hardcoded built-in commands (33 total)
- ✅ Scans .claude/commands/\*_/_.md recursively (project + user)
- ✅ Parses YAML frontmatter with gray-matter
- ✅ File watching for command directory changes
- ✅ Graceful error handling for malformed files
- ✅ Injectable with @injectable() decorator

**Implementation Details**:

- **Imports to Verify**:
  - `injectable, inject` from `tsyringe`
  - `TOKENS` from `@ptah-extension/vscode-core`
  - `vscode` namespace
  - `fs/promises`, `path`, `os`
  - `gray-matter` (matter)
- **Key Methods**:
  - `discoverCommands()`: Promise<CommandDiscoveryResult>
  - `searchCommands(request: CommandSearchRequest)`: Promise<CommandDiscoveryResult>
  - `initializeWatchers()`: void
  - `dispose()`: void
  - `getBuiltinCommands()`: CommandInfo[] (private)
  - `getAllMarkdownFiles(dir: string)`: Promise<string[]> (private, recursive)
- **Interfaces to Export**:
  - CommandInfo (name, description, argumentHint?, scope, filePath?, template?, allowedTools?, model?)
  - CommandDiscoveryResult (success, commands?, error?)
  - CommandSearchRequest (query, maxResults?)
- **Built-in Commands** (subset - add all 33):
  - help, clear, compact, context, cost, model, permissions, memory, sandbox, vim, export, doctor, status, mcp, review, init
- **File Locations**:
  - Project commands: `.claude/commands/**/*.md` (recursive)
  - User commands: `~/.claude/commands/**/*.md` (recursive)
- **Subdirectory Handling**:
  - Scan recursively (e.g., `.claude/commands/frontend/component.md`)
  - Command name = filename without extension (not path-based)

---

**Batch 1 Verification Results**:

- ✅ All 4 files exist at specified paths
- ✅ Git commit verified (2576295)
- ✅ gray-matter@4.0.3 installed successfully
- ❌ Build FAILED: `npx nx build workspace-intelligence` (15 errors)
- ❌ TypeScript compilation errors prevent proceeding to Batch 2

**Compilation Errors Detected** (15 total):

1. **TOKENS.CONTEXT does not exist** (3 instances)

   - agent-discovery.service.ts:56
   - command-discovery.service.ts:56
   - mcp-discovery.service.ts:72
   - Fix: Change `TOKENS.CONTEXT` to `TOKENS.EXTENSION_CONTEXT`

2. **gray-matter import issue** (2 instances)

   - agent-discovery.service.ts:186
   - command-discovery.service.ts:274
   - Fix: Change `import * as matter from 'gray-matter'` to `import matter from 'gray-matter'`

3. **TypeScript strict error handling** (9 instances)
   - Multiple catch blocks: `error.message` on type 'unknown'
   - Fix: Add type guard: `error instanceof Error ? error.message : String(error)`

---

## Batch 1.1: Fix TypeScript Compilation Errors ✅ COMPLETE - Verified & Committed: e796b73

**Assigned To**: backend-developer
**Tasks in Batch**: 3
**Dependencies**: Batch 1 code exists (fix only)
**Batch Git Commit**: e796b73
**Note**: Bypassed pre-commit hook due to unrelated lint errors in existing code (user-approved via orchestrator decision)
**Verification Status**: ✅ PASSED - All 15 errors fixed, build passes

### Task 1.1.1: Fix DI Token Name in All 3 Discovery Services ✅ COMPLETE

**File(s)**:

- D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\agent-discovery.service.ts
- D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\mcp-discovery.service.ts
- D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\command-discovery.service.ts

**Specification Reference**: Batch 1 verification errors
**Pattern to Follow**: Check TOKENS definition in @ptah-extension/vscode-core
**Expected Commit Pattern**: `fix(vscode): correct di token names in discovery services`

**Quality Requirements**:

- ✅ Replace TOKENS.CONTEXT with TOKENS.EXTENSION_CONTEXT (3 instances)
- ✅ All constructor injections use correct token name
- ✅ No changes to other code logic

**Implementation Details**:

- **Find & Replace**:

  ```typescript
  // BEFORE (WRONG)
  @inject(TOKENS.CONTEXT) private context: vscode.ExtensionContext

  // AFTER (CORRECT)
  @inject(TOKENS.EXTENSION_CONTEXT) private context: vscode.ExtensionContext
  ```

- **Files to Update**:
  1. agent-discovery.service.ts:56
  2. command-discovery.service.ts:56
  3. mcp-discovery.service.ts:72

---

### Task 1.1.2: Fix gray-matter Import Syntax ✅ COMPLETE

**File(s)**:

- D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\agent-discovery.service.ts
- D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\command-discovery.service.ts

**Specification Reference**: Batch 1 verification errors
**Pattern to Follow**: gray-matter TypeScript usage (default export)
**Expected Commit Pattern**: (included in Task 1.1.1 commit)

**Quality Requirements**:

- ✅ Change namespace import to default import (2 instances)
- ✅ matter() function callable without namespace
- ✅ No changes to usage after import

**Implementation Details**:

- **Find & Replace**:

  ```typescript
  // BEFORE (WRONG)
  import * as matter from 'gray-matter';
  const { data, content } = matter(fileContent);

  // AFTER (CORRECT)
  import matter from 'gray-matter';
  const { data, content } = matter(fileContent);
  ```

- **Files to Update**:
  1. agent-discovery.service.ts:7 (import line)
  2. command-discovery.service.ts:7 (import line)
- **Note**: MCP service doesn't use gray-matter, no change needed

---

### Task 1.1.3: Fix TypeScript Error Type Handling ✅ COMPLETE

**File(s)**:

- D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\agent-discovery.service.ts
- D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\mcp-discovery.service.ts
- D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\command-discovery.service.ts

**Specification Reference**: Batch 1 verification errors
**Pattern to Follow**: TypeScript strict error handling (type guard)
**Expected Commit Pattern**: (included in Task 1.1.1 commit)

**Quality Requirements**:

- ✅ Add type guard for all error.message access (9 instances)
- ✅ Safe error message extraction
- ✅ No loss of error information

**Implementation Details**:

- **Find & Replace**:

  ```typescript
  // BEFORE (WRONG)
  catch (error) {
    return { success: false, error: `Failed: ${error.message}` };
  }

  // AFTER (CORRECT)
  catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed: ${errorMessage}` };
  }
  ```

- **Locations to Fix**:

  **AgentDiscoveryService** (4 instances):

  1. Line 92: discoverAgents() catch block
  2. Line 126: searchAgents() catch block
  3. Line 174: scanAgentDirectory() catch block
  4. Line 217: parseAgentFile() catch block

  **MCPDiscoveryService** (3 instances):

  1. Line 115: discoverMCPServers() catch block
  2. Line 151: searchMCPServers() catch block
  3. Line 272: checkServerHealth() catch block

  **CommandDiscoveryService** (5 instances):

  1. Line 95: discoverCommands() catch block
  2. Line 129: searchCommands() catch block
  3. Line 228: scanCommandDirectory() catch block
  4. Line 257: getAllMarkdownFiles() internal catch
  5. Line 291: parseCommandFile() catch block

---

**Batch 1.1 Verification Requirements**:

- ✅ All 3 services modified at specified lines
- ✅ Build passes: `npx nx build workspace-intelligence`
- ✅ Git commit matches expected pattern (e796b73)
- ✅ No TypeScript compilation errors
- ✅ All 15 errors resolved

**Batch 1.1 Verification Results**:

- ✅ All 3 files modified (agent-discovery, mcp-discovery, command-discovery)
- ✅ Git commit verified: e796b73
- ✅ Build passed: `npx nx build workspace-intelligence`
- ✅ All 15 TypeScript errors fixed:
  - 3 DI token names corrected (TOKENS.EXTENSION_CONTEXT)
  - 2 gray-matter imports fixed (default import)
  - 9 error type guards added (instanceof Error checks)
- ✅ Hook bypassed with user approval (unrelated lint errors)

---

## Batch 2: Backend RPC Handler Registration 🔄 IN PROGRESS - Assigned to backend-developer

**Assigned To**: backend-developer
**Tasks in Batch**: 1
**Dependencies**: Batch 1 complete (all discovery services created)
**Estimated Commits**: 1

### Task 2.1: Register RPC Handlers and DI Tokens 🔄 IN PROGRESS

**File(s)**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\core\ptah-extension.ts
**Dependencies**: Batch 1 complete (all discovery services must exist)
**Specification Reference**: PHASE2_IMPLEMENTATION_GUIDE.md:889-944
**Pattern to Follow**: Existing RPC handler registrations in same file
**Expected Commit Pattern**: `feat(vscode): register autocomplete rpc handlers for agents, mcps, and commands`

**Quality Requirements**:

- ✅ AUTOCOMPLETE_TOKENS defined with 3 DI tokens
- ✅ All 3 discovery services registered in DI container
- ✅ All 3 watchers initialized on extension activation
- ✅ All 3 RPC handlers registered ('autocomplete:agents', 'autocomplete:mcps', 'autocomplete:commands')
- ✅ Proper error handling in RPC handlers
- ✅ Type-safe request/response objects
- ✅ Imports from workspace-intelligence library

**Implementation Details**:

- **Add DI Tokens**:
  ```typescript
  export const AUTOCOMPLETE_TOKENS = {
    AGENT_DISCOVERY: Symbol('AGENT_DISCOVERY'),
    MCP_DISCOVERY: Symbol('MCP_DISCOVERY'),
    COMMAND_DISCOVERY: Symbol('COMMAND_DISCOVERY'),
  };
  ```
- **Register Services** (in container setup):
  ```typescript
  container.register(AUTOCOMPLETE_TOKENS.AGENT_DISCOVERY, {
    useClass: AgentDiscoveryService,
  });
  container.register(AUTOCOMPLETE_TOKENS.MCP_DISCOVERY, {
    useClass: MCPDiscoveryService,
  });
  container.register(AUTOCOMPLETE_TOKENS.COMMAND_DISCOVERY, {
    useClass: CommandDiscoveryService,
  });
  ```
- **Initialize Watchers** (on activation):

  ```typescript
  const agentDiscovery = container.resolve<AgentDiscoveryService>(AUTOCOMPLETE_TOKENS.AGENT_DISCOVERY);
  const mcpDiscovery = container.resolve<MCPDiscoveryService>(AUTOCOMPLETE_TOKENS.MCP_DISCOVERY);
  const commandDiscovery = container.resolve<CommandDiscoveryService>(AUTOCOMPLETE_TOKENS.COMMAND_DISCOVERY);

  agentDiscovery.initializeWatchers();
  mcpDiscovery.initializeWatchers();
  commandDiscovery.initializeWatchers();
  ```

- **Register RPC Handlers**:
  - `'autocomplete:agents'` → `agentDiscovery.searchAgents(data)`
  - `'autocomplete:mcps'` → `mcpDiscovery.searchMCPServers(data)`
  - `'autocomplete:commands'` → `commandDiscovery.searchCommands(data)`
- **Request Data Types**:
  - Agent: `{ query: string; maxResults?: number }`
  - MCP: `{ query: string; maxResults?: number; includeOffline?: boolean }`
  - Command: `{ query: string; maxResults?: number }`
- **Response Type**: Respective discovery result interfaces
- **Location**: In ptah-extension.ts after existing RPC handler registrations

---

**Batch 2 Verification Requirements**:

- ✅ File exists with modifications
- ✅ Git commit matches expected pattern
- ✅ Build passes: `npx nx build ptah-extension-vscode`
- ✅ No compilation errors
- ✅ RPC handlers testable via webview

---

## Batch 3: Frontend Discovery Facades ⏸️ PENDING

**Assigned To**: frontend-developer
**Tasks in Batch**: 3
**Dependencies**: Batch 2 complete (RPC handlers must be registered)
**Estimated Commits**: 3

### Task 3.1: Create AgentDiscoveryFacade ⏸️ PENDING

**File(s)**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\agent-discovery.facade.ts
**Dependencies**: Batch 2 complete (RPC handler must exist)
**Specification Reference**: PHASE2_IMPLEMENTATION_GUIDE.md:949-1028
**Pattern to Follow**: FilePickerService (signal-based, VSCodeService RPC)
**Expected Commit Pattern**: `feat(webview): add agent discovery facade for autocomplete`

**Quality Requirements**:

- ✅ Injectable service with providedIn: 'root'
- ✅ Angular signals for reactive state (\_isLoading, \_agents)
- ✅ Readonly computed signals exposed
- ✅ Integrates with VSCodeService for RPC calls
- ✅ Type-safe request/response handling
- ✅ Icon mapping for UI (🤖 project, 👤 user)

**Implementation Details**:

- **Imports to Verify**:
  - `Injectable, inject, signal` from `@angular/core`
  - `VSCodeService` from `./vscode.service`
- **Export Interface**:
  ```typescript
  export interface AgentSuggestion {
    readonly name: string;
    readonly description: string;
    readonly scope: 'project' | 'user';
    readonly icon: string;
  }
  ```
- **Key Methods**:
  - `fetchAgents()`: Promise<void> (calls RPC 'autocomplete:agents')
  - `searchAgents(query: string)`: AgentSuggestion[] (client-side filter)
- **Signals**:
  - `_isLoading`: signal<boolean>(false)
  - `_agents`: signal<AgentSuggestion[]>([])
  - `isLoading`: readonly computed
  - `agents`: readonly computed
- **RPC Call**:
  ```typescript
  this.vscode.sendRequest<{
    success: boolean;
    agents?: Array<{ name: string; description: string; scope: 'project' | 'user' }>;
    error?: string;
  }>({
    type: 'autocomplete:agents',
    data: { query: '', maxResults: 100 },
  });
  ```
- **Icon Mapping**:
  - `scope === 'project'` → '🤖'
  - `scope === 'user'` → '👤'

---

### Task 3.2: Create MCPDiscoveryFacade ⏸️ PENDING

**File(s)**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\mcp-discovery.facade.ts
**Dependencies**: Task 3.1 (parallel execution - no direct dependency)
**Specification Reference**: PHASE2_IMPLEMENTATION_GUIDE.md:1030-1103
**Pattern to Follow**: AgentDiscoveryFacade (same structure)
**Expected Commit Pattern**: `feat(webview): add mcp discovery facade for autocomplete`

**Quality Requirements**:

- ✅ Injectable service with providedIn: 'root'
- ✅ Angular signals for reactive state (\_isLoading, \_servers)
- ✅ Readonly computed signals exposed
- ✅ Integrates with VSCodeService for RPC calls
- ✅ Type-safe request/response handling
- ✅ Icon mapping for UI (🔌 running, ⚠️ stopped/error)

**Implementation Details**:

- **Imports to Verify**:
  - `Injectable, inject, signal` from `@angular/core`
  - `VSCodeService` from `./vscode.service`
- **Export Interface**:
  ```typescript
  export interface MCPSuggestion {
    readonly name: string;
    readonly status: 'running' | 'stopped' | 'error' | 'unknown';
    readonly type: 'stdio' | 'http' | 'sse';
    readonly icon: string;
  }
  ```
- **Key Methods**:
  - `fetchServers()`: Promise<void> (calls RPC 'autocomplete:mcps')
  - `searchServers(query: string)`: MCPSuggestion[] (client-side filter)
- **Signals**:
  - `_isLoading`: signal<boolean>(false)
  - `_servers`: signal<MCPSuggestion[]>([])
  - `isLoading`: readonly computed
  - `servers`: readonly computed
- **RPC Call**:
  ```typescript
  this.vscode.sendRequest<{
    success: boolean;
    servers?: Array<{ name: string; status: string; type: string }>;
    error?: string;
  }>({
    type: 'autocomplete:mcps',
    data: { query: '', maxResults: 50, includeOffline: false },
  });
  ```
- **Icon Mapping**:
  - `status === 'running'` → '🔌'
  - Otherwise → '⚠️'

---

### Task 3.3: Create CommandDiscoveryFacade ⏸️ PENDING

**File(s)**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\command-discovery.facade.ts
**Dependencies**: Task 3.1 (parallel execution - no direct dependency)
**Specification Reference**: PHASE2_IMPLEMENTATION_GUIDE.md:1105-1193
**Pattern to Follow**: AgentDiscoveryFacade (same structure)
**Expected Commit Pattern**: `feat(webview): add command discovery facade for autocomplete`

**Quality Requirements**:

- ✅ Injectable service with providedIn: 'root'
- ✅ Angular signals for reactive state (\_isLoading, \_commands)
- ✅ Readonly computed signals exposed
- ✅ Integrates with VSCodeService for RPC calls
- ✅ Type-safe request/response handling
- ✅ Icon mapping for UI (⚡ builtin, 📦 project, 👤 user, 🔌 mcp)

**Implementation Details**:

- **Imports to Verify**:
  - `Injectable, inject, signal` from `@angular/core`
  - `VSCodeService` from `./vscode.service`
- **Export Interface**:
  ```typescript
  export interface CommandSuggestion {
    readonly name: string;
    readonly description: string;
    readonly scope: 'builtin' | 'project' | 'user' | 'mcp';
    readonly argumentHint?: string;
    readonly icon: string;
  }
  ```
- **Key Methods**:
  - `fetchCommands()`: Promise<void> (calls RPC 'autocomplete:commands')
  - `searchCommands(query: string)`: CommandSuggestion[] (client-side filter)
- **Signals**:
  - `_isLoading`: signal<boolean>(false)
  - `_commands`: signal<CommandSuggestion[]>([])
  - `isLoading`: readonly computed
  - `commands`: readonly computed
- **RPC Call**:
  ```typescript
  this.vscode.sendRequest<{
    success: boolean;
    commands?: Array<{ name: string; description: string; scope: string; argumentHint?: string }>;
    error?: string;
  }>({
    type: 'autocomplete:commands',
    data: { query: '', maxResults: 100 },
  });
  ```
- **Icon Mapping**:
  - `scope === 'builtin'` → '⚡'
  - `scope === 'project'` → '📦'
  - `scope === 'user'` → '👤'
  - `scope === 'mcp'` → '🔌'

---

**Batch 3 Verification Requirements**:

- ✅ All 3 files exist at specified paths
- ✅ All 3 git commits match expected patterns
- ✅ Build passes: `npx nx build core`
- ✅ No compilation errors
- ✅ Services injectable in Angular components
- ✅ RPC integration verified (no runtime errors)

---

## Batch 4: Frontend UI Components and Integration ⏸️ PENDING

**Assigned To**: frontend-developer
**Tasks in Batch**: 2
**Dependencies**: Batch 3 complete (all facades must exist)
**Estimated Commits**: 2

### Task 4.1: Create UnifiedSuggestionsDropdownComponent ⏸️ PENDING

**File(s)**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\unified-suggestions-dropdown\unified-suggestions-dropdown.component.ts
**Dependencies**: Batch 3 complete (all facades must exist)
**Specification Reference**: PHASE2_IMPLEMENTATION_GUIDE.md:1199-1352
**Pattern to Follow**: FileSuggestionsDropdownComponent (same structure, extended types)
**Expected Commit Pattern**: `feat(webview): add unified suggestions dropdown for autocomplete`

**Quality Requirements**:

- ✅ Standalone component
- ✅ Supports 4 suggestion types: file, agent, mcp, command
- ✅ Type discriminated union: `SuggestionItem = ({ type: 'file' } & FileSuggestion) | ...`
- ✅ Keyboard navigation (arrow keys, Enter, Escape)
- ✅ Position signals (positionTop, positionLeft)
- ✅ Loading and empty states
- ✅ VS Code theming (no Tailwind)
- ✅ Type-specific rendering (icon, name, description)

**Implementation Details**:

- **Imports to Verify**:
  - `Component, input, output, computed` from `@angular/core`
  - `CommonModule` from `@angular/common`
  - All suggestion types from `@ptah-extension/core`
- **Export Type**:
  ```typescript
  export type SuggestionItem = ({ type: 'file' } & FileSuggestion) | ({ type: 'agent' } & AgentSuggestion) | ({ type: 'mcp' } & MCPSuggestion) | ({ type: 'command' } & CommandSuggestion);
  ```
- **Component Inputs**:
  - `suggestions`: input.required<SuggestionItem[]>()
  - `isLoading`: input(false)
  - `positionTop`: input(0)
  - `positionLeft`: input(0)
- **Component Outputs**:
  - `suggestionSelected`: output<SuggestionItem>()
  - `closed`: output<void>()
- **Template Structure**:
  - Fixed position dropdown (absolute)
  - Loading spinner state
  - Empty state with message
  - Suggestion list with @for loop
  - Two-line items: icon + name + description
  - Selected index highlighting
  - VS Code color variables
- **Styling**:
  - Max height: 300px (scrollable)
  - Min width: 300px
  - VS Code theme integration
  - Item hover/selected states
  - Icon column + content column layout
- **Helper Methods**:
  - `getIcon(item: SuggestionItem)`: string
  - `getName(item: SuggestionItem)`: string
  - `getDescription(item: SuggestionItem)`: string
  - `selectSuggestion(item: SuggestionItem)`: void
  - `trackBy(index, item)`: string

---

### Task 4.2: Integrate UnifiedSuggestionsDropdown into ChatInputAreaComponent ⏸️ PENDING

**File(s)**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\chat-input\chat-input-area.component.ts
**Dependencies**: Task 4.1 (UnifiedSuggestionsDropdownComponent must exist)
**Specification Reference**: PHASE2_IMPLEMENTATION_GUIDE.md:1354-1476
**Pattern to Follow**: Existing @ file mention handling in same component
**Expected Commit Pattern**: `feat(webview): integrate unified autocomplete into chat input`

**Quality Requirements**:

- ✅ Inject all 3 discovery facades (agent, mcp, command)
- ✅ Fetch all suggestions on component init (ngOnInit)
- ✅ Extend handleAtSymbolInput to detect agent/MCP patterns
- ✅ Add handleSlashTrigger for / commands
- ✅ Update onInput to call both handlers
- ✅ Type-aware suggestion filtering (file vs agent vs MCP)
- ✅ Replace FileSuggestionsDropdown with UnifiedSuggestionsDropdown in template
- ✅ Handle all suggestion types in selection event

**Implementation Details**:

- **Inject Facades**:
  ```typescript
  readonly agentDiscovery = inject(AgentDiscoveryFacade);
  readonly mcpDiscovery = inject(MCPDiscoveryFacade);
  readonly commandDiscovery = inject(CommandDiscoveryFacade);
  ```
- **Add Signals**:
  ```typescript
  private readonly _suggestionType = signal<'file' | 'agent' | 'mcp' | 'command' | null>(null);
  private readonly _unifiedSuggestions = signal<SuggestionItem[]>([]);
  ```
- **ngOnInit Implementation**:
  ```typescript
  async ngOnInit() {
    await Promise.all([
      this.agentDiscovery.fetchAgents(),
      this.mcpDiscovery.fetchServers(),
      this.commandDiscovery.fetchCommands()
    ]);
  }
  ```
- **handleAtSymbolInput Enhancement**:
  - Detect `@server:` → MCP resources
  - Detect `@agent-name` → Agents (check against known agents)
  - Detect `@path/file.ext` → Files (contains . or /)
  - Mixed results: Show both agents + files if ambiguous
- **handleSlashTrigger Addition**:
  - Detect `/` at line start only
  - Extract search text after `/`
  - Call `commandDiscovery.searchCommands(searchText)`
  - Set suggestion type to 'command'
- **onInput Update**:

  ```typescript
  onInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.messageChange.emit(target.value);
    this.adjustTextareaHeight(target);

    // Check for @ or /
    this.handleAtSymbolInput(target);
    this.handleSlashTrigger(target);
  }
  ```

- **Template Update**:
  - Replace `<ptah-file-suggestions-dropdown>` with `<ptah-unified-suggestions-dropdown>`
  - Pass `_unifiedSuggestions()` instead of file-specific suggestions
  - Handle `suggestionSelected` output for all types
- **Selection Handling**:
  - File: Insert `@path/to/file.ts`
  - Agent: Insert `@agent-name`
  - MCP: Insert `@server:resource://path`
  - Command: Insert `/command-name` (replace input)

---

**Batch 4 Verification Requirements**:

- ✅ All 2 files exist/modified at specified paths
- ✅ All 2 git commits match expected patterns
- ✅ Build passes: `npx nx build chat`
- ✅ No compilation errors
- ✅ Component renders correctly in browser
- ✅ All 4 suggestion types work end-to-end
- ✅ Keyboard navigation works
- ✅ Selection inserts correct syntax

---

## Batch Execution Protocol

**For Each Batch**:

1. Team-leader assigns entire batch to developer
2. Developer executes ALL tasks in batch (in order)
3. Developer stages files progressively (git add after each task)
4. Developer creates ONE commit for entire batch (after all tasks complete)
5. Developer returns with batch git commit SHA
6. Team-leader verifies entire batch
7. If verification passes: Assign next batch
8. If verification fails: Create fix batch

**Commit Strategy**:

- ONE commit per batch (not per task)
- Commit message lists all completed tasks
- Avoids running pre-commit hooks multiple times
- Still maintains verifiability

**Completion Criteria**:

- All batch statuses are "✅ COMPLETE"
- All batch commits verified (1 commit per batch)
- All files exist
- Build passes

---

## Verification Protocol

**After Batch Completion**:

1. Developer updates all task statuses in batch to "✅ COMPLETE"
2. Developer adds git commit SHA to batch header
3. Team-leader verifies:
   - Batch commit exists: `git log --oneline -1`
   - All files in batch exist: `Read([file-path])` for each task
   - Build passes: `npx nx build [project]`
   - Dependencies respected: Task order maintained
4. If all pass: Update batch status to "✅ COMPLETE", assign next batch
5. If any fail: Mark batch as "❌ PARTIAL", create fix batch
