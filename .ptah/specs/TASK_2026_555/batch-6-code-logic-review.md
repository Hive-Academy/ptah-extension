# Code Logic Review — `TASK_2026_555` Batch 6 (Electron secret-delete pre-check)

## Scope

- Diff reviewed: `git diff -- libs/backend/platform-electron/src/implementations/electron-secret-storage.spec.ts`
  (one new `it` block, lines 163-179 of the file).
- Claims reviewed: `.ptah/specs/TASK_2026_555/batch-6-report.md` against the actual source at:
  - `libs/backend/platform-electron/src/registration.ts:144-149`
  - `apps/ptah-electron/src/di/phase-1-infra.ts:82,123-126`
  - `libs/backend/vscode-core/src/di/register-storage-shims.ts:54-56,69-81`
  - `libs/backend/vscode-core/src/services/auth-secrets.service.ts:122-146,192-229,256-303`
  - `libs/backend/platform-electron/src/implementations/electron-secret-storage.ts` (whole file, 137 lines)
- Verification run myself: `npx jest src/implementations/electron-secret-storage.spec.ts` from
  `libs/backend/platform-electron` → **27 passed, 27 total**, matching the report's claim of 27/27.
- No production code was changed in this batch (report's claim); confirmed — the diff touches only the
  spec file.

## Summary

| Metric              | Value       |
| ------------------- | ----------- |
| Overall score       | 8/10        |
| Assessment          | APPROVED    |
| Blocking issues     | 0           |
| Serious issues      | 0           |
| Moderate issues     | 2           |
| Failure modes found | 2 (both pre-existing, neither introduced by this batch) |

## Five logic questions

### 1. How does this fail silently?

Not in the new test itself. But the underlying implementation it validates has one silent-success path
worth naming: `ElectronSecretStorage.delete` (`electron-secret-storage.ts:105-114`) early-returns when
`!(key in this.secrets)` — a delete of an already-deleted or never-existing key succeeds without calling
`persist()` or firing `onDidChange`. That is correct idempotent behaviour for `auth:deleteStoredKey`
(a double-click or RPC retry should not error), not a defect — but the pre-check report does not call
this out, and Batch 7 should not assume `onDidChange` fires on every successful delete call.

### 2. What user action produces unexpected behaviour?

None found for the code under review. The new test exercises store → delete → reload → get, which is
exactly the "clear an API key, then re-open the app" user action the report claims to prove.

### 3. What input data produces a wrong answer?

Nothing in the new test's own logic. One divergence exists elsewhere in this file (documented in the
file's own comment at lines 72-78): empty-string values round-trip differently between the encrypting
and VS Code SecretStorage implementations. Unrelated to `delete`; pre-existing and already flagged as a
known follow-up, not introduced by this batch.

### 4. What happens when a dependency fails?

This is the one real gap. `delete()` chains `persist()` through `this.writePromise` (`:108-111`) and
`await`s it (`:112`) before firing the change event. If `persist()` rejects — e.g. `fsPromises.rename`
fails because of a locked file, a full disk, or a permissions error — the rejection propagates out of
`delete()` as a thrown error. Neither the new test nor the report exercises this path, and the report's
"Risks handled" section does not mention it. This matters directly for Batch 7: `AuthDeleteStoredKeyResult`
is typed `{ success: boolean; error?: string }` (implementation-plan.md:295), so the handler must catch
this rejection and map it to `{ success: false, error }` rather than let it escape as an unhandled
RPC-layer exception. The pre-check's "delete persists on disk" claim is proven only for the happy path;
the failure path is unverified and unmentioned.

### 5. What is missing that the requirements never mentioned?

The plan's checklist item (implementation-plan.md:323-332) asked only to verify that delete removes the
entry and that a later `get` returns `undefined` — the report and test do exactly and only that, which is
in scope. Not asked, and therefore not a gap in this batch, but worth flagging forward to Batch 7:
concurrent delete/store ordering under real RPC latency (two `auth:deleteStoredKey` calls for the same
key in flight) is not covered anywhere yet; the `writePromise` chain (`:97-101`, `:108-111`) does serialize
persists correctly in-process, so this is very likely safe, but no test proves it.

## Failure modes

### Persist rejection during delete is unhandled by the caller contract

- Trigger: `fsPromises.writeFile`/`fsPromises.rename` in `persist()` (`electron-secret-storage.ts:125-135`)
  throws (disk full, permission denied, AV lock on Windows).
- Symptom: `delete()` (`:105-114`) throws instead of resolving; a caller awaiting it without a try/catch
  sees an unhandled rejection.
- Evidence: `electron-secret-storage.ts:108-112` — no catch around the awaited `writePromise`.
- Current handling: none in this library; not exercised by the new spec.
- Recommendation: not a defect in Batch 6 (out of its stated scope), but should be an explicit item in
  Batch 7's handler design — wrap the `authSecrets.deleteCredential`/`deleteProviderKey` call in a
  try/catch and return `{ success: false, error: ... }` on rejection, matching the typed result contract.

### Test double never exercises real OS-backed encryption for the delete path

- Trigger: `createEncryptingSafeStorage()` in the spec (`electron-secret-storage.spec.ts:28-36`) is a
  reversible plain-text-to-buffer identity encoding, not real Electron `safeStorage` (DPAPI/Keychain/
  libsecret).
- Symptom: none for `delete` specifically — `delete()` never calls `encryptString`/`decryptString`, so this
  gap does not affect the correctness of the new test's claim. It does mean no test in this file (new or
  old) proves delete-then-reload survives a real OS keychain being locked or unavailable between the two
  instantiations.
