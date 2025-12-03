# TASK_2025_039: Enhanced ptah.ai Namespace - LLM & IDE Superpowers

## Overview

Enhance the `ptah.ai` namespace in the Ptah MCP server to provide Claude Code CLI with unique VS Code superpowers. This includes advanced LLM chat capabilities and IDE-specific features that are impossible to access from outside VS Code.

## Problem Statement

The current `ptah.ai` namespace is minimal:

- `chat(message, model?)` - Basic single-turn chat
- `selectModel(family?)` - List models with limited metadata

This underutilizes VS Code's Language Model API capabilities and misses the opportunity to give Claude unique IDE powers.

## Goals

1. **Enhanced LLM Capabilities** - Full utilization of VS Code's Language Model API
2. **IDE Superpowers** - Access to LSP, editor state, code actions, and testing
3. **Multi-agent Architecture** - Enable Claude to delegate tasks to VS Code's LLM
4. **Token Intelligence** - Accurate context planning with model tokenizers
5. **Cost Optimization** - Delegate routine tasks to cheaper models (GPT-4o-mini, Haiku) with system prompts

## Scope

### In Scope

#### Part A: Enhanced LLM Chat (`ptah.ai.*`)

| Method                                          | Description                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| `chat(message, model?)`                         | Keep existing                                                       |
| `selectModel(family?)`                          | **Enhance**: Return full metadata (maxInputTokens, vendor, version) |
| `chatWithHistory(messages[], model?)`           | **NEW**: Multi-turn conversations                                   |
| `chatStream(message, onChunk, model?)`          | **NEW**: Streaming responses                                        |
| `chatWithSystem(message, systemPrompt, model?)` | **NEW**: Chat with system prompt (agent delegation)                 |
| `invokeAgent(agentPath, task, model?)`          | **NEW**: Invoke agent with .md file as system prompt                |
| `countTokens(text, model?)`                     | **NEW**: Model-specific token counting                              |
| `countFileTokens(filePath, model?)`             | **NEW**: Token count for files                                      |
| `fitsInContext(content, model?, reserve?)`      | **NEW**: Context capacity check                                     |
| `getTools()`                                    | **NEW**: List registered VS Code LM tools                           |
| `invokeTool(name, input)`                       | **NEW**: Invoke VS Code tools directly                              |
| `chatWithTools(message, toolNames[], model?)`   | **NEW**: Chat with tool access                                      |
| `summarize(content, options?)`                  | **NEW**: Summarize using VS Code LM                                 |
| `explain(code, options?)`                       | **NEW**: Explain code with context                                  |
| `review(code, options?)`                        | **NEW**: Code review via LM                                         |
| `transform(code, instruction, model?)`          | **NEW**: Transform code by instruction                              |
| `generate(description, options?)`               | **NEW**: Generate code from description                             |

#### Part B: IDE Superpowers (`ptah.ai.ide.*`)

| Method                                         | Description                      |
| ---------------------------------------------- | -------------------------------- |
| `ide.lsp.getDefinition(file, line, col)`       | Go to definition via LSP         |
| `ide.lsp.getReferences(file, line, col)`       | Find all references              |
| `ide.lsp.getHover(file, line, col)`            | Get hover info (types, docs)     |
| `ide.lsp.getTypeDefinition(file, line, col)`   | Get type definition location     |
| `ide.lsp.getSignatureHelp(file, line, col)`    | Get function signatures          |
| `ide.editor.getActive()`                       | Get active file, line, selection |
| `ide.editor.getOpenFiles()`                    | Get all open files               |
| `ide.editor.getDirtyFiles()`                   | Get unsaved files                |
| `ide.editor.getRecentFiles(limit?)`            | Get recently accessed files      |
| `ide.editor.getVisibleRange()`                 | Get visible code range           |
| `ide.actions.getAvailable(file, line)`         | Get available code actions       |
| `ide.actions.apply(file, line, actionTitle)`   | Apply a code action              |
| `ide.actions.rename(file, line, col, newName)` | Rename symbol                    |
| `ide.actions.organizeImports(file)`            | Organize imports                 |
| `ide.actions.fixAll(file, kind?)`              | Apply all auto-fixes             |
| `ide.testing.discover()`                       | Discover tests                   |
| `ide.testing.run(options?)`                    | Run tests                        |
| `ide.testing.getLastResults()`                 | Get last test results            |
| `ide.testing.getCoverage(file)`                | Get coverage info                |

