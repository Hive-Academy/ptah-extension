// 0042_db_integrity_check_state — the persisted record of when this database
// file was last integrity-checked, and what the check said (TASK_2026_380 B1).
//
// WHAT THIS IS FOR. `PRAGMA quick_check` used to run on the boot path inside
// `SqliteConnectionService.openAndMigrate`, before the migration runner, on the
// only `await` the post-window boot makes. Measured 2026-09-06 against a real
// 1 000.7 MB `~/.ptah/state/ptah.sqlite` (256 183 pages) under the repo's own
// `better-sqlite3`: 1868 ms with a WARM OS page cache, and 20-26 s in the field
// where the launch reads ~1 GB COLD. That cost is intrinsic to reading the file
// — it cannot be optimised away, only moved off the thread that answers IPC.
// `PRAGMA foreign_key_check` on the same file was 27 ms with 0 violations, so
// the pair's cost is essentially all `quick_check`.
//
// This table is what lets the check run OUT OF BAND and then STAY quiet: it
// records the last verdict, and `SqliteIntegrityService` re-runs only once the
// record is a week old (or missing, or unhappy).
//
// ONE ROW FOR THE WHOLE TABLE, and the reasoning is the exact INVERSE of
// `0041`'s. `0041` is keyed per scanned root because it describes a directory
// tree that can be repointed and because two roots are walked independently.
// This record describes THE FILE IT LIVES IN. There is exactly one such file
// per database, it cannot be repointed relative to its own row, and a second
// row could only ever be a duplicate. `id INTEGER PRIMARY KEY CHECK (id = 1)`
// makes that a schema constraint rather than a convention the store has to
// remember — a writer that gets the key wrong fails loudly instead of silently
// accumulating history nobody reads. Do NOT copy `0041`'s per-path key here.
//
// ABSENCE OF THE ROW MEANS "NEVER CHECKED", exactly as `0041` treats it, and
// "never checked" means DUE. Every failure in the read path therefore degrades
// towards running a check, never towards skipping one.
//
// AN INCONCLUSIVE CHECK WRITES NO ROW. The worker's third verdict,
// `'unavailable'` (native module missing, file locked, open refused, pragma
// threw), is not recorded at all — the service warns and the next window
// retries. That is `backup.service.ts:44-53`'s rule restated: a row saying
// "checked, fine" that was written by a check which never ran is worse than no
// row. Consequently `quick_check_ok` only ever stores a verdict that was
// actually reached.
//
// EVERY DATA COLUMN IS `INTEGER NOT NULL` and the table is created empty —
// safe for the same reason `0041`'s columns are: this is a NEW table with no
// pre-existing rows and no INSERT anywhere that predates it, so there is no
// legacy statement to break. `detail TEXT` is the one nullable column, because
// it is the only value that can be genuinely unknown: a clean `quick_check`
// has nothing to say, and NULL says that without inventing an empty string.
//
// `checked_at` is epoch ms. A row stamped in the FUTURE is treated as due by
// the reader (clock skew — the same "I cannot date this" reasoning as
// `skill-md-migration.ts:222-225`), so no hand-repair of the row is ever needed
// after a clock change.
//
// `page_count` and `duration_ms` are recorded because they are the only
// evidence a later reader has for why a check cost what it cost; they are
// diagnostics, never inputs to the due decision.
//
// IDEMPOTENT: `CREATE TABLE IF NOT EXISTS` only, no rebuild, no backfill —
// applying it twice is a no-op. The runner's `schema_migrations` ledger still
// guarantees exactly-once regardless.
//
// SECURITY: SQL MUST stay static. No `${...}` interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
CREATE TABLE IF NOT EXISTS db_integrity_check_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  checked_at INTEGER NOT NULL,
  quick_check_ok INTEGER NOT NULL,
  foreign_key_violations INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  page_count INTEGER NOT NULL,
  detail TEXT
);
`;
