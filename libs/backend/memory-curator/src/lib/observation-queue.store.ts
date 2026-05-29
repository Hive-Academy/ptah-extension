/**
 * ObservationQueueStore — typed CRUD over the `observation_queue` table.
 *
 * Captures hook-side observations (PreToolUse Read, PostToolUse, ToolFailure,
 * Stop, UserPromptSubmit) BEFORE the cue-match/threshold gates inside
 * `MemoryTriggerService`, then drained inside `invokeCurate` to compose the
 * curator transcript. Rows are marked processed only on curator success.
 */
import { inject, injectable } from 'tsyringe';
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
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  insert(row: ObservationQueueInsert): void {
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
    try {
      stmt.run({
        session_id: row.sessionId,
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
        captured_at: Date.now(),
      });
    } catch (error: unknown) {
      this.logger.warn('[memory-curator] observation-queue insert failed', {
        kind: row.kind,
        sessionId: row.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
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
