---
id: TASK_2026_301
status: backlog
type: bugfix
title: >-
  TypeScriptDiagnosticsProvider silently truncates tsconfig discovery at 200
  results
description: >-
  `TypeScriptDiagnosticsProvider.getDiagnostics` discovers its work set with
  `this.fs.findFiles('**/tsconfig*.json', DEFAULT_WORKSPACE_EXCLUDES, 200,
  workspaceRoot)` and treats whatever comes back as the whole workspace. Any
  config past the 200th is never parsed, never compiled, and never reported —
  with no error, no `unavailable`, and no partial-coverage flag. The result is
  indistinguishable from a genuinely clean subtree. This repo makes the cap a
  live risk rather than a theoretical one: 13 apps plus roughly 80 libs, most
  carrying `tsconfig.json` alongside `tsconfig.lib.json`/`tsconfig.app.json`
  and `tsconfig.spec.json`, plausibly clears 200 files on its own. The failure
  compounds with the class of defect TASK_2026_299 was opened to remove —
  under-reporting that reads to the calling agent as "no issues here" — so the
  fix must make truncation observable rather than merely raise the ceiling.
  Options: page through discovery, raise the cap with a hard assertion, or
  carry a truncation marker into the `DiagnosticsResult` reason. Whichever is
  chosen, a spec must prove that a workspace exceeding the cap cannot report a
  clean result.
---

# TypeScript diagnostics discovery truncates silently at 200 tsconfigs

Machine-owned metadata carrier. Prose lives in `./context.md`.
