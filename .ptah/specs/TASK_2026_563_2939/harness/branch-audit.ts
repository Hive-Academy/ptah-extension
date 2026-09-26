/**
 * branch-audit — TASK_2026_563_2939 measurement harness, Phase 2
 * (implementation-plan.md component 9, measurement table rows "Relevance"
 * bullets 2-3 and "KNN starvation"). Bundled against the BRANCH sources only
 * (asserts MIGRATIONS max = 49). Kept out of `copy-audit.ts` because that file
 * is also bundled against the base worktree.
 *
 * Modes (first CLI argument):
 *
 *   relevance-branch  Fresh backup-API copy `relbranch-copyA49.sqlite`, migrated
 *                     with the production runner to 49 (0048 + 0049). Q1-Q4
 *                     through the BRANCH MemorySearchService.searchRich(query, 5,
 *                     D:\projects\ptah-extension) with VecStatus.available =
 *                     false and a plain embedder (BM25 through fts-query.util):
 *                     the same path and parameters as relevance-main. Then, per
 *                     recorded MATCH expression, the same FTS SQL WITHOUT the
 *                     quarantine predicate, to show which quarantined rows the
 *                     filter removed from the top 20. Then
 *                     MemoryStore.restoreQuarantined({ all: true }, ws) and
 *                     ({ all: true }, null) and the same four queries again; the
 *                     restored ids are compared with relevance-main.raw.json.
 *                     Writes output/relevance-branch.raw.json.
 *
 *   knn               KNN starvation, "before and after 0049" (plan:1025): copy
 *                     B (48 only, no row quarantined) and a fresh copy
 *                     `knn-copyA49.sqlite` (49). The branch code cannot read an
 *                     unmigrated copy (every read now names
 *                     `quarantined_at`), so "before 0049" is copy B, whose
 *                     quarantine columns are all NULL. REAL embedder and
 *                     reranker, VecStatus.available = true. For Q1-Q4 and the
 *                     8(a) draft query, both `searchRich(q, 5, ws)` and
 *                     `searchIndex({ query: q, workspaceRoot: ws })`: vector KNN
 *                     candidates before the join, rows surviving the join (scope
 *                     + quarantine), why the rest were dropped, BM25 rows, the
 *                     fused list size and the final hit count. Also records every
 *                     rerank call's input and output order. Writes
 *                     output/knn-starvation.raw.json.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import {
  MemorySearchService,
  MemoryStore,
  ObservationQueueStore,
} from '@ptah-extension/memory-curator';
import {
  OUT_DIR,
  WORKSPACE,
  collectorQuery,
  ensureCopyB,
  makeMigratedCopy,
  newestScopeEnumRow,
  scalar,
  writeJson,
} from './lib/copies';
import {
  makeLogger,
  openWorkingCopy,
  type HarnessConnection,
} from './lib/connection';
import { buildEmbedder } from './lib/embedder';

const TRACK_A_QUERIES: ReadonlyArray<readonly [string, string]> = [
  ['Q1', 'what did we decide about the judge threshold'],
  ['Q2', 'how do we name DI tokens'],
  ['Q3', 'why did the release branch drift'],
  ['Q4', "what is the user's preference for commit messages"],
];

/** Track A's 20 printed rows and its verdict (track-a-retrieval-measurement.md §3). */
const TRACK_A_ROWS: Record<
  string,
  ReadonlyArray<readonly [string, boolean]>
