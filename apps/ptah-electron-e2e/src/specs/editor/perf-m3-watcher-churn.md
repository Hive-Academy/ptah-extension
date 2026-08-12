# M3 — `git status` invocations from cache churn (B0, TASK_2026_173)

**Requirement**: B0 (M3), B4. Zero product-code change (plan §7 / Task 0.3).

## What this measures

`GitWatcherService.watchWorkspaceRoot` (`apps/ptah-electron/src/services/git-watcher.service.ts:370-422`)
recursively watches the entire workspace root and schedules a debounced
`git status --porcelain=v2 --branch` fetch (`GitInfoService.getGitInfo`,
`libs/backend/vscode-core/src/services/git-info.service.ts:54-55`) on **any**
qualifying file-system event. The exclusion predicate
(`git-watcher.service.ts:376-393`) skips only `.git/`, `node_modules/`, and
`dist/` — it does **not** skip `.nx/cache` or `.angular/cache`, both of which
churn continuously during any `nx serve`/`nx build` dev session. Every write
into either cache directory therefore re-arms the
`WORKSPACE_DEBOUNCE_MS` (2000ms, `git-watcher.service.ts:102`) timer and,
once the writes go quiet for 2s, fires a real `git status` shell-out — pure
overhead with no git-relevant change behind it. B4 (Batch 5) fixes this by
folding `.nx` and `.angular` into the same exclusion set the tree builder
already uses.

## Method

A companion script, `perf-m3-watcher-churn.script.mjs`, **replicates**
(does not import — see "Why a standalone replica" below)
`watchWorkspaceRoot`'s exact exclusion predicate and debounce window, and
shells out the exact `git status --porcelain=v2 --branch` command
`GitInfoService.getGitInfo` issues, with `GIT_TRACE=1` set on the child
process environment. Git's `GIT_TRACE` support emits exactly one trace line
per invocation to stderr (confirmed empirically below — this matches plan
§7's description precisely), which the script counts.

```
node apps/ptah-electron-e2e/src/specs/editor/perf-m3-watcher-churn.script.mjs \
  <repoRoot> <windowMs> <probeRelPathToATrackedFile>
```

The script:

1. Arms a recursive `fs.watch` on `<repoRoot>`, applying the same
   `.git/` / `node_modules/` / `dist/` exclusion `git-watcher.service.ts`
   applies.
2. Writes a small probe file into `<repoRoot>/.nx/cache/` **and**
   `<repoRoot>/.angular/cache/m3-probe/` every 2200ms (chosen deliberately
   just above the 2000ms debounce window, so successive writes do not all
   coalesce into one or two status calls — see "Why 2200ms" below).
3. At the window's midpoint, appends to `<probeRelPathToATrackedFile>` (a
   real tracked file) and reverts it after the window closes — this is the
   B4 AC3 proof that a genuine change still fires a status update within the
   existing debounce window, not just cache noise.
4. Counts `git status` invocations and their `GIT_TRACE` stderr lines
   over the window, and reports whether the mid-window genuine change was
   observed to trigger one of them.

### Why a standalone replica instead of instantiating `GitWatcherService`

`GitWatcherService`'s constructor only needs `GitInfoService` + `Logger`
(`git-watcher.service.ts:113-116`), so it is technically importable
standalone. It was not imported directly because doing so would require a
TypeScript execution step (`ts-node`/`@swc-node/register` plus path-mapped
resolution of `@ptah-extension/vscode-core` and `@ptah-extension/shared`)
for a class whose logic is three `if` conditions, one `setTimeout` reset,
and one shell-out — reproducing it inline is lower-risk and has zero
build-step dependency. Every line of the replica cites the exact source
lines it mirrors so a reviewer can diff them by eye. If this harness is
promoted to a permanent regression guard later, importing the real class is
the better long-term choice.

### Why 2200ms cache-write cadence instead of a live `nx build`

