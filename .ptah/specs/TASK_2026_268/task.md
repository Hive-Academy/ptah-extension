---
id: TASK_2026_268
status: done
type: REFACTORING
title: >-
  Set a 700-line soft ceiling the repo can actually hold, and rank the 50
  files over 1000 by whether a real seam is buried in them
description: >-
  There is no `max-lines` rule in `eslint.config.mjs` and no file-size standard
  in `CLAUDE.md`, so file growth is currently invisible until someone measures
  it by hand — which is how `skill-synthesis.service.ts` went from 906 lines on
  `main` to 2027 without anyone noticing (repaired in TASK_2026_256). Excluding
  the generated Prisma client, 50 hand-written production `.ts` files exceed
  1000 lines and 137 exceed 700. This task does the cheap half outright — a
  warn-level `max-lines` rule at 700 plus the standard and its facade
  guardrails written into `CLAUDE.md` — and then surveys the 50 worst files to
  produce a RANKED backlog rather than opening 137 refactors on line count
  alone. The survey classifies each file by technique (facade, barrel split,
  component split, exempt) and judges whether an important role is actually
  buried among unrelated concerns, which is what made 256 worth doing. Files
  where the count is incidental rather than symptomatic — `rpc.types.ts` at
  3589 is a contract barrel where a split buys nothing but import churn — are
  to be marked exempt with a reason, not queued.
---

# A file-size standard, and a ranked backlog instead of a blanket sweep

Machine-owned metadata carrier. Prose lives in `./context.md`.
