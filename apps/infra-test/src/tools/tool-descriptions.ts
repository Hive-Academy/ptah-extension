/**
 * MCP Tool Descriptions for the standalone test server
 */

import type { MCPToolDefinition } from '../types';

/**
 * Build the execute_code tool definition
 */
export function buildExecuteCodeTool(): MCPToolDefinition {
  return {
    name: 'execute_code',
    description: `Execute TypeScript/JavaScript code with access to the Ptah API.

The code runs in an async context with the global "ptah" object available.
All methods are async and should be awaited.

## Available Namespaces (15 total)

### ptah.workspace - Workspace Analysis
- analyze(): Full workspace analysis with info and structure
- getInfo(): Project metadata (name, type, frameworks)
- getProjectType(): Detected project type string
- getFrameworks(): Array of detected frameworks

### ptah.search - File Discovery
- findFiles(pattern, limit?): Find files by glob pattern
- getRelevantFiles(query, maxFiles?): Semantic file search

### ptah.symbols - Code Symbol Search
- find(name, type?): Find symbols (class, function, method, interface, variable)

### ptah.diagnostics - Errors & Warnings
- getErrors(): All error-level diagnostics
- getWarnings(): All warning-level diagnostics
- getAll(): All diagnostics with severity

### ptah.git - Git Status
- getStatus(): Branch name and file changes

### ptah.ai - AI Chat
- chat(message, model?): Send message to VS Code LM API
- selectModel(family?): List available models

### ptah.files - File Operations
- read(path): Read file contents
- exists(path): Check if file exists
- list(directory): List directory contents

### ptah.commands - VS Code Commands
- execute(command, ...args): Execute a VS Code command
- list(): List available commands

### ptah.context - Context Management
- getContext(query): Get optimized context for a query
- getTokenBudget(): Get available token budget

### ptah.project - Project Information
- getProjectInfo(): Detailed project information
- getDependencies(): List project dependencies

### ptah.relevance - File Relevance
- scoreRelevance(query, files): Score file relevance

### ptah.ast - AST Analysis
- parse(filePath): Parse file to AST
- getSymbols(filePath): Get symbols from file

### ptah.ide - IDE Features
- getActiveEditor(): Get active editor info
- getDiagnostics(path?): Get IDE diagnostics

### ptah.llm - LLM Integration
- chat(message): Simple LLM chat
- countTokens(text): Count tokens in text

### ptah.orchestration - Workflow State
- getState(): Get current workflow state
- updateState(state): Update workflow state

### ptah.help(topic?) - Documentation
- help(): Overview of all namespaces
- help('workspace'): Help for specific namespace

## Code Patterns (all work automatically)

- Simple: \`await ptah.workspace.getInfo()\`
- With variables: \`const info = await ptah.workspace.getInfo(); return info;\`
- IIFE: \`(async () => { return await ptah.git.getStatus(); })()\`
- Direct return: \`return "hello"\`

NOTE: This is a TEST server with mock implementations for standalone testing.`,
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'TypeScript/JavaScript code to execute. Has access to "ptah" global object.',
        },
        timeout: {
          type: 'number',
          description:
            'Execution timeout in milliseconds (default: 5000, max: 30000)',
        },
      },
      required: ['code'],
    },
  };
}

/**
 * Build the approval_prompt tool definition
 */
export function buildApprovalPromptTool(): MCPToolDefinition {
  return {
    name: 'approval_prompt',
    description:
      'Request user approval for a tool execution. In test mode, all requests are auto-approved.',
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: {
          type: 'string',
          description: 'Name of the tool requesting permission',
        },
        input: {
          type: 'object',
          description: 'Input parameters for the tool',
        },
        tool_use_id: {
          type: 'string',
          description: 'Unique tool use request ID',
        },
      },
      required: ['tool_name', 'input'],
    },
  };
}
