# Batch 38a — executor report (carried fixes before the completion gate)

Worktree `.claude-worktrees/task-559-mcp-tool-contract`, branch `fix/task-559-mcp-tool-contract`, HEAD e933f8c06. Nothing
committed. `libs/backend/workspace-intelligence/src/ast/**` not touched (Lane G2).

## Item (a) — flaky "delivers a slow empty build to the next call, then rediscovers"

**Root cause.** The test already used fake timers for the 2 s bounded wait. The flake came from somewhere else:
`with the real graph service` uses the real `DependencyGraphService`. After `slowEmpty.resolve([])`, its
`buildGraph` awaits real filesystem I/O on the libuv thread pool: `realRootIdentity` → `fs.promises.realpath(root)`
(`dependency-graph.service.ts:245-263`), and `buildResolverContext` manifest reads. The test then waited only a fixed
50 `setImmediate` turns (`flush()`) before asserting `s.graph.isBuilt(root)`. Under parallel load the thread-pool I/O
finishes after those 50 turns, the graph is not yet published, and the assertion fails. Fake timers cannot help,
because the race is against real I/O, not timers.

**Fix** (test only, `protocol-dispatcher.spec.ts`). The test now waits on the real build's own promise, not a turn
count. It spies `s.graph.buildGraph` on the per-test service instance and resolves `buildsDone[n]` with each build's
promise. It awaits `buildsDone[0]` after the slow discovery resolves, then runs `flush()` to drain the dispatcher's
microtask bookkeeping (`latch.empty.set`, job `finally`), which does no I/O. It likewise awaits `buildsDone[1]` for
the held rediscovery at the end, so no build outlives the test.

As a permanent pin, the test also holds `fs.promises.realpath` for 200 macrotasks, far beyond any fixed flush, so it
cannot pass by winning the race. The spy is restored in `finally`. Every Decision 16 assertion is unchanged:

- The first call answers `building`.
- The unconsumed empty result is delivered to the second call (`total: 0`, no status, no new discovery: `findFiles`
  called once).
- The third call rediscovers (`building`, `findFiles` called twice).

**Fails-before (deterministic).** With the 200-turn realpath hold and the old `flush()` wait:
`● … delivers a slow empty build … Expected: true Received: false at protocol-dispatcher.spec.ts:6644`
(`expect(s.graph.isBuilt(root))`), `Tests: 1 failed`. This is the same step the flake loses. Natural reproduction
before the fix: 1 failure in 18 runs of the `real graph service` group across 8 and 10 concurrent jest processes.

**Repeat-run evidence after the fix.**

- The spec file 5 times in a row, each `Tests: 298 passed, 298 total`.
- 10 concurrent jest processes of the `real graph service` group: `10 × Tests: 288 skipped, 10 passed`.
- Full vscode-lm-tools suite, `jest --maxWorkers=1`: `Test Suites: 77 passed, 77 total`, `Tests: 2463 passed, 2463 total`.

## Item (b) — `_test` package attribution (Lane K Moderate 5)

**Root cause.** `packageDirForId` (`go-vet-output.ts:178-194`) dropped everything after the first space, so it
discarded the `[<pkg>.test]` bracket, the only exact part of a test-variant id. It then stripped `.test` and `_test`
unconditionally. A real `a_test` package therefore mapped to its sibling `a`:

- Its internal test variant `a_test [a_test.test]` mapped to `a`.
- A bare `a_test` id also mapped to `a`.

As a result, the real `a_test` requested file stayed credited as checked, and `a` was disqualified instead.

**Fix.** `packageDirForId` is replaced by `packageDirsForId(...): string[] | null`. The checker disqualifies every
returned directory (`go-vet-checker.ts` unmapped loop; the import and re-export are renamed).

- **Bracketed id** `<path> [<pkg>.test]`: this is exact.
  - `<pkg>_test` (the external test package) → `<pkg>`'s directory.
  - Any other `<path>` → its own directory.
  - Examples: `a_test [a.test]` → `a`; `a_test [a_test.test]` → `a_test`; `a_test_test [a_test.test]` → `a_test`.
- **Bare id** that could be a test variant reported without its bracket: returns every candidate, and all are
  disqualified, never guessed.
  - `a_test` → [`a_test`, `a`].
  - `a.test` → [`a.test`, `a`].
- A candidate no vetted file lives in costs nothing, so the exact real package is effectively preferred whenever only
  one candidate was vetted.
