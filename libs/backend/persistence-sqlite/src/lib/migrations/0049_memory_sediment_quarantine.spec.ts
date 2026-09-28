/**
 * Migration 0049 — one-time R4 quarantine (`rule:commitlint-scope-facts`).
 *
 * Seeds every fixture listed in quarantine-rules.md r2 section 6 (2 positive,
 * 13 durable, 3 guard) on the real schema lineage, in isolated in-memory
 * databases. This spec never opens a user database or a pre-migration
 * snapshot, and fails instead of skipping when neither SQLite binding loads.
 *
 * The event fixtures stay even though r2 has no event rule: they pin that 0049
 * never touches events, so a future rule edit cannot bring the r0/r1 losses back.
 */
import 'reflect-metadata';
import { sql } from './0049_memory_sediment_quarantine';
import { MIGRATIONS } from './index';

interface StatementShape {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

interface DatabaseShape {
  exec(sql: string): void;
  prepare(sql: string): StatementShape;
  close(): void;
}

type DbOpener = () => DatabaseShape;

function resolveOpener(): DbOpener | null {
  try {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => DatabaseShape;
    new Database(':memory:').close();
    return () => new Database(':memory:');
  } catch {
    // Electron's native ABI may not load in Jest; fall through to node:sqlite.
  }
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => DatabaseShape;
    };
    new DatabaseSync(':memory:').close();
    return () => new DatabaseSync(':memory:');
  } catch {
    return null;
  }
}

const REASON = 'rule:commitlint-scope-facts';

/** quarantine-rules.md r2 section 5, verbatim. */
const COMMON_GUARD =
  "pinned = 0 AND tier <> 'core' AND NOT EXISTS (SELECT 1 FROM corpus_memories c WHERE c.memory_id = memories.id) AND quarantined_at IS NULL";
/** quarantine-rules.md r2 section 6 (R4), verbatim. */
const R4_PREDICATE =
  "kind = 'fact' AND TRIM(LOWER(subject)) LIKE '%commitlint%' AND LOWER(content) LIKE '%scope%'";

type FixtureClass = 'positive' | 'durable' | 'guard';

interface Fixture {
  readonly id: string;
  readonly fixtureClass: FixtureClass;
  readonly workspaceRoot: string | null;
  readonly tier: 'core' | 'recall' | 'archival';
  readonly kind: 'fact' | 'preference' | 'event';
  readonly type: string;
  readonly subject: string;
  readonly content: string;
  readonly pinned?: number;
  readonly corpusLinked?: boolean;
  readonly request?: string;
  readonly investigated?: string;
  readonly learned?: string;
  readonly completed?: string;
  readonly nextSteps?: string;
}

const WS = 'D:/projects/fixture-workspace';

