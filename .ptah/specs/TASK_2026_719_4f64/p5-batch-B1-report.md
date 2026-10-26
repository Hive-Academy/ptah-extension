# P5 batch B1 report - shared name rule, ambient types, host uniqueness, absent-list names

Executor: backend-developer. Worktree: `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts`.
No git action taken. The batch verify command has not been run (the orchestrator runs it).

## Files changed (6)

- MODIFY `libs/shared/src/lib/types/provider-account.types.ts`
  - Adds `PROVIDER_ACCOUNT_RESERVED_LABEL = 'Existing Claude login'` and
    `PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY = 'That name is already used. Names must be different.'`.
  - Adds `providerAccountLabelKey(label)` (`trim().toLowerCase()`) and
    `isProviderAccountLabelTaken(label, existingLabels)`, which is true for the reserved name key or any existing key.
    The caller excludes the renamed account.
  - Adds `PROVIDER_AMBIENT_CLAUDE_STATES` and `PROVIDER_AMBIENT_CLAUDE_REASONS` as `as const` tuples, their derived
    types, and `interface ProviderAmbientClaudeStatus { state; checkedAt: string | null; reason? }` (readonly fields).
    The doc comment covers the Revision 1 `checkedAt` provenance. The module stays free of zod. The barrel already
    re-exports it (`libs/shared/src/index.ts:32`).
- CREATE `libs/shared/src/lib/types/provider-account-label.spec.ts` (7 tests): trim and case keying (inner spaces
  still count), case and space variants taken, reserved name taken in any case and passing
  `isSafeProviderAccountLabel`, renamed-row exclusion left to the caller, duplicate summary passing
  `isSafeProviderAccountSummary`, the tuple constants, and the `checkedAt: null` shape.
- MODIFY `libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts`
  - Adds private `assertLabelFree(db, label, exceptProfileId)`. It runs a constant query with no interpolated input
    (`SELECT profile_id, label FROM provider_account_profiles WHERE provider = 'claude' AND removed_at IS NULL`). Rows
    are parsed with a small zod schema and the excepted row is dropped. If `isProviderAccountLabelTaken` is true it
    throws `ProviderAccountStoreError('conflict', PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY)`.
  - `insert` calls it inside the existing `atomic()` transaction, after the duplicate-route check and before
    `unoccupied` and `validateOwned`. `rename` calls it after the revision-checked `profile()` read with
    `exceptProfileId = profileId`.
  - Rows that already share a name stay as they are. Labels are never logged.
- MODIFY `libs/backend/auth-providers/src/lib/accounts/provider-account.store.spec.ts`
  - Existing fixtures that now collide with D40:
    - The `add()` helper names extra accounts by their id. The first account is still `Work`. This affects
      `add('profile-0002', ...)` and the three-route test.
    - "creates a new account for a different request ID" now adds `Home` as its second account, not a second `Work`.
  - New `describe('unique account names (D40)')` with 6 tests:
    - Add with a case variant is refused with the exact summary, and no row or directory is left behind.
    - Add with a padded name is refused.
    - Add with the reserved name is refused in any case.
    - Rename to another live name or to the reserved name is refused, and the old label and revision are kept.
    - Rename to the account's own name in another case is allowed.
    - A removed account's name can be used again.
    - Replaying the same Add request through the service still returns the stored account, and a new request with a
      case variant is refused.
- MODIFY `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` and
  `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`: add `'provider:getAmbientClaudeStatus'` to the
  provider-account absent group, in alphabetical order after `provider:getAccountStatus`. Both lists are filtered by
  live method names, so the entry stays inert until B3 makes it live. These are guard updates only.

## Verification

- `node scripts/verify.mjs --exec --task b1-jest -- npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/accounts/provider-account.store.spec.ts`
  -> Test Suites 1 passed, Tests 69 passed.
- `node scripts/verify.mjs --exec --task b1-jest -- npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/provider-account-label.spec.ts`
  -> Test Suites 1 passed, Tests 7 passed.
- `ptah_get_diagnostics` on the store, its spec and the new shared spec: 0 errors.
- Not run (orchestrator owns it): the B1 `npm run verify` with N = 9. Lint is not run. The two rpc-surface specs are
  not run.

## Deviations from the plan

- Plan §2 lists "add duplicate (case/space variants)" as a store case. At the store, a padded name (`' work'`) is
  refused earlier by the existing `isSafeProviderAccountLabel` check in `validateProfile`. That refusal is a
  `conflict` with the generic sentence, so the padded name never reaches the uniqueness check. The store spec asserts
  that refusal. The trim behaviour of the name rule is covered in the shared spec. No code change was needed.
- Existing store-spec fixtures that relied on duplicate `Work` labels were renamed (see above). This is needed for D40
  and does not change what those tests prove.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Run the label check after the duplicate-route check in `insert` | before or after the route check | Existing tests (`store.spec` "racing Add") expect the route or primary-key conflict to win for an occupied directory. Either order refuses with `conflict`. | yes |
| Parse live-label rows with a minimal zod schema `{profile_id, label}` | reuse `profileSchema` (needs `SELECT *`) or a minimal schema | The plan names the two-column query. Rows that fail the parse surface as `unavailable-storage` through `atomic()`, the same as the existing parse failures. | yes |
| `ProviderAmbientClaudeStatus` is an interface with an optional `reason` (not a discriminated union) | interface or union | The plan in §1 names the interface shape. The "`reason` only with `unknown`" rule is documented in the comment; the B2 reader enforces it. | yes |

## Open points

- None blocking. B3 must add `'provider:getAmbientClaudeStatus'` to the tuple and registry so that the absent-list
  entries take effect.
