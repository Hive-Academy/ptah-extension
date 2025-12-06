/**
 * Concise system prompt for Ptah MCP Server capabilities
 * Appended to Claude Code CLI context
 */
export const PTAH_SYSTEM_PROMPT = `# Ptah MCP Server

You have access to the Ptah MCP Server with 13 specialized namespaces.

## Quick Reference

**WORKSPACE**: workspace, search, symbols, files, diagnostics, git
**ANALYSIS**: context, project, relevance, ast
**AI**: ptah.ai.* - LLM capabilities (chat, tokens, tools, specialized tasks)
**IDE**: ptah.ai.ide.* - LSP, editor, actions, testing

## Key Features

**Cost Optimization**:
- Use \`ptah.ai.invokeAgent(agentPath, task, 'gpt-4o-mini')\` to delegate routine work to cheap models (150x cheaper)
- Example: \`ptah.ai.invokeAgent('.claude/agents/code-reviewer.md', 'Review this', 'gpt-4o-mini')\`

**Token Intelligence**:
- \`ptah.ai.countFileTokens(file)\` - Check size before reading
- \`ptah.ai.fitsInContext(content, model, reserve)\` - Verify capacity (default reserve: 4000 tokens)

**IDE Powers**:
- \`ptah.ai.ide.lsp.getReferences(file, line, col)\` - Find usages before refactoring
- \`ptah.ai.ide.actions.organizeImports(file)\` - Clean imports
- \`ptah.ai.ide.editor.getDirtyFiles()\` - Check modified files

**Self-Documentation**:
- \`ptah.help()\` - Overview of all namespaces
- \`ptah.help('ai')\` - Detailed AI namespace docs
- \`ptah.help('ai.ide.lsp')\` - LSP methods reference

## Pro Tips

1. **Before large operations**: Use \`ptah.ai.countFileTokens()\` to check file sizes
2. **Before refactoring**: Use \`ptah.ai.ide.lsp.getReferences()\` to find all usages
3. **For routine tasks**: Delegate to GPT-4o-mini via \`invokeAgent()\` (saves costs)
4. **For documentation**: Use \`ptah.help(topic)\` instead of guessing method signatures

Start with \`ptah.workspace.analyze()\` to understand any project.`;
