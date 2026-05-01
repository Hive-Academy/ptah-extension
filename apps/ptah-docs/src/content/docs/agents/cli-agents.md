---
title: CLI Agents
description: Spawn Copilot CLI, Gemini CLI, Codex CLI, and ptah-cli as parallel workers.
---

# CLI Agents

CLI agents are external command-line assistants that Ptah spawns as subprocesses. They complement the built-in orchestra by providing bulk, parallel, or provider-specific horsepower — think of them as extra pairs of hands your main agent can delegate to.

![CLI agents panel](/screenshots/agents-cli-panel.png)

## Supported CLIs

Ptah auto-detects these CLIs on your `PATH` at startup:

| CLI             | Binary    | Notes                                |
| --------------- | --------- | ------------------------------------ |
| **ptah-cli**    | `ptah`    | First-party CLI, deepest integration |
| **Gemini CLI**  | `gemini`  | Google Gemini, spawn-based adapter   |
| **Codex CLI**   | `codex`   | OpenAI Codex, SDK adapter            |
| **Copilot CLI** | `copilot` | GitHub Copilot, SDK adapter          |

:::note[Windows gotcha]
npm-installed CLIs on Windows are `.cmd` wrapper scripts. Ptah handles this automatically by routing non-`.exe` paths through a shell. No configuration needed.
:::

## Priority & selection

When a parent agent asks Ptah to "spawn a CLI helper" without specifying which, Ptah picks in this order:

1. `ptah-cli`
2. `gemini`
3. `codex`
4. `copilot`

You can override the default in **Settings → CLI Agents → Preferred CLI**.

## The spawn → poll → read pattern

CLI agents are asynchronous. The orchestrating agent follows a three-step protocol:

```text
1. spawn   → launch CLI with a self-contained prompt, get a session_id
2. poll    → check status until the agent is done or needs input
3. read    → fetch the final transcript and incorporate results
```

This lets the parent continue working (or spawn more CLIs) while helpers run. The MCP tools that drive this flow are:

- `ptah_agent_spawn` — start a CLI with a prompt
- `ptah_agent_status` — poll for completion
- `ptah_agent_read` — fetch transcript and results
- `ptah_agent_steer` — send follow-up instructions mid-run
- `ptah_agent_stop` — cancel a running CLI

## Concurrency limits

To keep your machine responsive, Ptah caps concurrent CLI agents:

:::caution[Max 3 concurrent]
You can run **up to 3 CLI agents simultaneously**. Attempting a 4th returns a `CONCURRENCY_LIMIT` error — wait for one to finish or stop it explicitly.
:::

This limit applies across all CLIs combined, not per-CLI.

## Writing self-contained prompts

CLI agents don't share memory with your main chat. Each prompt must include everything the CLI needs:

- File paths (absolute)
- Acceptance criteria
- Output format

Good:

```text
Read D:\projects\app\src\auth\login.ts and refactor the validation block
into a pure function. Write the result back to the same file.
Return a one-line summary when done.
```

Bad:

```text
Refactor the login code we talked about.
```

## Session resume

Long-running CLI tasks can be resumed across Ptah restarts. When you spawn an agent, pass `resume_session_id` to continue a prior conversation:

```json
{
  "cli": "gemini",
  "resume_session_id": "sess_7a2f...",
  "prompt": "Continue with the test coverage pass we started."
}
```

The CLI rehydrates from its own on-disk transcript. Session IDs are displayed in the CLI agents panel.

## Using CLI agents from chat

Ask any senior-tier agent to delegate. For example:

> "Spawn three Gemini CLI agents in parallel to generate unit tests for `libs/backend/auth`, `libs/backend/billing`, and `libs/backend/users`. Merge the results."

The orchestrator will manage spawn/poll/read and return a consolidated summary.

## Inspecting CLI runs

The **CLI Agents** panel shows every spawn with:

- Status (running / done / failed / cancelled)
- Duration
- Tokens / cost (when the CLI reports it)
- Session ID (copyable for resume)
- Full transcript

Click any row to open the transcript in a side-by-side diff viewer.

## Troubleshooting

| Symptom                       | Cause                             | Fix                                                                           |
| ----------------------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| `CLI not detected` on startup | Binary not on `PATH`              | Restart Ptah after installing / add to `PATH` manually                        |
| `ENOENT` spawning on Windows  | `.cmd` wrapper issue              | Upgrade Ptah — auto-shell routing landed in v1.0                              |
| Hanging forever               | CLI waiting for interactive input | Stop it; rewrite prompt to be fully non-interactive                           |
| Mangled colors in output      | ANSI codes in transcript          | Ptah sets `FORCE_COLOR=0` and `NO_COLOR=1`; ensure no shell profile overrides |
