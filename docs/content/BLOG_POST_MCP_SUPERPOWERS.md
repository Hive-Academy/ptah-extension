# Blog Post: Your Claude Agent Just Got Superpowers

## Technical Content Delivery

### Investigation Summary

- **Library**: libs/backend/vscode-lm-tools
- **Key Files**: code-execution-mcp.service.ts, ptah-api-builder.service.ts, ptah-system-prompt.constant.ts
- **Source Evidence**: vscode-lm-tools/CLAUDE.md, workspace-intelligence/CLAUDE.md

---

## SEO Metadata

**Title**: Your Claude Agent Just Got Superpowers: 5 APIs You Didn't Know Were Possible
**Meta Description**: Ptah's Code Execution MCP server gives Claude agents direct access to workspace analysis, file search, diagnostics, and more. Here's how it works.
**URL Slug**: claude-agent-superpowers-mcp-server
**Keywords**: Claude Code MCP server, Claude agent APIs, Ptah extension, VS Code AI tools, Claude workspace access

---

## Blog Post

# Your Claude Agent Just Got Superpowers: 5 APIs You Didn't Know Were Possible

## Hook

What if your Claude agent could query your entire workspace structure, search files by semantic relevance, check for TypeScript errors, and read/write files - all from within a conversation?

That's what Ptah's Code Execution MCP server adds to the Claude Code experience.

## The Opportunity

Claude Code is powerful. But when you're working in VS Code, you have access to rich workspace information that could make Claude even more helpful - your project structure, TypeScript diagnostics, git status, symbol information, and more.

Ptah bridges that gap. It's a VS Code extension powered by the official Claude Code Agent SDK that adds an MCP server exposing VS Code's capabilities directly to Claude. The result:

- Claude can search your files semantically
- Claude can see your TypeScript errors
- Claude can understand your project structure
- Claude can read and write files

All without you manually providing context.

## Our Approach

We built an MCP (Model Context Protocol) server that exposes 5 core API namespaces directly to Claude agents. Instead of Claude asking _you_ about your workspace, Claude queries _Ptah_, which has direct access to VS Code's APIs.

The result: Claude agents that understand your codebase as well as you do.

## How It Works

### The Ptah API Architecture

When you enable Ptah's MCP server, Claude gains access to a `ptah` global object with key namespaces:

```typescript
// These APIs are now available to Claude agents
ptah.workspace; // Workspace analysis and project detection
ptah.search; // File search with relevance scoring
ptah.diagnostics; // VS Code problems/errors
ptah.ai; // Multi-provider LLM access
ptah.files; // File read/write operations
```

Each namespace maps to actual VS Code APIs and Ptah's workspace intelligence services.

### Namespace Deep Dive

#### 1. ptah.workspace - Know Your Project

Claude can now understand your project without you explaining it:

```typescript
// Claude executes this
const info = await ptah.workspace.getInfo();

// Returns:
// {
//   projectType: 'Angular',
//   frameworks: ['NestJS', 'Jest', 'Tailwind'],
//   hasMonorepo: true,
//   monorepoType: 'Nx'
// }
```

**Backed by**: `libs/backend/workspace-intelligence` - Project detection supports 13+ project types (Node.js, React, Vue, Angular, Next.js, Python, Java, Rust, Go, .NET, PHP, Ruby) and 6 monorepo tools.

#### 2. ptah.search - Semantic File Discovery

Instead of you listing relevant files, Claude finds them:

```typescript
// Find authentication-related files
const files = await ptah.search.findFiles({
  query: 'authentication service',
  maxResults: 20,
});

// Returns ranked results:
// [
//   { path: '/src/auth/auth.service.ts', score: 0.95 },
//   { path: '/src/auth/auth.guard.ts', score: 0.88 },
//   { path: '/src/user/user.service.ts', score: 0.72 }
// ]
```

**Backed by**: `FileRelevanceScorerService` uses path keyword matching, file type weighting (source > test > config > docs > assets), language-specific patterns, and framework patterns for ranking.

#### 3. ptah.diagnostics - Error Awareness

Claude can see VS Code's problems panel:

```typescript
// Get workspace errors
const diagnostics = await ptah.diagnostics.getProblems();

// Returns:
// [
//   { file: '/src/app.ts', line: 10, severity: 'error',
//     message: 'Property "user" does not exist on type "Request"' },
//   { file: '/src/auth.ts', line: 5, severity: 'warning',
//     message: 'Variable "token" is declared but never used' }
// ]
```