const FIXTURES: readonly Fixture[] = [
  // positive: a section 3.4 R4 row in a named workspace.
  {
    id: 'pos-named',
    fixtureClass: 'positive',
    workspaceRoot: WS,
    tier: 'recall',
    kind: 'fact',
    type: 'discovery',
    subject: 'commitlint-scopes',
    content:
      'Allowed commitlint scopes: webview, vscode, deps, release, docs, hooks, scripts, cli.',
  },
  // positive: class 3 row with a NULL workspace (0049 is not workspace-scoped).
  {
    id: 'pos-null-ws',
    fixtureClass: 'positive',
    workspaceRoot: null,
    tier: 'archival',
    kind: 'fact',
    type: 'discovery',
    subject: '  Commitlint-Config ',
    content: "'chat' is not a valid Scope in commitlint; use webview instead.",
    learned: 'First commit attempt with scope chat failed the hook.',
  },
  // durable: 01KWHNZ35HE87Y9BN1QJ4RY5FM
  {
    id: 'dur-clear-command-regression',
    fixtureClass: 'durable',
    workspaceRoot: WS,
    tier: 'recall',
    kind: 'event',
    type: 'bugfix',
    subject: '/clear-command-regression',
    content: '/clear stopped resetting the chat view after the turn refactor.',
    learned:
      'CHAT_COMPLETE is deliberately ignored per turn; the fix re-registers it narrowly for clear.',
  },
  // durable: 01KXDT44N5NS5JFVFNTCJC77KY
  {
    id: 'dur-vscode-e2e',
    fixtureClass: 'durable',
    workspaceRoot: WS,
    tier: 'recall',
    kind: 'event',
    type: 'bugfix',
    subject: 'vscode-e2e',
    content:
      'PR #364: an awaited showInformationMessage with buttons never resolves headlessly and deadlocks activation.',
    learned: 'Never await a modal notification during activation.',
  },
  // durable: 01KXKCB1ND5JQDE6W8P5F4P199
  {
    id: 'dur-chat-view-empty-state',
    fixtureClass: 'durable',
    workspaceRoot: WS,
    tier: 'recall',
    kind: 'event',
    type: 'bugfix',
    subject: 'chat-view-empty-state',
    content:
      'TASK_2026_155: @for with zero tabs rendered nothing; the @empty block restores the empty state.',
  },
  // durable: 01M19SPXP18AFNSEWZ97GJRR5V
  {
    id: 'dur-task-2026-306',
    fixtureClass: 'durable',
    workspaceRoot: WS,
    tier: 'recall',
    kind: 'event',
    type: 'change',
    subject: 'task-2026-306',
    content:
      'TaskIndexService.rebuild skips writes when isReady() is false; this guard pattern prevents state corruption during connection failures.',
    nextSteps: 'Apply the same readiness guard to the task spec watcher.',
  },
  // durable: 01M215720HVHDSD2PPD5BRVDEV
  {
    id: 'dur-task-2026-394',
    fixtureClass: 'durable',
    workspaceRoot: WS,
    tier: 'recall',
    kind: 'event',
    type: 'discovery',
    subject: 'task-2026-394',
    content:
      'keytar is guarded with .catch(() => null) and documented as optional — must stay undeclared.',
  },
  // durable: 01M215720Z7652DGW8MQYGNXQY
  {
    id: 'dur-task-2026-395',
    fixtureClass: 'durable',
    workspaceRoot: WS,
    tier: 'recall',
    kind: 'event',
    type: 'discovery',
    subject: 'task-2026-395',
    content:
      'HARD CONSTRAINT: app must refuse to serve partially-applied schema (prevents silent data corruption).',
  },
  // durable: 01KX27X86M0BWY264NHQS0QEHT
  {
    id: 'dur-task-2026-154',
    fixtureClass: 'durable',
    workspaceRoot: WS,
    tier: 'recall',
    kind: 'event',
    type: 'feature',
    subject: 'task_2026_154',
    content: 'Editor tabs switch between files without losing state.',
    completed:
      'switchGeneration and recency guards against A->B->A races; a per-file Monaco model cache keeps undo, scroll and cursor.',
  },
  // durable: 01M21ASKKYY4NBCJF96TD6PE25
  {
    id: 'dur-task-2026-398-backlog',
    fixtureClass: 'durable',
    workspaceRoot: WS,
    tier: 'recall',
    kind: 'event',
    type: 'discovery',
    subject: 'task-2026-398-backlog',
    content:
      'Codex can resume via codex.resumeThread; the stale warning that says otherwise is false.',
  },
  // durable: 01M2135N2GWQJSRTDJ4VEH759M
  {
    id: 'dur-pr-468-write-signal',
    fixtureClass: 'durable',
    workspaceRoot: WS,
    tier: 'recall',
    kind: 'event',
    type: 'change',
    subject: 'pr-468-write-signal',
    content:
      'recordPhaseOutcome now uses mtime or changed content to detect rewrites.',
  },
  // durable: 01KX7BY1GSABG7D0W6H09BE73K. Its content mentions scope, so only
  // the subject keeps it out of R4.
  {
    id: 'dur-task-2026-180-architecture',
    fixtureClass: 'durable',
    workspaceRoot: WS,
    tier: 'recall',
    kind: 'fact',
    type: 'decision',
    subject: 'task-2026-180-architecture',
    content:
      'Skill synthesis runs in four phases; each phase has its own queue stage and scope of writes.',
  },
  // durable: 01M1XMRK9PFTXVVB4G7JMSR0MC (preference, no corpus link).
  {
    id: 'dur-commitlint-multi-scope-batching',
    fixtureClass: 'durable',
    workspaceRoot: WS,
    tier: 'recall',
    kind: 'preference',
    type: 'decision',
    subject: 'commitlint-multi-scope-batching',
    content:
      'When a change spans libraries, split commits so each carries one commitlint scope.',
  },
  // durable: 01KW9R8WEE5KBG2Y1N7F3TK9TC (preference, mixed).
  {
    id: 'dur-commitlint-constraints',
    fixtureClass: 'durable',
    workspaceRoot: WS,
    tier: 'recall',
    kind: 'preference',
    type: 'decision',
    subject: 'commitlint-constraints',
    content:
      'Always verify the scope against .commitlintrc.json before committing; subject lower-case.',
  },
  // durable: a commitlint fact whose content does not mention scope.
  {
    id: 'dur-commitlint-subject-case',
    fixtureClass: 'durable',
    workspaceRoot: WS,
    tier: 'recall',
    kind: 'fact',
    type: 'discovery',
    subject: 'commitlint-subject-case',
    content:
      'Commit subjects must be lower-case, at most 72 characters, with no trailing period.',
  },
  // guard: corpus-linked commitlint scope fact.
  {
    id: 'guard-corpus-linked',
    fixtureClass: 'guard',
    workspaceRoot: WS,
    tier: 'recall',
    kind: 'fact',
    type: 'discovery',
    subject: 'commitlint-scopes',
    content: 'Valid commitlint scopes include persistence-sqlite and memory.',
    corpusLinked: true,
  },
  // guard: pinned commitlint scope fact.
  {
    id: 'guard-pinned',
    fixtureClass: 'guard',
    workspaceRoot: WS,
    tier: 'recall',
    kind: 'fact',
    type: 'discovery',
    subject: 'commitlint-scopes',
    content: 'Scope list lives in .commitlintrc.json scope-enum.',
    pinned: 1,
  },
  // guard: core-tier commitlint scope fact.
  {
    id: 'guard-core',
    fixtureClass: 'guard',
    workspaceRoot: WS,
    tier: 'core',
    kind: 'fact',
    type: 'discovery',
    subject: 'commitlint',
    content: 'Every commit needs a scope from the commitlint scope-enum.',
  },
];

