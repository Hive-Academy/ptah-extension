# Code Logic Review — Cross-side review of Codex lane, TASK_2026_538 Batch A

Commit under review: `ed7c4ce7da6ddefc45ffb043e7ca5e9b68ae8012`
Scope: `agent:setConfig` write/delete, `agent:getConfig` `cursorApiKeyConfigured`, `migrateCursorApiKeyToSecrets`.

## Verdict

**REVISE.** The write path itself (set/delete/migrate/plain-removal) is correct and the trace in
`batch-a-report.md` matches the code. But `migrateCursorApiKeyToSecrets` has an unguarded
check-then-act race against a concurrent `agent:setConfig` call that can silently overwrite a
freshly entered key with a stale legacy value (Finding 1), and the catch-all in `agent:setConfig`
suppresses error detail and the error object for any failure once `cursorApiKey` is present in the
request, not just failures that could carry the secret (Finding 2). Neither is a five-minute fix,
but both are logic defects in the code as committed, not style nitpicks.

## Findings

1. **[MAJOR] Startup migration can silently clobber a key the user just set, with no error to
   anyone.**
   - File: `libs/backend/rpc-handlers/src/lib/migrations/cursor-api-key-migration.ts:16-24`
   - Scenario: at startup, `migrateCursorApiKeyToSecrets` reads the legacy plain value, then
     `await secrets.hasProviderKey('cursor')` (line 18). If this resolves `false` (no secret yet),
     it proceeds to `await secrets.setProviderKey('cursor', legacyValue.trim())` (line 21). There is
     no lock between the `hasProviderKey` check and the `setProviderKey` write. If a user opens the
     agent settings UI in the same startup window and calls `agent:setConfig({ cursorApiKey: 'new-key' })`
     (`agent-rpc.handlers.ts:319-330`), and that call's `authSecrets.setProviderKey('cursor', 'new-key')`
     resolves *before* the migration's `setProviderKey` call resolves, the migration's write wins:
     the secret store ends up holding the **old, stale legacy key**, not the one the user just typed.
     Both call sites report success (`{success: true}` from setConfig; `'migrated'` from the
     migration) — there is no signal to the user or the log that a collision occurred.
   - Symptom: the user believes they rotated the Cursor key; the CLI adapter (once Batch B lands)
     silently authenticates with the old key instead.
   - Current handling: none — no mutex, no re-check of `hasProviderKey` immediately before the
     write, no ordering guarantee between the migration step and RPC handler.
   - Recommendation: either have the migration take an exclusive lock/mutex shared with
     `agent:setConfig`'s cursor-key branch (e.g. a promise-chained gate in `AuthSecretsService`), or
     make the migration idempotent-safe by re-checking `hasProviderKey('cursor')` immediately before
     the write inside a single critical section, or simply document/enforce that
     `migrateCursorApiKeyToSecrets` must complete and be awaited before the RPC surface (including
     `agent:setConfig`) is registered — which Batch C's wiring should be told to guarantee explicitly,
     since Batch A exports the function with no such contract stated in its doc comment
     (`cursor-api-key-migration.ts:5`).
   - Note: `context.md` line 22 says migration runs "after `runMigrations()`" in each bootstrap, and
     RPC handlers are presumably registered after bootstrap completes in each runtime — if that
     ordering is strictly enforced end-to-end in Batch C, this race cannot occur. But Batch A's own
     code and doc comment give no ordering guarantee, and the exported function is a public API
     (`libs/backend/rpc-handlers/src/index.ts:93`) that any future caller could invoke concurrently
     with live traffic. The defect is real at the unit the review is scoped to (Batch A), even though
     it is only exploitable depending on how Batch C sequences things.

2. **[MODERATE] The generic-error catch after a failed `cursorApiKey` write suppresses detail
   (and drops the `Error` object entirely) for unrelated failures too, not just secret-store
   failures.**
   - File: `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:392-397`
   - Scenario: `if (params?.cursorApiKey !== undefined) { this.logger.error('RPC: agent:setConfig failed'); return { success:false, error:'Failed to update agent configuration' }; }` fires for *any* exception thrown anywhere in the try block as long as the request included `cursorApiKey`, including exceptions from fields processed **after** the cursor-key block (`copilotAutoApprove`, `mcpPort`, `disabledClis`, `browserAllowLocalhost`, `workflowsDisabled`, lines 333-389) which cannot possibly carry the credential. A single combined request such as
     `{ cursorApiKey: 'sk-...', mcpPort: NaN }` (or any other field whose write throws) now reports
     the same opaque `'Failed to update agent configuration'` and logs `logger.error('RPC: agent:setConfig failed')` **with no `Error` argument at all** — contrast with the non-cursor branch at
     line 398-403, which still passes `error instanceof Error ? error : new Error(errorMessage)` to
     the logger. This is a real loss of diagnosability for failures that have nothing to do with the
     secret.
   - Symptom: on-call/debugging loses the actual error message and stack for any co-occurring
     failure whenever a request happens to also touch `cursorApiKey`; callers get a misleading
     "config update failed" with no hint which field caused it.
   - Current handling: blanket suppression keyed only on "was `cursorApiKey` present in the
     request", not on "did the failure originate from the secret write."
   - Recommendation: scope the credential-safe catch to the actual secret-write call (e.g. wrap
     only `authSecrets.setProviderKey`/`deleteProviderKey` in a local try/catch that returns the
     generic message), or at minimum still pass the `Error` object to `logger.error` (the message is
     already suppressed from the RPC response; the structured logger's own field redaction, if any,
     should be trusted the same way it is for every other handler) so failures remain triageable.

