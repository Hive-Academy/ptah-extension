---
id: TASK_2026_560_2ae5
status: backlog
type: FEATURE
title: Per-workspace and global on/off controls for MCP servers and skills, enforced for every provider
description: >-
  Users cannot turn MCP servers or skills off per workspace from Ptah, cannot see whether a server
  comes from global or workspace scope, and Ptah does not enforce an effective set when it builds
  Claude SDK, proxied or CLI-lane sessions. Proxied sessions carry every schema on every request
  (about 49k unused tokens per request measured). Add the settings contract, the Marketplace UI and
  the enforcement.
depends_on: []
created: 2026-09-25T00:00:00.000Z
updated: 2026-09-25T00:00:00.000Z
---

## Description

Evidence: `.ptah/specs/TASK_2026_557_tokaudit/research-report.md` (RC6, Wave 0 item 0.5, Wave 1
item 7, Wave 2 item 2.1).

### Problem (measured)
- `.mcp.json` declares firecrawl, davinci-resolve, ptah and shopify-dev-mcp. `.claude/settings.local.json`
  sets `enableAllProjectMcpServers: true`, which overrides `enabledMcpjsonServers: ["ptah"]`, so all
  four load.
- Proxied sessions (custom base URL) have no tool deferral (40/40 streams). Each request carries
  davinci-resolve ~28k, ptah ~15.9k, firecrawl ~13k, shopify ~8.5k tokens of schemas. First request
  83.5k tokens, about 49k of it unused servers.
- Codex lanes inherit 12 desktop plugins and a 17.9k-char skills catalog from the global Codex config.
- The only way to turn a server off today is to hand-edit settings files.

### Requirements (from the user)
1. A Ptah setting and UI to turn each MCP server on or off per workspace.
2. A clear distinction between global servers (user scope: `~/.claude.json`, `~/.codex/config.toml`,
   `~/.ptah`) and workspace servers (`.mcp.json`, `.claude/settings*.json`). The UI shows the source of
   each server and which scope a toggle writes to. A workspace override never changes the global entry.
3. The same per-workspace on/off for skills and plugins.
4. Ptah enforces the effective set when it builds every session: Claude SDK, proxied, and CLI lanes
   (Codex, OpenCode, Antigravity, Ptah CLI). ptah is on by default. It does not depend on user files.
5. Show the token cost (schema size) of each enabled server.

### Anchors (from the marketplace session)
- Marketplace "Installed servers" page: `libs/frontend/marketplace/src/lib/pages/servers/installed-servers-page.component.ts`
  and `server-detail.component.html` already show status and config file paths. This is the place for
  the scope label, the per-workspace toggle and the schema-size figure.
- Shared contracts go in `libs/shared`.
- Coordinate with TASK_2026_559_8ca9 for per-caller tool profiles in
  `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (handleToolsList).
