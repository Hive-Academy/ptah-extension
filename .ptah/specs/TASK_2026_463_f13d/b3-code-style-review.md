# Code Style Review — `TASK_2026_463_f13d` Batch 3

## Summary

| Metric          | Value                                 |
| ---------------- | ------------------------------------ |
| Overall score   | 7/10                                  |
| Assessment      | APPROVED                              |
| Blocking issues | 0                                      |
| Serious issues  | 1                                      |
| Minor issues    | 3                                      |
| Files reviewed  | 3 (`property-hub-loadtest-paths.mjs`, `property-hub-loadtest-setup.mjs`, `property-hub-loadtest-cleanup.mjs`) |

## Five style questions

### 1. What breaks in six months?

If `run()`, `childFailure()`, or the win32-lowercase `comparable()` path-compare helper ever need a
fix — e.g. adding a timeout, or handling a spawn `ENOENT` distinctly from other spawn errors — the
fix has to be applied in up to three places by hand: `property-hub-loadtest-setup.mjs:88-114,128-135`,
`property-hub-loadtest-cleanup.mjs:45-55,57-90`, and the private (unexported) `comparable()` inside
`property-hub-loadtest-paths.mjs:13-16`. These three copies are already not byte-identical (setup's
`run()` takes a `cwd` option; cleanup's does not), so a reader cannot assume a fix in one place is
mirrored correctly in the others — the classic "duplication with drift" shape the review brief asks
to watch for.

### 2. What would a new team member misread?

None of the three new files carries the header-comment convention this directory's own sibling
scripts use for anything non-trivial or destructive: `scripts/performance-baseline.mjs:1-17` and
`scripts/test-native.mjs:1-36` (Node) and `scripts/reset-ptah-dev-profile.sh:1-29` (bash) all open
with a purpose/why/usage block before any code. These three scripts are the ones in the repo most
capable of deleting the wrong directory tree — cleanup's whole job is `fs.rm(..., { recursive:
true, force: true })` on a resolved path — and a reader arriving cold has to reconstruct "why does
this exist, what is property-hub, why -loadtest suffix, why remove origin" from
`implementation-plan.md` (which does not ship with `git clone` of this repo) rather than from the
file. The `USAGE` constants (`setup.mjs:11-17`, `cleanup.mjs:12`) document flags, not intent.

### 3. What does this cost to maintain?

Moderate. The guard logic itself (`resolveLoadtestPaths`, `writeMarker`, `readMarker`) is
genuinely centralized and used by both `setup.mjs:6-9,161-164` and `cleanup.mjs:7-10,103-112` — the
one part of Task 3.1's stated purpose ("a shared guard module lets setup and cleanup agree on what
a load-test clone is", `implementation-plan.md:149`) that *was* centralized. But the plumbing around
it (spawn wrapper, exit-code formatting, path-comparison) was not, so the module is a partial
success: the safety-critical rules live in one place, the everyday utility code does not.

### 4. Where is this inconsistent with the rest of the repository?

`scripts/rename-tui-to-cli.mjs` and `scripts/fix-empty-catches.mjs` (the two largest scripts in
`scripts/`) each own their process/file helpers inline because they are single-file, single-purpose
tools with no sibling script sharing their domain. `property-hub-loadtest-setup.mjs` and
`-cleanup.mjs` are not that case — they are a matched pair created in the same task, explicitly
designed to "agree" through a shared module — yet the pair duplicates its process-spawning and
path-comparison code instead of extending the module both already import from. That is the
boundary violation this review is scoped to catch: a shared module existing, but only partially
used by the two units it was built for.

### 5. What would you have done differently?

Move `run()`, `childFailure()`, and `comparable()` into `property-hub-loadtest-paths.mjs` (or a
sibling `property-hub-loadtest-process.mjs` if `paths.mjs` should stay pure/no-child-process, which
is plausible given its `--self-test` runs with no children). Export `comparable` alongside
`resolveLoadtestPaths` so cleanup's `isStrictlyWithin`/`comparable` pair collapses to an import, and
give `run()` a `cwd` parameter unconditionally so both callers use the identical function. This
would take Task 3.1's "one lane in order... setup and cleanup import it" framing
(`batches.md:392`) all the way, rather than half of it. I would also add a 6-10 line header comment
to each file naming the source (`S437/handoff.md §9`), the invariant ("never touches the real
repo"), and pointing at the marker file, matching the convention the rest of `scripts/` already
sets.

## Blocking issues

None. No refusal rule is bypassable, no `--execute` path was run, and the marker/guard model holds
across all three files (verified by reading, not by re-running `--execute`).

## Serious issues

### Duplicated process/path-comparison helpers between the two consumers of a shared guard module

- File: `scripts/perf/property-hub-loadtest-setup.mjs:88-114` (`run()`), `:128-135`
  (`childFailure()`); `scripts/perf/property-hub-loadtest-cleanup.mjs:45-55` (`comparable()`),
  `:57-82` (`run()`), `:84-90` (`childFailure()`); `scripts/perf/property-hub-loadtest-paths.mjs:13-16`
  (private `comparable()`, a third near-identical copy of the same win32-lowercase logic).
- Problem: Task 3.1's own stated purpose for the shared module is that "setup and cleanup import
  it" so they "agree" (`implementation-plan.md:149`, `batches.md:392`). The safety rules
  (`resolveLoadtestPaths`, marker read/write) do live in the shared module and are correctly
  imported by both. The spawn wrapper and its exit-code formatting, and the case-insensitive path
  comparison, do not — each of the two scripts re-implements them, and `paths.mjs` has its own
  third private copy of the comparison logic that neither script reuses.
- Impact: three copies of logic that must stay behavior-identical for the guard model to hold (a
  path comparison that silently stops being case-insensitive in only one of the three copies would
  reopen exactly the "same repo, different case" refusal gap Task 3.1 was built to close). The two
  `run()` copies already differ in shape (`cwd` supported only in `setup.mjs`), so a future patch to
  one is not visibly required in the other — nothing marks them as linked.
- Recommendation: export `comparable` from `property-hub-loadtest-paths.mjs` and have both scripts
  import it instead of redefining it; extract `run()`/`childFailure()` into the shared module (or
  one new file it re-exports from) with a `cwd` option that both scripts use, deleting the two
  inline copies. This does not add a new abstraction with unclear cases behind it — the two repeated
  cases (setup, cleanup) already exist and already need to agree.

## Minor issues

- No purpose/why/usage header comment in any of the three files, unlike
  `scripts/performance-baseline.mjs:1-17`, `scripts/test-native.mjs:1-36`,
  `scripts/reset-ptah-dev-profile.sh:1-29` — see Q2. Cost is a real one given these scripts run
  destructive filesystem operations, but is not a functional defect.
- `property-hub-loadtest-paths.mjs:95-118` (`readMarker`) collapses every `Error` from `readFile`
  or `JSON.parse` into `null`, including e.g. an `EACCES` permission error that is not "not a
  load-test clone" but "cannot tell." The caller in `cleanup.mjs:104-107` reports the single message
  `not a load-test clone` either way. This matches the plan's stated design exactly
  (`implementation-plan.md:425-426`: "returns `null` on any mismatch or read/parse failure ... the
  failure reason is reported by the caller's refusal message, not swallowed silently") — so it is
  not a deviation from the agreed contract, but it does mean a permissions problem and a genuinely
  wrong directory produce the identical, less-specific message to an operator at 2am. Flagging for
  visibility rather than as a defect, since the plan explicitly chose this tradeoff.
- `property-hub-loadtest-setup.mjs:60` (`if (arg === '--worktrees') options.worktrees =
  Number(value);`) and its two neighbor lines use single-line `if` bodies without braces, the only
  place in either new script that departs from the brace-per-block style used everywhere else in
  the same function (e.g. `:58-59` above it, `:69-75` below it). Not a rule violation — Prettier
  accepts it and the codex report confirms a clean `--check` — but it reads as a stray formatting
  choice next to fully-braced siblings three lines away.

## File-by-file

### `property-hub-loadtest-paths.mjs`

Score 7/10 — 0 blocking, 1 serious (shared with the pair above; this file is the one that should
have exported the comparison helper), 0 further minor beyond the `readMarker` note. The refusal
rules (`:40-68`) are complete against the plan's five-rule list (equal, nested either direction,
suffix, Ptah-repo containment either direction, filesystem root) and the `--self-test` block
(`:125-202`) exercises all of them plus case and trailing-separator variants, matching
`implementation-plan.md:427-429`. Naming is domain-appropriate (`resolveLoadtestPaths`,
`writeMarker`, `readMarker`) with no `helpers`/`utils` grab-bag.

### `property-hub-loadtest-setup.mjs`

Score 7/10 — 0 blocking, 1 serious (duplication, see above), 1 minor (brace style at `:58-60`).
Step ordering matches the plan exactly (guards → clone → marker → remove origin → npm ci →
worktrees → print manual procedure, `implementation-plan.md:433-445`); dry-run prints the identical
plan and performs only the read-only `git rev-parse` check, matching AC3
(`batches.md:432-433`); a failed clone removes only a target this run created
(`setup.mjs:222-233`); a failed marker write removes the clone and never claims the marker exists
(`:236-254`); every later failure appends `run cleanup --execute` exactly once
(`:293-298`) rather than double-appending across nested catches. `npm.cmd` is selected on win32 and
`spawn` always passes an argument array with `shell: false` (`:88-93,268-275`), satisfying the
no-shell-interpolation requirement.

### `property-hub-loadtest-cleanup.mjs`

Score 7/10 — 0 blocking, 1 serious (duplication, see above), 0 further minor. Cleanup correctly
re-derives `paths` from the marker's own recorded `source` (`:109-112`) rather than trusting the
CLI `--target` alone, and refuses when the resolved target is not the git-registered main worktree
(`:136-144`) or when any linked worktree lies outside the target (`:146-155`) — a defense not
explicitly named as its own acceptance criterion but consistent with "no code path deletes a path
without a valid marker, under the source, or under the Ptah repo" (`implementation-plan.md:465-466`,
`batches.md:448`). `git worktree prune` runs after explicit removals as the plan specifies
(`implementation-plan.md:454`), and `fs.rm` uses the same retry options as `setup.mjs`'s rollback
path, which is a case of the *good* kind of duplication (a small, stable literal, not a
place logic could drift).

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| `kebab-case.ts`-equivalent file naming for scripts, domain-named (no `helpers`/`utils`) | PASS | `property-hub-loadtest-{paths,setup,cleanup}.mjs` |
| `catch (error: unknown)` narrowing pattern (TS convention, applied idiomatically in `.mjs`) | PASS | `setup.mjs:120-124,250,294,306-309`; `cleanup.mjs:188-191`; `paths.mjs:113-117` all narrow with `instanceof Error` before use |
| No shell interpolation of untrusted input; array-form `spawn` | PASS | `setup.mjs:88-93`; `cleanup.mjs:57-61` |
| No TODO/stub/placeholder | PASS | grep across `scripts/perf/*.mjs` returns no matches |
| ESM `.mjs` + Node built-ins only, matching the plan's chosen precedent over `.ps1`/bash | PASS | `implementation-plan.md:150-154`; no non-builtin imports in any of the three files |
| Header/purpose doc-comment convention used by other non-trivial `scripts/*` files | FAIL | `scripts/performance-baseline.mjs:1-17`, `scripts/test-native.mjs:1-36`, `scripts/reset-ptah-dev-profile.sh:1-29` vs. none in the three new files |
| Shared module used fully by both of its declared consumers | FAIL | `property-hub-loadtest-paths.mjs` is imported for guards/marker only; `run`/`childFailure`/`comparable` are duplicated instead of shared, see Serious issue |
| `eslint.config.mjs` `**/*.mjs` coverage applies, `scripts/` not ignored | PASS (per codex report) | `eslint.config.mjs:166-190` (ignores list has no `scripts/` entry), `:388-396` (`**/*.mjs` rule block); `b3-codex-report.md:174-180` reports 0 errors/warnings |

## Maintenance debt

- Introduced: one genuinely shared safety module (`property-hub-loadtest-paths.mjs`) plus two
  scripts that partially duplicate its neighborhood (spawn wrapper, path comparison). No new
  `node_modules` dependency, no npm script entry — as scoped.
- Retired: nothing (three new files, no existing file touched, per the codex report and
  `git status`).
- Net: mild increase in future maintenance risk specifically at the three duplicated helpers; the
  safety-critical guard logic itself carries no such debt.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: `run()`, `childFailure()`, and the win32 path-comparison logic exist in three
  slightly-different copies across a module explicitly built so its two consumers "agree" — a
  behavior-changing fix to one is not guaranteed to reach the others.
- What a 10/10 version would do differently: export `comparable` from `property-hub-loadtest-paths.mjs`
  and consolidate the two `run()`/`childFailure()` copies into the shared module (or one file it
  re-exports), and add a short header comment to each script naming its origin
  (`S437/handoff.md §9`) and its core invariant, matching the convention already set by
  `performance-baseline.mjs`, `test-native.mjs`, and `reset-ptah-dev-profile.sh`.
