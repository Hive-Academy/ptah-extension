import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import type { Logger } from '@ptah-extension/vscode-core';
import { sql as sql0005Gateway } from './0005_gateway';
import { sql as sql0006GatewayPairingCode } from './0006_gateway_pairing_code';
import { sql as sql0020GatewayBindingAllowListId } from './0020_gateway_binding_allow_list_id';
import { sql as sql0024GatewayConversations } from './0024_gateway_conversations';
import { MIGRATIONS } from './index';
import { SqliteMigrationRunner } from '../migration-runner';
import type { SqliteDatabase } from '../sqlite-connection.service';

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number };
  };
  close(): void;
}

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0024-test-'));
  return path.join(dir, 'ptah.db');
}

function seedGatewaySchema(db: DatabaseShape): void {
  db.exec(sql0005Gateway);
  db.exec(sql0006GatewayPairingCode);
  db.exec(sql0020GatewayBindingAllowListId);
}

function seedBinding(
  db: DatabaseShape,
  args: { id: string; chatId: string; sessionId: string | null },
): void {
  db.prepare(
    `INSERT INTO gateway_bindings
       (id, platform, external_chat_id, display_name, approval_status,
        ptah_session_id, workspace_root, pairing_code, allow_list_id,
        created_at, approved_at, last_active_at)
     VALUES (?, 'discord', ?, 'Chan', 'approved', ?, '/ws', '123456', 'guild-1', 1000, 2000, 3000)`,
  ).run(args.id, args.chatId, args.sessionId);
}

const fakeLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

describe('migration 0024_gateway_conversations — registry entry', () => {
  it('is registered as version 24, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((m) => m.version === 24);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0024_gateway_conversations');
    expect(entry?.sql).toBe(sql0024GatewayConversations);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is the highest bundled version', () => {
    expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(24);
  });
});

describe('migration 0024_gateway_conversations — behavior (skipped without native)', () => {
  let nativeAvailable = false;
  try {
    require.resolve('better-sqlite3');
    const Database = require('better-sqlite3') as new (file: string) => {
      close(): void;
    };
    const probe = new Database(':memory:');
    probe.close();
    nativeAvailable = true;
  } catch {
    nativeAvailable = false;
  }

  const maybe = nativeAvailable ? it : it.skip;

  function openDb(): DatabaseShape {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => DatabaseShape;
    return new Database(makeTempDbPath());
  }

  maybe('applies cleanly on a database at the 0020 gateway schema', () => {
    const db = openDb();
    try {
      seedGatewaySchema(db);
      expect(() => db.exec(sql0024GatewayConversations)).not.toThrow();
      const cols = db
        .prepare('PRAGMA table_info(gateway_conversations)')
        .all() as Array<{ name: string; type: string; notnull: number }>;
      const byName = new Map(cols.map((c) => [c.name, c]));
      expect(byName.size).toBe(6);
      expect(byName.get('id')?.type).toBe('TEXT');
      expect(byName.get('binding_id')?.notnull).toBe(1);
      expect(byName.get('external_conversation_id')?.notnull).toBe(1);
      expect(byName.get('ptah_session_id')?.notnull).toBe(0);
      expect(byName.get('created_at')?.notnull).toBe(1);
      expect(byName.get('last_active_at')?.notnull).toBe(0);
    } finally {
      db.close();
    }
  });

  maybe(
    "backfills a 'default' row only for bindings with a non-NULL ptah_session_id",
    () => {
      const db = openDb();
      try {
        seedGatewaySchema(db);
        seedBinding(db, {
          id: 'b-resident',
          chatId: 'chan-1',
          sessionId: 'session-1',
        });
        seedBinding(db, { id: 'b-empty', chatId: 'chan-2', sessionId: null });

        db.exec(sql0024GatewayConversations);

        const rows = db
          .prepare(
            'SELECT binding_id, external_conversation_id, ptah_session_id, created_at, last_active_at FROM gateway_conversations',
          )
          .all() as Array<{
          binding_id: string;
          external_conversation_id: string;
          ptah_session_id: string | null;
          created_at: number;
          last_active_at: number | null;
        }>;
        expect(rows).toHaveLength(1);
        expect(rows[0].binding_id).toBe('b-resident');
        expect(rows[0].external_conversation_id).toBe('default');
        expect(rows[0].ptah_session_id).toBe('session-1');
        expect(rows[0].created_at).toBe(1000);
        expect(rows[0].last_active_at).toBe(3000);
      } finally {
        db.close();
      }
    },
  );

  maybe('leaves gateway_bindings rows and columns untouched', () => {
    const db = openDb();
    try {
      seedGatewaySchema(db);
      seedBinding(db, {
        id: 'b-resident',
        chatId: 'chan-1',
        sessionId: 'session-1',
      });
      const before = db.prepare('SELECT * FROM gateway_bindings').all();

      db.exec(sql0024GatewayConversations);

      expect(db.prepare('SELECT * FROM gateway_bindings').all()).toEqual(
        before,
      );
      const cols = db
        .prepare('PRAGMA table_info(gateway_bindings)')
        .all() as Array<{ name: string }>;
      expect(cols.map((c) => c.name)).toContain('pairing_code');
      expect(cols.map((c) => c.name)).toContain('ptah_session_id');
    } finally {
      db.close();
    }
  });

  maybe('re-run is a no-op via the runner ledger', async () => {
    const db = openDb();
    try {
      seedGatewaySchema(db);
      seedBinding(db, {
        id: 'b-resident',
        chatId: 'chan-1',
        sessionId: 'session-1',
      });
      const runner = new SqliteMigrationRunner(
        db as unknown as SqliteDatabase,
        fakeLogger,
      );
      const migration24 = [
        {
          version: 24,
          name: '0024_gateway_conversations',
          sql: sql0024GatewayConversations,
        },
      ];

      const first = await runner.applyAll(migration24);
      expect(first.appliedVersions).toEqual([24]);

      const second = await runner.applyAll(migration24);
      expect(second.appliedVersions).toEqual([]);
      expect(second.skippedVersions).toEqual([24]);

      const count = db
        .prepare('SELECT COUNT(*) AS n FROM gateway_conversations')
        .get() as { n: number };
      expect(count.n).toBe(1);
    } finally {
      db.close();
    }
  });
});
