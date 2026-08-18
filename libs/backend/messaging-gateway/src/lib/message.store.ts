/**
 * MessageStore — persistence for `gateway_messages`.
 *
 * Provider-retry dedup is enforced by the
 * `UNIQUE(binding_id, direction, external_msg_id)` constraint added in
 * migration 0005. The store catches the constraint violation and returns
 * `null` so caller (GatewayService) can ignore the duplicate without
 * breaking the inbound pipeline.
 *
 * Migration 0038 added `turn_state` + `conversation_id` (TASK_2026_277): an
 * inbound row now carries the durable state of the agent turn it drives, so a
 * turn that was in flight when the host process died is still visible on the
 * next boot instead of vanishing silently.
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
  GatewayConversationId,
  GatewayMessage,
  GatewayMessageId,
  GatewayTurnState,
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
  turn_state: GatewayTurnState | null;
  conversation_id: string | null;
}

const SELECT_COLS =
  'id, binding_id, direction, external_msg_id, ptah_message_id, body, voice_path, created_at, turn_state, conversation_id';

/**
 * Turn states that mean "this inbound message never reached a conclusion".
 * Both are only reachable while the owning process is alive, so finding one at
 * startup is proof the process died mid-turn.
 */
const UNFINISHED_TURN_STATES: readonly GatewayTurnState[] = [
  'queued',
  'running',
];

/**
 * An inbound row whose turn never finished, as found by the startup sweep.
 * `conversationId` is NULL for rows written before migration 0038.
 */
export interface UnfinishedInboundTurn {
  id: GatewayMessageId;
  bindingId: BindingId;
  conversationId: GatewayConversationId | null;
}

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
    /** Conversation the row belongs to — set for inbound, omitted for outbound. */
    conversationId?: GatewayConversationId | null;
    /** `'queued'` for inbound; omitted (NULL) for outbound. */
    turnState?: GatewayTurnState | null;
  }): GatewayMessage | null {
    const id = randomUUID();
    const createdAt = Date.now();
    const turnState = args.turnState ?? null;
    const conversationId = args.conversationId ?? null;
    try {
      this.sqlite.db
        .prepare(
          `INSERT INTO gateway_messages (id, binding_id, direction, external_msg_id, ptah_message_id, body, voice_path, created_at, turn_state, conversation_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          turnState,
          conversationId,
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
      turnState,
      conversationId,
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

  /**
   * Inbound rows still `'queued'` or `'running'` (TASK_2026_277). Called once
   * at startup: nothing can legitimately be in either state before the bridge
   * has run a single turn, so every row returned belongs to a turn the previous
   * process took to its grave.
   *
   * Rows written before migration 0038 have a NULL `turn_state` and are
   * therefore never returned — SQL's three-valued logic excludes NULL from
   * `IN (...)`, which is exactly why the migration needs no backfill.
   */
  listUnfinishedInboundTurns(): UnfinishedInboundTurn[] {
    const rows = this.sqlite.db
      .prepare(
        `SELECT id, binding_id, conversation_id FROM gateway_messages
          WHERE direction = 'inbound' AND turn_state IN (?, ?)
          ORDER BY created_at ASC`,
      )
      .all(...UNFINISHED_TURN_STATES) as Array<{
      id: string;
      binding_id: string;
      conversation_id: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id as GatewayMessageId,
      bindingId: r.binding_id as BindingId,
      conversationId:
        (r.conversation_id as GatewayConversationId | null) ?? null,
    }));
  }

  /**
   * Move rows to a terminal turn state. Written in ONE transaction so the
   * startup sweep either claims every interrupted row or none of them — a
   * partial claim would re-notify the survivors on the next boot.
   */
  markTurnState(
    ids: readonly GatewayMessageId[],
    state: GatewayTurnState,
  ): void {
    if (ids.length === 0) return;
    const stmt = this.sqlite.db.prepare(
      'UPDATE gateway_messages SET turn_state = ? WHERE id = ?',
    );
    const txn = this.sqlite.db.transaction(() => {
      for (const id of ids) {
        stmt.run(state, id);
      }
    });
    txn();
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
      turnState: row.turn_state,
      conversationId:
        (row.conversation_id as GatewayConversationId | null) ?? null,
    };
  }
}
