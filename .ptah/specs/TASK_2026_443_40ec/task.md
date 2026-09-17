---
id: TASK_2026_443_40ec
status: done
type: FEATURE
title: >-
  Thoth phase 2: memory age lifecycle and ranking-only salience
description: >-
  Phase 2 of TASK_2026_439_1310. Unpinned recall memories unused for N days
  move to archival, archival unused for M more days are deleted with their
  chunks, FTS and vec rows, and a per-workspace count cap applies. Salience
  becomes ranking-only (no feedback loop, no salience-driven archival).
  MemoryDecayJob was built and tested but never scheduled, and nothing ever
  deletes a memory. Ships a reachability proof on the retention cron path.
depends_on: [TASK_2026_440_834c]
created: 2026-09-15T16:10:00.000Z
updated: 2026-09-15T16:10:00.000Z
---

## Description

See `context.md` for the request and roster, and
`../TASK_2026_439_1310/tribunal/verdict.md` section A for the cited requirements.
