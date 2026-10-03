# Code Logic Review — `TASK_2026_555` Batch 2

**DISCLOSURE:** This is a same-side, in-process review. The reviewer runs in the same
session context as the batch's author (an in-process backend-developer); all CLI lanes
were unavailable (out of quota), so no cross-vendor or cross-process lane review was
possible for this batch. Findings below are independently re-derived from the repository
(fresh greps, fresh reads, fresh test runs) rather than taken on the author's word, but the
structural independence a CLI lane would provide is absent. Treat this review as a
diligent self-check, not an adversarial second opinion.

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 2                                    |
| Failure modes found | 2 (both pre-existing, correctly disclosed, not caused by this batch) |

## Scope note

This batch is spec-only (no production code changed) and its job was narrow: prove that a
rejecting settings write cannot abort `bootstrapVscode`, `bootstrapElectron`, or
`withEngine`. That is a narrower question than "is settings-write error handling correct
everywhere" — e.g. whether a rejected migration silently loses user data is out of this
batch's scope and is exactly what the two pre-existing issues below flag for a later batch.

## Five logic questions

### 1. How does this fail silently?

Not introduced by this batch (no production code touched), but the batch's own survey
surfaces one real silent-failure path it did not fix (correctly, since fixing was out of
scope and the report says so): when the settings `MigrationRunner` rejects,
`customProviders.load()` inside the same `try` never runs
(`apps/ptah-extension-vscode/src/activation/bootstrap.ts:104-125`, mirrored at
`apps/ptah-electron/src/activation/bootstrap.ts:246-268`). Activation proceeds and logs a
"non-fatal" warning, but user-defined provider ids silently do not resolve for that
session — the user sees no distinct symptom for "custom providers missing" vs. "everything
fine." Verified independently by reading `bootstrap.ts:104-126`: the `try` opens before
`registerVscodeSettings`, `migrationRunner.runMigrations()` is at line 108, and
`customProviders.load()` is at line 115, both inside the one try/catch whose `catch
(settingsError)` at line 126 only logs.

### 2. What user action produces unexpected behaviour?

None from this batch itself (it adds assertions, not behaviour). The pre-existing gap it
surfaces: a user with custom providers configured, on a machine where `~/.ptah/settings.json`
is briefly unwritable (e.g. antivirus lock, read-only mount, disk full), starts the app and
finds custom-provider-backed chats fail to resolve a provider — with no error message
naming "custom providers" specifically, only the generic settings-migration warning in the
console/log, which a non-developer will not see.

### 3. What input data produces a wrong answer?

Confirmed by re-derivation, not just accepted from the report:
`migrateLegacyAuthMethod` (`libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts:519-537`)
resolves `Symbol.for('WorkspaceProvider')` (line 105/525), while the platform DI token is
`PLATFORM_TOKENS.WORKSPACE_PROVIDER = Symbol.for('PlatformWorkspaceProvider')`
(`libs/backend/platform-core/src/di/tokens.ts:25`). These are two different symbols. In
every real container no registration exists for `Symbol.for('WorkspaceProvider')`, so
`container.resolve` throws, the function's own `catch { return; }` (line 527-529) swallows
it, and the `claudeCli` → `claude-cli` migration silently never runs in production. A user
whose settings still carry the old `claudeCli` spelling never gets migrated by this path
(it is presumably reconciled elsewhere, but not here). The new `with-engine.spec.ts` test
only exercises this path because the spec itself registers `Symbol.for('WorkspaceProvider')`
in its `byToken` map (`with-engine.spec.ts:+218`) — which is the correct choice for proving
"startup survives," but it means the passing assertion
`expect(setConfiguration).toHaveBeenCalledWith('ptah', 'authMethod', 'claude-cli')` would
not hold against the real production container, only against this test's synthetic one. The
batch report discloses this accurately as a pre-existing, unfixed issue; it is not
mischaracterized as fixed.

### 4. What happens when a dependency fails?

