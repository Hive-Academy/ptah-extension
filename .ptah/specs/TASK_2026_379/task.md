---
id: TASK_2026_379
status: in_progress
type: FEATURE
title: Grow the connectors catalog to the probe-verified set and guide every app-required connect
depends_on:
  - TASK_2026_375
  - TASK_2026_378
created: '2026-09-04T00:10:00.000Z'
updated: '2026-09-04T00:10:00.000Z'
description: >-
  TASK_2026_378 probed 63 remote MCP endpoints and found 43 that connect with
  one browser round trip and 14 that need an app the user creates with the
  provider. The catalog carries 21 entries and tells an app-required user
  nothing about what to do. Add the verified rows, including the new
  first-party Google Workspace servers and the Smithery Google servers, render
  per-connector setup steps with the host's real redirect URL, and add a
  scheduled probe so the catalog cannot quietly go stale.
estimate: M
labels:
  - marketplace
  - mcp
  - oauth
  - catalog
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

More verified connectors, and a walkthrough instead of a dead end for the ones that need a provider-side app.

Evidence: [../TASK_2026_378/research-report.md](../TASK_2026_378/research-report.md). Plan: [./batches.md](./batches.md).
