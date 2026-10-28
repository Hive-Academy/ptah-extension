# Batch 7 WP-a report — TASK_2026_719_4f64

## Task 7.1 WP-a: Migration 0060 and its registration — COMPLETE (pending team-leader verify)

### Files

- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/persistence-sqlite/src/lib/migrations/0060_provider_account_lease_epoch.ts`
  - Static SQL only. Bare ALTERs, as in `0055`: leases get `auth_epoch INTEGER NOT NULL DEFAULT 0 CHECK (>= 0)`, `route_revision INTEGER NOT NULL DEFAULT 0 CHECK (>= 0)` and `lease_state TEXT NOT NULL DEFAULT 'live' CHECK (IN ('live','quarantined'))`. Profiles get `identity_ref TEXT`.
  - Backfill: one UPDATE sets epoch and revision from a consistent binding. The two SET subqueries and the EXISTS guard all use the same four-column predicate (`run_id`, `provider`, `profile_id`, `route_fingerprint`).
  - Quarantine: a second UPDATE marks two kinds of row `quarantined`: a named lease with no consistent binding, and an ambient lease whose `run_id` has a binding. This SQL has no DELETE statement and does not clear any column.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/persistence-sqlite/src/lib/migrations/0060_provider_account_lease_epoch.spec.ts`
  - Uses real `node:sqlite` `:memory:` with `foreign_keys = ON`, then applies 0058 and 0059, as `0059…spec.ts` does. No temp files.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/persistence-sqlite/src/lib/migrations/index.ts`
  - Adds the `sql0060ProviderAccountLeaseEpoch` import and the `{ version: 60, name: '0060_provider_account_lease_epoch', sql }` entry after 59.

### Acceptance coverage (spec tests)

- Registration: the entry right after 59 is version 60 with the exact name and SQL, and the highest version is 60.
- The new columns exist, and `identity_ref` is NULL on existing profiles.
- Backfill cases (a)-(e), seeded in one DB:
  - (a) ambient lease, unbound: 0/0, `live`
  - (b) named lease with a binding at epoch 4, revision 2: 4/2, `live`
  - (c) named lease with no binding: `quarantined`
  - (d) binding for another profile and route: `quarantined`
  - (e) ambient lease with a binding: `quarantined`
- Bindings are unchanged. Profiles are unchanged apart from the new NULL `identity_ref`.
- Extra (d) case: same profile, different fingerprint. This row can only be inserted with `foreign_keys = OFF`, as legacy corruption could produce it. It is `quarantined`.
- Row counts of profiles, bindings, leases and session links are the same before and after.
- After the migration, CHECKs reject a negative epoch, a negative revision and an unknown `lease_state`. `quarantined` is accepted.
- A lease written without the new columns defaults to 0/0 `live`.

### Evidence

- `ptah_get_diagnostics` on the 3 files: 0 errors, 0 warnings, coverage clean.
- I ran a one-off node check: 0058 + 0059 + 0060 SQL on in-memory `node:sqlite` with seeded rows. The script was in `%TEMP%` and was deleted afterwards.
  - Result: `la 0/0 live`, `lb 4/2 live`, `lc 0/0 quarantined`, `le 0/0 quarantined`.
  - `identity_ref` was present, and `lease_state='x'` failed the CHECK.
  - This was not the Jest spec. Per rule 12, I did not run the Jest spec or `npm run verify`.
- Lint: the package rule `no-restricted-syntax` (TemplateLiteral with expressions) also covers specs under `lib/migrations/**`. Both new files have no `${…}` (checked with grep). Table names go to `pragma_table_info(?)` as a bound parameter.

### Specs that pin the head version (rule 5)

- `MIGRATIONS` gains one entry. These specs pin the highest version and are owned by WP-b..WP-e:
  - `0028`, `0030`, `0038`, `0039`, `0040`, `0041`
  - `0042`, `0043`, `0044`, `0045`, `0046`, `0047`
  - `0051`, `0052`, `0053`, `0054`, `0055`, `0056`
  - `0059`
- When I ran grep, 0059 already showed `toBe(60)` (WP-e, concurrent). `0044` and `0046` use a different expression form.
- `migration-runner.spec.ts:726,756` reads the last entry and needs no change.
- Account store specs pick explicit 58/59 and are unaffected until B8.
- No ambient-path pin was touched.

### Risks handled

- **D-N (quarantine, never delete):** this SQL has no DELETE statement. Inconsistent rows are only marked `quarantined`, and the spec checks that row counts do not change.
- **Same predicate in every subquery:** the predicate text is identical in the two SET subqueries, the EXISTS guard and the NOT EXISTS clause. `run_id` is the PRIMARY KEY of bindings, so each subquery returns at most one row.
- **NULL profile:** `b.profile_id = l.profile_id` is never true for an ambient lease, so ambient rows are never backfilled. Ambient quarantine uses a run-only EXISTS.
- **Existing rows and NOT NULL columns:** constant defaults keep existing rows valid. The CHECKs are satisfied by the defaults and by the backfilled values, which are already constrained `>= 0` in bindings.
- **Re-application:** the bare ALTERs depend on the runner's `schema_migrations` once-only rule, the same as 0055.

## Decisions

- I added a fingerprint-only (d) test with FKs off. Options were: profile-and-route mismatch only, or both. Evidence: binding FKs reference `(profile_id, provider, route_fingerprint)`, so a fingerprint-only mismatch cannot exist while FKs are on. It can still exist in a legacy DB. The test only adds coverage and can be removed.

## Plan deviations

None.

## Out-of-scope observations

None.
