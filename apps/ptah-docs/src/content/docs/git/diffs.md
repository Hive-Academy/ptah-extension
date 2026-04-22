---
title: Diffs
description: Side-by-side file change display with syntax highlighting.
---

# Diffs

Every modified file in the workspace shows a diff view when you click it. Ptah renders diffs **side-by-side** by default, with the pre-change version on the left and the post-change version on the right.

![Side-by-side diff view](/screenshots/diff-side-by-side.png)

## What the diff shows

Ptah compares:

| Base                       | Target                       |
| -------------------------- | ---------------------------- |
| `HEAD` version of the file | Current working-tree version |

Staged-only changes and unstaged changes are both included. If the file is new (untracked), the left pane is empty and the right pane shows the full content as additions.

## Syntax highlighting

Diffs use the same syntax highlighter as the rest of Ptah (Shiki). Languages are detected from file extension. Supported out of the box includes: TypeScript, JavaScript, Python, Rust, Go, Java, C/C++, C#, Ruby, PHP, Swift, Kotlin, HTML, CSS, SCSS, JSON, YAML, TOML, Markdown, SQL, Shell, and many more.

## Viewing options

Toggle via the diff toolbar:

- **Side-by-side** (default) — two panes with aligned line numbers.
- **Inline** — single pane, deletions in red followed by additions in green.
- **Whitespace ignore** — hides whitespace-only changes.
- **Word-level highlight** — within a changed line, highlight the specific tokens that changed.

## Agent-generated diffs

When an agent proposes a file edit, Ptah renders the proposed change as a diff **before** applying it. You see exactly what will change and can accept or reject per-hunk.

![Agent proposed diff](/screenshots/diff-agent-proposed.png)

Rejecting a hunk keeps the rest of the proposed edit and skips only that section. Rejecting the whole diff reverts nothing — the agent's proposal simply isn't applied.

:::tip
For agent diffs, the keyboard shortcut `y` accepts, `n` rejects, and `shift+y` accepts the whole file without reviewing remaining hunks. Use the last one only when you trust the agent.
:::

## Limitations

- Diffs over 10,000 lines switch to a collapsed summary view for performance. Click **Show full diff** to load the complete content.
- Binary files show a file-info card only (size, mime type, new/modified/deleted status) — no byte-level diff.
- Renamed files are detected when git reports them as renames; otherwise they show as a delete + add pair.