### Out of Scope

- Replacing Claude CLI's core tools (Read, Write, Bash, Grep, Glob)
- Creating separate top-level namespaces (keep everything under `ptah.ai`)
- Modifying the MCP protocol or server infrastructure
- Frontend/webview changes

## Success Criteria

1. All new methods implemented and working
2. Types defined in `types.ts`
3. Namespace builders created/updated
4. Tool description updated in `code-execution-mcp.service.ts`
5. Unit tests for new functionality
6. Claude can successfully:
   - Count tokens and check context capacity
   - Have multi-turn conversations with VS Code LM
   - Invoke VS Code registered tools
   - Use specialized AI tasks (summarize, explain, review)
   - Access LSP intelligence (definitions, references)
   - See editor state (active file, selection)
   - Run and verify tests

## Technical Notes

### VS Code APIs to Use

```typescript
// Language Model API
vscode.lm.selectChatModels(selector)    // Get models with full metadata
model.sendRequest(messages, options)    // Chat with tool support
model.countTokens(text)                 // Token counting
model.maxInputTokens                    // Context window size

// Tool API
vscode.lm.tools                         // List registered tools
vscode.lm.invokeTool(name, options)     // Invoke a tool

// LSP APIs
vscode.commands.executeCommand('vscode.executeDefinitionProvider', ...)
vscode.commands.executeCommand('vscode.executeReferenceProvider', ...)
vscode.commands.executeCommand('vscode.executeHoverProvider', ...)
vscode.commands.executeCommand('vscode.executeCodeActionProvider', ...)

// Editor APIs
vscode.window.activeTextEditor
vscode.window.visibleTextEditors
vscode.workspace.textDocuments

// Test APIs
vscode.tests.createTestController
testController.items
testRun.enqueued / started / passed / failed
```

### System Prompt Implementation Strategy

**Important**: VS Code LM API does NOT have native `LanguageModelChatMessage.System` support.

