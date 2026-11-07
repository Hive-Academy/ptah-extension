---
title: CLI Agents
description: Run installed CLIs and Ptah CLI providers as parallel lanes.
---

# CLI Agents

CLI agents are external command-line assistants that PtahCode runs as lanes. The main agent gives them self-contained tasks that run in parallel.

![CLI agents panel](/screenshots/agents-cli-panel.png)

## Supported CLIs

PtahCode detects these system CLIs when they are installed: **Codex**, **Copilot**, **Cursor**, **Antigravity**, **OpenCode**, **Pi**, **Grok**, and **Claude**.

A **Ptah CLI** agent is not a binary. It is an Anthropic-compatible provider that you configure.

An absent CLI is not an error. `ptah_agent_list` shows which lanes are installed and available.

:::note[Windows]
npm-installed CLIs on Windows are `.cmd` wrapper scripts. PtahCode runs them through a shell. No configuration is necessary.
:::

To turn off a CLI, add it to `agentOrchestration.disabledClis`. A spawn for a disabled CLI is refused with `CLI agent '<cli>' is disabled`.

## The agent-lanes skill

`agent-lanes` in `ptah-core` defines the CLI lane contract used by orchestration and Tribunal. Enable it with those workflows; if it is missing, they name the skill to enable. Orchestration continues with sub-agents only until it is available. See [skill dependencies](/mcp-and-skills/skills/#skill-dependencies).

When `ptah_agent_*` tools are available, call `ptah_agent_list` before choosing a lane. Use an installed system CLI via `cli`, or an available Ptah CLI provider via its listed `ptahCliId`. Setting `ptahCliId` overrides `cli`. `model` selects a raw model ID supported by that lane; `modelTier` applies only to Ptah CLI providers and uses their tier mappings. A raw `model` overrides that mapping. If a named lane is missing, the agent says so instead of substituting silently.

Without the lane tools, the agent does the work natively and says so.

## The spawn → signal → read pattern

CLI agents are asynchronous. The orchestrating agent follows a three-step protocol:

```text
1. spawn   → launch a lane with a self-contained task, get an agentId
2. signal  → wait for the <agent-lane-completed> message that the lane pushes when it ends
3. read    → fetch captured output, read deliverables, and verify results
```

The parent can continue to work, or spawn more lanes, while lanes run. The MCP tools that drive this flow are:

- `ptah_agent_list` — discover lane availability and messaging capabilities
- `ptah_agent_spawn` — start a CLI lane with a `task`
- `ptah_agent_wait` — block until lanes end
- `ptah_agent_status` — a one-time status check, for example to get the CLI Session ID for resume
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

To keep your machine responsive, PtahCode caps concurrent CLI agents. The cap is
`agentOrchestration.maxConcurrentAgents`.

| Setting | Value |
| ------- | ----- |
| Default | 5     |
| Maximum | 100   |

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

The orchestrator manages spawn, signal, and read and return a consolidated summary.

## Inspecting CLI runs

Each lane shows as an agent card in the chat, with its status, its output, and its token use when the CLI reports it. Click **Stop agent** on the card to stop a lane.

## Troubleshooting

| Symptom                       | Cause                             | Fix                                                                           |
| ----------------------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| CLI not detected              | Binary not on `PATH`              | Add the CLI to `PATH`, then restart PtahCode                                  |
| Hanging forever               | CLI waiting for interactive input | Stop it; rewrite prompt to be fully non-interactive                           |
| Mangled colors in output      | ANSI codes in transcript          | PtahCode sets `FORCE_COLOR=0` and `NO_COLOR=1`. Make sure that no shell profile overrides them. |
