/**
 * BindingStore.setPtahSessionId — unit tests against a real in-memory
 * better-sqlite3 database. Skipped automatically when the native module is
 * not available in the test environment (mirrors the migration specs).
 */
import 'reflect-metadata';

import { BindingStore } from './binding.store';
import { BindingId, type GatewayPlatform } from './types';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';

const SCHEMA = `
CREATE TABLE gateway_bindings (
  id              TEXT PRIMARY KEY,
  platform        TEXT NOT NULL CHECK (platform IN ('telegram','discord','slack')),
  external_chat_id TEXT NOT NULL,
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

maybe('BindingStore.setPtahSessionId', () => {
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

  it('updates ptah_session_id and last_active_at, round-trips via findById', () => {
    const id = seed('telegram', 'chat-1');
    const before = store.findById(id);
    const sessionUuid = '11111111-2222-4333-8444-555555555555';

    const returned = store.setPtahSessionId(id, sessionUuid);

    expect(returned.ptahSessionId).toBe(sessionUuid);
    const reread = store.findById(id);
    expect(reread?.ptahSessionId).toBe(sessionUuid);
    expect(reread?.lastActiveAt).not.toBeNull();
    expect(reread?.lastActiveAt ?? 0).toBeGreaterThanOrEqual(
      before?.lastActiveAt ?? 0,
    );
  });

  it('throws when the binding id is unknown', () => {
    expect(() =>
      store.setPtahSessionId(BindingId.create('does-not-exist'), 'session-x'),
    ).toThrow(/not found/);
  });
});
