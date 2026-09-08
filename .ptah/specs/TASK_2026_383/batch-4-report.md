# Batch 4 report — ESM bundle gate, build-artifact skip policy, probe hardening

## Revision 1

Triggered by `code-logic-review.md` (NEEDS_REVISION 5/10: 1 blocking, 1
serious, 2 moderate, 3 failure modes) and `code-style-review.md` (APPROVED
8/10, 3 minor). Orchestrator ruling on the blocking finding: make the
cross-host build dependency explicit in the Nx graph rather than relying on
CI step ordering.

### 1. Blocking FM-1 — cross-host false-red — FIXED by design change

The original combined `esm-bundle-gate.spec.ts` (in `apps/ptah-electron`)
scanned all four ESM-producing apps' `project.json` files and their built
bundles from inside ONE project's test target. A PR touching only
`apps/ptah-electron` left the other three hosts' bundles unbuilt under
`nx affected -t build`, and Task 4.2's fail-not-skip policy turned that
absence into a hard, opaque CI failure on hosts the PR never touched.

**Fix (per orchestrator instruction):**

- Split the gate PER HOST. Deleted the combined
  `apps/ptah-electron/src/config/esm-bundle-gate.spec.ts` and replaced it
  with four independent files, each discovering and checking ONLY its own
  app's `project.json`:
  - CREATED `apps/ptah-electron/src/config/esm-bundle-gate.spec.ts` (409
    lines) — 4 targets (`build-main`, `build-embedder-worker`,
    `build-integrity-worker`, `build-voice-worker`), plus the worker-wiring
    family (three-place rule) that only applies to this host.
  - CREATED `apps/ptah-cli/src/test-utils/esm-bundle-gate.spec.ts` (348
    lines) — 3 targets (`build-esbuild`, `build-embedder-worker`,
    `build-integrity-worker`).
  - CREATED `apps/ptah-extension-vscode/src/esm-bundle-gate.spec.ts` (211
    lines) — 1 target (`build-esbuild`); no worker-shaped targets.
  - CREATED `apps/ptah-tui/src/esm-bundle-gate.spec.ts` (202 lines) — 1
    target (`build`); no worker-shaped targets.
  - `apps/ptah-extension-vscode` and `apps/ptah-tui` had no existing
    `config`/`test-utils` support directory, so their helper and spec sit at
    the top of `src/` beside each app's own existing top-level file
    (`deactivate-order.spec.ts` for vscode, `main.tsx` for tui) — matching,
    not inventing, a convention.
  - CREATED `apps/ptah-extension-vscode/src/build-artifact-gate.ts` (62
    lines) and `apps/ptah-tui/src/build-artifact-gate.ts` (62 lines) — the
    same near-duplicate helper as the existing two, now four copies total
    (still "no new shared lib" per `batches.md`).
- Made the dependency EXPLICIT in the Nx graph rather than relying on CI step
  ordering: each app's `test` target now `dependsOn` its own ESM build
  targets (`project.json` `MODIFIED` in all four apps):
  - `ptah-electron:test` → `dependsOn: [build-main, build-embedder-worker,
build-integrity-worker, build-voice-worker]`
  - `ptah-cli:test` → `dependsOn: [build-esbuild, build-embedder-worker,
build-integrity-worker]`
  - `ptah-extension-vscode:test` → `dependsOn: [build-esbuild]`
  - `ptah-tui:test` → `dependsOn: [build]`

**Verified no cycle, no unaffected-project slowdown**: `npx nx graph
--file=graph.json` produced 90 nodes with no cycle diagnostic. A task-graph
dump (`nx run-many -t test -p <4 apps> --graph=...`) confirmed each host's
`test` task lists ONLY its own build targets as dependencies — e.g.
`ptah-electron:test -> [ptah-electron:build-main:production,
ptah-electron:build-embedder-worker, ptah-electron:build-integrity-worker,
ptah-electron:build-voice-worker]`, with no ptah-cli/vscode/tui targets
appearing in ptah-electron's dependency list or vice versa. `test.dependsOn`
only fires when that project's OWN `test` target is scheduled, so an
unaffected project pays nothing extra — this closes FM-1 exactly: a PR
touching only one host now guarantees that host's own bundles via its own
test task, independent of whether the other three hosts are affected or
whether the CI job builds before or after testing.