**Workaround**: Use structured message formatting (inspired by [claude-copilot](https://github.com/VictorNanka/claude-copilot)):

```typescript
// Merge format with XML-style delimiters for clear instruction boundaries
const messages = [
  vscode.LanguageModelChatMessage.User(`
<SYSTEM_INSTRUCTIONS>
${systemPromptContent}
</SYSTEM_INSTRUCTIONS>

<USER_MESSAGE>
${userMessage}
</USER_MESSAGE>
  `),
];
```

### Agent Invocation Pattern (Cost Optimization)

Claude Code CLI can delegate routine tasks to cheaper VS Code models:

```typescript
// Example: Claude delegates testing review to GPT-4o-mini
const result = await ptah.ai.invokeAgent(
  '.claude/agents/senior-tester.md', // Agent definition as system prompt
  'Review this test file for completeness',
  'gpt-4o-mini' // Use cheap model for routine tasks
);

// Example: Claude delegates code explanation to Haiku
const explanation = await ptah.ai.invokeAgent('.claude/agents/code-explainer.md', 'Explain this function', 'claude-3-haiku');
```

**Cost Savings Scenarios**:
| Task | Model | Est. Cost | Notes |
|------|-------|-----------|-------|
| Code review | gpt-4o-mini | ~$0.0001/1K tokens | Routine pattern checks |
| Test validation | gpt-4o-mini | ~$0.0001/1K tokens | Test completeness |
| Code summary | claude-3-haiku | ~$0.00025/1K tokens | Quick summaries |
| Documentation | gpt-4o-mini | ~$0.0001/1K tokens | Doc generation |
| Complex analysis | gpt-4o | ~$0.005/1K tokens | When quality matters |

**Workflow Integration**:

```
Claude Code CLI (Opus/Sonnet - orchestrator)
    │
    ├─► ptah.ai.invokeAgent('senior-tester.md', task, 'gpt-4o-mini')
    │       └─► Returns: Test review results
    │
    ├─► ptah.ai.invokeAgent('code-reviewer.md', task, 'gpt-4o-mini')
    │       └─► Returns: Code review findings
    │
    └─► Claude synthesizes results and continues main task
```

### Discovery & Guidance Strategy

**Challenge**: With 47 new methods, the tool description would become massive (400+ lines), bloating Claude's context.

**Solution**: Hybrid Discovery System

#### 1. Concise Tool Description (`tool-description.builder.ts`)

Keep API reference brief (~200-250 lines):

```
## Available Namespaces (16 total)

### WORKSPACE & FILES (existing)
ptah.workspace, ptah.search, ptah.symbols, ptah.files, ptah.diagnostics, ptah.git

### CONTEXT & ANALYSIS (existing)
ptah.context, ptah.project, ptah.relevance, ptah.ast

### AI & LLM (ENHANCED)
ptah.ai.chat/chatWithSystem/invokeAgent - Chat with system prompts
ptah.ai.countTokens/fitsInContext - Token intelligence
ptah.ai.getTools/invokeTool/chatWithTools - VS Code tool integration
ptah.ai.summarize/explain/review/transform/generate - Specialized tasks

### IDE SUPERPOWERS (NEW)
ptah.ai.ide.lsp.* - LSP access (definitions, references, hover)
ptah.ai.ide.editor.* - Editor state (active file, selection)
ptah.ai.ide.actions.* - Refactoring (rename, code actions)
ptah.ai.ide.testing.* - Test execution and coverage

### SELF-DOCUMENTATION
ptah.help(topic?) - Get detailed docs on any namespace
```

#### 2. Self-Documentation Method (`ptah.help()`)

```typescript
ptah.help(); // Overview of all namespaces
ptah.help('ai'); // Full AI namespace documentation
ptah.help('ai.invokeAgent'); // Specific method with examples
ptah.help('ide.lsp'); // LSP sub-namespace docs
```

Claude loads detailed docs ONLY when needed - massive context savings!

#### 3. Strategic Usage Guide (`.claude/PTAH_GUIDE.md`)

Auto-loaded by Claude Code. Contains:

- **Cost Optimization**: When to delegate to cheap models
- **Workflow Patterns**: Test → Fix → Verify cycles
- **Decision Trees**: Which namespace for which task
- **Agent Delegation Examples**: Using invokeAgent with agent .md files

Example content:

```markdown
# Ptah Strategic Usage Guide

## Cost Optimization: Agent Delegation

Delegate routine tasks to cheaper models via VS Code LM:

| Task        | Command                                                        | Model       | Why              |
| ----------- | -------------------------------------------------------------- | ----------- | ---------------- |
| Test review | `ptah.ai.invokeAgent('senior-tester.md', task, 'gpt-4o-mini')` | GPT-4o-mini | Routine checks   |
| Code review | `ptah.ai.invokeAgent('code-reviewer.md', task, 'gpt-4o-mini')` | GPT-4o-mini | Pattern matching |
| Summary     | `ptah.ai.summarize(code, {model: 'gpt-4o-mini'})`              | GPT-4o-mini | Quick summaries  |

## When to Use IDE Powers

- **Before refactoring**: `ptah.ai.ide.lsp.getReferences()` - find all usages
- **Understanding types**: `ptah.ai.ide.lsp.getHover()` - get type info
- **After changes**: `ptah.ai.ide.testing.run()` - verify tests pass
```

#### 4. Project CLAUDE.md Update

```markdown
## Ptah MCP Server Capabilities

This project includes a Ptah MCP server with extended VS Code powers.

- See `.claude/PTAH_GUIDE.md` for strategic usage guidance
- Use `ptah.help()` to discover available APIs on-demand
- Use `ptah.ai.invokeAgent()` to delegate tasks to cheaper models
```

### File Locations

- Types: `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`
- Builders: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/`
- MCP Service: `libs/backend/vscode-lm-tools/src/lib/code-execution/code-execution-mcp.service.ts`
- API Builder: `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`
- Tool Description: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts`
- Strategic Guide: `.claude/PTAH_GUIDE.md` (NEW)

## Dependencies

- VS Code API (built-in)
- Existing workspace-intelligence services
- Existing vscode-core wrappers

## Risks & Mitigations

| Risk                                            | Mitigation                                           |
| ----------------------------------------------- | ---------------------------------------------------- |
| VS Code LM API may not support all features     | Check API availability, provide graceful fallbacks   |
| Tool invocation requires user consent           | Document the consent flow, handle LanguageModelError |
| Some LSP features depend on language extensions | Return empty results if provider unavailable         |
| Test API may not be available in all workspaces | Check for test controller existence                  |

## References

- [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model)
- [VS Code Language Model Tool API](https://code.visualstudio.com/api/extension-guides/ai/tools)
- [VS Code API Reference](https://code.visualstudio.com/api/references/vscode-api)
- Current implementation: `libs/backend/vscode-lm-tools/src/lib/code-execution/`
