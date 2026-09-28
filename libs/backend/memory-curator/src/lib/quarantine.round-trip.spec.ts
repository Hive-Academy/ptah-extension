/**
 * TASK_2026_563 M5 criterion 6: the ONE round-trip spec that walks the whole
 * quarantine cycle across every agent-facing read path, on real SQLite (plus
 * sqlite-vec), with the production migrations 0048/0049 and the real
 * `MemoryStore`, `MemorySearchService`, `CorpusStore` and
 * `MergeCandidateCollector`. Other specs may test exclusion for a single path
 * (memory.store.spec.ts, memory-search.service.spec.ts,
 * memory-lifecycle.quarantine.spec.ts, corpus.store.spec.ts,
 * merge-candidate-collector.spec.ts, memory-rpc.handlers.spec.ts) — only this
 * one proves the cycle end to end, in BOTH a named workspace and the NULL
 * workspace, before and after restore. Re-run under
 * `ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron.cmd` for the second
 * driver; `openRetentionTestDb` picks whichever SQLite binding loads (it
 * throws rather than skips when neither loads, and when sqlite-vec cannot be
 * loaded — no silent green from a missing capability).
 *
 * Revision (code-logic-review batch-7, NEEDS_REVISION 5/10) fixed four gaps:
 * 1. The NULL-workspace row now gets the SAME exclusion/inclusion matrix as
 *    the named-workspace row, on every path, with fresh post-restore calls.
 * 2. `timeline` is now also exercised with an ACTIVE anchor and a quarantined
 *    neighbour (not only a quarantined anchor), excluded then restored.
 * 3. `searchIndex` is now exercised in its queryless (pure-filter) shape too,
 *    named-scope and unscoped, so removing `buildFilterClause`'s predicate
 *    would fail this spec even though the query-mode path is filtered
 *    upstream by `bm25SearchByMemory`.
 * 4. The search connection now reports `vecExtensionLoaded: true` truthfully
 *    (the retention test-support stand-in only exposes `db`), so
 *    `searchIndex`'s own vector branch actually runs, `bm25Only` is asserted
 *    false, and tier 2 is asserted to have actually collected rows, not just
 *    to have avoided the `tier1-empty` skip reason.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IEmbedder,
  SqliteConnectionService,
  VecStatusService,
} from '@ptah-extension/persistence-sqlite';
import { CorpusStore } from './knowledge-agents/corpus.store';
import type { ExtractedMemoryDraft } from './curator-llm/curator-llm.interface';
import { MergeCandidateCollector } from './curator-llm/merge-candidate-collector';
import { MemorySearchService } from './memory-search.service';
import { MemoryStore } from './memory.store';
import { memoryId } from './memory.types';
import type { ObservationQueueStore } from './observation-queue.store';
import {
  migrationSql,
  openRetentionTestDb,
  removeRetentionTempDirs,
  type RawDb,
  type RetentionTestDb,
} from './retention/retention-sqlite.test-support';

const WS = 'D:/projects/mqs-563-roundtrip';
const EMBED_DIM = 384;

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/** Every vector is the same zero vector, so vec KNN never decides membership. */
const zeroEmbedder = {
  dim: EMBED_DIM,
  embed: async (texts: readonly string[]) =>
    texts.map(() => new Float32Array(EMBED_DIM)),
} as unknown as IEmbedder;

function makeVecStatus(): VecStatusService {
  return { available: true } as unknown as VecStatusService;
}

function makeObservationQueue(): ObservationQueueStore {
  return {
    enqueue: jest.fn(),
    flush: jest.fn(),
    drainForSession: jest.fn(() => []),
    peekForSession: jest.fn(() => []),
    markProcessed: jest.fn(),
    countUnprocessed: jest.fn(() => 0),
  } as unknown as ObservationQueueStore;
}

