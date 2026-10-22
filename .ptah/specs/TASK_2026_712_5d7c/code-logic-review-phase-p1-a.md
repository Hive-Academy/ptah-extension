# Code Logic Review — TASK_2026_712_5d7c phase P1-A

Verdict: REVISE

Review family: xAI (grok) reviewing OpenAI (codex) Batches 3–7

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking | 0 |
| Serious | 1 |
| Moderate | 2 |
| Failure modes | 3 |

Score 6 sits in the real-gap band. It is not 7–8: a status read is wired through the sign-in reservation, so `auth_epoch` moves and the row becomes `pending` on a path the action spec already runs once command authorization is stubbed to ok. It is not 3–4: named admission returns `release-held` and does not build a `ClaudeAccountRoute`; uncertain auth rows are left in place on dispose and on unproved kill; canonical identity is realpath plus device/inode with no blanket lowercasing; migration 0058 columns match the store writes; SQL transactions do not cover process awaits; account registration does not touch the database; `libs/backend/agent-sdk` has no import of `@ptah-extension/auth-providers`.

Batches 1–2 were not re-scored. Checked only where Batches 3–7 consume them: the admission port stays a refusal on this service, action sentences come from the closed code table (interim R1), and the shared binding schema is still strict and path-free.

Scope read in full: `provider-account-route.ts`, `provider-account.store.ts`, `provider-account.service.ts`, `provider-account-actions.service.ts`, `claude-account-command.ts`, `0058_provider_accounts.ts`, auth-providers `src/index.ts`, `registerProviderAccountServices` in `di/register.ts`, the admission port, and the shared account/profile/adapter/process contract edits. Specs were sampled for the status, cancel, lease, and env cases. No nx, jest, tsc, lint, or build. `ptah_get_diagnostics` was not run: the ptah tool server is not connected in this session. Host gates stay with CI (D8a).

## Five logic questions

1. Silent failure: a status command whose authorization returns `ok` commits an auth-epoch bump and `pending`, then a later `completeAuth` can store `signed-in` or `disconnected`. Callers see a normal action result. The epoch no longer means “credentials changed.”
2. User action: Read status, or a mocked/released status, on a signed-in profile. Cancel of sign-in still works when the caller passes the post-reserve revision (the action spec re-reads it). Reusing the pre-reserve revision correctly conflicts.
3. Wrong answer: official status JSON `authMethod: "none"` after `signed-in` is stored as `disconnected`, not `signed-out`.
4. Dependency failure: child kill that does not deliver `close` within 2s leaves the operation row and `pending` (intended). SQLite `BUSY`/`LOCKED` becomes `busy`. Other store errors become `unavailable-storage` or `conflict`, not success. `ClaudeAccountCommand.environment` still throws `unsupported-source`, so production sign-in does not spawn.
5. Unspecified but present: `withNewProviderAccountDirectory` records the created inode and uses it only if commit throws. A same-user replace of that empty directory with a link before `realpath` is stored as the link target.

## Failure modes

### Status read consumes a sign-in epoch

- Trigger: `readStatus` → `run(..., 'status')` while `authorization()` is `ok`.
- Symptom: `auth_epoch` increments, `state` is `pending` for the call, then becomes `signed-in` when status JSON says `claude.ai`.
- Evidence: `provider-account-actions.service.ts:47`, `provider-account-actions.service.ts:86-87`, `provider-account.store.ts:229-231`.
- Current handling: production `authorization()` returns `release-held` before `reserveAuth` (`claude-account-command.ts:108`, `provider-account-actions.service.ts:82-83`), so today’s UI does not hit this. The machine under test does (`provider-account-actions.service.spec.ts:134-136` and `:249-254`).
- Recommendation: do not use the sign-in reservation for status. Do not change `auth_epoch` or force `pending` on a read.

### Successful `none` becomes disconnected

- Trigger: terminated status with `authMethod: "none"` when the captured pre-call state is `signed-in`.
- Symptom: the profile is `disconnected` even though the command exited 0 and reported signed out.
- Evidence: `provider-account-actions.service.ts:105-106`. `parseClaudeAccountStatus` accepts `none` at `claude-account-command.ts:84-93`.
- Current handling: non-ok status on a signed-in row correctly becomes `disconnected` (`provider-account-actions.service.ts:103` and spec `:135-136`). The `none` branch shares that label.
- Recommendation: ok + `none` stores `signed-out`. Reserve `disconnected` for a non-ok or unproved read of a previously signed-in route.

