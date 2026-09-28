/**
 * copy-audit — TASK_2026_563_2939 measurement harness (implementation-plan.md
 * component 9, measurement table rows "M5 migration", "M5 rules", "KNN
 * starvation", "Relevance").
 *
 * Modes (first CLI argument):
 *
 *   m5              Bundle against the BRANCH sources (this worktree's
 *                   tsconfig.base.json). Copy A: before-counts/integrity/
 *                   ordered hashes -> real SqliteMigrationRunner.applyAll(
 *                   MIGRATIONS, { vecExtensionLoaded }) with no backup service,
 *                   timed -> after-counts/integrity/hashes; then the M5 rules
 *                   check on copy A. Writes output/m5-migration.json and
 *                   output/m5-rules.json.
 *
 *   relevance-main  Bundle against the BASE-COMMIT sources (ebfc73321, the
 *                   detached worktree's tsconfig.base.json, so every
 *                   `@ptah-extension/*` alias resolves to base code). Fresh
 *                   UNMIGRATED copy; MemorySearchService.searchRich with
 *                   VecStatus.available = false and a plain embedder (BM25
 *                   through fts-query.util), top 5, scoped to
 *                   D:\projects\ptah-extension. Writes
 *                   output/relevance-main.raw.json (the judged table is written
 *                   by hand into output/relevance-main.md).
 *
 * Phase 2 (KNN starvation plan:1025, the relevance "branch" run on copy A and
 * restore-all equivalence plan:1026) lives in `branch-audit.ts`, not here:
 * this file is also bundled against the BASE worktree, and the Phase 2 code
 * deep-imports branch files that would break that bundle's zero-branch-input
 * property.
 */
import 'reflect-metadata';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  MIGRATIONS,
  SqliteMigrationRunner,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import {
  MemorySearchService,
  MemoryStore,
  ObservationQueueStore,
} from '@ptah-extension/memory-curator';
import { makeWorkingCopy, type WorkingCopyRecord } from './lib/copy-db';
import {
  makeLogger,
  openWorkingCopy,
  type HarnessConnection,
} from './lib/connection';

const OUT_DIR =
  process.env['MQS_OUT_DIR'] ??
  'D:\\projects\\ptah-extension-memory-quality-source\\.ptah\\specs\\TASK_2026_563_2939\\harness\\output';
const WORKSPACE = 'D:\\projects\\ptah-extension';

function writeJson(name: string, value: unknown): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, name),
    JSON.stringify(value, null, 2) + '\n',
  );
  process.stdout.write(`wrote ${path.join(OUT_DIR, name)}\n`);
}

function count(db: SqliteDatabase, sql: string): number {
  const row = db.prepare(sql).get() as Record<string, unknown>;
  return Number(Object.values(row)[0]);
}

function integrity(db: SqliteDatabase): { result: string; ms: number } {
  const t0 = performance.now();
  const rows = db.prepare('PRAGMA integrity_check').all() as Array<{
    integrity_check: string;
  }>;
  return {
    result: rows.map((r) => r.integrity_check).join('; '),
    ms: Math.round(performance.now() - t0),
  };
}

function orderedHash(
  db: SqliteDatabase,
  table: string,
  columns: readonly string[],
): { sha256: string; rows: number } {
  const hash = crypto.createHash('sha256');
  const cols = columns.map((c) => `"${c}"`).join(', ');
  const stmt = db.prepare(
    `SELECT ${cols} FROM ${table} ORDER BY id`,
  ) as unknown as {
    iterate(): IterableIterator<Record<string, unknown>>;
  };
  let rows = 0;
  for (const row of stmt.iterate()) {
    // Explicit column order so the JSON text is independent of driver key order.
    const ordered: Record<string, unknown> = {};
    for (const c of columns) {
      const v = row[c];
      ordered[c] = Buffer.isBuffer(v) ? `blob:${v.toString('hex')}` : v;
    }
    hash.update(JSON.stringify(ordered));
    hash.update('\n');
    rows++;
  }
  return { sha256: hash.digest('hex'), rows };
}

