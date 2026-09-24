---
status: in_review
type: bugfix
title: 'Security: move the Cursor API key out of plain settings into the secrets store'
depends_on: [TASK_2026_534]
blocks: []
---

# TASK_2026_538 — Cursor API key is stored in plain text

## Why

`agent:setConfig` persists `cursorApiKey` with
`workspace.setConfiguration('ptah', 'provider.cursor.apiKey', …)`
(`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:~307-312`), so
the key sits in the plain settings file. Every other provider key goes through
`AuthSecretsService` (`libs/backend/vscode-core/src/services/auth-secrets.service.ts:263-279`,
`ptah.auth.provider.<id>`). Found while fixing the debug-log leak of the same key
in TASK_2026_534. The log leak is fixed in PR #581, which is now merged.
This task depends on #581 and must be based on main.

## Scope

1. Write: `agent:setConfig { cursorApiKey }` stores via
   `AuthSecretsService.setProviderKey('cursor', …)`; empty string deletes.
2. Read: every reader of `provider.cursor.apiKey` (Cursor adapter / detection,
   `isCursorApiKeyConfigured`, `agent:getConfig`) reads the secret instead.
   Find them with `ptah_lsp_references` / grep before changing.
3. Migration: the VS Code extension, Electron desktop app and headless CLI each
   own registration in their composition root / settings bootstrap. Run once at
   backend startup in each runtime; keep it idempotent. If a secret already
   exists, keep it and still delete the plain setting; copy the plain value to
   the secret store only when no secret exists. Never log the value.
4. Tests: write → secret store only (settings file untouched); migration moves
   and deletes; readers work from the secret; no logger call contains the key.
   Keep #581's regression test for the exact `agent:setConfig` log call (field
   names only). Acceptance covers startup migration through each runtime's
   registration path and an idempotent repeat run.

## Process

BUGFIX. Write-path trace required (key, scope, reader). Cross-family review.
