# Code-logic review — Phase 3.4 (Batches 15 and 16)

Reviewer: `code-logic-reviewer` (CLI lane). Read-only; one deliverable.

Scope, read in full:

- **B15** `6d5bf327c` — `host/memory-skills-host.entry.ts`, `host/memory-skills-host.ts`,
  `host/plan.schema.ts`, `host/fixture-seeder.ts`, `host/doubles-override.ts` (+ specs),
  `project.json` (build target).
- **B16** `44a3329c4` — `runner/run-memory-skills.{ts,entry.ts}`, `runner/read-path-guard.ts`,
  `runner/runner-plan.ts`, `runner/offline-suites.ts`, `runner/case-runner.ts`,
  `runner/host-completion-reader.ts`, `runner/ground-truth-freshness.ts`,
  `runner/suite-result.ts`, `runner/run-scorecard.ts` (+ specs), the Batch 8/9 entry-default
  changes under `data/` and `labelling/`, `project.json` (bench target).
- Supporting contracts read as needed: `bench-data.ts` (619), `transport/host-launcher.ts`
  (619, `HostExit`/`stop` contract), `gate/known-failures.ts` (B13), `runner/net-recorder.ts`
  (B14), `host-only-imports.spec.ts`, `context.md` §"619 answers to design §6.6" (lines
  97-176), `batch-15-report.md`, `batch-16-report.md`, `batches.md` Batch 15/16 sections
  (lines 616-674).

Verification run (the only check, scoped as allowed):

```
npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills --runInBand
Test Suites: 36 passed, 36 total
Tests:       405 passed, 405 total
```

PASS lines seen for every suite named below, including
`runner/run-memory-skills.spec.ts`, `runner/read-path-guard.spec.ts`,
`runner/case-runner.spec.ts`, `runner/ground-truth-freshness.spec.ts`,
`runner/suite-result.spec.ts`, `host/fixture-seeder.spec.ts`,
`host/memory-skills-host.spec.ts`, `host/doubles-override.spec.ts`,
`host/plan.schema.spec.ts`, `host-only-imports.spec.ts`.

## The five logic questions

1. **Silent failure?** Two places produce a success-looking result under failure: the
   committed-files snapshot going stale mid-run (Finding 2) and the non-CI exit code
   ignoring suite errors and guard trips (Finding 3). Both are bounded below; neither
   touches the real `~/.ptah` path, which fails closed everywhere I could push it.
2. **Unexpected user action?** `bench-memory-skills` without `--ci` while every suite
   fails (or one suite is refused a read) still prints `"benchMemorySkills":"ok"` and
   exits 0 (Finding 3). A `record`-mode plan naming a cassette inside the committed
   fixtures dir writes into the repository tree (Finding 7).
3. **Wrong answer, not an error?** A mid-run edit to a committed CSV is read as if from
   HEAD (Finding 2). Two concurrent runs sharing a bench data dir can drop a
   first-scored ledger entry and later score changed labels under the old version id
   without any refusal (Finding 4).
4. **Dependency failure?** Traced and handled: host crash before completion → `exited-early`
   → problem + exit 1 (`run-memory-skills.ts:578-585`, spec :441-453); crash during
   shutdown → `crash-on-shutdown`, a run fact, never a suite error, completion already on
   disk (`memory-skills-host.ts:255-276`, entry :111-113); completion timeout → `null` →
   problem (`host-completion-reader.ts:104-122`, `run-memory-skills.ts:575-577`); invalid
   completion JSON → hard run error with the host still stopped (`host-completion-reader.ts:78-93`,
   spec :456-478); non-ENOENT realpath failures → refusal, not a skip (`read-path-guard.ts:116-122`,
   `bench-data.ts:257-264`). One masking uncertainty in the catch path (Finding 10).