- Evidence: `electron-secret-storage.spec.ts:28-36`, `:163-179`.
- Current handling: matches the file's pre-existing convention (all other tests in this file use the same
  fakes); not a regression introduced by this batch.
- Recommendation: no action required for Batch 6. Worth a follow-up note if a future task needs to prove
  reload survives a locked/unavailable OS keychain — out of this batch's scope.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Moderate — `electron-secret-storage.ts:108-112`: persist failure during delete is unhandled and
  unmentioned in the pre-check's risk list; Batch 7 needs to own this explicitly (see failure mode above).
- Minor — the report's "Full suite ... passed 35 of 38 / 53 of 55" figures were not independently
  re-verified by this review (only the targeted spec file was rerun, as instructed); they are plausible
  and attributed to pre-existing, unrelated stress-test flakiness, but they remain a self-report.

## Data flow

1. `EXTENSION_CONTEXT.secrets.delete(key)` (`register-storage-shims.ts:74-75`) — OK, delegates directly to
   the resolved `PLATFORM_TOKENS.SECRET_STORAGE` instance, confirmed at `registration.ts:144-149` to be the
   `ElectronSecretStorage` constructed with `options.userDataPath` and `options.safeStorage`.
2. `AuthSecretsService.deleteCredential`/`deleteProviderKey` (`auth-secrets.service.ts:219-222, 300-302`) —
   OK, both compute a namespaced key (`ptah.auth.anthropicApiKey` vs `ptah.auth.provider.<id>`, confirmed
   at `:127-129, 256-257`) and call `context.secrets.delete(secretKey)`. Distinct namespaces, no collision
   risk between the two call sites, and both converge on the same generic `ElectronSecretStorage.delete`.
3. `ElectronSecretStorage.delete` (`:105-114`) — OK for the happy path: removes the in-memory entry, queues
   and awaits `persist()`, fires `onDidChange`. Gap: an unhandled persist rejection propagates as a thrown
   error (see failure mode above) — untested, unmentioned, but out of this batch's stated scope.
4. `persist()` (`:125-135`) — OK: writes to a `.tmp` file and renames over the real target, avoiding a
   torn write on crash mid-write.
5. New instance construction → `loadSync()` (`:53, 116-123`) — OK: reads the real file from disk
   synchronously; the new test's `second` instance shares the same temp directory as `first`
   (`electron-secret-storage.spec.ts:93-97, 163-178`), so this is a genuine disk-backed reload, not an
   in-memory illusion.
6. `get(key)` (`:56-57`) — OK: `!(key in this.secrets)` after a real reload from the post-delete file
   correctly returns `undefined`, which the new test asserts.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Trace `EXTENSION_CONTEXT.secrets` → `ElectronSecretStorage` with file:line | COMPLETE | None — every cited line in the report matches the actual source exactly |
| `setCredential('apiKey','')` → delete, cited `:193-196` | COMPLETE | Actual lines are 192-196; a one-line offset, immaterial |
| `deleteProviderKey` cited `:300-302` | COMPLETE | Matches exactly |
| Delete must survive reload, not just the in-memory map | COMPLETE | New test proves this against a real temp-dir file, sharing the directory across two constructed instances |
| "The handler must not ship on the unverified assumption" (plan:332) | COMPLETE | No code change was needed; the assumption was verified true, and the report is explicit about why no `electron-secret-storage.ts` change was made |
| Batch 6 verification command run | COMPLETE | Re-run independently; 27/27 passed, matches report |

Implicit requirements not addressed: persist-failure error propagation contract for Batch 7 (see Failure
modes); not stated in the plan's checklist item, so not a fault of this batch, but a real forward
dependency.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Delete an existing key, reload, get | YES | New test, real disk | None |
| Delete a missing key | YES | Pre-existing test (`:… "delete on a missing key does not throw"`) | None |
| Delete, then reload with encryption toggled off/on | NO (not tested) | N/A | Low risk — `delete()` never touches `encryptString`/`decryptString`; only `get`/`store` do, and those paths are already covered by other tests in this file |
| Persist rejects during delete | NO | N/A | See failure mode above — Batch 7's concern, not Batch 6's stated scope |
| Two `auth:deleteStoredKey` calls racing for the same key | NO | N/A | `writePromise` chaining likely serializes correctly, but nothing proves it |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking Batch 7 — the persistence claim is proven correctly for the happy path with a
  real on-disk reload across two constructed instances, and every file:line citation in the report was
  checked against the actual source and found accurate.
- What a robust implementation would add: an explicit note (even one sentence) in the report's "Risks
  handled" section acknowledging that persist-failure propagation during delete is untested and must be
  handled by Batch 7's RPC handler contract (`{success, error?}`), so the next batch does not silently
  inherit an unhandled-rejection path.