const idsOf = (fixtureClass: FixtureClass): string[] =>
  FIXTURES.filter((f) => f.fixtureClass === fixtureClass)
    .map((f) => f.id)
    .sort();

interface QuarantineRow {
  id: string;
  quarantined_at: number | null;
  quarantine_reason: string | null;
}

describe('migration 0049_memory_sediment_quarantine — registry and static SQL', () => {
  it('is registered once as plain, static SQL', () => {
    expect(MIGRATIONS.filter((m) => m.version === 49)).toEqual([
      { version: 49, name: '0049_memory_sediment_quarantine', sql },
    ]);
    expect(sql).not.toContain('${');
  });

  it('is exactly one UPDATE of the two quarantine columns and nothing else', () => {
    expect(sql.match(/;/g)).toHaveLength(1);
    expect(sql.match(/\bUPDATE\b/g)).toHaveLength(1);
    expect(sql).not.toMatch(/\b(DELETE|INSERT|CREATE|DROP|ALTER)\b/i);
    expect(sql).not.toMatch(/\bmemories\s+(AS\s+)?m\b/i);
    const setClause = sql.slice(sql.indexOf('SET'), sql.indexOf('WHERE'));
    expect(setClause.match(/\b\w+\s*=/g)).toEqual([
      'quarantined_at =',
      'quarantine_reason =',
    ]);
    expect(sql).toContain(
      "quarantined_at = CAST(strftime('%s','now') AS INTEGER) * 1000",
    );
    expect(sql).toContain("quarantine_reason = '" + REASON + "'");
  });

  it('carries the common guard and the R4 predicate verbatim, with no other predicate', () => {
    const whereClause = sql
      .slice(sql.indexOf('WHERE') + 'WHERE'.length)
      .replace(/;\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    expect(whereClause).toBe(COMMON_GUARD + ' AND ' + R4_PREDICATE);
    expect(sql).not.toMatch(/workspace_root/i);
    expect(sql).not.toMatch(/'event'/);
  });
});

describe('migration 0049_memory_sediment_quarantine — fixtures', () => {
  const opener = resolveOpener();

  it('has a SQLite binding to run against (fails instead of skipping)', () => {
    expect(opener).not.toBeNull();
  });

  it('seeds every section 6 fixture: 2 positive, 13 durable, 3 guard', () => {
    expect(idsOf('positive')).toHaveLength(2);
    expect(idsOf('durable')).toHaveLength(13);
    expect(idsOf('guard')).toHaveLength(3);
    expect(new Set(FIXTURES.map((f) => f.id)).size).toBe(FIXTURES.length);
  });

  function openAtVersion48(): DatabaseShape {
    if (!opener) {
      throw new Error(
        'No SQLite binding loaded (neither better-sqlite3 nor node:sqlite)',
      );
    }
    const db = opener();
    db.exec('PRAGMA foreign_keys = ON');
    for (const migration of MIGRATIONS.filter((m) => m.version < 49)) {
      if (migration.sql) db.exec(migration.sql);
    }
    return db;
  }

  function seed(db: DatabaseShape): void {
    db.prepare(
      `INSERT INTO corpora (id, name, workspace_root, query_json, built_at)
       VALUES (?, ?, ?, '{}', 1)`,
    ).run('corpus-1', 'commitlint-corpus', WS);
    const insertMemory = db.prepare(
      `INSERT INTO memories (
         id, session_id, workspace_root, tier, kind, subject, content, pinned,
         type, request, investigated, learned, completed, next_steps,
         created_at, updated_at, last_used_at
       ) VALUES (?, 'session-1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 100, 100, 100)`,
    );
    const insertChunk = db.prepare(
      `INSERT INTO memory_chunks (id, memory_id, ord, text, token_count, created_at)
       VALUES (?, ?, 0, ?, 8, 100)`,
    );
    const insertConcept = db.prepare(
      'INSERT INTO memory_concepts_fts (memory_id, concept) VALUES (?, ?)',
    );
    const linkCorpus = db.prepare(
      'INSERT INTO corpus_memories (corpus_id, memory_id, ord) VALUES (?, ?, ?)',
    );
    FIXTURES.forEach((fixture, ord) => {
      insertMemory.run(
        fixture.id,
        fixture.workspaceRoot,
        fixture.tier,
        fixture.kind,
        fixture.subject,
        fixture.content,
        fixture.pinned ?? 0,
        fixture.type,
        fixture.request ?? null,
        fixture.investigated ?? null,
        fixture.learned ?? null,
        fixture.completed ?? null,
        fixture.nextSteps ?? null,
      );
      insertChunk.run(fixture.id + '-chunk', fixture.id, fixture.content);
      insertConcept.run(fixture.id, fixture.subject);
      if (fixture.corpusLinked) linkCorpus.run('corpus-1', fixture.id, ord);
    });
  }

  function quarantineRows(db: DatabaseShape): QuarantineRow[] {
    return db
      .prepare(
        'SELECT id, quarantined_at, quarantine_reason FROM memories ORDER BY id',
      )
      .all() as QuarantineRow[];
  }

  /** Row counts of the memory table and everything indexed from it. */
  function tableCounts(db: DatabaseShape): Record<string, number> {
    const row = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM memories) AS memories,
                (SELECT COUNT(*) FROM memory_chunks) AS memory_chunks,
                (SELECT COUNT(*) FROM memory_chunks_fts_docsize) AS memory_chunks_fts_docsize,
                (SELECT COUNT(*) FROM memory_concepts_fts) AS memory_concepts_fts,
                (SELECT COUNT(*) FROM corpus_memories) AS corpus_memories`,
      )
      .get() as Record<string, number>;
    return Object.fromEntries(
      Object.entries(row).map(([table, n]) => [table, Number(n)]),
    );
  }

  function totalChanges(db: DatabaseShape): number {
    const row = db.prepare('SELECT total_changes() AS n').get() as {
      n: number;
    };
    return Number(row.n);
  }

  it('quarantines only the positive fixtures, including the NULL-workspace row', () => {
    const db = openAtVersion48();
    try {
      seed(db);
      const countsBefore = tableCounts(db);
      expect(countsBefore).toEqual({
        memories: 18,
        memory_chunks: 18,
        memory_chunks_fts_docsize: 18,
        memory_concepts_fts: 18,
        corpus_memories: 1,
      });

      const before = Math.floor(Date.now() / 1000) * 1000;
      db.exec(sql);
      const after = Date.now();

      const rows = quarantineRows(db);
      const quarantined = rows.filter((row) => row.quarantined_at !== null);
      expect(quarantined.map((row) => row.id).sort()).toEqual(
        idsOf('positive'),
      );
      for (const row of quarantined) {
        expect(row.quarantine_reason).toBe(REASON);
        expect(Number.isInteger(row.quarantined_at)).toBe(true);
        expect((row.quarantined_at as number) % 1000).toBe(0);
        expect(row.quarantined_at).toBeGreaterThanOrEqual(before);
        expect(row.quarantined_at).toBeLessThanOrEqual(after);
      }

      const untouched = new Set([...idsOf('durable'), ...idsOf('guard')]);
      const active = rows.filter((row) => untouched.has(row.id));
      expect(active).toHaveLength(16);
      for (const row of active) {
        expect(row).toEqual({
          id: row.id,
          quarantined_at: null,
          quarantine_reason: null,
        });
      }

      expect(
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM memories
              WHERE kind = 'event' AND quarantined_at IS NOT NULL`,
          )
          .get(),
      ).toEqual({ n: 0 });
      expect(
        db
          .prepare(
            `SELECT id FROM memories
              WHERE workspace_root IS NULL AND quarantined_at IS NOT NULL`,
          )
          .all(),
      ).toEqual([{ id: 'pos-null-ws' }]);

      // Reversible and non-destructive: nothing is deleted anywhere.
      expect(tableCounts(db)).toEqual(countsBefore);
    } finally {
      db.close();
    }
  });

  it('leaves every other column of a quarantined row unchanged', () => {
    const db = openAtVersion48();
    try {
      seed(db);
      const snapshot = (): unknown[] =>
        db
          .prepare(
            `SELECT id, session_id, workspace_root, tier, kind, subject, content,
                    pinned, type, request, investigated, learned, completed,
                    next_steps, salience, hits, created_at, updated_at,
                    last_used_at, archived_at
               FROM memories ORDER BY id`,
          )
          .all();
      const before = snapshot();
      db.exec(sql);
      expect(snapshot()).toEqual(before);
    } finally {
      db.close();
    }
  });

  it('changes nothing on a second application and never moves an earlier timestamp', () => {
    const db = openAtVersion48();
    try {
      seed(db);
      db.exec(sql);
      // Pin a distinguishable earlier timestamp, as a boot a day before would.
      db.prepare(
        'UPDATE memories SET quarantined_at = ? WHERE quarantined_at IS NOT NULL',
      ).run(1_000);
      const rowsBefore = quarantineRows(db);
      const countsBefore = tableCounts(db);
      const changesBefore = totalChanges(db);

      db.exec(sql);

      expect(totalChanges(db)).toBe(changesBefore);
      expect(quarantineRows(db)).toEqual(rowsBefore);
      expect(
        rowsBefore
          .filter((row) => row.quarantined_at !== null)
          .map((row) => [row.id, row.quarantined_at]),
      ).toEqual([
        ['pos-named', 1_000],
        ['pos-null-ws', 1_000],
      ]);
      expect(tableCounts(db)).toEqual(countsBefore);
    } finally {
      db.close();
    }
  });
});
