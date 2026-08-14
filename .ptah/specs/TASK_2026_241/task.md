---
id: TASK_2026_241
status: backlog
type: feature
title: Unified installed-inventory surface for the Marketplace
description: >-
  Every Marketplace provider surface reads only its own installed list —
  mcpDirectory:listInstalled for the MCP Registry, listSmitheryInstalled for
  Smithery, listOAuthConnected for Connected Apps. Nothing aggregates them, so a
  server installed via one provider is invisible from the others and there is no
  single place to see what is actually wired into .mcp.json and the three other
  target configs. Add an inventory surface grouped by target config file.
---

# Unified installed-inventory surface for the Marketplace

Users cannot answer "what MCP servers do I actually have installed, and where?"
without opening each provider surface in turn and mentally merging four
partial lists — none of which agree on shape.

Prose lives in `context.md`.
