# Review brief — new docs pages (claim check)

## Objective

Independently check every claim in the new PtahCode docs pages against the code. You are the
reviewer, not the author. Edit nothing except your deliverable.

Worktree: `D:\projects\ptah-extension\.claude-worktrees\docs-gap-fill`

## What to check, per page

1. **Each claim is true in the code now.** A claim is any statement about what the user sees
   or can do: UI labels, where a control is, what it does, defaults, setting keys, limits,
   order of steps, file paths shown to users. Find the code yourself (Grep,
   `ptah_code_search_symbols`, `ptah_ast_analyze`). The writer's evidence report lists
   `path:line` for each claim; use it as a starting point but do not trust it.
2. **Reachable in the Electron app.** The feature must be reachable in the desktop app. Flag
   claims that are true only for another host (for example code gated on `host === 'vscode'`).
3. **Rules**: no mention of VS Code, CLI or TUI as hosts; no version numbers, prices, dates,
   roadmaps, "coming soon", "planned", "not yet", or changelogs.
4. **Links**: every internal link points to an existing page in
   `apps/ptah-docs/src/content/docs/` (a `slug:` frontmatter field overrides the path) and
   every `#anchor` matches a heading on the target page. Relative links are defects.
5. Omissions are not defects unless the page says something that becomes false because of
   them.

## Deliverable format

Write the skeleton first, then fill it in.

```
# Review — <scope>
Verdict: APPROVED | REVISE
Reviewer family: codex

## Defects
| # | Severity (Blocking/Serious/Minor) | Page file:line | Claim | Problem | Code evidence (path:line) | Fix |

## Checked claims
Per page: number of claims checked, number confirmed.

## Notes
```

- Blocking: a false claim about behavior, a broken link, a non-Electron host claim.
- Serious: a wrong label, default or step that would mislead a user.
- Minor: a wording problem that does not change the meaning.
- Each defect needs a page `file:line` AND code evidence `path:line`. Drop any defect without
  both.
- Verdict is APPROVED only when there are no Blocking or Serious defects.

## Rules

- Memory-safe: do not run `npm run verify`, nx, astro, builds, serve, dev, e2e or tests. You
  may run `node .ptah/specs/TASK_2026_889_d57a/_linkcheck.mjs` from the worktree root.
- Git: read-only only (`git log`, `git show`, `git diff`). Never commit, push, stash, reset,
  restore or checkout.
- Do not spawn subagents or other lanes.
- Reply only `WROTE: <path>` plus a one-line verdict. Call `ptah_agent_report` once before exit.
