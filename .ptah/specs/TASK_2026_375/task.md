---
id: TASK_2026_375
status: in_progress
type: FEATURE
title: Ptah Connectors — one surface for every remote MCP server, with live auth status
depends_on:
  - TASK_2026_373
created: '2026-09-03T19:10:00.000Z'
updated: '2026-09-03T19:10:00.000Z'
description: >-
  Ptah has four disconnected ways to reach a remote MCP server and none of them
  tells the user whether the server is usable. Installed Smithery servers and
  Connected Apps never reach a session until the app restarts, because both
  manifests are read once at construction. OAuth discovery ignores URL paths, so
  every Smithery-hosted server is reported as "needs an API key" although its
  auth server supports dynamic registration. The Smithery surface still uses the
  legacy per-server URL and has no account, no connection list and no OAuth
  step, so HubSpot lands in the session as "needs-auth" and nothing shows it.
  The CLI reports per-server MCP status and the claude.ai connectors notice at
  session start, and Ptah logs both at debug level only. Fix the freshness and
  discovery defects, adopt the Smithery Connections API, ship a curated Ptah
  connectors catalog, and surface per-session MCP status with an Authorize
  action.
estimate: L
labels:
  - marketplace
  - mcp
  - oauth
  - smithery
  - rpc
  - chat
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

One Connectors surface for every remote MCP server, a working Smithery path with account and connection status, and a per-session MCP status chip with an Authorize action.

Full context lives in [./context.md](./context.md). The executable batch plan lives in [./batches.md](./batches.md).
