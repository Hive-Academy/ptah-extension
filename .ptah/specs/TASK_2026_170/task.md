---
id: TASK_2026_170
status: done
type: BUGFIX
title: >-
  Make the license-server ValidationPipe actually validate, and split the admin
  routes
depends_on: []
created: '2026-08-09T15:26:27.186Z'
updated: '2026-08-09T15:26:27.209Z'
status_inferred: true
description: >-
  The global ValidationPipe was inert because esbuild emits no
  design:paramtypes, so every @Body()/@Query() payload was returned unvalidated,
  including on public endpoints. Bind a per-endpoint dtoPipe across all three
  tiers (webhooks excluded), then split the admin god-controller off the shared
  v1/admin prefix to kill ten route contests. UNVALIDATED_DEBT is now empty,
  which was the task-defined completion gate.
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Make the license-server ValidationPipe actually validate, and split the admin routes

Full context, plan and discussion live in [./context.md](./context.md).
