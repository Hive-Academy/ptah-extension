---
id: TASK_2026_560_2ae5
status: backlog
type: FEATURE
title: Enforce MCP on/off toggles for Codex, OpenCode and Antigravity lanes
description: >-
  PR #599 shipped the toggle contract, store, resolver, Marketplace switches and Claude/Ptah CLI
  enforcement. Left: MCP enforcement for the rival CLI lanes and real schema-size figures.
depends_on: []
created: 2026-09-25T00:00:00.000Z
updated: 2026-11-07T00:00:00.000Z
parent: TASK_2026_640_11a5
labels:
  - P3
---

## Description

PR 1 (#599) is done. The remaining work (PR 2):

1. Give the Codex, OpenCode and Antigravity lanes the effective MCP set from the capability
   resolver (`libs/backend/cli-agent-runtime/src/lib/capabilities/capability-resolver.service.ts`).
   Then flip their rows to `enforced` in `CAPABILITY_ENFORCEMENT`
   (`libs/shared/src/lib/types/capability-toggle.types.ts:692-701`); the UI follows from that table.
2. Measure the schema size of each enabled server, so the Marketplace shows a real figure instead of
   `size unknown` (`SCHEMA_SIZE_UNKNOWN`,
   `libs/frontend/marketplace/src/lib/pages/servers/installed-servers-page.component.ts:72,101-109`).
3. Remove the `ptah-cli-proxy` row (`capability-toggle.types.ts:699-701`). The headless CLI and its
   proxy are removed (PR #892).
4. Check the remaining PR 2 items from `context.md` against current code before you build them:
   the skills/plugins Marketplace page toggles, the duplicate-scope display and Codex quoted keys.

## Current state (2026-11-07)

- Done (PR #599 and its batches, for example `e303b8514`): the capability contract, toggle store,
  scope labels and the size label; Claude SDK sessions (including proxied ones) and Ptah CLI agent
  lanes apply the resolver.
- Open: `codex`, `opencode` and `antigravity` still use `MCP_NOT_ENFORCED`
  (`capability-toggle.types.ts:660-661,696-698`). Skills and plugins reach those lanes through the
  harness sync, which already honours the toggles.
- Obsolete with the CLI app removal (PR #892): the CLI proxy enforcement, the CLI warning print, and
  the Ptah CLI "unverified" notice from the old PR 2 list.
- The evidence folders `TASK_2026_557_tokaudit` and `TASK_2026_559_8ca9` are not on this branch. Read
  them from git history if needed.

## Original requirements (2026-09-25)

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