interface Snapshot {
  readonly counts: Record<string, number | string>;
  readonly integrity: { result: string; ms: number };
  readonly memoriesHash: { sha256: string; rows: number };
  readonly chunksHash: { sha256: string; rows: number };
  readonly schemaMaxVersion: number;
  readonly userVersion: number;
}

function takeSnapshot(
  conn: HarnessConnection,
  memoryColumns: readonly string[],
): Snapshot {
  const db = conn.db;
  const counts: Record<string, number | string> = {
    memories: count(db, 'SELECT COUNT(*) FROM memories'),
    memory_chunks: count(db, 'SELECT COUNT(*) FROM memory_chunks'),
    memory_chunks_fts_docsize: count(
      db,
      'SELECT COUNT(*) FROM memory_chunks_fts_docsize',
    ),
    memory_chunks_vec_rowids: count(
      db,
      'SELECT COUNT(*) FROM memory_chunks_vec_rowids',
    ),
  };
  if (conn.vecExtensionLoaded) {
    counts['memory_chunks_vec'] = count(
      db,
      'SELECT COUNT(*) FROM memory_chunks_vec',
    );
  } else {
    counts['memory_chunks_vec'] = 'not measured: sqlite-vec not loaded';
  }
  const chunkColumns = [
    'rowid',
    'id',
    'memory_id',
    'ord',
    'text',
    'token_count',
    'created_at',
  ];
  return {
    counts,
    integrity: integrity(db),
    memoriesHash: orderedHash(db, 'memories', memoryColumns),
    chunksHash: orderedHash(db, 'memory_chunks', chunkColumns),
    schemaMaxVersion: count(db, 'SELECT MAX(version) FROM schema_migrations'),
    userVersion: Number(db.pragma('user_version', { simple: true })),
  };
}

/** Durable fixture ids from quarantine-rules.md r2 §6 (fixture table). */
const SECTION6_DURABLE_FIXTURES: ReadonlyArray<readonly [string, string]> = [
  ['01KWHNZ35HE87Y9BN1QJ4RY5FM', '/clear-command-regression'],
  ['01KXDT44N5NS5JFVFNTCJC77KY', 'vscode-e2e'],
  ['01KXKCB1ND5JQDE6W8P5F4P199', 'chat-view-empty-state'],
  ['01M19SPXP18AFNSEWZ97GJRR5V', 'task-2026-306'],
  ['01M215720HVHDSD2PPD5BRVDEV', 'task-2026-394'],
  ['01M215720Z7652DGW8MQYGNXQY', 'task-2026-395'],
  ['01KX27X86M0BWY264NHQS0QEHT', 'task_2026_154'],
  ['01M21ASKKYY4NBCJF96TD6PE25', 'task-2026-398-backlog'],
  ['01M2135N2GWQJSRTDJ4VEH759M', 'pr-468-write-signal'],
  ['01KX7BY1GSABG7D0W6H09BE73K', 'task-2026-180-architecture'],
  ['01M1XMRK9PFTXVVB4G7JMSR0MC', 'commitlint-multi-scope-batching'],
  ['01KW9R8WEE5KBG2Y1N7F3TK9TC', 'commitlint-constraints (mixed)'],
];

