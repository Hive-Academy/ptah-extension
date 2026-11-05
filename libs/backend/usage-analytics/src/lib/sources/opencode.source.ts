import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { z } from 'zod';
import type { UsageContribution, UsageSource, UsageSourceResult } from '../usage-source.types';
import { workspaceMatches } from './file-facts';

const count = z.number().int().nonnegative().default(0);
const assistant = z.object({ role: z.literal('assistant'), time: z.object({ created: z.number().int().nonnegative() }), tokens: z.object({ input: count, output: count, reasoning: count, cache: z.object({ read: count, write: count }).optional() }), cost: z.number().finite().nonnegative().optional(), modelID: z.string().optional(), providerID: z.string().optional(), model: z.object({ modelID: z.string().optional(), providerID: z.string().optional() }).optional() }).passthrough();
const rowSchema = z.object({ id: z.string(), data: z.string(), sessionId: z.string(), sessionTitle: z.string().nullable(), directory: z.string().nullable() });
interface Database { prepare(sql: string): { all(...params: number[]): unknown[] }; close(): void }
type DatabaseCtor = new (file: string, options: { readonly: boolean; fileMustExist: boolean }) => Database;

export class OpenCodeSource implements UsageSource {
  private readonly cache = new Map<string, UsageSourceResult>();
  constructor(private readonly dataHome = process.env['XDG_DATA_HOME'] || path.join(os.homedir(), '.local', 'share')) {}

  async read(workspacePath: string, since: number, until: number, signal?: AbortSignal): Promise<UsageSourceResult> {
    if (signal?.aborted) return { contributions: [], status: { sourceId: 'opencode', status: 'partial', reason: 'time-budget' } };
    const file = path.join(this.dataHome, 'opencode', 'opencode.db');
    let dbStat: Awaited<ReturnType<typeof fs.stat>>;
    try { dbStat = await fs.stat(file); } catch { return { contributions: [], status: { sourceId: 'opencode', status: 'unavailable', reason: 'OpenCode database missing' } }; }
    // degradation-audit: optional-capability - SQLite has no WAL file after a checkpoint; the cache key then uses 0
    const wal = await fs.stat(`${file}-wal`).catch(() => null);
    const key = `${file}:${dbStat.size}:${dbStat.mtimeMs}:${wal?.size ?? 0}:${wal?.mtimeMs ?? 0}:${since}:${until}:${workspacePath}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    let db: Database | undefined;
    try {
      // Lazy load keeps other hosts usable if their native module is unavailable.
      const Driver = require('better-sqlite3') as DatabaseCtor;
      db = new Driver(file, { readonly: true, fileMustExist: true });
      const invalidRows = signal ? [] : db.prepare('SELECT COUNT(*) AS count FROM message WHERE time_created >= ? AND time_created < ? AND NOT json_valid(data)').all(since, until);
      const invalidCount = z.object({ count: z.number().int().nonnegative() }).safeParse(invalidRows[0]);
      const columns = db.prepare('PRAGMA table_info(session)').all();
      const hasTitle = columns.some((column) => z.object({ name: z.string() }).safeParse(column).data?.name === 'title');
      const titleColumn = hasTitle ? 's.title' : 'NULL';
      const records: unknown[] = [];
      let pagedMalformed = 0;
      let stalled = false;
      if (signal) {
        const page = db.prepare(`SELECT m.rowid AS rowid, m.id, m.data, m.session_id AS sessionId, ${titleColumn} AS sessionTitle, s.directory FROM message m LEFT JOIN session s ON s.id = m.session_id WHERE m.rowid > ? AND ((COALESCE(json_valid(m.data), 0) = 0 AND m.time_created >= ? AND m.time_created < ?) OR (json_valid(m.data) AND json_extract(m.data, '$.role') = 'assistant' AND CAST(json_extract(m.data, '$.time.created') AS INTEGER) >= ? AND CAST(json_extract(m.data, '$.time.created') AS INTEGER) < ?)) ORDER BY m.rowid LIMIT 256`);
        let cursor = 0;
        while (!signal.aborted && records.length <= 100000) {
          const rows = page.all(cursor, since, until, since, until);
          if (rows.length === 0) break;
          const before = cursor;
          for (const raw of rows) {
            const rowId = z.object({ rowid: z.number().int().positive() }).safeParse(raw);
            if (!rowId.success || rowId.data.rowid <= cursor) continue;
            cursor = rowId.data.rowid;
            const row = z.object({ data: z.string() }).safeParse(raw);
            if (!row.success) { pagedMalformed++; continue; }
            try { JSON.parse(row.data.data); } catch { pagedMalformed++; continue; }
            records.push(raw);
          }
          if (cursor === before) { stalled = true; break; }
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      } else {
        records.push(...db.prepare(`SELECT m.id, m.data, m.session_id AS sessionId, ${titleColumn} AS sessionTitle, s.directory FROM message m LEFT JOIN session s ON s.id = m.session_id WHERE json_valid(m.data) AND json_extract(m.data, '$.role') = 'assistant' AND CAST(json_extract(m.data, '$.time.created') AS INTEGER) >= ? AND CAST(json_extract(m.data, '$.time.created') AS INTEGER) < ? LIMIT 100001`).all(since, until));
      }
      const contributions: UsageContribution[] = [];
      let malformed = (invalidCount.success ? invalidCount.data.count : 0) + pagedMalformed; let partial = records.length > 100000 || !!signal?.aborted || stalled;
      for (const raw of records.slice(0, 100000)) {
        if (signal?.aborted) { partial = true; break; }
        const row = rowSchema.safeParse(raw);
        if (!row.success) { malformed++; continue; }
        let data: unknown;
        try { data = JSON.parse(row.data.data); } catch { malformed++; continue; }
        const entry = assistant.safeParse(data);
        if (!entry.success) { malformed++; continue; }
        const root = row.data.directory ?? undefined;
        if (workspacePath && !root) partial = true;
        if (!workspaceMatches(root, workspacePath)) continue;
        const value = entry.data;
        const provider = value.providerID ?? value.model?.providerID ?? 'unknown';
        const model = value.modelID ?? value.model?.modelID ?? 'unknown';
        contributions.push({ key: row.data.id, timestampMs: value.time.created, sessionId: row.data.sessionId, sessionTitle: row.data.sessionTitle ?? "Session " + row.data.sessionId.slice(0, 8), providerId: 'opencode', modelId: `${provider}/${model}`, modelProviderId: provider, workspaceRoot: root, inputUncachedTokens: value.tokens.input, cacheReadTokens: value.tokens.cache?.read ?? 0, cacheWriteTokens: value.tokens.cache?.write ?? 0, outputTokens: value.tokens.output, ...(value.cost !== undefined && value.cost > 0 ? { reportedCostUsd: value.cost } : {}), requestCount: 1, sourceId: 'opencode' });
      }
      const result: UsageSourceResult = { contributions, status: { sourceId: 'opencode', status: partial || malformed ? 'partial' : 'complete', scannedFiles: 1, malformedRecords: malformed, ...(partial ? { reason: signal?.aborted ? 'time-budget' : stalled ? 'Paging cursor stalled' : 'Query limit or workspace metadata incomplete' } : {}) } };
      if (!signal?.aborted && !stalled) {
        if (this.cache.size >= 12) this.cache.delete(this.cache.keys().next().value ?? '');
        this.cache.set(key, result);
      }
      return result;
    } catch {
      return { contributions: [], status: { sourceId: 'opencode', status: 'unavailable', reason: 'OpenCode database or native SQLite driver could not be read (possibly WAL metadata)' } };
    } finally { db?.close(); }
  }
}
