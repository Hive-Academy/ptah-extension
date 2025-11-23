# Development Tasks - TASK_2025_016: Code Execution API for Autonomous Claude CLI Tool Usage

**Task Type**: Backend
**Total Tasks**: 10
**Total Batches**: 4
**Batching Strategy**: Layer-based (foundation → services → integration → testing)
**Status**: 2/4 batches complete (50%)

---

## Batch 1: Type Definitions and API Builder (Foundation) - COMPLETE - Assigned to backend-developer

**Assigned To**: backend-developer
**Tasks in Batch**: 2
**Dependencies**: None (foundation layer)
**Estimated Commits**: 2
**Estimated Time**: 2 hours
**Git Commit SHA (Task 1.1)**: 2d955e0
**Git Commit SHA (Task 1.2)**: f1587a6
**Pre-commit Hook Note**: Task 1.2 committed with `--no-verify` flag due to pre-existing TypeScript errors in vscode-core library (unrelated to this task). User approved bypass (Option 2).

### Task 1.1: Create Type Definitions for Code Execution API - COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\types.ts`
**Specification Reference**: implementation-plan.md:365-428
**Pattern to Follow**: N/A (pure type definitions)
**Expected Commit Pattern**: `feat(vscode): add code execution api type definitions`

**Description**: Create TypeScript interfaces for the Code Execution API including PtahAPI, all 7 namespace interfaces (WorkspaceNamespace, SearchNamespace, SymbolsNamespace, DiagnosticsNamespace, GitNamespace, AINamespace, FilesNamespace, CommandsNamespace), MCP protocol types (MCPRequest, MCPResponse, ExecuteCodeParams), and DiagnosticInfo interface.

**Quality Requirements**:

- All 7 namespace interfaces defined with correct method signatures
- MCPRequest interface follows JSON-RPC 2.0 specification (jsonrpc, id, method, params)
- MCPResponse interface includes both result and error patterns
- ExecuteCodeParams includes code (string) and optional timeout (number)
- DiagnosticInfo includes file, message, line, and optional severity
- All async methods return Promise types
- PtahAPI aggregates all 7 namespaces
- No TypeScript compilation errors

**Verification**:

- File exists at specified path
- All exports are present
- TypeScript compiler accepts all type definitions
- No missing type imports

**Git Verification**: ✅ Complete - Commit SHA: 2d955e0

---

### Task 1.2: Implement PtahAPIBuilder Service - COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts`
**Dependencies**: Task 1.1 (requires types.ts)
**Specification Reference**: implementation-plan.md:87-429
**Pattern to Follow**: analyze-workspace.tool.ts:17-24 (injectable service with DI)
**Expected Commit Pattern**: `feat(vscode): add ptah api builder service with 7 namespaces`

**Description**: Create PtahAPIBuilder service that constructs the complete ptah API object with 7 namespaces. Service must be injectable, inject all required workspace-intelligence services via DI container, and provide buildAPI() method that returns complete PtahAPI object. Each namespace must delegate to appropriate existing services (WorkspaceAnalyzerService, ContextOrchestrationService, FileIndexerService, etc.).

**Quality Requirements**:

- @injectable() decorator applied (pattern: analyze-workspace.tool.ts:17)
- All services injected via @inject(TOKENS.X) constructor pattern
- buildAPI() method returns object with all 7 namespaces
- Workspace namespace: analyze(), getInfo(), getProjectType(), getFrameworks()
- Search namespace: findFiles(), getRelevantFiles()
- Symbols namespace: find()
- Diagnostics namespace: getErrors(), getWarnings(), getAll()
- Git namespace: getStatus()
- AI namespace: chat(), selectModel()
- Files namespace: read(), list()
- Commands namespace: execute(), list()
- All namespace methods delegate to verified existing services (no hallucinated APIs)
- Error handling with descriptive messages
- Helper methods: parseSymbolKind(), severityToString()
- No TypeScript compilation errors

**Implementation Details**:

- **Imports to Verify**:

  - `injectable`, `inject` from 'tsyringe'
  - `TOKENS` from '@ptah-extension/vscode-core'
  - `WorkspaceAnalyzerService`, `ContextOrchestrationService`, `FileIndexerService` from '@ptah-extension/workspace-intelligence'
  - `vscode` API
  - Types from './types'

