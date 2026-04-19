# Ptah - The Coding Orchestra

**Provider-agnostic AI orchestration with intelligent workspace analysis and multi-agent workflows.**

---

## What is Ptah?

Ptah is an AI-powered development environment that brings multi-agent orchestration, workspace intelligence, and a built-in MCP server directly into your editor. It analyzes your codebase, configures specialized AI agents, and coordinates them to tackle complex development tasks.

---

## Key Features

### Multi-Agent Orchestration

Spawn multiple AI agents as headless background workers. The primary agent delegates subtasks and checks back for results — enabling true parallel multi-agent workflows.

- Built-in agents auto-detected from installed CLIs
- Custom agents configurable with your own provider and API key
- Spawn, monitor, steer, and collect results via MCP tools

### Built-in MCP Server

14 API namespaces give AI agents structured access to workspace analysis, LSP diagnostics, AST parsing, file search, dependency graphs, and editor state — all in a single tool call.

### Setup Wizard

Automated 6-step workspace scanning: detects project type, frameworks, and dependencies across 13+ project types. Generates project-specific agent configurations and rules.

### Plugin System

Extend with skill plugins for orchestration workflows, code review, architecture patterns, content generation, and UI/UX design. Available for Angular, React, NestJS, and NX workspaces.

### Chat Interface

Native editor chat with real-time execution tree visualization, session management, cost tracking, file attachments, and streaming text reveal.

### Performance Dashboard

Real-time and historical analytics for cost, tokens, sessions, and agent performance. Filter by time range and export as CSV or JSON.

### Orchestration Workflows

Seven workflow types — Feature, Bugfix, Refactoring, Documentation, Research, DevOps, Creative — each with specialized agent delegation and user approval checkpoints at every stage.

---

## Authentication

Multiple auth methods supported:

- **API Key** — Pay-per-token with your own key (recommended)
- **Provider** — Third-party AI providers with hundreds of models
- **Auto** — Tries all configured credentials automatically

---

## Getting Started

1. Install the extension
2. Sign up at **ptah.live** for a free 100-day Pro trial No credit card required
3. Configure your AI provider in the sidebar settings
4. Run the Setup Wizard to analyze your workspace
5. Start chatting or use `/orchestrate` for complex tasks

---

## License

Functional Source License, Version 1.1, MIT Future License (FSL-1.1-MIT).
Every version converts to the full MIT license two years after release.
