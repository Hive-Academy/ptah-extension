# Code Logic Review, Phase F part 1 (batches 67, 70, 71) - TASK_2026_662

Review family: Claude (reviewer) vs codex (implementer); batch 71 and two small corrections by the orchestrator (Claude) - same-family for those, weaker evidence.

Scope: uncommitted working tree vs HEAD of `.claude-worktrees/skill-synthesis-purge`. Read in full: `skill-pipeline-archive.ts`, the diffs of `db-path.ts`, `migration-runner.ts` (ensureArchive and the apply loop), `sqlite-connection.service.ts`, `candidate-row-diff.ts`, `user-layer-fs-ops.ts`, `user-layer-mirror.service.ts` (retire path and its three re-mirror guards), the prompt-suggestions diff, and migrations 0003/0004/0007. No nx/jest/tsc was run, as instructed, so every statement is from source reading. No test was executed.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | REVISE (one cheap fix before batch 68) |
| Blocking | 0 |
| Serious | 1 |
| Moderate | 3 |
| Minor | 5 |

The archive is the only copy once 0057 runs. One Serious finding is on the vec0 table: the row id is not exported.

## Findings

### Serious

**S1. `skill_candidates_vec` is archived without its rowid, so vectors cannot be re-linked to candidates.**
- File: `skill-pipeline-archive.ts:80` (`SELECT * FROM "skill_candidates_vec"`), table shape in `migrations/0007_fix_vec0_rowid.ts:13-15`.
- Scenario: 0007 recreated the table as `vec0(embedding FLOAT[384])`. The rowid is implicit and is not a declared column, so `SELECT *` on a vec0 table returns only `embedding`. The key that `skill_candidates.embedding_rowid` (`0003_skills.ts:18`) points to is not written. The archived `skill_candidates` rows keep `embedding_rowid`, but the vector file has no id column, so the association survives only by row order. That is unspecified for a virtual table. The embedding BLOB (Uint8Array, 1536 bytes) does round-trip through the `$base64` envelope.
- Impact: this is the only copy of the vectors. They are derived and regenerable (the 0007 comment says so), but the archive's purpose is restoring or auditing. The spec only covers the "vec table absent" case (`skill-pipeline-archive.spec.ts:66`), so this path has no test. I have not run sqlite-vec, so this rests on vec0 semantics; confidence is high.
- Fix: for `skill_candidates_vec` use `SELECT rowid AS rowid, * FROM skill_candidates_vec`. Add one vec-loaded test, or document the rowid loss and drop the vec table from the "complete archive" claim.

### Moderate

**M1. Pruning a directory with no `receipt.json` can delete another process's in-flight archive.** `skill-pipeline-archive.ts:123-130`. Two hosts (Electron plus CLI, or two windows) starting on the same DB: process B finishes, scans, and `rmSync`s A's dir because A has not written its receipt yet. On POSIX A then fails at `wx` receipt write or `inspectFile` and throws. That is fail-closed (migration refused, retried next boot) but is a spurious startup failure. On Windows the `rmSync` of open files fails and is swallowed by the non-fatal catch, which aborts all further maintenance for that run. The data is never lost. Mitigation: skip receipt-less dirs younger than N minutes (mtime), and/or hold a lock file.

**M2. The listing exclusion is stateful and set only inside `retireManagedSkills()`.** `user-layer-fs-ops.ts:38-45,286-290`, `user-layer-mirror.service.ts:578`. The orphan reaper (`user-layer-orphan-reaper.ts:175`) is the only other reader of `<userLayer>/skills`. `reapDeletedUpstream()` is public ("exposed on its own", mirror :665) and does not call retire first. A caller using it alone sees preserved user copies as orphan candidates. `reconcileAll` is safe because it retires first. The map is also keyed by a resolved root string. Fix: apply the exclusion in the constructor or the reaper args instead of via call order.

**M3. `:memory:` or bare-name DB paths put the archive in the process cwd.** `db-path.ts:68-70` uses `path.dirname(dbPath)`; `:memory:` gives `.`, so `./backups/skill-pipeline`. `resolvePtahDbPath` resolves overrides to absolute, so real hosts are fine. Only tests and direct construction with `:memory:` are affected (`sqlite-connection.service.ts:562` explicitly supports `:memory:`). Guard: for `:memory:` use `os.tmpdir()`, or skip.