5. **Missing?** The isolated home equal to the real `~/.ptah` is not refused (Finding 1);
   `--workspace` under the real `~/.ptah` is not refused (Finding 8); two documented
   behaviours have no pinning test (Finding 9).

## Findings

All severities use the role definitions. No blocking, no serious findings. The jest lines
quoted in each finding are from the run above.

1. **[Moderate] The seeder's overlap check misses the isolated home _being_ the real `~/.ptah`.**
   `host/fixture-seeder.ts:108-115` refuses `isSamePath(realHome, home)`,
   `isPathInside(realHome, home)` and `isPathInside(home, realPtah)` — but `isPathInside`
   is strict (`bench-data.ts:87`, `rel !== ''`), so `home === ~/.ptah` (the isolated home
   is exactly the real state directory) passes every clause. In that case `seed()` copies
   the database fixture to `isolation.dbPath` without any target check
   (`fixture-seeder.ts:149-159`; only file/directory fixtures go through `target()`,
   `:203-212`), and the engine then opens that path as its DB — inside the real
   `~/.ptah`. Precondition: 619's launcher misconfigures the temp home to be exactly
   `~/.ptah` (a temp dir _inside_ it is caught). This constructor exists precisely to
   fail closed on that misconfiguration, and every sibling check in this feature handles
   the equality case (`plan.schema.ts:140-142` `underRealPtah` = same-or-inside;
   `read-path-guard.ts:102-103` `atOrUnder`). One `isSamePath(home, this.realPtah)`
   clause closes it. Not covered by `fixture-seeder.spec.ts` (suite PASS in the jest run;
   no test asserts this equality). Fix is one line; recommend before B17 wires real
   fixtures through it.

2. **[Moderate] The read-path guard's committed-files snapshot goes stale mid-run (TOCTOU).**
   `listCommittedFiles` (`runner/read-path-guard.ts:61-78`) runs once at step 1
   (`run-memory-skills.ts:448-455`); `assertReadable` (`:136-184`, membership at `:166`)
   only checks the path against that snapshot and never re-verifies the file's git state
   at read time. The module's own promise — "a scored number never comes from an
   uncommitted edit" (`read-path-guard.ts:5-6`) — is broken by any edit made after step
   1: an offline suite's `guard.readText(csv)` still reads the edited bytes and the
   scorecard attributes them to HEAD. A run holds the launcher window for up to 4 h
   (`DEFAULT_HOST_COMPLETION_TIMEOUT_MS`, `run-memory-skills.ts:136`) on the developer's
   live worktree, so a mid-run IDE auto-save is a realistic local event;
   `readProduct`'s `-dirty` flag (`run-scorecard.ts:89-95`) is also computed at step 1
   and does not catch it. Silent by construction (the read succeeds). `read-path-guard.spec.ts`
   passes (jest run) but freezes `committedFiles` per guard instance, so the window is
   untested. Recommend a per-read `git status` re-check, or a hash pin of allowed files
   at step 1.

3. **[Moderate] Outside `--ci`, suite errors and parent guard trips cannot fail the run.**
   `runner/offline-suites.ts:100-105` catches every suite failure — including
   `ReadPathRefusedError` — into `status: 'error'`; `collectSuites` (`run-scorecard.ts:172-182`)
   turns that into a `missing` entry; `problems`/`exitCode` (`run-memory-skills.ts:574-590`,
   `:626`) count only the CI gate, a missing completion, or `exited-early`/`killed`. So a
   local run in which a suite attempted a forbidden read still prints
   `"benchMemorySkills":"ok"` and exits 0; the failure is visible only inside the stdout
   suite list (`run-memory-skills.entry.ts:121-125`) and `run-summary.json`. In `--ci`
   the gate does catch it (a missing suite has `executedCases: 0` → `zero-cases` finding,
   `gate/known-failures.ts:133-140`; network hits → `network-hit`, `:169-173`; wired at
   `run-memory-skills.ts:556-572`). The asymmetry vs the host side is the issue: a
   real-state guard trip in the host rejects `stop()` (`transport/host-launcher.ts:226-231`)
   and aborts the run with exit 1 in _every_ mode, while the parent's analogue aborts
   nothing outside CI. Batch-16-report.md:79-84 documents the three exit-1 causes, so
   this is intended behaviour — but for a bench whose top rule is "never touch real
   data", a refused read deserves at least a problem line. Spec evidence: `run-memory-skills.spec.ts`
   covers the CI gate and the refusals (PASS, jest run) but no test pins the non-CI
   exit code when a suite is refused.

