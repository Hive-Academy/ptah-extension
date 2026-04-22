---
title: Session Auto-Import
description: Discover and restore sessions from the Claude CLI automatically.
---

# Session Auto-Import

Ptah can discover and import sessions from the Claude CLI's default storage folder, so everything you've been working on outside the app becomes browsable, searchable, and resumable inside it.

![Auto-import banner](/screenshots/sessions-autoimport.png)

## Where Ptah scans

```
~/.claude/projects/
```

On Windows:

```
C:\Users\<you>\.claude\projects\
```

This is the standard folder the Claude CLI writes to. Each sub-folder is a project; each JSONL inside is a session transcript.

## When auto-import runs

| Trigger                 | Behavior                                              |
| ----------------------- | ----------------------------------------------------- |
| First Ptah launch       | Full scan, shows an import dialog                     |
| Every subsequent launch | Incremental scan (only new files)                     |
| File system watcher     | Ongoing — picks up new CLI sessions in the background |
| Command                 | **Ptah: Re-scan Claude CLI sessions**                 |

## What happens on import

For each discovered session, Ptah:

1. Parses the JSONL transcript
2. Extracts [metadata](/sessions/metadata/) — agent, model, timestamps, token counts
3. Associates the session with a Ptah workspace by matching project paths
4. Writes a native session record to `<workspace>/.ptah/sessions/`
5. Marks the record with `source: "claude-cli"` and preserves the original path

The original CLI file is **never modified or deleted**.

## Matching CLI projects to workspaces

Ptah uses the CLI project's absolute path (stored in the transcript header) to match to an existing workspace. Three outcomes are possible:

- **Exact match** — imported into that workspace silently.
- **No match** — Ptah offers to create a new workspace from the CLI path.
- **Ambiguous** (e.g., the folder was moved) — Ptah shows a disambiguation prompt.

![Disambiguation prompt](/screenshots/sessions-autoimport-disambig.png)

## Filtering imports

In the import dialog you can:

- Limit to sessions from the last N days
- Include / exclude archived CLI sessions
- Pick specific CLI projects
- Dry-run (preview without writing)

Settings you pick are remembered for future auto-imports.

## Continuing an imported session

Imported sessions behave like native ones. Open one and click **Continue** to start a new turn. Ptah will:

- Reuse the original model (overridable)
- Load the full history into context
- Offer to resume under the same agent if the CLI session had one

## Disabling auto-import

**Settings → Sessions → Auto-import**:

```json
{
  "ptah.autoImport.claudeCli": {
    "enabled": false,
    "scanPaths": [],
    "watch": false
  }
}
```

You can also add extra scan paths if your CLI installation writes to a non-default location.

## Troubleshooting

| Symptom                                 | Fix                                                         |
| --------------------------------------- | ----------------------------------------------------------- |
| Nothing imported on first launch        | Check `~/.claude/projects/` exists and contains JSONL files |
| Sessions show under the wrong workspace | Use the disambiguation prompt to relink                     |
| Auto-import runs every launch forever   | Rebuild index: **Ptah: Rebuild Session Index**              |
| Permission denied reading               | Close the CLI, then re-run the scan                         |

:::note[One-way]
Auto-import is one-way: CLI → Ptah. Edits in Ptah are not written back to the CLI transcript. If you need a shared live session, use [CLI agent session resume](/agents/cli-agents/#session-resume) instead.
:::
