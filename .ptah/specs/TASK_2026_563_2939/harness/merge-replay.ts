/**
 * merge-replay — M3 reach (8a) and M3 replay (8b) (implementation-plan.md
 * measurement table rows "M3 reach" and "M3 replay", plan:1027-1028, and the
 * commitlint rule at plan:1041-1044). Bundled against the BRANCH sources
 * (asserts MIGRATIONS max = 49 through lib/copies.ts).
 *
 * Copy B: backup-API working copy migrated to 48 ONLY (M5 off), created once
 * by `lib/copies.ts` ensureCopyB and only read afterwards.
 *
 * Modes (first CLI argument):
 *
 *   reach <label>  8(a). Draft = { kind: 'fact', subject: 'commitlint-scope-enum',
 *                  content: <newest commitlint-scope-enum row in the workspace
 *                  on copy B, verbatim> }. Before = MemoryStore
 *                  .findMergeCandidates(['commitlint-scope-enum'], ws). After =
 *                  the shipped MergeCandidateCollector.collect([draft], ws),
 *                  unmodified, over the real MemorySearchService with the REAL
 *                  embedder and reranker (VecStatus.available = true). Counts
 *                  distinct TRIM(LOWER(subject)) LIKE '%commitlint%' in each
 *                  set. Every run installs lib/net-guard.ts in the main thread
 *                  and the embedder worker; run it once plainly (`direct`) and
 *                  once with HTTPS_PROXY/HTTP_PROXY=http://127.0.0.1:9 and
 *                  NODE_USE_ENV_PROXY=1 (`proxy`). Writes
 *                  output/m3-reach-<label>.json.
 *
 *   select         8(b) replay-set selection on copy B, seed
 *                  `TASK_2026_563_2939:m3`: workspace rows in DESCENDING
 *                  sha256(seed + ':' + id) hex order; a row qualifies when one
 *                  of its chunks, re-embedded with the REAL embedder, has a
 *                  vec0 KNN neighbour chunk of ANOTHER memory in the same
 *                  workspace with a different case-folded subject and exact
 *                  cosine similarity >= 0.85. The first 20 qualifiers are the
 *                  set; the 0.85 bar is never lowered. If fewer than 3
 *                  commitlint-family rows qualify, the 3 newest family rows are
 *                  added as fixed extras (plan:1041-1044). Writes
 *                  output/m3-replay-set.json.
 *
 *   replay         8(b) run. Copy B' = a fresh backup-API copy migrated to 48
 *                  with every replay row removed through MemoryStore.forget.
 *                  Phase 1 (local, timed, sequential): per draft, the three
 *                  candidate sets -
 *                    before : tier 1 only (findMergeCandidates)
 *                    after-A: the shipped collector with tier 2 FORCED on (see
 *                             forcedTier2Store below)
 *                    after-B: the shipped collector, unmodified (D4 = B)
 *                  -> %TEMP%\mqs-563-eval\m3-candidates.json.
 *                  Phase 2: one real SdkInternalQueryCuratorLlm.resolve([draft],
 *                  candidates) per draft and variant (before: BASE resolve
 *                  prompt; after-A/after-B: BRANCH prompt), MCP off (lib/llm.ts).
 *                  resolve() itself returns without an LLM call when the list is
 *                  empty. Each result is appended to
 *                  %TEMP%\mqs-563-eval\m3-calls.jsonl; a re-run resumes.
 *
 *   report         Aggregate m3-candidates.json + m3-calls.jsonl, applying the
 *                  memory-curator.service.ts eligibleMergeTarget guard (id in the
 *                  candidate list sent, AND getMergeTarget(id, ws) non-null on
 *                  copy B'). Writes output/m3-replay.json.
 */
import 'reflect-metadata';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import {
  MemorySearchService,
  MemoryStore,
  ObservationQueueStore,
  memoryId,
} from '@ptah-extension/memory-curator';
import {
  MergeCandidateCollector,
  type MergeCandidate,
  type MergeCandidateSet,
} from '../../../../libs/backend/memory-curator/src/lib/curator-llm/merge-candidate-collector';
import type { ExtractedMemoryDraft } from '../../../../libs/backend/memory-curator/src/lib/curator-llm/curator-llm.interface';
import { EVAL_DIR } from './lib/copy-db';
import {
  makeLogger,
  openWorkingCopy,
  type HarnessConnection,
} from './lib/connection';
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
import { buildEmbedder } from './lib/embedder';
import {
  buildCuratorLlm,
  callLabel,
  type LlmCallRecord,
  type PromptVariant,
} from './lib/llm';
import { installNetGuard } from './lib/net-guard';

export const M3_SEED = 'TASK_2026_563_2939:m3';
const REPLAY_SIZE = 20;
const COSINE_BAR = 0.85;
const MIN_FAMILY_DRAFTS = 3;
const COPY_B_PRIME = 'copyBprime-m3.sqlite';
const CANDIDATES_FILE = path.join(EVAL_DIR, 'm3-candidates.json');
const CALLS_FILE = path.join(EVAL_DIR, 'm3-calls.jsonl');
const REPLAY_SET_FILE = path.join(OUT_DIR, 'm3-replay-set.json');
const CONCURRENCY = Number(process.env['MQS_M3_CONCURRENCY'] ?? '3');
/** Fixed for every draft in every variant; the rows carry no hint and resolve does not rank on it. */
const DRAFT_SALIENCE_HINT = 0.5;
const SENTINEL_ID = '__mqs_after_a_forced_tier2__';

