# Batch 3 Codex Report — Property-hub load-test scripts

## Outcome

Batch 3 is implemented. The scripts require an explicit mode, use a shared path/marker guard,
remove the clone's `origin`, and only allow cleanup of a marked, guarded clone. No `--execute`
invocation was run. The prohibited Nx, Jest, build, Playwright, and git-write commands were not
run.

## Files created

- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\scripts\perf\property-hub-loadtest-paths.mjs`
- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\scripts\perf\property-hub-loadtest-setup.mjs`
- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\scripts\perf\property-hub-loadtest-cleanup.mjs`
- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\.ptah\specs\TASK_2026_463_f13d\b3-codex-report.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\.ptah\specs\TASK_2026_463_f13d\agent-output-root.md`

No existing file was modified.

## Task 3.1 — Shared path guard and marker

- `resolveLoadtestPaths` resolves defaults and normalizes comparisons at
  `property-hub-loadtest-paths.mjs:30`.
- Independent refusals cover equal paths (`:41`), filesystem roots (`:44`), nesting (`:46-52`),
  targets inside or containing this Ptah repo (`:53-59`), and the `-loadtest` suffix (`:62-68`).
  Windows comparisons are case-insensitive and resolved paths normalize trailing separators
  (`:13-23`).
- `MARKER` is `.git/ptah-loadtest-clone.json` (`:8`); writing is at `:77-84`; hand validation of
  `source`, canonical ISO `createdAt`, and integer `worktrees` is at `:86-117`. Read/parse/shape
  failures return `null`, which cleanup turns into the explicit caller refusal.
- The direct `--self-test` entry starts at `:125` and covers valid paths, equality, case variants,
  trailing separators, both nesting directions, wrong suffix, repo-inside, repo-containing, and
  filesystem-root cases (`:125-197`).

## Task 3.2 — Setup

- Argument validation is at `property-hub-loadtest-setup.mjs:33-78`: exactly one mode is required;
  `--source`, `--target`, `--worktrees` 1-40, and `--skip-install` are supported.
- Guards and the sole dry-run child process (`git rev-parse`) are at `:158-184`. The target must be
  absent before a plan or mutation continues.
- The ordered plan is printed at `:186-215`; dry run returns before mutation at `:217-220`.
- Execute-only implementation is clone/clone-failure cleanup (`:222-234`), immediate marker write
  with unmarked-clone rollback (`:236-257`), origin removal (`:260-266`), array-based `npm.cmd ci`
  on Windows (`:268-275`), and numbered worktree creation (`:277-293`).
- Child failures name the step and child exit code; spawn failures explicitly report that no child
  exit code exists (`:124-135`). Failures after marker creation direct the user to
  `run cleanup --execute` (`:294-299`).
- The manual B-E procedure, three streaming tiles, profile threshold, log paths, baseline advice,
  and perf-measurement warning are printed at `:137-154`.

## Task 3.3 — Cleanup

- Exactly-one-mode and target parsing is at `property-hub-loadtest-cleanup.mjs:20-43`.
- Cleanup first applies the shared guard, reads the marker, refuses with `not a load-test clone`,
  and re-guards using the marker's source (`:101-110`).
- Dry run prints all phases and returns without spawning or deleting (`:116-126`).
- Execute-only worktree enumeration is at `:128-145`. Every non-main worktree must be lexically
  inside the guarded target or cleanup refuses (`:147-155`), preventing registered external,
  source, or Ptah-repo paths from being removed.
- Non-main worktrees are removed with `--force` (`:157-171`), stale entries are pruned (`:173-176`),
  and only then is the marked target removed with the required retry options (`:178-184`).

## Risk and edge-case handling

- **Real repo / Ptah repo deletion:** shared guards reject equality, both containment directions,
  roots, wrong suffixes, and any target inside or containing Ptah. Cleanup repeats the guard using
  the marker source and refuses external registered worktrees.
