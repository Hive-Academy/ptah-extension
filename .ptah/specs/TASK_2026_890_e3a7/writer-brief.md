# Writer brief (shared by lanes W1, W2, W3)

## Objective

Write new user-guide pages for the PtahCode desktop app (Electron) in the docs site
`apps/ptah-docs`. Each page covers one feature group from the gap inventory. Every claim in a
page must have code evidence. Write no claim without evidence.

Worktree (work only here): `D:\projects\ptah-extension\.claude-worktrees\docs-gap-fill`

## Inputs (read first)

- `.ptah/specs/TASK_2026_890_e3a7/gap-inventory.md` — your rows (row ids in your lane prompt)
  give the starting code evidence. Re-check each one; the inventory is evidence, not proof.
- `.ptah/specs/TASK_2026_889_d57a/facts.md` — product ground truth.
- Two or three existing pages in the same docs folder as each new page: copy their frontmatter
  shape (`title`, `description`, and `sidebar: order` when siblings use it), heading style,
  tone, bold UI labels, and internal link form (`/folder/page/` with a trailing slash).

## Content rules

1. **Evidence for every claim.** A claim is any statement about what the user sees or can do,
   a UI label, a default value, a setting key, a limit or a behavior. Take labels verbatim from
   templates or `aria-label` / `title` strings. If you cannot find evidence, leave the claim out.
2. **Electron only.** Do not mention VS Code, the CLI or the TUI as hosts.
3. **No content that goes stale fast**: no version numbers, prices, dates, roadmaps, "coming
   soon", "planned", "not yet", or changelogs. Describe what the app does now.
4. Write for users: what the feature is, where to open it, what each main control does, and
   how to complete the main task (numbered steps). Keep pages focused; no code internals, no
   class or file names in the page body (setting keys like `mcp.externalCallerAccess` are fine
   when the UI shows them or existing pages already use them).
5. Internal links must point to pages that exist (check the file in
   `apps/ptah-docs/src/content/docs/`; a `slug:` frontmatter field overrides the path). Heading
   anchors must match a real heading. Use absolute links (`/chat/autopilot/`), never relative.
6. No images or screenshots (none exist for these features).
7. Do not edit `apps/ptah-docs/astro.config.mjs` (the orchestrator owns the sidebar). Edit only
   the files your lane prompt lists: your new pages, and one cross-link line in each listed
   existing page.

## Deliverables

1. The new pages listed in your lane prompt.
2. An evidence report at the path in your lane prompt. Write its skeleton first. For each page:

   ```
   ## <page path>
   | # | Claim (short) | Evidence (path:line) |
   ```

   One row per claim. Then `## Cross-links added` (file, line), `## Sidebar request` (the slug,
   the label and the group you propose for each new page), `## Decisions` and, if needed,
   `## Clarifications Needed`.

## Rules

- Memory-safe: do not run `npm run verify`, nx, astro, builds, serve, dev, e2e or tests. You
  need none. You may run `node .ptah/specs/TASK_2026_889_d57a/_linkcheck.mjs` from the worktree
  root to check internal links.
- Git: never commit, push, stash, reset, restore or checkout. Do not revert changes you did not
  make; other lanes write other files in parallel.
- Do not spawn subagents or other lanes.
- Reply only `WROTE: <report path>` plus a one-line headline. Call `ptah_agent_report` once
  before you exit with every file you wrote and anything you could not do.