/** Every other row judged durable in quarantine-rules.md §3, §3.5, §4.3, §4.4. */
const OTHER_DURABLE_IDS: readonly string[] = [
  '01KWQ0RS8XQG2JVG98R7N8EW3Z',
  '01KXKBWP66C48EAVVA6EX4DK7H',
  '01KXK8PQQTXRC6RXMEHB79NRRJ',
  '01M30JJRYQBAF1PXRMWNVVY1Z9',
  '01KXEVMRHT2Z43689G42J170VB',
  '01KWJH8EA0K7YDFRES8K6F739R',
  '01M2Q5B8V1PEZ6D1HNP13RES6Y',
  '01KXCC44267ZJSZ2EZR2E3YM6Z',
  '01M1M3TMF3Y1K17Z2WPY2BY2G7',
  '01M261PEBR6BY10FX5BXTMA713',
  '01M26SBC7RTRKRT70A8QG0H5AD',
  '01M20ZCHDWKQ0G63CBNEKK000X',
  '01M2G56P6HJS5511QWVVKFGVRX',
  '01M266XJJ69C6XK5PV68DK4WBB',
  '01M264XR7KJCS5BNPND37FQKBY',
  '01M28TT586KHXK3V43P2JPMJM3',
  '01KWHQDWJ3Q1PYVVKTADFBQR6G',
  '01M28PY0QS413D10SC1GXE47EY',
  '01M26MDNJB9615P6F1SJTKEC9G',
  '01M28W75FG3JW9YKWV1VM8603C',
  '01M23HV9Y6533DVB23WKJMKSP8',
  '01M26QGMHQV8VR79TXGKRQHT62',
  '01KVT3D2411D0PR0EHVYT9EM3D',
  '01KXK7Z2YKPBY09DA2PGPN87ND',
  '01M05TZG25SK3SE2FMB9S4ZXCZ',
  '01M21KFMMZ3BFAR5Y9QGMYETS5',
  '01KWS71R2W22S7622E9RQ33F9S',
  '01M1C076NWJM4SQ80BV6V586YM',
  '01M1WTG1G0C9QV8E0VX1TWH401',
];