This is the batch's core subject and it is verified, not merely asserted. Independently
re-run (see Verification below): with `MigrationRunner.runMigrations`,
`migrateLegacyAuthMethod`'s underlying `setConfiguration`, and the real
`runCursorApiKeyMigration`'s `setConfiguration` all rejecting with a real
`SettingsPersistError('EACCES')` (not a thrown string), `withEngine` still resolves the
caller's function result, and both app-level bootstrap functions have their Cursor-key step
proven structurally unreachable-to-abort via the source-scanning assertions plus a
behavioural run of the real migration function against a rejecting fake provider. Each spec
also asserts the plaintext legacy key never appears in any logged text
(`loggedText`/`logged` helpers), which is a real check against credential leakage on the
error path, not just an existence check.

### 5. What is missing that the requirements never mentioned?

- No test proves the two SDK-adapter writes (`model.selected` default and legacy-name
  migration, `sdk-agent-adapter.ts:493-494,504`) survive a rejecting write from inside
  `withEngine`'s own test — the `with-engine.spec.ts` case runs with `requireSdk: false`,
  so the SDK adapter's `initialize()` is not exercised through this path at all. The batch
  report's survey (row 3/4) relies on reading `sdk-agent-adapter.ts:490-511`'s own
  try/catch rather than a rejecting-write test through any of the three hosts. This is a
  legitimate, disclosed scope boundary (the SDK adapter is untouched, unowned production
  code) but it means "all six startup writes are tested to survive rejection" is not
  literally true — two of the six are verified by code reading only, not by a rejecting
  fake in this batch's specs. The report itself does not overclaim this (it says "six ...
  every one is contained," which is about containment, not about which ones got a new
  behavioural test), so this is a completeness gap in coverage, not a misrepresentation.
- No test covers concurrent/repeated rejection (e.g. the same writer rejecting on every one
  of several retries at next boot) — out of scope for "startup survives one rejection,"
  reasonable to leave for a retry-logic batch.

## Failure modes

### customProviders.load() skipped after a rejecting migration (pre-existing, disclosed)

- Trigger: `migrationRunner.runMigrations()` rejects (e.g. `settings.json` unwritable).
- Symptom: activation continues (correct), but custom provider ids silently do not resolve
  for the session; the user sees a generic "non-fatal" console warning, not a specific one.
- Evidence: `apps/ptah-extension-vscode/src/activation/bootstrap.ts:104-126`;
  `apps/ptah-electron/src/activation/bootstrap.ts:246-268`.
- Current handling: caught by the same try/catch as the migration runner; not logged
  distinctly.
- Recommendation: not this batch's job (correctly out of scope; batch made no production
  change and disclosed this). Worth a follow-up ticket to log
  "custom providers not loaded" distinctly from "migrations failed," since the current
  single warning conflates two different user-visible consequences.

### migrateLegacyAuthMethod resolves an unregistered token (pre-existing, disclosed)

- Trigger: any real CLI boot; no container registers `Symbol.for('WorkspaceProvider')`.
- Symptom: the `claudeCli` → `claude-cli` authMethod migration never runs in production;
  no error surfaces anywhere (the function's own catch silently returns).
- Evidence: `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts:105,519-537` vs.
  `libs/backend/platform-core/src/di/tokens.ts:25`.
- Current handling: swallowed by `catch { return; }` at line 527-529 — indistinguishable
  from "the setting was already correct."
- Recommendation: not this batch's job (disclosed, pre-existing, no production change
  made). Worth flagging to whichever batch owns CLI DI wiring: either register
  `WORKSPACE_PROVIDER_TOKEN` against the same instance as `PLATFORM_TOKENS.WORKSPACE_PROVIDER`,
  or change `migrateLegacyAuthMethod` to resolve the platform token directly.

## Blocking issues

None found in the reviewed diff.

## Serious issues

None found in the reviewed diff.

## Moderate and minor issues

1. **Moderate** — `with-engine.spec.ts`'s new case exercises three of the six surveyed
   startup writers rejecting at once, not all six; the SDK-adapter writes are covered only
   by reading `sdk-agent-adapter.ts`, not by a rejecting-fake test reached through
   `withEngine`, `bootstrapVscode`, or `bootstrapElectron`. Low risk (the code read is
   correct and the containment is real), but the batch's own framing ("every one is
   contained") rests partly on static reading rather than uniform behavioural proof across
   all three hosts. `with-engine.spec.ts:+206-306`.
