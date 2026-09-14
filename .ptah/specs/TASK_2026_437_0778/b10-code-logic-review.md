# Code Logic Review — Batch 10 (`TASK_2026_437_0778`)

Scope: build targets, packaging and native gates for the `@parcel/watcher` watch host
(Electron + CLI). Files reviewed: `.github/workflows/publish-electron.yml`,
`.github/workflows/publish-cli.yml` (unmodified but load-bearing), `.github/workflows/cli-e2e.yml`
(unmodified, read for context), `apps/ptah-cli/{package.json,project.json,src/test-utils/esm-bundle-gate.spec.ts,tsconfig.workspace-watch-host.json}`,
`apps/ptah-electron/{CLAUDE.md,electron-builder.yml,package.json,project.json,scripts/verify-packed-native.js,src/config/esm-bundle-gate.spec.ts,tsconfig.workspace-watch-host.json}`,
`apps/ptah-tui/tsconfig.app.json`, root `package.json`/`package-lock.json`, plus the runtime
consumers `libs/backend/platform-cli/src/implementations/cli-workspace-watcher.ts`,
`libs/backend/cli-engine/src/lib/thoth/{cli-integrity-worker-factory,register-thoth-libraries}.ts`,
`libs/backend/platform-electron/src/workspace-watch/parcel-watcher-engine.ts`, and
`.ptah/specs/TASK_2026_437_0778/{batches.md,b1-spike-report.md,handoff.md}`.

No `nx` command was run; findings below are static (project.json / workflow / source reading),
consistent with the read-only constraint for this review.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 4/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 2              |
| Serious issues      | 3              |
| Moderate issues     | 2              |
| Failure modes found | 4              |

## Five logic questions

### 1. How does this fail silently?