### New directory can be retargeted before it is named

- Trigger: after `mkdir` of the new account directory, replace that path with a symlink or junction, then let `resolveProviderAccountRoute` run.
- Symptom: the inserted `canonical_route` and fingerprint are the target’s, which can be an existing credential directory. Cleanup does not remove it, because the inode no longer matches `owned`.
- Evidence: `provider-account-route.ts:69-71` (owned inode taken, then `commit(resolve...)` with no compare); `:73-77` checks the inode only on the failure path.
- Current handling: the plan treats a malicious same-user replacement as outside an OS sandbox. This window is not detected, so it does not meet “detected route changes never silently pass.” Parent creation in the service rejects a symlink parent (`provider-account.service.ts:74-83`); the leaf commit does not.
- Recommendation: before insert, require `lstat(requestedPath)` to match `owned` and not be a link, and require the canonical stat to be that same directory.

## Findings

### 1. Serious — status is reserved as sign-in and advances `auth_epoch`

- File: `libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts:47`, `:86-87`; `libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts:229-231`
- Defect: `readStatus` calls `run` with kind `status`. `reserveAuth` is invoked as `sign-in` for every kind other than `logout`. That update sets `state = 'pending'`, sets `auth_epoch` to the previous epoch plus one, and bumps `revision`. Completion then treats `claude.ai` as `signed-in` because the kind is not `logout` (`provider-account-actions.service.ts:104`).
- Failure scenario: authorization is permitted (tests already do this; a later release would too). A status poll on an idle signed-in profile changes `auth_epoch`. Component 5 treats an epoch change as authentication that needs fresh identity proof, so a read-only status makes a bound run look rebound. Concurrent sign-in or sign-out sees `pending` and gets `busy`. An active run lease still blocks the reserve (`unoccupied(..., true)` at `provider-account.store.ts:302-306`), so this is not an auth action under a live lease.
- Fix: give status its own reservation that does not increment `auth_epoch` and does not set `pending`. Persist `signed-in` / `signed-out` / `not-signed-in` from `authMethod` only after a terminated ok status. Keep the `release-held` short-circuit until D7 is cleared.

### 2. Moderate — ok status `none` on a signed-in profile is stored as `disconnected`

- File: `libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts:105-106`
- Defect: for `authMethod === 'none'`, the expression is `(kind === 'logout' || profile.state === 'signed-out') ? 'signed-out' : (profile.state === 'signed-in' ? 'disconnected' : 'not-signed-in')`. Kind `status` is neither login nor logout. A signed-in row therefore becomes `disconnected`. The plan’s state list uses `disconnected` for a lost or unreachable route and `signed-out` for a successful sign-out observation; `none` means signed out (implementation plan, official-actions state list).
- Failure scenario: the user signs out in the browser, then Ptah status exits 0 with `authMethod: "none"`. The account shows disconnected, and a later resume policy can treat it as an unreachable route rather than signed out. The same branch turns `disconnected` + ok `none` into `not-signed-in`.
- Fix: on terminated ok status, map `claude.ai` to `signed-in` and `none` to `signed-out`. Map non-ok or unproved reads of a signed-in row to `disconnected`.

### 3. Moderate — create-time link swap is committed as the canonical route

- File: `libs/backend/auth-providers/src/lib/accounts/provider-account-route.ts:69-77`
- Defect: `owned` is the inode from `lstat` immediately after `mkdir`. `commit` resolves `requestedPath` with `realpathSync.native` and inserts that result (`provider-account.store.ts:118-129`). Nothing checks that the resolved directory is still `owned`. The inode compare runs only when commit throws, and then it skips removal when the inode differs.
- Failure scenario: a same-user process replaces the empty new directory with a junction to an existing Claude config directory before `resolveProviderAccountRoute`. The profile row’s `canonical_route` and `route_fingerprint` name that existing directory. Failed-commit cleanup leaves the junction in place. Alias handling after a successful create is otherwise sound: fingerprint is `dev` + `ino` + `birthtimeNs` (`provider-account-route.ts:27-35`), duplicate insert matches path or fingerprint (`provider-account.store.ts:121-124`), and there is no `LOWER()` on `canonical_route`.
- Fix: fail the commit unless `lstat(directory)` is still the owned directory and not a link, and the canonical stat’s device and inode are that same directory. Keep non-recursive `rmdir` only for that owned empty inode.

## Checked, not filed