**Side-effect fix**: `apps/ptah-extension-vscode`'s `build-esbuild` target
has no `skipTypeCheck` (unlike the other three hosts), so adding
`build-artifact-gate.ts` to `src/` broke that host's production build with
`TS2593: Cannot find name 'describe'` (the file uses bare Jest globals with
no `"types": ["jest"]` in the app's build tsconfig). Fixed by excluding this
one test-support file from the app tsconfig
(`apps/ptah-extension-vscode/tsconfig.app.json`, MODIFIED: `"exclude":
["**/*.spec.ts", "src/build-artifact-gate.ts"]`) — the same treatment
`*.spec.ts` files already get, since this file is test-only support code
that is never imported by production entry points either.

### 2. Style minor → mandatory: `WORKER_ENTRY_GUARDS` tied to discovery

Per instruction, made this a MUST in all four spec files, not just electron's
(vscode/tui have zero worker-shaped targets today but still carry the tie-in
so a future one cannot bypass it silently):

- `WORKER_TARGET_SUFFIX = /-worker$/` derives "worker-shaped" structurally
  from the discovered target NAME, not a hardcoded id list.
- `discoveredWorkerTargetNames` = every discovered target name matching that
  suffix.
- A new anti-vacuity test: `expect(Object.keys(WORKER_ENTRY_GUARDS).sort())
.toEqual(discoveredWorkerTargetNames)` — a new `build-*-worker` target
  added to any `project.json` without a matching `WORKER_ENTRY_GUARDS` entry
  now FAILS this assertion instead of silently skipping the executable
  self-test (the exact gap `code-style-review.md` minor #1 and #5
  described).

### 3. Serious — `build.dependsOn` "exactly five" — FIXED

`apps/ptah-electron/src/config/esm-bundle-gate.spec.ts`, `worker wiring
(three-place rule)` describe block: replaced the `toContain`-per-name check
with a set-equality assertion —
`expect([...dependsOn].sort()).toEqual([...OWN_PROJECT_BUILD_TARGETS,
'ptah-extension-webview:build'].sort())` — so a sixth, unrelated entry now
fails the test instead of silently passing it, matching the test's own
"exactly five... plus the webview entry" name.

### 4. Moderate — `runBundleBare` EMFILE robustness — comment added

Per the review's own suggested fix ("worth a comment noting the reliance"):
added a doc comment directly above `runBundleBare` in all applicable spec
files explaining that `spawn(process.execPath, ...)` is not wrapped in
try/catch because `execPath` is always a valid, resolvable path and cannot
throw synchronously the way a caller-supplied path could — `EMFILE` and
similar failures surface asynchronously via the `'error'` event, which is
already handled.

### 5. Moderate — `cleanupOrKeep` PID-scoping — no fix needed, confirmed

The review found this correctly implemented already (no `taskkill`, both
`app.close()` sites call `cleanupOrKeep`) and flagged it only because the
batch's own instructions asked for explicit verification. No code change;
re-confirmed in this revision's verification pass (unchanged from the
original submission).

### 6. FM-2 (unbuilt + skip-enabled banner check) — documented, no fix required

Confirmed as an accepted, small cost of a correct generalization (the
conditional-require design structurally requires reading the built bundle to
know whether a shim is even present). Noted here per the review's
recommendation so a future reviewer does not mistake the local-dev gap for
new coverage: under `PTAH_ALLOW_SKIP_UNBUILT=1` with no build present, the
banner-in-`project.json` check does not run locally — it still runs in CI,
which always builds first via the new `test.dependsOn` wiring (see §1).

### 7. FM-3 (`session.headless.integration.spec.ts` decorative gate) — no action

Unchanged from the original submission; already correctly documented as a
known no-op per PC-6 and the review's own conclusion ("no action needed
beyond what is already documented").

### 8. Style minor #2 — unexplained `as unknown as jest.Describe` cast

Added a one-line comment above the cast in all FOUR `build-artifact-gate.ts`
copies (electron, cli, and the two new ones for vscode/tui) explaining the
structural-vs-nominal typing mismatch against Jest's `Describe` interface —
the exact fix the review suggested.

### 9. `.github/workflows/ci.yml` reorder — REVERTED (redundant)

