---
title: Syncing Agents to CLIs
description: Distribute your Ptah agent roster to Copilot, Gemini, Codex, and Cursor.
---

# Syncing Agents to CLIs

Once you've tuned a roster of agents in Ptah, you can push them to the external CLIs and editors you already use. The same prompts, tools, and personalities become available in Copilot CLI, Gemini CLI, Codex CLI, and Cursor — so your team gets consistent behavior everywhere.

:::note[Pro-tier feature]
Agent sync is available on **Ptah Pro**. The free tier supports using built-in and custom agents inside Ptah; sync to external CLIs requires an active Pro license. See [Signing in](/getting-started/signing-in/) to upgrade.
:::

![Sync targets](/screenshots/agents-sync-targets.png)

## Supported targets

| Target             | Installed to                  |
| ------------------ | ----------------------------- |
| **GitHub Copilot** | `~/.copilot/agents/`          |
| **Gemini CLI**     | `~/.gemini/agents/`           |
| **Codex CLI**      | `~/.codex/agents/`            |
| **Cursor**         | `<workspace>/.cursor/agents/` |

Ptah writes into the conventional locations each tool expects, so no manual configuration is needed on the target side.

## What gets synced

- All agents in `<workspace-root>/.claude/agents/`
- Selected built-in overrides (opt-in)
- Tool permission metadata, translated to the target's format

What is **not** synced:

- MCP server credentials (these stay local to Ptah)
- Session history
- Your Ptah-specific settings

## Running a sync

1. Open the **Agents** panel.
2. Click **Sync to CLIs** in the top-right.
3. Pick which targets to include.
4. Review the diff — Ptah shows added, changed, and removed agents per target.
5. Click **Apply**.

![Sync diff view](/screenshots/agents-sync-diff.png)

### Sync modes

- **Additive** (default) — only writes new/changed agents. Existing target files are left untouched unless they conflict.
- **Mirror** — makes the target match Ptah exactly, including deletions. Use when you want Ptah to be the single source of truth.
- **Dry run** — shows the diff without writing anything.

## Automating sync

Turn on **Settings → Agents → Auto-sync on save** to re-run sync every time you edit an agent in Ptah. Combine with a git pre-commit hook to keep your team's CLIs in lockstep.

```json
{
  "ptah.agents.autoSync": {
    "enabled": true,
    "targets": ["copilot", "gemini", "codex", "cursor"],
    "mode": "additive"
  }
}
```

## Translation notes

Different CLIs expect slightly different frontmatter. Ptah handles the translation for you:

| Ptah field    | Copilot         | Gemini    | Codex         | Cursor         |
| ------------- | --------------- | --------- | ------------- | -------------- |
| `name`        | `name`          | `id`      | `name`        | `name`         |
| `description` | `description`   | `summary` | `description` | `description`  |
| `tools`       | `allowed_tools` | `tools`   | `tools`       | `capabilities` |
| `model`       | `model`         | `model`   | `model`       | (inferred)     |

Where a target doesn't support a field, Ptah drops it with a warning in the sync log.

## Revoking a sync

Click **Sync to CLIs → Unsync target** to remove all Ptah-authored agents from a target. Ptah tags each synced file with `x-ptah-managed: true` so it can clean up cleanly without touching agents you wrote by hand in the target tool.

## Troubleshooting

| Symptom                        | Fix                                                           |
| ------------------------------ | ------------------------------------------------------------- |
| Target not detected            | Install the CLI and restart Ptah                              |
| Permission denied writing      | Close the target tool, then re-run sync                       |
| Agent missing fields in target | Check the sync log — unsupported fields are listed per target |
| Sync loop / flapping           | Disable auto-sync in one tool; pick a single source of truth  |
