---
status: planned
type: bugfix
title: 'Security: move the Cursor API key out of plain settings into the secrets store'
depends_on: []
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
in TASK_2026_534 (PR #581), which only stopped the logging.

## Scope
1. Write: `agent:setConfig { cursorApiKey }` stores via
   `AuthSecretsService.setProviderKey('cursor', …)`; empty string deletes.
2. Read: every reader of `provider.cursor.apiKey` (Cursor adapter / detection,
   `isCursorApiKeyConfigured`, `agent:getConfig`) reads the secret instead.
   Find them with `ptah_lsp_references` / grep before changing.
3. Migration (one-shot, idempotent, all three runtimes): if the plain setting
   holds a value and no secret exists, move it to the secret store, then delete
   the plain setting. Never log the value.
4. Tests: write → secret store only (settings file untouched); migration moves
   and deletes; readers work from the secret; no logger call contains the key.

## Process
BUGFIX. Write-path trace required (key, scope, reader). Cross-family review.