- **Unmarked deletion:** cleanup cannot reach `fs.rm` unless `readMarker` returns the validated
  shape. Missing, malformed, unreadable, or invalid markers print `not a load-test clone`.
- **Partial setup:** clone failure removes only the pre-checked-absent target created by this run.
  Marker-write failure removes the otherwise unmarked clone. All later failures retain a valid
  marker and instruct cleanup.
- **Accidental push:** origin removal immediately follows marker creation and precedes install and
  worktree creation.
- **Shell injection / Windows npm:** all child processes use `spawn` with argument arrays and
  `shell: false`; Windows selects `npm.cmd`.
- **Existing target / missing source:** setup refuses an existing target and reports `source
missing` for an absent source. The verified default source exists.
- **Already-deleted worktrees:** cleanup runs `git worktree prune` after removing remaining
  registered non-main entries.
- **Case, trailing separator, nested paths, roots:** covered by the built-in self-test.
- **Mode safety:** neither script defaults to execute; no-mode setup exits 2. No `--execute` was
  run during implementation or verification.

## Verification evidence

The mandated order was: syntax checks, self-test, dry run, refusal/no-mode cases, ESLint, then
Prettier. Nx/Jest/audit steps are N/A for this batch.

### 1. `node --check` on all three files

```text
CHECK paths EXIT=0
CHECK setup EXIT=0
CHECK cleanup EXIT=0
```

### 2. Shared guard self-test

```text
self-test OK
SELF_TEST EXIT=0
```

### 3. Setup dry run

```text
Mode: dry-run
Source: D:\projects\property-hub
Target: D:\projects\property-hub-loadtest
Worktrees: 16
Step 1: guards passed (git -C D:\projects\property-hub rev-parse --is-inside-work-tree)
Step 2: git clone --no-hardlinks D:\projects\property-hub D:\projects\property-hub-loadtest
Step 3: write marker .git/ptah-loadtest-clone.json
Step 4: git -C D:\projects\property-hub-loadtest remote remove origin
Step 5: (cwd D:\projects\property-hub-loadtest) npm.cmd ci
Step 6.01: git -C D:\projects\property-hub-loadtest worktree add .claude-worktrees/loadtest-01 -b loadtest/01
Step 6.02: git -C D:\projects\property-hub-loadtest worktree add .claude-worktrees/loadtest-02 -b loadtest/02
Step 6.03: git -C D:\projects\property-hub-loadtest worktree add .claude-worktrees/loadtest-03 -b loadtest/03
Step 6.04: git -C D:\projects\property-hub-loadtest worktree add .claude-worktrees/loadtest-04 -b loadtest/04
Step 6.05: git -C D:\projects\property-hub-loadtest worktree add .claude-worktrees/loadtest-05 -b loadtest/05
Step 6.06: git -C D:\projects\property-hub-loadtest worktree add .claude-worktrees/loadtest-06 -b loadtest/06
Step 6.07: git -C D:\projects\property-hub-loadtest worktree add .claude-worktrees/loadtest-07 -b loadtest/07
Step 6.08: git -C D:\projects\property-hub-loadtest worktree add .claude-worktrees/loadtest-08 -b loadtest/08
Step 6.09: git -C D:\projects\property-hub-loadtest worktree add .claude-worktrees/loadtest-09 -b loadtest/09
Step 6.10: git -C D:\projects\property-hub-loadtest worktree add .claude-worktrees/loadtest-10 -b loadtest/10
Step 6.11: git -C D:\projects\property-hub-loadtest worktree add .claude-worktrees/loadtest-11 -b loadtest/11
Step 6.12: git -C D:\projects\property-hub-loadtest worktree add .claude-worktrees/loadtest-12 -b loadtest/12
Step 6.13: git -C D:\projects\property-hub-loadtest worktree add .claude-worktrees/loadtest-13 -b loadtest/13
Step 6.14: git -C D:\projects\property-hub-loadtest worktree add .claude-worktrees/loadtest-14 -b loadtest/14
Step 6.15: git -C D:\projects\property-hub-loadtest worktree add .claude-worktrees/loadtest-15 -b loadtest/15
Step 6.16: git -C D:\projects\property-hub-loadtest worktree add .claude-worktrees/loadtest-16 -b loadtest/16

Manual load-test procedure:
  WARNING: do not run during a perf measurement.
  From this Ptah worktree, set PTAH_PROFILE_ON_LAG_MS=500 and run:
  npx nx serve ptah-electron
  With 3 streaming tiles running:
  B) Have an agent remove all worktrees in one Bash command.
  C) Run rm -rf node_modules && npm ci.
  D) Run npx nx run-many -t build.
  E) Use the git panel during C/D.
  Inspect %APPDATA%\Ptah Dev\logs\Ptah Electron-<date>.log for
  [event-loop] lag, git status timed out, storm lines, and [GitProcessGate] saturated.
  Also inspect ptah-hang.log and crash dumps.
  Reproduce first on the installed build for a baseline.
DRY_RUN EXIT=0
TARGET_EXISTS=False
```

