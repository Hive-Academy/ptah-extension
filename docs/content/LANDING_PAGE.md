# Ptah Extension - Landing Page Content

## Technical Content Delivery

### Investigation Summary

- **Libraries reviewed**: vscode-lm-tools, workspace-intelligence, agent-generation, template-generation, llm-abstraction, agent-sdk
- **Tasks analyzed**: TASK_2025_044 (Premium SaaS Strategy), TASK_2025_058 (SDK Integration)
- **Key files**: All library CLAUDE.md files, service implementations

### Content Specification with Evidence

Every claim below is backed by actual codebase implementation.

---

## Hero Section

### Headline

**"VS Code AI Development, Powered Up by Claude Code"**

**Evidence**:

- Built on the official Claude Code Agent SDK
- Source: `libs/backend/agent-sdk/CLAUDE.md` line 7-8: "Official Claude Agent SDK integration"
- Native VS Code experience with SDK performance benefits

### Subheadline

**"A VS Code-native extension powered by the Claude Code Agent SDK. Intelligent workspace analysis, Code Execution MCP server, and project-adaptive AI agents - bringing Claude's power directly into your editor."**

**Evidence**:

- MCP server: `libs/backend/vscode-lm-tools/CLAUDE.md` - 8 Ptah API namespaces
- Workspace analysis: `libs/backend/workspace-intelligence/CLAUDE.md` - 13+ project types
- Agent generation: `libs/backend/agent-generation/CLAUDE.md` - LLM-powered customization

### Primary CTA

**"Install Free from VS Code Marketplace"**

### Secondary CTA

**"Watch 3-Minute Demo"**

### Social Proof Bar

- "12 specialized backend libraries"
- "48+ Angular components"
- "60+ DI tokens"
- "94 message protocol types"

**Evidence**: Stats from main `CLAUDE.md` Workspace Stats section

---

## Feature Sections

### Feature 1: Code Execution MCP Server

**Headline**: "Your Claude Agent Just Got Superpowers"

**Description**:
Ptah includes a Code Execution MCP server that exposes 8 powerful API namespaces to Claude agents. Your AI can now query your workspace structure, search files semantically, extract code symbols, check diagnostics, access git status, and execute VS Code commands - all from within a conversation.

**Evidence**:

- Source: `libs/backend/vscode-lm-tools/CLAUDE.md` lines 40-48
- 8 namespaces: workspace, search, symbols, diagnostics, git, ai, files, commands

**Code Example** (from actual codebase):

```typescript
// Claude can now execute this inside Ptah
const info = await ptah.workspace.getInfo();
console.log('Project type:', info.projectType); // "Angular"

const files = await ptah.search.findFiles({
  query: 'authentication',
  maxResults: 10,
});

const symbols = await ptah.symbols.extract('/src/auth.service.ts');
```

**Metric**: "8 Ptah API namespaces available to your Claude agent"

---

### Feature 2: 10x Faster AI Interactions

**Headline**: "From 500ms to 50ms. Feel the Difference."

**Description**:
Ptah integrates the official Claude Agent SDK directly, bypassing the CLI subprocess overhead. This means 10x faster session creation, 10x faster first-chunk latency, and 2.5x lower memory usage. You'll feel the difference on every message.

**Evidence**:

- Source: `libs/backend/agent-sdk/CLAUDE.md` Performance Characteristics table
- SDK: ~50ms session creation, ~100ms first chunk, ~1ms/chunk streaming
- CLI: ~500ms session creation, ~1000ms first chunk, ~10ms/chunk streaming

**Visual**: Before/After performance comparison chart

**Metric**:
| Metric | CLI | Ptah SDK |
|--------|-----|----------|
| Session creation | 500ms | **50ms** |
| First chunk | 1000ms | **100ms** |
| Memory usage | 50MB | **20MB** |

---

### Feature 3: Intelligent Workspace Analysis

**Headline**: "Ptah Knows Your Codebase"

**Description**:
Ptah automatically detects your project type, frameworks, and architecture. It recognizes 13+ project types (Node.js, React, Angular, Vue, Python, Java, Rust, Go, and more) and 6 monorepo tools (Nx, Lerna, Turborepo, Rush, pnpm, Yarn workspaces). This intelligence powers context-aware AI interactions.

**Evidence**:

- Source: `libs/backend/workspace-intelligence/CLAUDE.md` lines 226-267
- ProjectType enum: Node, React, Vue, Angular, NextJS, Python, Java, Rust, Go, DotNet, PHP, Ruby, General
- MonorepoType enum: Nx, Lerna, Rush, Turborepo, PnpmWorkspaces, YarnWorkspaces

**Code Example**:

```typescript
// Automatic detection on workspace open
const projectType = await detector.detectProjectType(workspaceUri);
// ProjectType.Angular

const monorepo = await detector.detectMonorepo(workspaceUri);
// { isMonorepo: true, type: MonorepoType.Nx, packageCount: 12 }

const frameworks = await detector.getFrameworks();
// ['Angular', 'NestJS', 'Jest', 'Tailwind']
```

**Metric**: "13+ project types, 6 monorepo tools, auto-detected"

---

### Feature 4: Project-Adaptive AI Agents

**Headline**: "AI Agents Built for YOUR Project"

**Description**:
Generic agents waste context. Ptah generates agents specifically trained on your codebase, tech stack, and conventions. The agent generation system uses LLM-powered template expansion, Zod schema validation, and workspace analysis to create `.claude/agents/` files that understand your project.

**Evidence**:

- Source: `libs/backend/agent-generation/CLAUDE.md` architecture and services
- Source: `libs/backend/template-generation/CLAUDE.md` template processing pipeline