> = {
  Q1: [
    ['01M2G2YBXS5B29DB0HRQJP09S9', true],
    ['01M03AJC59MFRGJAMGFHFQF9NW', false],
    ['01KXBGZR5N04QE99N6W269GAWA', true],
    ['01KTMN28N2BD5CTF1PC2X09GEK', true],
    ['01KTM4M5GY25FQWVYQTA16YRHE', true],
  ],
  Q2: [
    ['01KVTQ0JRK249ZWWSS4J50C919', true],
    ['01KXCACXX4FXK8TH0RFFS61HC3', true],
    ['01KTRKXNHCAQD68454ZW28F2QC', true],
    ['01KWCEMKYZ0GM195MM9QG6V15N', false],
    ['01KWMDVPW4QKSQE97JWKCHH70V', true],
  ],
  Q3: [
    ['01M1JHQ2ZX974E7W48EMNT6HJG', true],
    ['01M1CW1PEZ96929CWN94GER54D', true],
    ['01KTH10JAVY9S7FQBEDFSXFGJT', true],
    ['01KXGQVEPVD5SS7T6EMDW0DYP0', true],
    ['01KTBMTDZAB85BRHE0TY0EKXWW', true],
  ],
  Q4: [
    ['01KTRN79C0KAXVJQ16AR08H54Y', true],
    ['01KVBCN6GG95S8G5ART67ZK4ZB', true],
    ['01KVBC8PFF81BWXJS4GSTGP0MP', true],
    ['01KVTH8ETY5JH0E3N8D2X1PJAT', false],
    ['01KV60ZM1ZQNQJGDR4XCZJ0314', false],
  ],
};

// ------------------------------------------------------------ instrumentation

interface SqlCall {
  readonly kind: 'fts' | 'knn' | 'join';
  readonly match?: unknown;
  readonly rows: number;
  /** fts: rowid (searchRich) or memory_id (searchIndex); knn: rowid; join: rowid. */
  readonly keys: unknown[];
  readonly distances?: number[];
}

/**
 * Wrap the adapted db so the three statement shapes the search paths issue
 * record their results: FTS MATCH, vec0 KNN, and the `mc.rowid IN (...)` join
 * that applies scope + quarantine after KNN.
 */
function instrument(db: SqliteDatabase, sink: SqlCall[]): SqliteDatabase {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== 'prepare') return Reflect.get(target, prop, receiver);
      return (sql: string) => {
        const stmt = target.prepare(sql) as unknown as {
          all(...p: unknown[]): unknown[];
        };
        let kind: SqlCall['kind'] | null = null;
        if (/memory_chunks_fts MATCH \?/.test(sql)) kind = 'fts';
        else if (
          /FROM memory_chunks_vec/.test(sql) &&
          /embedding MATCH \?/.test(sql)
        )
          kind = 'knn';
        else if (/WHERE mc\.rowid IN \(/.test(sql)) kind = 'join';
        if (kind === null) return stmt;
        const k = kind;
        return new Proxy(stmt, {
          get(s, p, r) {
            if (p !== 'all') return Reflect.get(s, p, r);
            return (...params: unknown[]) => {
              const rows = s.all(...params) as Array<Record<string, unknown>>;
              sink.push({
                kind: k,
                match: k === 'fts' ? params[0] : undefined,
                rows: rows.length,
                keys: rows.map((row) => row['rowid'] ?? row['memory_id']),
                distances:
                  k === 'knn'
                    ? rows.map((row) => Number(row['distance']))
                    : undefined,
              });
              return rows;
            };
          },
        });
      };
    },
  });
}

/** Same shape as copy-audit's MatchCall recorder, over the instrumented sink. */
function matchCalls(
  calls: readonly SqlCall[],
): Array<{ match: unknown; rows: number }> {
  return calls
    .filter((c) => c.kind === 'fts')
    .map((c) => ({ match: c.match, rows: c.rows }));
}

function plainEmbedder() {
  return {
    dim: 384,
    modelId:
      'harness-plain-embedder (never called: VecStatus.available = false)',
    embed: async () => {
      throw new Error(
        'plain embedder: vector path must not run in the BM25-only run',
      );
    },
    dispose: async () => undefined,
  };
}