- **DI Constructor Injections**:

  - TOKENS.WORKSPACE_ANALYZER_SERVICE → WorkspaceAnalyzerService
  - TOKENS.CONTEXT_ORCHESTRATION_SERVICE → ContextOrchestrationService
  - TOKENS.FILE_INDEXER_SERVICE → FileIndexerService
  - TOKENS.LOGGER → Logger
  - TOKENS.FILE_SYSTEM_MANAGER → FileSystemManager
  - TOKENS.COMMAND_MANAGER → CommandManager

- **Example Service Delegations**:
  - workspace.analyze() → workspaceAnalyzer.getCurrentWorkspaceInfo() + analyzeWorkspaceStructure()
  - search.findFiles() → contextOrchestration.searchFiles()
  - diagnostics.getErrors() → vscode.languages.getDiagnostics() (filter by Error severity)
  - git.getStatus() → vscode.extensions.getExtension('vscode.git').exports.getAPI(1)
  - ai.chat() → vscode.lm.selectChatModels() + sendRequest()
  - files.read() → fileSystemManager.readFile()
  - commands.execute() → vscode.commands.executeCommand()

**Verification**:

- File exists at specified path
- @injectable() decorator present
- All 7 namespaces implemented with correct method signatures
- All services properly injected
- buildAPI() returns complete PtahAPI object
- No TypeScript compilation errors
- No hallucinated service methods (all verified from existing services)

**Git Verification**: ✅ Complete - Commit SHA: f1587a6 (committed with --no-verify flag, user approved)

---

**Batch 1 Verification Requirements**:

- Both files exist at specified paths
- All 2 git commits present (1 per task)
- Build passes: `npx nx build vscode-lm-tools`
- No TypeScript compilation errors
- Types properly exported
- Service follows injectable pattern

---

## Batch 2: MCP Server Implementation (Core Service) - COMPLETE

**Assigned To**: backend-developer
**Tasks in Batch**: 1
**Dependencies**: Batch 1 complete (requires types.ts and PtahAPIBuilder)
**Estimated Commits**: 1
**Estimated Time**: 2.5 hours
**Git Commit SHA (Task 2.1)**: 7bd78ce

### Task 2.1: Implement CodeExecutionMCP Service - COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\code-execution-mcp.service.ts`
**Dependencies**: Tasks 1.1 and 1.2 (requires types and PtahAPIBuilder)
**Specification Reference**: implementation-plan.md:456-835
**Pattern to Follow**: lm-tools-registration.service.ts:25-69 (lifecycle management), main.ts:88-98 (activation)
**Expected Commit Pattern**: `feat(vscode): add code execution mcp server with http transport`

**Description**: Create CodeExecutionMCP service that provides HTTP MCP server with JSON-RPC 2.0 protocol. Service must start HTTP server on random localhost port, store port in workspace state, implement tools/list and tools/call endpoints, execute TypeScript code using AsyncFunction with timeout protection, and manage server lifecycle (start, stop, dispose).

**Quality Requirements**:

- @injectable() decorator applied
- Implements vscode.Disposable interface
- Constructor injects PtahAPIBuilder, Logger, ExtensionContext
- start() method creates http.Server on random port (listen(0))
- Port stored in workspace state (context.workspaceState.update('ptah.mcp.port', port))
- handleRequest() accepts only POST requests
- handleMCPRequest() supports 'tools/list' and 'tools/call' methods
- tools/list returns single tool definition: execute_code
- tools/call executes TypeScript code with AsyncFunction constructor
- executeCode() injects ptah API object into execution context
- Timeout protection via Promise.race() (default 5000ms, max 30000ms)
- Error handling includes stack traces in MCP error responses
- stop() method closes server and clears workspace state
- dispose() method calls stop()
- All operations logged via Logger
- HTTP server binds to localhost only (security)

**Implementation Details**:

- **Imports to Verify**:

  - `injectable`, `inject` from 'tsyringe'
  - `TOKENS`, `Logger` from '@ptah-extension/vscode-core'
  - `http` from 'http' (Node.js built-in)
  - `vscode` API
  - `PtahAPIBuilder`, `PtahAPI` from './ptah-api-builder.service'
  - Types from './types'

- **HTTP Server Pattern**:

  - Create server: `http.createServer((req, res) => this.handleRequest(req, res))`
  - Listen on random port: `server.listen(0, 'localhost', callback)`
  - Get assigned port: `server.address().port`
  - Store in workspace state for Claude CLI discovery

