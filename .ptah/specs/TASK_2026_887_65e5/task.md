---
id: TASK_2026_887_65e5
status: backlog
type: FEATURE
title: Finish Codex App Server leftovers (named roles, rewind, parity gate)
description: >-
  Remaining PENDING batches of TASK_2026_714_c8a2 with no code on main: 11c Codex
  named roles, 13a-13b turn-start shadow-tree checkpoint and rewind, 14a-14b
  parity-gate ledger and live parity run.
depends_on: [TASK_2026_714_c8a2]
created: 2026-11-07T00:00:00.000Z
updated: 2026-11-07T00:00:00.000Z
---

## Description

Split out of TASK_2026_714_c8a2 by the TASK_2026_886_032a status sweep. The parent's core scope
merged in #809, #823 and #881. These batches in the parent's `batches.md` were still `PENDING`,
with no code on main and no open PR or branch:

- 11c: Codex named roles / personas.
- 13a-13b: turn-start shadow-tree checkpoint and rewind.
- 14a-14b: parity-gate ledger and a live parity run.

Re-check each item against current main before planning.