A real `nx serve ptah-electron` + concurrent build session was tried FIRST,
directly against this repository (see "What we actually ran" below) and
produced a confounded result: the live monorepo has continuous ambient
file-system churn unrelated to any build (Nx daemon activity, editor
auto-save, and other background tooling on a live dev machine) frequent
enough that the 2000ms debounce window never went quiet across a full 60s
observation — **zero** status calls fired, not because the fix already
works, but because the debounce kept getting re-armed by noise the watcher
was never designed to filter. This is itself a real, reportable observation
(a live dev workspace is a worse environment for this specific measurement
than a controlled one — every other spec in this e2e suite uses a fictional
`C:\ptah-e2e-ws` workspace rather than the live repo, precisely to avoid
this class of problem), but it is not a usable baseline figure.

The recorded baseline instead uses an isolated scratch git repository
(`git init` in a temp directory, one tracked file, empty `.nx/cache` +
`.angular/cache` directories) with synthetic cache writes on a fixed
2200ms cadence — just above the 2000ms debounce window, so most writes
produce their own separate status call rather than coalescing, which
reproduces the "many separate cache-write bursts over a dev-build window"
shape a real build produces without needing a multi-minute build or a
noise-free machine.

## Reproduction

```bash
# 1. Create an isolated scratch repo
mkdir /tmp/ptah-m3-scratch && cd /tmp/ptah-m3-scratch
git init -q && git config user.email m3@test.local && git config user.name "M3"
mkdir -p src .nx/cache .angular/cache
echo "export const x = 1;" > src/file.ts
git add -A && git commit -q -m init

# 2. Run the script (Windows path form; 60s window)
node D:/projects/ptah-extension/apps/ptah-electron-e2e/src/specs/editor/perf-m3-watcher-churn.script.mjs \
  "<scratch-repo-windows-path>" 60000 "src/file.ts"
```

### Gold-standard variant (not used for the recorded baseline, documented for completeness)

Launch the real dev build and watch its own stderr, with no synthetic
substitute:

```bash
GIT_TRACE=1 npx nx serve ptah-electron 2> electron-trace.log &
# ... run a real build in parallel, e.g.:
npx nx build @ptah-extension/editor --skip-nx-cache
# after >=60s, stop the app and:
grep -c 'git status' electron-trace.log
```

This was not used for the recorded number because (a) it requires a
multi-minute wall-clock build with non-deterministic duration, (b) it risks
conflicting with a developer's already-running `nx serve ptah-electron`
instance (explicitly flagged as a risk for this task), and (c) the live
monorepo's ambient noise problem described above confounds the count. It
remains the correct procedure for a final pre-ship sanity check in Batch 5
(Task 5.3's after-measurement), run on a quiet machine.

## Recorded baseline (captured today, pre-Batch-5)

| Field                                                                                                           | Value                                                           |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Window                                                                                                          | 60,000ms                                                        |
| Cache-write cadence                                                                                             | 2,200ms (28 writes to each of `.nx/cache` and `.angular/cache`) |
| Workspace debounce                                                                                              | 2,000ms (`WORKSPACE_DEBOUNCE_MS`, unmodified)                   |
| **`git status` invocations**                                                                                    | **25**                                                          |
| GIT_TRACE stderr lines matching the invocation (1 per call, confirms plan §7's "one trace line per invocation") | 25                                                              |
| Mid-window genuine tracked-file change fired its own status update                                              | Yes — confirmed                                                 |
| Plan's expected baseline                                                                                        | ≈30                                                             |

25 is close to the plan's ≈30 expectation (same order of magnitude, same
mechanism — the small delta is attributable to the exact cache-write cadence
and count chosen here versus a real build's actual write pattern). See
`.ptah/specs/TASK_2026_173/measurements.md` for the M3 row and how this
compares against the Batch 5 after-figure (target: 0 invocations
attributable to already-excluded paths).