3. **[MODERATE] `migrateCursorApiKeyToSecrets` never clears a non-string legacy value.**
   - File: `libs/backend/rpc-handlers/src/lib/migrations/cursor-api-key-migration.ts:12-14`
   - Scenario: `if (typeof legacyValue !== 'string' || !legacyValue.trim()) { return 'none'; }` —
     for a corrupted/non-string `provider.cursor.apiKey` (e.g. a stray number or object from manual
     file editing or an old bug), the function returns `'none'` without ever calling
     `workspace.setConfiguration(..., undefined)`. Confirmed by the lane's own test
     (`cursor-api-key-migration.spec.ts`, `it.each(['', ' \t ', null, 42])('returns none without
     writes for %p' ...)`): the `42` case asserts `setConfiguration` is *not* called, i.e. the stale
     value is left in the plain settings file forever — every future startup will re-read it and
     again do nothing.
   - Symptom: this specific corrupted-value case can never converge to "no plaintext residue in
     settings.json", contradicting the task's overall goal, though it is a narrow edge case (a valid
     API key is never a JSON number/object in normal operation).
   - Current handling: silently ignored, indistinguishable in the log from "nothing was ever
     configured."
   - Recommendation: for a present-but-non-string leftover, still clear the plain setting (there is
     nothing safe to migrate, but there is also no reason to leave a known-invalid leftover in the
     file); log a distinct outcome (e.g. `'invalid'`) rather than folding it into `'none'`.

4. **[MINOR / OBSERVATION] `AgentRpcHandlers`'s new `AUTH_SECRETS_SERVICE` dependency is not
   exercised by any of the three apps' DI smoke tests.**
   - Files: `apps/ptah-extension-vscode/src/di/expected-resolvable.ts`,
     `apps/ptah-electron/src/di/expected-resolvable.ts` (not present, checked by absence),
     `apps/ptah-cli/src/di/expected-resolvable.ts` (same) — none lists `AgentRpcHandlers`, and none
     of the three `container.smoke.spec.ts` files (`apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:193-211`,
     and the electron/CLI equivalents) actually call `.resolve(AgentRpcHandlers)`.
     `registerSharedRpcHandlers` (`libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts:42-50`)
     — which the VS Code smoke spec does call — does not even register `AgentRpcHandlers`; that
     class is registered separately per app (`apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:76`,
     `apps/ptah-electron/src/di/phase-4-handlers.ts:129/180`, `libs/backend/cli-engine/src/lib/container.ts:877`)
     and never resolved by a smoke test anywhere.
   - This is **pre-existing** (the gap predates this commit — `AgentRpcHandlers` was already absent
     from all three `EXPECTED_RESOLVABLE` lists before this change) and is explicitly not something
     Batch A introduced, so it is not blocking. But it means the new `@inject(TOKENS.AUTH_SECRETS_SERVICE)`
     constructor slot added at `agent-rpc.handlers.ts:131-132` is unverified by any automated
     "does the real container shape actually resolve this class" check in any of the three runtimes
     — the only thing standing between this change and a runtime `resolve()` failure at activation is
     manual/integration testing. Given the DI-drift Sentry incident the smoke tests themselves cite
     as their reason for existing (`container.smoke.spec.ts:1-16`), recommend adding
     `AgentRpcHandlers` to all three `EXPECTED_RESOLVABLE` lists as a follow-up, ideally before or in
     Batch C.
   - I independently confirmed the DI *ordering* is safe: `TOKENS.AUTH_SECRETS_SERVICE` is
     registered inside `registerVsCodeCorePlatformAgnostic`
     (`libs/backend/vscode-core/src/di/register-platform-agnostic.ts:151`), which runs in phase 2
     library registration in VS Code/Electron (before phase 3/4 handler registration) and at
     `libs/backend/cli-engine/src/lib/container.ts:420` (before `AgentRpcHandlers` registration at
     line 877) in the CLI. `AUTH_SECRETS_SERVICE` is also already consumed by other existing
     handlers (`mcp-directory-rpc.handlers.ts`, `provider-rpc.handlers.ts`, per `batch-a-report.md`),
     so this is an established, working pattern — the finding is about test coverage, not actual
     breakage.

