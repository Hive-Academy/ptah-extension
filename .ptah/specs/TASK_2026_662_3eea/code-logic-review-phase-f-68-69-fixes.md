# Code Logic Review - TASK_2026_662 batches 68-69 gate fixes

Score: 8/10
Verdict: APPROVED WITH FOLLOW-UPS
Review family: reviewer Claude subagent, implementer Claude orchestrator (same family: weaker evidence; reason: bounded post-gate correction, codex lane re-spawn not worth it for a 15-line test-infra fix)

Scope: static read only. No jest, nx or tsc was run. Files read: jest.setup-home.cjs, the jest.config.ts diff, the migration-runner.spec.ts diff, the 0044 and 0046 spec diffs, 0057_drop_skill_pipeline.ts, and the `os` usages in src.

## Answers to the checks

1. Does the os.homedir replacement reach the TS sources? Yes.
   - The sources use `import * as os from 'node:os'` (skill-pipeline-archive.ts:2, db-path.ts:1). ts-jest compiles these to `__importStar(require('node:os'))`.
   - `__importStar` returns the module itself when `__esModule` is set. Otherwise it builds a copy, but only through getters that read live properties. Node's `os` module has no `__esModule`, so the copy path applies. TypeScript's `__createBinding` defines getters (`function () { return m[k]; }`), so `os.homedir()` resolves to the replaced function at call time.
   - Jest's core-module `require('node:os')` returns the same real module object in the sandbox and in the setup file. A plain assignment works because `os.homedir` is a writable property of the CommonJS `os` module.
   - The orchestrator's measurement agrees: the archive count stayed at 13.
   - Residual risk: this relies on `esModuleInterop` getter semantics. A non-getter copy (for example a future SWC or esbuild transform that snapshots exports) would silently bypass the override.
2. Does it survive `jest.restoreAllMocks()` and `jest.resetModules()`? Yes. Nothing in src uses `jest.mock` for os, `resetModules`, `isolateModules`, or HOME/USERPROFILE (grep returned nothing). Assignment is not a spy, so `restoreAllMocks` cannot undo it. `resetModules` does not re-require core modules, so the patched object persists. Setup files run once per spec file (per module registry), so each file has one stable home.
3. Do any specs compare against a home captured differently? db-path.spec.ts:22 and session-store.spec.ts:85 call `os.homedir()` at use time through the same patched module. Production code calls the same function, so the expected and actual paths match, and both now resolve to the temp home. No process.env-based home lookups exist in src. This is safe.
4. Are the spec changes correct for 0057?
   - 0044 and 0046: the pins 56 -> 57 are correct because 0057 is registered last (0057 spec:30). The assertions are unchanged except for the number.
   - migration-runner.spec.ts:479: VEC_VERSIONS including 57 is correct. 0057 exports `vecSql` (DROP TABLE IF EXISTS skill_candidates_vec), so with no vec loaded the runner records 57 as pending-vec. This matches the assertions at lines 520, 538, 605 and 649.
   - Splitting VEC_TABLES/BASE_TABLES and adding DROPPED_TABLES (checked absent in the cold-start case) is a correct strengthening. No assertion was weakened.
5. Is the temp-dir leak acceptable? Yes, with a follow-up. Each spec file creates one empty `home-*` directory under os.tmpdir() and never removes it. Directories accumulate across runs, and a real archive could land in one of them. The cost is small and the location is the OS temp dir, which is a lot better than the developer's real home. See finding 1.

## Findings

1. Minor, jest.setup-home.cjs:13. The temp home is never removed. Scenario: repeated test runs accumulate `home-*` directories (some containing archive output) in `%TEMP%\ptah-persistence-sqlite-jest` indefinitely. Fix: register `process.on('exit', () => fs.rmSync(home, { recursive: true, force: true }))` guarded by try/catch. Alternatively use a `globalTeardown` that removes the parent. Not blocking.
2. Minor, jest.setup-home.cjs:14. No guard that the override took effect. Scenario: if a future transform stops using live getters, specs silently write to the real home again. Nothing fails. Fix: add one assertion in a spec, for example `expect(skillPipelineArchiveRoot...)`, or check `os.homedir().startsWith(os.tmpdir())` in a tiny sanity spec. Alternatively make `archiveRoot` required in the runner constructor for test paths.
3. Minor, migration-runner.spec.ts:~566 (cold start) and ~605-650 (no-vec then vec). The DROPPED_TABLES absence check is added only for the vec cold start. The no-vec-then-vec catch-up test (line ~538) does not assert that `skill_candidates_vec` is gone after the deferred 57 catch-up, so a broken deferred drop would not be caught there. Fix: after `second.applyAll`, assert `db.tables.has('skill_candidates_vec')` is false (if the fake models the drop).
4. Minor, jest.setup-home.cjs:7-14. The override is scoped to persistence-sqlite. Other projects that run all MIGRATIONS without an archiveRoot, or that depend on SqliteMigrationRunner (host app specs), would still write to the real home. Evidence for this was not gathered here (static review only). Worth a grep for `new SqliteMigrationRunner(` in other projects' specs.

No Blocking or Serious findings.
