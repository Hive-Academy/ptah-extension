import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import type { Logger } from '@ptah-extension/vscode-core';
import { sql as sql0005Gateway } from './0005_gateway';
import { sql as sql0006GatewayPairingCode } from './0006_gateway_pairing_code';
import { sql as sql0020GatewayBindingAllowListId } from './0020_gateway_binding_allow_list_id';
import { sql as sql0024GatewayConversations } from './0024_gateway_conversations';
import { sql as sql0038GatewayMessageTurnState } from './0038_gateway_message_turn_state';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-migr0038-test-'));
  return path.join(dir, 'ptah.db');
}

function seedGatewaySchema(db: DatabaseShape): void {
  db.exec(sql0005Gateway);
  db.exec(sql0006GatewayPairingCode);
  db.exec(sql0020GatewayBindingAllowListId);
}

function seedBinding(db: DatabaseShape, id: string): void {
  db.prepare(
    `INSERT INTO gateway_bindings
       (id, platform, external_chat_id, display_name, approval_status,
        ptah_session_id, workspace_root, pairing_code, allow_list_id,
        created_at, approved_at, last_active_at)
     VALUES (?, 'discord', 'chan-1', 'Chan', 'approved', NULL, '/ws', '123456', 'guild-1', 1000, 2000, 3000)`,
  ).run(id);
}

function seedMessage(
  db: DatabaseShape,
  args: { id: string; bindingId: string; direction: 'inbound' | 'outbound' },
): void {
  db.prepare(
    `INSERT INTO gateway_messages
       (id, binding_id, direction, external_msg_id, ptah_message_id, body, voice_path, created_at)
     VALUES (?, ?, ?, ?, NULL, 'hello', NULL, 1500)`,
    // NB: no template interpolation anywhere in this directory — the
    // `no-restricted-syntax` migration rule bans `${...}` in spec files too.
  ).run(args.id, args.bindingId, args.direction, 'ext-'.concat(args.id));
}

const fakeLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger;

describe('migration 0038_gateway_message_turn_state — registry entry', () => {
  it('is registered as version 38, plain sql, NOT vec-gated', () => {
    const entry = MIGRATIONS.find((m) => m.version === 38);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('0038_gateway_message_turn_state');
    expect(entry?.sql).toBe(sql0038GatewayMessageTurnState);
    expect(entry?.vecSql).toBeUndefined();
    expect(entry?.requiresVec).toBeUndefined();
    expect(entry?.run).toBeUndefined();
  });

  it('is the highest bundled version', () => {
    // Bumped to 40 when TASK_2026_322 appended
    // 0040_skill_candidate_workspace_root (39 for TASK_2026_296's
    // 0039_reap_orphaned_queue_rows; 38 was TASK_2026_277's own
    // 0038_gateway_message_turn_state). Tracks the current highest version and
    // moves forward with every appended migration (0027 → 0028 precedent).
    expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(40);
  });

  it('adds exactly the two columns TASK_2026_277 needs and nothing else', () => {
    // The spec deliberately scopes this migration to turn_state +
    // conversation_id; an index or a third column riding along here would be a
    // schema change nobody reviewed as part of the restart-recovery work.
    const added = sql0038GatewayMessageTurnState
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('--'));
    expect(added).toEqual([
      'ALTER TABLE gateway_messages ADD COLUMN turn_state TEXT;',
      'ALTER TABLE gateway_messages ADD COLUMN conversation_id TEXT;',
    ]);
  });
});

describe('migration 0038_gateway_message_turn_state — behavior (skipped without native)', () => {
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

  maybe('adds nullable turn_state and conversation_id TEXT columns', () => {
    const db = openDb();
    try {
      seedGatewaySchema(db);

      expect(() => db.exec(sql0038GatewayMessageTurnState)).not.toThrow();

      const cols = db
        .prepare('PRAGMA table_info(gateway_messages)')
        .all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
      }>;
      const byName = new Map(cols.map((c) => [c.name, c]));
      expect(byName.get('turn_state')?.type).toBe('TEXT');
      expect(byName.get('turn_state')?.notnull).toBe(0);
      expect(byName.get('turn_state')?.dflt_value).toBeNull();
      expect(byName.get('conversation_id')?.type).toBe('TEXT');
      expect(byName.get('conversation_id')?.notnull).toBe(0);
      expect(byName.get('conversation_id')?.dflt_value).toBeNull();
    } finally {
      db.close();
    }
  });

  maybe('existing message rows read back NULL for both columns', () => {
    const db = openDb();
    try {
      seedGatewaySchema(db);
      seedBinding(db, 'b-1');
      seedMessage(db, { id: 'm-in', bindingId: 'b-1', direction: 'inbound' });
      seedMessage(db, { id: 'm-out', bindingId: 'b-1', direction: 'outbound' });

      db.exec(sql0038GatewayMessageTurnState);

      const rows = db
        .prepare(
          'SELECT id, direction, turn_state, conversation_id FROM gateway_messages ORDER BY id',
        )
        .all() as Array<{
        id: string;
        direction: string;
        turn_state: string | null;
        conversation_id: string | null;
      }>;
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.turn_state === null)).toBe(true);
      expect(rows.every((r) => r.conversation_id === null)).toBe(true);
    } finally {
      db.close();
    }
  });

  maybe(
    'a legacy row stays invisible to the recovery sweep predicate; a queued row does not',
    () => {
      const db = openDb();
      try {
        seedGatewaySchema(db);
        seedBinding(db, 'b-1');
        seedMessage(db, {
          id: 'm-legacy',
          bindingId: 'b-1',
          direction: 'inbound',
        });
        db.exec(sql0038GatewayMessageTurnState);
        db.exec(sql0024GatewayConversations);

        // A post-migration inbound row, written the way MessageStore writes it.
        db.prepare(
          `INSERT INTO gateway_messages
             (id, binding_id, direction, external_msg_id, ptah_message_id, body, voice_path, created_at, turn_state, conversation_id)
           VALUES ('m-live', 'b-1', 'inbound', 'ext-live', NULL, 'hi', NULL, 1600, 'running', 'conv-1')`,
        ).run();

        const swept = db
          .prepare(
            `SELECT id FROM gateway_messages
              WHERE direction = 'inbound' AND turn_state IN ('queued','running')`,
          )
          .all() as Array<{ id: string }>;

        // NULL turn_state is not IN (...) in SQL three-valued logic, so the
        // legacy row can never be swept — which is why no backfill is needed.
        expect(swept.map((r) => r.id)).toEqual(['m-live']);
      } finally {
        db.close();
      }
    },
  );

  maybe('re-run is a no-op via the runner ledger', async () => {
    const db = openDb();
    try {
      seedGatewaySchema(db);
      const runner = new SqliteMigrationRunner(
        db as unknown as SqliteDatabase,
        fakeLogger,
      );
      const migration38 = [
        {
          version: 38,
          name: '0038_gateway_message_turn_state',
          sql: sql0038GatewayMessageTurnState,
        },
      ];

      const first = await runner.applyAll(migration38);
      expect(first.appliedVersions).toEqual([38]);

      // A bare ADD COLUMN is not idempotent on its own — re-running it throws
      // "duplicate column name". Exactly-once is the ledger's job (same
      // guarantee 0033's bare ADD COLUMNs depend on).
      const second = await runner.applyAll(migration38);
      expect(second.appliedVersions).toEqual([]);
      expect(second.skippedVersions).toEqual([38]);
    } finally {
      db.close();
    }
  });
});
