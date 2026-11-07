---
title: Context Management
description: Control prompt caching, lane guards, routing suggestions, context budgets, background query limits, and the Claude Code built-ins.
---

The **Context Management** tab of **Settings** controls how much context the agents use and how PtahCode routes work to executors.

## Open the tab

1. Open **Settings**.
2. Click the **Context Management** tab.

The tab shows these sections, from top to bottom:

1. **Subagent prompt-cache TTL**
2. Session budget
3. **Lane guards**
4. **Routing suggestions**, **Rotate close executors**, and **Capability matrix**
5. **Context budgets**
6. **Codex agents** and **Codex sandbox**
7. **Background query limits**

## Subagent prompt-cache TTL

**Subagent prompt-cache TTL** sets how long the prompt cache of a subagent lasts.

| Value | Effect |
| ----- | ------ |
| **Auto (1 hour for sessions with subagents)** | Default |
| **5 minutes** | A 5-minute cache |
| **1 hour** | A 1-hour cache |

When the environment variable `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` is set, a notice shows below the list. A valid value in the environment variable takes precedence over this setting. PtahCode ignores a value that is not valid.

## Session budget

The session budget section sets the cost limits of a session. See [Session Budget](/sessions/cost-summary/#settings).

## Lane guards

**Lane guards** stop background lanes that are stuck in a loop. Lanes have no limit on tool calls. PtahCode stops a lane only when it repeats the same tool call many times.

| Field | Default | What it does |
| ----- | ------- | ------------ |
| **Repeat-call stop at** | `20` calls | Stops a lane that repeats the same tool call this many times. The minimum is `2` |

PtahCode still judges a stopped lane by the files that it delivered.

## Routing suggestions

**Routing suggestions** is on by default. Before planning, PtahCode checks whether the engineering task is agreed. Then it suggests a task type, a depth, and the available executors. Each message uses one call to the decision model.

This switch is available only when a decision model is set. If no decision model is set, the section shows **Off: set a decision model in Providers to use this.**

## Rotate close executors

**Rotate close executors** is on by default. When several executors are equally suitable, PtahCode changes which one it picks each time. When it is off, PtahCode always keeps the first candidate. Below the switch, **Last pick** shows the recent picks.

## Capability matrix

The **Capability matrix** table shows a score for each family, model, and task kind.

| Column | What it shows |
| ------ | ------------- |
| **Family** | The family of the model |
| **Model** | The model |
| **Task** | The task kind |
| **Score** | The score, or `unrated` when there is no evidence |
| **Source** | Where the score comes from |
| **Samples** | The number of samples |
| **Stale** | `yes` when the score is stale |

If there are no scores, the section shows **No capability matrix yet**.

## Context budgets

**Context budgets** sets the token sizes at which PtahCode cuts down tool output, subagent results, and long chats. These values apply right away.

| Field | Default | Range | What it does |
| ----- | ------- | ----- | ------------ |
| **Tool output size** | `2,500` tokens | 100–200,000 | A tool result longer than this is cut down before the model sees it |
| **Subagent handoff size** | `150,000` tokens | 1,000–2,000,000 | When a subagent context reaches this size, PtahCode stops it and gives the main chat a handoff to continue the work |
| **Suggest a new session at** | `300,000` tokens | 1,000–5,000,000 | When a chat context reaches this size, PtahCode suggests a new session |
| **Subagent stop size** | `3,000,000` weighted tokens | 1,000–100,000,000 | PtahCode stops a subagent when its weighted token total reaches this size |
| **Compact idle chats** | On | — | Before the prompt cache of a long chat expires, PtahCode compacts the chat, so that your next message costs less |
| **Compact idle chats from** | `200,000` tokens | 100,000–5,000,000 | PtahCode compacts an idle chat when it reaches this size |

The setting keys start with `compaction.`, for example `compaction.toolOutputBudgetTokens`.

## Codex agents

**Codex agents** sets the limits that PtahCode gives to the Codex agents that it starts. These values apply to the next Codex agent that you start.

| Field | Key | Default | What it does |
| ----- | --- | ------- | ------------ |
| **Codex auto-compact size** | `agentOrchestration.codexAutoCompactTokens` | `120,000` tokens | Codex compacts its conversation at this size. `0` uses the Codex default |
| **Codex tool output limit** | `agentOrchestration.codexToolOutputTokenLimit` | `2,500` tokens | Codex cuts each tool result down to this size. `0` uses the Codex default |
| **Codex web search** | `agentOrchestration.codexWebSearch` | On | Lets Codex agents search the web |

For the other Codex settings, see [Codex](/providers/codex/).

## Codex sandbox

**Codex sandbox** sets the sandbox mode for all new Codex chat turns and Codex CLI lanes.

| Mode | What Codex can do |
| ---- | ----------------- |
| **Read only** | Read files. It cannot change files or use the network |
| **Workspace write, no network** | Change files in this workspace. Network access is disabled where the platform supports it |
| **Workspace write with network** | Change files in this workspace and use the network |
| **Full access** (default) | Read and change files outside this workspace and use the network, with no sandbox protection |

:::caution
With **Full access**, commands can affect your computer. Use it only for runs that you trust. When you change to **Full access** from another mode, PtahCode asks you to confirm. Click **Use full access** to confirm.
:::

On Windows, the workspace-write modes block child processes, so some build and test tools cannot run. Network blocking on Windows is not complete.

For runs that PtahCode starts, this setting takes precedence over `~/.codex/config.toml`. A change applies from the next turn. A turn that is already running keeps its sandbox. **In effect** shows the mode that is in use.

Approval prompts in Codex chat still follow your permission level. Codex CLI lanes run without approval prompts.

## Background query limits

**Background query limits** sets how many background model calls can run at the same time. Memory, skills, and scheduled jobs use background calls. These values apply right away.

| Field | Default | Range | What it does |
| ----- | ------- | ----- | ------------ |
| **Parallel background queries** | `3` | 1–16 | The maximum number of background calls at the same time |
| **Parallel queries per feature** | `1` | 1–16 | The maximum number of background calls for one feature, such as memory or skills |
| **Queue wait limit** | `60,000` ms | 1,000–600,000 | How long a background query waits for a free slot before it stops |

The setting keys start with `internalQuery.`, for example `internalQuery.maxConcurrent`.

## Claude Code tools & skills

This section is on the **Advanced** tab of **Settings**. It sets which of the tools and skills of Claude Code a PtahCode session starts with. Fewer items give a smaller first message and lower token use.

Changes apply to new sessions. Sessions that are already open keep what they started with. These settings apply to all your workspaces. The section shows an estimate of the tokens that the hidden items save for each new session.

| Group | Default | Columns |
| ----- | ------- | ------- |
| **Built-in tools** | Off | **Tool**, **Token cost**, **Description**, **Skills that need it** |
| **Terminal-only built-in skills** | Off | **Skill**, **Token cost**, **Description**, **Needs tool** |
| **Skills synced from your claude.ai account** | Hidden | **Skill**, **Token cost**, **Description** |

A skill that needs a tool works only when both the skill and the tool are on. When the tool is off, the skill row shows that the tool is off.

To turn on a tool or a skill:

1. Open **Settings → Advanced**.
2. Go to **Claude Code tools & skills**.
3. Select the check box of the tool or the skill.
4. Start a new session.

## Related

- [Settings](/settings/)
- [Session Budget](/sessions/cost-summary/)
- [Codex](/providers/codex/)