type Variant = 'before' | 'after-A' | 'after-B';
const VARIANTS: readonly Variant[] = ['before', 'after-A', 'after-B'];
const PROMPT_OF: Record<Variant, PromptVariant> = {
  before: 'old',
  'after-A': 'new',
  'after-B': 'new',
};

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function fold(subject: string | null): string | null {
  if (subject === null) return null;
  const s = subject.trim().toLowerCase();
  return s.length === 0 ? null : s;
}

function isFamily(subject: string | null): boolean {
  return (fold(subject) ?? '').includes('commitlint');
}

interface RerankRecord {
  readonly inputIds: string[];
  readonly outputIds: string[];
  readonly scores: number[];
}

/**
 * The real services over one working copy, with the REAL embedder. The rerank
 * wrapper is an instance override, so `instanceof EmbedderWorkerClient` still
 * holds and MemorySearchService still takes its rerank branch; it only records.
 */
function buildServices(
  logger: never,
  conn: HarnessConnection,
  embedder: ReturnType<typeof buildEmbedder>,
): { store: MemoryStore; search: MemorySearchService } {
  const vecStatus = { available: true, reason: 'loaded' } as never;
  const store = new MemoryStore(
    logger,
    conn.connection,
    embedder as never,
    vecStatus,
  );
  const search = new MemorySearchService(
    logger,
    conn.connection,
    embedder as never,
    store,
    new ObservationQueueStore(logger, conn.connection),
    vecStatus,
  );
  return { store, search };
}

function recordReranks(
  embedder: ReturnType<typeof buildEmbedder>,
  sink: RerankRecord[],
): void {
  const orig = embedder.rerank.bind(embedder);
  (embedder as unknown as { rerank: typeof orig }).rerank = async (
    q,
    candidates,
    topK,
  ) => {
    const out = await orig(q, candidates, topK);
    sink.push({
      inputIds: candidates.map((c) => c.id),
      outputIds: out.map((o) => o.id),
      scores: out.map((o) => o.score),
    });
    return out;
  };
}

function summariseReranks(records: readonly RerankRecord[]) {
  return {
    calls: records.length,
    distinctScores: [...new Set(records.flatMap((r) => r.scores))],
    everyOutputIsInputPrefix: records.every((r) =>
      r.outputIds.every((id, i) => r.inputIds[i] === id),
    ),
  };
}

function familyStats(
  candidates: ReadonlyArray<{ id: string; subject: string | null }>,
) {
  const family = candidates.filter((c) => isFamily(c.subject));
  const subjects = [
    ...new Set(family.map((c) => fold(c.subject) as string)),
  ].sort();
  return {
    rows: candidates.length,
    familyRows: family.length,
    distinctFamilySubjects: subjects.length,
    familySubjects: subjects,
  };
}

// ------------------------------------------------------------------ 8(a) reach

async function reach8a(label: string): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(label))
    throw new Error('usage: merge-replay.cjs reach <label>');
  const guard = installNetGuard(`m3-reach-${label}`);
  const logger = makeLogger('merge-replay:reach', true);
  const copyB = await ensureCopyB();
  const conn = openWorkingCopy(copyB, { readonly: true, loadVec: true });
  const embedder = buildEmbedder(logger, guard.workerPath);
  const reranks: RerankRecord[] = [];
  recordReranks(embedder, reranks);
  try {
    const db = conn.db;
    const source = newestScopeEnumRow(db);
    const draft: ExtractedMemoryDraft = {
      kind: 'fact',
      subject: 'commitlint-scope-enum',
      content: source.content,
      salienceHint: DRAFT_SALIENCE_HINT,
    };
    const familyInWorkspace = db
      .prepare(
        `SELECT TRIM(LOWER(subject)) AS s, COUNT(*) AS n FROM memories
          WHERE workspace_root IS ? AND TRIM(LOWER(subject)) LIKE '%commitlint%' GROUP BY 1 ORDER BY 1`,
      )
      .all(WORKSPACE) as Array<{ s: string; n: number }>;
    const familyAllScopes = scalar(
      db,
      "SELECT COUNT(DISTINCT TRIM(LOWER(subject))) FROM memories WHERE TRIM(LOWER(subject)) LIKE '%commitlint%'",
    );
    const familyRowsAllScopes = scalar(
      db,
      "SELECT COUNT(*) FROM memories WHERE TRIM(LOWER(subject)) LIKE '%commitlint%'",
    );
    const { store, search } = buildServices(logger, conn, embedder);

    const b0 = performance.now();
    const before = store.findMergeCandidates(
      ['commitlint-scope-enum'],
      WORKSPACE,
    );
    const beforeMs = performance.now() - b0;
    const collector = new MergeCandidateCollector(logger, store, search);
    const a0 = performance.now();
    const after = await collector.collect([draft], WORKSPACE);
    const afterMs = performance.now() - a0;

    const describe = (
      rows: ReadonlyArray<MergeCandidate>,
      tier1Count: number,
    ) =>
      rows.map((c, i) => ({
        tier: i < tier1Count ? 1 : 2,
        id: c.id,
        subject: c.subject,
        family: isFamily(c.subject),
        content: c.content.slice(0, 160),
      }));
    const beforeStats = familyStats(before);
    const afterStats = familyStats(after.candidates);
    const attempts = guard.attempts();
    writeJson(`m3-reach-${label}.json`, {
      measurement:
        'M3 reach 8(a) (implementation-plan.md measurement table, "M3 reach")',
      label,
      env: {
        HTTPS_PROXY: process.env['HTTPS_PROXY'] ?? null,
        HTTP_PROXY: process.env['HTTP_PROXY'] ?? null,
        NODE_USE_ENV_PROXY: process.env['NODE_USE_ENV_PROXY'] ?? null,
      },
      copyB,
      workspace: WORKSPACE,
      draftSource: {
        id: source.id,
        subject: source.subject,
        createdAt: source.created_at,
        createdAtIso: new Date(source.created_at).toISOString(),
      },
      draft,
      family: {
        distinctSubjectsInWorkspace: familyInWorkspace.length,
        rowsInWorkspace: familyInWorkspace.reduce((a, r) => a + Number(r.n), 0),
        distinctSubjectsAllScopes: familyAllScopes,
        rowsAllScopes: familyRowsAllScopes,
        subjectsInWorkspace: familyInWorkspace,
      },
      before: {
        call: "findMergeCandidates(['commitlint-scope-enum'], ws)",
        ms: Number(beforeMs.toFixed(2)),
        ...beforeStats,
        rowsDetail: describe(before, before.length),
      },
      after: {
        call: 'MergeCandidateCollector.collect([draft], ws) — shipped code, unmodified',
        ms: Math.round(afterMs),
        tier1Count: after.tier1Count,
        tier2Count: after.tier2Count,
        tier2Queries: after.tier2Queries,
        tier2Skipped: after.tier2Skipped,
        bm25Only: after.bm25Only,
        ...afterStats,
        rowsDetail: describe(after.candidates, after.tier1Count),
      },
      gate: {
        afterGreaterThanBefore:
          afterStats.distinctFamilySubjects >
          beforeStats.distinctFamilySubjects,
      },
      rerank: summariseReranks(reranks),
      network: {
        guardLog: guard.logFile,
        installedIn: guard.installs().map((r) => r.tag),
        attempts: attempts.length,
        attemptsDetail: attempts,
      },
    });
  } finally {
    await embedder.dispose();
    conn.close();
  }
}

