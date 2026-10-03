# Batch 45b report — web search host-text fix (TASK_2026_555)

Author: Search & Voice owner (frontend-developer, in-process, same side as the code author).
No build, Playwright, screenshots, git writes or `batches.md` edits.

## Change

`libs/frontend/chat/src/lib/settings/ptah-ai/web-search-config.component.ts` (626 lines)

- `errorText()` and `SAVE_CONFIG_FALLBACK` removed. No `error.message`, `result.error` or backend
  `error` field reaches the inline alert, the key popover error, a row status or the toast.
- One fixed sentence per action (:67-74):

| Action | Sentence |
|---|---|
| `webSearch:getConfig` | "Could not load the web search settings." |
| `webSearch:setConfig` (providers, incl. Undo) | "Could not save the web search providers." |
| `webSearch:setConfig` (max results, incl. Undo) | "Could not save the web search max results." |
| `webSearch:setApiKey` | "Could not save the {Provider} API key." |
| `webSearch:deleteApiKey` | "Could not clear the {Provider} API key." |
| `webSearch:test` (whole call) and each failed provider row | "The connection check failed." |

- Test connection: the per-provider `error` is not a fixed probe reason. The backend builds it from
  `result.reason.message` / `String(result.reason)` (`libs/backend/rpc-handlers/src/lib/handlers/web-search-rpc.handlers.ts:202-207`),
  so the row now shows the fixed "The connection check failed." (template :183) rather than
  `r.error`.
- The RPC failure, `{ success:false, error }` and a thrown Error all map to the same sentence.

## Spec

`web-search-config.component.spec.ts`: 18 → 36 tests.

- Updated seven assertions that expected host text (load alert, provider-save toast + alert,
  key-save popover error + toast, clear alert + toast, failed test row, max-results toast) to the
  fixed sentences. The test-row case also asserts "Unauthorized" is not rendered.
- New `describe('fixed failure sentences (F1)')` (+18): `HOST_FAILURES` = RPC failure,
  `{ success:false, error:'host detail' }`, thrown `Error('host detail')` × config load, provider
  save, max-results save, key save, key clear (15); whole connection check × RPC failure / thrown
  Error (2; its success payload has no `success:false` failure shape); one failed provider row
  carrying `error:'host detail'` (1). Each asserts the exact sentence where it is shown and that
  "host detail" appears in neither the DOM nor the toast.

## Verification

- `npx jest -c libs/frontend/chat/jest.config.ts --maxWorkers=2 libs/frontend/chat/src/lib/settings/ptah-ai/web-search-config`
  → 1 suite passed, 36 tests passed.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=2` → "Successfully ran
  targets typecheck, lint"; no warning or error lines.

## Host-text scan

Scan only, nothing fixed. Scope: every non-spec file under `libs/frontend/chat/src/lib/settings/`.
Patterns: `errorText`-style helpers, `error.message` / `${error...}`, `result.error`,
`data.error` / `data?.error`, `instanceof Error`, and signals or toast messages that carry them.
Each hit was traced to its template. The accepted output-style parse-error lines
(`output-style-editor.component.ts:115`, `output-style-list.component.ts:401`) are excluded.

### Visible host text (outside Batch 44)

| File:line | Path to the user | Visible |
|---|---|---|
| `advanced-settings.component.ts:221`, `:234` | `result.error` → `importOutcome.message` → template :131 | Yes |
| `advanced-settings.component.ts:242-243` | `` `Import failed: ${error.message}` `` → template :131 | Yes |
| `license/license-status-card.component.ts:597-599` | `result.data.error` / `result.error` → `licenseKeyError` → template :221 | Yes |
| `license/license-status-card.component.ts:604-605` | `` `Failed to verify membership key: ${error.message}` `` → :221 | Yes |
| `license/license-status-card.component.ts:638-640` | `result.data.error` / `result.error` → `logoutError` → template :404 | Yes |
| `license/license-status-card.component.ts:645-646` | `` `Log out failed: ${error.message}` `` → :404 | Yes |
| `ptah-ai/agent-orchestration-config.component.ts:404` | `result.error` → `agentConfigError` → template :77 | Yes |
| `ptah-ai/agent-orchestration-config.component.ts:617` | `result.error` → `agentConfigError` → :77 | Yes |
| `output-style/output-style.store.ts:127` | `parityOutcome.error.message` → `parityWarning` → `output-style-parity-section.component.ts:163` | Yes, if the backend parity `error.message` is not fixed (not verified here) |
| `output-style/output-style.store.ts:228-233` (`failureMessage` :348) | `operationError.message ?? result.error` → returned to editor; `FILE_EXISTS` / `STALE_FILE` → `conflict` → `output-style-editor.component.ts:153` `{{ pending.message }}` | Yes for those two codes; the store's own comment (:340-342) says backend messages are path-relative, not raw exceptions (not verified here) |

### Present but not visible

| File:line | Why not visible |
|---|---|
| `output-style/output-style.store.ts:145`, `:190-196`, `:252-258`, `:277` | Set `store.error`, which the list renders only through `fixedErrorMessage` (`output-style-list.component.ts:509-516`, template :112) |
| `output-style/output-style-editor.component.ts` save path (:568-580) | Non-conflict failures show the fixed `OUTPUT_STYLE_SAVE_FAILED` |
| `pro-features/system-prompt-drawer.component.ts:394` | `result.data.error` only compared to `DOWNLOAD_CANCELLED_BY_USER` |
| `providers/main-agent-reassign-popover.component.ts:334` | `result.error` used only as a boolean |
| `providers/provider-setup-wizard.component.ts:2116`, `:2185`; `providers/providers-settings.component.ts:445`, `:590` | `error.constructor.name` for logging only |
| `ptah-ai/cli-matrix-rows.ts:217` | `lastTest.reason` carried in the row model; no template reads it |
| `providers/*` `commit.message`, `externalAuth.message`, `outcome.message` (`advanced-tab.component.ts:227-228`, `credentials-tab.component.ts:282`, `:399-400`, `providers-settings.component.ts:179`, `:189`, `:276`, `:337`; `ptah-ai/orchestration-settings.component.ts:62`; `feedback/settings-save-feedback.service.ts:106`) | Visible, but the source is fixed copy: `core/.../providers-commit.service.ts:390` and `providers-connection-setup.service.ts:121`, `:334` keep RPC text out of state |
| `providers/connection-drawer/{advanced,credentials,overview}-tab` probe `reason` | Mapped through fixed `PROBE_FAILURE_COPY` / `CHECK_FAILURE_COPY` |
| `ptah-ai/agent-orchestration-config.component.ts:521`, `:559` (`copilotAutoApproveError`) | Fixed sentences |
| `ptah-ai/elevenlabs-panel`, `local-tts-panel`, `local-stt-panel`, `go-vet-consent-config`, `voice-config`, `web-search-config` | Fixed constants (F1), after the Batch 48 fixes and this batch |
| `providers/routing-map*.ts` `errorText` | An `input()` with fixed strings, not a host-text helper |

### Batch 44 files (handled in Batch 44)

| File:line | Path to the user | Visible |
|---|---|---|
| `pro-features/mcp-port-config.component.ts:251-253` | `result.data?.error ?? result.error` → `validationError` → template :75 | Yes |
| `pro-features/browser-settings.component.ts` | No hit | — |
| `pro-features/vscode-lm-config.component.ts` | No hit | — |
