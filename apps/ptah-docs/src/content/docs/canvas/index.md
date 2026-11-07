---
title: Orchestra Canvas
description: Run many chat sessions at once from the Sessions rail.
---

The **Orchestra Canvas** is the main surface of the desktop app. It has a **Sessions** rail and a focus area. Each card in the rail is a full chat session with its own conversation, agent, and model. The focus area shows the conversation of the focused session.

## Why many sessions

One conversation is a bottleneck. A long refactor blocks a quick question, and a background research task blocks both.

Give each concern its own session:

- One session drives the feature that you build.
- One session reviews the diff.
- One session researches a library.

Each session keeps its own context window.

## The Sessions rail

The rail groups the session cards by state:

| Group                                    | Sessions in the group                        |
| ---------------------------------------- | -------------------------------------------- |
| **Running**                              | A turn is in progress.                       |
| **Background work**                      | Background agents are still at work.         |
| **Waiting / Needs input / Error / Idle** | The session waits, needs you, failed, or is idle. |
| **Finished**                             | The work is done.                            |

When a session changes state, its card moves to the new group. The move is animated, unless your system is set to reduce motion.

You can sort the rail by recent activity or keep your own order. Select **Dense cards** to show more cards at once.

## Add a session

1. Click **New session** in the rail.
2. Type a name, or leave the field empty. An empty name lets PtahCode name the session from your first prompt.
3. Save. The new session gets the focus.

If the session is already on the canvas, PtahCode focuses the existing card and does not make a copy.

To bring back an earlier session, open **Previous sessions** from the rail footer.

:::note[Limits]
The canvas holds a maximum of 20 sessions. A maximum of 9 sessions can run at the same time. When 9 sessions run, PtahCode shows "9 sessions are running. Wait for one to finish to start another."
:::

## Card actions

Each card has these actions:

- **Rename**: change the session name.
- **Organize**: set the status, priority, pin, and task link. Refer to [Managing sessions](/sessions/managing-sessions/).
- **Open beside**: show the session in a second pane next to the focused session. Click **Close split** to go back to one pane.

## Focus

One session has the focus at a time. Keyboard input and the composer controls apply to it. Click a card to focus it.

## Per-workspace boards

Each workspace has its own board. When you switch workspaces, you see the sessions of that workspace.

## Next steps

- [Send your first message](/chat/sending-messages/)
- [Switch models](/chat/switching-models/)
- [Spawn CLI agents](/agents/cli-agents/) for work that does not need its own session
- [Run a Tribunal](/tribunal/) when you want several vendors on one problem