- **MCP Protocol**:

  - JSON-RPC 2.0 format: `{ jsonrpc: '2.0', id, method, params, result/error }`
  - tools/list response: `{ tools: [{ name: 'execute_code', description, inputSchema }] }`
  - tools/call response: `{ content: [{ type: 'text', text: JSON.stringify(result) }] }`
  - Error codes: -32700 (Parse), -32601 (Method not found), -32602 (Invalid params), -32603 (Internal), -32000 (Execution)

- **AsyncFunction Execution**:
  - Create function: `new (async function(){}).constructor('ptah', code)`
  - Execute with API: `asyncFunction(this.ptahAPI)`
  - Timeout: `Promise.race([executionPromise, timeoutPromise])`
  - Catch all errors and include stack traces

**Verification**:

- File exists at specified path
- @injectable() decorator present
- Implements vscode.Disposable
- start() creates HTTP server on localhost
- Port stored in workspace state
- tools/list endpoint returns execute_code tool
- tools/call endpoint executes code
- Timeout protection works (tested with infinite loop code)
- Error responses include stack traces
- stop() closes server gracefully
- No TypeScript compilation errors

**Git Verification**: ✅ Complete - Commit SHA: 7bd78ce

---

**Batch 2 Verification Requirements**:

- File exists at specified path
- Git commit present
- Build passes: `npx nx build vscode-lm-tools`
- No TypeScript compilation errors
- Service follows injectable and disposable patterns
- HTTP server code compiles

---

## Batch 3: DI Registration and Integration (Infrastructure) - PENDING

**Assigned To**: backend-developer
**Tasks in Batch**: 4
**Dependencies**: Batch 2 complete (requires all services implemented)
**Estimated Commits**: 4
**Estimated Time**: 1.5 hours

### Task 3.1: Register DI Tokens for Code Execution Services - PENDING

**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts`
**Dependencies**: Batch 2 (services must exist to register tokens)
**Specification Reference**: implementation-plan.md:868-909
**Pattern to Follow**: tokens.ts:104-112 (VS Code Language Model Tools section)
**Expected Commit Pattern**: `feat(vscode): register di tokens for code execution services`

**Description**: Add two new DI tokens (PTAH_API_BUILDER and CODE_EXECUTION_MCP) to the VS Code Language Model Tools section in tokens.ts. Tokens must use Symbol.for() pattern and be added both as individual exports and to the TOKENS constant object.

**Quality Requirements**:

- Two new token exports added after line 112:
  - `export const PTAH_API_BUILDER = Symbol.for('PtahAPIBuilder');`
  - `export const CODE_EXECUTION_MCP = Symbol.for('CodeExecutionMCP');`
- Tokens added to TOKENS constant object (after line 261):
  - `PTAH_API_BUILDER,`
  - `CODE_EXECUTION_MCP,`
- Tokens follow Symbol.for() pattern (matches existing tokens)
- Tokens placed in correct section (VS Code Language Model Tools)
- No TypeScript compilation errors

**Verification**:

- tokens.ts modified with 2 new exports
- TOKENS constant includes new tokens
- Build passes: `npx nx build vscode-core`
- No TypeScript compilation errors

**Git Verification**: `git log --oneline -1` shows commit with tokens.ts modification

---

### Task 3.2: Export Code Execution Services from Library Index - PENDING

**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\index.ts`
**Dependencies**: Batch 2 (services must exist to export)
**Specification Reference**: implementation-plan.md:1041-1073
**Pattern to Follow**: vscode-lm-tools/src/index.ts:9-28 (existing exports)
**Expected Commit Pattern**: `feat(vscode): export code execution services from library`

**Description**: Add exports for PtahAPIBuilder, CodeExecutionMCP, and PtahAPI type to the vscode-lm-tools library index. Exports should be added after line 17 in a new "Code Execution MCP exports" section.

**Quality Requirements**:

- Three new exports added after line 17:
  - `export { PtahAPIBuilder } from './lib/code-execution/ptah-api-builder.service';`
  - `export { CodeExecutionMCP } from './lib/code-execution/code-execution-mcp.service';`
  - `export type { PtahAPI } from './lib/code-execution/types';`
- Exports follow existing pattern (service exports, then type exports)
- Comment added: "// Code Execution MCP exports"
- No TypeScript compilation errors

**Verification**:

- index.ts modified with 3 new exports
- Exports accessible from '@ptah-extension/vscode-lm-tools'
- Build passes: `npx nx build vscode-lm-tools`
- No TypeScript compilation errors

**Git Verification**: `git log --oneline -1` shows commit with index.ts modification

---

### Task 3.3: Register Services in DI Container and Start MCP Server - PENDING

**File(s)**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts`
**Dependencies**: Tasks 3.1 and 3.2 (tokens and exports must exist)
**Specification Reference**: implementation-plan.md:915-949
**Pattern to Follow**: main.ts:88-98 (LM Tools registration)
**Expected Commit Pattern**: `feat(vscode): integrate code execution mcp server in extension activation`

**Description**: Add Step 9 to extension activation that starts the CodeExecutionMCP server. Must resolve service from DI container, call start() method, store server in subscriptions for cleanup, and log success with port number.

**Quality Requirements**:

- New Step 9 added after line 98 (after Step 8: Language Model Tools)
- Console log: `console.log('[Activate] Step 9: Starting Code Execution MCP Server...');`
- Resolve service: `const codeExecutionMCP = DIContainer.resolve(TOKENS.CODE_EXECUTION_MCP);`
- Start server: `const mcpPort = await (codeExecutionMCP as { start: () => Promise<number> }).start();`
- Register disposable: `context.subscriptions.push(codeExecutionMCP as vscode.Disposable);`
- Logger info: `logger.info(\`Code Execution MCP Server started on port \${mcpPort}\`);`
- Console log: `console.log(\`[Activate] Step 9: Code Execution MCP Server started (port \${mcpPort})\`);`
- No breaking changes to existing steps
- No TypeScript compilation errors

**Implementation Details**:

- **Service Registration**: Services must be registered in DIContainer.setup() before activation
- **Location**: Check if DIContainer.setup() is in separate container.ts file or inline in main.ts
- **Pattern**: `container.registerSingleton(TOKENS.PTAH_API_BUILDER, PtahAPIBuilder);`
- **Pattern**: `container.registerSingleton(TOKENS.CODE_EXECUTION_MCP, CodeExecutionMCP);`
- **Imports**: Add `TOKENS.PTAH_API_BUILDER, TOKENS.CODE_EXECUTION_MCP` to imports

**Verification**:

- main.ts modified with Step 9
- Server starts on extension activation (manual test)
- Port logged to console
- Server registered in subscriptions (cleanup on deactivate)
- Build passes: `npx nx build ptah-extension-vscode`
- No TypeScript compilation errors

**Git Verification**: `git log --online -1` shows commit with main.ts modification

---

### Task 3.4: Integrate MCP Config in Claude CLI Launcher - PENDING

**File(s)**: `D:\projects\ptah-extension\libs\backend\claude-domain\src\cli\claude-cli-launcher.ts`
**Dependencies**: Task 3.3 (MCP server must be running to get port)
**Specification Reference**: implementation-plan.md:973-1036
**Pattern to Follow**: claude-cli-launcher.ts:100-106 (env object in spawn)
**Expected Commit Pattern**: `feat(vscode): inject mcp config in claude cli launcher`

**Description**: Modify ClaudeCliLauncher.spawnTurn() method to inject MCP server configuration via environment variable. Must retrieve port from workspace state, construct MCP config JSON, and add to spawn environment.

**Quality Requirements**:

- Get port from workspace state before spawn call
- Add ANTHROPIC_MCP_SERVER_PTAH environment variable to spawn env object
- MCP config format: `{ command: 'http', args: [\`http://localhost:\${port}\`] }`
- Only add env var if port exists (conditional)
- JSON.stringify() the config object
- No breaking changes to existing spawn logic
- Environment variable only set when MCP server is running
- No TypeScript compilation errors

**Implementation Details**:

- **Location**: Inside spawnTurn() method, before spawn() call (around lines 40-160)
- **Get Port**: `const mcpPort = this.context?.workspaceState.get('ptah.mcp.port');`
  - NOTE: May need to inject ExtensionContext into ClaudeCliLauncher via DI
  - Check if context already available or needs injection
- **Add to env**:
  ```typescript
  env: {
    ...process.env,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    PYTHONUNBUFFERED: '1',
    NODE_NO_READLINE: '1',
    // ADD: MCP config
    ANTHROPIC_MCP_SERVER_PTAH: mcpPort
      ? JSON.stringify({
          command: 'http',
          args: [`http://localhost:${mcpPort}`]
        })
      : undefined
  }
  ```

**Alternative Strategy** (if env var not working):

- Write MCP config to `.claude_mcp/ptah.json` in workspace root
- Claude CLI auto-discovers MCP servers in this directory
- Cleaner separation, no env var pollution

**Verification**:

- claude-cli-launcher.ts modified
- MCP config injected in environment (check process.env in spawned CLI)
- Claude CLI can connect to MCP server (end-to-end test)
- Build passes: `npx nx build claude-domain`
- No TypeScript compilation errors

**Git Verification**: `git log --oneline -1` shows commit with claude-cli-launcher.ts modification

---

**Batch 3 Verification Requirements**:

- All 4 files modified at specified paths
- All 4 git commits present
- Tokens registered and accessible
- Services exported from library
- MCP server starts on extension activation
- MCP config passed to Claude CLI
- Build passes: `npx nx run-many --target=build --all`
- No TypeScript compilation errors

---

## Batch 4: Testing and Documentation (Quality Assurance) - PENDING

**Assigned To**: backend-developer
**Tasks in Batch**: 3
**Dependencies**: Batch 3 complete (all integration must be working)
**Estimated Commits**: 3
**Estimated Time**: 2 hours

### Task 4.1: Create Unit Tests for PtahAPIBuilder - PENDING

**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.spec.ts`
**Dependencies**: Batch 3 (integration must be complete to test properly)
**Specification Reference**: implementation-plan.md:1265-1307
**Pattern to Follow**: Existing .spec.ts files in workspace-intelligence
**Expected Commit Pattern**: `test(vscode): add unit tests for ptah api builder`

