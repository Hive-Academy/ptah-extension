# Batch 67 — skill pipeline archive

## Changes

1. **O34b gap A:** `libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive.ts:19,73-77` appends `scheduled_jobs` after `job_runs` and exports only the four pipeline IDs. The filter column is **`id`**, declared as the scheduled job primary key in `libs/backend/persistence-sqlite/src/lib/migrations/0004_cron.ts:4`; `job_runs.job_id` references it at line 20. The unrelated cron row exclusion is covered in `libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive.spec.ts:38-74`.
2. **O34b gap B:** `libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive.ts:81-86,137-149` maps row values before JSON serialization: Buffer/Uint8Array becomes `{ "$base64": "..." }`, bigint becomes a decimal string, and the exported decoder restores the binary value to Buffer. The persisted receipt is `{ "format": 2, "archivePath": string, "tables": [nine ordered entries] }`; each entry retains `table`, `present`, `file`, `rows`, and `sha256` (`skill-pipeline-archive.ts:28-42,102`). Verification accepts only format 2 and the exact nine-table order (`skill-pipeline-archive.ts:152-175,198-208`). The bench reader uses the same decoder and schema (`tools/mcp-bench/src/memory-skills/data/candidate-row-diff.ts:6,140-153,182`). Round trips and format rejection are covered in `skill-pipeline-archive.spec.ts:75-77` and `candidate-row-diff.spec.ts:43-53`.
3. **Task 67.1:** `libs/backend/persistence-sqlite/src/lib/db-path.ts:68-70` derives `<DB directory>/backups/skill-pipeline`, including for `PTAH_DB_PATH`; `sqlite-connection.service.ts:231-235` passes it through the optional fourth runner argument (`migration-runner.ts:46-51`) to the preflight (`migration-runner.ts:355-359`). Existing positional arguments remain valid. The root is checked in `db-path.spec.ts:14-16`, `sqlite-connection.service.spec.ts:26-36`, and `migration-runner.spec.ts:43-52`. The writer's old default remains for callers omitting the root (`skill-pipeline-archive.ts:52`).
4. **Task 67.2 / L-M9 a:** The Windows inherited per-user ACL rationale is documented beside the writer at `libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive.ts:44-49`. No `icacls` process or Windows mode change was added.
5. **Task 67.2 / L-M9 b:** After the new archive verifies, `libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive.ts:116-154` scans only direct `pre-0057-*` real directories (`lstat`, so symlinks are skipped). It prunes older directories only when `receipt.json` is absent; directories with present but unverifiable receipts are kept. It compares the newest older verified archive's `present`, `rows`, and `sha256` for all nine tables; if identical, it deletes the new archive and returns the older receipt. Differing verified archives remain. The returned, run-local maintenance counts are omitted from `receipt.json`; `migration-runner.ts:356-359` logs reuse and prune counts. Coverage is at `skill-pipeline-archive.spec.ts:84-140`.
6. **Exporter:** `scripts/export-skill-pipeline-archive.ts:44-45` already delegates to the writer and verifier, so its source required no change. `scripts/export-skill-pipeline-archive.spec.ts:28-30` now asserts format 2 and nine tables with `scheduled_jobs` last. **No Nx project runs `scripts/*.spec.ts`**: `scripts/jest.config.ts:2-11` says `scripts/` has no `project.json`; `package.json:53` provides the standalone `npm run test:scripts` command.
7. **Specs:** `libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive.spec.ts:38-140` covers scheduled job filtering, binary round trip, format 2, identical reuse, partial prune, invalid receipt retention, non-fatal maintenance failure, differing archive retention, and tampered-file verification failure. `tools/mcp-bench/src/memory-skills/data/candidate-row-diff.spec.ts:43-53` covers bench decoding and rejection of format 1.

## Revision 1

1. `libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive.ts:125-138` now prunes only a direct older directory with no `receipt.json` entry. If a receipt exists but verification fails, the directory is retained and `maintenance.kept` increments (`:42-47`), including for legacy format-1 archives and transient read failures.
2. `libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive.ts:116-154` wraps all post-verification maintenance, including listing, stat, and removal, in a non-fatal boundary. If maintenance fails, it returns the new receipt with `maintenanceError: true`. The comment at `:116` records why preflight can continue; a failed reuse deletion returns the new receipt.
3. `libs/backend/persistence-sqlite/src/index.ts:115` exposes the decoder through the public package; `tools/mcp-bench/src/memory-skills/data/candidate-row-diff.ts:6` imports that alias.
4. `libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive.ts:86,161-163` uses a record guard and throws a clear error for a non-object row before encoding.
5. `libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive.spec.ts:91-128` covers receipt-free pruning, format-1 receipt retention, and a mocked cleanup failure that still returns a verifiable new receipt.

## Decisions

- Archive location follows the selected DB path. Windows relies on the DB directory's inherited per-user ACL.
- Receipt files contain only durable format and table evidence; maintenance counts are returned to the runner, which logs reuse and prune counts.
- Reuse considers the newest older verified archive by directory modification time. Every other verified archive is retained, even when its content differs.
- The script exporter continues to use its explicit output root from a private DB copy.

## Verification and limits

No Nx, Jest, TypeScript, npm, build, lint, ts-node, or export was run, as instructed. Source reads and diff inspection only. No real database or `~/.ptah` path was touched. Scoped checks remain for the orchestrator.

## Revision 2

1. **S1:** `libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive.ts:81-84` selects `rowid AS rowid` for `skill_candidates_vec` so the archive retains the implicit vec0 key referenced by candidates. `skill-pipeline-archive.spec.ts:91-106` archives explicit rowids 7 and 42 from a plain BLOB table, decodes both JSONL rows, and checks embedding bytes.
2. **M1:** `libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive.ts:9,125-134` prunes a receipt-less directory only when its `lstat` modification time is more than one hour old. Fresh partial directories are skipped without changing maintenance counts. `skill-pipeline-archive.spec.ts:108-128` ages the stale fixture with `fs.utimesSync` and verifies that a fresh partial directory survives.

Revision 2 checks were not run, as instructed. No real database or `~/.ptah` path was touched.