// --------------------------------------------------------------- 8(b) select

interface ReplayRow {
  readonly id: string;
  readonly hash: string;
  readonly kind: ExtractedMemoryDraft['kind'];
  readonly subject: string | null;
  readonly content: string;
  readonly type: string | null;
  readonly concepts: string[];
  readonly files: string[];
  readonly createdAt: number;
  readonly neighbour?: {
    readonly chunkOrd: number;
    readonly neighbourMemoryId: string;
    readonly neighbourSubject: string | null;
    readonly neighbourChunkRowid: number;
    readonly cosine: number;
    readonly knnK: number;
  };
}

function toFloat32(buf: Buffer): Float32Array {
  const copy = Buffer.from(buf);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function parseArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

async function selectReplaySet(): Promise<void> {
  const logger = makeLogger('merge-replay:select', true);
  const copyB = await ensureCopyB();
  const conn = openWorkingCopy(copyB, { readonly: true, loadVec: true });
  const embedder = buildEmbedder(logger);
  try {
    const db = conn.db;
    type Row = {
      id: string;
      kind: ReplayRow['kind'];
      subject: string | null;
      content: string;
      type: string | null;
      concepts_json: string | null;
      files_json: string | null;
      created_at: number;
    };
    const rows = (
      db
        .prepare(
          'SELECT id, kind, subject, content, type, concepts_json, files_json, created_at FROM memories WHERE workspace_root IS ?',
        )
        .all(WORKSPACE) as Row[]
    )
      .map((r) => ({ ...r, hash: sha256(`${M3_SEED}:${r.id}`) }))
      .sort((a, b) => (a.hash < b.hash ? 1 : a.hash > b.hash ? -1 : 0));

    // Stored-vector norms: if they are unit length, vec0's L2 order equals cosine order.
    const normSample = (
      db
        .prepare('SELECT embedding FROM memory_chunks_vec LIMIT 500')
        .all() as Array<{ embedding: Buffer }>
    ).map((r) => {
      const v = toFloat32(r.embedding);
      return Math.sqrt(v.reduce((a, x) => a + x * x, 0));
    });
    const chunksOf = db.prepare(
      'SELECT rowid AS rowid, ord, text FROM memory_chunks WHERE memory_id = ? ORDER BY ord',
    );
    const storedVec = db.prepare(
      'SELECT embedding FROM memory_chunks_vec WHERE rowid = ?',
    );
    const t0 = performance.now();
    const selected: ReplayRow[] = [];
    let examined = 0;
    let noChunks = 0;
    let maxKUsed = 0;
    const selfCosines: number[] = [];

    for (const r of rows) {
      if (selected.length >= REPLAY_SIZE) break;
      examined++;
      const chunks = chunksOf.all(r.id) as Array<{
        rowid: number;
        ord: number;
        text: string;
      }>;
      if (chunks.length === 0) {
        noChunks++;
        continue;
      }
      const vectors = await embedder.embed(chunks.map((c) => c.text));
      let best: ReplayRow['neighbour'] | undefined;
      for (let ci = 0; ci < chunks.length; ci++) {
        const q = vectors[ci];
        const own = storedVec.get(chunks[ci].rowid) as
          { embedding: Buffer } | undefined;
        if (own) selfCosines.push(cosine(q, toFloat32(own.embedding)));
        const qbuf = Buffer.from(q.buffer, q.byteOffset, q.byteLength);
        for (let k = 64; ; k *= 2) {
          maxKUsed = Math.max(maxKUsed, k);
          const knn = db
            .prepare(
              'SELECT rowid AS rowid, distance AS distance FROM memory_chunks_vec WHERE embedding MATCH ? ORDER BY distance ASC LIMIT ?',
            )
            .all(qbuf, k) as Array<{ rowid: number; distance: number }>;
          if (knn.length === 0) break;
          const ph = knn.map(() => '?').join(',');
          const meta = new Map(
            (
              db
                .prepare(
                  `SELECT mc.rowid AS rowid, mc.memory_id AS memory_id, m.workspace_root AS ws, m.subject AS subject
                   FROM memory_chunks mc JOIN memories m ON m.id = mc.memory_id WHERE mc.rowid IN (${ph})`,
                )
                .all(...knn.map((x) => x.rowid)) as Array<{
                rowid: number;
                memory_id: string;
                ws: string | null;
                subject: string | null;
              }>
            ).map((m) => [m.rowid, m]),
          );
          let found: ReplayRow['neighbour'] | undefined;
          for (const n of knn) {
            const m = meta.get(n.rowid);
            if (
              !m ||
              m.memory_id === r.id ||
              m.ws !== WORKSPACE ||
              fold(m.subject) === fold(r.subject)
            )
              continue;
            const nv = storedVec.get(n.rowid) as
              { embedding: Buffer } | undefined;
            if (!nv) continue;
            const cos = cosine(q, toFloat32(nv.embedding));
            if (!found || cos > found.cosine) {
              found = {
                chunkOrd: chunks[ci].ord,
                neighbourMemoryId: m.memory_id,
                neighbourSubject: m.subject,
                neighbourChunkRowid: n.rowid,
                cosine: cos,
                knnK: k,
              };
            }
          }
          if (found) {
            if (!best || found.cosine > best.cosine) best = found;
            break;
          }
          // No qualifying neighbour among the k nearest. Widen only while the
          // k-th neighbour is itself still >= the bar; past it nothing can qualify.
          const last = storedVec.get(knn[knn.length - 1].rowid) as
            { embedding: Buffer } | undefined;
          const lastCos = last ? cosine(q, toFloat32(last.embedding)) : -1;
          // sqlite-vec caps k at 4096.
          if (lastCos < COSINE_BAR || knn.length < k || k >= 4096) break;
        }
      }
      if (best && best.cosine >= COSINE_BAR) {
        selected.push({
          id: r.id,
          hash: r.hash,
          kind: r.kind,
          subject: r.subject,
          content: r.content,
          type: r.type,
          concepts: parseArray(r.concepts_json),
          files: parseArray(r.files_json),
          createdAt: r.created_at,
          neighbour: best,
        });
        process.stdout.write(
          `selected ${selected.length}/${REPLAY_SIZE} after ${examined} rows: ${r.id} ${r.subject} ~ ${best.neighbourSubject} cos=${best.cosine.toFixed(4)}\n`,
        );
      }
      if (examined % 250 === 0)
        process.stdout.write(
          `examined ${examined}, selected ${selected.length}\n`,
        );
    }
    const selectionMs = Math.round(performance.now() - t0);

    const familySelected = selected.filter((s) => isFamily(s.subject)).length;
    const extras: ReplayRow[] = [];
    if (familySelected < MIN_FAMILY_DRAFTS) {
      const taken = new Set(selected.map((s) => s.id));
      const fam = db
        .prepare(
          `SELECT id, kind, subject, content, type, concepts_json, files_json, created_at FROM memories
            WHERE workspace_root IS ? AND TRIM(LOWER(subject)) LIKE '%commitlint%'
            ORDER BY created_at DESC, id DESC`,
        )
        .all(WORKSPACE) as Row[];
      for (const f of fam) {
        if (extras.length >= MIN_FAMILY_DRAFTS) break;
        if (taken.has(f.id)) continue;
        extras.push({
          id: f.id,
          hash: sha256(`${M3_SEED}:${f.id}`),
          kind: f.kind,
          subject: f.subject,
          content: f.content,
          type: f.type,
          concepts: parseArray(f.concepts_json),
          files: parseArray(f.files_json),
          createdAt: f.created_at,
        });
      }
    }
    const setIds = new Set([...selected, ...extras].map((s) => s.id));
    writeJson('m3-replay-set.json', {
      measurement:
        'M3 replay 8(b) replay set (implementation-plan.md measurement table, "M3 replay")',
      seed: M3_SEED,
      hashInput:
        "sha256(seed + ':' + memory id), hex, DESCENDING (highest first)",
      copyB,
      workspace: WORKSPACE,
      workspaceRows: rows.length,
      rule: `a chunk of the row, re-embedded with the REAL embedder, has a vec0 KNN neighbour chunk of another memory in the same workspace with a different TRIM(LOWER(subject)) and exact cosine >= ${COSINE_BAR}; KNN starts at k=64 and doubles while the k-th neighbour is still >= the bar (max 4096, the sqlite-vec k cap)`,
      rowsExamined: examined,
      rowsWithoutChunks: noChunks,
      maxKUsed,
      selectionMs,
      storedVectorNorms: {
        sampled: normSample.length,
        min: Math.min(...normSample),
        max: Math.max(...normSample),
      },
      reembedVsStoredOwnChunkCosine: {
        chunks: selfCosines.length,
        min: selfCosines.length ? Math.min(...selfCosines) : null,
        max: selfCosines.length ? Math.max(...selfCosines) : null,
      },
      selected,
      selectedCount: selected.length,
      familySelected,
      extras,
      extrasReason:
        extras.length > 0
          ? `the selection yielded ${familySelected} commitlint-family rows (< ${MIN_FAMILY_DRAFTS}); the ${extras.length} newest family rows in the workspace were added as fixed extra drafts (plan:1041-1044)`
          : null,
      neighboursThatAreThemselvesReplayRows: selected
        .filter((s) => s.neighbour && setIds.has(s.neighbour.neighbourMemoryId))
        .map((s) => ({ id: s.id, neighbour: s.neighbour?.neighbourMemoryId })),
    });
  } finally {
    await embedder.dispose();
    conn.close();
  }
}

// --------------------------------------------------------------- 8(b) replay

interface ReplaySetFile {
  selected: ReplayRow[];
  extras: ReplayRow[];
}

function loadReplayDrafts(): Array<{
  row: ReplayRow;
  extra: boolean;
  draft: ExtractedMemoryDraft;
}> {
  const set = JSON.parse(
    fs.readFileSync(REPLAY_SET_FILE, 'utf8'),
  ) as ReplaySetFile;
  const toDraft = (r: ReplayRow): ExtractedMemoryDraft => ({
    kind: r.kind,
    subject: r.subject,
    content: r.content,
    salienceHint: DRAFT_SALIENCE_HINT,
    ...(r.type ? { type: r.type as ExtractedMemoryDraft['type'] } : {}),
    concepts: r.concepts,
    files: r.files,
  });
  return [
    ...set.selected.map((row) => ({ row, extra: false, draft: toDraft(row) })),
    ...set.extras.map((row) => ({ row, extra: true, draft: toDraft(row) })),
  ];
}

/** Copy B': a fresh 48-only copy with every replay row deleted by MemoryStore.forget. */
async function ensureCopyBPrime(ids: readonly string[]): Promise<string> {
  const target = path.join(EVAL_DIR, COPY_B_PRIME);
  const residue = (db: SqliteDatabase) => {
    const ph = ids.map(() => '?').join(',');
    return {
      memories: scalar(
        db,
        `SELECT COUNT(*) FROM memories WHERE id IN (${ph})`,
        ...ids,
      ),
      chunks: scalar(
        db,
        `SELECT COUNT(*) FROM memory_chunks WHERE memory_id IN (${ph})`,
        ...ids,
      ),
    };
  };
  if (fs.existsSync(target)) {
    const c = openWorkingCopy(target, { readonly: true });
    try {
      const r = residue(c.db);
      if (r.memories !== 0 || r.chunks !== 0)
        throw new Error(
          `existing copy B' still holds replay rows: ${JSON.stringify(r)}`,
        );
    } finally {
      c.close();
    }
    return target;
  }
  const made = await makeMigratedCopy(COPY_B_PRIME, 48);
  const conn = openWorkingCopy(made.record.target, { loadVec: true });
  try {
    const db = conn.db;
    const counts = () => ({
      memories: scalar(db, 'SELECT COUNT(*) FROM memories'),
      memory_chunks: scalar(db, 'SELECT COUNT(*) FROM memory_chunks'),
      memory_chunks_fts_docsize: scalar(
        db,
        'SELECT COUNT(*) FROM memory_chunks_fts_docsize',
      ),
      memory_chunks_vec_rowids: scalar(
        db,
        'SELECT COUNT(*) FROM memory_chunks_vec_rowids',
      ),
    });
    const before = counts();
    const ph = ids.map(() => '?').join(',');
    const chunksOfReplay = scalar(
      db,
      `SELECT COUNT(*) FROM memory_chunks WHERE memory_id IN (${ph})`,
      ...ids,
    );
    const store = new MemoryStore(
      makeLogger('merge-replay:bprime', true),
      conn.connection,
      {} as never,
      { available: true } as never,
    );
    for (const id of ids) store.forget(memoryId(id));
    const after = counts();
    const r = residue(db);
    const integrity = (
      db.prepare('PRAGMA integrity_check').all() as Array<{
        integrity_check: string;
      }>
    )
      .map((x) => x.integrity_check)
      .join('; ');
    if (r.memories !== 0 || r.chunks !== 0)
      throw new Error(`copy B' deletion left residue: ${JSON.stringify(r)}`);
    writeJson('m3-copyBprime.json', {
      copy: "B' (48 only, replay rows deleted through MemoryStore.forget; FTS and vec cleanup by the schema's own triggers)",
      workingCopy: made.record,
      migration: {
        applied: made.applied,
        durationMs: made.migrationMs,
        schemaMaxAfter: made.schemaMax,
      },
      deletedIds: ids,
      chunksOwnedByReplayRows: chunksOfReplay,
      before,
      after,
      residue: r,
      integrityAfter: integrity,
    });
  } finally {
    conn.close();
  }
  return made.record.target;
}

/**
 * After-A only: tier 2 must run even when tier 1 is empty. The shipped
 * collector skips tier 2 on an empty tier 1 (D4 = B), and this measurement must
 * not edit it. So its store is wrapped: when the real tier 1 is empty,
 * `findMergeCandidates` returns one sentinel row, which opens the collector's
 * gate; the sentinel is stripped from the result afterwards. Tier 2 then runs
 * through the shipped loop unchanged (same bounds, dedup and scope check). The
 * sentinel id matches no row, so it cannot collide with a tier-2 hit.
 */
function forcedTier2Store(store: MemoryStore): MemoryStore {
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop !== 'findMergeCandidates')
        return Reflect.get(target, prop, receiver);
      return (...args: Parameters<MemoryStore['findMergeCandidates']>) => {
        const real = target.findMergeCandidates(...args);
        return real.length > 0
          ? real
          : [{ id: SENTINEL_ID, subject: null, content: '' }];
      };
    },
  });
}

