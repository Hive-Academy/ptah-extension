---
id: TASK_2026_287
status: done
type: bugfix
title: >-
  The consent dialog promised to install a plugin's MCP servers and nothing ever
  did — record the intent the reconciler was already waiting for
description: >-
  `MarketplaceManifestSchema` has accepted `mcpServers` since the external
  marketplace shipped. `ExternalPluginInstallerService` renders them for the
  consent dialog through `describeMcpServers` and persists them in the consent
  record as `InstalledPluginSchema.mcpServers`. Nothing installed them. The
  `plugin-marketplace` lib has no reference to `harness-sync`, `McpIntentStore`
  or `McpInstallService` anywhere — its entire dependency set is `shared` plus
  `vscode-core` — and the only other consumer of that field in the repo is the
  dialog component that displays it. So the user was shown a list of MCP
  servers, told the plugin would install them, approved, and not one byte
  reached `.mcp.json`, `~/.codex/config.toml`, `~/.copilot/mcp-config.json`,
  `.cursor/mcp.json` or `~/.gemini/config/mcp_config.json`. No intent was
  recorded, so the reconciler never saw them. That is worse than not offering
  the feature, because the user believes it happened.
updated: '2026-08-25T21:16:27.891Z'
---

# External plugin MCP servers were never installed

Machine-owned metadata carrier. Prose lives in `./context.md`.
