# Batch 5 implementation report

Implemented canonical filesystem routes and a synchronous transactional Claude account store. Only the five assigned source/package files and this report were written. No git, Nx, Jest, tsc, lint, build, server or e2e commands were run.

## Files changed

Workspace: `D:/projects/ptah-extension/.claude-worktrees/provider-accounts`.

- CREATED `libs/backend/auth-providers/src/lib/accounts/provider-account-route.ts`
- CREATED `libs/backend/auth-providers/src/lib/accounts/provider-account-route.spec.ts`
- CREATED `libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts`
- CREATED `libs/backend/auth-providers/src/lib/accounts/provider-account.store.spec.ts`
- MODIFIED `libs/backend/auth-providers/package.json`: added `@ptah-extension/persistence-sqlite: 0.0.1`.
- CREATED `.ptah/specs/TASK_2026_712_5d7c/implementation-report-batch-05.md`.

All four TypeScript files are below 400 lines. Existing migration, contracts, registration and barrel files were not changed.

## Public API

### Route

- `CanonicalProviderAccountRoute`: backend-only requested path, canonical realpath, shared `ClaudeAccountFilesystemIdentity`, immutable SHA-256 fingerprint. Device/inode plus creation time form the fingerprint; path case is never folded. Both route and identity objects are frozen.
- `resolveProviderAccountRoute(directory)`: requires an absolute existing directory and usable physical identity. Resolves symlinks/junctions. Missing/unresolvable/unsupported routes fail closed with a safe typed error.
- `revalidateProviderAccountRoute(route)`: checks original requested path, realpath, fingerprint and identity again; replacement/retargeting becomes `route-changed`.
- `withNewProviderAccountDirectory(directory, synchronousCommit)`: creates only the final directory, without recursive parent creation or adoption. On failure, removes only that attempt's still-identical empty directory using non-recursive `rmdir`. Existing, replaced and populated directories remain untouched.
- `ProviderAccountStoreError`: shared result `code` and safe sentence; filesystem/SQLite errors and paths are not copied into messages. Duplicate-directory summary uses the shared exact copy.

### Store

`ProviderAccountStore` constructor injects `PERSISTENCE_TOKENS.SQLITE_CONNECTION`, typed as the public connection's `db` surface. It does not access the connection during construction or choose another database path.

- `add(profileId, label, directory)`: creates a new directory and atomically inserts metadata/reserves its route. Never adopts an existing directory. Database failure invokes ownership-aware empty-directory cleanup.
- `get(profileId)`, `list()`: backend metadata; these are not public RPC summaries and contain backend paths.
- `rename(profileId, expectedRevision, label)`: label-only CAS; leaves route identity unchanged.
- `remove(profileId, expectedRevision)`: tombstones profile and clears both scopes' selections atomically, incrementing their revisions. Retains files, bindings, leases and route uniqueness. Active auth excludes removal; active runs survive removal.
- `selection(workspaceRoot, scope)`, `select(workspaceRoot, scope, profileIdOrNull, expectedSelectionRevision, expectedProfileRevision?)`: independent main/lane CAS selections. An absent selection has revision `-1`; the first stored revision is `0`. A named selection requires the expected profile revision. Null explicitly selects ambient.
- `admit(AccountRunAdmission)`: validates a supplied resolved route and optionally the selection snapshot under the transaction; writes one immutable binding and one lease atomically. Returns the shared `ClaudeAccountRunReservation` and `ProviderAccountBinding` (null for ambient). Distinct runs may share a route, but run IDs and lease IDs cannot replay while present. Optional identity evidence accepts only the shared known hash/unknown union; absent evidence remains unknown. This method does not create a certified `ClaudeAccountRoute` or implement the higher-level admission port.
- `binding(runId)`: reads a retained binding, validates its persisted shape/evidence, and returns a frozen snapshot or null. No binding-update API exists.
- `reserveAuth(profileIdOrNull, expectedRevision, route, operationId, ownerId, kind)`: reserves exclusive sign-in/sign-out, excluding runs and auth operations on that physical route. Named reservations advance profile revision and auth epoch and set pending state atomically.
- `completeAuth(operationId, ownerId, authEpoch, state)`: compares active operation, owner, epoch and reserved revision, then updates state/revision and releases the operation atomically.
- `release(sharedReleaseCommand)`, `retain(sharedRetainCommand)`: compare lease ID, operation/owner ID and binding epoch. Release deletes only the lease; retain leaves it held. The calling service must establish child termination before release/completion. These methods do not infer termination from a reason string, time or PID.

All mutation bodies run synchronously within `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` using the public `SqliteDatabase` API and parameterized statements. SQLite BUSY/LOCKED produces typed `busy`; constraint/CAS collisions produce typed `conflict`; storage errors produce safe `unavailable-storage`. Transactions do not span process/network work. Reservations remain database records after commit, so a stuck route holds no open SQLite transaction.

## Acceptance coverage

Specs are authored, not executed. CI must establish their runtime results. Two-connection race cases use deterministic conflicting schedules and a real held writer lock; they are not a multiprocess stress test.

1. Two real connections and typed conflicts:
   - `two connections racing Add have one winner and preserve its directory`
   - `two connections racing rename and remove compare revisions`
   - `two connections racing select have one CAS winner with independent scopes`
   - `two connections racing admission for the same run have one binding and lease`
   - `two connections racing auth have one winner and auth excludes admission`
   - `selection changes before admission refuse the stale selected snapshot`
   - `allows distinct runs on one route but excludes auth until all leases release`