**Description**: Create comprehensive unit tests for PtahAPIBuilder service covering namespace construction, service delegation, and error handling. All service dependencies must be mocked.

**Quality Requirements**:

- Test: buildAPI() returns object with all 7 namespaces
- Test: Each namespace has expected methods
- Test: workspace.analyze() calls workspaceAnalyzer methods
- Test: workspace.getInfo() delegates correctly
- Test: workspace.getProjectType() extracts projectType
- Test: workspace.getFrameworks() extracts frameworks
- Test: search.findFiles() calls contextOrchestration.searchFiles()
- Test: search.getRelevantFiles() calls contextOrchestration.getRelevantFiles()
- Test: symbols.find() calls vscode.commands.executeCommand
- Test: diagnostics.getErrors() filters by Error severity
- Test: diagnostics.getWarnings() filters by Warning severity
- Test: diagnostics.getAll() returns all diagnostics
- Test: git.getStatus() calls VS Code git extension
- Test: ai.chat() calls vscode.lm.selectChatModels() and sendRequest()
- Test: ai.selectModel() returns model metadata
- Test: files.read() delegates to fileSystemManager
- Test: files.list() delegates to fileSystemManager
- Test: commands.execute() calls vscode.commands.executeCommand
- Test: commands.list() returns ptah commands
- Test: Error handling when services throw
- All tests pass
- Code coverage target: 80% minimum

**Mock Requirements**:

- Mock WorkspaceAnalyzerService (getCurrentWorkspaceInfo, analyzeWorkspaceStructure)
- Mock ContextOrchestrationService (searchFiles, getRelevantFiles)
- Mock FileIndexerService
- Mock FileSystemManager (readFile, readDirectory)
- Mock CommandManager
- Mock vscode.languages.getDiagnostics()
- Mock vscode.lm.selectChatModels()
- Mock vscode.commands.executeCommand()
- Mock vscode.extensions.getExtension('vscode.git')

**Verification**:

- Test file exists at specified path
- All 20+ test cases present
- All tests pass: `npx nx test vscode-lm-tools`
- Code coverage at least 80% for ptah-api-builder.service.ts
- No test failures

**Git Verification**: `git log --oneline -1` shows commit with test file creation

---

### Task 4.2: Create Unit Tests for CodeExecutionMCP - PENDING

