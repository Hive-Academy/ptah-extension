---
title: Ptah CLI
description: Wrap any command-line AI agent as a first-class provider.
sidebar:
  order: 8
---

# Ptah CLI

The **Ptah CLI** provider lets you register any command-line AI agent — your own, a teammate's, or an experimental one — and have Ptah use it as a sub-agent on equal footing with Codex and Copilot.

Ptah-CLI agents have the **highest priority** in CLI detection. When Autopilot needs to delegate a subtask and a ptah-cli agent is registered and enabled, it's picked first.

## What you need

- A CLI executable that:
  - Accepts a prompt via stdin or `--prompt`.
  - Streams responses to stdout.
  - Returns a non-zero exit code on failure.
- The full path to the binary (or an entry on your `PATH`).

## Configuration

Ptah CLI agents are configured in `~/.ptah/settings.json` under the `ptahCliAgents` key:

```json
{
  "ptahCliAgents": [
    {
      "id": "my-agent",
      "displayName": "My Custom Agent",
      "command": "my-agent",
      "args": ["--stream"],
      "env": {
        "MY_AGENT_MODEL": "gpt-4o"
      },
      "enabled": true
    }
  ]
}
```

| Field         | Description                                                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | Unique id, lowercase with dashes. Used in logs and the Execution Tree.                                                                                                                    |
| `displayName` | Label shown in the chat model selector.                                                                                                                                                   |
| `command`     | Executable name (if on `PATH`) or absolute path. Use forward slashes on Windows.                                                                                                          |
| `args`        | Additional CLI arguments passed before the prompt.                                                                                                                                        |
| `env`         | Environment variables for the child process. Secrets should live here only if you're on a trusted machine — otherwise use `safeStorage` by configuring the agent through the Settings UI. |
| `enabled`     | Set to `false` to keep the config but stop Ptah from using it.                                                                                                                            |

You can also manage Ptah CLI agents from **Settings → Providers → Ptah CLI** in the app.

## Selection priority

When Autopilot delegates a subtask:

`ptah-cli > codex > copilot`

`agentOrchestration.disabledClis` does **not** apply to Ptah CLI agents. It is matched against CLI _types_ (`codex`, `copilot`, `cursor`, `antigravity`, `opencode`, `pi`) — putting a ptah-cli agent id in it has no effect anywhere.

To switch a Ptah CLI agent off, set `enabled: false` on the agent itself (see the table above). That removes it from Autopilot _and_ from manual selection; there is no "Autopilot-only" opt-out for these agents.

```json
{ "agentOrchestration.disabledClis": ["codex", "copilot"] }
```

Disabling a CLI type this way is a **hard disable** — it is skipped by automatic selection and an explicit `ptah_agent_spawn { cli: "codex" }` is rejected. Disabled CLIs still show up in `ptah_agent_list` with a `disabled` status.

## Verifying it works

1. Open the chat and select your custom agent from the model selector.
2. Send a prompt.
3. You should see the agent's output stream into the transcript. In the [Execution Tree](/chat/execution-tree/), the node's provider field shows `ptah-cli:<id>`.

## Troubleshooting

- **Agent not listed in the selector** — check `enabled: true`, restart Ptah, verify the `command` resolves (run it manually in a terminal).
- **ENOENT on Windows** — npm-installed CLIs are `.cmd` wrappers. Ptah handles this automatically, but if you use an absolute path, make sure it ends in `.cmd` or `.exe`.
- **Output looks corrupted** — Ptah sets `FORCE_COLOR=0` and `NO_COLOR=1` on child processes, but some CLIs ignore these. Add your own `env` entry to force plain output.
- **Agent hangs on first turn** — your CLI may be waiting for an interactive TTY. Run it with a non-interactive flag (`--no-tty`, `--pipe`, etc.).

:::note[Cost]
Cost for ptah-cli agents is reported as $0 because billing is handled by whatever service the CLI ultimately calls. Token counts are still captured from the CLI's output where possible.
:::
