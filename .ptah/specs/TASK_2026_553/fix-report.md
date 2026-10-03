# Fix report — TASK_2026_553: a failed write to `~/.ptah/settings.json` reaches the caller

Delivered as Batch 1 of TASK_2026_555 (plan step S1a, implementation-plan.md Component 1).
Batch 2 appends the startup evidence (the three bootstrap specs).

## What changed

| File | Change |
| --- | --- |
| `libs/backend/platform-core/src/file-settings-errors.ts` (new) | `SettingsPersistError`: `name = 'SettingsPersistError'`, `code` = the fs error code (`EACCES`, `ENOSPC`, `EBUSY`, …, or `UNKNOWN`), message `Settings could not be saved to disk (<code>)`. It carries no value, no key, no path and no underlying message. |
| `libs/backend/platform-core/src/file-settings-manager.ts` | `persist()` keeps its `console.warn` line, then throws `SettingsPersistError`. `set()` snapshots the key's previous value (or its absence), awaits the queued persist, and on rejection restores the snapshot and rethrows. Listeners fire only after a successful persist. |
| `libs/backend/platform-core/src/file-settings-manager.ts` (write hardening) | Two companion changes. Without them, surfacing failures would turn benign races into user-visible "Not saved" errors. **(a)** Each `persist()` uses a unique temp name, `settings.json.<pid>.<n>.tmp` (was a shared `settings.json.tmp`), and removes it on failure. **(b)** The final `rename` is retried on `EPERM`/`EACCES`/`EBUSY` with 20/60/150 ms backoff (rename is idempotent). The fs code is read structurally (`fsErrorCode`), because Node core errors can come from another realm where `instanceof Error` is false. |
| `libs/backend/platform-core/src/file-settings-manager.ts` (stale temp sweep) | **(c)** At construction, `loadSync` first sweeps `settings.json.<pid>.<n>.tmp` files left by a writer that died between `writeFile` and `rename`. It removes only files older than 10 minutes, never the current process's files, and never files that do not match the pattern. It is best-effort: fs errors are logged and ignored. |
| `libs/backend/platform-core/src/index.ts` | Exports `SettingsPersistError`. |
| `libs/backend/platform-core/src/file-settings-manager.error-paths.spec.ts` | Two deliberate changes to existing cases, plus a new `failed write (TASK_2026_553)` block and a `stale temp-file sweep on load` block (below). |

### Why (a) and (b)

The first scoped verify run failed `settings-core` `migration-edge-cases.spec.ts` "B4 — concurrent set() from
two instances". Both instances wrote the same `settings.json.tmp`, so one instance's rename moved the other's temp
file away. The old code swallowed this; the new code rejected it. The same race exists in production: the VS Code
extension, the Electron app and the CLI share `~/.ptah/settings.json`.

After (a), B4 still failed 1 run in 5 on Windows, because a rename onto a target that another rename is replacing
returns a transient lock code. (b) closes that gap and also covers the antivirus/OneDrive locks named in `task.md`.
With both changes in place, B4 passed 8/8 repeated runs.

(c) was added in the review round (code-logic review finding 2). Unique temp names turn "at most one stray file"
into "one per interrupted write", so the sweep bounds that. The 10-minute age is far longer than any live write,
including the ~230 ms of rename retries, so another process's in-flight temp file is never removed.

Unchanged on purpose:

- `flushSync()` still swallows (exit path; a new spec pins it).
- The `writePromise` queue still chains each persist on both fulfilment and rejection, so one failed write
  never blocks the next.

### Restore rule

The snapshot is restored only while this `set()` still **owns** the key. Ownership is tracked by write, not
by value:

- Each `set()` takes the next per-key write generation (`writeGenerations`).
- It also records the reload epoch (`reloadEpoch`, bumped when `processCrossProcessChange` replaces the map).
- The catch restores only when both are unchanged.

Why:

- `persist()` writes the whole in-memory map. A later `set()` on the same key that is queued behind the failed
  write owns the key, **even when it writes an identical value**. Rolling back would overwrite that value, and
  the second call's persist would then write the rollback to disk while that call resolves and fires its
  listeners.
- A cross-process reload that replaced the map owns it too.

The first version used value identity (`Object.is`). Code-logic review finding 1 showed that two concurrent
identical-value writes defeat that rule, so it was replaced with the ownership rule above. Specs pin both the
different-value and the identical-value race.

## Write-path trace: RPC save path

1. **Webview.** `ProvidersSettingsStateService.runCommit`
   (`libs/frontend/core/src/lib/services/providers-settings-state.service.ts:1039-1080`) calls
   `operation.write()`, which sends an RPC, e.g. `settings:set`.
2. **Handler.** `settings:set` (`libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts:143-173`)
   checks the key against the file-based allow-list, then calls
   `workspaceProvider.setConfiguration('ptah', key, value)`.
