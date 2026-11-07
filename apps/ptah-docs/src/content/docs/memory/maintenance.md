---
title: Memory Maintenance
description: Check the health of the memory store, control the curator triggers, and purge memories by subject.
---

# Memory Maintenance

The **Maintenance** view of the **Memory** tab shows the health of the memory store and the state of the curator. It also has the **Danger zone**, where you can delete memories by subject.

To open it:

1. Open **Thoth → Memory**.
2. Click the **Maintenance** view tab.

The view has two parts: **Diagnostics** and **Danger zone**.

## Diagnostics

### Last curator run

The **Last curator run** card shows when the curator ran last.

### Triggers

The **Triggers** card has one toggle for each event that can start a curate pass:

- **Idle timer** (value in `ms`)
- **Turn threshold** (value in `turns`)
- **Boot scan**
- **PostToolUse hook**
- **Turn-complete (Stop hook)**
- **Error→recovery episodes**
- **Session-end flush**
- **UserPromptSubmit cues** (value: **min length**)
- **Max curates per hour** (value: `/hour`)

Select or clear the check box to turn a trigger on or off. When a trigger has a value, type the value in the number box next to it. The number box is available only while the trigger is on. **Cue list (read-only)** shows the phrases that count as a recall cue.

For the setting keys and defaults of the triggers, see [Memory settings](/memory/settings/#triggers).

### Curator model

The **Curator model** card shows the provider and the model that the curator uses. When no curator provider is set, the card shows **Follows main agent**. Click **Change** to open the background model roles on the **Providers** tab of **Settings**.

If a curator run fails, an alert shows the reason. When a change of model settings can fix the problem, the alert has an **Open model settings** button.

### Recent events

**Recent events** lists the last 10 curator events. Each row shows the event kind, its result, and how long ago it occurred. When a pass did not run, the row gives the reason, for example **Skipped: the provider is rate-limited**.

### DB Health

**DB Health** compares the search indexes of the memory store:

- **coherent** is `true` when the indexes agree.
- Each row compares two counts, for example `memory_chunks` with the vector index and with the full-text index. A row that agrees shows **✓ in sync**.
- The **sqlite-vec** part shows the state of vector search. When it is not available, it shows the reason, the platform, and the error. Use **Retry vec** to try again. **Open binding folder** opens the folder of the sqlite-vec binding.
- The **Embedder** part shows the state of the local embedding model. On the first run, the model downloads and then stays cached on your computer. Use **Retry / download now** to start the download, or **Re-warm** when the model is ready.
- **Copy diagnostic** copies the diagnostic data.

### Storage and Retention

**Storage and Retention** shows how much space the memory store uses and how cleanup runs:

| Card | What it shows |
| ---- | ------------- |
| **Database size** | The size of the database, and the **Reclaimable** space |
| **Pending observations** | Rows, size, the oldest pending row, and boot-scan retries |
| **Quarantine** | Rows that are stuck, and the ledger rows |
| **Processed observations** | Rows and size |
| **Last retention run** | When it finished, and how many rows it purged and quarantined |
| **Retention settings** | **Processed after**, **Stuck after**, **Next run**, and **Memory lifecycle** |

For the retention and lifecycle settings, see [Memory settings](/memory/settings/#retention).

### Run the curator manually

1. Open a chat session.
2. In **Thoth → Memory → Maintenance**, click **Run curator now**.

The curator curates the active session one time. The button is not available when no session is open or when Memory is paused. Click **Refresh** to read the diagnostics again.

Open **How this works** for a short description of the curator. For the full pipeline, see [How memory works](/memory/how-it-works/).

## Danger zone

The **Danger zone** deletes all memory entries whose subject matches a pattern. This action is permanent.

:::caution
A purge cannot be undone. It deletes every matching entry in the open workspace. It also permanently deletes matching pinned memories. To remove one memory and keep a record of it, use **Forget** instead. See [Pinning & forgetting](/memory/pinning-and-forgetting/).
:::

The **Mode** list sets how PtahCode matches the pattern:

| Mode | How the pattern matches |
| ---- | ----------------------- |
| `substring` | The subject contains the text. The characters `%` and `_` match only themselves |
| `like` | The pattern is an SQL `LIKE` expression. `%` matches any text and `_` matches one character |

To purge memories:

1. Open a workspace.
2. In the **Memories** view, set the scope to **This workspace**.
3. Click the **Maintenance** view tab.
4. In **Purge by subject pattern**, type the pattern.
5. Select the **Mode**.
6. Click **Purge**.
7. Read the confirmation message and confirm.

A message shows how many entries were deleted. The **Purge** button is not available when no workspace is open or when the scope is **All workspaces**. When the scope is **All workspaces**, click **Switch** to change it to **This workspace**.

## Related

- [Timeline & Corpus](/memory/timeline-and-corpus/)
- [Memory settings](/memory/settings/)
- [Pinning & forgetting](/memory/pinning-and-forgetting/)
