# Code Style Review — `TASK_2026_437_0778` Batch 15

## Delta review (review fixes)

Scope: the fixed state of Batch 15, read-only, no test/nx runs (`npx eslint`/`npx prettier --check`
run). Reviewed the five touched/created files in full —
`workspace-watch-host.stress.harness.ts` (new, 748 lines),
`workspace-watch-host-rss-sampler.js` (new, 92 lines),
`workspace-watch-host.stress.spec.ts` (rewritten, 149 lines, mechanism only),
`workspace-watch-host.stress.perf.spec.ts` (new, 99 lines),
`libs/backend/platform-electron/tsconfig.spec.json` (`allowJs: true` added), and the backport diff
in `apps/ptah-electron/src/services/git-watcher.stress.harness.ts` — plus `test-report-b15.md`
(337 lines). `npx eslint` on all five touched TS/JS files: 0 errors, 0 warnings. `npx prettier
--check` on all five: clean.

### Verified against the base review's five items

| #         | Base finding                                                                                                 | Verified fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Verdict  |
| --------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Serious 1 | Rig lived inside the spec                                                                                    | Extracted to `workspace-watch-host.stress.harness.ts`, 400+ lines, exporting `ensureHostBundleExists`, `RssPeakMonitor`, `WatchHostChildProcess`, `buildTree`, `measureEventLoopDelay`, `BatchRecorder`, `makeWatcher`, and the three scenario runners (`runMassDeleteStorm`, `runSingleKillScenario`, `runDegradedPastBudgetScenario`). Spec and perf files now import only these (`workspace-watch-host.stress.spec.ts:78-83`, `.perf.spec.ts:26-30`).                                                                                                                                                                                                                                                                                         | RESOLVED |
| Serious 2 | Perf case gated per-`it` inside the always-run file                                                          | Split into `workspace-watch-host.stress.perf.spec.ts`, `PERF_ENABLED`-gated at the whole-`describe` level (`:35`), matching `git-watcher.stress.perf.spec.ts`'s `perfDescribe` pattern exactly, including the same header rationale (contention from parallel agents) copied near-verbatim (`:1-11`). The always-run file (`workspace-watch-host.stress.spec.ts`) now contains only mechanism cases.                                                                                                                                                                                                                                                                                                                                             | RESOLVED |
| Serious 3 | RSS sampler duplicated `readHostRssKb`'s logic as an inline, unlinted `-e` string with a silent `catch(e){}` | Extracted to `workspace-watch-host-rss-sampler.js`, a real committed CommonJS file. Confirmed by direct read: `sampleRssKb` is defined ONCE (`:29-49`) and used two ways — `require`d synchronously by the harness's `readHostRssKb` (`workspace-watch-host.stress.harness.ts:67-69,139-146`) and run directly as the persistent monitor child's entrypoint (`if (require.main === module)`, `:57-91`). Errors are reported over IPC (`{type:'error',message}`) rather than swallowed, and `RssPeakMonitor.errors()` (harness `:203-206`) surfaces them into the scenario result (`rssMonitorErrors`, printed in every log line). `npx eslint` confirms this file is genuinely linted, not exempted (`eslint.config.mjs:196` matches `**/*.js`). | RESOLVED |
| Minor 1   | `PERF` vs sibling's `PERF_ENABLED`                                                                           | Renamed to `PERF_ENABLED` (`workspace-watch-host.stress.perf.spec.ts:32`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | RESOLVED |
| Minor 2   | `ForkedWatchHostProcess` name collision with `git-watcher.stress.harness.ts`'s class of the same name        | Renamed to `WatchHostChildProcess` (`workspace-watch-host.stress.harness.ts:251`), with a header comment stating why.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | RESOLVED |

All five base findings are genuinely fixed, not merely reworded. No regression found in the fixed
files themselves.

### New items from this delta pass

