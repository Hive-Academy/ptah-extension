# Code Logic Review — `TASK_2026_463_f13d` Batch 3 (C4)

Scope: `scripts/perf/property-hub-loadtest-paths.mjs`,
`scripts/perf/property-hub-loadtest-setup.mjs`, `scripts/perf/property-hub-loadtest-cleanup.mjs`
(all new, untracked files). Verified by reading all three files in full, independently running
`node --check`, `--self-test`, `npx eslint scripts/perf` (0 errors across 3 files, confirmed via
`--format json`), and by writing a standalone reproduction against the exported
`resolveLoadtestPaths` function.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 1              |
| Failure modes found | 3              |

## Five logic questions

### 1. How does this fail silently?

`readMarker` (`property-hub-loadtest-paths.mjs:95-119`) collapses every failure — missing file,
unreadable file, malformed JSON, and a real filesystem error such as `EACCES` — into a single
`null` return. The caller in `property-hub-loadtest-cleanup.mjs:104-107` then reports one generic
message, `not a load-test clone: <target>`, regardless of which of those actually happened. This
is the documented, intended behaviour (implementation-plan.md Task 3.1 AC 3: "the failure reason
is reported by the caller's refusal message, not swallowed silently"), so it is not a defect, but
it does mean a permissions problem on a legitimate load-test clone is indistinguishable from "this
was never a load-test clone" to the operator.

### 2. What user action produces unexpected behaviour?

Passing `--target` as a path that is itself a directory symlink or an NTFS junction pointing at a
real git repository (the source `property-hub`, another unrelated project, or the Ptah repository
itself) is **not detected** by any of the five refusal rules. See Failure modes below — this is
the most consequential finding in this batch.

### 3. What input data produces a wrong answer?

A marker file (`.git/ptah-loadtest-clone.json`) with `worktrees` as a large integer or a `source`
string that itself resolves to a protected path does not produce a wrong *comparison* — the second
`resolveLoadtestPaths` call in `cleanup.mjs:109-112` re-validates using the marker's own `source`
and would refuse if that now collides with the target. No input-data defect found here beyond the
symlink/junction gap above.

### 4. What happens when a dependency fails?

`git`, `npm.cmd`/`npm` failures are all captured via `spawn` with `stdio` piped or inherited and
turned into a thrown `Error` naming the step and exit code (`setup.mjs:128-135`,
`cleanup.mjs:84-90`), matching the acceptance criterion. A `spawn` error itself (binary not found)
is distinguished from a nonzero exit code (`result.code === null` branch), which is a nice touch
neither AC required nor forbade. No swallowed dependency failure found in either script's execute
path.

### 5. What is missing that the requirements never mentioned?

The plan's own "Verified contracts" section and this review's explicit brief both call out
"symlinks/junctions" as a dimension the path guard needs to survive; the plan's component spec
(implementation-plan.md Component 4 responsibilities) never lists it as one of the five refusal
rules, so its absence is a gap in the design surface itself, not merely an implementation slip. See
the Serious issue below.

## Failure modes

### Path guard is lexical-only — a target that is a symlink/junction into a protected repo is not refused

- Trigger: `--target` (setup) or the target directory `resolveLoadtestPaths` is asked to validate
  (cleanup) is itself a directory symlink or an NTFS junction whose real destination is the source
  repo, an unrelated repo, or the Ptah repository that owns the scripts.
- Symptom: none of the five refusal rules in `resolveLoadtestPaths`
  (`property-hub-loadtest-paths.mjs:30-69`) fire, because every comparison
  (`isWithinOrEqual`, the equality check, the Ptah-repo containment check) operates on
  `path.resolve()`-normalized strings — never on `fs.realpath`/`fs.lstat` output. Reproduced
  directly against the live file:

  ```
  fs.symlinkSync(<ptah-repo-root>, 'D:/projects/evil-loadtest', 'junction');
  resolveLoadtestPaths({ target: 'D:/projects/evil-loadtest' })
  // => NOT REFUSED: { source: '...property-hub', target: 'D:\\projects\\evil-loadtest', ptahRepo: '...' }
  ```

  The basename ends in `-loadtest`, so the suffix rule is satisfied; the lexical string
  `D:\projects\evil-loadtest` is neither equal to, nor (lexically) nested in or containing, the
  Ptah repo path — even though the junction physically resolves into it.
- Evidence: `property-hub-loadtest-paths.mjs:13-16` (`comparable()` calls only `path.resolve`,
  never a realpath), `:18-24` (`isWithinOrEqual` operates purely on the lexical strings from
  `comparable`), `:34-59` (all five refusal rules are built from those two primitives, with no
  `fs.lstat`/`fs.realpath` call anywhere in the file).
- Current handling: none. The guard does not attempt to detect or resolve a symlink/junction at
  any point in the target or source path.
- Practical exploitability: for `setup.mjs`, this is largely defanged in practice — a pre-existing
  junction means `exists(paths.target)` is already true, so the *separate* "target already exists"
  guard (`setup.mjs:182-184`) refuses first, for an unrelated reason. For `cleanup.mjs`, exploiting
  this additionally requires a valid marker file to already exist inside the junction's real
  `.git` directory (`readMarker` would otherwise return `null` and refuse with "not a load-test
  clone", `cleanup.mjs:104-107`) — an unusual precondition, but not an impossible one (e.g. a
  target directory that used to be a legitimate load-test clone was later replaced by a junction
  pointing elsewhere while its `.git` marker survived, or a user manually aliases a path for disk
  space reasons). Given the review focus explicitly named this as a required guard dimension, and
  the architecture's whole stated purpose is "never touch the real repos," the residual risk of an
  unresolved junction bypassing every containment check is a real gap against that stated
  invariant, not a theoretical one.
- Recommendation: resolve `source`, `target`, and `PTAH_REPO` through `fs.realpathSync` (falling
  back to the lexical path when the target does not yet exist, e.g. for setup's pre-clone check)
  before any comparison, and re-run the same resolution once the target exists (post-clone / at
  cleanup time) so a symlink or junction introduced after the initial guard check cannot smuggle a
  delete outside the intended tree.

### Two independently-typed copies of "does this path collide" logic between setup and cleanup guard calls

- Trigger: none required to reproduce; this is a structural observation, not a runtime bug today.
- Symptom: `cleanup.mjs` calls `resolveLoadtestPaths` twice — once with the default source before
  the marker is read (`:103`), once with the marker's real `source` after (`:109-112`). The first
  call's containment checks are evaluated against a source that may not be the clone's actual
  source at all (if `--source` was customized during setup). This does not currently produce a
  wrong answer, because the second, authoritative call re-validates everything with the correct
  source before any mutation — but a future refactor that short-circuits on the first call's result
  (e.g. to avoid running the check twice "since they're the same function") would silently drop the
  authoritative check.
- Evidence: `cleanup.mjs:103,109-112`.
- Current handling: safe today only because both calls happen and the second is authoritative.
- Recommendation: a one-line comment at `cleanup.mjs:103` noting that this first call's containment
  result is provisional and the second call at `:109` is authoritative would prevent an
  accidental future collapse of the two calls.

### `readMarker`'s catch-all silently absorbs non-Error throws it cannot classify

- Trigger: something other than a standard Node `Error` is thrown inside the `try` (in practice
  this would require a non-standard `fs` implementation or monkeypatch; not reachable via normal
  Node `fs/promises` failures).
- Symptom: the `instanceof Error` check at `property-hub-loadtest-paths.mjs:114` re-throws only
  genuine `Error` instances that somehow aren't meant to be swallowed — but the code as written
  actually does the opposite of what the branch name suggests: **any** `Error` is swallowed to
  `null` (line 114-115), and only a non-`Error` throw propagates (line 116-117). That matches the
  stated intent (collapse all real fs/parse errors into "not a load-test clone") and is consistent
  with the AC. Flagged here only because the inverted-looking branch (`if (error instanceof Error)
  return null; throw error;`) is easy to misread as "rethrow real errors" on a future edit; it does
  the opposite by design.
- Evidence: `property-hub-loadtest-paths.mjs:113-118`.
- Current handling: correct per spec, but fragile to a future misreading.
- Recommendation: a short comment above the catch block stating "all fs/parse errors collapse to
  null by design; only a non-Error throw propagates" would prevent an accidental flip.

## Blocking issues

None found.

## Serious issues

### Path guard does not resolve symlinks/junctions before comparison

- File: `scripts/perf/property-hub-loadtest-paths.mjs:13-16,18-24,30-69`
- Scenario: `--target` (or, for cleanup, the existing target directory) is a symlink/junction whose
  real destination is a protected path (source repo, unrelated repo, or the Ptah repo). See
  Failure modes above for the confirmed reproduction.
- Impact: the stated safety invariant ("no code path deletes or writes under the resolved source,
  under the Ptah repo, or under a target without a marker," implementation-plan.md Component 4
  Quality requirements) is not fully met — it holds only for lexical paths, not real filesystem
  targets. Exploiting it against `cleanup.mjs`'s final `fs.rm(paths.target, { recursive: true,
  force: true, ... })` requires an additional coincidence (a valid marker already present at the
  junction's real `.git`), which lowers likelihood but does not remove the gap the review was
  explicitly asked to check.
- Fix: resolve real paths (`fs.realpathSync`, with a safe fallback for not-yet-existing paths)
  before every comparison in `resolveLoadtestPaths`, and treat an unresolvable target the same as
  any other guard failure (refuse, don't silently proceed).

## Moderate and minor issues

- `cleanup.mjs:103` performs a provisional containment check against the *default* source before
  the marker's real source is known; safe today only because the later authoritative call at `:109`
  is never skipped. Add a comment to prevent a future refactor from collapsing the two calls. See
  Failure modes above.
- `readMarker`'s `instanceof Error` branch (`property-hub-loadtest-paths.mjs:113-118`) reads as the
  inverse of its intent at a glance; a short comment would prevent a future accidental flip.

## Data flow

1. CLI args parsed (`setup.mjs:33-77` / `cleanup.mjs:20-43`) — exactly one of `--dry-run`/
   `--execute` enforced by `options.dryRun === options.execute` check in both files. **OK.**
2. `resolveLoadtestPaths` normalizes and refuses on 5 rules. **Gap**: normalization is lexical
   only; see Serious issue above.
3. Setup: source existence + `git rev-parse --is-inside-work-tree` (read-only, runs even in
   `--dry-run`) → target-absence guard → (execute only) `git clone --no-hardlinks` → on clone
   failure, `fs.rm` the target *only if this run created it* (verified: the `rm` only runs inside
   the `if (cloneResult.code !== 0)` branch, after the pre-clone `exists` check already confirmed
   absence, so the removed path was necessarily created by this run's clone attempt). **OK.**
4. Marker written immediately post-clone (`setup.mjs:236-254`); a marker-write failure removes the
   otherwise-unmarked clone and reports "unmarked clone removed." **OK.**
5. `origin` remote removed before `npm ci` and worktree creation, so no code path with a live
   `origin` remote runs untrusted install scripts or worktree operations before the remote is cut.
   **OK.**
6. `npm ci` and each `git worktree add` failure is named with its child exit code; every failure
   after marker-write appends "run cleanup --execute" (verified: `childFailure(..., true)` already
   appends it inline, and the outer catch only appends it when not already present, so no
   duplication). **OK.**
7. Cleanup: guard + marker read (**Gap** carried from step 2) → re-guard with the marker's real
   source (authoritative) → `git worktree list --porcelain` parsed by matching `^worktree (.+)$`
   blocks → refuses unless the target itself is a registered main worktree → refuses if any
   non-main worktree is lexically outside the target → removes each non-main worktree with
   `--force` → `git worktree prune` → `fs.rm(target, { recursive: true, force: true, maxRetries: 5,
   retryDelay: 500 })`. **OK** except that the final `fs.rm` operates on the same lexically-resolved
   `target` from step 2, inheriting its gap.

## Requirements fulfilment

| Requirement                                                        | Status   | Gap                                             |
| -------------------------------------------------------------------- | -------- | ------------------------------------------------ |
| `resolveLoadtestPaths` defaults, `path.resolve`, case-insensitive win32, trailing separators | COMPLETE | none |
| Five refusal rules, each with its own message                      | COMPLETE | none for the five listed rules; the set itself doesn't cover symlink/junction resolution (design-level gap, see Serious) |
| Marker write/read with hand-validated shape, `null` on any failure  | COMPLETE | none |
| `--self-test` covering refusal rules incl. case/trailing-separator  | COMPLETE | does not include a symlink/junction case (none was required by the AC, but the review focus asked for it) |
| Setup: exactly one mode required; flags parsed and validated        | COMPLETE | none |
| Setup steps in the specified order, dry-run prints and mutates nothing | COMPLETE | none |
| Setup failure messaging + `run cleanup --execute` guidance          | COMPLETE | none |
| Cleanup: exactly one mode; marker required; refuses external worktrees | COMPLETE | none |
| Cleanup never deletes without a valid marker, under source, or under Ptah repo | PARTIAL | holds for lexical paths only — see Serious issue |
| `--execute` never run during implementation/verification            | COMPLETE | confirmed by report and by the absence of any target directory left on disk |

Implicit requirements not addressed: symlink/junction resolution in the shared path guard (named
explicitly in this review's brief and implied by the architecture's "never touch the real repos"
invariant, but not enumerated as one of the plan's five refusal rules).

## Edge cases

| Case                                              | Handled | How                                                                 | Concern |
| --------------------------------------------------- | ------- | --------------------------------------------------------------------- | ------- |
| Case-insensitive drive letters (win32)              | YES     | `comparable()` lowercases resolved paths on win32                     | none |
| Trailing separators                                 | YES     | `path.resolve` strips them before comparison; self-test covers it     | none |
| `..` traversal                                      | YES     | `path.resolve` fully normalizes before any comparison                 | none |
| UNC paths                                           | PARTIAL | `path.parse(...).root` and `path.relative` are UNC-aware in Node, so the root/containment logic should generalize | not exercised by the self-test; no concrete failure found, but unverified |
| Symlinks/junctions                                  | NO      | no `fs.realpath`/`fs.lstat` call anywhere in the guard                | confirmed bypass, see Serious issue |
| Refuses the real repo (source) as target            | YES     | equality rule; confirmed by both scripts' own reported refusal runs   | none |
| Refuses targets inside/around the Ptah repo         | YES     | dedicated rule using `import.meta.url`-derived `PTAH_REPO`            | only lexical, see Serious issue |
| Non -loadtest targets refused                       | YES     | suffix rule, case-insensitive on win32                                | none |
| `--dry-run`/`--execute` both given or neither        | YES     | `options.dryRun === options.execute` in both scripts, exit 2          | none |
| Cleanup with worktrees already removed by the load test | YES  | `git worktree prune` runs after the removal loop                      | none |
| Partial-failure cleanup (mid-loop worktree remove fails) | YES | throws immediately, target left intact with its marker for a retry    | none |
| Cleanup refuses a registered worktree outside the target | YES | `isStrictlyWithin` check before any `git worktree remove`/`fs.rm`      | none |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the shared path guard performs every comparison on lexically-resolved paths and never
  resolves symlinks or NTFS junctions, so a target that is itself a link into the source repo, an
  unrelated repo, or the Ptah repository bypasses all five refusal rules — confirmed by direct
  reproduction against the live `resolveLoadtestPaths` export.
- What a robust implementation would add: `fs.realpath`-based resolution (with a safe fallback for
  paths that don't exist yet, e.g. the pre-clone target check) folded into `comparable()` before
  every equality/containment/suffix check in `resolveLoadtestPaths`, re-run once more at the start
  of `cleanup.mjs` immediately before the final `fs.rm`, so a link introduced between setup and
  cleanup cannot widen the blast radius of the delete.

## Delta

Re-reviewed after "Revise round 1" (`b3-codex-report.md` § Revise round 1). No code edits made by
this reviewer; verification limited to reading the three files in full plus running
`node --check` on all three and `node scripts/perf/property-hub-loadtest-paths.mjs --self-test`
(both independently re-run, not taken on the codex report's word). No link was created outside
`os.tmpdir()`; the self-test's own junction fixture (`property-hub-loadtest-paths.mjs:338-377`)
already builds and tears down its link entirely under `os.tmpdir()`, lstat-checks its type before
removal, and removes only the link — this reviewer created no additional link.

### Serious — lexical-only path guard: RESOLVED

`resolveLoadtestPaths` (`property-hub-loadtest-paths.mjs:175-223`) now resolves real paths before
every comparison: `assertTargetIsNotLink` (`:71-103`) walks the target's path component-by-component
with `lstatSync`, refusing on the first symlink or junction found anywhere in the chain (parent
directories included, not just the leaf) — independent of whether the leaf itself exists yet.
`realPathFromNearestExisting` (`:105-129`) then resolves the true filesystem target via
`realpathSync.native`, walking up to the nearest existing ancestor for not-yet-created paths (the
pre-clone case) and rejoining the missing suffix. All five refusal rules now compare `realSource`/
`realTarget`/`PTAH_REPO_REAL`, not the raw lexical strings. I independently re-ran the self-test,
which reproduces the exact junction-bypass scenario from my original finding entirely inside
`os.tmpdir()` (a disposable stand-in repo and a disposable junction pointed at it,
`:338-377`) and confirmed both refusals fire (`self-test junction refusal OK`) and the link is
removed cleanly afterward (`self-test junction cleanup OK`) — output reproduced below. `setup.mjs`
and `cleanup.mjs` also call `assertTargetIsNotLink` immediately before every destructive `rm`
(`setup.mjs:203,216,225`; `cleanup.mjs:68,149`), closing the gap on both the pre-existing-link case
and the swapped-in-after-the-first-check case for the final delete. This directly answers the
Serious finding above; I consider it closed.

```text
$ node --check scripts/perf/property-hub-loadtest-paths.mjs
$ node --check scripts/perf/property-hub-loadtest-setup.mjs
$ node --check scripts/perf/property-hub-loadtest-cleanup.mjs
$ node scripts/perf/property-hub-loadtest-paths.mjs --self-test
self-test junction refusal OK
self-test junction cleanup OK
self-test OK
```

(`node --check` produced no output on any of the three files, i.e. exit 0.)

Residual (not a regression, noting for completeness): a TOCTOU window remains between
`cleanup.mjs`'s pre-delete `assertTargetIsNotLink` + `resolveLoadtestPaths` re-check (`:149-153`)
and the `fs.rm` call two lines later (`:154-159`) — a link could theoretically be swapped in during
that window. This is an inherent limit of check-then-act without atomic rename/open-by-handle
semantics, not something the fix was expected to close, and the window is now as small as it can
reasonably be made without a larger redesign. Not scored as an open issue.

### Moderate — provisional cleanup guard before the marker is read: RESOLVED

`cleanup.mjs:69` now carries an explicit comment ("Provisional only: the marker supplies the source
for the authoritative guard below") directly above the first `resolveLoadtestPaths` call, and a
second, independent re-check with `assertTargetIsNotLink` plus a fresh `resolveLoadtestPaths` call
now runs immediately before the destructive `fs.rm` (`cleanup.mjs:149-153`), which goes beyond what
I asked for (I only asked for a guarding comment against a future collapse; the fix additionally
added a second real-path re-validation right at the point of deletion). Closed.

### Minor — `readMarker`'s inverted-looking catch branch: RESOLVED

`property-hub-loadtest-paths.mjs:265` now carries the comment "All normal filesystem and parse
failures collapse to null by contract" directly above the `instanceof Error` branch, and the
function also now logs a specific reason code (`ENOENT`/`EACCES`/`INVALID_JSON`/`INVALID_SHAPE`/
`UNKNOWN`, `:254-256,266-269`) to stderr before collapsing to `null` — an improvement beyond what I
asked for, since an operator now gets the real reason on the console even though the thrown/return
contract to the caller is unchanged. Closed.

### Style review's Serious ("duplicated process/path-comparison helpers"): RESOLVED

Independently confirmed by reading both consumers: `setup.mjs:12-18` imports
`assertTargetIsNotLink, childFailure, resolveLoadtestPaths, run, writeMarker` from
`property-hub-loadtest-paths.mjs`; `cleanup.mjs:13-21` imports `assertTargetIsNotLink,
childFailure, comparable, isStrictlyWithin, readMarker, resolveLoadtestPaths, run` from the same
module. `comparable`, `run`, `childFailure`, and `isStrictlyWithin` are now exported once from
`property-hub-loadtest-paths.mjs:32-136,138-173` and grepping both consumer files for a local
`function run(`/`function comparable(`/`function childFailure(`/`function isStrictlyWithin(`
definition returns nothing — no shadow copies remain. `run()` now has one shape (with `cwd`) used
by both callers, closing the "already not byte-identical" drift the style review flagged. Closed.

### Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Open findings: none from this reviewer's original review. The one item noted as residual (the
  cleanup TOCTOU window between the final guard re-check and `fs.rm`) is inherent to check-then-act
  file deletion and is not a regression or an unaddressed finding — it is called out for
  completeness only, not as a blocker to approval.
- Batch 3 overall score revised: 9/10 (up from 6/10) — the Serious finding that drove the original
  NEEDS_REVISION verdict is closed with independently-verified evidence, and the two follow-on
  fixes (moderate + minor) both exceed what was asked.