async function runM5(): Promise<void> {
  const logger = makeLogger('copy-audit:m5', false);
  const copyA: WorkingCopyRecord = await makeWorkingCopy('copyA-m5.sqlite');
  process.stdout.write(`copy A: ${JSON.stringify(copyA)}\n`);
  const conn = openWorkingCopy(copyA.target, { loadVec: true });
  try {
    const tableInfo = conn.db
      .prepare('PRAGMA table_info(memories)')
      .all() as Array<{ name: string }>;
    const memoryColumns = tableInfo.map((c) => c.name);
    if (memoryColumns.length !== 25) {
      throw new Error(
        `expected 25 pre-existing memories columns, found ${memoryColumns.length}`,
      );
    }
    const bundledMax = Math.max(...MIGRATIONS.map((m) => m.version));
    const before = takeSnapshot(conn, memoryColumns);
    process.stdout.write(`before: ${JSON.stringify(before)}\n`);

    const runner = new SqliteMigrationRunner(conn.db, logger);
    const m0 = performance.now();
    const result = await runner.applyAll(MIGRATIONS, {
      vecExtensionLoaded: conn.vecExtensionLoaded,
    });
    const migrationMs = performance.now() - m0;
    process.stdout.write(
      `applyAll: ${JSON.stringify(result)} in ${migrationMs.toFixed(1)} ms\n`,
    );

    const after = takeSnapshot(conn, memoryColumns);
    const afterColumns = (
      conn.db.prepare('PRAGMA table_info(memories)').all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    process.stdout.write(`after: ${JSON.stringify(after)}\n`);

    const countKeys = Object.keys(before.counts);
    const countsEqual = countKeys.every(
      (k) => before.counts[k] === after.counts[k],
    );
    writeJson('m5-migration.json', {
      measurement:
        'M5 migration (implementation-plan.md measurement table, M5 criterion 4)',
      workingCopy: copyA,
      sqliteVecLoaded: conn.vecExtensionLoaded,
      bundledMigrationMax: bundledMax,
      memoriesHashColumns: memoryColumns,
      memoryChunksHashColumns: [
        'rowid',
        'id',
        'memory_id',
        'ord',
        'text',
        'token_count',
        'created_at',
      ],
      before,
      migration: {
        call: 'new SqliteMigrationRunner(db, logger).applyAll(MIGRATIONS, { vecExtensionLoaded }) — no backup service',
        result,
        durationMs: Number(migrationMs.toFixed(1)),
      },
      after,
      memoriesColumnsAfter: afterColumns,
      gate: {
        countsEqual,
        integrityOkBefore: before.integrity.result === 'ok',
        integrityOkAfter: after.integrity.result === 'ok',
        memoriesHashEqual:
          before.memoriesHash.sha256 === after.memoriesHash.sha256,
        chunksHashEqual: before.chunksHash.sha256 === after.chunksHash.sha256,
      },
    });

    // ---- M5 rules on copy A (after migration) ----
    const db = conn.db;
    const byReason = db
      .prepare(
        'SELECT quarantine_reason AS reason, COUNT(*) AS n FROM memories WHERE quarantine_reason IS NOT NULL GROUP BY quarantine_reason ORDER BY quarantine_reason',
      )
      .all();
    const quarantinedAtNotNull = count(
      db,
      'SELECT COUNT(*) FROM memories WHERE quarantined_at IS NOT NULL',
    );
    const inconsistent = count(
      db,
      'SELECT COUNT(*) FROM memories WHERE (quarantined_at IS NULL) <> (quarantine_reason IS NULL)',
    );
    const chunksOwned = count(
      db,
      'SELECT COUNT(*) FROM memory_chunks mc JOIN memories m ON m.id = mc.memory_id WHERE m.quarantined_at IS NOT NULL',
    );
    const guardViolations = {
      pinned: count(
        db,
        'SELECT COUNT(*) FROM memories WHERE quarantined_at IS NOT NULL AND pinned <> 0',
      ),
      core: count(
        db,
        "SELECT COUNT(*) FROM memories WHERE quarantined_at IS NOT NULL AND tier = 'core'",
      ),
      corpusLinked: count(
        db,
        'SELECT COUNT(*) FROM memories m WHERE m.quarantined_at IS NOT NULL AND EXISTS (SELECT 1 FROM corpus_memories c WHERE c.memory_id = m.id)',
      ),
      notFact: count(
        db,
        "SELECT COUNT(*) FROM memories WHERE quarantined_at IS NOT NULL AND kind <> 'fact'",
      ),
      contentWithoutScope: count(
        db,
        "SELECT COUNT(*) FROM memories WHERE quarantined_at IS NOT NULL AND LOWER(content) NOT LIKE '%scope%'",
      ),
      subjectWithoutCommitlint: count(
        db,
        "SELECT COUNT(*) FROM memories WHERE quarantined_at IS NOT NULL AND TRIM(LOWER(subject)) NOT LIKE '%commitlint%'",
      ),
    };
    const predicateUnguarded = count(
      db,
      "SELECT COUNT(*) FROM memories WHERE kind = 'fact' AND TRIM(LOWER(subject)) LIKE '%commitlint%' AND LOWER(content) LIKE '%scope%'",
    );
    const byWorkspace = db
      .prepare(
        "SELECT COALESCE(workspace_root, '<NULL>') AS workspace_root, COUNT(*) AS n FROM memories WHERE quarantined_at IS NOT NULL GROUP BY workspace_root ORDER BY n DESC",
      )
      .all();
    const commitlintNoScopeFactsActive = count(
      db,
      "SELECT COUNT(*) FROM memories WHERE kind = 'fact' AND TRIM(LOWER(subject)) LIKE '%commitlint%' AND LOWER(content) NOT LIKE '%scope%' AND quarantined_at IS NULL",
    );
    const commitlintPreferencesActive = count(
      db,
      "SELECT COUNT(*) FROM memories WHERE kind = 'preference' AND TRIM(LOWER(subject)) LIKE '%commitlint%' AND quarantined_at IS NULL",
    );
    const lookup = db.prepare(
      'SELECT id, kind, subject, quarantined_at, quarantine_reason FROM memories WHERE id = ?',
    );
    const fixtureCheck = SECTION6_DURABLE_FIXTURES.map(([id, label]) => {
      const row = lookup.get(id) as
        | {
            id: string;
            kind: string;
            subject: string | null;
            quarantined_at: number | null;
            quarantine_reason: string | null;
          }
        | undefined;
      return row
        ? {
            id,
            label,
            exists: true,
            kind: row.kind,
            subject: row.subject,
            quarantined_at: row.quarantined_at,
            quarantine_reason: row.quarantine_reason,
            staysNull: row.quarantined_at === null,
          }
        : { id, label, exists: false };
    });
    const otherDurable = OTHER_DURABLE_IDS.map((id) => {
      const row = lookup.get(id) as
        { subject: string | null; quarantined_at: number | null } | undefined;
      return row
        ? {
            id,
            exists: true,
            subject: row.subject,
            staysNull: row.quarantined_at === null,
          }
        : { id, exists: false };
    });
    const sample = db
      .prepare(
        'SELECT id, subject, SUBSTR(content, 1, 140) AS content FROM memories WHERE quarantined_at IS NOT NULL ORDER BY id LIMIT 10',
      )
      .all();
    writeJson('m5-rules.json', {
      measurement:
        'M5 rules (implementation-plan.md measurement table, M5 criterion 11)',
      workingCopy: copyA.target,
      expected: { 'rule:commitlint-scope-facts': 89, otherReasons: 0 },
      byReason,
      quarantinedAtNotNull,
      columnsInconsistent: inconsistent,
      chunksOwnedByQuarantined: chunksOwned,
      predicateMatchesBeforeGuard: predicateUnguarded,
      guardViolations,
      byWorkspace,
      commitlintNoScopeFactsActive,
      commitlintPreferencesActive,
      section6DurableFixtures: fixtureCheck,
      otherDurableIdsFromSections3to4: otherDurable,
      firstTenQuarantinedById: sample,
    });
  } finally {
    conn.close();
  }
}

// ---------------------------------------------------------------- relevance

const TRACK_A_QUERIES: ReadonlyArray<readonly [string, string]> = [
  ['Q1', 'what did we decide about the judge threshold'],
  ['Q2', 'how do we name DI tokens'],
  ['Q3', 'why did the release branch drift'],
  ['Q4', "what is the user's preference for commit messages"],
];

interface MatchCall {
  match: unknown;
  rows: number;
}

/** Wrap the adapted db so every MATCH statement records its bound expression and row count. */
function recordMatches(db: SqliteDatabase, sink: MatchCall[]): SqliteDatabase {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== 'prepare') return Reflect.get(target, prop, receiver);
      return (sql: string) => {
        const stmt = target.prepare(sql) as unknown as {
          all(...p: unknown[]): unknown[];
        };
        if (!/MATCH \?/.test(sql) || !/memory_chunks_fts/.test(sql))
          return stmt;
        return new Proxy(stmt, {
          get(s, p, r) {
            if (p !== 'all') return Reflect.get(s, p, r);
            return (...params: unknown[]) => {
              const rows = s.all(...params);
              sink.push({ match: params[0], rows: rows.length });
              return rows;
            };
          },
        });
      };
    },
  });
}

