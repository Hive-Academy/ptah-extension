---
title: New project
description: Start a new project from an empty folder with a phased roadmap and a proposed AI team.
---

**New project** is the Setup path for an empty folder. You answer short questions about what you want to build. Then the agent plans the project, writes a phased roadmap, scaffolds the foundation, and proposes an AI team for it.

![New project](/screenshots/setup-new-project.png)

## Start a new project

1. Open an empty folder as a workspace.
2. Click **Setup** in the tab bar.
3. On the **New project** card, click **Start a project**.
4. Answer the questions, starting with **What are you building?**
5. Under **Check your answers:**, examine your answers and continue.

If the folder is not empty, Ptah shows **Folder is not empty. Starting a new project here may use existing files.** Click **Continue in this folder** only if you accept this. For an existing codebase, use [Analyze current project](/setup/setup-wizard/) instead.

## What the agent does

1. **Discovery and roadmap** — the agent asks about your stack and scope. Then it writes a phased plan to `.ptah/roadmap.md`.
2. **Foundation** — the agent scaffolds only the foundation, then stops. Each other roadmap item runs later as its own task.
3. **AI team** — the agent proposes the agents, skills, and MCP servers for the project. You review the proposal and click **Apply**. The agent does not apply it for you.

The proposal and review steps are the same as in the [AI team builder](/setup/ai-team-builder/).

## After the foundation

Build each roadmap item as its own task. See [Agent orchestration](/agents/agent-orchestration/). Mark items as done in `.ptah/roadmap.md`.

```
<workspace-root>/
  .ptah/
    roadmap.md          # phased plan
  .claude/
    agents/             # the AI team of the project
  CLAUDE.md             # project conventions
```

## Next steps

- [Agent orchestration](/agents/agent-orchestration/) — build each roadmap item
- [AI team builder](/setup/ai-team-builder/) — change the team later
- [Marketplace](/marketplace/) — add MCP servers and skills
