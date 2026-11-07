---
title: Analyze current project
description: Let Ptah read your workspace, recommend agents, write them, and prepare project guidance.
---

**Analyze current project** is the Setup path for a project that already has code. Ptah reads your workspace, recommends agents, writes them to `.claude/agents/`, and prepares project guidance.

<video controls preload="metadata" playsinline style="width:100%;border-radius:0.5rem;border:1px solid var(--sl-color-gray-5);margin:1rem 0;">
  <source src="/assets/videos/setup-wizard-agent-generation.mp4" type="video/mp4" />
</video>

![Setup analysis overview](/screenshots/agents-setup-wizard.png)

## When to run it

- The first time that you open a project in Ptah.
- After a large change to the stack of the project.
- When you want to refresh the agents against the current code.

## Start the analysis

1. Click **Setup** in the tab bar.
2. On the **Analyze current project** card, click **Start analysis**.

## The steps

A stepper at the top of the page shows where you are.

### 1. Analyze workspace

Ptah scans the workspace and detects the stack. It shows the progress of each phase. You can leave the page: the analysis keeps running. Earlier results appear under **Saved analyses**.

![Analysis step](/screenshots/agents-wizard-step1.png)

### 2. Choose agents

Ptah recommends agents for the detected stack. Turn agents on or off.

![Choose agents step](/screenshots/agents-wizard-step3.png)

### 3. Generate agents

Ptah writes the selected agents to `.claude/agents/`. The page shows the status of each agent and any generation errors.

### 4. Project guidance

Ptah shows the **Detected stack** and writes project guidance. The page shows the **Generated guidance**.

### 5. Done

A summary of what happened, with any items that need attention.

## Run only one part

The **Analyze current project** card also has two links:

- **Only generate agents** — run agent generation again.
- **Only regenerate guidance** — write the project guidance again.

## What gets written

Each agent is a Markdown file with YAML frontmatter in `.claude/agents/`:

```
<workspace-root>/
  .claude/
    agents/
      backend-developer.md
      frontend-developer.md
      ...
```

:::tip
Commit `.claude/agents/` to source control. Your team then gets the same agents, and pull requests can review prompt changes.
:::

## Analyze current project or AI team builder

**Analyze current project** is the fast path: Ptah recommends agents from a scan. The [AI team builder](/setup/ai-team-builder/) is the hands-on path: you describe the team and tune agents, skills, prompts, and MCP servers with the agent.