async function runRelevanceMain(): Promise<void> {
  const bundledMax = Math.max(...MIGRATIONS.map((m) => m.version));
  if (bundledMax !== 47) {
    throw new Error(
      `relevance-main must be bundled from the BASE commit (MIGRATIONS max 47); this bundle has ${bundledMax}`,
    );
  }
  const logger = makeLogger('copy-audit:relevance-main', true);
  const copy = await makeWorkingCopy('relmain-unmigrated.sqlite');
  process.stdout.write(`relevance copy: ${JSON.stringify(copy)}\n`);
  const conn = openWorkingCopy(copy.target, { loadVec: false });
  try {
    const schemaMax = count(
      conn.db,
      'SELECT MAX(version) FROM schema_migrations',
    );
    const hasQuarantineColumn = (
      conn.db.prepare('PRAGMA table_info(memories)').all() as Array<{
        name: string;
      }>
    ).some((c) => c.name === 'quarantined_at');
    const calls: MatchCall[] = [];
    const recordingDb = recordMatches(conn.db, calls);
    const connection = {
      get db() {
        return recordingDb;
      },
      vecExtensionLoaded: false,
    } as never;
    const plainEmbedder = {
      dim: 384,
      modelId:
        'harness-plain-embedder (never called: VecStatus.available = false)',
      embed: async () => {
        throw new Error(
          'plain embedder: vector path must not run in the BM25-only baseline',
        );
      },
      dispose: async () => undefined,
    };
    const vecStatus = {
      available: false,
      reason: 'harness-bm25-only',
    } as never;
    const store = new MemoryStore(
      logger,
      connection,
      plainEmbedder as never,
      vecStatus,
    );
    const observationQueue = new ObservationQueueStore(logger, connection);
    const search = new MemorySearchService(
      logger,
      connection,
      plainEmbedder as never,
      store,
      observationQueue,
      vecStatus,
    );
    const workspaceRows = Number(
      (
        conn.db
          .prepare(
            'SELECT COUNT(*) AS n FROM memories WHERE workspace_root IS ?',
          )
          .get(WORKSPACE) as { n: number }
      ).n,
    );
    const results = [];
    for (const [qid, query] of TRACK_A_QUERIES) {
      const before = calls.length;
      const t0 = performance.now();
      const response = await search.searchRich(query, 5, WORKSPACE);
      const ms = performance.now() - t0;
      const matchCalls = calls.slice(before);
      const hits = response.hits.map((h, i) => {
        const full = conn.db
          .prepare(
            'SELECT kind, type, tier, workspace_root, request, investigated, learned, completed, next_steps, archived_at, created_at FROM memories WHERE id = ?',
          )
          .get(h.memory.id) as Record<string, unknown>;
        return {
          rank: i + 1,
          memoryId: h.memory.id,
          subject: h.memory.subject,
          kind: full['kind'],
          type: full['type'],
          tier: full['tier'],
          workspaceRoot: full['workspace_root'],
          archivedAt: full['archived_at'],
          createdAt: full['created_at'],
          rrfScore: h.score,
          bm25Rank: h.bm25Rank,
          vecRank: h.vecRank,
          chunkText: h.chunk.text,
          content: h.memory.content,
          learned: full['learned'],
          investigated: full['investigated'],
          completed: full['completed'],
          nextSteps: full['next_steps'],
          request: full['request'],
        };
      });
      results.push({
        qid,
        query,
        bm25Only: response.bm25Only,
        ms: Math.round(ms),
        matchCalls,
        hits,
      });
    }
    writeJson('relevance-main.raw.json', {
      measurement:
        'Relevance "main" baseline (implementation-plan.md measurement table, Relevance row, first bullet)',
      code: 'BASE COMMIT ebfc73321 — bundled from the detached worktree sources (MIGRATIONS max asserted = 47)',
      entryPoint: 'MemorySearchService.searchRich(query, 5, workspaceRoot)',
      vecStatusAvailable: false,
      embedder: 'plain stub (throws if called; never called)',
      workspace: WORKSPACE,
      workspaceRows,
      workingCopy: copy,
      schemaMaxVersionOnCopy: schemaMax,
      copyHasQuarantineColumn: hasQuarantineColumn,
      results,
    });
  } finally {
    conn.close();
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'm5') return runM5();
  if (mode === 'relevance-main') return runRelevanceMain();
  throw new Error('usage: copy-audit.cjs <m5|relevance-main>');
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(
      `copy-audit FAILED: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exit(1);
  },
);
