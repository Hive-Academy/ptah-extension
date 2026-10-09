# Batch 8 report: Freeze verification, candidate-row diff, session sampler

Executor: backend-developer sub-agent. Worktree
`D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`. Nothing was committed.
Batch 9 needed Batch 8's guard and snapshot reader, so Batch 8 was built alongside Batch 9.

Status: implemented and verified; the local dry run passed.

## Tasks

### 8.1 Verify the existing candidate manifest: done

Files:

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\data\verify-candidate-manifest.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\data\verify-candidate-manifest.spec.ts`

- The tool parses the manifest on disk with zod (`{source, dirs, files, manifestSha256,
  files_sha256}`) and recomputes every file hash. It reports missing, extra and changed files, and
  checks the declared dirs/files counts against the copy.
- **Manifest hash formula, recovered and checked against the real file.** `manifestSha256` =
  sha256 of Python's `json.dumps(files_sha256, sort_keys=True)`, which uses `", "`/`": "`
  separators and escapes non-ASCII. `computeManifestSha256` reproduces this. A brute-force search
  over other encodings matched nothing else. The value is pinned to `73a184c5…45f3`.
- `assertSafeBenchDataDir(dir)` is exported here; it does not add a second bench-data helper (R5).
  - It refuses an empty or relative path, any path under `<home>/.ptah` (case-folded on Windows,
    realpath of the deepest existing ancestor), and any path inside the repository (the nearest
    `.git` ancestor of cwd).
  - Batch 9 uses it too. Batch 16 replaces it with 619's `resolveBenchDataDir()`.
- The task does not copy anything.

### 8.2 Candidate-dir vs `skill_candidates` row diff: done

Files:

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\data\candidate-row-diff.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\data\candidate-row-diff.spec.ts`

- `withReadonlySnapshot(path, read, expectedSha256)` (R12):
  - streams a sha256 of the snapshot before the read and refuses a hash that is not the frozen one;
  - opens the file with better-sqlite3 `{readonly: true, fileMustExist: true}`, loaded lazily the way
    the product loads it;
  - closes it in `finally`, hashes it again, and fails on any change or on a new
    `-wal`/`-shm`/`-journal` sidecar.
- `diffCandidateRows` is pure. It reports rows without a dir (by status), dirs without a row, dirs
  without a SKILL.md, and `body_path` mismatches.
- The full diff lists private slugs, so it is written only to
  `<benchData>\reports\candidate-row-diff.<name>.json`.
- The spec uses a temp SQLite file. It covers: hash unchanged, no sidecars, report only under the
  bench dir, a pinned-hash refusal, a mutation during the read, and a missing snapshot that is never
  created.

### 8.3 Held-out session sampler: done

