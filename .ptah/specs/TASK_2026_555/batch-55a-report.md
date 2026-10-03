# Batch 55a report: backend fixes from the final reviews

Sources: `final-code-logic-review.md` (S-1, M-1 to M-6) and `final-code-style-review.md` (CS-8).
Worktree `feat/task-555-settings-redesign`. No commits. No frontend, webview, harness or dist files touched.

## S-1 (Serious): key text in the logger or Sentry from Ptah CLI and agent:setConfig catches

**Change**
- `libs/backend/rpc-handlers/src/lib/handlers/ptah-cli-rpc.handlers.ts:341` adds a new private `reportFailure(method, source, error)`. It logs `RPC: <method> failed` with `{ errorType }` only, and it sends Sentry a fixed `new Error('<method> failed (<errorType>)')`. This is the same rule as `keyStoreReadFailure` in the auth handlers. All six catches now call it and are typed `catch (error: unknown)`: list `:114`, create `:148`, update `:198`, delete `:225`, testConnection `:257`, listModels `:325`. The RPC results keep their fixed text. `ptahCli:list` still rethrows, as it did before.
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:398`: the outer catch of `agent:setConfig` now logs `{ errorType }` and never the Error object. This handler has no Sentry capture.

**Specs**
- `ptah-cli-rpc.handlers.spec.ts`: new block "a thrown error carrying the key never reaches the logger or Sentry (final review S-1)". It runs once for each of the six methods. It serialises every logger call and Sentry call, including Error message and stack, and asserts that neither the key nor the thrown text appears. The existing Batch 12b test now asserts the Sentry message `<method> failed (Error)`.
- `agent-rpc.handlers.set-config.spec.ts`: new test "a thrown error carrying the Cursor key never reaches the logger (final review S-1)". The two existing assertions that expected the raw Error now expect `{ errorType: 'Error' }`.

**UI contract**: unchanged.

## M-1: a second Check joined an in-flight check for an old key

**Change**
- `libs/backend/rpc-handlers/src/lib/utils/connection-check-recorder.ts:60` adds `isCurrent(ticket)`. It is true while `complete` would still store this ticket, meaning no later check and no `clear` has been recorded for the connection. `complete` (`:51`) now uses it.
- `libs/backend/rpc-handlers/src/lib/handlers/connection-check.ts:116`: `check()` now takes the ticket before it starts `run`, and the in-flight map holds `{ ticket, result }`. A new caller joins the running check only if `recorder.isCurrent(running.ticket)`. After a key replace or delete, `recorder.clear` makes the old ticket stale, so a fresh check starts and records its own result. A double click with no key change still joins: one provider request.
- The map is keyed by a generation (the recorder sequence), not by key text. No key material is held.

**Specs**
- `connection-check.spec.ts`: "a check started after the key was replaced does not join the old check and records its own result (final review M-1)". It shows two requests, the new result recorded even though the old check finishes last, and later callers still joining the new check. A second new test: "a check started after the key was deleted records a fresh result, not the pre-delete verdict".
- `connection-check-recorder.spec.ts`: "isCurrent turns false for a ticket taken before a clear (final review M-1)".

**UI contract**: unchanged.

## M-2: Cursor stream text emitted unredacted

**Change**
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts`: the stream loop (`:414`) now passes `emitStreamOutput` and `emitStreamSegment` to `handleMessage`. These wrap the buffered emitters with `redactSecrets(…, secretRedactions)`. Every text that `handleMessage` emits goes through them: status ERROR and info, thinking, task, tool-call, tool-result and tool-result-error, assistant text, and the model line.
- New module function `redactSegment` (`:165`) redacts a segment's `content`, `toolArgs` and the raw `toolInput`. `toolInput` is round-tripped through JSON only when its JSON contains a secret. An input that cannot be serialised is dropped rather than emitted unchecked.

**Spec**: `cursor-cli.adapter.spec.ts` adds "streamed status ERROR, thinking, tool-call and tool-result text never carries the key (final review M-2)". It covers output plus segments, the exact redacted error segment, and the redacted `toolInput`.

**Known limit**: assistant text is redacted per emitted delta. If the SDK splits a key across two text deltas, the partial pieces are not matched. Every other path emits whole messages.

**UI contract**: unchanged.

## M-3: Cursor key stored, legacy clear throws, UI says "The key was not saved"