- The published `@hive-academy/ptah-cli` npm tarball ships without
  `workspace-watch-host.mjs` (and, unchanged by this batch, without
  `embedder-worker.mjs` / `integrity-worker.mjs`) because `publish-cli.yml`'s
  `Build` step wipes them (see Blocking #1). `CliWorkspaceWatchHostProcess`'s
  constructor throws `watch host bundle not found` for a missing bundle
  (`libs/backend/platform-cli/src/implementations/cli-workspace-watcher.ts:87-90`),
  and by design (`:27-29`) the supervisor treats that as a failed fork, burns its
  restart budget in ~1.5s, and degrades. The CLI keeps running and prints nothing
  a user would recognize as "watch mode never worked" — this is silent by design
  for a _dev_ run before the build exists, but it also silently swallows the
  _production_ case introduced by the broken publish pipeline.
- `verify-packed-native.js`'s new `verifyPackedParcelWatcher()` (`apps/ptah-electron/scripts/verify-packed-native.js:136-186`)
  does correctly FAIL (not skip) on a missing/broken packed watcher — that part is not silent.
  But it has no timeout around `await watcher.subscribe(tmpDir, () => {})` /
  `await handle.unsubscribe()` (`:161-163`). If the native binding loads but hangs on
  subscribe (a real N-API failure mode, not hypothetical — it's exactly the class of bug
  the better-sqlite3 gate exists to catch for a different symptom), the gate does not fail;
  it hangs until the CI job's outer timeout kills the whole job, which reads as an
  infrastructure flake, not "the watcher gate caught a packaging defect."

### 2. What user action produces unexpected behaviour?

- A user who installs the published CLI (`npm install -g @hive-academy/ptah-cli`) and runs
  `ptah tui` or any command that touches the workspace watcher gets no recursive file
  watching, ever, with no error surfaced to them — `isDegraded` flips true almost
  immediately and stays there for the process lifetime. The feature this whole task exists
  to ship (C9, the `@parcel/watcher` host) does not work for the actual distribution channel
  this batch is meant to gate.
- A contributor running `nx build ptah-cli` locally, immediately followed by
  `nx build-embedder-worker ptah-cli` (or vice versa) from a _fresh_ checkout, then a second
  time with Nx cache warm, can get a `dist/apps/ptah-cli` missing one of
  `embedder-worker.mjs` / `integrity-worker.mjs` / `workspace-watch-host.mjs` / `tui.mjs`
  depending on which target's cache entry gets replayed last, because five targets
  (`build-esbuild`, `build-embedder-worker`, `build-integrity-worker`,
  `build-workspace-watch-host`, and `ptah-tui:build`) all declare the _entire_
  `dist/apps/ptah-cli` directory as `outputs` (see Blocking #2). `nx` reports success either way.

### 3. What input data produces a wrong answer rather than an error?

- None of the packaging config itself computes a "wrong answer" from bad input in the usual
  sense (this batch is almost entirely build wiring, not business logic). The closest
  analogue: `verify-packed-native.js`'s `findPackedParcelWatcher` walk
  (`apps/ptah-electron/scripts/verify-packed-native.js:123-142`) matches on a path _suffix_
  (`app.asar.unpacked${sep}node_modules${sep}@parcel/watcher/index.js`). If electron-builder
  ever nests a second copy of `@parcel/watcher` inside another package's own
  `node_modules` (npm dedup failure, or a future transitive dependency pinning a different
  version), the walk would find both and `require()` whichever one first — the gate would
  report a green subscribe against a copy that is not necessarily the one your own
  `package.json` pins. Low probability, not exercised by this diff, but the recursive walk
  has no de-dup/uniqueness assertion the better-sqlite3 walk arguably also lacks.

### 4. What happens when a dependency fails?

- `@parcel/watcher` failing to load or subscribe _in the packaged app_ is handled well: the
  Electron/CLI supervisor's restart-budget-then-degrade path (documented in Batch 8/9 outcome,
  exercised by `verify-packed-native.js`'s pre-ship gate) is a solid design, and this batch's
  addition to that gate is a real, working check for the Electron artifact.
- `@parcel/watcher` failing to load in the _CLI npm distribution_ is not actually gated at
  all — there is no equivalent of `verify-packed-native.js` for the CLI tarball verifying
  `workspace-watch-host.mjs`/`@parcel/watcher` presence before `npm publish`; the closest
  check, "Verify dist contents" in `publish-cli.yml`, does not list `workspace-watch-host.mjs`,
  `embedder-worker.mjs`, or `integrity-worker.mjs` among the files it asserts exist
  (only `main.mjs`, `tui.mjs`, docs and wasm). Combined with Blocking #1, this means the one
  file-existence gate that could have caught the missing bundle does not check for it.

### 5. What is missing that the requirements never mentioned?

- A CLI-side equivalent of `verify-packed-native.js` — a `npm pack` + install + `require`
  - subscribe smoke run as an actual publish gate, not just as a manual Batch-1 spike step
    that nobody re-ran in CI. `b1-spike-report.md` proved this once, by hand, in a throwaway
    worktree; nothing in this batch turns that into a repeatable, enforced check.
- A single source of truth for "these N files must exist in `dist/apps/ptah-cli` before pack"
  that all three of `publish-cli.yml`, `cli-e2e.yml`, and local dev share, instead of each
  workflow hand-rolling its own build+copy sequence that can silently diverge from what
  `restore-cli-manifest`'s `dependsOn` graph actually produces.

## Failure modes

### CLI publish ships without the watch host bundle

- Trigger: `.github/workflows/publish-cli.yml` "Build" step runs `npx nx build ptah-cli`.
  `ptah-cli`'s `build` target depends only on `["build-esbuild", "copy-wasm"]`
  (`apps/ptah-cli/project.json:8-10`); it does **not** depend on `build-embedder-worker`,
  `build-integrity-worker`, or the new `build-workspace-watch-host`. `build-esbuild` sets
  `"deleteOutputPath": true` (`apps/ptah-cli/project.json:12-27`), which wipes
  `dist/apps/ptah-cli` on every run. The workflow never calls the `restore-cli-manifest` nx
  target (the one whose `dependsOn` actually orders `build-embedder-worker` →
  `build-integrity-worker` → `build-workspace-watch-host` → `ptah-tui:build`,
  `apps/ptah-cli/project.json:210-224`); instead it runs `npx nx build ptah-cli`, then
  `npx nx build ptah-tui`, then hand-copies `package.json`
  (`.github/workflows/publish-cli.yml` "Build" / "Build TUI bundle" / "Restore CLI manifest"
  steps). Earlier in the same job, the "Test" step (`npx nx test ptah-cli`) _does_ trigger
  the three worker builds via `test`'s `dependsOn` (`apps/ptah-cli/project.json:247-254`) —
  but the later "Build" step's `deleteOutputPath: true` throws that work away.
- Symptom: `npm publish` ships a tarball with `main.mjs`, `tui.mjs`, docs and wasm, but no
  `embedder-worker.mjs`, `integrity-worker.mjs`, or `workspace-watch-host.mjs`. Nothing in the
  pipeline fails — "Verify dist contents" only checks for `main.mjs`/`tui.mjs`/docs/wasm
  (see file list in that step) — so `publish` succeeds and reports green.
- Evidence: `.github/workflows/publish-cli.yml` (Build/Build TUI bundle/Restore CLI
  manifest/Verify dist contents steps); `apps/ptah-cli/project.json:8-10,12-27,210-224,247-254`;
  `libs/backend/platform-cli/src/implementations/cli-workspace-watcher.ts:86-90`.
- Current handling: none. This is the mechanism the executor's deviation #3 asked to be
  judged, and it is confirmed real and unfixed by this batch — the batch only worked around
  it locally with `--skip-nx-cache` on `restore-cli-manifest`, which `publish-cli.yml` doesn't
  even call.
- Recommendation: change `publish-cli.yml`'s build sequence to `npx nx run
ptah-cli:restore-cli-manifest` (the graph that is already correct) instead of the
  hand-rolled `build` + `build ptah-tui` + manual copy, and add
  `embedder-worker.mjs`, `integrity-worker.mjs`, `workspace-watch-host.mjs` to "Verify dist
  contents". Do the same for any other workflow that independently replays this sequence
  (`cli-e2e.yml` already does the right thing by calling `restore-cli-manifest` directly —
  use it as the template).

### Nx cache-replay can silently drop CLI worker bundles

- Trigger: `build-esbuild`, `build-embedder-worker`, `build-integrity-worker`, and the new
  `build-workspace-watch-host` (`apps/ptah-cli/project.json:183-209`) all declare
  `"outputs": ["{options.outputPath}"]` — i.e. the whole `dist/apps/ptah-cli` directory,
  not their own file — and `ptah-tui:build` (`apps/ptah-tui/project.json:8-27`) does the
  same for its single `tui.mjs`. Because these five targets' recorded cache snapshots each
  cover the _entire_ directory, a cache-hit replay of any one of them (which Nx performs by
  restoring its own snapshot into `outputPath`) overwrites whatever files sibling targets
  wrote in the same graph run, and Nx reports success regardless (the exact mechanism the
  Batch 9→10 handoff already reproduced with `tui.mjs`/`integrity-worker.mjs`/
  `workspace-watch-host.mjs` disappearing).
- Symptom: an apparently-successful `nx build-esbuild ptah-cli` / `restore-cli-manifest` /
  CI run that leaves `dist/apps/ptah-cli` missing one or more of the four generated `.mjs`
  bundles, with no error anywhere in the log.
- Evidence: `apps/ptah-cli/project.json:12-27` (`build-esbuild`, `deleteOutputPath: true`,
  unscoped outputs), `:183-209` (`build-workspace-watch-host`, unscoped outputs — copies the
  same shape), `apps/ptah-tui/project.json:8-27` (writes into a _different project's_ dist
  dir and claims the whole thing as its own output). Contrast with
  `apps/ptah-electron/project.json`'s own new target in the _same diff_:
  `build-workspace-watch-host` there correctly scopes
  `"outputs": ["{options.outputPath}/workspace-watch-host.mjs"]` — the fix pattern was
  available in this very batch and was not applied to the CLI copy.
- Current handling: the batch's only mitigation is `--skip-nx-cache` on
  `restore-cli-manifest`, applied manually by the executor locally
  (`batches.md` Batch 10 section, D3 note) — not committed as a workflow change, not applied
  to `publish-cli.yml` or `cli-e2e.yml`, and not a fix for the underlying overlapping-outputs
  declaration.
- Recommendation: scope every CLI worker/host esbuild target's `outputs` to its own
  filename (as Electron's copy already does), and add a pack-time gate — a small script
  run right before `npm pack`/`npm publish` that asserts every file in `package.json`
  `files` exists on disk with a size > 0 — so a future cache or ordering regression fails
  loudly instead of shipping a truncated tarball.

### `verify-packed-native.js`'s parcel-watcher smoke can hang instead of fail

- Trigger: the packed `@parcel/watcher` native binding loads (`require()` succeeds) but
  `subscribe()` never resolves or rejects — a plausible native-module failure mode distinct
  from the `MODULE_NOT_FOUND` case the gate was written to catch.
- Symptom: the `package`/CI job hangs until the surrounding job or step timeout kills it,
  rather than the gate itself failing with a clear message the way the sibling
  `MODULE_NOT_FOUND` / missing-binary branches do.
- Evidence: `apps/ptah-electron/scripts/verify-packed-native.js:159-166` — `await
watcher.subscribe(tmpDir, () => {})` and `await handle.unsubscribe()` have no
  `Promise.race`/timeout wrapper, unlike e.g. a bounded-timeout pattern used elsewhere in
  this codebase for worker self-tests (`esm-bundle-gate.spec.ts` comments reference "the
  bounded timeout below is a safety net").
- Current handling: none — a bare `await`.
- Recommendation: wrap the subscribe/unsubscribe calls in a short timeout (a few seconds is
  plenty for a local temp-dir subscribe) and throw a named error ("subscribe() did not
  resolve within Nms") so a hang reads as a packaging defect, not a CI infra flake.

### D10 (cross-platform proof) is not actually closed by this batch

- Trigger: none — this is a gap in the verification claim itself. `batches.md:667` states
  "Release CI package matrix (macOS / Linux / Windows arm64) green ... before P2 is declared
  done (D10)" as a Batch 10 done-condition, and Task 10.5 describes adding
  cross-platform smoke coverage. The actual diff to `.github/workflows/publish-electron.yml`
  is comment/title-only (confirmed via `git diff`) — it renames the existing
  "Verify packed better-sqlite3 ABI" step to mention `@parcel/watcher` too, but adds no new
  runner leg.
- Symptom: the matrix is still `windows-latest` / `macos-latest` / `ubuntu-latest`
  (`.github/workflows/publish-electron.yml:150-157`), and `mac:` in
  `apps/ptah-electron/electron-builder.yml:122-128` sets no `arch:`, so electron-builder
  defaults to the host runner's architecture. GitHub's `macos-latest` is an Apple Silicon
  (arm64) image, so the one macOS leg proves darwin-arm64 only — darwin-x64 (Intel Mac)
  remains unproven, exactly as flagged in `b1-spike-report.md`'s own "Platform risk (D10)"
  section, and no Windows-arm64 leg exists at all.
- Evidence: `.github/workflows/publish-electron.yml:150-157`;
  `apps/ptah-electron/electron-builder.yml:122-128` (no `arch:` key under `mac:`);
  `b1-spike-report.md:59-64`.
- Current handling: the batch relabels an existing step and calls D10 addressed; it is not.
- Recommendation: either add an explicit `arch: [x64, arm64]` matrix leg for macOS (electron-
  builder supports building both from an arm64 host) or state plainly in `batches.md` that
  D10 remains open for darwin-x64 and Windows-arm64, rather than marking the risk closed.

## Blocking issues

### CLI publish pipeline can ship without `workspace-watch-host.mjs`

- File: `.github/workflows/publish-cli.yml` (Build / Build TUI bundle / Restore CLI manifest
  / Verify dist contents steps); `apps/ptah-cli/project.json:8-10,12-27`
- Scenario: every real `release/cli` publish and every `workflow_dispatch` publish run, given
  the current step sequence (see Failure modes above). This is not a hypothetical edge case —
  it is the pipeline's normal path.
- Impact: users who install the published CLI/TUI get no recursive workspace watching, ever,
  with no visible error (`isDegraded` swallows it). This is the feature Batch 8–10 exist to
  ship. It also means `embedder-worker.mjs`/`integrity-worker.mjs` — unrelated to this task
  but sharing the same wipe — are very likely already missing from every published CLI
  version today.
- Fix: point the publish workflow at `nx run ptah-cli:restore-cli-manifest` (the correct
  dependency chain, already used by `cli-e2e.yml`) instead of the hand-rolled
  `build`+`build ptah-tui`+manual-copy sequence, and extend "Verify dist contents" to assert
  all three worker/host bundles exist.

### `build-workspace-watch-host` (CLI) reintroduces the exact cache-hazard this batch was warned about

- File: `apps/ptah-cli/project.json:183-209`
- Scenario: any Nx invocation (local or CI) where `build-workspace-watch-host`,
  `build-embedder-worker`, `build-integrity-worker`, `build-esbuild`, or `ptah-tui:build`
  is a cache hit after a sibling target already wrote its file into the same run's
  `dist/apps/ptah-cli`.
- Impact: a silently incomplete `dist/apps/ptah-cli`, reported as success by Nx; the exact
  mechanism already observed once this session (per `handoff.md`/`batches.md`) and left
  unresolved as a batch deliverable — the batch had the correctly-scoped pattern one file
  away (Electron's own `build-workspace-watch-host`) and did not apply it to the CLI copy.
- Fix: scope `apps/ptah-cli/project.json:183-209`'s `outputs` to
  `["{options.outputPath}/workspace-watch-host.mjs"]`, and do the same retroactively for
  `build-esbuild`/`build-embedder-worker`/`build-integrity-worker`/`ptah-tui:build` (pre-
  existing, but now proven to bite in practice).

## Serious issues

### `verifyPackedParcelWatcher` has no timeout on `subscribe`/`unsubscribe`

- File: `apps/ptah-electron/scripts/verify-packed-native.js:159-166`
- Scenario: native binding loads but hangs on first subscribe (a real N-API failure class).
- Impact: CI job hangs to its outer timeout instead of failing fast with a diagnosable
  message; wastes CI minutes and looks like infra flakiness, undermining the very purpose of
  a "fail loud" gate the file's own header comment describes.
- Fix: wrap both calls in a short `Promise.race` timeout with a named error.

### D10 cross-platform claim is not backed by the diff

- File: `.github/workflows/publish-electron.yml:150-157`; `apps/ptah-electron/electron-builder.yml:122-128`
- Scenario: any macOS publish run — proves arm64 only, per the runner's default architecture
  and the absence of an `arch:` override.
- Impact: darwin-x64 and windows-arm64 remain unproven despite `batches.md` treating D10 as
  closed by this batch.
- Fix: add an explicit arch matrix leg, or correct the batch's done-condition wording.

### `integrity-worker.mjs` still missing from `apps/ptah-cli/package.json` `files`

- File: `apps/ptah-cli/package.json:33-37`
- Scenario: same class of bug as the Blocking finding above — even in the counterfactual
  world where the wipe bug is fixed and the file is actually built, `npm publish` would not
  ship it because `files` doesn't list it (only `workspace-watch-host.mjs` was added by this
  batch).
- Impact: `SqliteIntegrityService`'s worker spawn (`libs/backend/cli-engine/src/lib/thoth/cli-integrity-worker-factory.ts`)
  fails on every published CLI install that reaches an integrity check.
- Fix: add `"integrity-worker.mjs"` to `files` in the same edit that added
  `"workspace-watch-host.mjs"` — the batch touched this exact array and had the chance to
  close this pre-existing gap.

## Moderate and minor issues

- `WORKER_TARGET_SUFFIX` widened from `/-worker$/` to `/-(worker|host)$/` in both ESM-gate
  copies (`apps/ptah-electron/src/config/esm-bundle-gate.spec.ts:307`,
  `apps/ptah-cli/src/test-utils/esm-bundle-gate.spec.ts`) is safe today (no other discovered
  esbuild target ends in `-host`), but is a structural, non-allowlisted rule — a future
  ESM esbuild target legitimately named `*-host` without a bare-run guard would be silently
  swept into the anti-vacuity self-test. Low current risk; worth a one-line comment noting
  the assumption so the next author checks it.
- `apps/ptah-tui/tsconfig.app.json:16-19` excludes `src/build-artifact-gate.ts`, matching the
  pattern already used by `ptah-electron`/`ptah-extension-vscode`'s copies — but none of the
  four apps' `tsconfig.spec.json` `include` globs (`*.spec.ts`/`*.test.ts`/`*.d.ts`) match
  these plain-named gate helper files either, so they are typechecked by neither the app nor
  the spec project config, in any of the four apps. Pre-existing, not introduced by this
  batch, but this batch had the chance to close the gap for the 4th app and chose parity
  with the existing (blind-spot) pattern instead.
- `findPackedParcelWatcher`'s recursive walk (`apps/ptah-electron/scripts/verify-packed-native.js:123-142`)
  has no de-dup/uniqueness assertion if more than one `@parcel/watcher` copy ends up packed
  — mirrors an existing gap in the better-sqlite3 walk, not a new one.

## Data flow

1. `npm ci` at repo root resolves `@parcel/watcher@2.5.6` as a direct dependency (root +
   `apps/ptah-electron` + `apps/ptah-cli` `package.json`) — OK, confirmed by lockfile diff;
   `optional: true` correctly dropped only for `@parcel/watcher` itself and its regular
   dependency `node-addon-api`, while per-platform prebuild packages
   (`@parcel/watcher-<os>-<arch>`) are untouched and remain optional — OK.
2. `nx build-main ptah-electron` / `nx build-esbuild ptah-cli` externalize `@parcel/watcher`
   (added to both externals lists) so it stays a real `node_modules` package rather than
   getting bundled — OK, and the in-process fallback
   (`libs/backend/platform-electron/src/workspace-watch/parcel-watcher-engine.ts:28`)
   resolves it the same way `require()` resolves any external in the packed app, which
   Batch 1 already proved end-to-end (`b1-spike-report.md`) — OK.
3. `nx build-workspace-watch-host` (both apps) bundles the new host entry, external
   `@parcel/watcher`, ESM with a `createRequire` banner — OK for Electron (scoped outputs);
   **gap** for CLI (unscoped outputs, see Blocking #2).
4. `nx package ptah-electron` → `prune-dist-deps`/`validate-deps` → electron-builder →
   `asarUnpack` for `@parcel/watcher`, its per-platform prebuild, and its four runtime
   siblings (`picomatch`, `is-glob`, `is-extglob`, `detect-libc`) — OK, matches the Batch 1
   spike's corrected list exactly.
5. `verify-packed-native.js` requires + subscribes the packed watcher from
   `app.asar.unpacked` — OK for the failure modes it checks (missing sibling, missing
   binary); **gap** on hang risk (Serious #1).
6. CLI: `restore-cli-manifest`'s `dependsOn` graph is _correct_
   (`build-embedder-worker`→`build-integrity-worker`→`build-workspace-watch-host`→
   `ptah-tui:build`, then the manifest copy) — but **no workflow actually calls it before
   publish** (Blocking #1); `cli-e2e.yml` does call it, so CI _tests_ against the full
   bundle set while `publish-cli.yml` _ships_ a different, incomplete set — a real
   test/production divergence.
7. Published tarball reaches the end user; `CliWorkspaceWatcher` degrades silently on the
   missing bundle — OK as a _designed_ fallback for a missing artifact, but the artifact's
   absence in production is the actual bug (Failure modes, #1).

## Requirements fulfilment

| Requirement                                                            | Status   | Gap                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 10.1 Electron build target in all four lists                      | COMPLETE | `build.dependsOn`, `build-dev`, `serve:watch`, `test.dependsOn`, ESM gate all updated — verified in diff.                                                                                                                                 |
| Task 10.2 dependency/asarUnpack/packed-load gate                       | COMPLETE | Matches `b1-spike-report.md` exactly; `verify-packed-native.js` fails loud — minus the timeout gap (Serious).                                                                                                                             |
| Task 10.3 validate-deps/prune gate confirmation                        | PARTIAL  | Static config is right; the executor's own note (D3 "not reproduced in isolation") means this task's stated rationale doesn't hold, though the ordering precaution is harmless.                                                           |
| Task 10.4 CLI host bundle                                              | PARTIAL  | Target exists and is wired into `restore-cli-manifest`/`test` — but the publish pipeline that ships the artifact bypasses that wiring entirely (Blocking #1), and the new target repeats the whole-directory-output hazard (Blocking #2). |
| Task 10.5 cross-platform CI smoke (D10)                                | PARTIAL  | Existing per-OS step relabeled; no new arch leg added — darwin-x64/win-arm64 still unproven (Serious).                                                                                                                                    |
| "Done when: A2 is gated permanently; the ESM gate discovers 6 targets" | PARTIAL  | A2 (Electron) is gated permanently — true. The CLI side's equivalent gate does not exist for publish; ESM discovery count is presumably correct (not independently re-run here per the read-only/no-build constraint).                    |

Implicit requirements not addressed: a CI-enforced (not manual-spike) proof that the
_published_ CLI tarball actually contains and can load the watch host bundle; a single
build-sequence contract shared by `publish-cli.yml`/`cli-e2e.yml`/local dev instead of three
independently-hand-rolled sequences.

## Edge cases

| Case                                                         | Handled | How                                                                                | Concern                                              |
| ------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Electron packed app missing `@parcel/watcher`'s siblings     | YES     | `verify-packed-native.js` require-fails loud                                       | None                                                 |
| Electron packed app whose watcher loads but never subscribes | NO      | Bare `await`, no timeout                                                           | CI hang instead of fail (Serious)                    |
| CLI dev run (`tsx`) before any build exists                  | YES     | `CliWorkspaceWatchHostProcess` throws → supervisor degrades gracefully, documented | None — by design                                     |
| CLI _published_ package missing the watch host bundle        | NO      | Same degrade path as above, but for a production install                           | Silent feature loss for every user (Blocking #1)     |
| Nx cache hit replaying a whole-directory CLI output target   | NO      | Nothing — `--skip-nx-cache` was a local, uncommitted workaround                    | Silent incomplete `dist/apps/ptah-cli` (Blocking #2) |
| macOS build on non-default architecture                      | NO      | No `arch:` override, single runner leg                                             | darwin-x64 unproven (Serious)                        |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the CLI publish workflow (unmodified by this batch but directly gated by it)
  ships `@hive-academy/ptah-cli` without the watch host bundle it exists to add, and the
  batch's own new CLI target perpetuates the cache-replay hazard that causes it, while the
  identical, correctly-scoped fix pattern sits one file away in the Electron half of the same
  diff.
- What a robust implementation would add: (1) route `publish-cli.yml` through
  `nx run ptah-cli:restore-cli-manifest` instead of a hand-rolled sequence, and check all
  four generated bundles in "Verify dist contents"; (2) scope every CLI esbuild worker/host
  target's `outputs` to its own file, matching the Electron pattern already in this diff;
  (3) a timeout around the packed-watcher subscribe/unsubscribe smoke; (4) an explicit
  multi-arch macOS (and ideally Windows-arm64) leg, or an honest downgrade of the D10
  done-condition in `batches.md`; (5) add `integrity-worker.mjs` to the CLI `files` array
  while the array is already being edited for this exact reason.

---

## Delta review (review fixes)

Re-read every changed file in the current uncommitted diff (Batch 10 files only; the
`libs/backend/persistence-sqlite` changes are a separate commit and out of scope here, per
instruction). No `nx` command was run; findings are static, cross-checked against
`D:\projects\ptah-437-backup\b10fix-*.log` where those logs exist and against Nx's documented
cache-hit behaviour (a cache hit restores only a target's declared `outputs`, it never
re-invokes the executor — this is the load-bearing assumption behind items (a) and (b) below;
it was not independently re-proven by running Nx in this session, consistent with the
read-only constraint).

### a. `apps/ptah-cli/project.json` / `apps/ptah-tui/project.json` — outputs scoped per file

Confirmed by diff: `build-esbuild` outputs now list `main.mjs`, `main.mjs.map`,
`package.json`, `README.md`, `LICENSE.md`, `docs` (:12-19); `build-embedder-worker` →
`embedder-worker.mjs` (:141); `build-integrity-worker` → `integrity-worker.mjs` (:165);
`build-workspace-watch-host` → `workspace-watch-host.mjs` (:192-201, new target, now matches
the scoped shape `apps/ptah-electron/project.json`'s copy already used); `ptah-tui/project.json:10`
→ `tui.mjs`. `wasm/` is unaffected — it was always a separate target's (`copy-wasm`) own
scoped output, not part of `build-esbuild`'s declared outputs, so nothing needed to change
there; the dry-run's wasm files come from `copy-wasm`, whose own `outputs` (`{workspaceRoot}/dist/apps/ptah-cli/wasm`)
were never part of this bug.

`build-esbuild` keeping `deleteOutputPath: true` is safe under the fix, for a reason worth
being explicit about since scoping `outputs` alone does not, by itself, stop the executor's
own runtime `rimraf` of `outputPath`: **`deleteOutputPath` only runs when the executor
actually executes**, i.e. on a cache MISS. On a cache HIT, Nx restores the target's declared
`outputs` from the cache and never invokes the esbuild executor at all, so `deleteOutputPath`
never fires. The remaining question is whether a _real_ `build-esbuild` execution can ever
happen after a sibling has already written its file in the same directory, within one graph.
It cannot, because every downstream target (`build-embedder-worker`, `build-integrity-worker`,
`build-workspace-watch-host`, and — transitively, via `ptah-cli:build` — `ptah-tui:build`) has
`dependsOn: ["build"]` / `dependsOn: [{"projects":["ptah-cli"],"target":"build"}]`, and `build`
depends on `build-esbuild` + `copy-wasm`. Nx's task graph strictly orders `build-esbuild`
before any of these, cache hit or miss, within a single invocation, so by the time any sibling
writes its file, `build-esbuild` has already finished (real run or cache restore) and will not
run again in that same graph. Combined with the now-scoped `outputs`, a cache-hit replay of
`build-esbuild` in a _later, separate_ `nx` invocation (e.g. the "Build" step after the "Test"
step already built everything, both in `publish-cli.yml`) restores only its own six paths and
does not touch the sibling files. `ci.yml`'s `npx nx affected -t build` (`.github/workflows/ci.yml:174`)
runs `ptah-cli:build` (the noop aggregating `build-esbuild`+`copy-wasm` only) after the same
job's `nx affected -t test --coverage` step, which would already have built the workers via
`test`'s `dependsOn`; by the same cache-hit-skips-the-executor reasoning, `build-esbuild` is a
cache hit there too and does not wipe anything. This fix is correct given standard Nx caching
semantics; it was not re-verified by an actual `nx` run in this pass, so treat "cache hit
never re-invokes the executor" as the one load-bearing assumption behind this being closed.
**Assessed: RESOLVED**, on that assumption, which the reported test evidence (identical
16-file tarball from a clean build and from a cache replay) is consistent with.

### b. `publish-cli.yml` build step

Confirmed by diff (`:128-135`ish smoke job, `:330-352` publish job): both the disabled smoke
job and the publish job now run a single `npx nx run ptah-cli:restore-cli-manifest` step in
place of the old `nx build ptah-cli` + `nx build ptah-tui` + manual `package.json` copy.
`restore-cli-manifest`'s own `dependsOn` (`apps/ptah-cli/project.json:220-235`) is
`build-embedder-worker → build-integrity-worker → build-workspace-watch-host → {ptah-tui:build}`,
then the manifest-copy command — every one of those targets transitively depends on `build`
(→ `build-esbuild` + `copy-wasm`), so the full bundle set (`main.mjs`, `tui.mjs`,
`embedder-worker.mjs`, `integrity-worker.mjs`, `workspace-watch-host.mjs`, `wasm/`,
`package.json`) is produced in the mandatory order by one target. `cli-e2e.yml` already used
this same target and is unchanged, so CI test and publish now build through the identical
graph — the test/production divergence that caused the original Blocking #1 is closed. The
publish job's order (`Lint` → `Typecheck` → `Test` → `Content manifest is current` → `Build
(restore-cli-manifest)`) still runs tests/typecheck first; the "Test" step's own `test.dependsOn`
(`build-esbuild`, `build-embedder-worker`, `build-integrity-worker`, `build-workspace-watch-host`)
builds the same artifacts a second time from the "Build" step's point of view, but per (a)
above this is a cache hit the second time (same `apps/ptah-cli/package.json`, already
version-bumped before `Test` runs, so inputs match) and is not a duplicate real build, just a
duplicate cache lookup — cheap, not wrong. "Verify dist contents" now also checks
`embedder-worker.mjs`, `integrity-worker.mjs`, `workspace-watch-host.mjs` on top of the
pre-existing five. **Assessed: RESOLVED.**

### c. `apps/ptah-cli/src/test-utils/packaged-files.spec.ts`

New file, read in full. `REQUIRED_CLI_BUNDLES` (5 names) is cross-checked against
`package.json` `files`, against on-disk existence for the 4 locally-buildable bundles (via
`describeIfBuiltOrFail`, correctly gated on `main.mjs` rather than the directory — matches the
sibling `esm-bundle-gate.spec.ts` convention), and against `publish-cli.yml`'s text via
`expect(publishWorkflow).toContain(bundleName)`. On-disk checks run under `ptah-cli:test`'s
own `dependsOn`, which is a static project-graph declaration Nx honours identically whether
invoked as `nx test ptah-cli` or discovered via `nx affected -t test` — the coordinator's
"is dependsOn honoured there" concern does not hold; affected-selection only changes _which_
projects' targets enter the graph, never whether a selected project's own `dependsOn` graph is
respected.

The substring check is a real, confirmed weakness, exactly as flagged: `publishWorkflow` is
the _entire_ workflow file's text, not the `for f in ...` verify block specifically, and the
new "Build (restore-cli-manifest — main.mjs, tui.mjs, embedder-worker.mjs, integrity-worker.mjs,
workspace-watch-host.mjs, wasm, manifest)" step name added by fix (b) happens to restate every
one of the five bundle names near the top of the file. A future edit that dropped, say,
`workspace-watch-host.mjs` from the actual `for f in ...` line in "Verify dist contents" would
still pass this spec, because the name would still appear in that step's title a few lines
above. The check would only fail on a _wholesale_ removal of the name from the file (e.g. the
step and the loop both edited), not on the specific regression it documents itself as guarding
("a bundle silently dropped from the `for f in ...` line"). **Assessed: PARTIALLY RESOLVED** —
the anti-vacuity intent is right and meaningfully raises the bar over having no check at all,
but the substring scope should be narrowed to the text between the "Verify dist contents" step
header and the next `- name:` line, not the whole file, to actually pin the regression it
names. Minor, not blocking.

### d. `apps/ptah-cli/package.json` `files`

Confirmed: `integrity-worker.mjs` and `workspace-watch-host.mjs` both added (:33-38), closing
Serious #3 from the base review. **Assessed: RESOLVED.**

### f/g. `verify-packed-native.js` `withTimeout` + `findPackedFiles`

Confirmed by diff: `withTimeout(promise, ms, label)` (new) wraps both
`watcher.subscribe(tmpDir, noopListener)` and `handle.unsubscribe()` in a `Promise.race`
against a 30 s `setTimeout`, rejecting with a named error on timeout; the outer IIFE's
`.catch()` (unchanged, tail of file) calls `process.exit(1)` unconditionally on any thrown
error, including a `withTimeout` rejection. `process.exit()` terminates the process regardless
of any still-pending promise or native handle the timed-out `subscribe()` left alive — Node
does not wait for outstanding I/O or unresolved promises on an explicit `process.exit()` call
— so a genuinely hung native `subscribe()` now fails loud at 30 s instead of hanging to the
CI job's outer timeout. `findPackedAddons` was correctly generalised to `findPackedFiles(dir,
suffix, found)` and both the better-sqlite3 and `@parcel/watcher` call sites were migrated to
it (`:99-134` for the shared walk, call sites at `:154` and `:229`) — a legitimate
de-duplication, not a behaviour change. **Assessed: RESOLVED**, both the original Serious
finding (no timeout) and the coordinator's follow-on question (does a timeout leave a
process-exit hazard) are closed by the same `process.exit(1)`.

### h. `publish-electron.yml` darwin-x64 / windows-arm64 documentation

Confirmed against `apps/ptah-electron/electron-builder.yml:122-160` (`mac:`/`win:`/`linux:`
blocks carry no `arch:` key) and the workflow's `electron-builder` invocations
(`:310,342,590` — `--win`/`--mac`/`--linux` `build-args` only, no `--x64`/`--arm64`/
`--universal` anywhere in the file). The new comment block (`:141-159`) is accurate: with no
arch override, electron-builder defaults to the host runner's own architecture, so
`windows-latest` → win32-x64, `macos-latest` → darwin-arm64 (GitHub's `macos-latest` image is
Apple Silicon), `ubuntu-latest` → linux-x64, and darwin-x64 / windows-arm64 are not built or
published by this workflow at all — not "unproven", genuinely absent from the release. This is
a materially more honest statement than the base review's framing (which read the D10 gap as
"unproven" rather than "not shipped"), and it correctly scopes what `verify-packed-native.js`'s
now-renamed step actually proves per OS. It does not add arm64/x64 cross-building — that
remains a real product gap if darwin-x64 or windows-arm64 distribution is ever wanted — but as
a _review-finding fix_ (the finding was about an inaccurate/overstated claim in `batches.md`
and the step name, not "add the missing architectures"), this closes it. **Assessed:
RESOLVED** as a documentation/accuracy fix; the underlying distribution-coverage gap is a
legitimate future-enhancement item, not a defect in this batch's own claims anymore.

### Logic #1. Exact set-equality on discovered ESM targets

Confirmed in both `esm-bundle-gate.spec.ts` copies: a new
`it('discovers exactly EXPECTED_ESM_TARGETS -- no undeclared ESM esbuild target exists', ...)`
asserts `[...discoveredTargets.keys()].sort()` equals `[...EXPECTED_ESM_TARGETS].sort()`. This
directly closes the base review's Moderate forward-risk finding on the `-worker|-host` suffix
widening: a future ESM esbuild target (worker-shaped or not) can no longer be silently added
without a test failure forcing a conscious update to `EXPECTED_ESM_TARGETS` (and, by extension,
a conscious decision about whether it also needs a `WORKER_ENTRY_GUARDS` entry). **Assessed:
RESOLVED.**

### Delta summary

| Base finding                                                                                          | Status                                                                              |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Blocking #1 — CLI publish ships without `workspace-watch-host.mjs`                                    | RESOLVED (b, c)                                                                     |
| Blocking #2 — `build-workspace-watch-host` (CLI) unscoped outputs                                     | RESOLVED (a)                                                                        |
| Serious — `verify-packed-native.js` no timeout on subscribe/unsubscribe                               | RESOLVED (f/g)                                                                      |
| Serious — D10 cross-platform claim overstated                                                         | RESOLVED as a documentation fix (h)                                                 |
| Serious — `integrity-worker.mjs` missing from CLI `files`                                             | RESOLVED (d)                                                                        |
| Moderate — ESM gate suffix widening, no allowlist                                                     | RESOLVED (Logic #1)                                                                 |
| Moderate — `ptah-tui` tsconfig gate-helper typecheck blind spot                                       | NOT ADDRESSED (out of scope for this fix pass; still a 4-app-wide pre-existing gap) |
| New (this pass) — `packaged-files.spec.ts` substring check scoped to whole file, not the verify block | Minor, open                                                                         |

No new Blocking or Serious issue was introduced by this fix pass. The one new item
(`packaged-files.spec.ts`'s over-broad substring match) is Minor and does not block acceptance
— it weakens, but does not eliminate, the regression guard it exists for, and the primary
mechanism fix (routing `publish-cli.yml` through `restore-cli-manifest`, plus the scoped
`outputs`) no longer depends on that spec to be correct; the spec is a second, imperfect line
of defense on top of an already-fixed root cause.

## Delta verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Remaining risk: none blocking. The `packaged-files.spec.ts` substring check (item c) should
  be tightened to scope its match to the "Verify dist contents" step body specifically, and the
  `tsconfig.spec.json` gate-helper blind spot (base review Moderate, all four apps) remains
  open as a follow-up, not a defect in this fix pass.