function buildServices(
  logger: never,
  conn: HarnessConnection,
  sink: SqlCall[],
  embedder: unknown,
  vecAvailable: boolean,
): { store: MemoryStore; search: MemorySearchService } {
  const recordingDb = instrument(conn.db, sink);
  const connection = {
    get db() {
      return recordingDb;
    },
    vecExtensionLoaded: conn.vecExtensionLoaded,
  } as never;
  const vecStatus = {
    available: vecAvailable,
    reason: vecAvailable ? 'loaded' : 'harness-bm25-only',
  } as never;
  const store = new MemoryStore(
    logger,
    connection,
    embedder as never,
    vecStatus,
  );
  const search = new MemorySearchService(
    logger,
    connection,
    embedder as never,
    store,
    new ObservationQueueStore(logger, connection),
    vecStatus,
  );
  return { store, search };
}

// ----------------------------------------------------------- relevance-branch

async function runQueries(
  logger: never,
  conn: HarnessConnection,
): Promise<
  Array<
    Record<string, unknown> & {
      qid: string;
      hits: Array<{ memoryId: string }>;
      matchCalls: Array<{ match: unknown; rows: number }>;
    }
  >
> {
  const sink: SqlCall[] = [];
  const { search } = buildServices(logger, conn, sink, plainEmbedder(), false);
  const detail = conn.db.prepare(
    'SELECT kind, type, tier, workspace_root, archived_at, created_at, quarantined_at, quarantine_reason FROM memories WHERE id = ?',
  );
  const results = [];
  for (const [qid, query] of TRACK_A_QUERIES) {
    const before = sink.length;
    const t0 = performance.now();
    const response = await search.searchRich(query, 5, WORKSPACE);
    const ms = Math.round(performance.now() - t0);
    const hits = response.hits.map((h, i) => {
      const full = detail.get(h.memory.id) as Record<string, unknown>;
      return {
        rank: i + 1,
        memoryId: h.memory.id as string,
        subject: h.memory.subject,
        kind: full['kind'],
        type: full['type'],
        tier: full['tier'],
        workspaceRoot: full['workspace_root'],
        archivedAt: full['archived_at'],
        createdAt: full['created_at'],
        quarantinedAt: full['quarantined_at'],
        quarantineReason: full['quarantine_reason'],
        rrfScore: h.score,
        bm25Rank: h.bm25Rank,
        vecRank: h.vecRank,
        chunkText: h.chunk.text,
        content: h.memory.content,
      };
    });
    results.push({
      qid,
      query,
      bm25Only: response.bm25Only,
      ms,
      matchCalls: matchCalls(sink.slice(before)),
      hits,
    });
  }
  return results;
}

/** The branch bm25Search SQL minus the quarantine predicate, same scope and LIMIT 20. */
function unfilteredProbe(db: SqliteDatabase, match: string) {
  const top = db
    .prepare(
      `SELECT mc.rowid AS rowid, mc.memory_id AS memory_id, m.subject AS subject,
              m.quarantined_at AS quarantined_at, m.quarantine_reason AS reason
         FROM memory_chunks_fts fts
         JOIN memory_chunks mc ON mc.rowid = fts.rowid
         JOIN memories m ON m.id = mc.memory_id
        WHERE memory_chunks_fts MATCH ?
          AND m.workspace_root IS ?
        ORDER BY bm25(memory_chunks_fts) ASC
        LIMIT 20`,
    )
    .all(match, WORKSPACE) as Array<{
    rowid: number;
    memory_id: string;
    subject: string | null;
    quarantined_at: number | null;
    reason: string | null;
  }>;
  const quarantinedMatchingAnyRank = scalar(
    db,
    `SELECT COUNT(DISTINCT m.id) FROM memory_chunks_fts fts
       JOIN memory_chunks mc ON mc.rowid = fts.rowid
       JOIN memories m ON m.id = mc.memory_id
      WHERE memory_chunks_fts MATCH ? AND m.workspace_root IS ? AND m.quarantined_at IS NOT NULL`,
    match,
    WORKSPACE,
  );
  return {
    match,
    unfilteredTop20Rows: top.length,
    quarantinedInUnfilteredTop20: top
      .map((r, i) => ({ rank: i + 1, ...r }))
      .filter((r) => r.quarantined_at !== null),
    quarantinedRowsMatchingAtAnyRank: quarantinedMatchingAnyRank,
  };
}