2. Canonical route safety:
   - `recognizes aliases and Windows junctions by physical identity`
   - `preserves case distinctions when the filesystem supports them` (asserts equivalence instead on case-insensitive volumes)
   - `refuses directory replacement and alias retargeting`
   - `fails closed for missing, relative and non-directory routes without raw errors`
   - `refuses ambient collision in both directions without adopting external directories`
   - `refuses route replacement even with the same profile and revision`
3. Complete rollback and retained metadata:
   - `a busy writer refuses safely and failed Add cleans its newly owned empty directory`
   - `failed lease insertion rolls back its binding and failed remove restores selections`
   - `a failed commit rolls back all profile changes and removes only its empty directory`
   - `failed auth reservation restores revision and epoch on the losing route`
   - `auth completion compares operation, owner, epoch and revision before releasing`
   - `removal clears future selections but retains snapshots, leases and tombstones`
4. No age/PID stealing:
   - `never steals old reservations and a stuck route does not block unrelated routes`: ages records to zero, preserves operations/leases, rejects another owner, and retains unresolved leases. No PID/expiry/recovery code or per-route timers exist.
5. Failed Add ownership:
   - `failed Add removes only its own empty directory`
   - `failed Add preserves external directories and newly written content`
   - `failed Add never deletes a replacement empty directory`
   - Store Add/commit/busy specs also assert directory cleanup/preservation.
6. Unrelated progress:
   - `never steals old reservations and a stuck route does not block unrelated routes`: another account is added and admitted while the first route has an old unresolved auth reservation.

Fixtures use isolated temporary directories and a temporary SQLite file with two actual `better-sqlite3` connections, WAL, foreign keys and zero busy timeout. Only migration 0058 is applied, obtained from public `MIGRATIONS`; tests never resolve the real profile database.

## Verification

Final `ptah_get_diagnostics` scoped to the four changed TypeScript files reported **0 errors, 0 warnings, clean coverage**. An earlier spec diagnostic identified optional migration SQL; the fixture now guards it explicitly. No runtime test results are claimed. Native SQLite binary availability and Windows junction behavior remain for CI.

## Decisions

1. **Use the public injected shared connection, with no new database/location resolver.** Options: reuse the existing connection or allocate an account-specific database. Evidence: plan lines 128-140, public `sqlite-connection.service.ts` API, `db-path.ts` profile/override isolation, and `SqliteLaneOutcomeStore` constructor/prepared statements. Reversible through constructor composition, but persisted account tables remain in the shared DB. This preserves Electron's auth-before-persistence registration ordering.
2. **Use explicit synchronous `BEGIN IMMEDIATE`.** Options: deferred public transaction helper or immediate SQL transaction through public `exec`. Evidence: public transaction type has no `.immediate()` overload; cross-connection check-before-write exclusion requires a writer reservation before reads. Immediate transactions serialize short admission/CAS checks without holding a transaction across child lifetime. Reversible without schema changes.
3. **Fingerprint physical identity and creation time, not lowercased path.** Options: path normalization alone or realpath plus device/inode identity. Evidence: plan's alias/junction/case requirements and shared filesystem-identity fields. Creation time reduces inode-reuse ambiguity; realpath is separately compared for relocation. No compatibility fallback for unsupported identity. Reversibility requires a deliberate persisted-route migration because fingerprints are durable.
4. **Add creates a fresh final directory and refuses adoption.** Options: adopt an existing empty/credential directory or require creation ownership. Evidence: plan explicitly prohibits automatic import/adoption and permits cleanup only with ownership and emptiness proof. Reversible only through a separately authorized adoption workflow, not a silent fallback.
5. **Keep metadata-only removal compatible with active run leases, but exclude active auth.** Options: revoke leases, reject every active run, or retain snapshots/tombstones while clearing future selections. Evidence: plan explicitly preserves executing leases and immutable snapshots. No automatic recovery, PID check or expiration is added. Service-level termination proof remains necessary. Reversible through a future explicit recovery contract.
6. **Phase-one store is Claude-only; reuse shared carrier types without certifying routes.** Options: prematurely generalize provider behavior or implement the phase-one boundary and leave certification to Batch 6. Evidence: context/task description phase 1 and admission-port certification comments. No provider-specific action runner or credential handling is introduced. Codex expansion remains a later task phase.
7. **Dependency tags permit the new package edge.** Auth-providers is `scope:extension,type:feature`; persistence-sqlite is `scope:extension,type:util`. `eslint.config.mjs` permits extension-to-extension and feature-to-util. Internal dependency version `0.0.1` matches the existing package. No tags changed; the edge is reversible.

## Not done / integration boundaries

- Tests were not run, as required. No claim of multiprocess stress execution or runtime acceptance completion.
- Batch 6 owns service/port implementation, certified routes, composition/public exports, host launch-time revalidation, deriving account directory locations, and proof of child termination before release. None were added outside this batch's ownership.
- No recovery/garbage collection, credential access, auth subprocess execution, UI/host features, Codex behavior, lockfile edits or git operations.
- Operations are exclusive while retained; completion deletes their row. Historical operation-ID replay receipts are not introduced by this schema. Callers must use fresh opaque operation IDs and current revision/epoch; retained run bindings prevent reuse of named run IDs.
- No automatic parent-directory creation: the account service must establish its trusted metadata parent before Add.
