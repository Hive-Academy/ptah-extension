/**
 * BindingStore — persistence layer for `gateway_bindings` (migration 0005).
 *
 * Wraps the shared `SqliteConnectionService` from
 * `@ptah-extension/persistence-sqlite`. All writes are synchronous (better-sqlite3).
 *
 * Approval gating contract:
 *   1. First inbound from an unknown `(platform, externalChatId)` →
 *      {@link upsertPending} returns a fresh binding with status `pending`
 *      and a 6-digit pairing code.
 *   2. RPC `gateway:approveBinding` flips the row to `approved` and clears
 *      the pairing code.
 *   3. While `pending`, GatewayService MUST NOT echo any inbound back to
 *      the agent — only acknowledge with the pairing code reply.
 */
import { inject, injectable } from 'tsyringe';
import { randomInt, randomUUID } from 'node:crypto';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import type {
  ApprovalStatus,
  BindingId,
  GatewayBinding,
  GatewayPlatform,
} from './types';

interface BindingRow {
  id: string;
  platform: GatewayPlatform;
  external_chat_id: string;
  display_name: string | null;
  approval_status: ApprovalStatus;
  ptah_session_id: string | null;
  workspace_root: string | null;
  pairing_code: string | null;
  created_at: number;
  approved_at: number | null;
  last_active_at: number | null;
}

const SELECT_COLS =
  'id, platform, external_chat_id, display_name, approval_status, ptah_session_id, ' +
  'workspace_root, pairing_code, created_at, approved_at, last_active_at';

@injectable()
export class BindingStore {
  constructor(
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly sqlite: SqliteConnectionService,
  ) {}

  /**
   * Locate an existing binding by composite natural key.
   */
  findByExternal(
    platform: GatewayPlatform,
    externalChatId: string,
  ): GatewayBinding | null {
    const row = this.sqlite.db
      .prepare(
        `SELECT ${SELECT_COLS} FROM gateway_bindings WHERE platform = ? AND external_chat_id = ?`,
      )
      .get(platform, externalChatId) as BindingRow | undefined;
    return row ? this.toBinding(row) : null;
  }

  findById(id: BindingId): GatewayBinding | null {
    const row = this.sqlite.db
      .prepare(`SELECT ${SELECT_COLS} FROM gateway_bindings WHERE id = ?`)
      .get(id) as BindingRow | undefined;
    return row ? this.toBinding(row) : null;
  }

  list(filter?: {
    platform?: GatewayPlatform;
    status?: ApprovalStatus;
  }): GatewayBinding[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter?.platform) {
      where.push('platform = ?');
      params.push(filter.platform);
    }
    if (filter?.status) {
      where.push('approval_status = ?');
      params.push(filter.status);
    }
    const sql =
      `SELECT ${SELECT_COLS} FROM gateway_bindings` +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY created_at DESC';
    const rows = this.sqlite.db.prepare(sql).all(...params) as BindingRow[];
    return rows.map((r) => this.toBinding(r));
  }

  /**
   * Upsert a pending binding for a previously-unknown sender. Returns the
   * existing row if one already exists (pending OR approved) — caller decides
   * whether to gate or forward based on `approvalStatus`.
   */
  upsertPending(args: {
    platform: GatewayPlatform;
    externalChatId: string;
    displayName?: string;
  }): GatewayBinding {
    const existing = this.findByExternal(args.platform, args.externalChatId);
    if (existing) {
      // Refresh last_active_at; preserve pairing code + status.
      this.sqlite.db
        .prepare('UPDATE gateway_bindings SET last_active_at = ? WHERE id = ?')
        .run(Date.now(), existing.id);
      return { ...existing, lastActiveAt: Date.now() };
    }
    const id = randomUUID();
    const now = Date.now();
    // SECURITY: pairing code authorizes a binding, so it MUST be sourced from
    // a CSPRNG. `Math.random()` is V8 xorshift128+ — not cryptographically
    // strong. `crypto.randomInt` draws uniformly from the requested range.
    const pairingCode = String(randomInt(100000, 1000000));
    this.sqlite.db
      .prepare(
        `INSERT INTO gateway_bindings (id, platform, external_chat_id, display_name, approval_status,
            ptah_session_id, workspace_root, pairing_code, created_at, approved_at, last_active_at)
         VALUES (?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, NULL, ?)`,
      )
      .run(
        id,
        args.platform,
        args.externalChatId,
        args.displayName ?? null,
        pairingCode,
        now,
        now,
      );
    const created = this.findById(id as BindingId);
    if (!created) {
      throw new Error('BindingStore.upsertPending: row vanished after insert');
    }
    return created;
  }

  approve(
    id: BindingId,
    ptahSessionId?: string,
    workspaceRoot?: string,
  ): GatewayBinding {
    const now = Date.now();
    this.sqlite.db
      .prepare(
        `UPDATE gateway_bindings
            SET approval_status = 'approved', approved_at = ?, ptah_session_id = ?,
                workspace_root = ?, pairing_code = NULL
          WHERE id = ?`,
      )
      .run(now, ptahSessionId ?? null, workspaceRoot ?? null, id);
    const updated = this.findById(id);
    if (!updated)
      throw new Error(`BindingStore.approve: binding ${id} not found`);
    return updated;
  }

  setStatus(id: BindingId, status: ApprovalStatus): GatewayBinding {
    this.sqlite.db
      .prepare(
        `UPDATE gateway_bindings SET approval_status = ?, last_active_at = ? WHERE id = ?`,
      )
      .run(status, Date.now(), id);
    const updated = this.findById(id);
    if (!updated)
      throw new Error(`BindingStore.setStatus: binding ${id} not found`);
    return updated;
  }

  touch(id: BindingId): void {
    this.sqlite.db
      .prepare('UPDATE gateway_bindings SET last_active_at = ? WHERE id = ?')
      .run(Date.now(), id);
  }

  private toBinding(row: BindingRow): GatewayBinding {
    return {
      id: row.id as BindingId,
      platform: row.platform,
      externalChatId: row.external_chat_id,
      displayName: row.display_name,
      approvalStatus: row.approval_status,
      ptahSessionId: row.ptah_session_id,
      workspaceRoot: row.workspace_root,
      pairingCode: row.pairing_code ?? null,
      createdAt: row.created_at,
      approvedAt: row.approved_at,
      lastActiveAt: row.last_active_at,
    };
  }
}
