# Batch 8 WP-a report — TASK_2026_719_4f64

Status: COMPLETE. All 6 files are edited. ESLint finds 0 errors in them. The store spec passes
63/63. The only remaining type errors exist because WP-b has not yet rewritten
`ClaudeAccountCommand` and the actions service; they are listed exactly under "Verification".

## Files (all modified)

- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts`
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/provider-account.store.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/di/register.ts`
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/di/register.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.activation.spec.ts`

Helper edit scripts (outside the worktree, not deliverables) are in `D:/projects/ptah-extension/.ptah/tmp/b8a-*`.

## What was done

### Store (`provider-account.store.ts`)

- `admit` and the old `commitRunBinding` alias are removed. They are replaced by
  `acquireRunLease` and a new `commitRunBinding`.
- `acquireRunLease(request: AccountRunAdmission): AccountRunLease`. It runs in one immediate
  transaction, in this order:
  1. selection CAS;
  2. `routeProfile`;
  3. `unoccupied(fp,false)`, so an auth op in progress is reported as `busy` first;
  4. a named profile must be `signed-in` with a non-null `identity_ref`, otherwise
     `identity-unproved`;
  5. on resume, an existing binding must match the profile and have an epoch at most the
     profile epoch, otherwise `conflict`; a fingerprint or route-revision mismatch is
     `route-changed`;
  6. the lease is inserted with the profile `auth_epoch` and `route_revision`, `live`.

  It returns `{ reservation (phase 'reserved'), binding | null }` and never inserts a binding.
- `commitRunBinding(AccountRunBindingCommit): Promise<ProviderAccountBinding>`:
  - The lease must be live, owned and at the given epoch, for the same run, and named.
  - The profile epoch must still be equal, and the profile route must equal the lease route
    (otherwise `route-changed`).
  - The identity must be `known` (otherwise `identity-unproved`).
  - There must be no binding yet for the run.
  - The binding is built from the lease columns. No lease is inserted.
- `held()` reads `auth_epoch` and `lease_state` (plus the columns it needs for the returned
  record). It requires `live` and an equal epoch, otherwise `conflict`. The old COALESCE read is
  gone.
- `release(command)` validates `reason`, then deletes the row. It returns a frozen
  `ClaudeAccountRunReservation & { phase: 'released' }`.
- `retain(command)` only checks. It returns `{ phase: 'retained' }`.
- `identityRef(profileId): string | null` is new.
- `completeStatus(..., terminated, identityRef?)` and `completeAuth(..., state, identityRef?)`
  take an optional identity reference:
  - `undefined` keeps the stored value;
  - `null` clears it;
  - a string must be printable ASCII with no space and at most 256 characters, otherwise
    `conflict`.
- `profileSchema` gains `identity_ref`, which needs migration 60.
- D18 `no-control-regex` (old line 16) is fixed: `isSafeSdkSessionId` is a char-code check. It
  accepts exactly the same set as the old regex.

### Service (`provider-account.service.ts`)

- Constructor: `(store, connection, @inject(ClaudeRouteCertifier) certifier)`.
- `admitClaudeRoute(request)`:
  1. Validates the request with zod. `workingDirectory` is optional and must be absolute, have
     no NUL and be at most 4096 characters.
  2. Refuses `omitted` or `ambient` with `conflict`.
  3. Calls `store.get`, then `resolveProviderAccountRoute`, then `acquireRunLease` with a
     `randomUUID()` reservation id.
  4. Calls `certify` with:
     - `cwd = workingDirectory ?? canonicalPath`;
     - `settingSources` `['user','project','local']`;
     - the disposal abort signal.
  5. On a refusal it calls `release(startup-failure)` if every child close was proved, otherwise
     `retain`. If `certify` throws, it retains the lease and refuses `identity-unproved`.
  6. On success it returns `{ code:'ok', reservation, resources:{ kind:'named', route, accountDataDir: canonicalPath, filesystemIdentity, launch } }`.
- `releaseReservation` and `retainUnresolvedReservation` delegate to the store and map store
  errors to typed refusals. After disposal they return `unavailable-storage`.
- `commitRunBinding` delegates to the store.
- `readStoredSelection` (the `ClaudeAccountSelectionReader` contract) fails closed: on a storage
  error it throws and never returns null.
- `dispose()` also aborts any certification in flight.

### Registration (`register.ts`)

- `ClaudeRouteCertifier` (factory):
  `new ClaudeRouteCertifier(c.resolve(ClaudeAccountCommand), process.platform, certifierFs)`.
  - `certifierFs` adapts `node:fs/promises` as `readFile(p,'utf8')`, `lstat`,
    `readdir(p,{withFileTypes:true})` and `stat` (D14 note 1).
- `ClaudeLoginConsole` (factory): `(SDK_PROCESS_SPAWNER, process.platform)`.
- `SDK_PROVIDER_ACCOUNT_SELECTION_READER`:
  - the service singleton when `isRegistered(SQLITE_CONNECTION, true)`;
  - otherwise a reader that returns `{ profileId: null }`.
- Without SQLite, admission refuses `unavailable-storage`. Release and retain stay `conflict`.
- The persistence adapter is not registered.

### Specs

- **`provider-account.store.spec.ts`**:
  - Migrations are `[58, 59, 60]`.
  - The `add()` fixture records `signed-in` plus an identity reference.
  - New helpers: `bind`, `commit`, a `certifier()` fake (the real prototype with only `certify`
    replaced; no namespace spy) and `accountService()`.
  - D18 `no-unexpected-multiline` (old line 132) is fixed.
  - New cases cover:
    - the post-migration row (b): retain at 4, release at 0 is `conflict`, release at 4 deletes it;
    - quarantined named-without-binding and ambient rows: never settled, and they block auth;
    - the pre-binding lease at epoch 3 after three sign-in cycles is released (pins the
      COALESCE bug);
    - `identity-unproved` when the profile is not signed in or has no identity reference;
    - resume returns the binding, with no second binding and no second live lease;
    - three routes coexist;
    - admission: success with launch and cwd; closed refusal releases; unproved refusal
      retains; default, malformed and busy requests refuse before certify;
    - `readStoredSelection`.
- **`register.spec.ts`**:
  - Without SQLite: admission returns `unavailable-storage` with the COPY summary, and the
    reader returns `{ profileId: null }` and is a singleton.
  - With SQLite: the reader is the admission service singleton. `ClaudeRouteCertifier` and
    `ClaudeLoginConsole` resolve as cached singletons without reading the DB.
  - With a busy DB: release and retain return `busy` (they now reach the store).
  - The two disposal cases (`container disposal stops account actions…` and
    `releases a never-spawned sign-in at once on disposal…`) are removed, together with their
    now-unused imports, `AccountChild` and the `platform-core` `jest.mock`. They spied on
    `commands.authorization` and `commands.environment`, which WP-b deletes. WP-b must re-cover
    them; see the contract below.
- **`activation.spec.ts:346`**: the pin is now `unavailable-storage`.

## Verification (run from the worktree)

- `ptah_get_diagnostics` with `files` set to the 6 files, run twice: "TypeScript check still
  running after 45s", so it was unavailable. Fallback used:
  `npx tsc -p tsconfig.lib.json --noEmit` and `npx tsc -p tsconfig.spec.json --noEmit` in
  `libs/backend/auth-providers`. The only errors are the three expected WP-b errors:
  - `src/lib/di/register.ts(171,7): TS2345 Argument of type 'ClaudeAccountCommand' is not assignable to parameter of type 'ClaudeCliProbe'` (missing `certifyExecutable`, `status`, `logout`, `queryRegistry`).
  - `src/lib/accounts/provider-account-actions.service.spec.ts(66,15): TS2554 Expected 3 arguments, but got 2` (the `ProviderAccountService` constructor gained the certifier).
  - `src/lib/accounts/provider-account-actions.service.spec.ts(266,11): TS2339 Property 'admit' does not exist on type 'ProviderAccountStore'`.
- rpc-handlers was not typechecked separately. The activation edit changes one string literal
  only.
- `npx eslint <6 files>`: 0 errors and 1 warning. The warning is the pre-existing unused
  `rollbackError` in `setDefault` (`provider-account.service.ts:276`), in code I did not
  change. The D18 errors in the store and store spec are gone.
- `npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/accounts/provider-account.store.spec.ts --maxWorkers=2`:
  63 passed, 0 failed.
- `register.spec.ts` with the same command: the suite fails to compile only on the expected
  `register.ts(171,7)` TS2345 above. It runs once WP-b lands. The team-leader's B8 verify
  covers it.

## Specs that mock or pin changed members (rule 5, grep)

- `provider-account-actions.service.spec.ts:66` (service constructor) and `:266`
  (`store.admit`): WP-b must update both.
- `completeAuth` calls at `:187` and `:277-284` stay valid (the new parameter is optional).
- `provider-account-actions.service.ts:110,122` calls `completeStatus`/`completeAuth`. These
  calls stay valid; WP-b should pass `identityRef`.
- agent-sdk `session-query-executor.service.ts:561` and cli-agent-runtime
  `claude-sdk-lane-runner.ts:244` call `commitRunBinding` on their own persistence ports (the
  B9 adapter), not on this store. They are unaffected.
- Admission `release-held` pins: `register.spec.ts` and `activation.spec.ts:346`. Both are
  updated.
- No ambient-path pin (plan 943-953) was touched.

## Risks

| Risk | How it was handled |
| --- | --- |
| D14 note 1 | `stat` is passed in the factory. |
| No-SQLite admission | Refuses `unavailable-storage`; both pins are updated. |
| Legacy quarantine and the COALESCE bug | Pinned by store cases. |
| Silent fallback to the default account | `readStoredSelection` throws on a storage error. |
| Rule compliance | No `process.cwd()`. No `jest.spyOn` on module namespaces. No `process.env` mutation. No path logging. |

Coverage gap: plan pin (d), a binding whose fingerprint differs, is not added. `held()` judges
quarantine by `lease_state` only, which the migration sets.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| `acquireRunLease` reads the existing binding from the DB rather than taking `existingBinding?` | caller value vs authoritative row | plan 628-634 | yes |
| `unoccupied` runs before the signed-in check | plan order vs `busy` first | existing "auth excludes admission" pin expects `busy` | yes |
| Ambient or omitted admission refuses `conflict` | `conflict` or `release-held` | plan 647; the `release-held` copy is retired | yes |
| `accountDataDir` is the canonical profile directory | — | no consumer yet (grep); the profile directory is Ptah-owned | yes |
| Actions/command disposal cases leave the store spec and `register.spec` | keep or move to WP-b | they construct the classes WP-b rewrites | yes |

## Contract for WP-b

### Store (`ProviderAccountStore`)

- `acquireRunLease(AccountRunAdmission): AccountRunLease`.
  `AccountRunAdmission = { profileId, expectedRevision, route, runId, reservationId, operationId, selection? }`.
  It has no `identity` field.
- `commitRunBinding({ reservationId, operationId, authEpoch, runId, identity }): Promise<ProviderAccountBinding>`.
- `release(ClaudeAccountReservationRelease)` returns `ClaudeAccountRunReservation & { phase:'released' }`.
- `retain(ClaudeAccountReservationRetain)` returns the same with `phase:'retained'`.
- `identityRef(profileId): string | null`.
- `completeStatus(op, owner, epoch, state, terminated, identityRef?)` and
  `completeAuth(op, owner, epoch, state, identityRef?)`:
  - pass the parsed status `identityReference` when the status proves `signed-in`;
  - pass `null` after sign-out;
  - a named run needs `signed-in` and a non-null `identity_ref`.
- `reserveAuth`, `reserveStatus`, `get`, `list`, `add`, `select` and the other members are
  unchanged.
- `store.admit` is gone. Fix `provider-account-actions.service.spec.ts:266`.

### Service (`ProviderAccountService`)

- Constructor: `(store, connection, certifier)`. Fix `provider-account-actions.service.spec.ts:66`.
  - A spec fake that avoids a namespace spy:
    `Object.assign(Object.create(ClaudeRouteCertifier.prototype), { certify: jest.fn(...) })`.

### Command (`ClaudeAccountCommand`)

- `register.ts` calls
  `new ClaudeRouteCertifier(c.resolve(ClaudeAccountCommand), process.platform, certifierFs)`,
  so the command must structurally satisfy `ClaudeCliProbe`:
  - `certifyExecutable(signal)`;
  - `status(context, signal)`;
  - `logout(context, signal)`;
  - `queryRegistry(path, signal)`.

  This clears `register.ts(171,7)`.
- Keep the constructor `(detector, spawner)`; the factory passes `SDK_CLI_DETECTOR` and
  `SDK_PROCESS_SPAWNER`.
- Keep exporting `accountActionResult`; `register.ts` and the service import it. Change the
  `release-held` COPY text to "Named accounts are not available on this host."

### Actions (`ProviderAccountActionsService`)

- Constructor: `(@inject(ProviderAccountStore) store, @inject(ClaudeAccountCommand) commands, @inject(ClaudeRouteCertifier) certifier, @inject(ClaudeLoginConsole) loginConsole)`.
  - All four class tokens are registered in `register.ts`.
  - The actions registration (`useClass`, Singleton) and the `SDK_PROVIDER_ACCOUNT_ACTIONS`
    alias are unchanged.
- Call `loginConsole.fallbackScript(context)` with one argument.
- In `register.spec`, a host test can override the certifier and console with
  `c.registerInstance(ClaudeRouteCertifier, fake)` and
  `c.registerInstance(ClaudeLoginConsole, fake)`.

### Coverage WP-b must re-add

These cases were removed from WP-a specs because they construct the classes WP-b rewrites.
Add them to the actions or command spec:

1. Disposal waits for a bounded status, login or logout termination, retains an unproved
   operation, and refuses every new action afterwards.
2. Disposal aborts a cancellation status recheck and retains its unproved operation.
3. Container disposal stops a pending sign-in. With proved close it settles (`cancelled`, no
   operation row); with unproved close it keeps `pending` and the operation row. No listener or
   timer is left behind.
4. A never-spawned sign-in is released at once on disposal, without waiting out the 2 s grace
   and without calling `killProcessTree`.
