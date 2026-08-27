/**
 * ObservationQueueStore — typed CRUD over the `observation_queue` table.
 *
 * Captures hook-side observations (PostToolUse Read/tool results, ToolFailure,
 * Stop, UserPromptSubmit) BEFORE the cue-match/threshold gates inside
 * `MemoryTriggerService`, then drained inside `invokeCurate` to compose the
 * curator transcript. Rows are marked processed only on curator success.
 *
 * ## Writes are BATCHED (TASK_2026_323, blocker B2)
 *
 * better-sqlite3 runs entirely on the calling thread, which in Electron is the
 * SAME thread that owns every `BrowserWindow`. The capture path fires from six
 * hook sites on every tool call, every assistant turn and every prompt submit,
 * so three sessions driving CLI agents produced 100+ serialized synchronous
 * INSERTs per turn — each one re-preparing its statement, each one its own
 * implicit transaction (its own fsync under `synchronous = NORMAL`) against a
 * single connection with `busy_timeout = 5000`.
 *
 * So {@link enqueue} no longer writes. It appends to an in-memory array which
 * is drained by {@link flush} in ONE transaction, either on an `unref`'d 250 ms
 * timer or as soon as {@link FLUSH_THRESHOLD} rows are pending. The batch costs
 * one prepare (cached, see {@link ObservationQueueStore.statement}) and one
 * commit instead of N of each.
 *
 * **Every read flushes first.** `drainForSession`, `peekForSession`,
 * `countUnprocessed`, `purgeOlderThan` and `backfillSessionId` all call
 * {@link flush} before they touch SQL, so no caller can observe a state where a
 * row it just enqueued is missing. That is what keeps the batching invisible to
 * everything except the event loop.
 */
import { inject, injectable } from 'tsyringe';
import { blankToUndefined } from '@ptah-extension/shared';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
  type SqliteDatabase,
  type SqliteStatement,
} from '@ptah-extension/persistence-sqlite';

export type ObservationKind =
  | 'tool-use'
  | 'tool-failure'
  | 'assistant-turn'
  | 'user-prompt'
  | 'file-read'
  | 'commit';

export interface ObservationQueueInsert {
  readonly sessionId: string;
  readonly workspaceRoot: string | null;
  readonly kind: ObservationKind;
  readonly toolName?: string | null;
  readonly toolInputJson?: string | null;
  readonly toolResponseText?: string | null;
  readonly assistantMessage?: string | null;
  readonly userPrompt?: string | null;
  readonly filePath?: string | null;
  readonly promptNumber?: number | null;
}

export interface ObservationQueueRow extends ObservationQueueInsert {
  readonly id: number;
  readonly capturedAt: number;
  readonly processedAt: number | null;
}

/**
 * The projection {@link ObservationQueueStore.drainForSession} returns.
 *
 * Deliberately NOT {@link ObservationQueueRow}: the curator's only consumer of
 * a drained row is `formatObservationRow`, which reads exactly these eight
 * fields. `SELECT *` additionally materialised `session_id` (which the caller
 * supplied), `workspace_root`, `prompt_number`, `captured_at` and
 * `processed_at` — 500 copies of a string the caller already holds, for rows
 * that can each carry 16 KB of text.
 */
export interface ObservationDraftRow {
  readonly id: number;
  readonly kind: ObservationKind;
  readonly toolName: string | null;
  readonly toolInputJson: string | null;
  readonly toolResponseText: string | null;
  readonly assistantMessage: string | null;
  readonly userPrompt: string | null;
  readonly filePath: string | null;
}

/** Maximum byte length of `tool_response_text` retained at capture time. */
export const OBSERVATION_TOOL_RESPONSE_MAX_BYTES = 16 * 1024;

/**
 * Maximum byte length of `tool_input_json` retained at capture time.
 *
 * Previously uncapped, which is how a single `Write` tool call could push a
 * whole file body into the queue. `formatObservationRow` never shows more than
 * 1000 characters of it, so nothing downstream can tell the difference.
 */
export const OBSERVATION_TOOL_INPUT_MAX_BYTES = 4 * 1024;

/**
 * Maximum byte length of `assistant_message` / `user_prompt` at capture time.
 * The transcript composer truncates both far harder (2000 / 1000 characters).
 */
export const OBSERVATION_MESSAGE_MAX_BYTES = 16 * 1024;

/**
 * Byte budget for ONE {@link ObservationQueueStore.drainForSession} call,
 * measured across the `tool_response_text` of the rows it returns.
 *
 * The row limit alone bounds nothing useful: 500 rows × 16 KB is 8 MB of JS
 * strings allocated in a single tick, on the thread that also paints the UI.
 * The drain streams rows and stops once the budget is met, so a curate pass
 * costs a bounded allocation regardless of how chatty the session was.
 */
