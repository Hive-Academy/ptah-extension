/**
 * 0039_reap_orphaned_queue_rows — one-time reap of stale, never-advanced work
 * queue rows left behind by the tabId-vs-UUID session identity split
 * (TASK_2026_296 item 6).
 *
 * ## Why this REAPS and does not RECONCILE
 *
 * Before the fix, a session could arm state — and write queue rows — under its
 * **tabId** during the window between the first prompt and the SDK's system
 * `init` message, while every later signal (and `SessionEnd`, which always
 * canonicalises to `realSessionId ?? tabId`) arrived under the SDK **UUID**.
 * Rows written under the tabId are invisible to every read path, all of which
 * filter `WHERE session_id = ?` with the canonical id.
 *
 * Those rows CANNOT be reconciled by a migration. The tabId→UUID mapping lives
 * only in the in-memory `SessionRegistry` and is **never persisted** — nothing
 * on disk records which tabId belonged to which session, so there is nothing to
 * join on. This is impossible, not merely deferred. A shape test is no help
 * either: a tabId is itself a UUID v4 (`TabId.create()`), so the two ids are
 * indistinguishable by inspection, and the legacy `tab_<ts>_<id>` format is
 * retired — a `LIKE 'tab\_%'` predicate would match only long-dead rows and is
 * wrong by construction. There is deliberately no such predicate below.
 *
 * ## Why reaping is acceptable
 *
 * These are internal work-queue entries — pending observations to curate,
 * pending synthesis stages — **not user data**. Conversations live in the SDK's
 * JSONL files under `~/.claude/projects/` and are untouched by this migration
 * and by every other part of TASK_2026_296. The cost is some un-curated
 * memories and un-synthesised skills from sessions that ended over a month ago.
 *
 * Nothing else reclaims them: `ObservationQueueStore.purgeOlderThan` deletes
 * only rows that WERE processed, and `skill_synthesis_queue` has no purge at
 * all — so an orphan sits in the table forever, counted by `countUnprocessed`
 * for a session that can never be curated.
 *
 * ## What it deletes, and what it provably does not
 *
 * Deletes, in `observation_queue`: rows that are **unprocessed**
 * (`processed_at IS NULL`) AND older than the retention window.
 *
 * Deletes, in `skill_synthesis_queue`: rows that are **un-advanced** — still
 * `queued`, never attempted, never finished — AND older than the window, AND
 * neither depending on nor depended upon by another row.
 *
 * Provably untouched:
 *   - every PROCESSED observation (`processed_at IS NOT NULL`);
 *   - every ADVANCED queue row — `claimed`, `running`, `done`, `failed`,
 *     `skipped`, `unscored`, or any row with `attempt_count > 0` or a
 *     `finished_at`. A row that ran and produced no usable verdict is
 *     `unscored` and stays re-eligible under `not_before`;
 *   - every row INSIDE the retention window, in both tables. A live install
 *     upgrading mid-session has legitimate unprocessed rows and they must
 *     survive;
 *   - any queue row that is an ancestor or a dependent in the stage DAG, so the
 *     reap cannot strand pending work even where `PRAGMA foreign_keys` is off
 *     and `0032`'s `ON DELETE SET NULL` is not enforced.
 *
 * ## The retention window: 30 days
 *
 * There is no pre-existing retention CONSTANT to inherit — `purgeOlderThan`
 * has zero production callers and `skill_synthesis_queue` has no purge — so the
 * window is chosen here and is deliberately generous. It is four times the
 * longest retention precedent in the repo (`VOICE_RETENTION_MS`, 7 days,
 * `messaging-gateway`) and far longer than any session can plausibly stay open,
 * which is what makes "must not touch rows inside the window" hold with room to
 * spare. Erring long follows the same "miss rather than wrongly delete" rule
 * the in-memory rekey follows: leaving an orphan behind is recoverable at the
 * next boot, deleting a live row is not.
 *
 * The cutoff is computed by SQLite (`strftime('%s','now','-30 days')`, scaled to
 * the epoch-MILLISECOND units both `captured_at` and `enqueued_at` are written
 * in by `Date.now()`), so this stays STATIC TEXT with no `${...}` interpolation
 * (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
 *
 * Rollback story: forward-only per persistence-sqlite/CLAUDE.md. The rows are
 * gone; `SqliteBackupService.pre-migration` is the canonical recovery path.
 * Re-running is prevented by the runner's `schema_migrations` ledger, and would
 * in any case only reap a further 30-day-old cohort.
 */
export const sql = `
DELETE FROM observation_queue
 WHERE processed_at IS NULL
   AND captured_at < (CAST(strftime('%s', 'now', '-30 days') AS INTEGER) * 1000);

DELETE FROM skill_synthesis_queue
 WHERE status = 'queued'
   AND attempt_count = 0
   AND finished_at IS NULL
   AND depends_on IS NULL
   AND enqueued_at < (CAST(strftime('%s', 'now', '-30 days') AS INTEGER) * 1000)
   AND NOT EXISTS (
         SELECT 1 FROM skill_synthesis_queue AS dependent
          WHERE dependent.depends_on = skill_synthesis_queue.id
       );
`;
