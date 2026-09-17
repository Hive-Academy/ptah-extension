# TASK_2026_448 — Branch review panel UX

## User intent

The user opened the git dock in Electron, switched to **Branch review** (base `main`, head
`docs/skill-corpus-tasks`, 14 added `.ptah/specs/**` files) and said the UI "is so messed up,
not anywhere near the review tab". The reference is the GitHub pull request **Files changed** tab.

## Defects observed (screenshot + code)

1. `review/git-review-toolbar.component.ts:15` — `flex-wrap` toolbar. **Head** drops to a second
   line, the `…` separator dangles, `+1321 -0` has no label, no "N files changed" summary.
2. `review/git-review-file-row.component.ts:35` — each row shows the full path with `truncate`.
   Shared prefixes (`.ptah/specs/TASK_2026_439_1310/tribunal/…`) hide the file name, so rows look
   identical.
3. Same file — status is a bare letter (`A`), no badge/color. **Mark as viewed** is a wide text
   button on every row. No hover state, no sticky file header.
4. Same file:66 — the diff sits in a fixed `h-80` box. The embedded `ptah-diff-view` shows its own
   second header and renders side-by-side even for added/deleted files, so half the width is an
   empty red block and the text is cut off.
5. `review/git-review-panel.component.ts:79-99` — tree uses `▾`/`·` text glyphs, folders are
   `disabled` (cannot collapse), clicking a file expands it but does not scroll to its row, rail is a
   fixed `13rem`.

## Out of scope

- Backend / RPC changes (no commit list — that needs a new wire field).
- The Working tree mode and the source-control panel.
