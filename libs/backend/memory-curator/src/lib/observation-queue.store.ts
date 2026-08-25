/**
 * ObservationQueueStore — typed CRUD over the `observation_queue` table.
 *
 * Captures hook-side observations (PreToolUse Read, PostToolUse, ToolFailure,
 * Stop, UserPromptSubmit) BEFORE the cue-match/threshold gates inside
 * `MemoryTriggerService`, then drained inside `invokeCurate` to compose the
 * curator transcript. Rows are marked processed only on curator success.
 */
import { inject, injectable } from 'tsyringe';
import { blankToUndefined } from '@ptah-extension/shared';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
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

/** Maximum byte length of `tool_response_text` retained at insert time. */
export const OBSERVATION_TOOL_RESPONSE_MAX_BYTES = 16 * 1024;

/**
 * Capture event published when a new row is successfully inserted. Designed
 * to be broadcast as `MESSAGE_TYPES.MEMORY_OBSERVATION_CAPTURED` without any
 * further mapping — matches `MemoryObservationCapturedPayload` from
 * `@ptah-extension/shared`.
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

function truncateUtf8(
  value: string | null | undefined,
  maxBytes: number,
): string | null {
  if (value === null || value === undefined) return null;
  const buf = Buffer.from(value, 'utf8');
  if (buf.byteLength <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8');
}

@injectable()
export class ObservationQueueStore {
  private readonly captureListeners = new Set<ObservationCaptureListener>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  /**
   * Capture one observation.
   *
   * A row whose `sessionId` is empty is refused rather than written, because
   * such a row is UN-DRAINABLE and UN-REAPABLE by construction: every read path
   * here filters `WHERE session_id = ?` and nothing ever queries `''`, so it is
   * never drained, never marked processed, and `purgeOlderThan` only deletes
   * rows that WERE processed. It would sit in the table forever, counted by
   * `countUnprocessed` for a session that cannot be curated.
   */
  insert(row: ObservationQueueInsert): void {
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
        '[memory-curator] observation-queue insert skipped — empty sessionId',
        { kind: row.kind, workspaceRoot: row.workspaceRoot },
      );
      return;
    }
    const db = this.connection.db;
    const stmt = db.prepare(
      `INSERT INTO observation_queue
         (session_id, workspace_root, prompt_number, kind, tool_name,
          tool_input_json, tool_response_text, assistant_message, user_prompt,
          file_path, captured_at, processed_at)
       VALUES (@session_id, @workspace_root, @prompt_number, @kind, @tool_name,
               @tool_input_json, @tool_response_text, @assistant_message, @user_prompt,
               @file_path, @captured_at, NULL)`,
    );
    const capturedAt = Date.now();
    try {
      stmt.run({
        session_id: sessionId,
        workspace_root: row.workspaceRoot,
        prompt_number: row.promptNumber ?? null,
        kind: row.kind,
        tool_name: row.toolName ?? null,
        tool_input_json: row.toolInputJson ?? null,
        tool_response_text: truncateUtf8(
          row.toolResponseText,
          OBSERVATION_TOOL_RESPONSE_MAX_BYTES,
        ),
        assistant_message: row.assistantMessage ?? null,
        user_prompt: row.userPrompt ?? null,
        file_path: row.filePath ?? null,
        captured_at: capturedAt,
      });
    } catch (error: unknown) {
      this.logger.warn('[memory-curator] observation-queue insert failed', {
        kind: row.kind,
        sessionId: row.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    this.emitCapture({
      sessionId: row.sessionId,
      workspaceRoot: row.workspaceRoot,
      kind: row.kind,
      timestamp: capturedAt,
    });
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

  drainForSession(
    sessionId: string,
    limit = 500,
  ): readonly ObservationQueueRow[] {
    const clamped = Math.max(1, Math.min(2000, limit));
    const rows = this.connection.db
      .prepare(
        `SELECT * FROM observation_queue
         WHERE session_id = ? AND processed_at IS NULL
         ORDER BY captured_at ASC, id ASC
         LIMIT ?`,
      )
      .all(sessionId, clamped) as ObservationRow[];
    return rows.map(rowToObservation);
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
    const clamped = Math.max(1, Math.min(500, limit));
    const rows = this.connection.db
      .prepare(
        `SELECT * FROM observation_queue
         WHERE session_id = ?
         ORDER BY captured_at DESC, id DESC
         LIMIT ?`,
      )
      .all(sessionId, clamped) as ObservationRow[];
    return rows.map(rowToObservation);
  }

  markProcessed(ids: readonly number[]): void {
    if (ids.length === 0) return;
    const now = Date.now();
    const db = this.connection.db;
    const stmt = db.prepare(
      `UPDATE observation_queue SET processed_at = ? WHERE id = ?`,
    );
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

    const db = this.connection.db;
    let changes = 0;
    // Explicit `BEGIN IMMEDIATE` rather than `db.transaction(...)`: the same
    // idiom `SkillQueueStore` uses, so both halves of a rekey commit the same
    // way, and so the write lock is taken up front when two hosts share
    // `~/.ptah/state/ptah.sqlite`.
    db.exec('BEGIN IMMEDIATE');
    try {
      changes = Number(
        db
          .prepare(
            `UPDATE observation_queue SET session_id = ? WHERE session_id = ?`,
          )
          .run(to, from).changes,
      );
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
    const result = this.connection.db
      .prepare(
        `DELETE FROM observation_queue WHERE captured_at < ? AND processed_at IS NOT NULL`,
      )
      .run(thresholdMs);
    return result.changes;
  }

  countUnprocessed(sessionId: string): number {
    const row = this.connection.db
      .prepare(
        `SELECT COUNT(*) AS n FROM observation_queue WHERE session_id = ? AND processed_at IS NULL`,
      )
      .get(sessionId) as { n: number } | undefined;
    return row?.n ?? 0;
  }
}
