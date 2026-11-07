---
id: TASK_2026_289
status: backlog
type: feature
title: >-
  Decide whether to add Smithery skills as a second Marketplace skills provider
description: >-
  Ptah integrates only the MCP half of Smithery. Decide whether Smithery skills are worth a
  provider. If yes, follow the skills.sh shape: land content in a Ptah-owned source root and
  let the overlay and the harness reconciler carry it to every detected CLI.
parent: TASK_2026_640_11a5
labels:
  - P4
updated: 2026-11-07T00:00:00.000Z
---

# Smithery skills as a marketplace provider

Machine-owned metadata carrier. Prose lives in `./context.md`.

## Description

This is a scope decision first. Smithery also publishes skills, but Ptah does not fetch, list
or install them. Remaining work:

1. Decide if the Smithery skills side is worth a provider (cost: provider-specific fetch, auth
   and listing; propagation already exists).
2. If yes, add a skills provider modelled on the skills.sh integration (TASK_2026_288,
   `skillsSh:` RPCs) and a Marketplace tile or tab in `libs/frontend/marketplace`.
3. If no, close this task and state in the Smithery surface that it covers MCP servers only.

## Current state (2026-11-07)

- Not started. Every Smithery file is still MCP-only, under
  `libs/backend/cli-agent-runtime/src/lib/mcp-directory/` (`smithery-registry.source.ts`,
  `smithery-connection-resolver.ts`, `smithery-installed-manifest.ts`, and others).
- No Smithery skills code exists anywhere in `libs/backend`.
- Deferred on 2026-08-18; the decision is still open.