**1. `allowJs: true` (`libs/backend/platform-electron/tsconfig.spec.json:8`) — verified, not a
finding.** This is the first `allowJs: true` in any `tsconfig.spec.json` in the repo (checked via
`grep -rn allowJs libs/backend/*/tsconfig*.json apps/*/tsconfig*.json`: one hit, this one). I tested
the hypothesis that it is unnecessary by running `tsc --noEmit` against a copy of the tsconfig with
`allowJs` removed: it passed with no errors either way, because the harness calls the untyped global
`require()` (not an `import`), which `moduleResolution: node16` does not path-resolve at the type
level, and the tsconfig's own `"include"` list has no `.js` glob. **However**, that plain-`tsc` test
does not reproduce the actual mechanism the report cites: `jest.config.ts:6` maps
`'^.+\\.[tj]s$'` to `ts-jest`, so `.js` files ARE routed through `ts-jest`'s TypeScript-compiler-based
transform when `require`d from inside a Jest-run spec (unlike a plain `node -e` child, which never
goes through Jest). `ts-jest` needs `allowJs` to compile a `.js` input without a diagnostic warning,
which running `.js` files through `[tj]s` explicitly invites. I could not run Jest (instructed not
to) to observe the warning directly, but the report's stated mechanism is real, specific, and
consistent with the actual jest transform config — the change is scoped correctly (`"include"` is
untouched, so no `.ts` file gains new type-checking) and is not the redundant change my first,
narrower test suggested. Withdrawing any allowJs objection.