4. **[Moderate] The first-scored ledger is last-write-wins across concurrent runs.**
   `recordFirstScoredRuns` (`runner/ground-truth-freshness.ts:155-181`) re-reads the
   ledger and renames a temp file over it with no lock; the pid-suffixed temp
   (`:176`) only prevents tmp-file collisions. Two runner processes sharing one bench
   data dir (exactly the concurrent-bench scenario `context.md:146-150` warns about) can
   interleave read→write so the second rename drops the first's newly added entries.
   A dropped entry silently removes the freshness refusal for that ground-truth id —
   `assertGroundTruthNotNewer` (`:134-152`) then sees no `first` and changed labels can
   be scored under the old version id with no error. The refusal itself is correct and
   tested (`ground-truth-freshness.spec.ts` PASS, jest run; `run-memory-skills.spec.ts:596`).
   Merge-on-write (read, union, write) or an exclusive create/rename protocol closes it.

5. **[Minor] The seeder compares the resolved source path only against lexical roots.**
   `host/fixture-seeder.ts:134` re-checks `realpathSync.native(fixture.source)` through
   `assertSourcePath` (`:170-187`), which compares against the lexical
   `join(realHome, '.ptah')` and the _un-resolved_ `allowedRoots`. The sibling read-path
   guard computes the real path of every root first (`read-path-guard.ts:131-133`).
   Two consequences: (a) if `~/.ptah` is itself a symlink, a source under its target
   reached through a symlinked allowed root is not refused — the exact bypass the
   guard's `realPtahReal` check exists for; (b) on a machine where an allowed root has a
   symlink component (macOS `/tmp` → `/private/tmp` with
   `PTAH_MCP_BENCH_DATA_DIR=/tmp/bench`), the real source path no longer compares as
   inside the lexical root and _valid_ fixtures are falsely refused. (b) fails closed;
   (a) is a defence-in-depth gap with a contrived precondition. `fixture-seeder.spec.ts`
   passes (jest run) with lexical junction fixtures only.

6. **[Minor] Parent reads of run-dir artefacts bypass the read-path guard.**
   `collectSuites` → `readSuiteResult` (`run-scorecard.ts:136-146`) and `runArtifact` →
   `sha256File` (`:304-318`) read `<runDir>/<suite>.suite.json`, `.cases.jsonl`,
   `host-completion.json`, the net logs and the scorecard files directly, not through the
   `ReadPathGuard` every other parent read goes through. These are files the run itself
   wrote into a fresh run dir (`createRunDir` refuses an existing dir,
   `run-memory-skills.ts:200-218`), and `readFileSync` follows symlinks, so only a
   bench-owned suite creating a symlink at those names could redirect the read. Not
   attacker-reachable in the current wiring (all writers are first-party); recorded
   because the guard-everything posture is otherwise consistent.