function stripSentinel(
  set: MergeCandidateSet,
): MergeCandidateSet & { sentinelUsed: boolean } {
  const sentinelUsed = set.candidates.some((c) => c.id === SENTINEL_ID);
  if (!sentinelUsed) return { ...set, sentinelUsed };
  return {
    ...set,
    candidates: set.candidates.filter((c) => c.id !== SENTINEL_ID),
    tier1Count: set.tier1Count - 1,
    sentinelUsed,
  };
}

interface CandidateRecord {
  readonly id: string;
  readonly extra: boolean;
  readonly subject: string | null;
  readonly variants: Record<
    Variant,
    {
      candidates: MergeCandidate[];
      tier1Count: number;
      tier2Count: number;
      tier2Queries: number;
      tier2Skipped: string | null;
      sentinelUsed?: boolean;
      ms: number;
    }
  >;
}

async function collectCandidates(
  copyBPrime: string,
  drafts: ReturnType<typeof loadReplayDrafts>,
): Promise<void> {
  const logger = makeLogger('merge-replay:collect', true);
  const conn = openWorkingCopy(copyBPrime, { readonly: true, loadVec: true });
  const embedder = buildEmbedder(logger);
  const reranks: RerankRecord[] = [];
  recordReranks(embedder, reranks);
  try {
    const w0 = performance.now();
    await embedder.embed(['warmup']);
    const warmupMs = Math.round(performance.now() - w0);
    // Separate search services, so neither variant is served from the other's LRU cache.
    const b = buildServices(logger, conn, embedder);
    const a = buildServices(logger, conn, embedder);
    const collectorB = new MergeCandidateCollector(logger, b.store, b.search);
    const collectorA = new MergeCandidateCollector(
      logger,
      forcedTier2Store(a.store),
      a.search,
    );
    const records: CandidateRecord[] = [];
    for (const d of drafts) {
      const subjects = d.draft.subject ? [d.draft.subject] : [];
      let t = performance.now();
      const before =
        subjects.length > 0
          ? b.store.findMergeCandidates(subjects, WORKSPACE)
          : [];
      const beforeMs = performance.now() - t;
      t = performance.now();
      const afterB = await collectorB.collect([d.draft], WORKSPACE);
      const afterBMs = performance.now() - t;
      t = performance.now();
      const afterA = stripSentinel(
        await collectorA.collect([d.draft], WORKSPACE),
      );
      const afterAMs = performance.now() - t;
      records.push({
        id: d.row.id,
        extra: d.extra,
        subject: d.row.subject,
        variants: {
          before: {
            candidates: [...before],
            tier1Count: before.length,
            tier2Count: 0,
            tier2Queries: 0,
            tier2Skipped: null,
            ms: Number(beforeMs.toFixed(2)),
          },
          'after-A': {
            candidates: [...afterA.candidates],
            tier1Count: afterA.tier1Count,
            tier2Count: afterA.tier2Count,
            tier2Queries: afterA.tier2Queries,
            tier2Skipped: afterA.tier2Skipped,
            sentinelUsed: afterA.sentinelUsed,
            ms: Math.round(afterAMs),
          },
          'after-B': {
            candidates: [...afterB.candidates],
            tier1Count: afterB.tier1Count,
            tier2Count: afterB.tier2Count,
            tier2Queries: afterB.tier2Queries,
            tier2Skipped: afterB.tier2Skipped,
            ms: Math.round(afterBMs),
          },
        },
      });
      process.stdout.write(
        `collect ${d.row.id} ${d.row.subject}: before=${before.length} A=${afterA.candidates.length} (t2 ${afterA.tier2Count}, ${Math.round(afterAMs)}ms) B=${afterB.candidates.length} (t2 ${afterB.tier2Count}, ${afterB.tier2Skipped ?? 'ran'}, ${Math.round(afterBMs)}ms)\n`,
      );
    }
    fs.writeFileSync(
      CANDIDATES_FILE,
      JSON.stringify(
        { copyBPrime, warmupMs, rerank: summariseReranks(reranks), records },
        null,
        2,
      ),
    );
    process.stdout.write(`wrote ${CANDIDATES_FILE}\n`);
  } finally {
    await embedder.dispose();
    conn.close();
  }
}