- Candidates outside the module are dropped (e.g. `example.com/m_test` → module root). If none remain, the result is
  `null` and every vetted file is disqualified, as before.

**Tests** (`go-vet-checker.spec.ts`, describe "review r1 finding 3"):

1. `a finding of a real \`a_test\` package disqualifies that package, not its sibling \`a\``(bracketed`a_test [a_test.test]`)
2. `a bare \`a_test\` id that is only the real package disqualifies that package`
3. `a bare \`a_test\` id that may be either package disqualifies both, never guessing`
4. `the external test package of \`a\` still disqualifies \`a\`, not a real \`a_test\` package`(existing sibling case,`a_test [a.test]`)
5. `packageDirsForId maps a module package and its test variants, nothing else` (rewritten unit table: bracketed, bare,
   `.test`, module-root `_test`, outside, `..`, `command-line-arguments`, null module path)

**Fails-before.** Tests 1-4 were added before the source change and run against the old code:
`Tests: 3 failed, 52 skipped, 4 passed`. Tests 1, 2 and 3 failed (wrong `checkedFiles`/`skippedFiles`). Test 4, the
sibling case, passed, as it should. After the fix, the external-checkers folder gives `Tests: 9 skipped, 120 passed`.
The 9 skipped tests are the real-Go hostile integration spec, which needs Go.

## Item (c) — spec temp dirs

**Root cause.** Both wiring specs `mkdtemp` a dir per test and never removed it (comment: "No cleanup"). Phase 0
registers an output channel (`ElectronOutputChannel` / `CliOutputChannel`) whose `fs.createWriteStream` under
`user-data/logs` opens asynchronously, and whose `dispose()` only calls `end()`, which closes asynchronously too.
Removing the directory before the stream closes fails the pending open with an unhandled stream `error`.

**Fix** (both specs):

- `buildHostContainer` records each container.
- `beforeEach` spies `createWriteStream` on the core `node:fs` module via `jest.requireActual`, because the spec's
  `import * as fs` namespace is not spyable and the channel's namespace reads through to the core object. The spy
  collects the streams.
- `afterEach` does the following in order:
  1. Disposes each container's `PLATFORM_TOKENS.OUTPUT_CHANNEL`.
  2. Asserts it saw at least one stream per channel, so the wait cannot silently become a no-op.
  3. Awaits `close` on every stream that is not already closed.
  4. Restores the spy.
  5. Runs `fs.rmSync(tmp, { recursive: true, force: true })`.

**Temp-dir counts** (`ptah-*-govet-*` in `os.tmpdir()`):

- Before the fix:
  - Electron spec: 164 → 169 (+5).
  - CLI spec: 169 → 175 (+6).
- After the fix:
  - Electron spec: 175 → 175.
  - CLI spec: 175 → 175.
  - Full workspace-intelligence + ptah-electron + cli-engine test/lint/typecheck run: 175 → 175.

The 175 existing leftovers from earlier runs were not deleted; they are outside this batch's ownership.

## Changed paths

- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- MODIFIED `libs/backend/workspace-intelligence/src/diagnostics/external-checkers/go-vet-output.ts`
- MODIFIED `libs/backend/workspace-intelligence/src/diagnostics/external-checkers/go-vet-checker.ts`
- MODIFIED `libs/backend/workspace-intelligence/src/diagnostics/external-checkers/go-vet-checker.spec.ts`
- MODIFIED `apps/ptah-electron/src/di/phase-2-diagnostics-override.spec.ts`
- MODIFIED `libs/backend/cli-engine/src/lib/container-diagnostics-override.spec.ts` (the CLI wiring spec lives in
  cli-engine, not apps/ptah-cli or platform-cli)
- CREATED this report.

Prettier was run with `--write` only on the three workspace-intelligence files above. Their HEAD versions were
verified Prettier-clean first, so only my hunks changed.