**2. `deleteInChildProcess` is now duplicated verbatim in two harnesses (Minor, new).** The backport
to `apps/ptah-electron/src/services/git-watcher.stress.harness.ts:90-113` is a byte-for-byte copy of
`workspace-watch-host.stress.harness.ts:226-243` (same `-e` string, same spawn args, same
resolve/reject shape). This is a conscious, documented choice (`test-report-b15.md:81-84`, "the one
thing that WAS ported across the boundary is the FIX... not the code"), and it is the right call
given the timeline — but the FU-15a inventory (`workspace-watch-host.stress.harness.ts:30-44`,
`test-report-b15.md:73-84`) only names "forked-host wrapper / tree builder / event-loop-delay
measurement" as the duplicated shape. `deleteInChildProcess` is now a THIRD duplicated piece and is
not listed. Recommend adding one line to FU-15a's inventory so the next person picking it up does not
have to rediscover it by diffing the two files.

**3. FU-15a's stated boundary justification is incomplete (Serious, new).** The harness header
(`:30-44`) and the report (`:71-84`) both justify keeping the duplication by saying sharing
would need "a new cross-cutting test-utility package... or a deep relative import crossing the
app/lib boundary, which `@nx/enforce-module-boundaries`... treat[s] as a violation." That is correct
for the naive approach (a relative import reaching into another project's `src/`), but it overlooks
a mechanism this exact repository already uses for exactly this situation: a `/testing` secondary
package entry point. `libs/backend/platform-core/package.json` exports `"./testing"` alongside its
main entry (`src/testing/index.ts`), wired into `tsconfig.base.json:102`, and
`apps/ptah-electron/src/services/git-watcher.service.spec.ts` — in the SAME directory as the harness
this decision is about — already imports `@ptah-extension/platform-core/testing`. `@nx/enforce-
module-boundaries`' `depConstraints` (`eslint.config.mjs:299-305`) allow `scope:electron` (which
`platform-electron` itself carries, `project.json:6`) to depend on `scope:electron` libs — the same
tag relationship `apps/ptah-electron` already has with `platform-electron`'s main entry today. So a
`platform-electron/testing` secondary entry, re-exporting this harness, would not cross any boundary
`@nx/enforce-module-boundaries` actually enforces; it was not evaluated, only the relative-import
version was. This does not mean the extraction should happen this batch (Batch 15's own scope is
narrow, and `platform-core/testing`'s own header shows a testing entry point is expected to hold
mocks/contracts, not scenario runners, so it is a real design decision, not a rubber stamp) — but
FU-15a's decision record should say a secondary testing entry was considered and why it was deferred
(effort, or "not this batch's scope"), not that the boundary rules make it impossible, because they
do not.

**4. `test-report-b15.md` structure — matches `test-report-b6.md`, plus two improvements worth
naming.** Same Scope → Suites → Execution → status → Verdict → Files skeleton. Two additions beyond
the b6 shape are net positive and worth keeping as the new baseline for this task's remaining
reports: the "Review findings addressed" table (one row per base-review item, with file:line and
what changed) and the "Structure" table naming every file the batch now touches and why. Both make a
delta review faster to verify against, which is exactly what this pass used them for.

**5. No CLAUDE.md update needed.** Confirmed (unchanged from the base review): neither
`apps/ptah-electron/CLAUDE.md` nor `libs/backend/platform-electron/CLAUDE.md` documents
`git-watcher.stress*` or `workspace-watch-host.entry.spec.ts` today (`grep -n stress
apps/ptah-electron/CLAUDE.md` and the platform-electron equivalent both return nothing), so the new
`.stress.harness.ts`/`.stress.perf.spec.ts` pair not being listed in `platform-electron/CLAUDE.md`'s
Internal Structure section is consistent with the established convention, not a gap relative to it.

### Fixture naming and placement

`workspace-watch-host-rss-sampler.js` sits directly beside its spec/harness in
`src/workspace-watch/`, kebab-cased, matching the directory's own naming (`workspace-watch-host.entry.ts`, `electron-workspace-watcher.ts`). It is a committed source file, not a build artifact (unlike
`platform-cli`'s bundle harness output, which writes to gitignored `tmp/`), so the comparison there
is only partial — there is no closer precedent in this repo for a plain `.js` fixture living beside
`.ts` sources, but the placement and naming are unobjectionable on their own terms.

### Delta verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Blocking: 0. Serious (new): 1 (FU-15a's boundary justification should be corrected, not because
  the current duplication decision is wrong). Minor (new): 1 (`deleteInChildProcess` missing from
  FU-15a's inventory). All five base findings verified fixed by direct read and by running
  `eslint`/`prettier --check` on every touched file.
- Key concern: none blocking. The one new Serious item is a documentation-accuracy issue in a
  follow-up record, not a defect in the shipped code — it does not need to hold this batch, but
  FU-15a's text should be corrected before someone relies on "the boundary rules forbid it" to avoid
  reopening the question.
- What a 10/10 version would do differently: correct FU-15a's stated rationale to name the
  `/testing`-secondary-entry-point option and why it was deferred rather than impossible; add
  `deleteInChildProcess` to the same inventory; nothing else in the fixed code needs a further pass.

## Summary

| Metric          | Value                                                |
| --------------- | ---------------------------------------------------- |
| Overall score   | 6/10                                                 |
| Assessment      | NEEDS_REVISION                                       |
| Blocking issues | 0                                                    |
| Serious issues  | 3                                                    |
| Minor issues    | 2                                                    |
| Files reviewed  | 2 (new spec) + 4 (comparison siblings, read in full) |

Scope: `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.stress.spec.ts`
(776 lines) and `.ptah/specs/TASK_2026_437_0778/test-report-b15.md` (349 lines), compared against
`apps/ptah-electron/src/services/git-watcher.stress.spec.ts` (142 lines),
`git-watcher.stress.harness.ts` (531 lines), `git-watcher.stress.perf.spec.ts` (87 lines),
`workspace-watch-host.entry.spec.ts` (339 lines), `libs/backend/platform-cli/src/workspace-watch/workspace-watch-host.bundle.harness.ts`,
`test-report-b6.md`, and `libs/backend/platform-electron/CLAUDE.md`. `npx eslint` on the spec file
returned clean (spec files are exempt from `max-lines`, `eslint.config.mjs:487-489`); `npx prettier
--check` flagged formatting — the repo's own formatter owns that, so it is not scored here.

## Five style questions

### 1. What breaks in six months?

`git-watcher.stress.perf.spec.ts:63-85` still measures event-loop delay with
`fs.promises.rm` run **in-process** and no out-of-process RSS sampler. This batch's own test-report
(`test-report-b15.md:113-139`, "Rig attribution follow-up") proves that exact shape — an in-process
recursive delete plus an in-window `child_process` spawn for sampling — injects 250–650 ms of false
event-loop-delay noise on Windows via `uv_spawn`. The fix (`deleteInChildProcess`,
`RssPeakMonitor`, `workspace-watch-host.stress.spec.ts:236-253,167-222`) was not backported to the
sibling perf spec it was modeled on. The next person who reruns `git-watcher.stress.perf.spec.ts`
on a loaded Windows box and sees AC-1/AC-2 P1 blow their budget will re-diagnose a bug this batch
already found and fixed once, in a different file.

### 2. What would a new team member misread?

A reader who greps for `ForkedWatchHostProcess` gets two unrelated classes with the same name —
this file's own (`workspace-watch-host.stress.spec.ts:263-309`, with a `readStderrTail()` the other
lacks) and `git-watcher.stress.harness.ts:198-231`'s. Nothing marks them as independent copies; the
header comment at `:255-261` names the collision but only for the wrapper class, not for the
identical `buildTree`/`buildCheckoutTree`, `waitFor`, `sleep`, and event-loop-delay measurement that
also reappear here, in the harness, and in `workspace-watch-host.entry.spec.ts`.