3. **Provider.** `setConfiguration` routes file-based `ptah` keys to `fileSettings.set(key, value)`:
   - VS Code: `libs/backend/platform-vscode/src/implementations/vscode-workspace-provider.ts:100-101`
   - Electron: `libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts:218`
   - CLI: `libs/backend/platform-cli/src/implementations/cli-workspace-provider.ts:110`

   It has no `catch`, so the rejection propagates. The synthetic config-change event is **not** fired
   because the `await` throws first.
4. **Set.** `PtahFileSettingsManager.set` updates memory, queues `persist()` on `writePromise`, and awaits it.
5. **Persist.** `persist()` fails at `mkdir`, `writeFile` or `rename` and logs:
   `console.warn('[PtahFileSettingsManager] Failed to persist settings to <path>:', <fs message>)`.
   The log line holds the path and the fs message, never the value. It then throws
   `new SettingsPersistError(code)`.
6. **Reject.** `set()` catches, restores the previous in-memory value (memory == disk again), skips the
   listeners, and rethrows.
7. **Envelope.**
   - `settings:set` catches and returns `{ success: false, error: 'Settings could not be saved to disk (EACCES)' }`.
   - A handler without its own catch lets the throw reach the dispatcher
     (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:223-252`), which returns
     `{ success: false, error: <message> }`.
   - Either way the message is the fixed text plus the code.
8. **`runCommit`.** A `false` acknowledgement or a thrown RPC error leaves the field unacknowledged
   (`:1048-1061`).
   - Operations with a read-back re-read the value. Memory was restored, so the read-back returns the old
     value, the match fails, and the field lands in `unsaved` (`:1062-1070`). Status: `failed`, or
     `partial` when other fields saved.
   - Operations without a read-back land in `unconfirmed` today (`:1075-1079`). Turning that into
     `unsaved` / "never Saved after a failed write" is D15, owned by TASK_2026_555 Batch 8.
9. **Toast.** The page toast renders "Not saved: …" from `commitState` (TASK_2026_555 Component 11,
   Batch 17).

The other writers that reach `set()` inherit the rejection with no code change. Their callers already
turn throws into errors:

- `ConfigManager.set` (`libs/backend/vscode-core/src/config/config-manager.ts:216-227`). A watcher
  callback is not called on failure, because the `await` throws first.
- The settings adapters and stores:
  - `platform-vscode/src/settings/vscode-settings-adapter.ts:79`
  - `platform-electron/src/settings/file-settings-store.ts:41`
  - `platform-cli/src/settings/file-settings-store.ts:47`
- The CLI shim (`libs/backend/cli-engine/src/lib/container.ts:556-576`).

Startup paths (`runCursorApiKeyMigration`, `migrateAgentOrchestrationSettings`) are covered by
Batch 2 and Batch 5.

## Spec evidence (`file-settings-manager.error-paths.spec.ts`)

### Deliberate changes to existing assertions

1. **"set() recovers when a prior persist() in the chain rejected".** Only the first `await` changed:
   - Was: `await mgr.set('key', 'v1');`
   - Now: `await expect(mgr.set('key', 'v1')).rejects.toBeInstanceOf(SettingsPersistError);`

   The recovery assertion (`set('key','v2')` then `get` is `'v2'`) is unchanged.
2. **"persist() logs but does not throw when writeFile fails".** Renamed to "persist() logs and rejects
   with SettingsPersistError when writeFile fails".
   - Was: `.resolves.toBeUndefined()`
   - Now: `.rejects.toBeInstanceOf(SettingsPersistError)`

   The `warnSpy` assertion is unchanged.

### New cases (`describe('failed write (TASK_2026_553)')`)

- The error carries only the fs code and fixed text. It includes neither the value (`sk-secret-value`)
  nor `settings.json`.
- A failure without an fs code reports `UNKNOWN` (a `rename` failure).
- The failed write leaves the previous value unchanged, in memory and on disk.
- A key absent before the failed write is removed again, so `get` falls back to the registered default.
- The next `set()` after a failure resolves and is persisted to disk.
- Listeners are not called on failure. They are called once, with the new value, on the next success.
- A later `set()` on the same key, queued behind the failed write, is not rolled back. It wins in memory
  and on disk.
- A later `set()` of the **identical** value (`true`), queued behind the failed write, is not rolled back.
  Memory and disk hold `true`, and its listener fires once.
- `flushSync()` keeps swallowing write errors.
- A rename that stays locked (`EPERM`) rejects after 4 attempts and leaves no `.tmp` file.
- A rename that is locked once (`EBUSY`) is retried, and the value is saved.
- A non-transient rename failure (`ENOSPC`) is not retried.

### New cases (`describe('stale temp-file sweep on load')`)

- Another process's temp file older than 10 minutes is removed.
- Another process's recent temp file (an in-flight write) is kept.
- The current process's temp files are never removed, however old.
- Non-matching files are kept: `settings.json.flush.tmp`, `other.json.123.1.tmp`, `settings.json.bak`.
- `settings.json` still loads after the sweep.

## Verification

The scoped `nx run-many -t typecheck,test,lint` result over the 11 Batch 1 projects is recorded in
`.ptah/specs/TASK_2026_555/batch-1-report.md`.

## Startup survives a rejecting write (TASK_2026_555 Batch 2)

### Survey: every settings write that runs by itself at startup

The survey covered VS Code `activate` → `bootstrapVscode`, Electron `bootstrapElectron` / `wire-runtime` /
`main.ts` / DI phases, and CLI `withEngine`. `*.spec.ts` files were excluded.

| # | Write | Reached from | Containment |
| --- | --- | --- | --- |
| 1 | `rpc-handlers/src/lib/migrations/cursor-api-key-migration.ts:28` (`provider.cursor.apiKey` → `undefined`) | VS Code `bootstrap.ts:135`, Electron `bootstrap.ts:277`, CLI `with-engine.ts:321` (full mode) | Catch-all in `run-cursor-api-key-migration.ts:26-42`. It logs `errorType` only; the plain value stays and is retried at the next start |
| 2 | `rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1111` (`migrateAgentOrchestrationSettings` loop) | `void` at `agent-rpc.handlers.ts:136`, from `register()` during handler registration in all three hosts | try/catch at `:1094-1123`. The `void` promise cannot reject. A failed key stops the loop before the done-flag write, so the migration retries next boot. Spec owned by Batch 5 (S1b) |
| 3, 4 | `agent-sdk/src/lib/sdk-agent-adapter.ts:494, 504` (`model.selected` first-run default and legacy-name migration) | SDK adapter `initialize()` in all three hosts | Inner try/catch `:490-511`, with further catches in the adapter and the hosts |
| 5 | `cli-engine/src/lib/bootstrap/with-engine.ts:536` (`authMethod` `claudeCli` → `claude-cli`) | CLI `with-engine.ts:310` (full mode) | `.catch` at `with-engine.ts:310` |
| 6 | settings-core `MigrationRunner` v2-v4 | VS Code `bootstrap.ts:108`, Electron `bootstrap.ts:250`, CLI `with-engine.ts:293` | try/catch `catch (settingsError)` in each host (VS Code `:93-133`, Electron `:231-275`, CLI `:288-308`), logged as non-fatal |

Result: **no uncontained startup path**. No write rejects out of `bootstrapVscode`, `bootstrapElectron` or `withEngine`,
and there is no un-awaited `setConfiguration` without a handler. No production change was needed.

How row 6 relates to Batch 1: the v2-v4 migrations write `settings.json` with raw `fsPromises.writeFile` + `rename`
(`v2-migration.ts:66-67`, `v3-migration.ts:87-88`, `v4-migration.ts:40-41`), not through `PtahFileSettingsManager.set()`.
Their failure behaviour is therefore unchanged by Batch 1.

Recorded observations (pre-existing, not caused by this task, not changed):

- In VS Code and Electron, a failing settings migration also skips `customProviders.load()`, which sits in the same
  try block. Startup continues, but user-defined provider ids do not resolve for that session.
- `migrateLegacyAuthMethod` resolves `Symbol.for('WorkspaceProvider')`, which no container registers. In production it
  returns early at its `resolve` catch.

### Specs (each uses a real `SettingsPersistError('EACCES')` rejection, not a thrown string)

- **`apps/ptah-extension-vscode/src/activation/bootstrap.cursor-key.spec.ts`**, describe "startup survives a rejecting
  settings write (TASK_2026_553)":
  - "the settings catch around runMigrations() logs and never rethrows": `runMigrations()` sits inside the `try` whose
    `catch (settingsError)` calls `console.warn` and contains no `throw`.
  - "the Cursor key step resolves and warns without the key when setConfiguration rejects": the real
    `runCursorApiKeyMigration` over the container shape `bootstrapVscode` passes, with a rejecting provider. It
    resolves, reaches the write, warns once with `{ errorType: 'SettingsPersistError' }`, and never logs the key.
- **`apps/ptah-electron/src/activation/bootstrap.cursor-key.spec.ts`**: the same two cases against `bootstrapElectron`.
- **`libs/backend/cli-engine/src/lib/bootstrap/with-engine.spec.ts`**, "startup survives a rejecting settings write
  (TASK_2026_553)": `withEngine` (mode full, verbose) runs with all three startup writers rejecting at once:
  - the settings `MigrationRunner`
  - `migrateLegacyAuthMethod`, whose token the spec provides
  - the real `runCursorApiKeyMigration`

  `withEngine` still resolves `fn`'s result. Both writes are reached. stderr carries
  `file-settings migration failed (non-fatal): Settings could not be saved to disk (EACCES)` and
  `authMethod migration skipped: Settings could not be saved to disk (EACCES)`. The Cursor warning carries
  `errorType: 'SettingsPersistError'`, and neither stderr nor the logger contains the key.

Batch 2 verify: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-engine ptah-extension-vscode ptah-electron ptah-cli`
→ **EXIT=0**. All 12 targets passed (`Successfully ran targets typecheck, test, lint for 4 projects`).
