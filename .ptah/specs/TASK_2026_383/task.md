---
id: TASK_2026_383
status: in_review
type: REFACTORING
title: >-
  Silent-degradation audit, backup off the main thread, and post-boot RPC jank (TASK_2026_380 follow-ups)
depends_on: []
created: '2026-09-06T00:00:00.000Z'
updated: '2026-09-06T00:00:00.000Z'
description: >-
  TASK_2026_380 Finding F-1 showed a worker that failed on every run for the whole task while the catch returned 'unavailable' and logged warn. A repo sweep found 508 catch-return-sentinel sites, 20 swallowed promise catches, 3 ESM worker bundles with no createRequire banner, no lint rule for empty catch or floating promises, and no spec that executes a built worker. Track A inventories, classifies, lint-gates and makes degradation observable. Track B moves the pre-migration and daily 1 GB backup copy off the main thread through the 380 worker pattern. Track C removes the ~15 s post-first-RPC jank from CLI/SDK detection handlers.
executor: software-architect
estimate: L
labels:
  - reliability
  - observability
  - lint
  - testing
relates_to:
  - TASK_2026_380
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Make every catch-and-degrade path in the product visible at runtime, covered by a positive-path test, and gated by lint. See [./context.md](./context.md).
