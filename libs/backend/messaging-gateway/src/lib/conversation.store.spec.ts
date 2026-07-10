import 'reflect-metadata';

import { ConversationStore } from './conversation.store';
import { BindingStore } from './binding.store';
import { ConversationKey, type BindingId } from './types';
import {
  MIGRATIONS,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';

const SCHEMA_VERSIONS = [5, 6, 20, 24, 28];

interface NativeDb {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number };
  };
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

describe('ConversationKey.for', () => {
  it('2-arg output is unchanged from the legacy 2-segment form', () => {
    expect(ConversationKey.for('telegram', 'chat-1')).toBe('telegram:chat-1');
    expect(ConversationKey.for('slack', 'C123')).toBe('slack:C123');
  });

  it('3-arg appends the conversation segment', () => {
    expect(ConversationKey.for('discord', 'chan-1', 'thread-9')).toBe(
      'discord:chan-1:thread-9',
    );
  });

  it("never includes 'default' in the key", () => {
    expect(ConversationKey.for('discord', 'chan-1', 'default')).toBe(
      'discord:chan-1',
    );
  });
});

maybe('ConversationStore', () => {
  let db: NativeDb;
  let store: ConversationStore;
  let bindings: BindingStore;

  beforeEach(() => {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => NativeDb;
    db = new Database(':memory:');
    for (const version of SCHEMA_VERSIONS) {
      const migration = MIGRATIONS.find((m) => m.version === version);
      if (!migration?.sql) {
        throw new Error(`missing migration sql for version ${version}`);
      }
      db.exec(migration.sql);
    }
    const sqlite = { db } as unknown as SqliteConnectionService;
    store = new ConversationStore(sqlite);
    bindings = new BindingStore(sqlite);
  });

  afterEach(() => {
    db.close();
  });

  function seedBinding(externalChatId = 'chan-1'): BindingId {
    return bindings.upsertPending({
      platform: 'discord',
      externalChatId,
    }).id;
  }

  describe('resolveOrCreate', () => {
    it('creates a fresh row with a null session id and null workspace root', () => {
      const bindingId = seedBinding();
      const conversation = store.resolveOrCreate(bindingId, 'thread-1');

      expect(conversation.bindingId).toBe(bindingId);
      expect(conversation.externalConversationId).toBe('thread-1');
      expect(conversation.ptahSessionId).toBeNull();
      expect(conversation.workspaceRoot).toBeNull();
      expect(conversation.createdAt).toBeGreaterThan(0);
    });

    it('is idempotent under UNIQUE(binding_id, external_conversation_id)', () => {
      const bindingId = seedBinding();
      const first = store.resolveOrCreate(bindingId, 'thread-1');
      const second = store.resolveOrCreate(bindingId, 'thread-1');

      expect(second.id).toBe(first.id);
      expect(store.listByBinding(bindingId)).toHaveLength(1);
    });

    it('creates distinct rows per external conversation id', () => {
      const bindingId = seedBinding();
      const a = store.resolveOrCreate(bindingId, 'thread-1');
      const b = store.resolveOrCreate(bindingId, 'thread-2');

      expect(a.id).not.toBe(b.id);
      expect(store.listByBinding(bindingId)).toHaveLength(2);
    });

    it("never claims the 'default' row", () => {
      const bindingId = seedBinding();
      const fallback = store.resolveOrCreate(bindingId, 'default');
      store.setPtahSessionId(fallback.id, 'session-resident');

      const fresh = store.resolveOrCreate(bindingId, 'thread-1');

      expect(fresh.id).not.toBe(fallback.id);
      expect(fresh.ptahSessionId).toBeNull();
      expect(store.findByExternal(bindingId, 'default')?.id).toBe(fallback.id);
      expect(store.findByExternal(bindingId, 'default')?.ptahSessionId).toBe(
        'session-resident',
      );
    });
  });

  describe('resolveOrAdopt', () => {
    it('returns an existing row for a known external conversation id', () => {
      const bindingId = seedBinding();
      const existing = store.resolveOrCreate(bindingId, 'thread-1');

      const resolved = store.resolveOrAdopt(bindingId, 'thread-1');

      expect(resolved.id).toBe(existing.id);
      expect(store.listByBinding(bindingId)).toHaveLength(1);
    });

    it("claims the 'default' row exactly once, keeping its ptah_session_id", () => {
      const bindingId = seedBinding();
      const fallback = store.resolveOrCreate(bindingId, 'default');
      store.setPtahSessionId(fallback.id, 'session-resident');

      const adopted = store.resolveOrAdopt(bindingId, 'thread-1');

      expect(adopted.id).toBe(fallback.id);
      expect(adopted.externalConversationId).toBe('thread-1');
      expect(adopted.ptahSessionId).toBe('session-resident');
      expect(store.findByExternal(bindingId, 'default')).toBeNull();
    });

    it('gives a second unknown thread a FRESH row after adoption', () => {
      const bindingId = seedBinding();
      const fallback = store.resolveOrCreate(bindingId, 'default');
      store.setPtahSessionId(fallback.id, 'session-resident');

      const adopted = store.resolveOrAdopt(bindingId, 'thread-1');
      const fresh = store.resolveOrAdopt(bindingId, 'thread-2');

      expect(fresh.id).not.toBe(adopted.id);
      expect(fresh.externalConversationId).toBe('thread-2');
      expect(fresh.ptahSessionId).toBeNull();
      expect(store.listByBinding(bindingId)).toHaveLength(2);
    });

    it("inserts fresh when no 'default' row exists", () => {
      const bindingId = seedBinding();

      const conversation = store.resolveOrAdopt(bindingId, 'thread-1');

      expect(conversation.externalConversationId).toBe('thread-1');
      expect(conversation.ptahSessionId).toBeNull();
      expect(store.listByBinding(bindingId)).toHaveLength(1);
    });

    it("does not adopt another binding's 'default' row", () => {
      const bindingA = seedBinding('chan-a');
      const bindingB = seedBinding('chan-b');
      const fallbackA = store.resolveOrCreate(bindingA, 'default');

      const conversation = store.resolveOrAdopt(bindingB, 'thread-1');

      expect(conversation.id).not.toBe(fallbackA.id);
      expect(store.findByExternal(bindingA, 'default')?.id).toBe(fallbackA.id);
    });
  });

  describe('setPtahSessionId', () => {
    it('round-trips via findById and bumps last_active_at', () => {
      const bindingId = seedBinding();
      const conversation = store.resolveOrCreate(bindingId, 'thread-1');
      const sessionUuid = '11111111-2222-4333-8444-555555555555';

      const returned = store.setPtahSessionId(conversation.id, sessionUuid);

      expect(returned.ptahSessionId).toBe(sessionUuid);
      const reread = store.findById(conversation.id);
      expect(reread?.ptahSessionId).toBe(sessionUuid);
      expect(reread?.lastActiveAt ?? 0).toBeGreaterThanOrEqual(
        conversation.lastActiveAt ?? 0,
      );
    });

    it('throws when the conversation id is unknown', () => {
      const bindingId = seedBinding();
      store.resolveOrCreate(bindingId, 'thread-1');
      const fresh = store.resolveOrCreate(bindingId, 'thread-2');
      store.deleteByBinding(bindingId);

      expect(() => store.setPtahSessionId(fresh.id, 'session-x')).toThrow(
        /not found/,
      );
    });
  });

  describe('clearPtahSessionId', () => {
    it('sets ptah_session_id to NULL and bumps last_active_at', () => {
      const bindingId = seedBinding();
      const conversation = store.resolveOrCreate(bindingId, 'thread-1');
      store.setPtahSessionId(conversation.id, 'session-to-clear');
      expect(store.findById(conversation.id)?.ptahSessionId).toBe(
        'session-to-clear',
      );

      const returned = store.clearPtahSessionId(conversation.id);

      expect(returned.ptahSessionId).toBeNull();
      expect(store.findById(conversation.id)?.ptahSessionId).toBeNull();
    });

    it('is a no-op-safe clear when already null', () => {
      const bindingId = seedBinding();
      const conversation = store.resolveOrCreate(bindingId, 'thread-1');

      const returned = store.clearPtahSessionId(conversation.id);

      expect(returned.ptahSessionId).toBeNull();
    });

    it('throws when the conversation id is unknown', () => {
      const bindingId = seedBinding();
      const fresh = store.resolveOrCreate(bindingId, 'thread-2');
      store.deleteByBinding(bindingId);

      expect(() => store.clearPtahSessionId(fresh.id)).toThrow(/not found/);
    });
  });

  describe('setWorkspaceRoot', () => {
    it('pins the workspace root without touching the session link', () => {
      const bindingId = seedBinding();
      const conversation = store.resolveOrCreate(bindingId, 'thread-1');
      store.setPtahSessionId(conversation.id, 'session-kept');

      const returned = store.setWorkspaceRoot(conversation.id, 'D:/ws/alpha');

      expect(returned.workspaceRoot).toBe('D:/ws/alpha');
      expect(returned.ptahSessionId).toBe('session-kept');
      const reread = store.findById(conversation.id);
      expect(reread?.workspaceRoot).toBe('D:/ws/alpha');
      expect(reread?.ptahSessionId).toBe('session-kept');
    });

    it('throws when the conversation id is unknown', () => {
      const bindingId = seedBinding();
      const fresh = store.resolveOrCreate(bindingId, 'thread-1');
      store.deleteByBinding(bindingId);

      expect(() => store.setWorkspaceRoot(fresh.id, 'D:/ws/alpha')).toThrow(
        /not found/,
      );
    });
  });

  describe('setWorkspaceRootAndClearSession', () => {
    it('sets the root and clears the session link together', () => {
      const bindingId = seedBinding();
      const conversation = store.resolveOrCreate(bindingId, 'thread-1');
      store.setPtahSessionId(conversation.id, 'session-old');

      const returned = store.setWorkspaceRootAndClearSession(
        conversation.id,
        'D:/ws/beta',
      );

      expect(returned.workspaceRoot).toBe('D:/ws/beta');
      expect(returned.ptahSessionId).toBeNull();
      const reread = store.findById(conversation.id);
      expect(reread?.workspaceRoot).toBe('D:/ws/beta');
      expect(reread?.ptahSessionId).toBeNull();
    });

    it('is safe on a conversation with no session link', () => {
      const bindingId = seedBinding();
      const conversation = store.resolveOrCreate(bindingId, 'thread-1');

      const returned = store.setWorkspaceRootAndClearSession(
        conversation.id,
        'D:/ws/beta',
      );

      expect(returned.workspaceRoot).toBe('D:/ws/beta');
      expect(returned.ptahSessionId).toBeNull();
    });

    it('does not touch other conversations on the same binding', () => {
      const bindingId = seedBinding();
      const target = store.resolveOrCreate(bindingId, 'thread-1');
      const other = store.resolveOrCreate(bindingId, 'thread-2');
      store.setPtahSessionId(other.id, 'session-other');

      store.setWorkspaceRootAndClearSession(target.id, 'D:/ws/beta');

      const untouched = store.findById(other.id);
      expect(untouched?.workspaceRoot).toBeNull();
      expect(untouched?.ptahSessionId).toBe('session-other');
    });

    it('throws when the conversation id is unknown', () => {
      const bindingId = seedBinding();
      const fresh = store.resolveOrCreate(bindingId, 'thread-1');
      store.deleteByBinding(bindingId);

      expect(() =>
        store.setWorkspaceRootAndClearSession(fresh.id, 'D:/ws/beta'),
      ).toThrow(/not found/);
    });
  });

  describe('setPtahSessionIdAndWorkspaceRoot', () => {
    it('sets both fields atomically and bumps last_active_at', () => {
      const bindingId = seedBinding();
      const conversation = store.resolveOrCreate(bindingId, 'thread-1');
      db.prepare(
        'UPDATE gateway_conversations SET last_active_at = NULL WHERE id = ?',
      ).run(conversation.id);

      const returned = store.setPtahSessionIdAndWorkspaceRoot(
        conversation.id,
        'session-attached',
        'D:/ws/gamma',
      );

      expect(returned.ptahSessionId).toBe('session-attached');
      expect(returned.workspaceRoot).toBe('D:/ws/gamma');
      expect(returned.lastActiveAt).not.toBeNull();
      const reread = store.findById(conversation.id);
      expect(reread?.ptahSessionId).toBe('session-attached');
      expect(reread?.workspaceRoot).toBe('D:/ws/gamma');
    });

    it('throws when the conversation id is unknown', () => {
      const bindingId = seedBinding();
      const fresh = store.resolveOrCreate(bindingId, 'thread-1');
      store.deleteByBinding(bindingId);

      expect(() =>
        store.setPtahSessionIdAndWorkspaceRoot(
          fresh.id,
          'session-x',
          'D:/ws/gamma',
        ),
      ).toThrow(/not found/);
    });
  });

  describe('findBySessionId', () => {
    it('returns every conversation linked to the uuid across bindings', () => {
      const bindingA = seedBinding('chan-a');
      const bindingB = seedBinding('chan-b');
      const a = store.resolveOrCreate(bindingA, 'thread-1');
      const b = store.resolveOrCreate(bindingB, 'thread-2');
      const unrelated = store.resolveOrCreate(bindingA, 'thread-3');
      store.setPtahSessionId(a.id, 'session-shared');
      store.setPtahSessionId(b.id, 'session-shared');
      store.setPtahSessionId(unrelated.id, 'session-other');

      const owners = store.findBySessionId('session-shared');

      expect(owners.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    });

    it('returns an empty array for an unknown uuid', () => {
      const bindingId = seedBinding();
      store.resolveOrCreate(bindingId, 'thread-1');

      expect(store.findBySessionId('session-unknown')).toEqual([]);
    });
  });

  describe('touch', () => {
    it('updates last_active_at', () => {
      const bindingId = seedBinding();
      const conversation = store.resolveOrCreate(bindingId, 'thread-1');
      db.prepare(
        'UPDATE gateway_conversations SET last_active_at = NULL WHERE id = ?',
      ).run(conversation.id);

      store.touch(conversation.id);

      expect(store.findById(conversation.id)?.lastActiveAt).not.toBeNull();
    });
  });

  describe('deleteByBinding', () => {
    it("removes only the target binding's conversations", () => {
      const bindingA = seedBinding('chan-a');
      const bindingB = seedBinding('chan-b');
      store.resolveOrCreate(bindingA, 'thread-1');
      store.resolveOrCreate(bindingA, 'thread-2');
      const survivor = store.resolveOrCreate(bindingB, 'thread-3');

      store.deleteByBinding(bindingA);

      expect(store.listByBinding(bindingA)).toHaveLength(0);
      expect(store.listByBinding(bindingB).map((c) => c.id)).toEqual([
        survivor.id,
      ]);
    });
  });

  describe('listByBinding', () => {
    it('returns rows for the binding ordered by created_at', () => {
      const bindingId = seedBinding();
      const a = store.resolveOrCreate(bindingId, 'thread-1');
      const b = store.resolveOrCreate(bindingId, 'thread-2');
      db.prepare(
        'UPDATE gateway_conversations SET created_at = ? WHERE id = ?',
      ).run(a.createdAt - 1000, a.id);

      const listed = store.listByBinding(bindingId);

      expect(listed.map((c) => c.id)).toEqual([a.id, b.id]);
    });
  });
});