async function runRelevanceBranch(): Promise<void> {
  const logger = makeLogger('branch-audit:relevance-branch', true);
  const made = await makeMigratedCopy('relbranch-copyA49.sqlite', 49);
  const conn = openWorkingCopy(made.record.target, { loadVec: false });
  try {
    const db = conn.db;
    const quarantineByReason = db
      .prepare(
        "SELECT quarantine_reason AS reason, COALESCE(workspace_root, '<NULL>') AS ws, COUNT(*) AS n FROM memories WHERE quarantined_at IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2",
      )
      .all();
    const quarantinedIds = new Set(
      (
        db
          .prepare('SELECT id FROM memories WHERE quarantined_at IS NOT NULL')
          .all() as Array<{ id: string }>
      ).map((r) => r.id),
    );
    const workspaceRows = scalar(
      db,
      'SELECT COUNT(*) FROM memories WHERE workspace_root IS ?',
      WORKSPACE,
    );
    const workspaceActiveRows = scalar(
      db,
      'SELECT COUNT(*) FROM memories WHERE workspace_root IS ? AND quarantined_at IS NULL',
      WORKSPACE,
    );

    // Track A existence on copy A (49 applied), before restore.
    const lookup = db.prepare(
      'SELECT id, subject, workspace_root, archived_at, quarantined_at FROM memories WHERE id = ?',
    );
    const trackA = Object.entries(TRACK_A_ROWS).flatMap(([qid, rows]) =>
      rows.map(([id, relevant]) => {
        const r = lookup.get(id) as
          | {
              subject: string | null;
              workspace_root: string | null;
              archived_at: number | null;
              quarantined_at: number | null;
            }
          | undefined;
        return {
          qid,
          id,
          trackARelevant: relevant,
          exists: r !== undefined,
          subject: r?.subject ?? null,
          workspaceRoot: r?.workspace_root ?? null,
          inScope: r !== undefined && r.workspace_root === WORKSPACE,
          archived: r !== undefined && r.archived_at !== null,
          quarantined: r !== undefined && r.quarantined_at !== null,
        };
      }),
    );

    const branch = await runQueries(logger, conn);
    const probes = branch.map((q) => ({
      qid: q.qid,
      expressions: q.matchCalls.map((m) =>
        unfilteredProbe(db, String(m.match)),
      ),
      branchHitsThatAreQuarantined: q.hits.filter((h) =>
        quarantinedIds.has(h.memoryId),
      ).length,
    }));

    // Restore-all through the store method the RPC calls, both scopes.
    const store = new MemoryStore(
      logger,
      conn.connection,
      plainEmbedder() as never,
      { available: false, reason: 'harness-bm25-only' } as never,
    );
    const restoredWs = store.restoreQuarantined({ all: true }, WORKSPACE);
    const restoredNull = store.restoreQuarantined({ all: true }, null);
    const remainingQuarantined = scalar(
      db,
      'SELECT COUNT(*) FROM memories WHERE quarantined_at IS NOT NULL',
    );
    const restored = await runQueries(logger, conn);

    const mainRaw = JSON.parse(
      fs.readFileSync(path.join(OUT_DIR, 'relevance-main.raw.json'), 'utf8'),
    ) as {
      results: Array<{
        qid: string;
        hits: Array<{ memoryId: string }>;
        matchCalls: Array<{ match: unknown; rows: number }>;
      }>;
    };
    const equivalence = restored.map((q) => {
      const main = mainRaw.results.find((m) => m.qid === q.qid);
      const mainIds = main?.hits.map((h) => h.memoryId) ?? [];
      const restoredIds = q.hits.map((h) => h.memoryId);
      const branchIds =
        branch.find((b) => b.qid === q.qid)?.hits.map((h) => h.memoryId) ?? [];
      return {
        qid: q.qid,
        mainIds,
        restoredIds,
        branchPreRestoreIds: branchIds,
        restoredEqualsMainOrdered:
          JSON.stringify(mainIds) === JSON.stringify(restoredIds),
        branchEqualsMainOrdered:
          JSON.stringify(mainIds) === JSON.stringify(branchIds),
        matchCallsMain: main?.matchCalls ?? null,
        matchCallsRestored: q.matchCalls,
      };
    });

    writeJson('relevance-branch.raw.json', {
      measurement:
        'Relevance "branch" + restore-all equivalence (implementation-plan.md measurement table, Relevance row, bullets 2-3)',
      code: 'BRANCH (this worktree), MIGRATIONS max asserted = 49',
      entryPoint: 'MemorySearchService.searchRich(query, 5, workspaceRoot)',
      vecStatusAvailable: false,
      embedder: 'plain stub (throws if called; never called), so no rerank',
      workspace: WORKSPACE,
      workingCopy: made.record,
      migration: {
        applied: made.applied,
        durationMs: made.migrationMs,
        schemaMaxAfter: made.schemaMax,
      },
      workspaceRows,
      workspaceActiveRowsBeforeRestore: workspaceActiveRows,
      quarantineByReasonAndScope: quarantineByReason,
      quarantinedTotal: quarantinedIds.size,
      trackAExistence: trackA,
      branch,
      unfilteredProbes: probes,
      restore: { restoredWs, restoredNull, remainingQuarantined },
      restored,
      equivalence,
    });
  } finally {
    conn.close();
  }
}