interface SeedRowOptions {
  readonly id: string;
  readonly workspaceRoot: string | null;
  readonly subject: string;
  readonly content: string;
  /** Drives `created_at`/`updated_at`; also the default for `lastUsedAt`. Distinct values per row make `timeline` ordering meaningful. */
  readonly createdAt: number;
  readonly hits?: number;
  readonly salience?: number;
  readonly pinned?: number;
  readonly lastUsedAt?: number;
  readonly archivedAt?: number | null;
}

/**
 * Insert one fully-formed memory row plus one chunk (memory_chunks_fts is
 * populated by the production trigger; memory_chunks_vec is not, so it is
 * inserted explicitly, exactly as `MemoryStore.insertMemoryWithChunks` does).
 */
function seedRow(raw: RawDb, options: SeedRowOptions): void {
  const created = options.createdAt;
  const lastUsed = options.lastUsedAt ?? created;
  raw
    .prepare(
      `INSERT INTO memories (
         id, session_id, workspace_root, tier, kind, subject, content,
         source_message_ids, salience, decay_rate, hits, pinned,
         created_at, updated_at, last_used_at, archived_at, expires_at,
         request, investigated, learned, completed, next_steps,
         type, concepts_json, files_json
       ) VALUES (?, NULL, ?, 'recall', 'fact', ?, ?, '[]', ?, 0.01, ?, ?,
         ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, 'discovery', '[]', '[]')`,
    )
    .run(
      options.id,
      options.workspaceRoot,
      options.subject,
      options.content,
      options.salience ?? 0.5,
      options.hits ?? 0,
      options.pinned ?? 0,
      created,
      created,
      lastUsed,
      options.archivedAt ?? null,
    );
  const chunkId = `${options.id}-chunk-0`;
  raw
    .prepare(
      `INSERT INTO memory_chunks (id, memory_id, ord, text, token_count, created_at)
       VALUES (?, ?, 0, ?, 4, ?)`,
    )
    .run(chunkId, options.id, options.content, created);
  const row = raw
    .prepare('SELECT rowid FROM memory_chunks WHERE id = ?')
    .get(chunkId) as { rowid: number };
  raw
    .prepare('INSERT INTO memory_chunks_vec(rowid, embedding) VALUES (?, ?)')
    .run(BigInt(row.rowid), Buffer.from(new Float32Array(EMBED_DIM).buffer));
}

interface RowSnapshot {
  readonly content: string;
  readonly subject: string | null;
  readonly salience: number;
  readonly tier: string;
  readonly archived_at: number | null;
  readonly pinned: number;
  readonly hits: number;
  readonly last_used_at: number;
  readonly quarantined_at: number | null;
  readonly quarantine_reason: string | null;
}

function readRow(raw: RawDb, id: string): RowSnapshot | undefined {
  return raw
    .prepare(
      `SELECT content, subject, salience, tier, archived_at, pinned, hits,
              last_used_at, quarantined_at, quarantine_reason
         FROM memories WHERE id = ?`,
    )
    .get(id) as RowSnapshot | undefined;
}

function chunkTexts(raw: RawDb, id: string): readonly string[] {
  return (
    raw
      .prepare(
        'SELECT text FROM memory_chunks WHERE memory_id = ? ORDER BY ord',
      )
      .all(id) as Array<{ text: string }>
  ).map((r) => r.text);
}

function draft(subject: string, content: string): ExtractedMemoryDraft {
  return { kind: 'fact', subject, content, salienceHint: 0.5 };
}

const openDbs: RetentionTestDb[] = [];
afterEach(() => {
  for (const t of openDbs.splice(0)) t.close();
});
afterAll(() => removeRetentionTempDirs());