With `test.dependsOn` now wiring each host's own build targets directly into
the Nx task graph (§1), `nx affected -t test` guarantees the dist artifacts
each host's gate needs REGARDLESS of whether a separate `nx affected -t
build` step runs before or after it — Nx schedules `dependsOn` tasks whenever
the dependent task itself is scheduled, independent of the "affected"
marking of the dependency's own project and independent of step order in the
workflow file. The R-4 concern (tests running before build, dist missing) is
now structurally impossible for the two files it originally named
(`smoke.spec.ts`, the ESM bundle gate) because the test framework itself
pulls the build in first, per project.

**Decision: reverted the reorder.** `.github/workflows/ci.yml` is now
byte-identical to its pre-Batch-4 state (`git diff --stat
.github/workflows/ci.yml` shows no changes). The style-minor observation
about the moved step's missing `name:` field is moot — there is no moved
step anymore.

This was verified, not assumed: cleared `dist/apps/{ptah-electron,ptah-cli,
ptah-extension-vscode,ptah-tui}` and ran `nx run-many -t test -p
ptah-electron ptah-cli ptah-extension-vscode ptah-tui --skip-nx-cache` with
NO preceding build step at all — Nx built exactly the 9 ESM targets (via
each host's `test.dependsOn`) before running any test file, and all four
projects passed. See the verification tail below.

### Re-verification tail (Revision 1)

```
$ npx nx show project ptah-electron --json | ... # test.dependsOn present, no cycle
$ npx nx graph --file=graph.json   # 90 nodes, no cycle diagnostic

$ npx nx run-many -t test -p ptah-electron ptah-cli ptah-extension-vscode ptah-tui --graph=task-graph.json
ptah-electron:test -> [ptah-electron:build-main:production, ptah-electron:build-embedder-worker,
                        ptah-electron:build-integrity-worker, ptah-electron:build-voice-worker]
ptah-cli:test      -> [ptah-cli:build-esbuild:production, ptah-cli:build-embedder-worker,
                        ptah-cli:build-integrity-worker]
ptah-extension-vscode:test -> [ptah-extension-vscode:build-esbuild:production]
ptah-tui:test      -> [ptah-tui:build:production]

$ rm -rf dist/apps/{ptah-electron,ptah-cli,ptah-extension-vscode,ptah-tui}
$ npx nx run-many -t test -p ptah-electron ptah-cli ptah-extension-vscode ptah-tui --skip-nx-cache
NX   Running target test for 4 projects and 37 tasks they depend on:
  ptah-electron:          Test Suites: 1 skipped, 35 passed, 36 total
  ptah-tui:               Test Suites: 26 passed, 26 total
  ptah-cli:               Test Suites: 1 skipped, 66 passed, 67 total
  ptah-extension-vscode:  Test Suites: 5 passed, 5 total
NX   Successfully ran target test for 4 projects and 37 tasks they depend on

$ npx nx run-many -t lint -p ptah-electron ptah-cli ptah-extension-vscode ptah-tui --skip-nx-cache
NX   Running target lint for 4 projects:
  0 errors across all four (pre-existing warnings only)
NX   Successfully ran target lint for 4 projects

$ npx nx run degradation-audit:lint
degradation-audit: TOTAL 564 unsuppressed site(s)   # matches baseline exactly
NX   Successfully ran target lint for project degradation-audit
```

### Re-done mutation check (Revision 1, per-host spec)

```
$ node -e "delete banner from apps/ptah-electron/project.json build-integrity-worker.options.esbuildOptions"
$ npx jest --config apps/ptah-electron/jest.config.ts esm-bundle-gate
FAIL  build-integrity-worker — conditional require invariant › built artifact ›
      defines require via createRequire before any dynamic-require shim can run
Tests: 1 failed, 26 passed, 27 total

$ # restored from backup
$ npx jest --config apps/ptah-electron/jest.config.ts esm-bundle-gate
Tests: 27 passed, 27 total
$ git diff --stat apps/ptah-electron/project.json   # only the test.dependsOn addition remains, banner intact
```

### Re-done skip-policy three-way check (Revision 1, per-host spec)

```
$ mv dist/apps/ptah-electron/integrity-worker.mjs /tmp/...   # simulate unbuilt
$ npx jest ... esm-bundle-gate -t "built artifact"           # no PTAH_ALLOW_SKIP_UNBUILT
FAIL  build-integrity-worker — conditional require invariant › built artifact ›
      requires a build -- run `nx run ptah-electron:build-integrity-worker`, or set
      PTAH_ALLOW_SKIP_UNBUILT=1 to skip locally
Tests: 1 failed, 23 skipped, 3 passed, 27 total

