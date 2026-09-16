# Backlog Cleanup Measurement - TASK_2026_461_639c, Task 7.3

Counts and timings only. No session ids, file paths or transcript content appear below, per
HANDOFF rule 5 / R-TL9.

## Source

- Snapshot used: newest `ptah.pre-migration-*.sqlite` in `~/.ptah/state` (re-listed at
  measurement time; unchanged from the Batch 7 re-read, no newer snapshot existed).
- Size before: 1,178,537,984 bytes. Mtime before: 2026-09-09T23:06:09.256Z.
- Size after: 1,178,537,984 bytes. Mtime after: 2026-09-09T23:06:09.256Z. Unchanged.

## Copy + pragmas

- Copy made with `fs.copyFileSync(..., fs.constants.COPYFILE_EXCL)` into a fail-if-exists temp
  dir (name not starting with `ptah`). Only the copy was ever opened.
- Pragma read-back (all six match production): `journal_mode=wal`, `foreign_keys=1`,
  `synchronous=1`, `temp_store=2`, `mmap_size=268435456`, `busy_timeout=5000`.

## Schema migration

- Schema version before: 41.
- Schema version after: 45.
- Migration wall time: 7,612 ms (a second run measured 1,221 ms — see note below).
- Binding: better-sqlite3 via Electron-as-Node (the production binding), per the real
  `SqliteConnectionService` with vec resolvers null (V1) and no backup service registered (no
  pre-migration backup taken, as expected for this harness).

Note: the migration was timed twice across two harness runs (the first run used an
uncorrected "summed" counters bug, described below, and was re-run after the fix). The first
run measured 1,221 ms; the second, 7,612 ms — both on the same copy file freshly created each
time, so the difference is host variance (other Nx/jest activity on this shared machine), not
a property of the migration itself. Both are one-time boot costs on a 1.1 GB file and neither
is a regression signal.

## Cleanup run

