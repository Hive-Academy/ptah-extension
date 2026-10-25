# Batch 4 implementation report

Implemented and explicitly registered static, forward-only migration 0058. No data or credential migration. Migration number 0058 was absent before creation (`ptah_search_files`: zero hits). Only the three assigned source/spec files and this required report were written. No git commands or test/build commands were run.

## Files changed

Paths relative to `D:/projects/ptah-extension/.claude-worktrees/provider-accounts`:

- CREATED `libs/backend/persistence-sqlite/src/lib/migrations/0058_provider_accounts.ts`
- CREATED `libs/backend/persistence-sqlite/src/lib/migrations/0058_provider_accounts.spec.ts`
- MODIFIED `libs/backend/persistence-sqlite/src/lib/migrations/index.ts` — explicit import and version 58 entry immediately after 57.
- CREATED `.ptah/specs/TASK_2026_712_5d7c/implementation-report-batch-04.md`

## Tables and indexes

| Table | Contract |
| --- | --- |
| `provider_account_profiles` | Opaque profile ID; provider/label; backend-only canonical route and optional filesystem identity; unique route and fingerprint; metadata revision, route revision, auth epoch/state; creation/update times; nullable `removed_at` tombstone. Composite unique keys support same-provider and same-route foreign keys. |
| `provider_account_selections` | Composite primary key `(workspace_root, provider, scope)`; nullable profile for ambient selection; revision and update time. Composite FK rejects another provider's profile. |
| `provider_account_operations` | Operation ID replay key; unique route fingerprint for exclusive auth reservation; optional profile; provider/kind; auth epoch and expected revision; opaque owner ID and creation time. Composite FK verifies named profile/provider/route. |
| `provider_account_run_bindings` | Run ID replay key; binding version; named profile/provider; snapshot route revision/fingerprint and auth epoch; identity kind and optional owner hash; creation time. Composite FK verifies profile/provider/route. |
| `provider_account_run_leases` | Lease ID primary key; unique run ID; optional profile/provider/route; opaque owner ID; acquisition time. Multiple runs may lease one route. Composite FK verifies named profile/provider/route. |

Explicit indexes:

- `idx_provider_account_profiles_provider_removed` — `(provider, removed_at)`
- `idx_provider_account_selections_profile` — `(profile_id)`
- `idx_provider_account_operations_profile` — `(profile_id)`
- `idx_provider_account_run_bindings_profile` — `(profile_id)`
- `idx_provider_account_run_leases_route` — `(route_fingerprint)`
- `idx_provider_account_run_leases_profile` — `(profile_id)`

SQLite also creates constraint indexes for primary/unique keys. IDs and composite-key components are explicitly NOT NULL except nullable profile references for ambient behavior. Revisions and epochs are nonnegative. There are no credential, token, email, raw owner identity, browser URL or arbitrary auth-payload columns. `physical_identity` means filesystem identity, not user identity; `owner_id` means opaque reservation-owner identity.

## Acceptance coverage

Specs are authored, not executed; CI must establish their runtime result.

1. Fresh/upgrade/repeat:
   - `creates every table and index on a fresh database without importing data` — real in-memory Node SQLite.
   - `upgrades a real SQLite database after 0057 without changing unrelated data` — applies actual 0057 SQL to its prerequisite fixture, then 0058; this is not a replay of the complete historical migration chain.
   - `reapplies static DDL without changing account data` — real SQLite idempotency and preservation.
   - `applies from head %i and skips a repeated runner invocation` — heads 0/57, existing FakeSqliteDatabase runner seam; verifies bookkeeping/user_version/repeat skip. Earlier archive gate mocked as in 0057 tests.
2. Uniqueness and FK rejection (real SQLite, `foreign_keys = ON`):
   - `rejects duplicate profile IDs, physical routes and fingerprints including tombstones`
   - `enforces per-scope selection keys and same-provider profile references`
   - `enforces operation replay keys and exclusive route reservations`
   - `retains bound snapshots through removal and rejects invalid binding references`
   - `enforces lease replay keys and references while allowing concurrent runs on a route`
   - `rejects null idempotency keys and negative profile revisions or epochs`
