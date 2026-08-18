---
id: TASK_2026_291
status: done
type: bugfix
title: >-
  Any run that was not literally NODE_ENV=development opened the production
  database — an e2e capture migrated it and locked the installed build out
description: >-
  `resolvePtahDbPath()` branched on `NODE_ENV === 'development'` and nothing
  else, so `test`, unset and every CI value resolved to
  `~/.ptah/state/ptah.sqlite`. The Electron e2e launcher sets `NODE_ENV=test`
  and isolates only `--user-data-dir`, which moves Electron's userData and not
  `os.homedir()` — so a launch from the working tree opened the real 998 MB
  production database and, because a boot migrates whatever it opens, carried
  working-tree migrations into it. On 2026-08-17T17:14:03Z that produced
  `ptah.pre-migration-20260817T171403Z.sqlite` (965 MB) with no matching
  `migrations applied` line in either Electron profile log, because the
  migrator's logs went to the throwaway profile the harness deletes on exit.
  The packaged app had reported `finalVersion: 30` five hours earlier; the
  installed VS Code extension (0.2.43) then hit the forward-only guard and
  disabled persistence — memory search returned `bm25Only` with zero hits.
  Fixed by making `test` a real profile with its own file, adding a
  `PTAH_DB_PATH` override that wins over everything, and having `launchPtah`
  point every launch at a temp database instead of relying on `NODE_ENV`.
  Production stays the default for unset `NODE_ENV` — packaged Electron and the
  VS Code extension host both run that way.
---

# Test and CI runs must never resolve to the production database

Machine-owned metadata carrier. Prose lives in `./context.md`.
