# Code Logic Review (Phase F, round 2) — TASK_2026_662

Review family: reviewer Claude; implementer codex lanes + orchestrator gate edits.

Scope: S1, M1 and the O50(b) gate corrections only. Read-only; git diff and file reads; no checks executed.

## Summary

| Metric | Value |
| --- | --- |
| Score | 8.5/10 |
| Verdict | APPROVED |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 1 |
| Minor | 2 |

## Verification of the fixes

1. S1 (vec0 rowid) — FIXED. `skill-pipeline-archive.ts:81-84` selects `rowid AS rowid, *` for `skill_candidates_vec`. The row goes through the common encoder (`:91-95`), so the embedding BLOB becomes a `$base64` envelope and the rowid is a plain number. Spec `skill-pipeline-archive.spec.ts` "preserves implicit vector rowids and embedding bytes" round-trips rowids 7 and 42 and the bytes through `decodeSkillPipelineArchiveRow`.
2. M1 (prune only after 1 hour) — FIXED. `skill-pipeline-archive.ts:128-136`: a missing receipt (ENOENT only; other errors rethrow into the maintenance catch) plus mtime within `STALE_PARTIAL_ARCHIVE_MS` means `continue`. A fresh in-flight export is left alone. The spec "leaves a fresh receipt-less archive" covers it. The prune spec back-dates with `utimesSync`. Directory mtime changes on each file creation (nine tables), so a live export keeps refreshing it. The 1h margin is generous.
3. O50(b) corrections — all verified.
   - `error['code']` at `skill-pipeline-archive.ts:~163` (`isMissingFileError`) is fine under strict index-signature access.
   - `candidate-row-diff.spec.ts:48` uses `['payload']`. mcp-bench is the only project with `noPropertyAccessFromIndexSignature` (`tools/mcp-bench/tsconfig.json:9`). The persistence-sqlite spec dot-accesses `candidate.payload` and `rows[0].rowid`, which is legal there because that project does not set the flag.
   - The local `$base64` decoder (`candidate-row-diff.ts` `decodeArchiveRow`/`isBase64Envelope`) is the same logic as the exported `decodeSkillPipelineArchiveRow` (single-key object, string value, same strict base64 regex). It decodes exactly what the encoder writes (`Buffer.toString('base64')`, with padding; an empty buffer gives "", which the regex accepts). No ambiguity with real data: SQLite scalar columns cannot be objects, so a TEXT value never parses as an envelope.
   - Receipt `format: z.literal(2)` in the reader schema and `format: 2` in the snapshot-audits fixture (`snapshot-audits.suite.spec.ts:128`) are consistent with `isReceipt` in the writer. A format-1 receipt is rejected (tested in `candidate-row-diff.spec.ts`).
   - `ARCHIVE_TABLES` in the reader matches the writer `TABLES` order including `scheduled_jobs`. The index-wise comparison in the dedupe depends on that order. Writer-side `isReceipt` checks the table count and order.

## Regression hunt

- Prune race: a receipt-less directory is removed only after 1h of inactivity. A writer that stalls more than 1h between two file creations would lose its directory, which is not realistic. An in-flight writer's receipt is written before maintenance lists the directory, so no live archive can be mistaken for stale.
- Data loss on dedupe: the new copy is removed only when an older archive passed full `verifySkillPipelineArchive` (hash and row count) and every table entry matches on present/rows/sha256. The older receipt is returned, and a failed delete is reported through `maintenanceError` while the verified older copy stays. Safe.
- Silent failure: a maintenance exception returns the freshly verified receipt with `maintenanceError: true`, so the drop preflight is never blocked or given an unverified receipt. Not silent; the flag is surfaced.
- Old format-1 or corrupt receipts are kept (`kept++`), never deleted. Conservative.

## Findings

- Moderate — `skill-pipeline-archive.spec.ts` (vec rowid test): the spec uses a plain `CREATE TABLE skill_candidates_vec (embedding BLOB)`, not a real vec0 virtual table. The implicit-rowid behaviour of `SELECT rowid AS rowid, *` on vec0 is asserted only against a regular table, and the real sqlite-vec path is unexercised. The query is standard and low risk, but the S1 fix is not proven on the actual vec0 engine. Follow-up: an integration spec when sqlite-vec is loadable.
- Minor — `skill-pipeline-archive.ts:125`: `lstatSync` on an entry that disappears between `readdirSync` and `lstatSync` (a concurrent prune by another process) throws ENOENT into the outer catch. That aborts maintenance and skips dedupe and the remaining prunes for that run (`maintenanceError: true`). Harmless, but one vanished entry should be skipped instead.
- Minor — the decoder is duplicated across the two files (persistence-sqlite and mcp-bench). This is intentional (avoids the DI barrel) and documented, but the two copies can drift. Consider a shared pure helper later.

Previously recorded M2, M3 and Minors are not made worse by these fixes.

## Verdict

APPROVED, 8.5/10. S1 and M1 are fixed with tests; the gate corrections are consistent with the writer's format-2 envelope; no new data-loss or silent-failure path found. Residual uncertainty: no checks were run (read-only), and the vec0 behaviour is untested on a real virtual table.