## Verification

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence ptah-electron @ptah-extension/cli-engine --skip-nx-cache --parallel=2`
  → `Successfully ran targets test, lint, typecheck for 4 projects and 6 tasks they depend on`.
- Re-run after formatting, for workspace-intelligence, ptah-electron and cli-engine → `Successfully ran targets test,
lint, typecheck for 3 projects and 6 tasks they depend on`.
- `npx nx run ptah-electron:validate-deps --skip-nx-cache` → `Successfully ran target validate-deps`.
- `npx nx run degradation-audit:lint --skip-nx-cache` → `TOTAL 300 unsuppressed site(s)`, success. The baseline is
  unchanged.
- `ptah_get_diagnostics` on go-vet-output.ts / go-vet-checker.ts → 0 errors.
- Not run here: the dependent-project sweep (item d), which belongs to the Batch 38 gate. The real-Go hostile spec
  (item e) was not run because Go is not installed.

## Other writers / observations

- `.ptah/specs/TASK_2026_559_8ca9/context.md` shows as modified (+2 lines). I did not make that change and left it
  untouched. `code-logic-review.md` and `research/diagnostics-worktree-repro.ts` remain untracked and untouched.
- Out of scope (platform-core): `PtahFileSettingsManager.loadSync` prints
  `Failed to load settings … ENOENT` in the CLI wiring spec. Under Jest, `isNodeError`'s `error instanceof Error`
  fails across realms, so the ENOENT first-run path logs a warning. It runs synchronously at construction, so it
  predates and does not depend on the new teardown.

## Fix round (review r1)

Review `reviews/batch-38a-code-logic-review-r1.md`: REVISE 7/10. Lane K finding 5 CLOSED; item (a) accepted. One
finding fixed.

### R38A-01 Moderate — wiring-spec teardown could skip restore and removal

**Cause.** The r0 `afterEach` in both specs ran four steps in a row with no protection:

1. `c.resolve(OUTPUT_CHANNEL).dispose()`
2. the stream-count `expect`
3. `events.once(stream, 'close')`
4. `mockRestore()` and `rmSync`

If a partial setup had no channel, step 1 threw. If the stream failed asynchronously, `events.once` rejected on
`'error'` (for example ENOENT on open). Either way the spy restore and the removal were skipped.

**Fix** (both `apps/ptah-electron/src/di/phase-2-diagnostics-override.spec.ts` and
`libs/backend/cli-engine/src/lib/container-diagnostics-override.spec.ts`; kept per-spec, since they are in two
projects). New module-level helpers:

- `watchWriteStreams()`: the spy on the core `node:fs` `createWriteStream`, collecting the streams it opens.
- `streamSettled(stream)`: resolves on `close` OR `error`, never rejects, and returns at once when
  `stream.closed`. Its `error` listener also keeps a late failure from escaping as unhandled.
- `releaseHost(containers, watched, dir)`: disposes each container's channel, tolerating a channel that is missing or
  fails, then awaits every stream. `watched.spy.mockRestore()` and
  `fs.rmSync(dir, { recursive: true, force: true })` sit in a `finally`, so they always run. It returns the number of
  channels disposed.

The hooks now use these helpers:

- `beforeEach` resets `tmp`/`watched` first, so a failed setup does not reuse the previous test's values.
- `afterEach` calls `releaseHost`. Only after cleanup does it assert that the spy saw at least one stream per disposed
  channel.

**Regression** (one per spec). "Electron / CLI wiring spec teardown (Batch 38a review r1, R38A-01) › restores the spy
and removes the directory after a stream error and a missing channel". The test:

1. Opens a real `fs.WriteStream` under `<dir>/missing/x.log`, so the open fails asynchronously with ENOENT (the error
   path).
2. Passes a child container that never registered the output channel (a partial setup).
3. Asserts:
   - the stream error was ENOENT
   - `disposed === 0`
   - the stream was captured
   - `coreFs.createWriteStream` is the original again (restored)
   - `fs.existsSync(dir) === false`

**Fails-before.** I temporarily swapped `releaseHost` in the Electron spec for the r0 logic (unguarded resolve,
`events.once(close)`, no `finally`). The regression failed (`Tests: 1 failed, 5 skipped`), and its temp dir leaked
(`ptah-electron-govet-*` 115 → 116). After restoring the file, it passed (`1 passed, 5 skipped`). I then removed the
one empty dir that probe leaked.

**Verification.**

- Electron spec `Tests: 6 passed, 6 total`; CLI spec `Tests: 7 passed, 7 total`. `ptah-*-govet-*` count 175 before,
  175 after.
- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p ptah-electron @ptah-extension/cli-engine --skip-nx-cache` →
  `Successfully ran targets test, lint, typecheck for 2 projects and 6 tasks they depend on`.
- `npx nx run degradation-audit:lint --skip-nx-cache` → `TOTAL 300`, unchanged.
- Prettier `--write` was run only on the two specs. Their HEAD versions were verified Prettier-clean first.

**Other writers.** `context.md` is still modified by someone else. `reviews/batch-38a-code-logic-review-r1.md` is new
and untracked (the reviewer's). Neither was touched.