- Alias and case: `realpathSync.native` plus filesystem identity. Case-only names of one inode share a fingerprint. Case-sensitive distinct directories stay distinct. No blanket lowercasing.
- CAS: `reserveAuth` stores `expected_revision` as the post-increment revision and `completeAuth` requires that revision, the owner, and the epoch (`provider-account.store.ts:229-258`). Stale epoch completion does not clear the row (spec `:230-240`).
- Auth versus run leases: sign-in and sign-out call `unoccupied` with runs included; rename, select, and remove do not, so metadata can change during a run and auth cannot (`provider-account.store.ts:139-150`, `:302-306`). `startSignIn` under a lease returns `busy` and does not bump the epoch (spec `:220-227`).
- Uncertain retention: grace without `close` returns `cancelled` and leaves `pending` (spec `:154-162`). `dispose` aborts controllers and does not call `release` (`provider-account-actions.service.ts:29-37`, `provider-account.service.ts:60-63`). `releaseReservation` always returns `conflict` (`provider-account.service.ts:52-54`), which matches D13: this batch must not complete admission. `store.release` is not used by the service.
- Transactions: `atomic` and `setDefault` run synchronous SQL between `BEGIN IMMEDIATE` and `COMMIT`. Child `execute` is outside that transaction.
- Lazy DI: `registerProviderAccountServices` only registers factories (`di/register.ts:149-169`). Constructors do not query. First resolve is the first database use.
- Import cycle: auth-providers imports the agent-sdk detector type. agent-sdk does not import `@ptah-extension/auth-providers`.
- Admission: `admitClaudeRoute` validates the request, optionally loads a named profile, and returns `release-held` (`provider-account.service.ts:36-46`). It does not call `store.admit` and does not return a certified route.
- Migration: every column the store reads or writes exists on the five 0058 tables, including composite uniqueness used by the foreign keys. `0058_provider_accounts` is registered in `migrations/index.ts`. Connection setup turns foreign keys on (`sqlite-connection.service.ts:98`).
- R1: `accountActionResult` copies only `COPY` (`claude-account-command.ts:6-26`). Status parse drops email and organization (`:92-93`). A store error constructed with credential text is not returned (spec `:243-246`).
- Public summary `owner` is always `unknown` (`provider-account.service.ts:161`). Identity proof is a later batch; this phase does not pretend verification.

Residual uncertainty: create-time junction behavior was traced from source, not executed here. Workspace selection keys are raw strings; route canonicalization does not apply to them. No production caller invokes `store.admit`; a later batch that does must certify before insert and must wire proved `release` through the port.

## Public API style

The auth-providers barrel exports `ProviderAccountService` as a value and the admission and action ports as types. It does not export the store, the route helpers, `ClaudeAccountCommand`, canonical paths, or child env. Service returns are summaries (`profileId`, label, provider, state, `owner`, revision, `activeRunCount`) or selection ids and revisions. Duplicate-route text is the fixed no-path sentence.

Shared `ProviderAccountBinding`, summary, selection, and action-result schemas are `.strict()` and reject a directory, env bag, or raw identity. `classifyProviderAccountBinding` maps a present malformed value to `invalid-bound` and only `undefined` to absence. `ProviderProfile` still carries the existing `authEnv` and `cliJsPath`; those fields are not an account-route grant. The optional `accountBinding` cannot smuggle a path through the strict binding schema. Adapter start, resume, and slash configs add optional `accountSelection` only. `SYSTEM_CLI_TYPES` is unchanged. Action sentences stay on the closed code table, so interim R1 is met on this surface. Interim R2 (`export *` in the shared barrel) stays as dispositioned.

## Decisions

- Status epoch bump is a defect even though production `authorization()` is `release-held`. The state machine is the Batch 6 implementation and the spec already drives it with authorization permitted. Options were: waive until release clearance, or revise now. Revise now, because the epoch is the value later resume will trust. Reversible.
- Cancel that fails when passed the pre-reserve revision is correct CAS. The spec’s `command()` helper re-reads `store.get(id).revision` after reserve (`provider-account-actions.service.spec.ts:52`, `:144`). Not filed.
- `certifyClaudeAccountEnvironment` refuses a populated known selector instead of deleting it (`claude-account-command.ts:61-64`), and `environment()` always throws. The auth-env spec locks that refusal, and no resolver is certified. Clearing-by-deletion remains the Batch 8 child-env helper. Not filed.
- `releaseReservation` always returning `conflict` is the D13 fail-closed admission boundary, not a missing unlock. Not filed.