## Write-path trace (verified against the commit)

1. **Set (non-blank):** `agent:setConfig({ cursorApiKey })` → type guard
   (`agent-rpc.handlers.ts:273-278`, rejects non-string before any write, confirmed by test
   `rejects non-string keys before any write`) → `value = params.cursorApiKey.trim()` → if
   truthy, `authSecrets.setProviderKey('cursor', value)` (`:322`) →
   `AuthSecretsService.setProviderKey` (`auth-secrets.service.ts:275-291`) → re-trims and calls
   `context.secrets.store('ptah.auth.provider.cursor', value.trim())` → **only after this await
   resolves** does the handler call `workspace.setConfiguration('ptah', 'provider.cursor.apiKey', undefined)`
   (`:326-330`) to remove the plain leaf, then `cliDetection.invalidateCache()` (`:331`). If the
   secret write throws, `setConfiguration` is never reached (confirmed by test `keeps the plain
   copy and hides credential-bearing storage errors`), so the plain copy is preserved for retry —
   correct per spec.
2. **Set (empty/whitespace):** same path, but `authSecrets.deleteProviderKey('cursor')`
   (`:324`) → `context.secrets.delete(...)`, then the same plain-setting removal. Confirmed by
   test `deletes the secret and plain copy for %p` (empty and whitespace-only).
3. **Plain removal mechanics:** `IWorkspaceProvider.setConfiguration('ptah', 'provider.cursor.apiKey', undefined)`
   routes to `PtahFileSettingsManager.set(key, undefined)` in all three platforms
   (`vscode-workspace-provider.ts:95-101`, `electron-workspace-provider.ts:212-218`,
   `cli-workspace-provider.ts:104-110`, verified present and unchanged by this commit) —
   `file-settings-manager.ts:97-98` sets the in-memory cache to `undefined` synchronously (so any
   subsequent `get()` in-process treats the key as absent immediately, per `:83-91`), then
   `persist()` (`:483-503`) unflattens (`undefined` object properties are dropped by
   `JSON.stringify`, confirmed at `:493`) and atomically renames a temp file over `settings.json`.
   **However**, `persist()`'s `catch` block (`:497-502`) only `console.warn`s on a disk failure and
   never rethrows — `set()`'s `await this.writePromise` (`:103`) therefore always resolves, even
   when the on-disk write failed. This means `agent:setConfig` can return `{success: true}` (and
   the migration can return `'migrated'`/`'cleared'`) while the plaintext key **is still on disk**.
   This is pre-existing platform behavior outside this lane's edited files (correctly disclosed in
   `batch-a-report.md` as "Existing limitation, outside ownership"), so I am not scoring it against
   Batch A, but it is a real answer to logic-question 1 (silent failure) worth the team's attention
   given the task is specifically about not leaving the key in plaintext.
4. **Migration:** `migrateCursorApiKeyToSecrets(workspace, secrets, logger)`
   (`cursor-api-key-migration.ts:5-28`) reads the legacy value; non-string/blank → `'none'`, no
   writes (see Finding 3 for the non-string sub-case never clearing). Present + no secret →
   `setProviderKey` (propagates on throw, plain value kept, confirmed by test `keeps the plain
   setting and rethrows when storing the secret fails`) → plain removal → `'migrated'`. Present +
   existing secret → secret left untouched → plain removal → `'cleared'`. Logging is
   outcome-word-only (`logger.info(outcome)`, confirmed by test `logs outcome words only, never the
   key`). See Finding 1 for the TOCTOU race against a concurrent `setConfig`.
5. **Readers:** `agent:getConfig` → `await isCursorApiKeyConfigured()`
   (`agent-rpc.handlers.ts:200`, `:1046-1054`) → non-blank `CURSOR_API_KEY` env, else
   `authSecrets.hasProviderKey('cursor')` → boolean only, no raw value ever returned. The plain
   setting is no longer read here at all (old `this.workspace.getConfiguration(...)` branch
   removed). `CursorCliAdapter.resolveCursorApiKey` (`libs/backend/cli-agent-runtime/.../cursor-cli.adapter.ts:174`,
   unchanged by this commit, owned by Batch B) still reads env then the plain
   `provider.cursor.apiKey` setting — this is the expected, disclosed Batch B gap, not a Batch A
   defect, but see "Lane-introduced constraints" below for the sequencing implication.

