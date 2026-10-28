## Backend implementation — `TASK_2026_719_4f64`, batch 19

**Tasks completed**: 19.1 "named accounts are not available in the CLI host" — complete.

**Files**:

- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/apps/ptah-cli/src/cli/commands/agent-cli.ts
  - :145-146 `account` field doc (D7): "Only the ambient sentinel is accepted: named accounts are not available in the CLI host (D7)". The "release-held" wording is removed.
  - :670-672 `resolveResumeAccountSelection` doc (D7): "An account ID is refused here: named accounts are not available in the CLI host (D7)."
  - :691 refusal copy: `named accounts are not available in the CLI host; use --account ${AMBIENT_ACCOUNT_SENTINEL} or omit the flag` (plan:858 wording).
  - Behaviour unchanged. An opaque account ID still returns `status: 'refused'`, the ambient sentinel still maps to `{ kind: 'ambient' }`, and the raw value is still never echoed.
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/apps/ptah-cli/src/cli/commands/agent-cli.spec.ts
  - ~:1225-1226 section header comment uses the new D7 wording.
  - ~:1242-1249 test renamed "refuses an account ID in the CLI host, without echoing it". It now pins `'named accounts are not available in the CLI host'`.
  - ~:1340 `resume` command test now pins the same stderr copy (the old `'not available yet'` pin was a second occurrence outside 1225-1245).
  - Prettier `--write` also re-wrapped 3 pre-existing over-width lines in this file (formatting only). Without that, `prettier --check` failed on the file.

**Specs that pin the changed member** (rule 5): `apps/ptah-cli/src/cli/commands/agent-cli.spec.ts` only. Grep for `not available yet|release-held|D7` under `apps/ptah-cli` found no other spec pins. No ambient-path pins changed.

**Stack observed**: the CLI app has plain exported functions with a Jest spec colocated beside them (`agent-cli.ts` / `agent-cli.spec.ts`). The Jest config is `apps/ptah-cli/jest.config.cjs`. There is no DI or registration change.

**Verification**:

- `npx tsc --noEmit -p apps/ptah-cli/tsconfig.app.json`: exit 0, clean.
- `npx tsc --noEmit -p apps/ptah-cli/tsconfig.spec.json`: 1 error, in `apps/ptah-cli/src/cli/router.ts(127,26)` (TS1343 `import.meta`). It is not in a task file, and `router.ts` is unchanged against HEAD, so it is pre-existing. There were no errors in either task file.
- `npx eslint` on the 2 files: exit 0, no output.
- `npx prettier --check` on the 2 files: clean after `--write` on the spec.
- `npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src/cli/commands/agent-cli.spec.ts --maxWorkers=2`: 1 suite passed, 82/82 tests passed. The `jest.config.ts` path in the brief does not exist; `.cjs` is the real file.
- `ptah_get_diagnostics` (scoped to the 2 files): unavailable. Twice it returned "TypeScript check still running after 45s". The `tsc` runs above cover the same check.
- `npm run verify` was not run (rule 12). The team-leader runs `npm run verify -- -t lint,test,typecheck -p ptah-cli`.

**Risks handled**: no `process.cwd()`, no `jest.spyOn` on namespaces, no git state change, and no secret or raw ID in the message (the existing not-echoed assertions still pass).

**Plan deviations**: none.

**Out-of-scope observations**:

- `apps/ptah-cli/src/cli/router.ts:793` still has the `--account` help text "claude only: restate the default sign-in route (named accounts are not available yet)". It is the same stale "yet" wording, but it is not in B19's file list. I recommend a follow-up to align it to "not available in the CLI host".
- There is a pre-existing TS1343 in `router.ts:127` under `tsconfig.spec.json` (see above).
