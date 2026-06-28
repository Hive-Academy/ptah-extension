import { inject, injectable } from 'tsyringe';
import { randomUUID } from 'node:crypto';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import type {
  BindingId,
  GatewayConversation,
  GatewayConversationId,
} from './types';

interface ConversationRow {
  id: string;
  binding_id: string;
  external_conversation_id: string;
  ptah_session_id: string | null;
  created_at: number;
  last_active_at: number | null;
}

const SELECT_COLS =
  'id, binding_id, external_conversation_id, ptah_session_id, created_at, last_active_at';

@injectable()
export class ConversationStore {
  constructor(
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly sqlite: SqliteConnectionService,
  ) {}

  findById(id: GatewayConversationId): GatewayConversation | null {
    const row = this.sqlite.db
      .prepare(`SELECT ${SELECT_COLS} FROM gateway_conversations WHERE id = ?`)
      .get(id) as ConversationRow | undefined;
    return row ? this.toConversation(row) : null;
  }

  findByExternal(
    bindingId: BindingId,
    externalConversationId: string,
  ): GatewayConversation | null {
    const row = this.sqlite.db
      .prepare(
        `SELECT ${SELECT_COLS} FROM gateway_conversations WHERE binding_id = ? AND external_conversation_id = ?`,
      )
      .get(bindingId, externalConversationId) as ConversationRow | undefined;
    return row ? this.toConversation(row) : null;
  }

  listByBinding(bindingId: BindingId): GatewayConversation[] {
    const rows = this.sqlite.db
      .prepare(
        `SELECT ${SELECT_COLS} FROM gateway_conversations WHERE binding_id = ? ORDER BY created_at ASC`,
      )
      .all(bindingId) as ConversationRow[];
    return rows.map((r) => this.toConversation(r));
  }

  resolveOrCreate(
    bindingId: BindingId,
    externalConversationId: string,
  ): GatewayConversation {
    const txn = this.sqlite.db.transaction(() => {
      const existing = this.findByExternal(bindingId, externalConversationId);
      if (existing) return existing;
      return this.insert(bindingId, externalConversationId);
    });
    return txn();
  }

  resolveOrAdopt(
    bindingId: BindingId,
    externalConversationId: string,
  ): GatewayConversation {
    const txn = this.sqlite.db.transaction(() => {
      const existing = this.findByExternal(bindingId, externalConversationId);
      if (existing) return existing;
      const fallback = this.findByExternal(bindingId, 'default');
      if (fallback) {
        this.sqlite.db
          .prepare(
            'UPDATE gateway_conversations SET external_conversation_id = ?, last_active_at = ? WHERE id = ?',
          )
          .run(externalConversationId, Date.now(), fallback.id);
        const adopted = this.findById(fallback.id);
        if (!adopted) {
          throw new Error(
            `ConversationStore.resolveOrAdopt: conversation ${fallback.id} vanished during adoption`,
          );
        }
        return adopted;
      }
      return this.insert(bindingId, externalConversationId);
    });
    return txn();
  }

  setPtahSessionId(
    id: GatewayConversationId,
    ptahSessionId: string,
  ): GatewayConversation {
    this.sqlite.db
      .prepare(
        'UPDATE gateway_conversations SET ptah_session_id = ?, last_active_at = ? WHERE id = ?',
      )
      .run(ptahSessionId, Date.now(), id);
    const updated = this.findById(id);
    if (!updated) {
      throw new Error(
        `ConversationStore.setPtahSessionId: conversation ${id} not found`,
      );
    }
    return updated;
  }

  /**
   * Clear the session link on a conversation (SET ptah_session_id = NULL) and
   * bump `last_active_at`. Used by the gateway detach flow — detach CLEARS the
   * link (no continuity flag, no "stop resuming" branch).
   */
  clearPtahSessionId(id: GatewayConversationId): GatewayConversation {
    this.sqlite.db
      .prepare(
        'UPDATE gateway_conversations SET ptah_session_id = NULL, last_active_at = ? WHERE id = ?',
      )
      .run(Date.now(), id);
    const updated = this.findById(id);
    if (!updated) {
      throw new Error(
        `ConversationStore.clearPtahSessionId: conversation ${id} not found`,
      );
    }
    return updated;
  }

  touch(id: GatewayConversationId): void {
    this.sqlite.db
      .prepare(
        'UPDATE gateway_conversations SET last_active_at = ? WHERE id = ?',
      )
      .run(Date.now(), id);
  }

  deleteByBinding(bindingId: BindingId): void {
    this.sqlite.db
      .prepare('DELETE FROM gateway_conversations WHERE binding_id = ?')
      .run(bindingId);
  }

  private insert(
    bindingId: BindingId,
    externalConversationId: string,
  ): GatewayConversation {
    const id = randomUUID();
    const now = Date.now();
    this.sqlite.db
      .prepare(
        `INSERT INTO gateway_conversations (id, binding_id, external_conversation_id, ptah_session_id, created_at, last_active_at)
         VALUES (?, ?, ?, NULL, ?, ?)`,
      )
      .run(id, bindingId, externalConversationId, now, now);
    const created = this.findById(id as GatewayConversationId);
    if (!created) {
      throw new Error('ConversationStore.insert: row vanished after insert');
    }
    return created;
  }

  private toConversation(row: ConversationRow): GatewayConversation {
    return {
      id: row.id as GatewayConversationId,
      bindingId: row.binding_id as BindingId,
      externalConversationId: row.external_conversation_id,
      ptahSessionId: row.ptah_session_id,
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
    };
  }
}