### 3. What does this cost to maintain?

Every future change to "how do we fork the built host bundle and read its RSS without disturbing
the metric" (proven non-trivial by this very batch — two rounds of rig defects, per
`test-report-b15.md:121-139`) now has to be made in three places to stay correct:
`git-watcher.stress.harness.ts`, `workspace-watch-host.entry.spec.ts`, and this file. The file's own
comment (`:255-261`) names the FU-8d precedent ("extract a shared helper if a third caller
appears") and this IS the third caller, but defers extraction to keep the batch to Task 15.1's
listed single file. That is a legitimate scoping call, but it is a debt now incurred three times
over rather than paid once.

### 4. Where is this inconsistent with the rest of the repository?

`git-watcher.stress.perf.spec.ts:1-16` documents and follows a deliberate split: mechanism
assertions live in an always-run `*.stress.spec.ts`, absolute ms budgets live in a **separate**
`*.stress.perf.spec.ts` gated by `describe.skip` at the whole-suite level — explicitly "so the
budgets live here rather than in the always-run [file]... this repository normally runs several
agents building and testing in one working tree." `workspace-watch-host.stress.spec.ts` puts both
kinds of case in one file, gated per-`it` (`(PERF ? it : it.skip)`,
`workspace-watch-host.stress.spec.ts:572,679`) instead of per-file. The mechanism/perf boundary this
repo already drew for the identical problem is not followed here, without a comment explaining why
this batch chose differently.

### 5. What would you have done differently, and why is that better rather than merely other?

Move lines ~55–421 (RSS reading, `RssPeakMonitor`, `ForkedWatchHostProcess`, `buildTree`,
`measureEventLoopDelay`, `BatchRecorder`, `deleteInChildProcess`) into a peer
`workspace-watch-host.stress.harness.ts`, mirroring `git-watcher.stress.harness.ts` one directory
over AND `libs/backend/platform-cli/src/workspace-watch/workspace-watch-host.bundle.harness.ts` in
the sibling lib — the precedent for a `*.harness.ts` file sitting directly beside its spec inside a
`libs/backend/platform-*` tree already exists inside `platform-electron`'s own family, so "apps vs
libs" is not actually a boundary obstacle here: the harness would stay inside `platform-electron`,
importable by both this spec and (were it needed) a `platform-electron`-side perf file, without
crossing the apps/libs line at all. That also gives the RSS-sampler script (currently an inline
`-e` string, see Serious #3) a real, linted, typed home instead of an unchecked string literal.

## Blocking issues

None. Nothing here breaks a stated architectural invariant, boundary, or type-safety guarantee;
the issues below are pattern-consistency and maintenance-cost findings.

## Serious issues

### Rig lives inside the spec instead of a peer `.stress.harness.ts`

- File: `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.stress.spec.ts:55-421`
- Problem: ~367 lines of reusable test infrastructure (RSS reading, `RssPeakMonitor`,
  `ForkedWatchHostProcess`, tree building, event-loop measurement, `BatchRecorder`,
  `deleteInChildProcess`) sit in the spec file rather than a sibling harness file, even though the
  file's own comment (`:255-261`) identifies this as the third near-identical copy of the same
  shape and cites the repo's own "extract on third caller" rule (FU-8d) without applying it.
- Tradeoff: keeping it in one file matched Task 15.1's file list (`batches.md:1037`, "CREATE ...
  one file"), but the precedent for a same-directory `*.harness.ts` inside a `platform-*` lib
  already exists (`libs/backend/platform-cli/src/workspace-watch/workspace-watch-host.bundle.harness.ts`),
  so "stay in scope" and "extract" were not actually in tension here.
- Recommendation: extract to `workspace-watch-host.stress.harness.ts` beside the spec, following
  the `platform-cli` bundle-harness precedent (header comment: "Test harness ... Not imported by
  production code").

### Perf case embedded in the always-run file instead of a separate perf spec

- File: `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.stress.spec.ts:572-589,679-694`
  vs `apps/ptah-electron/src/services/git-watcher.stress.perf.spec.ts:1-49`
- Problem: the sibling convention this task is explicitly modeled on (same acceptance criteria
  family, same author of the AC-1/AC-2/AC-2-P2 numbers) splits mechanism (`*.stress.spec.ts`,
  always on) from ms budgets (`*.stress.perf.spec.ts`, `describe.skip`-gated at the suite level) for
  a stated reason: CI contention from several agents sharing a working tree. This file instead
  gates the 75,000-file perf case with `it.skip` inside the same always-run file.
- Tradeoff: functionally the perf case still does not run without `PTAH_PERF_SPECS=1`, but the file
  now diverges from the one place a reader would look for "how do we structure a mechanism-vs-perf
  stress suite in this repo," with no comment explaining the departure.
- Recommendation: either split into `workspace-watch-host.stress.perf.spec.ts` matching the
  sibling, or add a one-line comment at the top explaining why this batch chose file-scoped mixing
  instead (e.g., "one file per Task 15.1" — which is a real constraint, but should be stated, not
  left implicit).

### RSS sampler re-implements existing logic as an inline, unlinted string

- File: `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.stress.spec.ts:167-222`
  (`RssPeakMonitor`) vs `:118-149` (`readHostRssKb`/`readLinuxRssKb`/`bytesToKb`)
- Problem: `RssPeakMonitor`'s constructor builds a `node -e` script as an array of string literals
  that reimplements the exact platform-branching RSS read already written, typed, and testable as
  `readHostRssKb`/`readLinuxRssKb`/`bytesToKb` a few lines above. The two copies have already
  drifted: the string version swallows every error silently (`catch (e) {}`), while the named
  functions surface `undefined` only on the documented best-effort paths. Neither esbuild's real
  bundling (used by `workspace-watch-host.entry.spec.ts:58-71`) nor a fixture file is used; a plain
  concatenated string is.
- Tradeoff: the string works and is small, but it is code with no type-checking, no lint pass, and
  no single source of truth for "how do we read RSS on this platform" — a future platform-branch
  fix (e.g. a `ps` flag change) has to be applied twice and will silently miss one of them.
- Recommendation: factor the sampling body into a tiny fixture (or export it from the proposed
  harness file) and hand the persistent child process a `require(path)`-able module instead of an
  inline string, so it shares the same reading code `readHostRssKb` uses.

## Minor issues

- `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.stress.spec.ts:75` names its perf flag
  `PERF`; the sibling (`git-watcher.stress.perf.spec.ts:27`) names the identical flag
  `PERF_ENABLED`. Same env var, same purpose, different local name — a small tax on anyone
  searching across both files.
- `ForkedWatchHostProcess` (`:263-309`) duplicates the name of an unrelated class in
  `git-watcher.stress.harness.ts:198-231`. Neither is exported or shared, so there is no compile
  collision, but the shared name invites a reader to assume they are the same thing when they are
  not (this one adds `readStderrTail()`).

## File-by-file

### `workspace-watch-host.stress.spec.ts`

Score 6/10 — 0 blocking, 3 serious, 2 minor. The test cases themselves are well-reasoned and
well-evidenced (A1's design-vs-observed split, the real-time-vs-shortened split documented per
`describe` block, the root-vs-subtree delete fix), and the file matches the repo's dense,
narrative-comment convention for stress specs (`git-watcher.stress.harness.ts` is the same style).
Its weakness is entirely in where things live and how the file relates to the two siblings it was
built to match: the reusable rig belongs in a harness file the repo already has a same-lib
precedent for (`platform-cli`'s bundle harness), the perf/mechanism split diverges from the
established sibling pattern without comment, and the RSS sampler duplicates already-written logic
as an unchecked string.

### `test-report-b15.md`

Score 8/10 — 0 blocking, 0 serious, 1 minor (implicit in the above: it documents but does not
flag the perf-spec measurement fix as unbackported to `git-watcher.stress.perf.spec.ts`, which is
the one place a reader would want that flagged, given the report already discusses the discovery in
detail). Structure matches `test-report-b6.md`: Scope → Suites → Execution → Numbers → status
sections → Verdict → Files, same level of "not executed" and "risks" candour, same log-file
discipline. The "Rig attribution follow-up" section answering the coordinator's specific challenge
is the strongest part of the report — it states the two defects, the fix, and the comparison
numbers with mechanism counts held constant as the control.

## Pattern compliance

| Repository rule or nearby convention                                                                 | Status         | Evidence                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mechanism-always / perf-gated split as a separate file (`git-watcher.stress.perf.spec.ts` precedent) | FAIL           | `workspace-watch-host.stress.spec.ts:572,679` gate per-`it`, not per-file                                                                                                                     |
| `PTAH_PERF_SPECS=1` as the env gate                                                                  | PASS           | `:75`, matches `git-watcher.stress.perf.spec.ts:27`                                                                                                                                           |
| Diagnostic matching by `message.includes(...)` (no `code` field on `WorkspaceWatcherDiagnostic`)     | PASS           | `:519-521` matches the convention in `workspace-watch-supervisor.spec.ts:575`                                                                                                                 |
| Cleanup registered so a mid-test throw cannot leak a resource                                        | PASS           | `:424-427,592-596`, monitor/hosts/subscriptions all pushed to `cleanups`                                                                                                                      |
| `.harness.ts` file for reusable rig code, kept out of the spec                                       | FAIL           | rig lives in the spec; precedent exists in `git-watcher.stress.harness.ts` and, same-lib-family, `platform-cli/.../workspace-watch-host.bundle.harness.ts`                                    |
| CLAUDE.md documents stress/perf specs and how to run them                                            | NOT_APPLICABLE | Neither `apps/ptah-electron/CLAUDE.md` nor `platform-electron/CLAUDE.md` documents `git-watcher.stress*`/`.entry.spec.ts` either — no precedent requires it, so its absence here is not a gap |
| Real forked host over the built bundle, never `worker_threads`                                       | PASS           | `:56-60,268-270`, matches `platform-electron/CLAUDE.md`'s stated rule                                                                                                                         |
| `catch (error: unknown)`                                                                             | PASS           | no untyped catch found in the reviewed file                                                                                                                                                   |

## Maintenance debt

- Introduced: a third copy of the forked-host-wrapper/tree-builder/event-loop-measurement shape
  (now in `git-watcher.stress.harness.ts`, `workspace-watch-host.entry.spec.ts`, and this file); an
  unbackported measurement-accuracy fix that the sibling perf spec still lacks; a file-vs-file
  mechanism/perf split inconsistency.
- Retired: nothing (new file).
- Net: negative in isolation — the debt named above is real and was named by the author but not
  paid down. Not severe enough to block: the tests themselves are correct and well-evidenced, and
  the extraction is a mechanical follow-up, not a redesign.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: the rig that took two rounds of correction to trust (per the test report itself)
  is not shared with the sibling spec it was modeled on, so the exact measurement bug this batch
  found and fixed can silently reappear in `git-watcher.stress.perf.spec.ts`.
- What a 10/10 version would do differently: extract the rig into
  `workspace-watch-host.stress.harness.ts` beside the spec (matching the `platform-cli` bundle
  harness precedent); either split perf into its own gated file matching
  `git-watcher.stress.perf.spec.ts`'s file-level convention or state in a comment why this batch
  chose to mix them; replace the inline RSS-sampler string with a small fixture or a shared,
  linted module; and open a short follow-up note (or FU item) flagging that
  `git-watcher.stress.perf.spec.ts` should adopt the same out-of-process delete/RSS-sampling fix
  this batch proved necessary.
