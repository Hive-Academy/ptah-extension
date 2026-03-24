# Video Script: Ptah Hidden Features Deep Dive

## Metadata

- **Length**: 6-8 minutes
- **Type**: Technical Explainer / Feature Tutorial
- **Audience**: Developers already using Ptah or considering it
- **Goal**: Reveal hidden depth, drive feature adoption, establish authority

---

## HOOK (0:00-0:20)

### Visual

_Iceberg graphic: "What you see" (small top) vs "What's underneath" (massive bottom)_

### Narration

"Ptah is a VS Code extension powered by Claude Code's Agent SDK. But most people don't realize what's underneath the surface - 12 specialized libraries that extend what Claude can do in your editor. Let me show you."

### Action

_Iceberg animates to reveal labels: workspace-intelligence, agent-sdk, vscode-lm-tools, llm-abstraction, agent-generation, template-generation_

---

## OVERVIEW (0:20-0:50)

### Visual

_Architecture diagram from CLAUDE.md_

### Narration

"Ptah isn't one codebase - it's 12 specialized libraries. Two apps, ten backend and frontend libraries. 280 TypeScript files. 60+ dependency injection tokens. This is enterprise-grade architecture hidden behind a clean chat interface."

### On-Screen

```
Ptah Architecture:
├── apps/
│   ├── ptah-extension-vscode (VS Code extension)
│   └── ptah-extension-webview (Angular SPA)
├── libs/backend/
│   ├── agent-sdk          ← 10x faster SDK
│   ├── vscode-lm-tools    ← MCP superpowers
│   ├── workspace-intelligence ← Project detection
│   ├── agent-generation   ← Custom agents
│   ├── llm-abstraction    ← Multi-provider
│   └── template-generation ← Dynamic templates
└── libs/frontend/ (5 UI libraries)
```

---

## HIDDEN FEATURE 1: Workspace Intelligence Engine (0:50-2:00)

### Visual

_Open workspace-intelligence library structure_

### Narration

"Hidden feature number one: the Workspace Intelligence engine. This isn't simple project detection - it's a full analysis suite."

### On-Screen

_Show file tree of workspace-intelligence/src/_

### Narration

"Ptah detects 13 project types: Node, React, Vue, Angular, Next.js, Python, Java, Rust, Go, .NET, PHP, Ruby, and generic. But it doesn't stop there."

### Action

_Open monorepo-detector.service.ts_

### Narration

"It recognizes 6 monorepo tools: Nx, Lerna, Rush, Turborepo, pnpm workspaces, and Yarn workspaces. Open a monorepo and Ptah knows your package count, workspace configuration, and project boundaries."

### Code Callout

```typescript
// What happens when you open a workspace:
const result = await detector.detectMonorepo(workspaceUri);
// {
//   isMonorepo: true,
//   type: MonorepoType.Nx,
//   packageCount: 12,
//   workspaceFiles: ['nx.json', 'workspace.json']
// }
```

### Narration

"But here's the feature nobody knows about: Context Size Optimization."

### Visual

_Show context-size-optimizer.service.ts_

### Narration

"When Claude needs context, Ptah doesn't just dump files. It uses a greedy algorithm to select the most relevant files within your token budget. Different budgets for different project types: 200k for monorepos, 175k for apps, 150k for libraries. Response reserves calculated automatically."

### Code Callout

```typescript
// Intelligent file selection
const result = await optimizer.optimizeContext({
  files: indexedFiles,
  query: 'implement authentication',
  maxTokens: 200_000,
  responseReserve: 50_000,
});
// Returns: selectedFiles, excludedFiles, stats
```

---

## HIDDEN FEATURE 2: Multi-Provider LLM Abstraction (2:00-3:00)

### Visual

_Open llm-abstraction library_

### Narration

"Hidden feature number two: you're not locked to Claude. Ptah has a full Langchain-powered LLM abstraction layer supporting 5 providers."

### On-Screen

