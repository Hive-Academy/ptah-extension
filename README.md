# Ptah - AI Coding Orchestra

**Provider-agnostic AI orchestration for VS Code.**
Intelligent workspace analysis, Code Execution MCP server, and project-adaptive multi-agent workflows — all natively integrated into VS Code.

[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=ptah-extensions.ptah-extension-vscode) | [Desktop App](https://github.com/Hive-Academy/ptah-extension/releases/latest) | [License](https://github.com/Hive-Academy/ptah-extension/blob/main/LICENSE.md)

---

## Getting Started

Everything you need to install Ptah, connect your AI provider, and start building with intelligent agents inside VS Code.

---

## Installation & Pro Trial

### Option A: VS Code Extension

Search for **"Ptah"** in the Extensions panel (`Ctrl+Shift+X`) or install directly from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=ptah-extensions.ptah-extension-vscode).

### Option B: Desktop App (Standalone)

Download the standalone desktop app for your platform from [GitHub Releases](https://github.com/Hive-Academy/ptah-extension/releases/latest):

| Platform | Download                      |
| -------- | ----------------------------- |
| Windows  | `.exe` installer              |
| macOS    | `.dmg` disk image             |
| Linux    | `.AppImage` or `.deb` package |

### Create Your Account & Activate

1. Visit [ptah.live/signup](https://ptah.live/signup) — no credit card required. Your **30-day Pro trial** activates automatically.
2. Sign in from within Ptah (VS Code sidebar or desktop app) — your Pro trial license activates automatically.

> **Pro Trial includes**: All 13 AI agents, orchestration workflows, multi-provider support, plugin system, and full setup wizard — free for 30 days.

---

## Authentication Setup

Ptah supports multiple authentication methods. **API Key** or **third-party Provider** is recommended.

Access settings via: **Ptah sidebar → gear icon → four tabs: Provider, API Key, Auto**

### API Key (Recommended)

Use your own API key for pay-per-token billing — no subscription required.

1. Obtain an API key from your AI provider
2. Open Ptah settings → **API Key** tab → paste key → **Save & Test**

### Provider (OpenRouter, Moonshot, Z.AI)

Use third-party AI providers with your own API key. Each provider offers access to hundreds of models through a single key.

1. Select **Provider** tab
2. Choose your provider
3. Enter API key → **Save & Test**

### Auto Mode

Tries all configured credentials automatically.

> Always click **"Save & Test Connection"** to verify credentials.

---

## Provider APIs

Bring your own API key and use the full agentic experience with the model of your choice. Pay only through your provider's billing.

### OpenRouter

200+ models through a single API key — multi-provider gateway supporting all major AI providers.

- Key format: `sk-or-v1-...`
- Get your key at [openrouter.ai/keys](https://openrouter.ai/keys)

### Moonshot (Kimi)

Kimi K2 models with extended thinking support.

| Model                | Context           |
| -------------------- | ----------------- |
| kimi-k2              | 128K              |
| kimi-k2-0905-preview | 256K              |
| kimi-k2-thinking     | Extended thinking |
| kimi-k2.5            | 256K              |

### Z.AI (GLM)

GLM models with multilingual support.

| Model          | Context | Notes             |
| -------------- | ------- | ----------------- |
| GLM-5          | 200K    | Opus-class        |
| GLM-5 Code     | 200K    | Code-optimized    |
| GLM-4.7        | 200K    |                   |
| GLM-4.7 FlashX | 200K    | Accelerated       |
| GLM-4.7 Flash  | -       | Free tier         |
| GLM-4.5-X      | 128K    | Extended thinking |
| GLM-4.5        | 128K    |                   |
| GLM-4.5 AirX   | 128K    | Accelerated MoE   |
| GLM-4.5 Air    | 128K    | Lightweight       |
| GLM-4.5 Flash  | 128K    | Free tier         |

### Model Tier Mapping

Map provider models to Ptah tiers so when Ptah requests a tier, the correct model is used:

- **Opus** — Most capable tier, best for complex coding tasks
- **Sonnet** — Balanced tier, good performance at lower cost
- **Haiku** — Fast tier, ideal for quick simple tasks

---

## Plugins

Extend Ptah with skill plugins that add specialized agents, workflows, and code patterns. Browse and install from **"Configure Ptah Skills"** in settings.

### Ptah Core (Default)

6 skills, 5+ commands — Orchestration, Code Review, DDD Architecture, Content Writer, UI/UX Designer, Skill Creator.

### Ptah Angular (Optional)

3 skills — 3D Scene Crafter, Frontend Patterns, GSAP Animations. Angular-focused for immersive 3D scenes, scalable frontend patterns, and smooth scroll animations.

### Ptah NX SaaS (Optional)

7 skills, 2+ commands — NestJS Patterns, NX Workspace Architect, SaaS Initializer, Webhook Architecture, Resilient NestJS Patterns, SaaS Platform Patterns, NestJS Deployment.

### Ptah React (Optional)

3 skills — Composition Patterns, Best Practices, NX Patterns. React-focused for composition patterns, best practices enforcement, and Nx monorepo patterns.

---

## Agent Orchestration

Spawn **Gemini CLI**, **Codex**, and **GitHub Copilot** as headless background workers, or connect your own providers via Ptah CLI Agents. Primary agent delegates subtasks and checks back for results — a fire-and-check pattern for true multi-agent workflows.

### Built-in Agents (Auto-detected)

| Agent              | Type | Description                                        |
| ------------------ | ---- | -------------------------------------------------- |
| **Gemini CLI**     | CLI  | Google Gemini models, non-interactive prompt mode  |
| **Codex**          | SDK  | OpenAI models via Codex SDK, quiet mode            |
| **GitHub Copilot** | SDK  | Native SDK integration with full permission bridge |

### Ptah CLI Agents (User-configurable)

Connect any compatible provider as a background agent. Each gets its own API key, model selection, and tier mappings. Supported: **OpenRouter**, **Moonshot (Kimi)**, **Z.AI (GLM)**.

### Agent MCP Tools

| Tool                | Description                                        |
| ------------------- | -------------------------------------------------- |
| `ptah_agent_spawn`  | Launch a CLI or SDK agent with task in background  |
| `ptah_agent_status` | Check progress of one or all running agents        |
| `ptah_agent_read`   | Read stdout/stderr output from an agent            |
| `ptah_agent_steer`  | Send steering instructions to running agent        |
| `ptah_agent_stop`   | Gracefully stop a running agent process            |
| `ptah_agent_list`   | List all available agents and their current status |

### Fire-and-Check Workflow

1. **Spawn** — Primary agent launches background agent with task
2. **Continue** — Primary agent continues its own work independently
3. **Check** — Periodically checks agent status (running, completed, failed)
4. **Read** — Once complete, reads output and incorporates results

### When to Delegate

- Code reviews while implementing features
- Test generation while writing code
- Documentation while building
- Linting and formatting tasks
- Dependency audits in the background
- Multi-provider parallel task execution
- Cross-validation with different AI models

### Configuration

```json
{
  "ptah.agentOrchestration.preferredAgentOrder": ["gemini", "copilot"],
  "ptah.agentOrchestration.maxConcurrentAgents": 3
}
```

---

## Setup Wizard

The setup wizard scans your workspace and configures Ptah's AI agents for your project automatically.

### 6-Step Flow

**Scan → Analyze → Detect → Select Agents → Generate Rules → Complete**

### How to Use

1. **Open Setup Wizard** — Click "Setup Wizard" in the Ptah sidebar or run `Ptah: Run Setup Wizard` from Command Palette (`Ctrl+Shift+P`)
2. **Let it scan** — Wizard detects project type, frameworks, dependencies, and configurations. Supports 13+ project types (React, Angular, Node.js, Python, etc.)
3. **Review and generate** — Review detected agents, adjust selections, generate project-specific rules and agent configurations

---

## Ptah MCP Server

Built-in MCP (Model Context Protocol) server runs inside the VS Code extension host. Gives AI agents direct access to VS Code capabilities — LSP, diagnostics, workspace analysis, git, and more.

> **Pro feature** — automatically enabled with active license. Agents query Ptah APIs for structured, accurate results in a single call instead of manual file exploration and bash commands.

### How It Works

1. Extension startup launches MCP server on local port
2. Server registers in workspace's `.mcp.json`
3. Every AI agent spawned via `Task` tool auto-discovers it
4. Gets system prompt preferring Ptah tools over built-ins

### Available MCP Tools

| Tool                     | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| `ptah_workspace_analyze` | Full project analysis: type, frameworks, architecture    |
| `ptah_search_files`      | Glob search respecting .gitignore                        |
| `ptah_get_diagnostics`   | Live TypeScript errors and warnings from language server |
| `ptah_lsp_references`    | Find all references to a symbol via LSP                  |
| `ptah_lsp_definitions`   | Go-to-definition through re-exports and node_modules     |
| `ptah_get_dirty_files`   | Unsaved files in VS Code editor buffers                  |
| `ptah_count_tokens`      | Token count for file using model tokenizer               |
| `execute_code`           | Run TypeScript with access to all 14 `ptah.*` APIs       |

### 14 API Namespaces

```
ptah.workspace    — project info          ptah.context      — token budget
ptah.search       — file search           ptah.project      — deep analysis
ptah.diagnostics  — errors                ptah.relevance    — file scoring
ptah.ai           — multi-LLM            ptah.ast          — tree-sitter
ptah.files        — file I/O             ptah.ide.lsp      — LSP features
ptah.dependencies — dep analysis          ptah.ide.editor   — editor state
ptah.agent        — background agents     ptah.ide.actions  — refactoring
```

### Example

```typescript
const project = await ptah.workspace.analyze();
// → { type: "angular-nx", frameworks: ["Angular 20", "NestJS"] }

const errors = await ptah.diagnostics.getErrors();
// → [{ file: "app.ts", line: 42, message: "TS2345: ..." }]

const refs = await ptah.ide.lsp.getReferences('src/auth.ts', 15, 8);
// → Find every file that uses this function
```

### Security Model

- **Read-only** operations (workspace info, diagnostics, file search) run without prompts
- **Modifications** (file writes, git operations) trigger a permission dialog in VS Code
- All code execution has configurable timeouts
- Results truncated at 50KB to prevent context overflow

---

## Chat & Dashboard

Native VS Code chat interface with real-time agent visualization and performance dashboard.

### Recursive ExecutionNode Tree

Every agent action renders as a live execution tree — see the main agent spawning sub-agents, every tool call with file paths, thinking blocks, and results, all updating in real-time as tokens stream in.

### Chat Features

- **@agent autocomplete** — Type `@` to discover and select from builtin, project, and user agents
- **/command autocomplete** — Type `/` to discover slash commands from builtin and project directories
- **Streaming text reveal** — Character-by-character response rendering with typing cursor animation
- **Session management** — Create, switch, and resume sessions with full history preserved
- **Real-time cost tracking** — Token usage and cost displayed per session with input/output breakdown
- **File attachments** — Fuzzy file search to attach workspace files as context

### Performance Dashboard

Real-time and historical analytics for all AI sessions.

- Filter by time range (24h, 7d, 30d, 90d)
- Export data as CSV or JSON
- **Metrics**: Total Cost, Token Usage, Session Count, Agent Performance

---

## Orchestration Workflow

The `/orchestrate` command delegates complex tasks across specialized AI agents with user checkpoints at every stage.

### Quick Start

```
/orchestrate Add user authentication with OAuth support

# Or specify a workflow type:
/orchestrate FEATURE Add dark mode toggle to settings
```

### Workflow Types

`FEATURE` · `BUGFIX` · `REFACTORING` · `DOCUMENTATION` · `RESEARCH` · `DEVOPS` · `CREATIVE`

### Agent Delegation Flow

**Project Manager** → **Software Architect** → **Team Leader** → **Developers** → **QA / Reviewer**

You approve each stage before the workflow proceeds — plans, architecture decisions, implementation strategies, and final code review. Nothing ships without your sign-off.

---

## Development

### Setup

```bash
git clone https://github.com/Hive-Academy/ptah-extension.git
cd ptah-extension
npm install
npm run compile
```

### Running the Extension

1. Open the project in VS Code
2. Press `F5` to launch Extension Development Host
3. Test the extension in the new VS Code window

### Available Scripts

```bash
npm run compile      # Compile TypeScript
npm run watch        # Watch mode
npm run test         # Run tests
npm run lint         # Lint code
npm run build:all    # Build everything
```

---

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

Ptah is licensed under the [Functional Source License, Version 1.1, MIT Future License](LICENSE.md) (FSL-1.1-MIT).

### What This Means

**You CAN:**

- Use Ptah for internal development, education, research, and professional services
- Read, modify, and redistribute the source code for any non-competing purpose
- Use any version under the full MIT license two years after its release

**You CANNOT:**

- Offer Ptah (or a substantially similar product) as a competing commercial product or service

The FSL is a [Fair Source](https://fair.io/) license designed to balance user freedom with developer sustainability. Every version of Ptah automatically converts to the permissive MIT license two years after release. This means today's code will be fully open source by 2028.

For full details, see [LICENSE.md](LICENSE.md).

## Links

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=ptah-extensions.ptah-extension-vscode)
- [Desktop App Downloads](https://github.com/Hive-Academy/ptah-extension/releases/latest)
- [Issue Tracker](https://github.com/Hive-Academy/ptah-extension/issues)
- [Discussions](https://github.com/Hive-Academy/ptah-extension/discussions)

---

<p align="center"><strong>Made with care for the VS Code community</strong></p>
