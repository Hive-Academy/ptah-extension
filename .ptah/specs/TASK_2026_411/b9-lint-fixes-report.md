# B9 Lint Closure — TASK_2026_411

Closes the two ERROR-level lint findings recorded in `b9-report.md` section 1
("lint"). Everything else that lint reports on this branch is pre-existing and
warn-level; nothing else was touched.

Branch: `fix/task-411-profile-performance` (worktree
`.claude-worktrees/task-411-profile-performance`, draft PR #494).

## Finding 1 — `@nx/dependency-checks` on `@openai/codex`

- **Reported at**: `libs/backend/auth-providers/package.json:16` —
  `The "@openai/codex" package is not used by "@ptah-extension/auth-providers" project`.
- **Why it fired**: the dependency is real and is genuinely used, but only
  dynamically. `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:71`
  calls `require.resolve('@openai/codex/package.json')` and joins
  `bin/codex.js` onto its directory to locate the packaged binary. Nx's static
  dependency analysis does not treat a `require.resolve` subpath call as a
  usage, so a correct declaration reads as an obsolete one.
- **Fix**: `libs/backend/auth-providers/eslint.config.mjs:16-23` — added
  `ignoredDependencies: ['@openai/codex']` to the existing
  `@nx/dependency-checks` rule options, with a comment naming the dynamic
  resolution site and stating that the declaration must stay.
- **Why this mechanism**: it is the narrowest option the rule offers. It
  suppresses exactly one package on one project and leaves the rule at `error`
  for every other dependency of `auth-providers`, so a genuinely obsolete
  dependency added later still fails the gate. The alternatives were worse:
  removing the declaration breaks resolution in a packaged install (the package
  is only a transitive dependency of `@openai/codex-sdk` at the repo root, so
  nothing else guarantees it is present); disabling the rule for the project
  blinds it to 12 other declared dependencies; and an esbuild `external` marker
  — suggested in `b9-report.md` — addresses the separate build-time warning and
  does not change what the eslint rule sees.
- **Precedent**: none for `ignoredDependencies`. Searched every
  `eslint.config.*` under `libs/` and `apps/`: 14 projects configure
  `@nx/dependency-checks`, and all 14 use only `ignoredFiles` (for their own
  eslint/esbuild config files). This is the first dynamically-resolved
  dependency in the repo, hence the first use of the option; the rule block it
  was added to is the same shape the other 13 projects carry.

## Finding 2 — `@typescript-eslint/no-inferrable-types`

- **Reported at**:
  `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-host.spec.ts:212,273`
  — `private readonly shouldCrash: boolean = true`.
- **Fix**: removed the redundant `: boolean` annotation on both constructor
  parameters (`CrashOnFirstScalarPageWorker:212`,
  `CrashOnSequenceSliceWorker:273`). The `= true` default infers the identical
  type; no other line changed, and no test behaviour changed.
- **Why this mechanism**: the rule is right — there is nothing to preserve. A
  disable comment would carry the noise forward for no benefit.
- **Precedent**: not applicable; this is the rule's own prescribed fix and is
  `--fix`-able.

## Gate results

All three run in the foreground from the worktree root with `--skip-nx-cache`.
No `project.json` was edited, so no `nx reset` was needed.

### lint — PASS

`npx nx run-many -t lint -p @ptah-extension/auth-providers @ptah-extension/platform-electron --skip-nx-cache`

Header: `Running target lint for 2 projects` (both named projects present).
`Successfully ran target lint for 2 projects`. **0 errors** on both; both
previously-reported errors are gone. Remaining warnings, all pre-existing:

- `@ptah-extension/platform-electron` — 6 problems, 0 errors, 6 warnings:
  - `electron-state-storage-worker-protocol.ts:666:21` `@typescript-eslint/no-unused-vars` (`key`)
  - `electron-state-storage-worker-protocol.ts:756:1` `max-lines` (851 > 700)
  - `settings/electron-master-key-provider.spec.ts:418,435,449` unused eslint-disable directive (x3)
  - `settings/file-settings-store.ts:83:29` `@typescript-eslint/no-empty-function` (`dispose`)
- `@ptah-extension/auth-providers` — 4 problems, 0 errors, 4 warnings:
  - `provider-models.service.ts:1133:1` `max-lines` (718 > 700)
  - `translation/responses-stream-translator.ts:321:26` `no-non-null-assertion`
  - `translation/translation-proxy-base.ts:203:19` `no-non-null-assertion`
  - `translation/translation-proxy-base.ts:885:1` `max-lines` (980 > 700)

### test — PASS

`npx nx run-many -t test -p @ptah-extension/auth-providers @ptah-extension/platform-electron --skip-nx-cache`

Header: `Running target test for 2 projects`. `Successfully ran target test for
2 projects`.

| Project | Suites | Tests | Time |
|---|---|---|---|
| `@ptah-extension/auth-providers` | 40 passed / 40 | 747 passed / 747 (2 snapshots) | 63.991 s |
| `@ptah-extension/platform-electron` | 20 passed, 1 skipped / 21 | 340 passed, 2 skipped, 3 todo / 345 | 111.745 s |

`platform-electron`'s one skipped suite is the opt-in perf suite (it runs only
under `PTAH_PERF_SPECS=1`); these are the same counts `b9-report.md` recorded
for the perf-off run.

**Worker-teardown warning**: in the combined run it was
`@ptah-extension/auth-providers`, not `platform-electron`, that printed `A
worker process has failed to exit gracefully and has been force exited`. No
test failed. Rerun alone —
`npx nx test @ptah-extension/auth-providers --skip-nx-cache` — 40/40 suites,
747/747 tests passed in 14.065 s with no teardown warning at all. A leaked
handle/timer under parallel load, not an assertion failure; pass counts are
identical across both runs.

### typecheck — PASS

`npx nx run-many -t typecheck -p @ptah-extension/auth-providers @ptah-extension/platform-electron --skip-nx-cache`

Header: `Running target typecheck for 2 projects`. Both ran `tsc --noEmit`
against their `tsconfig.lib.json` with zero output. `Successfully ran target
typecheck for 2 projects`.

## Commits

```
112ba28d9 style(platform-electron): drop redundant boolean annotations in the worker host spec
99d2accc3 fix(auth-providers): satisfy dependency checks for the packaged codex binary
82c3be131 docs(task-specs): record TASK_2026_411 b9 closure
```

Two commits rather than one: the scopes are different libs and the second
change is cosmetic, so splitting keeps each subject honest about what it did.
Hooks ran on both; explicit paths only; nothing pushed.

## Out of scope, not touched

- The esbuild build-time warning `"@openai/codex/package.json" should be marked
  as external for use with "require.resolve"` — a separate build-config
  question, not a lint error, and not required to clear the gate.
- The `node_modules` install gaps `b9-report.md` recorded (`web-tree-sitter`
  blocking `ptah-cli:test`, `prismjs`/`daisyui`). Environmental, unrelated to
  this branch's diff, and not fixable by an edit here.
- Every warn-level finding listed above. They are pre-existing and the repo's
  configuration does not fail on them.
