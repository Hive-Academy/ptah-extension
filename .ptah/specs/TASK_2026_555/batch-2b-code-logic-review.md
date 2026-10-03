# Code Logic Review — `TASK_2026_555` Batch 2b

**DISCLOSURE:** This is a same-side, in-process review. The reviewer runs in the same
session context as the batch's author (an in-process backend-developer). All CLI lanes
were out of quota at review time, so no cross-vendor or cross-process lane review was
possible. Every claim below was independently re-derived from the repository (fresh
reads, fresh greps, fresh `nx test` runs) rather than taken from `batch-2b-report.md` on
trust, but the structural independence a separate process/vendor would provide is absent.
Treat this as a diligent self-check, not an adversarial second opinion.

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 1                                    |
| Failure modes found | 2 (both handled correctly by this batch) |

## Five logic questions

### 1. How does this fail silently?

- `loadCustomProviders` (`apps/ptah-extension-vscode/src/activation/bootstrap.ts:55-84`,
  mirrored `apps/ptah-electron/src/activation/bootstrap.ts:55-84`) still swallows a real
  failure into a generic warning: if `CustomProviderStore.load()` throws, or the token was
  never registered, the user gets `Custom provider load failed (non-fatal); only built-in
  providers are available: <message>` and nothing else distinguishes "corrupt custom
  provider file" from "everything is fine, you just have zero custom providers." This is
  the same shape of silence Batch 2's review flagged, now confined to its own log line
  instead of being conflated with the migration warning — an improvement, not a fix of
  the underlying user-visibility gap. Not a regression; out of this batch's stated scope.
- `migrateLegacyAuthMethod` (`with-engine.ts:510-529`) still returns silently
  (`catch { return; }`, line 512-514) when `PLATFORM_TOKENS.WORKSPACE_PROVIDER` cannot be
  resolved. Previously this branch was *always* taken in production (dead migration).
  Now that the token resolves, this branch is reachable only when a CLI entry path
  genuinely omits platform registration — verified there is no such path today (see
  finding under Q4) — so the silent-return is now a defensive fallback rather than the
  normal case. Acceptable, but worth flagging: if a future CLI subcommand builds a
  container without calling `registerPlatformCliServices`, the migration will resume
  silently no-op'ing with no signal.

### 2. What user action produces unexpected behaviour?

None introduced by this batch. The two behaviours it fixes were themselves the source of
unexpected behaviour (custom providers vanishing after a migration failure; the
`claudeCli` → `claude-cli` migration never running). Both are now closed for the paths
tested. One residual: a user who reads the two-line startup log
("Settings registered and migrations applied" / "Custom providers published (N custom
providers)") and sees N=0 has no way to tell "I have no custom providers" from "my custom
providers failed to load" without also seeing the (separate, easy-to-miss) `console.warn`
line — same limitation as Q1, not new.

### 3. What input data produces a wrong answer?

Checked the migration's write gate at `with-engine.ts:524-529`: it fires only when
`current === 'claudeCli'` (exact match) and `typeof provider.setConfiguration ===
'function'`. A user file with `authMethod: 'claude-cli'`, `'apiKey'`, `'oauth'`, or no key
at all takes no write — verified by the `with-engine.spec.ts` `it.each` cases (already
migrated / another method / absent) and independently by reading
`libs/backend/auth-providers/src/lib/auth/auth-method.utils.ts:30-46`, which normalizes
both `'claudeCli'` and `'claude-cli'` to the same canonical value, so no downstream reader
is broken by the newly-real migration in either direction (pre- or post-run).

### 4. What happens when a dependency fails?

- If `MigrationRunner.runMigrations()` rejects, `loadCustomProviders` still runs (outside
  the try, per the diff at `bootstrap.ts` in both apps) — verified structurally by the new
  spec case ("publishes after the settings try/catch...") and confirmed by reading the
  actual diff: the call sits after the `catch (settingsError)` block closes and before
  `runCursorApiKeyMigration`.
- If the settings-registration step itself throws before `SETTINGS_TOKENS
  .CUSTOM_PROVIDER_STORE` is registered, `loadCustomProviders`'s own `container.resolve`
  throws, caught by its own try/catch, logged, activation continues — verified by spec
  case 4 in both hosts.
- If `PtahFileSettingsManager.set` rejects during `migrateLegacyAuthMethod`, the
  `await provider.setConfiguration(...)` at `with-engine.ts:529` rejects; `withEngine`'s
  caller wraps the call in `.catch()` (`with-engine.ts:301-311`), so the rejection cannot
  abort the command — verified by the new `with-engine.spec.ts` case ("rejects with the
  fixed persist error...") plus reading the `.catch` at the call site.
- Registration order for the CLI: confirmed by tracing `withEngine` → `bootstrap()`
  (synchronous, `with-engine.ts:261`) → `CliDIContainer.setup` → `registerPlatformCliServices`
  (`libs/backend/cli-engine/src/lib/container.ts:404`) which unconditionally registers
  `PLATFORM_TOKENS.WORKSPACE_PROVIDER` (`libs/backend/platform-cli/src/registration.ts:81-83`)
  before `withEngine`'s migration block runs (`with-engine.ts:279-313`, guarded by
  `await result.workspaceReady` but the registration itself happened synchronously inside
  `bootstrap()` at line 261, before that await). This holds for every `opts.mode`, since
  `registerPlatformCliServices` is called unconditionally in `setup()`, not gated by mode.