$ PTAH_ALLOW_SKIP_UNBUILT=1 npx jest ... esm-bundle-gate -t "built artifact"
Tests: 24 skipped, 3 passed, 27 total          # skip permitted under the escape hatch

$ mv /tmp/... dist/apps/ptah-electron/integrity-worker.mjs   # restore
$ npx jest ... esm-bundle-gate -t "built artifact"
Tests: 23 skipped, 4 passed, 27 total          # runs and passes once built
```

### Deviations / notes

- The per-host split means `WORKER_ENTRY_GUARDS`/discovery/conditional-require
  logic is now duplicated FOUR times (one block of ~150 lines per host)
  instead of living once in a combined file. This is the direct, accepted
  cost of the orchestrator's ruling (no shared lib across apps) and mirrors
  the existing `build-artifact-gate.ts` duplication policy from the original
  submission.
- `apps/ptah-extension-vscode` and `apps/ptah-tui` carry a worker-shaped
  coverage assertion against an intentionally empty `WORKER_ENTRY_GUARDS`
  map. This is not vestigial: it is what makes a FUTURE `build-*-worker`
  target on either host subject to the same anti-vacuity rule the other two
  hosts already enforce, rather than a silent gap that would need to be
  independently remembered.

---

## Files changed

- CREATED `apps/ptah-electron/src/config/esm-bundle-gate.spec.ts` (406 lines)
  — the generalized ESM bundle gate. Replaces
  `apps/ptah-electron/src/config/integrity-worker-bundle.spec.ts` (DELETED).
- CREATED `apps/ptah-electron/src/config/build-artifact-gate.ts` (49 lines)
  — `describeIfBuiltOrFail(artifactPath, buildCommand)`.
- CREATED `apps/ptah-cli/src/test-utils/build-artifact-gate.ts` (49 lines)
  — the same function, duplicated per host per `batches.md` ("two apps do
  not justify one lib").
- MODIFIED `apps/ptah-cli/src/smoke.spec.ts` — `describeIfBuilt` now goes
  through `describeIfBuiltOrFail(DIST_BIN, 'nx build ptah-cli')` instead of a
  bare `existsSync` ternary (Task 4.2 site 1).
- MODIFIED
  `apps/ptah-cli/src/cli/commands/session.headless.integration.spec.ts` —
  PC-6: the `existsSync(DIST_BIN)` conjunct replaced with
  `describeIfBuiltOrFail`, gated behind the `STUB_CLAUDE_AVAILABLE` branch so
  today's behavior is unchanged (see "R-4 / PC-6" below).
- MODIFIED `apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs` — `--keep-db`
  flag + `cleanupOrKeep()`, called from both `app.close()` exit paths
  (Task 4.4 / PC-9).
- MODIFIED `.github/workflows/ci.yml` — `nx affected -t build` moved before
  `nx affected -t test --coverage` (Task 4.3, R-4).

## Discovered ESM targets (9)

| host                  | target                 | banner idiom                                                  | shim present in built bundle?                                                            | entry-guard message                                                                                     |
| --------------------- | ---------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| ptah-electron         | build-main             | `esbuildConfig` file (`esbuild.config.cjs`, `createRequire`)  | yes (`better-sqlite3` external)                                                          | n/a (app entry, not a worker)                                                                           |
| ptah-electron         | build-embedder-worker  | none                                                          | no                                                                                       | `embedder-worker.ts must be run as a worker (no Electron parentPort and no worker_threads parentPort)`  |
| ptah-electron         | build-integrity-worker | inline `esbuildOptions.banner`                                | yes (`better-sqlite3` external)                                                          | `integrity-worker.ts must be run as a worker (no Electron parentPort and no worker_threads parentPort)` |
| ptah-electron         | build-voice-worker     | none                                                          | no                                                                                       | `voice-worker.ts must be run as an Electron utilityProcess (no parentPort)`                             |
| ptah-cli              | build-esbuild          | inline `esbuildOptions.banner`                                | n/a (no better-sqlite3 in this bundle's require path at banner-check time; not asserted) | n/a (app entry)                                                                                         |
| ptah-cli              | build-embedder-worker  | none                                                          | no                                                                                       | same embedder message as above                                                                          |
| ptah-cli              | build-integrity-worker | inline `esbuildOptions.banner`                                | yes                                                                                      | same integrity message as above                                                                         |
| ptah-extension-vscode | build-esbuild          | inline `esbuildOptions.banner` (both dev/prod configurations) | not checked (no `better-sqlite3` external declared)                                      | n/a (app entry)                                                                                         |
| ptah-tui              | build                  | inline `esbuildOptions.banner`                                | n/a                                                                                      | n/a (app entry)                                                                                         |

Discovery is generic (reads every `apps/*/project.json`, filters
`executor === '@nx/esbuild:esbuild' && options.format === ['esm']`), not
hardcoded to these 9 — the anti-vacuity test asserts the discovered map
contains all nine known `host:target` ids, so a rename of any one fails
loudly rather than shrinking the suite silently. `build-preload` (cjs) and
the `build`/`build-esbuild` **wrapper** noops correctly fall outside the
filter.

## R-8 — did embedder-worker / voice-worker need a `--self-test` argument?

**No. Neither needed one.** Both already fail deterministically when spawned
bare:

- `embedder-worker.ts` probes `process.parentPort` (Electron) then
  `node:worker_threads`' `parentPort`; when run under plain
  `node --input-type=module` neither exists, so the `else` branch throws
  synchronously at module-evaluation time, before any heavy import runs
  (`@huggingface/transformers` is only dynamic-imported inside functions
  that are never called at the top level).
- `voice-worker.ts` checks only `process.parentPort` and throws
  synchronously the same way.

This was verified experimentally, not just read from source: the executable
self-test (see below) spawns all five built worker bundles and asserts each
exits non-zero with `stderr` containing exactly its own entry-guard string,
under a 10s bounded, PID-killed timeout — all 5×2 = 10 assertions passed with
no `--self-test` flag added to either source file.

## Mutation-check evidence

```
$ node -e "delete banner from apps/ptah-electron/project.json build-integrity-worker.options.esbuildOptions"
$ npx jest --config apps/ptah-electron/jest.config.ts esm-bundle-gate
FAIL ptah-electron apps/ptah-electron/src/config/esm-bundle-gate.spec.ts
  ● ptah-electron:build-integrity-worker — conditional require invariant › built artifact ›
    defines require via createRequire before any dynamic-require shim can run
    Expected substring: "createRequire"
    Received string:    ""
Test Suites: 1 failed, 1 total
Tests:       1 failed, 39 passed, 40 total

$ git checkout -- apps/ptah-electron/project.json   # (restored from a backup copy)
$ npx jest --config apps/ptah-electron/jest.config.ts esm-bundle-gate
Test Suites: 1 passed, 1 total
Tests:       40 passed, 40 total
```

Exactly one test failed (the target's own banner-invariant check), everything
else stayed green, and the file was restored with zero diff afterward.

## R-4 resolution (CI dist-chain)

Confirmed: `ci.yml` ran `nx affected -t test --coverage --parallel=3` BEFORE
`nx affected -t build`. With Task 4.2's tightened rule (fail, don't skip, on
a missing dist), that ordering would make `smoke.spec.ts` and
`esm-bundle-gate.spec.ts` fail on every CI run, since no `dist/` exists yet
when `test` runs. **Resolution: add the build to the job by moving it before
the test step**, rather than weakening the fail-vs-skip rule. Diff:

```diff
+      - run: npx nx affected -t build
+
       - name: Run affected tests with coverage
         run: npx nx affected -t test --coverage --parallel=3
-
-      - run: npx nx affected -t build
```

No other job semantics changed — both targets still run against the same
`nx affected` set; only the order changed.

### PC-6 note

`session.headless.integration.spec.ts:62`'s `STUB_CLAUDE_AVAILABLE = false`
still unconditionally forces `describe.skip` before the dist check is ever
consulted, so replacing its `existsSync(DIST_BIN)` conjunct with
`describeIfBuiltOrFail` has **zero observable effect today** — confirmed by
the full `ptah-cli` test run below (this suite is in the "1 skipped" test
suite line, unchanged from before the edit). It is not counted as fixed
green-by-skip; it only makes the suite consistent with the rest of the batch
once `STUB_CLAUDE_AVAILABLE` is eventually flipped true.

## `--keep-db` evidence

Ran the real `cleanupOrKeep()` logic (extracted verbatim into an isolated
script against real temp dirs — a full Electron boot-probe run needs a dev
build + a live workspace and was not exercised end-to-end here):

```
--- WITHOUT --keep-db ---
cleaned up
db dir exists after: false
userData exists after: false
--- WITH --keep-db ---
[probe] --keep-db set; retaining run artifacts:
  database:   ...\ptah-bootprobe-test-e5RYfc\probe.sqlite
  userData:   ...\ptah-bootprobe-udd-test-DH8CxO
db dir exists after: true
userData exists after: true
```

`cleanupOrKeep(db, userDataDir)` is called from BOTH `app.close()` sites
(the early-failure path right after `app.evaluate(INSTALL_PROBE)` throws,
and the normal end-of-run path) — PC-9. Termination stays PID-scoped
throughout: the script never calls `taskkill`; the only process-ending calls
are Playwright's `app.close()` (already PID-scoped to the launched
`_electron` instance) and, inside `esm-bundle-gate.spec.ts`'s self-test,
`process.kill(child.pid, 'SIGKILL')` against the specific spawned child.

## Verification tail

```
$ npx nx build-integrity-worker ptah-electron --skip-nx-cache
NX   Successfully ran target build-integrity-worker for project ptah-electron

$ npx nx build-integrity-worker ptah-cli --skip-nx-cache
NX   Successfully ran target build-integrity-worker for project ptah-cli and 28 tasks it depends on

$ npx nx run-many -t build,build-integrity-worker,build-embedder-worker -p ptah-cli ptah-tui --skip-nx-cache
NX   Successfully ran targets build, build-integrity-worker, build-embedder-worker for 2 projects and 27 tasks they depend on
   # (also separately: ptah-electron build-main / build-embedder-worker / build-voice-worker,
   #  ptah-extension-vscode build-esbuild — all 9 targets built and present simultaneously)

$ npx nx run-many -t test -p ptah-electron ptah-cli
Running target test for 2 projects
ptah-cli:   Test Suites: 1 skipped, 65 passed, 66 total | Tests: 3 skipped, 973 passed, 976 total
ptah-electron: Test Suites: 1 skipped, 35 passed, 36 total | Tests: 4 skipped, 493 passed, 497 total
NX   Successfully ran target test for 2 projects

$ npx jest --config apps/ptah-electron/jest.config.ts -t "self-test" --verbose
Test Suites: 35 skipped, 1 passed, 36 total
Tests:       487 skipped, 10 passed, 497 total   # 5 worker bundles x 2 assertions each

$ npx nx run-many -t lint -p ptah-electron ptah-cli --skip-nx-cache
NX   Successfully ran target lint for 2 projects   # 0 errors, 126 pre-existing warnings

$ npx nx run degradation-audit:lint
degradation-audit: TOTAL 564 unsuppressed site(s)   # matches baseline exactly, zero orphans
NX   Successfully ran target lint for project degradation-audit
```

`npx nx reset` failed with `EPERM` cleaning `.nx/workspace-data` (a stale
lock in this worktree, unrelated to this batch's edits) — non-fatal; all
subsequent commands ran with `--skip-nx-cache` where freshness mattered.

## Deviations from the literal build-order in the verification script

The `Batch 4 verification` block in `batches.md` invokes each worker-build
target as a separate `nx` call. Run that way, later separate invocations
(each depending on the same host's `build`) re-triggered `build-esbuild`'s
`deleteOutputPath: true` and wiped a sibling worker's `.mjs` that a prior,
separate invocation had just produced — an artifact of running dependent
targets across SEPARATE `nx` processes on `ptah-cli`, not a defect in the
project.json wiring itself (a single `nx affected -t build` in CI computes
one task graph and runs `build` once for every dependent). Verification
below instead builds all `ptah-cli`-family targets in one
`run-many -t build,build-integrity-worker,build-embedder-worker -p ptah-cli
ptah-tui` call so `build` executes exactly once and every dependent artifact
coexists — this is how the acceptance criteria ("every built bundle loads as
a process...") was actually satisfied.

## Out of scope, untouched

- `bootstrap-regression.e2e.spec.ts` and the ~75 `nativeAvailable` /
  platform / env-flag guards — not touched, per Task 4.2 scope.
- No `--self-test` argument added to `embedder-worker.ts` or
  `voice-worker.ts` (R-8 answer: not needed).
- `apps/ptah-cli/src/cli/commands/config.spec.ts` and `ptah-spec.spec.ts`
  intermittently fail with a Jest transform-cache `EPERM` on this machine
  (Windows AV/file-lock race unrelated to this batch); they passed cleanly on
  the immediately-following re-run and are not part of this batch's files.
