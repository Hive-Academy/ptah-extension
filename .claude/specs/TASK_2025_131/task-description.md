# Task Description - TASK_2025_131

**Created**: 2026-02-01
**Product Manager**: product-manager
**Status**: AWAITING USER VALIDATION

---

## 1. Task Overview

### Task Type

FEATURE

### Complexity Assessment

SIMPLE

**Reasoning**: Clear scope - clean out old code, bundle existing MCP server as standalone, configure for live testing. No new implementation needed, just restructuring existing code for standalone execution.

### Timeline Estimate

**Initial Estimate**: 1-2 days
**Timeline Discipline**: ✅ Well under 2-week limit

---

## 2. Business Requirements

### Primary Objective

Transform the `infra-test` application into a **standalone MCP server bundle** that can be tested LIVE using:

1. **MCP Inspector** (`npx @modelcontextprotocol/inspector`) - Visual testing tool
2. **Claude Code via `.mcp.json`** - Direct integration testing with Claude agent

### User Stories

**US1: As a developer**, I want to run the Ptah MCP server standalone (outside VS Code), so that I can test it with MCP Inspector and verify all tools work correctly.

**US2: As a developer**, I want to connect Claude Code to my bundled MCP server via `.mcp.json`, so that I can test the full integration live with the AI agent.

**US3: As a maintainer**, I want a clean infra-test app, so that legacy CLI spawn tests are removed and replaced with the MCP server bundle.

### Success Metrics

- `infra-test` builds successfully as standalone MCP server
- MCP Inspector can connect and list all tools (`execute_code`, `approval_prompt`)
- Claude Code can connect via `.mcp.json` configuration
- All 15 Ptah API namespaces accessible through `execute_code` tool
- Clean codebase (legacy ~1,388 lines of CLI spawn tests removed)

---

## 3. Functional Requirements (SMART Format)

### FR1: Delete Legacy Code

**Specific**: Remove all existing code in `apps/infra-test/src/` (~1,388 lines in main.ts, sdk-test.ts)
**Measurable**: 0 lines of legacy CLI spawn test code remaining
**Achievable**: Simple file deletion
**Relevant**: Clean slate required for new MCP server bundle
**Time-bound**: 30 minutes

### FR2: Bundle Ptah MCP Server as Standalone

**Specific**: Create a standalone Node.js MCP server in `infra-test` that:

- Imports and bundles the existing `CodeExecutionMCP` server from `libs/backend/vscode-lm-tools`
- Runs on stdio transport (for MCP Inspector compatibility) OR HTTP transport
- Works outside VS Code extension context (mocking VS Code APIs where needed)
  **Measurable**: `node dist/apps/infra-test/main.js` starts the MCP server successfully
  **Achievable**: Existing MCP implementation is well-structured; needs thin wrapper
  **Relevant**: Enables live testing with external tools
  **Time-bound**: 4 hours

### FR3: Mock VS Code Dependencies

**Specific**: Create minimal mocks for VS Code APIs that the MCP server depends on:

- `vscode.workspace` - Mock workspace folder, configuration
- `vscode.ExtensionContext` - Mock workspaceState, globalState
- `vscode.window` - Mock for any UI interactions
  **Measurable**: Server starts without VS Code extension host
  **Achievable**: Similar mocking patterns exist in `__mocks__/vscode.ts`
  **Relevant**: Required for standalone execution
  **Time-bound**: 2 hours

### FR4: MCP Inspector Compatibility

**Specific**: Ensure the bundled server works with MCP Inspector:

- Supports stdio transport (standard for MCP Inspector)
- Responds to `initialize`, `tools/list`, `tools/call` methods
- Returns proper JSON-RPC 2.0 responses
  **Measurable**: `npx @modelcontextprotocol/inspector node dist/apps/infra-test/main.js` shows tools
  **Achievable**: Existing protocol handlers are compliant
  **Relevant**: MCP Inspector is the official testing tool
  **Time-bound**: 2 hours

### FR5: .mcp.json Configuration Entry

**Specific**: Add entry to `.mcp.json` for Claude Code integration:

```json
{
  "mcpServers": {
    "ptah-test": {
      "command": "node",
      "args": ["dist/apps/infra-test/main.js"]
    }
  }
}
```

**Measurable**: Claude Code detects and connects to "ptah-test" server
**Achievable**: Standard MCP configuration
**Relevant**: Enables live testing with Claude agent
**Time-bound**: 30 minutes

### FR6: NPM Script for Building & Running

**Specific**: Add npm scripts:

- `npm run build:mcp-test` - Build the infra-test MCP server
- `npm run mcp:inspector` - Launch with MCP Inspector
  **Measurable**: Single commands execute the full workflow
  **Achievable**: Standard Nx/npm script configuration
  **Relevant**: Standardizes test execution
  **Time-bound**: 30 minutes

---

## 4. Non-Functional Requirements

### Performance

- Full test suite completes in < 60 seconds
- Individual test timeout: 10 seconds max
- No memory leaks during test execution

### Reliability

- Tests must be idempotent (repeatable with same results)
- Clear error messages on failure
- Graceful handling of server unavailability

### Maintainability

- Modular test structure (one file per test category)
- Reusable MCP client utility
- Well-documented test cases with JSDoc comments

### Compatibility

- Node.js 18+ runtime
- Works with existing Nx build system
- Compatible with CI/CD pipelines

---

## 5. Acceptance Criteria (BDD Format)

### Scenario 1: MCP Server Connection

**Given** the Ptah MCP server is running on localhost:51820
**When** the test harness sends an `initialize` request
**Then** the server responds with protocol version "2024-11-05"
**And** the response includes server info with name "ptah"

### Scenario 2: Tool Discovery