interface CallResult {
  readonly id: string;
  readonly variant: Variant;
  readonly candidateCount: number;
  readonly resolved: Array<{
    subject: string | null;
    mergeTargetId: string | null;
  }>;
  readonly llm: LlmCallRecord | null;
  readonly error: string | null;
}

function readCalls(): CallResult[] {
  if (!fs.existsSync(CALLS_FILE)) return [];
  return fs
    .readFileSync(CALLS_FILE, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as CallResult);
}

async function replay8b(): Promise<void> {
  const drafts = loadReplayDrafts();
  const copyBPrime = await ensureCopyBPrime(drafts.map((d) => d.row.id));
  if (!fs.existsSync(CANDIDATES_FILE))
    await collectCandidates(copyBPrime, drafts);
  const cand = JSON.parse(fs.readFileSync(CANDIDATES_FILE, 'utf8')) as {
    records: CandidateRecord[];
  };

  const logger = makeLogger('merge-replay:resolve', true);
  const records = new Map<string, LlmCallRecord>();
  const sink = (r: LlmCallRecord): void => {
    records.set(r.label, r);
  };
  const llms: Record<PromptVariant, ReturnType<typeof buildCuratorLlm>> = {
    old: buildCuratorLlm('old', logger, WORKSPACE, sink),
    new: buildCuratorLlm('new', logger, WORKSPACE, sink),
  };
  const done = new Set(
    readCalls()
      .filter((c) => c.error === null)
      .map((c) => `${c.id}:${c.variant}`),
  );
  const units = drafts.flatMap((d, i) => {
    // Alternate the variant order per draft to cancel ordering effects.
    const order = i % 2 === 0 ? VARIANTS : [...VARIANTS].reverse();
    return order.map((variant) => ({ d, variant }));
  });
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= units.length) return;
      const { d, variant } = units[i];
      if (done.has(`${d.row.id}:${variant}`)) continue;
      const rec = cand.records.find((r) => r.id === d.row.id);
      if (!rec) throw new Error(`no candidate record for ${d.row.id}`);
      const candidates = rec.variants[variant].candidates;
      const label = `${d.row.id}:${variant}`;
      let resolved: CallResult['resolved'] = [];
      let error: string | null = null;
      try {
        const out = await callLabel.run(label, () =>
          llms[PROMPT_OF[variant]].resolve([d.draft], candidates),
        );
        resolved = out.map((r) => ({
          subject: r.subject,
          mergeTargetId: r.mergeTargetId,
        }));
      } catch (err: unknown) {
        error = err instanceof Error ? err.message : String(err);
      }
      const result: CallResult = {
        id: d.row.id,
        variant,
        candidateCount: candidates.length,
        resolved,
        llm: records.get(label) ?? null,
        error,
      };
      fs.appendFileSync(CALLS_FILE, JSON.stringify(result) + '\n');
      process.stdout.write(
        `${new Date().toISOString()} ${label} cands=${candidates.length} -> ${error ?? resolved.map((r) => r.mergeTargetId ?? 'null').join(',')} ${result.llm ? `${result.llm.durationMs}ms $${result.llm.totalCostUsd}` : '(no LLM call)'}\n`,
      );
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
}

