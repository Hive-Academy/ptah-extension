import 'reflect-metadata';
import { sql as sessionOrganizationSql } from './0050_session_organization';
import { sql } from './0063_session_auto_links';
import { MIGRATIONS } from './index';

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: (string | number | null)[]): unknown;
    all(...params: (string | number | null)[]): unknown[];
  };
  close(): void;
}

interface ColumnRow {
  name: string;
}

interface NameRow {
  name: string;
}

describe('migration 0063_session_auto_links', () => {
  let db: DatabaseShape;

  beforeEach(() => {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => DatabaseShape;
    };
    db = new DatabaseSync(':memory:');
    db.exec(sessionOrganizationSql);
  });

  afterEach(() => db.close());

  function columns(table: string): string[] {
    return (
      db
        .prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid')
        .all(table) as ColumnRow[]
    ).map((row) => row.name);
  }

  function schemaNames(type: 'table' | 'index'): string[] {
    return (
      db
        .prepare('SELECT name FROM sqlite_master WHERE type = ? ORDER BY name')
        .all(type) as NameRow[]
    ).map((row) => row.name);
  }

  it('registers 0063 immediately after 0062 as the maximum version', () => {
    const previousIndex = MIGRATIONS.findIndex((entry) => entry.version === 62);
    expect(MIGRATIONS[previousIndex + 1]).toEqual({
      version: 63,
      name: '0063_session_auto_links',
      sql,
    });
    expect(Math.max(...MIGRATIONS.map((entry) => entry.version))).toBe(63);
    expect(sql).not.toContain('${');
  });

  it('adds the rule columns, both tables and the worktree index', () => {
    db.exec(sql);

    expect(columns('session_task_links')).toEqual(
      expect.arrayContaining(['auto_rule', 'auto_evidence']),
    );
    expect(columns('session_task_link_suppressions')).toEqual([
      'workspace_root',
      'session_id',
      'task_id',
      'created_at',
    ]);
    expect(columns('session_todo_progress')).toEqual([
      'workspace_root',
      'session_id',
      'done',
      'total',
      'in_progress',
      'updated_at',
    ]);
    expect(schemaNames('index')).toEqual(
      expect.arrayContaining([
        'idx_session_org_worktree',
        'idx_session_task_link_suppressions_session',
        'idx_session_todo_progress_session',
      ]),
    );
  });

  it('keeps existing links and reads their rule columns as NULL', () => {
    db.prepare(
      `INSERT INTO session_task_links
         (workspace_root, session_id, task_id, role, source, created_at)
       VALUES ('/ws', 's1', 'TASK_2026_001', 'primary', 'user', 1)`,
    ).run();

    db.exec(sql);

    expect(
      db
        .prepare(
          'SELECT task_id, source, auto_rule, auto_evidence FROM session_task_links',
        )
        .all(),
    ).toEqual([
      {
        task_id: 'TASK_2026_001',
        source: 'user',
        auto_rule: null,
        auto_evidence: null,
      },
    ]);
  });

  it('keys suppressions and todo progress by workspace and session', () => {
    db.exec(sql);
    const suppress = db.prepare(
      `INSERT INTO session_task_link_suppressions
         (workspace_root, session_id, task_id, created_at) VALUES (?, ?, ?, ?)`,
    );
    suppress.run('/ws', 's1', 'TASK_2026_001', 1);
    expect(() => suppress.run('/ws', 's1', 'TASK_2026_001', 2)).toThrow();

    const todo = db.prepare(
      `INSERT INTO session_todo_progress
         (workspace_root, session_id, done, total, in_progress, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    todo.run('/ws', 's1', 1, 3, 'Writing tests', 5);
    expect(() => todo.run('/ws', 's1', 2, 3, null, 6)).toThrow();
  });

  it('re-running only its CREATE statements is a no-op (IF NOT EXISTS)', () => {
    db.exec(sql);
    const creates = sql
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.startsWith('CREATE'));
    expect(creates.length).toBe(5);
    for (const statement of creates) {
      expect(() => db.exec(statement)).not.toThrow();
    }
  });
});
