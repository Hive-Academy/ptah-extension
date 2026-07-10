---
title: Discord Setup
description: Talk to Ptah from a Discord server.
---

# Discord Setup

## 1. Create a Discord application + bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. **New Application** → name it
3. Sidebar → **Bot** → **Add Bot**
4. Copy the bot token (you'll only see it once)

## 2. Enable required intents and scopes

In the Bot tab:

- Enable the **Message Content** privileged intent

In the OAuth2 → URL Generator tab, when generating the invite URL, select scopes:

- `bot`
- `applications.commands`

Bot permissions: at minimum **Send Messages** and **Read Message History**.

## 3. Invite the bot to your guild

Use the generated OAuth2 URL to invite the bot. Note the guild ID (right-click the server icon with developer mode on → **Copy Server ID**).

## 4. Configure Ptah

Open **Settings → Messaging → Discord**:

1. Paste the bot token (encrypted by the UI before persisting)
2. Add the guild ID to **Allowed guild IDs** (`gateway.discord.allowedGuildIds`)
3. Enable **Discord** (`gateway.discord.enabled = true`)
4. Enable the global **Messaging Gateway** (`gateway.enabled = true`)

## 5. Pair the binding

1. In any allowed guild, message the bot (DM or @-mention in a channel it can read)
2. The bot replies with a 6-digit pairing code
3. Approve the binding in **Settings → Messaging → Bindings**

The Discord adapter is `discord.js`-compatible and shipped as `DiscordAdapter`.

:::note
A single bot can be whitelisted across multiple guilds. Each guild + user pair becomes its own binding with independent pairing.
:::

## 6. Register the slash commands

In the Gateway tab's Discord pane, click **Register /ptah**. This registers Ptah's full command set with Discord in one idempotent call: the `/ptah` prompt command plus the five control commands below.

:::caution[Upgrading from an older Ptah]
Registration now replaces the old single `/ptah` registration with the full command set. **Re-run Register /ptah once after upgrading** or the control commands won't appear in Discord. Per-guild registration (an allowed guild ID is configured) takes effect immediately; global registration (no guild IDs configured) can take **up to ~1 hour** to propagate on Discord's side.
:::

## Threads are sessions

Each Discord thread the bot works in is its own conversation with its own Ptah session:

- Prompting in a parent channel (via `/ptah` or an @-mention) creates a **new thread**, and its first turn starts a **fresh session** bound to that thread.
- Plain messages inside an existing Ptah thread **resume that thread's session** — never another thread's.
- Starting a new topic is as simple as starting a new thread. The commands below are for the finer moves: re-pointing a thread at an existing session, resetting it, or switching which workspace it targets.

## Control commands

Five slash commands manage sessions and workspaces without touching the desktop app. They are a pure control plane: a command is never forwarded to the agent as a prompt, never starts a turn, and never appears in the conversation transcript.

| Command                 | What it does                                                 | Where it works                          |
| ----------------------- | ------------------------------------------------------------ | --------------------------------------- |
| `/sessions`             | List resumable sessions for this thread's workspace          | Threads and parent channels (read-only) |
| `/session use <pick>`   | Point this thread at an existing session                     | Threads only                            |
| `/new`                  | Clear this thread's session link — next message starts fresh | Threads only                            |
| `/workspace list`       | List the workspaces Ptah can target                          | Threads and parent channels (read-only) |
| `/workspace use <pick>` | Switch this thread to another allowed workspace              | Threads only                            |

All commands require an approved binding — unpaired or pending channels get an ephemeral refusal with no data disclosed.

### Reply visibility

Lists, errors, and refusals are always **ephemeral** (only you see them). When a command actually changes something (`/session use`, `/new`, `/workspace use`), Ptah additionally posts one short **public message in the thread** — an audit trail of what the thread is pointed at.

### `/sessions`

Lists the 25 most recently active resumable sessions for the thread's effective workspace, each as `name · short-id · last-active`, with the currently attached session marked `(current)`. Longer lists say they're truncated. Invoked in a parent channel, it lists sessions for the binding's default workspace and reminds you that attaching requires being inside a Ptah thread.

### `/session use`

The `pick` option is an autocomplete picklist fed by the same list `/sessions` shows — you can only pick from sessions Ptah already knows for this thread's workspace, and the value is re-validated server-side on submit. The command is refused when:

- it's run outside a thread (in-thread guidance is replied instead),
- a turn is currently running or queued in this thread ("finish or wait for the current turn first"),
- the session is attached to another channel or thread ("in use elsewhere" — no stealing),
- the session is actively running elsewhere (e.g. the desktop app is mid-turn on it),
- the pick doesn't resolve to exactly one listed session (re-run `/sessions`).

On success your next message in the thread continues the picked session. `/session use` never changes the thread's workspace — that's exclusively `/workspace use`.

### `/new`

Clears the thread's session link so the next message starts a brand-new session in the same thread and workspace. Idempotent — running it in an already-fresh thread just says so. Refused mid-turn, like `/session use`. Other threads keep their sessions.

### `/workspace list` and `/workspace use`

The workspace list is a **closed allowlist**: exactly the folders you've opened in the Ptah desktop app, nothing else. There is no way to type a raw path from Discord — the `pick` autocomplete offers only allowlisted folders, and the submitted value is re-validated against the freshly re-read list (exact folder roots only, no subpaths). Adding a workspace to the list happens only in the desktop app.

Switching with `/workspace use`:

- applies to **this thread only** — the desktop app's active workspace, the binding default, and other threads are untouched;
- **clears the thread's session** — sessions are workspace-bound, so a new session starts in the picked workspace on your next message;
- is a no-op (session kept) when you pick the workspace the thread already targets;
- is refused mid-turn, and refused if the picked folder no longer exists on disk.

Sessions in the previous workspace are untouched — switch back later and `/sessions` shows them again.

:::note[Discord-only for now]
The control commands are Discord-only in this release. On Telegram and Slack a literal `/sessions` message is treated as a plain agent prompt, and existing behavior is unchanged; command parity there is a documented follow-up.
:::