```
Supported Providers:
1. Anthropic (Claude 3.5 Sonnet, Opus, Haiku)
2. OpenAI (GPT-4 Turbo, GPT-4, GPT-3.5)
3. Google Gemini (1.5 Pro, 1.5 Flash)
4. OpenRouter (Any model they support)
5. VS Code LM API (No API key needed!)
```

### Narration

"That last one is interesting. VS Code has a built-in Language Model API. Ptah can use it without any API key configuration. Free AI assistance using VS Code's own models."

### Code Callout

```typescript
// Switch providers seamlessly
const response = await llmService.generate({
  prompt: 'Explain this code',
  provider: 'openai', // or 'anthropic', 'google-genai'
  model: 'gpt-4-turbo',
  temperature: 0.7,
});
```

### Narration

"The LlmService handles provider selection automatically. Use claude-3-5-sonnet and it routes to Anthropic. Use gpt-4 and it routes to OpenAI. One interface, any model."

---

## HIDDEN FEATURE 3: Project-Adaptive Agent Generation (3:00-4:15)

### Visual

_Open agent-generation library_

### Narration

"Hidden feature number three: adaptive agent generation. This is where it gets interesting."

### Narration

"When you run Ptah's setup wizard, it doesn't just generate generic agents. It analyzes your workspace, scores agent relevance, and generates customized markdown files."

### On-Screen

_Show agent selection flow diagram_

```
Setup Wizard Flow:
1. Workspace Analysis
   └─ Project type, frameworks, architecture
2. Agent Selection
   └─ Score relevance (0-100) per agent type
3. Template Processing
   └─ Load template, parse frontmatter
4. LLM Customization
   └─ Expand template with project context
5. Validation
   └─ Zod schema validation
6. File Generation
   └─ Write to .claude/agents/*.md
```

### Narration

"The templates aren't static strings. They're processed through a full template engine with Handlebars interpolation and LLM expansion zones."

### Code Callout

```typescript
// Agent selection based on workspace
const recommendations = await agentSelection.getRecommendations({
  projectType: 'Node.js',
  frameworks: ['NestJS', 'Angular'],
  complexity: 'high',
});
// [
//   { agentName: 'backend-developer', score: 0.95 },
//   { agentName: 'frontend-developer', score: 0.90 },
//   { agentName: 'architect', score: 0.85 }
// ]
```

### Narration

"A NestJS backend gets a backend-developer agent trained on NestJS patterns. An Angular frontend gets agents that understand Angular signals and zoneless change detection. Your agents know YOUR stack."

---

## HIDDEN FEATURE 4: The Full Ptah API (4:15-5:30)

### Visual

_Open vscode-lm-tools, show PtahAPIBuilder_

### Narration

"Hidden feature number four: the complete Ptah API that Claude can access through the MCP server. Most people know about search and workspace. But there are 14 namespaces."

### On-Screen

```typescript
// Full Ptah API available to Claude:
ptah.workspace; // Project info, frameworks, monorepo
ptah.search; // Semantic file search, relevance scoring
ptah.diagnostics; // VS Code problems, errors, warnings
ptah.ai; // Multi-provider LLM generation
ptah.files; // Read, write, list, exists
ptah.ast; // Tree-sitter AST parsing
ptah.ide.lsp; // LSP features (references, definitions)
ptah.agent; // Background agent orchestration
// ... and 6 more namespaces
```

### Narration

"Let me show you the one people miss: ptah.ide.lsp."

### Action

_Demo typing in chat: "Find all references to AuthService"_

### Narration

"Claude can use LSP features directly. Find references. Go to definition. All the power of VS Code's Language Server Protocol is available to Claude through Ptah."

### Code Callout

```typescript
// Claude can do this:
const refs = await ptah.ide.lsp.getReferences('src/auth.ts', 15, 8);
const def = await ptah.ide.lsp.getDefinition('src/app.ts', 10, 20);
```

---

## HIDDEN FEATURE 5: AST Parsing with Tree-sitter (5:30-6:15)

### Visual

_Open workspace-intelligence/ast folder_

### Narration

