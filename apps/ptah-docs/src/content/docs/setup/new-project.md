---
title: New Project Setup
description: Plan and scaffold a brand-new SaaS workspace with a generated roadmap and its own AI team.
---

**New Project Setup** is the greenfield path. Instead of analyzing an existing repo, it plans a brand-new project with you, scaffolds the foundation, and assembles an AI team to build it out — all from one guided flow.

![New Project Setup](/screenshots/setup-new-project.png)

## Starting a new project

From the [Setup Hub](/setup/), click the **New Project** card → **Start New Project**. Ptah opens the AI Team Builder in **New Project Setup** mode and seeds the conversation with a planning prompt.

:::tip
Run this in an **empty folder** (or a fresh workspace). New Project Setup scaffolds foundational files; pointing it at an existing codebase is what the [Setup Wizard](/setup/setup-wizard/) and [AI Team Builder](/setup/ai-team-builder/) are for.
:::

## What it does

New Project Setup follows a two-stage SaaS bootstrap:

1. **Discovery & roadmap** — Ptah asks about your framework choice and scope, then writes a **phased roadmap** to `.ptah/roadmap.md`. This is the plan of record: each phase is a checklist item you'll build later.
2. **Foundation scaffold** — it scaffolds only the foundation rather than the whole app: an **Nx workspace**, base apps (**Angular / NestJS**), lint/test/CI wiring, and — when discovery makes them load-bearing — multi-tenant, auth, and database primitives.

Alongside the scaffold it generates the project's **AI team** (agents, skills, `CLAUDE.md`), so the workspace is ready for AI-assisted development from the first commit.

## After the foundation

The roadmap is intentionally incremental. Once the foundation exists, build each remaining phase as its own task — open a roadmap item and run it through the [orchestration workflow](/agents/agent-orchestration/) or hand it to the project-manager agent. Check items off in `.ptah/roadmap.md` as you go.

```
<workspace-root>/
  .ptah/
    roadmap.md          # phased plan — unchecked items are your backlog
  .claude/
    agents/             # the project's AI team
  CLAUDE.md             # generated project conventions
  apps/ , libs/ ...     # Nx workspace foundation
```

## New Project vs. the other setup paths

| Flow                                       | Best for                                                      |
| ------------------------------------------ | ------------------------------------------------------------- |
| **New Project**                            | An empty folder — scaffolds the app _and_ its AI team         |
| [Setup Wizard](/setup/setup-wizard/)       | An existing repo — fast, auto-generated agent roster          |
| [AI Team Builder](/setup/ai-team-builder/) | An existing repo — hand-crafted agents, skills, and MCP tools |

## Next steps

- [Agent orchestration](/agents/agent-orchestration/) — how to build each roadmap phase
- [AI Team Builder](/setup/ai-team-builder/) — refine the generated team
- [Marketplace](/marketplace/) — add MCP servers and skills to the new workspace