// --------------------------------------------------------------- 8(b) report

async function report8b(): Promise<void> {
  const drafts = loadReplayDrafts();
  const cand = JSON.parse(fs.readFileSync(CANDIDATES_FILE, 'utf8')) as {
    copyBPrime: string;
    warmupMs: number;
    rerank: unknown;
    records: CandidateRecord[];
  };
  const latest = new Map<string, CallResult>();
  for (const c of readCalls()) latest.set(`${c.id}:${c.variant}`, c);
  const conn = openWorkingCopy(cand.copyBPrime, { readonly: true });
  try {
    const store = new MemoryStore(
      makeLogger('merge-replay:report', true),
      conn.connection,
      {} as never,
      { available: false } as never,
    );
    const perDraft = drafts.map((d) => {
      const rec = cand.records.find(
        (r) => r.id === d.row.id,
      ) as CandidateRecord;
      const v = Object.fromEntries(
        VARIANTS.map((variant) => {
          const call = latest.get(`${d.row.id}:${variant}`);
          const ids = new Set(
            rec.variants[variant].candidates.map((c) => c.id),
          );
          // memory-curator.service.ts eligibleMergeTarget: in the list sent, then getMergeTarget.
          const guarded = (call?.resolved ?? []).map((r) => {
            if (!r.mergeTargetId)
              return { mergeTargetId: null, passes: false, reason: 'null' };
            if (!ids.has(r.mergeTargetId))
              return {
                mergeTargetId: r.mergeTargetId,
                passes: false,
                reason: 'not-in-candidates',
              };
            const ok =
              store.getMergeTarget(memoryId(r.mergeTargetId), WORKSPACE) !==
              null;
            return {
              mergeTargetId: r.mergeTargetId,
              passes: ok,
              reason: ok ? 'eligible' : 'ineligible',
            };
          });
          const target = guarded.find((g) => g.passes);
          const targetRow = target
            ? (conn.db
                .prepare('SELECT subject FROM memories WHERE id = ?')
                .get(target.mergeTargetId) as
                { subject: string | null } | undefined)
            : undefined;
          return [
            variant,
            {
              candidates: rec.variants[variant].candidates.length,
              tier1: rec.variants[variant].tier1Count,
              tier2: rec.variants[variant].tier2Count,
              tier2Queries: rec.variants[variant].tier2Queries,
              tier2Skipped: rec.variants[variant].tier2Skipped,
              collectorMs: rec.variants[variant].ms,
              llmCall: call?.llm !== null && call?.llm !== undefined,
              error: call?.error ?? (call ? null : 'NOT RUN'),
              resolvedEntries: call?.resolved.length ?? 0,
              guard: guarded,
              merged: target !== undefined,
              mergedIntoSubject: targetRow?.subject ?? null,
              mergedTargetTier: target
                ? rec.variants[variant].candidates.findIndex(
                    (c) => c.id === target.mergeTargetId,
                  ) < rec.variants[variant].tier1Count
                  ? 1
                  : 2
                : null,
              costUsd: call?.llm?.totalCostUsd ?? 0,
              usage: call?.llm?.usage ?? null,
              llmMs: call?.llm?.durationMs ?? null,
              resolvedModel: call?.llm?.resolvedModel ?? null,
              toolUses: call?.llm?.toolUses ?? [],
            },
          ];
        }),
      ) as Record<
        Variant,
        {
          candidates: number;
          tier1: number;
          tier2: number;
          tier2Queries: number;
          collectorMs: number;
          llmCall: boolean;
          merged: boolean;
          costUsd: number;
          usage: LlmCallRecord['usage'] | null;
          error: string | null;
        }
      >;
      return {
        id: d.row.id,
        extra: d.extra,
        subject: d.row.subject,
        kind: d.row.kind,
        neighbour: d.row.neighbour ?? null,
        variants: v,
      };
    });
    const summary = Object.fromEntries(
      VARIANTS.map((variant) => {
        const rows = perDraft.map((p) => p.variants[variant]);
        const attempts = rows.length;
        const merges = rows.filter((r) => r.merged).length;
        const llmCalls = rows.filter((r) => r.llmCall).length;
        const tok = rows.reduce(
          (a, r) => {
            if (r.usage) {
              a.input += r.usage.input_tokens;
              a.output += r.usage.output_tokens;
              a.cacheRead += r.usage.cache_read_input_tokens;
              a.cacheCreation += r.usage.cache_creation_input_tokens;
            }
            a.costUsd += r.costUsd;
            return a;
          },
          { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, costUsd: 0 },
        );
        const collectorMs = rows.map((r) => r.collectorMs);
        const withTier2 = rows
          .filter((r) => r.tier2Queries > 0)
          .map((r) => r.collectorMs);
        const median = (xs: number[]) => {
          if (xs.length === 0) return null;
          const s = [...xs].sort((a, b) => a - b);
          return s.length % 2
            ? s[(s.length - 1) / 2]
            : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
        };
        return [
          variant,
          {
            attempts,
            merges,
            mergeRate:
              attempts === 0 ? null : Number((merges / attempts).toFixed(4)),
            llmCalls,
            errors: rows.filter((r) => r.error !== null).length,
            draftsWithCandidates: rows.filter((r) => r.candidates > 0).length,
            tier2RanOn: rows.filter((r) => r.tier2Queries > 0).length,
            collectorMsTotal: collectorMs.reduce((a, x) => a + x, 0),
            collectorMsMedian: median(collectorMs),
            collectorMsMedianWhenTier2Ran: median(withTier2),
            collectorMsMaxWhenTier2Ran: withTier2.length
              ? Math.max(...withTier2)
              : null,
            tokens: tok,
          },
        ];
      }),
    ) as Record<
      Variant,
      {
        attempts: number;
        merges: number;
        mergeRate: number | null;
        llmCalls: number;
      }
    >;
    const attemptedIds = perDraft.map((p) => p.id);
    // A draft counts as attempted by a variant only when that variant's latest
    // call record exists and succeeded ('NOT RUN' or an error does not count).
    const notAttempted = perDraft.flatMap((p) =>
      VARIANTS.filter((variant) => p.variants[variant].error !== null).map(
        (variant) => ({
          id: p.id,
          variant,
          error: p.variants[variant].error,
        }),
      ),
    );
    writeJson('m3-replay.json', {
      measurement:
        'M3 replay 8(b) (implementation-plan.md measurement table, "M3 replay")',
      copyBPrime: cand.copyBPrime,
      embedderWarmupMs: cand.warmupMs,
      rerankDuringCollection: cand.rerank,
      attemptedSet: {
        ids: attemptedIds,
        identicalAcrossVariants: notAttempted.length === 0,
        notAttempted,
        note: 'true only when every variant has a successful call record for every id; notAttempted lists each (id, variant) whose latest record errored or is NOT RUN',
      },
      summary,
      d4: {
        extraLlmCallsAfterAOverBefore:
          summary['after-A'].llmCalls - summary.before.llmCalls,
        extraLlmCallsAfterBOverBefore:
          summary['after-B'].llmCalls - summary.before.llmCalls,
      },
      gate: {
        shippedVariant: 'after-B (D4 = B)',
        mergesAfterBGreaterThanBefore:
          summary['after-B'].merges > summary.before.merges,
        rateAfterBGreaterThanBefore:
          (summary['after-B'].mergeRate ?? 0) > (summary.before.mergeRate ?? 0),
        mergesAfterAGreaterThanBefore:
          summary['after-A'].merges > summary.before.merges,
      },
      perDraft,
    });
  } finally {
    conn.close();
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'reach') return reach8a(process.argv[3] ?? 'direct');
  if (mode === 'select') return selectReplaySet();
  if (mode === 'replay') return replay8b();
  if (mode === 'report') return report8b();
  throw new Error(
    'usage: merge-replay.cjs <reach <label>|select|replay|report>',
  );
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(
      `merge-replay FAILED: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exit(1);
  },
);
