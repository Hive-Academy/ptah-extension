---
title: AI team builder
description: Describe the AI team you want, tune the proposed configuration with the agent, and apply it to your workspace.
---

The **AI team builder** is the Setup path where you describe the team that you want. The agent proposes a configuration, and you tune it in a conversation. Use [Analyze current project](/setup/setup-wizard/) instead if you want Ptah to recommend agents from a scan.

![AI team builder](/screenshots/setup-ai-team-builder.png)

## Start the builder

1. Click **Setup** in the tab bar.
2. On the **AI team builder** card, click **Build a team**.
3. Under **What should the team do?**, describe the team. This field is necessary.
4. Send the brief.

To continue earlier work, click **Load saved draft**.

## The steps

The builder has three steps: **Brief**, **Proposal**, and **Review**.

- **Brief** — what the team must do.
- **Proposal** — the agent proposes the configuration, and the panel shows it as it develops. Send more messages to change it. The agent can ask you questions in the conversation.
- **Review** — examine the final configuration, then click **Apply**.

## What the proposal contains

| Section       | What it holds                                         |
| ------------- | ----------------------------------------------------- |
| **Persona**   | The identity, description, and goals of the team      |
| **Agents**    | Built-in agents to turn on, and custom agents         |
| **Skills**    | Existing skills to include, and new skills            |
| **Prompt**    | A system prompt and added sections                    |
| **MCP**       | MCP servers to attach, and their enabled tools        |
| **CLAUDE.md** | The project `CLAUDE.md` file                          |

## Apply to your workspace

When the review shows **Safe to apply. The agent is not running.**, click **Apply**. Ptah writes the project `CLAUDE.md`, the agent files in `.claude/agents/`, and the new skills.

To start again, click **Start over**.

## Presets

Save a configuration as a preset from the **Presets** section of the proposal page. Apply the preset later to another workspace that uses the same conventions.

## Related

- [New project](/setup/new-project/) — start an empty folder with a proposed team.
