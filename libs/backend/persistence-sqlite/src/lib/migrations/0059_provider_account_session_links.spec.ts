import 'reflect-metadata';
import { sql as previousHeadSql } from './0058_provider_accounts';
import { sql } from './0059_provider_account_session_links';
import { MIGRATIONS } from './index';

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: (string | number | null)[]): unknown;
    all(...params: (string | number | null)[]): unknown[];
  };
  close(): void;
}

describe('migration 0059_provider_account_session_links', () => {
  let db: DatabaseShape;

  beforeEach(() => {
    // Match 0058's real SQLite seam: do not use the fake to prove constraints.
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => DatabaseShape;
    };
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(previousHeadSql);
  });

  afterEach(() => db.close());

  function binding(runId = 'run-0001', provider = 'claude'): void {
    db.prepare(`INSERT OR IGNORE INTO provider_account_profiles
      (profile_id, provider, label, canonical_route, route_fingerprint, created_at, updated_at)
      VALUES (?, ?, 'Work', ?, ?, 1, 1)`)
      .run(provider, provider, provider, provider);
    db.prepare(`INSERT INTO provider_account_run_bindings
      (run_id, provider, profile_id, route_revision, route_fingerprint,
       auth_epoch, identity_kind, created_at)
      VALUES (?, ?, ?, 0, ?, 0, 'unknown', 1)`)
      .run(runId, provider, provider, provider);
  }

  function attach(provider = 'claude', sdkSessionId = 'sdk-session-0001', runId = 'run-0001'): void {
    db.prepare(`INSERT INTO provider_account_session_links
      (provider, sdk_session_id, run_id, attached_at) VALUES (?, ?, ?, 1)`)
      .run(provider, sdkSessionId, runId);
  }

  it('registers 0059 immediately after 0058 as the maximum version', () => {
    const previousIndex = MIGRATIONS.findIndex((entry) => entry.version === 58);
    expect(MIGRATIONS[previousIndex + 1]).toEqual({
      version: 59,
      name: '0059_provider_account_session_links',
      sql,
    });
    expect(Math.max(...MIGRATIONS.map((entry) => entry.version))).toBe(64);
  });

  it('applies after 0058 without changing existing run bindings', () => {
    binding();
    const before = db.prepare('SELECT * FROM provider_account_run_bindings').all();
    db.exec(sql);
    for (const name of ['provider_account_session_links', 'idx_provider_account_session_links_run']) {
      expect(db.prepare('SELECT name FROM sqlite_schema WHERE name = ?').all(name)).toEqual([{ name }]);
    }
    expect(db.prepare('SELECT * FROM provider_account_session_links').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM provider_account_run_bindings').all()).toEqual(before);
    attach();
    expect(db.prepare('SELECT * FROM provider_account_session_links').all()).toEqual([{
      provider: 'claude',
      sdk_session_id: 'sdk-session-0001',
      run_id: 'run-0001',
      attached_at: 1,
    }]);
  });

  it('reapplies static DDL without changing session links', () => {
    db.exec(sql);
    binding();
    attach();
    const before = db.prepare('SELECT * FROM provider_account_session_links').all();
    db.exec(sql);
    expect(db.prepare('SELECT * FROM provider_account_session_links').all()).toEqual(before);
  });

  it('rejects a second run for the same provider and SDK session', () => {
    db.exec(sql);
    binding();
    binding('run-0002');
    attach();
    expect(() => attach('claude', 'sdk-session-0001', 'run-0002')).toThrow(/UNIQUE constraint failed/);
  });

  it('allows the same SDK session ID for distinct providers', () => {
    db.exec(sql);
    binding();
    binding('run-0002', 'codex');
    attach();
    attach('codex', 'sdk-session-0001', 'run-0002');
    expect(db.prepare('SELECT * FROM provider_account_session_links').all()).toHaveLength(2);
  });

  it('rejects a second SDK session for the same run', () => {
    db.exec(sql);
    binding();
    attach();
    expect(() => attach('claude', 'sdk-session-0002')).toThrow(/UNIQUE constraint failed/);
  });

  it('rejects an unknown run with foreign keys enabled', () => {
    db.exec(sql);
    expect(() => attach()).toThrow(/FOREIGN KEY constraint failed/);
  });
});