**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\code-execution-mcp.service.spec.ts`
**Dependencies**: Batch 3 (integration must be complete to test properly)
**Specification Reference**: implementation-plan.md:1310-1357
**Pattern to Follow**: Existing .spec.ts files in workspace-intelligence
**Expected Commit Pattern**: `test(vscode): add unit tests for code execution mcp server`

**Description**: Create comprehensive unit tests for CodeExecutionMCP service covering server lifecycle, MCP protocol, code execution, timeout scenarios, and error handling.

**Quality Requirements**:

- Test: start() creates HTTP server on localhost
- Test: start() stores port in workspace state
- Test: start() returns assigned port number
- Test: stop() closes server and clears workspace state
- Test: dispose() calls stop()
- Test: Starting already-started server returns existing port
- Test: POST /tools/list returns execute_code tool definition
- Test: POST /tools/call executes code and returns result
- Test: Non-POST requests return 405 Method Not Allowed
- Test: Invalid JSON returns 400 Parse Error
- Test: Unknown method returns -32601 Method Not Found
- Test: Unknown tool returns -32602 Invalid Params
- Test: Simple sync code executes correctly
- Test: Async code with await executes correctly
- Test: Code with return statement returns value
- Test: ptah API accessible in code context
- Test: Timeout protection works (code exceeding timeout throws)
- Test: Syntax errors return structured error response
- Test: Runtime errors include stack traces
- Test: Custom timeout (< 30000ms) respected
- Test: Timeout > 30000ms capped at 30000ms
- All tests pass
- Code coverage target: 80% minimum

**Mock Requirements**:

- Mock PtahAPIBuilder (buildAPI returns mock API object)
- Mock Logger (info, error, warn methods)
- Mock ExtensionContext (workspaceState.get/update)
- HTTP client for testing (node:http or supertest)

**Verification**:

- Test file exists at specified path
- All 20+ test cases present
- All tests pass: `npx nx test vscode-lm-tools`
- Code coverage at least 80% for code-execution-mcp.service.ts
- No test failures

**Git Verification**: `git log --oneline -1` shows commit with test file creation

---

### Task 4.3: Create Integration Tests for End-to-End Flow - PENDING

**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\integration.spec.ts`
**Dependencies**: Tasks 4.1 and 4.2 (unit tests must pass first)
**Specification Reference**: implementation-plan.md:1360-1391
**Pattern to Follow**: Existing integration test files
**Expected Commit Pattern**: `test(vscode): add integration tests for code execution end-to-end flow`

**Description**: Create integration tests that verify the complete flow from HTTP request → MCP protocol → code execution → response. Tests should use real services (not mocks) where possible.

**Quality Requirements**:

- Test: HTTP request → Code execution → JSON response (end-to-end)
- Test: Multiple sequential requests to same server instance
- Test: Concurrent requests handled correctly
- Test: Code calling ptah.workspace.analyze() returns real workspace data
- Test: Code calling ptah.search.findFiles() returns real file results
- Test: Code calling ptah.diagnostics.getErrors() returns real diagnostics
- Test: Code composing multiple ptah API calls in sequence
- Test: Code with error handling (try/catch)
- Test: Code returning complex objects (nested structures)
- Test: Service errors propagate to HTTP response
- Test: Timeout errors return proper MCP error response
- Test: Malformed MCP requests return appropriate error codes
- All tests pass
- Integration tests run in isolated test workspace

**Test Setup Requirements**:

- Real DIContainer with registered services
- Real workspace folder for testing (test fixtures)
- HTTP client for making MCP requests
- Cleanup after each test (stop server, clear state)

**Verification**:

- Test file exists at specified path
- All 12+ integration test cases present
- All tests pass: `npx nx test vscode-lm-tools`
- Tests use real services (not mocks) where appropriate
- No test failures

**Git Verification**: `git log --oneline -1` shows commit with integration test file creation

---

**Batch 4 Verification Requirements**:

- All 3 test files exist at specified paths
- All 3 git commits present
- All unit tests pass: `npx nx test vscode-lm-tools`
- Code coverage at least 80% for both services
- Integration tests pass with real services
- No test failures

---

## Batch Execution Protocol

**For Each Batch**:

1. Team-leader assigns entire batch to developer
2. Developer executes ALL tasks in batch (in order)
3. Developer stages files progressively (git add after each task)
4. Developer creates commits for each completed task (per task, not per batch)
5. Developer returns with batch completion report and all task commit SHAs
6. Team-leader verifies entire batch
7. If verification passes: Assign next batch
8. If verification fails: Create fix batch

**Commit Strategy**:

- ONE commit per task (not per batch)
- Each commit message follows pattern specified in task
- Commits created immediately after completing each task
- All commits follow commitlint rules (type(scope): description)
- Maintains verifiability and granular history

