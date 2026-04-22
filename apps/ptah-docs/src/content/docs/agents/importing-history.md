---
title: Importing Existing History
description: Bring your Claude CLI sessions into Ptah automatically.
---

# Importing Existing History

If you've been using the Claude CLI before Ptah, your conversations aren't stranded. Ptah auto-imports sessions from the standard Claude CLI storage location so you can pick up where you left off — full transcripts, metadata, costs, and all.

![Auto-import in progress](/screenshots/agents-import.png)

## Where Ptah looks

```
~/.claude/projects/
```

This is the default project-scoped session folder used by the Claude CLI. Each sub-folder represents a project, and each file inside is a session transcript (JSONL).

On Windows, the equivalent path is:

```
C:\Users\<you>\.claude\projects\
```

## When auto-import runs

- **First launch** — Ptah scans `~/.claude/projects/` and shows a prompt listing everything it found.
- **Every app start** — a quick incremental scan picks up new sessions written by the CLI while Ptah was closed.
- **On demand** — **Command Palette → Ptah: Re-scan Claude CLI sessions**.

:::note
Auto-import never deletes or moves your original CLI files. Ptah reads them and creates its own session records, pointing back to the source path.
:::

## What gets imported

For each session, Ptah captures:

- Full message transcript (user + assistant + tool calls)
- Timestamps
- Model used
- Agent (if the CLI session was scoped to one)
- Token counts and cost estimates
- Working directory / project association

See [Session metadata](/sessions/metadata/) for the full field list.

## Mapping CLI projects to Ptah workspaces

Ptah matches CLI projects to its own workspaces by comparing absolute paths. If you opened `D:\projects\my-app` in the CLI, its sessions appear under the same workspace in Ptah.

If the match is ambiguous (e.g., a moved folder), Ptah shows a **disambiguation prompt** and lets you:

- Link sessions to an existing workspace
- Create a new Ptah workspace from the CLI path
- Skip and import later

## Filtering what to import

In the import dialog you can:

- Limit to sessions newer than N days
- Exclude archived / trashed CLI sessions
- Pick specific projects only

![Import filters](/screenshots/agents-import-filters.png)

## Continuing a CLI session in Ptah

Imported sessions behave exactly like native Ptah sessions. Open one and click **Continue** to start a new turn. Ptah will:

1. Pick the same model the CLI session used (you can change it)
2. Load the full message history into context
3. Resume under the same agent (or prompt you to pick one if the CLI session was ad-hoc)

## Two-way sync?

Auto-import is **one-way** (CLI → Ptah). Changes you make in Ptah are not written back to the CLI transcript file. If you need both tools to see the same ongoing session, use [CLI agent session resume](/agents/cli-agents/#session-resume) instead — that preserves a shared session ID both tools can rehydrate.

## Privacy

- Importing is fully local — nothing is uploaded.
- You can disable auto-import in **Settings → Agents → Auto-import**.
- To delete imported sessions, use the [Sessions](/sessions/managing-sessions/) panel — this removes Ptah's copy only and leaves the CLI transcript intact.
