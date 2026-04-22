---
title: Agents in Ptah
description: Specialized AI workers that plan, build, review, and ship code inside the Ptah desktop app.
---

import { Card, CardGrid } from '@astrojs/starlight/components';

# Agents in Ptah

Agents are specialized AI workers that Ptah coordinates on your behalf. Each agent has a focused role — writing backend code, reviewing UI, researching a library, managing DevOps pipelines — and a system prompt tuned for that role. Instead of asking one generalist model to do everything, Ptah lets the right expert handle the right slice of work.

![Agents overview](/screenshots/agents-overview.png)

## Why agents?

A single, unrestricted chat session tends to drift: it forgets the architecture it proposed, mixes up frontend and backend conventions, and loses track of review feedback. Ptah's agents solve that by giving each concern:

- **A dedicated system prompt** with domain expertise and guardrails
- **A narrow toolset** (file access, CLI spawning, browser automation, etc.)
- **A clear handoff protocol** to other agents in the hierarchy

The result: higher-quality output, fewer hallucinations, and a reviewable trail of who did what.

## The 13 built-in agents

Ptah ships with 13 built-in agents covering the full software delivery lifecycle — from planning and architecture through implementation, review, and release. They live in every new workspace and are always available from the agent picker.

<CardGrid>
  <Card title="Planning & Leadership" icon="rocket">
    project-manager, software-architect, team-leader
  </Card>
  <Card title="Implementation" icon="laptop">
    backend-developer, frontend-developer, devops-engineer
  </Card>
  <Card title="Quality & Review" icon="approve-check">
    senior-tester, code-style-reviewer, code-logic-reviewer
  </Card>
  <Card title="Research & Design" icon="magnifier">
    researcher-expert, modernization-detector, ui-ux-designer, technical-content-writer
  </Card>
</CardGrid>

See the [built-in agent catalog](/agents/built-in-agents/) for the full table of roles, triggers, and typical use cases.

## How agents fit together

Ptah uses a three-tier orchestration model:

1. **Orchestrator** — the top-level agent that plans, decomposes, and delegates.
2. **Senior leads** — specialists (architect, backend-dev, reviewer, etc.) spawned as sub-agents.
3. **CLI helpers** — external CLI agents (Copilot CLI, Gemini CLI, Codex CLI, ptah-cli) spawned in parallel for bulk or exploratory work.

:::tip[When to use what]

- **One-off question** → chat directly with the default agent.
- **Multi-step feature** → let the orchestrator delegate to senior leads.
- **Wide, parallel exploration** → spawn CLI agents (up to 3 concurrent).
  :::

Read more in [Agent orchestration](/agents/agent-orchestration/).

## Where agents are stored

Built-in agents are bundled with Ptah. Custom and modified agents are stored per workspace under:

```
<workspace-root>/.claude/agents/
```

Each agent is a Markdown file with YAML frontmatter describing its name, description, tools, and system prompt. You can edit these directly or use the in-app editor — see [Custom agents](/agents/custom-agents/).

## Next steps

<CardGrid>
  <Card title="Run the setup wizard" icon="puzzle">
    Let Ptah analyze your project and generate a tuned agent roster. [Start here →](/agents/setup-wizard/)
  </Card>
  <Card title="Browse the built-ins" icon="list-format">
    See all 13 agents and when to reach for each. [Catalog →](/agents/built-in-agents/)
  </Card>
  <Card title="Spawn CLI agents" icon="seti:shell">
    Parallelize work with Copilot, Gemini, Codex, and ptah-cli. [CLI agents →](/agents/cli-agents/)
  </Card>
  <Card title="Sync to your CLIs" icon="random">
    Push your Ptah agents to Copilot, Gemini, Codex, and Cursor. [Sync →](/agents/syncing-to-cli/)
  </Card>
</CardGrid>