// ------------------------------------------------------------------------ knn

interface RerankRecord {
  readonly inputIds: string[];
  readonly outputIds: string[];
  readonly scores: number[];
}

function knnBreakdown(db: SqliteDatabase, rowids: unknown[]) {
  if (rowids.length === 0) {
    return {
      knnRowids: 0,
      chunkRowsFound: 0,
      inScope: 0,
      inScopeActive: 0,
      inScopeQuarantined: 0,
      otherScope: 0,
      quarantinedAnyScope: 0,
    };
  }
  const ph = rowids.map(() => '?').join(',');
  const row = db
    .prepare(
      `SELECT COUNT(*) AS found,
              COALESCE(SUM(CASE WHEN m.workspace_root IS ? THEN 1 ELSE 0 END), 0) AS in_scope,
              COALESCE(SUM(CASE WHEN m.workspace_root IS ? AND m.quarantined_at IS NULL THEN 1 ELSE 0 END), 0) AS in_scope_active,
              COALESCE(SUM(CASE WHEN m.workspace_root IS ? AND m.quarantined_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS in_scope_q,
              COALESCE(SUM(CASE WHEN m.quarantined_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS q_any
         FROM memory_chunks mc JOIN memories m ON m.id = mc.memory_id
        WHERE mc.rowid IN (${ph})`,
    )
    .get(WORKSPACE, WORKSPACE, WORKSPACE, ...rowids) as Record<string, number>;
  return {
    knnRowids: rowids.length,
    chunkRowsFound: Number(row['found']),
    inScope: Number(row['in_scope']),
    inScopeActive: Number(row['in_scope_active']),
    inScopeQuarantined: Number(row['in_scope_q']),
    otherScope: Number(row['found']) - Number(row['in_scope']),
    quarantinedAnyScope: Number(row['q_any']),
  };
}

