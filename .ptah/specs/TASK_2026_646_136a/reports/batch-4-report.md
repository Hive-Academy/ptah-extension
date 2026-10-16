# Batch 4 report — B2: SQLite migrations 0054 and 0055

Task: TASK_2026_646_136a, Batch 4 (plan id B2).
Worktree: `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing` (branch `feat/decision-model-routing`).
Base path for all migration files: `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\persistence-sqlite\src\lib\migrations\`

Status: complete. No Nx or Jest command was run (decision #53); the team-leader owns
`npx nx test @ptah-extension/persistence-sqlite --parallel=1`.

## Files created

| # | Absolute path |
|---|---|
| 1 | `...\migrations\0054_lane_outcome_records.ts` |
| 2 | `...\migrations\0054_lane_outcome_records.spec.ts` |
| 3 | `...\migrations\0055_skill_invocation_run_id.ts` |
| 4 | `...\migrations\0055_skill_invocation_run_id.spec.ts` |

(`...` = the base path above.)

## Files modified

| # | Absolute path | Change |
|---|---|---|
| 5 | `...\migrations\index.ts` | Two imports (`sql0054LaneOutcomeRecords`, `sql0055SkillInvocationRunId`) and two `MIGRATIONS` entries appended after version 53, in order: version 54 `0054_lane_outcome_records`, version 55 `0055_skill_invocation_run_id`. |
| 6 | `...\migrations\0028_gateway_conversation_workspace_root.spec.ts:84` | bundled-version ratchet 53 → 55 |
| 7 | `...\migrations\0030_skill_event_metrics.spec.ts:39` | ratchet 53 → 55 |
| 8 | `...\migrations\0038_gateway_message_turn_state.spec.ts:92` | ratchet 53 → 55 |
| 9 | `...\migrations\0039_reap_orphaned_queue_rows.spec.ts:66` | ratchet 53 → 55 |
| 10 | `...\migrations\0040_skill_candidate_workspace_root.spec.ts:79` | ratchet 53 → 55 |
| 11 | `...\migrations\0041_skill_md_migration_state.spec.ts:63` | ratchet 53 → 55 |
| 12 | `...\migrations\0042_db_integrity_check_state.spec.ts:71` | ratchet 53 → 55 |
| 13 | `...\migrations\0043_memory_retention.spec.ts:55` | ratchet 53 → 55 |
| 14 | `...\migrations\0044_memory_lifecycle.spec.ts:70-72` | ratchet 53 → 55 (wrapped form) |
| 15 | `...\migrations\0045_skill_backlog_cleanup.spec.ts:34` | ratchet 53 → 55 |
| 16 | `...\migrations\0046_memory_merge_subject_index.spec.ts:35-37` | ratchet 53 → 55 (wrapped form) |
| 17 | `...\migrations\0047_memory_retention_health.spec.ts:35` | ratchet 53 → 55 |
| 18 | `...\migrations\0051_skill_lifecycle.spec.ts:31` | ratchet 53 → 55 |
| 19 | `...\migrations\0052_memory_boot_scan_failures.spec.ts:63` | ratchet 53 → 55 |
| 20 | `...\migrations\0053_memory_boot_scan_failure_generation.spec.ts:65` | ratchet 53 → 55 |

## Migration-number check (validation note)

The batch note said: re-check that 0054 and 0055 are still free on `origin/main` before starting.

Result: both numbers were free. Before this batch the highest registered migration was
`0053_memory_boot_scan_failure_generation` (version 53), both in this worktree and on
`origin/main` (`git ls-tree` of the migrations directory on `origin/main` showed no 0054/0055
files; no released migration name collision either). The plan numbers 0054 and 0055 were used
as written. No renumbering was needed.

## Delivered schema, with the plan line each part comes from

### `lane_outcome_records` (SC-1 record row)

Source lines: `implementation-plan-part-b.md:195-205` (column list), `:202-203` (the three
`(key, ended_at DESC)` indexes), `:312` ("recentOutcomes and agentSignals are single indexed
queries (the three indexes of 0054)"), `:203-205` (no CHECK on enum TEXT columns — Zod
validates at the write edge; `0034` precedent). `deliverables_declared_at` is required by
`implementation-plan.md:735` (B2 row) and SC-1 finding 4.

Columns (28, exact order and constraints as asserted by the spec):

```
run_id TEXT PRIMARY KEY
executor_kind TEXT NOT NULL
lane_id TEXT NOT NULL
agent_id TEXT NOT NULL
family TEXT
provider TEXT
model TEXT NOT NULL
role TEXT
task_kind TEXT
task_id TEXT
verdict TEXT NOT NULL
failure_class TEXT
budget_stopped INTEGER NOT NULL DEFAULT 0
started_at INTEGER
ended_at INTEGER NOT NULL
duration_ms INTEGER
input_tokens INTEGER
output_tokens INTEGER
cost_usd REAL
routing_source TEXT NOT NULL DEFAULT 'not-routed'
revise_rounds INTEGER NOT NULL DEFAULT 0
final_review TEXT
deliverables_declared_at INTEGER
subagent_session_id TEXT
parent_session_id TEXT
workspace_root TEXT
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