**Change**
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:427` adds a new private `writeCursorApiKey(value)`, called from `:330`.
  - **Store (non-blank)**: the secret is written first; a failure returns the existing `'Failed to update the Cursor API key'`. Clearing the legacy plain `provider.cursor.apiKey` afterwards is now best-effort. On failure it logs a warning with `{ errorType }` and continues, so the result is `{ success: true }`. This is accurate because the stored key wins on every read, and the startup migration clears a legacy copy that sits beside a stored key (the `cleared` path).
  - **Delete (blank)**: the legacy copy is cleared first. Otherwise the startup migration would re-import it into the empty store, so the delete would quietly undo itself. If that clear fails, nothing is removed and the result is `{ success: false, error: 'Could not remove the Cursor API key.' }`. If the secret delete then fails, the result is the existing `'Failed to update the Cursor API key'`, and the key is still stored.
- Other fields later in the same request keep running after a best-effort legacy-clear failure.

**Specs** (`agent-rpc.handlers.set-config.spec.ts`)
- "a stored key is reported saved even when the legacy plain copy cannot be cleared (final review M-3)"
- "a delete whose legacy plain copy cannot be cleared removes nothing and says so (final review M-3)"
- The old `it.each` test is split in two. A delete whose secret delete fails now has its plain copy cleared, because the clear happens first.

**UI contract (for the frontend owner)**: the shape `{ success: boolean; error?: string }` is unchanged.
- `success: true` now means the key is in the secret store, including when the legacy copy could not be cleared. Keep the current read-back and "saved" path.
- `success: false` with `'Could not remove the Cursor API key.'` is new and only occurs on a blank-key (remove) request. The truthful UI text is "The key was not removed." Today the client shows "The key was not saved." for any `!success`. For a remove, it should say "not removed". The state is unchanged in this case, so the read-back stays as it was.

## M-4: parseAgyModels accepted any tab-less line

**Status: DONE.** Revised in the orchestrator follow-up so older agy versions keep working; the first version's id-shape rule is gone.

**Change**: `parseAgyModels` in `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts` handles two formats.
- **New format (any stdout line contains a tab):** only `id<TAB>name` lines are read. Every other line is ignored: status, progress, error lines, and stray labels.
- **Old format (no tab anywhere):** each non-empty line is a model (id = name = the label) unless it is a status or error line. A line counts as one when it:
  - ends in `...`, `…` or `:` (`AGY_STATUS_LINE_END`), or
  - starts with a status/error word matching `/^(error|warning|fetching|loading|usage|failed)\b/i` (`AGY_STATUS_LINE_START`).
- The spawn still passes only the id (`agyModelId`, unchanged).

**Specs** (`antigravity-cli.adapter.spec.ts`, `listModels()`)
- "old format: one spaced label per line still lists models": the original legacy-label case, restored.
- "old format: status and error lines on stdout are ignored (final review M-4)": `Fetching available models...`, `Error: not signed in`, `warning: …`, `Loading models`, `Loading…`, `Usage limit reached`, `Failed to refresh token` and `Models:` are all ignored, and only the label is listed.
- "an error-only stdout yields no models".
- "new format: when any line has a tab, only tab lines are models (final review M-4)": a stray spaced label and a note line next to tab lines are ignored.
- The existing "agy 1.2 format: skips the status line…" spec is unchanged and passes.

**Remaining limit**: in the old format, a status line that starts with none of the listed words and does not end in `...`/`…`/`:` is still listed as a model, for example "Please sign in".

## M-5: removing the main agent's custom connection

**Change**
- `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:831-847`: `provider:removeCustomEntry` now refuses before any write when the entry id equals the current `anthropicProviderId` (`resolveProviderId()`). It throws `RpcUserError('This connection runs the main agent. Switch the main agent to another connection before removing it.', 'CONNECTION_IN_USE')`. When it refuses, nothing is removed: the entry, the secret and the check record all stay.
- `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts:23` adds `'CONNECTION_IN_USE'` to `RpcUserErrorCode`. This is additive, and no exhaustive map over the union exists (grepped `libs`, `apps`).

**Spec**: `provider-rpc.custom-entries.spec.ts` adds "refuses to remove the main agent current connection with CONNECTION_IN_USE and changes nothing (final review M-5)". The suite's ConfigManager stub now answers `getWithDefault('anthropicProviderId')`.

**UI contract (for the frontend owner)**: the RPC fails with `success: false`, `errorCode: 'CONNECTION_IN_USE'` and the fixed `error` text above, which contains no host or id text. Map the code to the existing "Switch the main agent first" message and keep the connection listed. The client-side check can stay as UX.

## M-6: one unreadable key failed the whole auth:getApiKeyStatus list

**Change**
- `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts:1523-1560`: each provider's key is now read with `Promise.allSettled`.
  - An unreadable provider is listed as `{ provider, displayName, isDefault, hasApiKey: false, keyUnreadable: true }`, with no `keyHint`.
  - A partial failure logs one warning with provider ids and error types only.
  - Only when every read fails does the call throw the existing `keyStoreReadFailure`: `'Could not read the stored keys.'` with `PERSISTENCE_UNAVAILABLE`.
- `libs/shared/src/lib/types/rpc/rpc-auth.types.ts:613` adds `keyUnreadable?: true` to `AuthApiKeyStatusEntry`, and the result's doc comment is updated.

**Specs** (`auth-rpc.handlers.key-hint.spec.ts`)
- "one unreadable key marks only its entry; the other providers still load (final review M-6)". It asserts that no store text, path or key reaches the response, the logs or Sentry.
- The old single-failure test becomes "when no key can be read it is a fixed error…", with every read rejecting.

**UI contract (for the frontend owner)**:
- `auth:getApiKeyStatus` can now succeed with some entries carrying `keyUnreadable: true`. For those entries, `hasApiKey: false` means "unknown", not "no key". Show a per-row fixed state, for example "Could not read the stored key." with a retry, rather than "Not set".
- The whole-section error "Could not read the stored keys." now only happens when no key at all can be read.

## CS-8: bare `catch (error)` added by this branch

`git diff origin/main...HEAD` (non-spec backend and bootstrap code) shows three such catches. All are now `: unknown`:
- `apps/ptah-electron/src/activation/bootstrap.ts:78` (`loadError`)
- `apps/ptah-extension-vscode/src/activation/bootstrap.ts:67` (`loadError`)
- `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts:1444` (`auth:deleteStoredKey`)

No `closeError` catch exists in the current files. Every catch added in this batch is typed `unknown`.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers @ptah-extension/cli-agent-runtime @ptah-extension/shared @ptah-extension/vscode-core @ptah-extension/platform-core ptah-extension-vscode ptah-electron ptah-cli --parallel=2` passed: "Successfully ran targets typecheck, lint for 8 projects".
- Same projects with `-t test --parallel=2 -- --maxWorkers=2`: 48 of 49 tasks succeeded.
  - The one failure is `@ptah-extension/rpc-handlers:test`: 131 of 132 suites and 3762 tests passed, with 1 failure, `HarnessSkillSelectionRpcService › harness:get-skill-selection › never writes state.json`.
  - That is the known `%TEMP%\.ptah` environment failure, which the brief says to ignore. The folder was not touched.