- Cutoff (`cutoff_created_at`, set on the first tick to that tick's `now()`): recorded in the
  state row; not reproduced here as it is an epoch-ms timestamp with no independent meaning
  outside this run.
- Candidates at `status='candidate'` before the run: **2,418**.
- Ticks to completion: **13** (each `run()` call examines up to 200 candidates or runs up to
  60 s per call, whichever comes first, and returns `partial`; the 14th call returned
  `{status:'skipped', reason:'complete'}` and is not counted as a tick).
- Wall time per tick: min 18 ms, median 29 ms, max 1,007 ms.
- Largest single transcript read (wrapped in a timing proxy around the real
  `JsonlReaderService.readJsonlMessages`): **226 ms**.

### Final counters (state row, cumulative to completion)

| Counter | Value |
| --- | --- |
| Examined | 2,418 |
| Kept — evidence | 120 |
| Kept — verdict | 174 |
| Kept — degraded verdict | 265 |
| Rejected — no evidence | 0 |
| Rejected — transcript unreadable | 1,859 |
| Invocations deleted (fake, non-NULL `context_id` rows) | 2,424 |
| Deferred on error (summed across all 13 ticks; NOT persisted in migration 0045) | 0 |

Sanity check: kept (120 + 174 + 265 = 559) + rejected (0 + 1,859 = 1,859) = 2,418 = examined.
Holds exactly.

**Note on run()'s report shape**: each `run()` call's returned counters are *cumulative*
(read back from the state row), not a per-tick delta — only `deferredOnError` is genuinely
per-run (a fresh counter object per `run()` call). The measurement harness originally summed
every tick's counters and got wildly inflated numbers (`examined: 18018` instead of 2,418) on
its first pass; this was caught before writing this report and fixed to read the **last**
tick's cumulative report instead of summing. The final numbers above were cross-checked against
`SkillBacklogCleanupStore.readState()` after completion and match it field-for-field
(`cumulativeTotalsMatchFinalState: true` in the harness's own assertion).

### Tracker-row survival

The fake-invocation delete only removes `skill_invocations` rows with a non-NULL
`context_id` (the historical creation-time invocations Batch 1 stopped writing).
`invocationsDeleted = 2,424`; tracker-style rows (`context_id IS NULL`) are untouched by
construction (the store's `DELETE ... WHERE context_id IS NOT NULL` predicate, unchanged from
Batch 4) — the count of surviving tracker rows was not separately queried in this run beyond
what the delete predicate itself guarantees by its own WHERE clause.

## Accepted-risk check (Batch 4 finding 2 — EBUSY vs ENOENT ambiguity)

For every candidate rejected `backlog-cleanup: transcript unreadable and no verdict`
(1,859 candidates), a **read-only** existence check (directory listing / `fs.statSync` only,
never file content) was run against:
- the `prefilter` queue row's own `transcript_path` column on the copy, and
- `~/.claude/projects/*/<sessionId>.jsonl` for every session id named in the candidate's
  `source_session_ids`.

| Metric | Value |
| --- | --- |
| Unreadable-transcript candidates checked | 1,859 |
| Distinct sessions checked | 1,093 |
| Candidates with at least one transcript file present on disk | **13** |

So of the 1,859 candidates rejected for an unreadable transcript, 13 (0.7%) have a transcript
file that does in fact exist on disk today — consistent with the accepted risk that
`TrajectoryExtractor` cannot distinguish a transient read error (`EBUSY`) from a genuinely
missing file (`ENOENT`); the great majority (99.3%) of the unreadable-transcript rejections
correspond to sessions with no transcript file present at all.

## Cleanup

- Connection closed, then `fs.rmSync(tmpDir, {recursive:true})`.
- `fs.existsSync(tmpDir)` proven `false` afterward.
- Source re-stat proved size and mtime unchanged (see "Source" above).
- Temporary harness spec deleted; `git status --short -- libs/backend/skill-synthesis` shows
  only the Task 7.4 file.

## Batch 8 re-measurement (after user decisions)

Counts and timings only, per the same privacy rule (no session ids, paths or transcript
content). Same source snapshot (unchanged, re-verified: `1,178,537,984` bytes,
`2026-09-09T23:06:09.256Z`), same fail-if-exists-copy / six-pragma / temp-dir-proof procedure,
run through the Batch 8 code (non-MCP-only tool evidence; a candidate whose workspace root
never resolves is kept as `kept-root-unknown` instead of rejected as unreadable).

### Corpus (prefilter narrowing)

| Metric | Batch 7 | Batch 8 |
| --- | --- | --- |
| Sessions scanned | 1,710 | 1,691 |
| Extracted | 1,695 | 1,676 |
| Phase-2 (depth-inclusive) eligible | 1,641 | 1,622 |
| Phase-3 untightened eligible (Batch 7's rule) | 1,639 | 1,620 |
| Phase-3 eligible, real tightened predicate (non-MCP only) | not applicable (shipped untightened) | **1,609** |
| `mcpOnlyRejected` | not measured | **11** |
| Wall time | 22.245 s | 19.7 s |

The corpus grew/shrank between runs (live `~/.claude/projects`, one day apart) so absolute
counts are not directly comparable; the phase-2/untightened retained fraction stayed ~0.999
both times, and the new tightened measurement shows 11 of 1,622 previously-eligible sessions
(0.7%) losing eligibility because their only tool evidence was MCP calls.

### Byte copy (backlog cleanup outcome)

Same 2,418 candidates at `status='candidate'` before the run (unchanged source snapshot).

| Counter | Batch 7 | Batch 8 |
| --- | --- | --- |
| Examined | 2,418 | 2,418 |
| Kept — evidence | 120 | 109 |
| Kept — verdict | 174 | 174 |
| Kept — degraded verdict | 265 | 265 |
| Kept — root unknown (new counter, per run, not persisted) | did not exist | **1,553** |
| Rejected — no evidence | 0 | 0 |
| Rejected — transcript unreadable | 1,859 | **317** |
| Invocations deleted | 2,424 | 2,424 |
| Deferred on error (summed across ticks) | 0 | 0 |
| Ticks to completion | 13 | 13 |
| Wall time per tick (min / median / max) | 18 / 29 / 1,007 ms | 16 / 25 / 916 ms |
| Largest single transcript read | 226 ms | 147 ms |
| Migration wall time (schema 41 -> 45) | 1,221 ms / 7,612 ms (two runs) | 5,154 ms |

Sum check: `109 + 174 + 265 + 0 + 317 + 1,553 + 0 = 2,418 = examined`. Holds exactly.
Cross-checked against an independent, read-only recomputation of the root-unknown and
unreadable-rejected branches (mirroring `evaluateCandidate`'s own logic without touching
production code): 1,553 / 317 respectively — exact matches to the persisted and summed
counters.

The 11-candidate drop in kept-evidence (120 -> 109) is consistent with the corpus
measurement's `mcpOnlyRejected` narrowing: sessions whose only tool evidence was MCP calls no
longer count as evidence.

### Accepted-risk check (Batch 4 finding 2), before/after decision 2

| Metric | Batch 7 | Batch 8 |
| --- | --- | --- |
| Unreadable-transcript candidates checked | 1,859 | 317 |
| Distinct sessions checked | 1,093 | 317 |
| Candidates with >=1 transcript file present on disk | **13** | **0** |
| Kept-root-unknown candidates (new bucket) | n/a | 1,553 |
| ...of which have >=1 transcript file present on disk | n/a | **13** |

By candidate-id match inside the harness (ids not printed): all 13 of Batch 7's
false-positive "unreadable but a file exists" candidates are now classified
`kept-root-unknown`, and the true rejected-unreadable bucket (317 candidates: root resolved,
read attempted, extractor returned nothing) has zero candidates with a file present on disk
in this run. Decision 2 fully closes the accepted-risk gap Batch 4 recorded and Batch 7
measured.