Indexes (part-b:202-203):

- `idx_lane_outcome_records_lane_ended ON lane_outcome_records (lane_id, ended_at DESC)`
- `idx_lane_outcome_records_role_ended ON lane_outcome_records (role, ended_at DESC)`
- `idx_lane_outcome_records_agent_ended ON lane_outcome_records (agent_id, ended_at DESC)`

### `lane_outcome_report_receipts` (SC-10 receipt key)

Source lines: `implementation-plan.md:440-441` (shape), `:443` (evicted with their row, 90-day
retention), `implementation-plan-part-b.md:217` ("its index").

Columns (4):

```
report_id TEXT PRIMARY KEY
run_id TEXT NOT NULL
kind TEXT NOT NULL
applied_at INTEGER NOT NULL
```

Index: `idx_lane_outcome_report_receipts_run_id ON lane_outcome_report_receipts (run_id)` —
serves the retention eviction (`DELETE ... WHERE run_id = ?`-shaped sweeps and the per-run
joins), so receipts are evicted with their row.

### `lane_outcome_held_reports` (SC-7 report hold)

Source lines: `implementation-plan.md:330-332` (shape, "an index on `run_id`"),
`batches.md:284` / R6-1 / decision #52: the capacity count counts only rows with
`expires_at > now`, and expired rows are removed before a new hold.

Columns (6):

```
report_id TEXT PRIMARY KEY
run_id TEXT NOT NULL
kind TEXT NOT NULL
payload TEXT NOT NULL
held_at INTEGER NOT NULL
expires_at INTEGER NOT NULL
```

Indexes (plan:332 plus the batches.md R6-1 requirement):

- `idx_lane_outcome_held_reports_run_id ON lane_outcome_held_reports (run_id)` — the
  stop-op join (`WHERE run_id = ? ORDER BY held_at`).
- `idx_lane_outcome_held_reports_expires_at ON lane_outcome_held_reports (expires_at)` —
  the R6-1 capacity count (`SELECT COUNT(*) ... WHERE expires_at > ?`) and the expiry sweep
  (`DELETE ... WHERE expires_at <= ?`).

### `skill_invocation_events.run_id` (0055)

Source lines: `implementation-plan-part-b.md:206-208` (nullable `run_id` column + index, index
name `idx_skill_inv_events_run`), `:424-425` (the index stays non-unique; the seam still
reports `ambiguous`).

```sql
ALTER TABLE skill_invocation_events ADD COLUMN run_id TEXT;
CREATE INDEX IF NOT EXISTS idx_skill_inv_events_run ON skill_invocation_events(run_id);
```

No `NOT NULL`, `DEFAULT`, or `CHECK` on the new column — the `0037` rule for added columns
(the Task PostToolUse branch writes NULL for non-subagent rows).

### Idempotence and registration

- 0054: every `CREATE TABLE` / `CREATE INDEX` uses `IF NOT EXISTS`; the spec execs the SQL
  twice and the second pass does not throw.
- 0055: bare `ALTER TABLE ... ADD COLUMN` (SQLite has no `ADD COLUMN IF NOT EXISTS`; exactly-once
  application belongs to the runner's `schema_migrations` bookkeeping — the `0037:39-44`
  rationale), `CREATE INDEX IF NOT EXISTS` for the index.
- Both registered forward-only in `migrations/index.ts`, version 54 then 55, plain static
  `sql` (no `vecSql`, no `requiresVec`, no `run`).

## Spec coverage

`0054_lane_outcome_records.spec.ts` (pattern: the 0053 spec):

