# Task Context - TASK_2025_131

## User Intent

Convert the `infra-test` application into an MCP server that can connect to and test all features of the existing Ptah MCP server (`CodeExecutionMCP`).

**Goals:**

1. **Clear out** existing `infra-test` code (~1,388 lines of Claude CLI spawn tests)
2. **Build an MCP server** in `infra-test`
3. **Test the Ptah MCP server** by connecting to it and exercising all its features
4. Ensure all MCP features work correctly before shipping

## Technical Context

### Existing Ptah MCP Server

- **Service**: `libs/backend/vscode-lm-tools/src/lib/code-execution/code-execution-mcp.service.ts`
- **Handlers**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/`
- **Transport**: HTTP on localhost port 51820 (configurable)
- **Protocol**: JSON-RPC 2.0 over HTTP

### Tools Provided by Ptah MCP

1. `execute_code` - Sandboxed TypeScript/JavaScript execution with Ptah API access
2. `approval_prompt` - User permission prompts via webview

### Ptah API Namespaces (to be tested via execute_code)

- `ptah.workspace` - Workspace operations (getInfo, analyze, getProjectType, getFrameworks)
- `ptah.search` - File search & relevance (findFiles, getRelevantFiles)
- `ptah.symbols` - Code symbol extraction
- `ptah.diagnostics` - Problem detection
- `ptah.git` - Git operations
- `ptah.ai` - AI provider integration
- `ptah.files` - File operations
- `ptah.commands` - VS Code command execution

### Current infra-test State

- `main.ts` (~1,388 lines) - CLI spawn tests (TO BE DELETED)
- `sdk-test.ts` - SDK testing (TO BE DELETED)
- Uses esbuild for Node.js bundling
- Output: `dist/apps/infra-test/`

## Task Classification

- **Type**: FEATURE
- **Complexity**: Medium
- **Technical Research Needed**: Yes - MCP client implementation patterns

## Execution Strategy

PM → Researcher → Architect → Team-Leader (3 modes) → Optional QA

## Created

- **Date**: 2026-02-01
- **Status**: Initialized
- **Branch**: TBD