Files:

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\data\sample-sessions.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\data\sample-sessions.spec.ts`

- Windows are in UTC with exclusive end bounds:
  - seed window: every line timestamp in 2026-09-06 to 2026-09-30;
  - eval window: every line timestamp in 2026-10-01 to 2026-10-06.
  - Sessions that cross a window boundary are classed `straddling` and are not sampled.
- Exclusions:
  - any `cwd` under `.claude-worktrees/task-619*`;
  - any `cwd` under a bench temp root (default `os.tmpdir()`);
  - size outside 200 KiB-5 MiB;
  - no timestamps.
  - `persistSession: false` harness sessions are never written to disk, so they cannot appear.
- Order: `sha256("TASK_2026_620:real" + filename)`, ascending; the first 20 are taken.
- Copies use `COPYFILE_EXCL`, and each copy's hash must equal its source hash. The copies and
  `manifest.json` (opaque id `RS-…`, file, bytes, sha256, time range, counts) are staged, then
  renamed to `<benchData>\sessions\gt-memory-real-v1\`.
- The source dir is only read. The tool refuses if the source dir and the bench dir contain each
  other, and refuses to replace an existing sample without `overwrite`.
- The spec asserts that source bytes and mtimes are unchanged and that every written path is inside
  the temp bench dir.

## Dry run (local, real data)

| Check | Result |
|---|---|
| 8.1 frozen copy | **2,745 files verified**, 2,745 dirs, manifest hash OK (`73a184c5…45f3`), no missing/extra/changed |
| 8.2 snapshot hash | **`82cd16ac…d575a` before and after**; independent `sha256sum` after all runs: `82cd16ac39b60699c241286eda2db59b25be70c6aa85480db0be8ae7b77d575a` |
| 8.2 diff | 2,587 rows, 2,745 dirs, 2,586 matched. 1 row without a dir (status `promoted`; its body moved to `.claude/skills`). **159 dirs with no row.** 0 empty dirs, 0 `body_path` mismatches. Report: `C:\Users\abdal\AppData\Local\ptah-mcp-bench\reports\candidate-row-diff.skill-candidates-20261006.json` |
| 8.3 sample (U4 input) | Source: 293 transcripts in `~/.claude/projects/D--projects-ptah-extension`. Seed window 191, eval window 42 eligible, straddling 3. Excluded: 56 for size, 1 for a 619 worktree `cwd`. **20 copied** to `C:\Users\abdal\AppData\Local\ptah-mcp-bench\sessions\gt-memory-real-v1\` (0.5-5.07 MB each) |

## Verification

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/data --maxWorkers=2`:
  3 suites, **22 tests passed**.
- `npx nx run-many -t typecheck,lint -p mcp-bench --skip-nx-cache`: succeeded.
- `npx nx run mcp-bench:test --maxWorkers=2`: 175/176 tests passed. The one failure is 619's
  `corpus.spec.ts`; it passes when re-run alone (git-worktree contention with the parallel lanes).
- `npx prettier --check --ignore-unknown tools/mcp-bench/src/memory-skills/data`: clean.
- `git status`: only the 6 source files under `memory-skills/data/`; no data file.

## Risks and notes

- **Live eval-window sessions.** The eval window ends on the freeze day, and the transcript dir is
  live. A session that was still running at copy time (2026-10-06/07) is copied as a partial
  snapshot. The copy hash is checked against the source hash, so a file that grows during the copy
  fails the run instead of producing a torn copy. U4 labellers should know that the last few
  sessions may be incomplete.
- **Reading `~/.claude/projects`.** That is where transcripts live, and it is not under `~/.ptah`. The
  path is an explicit argument, and the sampler opens it read-only.
- The 159 dirs with no row have no `skill_candidates` row in the snapshot. Rows deleted while the
  dirs stayed is a likely cause, but it is not verified. Batch 9 can still sample them: `random` and `fallback` need only a body; `judged-model`
  needs a row.

## Not done

Nothing.

## Phase-1 revise round 1

Review: `code-logic-review-phase1-inprocess.md` (REVISE: 2 major, 3 minor). All 5 findings are fixed.
Nothing was committed.

### Changed files

