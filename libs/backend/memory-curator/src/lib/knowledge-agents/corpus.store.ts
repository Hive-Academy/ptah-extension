/**
 * CorpusStore — typed CRUD over the `corpora` and `corpus_memories` tables
 * landed by migration 0017.
 *
 * Ordered member ids are persisted via `corpus_memories.ord`. JSON columns
 * (`query_json`, `primed_session_ids_json`) are defensively parsed: a
 * malformed blob does not corrupt downstream callers — it degrades to
 * sensible defaults (empty array / null) and the failure is logged once.
 */
import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import type {
  BuildCorpusParams,
  CorpusRecord,
  CorpusRef,
} from './corpus.types';

interface CorpusRow {
  id: string;
  name: string;
  workspace_root: string | null;
  query_json: string;
  built_at: number;
  rebuilt_at: number | null;
  primed_session_ids_json: string;
}

function parseStringArray(raw: string | null | undefined): readonly string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string');
    }
  } catch {
    return [];
  }
  return [];
}

function rowToRef(row: CorpusRow, count: number): CorpusRef {
  return {
    id: row.id,
    name: row.name,
    count,
    builtAt: row.built_at,
    rebuiltAt: row.rebuilt_at,
    workspaceRoot: row.workspace_root,
  };
}

@injectable()
export class CorpusStore {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  create(params: BuildCorpusParams): CorpusRef {
    const id = randomUUID();
    const builtAt = Date.now();
    const queryJson = JSON.stringify(params);
    this.connection.db
      .prepare(
        `INSERT INTO corpora
           (id, name, workspace_root, query_json, built_at, rebuilt_at, primed_session_ids_json)
         VALUES (?, ?, ?, ?, ?, NULL, '[]')`,
      )
      .run(id, params.name, params.workspaceRoot ?? null, queryJson, builtAt);
    return {
      id,
      name: params.name,
      count: 0,
      builtAt,
      rebuiltAt: null,
      workspaceRoot: params.workspaceRoot ?? null,
    };
  }

  getByName(name: string): CorpusRecord | null {
    const row = this.connection.db
      .prepare(`SELECT * FROM corpora WHERE name = ?`)
      .get(name) as CorpusRow | undefined;
    return row ? this.toRecord(row) : null;
  }

  getById(id: string): CorpusRecord | null {
    const row = this.connection.db
      .prepare(`SELECT * FROM corpora WHERE id = ?`)
      .get(id) as CorpusRow | undefined;
    return row ? this.toRecord(row) : null;
  }

  list(filter: { workspaceRoot?: string | null } = {}): readonly CorpusRef[] {
    const hasFilter = filter.workspaceRoot !== undefined;
    const rows = hasFilter
      ? (this.connection.db
          .prepare(
            `SELECT * FROM corpora WHERE workspace_root IS ? ORDER BY built_at DESC`,
          )
          .all(filter.workspaceRoot) as CorpusRow[])
      : (this.connection.db
          .prepare(`SELECT * FROM corpora ORDER BY built_at DESC`)
          .all() as CorpusRow[]);
    return rows.map((row) => rowToRef(row, this.countMembers(row.id)));
  }

  delete(id: string): boolean {
    const result = this.connection.db
      .prepare(`DELETE FROM corpora WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  setMemberIds(corpusId: string, memoryIds: readonly string[]): void {
    const db = this.connection.db;
    const clear = db.prepare(`DELETE FROM corpus_memories WHERE corpus_id = ?`);
    const insert = db.prepare(
      `INSERT INTO corpus_memories (corpus_id, memory_id, ord) VALUES (?, ?, ?)`,
    );
    const txn = db.transaction(((..._args: unknown[]) => {
      clear.run(corpusId);
      for (let i = 0; i < memoryIds.length; i++) {
        insert.run(corpusId, memoryIds[i], i);
      }
    }) as (...args: unknown[]) => unknown);
    txn();
  }

  getMemberIds(corpusId: string): readonly string[] {
    const rows = this.connection.db
      .prepare(
        `SELECT memory_id FROM corpus_memories WHERE corpus_id = ? ORDER BY ord ASC`,
      )
      .all(corpusId) as Array<{ memory_id: string }>;
    return rows.map((r) => r.memory_id);
  }

  updateRebuiltAt(corpusId: string): void {
    this.connection.db
      .prepare(`UPDATE corpora SET rebuilt_at = ? WHERE id = ?`)
      .run(Date.now(), corpusId);
  }

  setPrimedSessionIds(corpusId: string, sessionIds: readonly string[]): void {
    this.connection.db
      .prepare(`UPDATE corpora SET primed_session_ids_json = ? WHERE id = ?`)
      .run(JSON.stringify([...sessionIds]), corpusId);
  }

  /**
   * Joins `corpus_memories` to `memories` and returns the priming view
   * (subject + 5-field summary + type) in `ord` order. Returns [] when the
   * corpus does not exist or has no members.
   */
  getCorpusMemoriesForPriming(name: string): readonly {
    readonly id: string;
    readonly subject: string | null;
    readonly type: string;
    readonly request: string | null;
    readonly investigated: string | null;
    readonly learned: string | null;
    readonly completed: string | null;
    readonly nextSteps: string | null;
  }[] {
    const corpus = this.connection.db
      .prepare(`SELECT id FROM corpora WHERE name = ?`)
      .get(name) as { id: string } | undefined;
    if (!corpus) return [];
    const rows = this.connection.db
      .prepare(
        `SELECT m.id AS id, m.subject AS subject, m.type AS type,
                m.request AS request, m.investigated AS investigated,
                m.learned AS learned, m.completed AS completed,
                m.next_steps AS next_steps
           FROM corpus_memories cm
           JOIN memories m ON m.id = cm.memory_id
          WHERE cm.corpus_id = ?
          ORDER BY cm.ord ASC`,
      )
      .all(corpus.id) as Array<{
      id: string;
      subject: string | null;
      type: string | null;
      request: string | null;
      investigated: string | null;
      learned: string | null;
      completed: string | null;
      next_steps: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      type: r.type ?? 'discovery',
      request: r.request,
      investigated: r.investigated,
      learned: r.learned,
      completed: r.completed,
      nextSteps: r.next_steps,
    }));
  }

  countMembers(corpusId: string): number {
    const row = this.connection.db
      .prepare(`SELECT COUNT(*) AS n FROM corpus_memories WHERE corpus_id = ?`)
      .get(corpusId) as { n: number } | undefined;
    return row?.n ?? 0;
  }

  private toRecord(row: CorpusRow): CorpusRecord {
    let queryJson = row.query_json;
    try {
      JSON.parse(row.query_json);
    } catch {
      this.logger.warn('[memory-curator] corpora.query_json malformed', {
        corpusId: row.id,
      });
      queryJson = '{}';
    }
    const primed = parseStringArray(row.primed_session_ids_json);
    const count = this.countMembers(row.id);
    return {
      ...rowToRef(row, count),
      queryJson,
      primedSessionIds: primed,
    };
  }
}