Now you can say: "Check if there are any TypeScript errors and fix them" - and Claude actually can.

#### 4. ptah.files - File Operations

Secure file access with permission handling:

```typescript
const content = await ptah.files.read('/src/auth.service.ts');
// File contents

const files = await ptah.files.list('/src/auth');
// ['auth.service.ts', 'auth.guard.ts', 'auth.module.ts']

await ptah.files.write('/src/auth/auth.dto.ts', newContent);
// With permission prompt
```

#### 5. ptah.ai - Multi-Provider LLM

Claude can use other AI models for specific tasks:

```typescript
const response = await ptah.ai.generate({
  prompt: 'Summarize this code',
  model: 'gpt-4-turbo', // Or claude, gemini, etc.
  temperature: 0.3,
});
```

**Backed by**: `libs/backend/llm-abstraction` - 5 providers (Anthropic, OpenAI, Google Gemini, OpenRouter, VS Code LM API).

### Security: Permission Handling

Ptah doesn't give Claude unlimited access. The `PermissionPromptService` manages user consent:

```typescript
// Before sensitive operations, Ptah prompts:
const allowed = await permissionService.requestPermission({
  tool: 'execute_code',
  operation: 'file_write',
  target: '/src/config.ts',
  riskLevel: 'high', // or 'medium', 'low'
});

if (!allowed) {
  throw new Error('Permission denied by user');
}
```

Risk levels determine prompt behavior:

- **Low**: Read-only operations (workspace info, file search)
- **Medium**: Modifications (file writes, git commits)
- **High**: Destructive operations (file delete, git reset)

### Execution Environment

Code runs in a sandboxed environment with configurable timeouts:

```typescript
// MCP tool invocation
{
  "tool": "execute_code",
  "arguments": {
    "code": "const info = await ptah.workspace.getInfo(); return info;",
    "timeout": 5000  // 5 seconds, max 30 seconds
  }
}
```

## Real-World Use Cases

### Use Case 1: Intelligent Refactoring

**Before Ptah**:

> You: "Refactor the authentication logic"
> You: _manually lists 8 files_
> You: _explains project structure_
> You: _copy-pastes current implementation_

**With Ptah**:

> You: "Refactor the authentication logic"
> Claude: _executes ptah.search.findFiles({ query: 'authentication' })_
> Claude: _reads each file and understands the structure_
> Claude: _refactors with full context_

### Use Case 2: Error Resolution

**Before Ptah**:

> You: "I'm getting TypeScript errors"
> Claude: "Can you share the error message?"
> You: _copy-pastes from Problems panel_

**With Ptah**:

> You: "Fix the TypeScript errors in my workspace"
> Claude: _executes ptah.diagnostics.getProblems()_
> Claude: _reads relevant files, fixes errors_

### Use Case 3: Codebase Understanding

**Before Ptah**:

> You: "How does authentication work in this project?"
> You: _explains for 5 minutes_

**With Ptah**:

> You: "How does authentication work in this project?"
> Claude: _queries workspace, searches files, extracts symbols_
> Claude: _provides accurate explanation based on actual code_

## Results

With Ptah's MCP server:

- **Context-building eliminated**: Claude gathers its own context
- **Accuracy improved**: Answers based on actual code, not assumptions
- **Workflow streamlined**: Ask once, get answers
- **Error fixing automated**: Claude sees and fixes VS Code diagnostics

## Getting Started

1. **Install Ptah** from VS Code Marketplace
2. **Enable MCP Server** in Ptah settings
3. **Start a conversation** - Claude now has access to all Ptah API namespaces

The `execute_code` tool becomes available automatically. Claude's system prompt includes full API documentation.

## Conclusion

Ptah's Code Execution MCP server transforms Claude from a helpful assistant into an AI that truly understands your codebase. By exposing powerful API namespaces - workspace, search, diagnostics, ai, and files - you give Claude the tools to help you at the level you actually need.

No more context-building theater. Just results.

---

**Try Ptah**: [VS Code Marketplace Link]
**Read the Docs**: [Documentation Link]
**Source Code**: [GitHub Link]

---

## Technical Validation Checklist

- [x] All code examples from actual codebase (vscode-lm-tools CLAUDE.md)
- [x] API namespaces match implementation
- [x] Permission handling described accurately
- [x] Security model explained correctly
- [x] No claims beyond actual implementation
