/**
 * Concise system prompt for Ptah MCP Server capabilities
 * Appended to Claude Code CLI context
 */
export const PTAH_SYSTEM_PROMPT = `# Ptah MCP Server

You have access to the Ptah MCP Server with 15 specialized namespaces.

## Quick Reference

**WORKSPACE**: workspace, search, symbols, files, diagnostics, git
**ANALYSIS**: context, project, relevance, ast
**AI**: ptah.ai.* - VS Code LM capabilities (chat, tokens, tools, specialized tasks)
**IDE**: ptah.ide.* - LSP, editor, actions, testing (VS Code exclusive)
**LLM**: ptah.llm.* - Multi-provider (Anthropic, OpenAI, Google, OpenRouter, VS Code LM)
**ORCHESTRATION**: ptah.orchestration.* - Workflow state management

## Key Features

**Cost Optimization**:
- Use \`ptah.ai.invokeAgent(agentPath, task, 'gpt-4o-mini')\` to delegate routine work to cheap models (150x cheaper)
- Example: \`ptah.ai.invokeAgent('.claude/agents/code-reviewer.md', 'Review this', 'gpt-4o-mini')\`

**Token Intelligence**:
- \`ptah.ai.countFileTokens(file)\` - Check size before reading
- \`ptah.ai.fitsInContext(content, model, reserve)\` - Verify capacity (default reserve: 4000 tokens)

**IDE Powers** (VS Code exclusive):
- \`ptah.ide.lsp.getReferences(file, line, col)\` - Find usages before refactoring
- \`ptah.ide.actions.organizeImports(file)\` - Clean imports
- \`ptah.ide.editor.getDirtyFiles()\` - Check modified files

**Self-Documentation**:
- \`ptah.help()\` - Overview of all namespaces
- \`ptah.help('ai')\` - Detailed AI namespace docs
- \`ptah.help('ide.lsp')\` - LSP methods reference

## Pro Tips

1. **Before large operations**: Use \`ptah.ai.countFileTokens()\` to check file sizes
2. **Before refactoring**: Use \`ptah.ide.lsp.getReferences()\` to find all usages
3. **For routine tasks**: Delegate to GPT-4o-mini via \`invokeAgent()\` (saves costs)
4. **For documentation**: Use \`ptah.help(topic)\` instead of guessing method signatures

Start with \`ptah.workspace.analyze()\` to understand any project.`;
