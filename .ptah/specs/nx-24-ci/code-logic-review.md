## Verdict

REVISE. Score 6/10. One major gate moved off the hook and was not picked up by this workflow's triggers. PR CI still builds, typechecks, and shards tests, so this is not a foundation failure (3-4) and not sound enough to approve (7-8).

## Five logic questions

1. Silent success: a push of `main` or `develop` exits 0 from `.husky/pre-push` after di-lint and `ptah-electron:validate-deps` while type errors in every other project are unchecked. `.github/workflows/ci.yml` does not run on `push`.
2. User action: push straight to `main` or `develop` (no PR). `PTAH_PREPUSH_PARANOID=1` still only builds; it does not typecheck.
3. Bad data: `assign-test-shard.mjs` throws on a non-array or a name outside `^(?:@scope/)?name$` (verified: `"nope name"` exits 1). That fails the job. It does not drop projects quietly.
4. Dependency failure: Nx Cloud is gone (`nx.json` no longer has `nxCloudId`). A cache miss recomputes; it does not report a green task. `actions/cache` restore is one entry, keyed by hash, so a foreign shard cache cannot satisfy a different task hash.
5. Unspecified: task-based affected (nrwl/nx#37479) does not follow `dependsOn`. E2E targets that only depend on the app are not selected when the app changes. The electron and vscode e2e workflows call `nx run`, so those jobs still start.

## Defects

1. **major** — `.husky/pre-push:41` and `.github/workflows/ci.yml:3-8`. The hook used to run `nx affected -t build --base=origin/$current_branch` and `npm run typecheck:affected` when the branch was `main` or `develop`. That block is gone. The comment at line 41 says CI owns those checks. This workflow's `on` is only `pull_request` to `main` (lines 3-8). There is no `push` trigger, and PRs into `develop` do not start it. `typecheck:affected` still exists in `package.json:41` and CI calls it only inside `checks` (`ci.yml:103-104`), which those pushes never enter. Paranoid mode (`pre-push:16-27`) adds `nx affected -t build --base=origin/main --head=HEAD` and never `typecheck`. Fix: put the same `nx affected -t build` and `nx affected -t typecheck` back on the hook for `main` and `develop`, or add a `push` job for those branches that runs both targets.

2. **minor** — `apps/ptah-electron-e2e/project.json:7-20` and `apps/ptah-extension-vscode-e2e/project.json:10-28`. Both e2e targets `dependsOn` the app build and declare `implicitDependencies`, and neither sets `inputs`. `nx.json:122-138` `e2e` defaults are filtered to `@nx/jest/plugin` and also set no `inputs`. Under task-based affected, `nx affected -t e2e` does not select these targets when only the app changes. `electron-e2e.yml` and `vscode-e2e.yml` call `nx run …:e2e` directly, so current CI jobs still run. Fix: add `"inputs": ["default", "^production"]` on these `nx:run-commands` e2e targets (and `ptah-cli`'s `e2e` at `apps/ptah-cli/project.json:309-316`, same shape).

## Checked and OK

- No `project.json` still uses `@nx/jest:jest` or `@nx/eslint:lint` (`git grep` empty). Targets removed from the file are covered by `@nx/jest/plugin` `test` / `@nx/eslint/plugin` `lint` includes in `nx.json:163-344`. No orphaned test or lint name in the diff.
- `vscode-core:test-real-git` (`libs/backend/vscode-core/project.json:39-61`) is still `nx:run-commands` with `runInBand: true`, `passWithNoTests: false`, and `^production` inputs. Installed Nx 24.0.0 `run-commands.impl.js` `forwardAllArgs` defaults to true and appends non-object unknown options, so the command becomes `jest … --runInBand=true --passWithNoTests=false`. CI `--testNamePattern` is `__unparsed__` and is appended the same way (`ci.yml:423-425`). `jest.real-git.config.ts` still matches only `**/*.real-git.spec.ts`.
- `nx.json:28-38` gives every `typecheck` and `validate-deps` target `default` + `^production`. Project typecheck targets do not override `inputs`, so a dependency production change selects them. CI runs both (`ci.yml:97-112`).
- Inferred `test` targets get `default` + `^production` from `@nx/jest` `getInputs`. CI still passes `--coverage --parallel=2 --maxWorkers=2` (`ci.yml:222`). `targetDefaults.test` `ci.coverage` replaced the old executor's `codeCoverage` so `-c ci` forwards `--coverage`, not `--codeCoverage`.
- Shard script (`tools/ci/assign-test-shard.mjs:25-38`): sort by weight then name, greedy first-lightest bucket, one push per project. Four invocations on the same JSON produced the same loads and a disjoint cover (`shared` | `vscode-lm-tools` | `ptah-cli,chat` | `mcp-bench,ptah-electron,setup-wizard`). Scoped names pass the regex. Empty list prints `projects=` and `ci.yml:218-220` exits 0.
- Cache keys put the job name before the SHA (`ci.yml:63-66` and `144-147`). Restore order is job prefix, then `nx-${os}-`. Save keys do not collide across checks vs shards.
- `artifact-containment.spec.ts:97-102` narrows `attemptSelfNavigation` with `in` plus `typeof === 'function'` before the call. A missing or non-function export throws instead of calling it.
- Diff has no application source besides that spec. Angular 22.2 is a manifest/lock bump; no runtime migration edit to review.

## Decisions

- Treat the removed main/develop hook as a defect, not an accepted trade. Option A: CI-only (what landed). Option B: keep the hook for those branches. Evidence: `ci.yml` never runs on `push` or on PRs to `develop`. Reversible.

## Review family

reviewer: grok; implementer: codex

Uncertainty: did not run `nx show project` or any test/build. Merged plugin inputs are from the installed plugin source plus `project.json`, not from a resolved graph print.
