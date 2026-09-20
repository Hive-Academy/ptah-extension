# PR #538 CodeRabbit follow-up — Track A

Measured on 2026-09-19. The live database was opened only with
`{ readonly: true, fileMustExist: true }`. Index creation and write benchmarks
ran only against
`tmp/codex-pr/ptah-benchmark.sqlite`, copied from the live database.

## Finding 1 — stored subjects are not trimmed

**Verdict: real.** The live database currently contains **0 padded subjects out
of 36,278 memories**, using:

```sql
SELECT COUNT(*)
FROM memories
WHERE subject IS NOT NULL AND subject <> TRIM(subject);
```

The present corpus therefore has no rows needing repair, but the code defect was
real: `insertMemoryWithChunks` bound `insert.subject` verbatim while
`findMergeCandidates` trimmed only draft keys. A future padded insert would be
unreachable by the merge lookup.

I normalized both boundaries:

- `insertMemoryWithChunks` now trims subjects and stores blank subjects as
  `NULL` through the existing `blankToNull` boundary helper.
- `findMergeCandidates` now uses `TRIM(LOWER(m.subject))` in both the
  `subject_key` projection and the `IN` predicate.

Using both read- and write-side normalization prevents new padded rows and keeps
already-padded rows mergeable. Although the measured live database currently
has none, the read normalization deliberately covers databases that may already
contain them.

Specs that pin the behavior:

- `MemoryStore subject normalization › trims a subject before binding the memory insert`
- `MemoryStore.findMergeCandidates — TASK_2026_473 Track A › matches a legacy stored subject with surrounding whitespace`

## Finding 2 — no index supports the merge lookup

**Verdict: real.** The largest live workspace contains **35,255** of the
database's **36,278** memories. On the database copy, the normalized query used
ten common subject keys and 30 warm iterations.

Before the index, `EXPLAIN QUERY PLAN` included:

```text
SEARCH m USING INDEX idx_memories_workspace (workspace_root=?)
USE TEMP B-TREE FOR ORDER BY
USE TEMP B-TREE FOR ORDER BY
```

The warm median was **70.72005 ms** (minimum 64.825 ms, maximum 117.0365 ms).

Building the expression index took **0.1272506 seconds**. The copied database
was **1,262,342,144 bytes** before and after, for **0 bytes file-size growth**;
SQLite reused free pages already present in the file.

After the index, `EXPLAIN QUERY PLAN` included:

```text
SEARCH m USING INDEX idx_memories_ws_normalized_subject (workspace_root=? AND <expr>=?)
USE TEMP B-TREE FOR LAST 2 TERMS OF ORDER BY
USE TEMP B-TREE FOR ORDER BY
```

The 30-iteration warm median fell to **2.09425 ms** (minimum 1.7699 ms,
maximum 3.4822 ms).

I added and registered migration `0046_memory_merge_subject_index`:

```sql
CREATE INDEX IF NOT EXISTS idx_memories_ws_normalized_subject
  ON memories(workspace_root, TRIM(LOWER(subject)));
```

The expression exactly matches Finding 1's read predicate, which is required
for SQLite to use an expression index. The `observation_queue` boot-path
caution does **not** apply at the same severity here: this index scans the
36,278-row `memories` table rather than the roughly gigabyte-scale observation
queue, and its measured build time was 127 ms. That one-time boot cost is small
relative to the synchronous main-process delay removed from every merge lookup.

The migration spec pins unique registry version 46 and runs
`EXPLAIN QUERY PLAN` against the exact normalized predicate, asserting that
SQLite selects `idx_memories_ws_normalized_subject`.

## Finding 3 — snake_case FTS phrase can miss rows

**Verdict: not real.** The live FTS definition is:

```sql
CREATE VIRTUAL TABLE memory_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  text,
  content='memory_chunks',
  content_rowid='rowid',
  tokenize='porter unicode61'
)
```

The live read-only queries used the builder's emitted phrase shape:

- `"memory_chunks_fts"*` returned **33 rows**.
- `"workspace_root"*` returned **307 rows**.

This confirms that FTS5 tokenizes the quoted query phrase with the same
`porter unicode61` tokenizer used for indexed text, preserving the adjacent
token phrase semantics for snake_case identifiers. I changed no production
builder code. The optional spec
`buildFtsQueryPlan › keeps a snake_case identifier as one quoted query phrase`
pins the emitted `"memory_chunks_fts"*` form without adopting the prohibited
ASCII-only token pattern.

## Verification

### `npx nx test @ptah-extension/memory-curator --skip-nx-cache`

```text
Test Suites: 42 passed, 42 total
Tests:       728 passed, 728 total
Snapshots:   0 total
Time:        25.013 s
Ran all test suites.

NX   Successfully ran target test for project @ptah-extension/memory-curator
```

The prior baseline was 42 suites and 725 tests; the new total is **42 suites and
728 tests**, all passing.

### `npx nx run-many -t typecheck -p @ptah-extension/memory-curator`

```text
> nx run @ptah-extension/memory-curator:typecheck
> tsc --noEmit --project libs/backend/memory-curator/tsconfig.lib.json

NX   Successfully ran target typecheck for project @ptah-extension/memory-curator
```

### `npx nx test @ptah-extension/persistence-sqlite --skip-nx-cache`

The first invocation encountered a transient Windows Jest transform-cache lock
(`EPERM` while reading a temp cache file) after 41 suites had passed. The same
required command was rerun unchanged and passed; Nx classified the task as
flaky because of that retry.

```text
Test Suites: 42 passed, 42 total
Tests:       3 skipped, 517 passed, 520 total
Snapshots:   0 total
Time:        44.297 s, estimated 58 s
Ran all test suites.

NX   Successfully ran target test for project @ptah-extension/persistence-sqlite

NX   Nx detected a flaky task
  @ptah-extension/persistence-sqlite:test
```
