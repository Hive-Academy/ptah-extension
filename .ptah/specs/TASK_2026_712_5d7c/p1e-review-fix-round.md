# P1-E review fix round — Serious finding 1 (Add replay after ledger eviction or restart)

## Chosen fix

The fix makes Add idempotent in storage without a schema change. When a `requestId` is supplied,
`ProviderAccountService.add` derives the profile ID from it: a SHA-256 of a namespaced request id,
formatted as an RFC 4122 v5-shaped UUID. Before it creates anything, the service looks up that
row, including soft-removed rows. The outcomes are:

- **Row active, same label:** the stored account is returned. Nothing is created and no directory is made.
- **Row active, different label:** `conflict`. This matches the contract rule that the same ID with different params is a conflict.
- **Row soft-removed:** `conflict`. An expired request is never silently re-executed, so a removed account is not resurrected.
- **No row:** normal Add path. The profile ID is deterministic, so the directory is too (`.../claude/<profileId>`).

The handler's in-memory ledger stays as the fast path that returns the exact original outcome. The handler now forwards `p.requestId`.

### Evidence

- The profile ID is the table key. `provider-account.store.ts:93` and `:107` select by `profile_id`. Before this change, the service drew a fresh `randomUUID()` on every Add, which is the root cause of the finding (old `provider-account.service.ts:107`).
- Remove is a soft delete. `provider-account.store.ts` `remove()` sets `removed_at`, so the row survives and a replay after removal can be told apart from a request that was never seen.
- Concurrent duplicate across connections or processes: `withNewProviderAccountDirectory` (`provider-account-route.ts:70-74`) refuses an existing directory with `conflict`, and `profile_id` uniqueness backs it in SQL. A second writer with the same request therefore fails closed and cannot create a duplicate.
- No migration is needed. Only existing columns are read (`profile_id`, `label`, `removed_at`).
- The `requestId` passed the handler's strict schema (opaque id, 8 to 64 characters). The service checks it again with `isProviderAccountOpaqueId`, and the derived ID is valid for `isProviderAccountOpaqueId`.

### Options considered

1. **Deterministic profile ID from `requestId` (chosen).** No schema change. Durability comes from the existing primary key. Reversible.
2. **A request ledger table that stores the request id and the committed outcome.** This is the reviewer's general suggestion. It needs a new migration, which is a user decision under the rules for this round, so it was not done.
3. **Persisting the in-memory ledger to a file.** This is a second store and is not atomic with the SQLite commit. Rejected.

### Residual semantics (documented, not defects)

- A replay after the account has been **renamed** returns `conflict`, because the label differs. It never creates a duplicate.
- A replay after an eviction or restart returns the **current** stored summary. The handler bumps its snapshot revision and pushes one notification. Within the ledger window the exact original outcome is still returned.
- If the process crashes between creating the directory and inserting the row, a retry with the same request returns `conflict` because the directory already exists. A new request id works. This fails closed and creates no duplicate.
- Rename, remove and selection replays outside the ledger are already stopped by their expected revisions (CAS), so they get `conflict`, not a second effect. The handler header now states this.

## Changed files (5 of the 6-file cap)

- `libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts:106-116`: new `find(profileId)` that returns the row even when removed, or `undefined`. It is validated with the existing `profileSchema`, and a malformed row maps to `unavailable-storage`.
- `libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts:28-35`: new `profileIdForRequest()`. Lines `101-140`: `add(label, requestId?)` with the replay lookup inside the existing try/catch, so storage failures still map to `unavailable-storage`. The `createHash` import is at `:1`.
- `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts:170`: Add forwards `p.requestId`. The header doc at `:23-29` states the durable rule.
- `libs/backend/auth-providers/src/lib/accounts/provider-account.store.spec.ts:620-648`: three specs on real SQLite.
- `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.spec.ts`: at `:83` the fake `add(label, requestId?)` mirrors the service's keyed idempotency. `setup()` accepts a shared `service`. Lines `:388-424` hold three specs.

There are no DI or token changes. `register.ts` and `claude-account-command.ts` were not touched.

## New specs

`provider-account.store.spec.ts`, real better-sqlite3 with two connections:
- `makes Add idempotent by request ID across a restart: same request returns the stored account`: a new service on a second connection replays the Add. The result is the same summary and there is 1 profile row.
- `creates a new account for a different request ID and refuses a reused one with another label`
- `does not recreate a removed account when its Add request is replayed`

`provider-account-rpc.handlers.spec.ts`:
- `forwards the request ID so a repeated Add after ledger eviction adds no duplicate`: the first Add is followed by 256 more writes, then a replay. The replay returns the same profileId and the profile count stays at 257.
- `a repeated Add on a new handler instance (restart) adds no duplicate`
- `a different request ID still creates a new account`

## Specs that mock changed members

- `ProviderAccountService.add`: the signature is widened with an optional `requestId`, which is backward compatible.
  - `provider-account-rpc.handlers.spec.ts` `FakeAccountService.add`: updated as above.
  - `provider-account.store.spec.ts:606` and `provider-account-actions.service.spec.ts:67` call the real `add('Work')`. They need no change, because without a `requestId` the old random-ID path is unchanged.
- `ProviderAccountStore.find`: new member. Every spec constructs a real `ProviderAccountStore`, and no spec mocks the store.
- `ProviderAccountRpcService` (a `Pick` of the service) is used only by the handler spec.

## Diagnostics

`ptah_get_diagnostics` on the 5 changed files reported 0 errors and 0 warnings (typescript-compiler, coverage clean). No nx, jest, tsc or lint was run, as this round's rules require. The orchestrator should run `npx nx test auth-providers --parallel=1`, `npx nx test rpc-handlers --parallel=1` and typecheck for both.

## Decisions

- **Durable Add idempotency through a deterministic profile ID.** The alternatives were a ledger table (needs a migration) or a file-backed ledger (not atomic). Evidence is above. The change is reversible: callers without a `requestId` keep random IDs.

## Deferred (named later tasks, out of scope)

- **P1E-F2 (Moderate):** a failure to read the snapshot after a commit loses the `provider:accountsChanged` push (`provider-account-rpc.handlers.ts` commit path). This needs a recovery or retry owner.
- **P1E-F3 (Moderate, D30):** the snapshot revision is seeded from `Date.now()`, so it is not monotonic across a restart. It needs a persisted or store-derived revision.
- **P1E-S1 (style, D32):** the agent RPC reads the stored account through a container lookup instead of a constructor `@inject`.
