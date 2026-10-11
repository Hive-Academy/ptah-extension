# Code-logic review — Phase 3.4, round 2 (fix verification)

Reviewer: `code-logic-reviewer` (CLI lane). Read-only; one deliverable. This round verifies
commit `c73c5e07a` ("fix: task 620 phase 3.4 - fail closed on real-home overlap, dirty inputs
and suite errors") against the ten findings of `code-logic-review-phase3-4.md`, per the
author's "Review fixes" notes (`batch-16-report.md:146-177`).

Read in full this round: `runner/read-path-guard.ts`, `host/fixture-seeder.ts`,
`runner/run-memory-skills.ts` (fixed regions + main flow), `runner/ground-truth-freshness.ts`,
plus the fixed regions of `runner/run-scorecard.ts` and `host/plan.schema.ts`, the new/changed
spec regions, and a repo grep confirming no reference to the old single-file ledger remains.

Verification run (the only check, scoped as allowed):

```
npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills --runInBand
Test Suites: 36 passed, 36 total
Tests:       419 passed, 419 total
```

(419 vs 405 in round 1 — the 14 new pinning tests all run and pass.)

## Finding status

| # | Finding (round 1) | Status | Evidence (file:line) |
|---|---|---|---|
| 1 | Seeder misses isolated home *equal to* real `~/.ptah` (moderate) | **CLOSED** | `host/fixture-seeder.ts:124-145` — the constructor now compares three pairs, `[home, realPtah]` given/given, `[homeReal, realPtahReal]` resolved/resolved, `[homeReal, realPtah]` resolved/given, each with `atOrUnder(isolated, ptah)` (home is/under `~/.ptah`), `atOrUnder(ptah, isolated)` (home *holds* `~/.ptah`) and `atOrUnder(input.realHome, isolated)` (home holds the real home), plus `atOrUnder(real(input.realHome), homeReal)` at `:141`. Every given/resolved combination of "is, lies in, or holds" is covered; equality is `isSamePath` inside `atOrUnder` (`:124-126`). Case folding on win32 comes from 619's `isSamePath`/`isPathInside` (`bench-data.ts:71-88`). Pinned: `host/fixture-seeder.spec.ts:227-258` (equal, inside, holding, and a junction to `~/.ptah` as the home) and `:260-275` (win32 case-insensitive: home `C:\Users\Dev\.PTAH` vs realHome `c:\users\dev` → `/overlap/`). |
| 2 | Guard committed-files snapshot TOCTOU (moderate) | **CLOSED** (working-tree class; see new finding N1 for the residual) | `runner/read-path-guard.ts:219-240` — `read()` reads the bytes first (`:221`), then, for a repository file only (`repoRelative !== undefined`, `:222`), re-runs `git status --porcelain=v1 -z --untracked-files=all -- :(literal)<repoRelative>` for that one path (`:224-231`); any output refuses the read (`:232-237`). The `:(literal)` pathspec keeps magic characters in filenames safe. `git` is now a required guard option (`:50-51`). Pinned: `runner/read-path-guard.spec.ts:108-118` — a committed file edited after the guard was built is refused by both `readText` and `readBytes`. Coverage of every committed input the plan reads: the plan (`run-memory-skills.ts:509-510`), `package.json` twice (`run-scorecard.ts:86`, `:108`), known-failures (`run-memory-skills.ts:438-440`) and every offline-suite read (`run-memory-skills.ts:323` → `context.read`) all go through `guard.readText`/`readBytes`; `collectSuites`/`runArtifact` reads are run-dir (bench-data) files where the git branch does not apply (`read-path-guard.ts:185-192`). Fails closed if git is unavailable: a throwing `git` runner fails `listCommittedFiles` at step 1 (run refused, `run-memory-skills.ts:493`), and at read time the git exception propagates out of `read()` — a step-1 read refuses the run, an in-suite read becomes a suite error, which since fix 3 fails the run. |
| 3 | Non-CI exit code ignores suite errors / guard trips (moderate) | **CLOSED** | `runner/run-memory-skills.ts:640-645` — every `missing` suite (suite error, refused parent read, skipped, unrun, invalid result, host-incomplete) is a `problems` line in every mode; `exitCode` at `:688`. No false failure on an empty plan: no suites → no `missing` → exit 0, pinned by `run-memory-skills.spec.ts:288-291` (`exitCode` 0), and crash-on-shutdown still exits 0 with results intact (`:339-357`, `problems` `[]`, real 0xC0000409 code at `:349`). Refusal cases pinned: `:365-383` (offline suite refused a read: `gate` null, exit 1, the problem names the refusal) and `:568-577` (host suite error: scorecard written, exit 1 outside `--ci`). The ratchet stays `--ci`-only (`:612-626`). |
| 4 | First-scored ledger last-write-wins race (moderate) | **CLOSED** | `runner/ground-truth-freshness.ts:191-222` — one file per ground truth id named `sha256(id).json` (`:134-136`), written fully to a unique `wx` temp (`:209-213`) and published with `linkSync` (`:215`), which is an atomic create-if-not-exists: `EEXIST` means another run published that id first and the earlier entry wins (`:217`); the temp is unlinked in `finally` (`:218-219`). No existence pre-check, so a stale view takes the same path (`:198-199`); no run ever rewrites another id's file. Reads are always fresh (`:222` re-reads the directory; the assertion read at `run-memory-skills.ts:520` is fresh too). Malformed or wrong-file entries fail closed and block runs (`:143-151`, with a zod parse at `:144-146`). Pinned: `ground-truth-freshness.spec.ts:130` ("never rewrites another id and keeps the first publisher on a race"). No reference to the old `first-scored-runs.json` single-file ledger remains (repo grep, zero matches). |
| 5 | Seeder compares resolved source only against lexical roots (minor) | **CLOSED** | `host/fixture-seeder.ts:200-225` — `assertSourcePath(path, resolved=true)` compares the realpath'd source against `[realPtah, realPtahReal]` (`:202-204`) and against the resolved `allowedRootsReal` (`:216-219`, computed at `:123`), so a linked `~/.ptah` target is refused (5a) and a source reached through a *linked allowed root* is accepted (5b, no false refusal). Pinned: `host/fixture-seeder.spec.ts:289+` (5a refusal) and `:277-287` (5b acceptance through a junctioned bench root). |
| 6 | Parent run-dir reads bypass the guard (minor) | **CLOSED** (code); test gap judged acceptable — see below | `runner/run-scorecard.ts:138-139` — `collectSuites` calls `guard.assertReadable` on both suite files before `readSuiteResult`; `runArtifact` resolves through `guard.assertReadable` and hashes through `guard.readBytes` (`:316`, `:321`); the run-summary's scorecard hash reads through `guard.readBytes` (`run-memory-skills.ts:666-671`). `sha256File` is gone from `run-scorecard.ts`. |
| 7 | Record-mode cassettes can write into the committed fixtures tree (minor) | **CLOSED** | `host/plan.schema.ts:199-212` — in `record` mode a cassette path inside `committedFixturesDir` is refused for both cassettes; replay may still read committed cassettes (`:56` comment). Pinned: `host/plan.schema.spec.ts:81`. |
| 8 | `--workspace` under the real `~/.ptah` never refused (minor) | **CLOSED** | `runner/run-memory-skills.ts:402-428` — `assertWorkspaceOutsideRealPtah` refuses a workspace that is, lies in or holds the real `~/.ptah`, as given (`:411`) and resolved (`:412-415`), called at `:502-508` before the run directory is created. Pinned: `run-memory-skills.spec.ts:390` (no launch happens). |
| 9 | Unpinned behaviours: crash-on-shutdown exit 0; env-var restore (minor) | **CLOSED** | `run-memory-skills.spec.ts:339-357` (crash-on-shutdown: exit 0, `problems` `[]`, suite results intact — the TASK_2026_622 rule now pinned, not incidental); `:316-322` (previous value restored after a successful launch) and `:323-337` (variable removed when the launch throws). The implementation itself was already correct (`run-memory-skills.ts` `launchWithPlan` unchanged from round 1). |
| 10 | Retry `stop()` can mask the window error (minor) | **CLOSED** | `runner/run-memory-skills.ts:303, 342, 345-359` — a `stopping` flag set before the normal `stop()` (`:342`): if that stop itself failed (a guard trip), its error is rethrown as itself with no retry (`:347`); otherwise the retry runs, and if it rejects too, an `AggregateError([windowError, stopError])` is thrown with `errors[0]` the original window error (`:348-357`). Pinned: `run-memory-skills.spec.ts:428` (guard trip in the normal stop: rethrown as itself, stopping once) and `:404` (both errors kept when the retry rejects). |

## Judgment on finding 6's missing dedicated test

Acceptable. The unpinned delta is only the *wiring* — "does `collectSuites` route its paths
through `assertReadable`" — and that wiring is exercised on the happy path of every
`run-memory-skills.spec.ts` test that scores suites (the guard call must pass for the reads
to succeed). The dangerous behaviour itself — a link whose real path leaves the bench folder —
is pinned in `read-path-guard.spec.ts:130-144` (junction into `~/.ptah`, junction out of the
bench folder; junction creation needs no privilege on Windows, which is also how the seeder
specs plant their links). The author's stated reason ("planting a file symlink on Windows
needs privilege", `batch-16-report.md:163`) is accurate for *file* symlinks; a belt-and-braces
pin without privilege would be a junction named `<id>.suite.json` pointing outside the bench
dir, expecting `missing` with a `read refused` reason — feasible today, worth a line in a later
batch, not a blocker: the residual risk is a future refactor silently dropping the guard call,
and every scoring spec would still pass because `assertReadable` is permissive for real files.

## New findings

1. **[Minor] The read-time re-check catches working-tree dirt, not HEAD movement.**
   `runner/read-path-guard.ts:222-238` re-checks the file with `git status`, which compares
   the working tree against the *current* index/HEAD. A label file edited **and committed**
   mid-run shows a clean status, so the read passes and the run scores the new HEAD's bytes
   while the scorecard and summary record the run-start HEAD (`run-memory-skills.ts:521`,
   `readProduct`'s `rev-parse HEAD` at `run-scorecard.ts:89`) and the run-start ground-truth
   commit (`run-memory-skills.ts:515-518`). Impact is bounded: the freshness ratchet catches
   the sequence on the *next* run — the changed commit is newer than this run's first-scored
   entry, so `assertGroundTruthNotNewer` (`ground-truth-freshness.ts:163-181`) refuses further
   scoring under the old version id — so one run can misreport which labels it scored.
   Requires a deliberate commit during a run (unlike the auto-save class, which is now
   refused). The module docblock's claim ("an edit made during the run … fails the read",
   `read-path-guard.ts:15-19`) overstates by this case. Minor.
2. **[Minor] The seeder honors the injected `realpath` for its root checks but not for the
   source re-check.** `host/fixture-seeder.ts:164` re-resolves the fixture source with
   hardcoded `realpathSync.native` (`this.assertSourcePath(realpathSync.native(fixture.source), true)`),
   while the constructor computes `realPtahReal`/`allowedRootsReal` through the injectable
   resolver (`:115-123`, `SeedFixturesInput.realpath` documented as "specs override",
   `:74-75`). Production is unaffected (when `platform === process.platform` both are
   `realpathSync.native`), and the current specs either plant real junctions (so native is
   correct) or check constructor refusals only — but a future spec that injects a fake
   `realpath` and runs real fixtures would silently get native resolution for the source and
   the injected one for the roots. Consistency (pass the resolver used by the constructor)
   would remove the trap. Minor.

No other new defects found in the fix regions: the per-read `git status` spawn is cost, not a
failure mode; a crashed run's ledger `.tmp` files are ignored by the name filter
(`ground-truth-freshness.ts:143`) though never swept (bounded litter, one file per crash);
`linkSync` needs the bench volume to support hard links (NTFS and the usual Linux filesystems
do; exFAT would fail closed with `EPERM`); and the cross-directory imports the fixes added
(`fixture-seeder.ts:41` importing `runner/read-path-guard`, which imports only Node and
`bench-data`) introduce no cycle and no host-only/barrel leak — `host-only-imports.spec.ts`
still passes.

## Verdict

**APPROVED.** All ten round-1 findings are closed with pinned tests (finding 6's code is
closed; its test gap is judged acceptable above); the four focus areas of this round hold:
the dirty-input refusal covers every committed input the plan reads and fails closed when git
is unavailable; the non-CI exit code is 1 on suite errors/guard trips with no false failure on
an empty plan; the per-ground-truth ledger is atomic (link-based create-once), loses no entry
on a race and never reads stale; and the home-overlap check is realpath- and case-insensitive
on win32 and refuses is/holds/lies-in in every direction. Two new minor findings (N1, N2)
remain, neither blocking: N1's residual is caught by the ratchet on the next run, and N2 is a
spec-facing consistency trap with no production effect. Score: 8/10 — sound; what keeps it
below 9-10 is N1 (a documented guarantee that still overstates by one deliberate-actor case)
and the finding-6 test gap.

Jest evidence line: `Test Suites: 36 passed, 36 total` / `Tests: 419 passed, 419 total`.
