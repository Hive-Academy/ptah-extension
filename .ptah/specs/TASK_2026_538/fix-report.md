# TASK_2026_538 — fix report

The Cursor API key no longer lives in the plain `ptah.provider.cursor.apiKey` setting
(`~/.ptah/settings.json`). It lives in the secrets store under `ptah.auth.provider.cursor`, like
every other provider key.

## Write-path trace

| Step | Key | Store | Code |
| --- | --- | --- | --- |
| UI saves a key | `cursorApiKey` (RPC param) | — | `libs/frontend/core/src/lib/services/providers-settings-state.service.ts:361` |
| `agent:setConfig` validates | non-string → `Unsupported cursorApiKey value` | — | `agent-rpc.handlers.ts:273-277` |
| Non-blank value | trimmed | secrets `ptah.auth.provider.cursor` via `setProviderKey('cursor')` | `agent-rpc.handlers.ts:319-323` |
| Blank value | — | `deleteProviderKey('cursor')` | `agent-rpc.handlers.ts:325` |
| After either write | `provider.cursor.apiKey` | plain setting removed (`undefined`) | `agent-rpc.handlers.ts:332-336` |
| Log line | field names only (#581 regression test kept) | — | `agent-rpc.handlers.ts:268` |

A secrets-store failure returns `Failed to update the Cursor API key` and leaves the plain setting
alone, so no key is lost.

## Readers

| Reader | Source | Code |
| --- | --- | --- |
| `agent:getConfig` → `cursorApiKeyConfigured` | env `CURSOR_API_KEY` or `hasProviderKey('cursor')` | `agent-rpc.handlers.ts:200`, `:1050-1055` |
| Cursor adapter (`runSdk`, `detect`) | env `CURSOR_API_KEY`, then the injected resolver | `cursor-cli.adapter.ts:186-200` |
| Resolver | `authSecrets.getProviderKey('cursor')` | `cli-detection.service.ts:68` |

The adapter no longer reads `~/.ptah/settings.json`. The raw key never goes back to the UI.

## Startup migration

`migrateCursorApiKeyToSecrets` (`libs/backend/rpc-handlers/src/lib/migrations/cursor-api-key-migration.ts`):

- No value or `''` → `none`, nothing written.
- Non-blank string and no secret → copy the trimmed value to the secret (`migrated`), then remove
  the plain setting.
- Secret already present, or a non-string/blank value → remove the plain setting only (`cleared`).
- Idempotent: a second run sees no plain value and returns `none`.

`runCursorApiKeyMigration(container)` wraps it, never throws, and logs only the outcome or the
error type. A failure keeps the plain setting, so the next start retries. It runs right after the
settings migrations in:

- VS Code: `apps/ptah-extension-vscode/src/activation/bootstrap.ts`
- Electron: `apps/ptah-electron/src/activation/bootstrap.ts`
- CLI (full mode only): `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts`

It runs before RPC handlers and windows exist, so a `setConfig` call cannot race it.

## Tests

- `agent-rpc.handlers.set-config.spec.ts`: write goes to the secret only, blank deletes, plain
  setting removed, secret failure keeps the plain value, no logger call contains the key.
- `cursor-api-key-migration.spec.ts`, `run-cursor-api-key-migration.spec.ts`: move, keep an
  existing secret, junk values, repeat run, failure path.
- `cursor-cli.adapter.spec.ts`, `cli-detection.service.spec.ts`: env → resolver order, no disk read.
- `bootstrap.cursor-key.spec.ts` (VS Code, Electron) and `with-engine.spec.ts`: each runtime calls
  the migration after the settings migrations (CLI: full mode only).

The Cursor CLI is not installed on this machine, so there is no live end-to-end run.

## Reviews

| Batch | Author | Reviewer | Result |
| --- | --- | --- | --- |
| A (rpc-handlers, shared) | Codex lane | in-process code-logic-reviewer | REVISE → fixed in `fd3543aa5` → round 2 PASS (`code-logic-review-round2.md`) |
| B (cli-agent-runtime) | GLM lane | in-process code-logic-reviewer | PASS |
| C (composition roots) | in-process | Antigravity lane | PASS |

## Follow-ups (not in scope)

- Cursor `runTurn` SDK error text could carry the key (pre-existing, found in the Batch B review).
- The UI read-back compares `cursorApiKeyConfigured` with the saved value. With `CURSOR_API_KEY`
  set, clearing the stored key still reads back `true`.
- `PtahFileSettingsManager.persist` logs and swallows write errors for every key (PR 585 comment
  4090516481). A failed removal of the plain Cursor value is retried by the next startup
  migration. A rethrow would change every settings writer, so it needs its own task.
