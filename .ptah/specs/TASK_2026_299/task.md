---
id: TASK_2026_299
status: in_review
type: bugfix
title: 'Repair internal file search and diagnostics across runtimes'
description: >-
  Fix ptah_search_files to do true filesystem glob discovery (not fuzzy
  substring index) and stop swallowing failures into []. Fix
  ptah_get_diagnostics so Electron/CLI return an honest
  available/unavailable contract instead of empty stubs, and the formatter
  no longer labels every empty result as "No issues found". Adds a shared
  TypeScriptDiagnosticsProvider in workspace-intelligence for Electron/CLI.
---

## TASK_2026_299 — Repair internal file search and diagnostics across runtimes

Carrier only. Prose and full implementation plan live in `context.md`.
Decomposition lives in `tasks.md` (team-leader output).
