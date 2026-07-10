import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import type { Logger } from '@ptah-extension/vscode-core';
import { sql as sql0005Gateway } from './0005_gateway';
import { sql as sql0006GatewayPairingCode } from './0006_gateway_pairing_code';
import { sql as sql0020GatewayBindingAllowListId } from './0020_gateway_binding_allow_list_id';
import { sql as sql0024GatewayConversations } from './0024_gateway_conversations';
import { sql as sql0028GatewayConversationWorkspaceRoot } from './0028_gateway_conversation_workspace_root';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0028-test-'));
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

describe('migration 0028_gateway_conversation_workspace_root — registry entry', () => {
  it('is registered as version 28, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((m) => m.version === 28);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0028_gateway_conversation_workspace_root');
    expect(entry?.sql).toBe(sql0028GatewayConversationWorkspaceRoot);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is the highest bundled version', () => {
    expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(28);
  });
});

describe('migration 0028_gateway_conversation_workspace_root — behavior (skipped without native)', () => {
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

  maybe('adds a nullable workspace_root TEXT column', () => {
    const db = openDb();
    try {
      seedGatewaySchema(db);
      db.exec(sql0024GatewayConversations);

      expect(() =>
        db.exec(sql0028GatewayConversationWorkspaceRoot),
      ).not.toThrow();

      const cols = db
        .prepare('PRAGMA table_info(gateway_conversations)')
        .all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
      }>;
      const byName = new Map(cols.map((c) => [c.name, c]));
      expect(byName.size).toBe(7);
      expect(byName.get('workspace_root')?.type).toBe('TEXT');
      expect(byName.get('workspace_root')?.notnull).toBe(0);
      expect(byName.get('workspace_root')?.dflt_value).toBeNull();
    } finally {
      db.close();
    }
  });

  maybe('existing 0024-era conversation rows read back NULL', () => {
    const db = openDb();
    try {
      seedGatewaySchema(db);
      seedBinding(db, {
        id: 'b-resident',
        chatId: 'chan-1',
        sessionId: 'session-1',
      });
      db.exec(sql0024GatewayConversations);
      db.prepare(
        `INSERT INTO gateway_conversations
           (id, binding_id, external_conversation_id, ptah_session_id, created_at, last_active_at)
         VALUES ('conv-thread', 'b-resident', 'thread-1', NULL, 1500, 1500)`,
      ).run();

      db.exec(sql0028GatewayConversationWorkspaceRoot);

      const rows = db
        .prepare(
          'SELECT external_conversation_id, ptah_session_id, workspace_root FROM gateway_conversations ORDER BY external_conversation_id',
        )
        .all() as Array<{
        external_conversation_id: string;
        ptah_session_id: string | null;
        workspace_root: string | null;
      }>;
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.workspace_root === null)).toBe(true);
      expect(
        rows.find((r) => r.external_conversation_id === 'default'),
      ).toEqual({
        external_conversation_id: 'default',
        ptah_session_id: 'session-1',
        workspace_root: null,
      });
    } finally {
      db.close();
    }
  });

  maybe('re-run is a no-op via the runner ledger', async () => {
    const db = openDb();
    try {
      seedGatewaySchema(db);
      db.exec(sql0024GatewayConversations);
      const runner = new SqliteMigrationRunner(
        db as unknown as SqliteDatabase,
        fakeLogger,
      );
      const migration28 = [
        {
          version: 28,
          name: '0028_gateway_conversation_workspace_root',
          sql: sql0028GatewayConversationWorkspaceRoot,
        },
      ];

      const first = await runner.applyAll(migration28);
      expect(first.appliedVersions).toEqual([28]);

      const second = await runner.applyAll(migration28);
      expect(second.appliedVersions).toEqual([]);
      expect(second.skippedVersions).toEqual([28]);
    } finally {
      db.close();
    }
  });
});
