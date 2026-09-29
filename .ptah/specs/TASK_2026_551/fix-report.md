# TASK_2026_551 — Fix report

Status: backend half complete (Batch 3 of TASK_2026_555). The UI read-back half
(`cursorApiKeyStored` / `cursorApiKeyEnvSet`) is Batch 5 and Batch 8; this
report gains that evidence when they land.

## 1. Key → store → reader trace

| Step | Where (file:line) | What happens |
| --- | --- | --- |
| Write | `agent-rpc.handlers.ts:319-338` (`agent:setConfig`) | `params.cursorApiKey` is trimmed; a non-empty value calls `authSecrets.setProviderKey('cursor', value)`, an empty string calls `deleteProviderKey('cursor')`. The log line (`:334`) records the field name `provider.cursor.apiKey` only — never the value. |
| Store | `AuthSecretsService` provider secret `cursor` | The key lives in the platform secrets store (TASK_2026_538). No file on disk is read for it. |
| Read-back | `agent-rpc.handlers.ts:1050-1055` (`agent:getConfig` → `isCursorApiKeyConfigured`) | `cursorApiKeyConfigured = env CURSOR_API_KEY || hasProviderKey('cursor')`. This is the conflation 551 fixes: Batch 5 adds `cursorApiKeyStored` (secret present) and `cursorApiKeyEnvSet` (env non-empty) so the UI can read back against the store alone. |
| Reader at spawn | `cursor-cli.adapter.ts:187-202` (`resolveCursorApiKey`) | Env `CURSOR_API_KEY` first (trimmed), then the injected resolver (wired by CliDetectionService to `getProviderKey('cursor')`). A resolver failure is the "not configured" state and logs a fixed text with no error detail (`:196-199`). |

## 2. Redaction evidence (Batch 3)

### Helper (`sdk-error-summary.ts`)

- `redactSecrets(text, secrets)`: literal-value replacement with the fixed
  marker `[REDACTED]`, via string splitting — no regex, so a `key_…`-shaped
  secret or one containing regex metacharacters is replaced exactly. Blank
  secrets are skipped.
- `summarizeCliSdkError(error, vendor, secrets = [])`: the optional third
  parameter defaults to `[]`, so the Codex call site
  (`codex-cli.adapter.ts:773`) is untouched and its behaviour is unchanged
  (pinned by `sdk-error-summary.spec.ts` "leaves a two-argument call
  untouched"). Redaction runs on the raw text before the headline is cut, so
  the marker survives the 500-character cap.

### Adapter (`cursor-cli.adapter.ts`)

- `runTurn` catch (`sdk-error-summary` + log): the resolved key is captured in
  the `runSdk` scope (`secretRedactions`, set by the turn that resolved the
  key). The log `detail` and the streamed summary both receive the redacted
  text.
- `interrupt()` catch: the log detail and the rethrown error both carry the
  redacted text. The rethrow is now always a fresh `Error` with the redacted
  message, which also keeps the leaked text out of the error's stack
  (the original stack embeds the original message).
- `detect()` / `listModels()` catch paths: unchanged — they log nothing on
  failure (`:196-199` fixed debug line; `listModels` returns the curated
  fallback). Pinned by specs.

### Spec evidence

`cursor-cli.adapter.spec.ts` — describe "Cursor API key redaction (551)":

1. `runTurn` rejection: the SDK mock rejects with the key in the message; no
   logger argument, output chunk or segment contains the key, and all carry
   `[REDACTED]`.
2. `run.cancel()` rejection: the logged detail and the rethrown error message
   carry `[REDACTED]`, not the key.
3. `detect` resolver failure with the key in the error: no logger call
   contains the key.
4. `listModels` failure with the key in the error: no logger call contains
   the key (the fixed fallback list is returned).

`sdk-error-summary.spec.ts` — describe blocks "redactSecrets" and
"summarizeCliSdkError — secret redaction (551)": literal replacement, multiple
secrets, blank-secret tolerance, regex-metacharacter safety, redaction before
the headline cap, usage-limit wording preserved, two-argument Codex call
untouched.

## 3. UI read-back half

Pending Batch 5 (`cursorApiKeyStored` / `cursorApiKeyEnvSet` in
`agent:getConfig`) and Batch 8 (UI read-back compares against
`cursorApiKeyStored`; env-precedence note). Evidence is appended here when
those batches land.