### Minor

- m1. bigint is exported as a decimal string and the decoder (`skill-pipeline-archive.ts:176-181`) does not restore it, so consumers get a string. If the driver is not in safe-integer mode, integers above 2^53 are already rounded by the driver before the archive sees them. Timestamps are far below that.
- m2. The cross-table snapshot is not transactional (separate SELECTs); rows written by another connection between tables can be inconsistent. Per-table integrity holds. Wrapping the export in a read transaction would fix it.
- m3. Preserved-copy notice is logged at info on every reconcile (`user-layer-mirror.service.ts:~607`); log noise for each activation, forever.
- m4. The session-store runner (`session-store-database.ts:63`) builds a runner without `archiveRoot`; it falls back to the home default. Harmless: `SESSION_STORE_MIGRATIONS` does not include 57.
- m5. REAL/TEXT edge: `Infinity` becomes `null` in JSON, and invalid UTF-8 text is replaced by the driver before export. Practically unreachable for these tables.

## Answers to the five review questions

### 1. Can the archive lose or corrupt data?

- TEXT: pass-through. A TEXT value shaped like `{"$base64":...}` is a JSON string, not an object, so it cannot collide with the envelope (`isBase64Envelope` requires an object with exactly one key, :183-187).
- INTEGER: numbers pass through; bigint becomes a string (m1).
- REAL: pass through. NULL: pass through.
- BLOB: `Uint8Array` becomes `{$base64}` (:89), decoded back to Buffer (:179). This covers the better-sqlite3 Buffer case.
- vec0: **only `embedding`, no rowid** (S1).
- `scheduled_jobs` key: `id TEXT PRIMARY KEY` (`0004_cron.ts:4`). The filter `WHERE id IN (?,?,?,?)` (:79) is correct. `job_runs.job_id` references `scheduled_jobs(id) ON DELETE CASCADE`. The archive writes `job_runs` and `scheduled_jobs` before the drop. Row order is irrelevant for restore except that `job_runs` rows need their parent rows, which are present in the same archive.
- Verification (:190-211, :213-234): sha256 over the whole file, newline-count equals `rows`, and the file must end with a newline. This detects truncation, appended bytes and edited content. The receipt itself is unauthenticated, so someone who edits both receipt and file is not detected; that is out of scope for a local backup. `archivePath` must equal the receipt's own dir.
- Reuse rule (:145-160): the older archive passed a full `verifySkillPipelineArchive` in the same call (:134), so it cannot return a receipt with missing or partial files. It requires identical `present/rows/sha256` on all nine tables, in the same fixed table order enforced by `verify`. If deleting the new copy fails, the older receipt is still returned (orchestrator correction O49a is sound).
- Prune (:123-131): only direct `pre-0057-*` real directories (lstat, symlinks skipped) with **no** `receipt.json` (ENOENT only). A complete archive always has a receipt, so a complete one is never pruned. Invalid, format-1 or unreadable receipts are kept. The only hazard is the concurrent in-flight case (M1).
- Permissions: `mkdirSync(..., {mode:0o700})` plus `chmodSync` on root and archive dir (:59-62), files `0o600` (:73,110). On Windows the POSIX modes are not enforced; the doc comment (:50-53) says archives inherit the per-user ACL. Documented, acceptable.

### 2. Does the migration runner still refuse the destructive step?

Yes. `ensureArchiveOnce()` runs before any migration with version >= 57 is applied (`migration-runner.ts:115-142`) and also before the pending-vec catch-up (:147-155). `archiveSkillPipeline` throws on mkdir, write, verify and the vec-without-extension preflight (:350-354). Only the post-verification maintenance is inside the non-fatal try/catch (:117-163), and that block runs after `verifySkillPipelineArchive(receiptPath)` at :111, which is outside the try. So a failed or unverifiable archive aborts. `archiveRoot` reaches the runner from the single place that constructs it for the main DB (`sqlite-connection.service.ts:232-235`, `skillPipelineArchiveRoot(this._dbPath)`). All three hosts use `SqliteConnectionService`, so Electron, CLI and VS Code are covered. `PTAH_DB_PATH` gives an absolute override (`db-path.ts:55-57`) and the archive follows it to `<dir>/backups/skill-pipeline`. `BackupService` uses the same `backups/` dir only for `.sqlite` prefixed files, so rotation does not touch the `skill-pipeline` subdirectory. See M3 for `:memory:`.

