---
title: Agent Sessions
description: Let a chat session start child chat sessions in their own git worktrees, steer them, and read their results, with the ptah_session_* tools and four settings.
---

# Agent Sessions

An agent session is a **child chat session** that one chat session (the parent) starts with the `ptah_session_start` tool. Each child works on a **new git branch in its own worktree**, opens as a tab in your window, and runs unattended. You can open that tab and type in it at any time.

A child session is not a [CLI agent](/agents/cli-agents/). A CLI agent is a vendor process that exits when it is done. A child session is a full Ptah chat session: slash commands work (a task that starts with `/`, such as `/orchestrate TASK_...`, runs as that command) and it goes **idle** in its tab instead of exiting.

You own the outcome. The worktree and the branch remain after a child ends, and nothing is merged, pushed or removed for you.

## The five tools

The parent's agent calls these. Each child is addressed by the `sessionId` that `ptah_session_start` returns.

| Tool                  | What it does                                                      |
| --------------------- | ----------------------------------------------------------------- |
| `ptah_session_start`  | Creates a worktree and branch, opens the child tab, runs the task |
| `ptah_session_send`   | Sends the child a message (the main way to steer it)              |
| `ptah_session_status` | Reports the state of one child, or all children of the caller     |
| `ptah_session_read`   | Returns the tail of a child's transcript                          |
| `ptah_session_stop`   | Stops a child                                                     |

### `ptah_session_start`

| Argument       | Required | Description                                                                                           |
| -------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `task`         | Yes      | What the child should do. Up to 100 KiB.                                                              |
| `branch`       | Yes      | The **new** branch to create (up to 200 characters). An existing branch is refused (`branch-exists`). |
| `baseRef`      | No       | The ref to branch from.                                                                               |
| `label`        | No       | A short tab label, up to 60 characters.                                                               |
| `taskId`       | No       | A task id such as `TASK_2026_584` or `TASK_2026_584_5e7a`.                                            |
| `taskFolder`   | No       | A path relative to the worktree, without `..`.                                                        |
| `deliverables` | No       | Up to 20 paths the child must write. They are checked when the child settles.                         |
| `model`        | No       | A model for the child.                                                                                |

There is deliberately no permission, path or parent argument. The caller is whichever session made the call, and any extra argument is rejected rather than ignored.

### `ptah_session_send`

| Argument    | Required | Description                                                                                                                                                                                                                                             |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionId` | Yes      | The child.                                                                                                                                                                                                                                              |
| `message`   | Yes      | The message. Up to 100 KiB.                                                                                                                                                                                                                             |
| `mode`      | No       | `queue` (default): start a turn now if the child is idle, otherwise hold the message until the current turn ends. `steer`: interrupt the turn in flight and start a new one. `if-idle`: deliver only if the child is idle, otherwise refused as `busy`. |

The result states the effect (`started-turn`, `held-until-turn-end` or `interrupted-and-started`) or the refusal reason.

### `ptah_session_status`

Takes an optional `sessionId`; without it, every child of the caller is listed. For each child it shows the status (`starting`, `working`, `awaiting-permission`, `waiting`, `idle`, `failed`, `stopped`, `timed-out` or `ended`), branch, base ref, worktree path, turns settled, reports delivered and refused, the last completion, any held completion, and the permission prompt it is waiting on with the time it will be denied.

### `ptah_session_read`

| Argument    | Required | Description                                                          |
| ----------- | -------- | -------------------------------------------------------------------- |
| `sessionId` | Yes      | The child.                                                           |
| `tailKiB`   | No       | How much of the transcript tail to return, 1 to 256 KiB. Default 32. |

If the transcript is longer, the tail is shown and the head says earlier turns are cut. Before the child has a transcript, the result says it is not available.

### `ptah_session_stop`

Takes a `sessionId`. The child's tab, transcript, worktree and branch remain.

## How a child reports back

- **Completion push.** Each time a child settles a turn, a completion is pushed into the parent session as an `<agent-lane-completed ... cli="ptah-session" ...>` message. Its `verdict` is `delivered` (every declared deliverable exists, is non-empty and was written after the start), `no-deliverable` (some are missing), `unverified` (none were declared) or `failed` (the turn did not finish). Treat it as a pointer to check, not proof the content is right.
- **Reports.** A child can call `ptah_agent_report` to send a progress note, a decision or a blocker. It works from a child session as well as from a CLI agent: the child is identified by the session it runs in, and the parent receives it as an `<agent-report ... cli="ptah-session">` message. If the parent is not live, the report is refused (not queued) and counted on the child's status; the child is told to repeat it in its final message.
- **Held completions.** Children keep running when the parent ends or is closed. A completion that arrives while the parent is not live is held, and the parent receives it at the end of its next `ptah_session_*` result under "Held while this session was not live". After a resume, a parent should call `ptah_session_status` to see what its children did meanwhile.

## Permissions

A child runs without a permission prompt for two things only: file edits inside its own worktree, and Bash commands that start with an entry of the allowlist below. Any other action waits in the child's tab for you to answer, and is **denied** when the wait window ends. `AskUserQuestion` and plan mode are not available to a child.

A child cannot start sessions of its own (depth is limited to 1).

## Settings

Four settings bound child sessions. They are read each time a session is started, so a change applies to the next `ptah_session_start`. All four live under `ptah.agentSessions.`.

| Setting                                     | Default   | Range           | Meaning                                                                                                                                   |
| ------------------------------------------- | --------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `ptah.agentSessions.maxConcurrent`          | `3`       | 1 to 5          | Live children across the whole host. An idle child still counts until it is stopped. A start beyond the limit is refused (`cap-reached`). |
| `ptah.agentSessions.maxRuntimeMinutes`      | `120`     | 5 to 720        | Wall-clock cap per child, in minutes.                                                                                                     |
| `ptah.agentSessions.permissionDenyWindowMs` | `60000`   | 0 to 600000     | How long a prompt outside the policy waits in the child's tab before it is denied. `0` denies at once.                                    |
| `ptah.agentSessions.bashAllowlist`          | see below | list of strings | Bash command prefixes a child may run without asking.                                                                                     |

A number outside its range is clamped, and a value of the wrong type falls back to the default. For the allowlist, any entry that is not a string makes the whole list fall back to the default; blank entries are dropped, and an explicit empty list means every Bash command needs approval.

Default `bashAllowlist`:

```json
["git status", "git diff", "git log", "git show", "git add", "git commit", "git rev-parse", "git ls-files", "git branch --show-current", "npx nx", "npm test", "npm run", "ls", "pwd"]
```

## Refusals

A refused call is returned to the agent as text with a code, so it can act on it. The start refusals are `unattributed-caller`, `depth-exceeded`, `cap-reached`, `mcp-unavailable`, `chat-runtime-unavailable`, `no-workspace`, `invalid-arguments`, `branch-exists`, `worktree-failed`, `worktree-outside-workspace` and `session-start-failed`. When a start fails after creating something, the result lists the rollback steps it ran.

Child sessions need the chat runtime and the Ptah MCP server. A host without the session spawner returns an error saying so.

## Related

- [Agent Orchestration](/agents/agent-orchestration/)
- [CLI Agents](/agents/cli-agents/)