export const OBSERVATION_DRAIN_BYTE_BUDGET = 2 * 1024 * 1024;

/** How long a pending batch may sit before it is written. */
const FLUSH_INTERVAL_MS = 250;

/** Pending row count that forces an immediate flush rather than waiting. */
const FLUSH_THRESHOLD = 64;

/**
 * Hard ceiling on the pending buffer. Only reachable when the connection is
 * unavailable (every successful flush empties the buffer), so it exists to stop
 * an offline database from turning the capture path into a memory leak.
 */
const MAX_PENDING_ROWS = 4096;

const INSERT_SQL = `INSERT INTO observation_queue
     (session_id, workspace_root, prompt_number, kind, tool_name,
      tool_input_json, tool_response_text, assistant_message, user_prompt,
      file_path, captured_at, processed_at)
   VALUES (@session_id, @workspace_root, @prompt_number, @kind, @tool_name,
           @tool_input_json, @tool_response_text, @assistant_message, @user_prompt,
           @file_path, @captured_at, NULL)`;

const DRAIN_SQL = `SELECT id, kind, tool_name, tool_input_json, tool_response_text,
                          assistant_message, user_prompt, file_path
                     FROM observation_queue
                    WHERE session_id = ? AND processed_at IS NULL
                    ORDER BY captured_at ASC, id ASC
                    LIMIT ?`;

const PEEK_SQL = `SELECT * FROM observation_queue
                   WHERE session_id = ?
                   ORDER BY captured_at DESC, id DESC
                   LIMIT ?`;

const MARK_PROCESSED_SQL = `UPDATE observation_queue SET processed_at = ? WHERE id = ?`;

const BACKFILL_SQL = `UPDATE observation_queue SET session_id = ? WHERE session_id = ?`;

const PURGE_SQL = `DELETE FROM observation_queue WHERE captured_at < ? AND processed_at IS NOT NULL`;

const COUNT_UNPROCESSED_SQL = `SELECT COUNT(*) AS n FROM observation_queue WHERE session_id = ? AND processed_at IS NULL`;

/**
 * Capture event published when a new row reaches the table. Designed to be
 * broadcast as `MESSAGE_TYPES.MEMORY_OBSERVATION_CAPTURED` without any further
 * mapping — matches `MemoryObservationCapturedPayload` from
 * `@ptah-extension/shared`.
 *
 * Published from {@link ObservationQueueStore.flush}, after the batch commits,
 * NOT from `enqueue`. Two reasons, both deliberate: the event's contract is
 * "this row is in the table", which is only true after the commit; and the one
 * consumer forwards it to every webview, so batching the write batches the
 * fan-out with it.
 */
export interface ObservationCaptureEvent {
  readonly sessionId: string;
  readonly workspaceRoot: string | null;
  readonly kind: ObservationKind;
  readonly timestamp: number;
}

export type ObservationCaptureListener = (
  event: ObservationCaptureEvent,
) => void;

interface ObservationRow {
  id: number;
  session_id: string;
  workspace_root: string | null;
  prompt_number: number | null;
  kind: ObservationKind;
  tool_name: string | null;
  tool_input_json: string | null;
  tool_response_text: string | null;
  assistant_message: string | null;
  user_prompt: string | null;
  file_path: string | null;
  captured_at: number;
  processed_at: number | null;
}

type ObservationDraftDbRow = Pick<
  ObservationRow,
  | 'id'
  | 'kind'
  | 'tool_name'
  | 'tool_input_json'
  | 'tool_response_text'
  | 'assistant_message'
  | 'user_prompt'
  | 'file_path'
>;

/** Named bind parameters for {@link INSERT_SQL}, built once at enqueue time. */
interface ObservationBindParams extends Record<string, unknown> {
  session_id: string;
  workspace_root: string | null;
  prompt_number: number | null;
  kind: ObservationKind;
  tool_name: string | null;
  tool_input_json: string | null;
  tool_response_text: string | null;
  assistant_message: string | null;
  user_prompt: string | null;
  file_path: string | null;
  captured_at: number;
}

interface PendingObservation {
  readonly bind: ObservationBindParams;
  readonly capture: ObservationCaptureEvent;
}

function rowToObservation(row: ObservationRow): ObservationQueueRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    workspaceRoot: row.workspace_root,
    promptNumber: row.prompt_number,
    kind: row.kind,
    toolName: row.tool_name,
    toolInputJson: row.tool_input_json,
    toolResponseText: row.tool_response_text,
    assistantMessage: row.assistant_message,
    userPrompt: row.user_prompt,
    filePath: row.file_path,
    capturedAt: row.captured_at,
    processedAt: row.processed_at,
  };
}