All under `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\`:

- `data\verify-candidate-manifest.ts` and `.spec.ts`
- `data\candidate-row-diff.ts`
- `data\sample-sessions.ts` and `.spec.ts`
- `labelling\select-rubric-sample.ts`
- `labelling\build-labelling-packet.ts` and `.spec.ts` (see the Batch 9 report)

### Fixes

- **Major 1: local guard removed.** `assertSafeBenchDataDir`, `BenchDataDirGuardOptions`,
  `canonicalPath`, `isWithin` and `findRepoRoot` are deleted.
  - All 5 entry points now call 619's `resolveBenchDataDir` from `tools/mcp-bench/src/bench-data.ts`:
    `verifyCandidateManifest`, `runCandidateRowDiff`, `sampleSessions`, `loadRubricSampleInputs` and
    `buildLabellingPacket`. The call is
    `resolveBenchDataDir({ ...benchDataRules, env: { PTAH_MCP_BENCH_DATA_DIR: benchDataDir } })`.
  - This uses the outermost `nx.json` as the repository root, so the main checkout is covered when
    running from a worktree. `benchDataRules` (`realHome`/`repoRoot`/`platform`) exists only for
    specs.
  - No junction workaround was added (619's known gap).
  - Side effect: an empty `benchDataDir` string now resolves to 619's default folder instead of
    throwing.
  - Specs cover refusal under `~/.ptah`, inside the repository, and for a relative path.
- **Major 2: partial transcripts.**
  - New exclusion `unparseable-lines`: a session with any line that does not parse is not sampled.
  - The manifest's `bytes`, `sha256`, `lines` and time range now all come from the same copied
    file. The copy is re-scanned and re-classified; a copy that no longer qualifies is deleted,
    listed in `rejectedAtCopy`, and replaced by the next pick.
  - A transcript can be partial without a broken line: this session's own transcript was still
    being written and sat in the sample. Two more rules cover that case:
    - new exclusion `modified-after-window`: the file mtime is at or after the eval window end
      (2026-10-07T00:00Z);
    - the sampler refuses to run while the eval window is open, unless `allowOpenWindow` is passed,
      and then marks the manifest `provisional: true`.
  - Specs cover all of these. Two of them, the copy-recheck rejection and the source-hash
    comparison, are untested; see below.
- **Minor 3: freeze check.** The copy walk now reports empty dirs at any depth (`emptyDirs`) and
  non-regular entries (`nonRegular`: links, junctions) as `problems`, instead of aborting. Empty
  top-level dirs count in `dirsOnDisk`. Specs cover an empty dir and a junction.
  `pythonJsonString` no longer contains a literal U+FFFF character.
- **Minor 4: task-619 regex.** It is now `task-619(?![0-9])`. The spec checks that `task-619` and
  `task-619-x` are excluded and that `task-6195-…` and `task-6190` are not.

### Real re-run (2026-10-06 22:17 UTC)

- 8.1: 2,745/2,745 files verified, manifest hash OK.
- 8.2: unchanged. Snapshot `82cd16ac…d575a` was the same before and after the read.
- 8.3: without `allowOpenWindow`, the sampler **refused**, because the window closes at 00:00Z. It
  was then run with `allowOpenWindow`, so the manifest is `provisional: true`.
  - Counts: 293 files; seed 191; eval 42 eligible; straddling 3. Excluded: 54 for size, **2 for
    unparseable lines**, 1 for a 619 `cwd`. 0 rejected at copy.
  - The 2 unparseable files were previously counted under size, so the 42 eligible sessions and
    the 20 picks are unchanged.
  - **Action for the orchestrator: re-run 8.3 with `overwrite` after 2026-10-07T00:00Z before U4
    labels.** One sampled session (this orchestration session's own transcript, which is growing)
    will then drop out as `modified-after-window`, and the next pick will replace it.

### Verification

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/data tools/mcp-bench/src/memory-skills/labelling --runInBand`:
  5 suites, **53/53 passed**.
- `npx eslint <changed files>`: **0 errors**, 1 warning. `select-rubric-sample.ts` has 706 counted
  lines against a 700 limit; the committed version was already over the limit.
- `npx prettier --check --ignore-unknown <changed files>`: clean.
- `npx nx run-many -t typecheck -p mcp-bench`: **fails, on other lanes' files only**
  (`memory-skills-suite-kinds.spec.ts`, `projection.spec.ts`, `runner/net-recorder.ts`; 4 errors).
  `tsc` reports 0 errors under `memory-skills/data` and `memory-skills/labelling`.

### Not covered

- The `rejectedAtCopy` path (a source that changes between the scan and the copy) has no spec,
  because the sampler has no hook between those two steps.
- The source-vs-copy hash comparison was removed, because the copy is re-validated instead.