This establishes that the source exists, the full plan printed, and the target was not created.

### 4. Refusal and required-mode cases

```text
refusing target: target equals source
SETUP_REAL_REPO_REFUSAL EXIT=1
refusing target: target equals source
CLEANUP_REAL_REPO_REFUSAL EXIT=1
exactly one of --dry-run or --execute is required
Usage: node property-hub-loadtest-setup.mjs (--dry-run | --execute) [options]

Options:
  --source PATH       Source git work tree (default: D:/projects/property-hub)
  --target PATH       Clone destination (default: D:/projects/property-hub-loadtest)
  --worktrees N       Number of worktrees, 1-40 (default: 16)
  --skip-install      Skip npm ci
SETUP_NO_MODE EXIT=2
```

PowerShell rendered stderr after its stdout exit annotations in the captured console; the literal
messages and recorded native exit codes above are paired by invocation.

### 5. ESLint

```text
ESLINT EXIT=0
```

There were zero errors and zero warnings.

### 6. Prettier

```text
Checking formatting...
All matched files use Prettier code style!
PRETTIER_ALL_CHANGED EXIT=0
```

The final check covered the three scripts and both report files.

## Review handoff

Implementation and required verification are complete. The batch-level logic/style reviewer gate
remains the team-leader's next step under `batches.md`; no reviewer subagent was invoked by this
lane.

## Revise round 1

### Outcome

All round-1 findings are fixed. Real filesystem destinations now participate in every safety
comparison, target links/junctions are refused, cleanup rechecks immediately before deletion, and
the duplicated process/path helpers have one implementation. No `--execute`, Nx, Jest, build,
Playwright, or git-write command was run.

### Files changed

- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\scripts\perf\property-hub-loadtest-paths.mjs`
- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\scripts\perf\property-hub-loadtest-setup.mjs`
- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\scripts\perf\property-hub-loadtest-cleanup.mjs`
- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\.ptah\specs\TASK_2026_463_f13d\b3-codex-report.md`

### Finding resolution

1. **Logic serious — lexical-only path guard:** fixed in
   `property-hub-loadtest-paths.mjs:30-231`. `realpathSync.native` resolves the Ptah root (`:30`)
   and each source/target or nearest-existing-ancestor comparison (`:101-128`). The complete target
   component chain is inspected with `lstatSync`, refusing symlinks and Windows junctions
   (`:71-99`). The five original equality/containment/root/suffix rules now compare real paths
   (`:175-231`). Self-test creates only a disposable temp junction pointing to a disposable
   stand-in repo, covers the junction itself and a nested target, confirms link type with `lstat`,
   removes the link non-recursively, and then removes the link-free temp directory (`:339-378`).
