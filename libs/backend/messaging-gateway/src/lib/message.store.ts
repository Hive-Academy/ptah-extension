/**
 * MessageStore — persistence for `gateway_messages`.
 *
 * Provider-retry dedup is enforced by the
 * `UNIQUE(binding_id, direction, external_msg_id)` constraint added in
 * migration 0005. The store catches the constraint violation and returns
 * `null` so caller (GatewayService) can ignore the duplicate without
 * breaking the inbound pipeline.
 */
import { inject, injectable } from 'tsyringe';
import { randomUUID } from 'node:crypto';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import {
  BindingId,
  Direction,
  GatewayMessage,
  GatewayMessageId,
} from './types';

interface MessageRow {
  id: string;
  binding_id: string;
  direction: Direction;
  external_msg_id: string | null;
  ptah_message_id: string | null;
  body: string;
  voice_path: string | null;
  created_at: number;
}

const SELECT_COLS =
  'id, binding_id, direction, external_msg_id, ptah_message_id, body, voice_path, created_at';

@injectable()
export class MessageStore {
  constructor(
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly sqlite: SqliteConnectionService,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Insert a message row. Returns the inserted row, or `null` when the
   * unique constraint trips (provider retry).
   */
  insert(args: {
    bindingId: BindingId;
    direction: Direction;
    externalMsgId: string | null;
    body: string;
    voicePath?: string | null;
    ptahMessageId?: string | null;
  }): GatewayMessage | null {
    const id = randomUUID();
    const createdAt = Date.now();
    try {
      this.sqlite.db
        .prepare(
          `INSERT INTO gateway_messages (id, binding_id, direction, external_msg_id, ptah_message_id, body, voice_path, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          args.bindingId,
          args.direction,
          args.externalMsgId,
          args.ptahMessageId ?? null,
          args.body,
          args.voicePath ?? null,
          createdAt,
        );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNIQUE constraint failed/i.test(msg)) {
        this.logger.debug(
          '[gateway] dedup: dropping retry of external_msg_id',
          {
            bindingId: args.bindingId,
            externalMsgId: args.externalMsgId,
          },
        );
        return null;
      }
      throw err;
    }
    return {
      id: id as GatewayMessageId,
      bindingId: args.bindingId,
      direction: args.direction,
      externalMsgId: args.externalMsgId,
      ptahMessageId: args.ptahMessageId ?? null,
      body: args.body,
      voicePath: args.voicePath ?? null,
      createdAt,
    };
  }

  list(args: {
    bindingId: BindingId;
    limit?: number;
    before?: number;
  }): GatewayMessage[] {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 500);
    const before = args.before ?? Date.now();
    const rows = this.sqlite.db
      .prepare(
        `SELECT ${SELECT_COLS} FROM gateway_messages
          WHERE binding_id = ? AND created_at < ?
          ORDER BY created_at DESC LIMIT ?`,
      )
      .all(args.bindingId, before, limit) as MessageRow[];
    return rows.map((r) => this.toMessage(r));
  }

  /** Voice file paths older than `cutoffMs`. Used by the 7-day GC sweep. */
  listVoicePathsOlderThan(cutoffMs: number): string[] {
    const rows = this.sqlite.db
      .prepare(
        `SELECT voice_path FROM gateway_messages WHERE voice_path IS NOT NULL AND created_at < ?`,
      )
      .all(cutoffMs) as Array<{ voice_path: string }>;
    return rows.map((r) => r.voice_path);
  }

  private toMessage(row: MessageRow): GatewayMessage {
    return {
      id: row.id as GatewayMessageId,
      bindingId: row.binding_id as BindingId,
      direction: row.direction,
      externalMsgId: row.external_msg_id,
      ptahMessageId: row.ptah_message_id,
      body: row.body,
      voicePath: row.voice_path,
      createdAt: row.created_at,
    };
  }
}
