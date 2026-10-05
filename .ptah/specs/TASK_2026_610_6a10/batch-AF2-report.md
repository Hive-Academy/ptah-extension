# AF2 Review Fix Report

## A7 bounded registry contract

- Replaced whole-registry equality with a baseline allow-set check. It fails only
  when a current RPC or push name matches the host-source pattern and is absent
  from its baseline array; unrelated additions no longer fail this contract.
- Documented and implemented the case-insensitive pattern:
  `turn|recap|ptah-?ui|change-?set|host-?source|turn-?tests|usage`.
- Current registry names matched by that pattern:
  `chat:tokenUsageUpdated`, `provider:getAccountUsage`, `git:turnChangeSet`,
  `git:turnChangeSets`, `session:turnEnded`, and `session:turnFailed`.
- Added matcher regression coverage: `git:turnRecapData` matches and `foo:bar`
  does not. The contract suite now has three tests.
- Preserved the Gate 2 exception header on the contract and added the exact
  baseline regeneration command to the baseline header. The generated arrays
  were not changed.

## Usage formatter documentation

- Reworded the two JSDoc comments to: “Shared formatter used by the chat cost
  badge.” and “Shared formatter used by the chat duration badge.” This makes no
  claim about formatting on other surfaces.

## Verification

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/rpc/ libs/shared/src/lib/utils/usage-format.utils.spec.ts`
  — PASS: 7/7 suites, 193/193 tests, 0 snapshots.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/shared --parallel=1`
  — PASS: 2/2 targets (`typecheck`, `lint`); 29.7s; cache 0/2. Nx reported its
  disabled Cloud organization as a non-failing external service warning.
