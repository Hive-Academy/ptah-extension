---
title: Discord Setup
description: Talk to PtahCode from a Discord server.
---

# Discord Setup

## 1. Create a Discord application and bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications).
2. Click **New Application** and name it.
3. Open **Bot** and copy the bot token.
4. In **Bot**, enable the **Message Content** privileged intent.
5. Copy the **Application ID** from **General Information**.

## 2. Configure PtahCode

1. Open **Thoth → Messaging → Discord**.
2. In **Connection**, paste the bot token and click **Save & start**.
3. In **Integration**, paste the **Application (client) ID** and click **Save**.
4. Click **Add to your server** and invite the bot.
5. Click **Register /ptah** to register the slash commands.

The invite link uses the `bot` and `applications.commands` scopes. It grants View Channel, Send Messages, Create Public Threads, and Send Messages in Threads.

## 3. Allow servers

Use one of these methods:

- In **Integration → Allowed servers**, click **Refresh** and select the servers.
- In **Access**, add server IDs to the allow list, and click **Save allow-list**.

When the list is empty, the bot accepts messages from any server that it is in.

## 4. Pair the binding

1. In a channel of an allowed server, send `/ptah` or @-mention the bot.
2. The bot replies with a 6-digit pairing code.
3. In **Access → Pending requests**, type the code and click **Approve**.

The bot does not read direct messages.

## Register the slash commands

**Register /ptah** registers `/ptah` and the control commands. When you have allowed servers, PtahCode registers the commands for each server, and they are available immediately. With no allowed servers, PtahCode registers them globally, and Discord can take up to one hour to show them.

## Threads are sessions

Each Discord thread that the bot works in has its own PtahCode session.

- A prompt in a parent channel (`/ptah` or an @-mention) creates a new thread with a new session.
- A message in a Ptah thread continues the session of that thread.
- To start a new topic, start a new thread.

## Control commands

Control commands manage sessions and workspaces. A control command does not start an agent turn. All commands need an approved binding.

| Command                 | What it does                                                 | Where it works         |
| ----------------------- | ------------------------------------------------------------ | ---------------------- |
| `/sessions`             | Lists resumable sessions for the workspace of the thread     | Threads and channels   |
| `/session use <pick>`   | Points the thread at an existing session                     | Threads only           |
| `/new`                  | Clears the session link. The next message starts a new session | Threads only         |
| `/workspace list`       | Lists the workspaces that PtahCode can target                | Threads and channels   |
| `/workspace use <pick>` | Switches the thread to another allowed workspace             | Threads only           |

Lists and errors are visible only to you. When a command changes the thread, PtahCode also posts a short public message in the thread.

### Rules

- Lists show a maximum of 25 items.
- The `pick` option shows only sessions or workspaces from the list. PtahCode checks the pick again when you submit it.
- PtahCode refuses `/session use`, `/new`, and `/workspace use` while a turn runs in the thread.
- PtahCode refuses `/session use` when the session is in use in another thread, or when the session is running.
- The workspace list contains only the folders that you opened in the PtahCode desktop app. You cannot type a path from Discord.
- `/workspace use` changes only this thread. It clears the session of the thread, so the next message starts a new session in the new workspace.