2. **Minor** — the VS Code and Electron specs' structural assertions parse `bootstrap.ts`'s
   own source text with regex/string search (`BODY.indexOf(...)`, `findCatchEnd`) rather
   than a static-analysis approach. This is consistent with the existing pattern in the
   same file (the pre-existing "runs after settings migrations" test uses the identical
   technique), so it is not a new pattern this batch introduced, but it remains brittle to
   any reformatting of `bootstrap.ts` (e.g. renaming the catch variable, or reformatting
   with a different brace style) — a refactor could silently defeat the structural
   assertion without the source's actual behaviour changing. `bootstrap.cursor-key.spec.ts:60-105`
   (both apps).

## Data flow

1. Rejecting fake provider constructed with real `SettingsPersistError('EACCES')` in each
   spec — OK, matches the failure shape `PtahFileSettingsManager.set()` produces.
2. VS Code/Electron: `runCursorApiKeyMigration` called directly against the fake — OK,
   resolves, warns with `errorType` only, key never logged (verified by `loggedText`
   assertion).
3. VS Code/Electron: structural proof that `runMigrations()`'s catch never rethrows and
   sits before the (out-of-try) Cursor step — OK, re-derived independently from
   `bootstrap.ts` source, matches the spec's claims.
4. CLI: `withEngine` run end-to-end with three writers rejecting simultaneously (settings
   `MigrationRunner`, `migrateLegacyAuthMethod`'s writer, and the real
   `runCursorApiKeyMigration`) — OK, `withEngine` resolves `fn`'s result, both stderr lines
   and the logger warning are asserted, and the plaintext key is asserted absent from all
   captured output.
5. SDK-adapter writers (#3, #4 in the survey) — not run through any host in this batch;
   containment confirmed only by reading `sdk-agent-adapter.ts:490-511`. Gap noted above.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Survey every startup settings write and its containment | COMPLETE | Independently re-derived and confirmed: six writes found, all six's containment code verified directly (four behaviourally in this batch's specs, two — SDK adapter — by source reading only). No unguarded write found. |
| Specs use a real `SettingsPersistError`, not a thrown string, and assert startup continues | COMPLETE | All three files construct `new SettingsPersistError('EACCES')` and assert `.resolves.toBe(...)`/`.resolves.toBeUndefined()`, not merely `toHaveBeenCalled()`. |
| Report the two pre-existing issues accurately | COMPLETE | Both re-verified independently at the cited file:line locations; descriptions match the code exactly. |
| Stop-and-report if a bootstrap path does not survive | N/A | Every path survived; the rule did not trigger, and the report says so. |

Implicit requirements not addressed: a rejecting-write test that reaches the SDK-adapter's
two writes through an actual host bootstrap (see Moderate #1) — reasonable to defer since
the SDK adapter is untouched code and its own containment is independently sound.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Settings write rejects with real `SettingsPersistError` | YES | Fake provider throws the real error class in all three specs | None |
| Rejecting write's error value/key never leaked to logs | YES | `loggedText`/`logged` helpers assert absence of the plaintext key across every logger/stderr call | None |
| All three "startup" writers reject simultaneously (CLI) | YES | `with-engine.spec.ts`'s new case | Only 3 of 6 surveyed writers are exercised this way; SDK adapter's 2 writers are not |
| Bootstrap source structurally never rethrows from the settings catch | YES | Regex/string-scan of `bootstrap.ts` in both app specs | Brittle to unrelated reformatting (Minor #2) |
| `migrateLegacyAuthMethod` against the real (unregistered) production token | NO | Not tested against the real token — the spec deliberately registers the token to prove containment, not to prove the migration runs in production | Pre-existing dead-code path stays untested against reality; already disclosed as a known issue, not silently ignored |

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM (same-side review only; no independent CLI lane was available to
  cross-check, though all claims here were re-derived from the repository rather than
  taken from the author's report)
- Top risk: the batch's "every one is contained" claim is proven behaviourally for 4 of 6
  surveyed writers and by code-reading alone for the other 2 (SDK adapter); if that reading
  is ever wrong, no test in this repository would currently catch a regression there.
- What a robust implementation would add: a `with-engine.spec.ts` (or SDK-adapter-level)
  case that drives `SdkAgentAdapter.initialize()` with a rejecting `config.set`, to make
  the "six for six, all behaviourally proven" claim literally true; and a follow-up ticket
  (not this batch) for the two disclosed pre-existing issues, since both are real,
  currently-silent gaps a future incident could surface without any test failing today.