describe('quarantine round trip (TASK_2026_563 M5 criterion 6)', () => {
  it('excludes quarantined rows from every agent-facing path, in both a named and the NULL workspace, then restores them byte-for-byte', async () => {
    // ---- Arrange: real schema up to 0048 (production migration list). ----
    const t = openRetentionTestDb({ memorySchema: true, vec: true });
    openDbs.push(t);
    expect(['better-sqlite3', 'node:sqlite']).toContain(t.openerName);

    // Named workspace, in `created_at` order (distinct timestamps so
    // `timeline` ordering is meaningful): tier1-match (1000) < active-ws
    // (2000) < quarantine-ws (3000). quarantine-ws is active-ws's "after"
    // timeline neighbour, which is exactly the case finding 2 exercises.
    seedRow(t.raw, {
      id: 'tier1-match',
      workspaceRoot: WS,
      subject: 'roundtrip-merge-target',
      content: 'zephyr merge target baseline content.',
      createdAt: 1_000,
    });
    seedRow(t.raw, {
      id: 'active-ws',
      workspaceRoot: WS,
      subject: 'roundtrip-active',
      content: 'zephyr lighthouse briefing text.',
      createdAt: 2_000,
    });
    // R4 candidate: kind fact, subject LIKE '%commitlint%', content LIKE '%scope%'.
    seedRow(t.raw, {
      id: 'quarantine-ws',
      workspaceRoot: WS,
      subject: 'commitlint-scopes',
      content: 'zephyr commitlint scope list: webview, cli.',
      createdAt: 3_000,
      hits: 3,
      salience: 0.42,
      lastUsedAt: 555_555,
    });

    // NULL workspace, same shape and the same timestamp ordering.
    seedRow(t.raw, {
      id: 'tier1-match-null',
      workspaceRoot: null,
      subject: 'roundtrip-merge-target-null',
      content: 'zephyr merge target baseline content, null scope.',
      createdAt: 1_500,
    });
    seedRow(t.raw, {
      id: 'active-null',
      workspaceRoot: null,
      subject: 'roundtrip-active-null',
      content: 'zephyr harbor summary text.',
      createdAt: 2_500,
    });
    seedRow(t.raw, {
      id: 'quarantine-null',
      workspaceRoot: null,
      subject: 'Commitlint-Scope-Enum',
      content: 'zephyr commitlint scope enum listing for null workspace.',
      createdAt: 3_500,
      hits: 5,
      salience: 0.77,
      lastUsedAt: 666_666,
    });

    // ---- Apply 0049 (production SQL, the real R4 rule) on top of 0048. ----
    t.raw.exec(migrationSql(49));

    expect(readRow(t.raw, 'quarantine-ws')?.quarantine_reason).toBe(
      'rule:commitlint-scope-facts',
    );
    expect(readRow(t.raw, 'quarantine-null')?.quarantine_reason).toBe(
      'rule:commitlint-scope-facts',
    );
    for (const id of [
      'active-ws',
      'active-null',
      'tier1-match',
      'tier1-match-null',
    ]) {
      expect(readRow(t.raw, id)?.quarantined_at).toBeNull();
    }

    // Corpus member links created AFTER 0049 has run — the state a corpus
    // build could only reach before this task (the guard never quarantines an
    // already-linked row). One corpus per scope, so the NULL-workspace
    // quarantined row gets the same exclusion/restore/inclusion cycle as the
    // named-workspace one.
    const corpusStore = new CorpusStore(makeLogger(), t.connection);
    const corpus = corpusStore.create({
      name: 'roundtrip-corpus',
      workspaceRoot: WS,
    });
    corpusStore.setMemberIds(corpus.id, ['quarantine-ws']);
    const corpusNull = corpusStore.create({
      name: 'roundtrip-corpus-null',
      workspaceRoot: null,
    });
    corpusStore.setMemberIds(corpusNull.id, ['quarantine-null']);

    const store = new MemoryStore(
      makeLogger(),
      t.connection,
      zeroEmbedder,
      makeVecStatus(),
    );
    // Finding 4: the retention test-support connection stand-in exposes only
    // `db`; MemorySearchService's own vector branch (searchIndex) reads
    // `connection.vecExtensionLoaded` directly, so a stand-in without it
    // silently disables that branch even though sqlite-vec is loaded on the
    // real handle. This wrapper reports it truthfully, matching
    // memory-search.service.spec.ts's real-SQLite pattern.
    const searchConnection = {
      vecExtensionLoaded: true,
      get db() {
        return t.db;
      },
    } as unknown as SqliteConnectionService;
    const search = new MemorySearchService(
      makeLogger(),
      searchConnection,
      zeroEmbedder,
      store,
      makeObservationQueue(),
      makeVecStatus(),
    );
    const collector = new MergeCandidateCollector(makeLogger(), store, search);

    const qWsId = memoryId('quarantine-ws');

    // ---- Frozen while quarantined: recordUse and setPinned are no-ops. ----
    store.recordUse(['quarantine-ws', 'quarantine-null']);
    expect(store.setPinned(qWsId, true)).toBe(false);
    expect(readRow(t.raw, 'quarantine-ws')).toMatchObject({
      hits: 3,
      last_used_at: 555_555,
      pinned: 0,
    });
    expect(readRow(t.raw, 'quarantine-null')).toMatchObject({
      hits: 5,
      last_used_at: 666_666,
    });

    /**
     * Runs the FULL read-path matrix for one scope, returning the results so
     * the caller can assert membership. Always issues fresh calls (no shared
     * mutable state across pre/post-restore invocations), so a stale cache
     * cannot hide a regression either way.
     */
    async function readEverything(args: {
      readonly ws: string | null;
      readonly quarantinedId: string;
      readonly quarantinedSubject: string;
      readonly activeId: string;
      readonly tier1Id: string;
      readonly tier1Subject: string;
    }) {
      const {
        ws,
        quarantinedId,
        quarantinedSubject,
        activeId,
        tier1Id,
        tier1Subject,
      } = args;
      // `IMemoryReader.search` and `MemSearchIndexFilter.workspaceRoot` are
      // both typed `string` only (unchanged by this task; `searchRich` is the
      // one tri-state entry point) — they cannot scope to exactly the NULL
      // workspace, so for `ws === null` these are exercised separately below
      // via the unscoped (cross-workspace) calls, not here.
      const searchPage =
        ws === null ? null : await search.search('zephyr', 10, ws);
      const searchRich = await search.searchRich('zephyr', 10, ws);
      const indexQueried =
        ws === null
          ? null
          : await search.searchIndex({ query: 'zephyr', workspaceRoot: ws });
      // Queryless (pure-filter) shape: finding 3. This reaches
      // `listIndexRowsByFilter`, never `bm25SearchByMemory`/
      // `fetchCompactRowsByIds`, so it is sensitive to `buildFilterClause`'s
      // predicate alone.
      const indexFiltered =
        ws === null ? null : await search.searchIndex({ workspaceRoot: ws });
      const listAll = store.listAll(ws ?? undefined, undefined, 500, 0);
      const mergeCandidates = store.findMergeCandidates(
        [quarantinedSubject],
        ws,
      );
      const collected = await collector.collect(
        [draft(tier1Subject, `zephyr resolve prompt content for ${tier1Id}`)],
        ws,
      );
      const observations = search.getObservations({
        ids: [quarantinedId, activeId],
      });
      const activeById = store.getActiveById(memoryId(quarantinedId));
      return {
        searchPage,
        searchRich,
        indexQueried,
        indexFiltered,
        listAll,
        mergeCandidates,
        collected,
        observations,
        activeById,
      };
    }

    // ---- Assert exclusion on every agent-facing path, both scopes. ----
    const beforeWs = await readEverything({
      ws: WS,
      quarantinedId: 'quarantine-ws',
      quarantinedSubject: 'commitlint-scopes',
      activeId: 'active-ws',
      tier1Id: 'tier1-match',
      tier1Subject: 'roundtrip-merge-target',
    });
    expect(beforeWs.searchPage!.hits.map((h) => h.memoryId).sort()).toEqual([
      'active-ws',
      'tier1-match',
    ]);
    expect(beforeWs.searchPage!.bm25Only).toBe(false); // finding 4: hybrid actually ran
    expect(beforeWs.searchRich.hits.map((h) => h.memory.id).sort()).toEqual([
      'active-ws',
      'tier1-match',
    ]);
    expect(beforeWs.searchRich.bm25Only).toBe(false);
    expect(beforeWs.searchRich.hits.some((h) => h.vecRank !== null)).toBe(true); // finding 4: the vector reader actually contributed a rank
    expect(beforeWs.indexQueried!.rows.map((r) => r.id).sort()).toEqual([
      'active-ws',
      'tier1-match',
    ]);
    expect(beforeWs.indexQueried!.bm25Only).toBe(false);
    expect(beforeWs.indexFiltered!.rows.map((r) => r.id).sort()).toEqual([
      'active-ws',
      'tier1-match',
    ]);
    expect(beforeWs.listAll.memories.map((m) => m.id).sort()).toEqual([
      'active-ws',
      'tier1-match',
    ]);
    expect(beforeWs.mergeCandidates).toEqual([]);
    expect(beforeWs.collected.tier1Count).toBe(1);
    expect(beforeWs.collected.tier2Skipped).not.toBe('tier1-empty');
    expect(beforeWs.collected.tier2Count).toBeGreaterThan(0); // finding 4: tier 2 actually collected rows
    expect(beforeWs.collected.candidates.map((c) => c.id)).toContain(
      'active-ws',
    );
    expect(beforeWs.collected.candidates.map((c) => c.id)).not.toContain(
      'quarantine-ws',
    );
    expect(beforeWs.observations.memories.map((m) => m.id)).toEqual([
      'active-ws',
    ]);
    expect(beforeWs.activeById).toBeNull();
    expect(store.getById(qWsId)).not.toBeNull(); // raw identity lookup, unaffected
    expect(corpusStore.getCorpusMemoriesForPriming('roundtrip-corpus')).toEqual(
      [],
    );

    const beforeNull = await readEverything({
      ws: null,
      quarantinedId: 'quarantine-null',
      quarantinedSubject: 'Commitlint-Scope-Enum',
      activeId: 'active-null',
      tier1Id: 'tier1-match-null',
      tier1Subject: 'roundtrip-merge-target-null',
    });
    expect(beforeNull.searchRich.hits.map((h) => h.memory.id).sort()).toEqual([
      'active-null',
      'tier1-match-null',
    ]);
    // `IMemoryReader.search` and `searchIndex`'s filter cannot scope to
    // exactly NULL (unchanged by this task) — proven instead via the
    // cross-workspace unscoped calls below.
    const beforeUnscopedSearch = await search.search('zephyr', 10);
    expect(beforeUnscopedSearch.hits.map((h) => h.memoryId).sort()).toEqual([
      'active-null',
      'active-ws',
      'tier1-match',
      'tier1-match-null',
    ]);
    const beforeUnscopedIndex = await search.searchIndex({});
    expect(beforeUnscopedIndex.rows.map((r) => r.id).sort()).toEqual([
      'active-null',
      'active-ws',
      'tier1-match',
      'tier1-match-null',
    ]);
    expect(beforeNull.listAll.memories.map((m) => m.id)).not.toContain(
      'quarantine-null',
    );
    expect(beforeNull.mergeCandidates).toEqual([]);
    expect(beforeNull.collected.tier1Count).toBe(1);
    expect(beforeNull.collected.tier2Skipped).not.toBe('tier1-empty');
    expect(beforeNull.collected.candidates.map((c) => c.id)).not.toContain(
      'quarantine-null',
    );
    expect(beforeNull.observations.memories.map((m) => m.id)).toEqual([
      'active-null',
    ]);
    expect(beforeNull.activeById).toBeNull();
    expect(
      corpusStore.getCorpusMemoriesForPriming('roundtrip-corpus-null'),
    ).toEqual([]);

    // ---- timeline: quarantined anchor -> empty (existing case). ----
    expect(
      search.timeline({ anchorId: 'quarantine-ws', workspaceRoot: WS }),
    ).toEqual({
      rows: [],
      anchorIndex: 0,
    });
    expect(search.timeline({ anchorId: 'quarantine-null' })).toEqual({
      rows: [],
      anchorIndex: 0,
    });
    // ---- timeline: ACTIVE anchor with a quarantined NEIGHBOUR (finding 2). ----
    // Order by created_at in WS: tier1-match(1000) < active-ws(2000, anchor)
    // < quarantine-ws(3000, the "after" neighbour). The neighbour must be
    // absent before restore.
    const timelineActiveAnchorBefore = search.timeline({
      anchorId: 'active-ws',
      workspaceRoot: WS,
    });
    expect(timelineActiveAnchorBefore.rows.map((r) => r.id)).toEqual([
      'tier1-match',
      'active-ws',
    ]);
    expect(timelineActiveAnchorBefore.anchorIndex).toBe(1);

    // ---- Act: restore, the exact RPC path (all:true) for each scope. ----
    expect(store.restoreQuarantined({ all: true }, WS)).toEqual({
      restored: 1,
    });
    expect(store.restoreQuarantined({ all: true }, null)).toEqual({
      restored: 1,
    });
    // Idempotent: a second call in each scope restores nothing further.
    expect(store.restoreQuarantined({ all: true }, WS)).toEqual({
      restored: 0,
    });
    expect(store.restoreQuarantined({ all: true }, null)).toEqual({
      restored: 0,
    });

    // ---- Assert every restored row is byte-for-byte unchanged. ----
    expect(readRow(t.raw, 'quarantine-ws')).toEqual({
      content: 'zephyr commitlint scope list: webview, cli.',
      subject: 'commitlint-scopes',
      salience: 0.42,
      tier: 'recall',
      archived_at: null,
      pinned: 0,
      hits: 3,
      last_used_at: 555_555,
      quarantined_at: null,
      quarantine_reason: null,
    });
    expect(readRow(t.raw, 'quarantine-null')).toEqual({
      content: 'zephyr commitlint scope enum listing for null workspace.',
      subject: 'Commitlint-Scope-Enum',
      salience: 0.77,
      tier: 'recall',
      archived_at: null,
      pinned: 0,
      hits: 5,
      last_used_at: 666_666,
      quarantined_at: null,
      quarantine_reason: null,
    });
    expect(chunkTexts(t.raw, 'quarantine-ws')).toEqual([
      'zephyr commitlint scope list: webview, cli.',
    ]);
    expect(chunkTexts(t.raw, 'quarantine-null')).toEqual([
      'zephyr commitlint scope enum listing for null workspace.',
    ]);

    // ---- Assert inclusion again on every path, both scopes, with FRESH calls. ----
    const afterWs = await readEverything({
      ws: WS,
      quarantinedId: 'quarantine-ws',
      quarantinedSubject: 'commitlint-scopes',
      activeId: 'active-ws',
      tier1Id: 'tier1-match',
      tier1Subject: 'roundtrip-merge-target',
    });
    expect(afterWs.searchPage!.hits.map((h) => h.memoryId).sort()).toEqual([
      'active-ws',
      'quarantine-ws',
      'tier1-match',
    ]);
    expect(afterWs.searchPage!.bm25Only).toBe(false);
    expect(afterWs.searchRich.hits.map((h) => h.memory.id).sort()).toEqual([
      'active-ws',
      'quarantine-ws',
      'tier1-match',
    ]);
    expect(afterWs.indexQueried!.rows.map((r) => r.id).sort()).toEqual([
      'active-ws',
      'quarantine-ws',
      'tier1-match',
    ]);
    expect(afterWs.indexFiltered!.rows.map((r) => r.id).sort()).toEqual([
      'active-ws',
      'quarantine-ws',
      'tier1-match',
    ]);
    expect(afterWs.listAll.memories.map((m) => m.id).sort()).toEqual([
      'active-ws',
      'quarantine-ws',
      'tier1-match',
    ]);
    expect(afterWs.mergeCandidates.map((c) => c.id)).toEqual(['quarantine-ws']);
    expect(afterWs.collected.candidates.map((c) => c.id)).toEqual(
      expect.arrayContaining(['quarantine-ws']),
    );
    expect(afterWs.observations.memories.map((m) => m.id).sort()).toEqual([
      'active-ws',
      'quarantine-ws',
    ]);
    expect(afterWs.activeById?.id).toBe('quarantine-ws');
    expect(
      corpusStore
        .getCorpusMemoriesForPriming('roundtrip-corpus')
        .map((m) => m.id),
    ).toEqual(['quarantine-ws']);

    const afterNull = await readEverything({
      ws: null,
      quarantinedId: 'quarantine-null',
      quarantinedSubject: 'Commitlint-Scope-Enum',
      activeId: 'active-null',
      tier1Id: 'tier1-match-null',
      tier1Subject: 'roundtrip-merge-target-null',
    });
    expect(afterNull.searchRich.hits.map((h) => h.memory.id).sort()).toEqual([
      'active-null',
      'quarantine-null',
      'tier1-match-null',
    ]);
    const afterUnscopedSearch = await search.search('zephyr', 10);
    expect(afterUnscopedSearch.hits.map((h) => h.memoryId).sort()).toEqual([
      'active-null',
      'active-ws',
      'quarantine-null',
      'quarantine-ws',
      'tier1-match',
      'tier1-match-null',
    ]);
    const afterUnscopedIndex = await search.searchIndex({});
    expect(afterUnscopedIndex.rows.map((r) => r.id).sort()).toEqual([
      'active-null',
      'active-ws',
      'quarantine-null',
      'quarantine-ws',
      'tier1-match',
      'tier1-match-null',
    ]);
    expect(afterNull.listAll.memories.map((m) => m.id)).toContain(
      'quarantine-null',
    );
    expect(afterNull.mergeCandidates.map((c) => c.id)).toEqual([
      'quarantine-null',
    ]);
    expect(afterNull.collected.candidates.map((c) => c.id)).toEqual(
      expect.arrayContaining(['quarantine-null']),
    );
    expect(afterNull.observations.memories.map((m) => m.id).sort()).toEqual([
      'active-null',
      'quarantine-null',
    ]);
    expect(afterNull.activeById?.id).toBe('quarantine-null');
    expect(
      corpusStore
        .getCorpusMemoriesForPriming('roundtrip-corpus-null')
        .map((m) => m.id),
    ).toEqual(['quarantine-null']);

    // ---- timeline: both cases restored. ----
    const timelineQuarantinedAnchorAfter = search.timeline({
      anchorId: 'quarantine-ws',
      workspaceRoot: WS,
    });
    expect(timelineQuarantinedAnchorAfter.rows.map((r) => r.id)).toEqual([
      'tier1-match',
      'active-ws',
      'quarantine-ws',
    ]);
    expect(timelineQuarantinedAnchorAfter.anchorIndex).toBe(2);

    const timelineNullAnchorAfter = search.timeline({
      anchorId: 'quarantine-null',
    });
    expect(timelineNullAnchorAfter.rows.map((r) => r.id)).toEqual([
      'tier1-match-null',
      'active-null',
      'quarantine-null',
    ]);
    expect(timelineNullAnchorAfter.anchorIndex).toBe(2);

    // The active-anchor case: its previously-excluded "after" neighbour
    // (quarantine-ws) is now present.
    const timelineActiveAnchorAfter = search.timeline({
      anchorId: 'active-ws',
      workspaceRoot: WS,
    });
    expect(timelineActiveAnchorAfter.rows.map((r) => r.id)).toEqual([
      'tier1-match',
      'active-ws',
      'quarantine-ws',
    ]);
    expect(timelineActiveAnchorAfter.anchorIndex).toBe(1);
  });
});