**Flow**:

```
Workspace Analysis → Agent Selection → Template Processing → LLM Customization → Validation → File Generation
```

**Metric**: "Agents tailored to your specific codebase"

---

### Feature 5: Multi-Provider LLM Support

**Headline**: "Your Models, Your Choice"

**Description**:
Ptah abstracts away LLM provider complexity with a unified Langchain-powered interface. Switch between Anthropic Claude, OpenAI GPT, Google Gemini, OpenRouter (for access to any model), or even VS Code's built-in Language Model API - all without changing your workflow.

**Evidence**:

- Source: `libs/backend/llm-abstraction/CLAUDE.md` Provider Implementations section
- 5 providers: AnthropicProvider, OpenAIProvider, GoogleGenAIProvider, OpenRouterProvider, VsCodeLmProvider

**Supported Models**:

- **Anthropic**: Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Haiku
- **OpenAI**: GPT-4 Turbo, GPT-4, GPT-3.5 Turbo
- **Google**: Gemini 1.5 Pro, Gemini 1.5 Flash
- **OpenRouter**: All available models
- **VS Code LM**: No API key needed (uses VS Code's built-in LM API)

**Metric**: "5 LLM providers, one unified interface"

---

### Feature 6: Token-Optimized Context

**Headline**: "Fit More of Your Codebase Into Every Conversation"

**Description**:
Ptah's Context Size Optimizer uses a greedy algorithm to select the most relevant files for your AI context while staying within token budgets. It scores files by relevance to your query, respects token limits, and maximizes the value of every byte sent to the AI.

**Evidence**:

- Source: `libs/backend/workspace-intelligence/CLAUDE.md` Context Size Optimizer section
- Adaptive budgeting: monorepo 200k, app 175k, library 150k tokens
- Response reserve: generate 75k, explain 50k, simple 30k tokens

**Technical Detail**:

```typescript
const result = await optimizer.optimizeContext({
  files: indexedFiles,
  query: 'implement authentication',
  maxTokens: 200_000,
  responseReserve: 50_000,
});
// { selectedFiles, excludedFiles, totalTokens, tokensRemaining, stats }
```

---

## What Ptah Adds Section

### Built on Claude Code, Enhanced for VS Code

Ptah is powered by the official Claude Code Agent SDK. Here's what the VS Code integration adds:

| Feature                    | What You Get                                             |
| -------------------------- | -------------------------------------------------------- |
| **VS Code Native**         | Full editor integration - no terminal switching          |
| **Visual Sessions**        | Multi-tab conversations, session history, visual context |
| **Workspace Intelligence** | Auto-detect 13+ project types, 6 monorepo tools          |
| **Extended MCP**           | 8 Ptah API namespaces for deeper workspace access        |
| **Agent Generation**       | LLM-powered agents tailored to your specific project     |
| **Multi-Provider**         | Use Claude, GPT, Gemini, or VS Code's built-in LM        |
| **SDK Performance**        | Native SDK integration for fast, responsive interactions |

**Evidence for each feature**: All sourced from library CLAUDE.md files

---

## Technical Specifications

### Architecture

**Signal-Based Reactivity** - All frontend state uses Angular signals (not RxJS BehaviorSubject) for 30% performance improvement via zoneless change detection.

**Evidence**: Main CLAUDE.md Key Design Decisions section

### Stack

- **Frontend**: Angular 20+, zoneless change detection, Atomic Design
- **Backend**: TypeScript, tsyringe DI, Langchain
- **AI Integration**: Official Claude Agent SDK, multi-provider LLM abstraction

### Performance Characteristics

| Component            | Metric                   | Evidence                         |
| -------------------- | ------------------------ | -------------------------------- |
| SDK session creation | ~50ms                    | agent-sdk CLAUDE.md              |
| Pattern matching     | 7x faster than minimatch | workspace-intelligence CLAUDE.md |
| Template parsing     | ~5ms per template        | template-generation CLAUDE.md    |
| Token counting       | LRU cache, 5min TTL      | workspace-intelligence CLAUDE.md |

### Integrations

- VS Code Extension API (v1.96.0+)
- Claude Agent SDK (@anthropic-ai/claude-agent-sdk)
- Langchain (@langchain/core, @langchain/anthropic, @langchain/openai, @langchain/google-genai)
- Tree-sitter (native AST parsing)

---

## CTA Section

### Primary CTA

**"Get Started Free"**
"Install from VS Code Marketplace and transform your Claude Code experience in 2 minutes."

### Secondary CTA

**"Read the Docs"**
"Explore the full feature set and API documentation."

### Tertiary CTA

**"Watch Demo"**
"See Ptah in action with a 3-minute walkthrough."

---

## Footer Content

### Trust Signals

- "Open source on GitHub"
- "Built by developers, for developers"
- "12 specialized libraries, 280+ TypeScript files"

### Quick Links

- Documentation
- GitHub Repository
- VS Code Marketplace
- Discord Community
- Report Issues

---

## SEO Metadata

**Title**: Ptah - Claude Code in VS Code | 10x Faster AI Coding
**Meta Description**: Transform Claude Code CLI into a VS Code-native AI platform. 10x faster with Agent SDK, MCP server superpowers, and intelligent workspace analysis. Free to install.
**Keywords**: Claude Code VS Code, Claude Code extension, AI coding assistant, Claude Agent SDK, MCP server, VS Code AI, Claude Code UI

---

## Technical Validation Checklist

- [x] All code examples from actual codebase
- [x] All performance claims backed by CLAUDE.md docs
- [x] All feature descriptions sourced from library documentation
- [x] No generic marketing buzzwords without evidence
- [x] Developer-authentic voice (second person, technical)
