/**
 * BindingStore — unit tests against a real in-memory better-sqlite3
 * database. Skipped automatically when the native module is not available
 * in the test environment (mirrors the migration specs).
 */
import 'reflect-metadata';

import { BindingStore } from './binding.store';
import type { BindingId, GatewayPlatform } from './types';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';

const SCHEMA = `
CREATE TABLE gateway_bindings (
  id              TEXT PRIMARY KEY,
  platform        TEXT NOT NULL CHECK (platform IN ('telegram','discord','slack')),
  external_chat_id TEXT NOT NULL,
  allow_list_id   TEXT,
  display_name    TEXT,
  approval_status TEXT NOT NULL CHECK (approval_status IN ('pending','approved','rejected','revoked')) DEFAULT 'pending',
  ptah_session_id TEXT,
  workspace_root  TEXT,
  pairing_code    TEXT,
  created_at      INTEGER NOT NULL,
  approved_at     INTEGER,
  last_active_at  INTEGER,
  UNIQUE(platform, external_chat_id)
);
`;

interface NativeDb {
  exec(sql: string): void;
  close(): void;
}

let nativeAvailable = false;
try {
  require.resolve('better-sqlite3');
  const Database = require('better-sqlite3') as new (file: string) => NativeDb;
  const probe = new Database(':memory:');
  probe.close();
  nativeAvailable = true;
} catch {
  nativeAvailable = false;
}

const maybe = nativeAvailable ? describe : describe.skip;

maybe('BindingStore', () => {
  let db: NativeDb;
  let store: BindingStore;

  beforeEach(() => {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => NativeDb;
    db = new Database(':memory:');
    db.exec(SCHEMA);
    store = new BindingStore({
      db,
    } as unknown as SqliteConnectionService);
  });

  afterEach(() => {
    db.close();
  });

  function seed(platform: GatewayPlatform, externalChatId: string): BindingId {
    const binding = store.upsertPending({ platform, externalChatId });
    return binding.id;
  }

  it('persists allowListId on insert and round-trips it via findById', () => {
    const created = store.upsertPending({
      platform: 'discord',
      externalChatId: 'chan-1',
      allowListId: 'guild-9',
    });
    expect(created.allowListId).toBe('guild-9');
    expect(store.findById(created.id)?.allowListId).toBe('guild-9');
  });

  it('defaults allowListId to null when not provided', () => {
    const id = seed('telegram', 'chat-2');
    expect(store.findById(id)?.allowListId).toBeNull();
  });

  it('backfills a null allowListId on a later inbound that carries one', () => {
    const first = store.upsertPending({
      platform: 'discord',
      externalChatId: 'chan-2',
    });
    expect(first.allowListId).toBeNull();

    const second = store.upsertPending({
      platform: 'discord',
      externalChatId: 'chan-2',
      allowListId: 'guild-7',
    });
    expect(second.allowListId).toBe('guild-7');
    expect(store.findById(first.id)?.allowListId).toBe('guild-7');
  });

  describe('setWorkspaceRoot', () => {
    it('updates only workspace_root and last_active_at, leaving status/session/code intact', () => {
      const id = seed('telegram', 'chat-ws');
      const approved = store.approve(id, 'session-abc', '/old/root');
      expect(approved.approvalStatus).toBe('approved');
      expect(approved.pairingCode).toBeNull();

      const updated = store.setWorkspaceRoot(id, '/new/root');

      expect(updated.workspaceRoot).toBe('/new/root');
      // status, session id, and pairing code must be untouched
      expect(updated.approvalStatus).toBe('approved');
      expect(updated.ptahSessionId).toBe('session-abc');
      expect(updated.pairingCode).toBeNull();
      expect(store.findById(id)?.workspaceRoot).toBe('/new/root');
    });

    it('throws when the binding id is unknown', () => {
      expect(() =>
        store.setWorkspaceRoot('missing' as BindingId, '/x'),
      ).toThrow(/not found/);
    });
  });
});