3. Rollback:
   - `rolls back all migration DDL when a later statement fails`
   - `rolls back profile and selection writes together after a constraint failure`
   - Both use real SQLite transactions, explicit failure and rollback, and assert absence of partial results. The migration runner already owns transaction boundaries.
4. Two-connection busy handling: no new infrastructure/test added; see decision below, as permitted by the assignment.
5. Registry:
   - `explicitly registers 0058 immediately after 0057` checks exported SQL and registry position.

## Verification

`ptah_get_diagnostics` scoped to the three changed TypeScript files returned clean coverage, zero errors and zero warnings. After adding the real SQLite upgrade spec, a second call scoped to that changed spec also returned clean coverage, zero errors and zero warnings. No Nx, Jest, tsc, lint, build, host launch, git or live-provider action was performed.

## Decisions

1. **Retain profiles as tombstones via `removed_at`.** Options: retain the profile row (chosen), or split removed rows into a separate tombstone table. Evidence: implementation-plan lines 131–140 require retained IDs/routes and active snapshots, but specify no literal table or column DDL; shared `ProviderAccountBinding` carries profile ID and route snapshot. A retained row preserves unique physical routes and FK targets without moving data or cross-table uniqueness triggers. Reversible through a later forward migration, not by modifying an applied migration.
2. **Use explicit scalar metadata columns and composite FKs.** Options: explicit fields (chosen), or serialized payload blobs. Evidence: shared `provider-account.types.ts` binding fields and the scalar table/index style of 0054. Composite references prevent profile/provider/route mismatch; current revision/epoch are deliberately not FK targets because snapshots survive metadata updates. Reversible by forward migration. The plan supplies storage responsibilities rather than exact column spellings; these names form the Batch 5 implementation contract.
3. **Keep ambient reservations and leases possible without a named profile.** Options: nullable profile references (chosen), or fabricate ambient profiles. Evidence: plan line 133 requires collision/reservation checks for ambient routes without automatic account adoption. Leases do not FK to named binding rows because ambient runs have no named binding. Store admission must atomically create named bindings and leases and enforce operation-versus-lease exclusion; this batch provides schema only. Reversible by forward migration once all callers migrate.
4. **Retain tombstone route uniqueness and use restrictive FKs.** Options: retain reservations (chosen), or cascade/delete/reuse routes. Evidence: plan prohibits removed routes masquerading as new isolated accounts while old bindings exist. Removal must clear future selections and set `removed_at` transactionally; it must not physically delete the profile or cascade away active bindings/leases. Store enforcement of tombstone admission and immutable snapshots belongs to Batch 5. Reversible only through an explicit future migration and retention policy.
5. **Follow 0054 enum-validation and static-DDL conventions.** Options: write-boundary validation (chosen), or closed SQL enum CHECK lists. Evidence: 0054 explicitly avoids SQL enum CHECK constraints because widening needs table rebuilds; shared vocabulary supplies runtime validators. Numeric nonnegative checks and relational constraints remain in SQLite. No new services, dependencies or migration callbacks. Reversible by forward migration.
6. **Document busy handling instead of introducing concurrency infrastructure.** Options: document missing precedent (chosen), or create a new multi-connection harness. Evidence: 0057 tests use FakeSqliteDatabase plus real in-memory `node:sqlite`; searching migration specs for `busy` returned no hits. The assignment explicitly permits documenting this case, and Batch 5 owns two-connection transactional-store races/busy behavior. No production busy/retry behavior changed. Reversible by adding a future targeted integration spec.

## Not done and coordinator follow-up

- Tests were not run, per mandatory assignment rule; diagnostics are not a runtime test result.
- The existing `0057_drop_skill_pipeline.spec.ts` test `registers last with relational and optional vec cleanup` asserts `MIGRATIONS.at(-1)` is migration 57. Registering 58 necessarily invalidates that assertion. The file is outside this batch's ownership and was not edited. The coordinator must update it to check registration/order without asserting 57 remains the head before CI can pass that spec.
- No complete historical migration-chain replay, two-connection busy test, store logic, process recovery/reclamation, account selection/auth behavior, or host feature work was added. Batch 5 must enforce canonical filesystem equivalence before insertion, cross-table admission/exclusion, tombstone rejection, CAS, snapshot immutability, and boundary validation. Canonical-route string uniqueness alone does not resolve filesystem aliases.