- Prettier was run on every changed file.

## Follow-up 2: auth:deleteStoredKey logging (orchestrator review)

**Status: DONE.**

**Change**: the outer catch of `auth:deleteStoredKey` (`libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts:1444-1451`) now logs `RPC: auth:deleteStoredKey failed` with `{ errorType }` only. It captures a fixed `new Error('auth:deleteStoredKey failed (<errorType>)')` in Sentry, which is the S-1 rule. The secret-store call already had its own inner catch (`:1423-1431`) that logs fixed text and returns fixed text without Sentry. That path is unchanged and is now covered by a spec.

**Specs**: `auth-rpc.handlers.delete-stored-key.spec.ts` adds the block "error text carrying a key never reaches the logger or Sentry (batch 55a follow-up)".
- "a secret-store rejection is logged with fixed text and not sent to Sentry" covers the inner catch.
- "any other unexpected throw is logged and captured by error type only" covers the outer catch, triggered by a throw at the handler's first statement.
- Both serialise every logger call and Sentry call and assert that neither the key nor the thrown text appears.

**UI contract**: unchanged.

## Status per item

| Item | Status |
| --- | --- |
| S-1 | DONE |
| M-1 | DONE |
| M-2 | DONE (known limit: a key split across two assistant text deltas) |
| M-3 | DONE (frontend wording for "not removed" left to the UI owner) |
| M-4 | DONE (revised in follow-up 1: old format supported) |
| M-5 | DONE (UI must map `CONNECTION_IN_USE`) |
| M-6 | DONE (UI must render `keyUnreadable` rows) |
| CS-8 | DONE |
| Follow-up 1 (M-4 old agy format) | DONE |
| Follow-up 2 (`auth:deleteStoredKey` logging) | DONE |
| `ptahCli:list` raw rethrow | NOT DONE, by decision (dispatcher follow-up 1) |

## Verification after the follow-ups

- `npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers @ptah-extension/cli-agent-runtime --parallel=2` passed: "Successfully ran targets typecheck, lint for 2 projects".
- `npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/cli-agent-runtime --parallel=2 -- --maxWorkers=2`:
  - cli-agent-runtime passed. Its run came from the cache for the current inputs; the same inputs ran and passed earlier in the follow-up.
  - rpc-handlers: 131 of 132 suites and 3764 tests passed, 4 skipped, 1 failed. The failure is the known `HarnessSkillSelectionRpcService … never writes state.json` environment case (`%TEMP%\.ptah`), which the brief says to ignore; the folder was not touched.
- Note: passing `-- --maxWorkers=2` to a combined `typecheck,lint,test` run forwards the flag to `tsc`, which fails with TS5023. So typecheck/lint and test were run as separate commands.
- The other six projects (`shared`, `vscode-core`, `platform-core`, `ptah-extension-vscode`, `ptah-electron`, `ptah-cli`) were verified in the first pass. Neither follow-up touched them.

## Out-of-scope observations

- `ptahCli:list` rethrows the raw error to the RPC layer. This is unchanged, by dispatcher decision.