### 5. What is missing that the requirements never mentioned?

- The report explicitly records this out of scope, and it is correct to: the two
  SDK-adapter startup writes (`sdk-agent-adapter.ts:494,504`) are still verified only by
  code reading, carried over unchanged from Batch 2. Not this batch's job.
- No spec proves what happens when `CUSTOM_PROVIDER_STORE.load()` itself is slow (e.g.
  blocks on a large file). `loadCustomProviders` is synchronous, so a slow `load()` would
  block activation before the Cursor migration step runs. This existed before the batch
  (the call was synchronous inside the migration try too) and is unchanged in shape, just
  relocated — not a new risk, not flagged as a finding.

## Failure modes

### Custom provider load still not user-distinguishable from "no custom providers" (pre-existing, narrowed not fixed)

- Trigger: `CustomProviderStore.load()` throws, or the store was never registered.
- Symptom: one `console.warn` line with the fixed text and the error message; no
  UI-visible signal distinguishes this from a user who legitimately has zero custom
  providers.
- Evidence: `apps/ptah-extension-vscode/src/activation/bootstrap.ts:79-83`;
  `apps/ptah-electron/src/activation/bootstrap.ts:79-83`.
- Current handling: logged and swallowed, activation continues with built-ins only.
- Recommendation: unchanged from Batch 2's disclosed recommendation — a follow-up ticket
  to surface this distinctly to the user (e.g. a startup diagnostic banner), not this
  batch's job. Correctly out of scope here since the task was ordering/independence, not
  observability.

### `migrateLegacyAuthMethod`'s silent-return branch is now a real defensive path, not dead code

- Trigger: a future CLI container built without `registerPlatformCliServices` (or any
  path that fails to register `PLATFORM_TOKENS.WORKSPACE_PROVIDER`).
- Symptom: the migration silently no-ops with no log, indistinguishable from "the value
  was already migrated."
- Evidence: `with-engine.ts:510-514` (`catch { return; }`); confirmed no current CLI entry
  path lacks the registration (`libs/backend/cli-engine/src/lib/container.ts:404`).
- Current handling: unchanged `catch { return; }`, same as before the fix (this was true
  even when the token resolved to nothing, so this is pre-existing code shape, not new).
- Recommendation: none required for this batch — the branch is currently unreachable in
  production. Noting it so a future container-wiring change doesn't reintroduce the exact
  defect this batch just fixed, silently.

## Blocking issues

None found in the reviewed diff.

## Serious issues

None found in the reviewed diff.

## Moderate and minor issues

1. **Moderate** — The position-pinned "publishes after the settings try/catch" spec case
   in both hosts (`bootstrap.cursor-key.spec.ts`) reads `BODY` from
   `readFileSync(join(__dirname, 'bootstrap.ts'), 'utf8')` (verified: not a stale copy —
   both spec files re-read the real file at test time), and it also asserts
   `expect(BODY).not.toContain('customProviders.load()')`, which pins that the inline call
   was actually removed from the try block, not just moved textually elsewhere in a way
   that could coexist. Combined with the direct behavioural cases (2-4) that call
   `loadCustomProviders` for real, this is not dead-code-passing brittleness — the
   function is genuinely invoked in production at the pinned call site, and the spec
   proves it. The residual risk is the same one Batch 2's review already accepted as
   pre-existing for this file: an unrelated reformatting of `bootstrap.ts` (renaming
   `settingsError`, changing brace style) could defeat `findCatchEnd`'s regex without any
   real behaviour change. Low severity, inherited pattern, not introduced by this batch.
   `apps/ptah-extension-vscode/src/activation/bootstrap.cursor-key.spec.ts:130-146`;
   `apps/ptah-electron/src/activation/bootstrap.cursor-key.spec.ts:131-147`.

## Data flow

1. VS Code/Electron `bootstrapVscode`/`bootstrapElectron`: settings registration + migrations
   run inside their own try/catch — OK, unchanged from before this batch except the log
   line no longer reports the custom-provider count.
2. `loadCustomProviders(container)` runs immediately after the settings catch closes,
   before `runCursorApiKeyMigration` — OK, verified structurally and by the diff; no
   provider-by-id resolution happens between the load and the Cursor step in either
   bootstrap file (grepped for `getAnthropicProvider`/`resolveProvider`/`getProvider(` —
   none found in either file).
3. `loadCustomProviders` resolves `SETTINGS_TOKENS.CUSTOM_PROVIDER_STORE`, calls `.load()`,
   logs entry count and dropped count, publishes to the shared registry cache inside
   `CustomProviderStore.load()` itself (`custom-provider-store.ts`, unchanged) — OK, no new
   DI token, no change to what gets published.
4. `loadCustomProviders`'s own try/catch: any resolve/throw failure is logged with only the
   error's `.message` (no secret value; `CustomProviderStore.load()`'s own contract is
   "never throws on malformed data," per its doc comment, so the catch here is a genuine
   defensive fallback for resolve failure and any future change to that contract) — OK.
