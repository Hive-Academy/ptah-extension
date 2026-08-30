---
id: TASK_2026_355
status: backlog
type: BUGFIX
title: Repair CP1252-mojibake em dashes baked into 344 source strings across 65 .ts files
depends_on:
  - TASK_2026_354
created: '2026-08-29T01:40:14.012Z'
updated: '2026-08-29T01:40:14.012Z'
description: 'TASK_2026_354 traced the "â€”" in console output to the SOURCE, not the console: the byte sequence c3 a2 e2 82 ac e2 80 9d (a UTF-8 em dash decoded as CP1252 and re-encoded) appears in 344 places across 65 .ts files, mostly in log strings and comments. 354 masks it at Logger.writeToConsole via sanitizeConsoleText; this task does the mechanical whole-repo repair (replace the mojibake sequence with a plain em dash or "-"), adds a lint/guard spec that fails on the byte sequence, and must run when no other agent is editing those libs to avoid collisions.'
executor: backend-developer
estimate: S
labels:
  - logging
  - encoding
  - log-audit-2026-08-28
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

TASK_2026_354 traced the "â€”" in console output to the SOURCE, not the console: the byte sequence c3 a2 e2 82 ac e2 80 9d (a UTF-8 em dash decoded as CP1252 and re-encoded) appears in 344 places across 65 .ts files, mostly in log strings and comments. 354 masks it at Logger.writeToConsole via sanitizeConsoleText; this task does the mechanical whole-repo repair (replace the mojibake sequence with a plain em dash or "-"), adds a lint/guard spec that fails on the byte sequence, and must run when no other agent is editing those libs to avoid collisions.

Full context, plan and discussion live in [./context.md](./context.md).
