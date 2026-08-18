---
id: TASK_2026_289
status: backlog
type: feature
title: >-
  Smithery is a skills marketplace too, and we only integrate its MCP half —
  decide whether the Skills side is worth a second provider
description: >-
  The Marketplace surfaces Smithery as one of four providers, and every Smithery
  file in this repo lives under
  `libs/backend/cli-agent-runtime/src/lib/mcp-directory/` — registry source,
  connection resolver, installed manifest, override resolver. That is the MCP
  half only. Smithery also publishes skills, and nothing here fetches, lists or
  installs them, so a user who knows the platform sees a provider tile that
  silently covers less than the platform does. This is a scope decision before
  it is an implementation: the skills.sh integration (TASK_2026_288) already
  establishes the shape a second skills provider would take — land content in a
  Ptah-owned source root under `~/.ptah/plugins/`, let the overlay and the
  reconciler carry it to every detected CLI — so the cost is mostly the
  provider-specific fetch, auth and listing, not the propagation. Deferred
  deliberately on 2026-08-18 as too much work for the session that found it;
  filed so the gap is recorded rather than rediscovered.
---

# Smithery skills as a marketplace provider

Machine-owned metadata carrier. Prose lives in `./context.md`.