2. **Logic moderate — provisional cleanup guard:** documented explicitly at
   `property-hub-loadtest-cleanup.mjs:69`; the marker-source check at `:76-79` is identified and
   retained as authoritative. Cleanup lstat-checks the requested target before marker access
   (`:67-71`) and repeats lstat plus authoritative real-path validation immediately before
   `fs.rm` (`:149-159`).
3. **Style serious — duplicated helpers:** `comparable`, `isStrictlyWithin`, `run` (including
   `cwd`), and `childFailure` now exist only in `property-hub-loadtest-paths.mjs:32-173` and are
   imported by setup/cleanup. `rg` found one definition of each.
4. **Style minors:** purpose/why/usage headers are present at the top of all three scripts;
   setup's flag-assignment branches are braced at `property-hub-loadtest-setup.mjs:66-74`; and
   marker errors still collapse to `null` while reporting `ENOENT`, `EACCES`, `INVALID_JSON`,
   `INVALID_SHAPE`, or `UNKNOWN` at `property-hub-loadtest-paths.mjs:243-273`.

### Verification evidence

Verification ran in the requested order.

#### `node --check`

```text
CHECK paths EXIT=0
CHECK setup EXIT=0
CHECK cleanup EXIT=0
```

#### `--self-test` and temp-directory listing

```text
self-test junction refusal OK
self-test junction cleanup OK
self-test OK
SELF_TEST EXIT=0
TEMP_SELF_TEST_ARTIFACTS=0
```

The refusal line covers both the junction target and the nested-under-junction target assertions.
The temp listing confirms no `ptah-loadtest-paths-*` link or directory remained.

#### Setup `--dry-run`

```text
Mode: dry-run
Source: D:\projects\property-hub
Target: D:\projects\property-hub-loadtest
Worktrees: 16
Step 1: guards passed (git -C D:\projects\property-hub rev-parse --is-inside-work-tree)
Step 2: git clone --no-hardlinks D:\projects\property-hub D:\projects\property-hub-loadtest
Step 3: write marker .git/ptah-loadtest-clone.json
Step 4: git -C D:\projects\property-hub-loadtest remote remove origin
Step 5: (cwd D:\projects\property-hub-loadtest) npm.cmd ci
Step 6.01: git -C D:\projects\property-hub-loadtest worktree add .claude-worktrees/loadtest-01 -b loadtest/01
Step 6.16: git -C D:\projects\property-hub-loadtest worktree add .claude-worktrees/loadtest-16 -b loadtest/16
Manual load-test procedure:
  WARNING: do not run during a perf measurement.
  From this Ptah worktree, set PTAH_PROFILE_ON_LAG_MS=500 and run:
  npx nx serve ptah-electron
  With 3 streaming tiles running:
  B) Have an agent remove all worktrees in one Bash command.
  C) Run rm -rf node_modules && npm ci.
  D) Run npx nx run-many -t build.
  E) Use the git panel during C/D.
DRY_RUN EXIT=0
TARGET_EXISTS=False
```

Steps 6.02 through 6.15 were also printed literally in sequence; the boundary lines above keep the
report concise while showing the complete numbered range was reached.

#### Refusal and required-mode cases

```text
refusing target: target equals source
SETUP_REAL_REPO_REFUSAL EXIT=1
refusing target: target equals source
CLEANUP_REAL_REPO_REFUSAL EXIT=1
exactly one of --dry-run or --execute is required
Usage: node property-hub-loadtest-setup.mjs (--dry-run | --execute) [options]
SETUP_NO_MODE EXIT=2
```

PowerShell emitted the stderr lines after the stdout exit annotations in the raw capture; the
literal message/code pairs above are ordered by their invocations.

#### ESLint, Prettier, and whitespace validation

```text
ESLINT EXIT=0
Checking formatting...
All matched files use Prettier code style!
PRETTIER EXIT=0
GIT_DIFF_CHECK EXIT=0
```

ESLint reported zero errors and zero warnings.
