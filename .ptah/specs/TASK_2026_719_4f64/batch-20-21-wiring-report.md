# Frontend implementation: `TASK_2026_719_4f64`, Batch 20/21 wiring (drawer fallback)

**Verdict**: Complete. The Accounts section now passes the state service's sign-in fallback for the open account to the drawer's `[fallback]` input. Tests pass and lib typecheck is clean. The only ESLint error is the known D30 debt.

**Tasks completed**: The section binds the drawer's `[fallback]`, and two spec cases cover it.

## Files

All paths are under `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/`. Batch 20 and Batch 21 changes in these files are kept.

- MODIFIED `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-section.component.ts`
  - `:391`: the drawer binds `[fallback]="drawerFallback()"`.
  - `:520`: `private readonly fallbacks = this.accounts.fallbacks(PROVIDER)`. This is the existing B20 signal accessor on `ProviderAccountsStateService`.
  - `:522-525`: the `drawerFallback` computed. It returns `fallbacks()[drawerProfileId]`, or `null` when no drawer is open or the open account has no script.
  - It uses only signals: no subscription, no `effect`, and no logging. The script reaches the DOM only through the drawer's text interpolation.
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-section.component.spec.ts`
  - `:14`: a type import, `ProviderAccountSignInFallback`.
  - `:57`: `DrawerStub` gains the real `fallback` input contract.
  - `:120-122`: `AccountsStub` gains `scripts`, a writable signal, and `fallbacks()`, which mirrors the service accessor.
  - `:378`: the first new case. `startSignIn` stores a script for the profile, as the real `write()` does for a pending sign-in, and the open drawer receives it. Opening another account's drawer gets `null`.
  - `:403`: the second new case. A sign-in without a fallback passes `null` to the drawer, and no `account-fallback` element is rendered.
- `provider-accounts-state.service.ts` was not touched, because it already exposes `fallbacks(provider)` as a `Signal` (`:178-182`).

## Verification

- `npx tsc --noEmit -p libs/frontend/chat/tsconfig.lib.json`: no output, so 0 errors.
- `npx tsc --noEmit -p libs/frontend/chat/tsconfig.spec.json`, filtered for `accounts-section`: 0 errors.
- `npx eslint` on the two files: 1 error, at `accounts-section.component.ts:15:1`. It is `@nx/enforce-module-boundaries` on the static `@ptah-extension/shared` import, which is the known D30 debt and existed before this change. The spec has 0 errors and 0 warnings.
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/settings/providers/accounts --maxWorkers=2`: Test Suites 4/4 passed, Tests 72/72 passed.
- Not run, by the constraints: `npm run verify`, builds, and git.

## Decisions

- **Fallback lookup.** The section looks up the fallback by `drawerProfileId` from the service's per-provider record. It does not thread the script through the action outcome. Evidence: B20 stores scripts in the service only while a sign-in is pending and prunes them on settle. The service is therefore the single source of truth, and the drawer hides the script once the account is no longer pending. Reversible.

## Out-of-scope observations

None.
