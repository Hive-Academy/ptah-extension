# Cost-Effective MCP Delegation Reference

Guide for delegating sub-tasks to VS Code Language Models via the Ptah MCP server's `execute_code` tool.

---

## Overview

Cost-Effective Mode allows Claude-orchestrated workflows to delegate cheaper sub-tasks (research, analysis, boilerplate, review) to VS Code LM models (e.g., GitHub Copilot's gpt-4o) instead of running everything through Claude SDK.

**Key Principle**: Claude orchestrates and synthesizes. VS Code LM handles grunt work.

---

## When to Use

- `/orchestrate --cost-effective [task]` flag is present
- User has VS Code LM models available (GitHub Copilot, etc.)
- Task contains research, review, or boilerplate phases

## When NOT to Use

- Complex architectural decisions requiring deep reasoning
- Security-sensitive code review
- Final synthesis and deliverable creation
- Tasks requiring tool use (file read/write, git operations)

---

## Delegation Decision Matrix

| Sub-Task Type               | Delegate to VS Code LM? | Rationale                     |
| --------------------------- | :---------------------: | ----------------------------- |
| Codebase research queries   |           Yes           | Simple file content analysis  |
| Pattern/style checking      |           Yes           | Rule-based analysis           |
| Simple bug detection        |           Yes           | Static analysis patterns      |
| Draft/outline generation    |           Yes           | Boilerplate content creation  |
| Test case ideation          |           Yes           | Enumeration task              |
| Fixture/mock generation     |           Yes           | Template-based generation     |
| Architecture decisions      |           No            | Requires deep reasoning       |
| Complex refactoring plans   |           No            | Multi-step reasoning needed   |
| Security review             |           No            | Critical accuracy required    |
| Final synthesis/summary     |           No            | Quality-critical output       |
| Tool use (read/write files) |           No            | VS Code LM has no tool access |

---

## Delegation Pattern

Agents delegate via the `execute_code` MCP tool with `ptah.llm.vscodeLm.chat()`:

````javascript
// Inside execute_code MCP call
const result = await ptah.llm.vscodeLm.chat({
  systemPrompt: 'You are a code style reviewer...',
  userMessage: 'Review this code for naming conventions:\n\n```typescript\n...\n```',
  options: { temperature: 0.3 },
});
return result.text;
````

### System Prompt Engineering

Claude crafts task-specific system prompts before delegating:

```javascript
// Research delegation
const researchResult = await ptah.llm.vscodeLm.chat({
  systemPrompt: `You are a technical researcher. Analyze the provided code and answer the question concisely. Focus on facts, not opinions. Return structured findings.`,
  userMessage: `Question: What authentication patterns does this codebase use?\n\nCode:\n${codeSnippet}`,
});

// Style review delegation
const styleResult = await ptah.llm.vscodeLm.chat({
  systemPrompt: `You are a code style reviewer for a TypeScript/Angular project. Check for: naming conventions (camelCase methods, PascalCase classes), import ordering, unused imports, missing type annotations. Return a bullet list of issues found.`,
  userMessage: `Review this file:\n\n${fileContent}`,
});

// Test case ideation
const testCases = await ptah.llm.vscodeLm.chat({
  systemPrompt: `You are a test engineer. Given a function signature and description, enumerate all test cases needed (happy path, edge cases, error cases). Return as a numbered list.`,
  userMessage: `Function: ${functionSignature}\nDescription: ${description}`,
});
```

---

## Parallel Delegation

For batch analysis, use sequential `execute_code` calls (each containing a `ptah.llm.vscodeLm.chat()` call):

```
Agent receives list of 5 files to review
  → execute_code: ptah.llm.vscodeLm.chat() for file 1
  → execute_code: ptah.llm.vscodeLm.chat() for file 2
  → execute_code: ptah.llm.vscodeLm.chat() for file 3
  → ... (sequential MCP calls)
  → Claude synthesizes all results into final review
```

---

## Agent Delegation Prompt Template

When cost-effective mode is active, the orchestrator injects this into agent prompts:

````
## Cost-Effective Delegation Mode

You have access to VS Code Language Models via the `execute_code` MCP tool.
For research, analysis, and boilerplate sub-tasks, delegate to VS Code LM:

```javascript
const result = await ptah.llm.vscodeLm.chat({
  systemPrompt: "[craft a focused system prompt for the sub-task]",
  userMessage: "[the specific question or content to analyze]",
  options: { temperature: 0.3 }
});
````

**Delegate**: Research queries, style checks, test case enumeration, draft generation
**Keep in Claude**: Architecture decisions, security review, final synthesis, tool use

---

## Cost Comparison

| Operation | Claude SDK | VS Code LM (Copilot) |
|---|---|---|
| Research query | ~$0.01-0.05 per query | Free (included with Copilot) |
| Style review | ~$0.02-0.10 per file | Free |
| Test ideation | ~$0.01-0.03 per function | Free |
| Draft generation | ~$0.05-0.20 per section | Free |
| Full orchestration (10 sub-tasks) | ~$0.50-2.00 | ~$0.10-0.30 (Claude for synthesis only) |

**Typical savings**: 60-80% cost reduction for research-heavy and review-heavy workflows.