7. **[Minor] A `record`-mode plan can name cassettes inside the committed fixtures tree.**
   `host/plan.schema.ts:168-184` (`checkSource`) accepts cassette paths inside
   `benchDataDir` **or** `committedFixturesDir`. In `record` mode the doubles write the
   cassette JSONL to that path (`host/doubles-override.ts:73-93`), and the runner passes
   a user plan's `cassettes` straight through (`run-memory-skills.ts:238-247`; the runner
   schema leaves them `z.unknown()`, `runner-plan.ts:64`). A plan can therefore make the
   host create new files inside the repository fixtures tree, dirtying the worktree and
   contradicting `bench-data.ts:1-4` ("private material … must never be committed
   (snapshots, cassettes …)"). Reading committed cassettes in replay is clearly intended;
   writing in record mode is not gated (e.g. by refusing `committedFixturesDir` cassette
   paths when `cassetteMode === 'record'`).

8. **[Minor] `--workspace` under the real `~/.ptah` is never refused.**
   The runner accepts any absolute `--workspace` (`run-memory-skills.entry.ts:90`,
   `run-memory-skills.ts:477-481`); the host validates only that it is an existing
   directory (`memory-skills-host.entry.ts:59-77`); nothing on either side compares it
   with `realHome/.ptah` the way plan paths, fixtures and cassettes are
   (`plan.schema.ts:153-163`). An explicit `--workspace <home>/.ptah` (or a workspace
   containing a link into it) lets the benched engine read the user's real memories as
   corpus. Explicit opt-in by the person whose data it is, and the default is the empty
   `<runDir>/workspace` — but every sibling path in this feature refuses the same input,
   and the refusal is cheap (`isPathInside(workspace, join(realHome, '.ptah'))`).

9. **[Minor] Two documented failure behaviours have no pinning test.**
   `run-memory-skills.spec.ts` (PASS, jest run; 18 `it` blocks) covers exited-early,
   window failure, the CI gate, `failIfAny` ordering, freshness refusal and guard
   refusals — but (a) no test asserts that a `hostExit.kind: 'crash-on-shutdown'` run
   exits 0 with its suite results intact (the TASK_2026_622 rule holds today only by
   absence: `crash-on-shutdown` is simply not in the problems list,
   `run-memory-skills.ts:578-585`); and (b) no test asserts `PTAH_BENCH_MEMORY_SKILLS_PLAN`
   is restored (previous value or deleted) after a successful launch or after `launch`
   throws — `launchWithPlan` (`run-memory-skills.ts:264-277`) is correct in `finally`,
   but the fake launcher (`run-memory-skills.spec.ts:170-174`) only proves the variable
   is _set_ during launch.

10. **[Minor/uncertain] The window's catch can mask the original error if the retry `stop()` rejects.**
    `run-memory-skills.ts:341-345`: `catch { await host.stop(); throw error; }`. If the
    second `stop()` rejects (a guard rejection is the launcher's only documented
    rejection, `host-launcher.ts:226-231`, but idempotence-_after_-rejection is asserted
    in a comment, `run-memory-skills.ts:342`, not verified here), the safety-relevant
    first error is replaced by the second. Cannot be settled without 619's stop()
    implementation, which is outside this batch — flagging as uncertainty, not defect.

## Verified clean (evidence for the clean verdict)

Every claim below was pushed at and held; each carries its file:line.

- **Read-path guard vs the real `~/.ptah`.** Refusal comes first
  (`read-path-guard.ts:142-151`) and is checked three ways — on the resolved path, on
  its real path, and against the _real path of_ `~/.ptah` (`:131-133`) — so a symlinked
  or junctioned ancestor cannot lead a permitted path there, including from inside the
  bench data dir (bench branch is checked after, `:152-160`). Symlinks leaving the bench
  dir or the repo are refused (`:153-158`, `:172-177`). Case differences on Windows fold
  (`:98-100`, `:166`; `bench-data.ts:71-74`). `..` is normalised away by `api.resolve`
  (`:140`) and the missing-tail re-append joins basenames of an already-resolved path
  (`:106-129`). UNC paths are absolute on win32, fail both containment checks and land
  in the final refusal (`:180-183`). Relative paths are refused outright (`:137-139`).
  Non-ENOENT resolver errors are refusals, not skips (`:116-122`). Env overrides are
  pre-validated: `resolveBenchDataDir` runs in the parent only
  (`run-memory-skills.entry.ts:101`; `bench-data.ts:10-15` header) and rejects `~/.ptah`,
  the repo, relative values, and — twice, lexically and by realpath — junctions into
  them (`bench-data.ts:146-195`). `read-path-guard.spec.ts` PASS (jest run).
- **Host order and isolation.** `assertIsolatedEnvironment()` before the workspace arg
  and the plan (`memory-skills-host.ts:175-177`; spec :233 "refuses before anything else
  when the isolation check throws"); unknown plan suites refused before boot
  (`:179-186`); duplicate registrations refused (`:140-153`); `afterContainerReady`
  skipped by the boot helper is detected and fails before suites run (`:221-227`).
- **Fixtures copied, never opened in place.** `copyFileSync` with `COPYFILE_EXCL`
  (`fixture-seeder.ts:227`), fresh targets only (`:214-218`), hash before/after the copy
  and of the copy (`:221-239`), symlinked sources and symlinked tree entries refused
  (`:128-132`, `:254-258`), non-regular entries refused (`:267-271`), database sidecar
  refusal (`-wal` non-empty, any `-journal`, `:189-201`), source-under-real-`~/.ptah`
  refusal on both the given and the resolved path (`:170-178`, `:134`), and targets
  constrained to the isolated home for file/directory fixtures (`:203-212`).
- **Only the two doubles are overridden.** `CURATOR_LLM` and `LANE_RUNNER_SERVICE`
  registered, then verified to resolve to the doubles (`doubles-override.ts:95-107`);
  record mode refuses when the real service is not registered (`:52-58`); replay never
  resolves the real adapters (`:76-93`); residual singleton risk is documented in the
  header (`:12-17`) rather than hidden.
- **Safety cap.** Retried exactly once (`case-runner.ts:23` `MAX_ATTEMPTS = 2`,
  `:67-95`); a second cap returns `outcome: 'safety-cap'`; non-cap errors propagate
  unretred and are not retried (`:74-79` race rejects before the cap check); the
  abandoned attempt's settlement is deliberately swallowed with a comment (`:90-91`);
  the timer is cleared on every path via `finally` (`:92-94`); every attempt's runtime
  is recorded except a failed (non-cap) attempt — noted under Finding 9's coverage
  discussion, cosmetic. `case-runner.spec.ts` PASS (jest run).
- **`na` is never a pass.** Zero executed cases force `na: zero-cases`
  (`run-scorecard.ts:211-228`); missing suites are `na` with their reason, never scored
  (`:280-292`); the gate turns an `na` suite with a listed entry into `not-measurable`
  and any missing suite into `zero-cases` + `not-measurable` findings
  (`gate/known-failures.ts:85-91`, `:133-147`), and `pass`-with-entry into
  `remove-entry` (`:94-102`). Gate wiring is live code, not dead: entry `--ci` →
  `options.ci` (`run-memory-skills.entry.ts:88`, `:108`) → recorder start
  (`run-memory-skills.ts:303-311`) → `guardWorkerEntry` wrap (`:321-324`) → recorder
  stop into `parentAttempts` (`:326-328`) → gate signals from the host completion's
  `net.attempts` _and_ the parent's attempts (`:565`) → `gate.json` (`:567-571`) →
  `failIfAny` last, after every artefact (`:615`); the host mirrors it
  (`memory-skills-host.ts:294-303`, `:255-264`) and CI replay-only is enforced at the
  schema (`plan.schema.ts:150-152`). Spec: "fails on an outbound attempt in the parent
  after writing every artefact" (`run-memory-skills.spec.ts:551`) and host
  "CI: runs suites under the net recorder…" (`memory-skills-host.spec.ts:353,397`).
- **Ground-truth freshness refusal is correct.** Dirty/untracked ground-truth paths
  refused (`ground-truth-freshness.ts:97-108`), newest commit resolved (`:109-121`),
  newer-than-first-scored refused with the new-version-id instruction (`:134-152`),
  every plan suite must declare `groundTruth` so it cannot be bypassed
  (`runner-plan.ts:51-55`; spec :646), and a ledger parse failure blocks runs (fails
  closed, `:126-131`).
- **Crash, timeout, partial results.** Crash before completion → `exited-early`
  problem + exit 1 (`run-memory-skills.ts:578-585`; spec :441-453). Crash while shutting
  down → `crash-on-shutdown`, a run fact recorded in the scorecard and summary, never a
  suite error and never exit 1 (`:578-585` — it is absent from the problems list; the
  completion record is written atomically _before_ the shutdown wait,
  `memory-skills-host.ts:255-276`, with a forced-exit escape for a hung teardown,
  `memory-skills-host.entry.ts:111-113`). Timeout → `null` completion → problem
  (`host-completion-reader.ts:104-122`; `run-memory-skills.ts:575-577`), with the host
  still stopped afterwards (`:339`). Partial results: every suite that did write files
  is scored, the rest are missing with reasons (`collectSuites`, `run-scorecard.ts:128-184`);
  `writeSuiteResult` is tmp+rename and never overwrites (`suite-result.ts:148-164`).
- **`process.env` mutation around `launchBenchHost`.** Set immediately before, restored
  in `finally` on return _and_ throw, previous value or delete (`run-memory-skills.ts:264-277`);
  the child copies the env at spawn, so restoring after launch resolves is sound. The
  approach is a sanctioned stopgap (`context.md:168-172`: "until then keep … the
  `process.env` save/restore").
- **Host-only imports.** The runner parent imports no host-only module and no
  memory-curator barrel: `run-memory-skills.ts` imports `../host/plan.schema` (value)
  only, and that module imports nothing but Node, zod, `bench-data` and a type from
  `doubles/recorded-curator-llm` (`plan.schema.ts:18-24`); the completion reader is
  `import type * as Host` plus literal copies typed `typeof Host.…`
  (`host-completion-reader.ts:18-26`); `host-only-imports.spec.ts` enforces both rules
  structurally (`:67-88`) and PASSes (jest run).
- **Batch 8/9 entry defaults.** The old explicit-dir env-override pattern
  (`resolveBenchDataDir({ ...rules, env: { [BENCH_DATA_DIR_ENV]: options.benchDataDir } })`)
  is gone from all five call sites and replaced by one helper,
  `resolveEntryBenchDataDir` (`data/verify-candidate-manifest.ts:78-89`), which routes
  an explicit dir through the same 619 rules (absolute, outside `~/.ptah`, outside the
  repo) and defaults to the env/default resolution — nothing left beside it, matching
  batches.md Task 16.2. `verify-candidate-manifest.spec.ts` PASS (jest run).

## Score and verdict

**Score: 6/10 (works with real gaps).** What separates it from 7-8: four moderate
findings, two of which (the seeder equality gap, the guard TOCTOU) sit on the two
invariants this phase exists to enforce, and one of which (the ledger race) can silently
undo a correctness guarantee. What separates it from 5: the primary safety chain —
`assertIsolatedEnvironment` first, copy-only fixtures with hash proof, the two-doubles
override verified after registration, the triple-checked `~/.ptah` refusal, CI gate and
`failIfAny` wiring all live, `na` never a pass, crash-on-shutdown as a run fact — is
implemented, internally consistent with 619's contracts, and covered by 405 passing
tests; no finding is blocking or serious, and none is reachable on the default paths
without a misconfiguration, a concurrent run, or an explicit user opt-in.

**Verdict: APPROVED** — with Findings 1 and 2 recommended as small, high-value fixes
before Batch 17 starts wiring real fixtures and suites through these paths, and
Findings 3-4 scheduled (they are behavioural decisions/races, not wiring defects).
Findings 5-10 are minor and can ride the normal batch flow.
