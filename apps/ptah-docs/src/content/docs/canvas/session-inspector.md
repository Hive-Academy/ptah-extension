---
title: Session Details
description: Read the stats, plan limits, agents, task, and git state of the focused session in the Session inspector.
---

# Session Details

The **Session details** inspector shows the state of the focused session on the [Orchestra Canvas](/canvas/). It shows the session stats, the plan limits, the agents, the linked task, and the git changes. It also has the session actions.

## Open the inspector

The inspector is at the right edge of the focus area. When it is compact, it is a narrow rail. The rail shows the agents of the session and short metrics, for example **Tok** for tokens.

1. Click **Expand session details** at the top of the rail.
2. To change the width, drag the **Resize session details** grip.
3. To make the inspector compact again, click **Compact session details** or press **Esc**.

When the window is narrow, the inspector opens as a panel over the board. Click **Close session details** to close it.

A **!** mark on the rail tells you that a plan limit needs attention, or that an agent needs you.

## Header and session actions

The header shows the session name, the status, and the branch. It also has these actions:

| Action           | What it does                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| **Rename**       | Opens the **Rename session** dialog. Type the **Session name** and click **Save**.               |
| **Organize**     | Sets the status, priority, pin, and task link. Refer to [Organize a session](/sessions/managing-sessions/#organize-a-session). |
| **Stop session** | Stops the running session. It shows only while the session runs.                                 |

When the inspector is narrow, the actions are in the **More session actions** menu.

## Session stats

The **Session statistics** row has these metrics:

- **Context**: the part of the context window that the session uses.
- **Tokens**: the token count of the session.
- **Cost**: the cost of the session.

If the session uses more than one model, click **Models** (tooltip: "Show per-model breakdown") to see the usage of each model.

### Cache tile

The **Cache** tile shows the time until the prompt cache expires, for example **Cache · 5m** or **Cache · 1h**. When the time is done, the tile shows **Expired**. The value is an estimate from the last request. The server can remove cached content before that time.

When an idle compaction is set, the tile shows **idle in** and the time that remains.

## Agents

The agents section lists the agents of the session. Each row shows **Agent**, **Tokens**, **Cost**, **Time**, and **Status**. A **Total** row adds the values. If the session has no agents, the section shows **No agents yet**.

Click the **Actions for** menu of an agent row to see the actions that the agent permits:

- **Steer**: opens a field where you type a message to the agent.
- **Send to background**: moves the agent to the background.
- **Stop**: stops the agent.

If the list is long, click **Show _N_ more** to see all rows.

## Requests

When an agent asks for permission or asks a question, the request shows at the top of the inspector.

1. Click **Review** for a permission request, or **Answer** for a question.
2. For a permission request, click **Allow** or **Deny**.
3. To see the agent's own lane, click **Open lane**.

If the request was answered in a different place, the inspector tells you that the request is no longer pending.

## Plan limits

The **PLAN LIMITS** section shows one tile for each provider plan that the session uses. Each tile shows the usage of each plan window, a progress bar, and the reset time. When the usage is near the limit, the tile shows **Near limit**. When the usage is at the limit, the tile shows **At limit**.

If PtahCode cannot read the usage of a provider, the tile shows **Usage · Unavailable** and **Limits not tracked**.

In the compact session stats bar, a **Limits** alert shows while a plan is **Near limit** or **At limit**.

## Task

The **TASK** section shows the task that is linked to the session. It shows the task ID, the stage, and the progress, for example **3/5 tasks**.

The section also shows the task documents. Click a document to see a preview of it. Click **Open** to open the document, or **Close document preview** to close the preview. If the task has no documents, the section shows **No documents yet**.

## Git

The **GIT** section shows the branch of the session and the uncommitted changes as added and removed lines. If PtahCode cannot read the status, click **Retry reading git status**.

## Linked sessions

When the session continues an earlier session, the inspector lists the linked sessions. The entries show **This session**, **Continued from**, and **Continued in**. Click an entry to open that session.

## Lanes and the Agents menu

The focus area has a **Lanes** tab strip. The strip has a tab for the orchestrator, the main agent of the session. It also has a tab for each agent, in two groups: **Active agents** and **Finished agents**. The selected tab shows the agent name, the status, and the run time.

- Click a tab to show the lane of that agent in the focus area.
- Use the **Left Arrow** and **Right Arrow** keys to move between tabs.

When there are too many agents for the strip, the strip shows a **more** button, for example **3 more agents**. Click it to open the **Agents** menu. The menu lists the hidden agents. Select an agent to show its lane.

## Next steps

- [Manage sessions](/sessions/managing-sessions/)
- [Spawn CLI agents](/agents/cli-agents/)
- [Cost and tokens](/chat/cost-and-tokens/)