**Completion Criteria**:

- All batch statuses are "COMPLETE"
- All task commits verified (total 10 commits for 10 tasks)
- All files exist
- Build passes for all affected libraries
- All tests pass

---

## Verification Protocol

**After Batch Completion**:

1. Developer updates all task statuses in batch to "COMPLETE"
2. Developer adds git commit SHA to each task
3. Team-leader verifies:
   - All task commits exist: `git log --oneline -10`
   - All files in batch exist: `Read([file-path])` for each task
   - Build passes: `npx nx run-many --target=build --all`
   - Dependencies respected: Task order maintained
4. If all pass: Update batch status to "COMPLETE", assign next batch
5. If any fail: Mark batch as "PARTIAL", create fix batch

---

## Pre-Implementation Verification Checklist

**Before starting implementation, developer MUST verify**:

1. **All imports exist in codebase**:

   - `WorkspaceAnalyzerService` from `@ptah-extension/workspace-intelligence` (verified: tokens.ts:67)
   - `ContextOrchestrationService` from `@ptah-extension/workspace-intelligence` (verified: tokens.ts:77)
   - `FileIndexerService` from `@ptah-extension/workspace-intelligence` (verified: tokens.ts:66)
   - `TOKENS` from `@ptah-extension/vscode-core` (verified: tokens.ts exists)
   - `injectable`, `inject` from `tsyringe` (verified: analyze-workspace.tool.ts:12)

2. **All patterns verified from examples**:

   - @injectable() pattern (verified: analyze-workspace.tool.ts:17)
   - @inject(TOKENS.X) pattern (verified: analyze-workspace.tool.ts:22-24)
   - Service delegation pattern (verified: existing tools)
   - Disposable lifecycle (verified: existing services)

3. **Library documentation consulted**:

   - vscode-lm-tools/README.md (tool architecture patterns)
   - vscode-core/CLAUDE.md (DI container usage)
   - claude-domain/CLAUDE.md (ClaudeCliLauncher integration)

4. **No hallucinated APIs**:
   - All decorators verified: @injectable() (tsyringe), @inject() (tsyringe)
   - All base classes verified: vscode.Disposable
   - All service methods verified from existing implementations

---

## Manual Testing Checklist (After All Batches Complete)

**Before marking TASK_2025_016 as complete**:

1. **Server Startup**:

   - [ ] MCP server starts on extension activation (check logs)
   - [ ] Port number logged and stored in workspace state
   - [ ] Server accessible via HTTP client on localhost

2. **MCP Protocol**:

   - [ ] HTTP POST to /tools/list returns execute_code tool
   - [ ] HTTP POST to /tools/call executes simple code (return 1 + 1)
   - [ ] Invalid requests return proper error codes

3. **API Functionality**:

   - [ ] ptah.workspace.analyze() returns workspace info
   - [ ] ptah.search.findFiles('\*.ts') returns TypeScript files
   - [ ] ptah.diagnostics.getErrors() returns current errors
   - [ ] ptah.ai.chat('Hello') calls VS Code LM API

4. **Claude CLI Integration**:

   - [ ] Claude CLI spawned with MCP config in environment
   - [ ] Claude CLI can discover MCP server via workspace state
   - [ ] Claude CLI execute_code tool calls work end-to-end
   - [ ] Multi-turn conversation maintains MCP connection

5. **Error Scenarios**:

   - [ ] Timeout protection works (infinite loop terminates)
   - [ ] Syntax errors return helpful messages
   - [ ] Service errors propagate correctly

6. **Cleanup**:
   - [ ] Server stops on extension deactivation
   - [ ] Workspace state cleared
   - [ ] No orphaned processes

---

## Success Criteria (Architecture-Level)

- All 10 tasks complete with verified git commits
- All 4 batches complete and verified
- Build passes for all affected libraries (vscode-core, vscode-lm-tools, claude-domain, ptah-extension-vscode)
- All unit tests pass (80%+ coverage)
- All integration tests pass
- Manual testing checklist complete
- MCP server starts/stops cleanly
- Claude CLI integration working end-to-end
- No TypeScript compilation errors
- No breaking changes to existing functionality

---

**Implementation Ready**: All tasks defined with atomic scope, clear acceptance criteria, and git-verifiable outcomes. Ready for backend-developer assignment.
