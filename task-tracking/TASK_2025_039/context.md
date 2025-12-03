# TASK_2025_039: Enhanced ptah.ai Namespace - LLM & IDE Superpowers

## Context Summary

This task emerged from a strategic discussion about enhancing Ptah's `execute_code` MCP tool to provide unique capabilities that complement (not replace) Claude Code CLI.

## Key Insights from Discussion

### What Ptah Should NOT Do

- Replicate Claude CLI's existing tools (Read, Write, Bash, Grep, Glob)
- Overwhelm Claude with too many separate namespaces/tools
- Replace Claude's core functionality

### What Ptah SHOULD Do

- Provide **unique superpowers** only available inside VS Code
- Enhance the existing `ptah.ai` namespace with powerful LLM capabilities
- Add IDE-specific features that Claude CLI cannot access

## Current State

The `ptah.ai` namespace is minimal:

```typescript
ptah.ai.chat(message, model?)      // Single message → response
ptah.ai.selectModel(family?)       // List model names (basic)
```

## Enhancement Strategy

Enhance `ptah.ai` with two categories of capabilities:

### 1. LLM Enhancements (chat-related)

- Multi-turn conversations with history
- Token counting with model-specific tokenizer
- VS Code tool integration (invoke registered tools)
- Specialized AI tasks (summarize, explain, review, transform, generate)
- Streaming support
- Full model metadata (maxInputTokens, vendor, version)
- **System prompt support** via XML-delimited message formatting
- **Agent invocation** - load `.claude/agents/*.md` files as system prompts

### 2. IDE Superpowers (VS Code-exclusive)

- Language Server Protocol access (getDefinition, getReferences, getHover)
- Live editor context (active file, selection, cursor position)
- Code actions & refactoring (VS Code's refactoring engine)
- Test execution & coverage

## Cost Optimization Strategy (NEW)

**Key Insight**: Claude Code CLI (Opus/Sonnet) can delegate routine tasks to cheaper models via VS Code LM API.

### How It Works

1. Claude reads an agent definition file (e.g., `.claude/agents/senior-tester.md`)
2. Claude calls `ptah.ai.invokeAgent(agentPath, task, 'gpt-4o-mini')`
3. Ptah loads the .md file as system prompt, sends to cheap model
4. Cheap model returns results to Claude
5. Claude (expensive model) synthesizes and continues

### Example Workflow

```
Claude (Sonnet/Opus) orchestrates:
   ├─► ptah.ai.invokeAgent('senior-tester.md', 'Review tests', 'gpt-4o-mini')
   ├─► ptah.ai.invokeAgent('code-reviewer.md', 'Check patterns', 'gpt-4o-mini')
   └─► Claude synthesizes results (still cheaper than doing everything in Opus)
```

### Why VS Code LM API Doesn't Have System Prompts

VS Code's `LanguageModelChatMessage` only supports `User` and `Assistant` roles - no `System` role.

**Workaround**: Use XML-style delimiters (inspired by [claude-copilot](https://github.com/VictorNanka/claude-copilot)):

```typescript
vscode.LanguageModelChatMessage.User(`
<SYSTEM_INSTRUCTIONS>
${agentDefinition}
</SYSTEM_INSTRUCTIONS>

<USER_MESSAGE>
${task}
</USER_MESSAGE>
`);
```

## Research Sources

- [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model)
- [VS Code Language Model Tool API](https://code.visualstudio.com/api/extension-guides/ai/tools)
- [claude-copilot](https://github.com/VictorNanka/claude-copilot) - System prompt workaround inspiration
- [VS Code Language Model Tool API](https://code.visualstudio.com/api/extension-guides/ai/tools)
- [VS Code API Reference](https://code.visualstudio.com/api/references/vscode-api)

## User Requirements

1. Enhance the AI chat capabilities specifically
2. Make Claude able to utilize VS Code LM for tasks
3. Add IDE namespace for VS Code-exclusive powers
4. Keep it organized - don't overwhelm with too many tools
5. Complement Claude CLI, don't replace it
