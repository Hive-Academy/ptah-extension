---
title: Tasks Board
description: A six-column Kanban board over the task specifications in .ptah/specs/.
---

The **Tasks** board reads the `.ptah/specs/` folder in your workspace and renders
it as a Kanban board. Every card is a real folder on disk. Every status change
writes back to a file you can read, diff, and commit.

Open it from **Tasks** in the navigation rail.

## What a task is

A task is a folder under `.ptah/specs/`. The folder name is the task id.

```text
<workspace>/.ptah/specs/
├── TASK_2026_104/
│   ├── task.md                  ← the carrier (required)
│   ├── context.md               ← user intent and narrative
│   ├── implementation-plan.md
│   └── code-review.md
└── TASK_2026_105/
    └── task.md
```

**`task.md` is the carrier.** A folder without it is invisible to the board. The
carrier holds YAML frontmatter plus a short body:

```markdown
---
status: in_progress
type: FEATURE
title: Add Telegram voice replies
estimate: M
---

Wire the gateway's voice path to the outbound reply channel.
```

The folder name always wins. If the frontmatter carries an `id:` that disagrees
with the folder name, the board shows a warning and uses the folder name.

## The six columns

| Status        | Meaning                                |
| ------------- | -------------------------------------- |
| `backlog`     | Not started.                           |
| `in_progress` | Being worked on now.                   |
| `in_review`   | Work is done, review is not.           |
| `blocked`     | Waiting on something outside the task. |
| `done`        | Finished.                              |
| `cancelled`   | Dropped. Kept for the record.          |

Drag a card between columns to change its status. Ptah patches the `status:` line
in `task.md` and re-reads the board. Nothing moves on the board until the write
succeeds, so what you see is always what is on disk.

## Task types and estimates

Each task carries a `type` and an optional `estimate`.

**Types:** `FEATURE`, `BUGFIX`, `REFACTORING`, `DOCUMENTATION`, `RESEARCH`,
`DEVOPS`, `SAAS_INIT`, `CREATIVE`. These are the same eight types the
[orchestration workflow](/agents/agent-orchestration/) recognizes.

**Estimates:** `XS`, `S`, `M`, `L`, `XL`. These are relative t-shirt sizes and
nothing more. Ptah deliberately assigns them no numeric value and never sums a
column — a rough signal must not be read as a commitment.

## Board and list layouts

Two layouts show the same data.

- **Kanban** — six columns, drag between them.
- **List** — one row per task, with the id, title, description, and metadata.

Switch layouts from the view control. Your choice is remembered per machine, not
per project, because it is a personal preference rather than a project setting.

## The detail panel

Click a card to open its detail panel. The panel shows:

- The frontmatter facts — status, type, estimate, title.
- `depends_on` — which tasks this one waits for.
- Validation warnings, if the carrier has any.
- The `task.md` body, rendered as markdown.
- The **workflow documents** present in the folder.

### Workflow documents

A task folder can hold documents from each stage of work — the context, the task
description, the implementation plan, the batch breakdown, review reports, and a
research report. Each present document gets two controls:

| Control            | What it does                                  |
| ------------------ | --------------------------------------------- |
| **Read here**      | Renders the document inside the detail panel. |
| **Open in editor** | Opens the file in the editor for editing.     |

These are different intents. Use **Read here** to check what a stage produced.
Use **Open in editor** when you want to change it.

## Starting a task

Cards and rows carry a **Start** control. It hands the task to the orchestration
workflow, which reads the carrier and the plan and begins work.

You can start a task in an isolated **git worktree** so its edits do not touch
your working tree. See [Worktrees](/git/worktrees/).

:::note
Start lives on the card and the row only. The detail panel does not launch work —
it is for reading.
:::

## Creating a task

Click **New Task** in the board header. Ptah allocates the next id for the
current year, creates the folder, and writes a valid carrier.

Ids are allocated by scanning the folders on disk, not by reading an index. A
stale index can never cause a collision.

## Excluded folders

A folder under `.ptah/specs/` that Ptah cannot read as a task is **excluded**, and
the board lists it by name in the exclusions drawer with the reason.

Ptah never reports a count alone. A count tells you that folders vanished without
telling you which or why, and that silent drop is exactly what the drawer exists
to prevent. The most common cause is unparseable frontmatter.

:::caution[Quote anything with a colon]
A plain YAML scalar ends at the first colon followed by a space. A `description`
or `title` that quotes code makes the whole carrier unparseable, and the task
disappears from the board. Write those fields as block scalars:

```yaml
description: >-
  Fix the crash in rpc-handler.ts: the guard rejects the prefix.
```

:::

## Registry and reindex

**Registry** generates a summary document of every task. **Reindex** rescans
`.ptah/specs/` from scratch. Reindex is the fix when you have edited carriers
outside Ptah and want the board to catch up immediately.

The board also refreshes on its own. An agent writing spec folders pushes a
change notification, and the board re-reads when it is on screen.

## Working from the CLI

The same task tree is readable and writable from the headless CLI:

```bash
ptah spec list --status backlog,in_progress
ptah spec show TASK_2026_104
ptah spec status TASK_2026_104 --to in_review
ptah spec new --title "Add voice replies" --type FEATURE
ptah spec doctor
ptah execute-spec --id TASK_2026_104
```

See [Ptah CLI commands](/cli/commands/).

## Next steps

- [Agent orchestration](/agents/agent-orchestration/) — the workflow that consumes these specs
- [Tribunal Relay](/tribunal/relay/) — run one task through a multi-vendor pipeline, persisted here
- [Worktrees](/git/worktrees/) — isolate a task's edits