**Given** a successful MCP connection is established
**When** the test harness sends a `tools/list` request
**Then** the response includes tool "execute_code" with schema
**And** the response includes tool "approval_prompt" with schema

### Scenario 3: Code Execution - Success

**Given** the MCP server is ready
**When** executing code `return 2 + 2`
**Then** the result equals 4
**And** no error is returned

### Scenario 4: Code Execution - Syntax Error

**Given** the MCP server is ready
**When** executing code with syntax error `const x = (`
**Then** an error response is returned
**And** the error message indicates syntax error

### Scenario 5: Code Execution - Ptah API Access

**Given** the MCP server is ready
**When** executing code `const info = await ptah.workspace.getInfo(); return info.projectType;`
**Then** a valid project type string is returned
**And** no error occurs

### Scenario 6: Namespace Coverage - Workspace

**Given** the MCP server is ready
**When** executing code that calls `ptah.workspace.analyze()`
**Then** the result contains `info` and `structure` properties

### Scenario 7: Namespace Coverage - Search

**Given** the MCP server is ready
**When** executing code `await ptah.search.findFiles('**/*.ts', 5)`
**Then** an array of file paths is returned

### Scenario 8: Invalid Method Handling

**Given** the MCP server is running
**When** sending request with method "invalid/method"
**Then** error code -32601 (Method not found) is returned

### Scenario 9: Test Suite Summary

**Given** all tests have completed
**When** viewing the test output
**Then** a summary shows total tests, passed, failed counts
**And** failed tests are listed with error details

### Scenario 10: Server Unavailable Handling

**Given** the Ptah MCP server is NOT running
**When** the test harness attempts to connect
**Then** a clear error message indicates server unavailability
**And** the test suite exits gracefully with non-zero code

---

## 6. Risk Assessment

### Technical Risks

| Risk                                                  | Probability | Impact | Mitigation                                                         |
| ----------------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------ |
| MCP server not running during tests                   | HIGH        | HIGH   | Document prerequisite; add server health check at start            |
| VS Code-dependent APIs fail without extension context | MEDIUM      | HIGH   | Some namespaces may not work outside VS Code; document limitations |
| Timeout issues with slow operations                   | LOW         | MEDIUM | Configurable timeouts; appropriate defaults                        |
| Port 51820 conflict                                   | LOW         | MEDIUM | Make port configurable via environment variable                    |

### Business Risks

| Risk                            | Probability | Impact | Mitigation                                     |
| ------------------------------- | ----------- | ------ | ---------------------------------------------- |
| Incomplete namespace coverage   | LOW         | HIGH   | Explicit test checklist; coverage tracking     |
| Tests pass but production fails | LOW         | HIGH   | Test in realistic scenarios; integration tests |

---

## 7. Research Recommendations

**Technical Research Needed**: NO

**Reasoning**:

- JSON-RPC 2.0 is a well-documented standard
- HTTP client implementation is straightforward (Node.js `http` module)
- Existing MCP handler code in `protocol-handlers.ts` provides reference implementation
- No new technologies or unfamiliar patterns required

---

## 8. UI/UX Requirements

**UI/UX Design Needed**: NO

**Reasoning**: This is a command-line test harness with console output only. No visual interface required.

---

## 9. Dependencies & Integration Points

### External Dependencies

- Node.js 18+ (runtime)
- Ptah MCP server running on localhost:51820

### Internal Dependencies

- `libs/backend/vscode-lm-tools` - Reference for protocol, types, expected behavior
- Nx build system - For building `apps/infra-test`

### Third-Party Services

- None required

---

## 10. Out of Scope

Explicitly NOT included in this task:

- **Modifying the Ptah MCP server** - Tests only; no server changes
- **UI/Visual test runner** - Console output only
- **CI/CD integration** - Future task; this creates the tests
- **Performance benchmarking** - Functional correctness only
- **Mock server implementation** - Tests against real server only
- **approval_prompt UI interaction testing** - Cannot simulate webview; test API format only

---

## 11. Test Categories & Coverage Matrix

### Category 1: Protocol Tests

| Test | Description                   |
| ---- | ----------------------------- |
| P1   | Initialize request/response   |
| P2   | Tools list returns both tools |
| P3   | Invalid method returns -32601 |
| P4   | Malformed JSON returns -32700 |
| P5   | Missing id returns error      |

### Category 2: execute_code Tests

| Test | Description                  |
| ---- | ---------------------------- |
| E1   | Simple arithmetic expression |
| E2   | Async/await code             |
| E3   | Return object serialization  |
| E4   | Syntax error handling        |
| E5   | Runtime error handling       |
| E6   | Timeout enforcement          |
| E7   | Console.log capture          |
| E8   | Ptah API availability        |

### Category 3: Namespace Tests (via execute_code)

| Namespace     | Methods to Test                                 |
| ------------- | ----------------------------------------------- |
| workspace     | getInfo, analyze, getProjectType, getFrameworks |
| search        | findFiles, getRelevantFiles                     |
| symbols       | find                                            |
| diagnostics   | getErrors, getWarnings, getAll                  |
| git           | getStatus                                       |
| ai            | chat, selectModel                               |
| files         | read, exists                                    |
| commands      | execute                                         |
| context       | getContext                                      |
| project       | getProjectInfo                                  |
| relevance     | scoreRelevance                                  |
| ast           | parse                                           |
| ide           | getActiveEditor, getLspDiagnostics              |
| llm           | chat, countTokens                               |
| orchestration | getState, updateState                           |

### Category 4: approval_prompt Tests

| Test | Description                   |
| ---- | ----------------------------- |
| A1   | Valid prompt request format   |
| A2   | Missing required parameters   |
| A3   | Response structure validation |

---

**REQUIREMENTS COMPLETE - AWAITING USER VALIDATION**
