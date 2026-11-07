---
id: TASK_2026_241
status: backlog
type: FEATURE
title: Group the unified Marketplace MCP inventory by target config file
updated: 2026-11-07T00:00:00.000Z
description: >-
  The installed-servers page already merges harness-config, Claude user, Smithery and OAuth
  rows into one list with origin and target filters. The only open item is an optional view
  that groups rows by target config file. Decide if that view is still wanted.
---

# Unified installed-inventory surface for the Marketplace

Prose lives in `context.md`.

## Description

The original gap (each provider surface reads only its own installed list) is closed. One
inventory now carries every disk and manifest source. What is left:

- Decide if users still need a view grouped by target config file (`.mcp.json` and the other
  harness targets). Today the page offers a target filter facet, not grouping.
- If yes, add the grouping to `libs/frontend/marketplace/src/lib/pages/servers/installed-servers-page.component.ts`.
  Do not add a new RPC: `mcpDirectory:listInstalled` already returns every origin.

## Current state (2026-11-07)

- Done in `e4dc3c03c` ("show every connected MCP server and make Remove honest"):
  `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts:381` `listInstalled`
  emits `harness-config` (:489), `claude-user` (:514), `smithery` (:555) and `oauth` (:583) rows.
- The origin union is `McpServerOrigin` in `libs/shared/src/lib/types/mcp-directory.types.ts:383-384`.
  The frontend adds `claude-connector` rows in
  `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts:455-469`.
- `installed-servers-page.component.ts:172` filters by origin, target and status.
- Not done: grouping by target config file.
