---
id: TASK_2026_378
status: in_review
type: RESEARCH
title: First-class connectors out of the box — own catalog, Smithery, or an aggregator
depends_on:
  - TASK_2026_375
created: '2026-09-03T22:40:00.000Z'
updated: '2026-09-03T22:40:00.000Z'
description: >-
  Decide how Ptah ships first-class connectors in Connected Apps without a
  per-user quota. Compare four routes with measured facts: a Ptah-owned
  catalog of vendor-hosted remote MCP servers scraped from the Claude
  connectors directory and vendor docs; Smithery managed servers under its
  free-tier limits; other managed-OAuth aggregators (Pipedream, Composio,
  Klavis, Nango, Zapier); and Ptah-owned OAuth apps. Every candidate URL is
  probed live for OAuth discovery and dynamic registration. Output is a
  research report with a decision matrix, a verified candidate table, and an
  implementation plan for the chosen route.
estimate: M
labels:
  - marketplace
  - mcp
  - oauth
  - research
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Which route gives Ptah first-class connectors out of the box, at what cost, and with what coverage? Answered with probes, not opinions.

Context lives in [./context.md](./context.md). The result lands in `research-report.md`.