function rowToDraft(row: ObservationDraftDbRow): ObservationDraftRow {
  return {
    id: row.id,
    kind: row.kind,
    toolName: row.tool_name,
    toolInputJson: row.tool_input_json,
    toolResponseText: row.tool_response_text,
    assistantMessage: row.assistant_message,
    userPrompt: row.user_prompt,
    filePath: row.file_path,
  };
}

/**
 * Truncate to a UTF-8 byte budget without splitting a multi-byte sequence.
 *
 * `Buffer.byteLength` measures without copying, so the common case — a value
 * already inside the budget — allocates nothing. Only an oversized value pays
 * for the `Buffer.from` copy.
 */
function truncateUtf8(
  value: string | null | undefined,
  maxBytes: number,
): string | null {
  if (value === null || value === undefined) return null;
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  const buf = Buffer.from(value, 'utf8');
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8');
}

@injectable()
export class ObservationQueueStore {
  private readonly captureListeners = new Set<ObservationCaptureListener>();

  /** Rows captured but not yet written. Drained by {@link flush}. */
  private pending: PendingObservation[] = [];

  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Prepared-statement cache, keyed by SQL text.
   *
   * Invalidated by IDENTITY: {@link SqliteConnectionService.openAndMigrate}
   * builds a NEW `SqliteDatabase` on every open, so a cached statement is stale
   * exactly when `connection.db` is a different object than the one it was
   * prepared against. That is a strictly stronger guard than subscribing to
   * `SqliteConnectionService.onDidOpen`, which by its own contract does not
   * fire for a subscriber that arrived while the connection was already open,
   * and needs no subscription to leak on teardown.
   */
  private readonly statements = new Map<string, SqliteStatement>();
  private cachedDb: SqliteDatabase | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  /** Rows captured but not yet written. Test/diagnostic accessor. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Capture one observation into the pending batch.
   *
   * Named `enqueue`, not `insert`, because it does not write: the row reaches
   * SQLite on the next {@link flush}, which every read of this store performs
   * first. See the class docblock for why.
   *
   * A row whose `sessionId` is empty is refused rather than queued, because
   * such a row is UN-DRAINABLE and UN-REAPABLE by construction: every read path
   * here filters `WHERE session_id = ?` and nothing ever queries `''`, so it is
   * never drained, never marked processed, and `purgeOlderThan` only deletes
   * rows that WERE processed. It would sit in the table forever, counted by
   * `countUnprocessed` for a session that cannot be curated.
   */
  enqueue(row: ObservationQueueInsert): void {
    // `blankToUndefined` is the refusal predicate AND the normaliser, and the
    // NORMALISED value is what gets bound below. Testing the trimmed id and
    // then binding the raw one is not a style wart — `memories.session_id` is
    // written through `blankToNull` (trimmed), and `memory-search.service.ts`
    // joins the two by handing that value to `peekForSession`, which filters
    // `WHERE session_id = ?` here. Normalising one side of a join and not the
    // other means a padded id writes a row this store can never read back.
    const sessionId = blankToUndefined(row.sessionId);
    if (sessionId === undefined) {
      this.logger.warn(
        '[memory-curator] observation-queue enqueue skipped — empty sessionId',
        { kind: row.kind, workspaceRoot: row.workspaceRoot },
      );
      return;
    }

    if (this.pending.length >= MAX_PENDING_ROWS) {
      // Only reachable while the connection is down — a successful flush always
      // empties the buffer. Drop the observation rather than grow without bound.
      this.logger.warn(
        '[memory-curator] observation-queue backlog full — observation dropped',
        { kind: row.kind, pending: this.pending.length },
      );
      return;
    }

    const capturedAt = Date.now();
    this.pending.push({
      bind: {
        session_id: sessionId,
        workspace_root: row.workspaceRoot,
        prompt_number: row.promptNumber ?? null,
        kind: row.kind,
        tool_name: row.toolName ?? null,
        tool_input_json: truncateUtf8(
          row.toolInputJson,
          OBSERVATION_TOOL_INPUT_MAX_BYTES,
        ),
        tool_response_text: truncateUtf8(
          row.toolResponseText,
          OBSERVATION_TOOL_RESPONSE_MAX_BYTES,
        ),
        assistant_message: truncateUtf8(
          row.assistantMessage,
          OBSERVATION_MESSAGE_MAX_BYTES,
        ),
        user_prompt: truncateUtf8(
          row.userPrompt,
          OBSERVATION_MESSAGE_MAX_BYTES,
        ),
        file_path: row.filePath ?? null,
        captured_at: capturedAt,
      },
      capture: {
        sessionId,
        workspaceRoot: row.workspaceRoot,
        kind: row.kind,
        timestamp: capturedAt,
      },
    });

    if (this.pending.length >= FLUSH_THRESHOLD) {
      this.flush();
      return;
    }
    this.armFlushTimer();
  }