"Hidden feature number five: native Tree-sitter AST parsing. This is Phase 2 infrastructure that most users don't even know exists."

### Code Callout

```typescript
// Native AST parsing
const result = parser.parse(sourceCode, 'typescript');
// Returns: GenericAstNode - platform-agnostic AST
```

### Narration

"Ptah can parse JavaScript and TypeScript into a generic AST without running the TypeScript compiler. This powers symbol extraction and will enable future features like semantic code search and intelligent refactoring suggestions."

### On-Screen

_Show tree-sitter.config.ts with language mappings_

---

## HIDDEN FEATURE 6: Autocomplete Discovery Services (6:15-6:45)

### Visual

_Show autocomplete services in workspace-intelligence_

### Narration

"Hidden feature number six: autocomplete discovery. When you type @ or / in the chat input, Ptah discovers what's available."

### On-Screen

```
Discovery Services:
├── agent-discovery.service.ts
│   └─ Find @agents (builtin, project, user)
├── mcp-discovery.service.ts
│   └─ Find MCP servers (health checking)
└── command-discovery.service.ts
    └─ Find /commands (builtin, project, user)
```

### Narration

"It scans .claude/agents, .mcp.json, and command directories. It parses YAML frontmatter for metadata. It even health-checks MCP servers to show online/offline status."

---

## PROOF / SUMMARY (6:45-7:15)

### Visual

_Return to iceberg, now fully revealed_

### Narration

"That's 6 hidden features you probably didn't know about:

1. Workspace Intelligence with 13 project types and context optimization
2. Multi-provider LLM with 5 providers including free VS Code LM
3. Project-adaptive agent generation with LLM expansion
4. The full 14-namespace Ptah API for Claude
5. Native Tree-sitter AST parsing
6. Autocomplete discovery for agents, MCPs, and commands"

### On-Screen

_Stats from CLAUDE.md_

```
What's Really in Ptah:
• 12 specialized libraries
• 280+ TypeScript files
• 60+ DI tokens
• 94 message protocol types
• 48+ Angular components
```

### Narration

"This isn't a chat wrapper. It's an AI development platform that happens to have a really clean interface."

---

## CTA (7:15-7:45)

### Visual

_GitHub repo page_

### Narration

"Want to explore the code yourself? Ptah is open source. Check out the libs folder - each library has its own CLAUDE.md with full architecture documentation."

### On-Screen

- GitHub: github.com/[repo]
- Docs: [docs link]
- Marketplace: [marketplace link]

### Narration

"If you're using Ptah, you now know what's really running under the hood. If you're not, maybe it's time to find out. Links in the description."

---

## B-ROLL SHOT LIST

| Timestamp | Description               | Source           |
| --------- | ------------------------- | ---------------- |
| 0:00      | Iceberg graphic animation | Custom graphic   |
| 0:30      | Architecture diagram      | CLAUDE.md        |
| 1:00      | File tree navigation      | Screen recording |
| 2:00      | Provider logos            | Graphic          |
| 3:00      | Setup wizard flow         | Screen recording |
| 4:30      | ptah.ide.lsp demo         | Screen recording |
| 5:30      | AST visualization         | Custom graphic   |

## TECHNICAL REQUIREMENTS

### Code Snippets Needed

1. Monorepo detection result
2. Context optimization call
3. LLM provider switching
4. Agent selection recommendations
5. Ptah API namespace listing
6. Tree-sitter parse call

### Diagrams to Create

1. Iceberg (visible vs hidden features)
2. Architecture overview
3. Agent generation flow
4. Ptah API namespace visual

### Screen Recordings

1. File tree navigation in libs/
2. Setup wizard flow
3. Autocomplete discovery in action
4. ptah.ide.lsp execution

---

## Technical Validation Checklist

- [x] All 6 features exist and work as described
- [x] Code examples from actual codebase
- [x] Stats from CLAUDE.md (280+ files, 60+ tokens, etc.)
- [x] Library structure accurate
- [x] No features shown that are planned but not implemented
