# Backlog polish brief (TASK_2026_886_032a, phase 2)

User request: "do the full pledge of the remaining backlog items, polish them and make sure they are
following our latest update and don't contain any old claims".

Worktree (work ONLY here): `<repo>/.claude-worktrees/task-status-sweep` (absolute:
`D:\projects\ptah-extension\.claude-worktrees\task-status-sweep`), branch `chore/task-status-sweep`,
code = `origin/main` 390808edf plus task-file commits only.

## Current product facts (verified on main)

- Apps on main: `ptah-electron` (priority host), `ptah-extension-webview` (the Electron renderer,
  despite its name), `ptah-electron-e2e`, `ptah-landing-page` (+e2e), `ptah-docs`.
- REMOVED from main: the VS Code extension host, the headless CLI app, the Ink TUI
  (`1cee6fafe`, PR #892); the NestJS license server and its `libs/api*` (`0dde8a197`); the Tribunal
  page (`dea55817c`); the harness builder view (PR #877). Libraries `platform-cli` and `cli-engine`
  may still exist for provider CLI lanes: check before you call anything about them obsolete.
- Prior verdicts with evidence: `.ptah/specs/TASK_2026_886_032a/backlog-audit-part1.md` and
  `backlog-audit-part2.md`. Reuse them; re-check only what you change.

## What to do for each task in your list

1. Read `task.md` and skim the other files in the folder (headings, first lines). Do not read
   whole large files.
2. Check every concrete claim in `task.md` against current code: file paths, symbol names, line
   numbers, "X does not exist yet", "X is broken", host names, library names, PR/task references.
   Use `ptah_code_search_symbols`, `ptah_search_files`, `ptah_ast_analyze` (load deferred tools
   with ToolSearch `select:<name>`), else Grep/Glob scoped to the worktree. A few calls per task.
3. Edit `task.md` with the Edit tool (never Write/rewrite the file) so that it is current:
   - Frontmatter: keep `id`, `status`, `type`, `depends_on`, `created` and any other fields as they
     are. You may fix `title` (short, imperative; `>-` block scalar if it has a colon) and
     `description` (ALWAYS a `>-` block scalar, one to three lines). Set `updated:` to
     `2026-11-07T00:00:00.000Z` (add the line after `created:` if missing). Do not change `status`.
   - Body: make `## Description` state the remaining work only, in present tense, with current
     repo-relative paths (`libs/...:line`). Remove or correct claims about removed hosts/apps,
     moved or renamed files, and work that is already done. Retarget VS Code/CLI/TUI-only wording
     to Electron when the problem still exists there; drop parts that only applied to a removed
     host.
   - Add a section `## Current state (2026-11-07)` with 2-6 bullets: what is already done (commit
     or PR), what is left, and the evidence (repo-relative `file:line`).
   - Keep useful detail (acceptance criteria, design notes) that is still true.
4. Other files in the folder (context.md, task-description.md, implementation-plan.md, ...) are
   history. Do not rewrite them. If one contains a claim that is now wrong in a way that could
   mislead an implementer, add one line at its very top:
   `> Note (2026-11-07): parts of this file are out of date; task.md is the current scope.`
5. If the task is in fact fully done, obsolete or a duplicate, do not change its status: polish it
   anyway and list it in your report under "Status proposals" with evidence.

## Rules

- No absolute workstation paths in any file you write (no `D:\`, `C:\Users`, `/d/projects`).
  Use repo-relative paths.
- Edit only task folders in your list, plus your report. Do not edit `registry.md`.
- No git commit/push/branch/worktree commands. No npm, nx, verify, build or test runs.
- Keep tool output small. Do not paste large file contents.
- STE-like plain wording: short sentences, active voice, no marketing language.

## Report (your deliverable)

`.ptah/specs/TASK_2026_886_032a/polish-report-partNN.md`:
- Counts: polished, unchanged (already current), notes added to history files.
- Table: task ID | what changed (one line) | removed old claims (short) | confidence.
- "Status proposals": task ID | proposed status | evidence.
- "Unclear": task ID | what could not be checked.