  /**
   * Write every pending observation in ONE transaction, then publish their
   * capture events.
   *
   * Idempotent and safe to call at any time: with nothing pending it only
   * disarms the timer. Never throws — the capture path is a hook callback with
   * no caller able to act on a persistence failure, so a failed batch is logged
   * and dropped exactly as a failed single insert was before.
   */
  flush(): void {
    this.disarmFlushTimer();
    if (this.pending.length === 0) return;

    const batch = this.pending;
    this.pending = [];

    let db: SqliteDatabase;
    try {
      db = this.connection.db;
    } catch (error: unknown) {
      this.logger.warn(
        '[memory-curator] observation-queue flush skipped — persistence unavailable',
        {
          dropped: batch.length,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return;
    }

    try {
      const stmt = this.statement(db, INSERT_SQL);
      const txn = db.transaction(((..._args: unknown[]) => {
        for (const entry of batch) stmt.run(entry.bind);
      }) as (...args: unknown[]) => unknown);
      txn();
    } catch (error: unknown) {
      this.logger.warn('[memory-curator] observation-queue flush failed', {
        dropped: batch.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const entry of batch) this.emitCapture(entry.capture);
  }

  /**
   * Flush and release everything this store owns. For host shutdown — the
   * pending batch is written rather than lost, the timer is cleared, and the
   * statement cache is dropped so nothing holds a handle on a closing
   * connection.
   */
  dispose(): void {
    this.flush();
    this.disarmFlushTimer();
    this.statements.clear();
    this.cachedDb = null;
    this.captureListeners.clear();
  }

  private armFlushTimer(): void {
    if (this.flushTimer !== null) return;
    const timer = setTimeout(() => {
      // Cleared first so the flush's own `disarmFlushTimer` is a no-op rather
      // than clearing a handle that has already fired.
      this.flushTimer = null;
      this.flush();
    }, FLUSH_INTERVAL_MS);
    // Same defect class as commit 5dc525f02: a ref'd timer on a 250 ms loop
    // keeps the CLI's event loop alive after the work is done.
    (timer as unknown as { unref?: () => void }).unref?.();
    this.flushTimer = timer;
  }

  private disarmFlushTimer(): void {
    if (this.flushTimer === null) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  /** Cached `prepare`. See {@link ObservationQueueStore.statements}. */
  private statement(db: SqliteDatabase, sql: string): SqliteStatement {
    if (db !== this.cachedDb) {
      this.statements.clear();
      this.cachedDb = db;
    }
    let stmt = this.statements.get(sql);
    if (stmt === undefined) {
      stmt = db.prepare(sql);
      this.statements.set(sql, stmt);
    }
    return stmt;
  }

  onCapture(listener: ObservationCaptureListener): { dispose: () => void } {
    this.captureListeners.add(listener);
    return {
      dispose: () => {
        this.captureListeners.delete(listener);
      },
    };
  }

  private emitCapture(event: ObservationCaptureEvent): void {
    for (const listener of this.captureListeners) {
      try {
        listener(event);
      } catch (err: unknown) {
        this.logger.warn(
          '[memory-curator] observation capture listener threw',
          {
            kind: event.kind,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }
  }

  /**
   * The unprocessed observations for a session, oldest first.
   *
   * Bounded twice over: by `limit` rows AND by `byteBudget` bytes of
   * `tool_response_text`. Rows are streamed with `iterate()` and the walk stops
   * as soon as the budget is met, so SQLite never converts the rows past the
   * cut into JS strings at all. The row that crosses the budget is INCLUDED —
   * an observation is either whole or absent, never half-read.
   */
  drainForSession(
    sessionId: string,
    limit = 500,
    byteBudget = OBSERVATION_DRAIN_BYTE_BUDGET,
  ): readonly ObservationDraftRow[] {
    this.flush();
    const clamped = Math.max(1, Math.min(2000, limit));
    const budget = Math.max(1, byteBudget);
    const stmt = this.statement(this.connection.db, DRAIN_SQL);

    const out: ObservationDraftRow[] = [];
    let bytes = 0;
    // `break` inside `for..of` calls the iterator's `return()`, which is what
    // releases better-sqlite3's statement — no manual close needed.
    for (const raw of stmt.iterate(
      sessionId,
      clamped,
    ) as Iterable<ObservationDraftDbRow>) {
      out.push(rowToDraft(raw));
      if (raw.tool_response_text !== null) {
        bytes += Buffer.byteLength(raw.tool_response_text, 'utf8');
      }
      if (bytes >= budget) break;
    }
    return out;
  }

  /**
   * Read-only accessor returning the most recent observation rows for a
   * session, regardless of `processed_at`. Used by `mem:getObservations`
   * to surface trailing context to the renderer without side-effects.
   */
  peekForSession(
    sessionId: string,
    limit = 50,
  ): readonly ObservationQueueRow[] {
    this.flush();
    const clamped = Math.max(1, Math.min(500, limit));
    const rows = this.statement(this.connection.db, PEEK_SQL).all(
      sessionId,
      clamped,
    ) as ObservationRow[];
    return rows.map(rowToObservation);
  }

  markProcessed(ids: readonly number[]): void {
    if (ids.length === 0) return;
    const now = Date.now();
    const db = this.connection.db;
    const stmt = this.statement(db, MARK_PROCESSED_SQL);
    const txn = db.transaction(((..._args: unknown[]) => {
      for (const id of ids) stmt.run(now, id);
    }) as (...args: unknown[]) => unknown);
    txn();
  }

  /**
   * Re-point every `observation_queue` row from `fromId` to `toId`.
   *
   * Called synchronously by `MemoryTriggerService.rekeySession` when the SDK
   * resolves a session's canonical UUID, so rows a residual tabId-bearing hook
   * path captured before the resolve become drainable by the UUID-keyed drain
   * (`drainForSession` filters `WHERE session_id = ?`, so an un-migrated row is
   * un-drainable AND un-reapable — `purgeOlderThan` only deletes rows that were
   * processed). TASK_2026_296 item 6, Part B.
   *
   * The leading {@link flush} is load-bearing, not hygiene: an observation
   * still sitting in the pending batch carries `fromId` in its bind params, and
   * an UPDATE cannot reach it. Flushing first puts it in the table where the
   * UPDATE below finds it.
   *
   * `observation_queue` carries **no UNIQUE constraint on `session_id`**
   * (migration `0016`: the only unique key is the `INTEGER PRIMARY KEY`), so a
   * plain `UPDATE` can never collide the way `skill_synthesis_queue`'s
   * `UNIQUE(session_id, stage)` can. Rows already under `toId` are simply
   * joined by the migrated ones; nothing is dropped and nothing is overwritten.
   *
   * NO id-shape predicate. A tabId is a UUID v4 (`TabId.create()`), so a
   * `LIKE 'tab\_%'` filter would match only the retired legacy format and is
   * wrong by construction — the ids are supplied by the caller, never guessed.
   *
   * Wrapped in a transaction so the statement commits as one unit even though
   * it is a single UPDATE; the surrounding rekey handler holds no `await`, so
   * the in-memory map migration and this write are not separated by a
   * suspension point.
   *
   * @returns the number of rows re-pointed.
   */
  backfillSessionId(fromId: string, toId: string): number {
    const from = blankToUndefined(fromId);
    const to = blankToUndefined(toId);
    if (from === undefined || to === undefined || from === to) return 0;

    this.flush();

    const db = this.connection.db;
    let changes = 0;
    // Explicit `BEGIN IMMEDIATE` rather than `db.transaction(...)`: the same
    // idiom `SkillQueueStore` uses, so both halves of a rekey commit the same
    // way, and so the write lock is taken up front when two hosts share
    // `~/.ptah/state/ptah.sqlite`.
    db.exec('BEGIN IMMEDIATE');
    try {
      changes = Number(this.statement(db, BACKFILL_SQL).run(to, from).changes);
      db.exec('COMMIT');
    } catch (error: unknown) {
      db.exec('ROLLBACK');
      this.logger.warn('[memory-curator] observation-queue rekey failed', {
        fromId: from,
        toId: to,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
    if (changes > 0) {
      this.logger.info('[memory-curator] observation-queue rows re-pointed', {
        fromId: from,
        toId: to,
        changes,
      });
    }
    return changes;
  }

  purgeOlderThan(thresholdMs: number): number {
    this.flush();
    const result = this.statement(this.connection.db, PURGE_SQL).run(
      thresholdMs,
    );
    return result.changes;
  }

  countUnprocessed(sessionId: string): number {
    this.flush();
    const row = this.statement(this.connection.db, COUNT_UNPROCESSED_SQL).get(
      sessionId,
    ) as { n: number } | undefined;
    return row?.n ?? 0;
  }
}