5. CLI `withEngine`: `defaultBootstrap` → `CliDIContainer.setup` → `registerPlatformCliServices`
   registers `PLATFORM_TOKENS.WORKSPACE_PROVIDER` synchronously before the async migration
   block runs — OK, traced end to end.
6. `migrateLegacyAuthMethod` resolves the platform token, reads `authMethod`, writes only
   on an exact `'claudeCli'` match, via `provider.setConfiguration` → (in production)
   `PtahFileSettingsManager.set` → whole-file rewrite from the in-memory map — OK, the new
   spec's "keeps other keys" and "second run is a no-op" cases confirm the write is scoped
   to the one key and is idempotent.
7. A rejecting write from `migrateLegacyAuthMethod` is caught by `withEngine`'s `.catch()`
   at the call site, logged to stderr only under `--verbose`, and does not propagate — OK,
   confirmed by the new spec case and the unchanged `.catch` wiring.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| 2b.1: custom providers load independently of migration outcome, correct order, non-fatal, no secrets in logs | COMPLETE | None found. Order confirmed by source reading + spec; non-fatal confirmed by two throw/no-registration cases; log lines carry only counts and `.message`, never a provider value or secret. |
| 2b.1: "position pinned from source" spec is not dead-code-passing | COMPLETE | `BODY` is read from the live file at test time (not a stale copy) and asserts the old call site is gone; the function is also independently exercised for real in the same describe block. |
| 2b.2: `PLATFORM_TOKENS.WORKSPACE_PROVIDER` registered before `withEngine` runs the migration, in every CLI entry path | COMPLETE | Traced `withEngine` → `defaultBootstrap` → `CliDIContainer.setup` → `registerPlatformCliServices`, called unconditionally regardless of `opts.mode`. |
| 2b.2: migration idempotent, preserves other keys, never touches VS Code/Electron settings, cannot fail the CLI command | COMPLETE | Confirmed by the four new spec cases (migrate, no-op-on-rerun, three untouched-file variants, rejecting-write) plus the `.catch` wrapping at the call site. The migration only ever resolves the CLI's own `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, which VS Code and Electron register with their own host-specific providers, not the CLI's file-backed one — no cross-host write path exists. |
| 2b.2: every reader accepts the new `'claude-cli'` value | COMPLETE | `auth-method.utils.ts:30-46` normalizes both spellings to the same canonical value; this is the single documented source of truth "used by all SDK readers" per its own header comment. |
| No deep cross-lib imports | COMPLETE | All three production files import cross-lib code only through package barrels (`@ptah-extension/platform-core`, `@ptah-extension/settings-core`, `@ptah-extension/rpc-handlers`, etc.); intra-app imports are relative to the app's own `src`. |

Implicit requirements not addressed: none found beyond the pre-existing, disclosed
observability gap (Q1/Q2) and the SDK-adapter coverage gap carried over from Batch 2 —
both correctly out of this batch's scope.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Rejecting `runMigrations()` in VS Code/Electron | YES | `loadCustomProviders` moved outside the try; spec case 1 pins the source order | None |
| `CustomProviderStore` never registered (settings registration itself failed) | YES | `loadCustomProviders`'s own try/catch; spec case 4 | None |
| `CustomProviderStore.load()` throws | YES | Same try/catch; spec case 3 with a real `SettingsPersistError` | None |
| CLI: `authMethod: 'claudeCli'` on disk | YES | Migration writes `'claude-cli'`, keeps other keys | None |
| CLI: second boot after migration | YES | No-op, byte-identical file | None |
| CLI: file already `'claude-cli'`, `'apiKey'`, or absent `authMethod` | YES | `it.each` — no write, byte-identical | None |
| CLI: write fails mid-migration | YES | Rejects with fixed `SettingsPersistError` text; `withEngine`'s `.catch` contains it | None |
| A future CLI container omitting `registerPlatformCliServices` | NO | `migrateLegacyAuthMethod`'s `catch { return; }` would silently no-op | Pre-existing code shape, currently unreachable; noted as a failure mode above, not a new defect this batch introduced |

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM (same-side review; no independent CLI lane was available, though
  every claim here was re-derived from the repository rather than taken on the author's
  word — production diffs read directly, registration chain traced by hand, all three
  target spec files run via their nx test targets: vscode 8/8, electron 8/8,
  with-engine.spec.ts 51/51)
- Top risk: the observability gap already flagged in Batch 2's review (a load/migration
  failure is a generic warning, not a user-facing distinct signal) persists unchanged;
  this batch correctly did not expand its scope to fix it, but it remains open.
- What a robust implementation would add: a startup diagnostic surface (even a status-bar
  or output-channel line distinct from the generic warning) so "custom providers failed to
  load" is visible to a non-developer user, not just in a console/log a normal user never
  opens; and a lint/wiring test that would fail loudly if a future CLI entry path omitted
  `registerPlatformCliServices`, so `migrateLegacyAuthMethod`'s silent-return branch cannot
  quietly become the normal case again.
