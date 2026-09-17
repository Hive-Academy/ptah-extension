---
title: CLI Agents
description: Spawn Copilot CLI, Codex CLI, and ptah-cli as parallel workers.
---

# CLI Agents

CLI agents are external command-line assistants that Ptah spawns as subprocesses. They complement the built-in orchestra by providing bulk, parallel, or provider-specific horsepower — think of them as extra pairs of hands your main agent can delegate to.

![CLI agents panel](/screenshots/agents-cli-panel.png)

## Supported CLIs

Ptah auto-detects these CLIs on your `PATH` at startup:

| CLI             | Binary         | Notes                                                          |
| --------------- | -------------- | -------------------------------------------------------------- |
| **ptah-cli**    | —              | Not a binary. A user-configured Anthropic-compatible provider. |
| **Codex CLI**   | `codex`        | OpenAI Codex, SDK adapter                                      |
| **Copilot CLI** | `copilot`      | GitHub Copilot, SDK adapter                                    |
| **Cursor CLI**  | `cursor-agent` | Cursor's agent CLI                                             |
| **Antigravity** | `agy`          | Antigravity agent CLI                                          |
| **OpenCode**    | `opencode`     | OpenCode agent CLI                                             |
| **Pi**          | `pi`           | Pi agent CLI                                                   |

Only the CLIs you have installed are detected. An absent CLI is not an error.

:::note[Windows gotcha]
npm-installed CLIs on Windows are `.cmd` wrapper scripts. Ptah handles this automatically by routing non-`.exe` paths through a shell. No configuration needed.
:::

## Priority & selection

When a parent agent asks Ptah to "spawn a CLI helper" without specifying which, Ptah picks in this order:

1. `ptah-cli`
2. `codex`
3. `copilot`

You can override the default in **Settings → CLI Agents → Preferred CLI**.

## The agent-lanes skill

`agent-lanes` in `ptah-core` defines the CLI lane contract used by orchestration and Tribunal. Enable it with those workflows; if it is missing, they name the skill to enable. Orchestration continues with sub-agents only until it is available. See [skill dependencies](/mcp-and-skills/skills/#skill-dependencies).

When `ptah_agent_*` tools are available, call `ptah_agent_list` before choosing a lane. Use an installed system CLI via `cli`, or an available Ptah CLI provider via its listed `ptahCliId`. Setting `ptahCliId` overrides `cli`. `model` selects a raw model ID supported by that lane; `modelTier` applies only to Ptah CLI providers and uses their tier mappings. A raw `model` overrides that mapping. If a named lane is missing, the agent says so instead of substituting silently.

Without the lane tools, the agent does the work natively and says so.

## The spawn → poll → read pattern

CLI agents are asynchronous. The orchestrating agent follows a three-step protocol:

```text
1. spawn   → launch a lane with a self-contained task, get an agentId
2. poll    → check status until it is no longer running
3. read    → fetch captured output, read deliverables, and verify results
```

This lets the parent continue working (or spawn more CLIs) while helpers run. The MCP tools that drive this flow are:

- `ptah_agent_list` — discover lane availability and messaging capabilities
- `ptah_agent_spawn` — start a CLI lane with a `task`
- `ptah_agent_status` — poll for completion
- `ptah_agent_read` — fetch captured stdout/stderr, including output so far for a running lane; `tail` limits the returned lines
- `ptah_agent_message` — send a follow-up instruction mid-run. It reports back which of four delivery modes
  actually fired (`steer`, `interrupt-resume`, `queue-next-turn`,
  `unsupported`) — check `ptah_agent_list` for a given CLI's capability rather
  than assuming one. `interrupt-resume` discards the interrupted turn's
  partial work; `steer` and `queue-next-turn` do not.
- `ptah_agent_report` — let a spawned CLI report back to the session that
  spawned it. Only reachable from a CLI Ptah itself spawned, and it takes no
  agent id: identity comes from how the call reached Ptah, not from an
  argument. Check `delivered`: `false` with a `reason` means the report reached nobody. Verify reported claims against files and tests.
- `ptah_agent_stop` — cancel a running CLI

Status values are `running`, `completed`, `failed`, `timeout`, and `stopped`. The returned `agentId` is the process handle; a **CLI Session ID**, when reported, is the separate identifier used for conversation resume.

## Concurrency limits

The `agent-lanes` skill uses **three concurrent lanes** by default; workflows may widen that budget with your agreement. This is separate from the runtime limit below.

To keep your machine responsive, Ptah caps concurrent CLI agents. The cap is
`agentOrchestration.maxConcurrentAgents`.

| Setting | Value |
| ------- | ----- |
| Default | 5     |
| Maximum | 20    |

A spawn beyond the cap fails with a "Maximum concurrent agent limit reached"
error. Wait for a running agent to finish, stop one explicitly, or raise the
setting. The limit applies across all CLIs combined, not per CLI.

## Writing self-contained prompts

CLI agents don't share memory with your main chat. Each prompt must include everything the CLI needs:

- File paths (absolute)
- Acceptance criteria
- Permitted files and output format
- An absolute deliverable path, or an exact answer structure for panel responses
- Instructions not to commit or change Git history, and to report blockers

Good:

```text
Read D:\projects\app\src\auth\login.ts and refactor the validation block
into a pure function, preserving its inputs, outputs, and error behavior.
Modify only that file. Do not commit or change Git history.
Write a short report to D:\projects\app\refactor-report.md with validation
evidence, or blocking questions under ## Clarifications Needed.
Reply WROTE: D:\projects\app\refactor-report.md plus a one-line verdict.
```

Bad:

```text
Refactor the login code we talked about.
```

## Session resume

Resume only when `ptah_agent_status` reports a **CLI Session ID**. Pass that ID as `resume_session_id` to `ptah_agent_spawn` on the same lane (`cli` or `ptahCliId`), with a continuation `task`. If no session ID is reported, spawn fresh and restate the context and prior work.

```json
{
  "cli": "codex",
  "resume_session_id": "sess_7a2f...",
  "task": "Continue with the test coverage pass we started."
}
```

A resumed run gets a new `agentId` and retains the prior conversation. A saved task folder alone does not guarantee that the CLI adapter supports conversation resume.

## Using CLI agents from chat

Ask the orchestrator to assign CLI work. Eligible specialists can also delegate focused sub-tasks when lane mode permits; `team-leader`, `visual-reviewer`, and `ui-ux-designer` do not. For example:

> "Spawn three Codex CLI agents in parallel to generate unit tests for `libs/backend/auth`, `libs/backend/billing`, and `libs/backend/users`. Merge the results."

The orchestrator will manage spawn/poll/read and return a consolidated summary.

## Inspecting CLI runs

The **CLI Agents** panel shows every spawn with:

- Status (running / completed / failed / timeout / stopped)
- Duration
- Tokens / cost (when the CLI reports it)
- CLI Session ID when the adapter reports one (used for resume)
- Full transcript

Click any row to open the transcript in a side-by-side diff viewer.

## Troubleshooting

| Symptom                       | Cause                             | Fix                                                                           |
| ----------------------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| `CLI not detected` on startup | Binary not on `PATH`              | Restart Ptah after installing / add to `PATH` manually                        |
| `ENOENT` spawning on Windows  | `.cmd` wrapper issue              | Upgrade Ptah — auto-shell routing landed in v1.0                              |
| Hanging forever               | CLI waiting for interactive input | Stop it; rewrite prompt to be fully non-interactive                           |
| Mangled colors in output      | ANSI codes in transcript          | Ptah sets `FORCE_COLOR=0` and `NO_COLOR=1`; ensure no shell profile overrides |