### 3. Batch 70

- Outside `<userLayer>/skills/<slug>`: no. `cloneDir = join(skillsRoot, <const slug>)` (:~597), `assertUnderUserLayer` (:~598), and `lstat` rejects symlinked root, clone dir and sidecar (:~585, ~600, ~609).
- Symlink following: `rm -recursive` (`user-layer-fs-ops.ts:181`) does not follow symlinks inside. The directory itself is `lstat`-checked.
- User-modified: removal needs a valid sidecar with `kind==='skill'`, `slug===slug`, a non-empty `sourceHash`, and `computeSourceHash(cloneDir) === sidecar.sourceHash` (:~617). Any edit, added file or deleted file changes the hash, and the copy is preserved. Sidecar-less and invalid sidecar copies are preserved (conservative).
- History snapshot comes before `removePath` (:~622); a snapshot failure throws into the catch, counts an error, and nothing is removed.
- Idempotent: ENOENT is silently skipped, and the second run returns empty (spec :160). Non-fatal: all errors are caught per slug, counted in `errors`, and a startup reconcile continues. Runs under the per-slug lock.
- Re-seeding: the three mirror/reconcile source loops skip the retired slugs (:1418, :1473, :1898), so a surviving `~/.ptah/skills/<slug>` source does not re-create the clones. Only the listing exclusion is stateful (M2).

### 4. Batch 71

Both skill folders are deleted; the repo `.claude/skills` has no live reference. A grep (excluding node_modules, dist, the 662 task folder) finds the slugs only in historical specs (`.ptah/specs/TASK_2026_471_*`, `_578_*`, `_620_*`), which are history and cannot break. The `prompt-suggestions.component.ts` entry is removed cleanly; the neighbouring entry's trailing structure is intact. Not verified: `tools/mcp-bench/fixtures/memory-skills/skill-docs.v1.json`, `baseline/gate-baseline.json` and the rubric/labelling files match `.claude/skills` paths and mention "26 positives / 2 promoted-synthesized" in `TASK_2026_620_a13e/benchmark-design.md:50`. They are frozen fixtures and gate-baseline numbers; I did not open them for counts of live skill directories. The orchestrator's mcp-bench gate should confirm no test reads the live `.claude/skills` directory count. This is the only residual risk for batch 71 and I rate it low.

### 5. Does anything block batch 68 (0057)?

Nothing hard-blocks it. S1 should be fixed first because 0057 destroys the vec table with no other copy. M1 is a startup-race annoyance, not a blocker. Batch 68 should keep `FIRST_DESTRUCTIVE_SKILL_PIPELINE_VERSION = 57` and the `ensureArchiveOnce()` call in place.

## Failure modes

| Name | Trigger | Handling |
| --- | --- | --- |
| Vec rowid loss | any DB with vec rows, S1 | Not handled; fix before 68 |
| Concurrent archive prune | two hosts boot together, M1 | Fails closed, retried next boot |
| Maintenance I/O error | disk or permissions during scan | Caught; new archive returned with `maintenanceError` |
| Archive write error | disk full | Throws; migration refused |
| Reuse delete failure | locked files | Older verified receipt returned |

## Verdict

- Recommendation: REVISE (fix S1, then proceed to batch 68; M1-M3 can be follow-ups)
- Score: 7/10. Threshold evidence: the refusal path, key column, verification, reuse and prune safety are sound (above 6); the single data-completeness hole on the vec table, in an only-copy backup, keeps it below 8.
- Confidence: MEDIUM-HIGH (no tests executed; vec0 `SELECT *` semantics from knowledge, not run).
- Top risk: vec0 rowid not archived (S1).
- A robust implementation would add: `rowid` in the vec export plus a vec-loaded round-trip test; a young-directory guard or lock before pruning receipt-less dirs; restoring bigint on decode; a read transaction around the export; the reaper exclusion passed as an argument rather than call-order state.
