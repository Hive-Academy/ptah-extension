# Inventory brief (shared by lanes A and B)

## Objective

Build a gap inventory: every **user-facing** feature of the PtahCode desktop app (Electron) in
your assigned scope, compared with the docs site `apps/ptah-docs`. This is read-only research.
Do not edit any file except your deliverable.

Worktree (work only here): `D:\projects\ptah-extension\.claude-worktrees\docs-gap-fill`

## What counts as a feature

A thing a user can see or do: a tab, a panel, a page or route, a dialog, a settings section or
setting, a menu item, a tray or app menu entry, a keyboard shortcut, or a button/action that
calls an RPC method. Group small controls under their panel (one row per meaningful feature,
not per button). Skip dev-only, test-only, e2e-harness and internal plumbing code.

## Inputs (read first)

- `.ptah/specs/TASK_2026_889_d57a/facts.md` — ground truth about the product. The Electron
  app is the only host. Removed things (VS Code extension, CLI, TUI, license server) are not
  features.
- Docs content: `apps/ptah-docs/src/content/docs/**` (one `.md`/`.mdx` per page; the slug is the
  path without the extension, or the `slug:` frontmatter field when present).
- Docs sidebar: `apps/ptah-docs/astro.config.mjs`.
- Use `ptah_ast_analyze`, `ptah_code_search_symbols` and Grep for the code. Do not read whole
  large files when a search gives the line.

## Status rules

- `documented` — a docs page describes the feature and how to use it.
- `partial` — a page mentions it, but key parts (main actions, settings) are absent or the
  page only names it.
- `missing` — no page describes it (a glossary entry alone counts as missing).

Search the docs for the feature name AND its UI label strings before you mark `missing`.

## Deliverable format

Write the skeleton early (headings + empty table), then fill it in. Markdown table, columns:

| # | Area | Feature (UI label) | Code evidence (file:line) | Docs page (slug or —) | Status | Notes |

- Code evidence: one or two `path:line` references to the component, template or RPC handler
  that proves the feature exists and is reachable by a user (route, tab registration, menu).
- Notes: one short line (for `partial`, say what is absent).

After the table add:

- `## Summary` — counts per status, and the 10 most important `missing` features with one
  sentence each on why a user needs a page.
- `## Decisions` — any judgment calls (what you grouped, what you skipped as non-user-facing).

## Known gaps (confirm and give evidence)

The user knows these have no page: remote machines, MCP caller authentication, the session
inspector, the memory corpus and timeline. Include a row for each one that is in your scope.

## Rules

- Electron only. Do not list VS Code, CLI or TUI features.
- Memory-safe: do not run `npm run verify`, builds, serve, dev, e2e or tests. You need none.
- Git: never commit, push, stash, reset, restore or checkout. Do not edit any other file.
- Reply only `WROTE: <absolute path>` plus a one-line headline. Call `ptah_agent_report` once
  before you exit with the path you wrote and anything you could not do.
