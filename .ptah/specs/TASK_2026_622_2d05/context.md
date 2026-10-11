# Task Context - TASK_2026_622_2d05

## User Request

Not a direct user request. Found by the TASK_2026_619_af7f benchmark (Batch 4d, task 4d.1) and filed by the orchestrator of that task on 2026-10-07, because it is a product defect in the persistence layer, outside the scope of 619 (which fixes the MCP tools against their prompt claims).

## Task Type

BUGFIX

## Complexity

Medium (native-layer crash, intermittent, not yet reproduced in isolation)

## Strategy

BUGFIX: researcher-expert (reproduce in isolation, root cause, data-safety assessment, Electron check) → team-leader → QA.

## Evidence

Full report: branch `fix/task-619-tool-benchmark`, file `.ptah/specs/TASK_2026_619_af7f/batch-4d-executor-report.md` (section "Task 4d.1", bisect table and product finding).

- **Symptom:** the process exits with `0xC0000409` (3221226505, STATUS_STACK_BUFFER_OVERRUN / fail-fast) on graceful shutdown.
- **Where:** `SqliteConnectionService.close()`, `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts:522-552`, inside `this.database.pragma('wal_checkpoint(TRUNCATE)')` at `:526`. With a trace, the last marker of every crash is `sqlite wal_checkpoint(TRUNCATE) begins`, never `done`.
- **Host:** a `cli-headless` bench host (CLI DI container, `thoth: 'oneshot'`), win32, Node v24.15.0.
- **Bisect (graceful stdin-EOF shutdowns):**

| Variant | Vector search | Shutdowns | Crashes |
|---|---|---|---|
| baseline | yes | 10 | 7 |
| any variant, no search | no | 26 | 0 |
| no embedder (sqlite-vec loaded, no vectors written) | yes | 9 | 0 (plus 1 crash at about 1.7 s during boot) |
| no sqlite-vec (no `vec0` tables) | yes | 10 | 0 |
| connection left open at `process.exit` | yes | 10 | 3 (better-sqlite3's exit cleanup also checkpoints) |
| 20-shutdown smoke after 4d | yes | 20 | 16 |

- **Necessary conditions:** vectors written into `vec0` tables (the first `ptah_code_search_symbols` call downloads the embedding model and embeds the code symbols), then a WAL checkpoint at close.
- **Not reproduced in isolation:** a standalone better-sqlite3 + sqlite-vec script (`vec0 FLOAT[384]`, 50 or 2,000 rows, WAL, checkpoint, close) gave 0 of 20. The product write path adds something more; candidates: code-symbol rows with FTS5 and `vec0` in one transaction, or the migration's `vec0` setup.
- **Reproduction:** with the `tools/mcp-bench` host from 619: boot the bench host on the corpus, make one `ptah_code_search_symbols` call, end stdin. `PTAH_BENCH_BISECT=trace` prints the markers. The bisect flags (`no-embedder`, `no-sqlite-vec`, `no-sqlite-close`, `trace`) live in `tools/mcp-bench/src/transport/bench-host-boot.ts`.

## Questions this task must answer

1. Does the Electron app and the CLI crash the same way on quit after vector writes? (Not tested in 619.)
2. Data safety: is a fail-fast inside `wal_checkpoint(TRUNCATE)` only a lost checkpoint (the WAL is replayed at the next open), or a sign of memory corruption in sqlite-vec that can damage the database? Check `PRAGMA integrity_check` on databases after crashed shutdowns.
3. The root cause in sqlite-vec / better-sqlite3 versions, and the fix (version, close order, checkpoint mode, finalizing statements before close).
4. The boot-time crash at about 1.7 s seen once in the no-embedder variant.

## CLI Lanes

Pending Gate 0.1.

## Conversation Summary

- 2026-10-07: filed from TASK_2026_619_af7f Batch 4d. The 619 bench classifies these exits as `crash-on-shutdown` (a run fact, never a tool error), so the benchmark is not blocked by this task.
