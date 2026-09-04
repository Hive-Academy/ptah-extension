---
id: TASK_2026_373
status: in_review
type: FEATURE
title: Connected Apps supports pre-registered OAuth clients on Electron and CLI
depends_on: []
created: '2026-09-03T18:30:00.000Z'
updated: '2026-09-03T18:30:00.000Z'
description: >-
  Remote MCP servers come in two OAuth flavors. Sentry, Notion and Linear
  register Ptah automatically (RFC 7591). HubSpot and others require the user
  to create an app with the provider and register a fixed redirect URL. On
  Electron and CLI the loopback listener binds a random port, so the redirect
  URL cannot be registered, and the UI never shows the URL to register. Bind a
  fixed loopback port, expose the redirect URL over RPC with a copy button,
  report dynamic-registration support from the discovery probe, and add a
  HubSpot quick-connect chip plus docs.
estimate: M
labels:
  - marketplace
  - oauth
  - mcp
  - rpc
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Connected Apps must work for both OAuth flavors on every host: servers that register Ptah automatically, and servers that require a pre-registered app with a fixed redirect URL.

Full context, plan and discussion live in [./context.md](./context.md).