## Checks run

- `git show ed7c4ce7d` (full diff, all 9 files) and `git show --stat` — read in full, not just
  hunks.
- Read `agent-rpc.handlers.ts` register/setConfig/getConfig/isCursorApiKeyConfigured methods in
  full context (not only the diff hunks) to see field-processing order and catch-block scope.
- Read `AuthSecretsService.{getProviderKey,setProviderKey,deleteProviderKey,hasProviderKey}`
  (`libs/backend/vscode-core/src/services/auth-secrets.service.ts:230-311`) — no locking/mutex
  present, confirming Finding 1 is exploitable at this layer too (no lower-layer protection either).
- Read `file-settings-manager.ts` `set()`/`persist()`/`loadSync()` in full to verify plain-removal
  semantics and the swallowed-persist-error behavior cited above.
- Grepped for every `provider.cursor.apiKey`, `cursorApiKey`, `hasProviderKey('cursor')`,
  `getProviderKey('cursor')` reader path reported in `batch-a-report.md` and spot-checked the
  cited line numbers for `agent-rpc.handlers.ts`, `cursor-api-key-migration.ts`,
  `file-settings-keys.ts`, and the three platform workspace-provider adapters — all matched.
  `CursorCliAdapter` unchanged, confirmed out of scope for Batch A.
  `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts:174` still
  reads the plain file (expected; Batch B's job).
- Checked DI registration order for `TOKENS.AUTH_SECRETS_SERVICE` vs. `AgentRpcHandlers` in all
  three runtimes (VS Code `container.ts` phase ordering, Electron `container.ts` phase ordering,
  CLI `libs/backend/cli-engine/src/lib/container.ts:420` vs `:877`) — registration precedes
  resolution in all three; no ordering defect found (see Finding 4 for the separate test-coverage
  gap).
- Checked all three apps' `container.smoke.spec.ts` / `expected-resolvable.ts` for
  `AgentRpcHandlers` coverage — absent in all three, pre-existing, not introduced by this commit
  (see Finding 4).
- Ran `npx nx test @ptah-extension/rpc-handlers --testPathPatterns="agent-rpc.handlers|cursor-api-key-migration" --skip-nx-cache`:
  **6 test suites passed, 91 tests passed, 0 failed**, 41s. This resolves the "unresolved at
  tool-budget checkpoint" state the Codex lane left the verification in — the tests do pass.
- Ran `npx nx run @ptah-extension/rpc-handlers:typecheck --skip-nx-cache`: passed, no errors.
- `mcp__ptah__ptah_get_diagnostics` on the two changed source files: reported "Unavailable —
  TypeScript check still running", same as the lane's own report; superseded by the direct
  `nx typecheck` run above, which completed and passed.
- Did not run lint separately (not requested by the reviewer prompt beyond the specific test
  command); typecheck + the full test run for the touched project is the evidence basis here.
- Read the #581 regression test (`never writes a credential value to the log`,
  `agent-rpc.handlers.set-config.spec.ts:169-184`) — confirmed it is preserved and still asserts
  `fields: ['cursorApiKey']` only, plus new assertions that the plain setting no longer holds the
  raw secret.

## Lane-introduced constraints

- **Cross-batch sequencing dependency (not a Batch A code defect, but Batch A's plain-removal
  behavior makes it real):** as soon as Batch A merges and any `agent:setConfig({cursorApiKey})`
  call or the (currently unwired) migration runs, the plain `provider.cursor.apiKey` setting is
  deleted — but Batch B's `CursorCliAdapter.resolveCursorApiKey`
  (`cursor-cli.adapter.ts:174`, confirmed unchanged) still reads only the plain setting, not the
  secrets store. If Batch A's `agent:setConfig` handler ships to a running instance before Batch
  B's adapter change and before Batch C wires the migration with matching read-side changes, a
  user who sets a new Cursor key through the UI will see `{success: true}` but Cursor CLI
  detection/authentication/execution will fail to find any key at all (the plain file is now
  empty and the adapter doesn't yet know about the secrets store). This is expected/disclosed
  multi-batch work per `context.md`, not a Batch A logic bug, but it means **Batch A and Batch B
  must land together** (or behind a flag) — Batch A alone is not safely shippable in isolation.
  Flagging per instructions since it is something Batch A does that makes Batch B's absence
  actively harmful rather than merely incomplete.
- Otherwise: none. No additional constraints were needed to make the reviewed diff behave as
  described; Findings 1-4 above are defects in Batch A's own code, not requirements imposed on
  downstream batches.
