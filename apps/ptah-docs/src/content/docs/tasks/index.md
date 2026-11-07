---
title: Tasks Board
description: A six-column Kanban board over the task specifications in .ptah/specs/.
---

The **Tasks** board reads the `.ptah/specs/` folder in your workspace and renders
it as a Kanban board. Every card is a real folder on disk. Every status change
writes back to a file you can read, diff, and commit.

Open it from **Tasks** in the tab bar.

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

To change the status of a task, open **Change status** on the card and select a status. PtahCode patches the `status:` line
in `task.md` and re-reads the board. Nothing moves on the board until the write
succeeds, so what you see is always what is on disk.

## Task types and estimates

Each task carries a `type` and an optional `estimate`.

**Types:** `FEATURE`, `BUGFIX`, `REFACTORING`, `DOCUMENTATION`, `RESEARCH`,
`DEVOPS`, `SAAS_INIT`, `CREATIVE`. These are the same eight types the
[orchestration workflow](/agents/agent-orchestration/) recognizes.

**Estimates:** `XS`, `S`, `M`, `L`, `XL`. These are relative t-shirt sizes and
nothing more. PtahCode deliberately assigns them no numeric value and never sums a
column — a rough signal must not be read as a commitment.

## Board and list layouts

Two layouts show the same data.

- **Kanban** — six columns.
- **List** — one row per task, with the id, title, description, and metadata.

Switch layouts with the task layout control. Your choice is remembered per machine, not
per project, because it is a personal preference rather than a project setting.

## The detail panel

Click a card to open its detail panel. The panel shows:

- The frontmatter facts — status, type, estimate, title.
- A metadata editor for labels, estimate, and parent.
- `depends_on` — which tasks this one waits for.
- Validation warnings, if the carrier has any.
- The files in the task folder.

### Workflow documents

A task folder can hold documents from each stage of work — the context, the task
description, the implementation plan, the batch breakdown, review reports, and a
research report. Select a document to read it in the detail panel. Click
**Open in editor** to change the file.

`task.md` is machine-owned. Change its status and metadata with the board controls.

## Starting a task

Cards and rows carry a **Start** control. The detail panel has **Start in chat** and **Change status**. It hands the task to the orchestration
workflow, which reads the carrier and the plan and begins work.

You can start a task in an isolated **git worktree** so its edits do not touch
your working tree. See [Worktrees](/git/worktrees/).

## Creating a task

Click **New Task** in the board header. PtahCode allocates the next id for the
current year, creates the folder, and writes a valid carrier.

Ids are allocated by scanning the folders on disk, not by reading an index. A
stale index can never cause a collision.

## Excluded folders

A folder under `.ptah/specs/` that PtahCode cannot read as a task is **excluded**, and
the board lists it by name in the exclusions drawer with the reason.

PtahCode never reports a count alone. A count tells you that folders vanished without
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

Open **Manage** in the board header. **Generate registry** regenerates `registry.md`, a summary of every task. **Reindex** rescans
`.ptah/specs/` from scratch. **Tidy finished…** previews which finished tasks would be deleted. Reindex is the fix when you have edited carriers
outside PtahCode and want the board to catch up immediately.

The board also refreshes on its own. An agent writing spec folders pushes a
change notification, and the board re-reads when it is on screen.

## Next steps

- [Agent orchestration](/agents/agent-orchestration/) — the workflow that consumes these specs
- [Relay orchestration](/tribunal/relay/) — run one task through a multi-vendor pipeline, persisted here
- [Worktrees](/git/worktrees/) — isolate a task's edits
