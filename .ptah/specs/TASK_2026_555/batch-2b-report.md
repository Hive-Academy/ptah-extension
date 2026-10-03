# Batch 2b report — startup degradations found by Batch 2 (S1a follow-up)

Executor: backend-developer (subagent, in-process). This batch fixes the two pre-existing defects confirmed in
`batch-2-code-logic-review.md`.

## Files

| Path (under ROOT) | Change |
| --- | --- |
| `apps/ptah-extension-vscode/src/activation/bootstrap.ts` | Exported `loadCustomProviders(container)`, which has its own non-fatal try/catch. It is called right after the settings-migration try/catch and before `runCursorApiKeyMigration`. The migration try now logs only "Settings registered and migrations applied". |
| `apps/ptah-electron/src/activation/bootstrap.ts` | The same change, with the `[Ptah Electron]` prefix. |
| `apps/ptah-extension-vscode/src/activation/bootstrap.cursor-key.spec.ts` | +4 cases (describe "custom providers load independently of the settings migrations (Batch 2b)"). |
| `apps/ptah-electron/src/activation/bootstrap.cursor-key.spec.ts` | +4 cases (same describe). |
| `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts` | `migrateLegacyAuthMethod` resolves `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, imported from the `@ptah-extension/platform-core` barrel. The local `Symbol.for('WorkspaceProvider')` constant and its stale doc comment are removed. |
| `libs/backend/cli-engine/src/lib/bootstrap/with-engine.spec.ts` | The Batch 2 case no longer registers the dead symbol. +6 cases in a new describe, "migrateLegacyAuthMethod (TASK_2026_555 Batch 2b)". |
| `.ptah/specs/TASK_2026_555/batch-2b-report.md` | This file. |

No other file changed. No new DI token was added. `CustomProviderStore` is resolved exactly as before
(`SETTINGS_TOKENS.CUSTOM_PROVIDER_STORE`).

## Task 2b.1 — custom providers load regardless of the migration outcome

- **Before.**
  - `customProviders.load()` sat in the same try block as `runMigrations()`:
    - VS Code `bootstrap.ts:104-126`
    - Electron `bootstrap.ts:246-268`
  - When a migration rejected, user-defined providers were never published for that session.
- **After.**
  - `loadCustomProviders(container)` runs after the settings catch and before the Cursor step.
  - It still logs the entry count (`Custom providers published (N custom providers)`) and the dropped entries.
  - A throwing `load()`, or a store that was never registered (settings registration failed), is logged as
    `Custom provider load failed (non-fatal); only built-in providers are available: <message>`, and activation
    continues.
  - Publish order is unchanged: the load happens before anything later in activation resolves a provider.
  - `load()` itself publishes to the registry cache (`custom-provider-store.ts:94-101`).
- **Spec approach.** It follows the in-repo precedent `apps/ptah-electron/src/activation/bootstrap.network.spec.ts`: the
  helper is driven for real, and the one thing that cannot be observed without a VS Code or Electron host is pinned
  from source. Per host:
  1. "publishes after the settings try/catch, so a rejecting runMigrations() cannot skip it": the call sits after
     the end of the `catch (settingsError)` block and before `runCursorApiKeyMigration`, and
     `customProviders.load()` no longer appears in the bootstrap body.
  2. "loads the store, publishes, and logs the entry count and dropped entries".
  3. "logs and does not throw when load() throws": the store throws `SettingsPersistError('EACCES')`, and the
     warning carries the fixed text only.
  4. "logs and does not throw when settings registration never registered the store".

  Limit, stated plainly: `bootstrapVscode` / `bootstrapElectron` cannot run under Jest (full DI, host APIs). The
  "rejecting `runMigrations()` → load still called" property is therefore pinned by source position (case 1), and
  the load's own behaviour by cases 2-4.

## Task 2b.2 — `migrateLegacyAuthMethod` resolves the real token

- **Before.** `with-engine.ts:105` used `Symbol.for('WorkspaceProvider')`, which no container registers. Its own
  `catch { return; }` hid the resolution failure, so the `claudeCli` → `claude-cli` migration never ran in the CLI.
- **After.** It resolves `PLATFORM_TOKENS.WORKSPACE_PROVIDER` (`Symbol.for('PlatformWorkspaceProvider')`), which the
  CLI registers at `libs/backend/platform-cli/src/registration.ts:81`. The failure log in `withEngine` (the `.catch`
  on the call, printed with `--verbose`) is unchanged and prints only the error message. For a write failure that
  message is the fixed `Settings could not be saved to disk (<code>)`.
- **Specs.** A real `PtahFileSettingsManager` on a temp directory, behind a provider registered under
  `PLATFORM_TOKENS.WORKSPACE_PROVIDER`:
  - **Runs and migrates:** `claudeCli` becomes `claude-cli` on disk with exactly one write, and the unrelated keys
    (`llm.defaultProvider`, `reasoningEffort`) are kept. This fails under the old symbol, where nothing is written.
  - **Second run is a no-op:** no write, and the file is byte-identical.
  - **Untouched user files** (`it.each`): already `claude-cli`, another method (`apiKey`), or no `authMethod` at all.
    In each case there is no write and the file is byte-identical, so no unrelated key is deleted.
  - **Write fails:** rejects with the fixed `SettingsPersistError` text, which `withEngine` contains (also pinned
    end to end by the Batch 2 case, which now wires the provider only under the platform token).

### Write-path trace row

| Migration | Reads | Writes | Store | Scope | Touches |
| --- | --- | --- | --- | --- | --- |
| `migrateLegacyAuthMethod` (CLI, `withEngine` full mode) | `getConfiguration('ptah','authMethod')` | `setConfiguration('ptah','authMethod','claude-cli')`, only when the value is exactly `'claudeCli'` | `authMethod` is file-based → CLI workspace provider → `PtahFileSettingsManager.set` → `~/.ptah/settings.json` | User-global file (`~/.ptah/`) | Only the legacy key. The manager rewrites the whole file from its in-memory map, and the spec proves the other keys survive byte-for-byte in value |

## Verification

- Scoped:
  - VS Code `bootstrap.cursor-key.spec.ts`: 8/8
  - Electron `bootstrap.cursor-key.spec.ts`: 8/8
  - `with-engine.spec.ts` (`-c libs/backend/cli-engine/jest.config.cjs`): 51/51
- Batch 2b verify command, run in the foreground:
  `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-engine ptah-extension-vscode ptah-electron ptah-cli --parallel=2`
  → **EXIT=0**, "Successfully ran targets typecheck, test, lint for 4 projects and 41 tasks they depend on".
- **Gate G was not run by this executor.** It needs `nx build ptah-extension-webview` plus the reachability
  Playwright spec, which execution default 4 treats as a single-writer resource run by the team-leader at commit
  time. This batch changes no webview code.

## Plan deviations

- **The load moved into an exported helper, `loadCustomProviders`,** rather than a bare second try block inline.
  That is the only way to drive it from a spec without a host, and it matches the existing exported-helper pattern
  in the same Electron file (`startMembershipVerification`, `startAgentAdapterInitialization`).
- **The startup log line changed.** It was "Settings registered and migrations applied (N custom providers)". It is
  now two lines: "Settings registered and migrations applied" and "Custom providers published (N custom providers)".

## Out of scope (recorded, not changed)

- Review Moderate 1 (Batch 2): the two SDK adapter startup writes (`sdk-agent-adapter.ts:494, 504`) are still
  verified by code reading, not by a rejecting fake through a host.
- The Batch 1 open items (M1 double-failure cache, the sweep ENOENT warning) are untouched.