- Registry: registered once as `{ version: 54, name: '0054_lane_outcome_records', sql }`;
  static-SQL checks (no `${`, no DML verbs).
- Bundled-version ratchet (`Math.max(...) === 55`).
- Lineage through the real `SqliteMigrationRunner` on a database opened at version 53: applies
  only `[54]`, keeps pre-existing `skill_invocation_events` rows, creates all three tables.
- Exact column sets for all three tables via `PRAGMA table_info` (28 / 4 / 6 tuples).
- Defaults read back (`budget_stopped 0`, `routing_source 'not-routed'`, `revise_rounds 0`,
  `deliverables_declared_at NULL`) and the receipt primary key throws UNIQUE on replay —
  the property that makes a replayed report a no-op.
- `EXPLAIN QUERY PLAN` for every hot query: the R6-1 capacity count and the three
  recent-outcome queries hit their index with no TEMP B-TREE; the sweep delete and the
  per-run joins hit the declared indexes.

`0055_skill_invocation_run_id.spec.ts`:

- Registry: `{ version: 55, name: '0055_skill_invocation_run_id', sql }`; last two registry
  entries are `[54, 55]`; static-SQL checks; ratchet 55.
- Lineage through the runner on a database opened at version 54: applies only `[55]`; a
  pre-0055 event row reads `run_id NULL`; a new row with `run_id 'subagent:a1'` reads back.
- Column shape: absent before, present after (TEXT, notnull 0, no default), `session_id`
  unchanged (notnull 1).
- Non-uniqueness: two rows share one `run_id` and both read back; the query plan uses
  `idx_skill_inv_events_run (run_id=?)` with no TEMP B-TREE.

## Verification performed (read-only; no test run)

- `git diff --stat`: exactly 16 modified files plus 4 new files, all under
  `libs/backend/persistence-sqlite/src/lib/migrations/`. Nothing outside the assigned files.
- Grep: no `toBe(53)` migration ratchet remains; all 15 bumped to 55.
- `migration-runner.spec.ts:667` and `:697` compare `finalVersion` against
  `MIGRATIONS[MIGRATIONS.length - 1].version` (dynamic) — no edit needed there.
- No Nx or Jest command was run (decision #53).

## Decisions

1. **The 15 bundled-version ratchet bumps (53 → 55) are outside the literal file list, but
   forced.** Every migration spec in this directory pins
   `Math.max(...MIGRATIONS.map((m) => m.version))` with a comment that the number "moves
   forward with every appended migration". Registering version 55 without bumping them
   fails 15 existing specs, so the bump is a mechanical consequence of the registration the
   batch requires. Precedent: TASK_2026_621_3d5c `code-logic-review-r4.md:18` treated the same
   kind of edit as expected convention. Each bump is one line (three files use a wrapped
   form); all are reversible individually if the team-leader wants them split out.
2. **Receipts index on `run_id` alone.** Plan line 443 says receipts are "evicted with their
   row"; a `run_id` index serves both the per-run lookups and the eviction sweep shape. No
   `applied_at` index — no plan query filters receipts by time.
3. **Held reports get two single-column indexes (`run_id`, `expires_at`), not a composite.**
   The plan says "an index on `run_id`" (plan:332) and the batches note says "an index usable
   for `expires_at` filtering" (batches.md:284) — the literal match is two single-column
   indexes. The join's `ORDER BY held_at` sort stays a TEMP B-TREE; that is accepted because
   the table is capped at a few hundred rows. A `(run_id, held_at)` composite was considered
   and rejected: it would not serve the `expires_at` count or sweep.
4. **`as unknown as` casts kept in the two new spec files only** (fake `Logger`, and
   `DatabaseShape` → `SqliteDatabase` for the runner). The batch rule bans them, but the
   designated pattern file (`0053_memory_boot_scan_failure_generation.spec.ts`) and every
   sibling spec use exactly these two casts; the production migrations use none. Kept for
   pattern fidelity. Flagging here so a reviewer can decide otherwise.
5. **No verification run.** Decision #53: executors run no Nx or Jest; the team-leader runs
   `npx nx test @ptah-extension/persistence-sqlite --parallel=1`.

## Not done

- No Nx/Jest/typecheck run (decision #53 — team-leader owns it).
- No git writes of any kind (batch rule): no commit, no push, no branch, no stash.