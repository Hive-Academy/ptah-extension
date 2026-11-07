---
id: TASK_2026_522_c6b1
status: backlog
type: BUGFIX
title: >-
  The MCP OAuth Electron e2e spec reads the real user profile and fails on a
  developer machine
description: >-
  The spec expects zero OAuth-connected MCP servers, but the app reads the real
  ~/.ptah/mcp-oauth-installed.json of whoever runs it. Give e2e runs their own home directory.
updated: 2026-11-07T00:00:00.000Z
---

# The MCP OAuth Electron e2e spec reads the real user profile

## Description

Found while verifying TASK_2026_491_e0da. The test
`mcpDirectory:listOAuthConnected returns an empty servers array on a fresh launch`
(`apps/ptah-electron-e2e/src/specs/rpc-new-features.spec.ts:162-176`) fails on any developer machine
that has an OAuth-connected MCP server. It passes on CI only because that machine starts clean.

The launcher isolates Electron `userData` and the database (`PTAH_DB_PATH`), but not the home
directory (`apps/ptah-electron-e2e/src/support/electron-launcher.ts:52-69,107-115`). The OAuth list
comes from `McpOAuthInstalledManifestStore`, which reads `os.homedir()/.ptah/mcp-oauth-installed.json`
(`libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/mcp-oauth-installed-manifest.ts:25-27`).

Remaining work is the scope and acceptance criteria in `context.md`: isolate the profile (most
likely HOME/USERPROFILE in the launcher), audit the other e2e specs for the same dependency, and
decide suite-wide versus per-spec isolation. TASK_2026_558_f761 has the same root cause for
`~/.gemini`; fix them together if suite-wide isolation is chosen.

## Current state (2026-11-07)

- Not fixed. The launcher env sets `PTAH_DB_PATH` (`electron-launcher.ts:114`) and no HOME or
  USERPROFILE override.
- The spec still asserts `length` is 0 (`rpc-new-features.spec.ts:175`).
- No audit of the other specs is recorded in this folder.