/** executeFtsQueryPlan's merge (fts-query.util.ts), replayed over the recorded calls. */
function replayFtsPlan(fts: readonly SqlCall[], limit: number): unknown[] {
  if (fts.length === 0) return [];
  const primary = fts[0].keys;
  if (fts.length === 1) return primary;
  const fallback = fts[1].keys;
  if (primary.length === 0) return fallback;
  const out = [...primary];
  const seen = new Set(primary);
  for (const k of fallback) {
    if (seen.has(k)) continue;
    out.push(k);
    seen.add(k);
    if (out.length >= limit) break;
  }
  return out;
}

async function runKnn(): Promise<void> {
  const logger = makeLogger('branch-audit:knn', true);
  const copyB = await ensureCopyB();
  const madeA = await makeMigratedCopy('knn-copyA49.sqlite', 49);
  const embedder = buildEmbedder(logger);
  const reranks: RerankRecord[] = [];
  const origRerank = embedder.rerank.bind(embedder);
  // Instance override: keeps `instanceof EmbedderWorkerClient`, so
  // MemorySearchService still takes its rerank branch.
  (embedder as unknown as { rerank: typeof origRerank }).rerank = async (
    q,
    candidates,
    topK,
  ) => {
    const out = await origRerank(q, candidates, topK);
    reranks.push({
      inputIds: candidates.map((c) => c.id),
      outputIds: out.map((o) => o.id),
      scores: out.map((o) => o.score),
    });
    return out;
  };

  let draft: { id: string; subject: string; content: string; query: string };
  {
    const c = openWorkingCopy(copyB, { readonly: true });
    try {
      const row = newestScopeEnumRow(c.db);
      draft = {
        id: row.id,
        subject: row.subject,
        content: row.content,
        query: collectorQuery(row.subject, row.content),
      };
    } finally {
      c.close();
    }
  }
  const queries: Array<readonly [string, string]> = [
    ...TRACK_A_QUERIES,
    ['8a-draft', draft.query],
  ];
  const copies: Array<readonly [string, string]> = [
    ['before-0049 (copy B: 48 only, no quarantined rows)', copyB],
    ['after-0049 (knn-copyA49: 48 + 49)', madeA.record.target],
  ];
  const out = [];
  try {
    for (const [copyLabel, file] of copies) {
      const conn = openWorkingCopy(file, { readonly: true, loadVec: true });
      try {
        const quarantined = scalar(
          conn.db,
          'SELECT COUNT(*) FROM memories WHERE quarantined_at IS NOT NULL',
        );
        const sink: SqlCall[] = [];
        const { search } = buildServices(logger, conn, sink, embedder, true);
        const perQuery = [];
        for (const [qid, query] of queries) {
          // searchRich(q, 5, ws): KNN LIMIT = limit * 4 = 20.
          let s0 = sink.length;
          const r0 = reranks.length;
          let t0 = performance.now();
          const rich = await search.searchRich(query, 5, WORKSPACE);
          const richMs = Math.round(performance.now() - t0);
          let calls = sink.slice(s0);
          const knn = calls.find((c) => c.kind === 'knn');
          const join = calls.find((c) => c.kind === 'join');
          const bm25Keys = replayFtsPlan(
            calls.filter((c) => c.kind === 'fts'),
            20,
          );
          // vecSearchInner keeps KNN order for rows that survived the join.
          const joinSet = new Set(join?.keys ?? []);
          const vecKeys = (knn?.keys ?? []).filter((k) => joinSet.has(k));
          const fusedUnion = new Set([...bm25Keys, ...vecKeys]).size;
          const rr = reranks.slice(r0);
          const richRecord = {
            knnCandidates: knn?.rows ?? 0,
            knnBestDistance: knn?.distances?.[0] ?? null,
            knnWorstDistance:
              knn?.distances?.[knn.distances.length - 1] ?? null,
            survivingJoin: join?.rows ?? 0,
            breakdown: knnBreakdown(conn.db, knn?.keys ?? []),
            bm25Rows: bm25Keys.length,
            vecRowsAfterJoin: vecKeys.length,
            bm25VecOverlap: bm25Keys.filter((k) => joinSet.has(k)).length,
            fusedBeforeSlice: Math.min(20, fusedUnion),
            finalHits: rich.hits.length,
            bm25Only: rich.bm25Only,
            hitIds: rich.hits.map((h) => h.memory.id),
            hitSubjects: rich.hits.map((h) => h.memory.subject),
            hitVecRanks: rich.hits.map((h) => h.vecRank),
            hitBm25Ranks: rich.hits.map((h) => h.bm25Rank),
            rerank: rr.map((r) => ({
              inputCount: r.inputIds.length,
              outputCount: r.outputIds.length,
              distinctScores: [...new Set(r.scores)],
              outputIsInputPrefix: r.outputIds.every(
                (id, i) => r.inputIds[i] === id,
              ),
            })),
            ms: richMs,
          };
          // searchIndex({ query, workspaceRoot }): topK 20, KNN LIMIT 80.
          s0 = sink.length;
          t0 = performance.now();
          const idx = await search.searchIndex({
            query,
            workspaceRoot: WORKSPACE,
          });
          const idxMs = Math.round(performance.now() - t0);
          calls = sink.slice(s0);
          const iknn = calls.find((c) => c.kind === 'knn');
          const ijoin = calls.find((c) => c.kind === 'join');
          const ibm25 = replayFtsPlan(
            calls.filter((c) => c.kind === 'fts'),
            80,
          );
          const ijoinRowids = new Set(ijoin?.keys ?? []);
          const indexRecord = {
            knnCandidates: iknn?.rows ?? 0,
            survivingJoin: ijoin?.rows ?? 0,
            breakdown: knnBreakdown(conn.db, iknn?.keys ?? []),
            vecChunkRowsAfterJoin: (iknn?.keys ?? []).filter((k) =>
              ijoinRowids.has(k),
            ).length,
            bm25Memories: ibm25.length,
            finalRows: idx.rows.length,
            bm25Only: idx.bm25Only,
            ms: idxMs,
          };
          perQuery.push({
            qid,
            query: qid === '8a-draft' ? `${query.slice(0, 120)}…` : query,
            searchRich: richRecord,
            searchIndex: indexRecord,
          });
          process.stdout.write(
            `${copyLabel} ${qid}: rich knn=${richRecord.knnCandidates} join=${richRecord.survivingJoin} fused=${richRecord.fusedBeforeSlice} hits=${richRecord.finalHits} | index knn=${indexRecord.knnCandidates} join=${indexRecord.survivingJoin} rows=${indexRecord.finalRows}\n`,
          );
        }
        out.push({
          copy: copyLabel,
          file,
          quarantinedRows: quarantined,
          perQuery,
        });
      } finally {
        conn.close();
      }
    }
  } finally {
    await embedder.dispose();
  }
  writeJson('knn-starvation.raw.json', {
    measurement:
      'KNN starvation (implementation-plan.md measurement table; r1 finding 8) — accepted limitation, recorded',
    code: 'BRANCH (this worktree)',
    embedder:
      'REAL EmbedderWorkerClient (bge-small-en-v1.5 + ms-marco-MiniLM-L-6-v2) over lib/embedder.ts',
    vecStatusAvailable: true,
    workspace: WORKSPACE,
    knnCopyA: madeA.record,
    knnCopyAMigration: {
      applied: madeA.applied,
      durationMs: madeA.migrationMs,
    },
    draft8a: {
      sourceRowId: draft.id,
      subject: draft.subject,
      queryChars: draft.query.length,
    },
    results: out,
  });
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'relevance-branch') return runRelevanceBranch();
  if (mode === 'knn') return runKnn();
  throw new Error('usage: branch-audit.cjs <relevance-branch|knn>');
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(
      `branch-audit FAILED: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exit(1);
  },
);
