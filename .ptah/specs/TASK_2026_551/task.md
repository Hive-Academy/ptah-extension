---
id: TASK_2026_551
status: backlog
type: BUGFIX
title: 'Cursor key: keep it out of SDK error text and report the stored key truthfully'
depends_on: []
created: "2026-09-24T08:26:07.000Z"
updated: "2026-09-24T08:26:07.000Z"
description: "Follow-up from TASK_2026_538. The Cursor SDK error path can surface text that carries the API key, and the settings read-back reports 'configured' from CURSOR_API_KEY even after the stored key is cleared."
executor: backend-developer
estimate: S
labels:
  - security
  - cursor
  - providers-settings
  - priority-high
---

# TASK_2026_551 — Cursor key: SDK error text and read-back

Priority: **high** (item 1 is a credential leak path).

## Why

TASK_2026_538 (PR #585) moved the Cursor API key into the secrets store. Two gaps stay open.

1. **SDK error text.** `runTurn` in
   `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts:378-390`
   logs `error.message` at error level and emits `summarizeCliSdkError(error, 'Cursor')` to the
   lane output and the UI. The adapter passes the key to the SDK (`agentOptions.apiKey`). An SDK
   or HTTP error that echoes the request (an auth failure message or a request dump) puts the key
   in the log and in the chat. Found in the Batch B review of TASK_2026_538.
2. **Read-back with `CURSOR_API_KEY` set.** `agent:getConfig` reports
   `cursorApiKeyConfigured = env CURSOR_API_KEY || hasProviderKey('cursor')`
   (`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1050-1055`). The UI
   read-back (`libs/frontend/core/src/lib/services/providers-settings-state.service.ts:361-362`)
   expects `cursorApiKeyConfigured === !!apiKey.trim()`. With the env var set, clearing the stored
   key reads back `true`, so the UI reports a failed save for a save that worked.

## Scope

1. Redact the key from every Cursor error path before it reaches a logger, `output` or
   `segment`: replace each occurrence of the resolved key with a fixed marker. Cover `runTurn`,
   the `run.cancel()` path (`:430-436`) and `detect`. Decide with evidence whether one adapter
   helper is enough or `summarizeCliSdkError` (`cli-adapter.utils.ts`) should take a list of
   secrets for every adapter.
2. Report the two sources separately: add `cursorApiKeyStored` (secret present) next to
   `cursorApiKeyConfigured` in the `agent:getConfig` result type
   (`libs/shared/src/lib/types/rpc/rpc-agents.types.ts`), and make the UI read-back compare
   against `cursorApiKeyStored`. Show a note in the Cursor card when `CURSOR_API_KEY` is set,
   because the env var wins over the stored key.

## Acceptance

- A spec makes the SDK mock throw an error whose message contains the key during `runTurn`. No
  logger call, `output` chunk or `segment` contains it.
- A spec makes `run.cancel()` reject with an error whose message contains the key. The logged
  error and the rethrown error carry the redaction marker, not the key.
- A spec makes the key resolution in `detect` fail with the key in the error. No logger call
  contains it.
- With `CURSOR_API_KEY` set, saving and then clearing the stored key both read back as success.
- `fix-report.md` carries the write-path trace (key → store → reader), as in TASK_2026_538.

## Process

BUGFIX, Partial. Cross-side review. Verify `cli-agent-runtime`, `rpc-handlers`, `shared`, `core`,
`chat`, and typecheck `ptah-extension-webview`.
