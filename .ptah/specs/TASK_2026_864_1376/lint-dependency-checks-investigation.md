# `@nx/dependency-checks` false "not used" on `@ptah-extension/persistence-sqlite`

## Reproduction

`npm run verify -- -t lint -p @ptah-extension/auth-providers` (run once, worktree
`feat/provider-readiness`), Nx 24.0.0:

```
libs/backend/auth-providers/package.json
  9:5  error  The "@ptah-extension/persistence-sqlite" package is not used by
              "@ptah-extension/auth-providers" project  @nx/dependency-checks
✖ 11 problems (1 error, 10 warnings)
  1 error and 0 warnings potentially fixable with the `--fix` option.
```

## Root cause

The rule does not decide "used" from the project graph edge. It builds a list of
*expected package names*, and a workspace library makes that list only if it is buildable
**and has its own `package.json` with a `name`**. `persistence-sqlite` has no
`package.json`, so it can never be expected, and any declaration of it is reported as
obsolete.

Evidence:

1. `node_modules/@nx/eslint-plugin/dist/src/rules/dependency-checks.js:92-99`: the rule
   sets `expectedDependencyNames = Object.keys(findNpmDependencies(...))`. Lines 349-356
   call `reportObsoleteDependency` for every declared dependency that is not in that list.
2. `node_modules/@nx/js/dist/src/utils/find-npm-dependencies.js:43-52`: it filters files
   by the build target's inputs. The importing files pass this filter: the graph edge is
   found, which is why the import itself is not in doubt.
3. `node_modules/@nx/js/dist/src/utils/find-npm-dependencies.js:66-80`: for an internal
   (workspace) dependency it calls `readPackageJson(workspaceDep)` and records the
   dependency only when
   `workspaceDep.data.targets[buildTarget] && packageJson?.name`.
   `readPackageJson` (lines 108-112) returns `null` when
   `<projectRoot>/package.json` does not exist.
4. `libs/backend/persistence-sqlite/` contains `project.json`, `eslint.config.mjs`, `src`
   and tsconfigs, and **no `package.json`**. It does have a `build` target, so condition
   (a) holds and condition (b) fails. Its name comes from `project.json:2`, which the rule
   does not read.
5. Every other workspace dependency in `libs/backend/auth-providers/package.json`
   (`vscode-core`, `platform-core`, `settings-core`, `agent-sdk`,
   `auth-providers-tokens`, `codex-runtime`, `shared`) has its own `package.json` and a
   `build` target. That is why only this one line is flagged.
6. The line came from `58db76bc3` ("feat(auth-providers): add canonical account routes
   and account store"), a hand edit that added only
   `libs/backend/auth-providers/package.json:9`. It is on `main` too, which explains why
   `main` fails the same way.

The hypotheses I ruled out:

- namedInputs or `tsconfig.lib.json` excluding the importing files: no. Those files are
  non-spec files under `src/` and pass the input filter. The failure is in the internal
  dependency branch, after file filtering.
- A stale graph: no. A fresh graph run gave the same result, because the rule's own logic
  is deterministic here.

### Why sibling libraries that import persistence-sqlite pass

- `memory-curator`, `cron-scheduler`, `skill-synthesis`, `session-organization`,
  `thoth-runtime`, `lane-outcomes`, `messaging-gateway` and `rpc-handlers` have **no
  `package.json`**. The rule only lints `*/package.json`
  (`dependency-checks.js:72-75`), so it never runs for them.
- `cli-engine/package.json:22` also declares `@ptah-extension/persistence-sqlite`, but
  `cli-engine/project.json` has **no `build` target**. The rule exits early at
  `dependency-checks.js:86-89` (`if (!buildTarget) return {}`).
- `auth-providers` is the only project that has all three: a `package.json`, a `build`
  target, and a declaration of `persistence-sqlite`.

## Minimal correct fix

Remove the declaration. Use file `libs/backend/auth-providers/package.json`. This is the
same change the rule's `--fix` makes.

```diff
--- a/libs/backend/auth-providers/package.json
+++ b/libs/backend/auth-providers/package.json
@@ -6,7 +6,6 @@
   "main": "./src/index.js",
   "types": "./src/index.d.ts",
   "dependencies": {
-    "@ptah-extension/persistence-sqlite": "0.0.1",
     "@ptah-extension/vscode-core": "0.0.1",
     "@ptah-extension/platform-core": "0.0.1",
     "@ptah-extension/settings-core": "0.0.1",
```

Verify with `npm run verify -- -t lint -p @ptah-extension/auth-providers`. Expect 0 errors
and the same 10 pre-existing warnings.

### Alternatives (not recommended)

- **Add `'@ptah-extension/persistence-sqlite'` to `ignoredDependencies`** in
  `libs/backend/auth-providers/eslint.config.mjs`. This keeps a declaration that has no
  effect and hides the real state. Use it only if someone wants the manifest to "document"
  the dependency. It is also a one-line change.
- **Add `libs/backend/persistence-sqlite/package.json`** with `name` and `version`. That
  would make the declaration valid. But it opens new surface: the `nx/core/package-json`
  plugin merges it into the project, and `@nx/dependency-checks` would then start linting
  that lib's npm dependencies (`better-sqlite3`, `sqlite-vec`, and so on). It is larger
  than this task and could produce new lint errors.

## Runtime and packaging impact of the recommended fix

None.

- Runtime resolution of `@ptah-extension/persistence-sqlite` goes through the
  `tsconfig.base.json:145-146` path alias, and esbuild/webpack bundle it. The root
  `package.json` declares no npm `workspaces`, so this manifest entry was never installable
  or resolvable as a package anyway.
- Electron packaging (`apps/ptah-electron/project.json:33`, `generatePackageJson: true`)
  uses Nx `createPackageJson`
  (`node_modules/nx/dist/src/plugins/js/package-json/create-package-json.js:36-39,
  213-300`). That function reads only the **app's** `package.json`. It walks workspace
  libraries through the graph and collects only `externalNodes` (npm) dependencies. A
  library `package.json` entry for another workspace library does not affect the generated
  dist `package.json`, `prune-dist-deps.js` or `validate-deps.js`.
- The Nx project graph edge auth-providers -> persistence-sqlite comes from the static
  imports, not from the manifest. It stays, so build ordering, `affected` and caching are
  unchanged.

## Risks

- Low. If someone later adds `libs/backend/persistence-sqlite/package.json`, the rule
  would report the dependency as *missing* from `auth-providers/package.json`. The
  declaration would then need to be re-added. The message says so, and `--fix` adds it.
- `cli-engine/package.json:22` has the same ineffective declaration. It is not flagged
  only because `cli-engine` has no `build` target. It is harmless and out of scope here.
  If a `build` target is ever added to cli-engine, the same error appears there.
- The fix is a manifest-only change. It touches no `.ts` source and does not invalidate
  test or typecheck cache entries beyond what a `package.json` input change normally does
  for this project.
