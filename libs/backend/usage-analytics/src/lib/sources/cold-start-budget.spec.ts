import * as fs from 'node:fs/promises';
import type { PathLike } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CodexSource } from './codex.source';
import { GrokSource } from './grok.source';
import { FileFactsCache } from './file-facts';
import { OpenCodeSource } from './opencode.source';
import type { UsageContribution } from '../usage-source.types';

jest.mock('node:fs/promises', () => ({
  ...jest.requireActual('node:fs/promises'),
  readdir: jest.fn(jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises').readdir),
}));

describe('cold start scan budget', () => {
  let home: string;
  afterEach(() => {
    jest.restoreAllMocks();
    jest.mocked(fs.readdir).mockImplementation(jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises').readdir);
  });

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-usage-budget-'));
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it('returns partial results when the Codex scan budget has expired', async () => {
    await fs.mkdir(path.join(home, 'sessions'), { recursive: true });
    const budget = new AbortController();
    budget.abort();
    const result = await new CodexSource(home).read(home, 0, 86_400_000, budget.signal);
    expect(result.status).toMatchObject({ status: 'partial', reason: 'time-budget' });
  });

  it('returns partial results when the Grok scan budget has expired', async () => {
    await fs.mkdir(path.join(home, 'sessions', encodeURIComponent(home)), { recursive: true });
    const budget = new AbortController();
    budget.abort();
    const result = await new GrokSource(home).read(home, 0, 86_400_000, budget.signal);
    expect(result.status).toMatchObject({ status: 'partial', reason: 'time-budget' });
  });

  it('does not open OpenCode SQLite after the budget expires', async () => {
    const budget = new AbortController();
    budget.abort();
    const result = await new OpenCodeSource(home).read(home, 0, 86_400_000, budget.signal);
    expect(result.status).toMatchObject({ status: 'partial', reason: 'time-budget' });
  });

  it('counts malformed OpenCode rows across pages and advances past bad data', async () => {
    const Database = require('better-sqlite3') as new (file: string) => {
      exec(sql: string): void;
      prepare(sql: string): { run(...params: (string | number | null)[]): unknown };
      close(): void;
    };
    const directory = path.join(home, 'opencode');
    await fs.mkdir(directory);
    const db = new Database(path.join(directory, 'opencode.db'));
    try {
      db.exec('CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT); CREATE TABLE message (id TEXT, data TEXT, session_id TEXT, time_created INTEGER)');
      db.prepare('INSERT INTO session (id, title, directory) VALUES (?, ?, ?)').run('s', 'Session', home);
      const insert = db.prepare('INSERT INTO message (id, data, session_id, time_created) VALUES (?, ?, ?, ?)');
      for (let i = 0; i < 256; i++) insert.run(`bad-${i}`, null, 's', 1);
      insert.run('good', JSON.stringify({ role: 'assistant', time: { created: 2 }, tokens: { input: 1, output: 1, reasoning: 0 } }), 's', 2);
    } finally { db.close(); }
    const result = await new OpenCodeSource(home).read(home, 0, 10, new AbortController().signal);
    expect(result.status).toMatchObject({ status: 'partial', malformedRecords: 256 });
    expect(result.contributions.map((item) => item.key)).toEqual(['good']);
  });

  it('reparses a file after an interrupted projection', async () => {
    const file = path.join(home, 'session.jsonl');
    await fs.writeFile(file, '{}\n');
    const cache = new FileFactsCache();
    const budget = new AbortController();
    const parse = jest.fn().mockImplementationOnce(async () => { budget.abort(); return { facts: [], malformed: 0, partial: true }; })
      .mockResolvedValueOnce({ facts: [], malformed: 0, partial: false });
    await cache.read(file, parse, budget.signal);
    await cache.read(file, parse);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('preserves an existing projection when a new read aborts before cache insertion', async () => {
    const original = path.join(home, 'original.jsonl');
    const next = path.join(home, 'next.jsonl');
    await Promise.all([fs.writeFile(original, '{}\n'), fs.writeFile(next, '{}\n')]);
    const cache = new FileFactsCache();
    const fact: UsageContribution = { key: 'a', timestampMs: 0, providerId: 'codex', modelId: 'm', inputUncachedTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, sourceId: 'codex' };
    const full = { facts: Array(100_000).fill(fact) as UsageContribution[], malformed: 0, partial: false };
    const parseOriginal = jest.fn().mockResolvedValue(full);
    await cache.read(original, parseOriginal);
    const budget = new AbortController();
    await cache.read(next, async () => { budget.abort(); return { facts: [fact], malformed: 0, partial: true }; }, budget.signal);
    await cache.read(original, parseOriginal);
    expect(parseOriginal).toHaveBeenCalledTimes(1);
  });

  it('stops the Codex day loop at the file cap', async () => {
    await fs.mkdir(path.join(home, 'sessions'), { recursive: true });
    const names = Array.from({ length: 10_000 }, (_, i) => `rollout-${i}.jsonl`);
    const readdir = jest.mocked(fs.readdir);
    readdir.mockClear();
    readdir.mockImplementation((async (_folder: PathLike) => names) as typeof fs.readdir);
    jest.spyOn(FileFactsCache.prototype, 'read').mockResolvedValue({ facts: [], malformed: 0, partial: false });
    const result = await new CodexSource(home).read(home, 0, 2 * 86_400_000);
    expect(result.status).toMatchObject({ status: 'partial', scannedFiles: 10_000 });
    expect(readdir).toHaveBeenCalledTimes(1);
  });

  it('stops the Grok workspace loop at the file cap', async () => {
    const root = path.join(home, 'sessions');
    await fs.mkdir(root, { recursive: true });
    const encoded = encodeURIComponent(home);
    const sessions = Array.from({ length: 10_000 }, (_, i) => `session-${i}`);
    const readdir = jest.mocked(fs.readdir);
    readdir.mockClear();
    readdir.mockImplementation((async (folder: PathLike) =>
      String(folder) === root ? [encoded, encoded] : sessions) as typeof fs.readdir);
    jest.spyOn(FileFactsCache.prototype, 'read').mockResolvedValue({ facts: [], malformed: 0, partial: false });
    const result = await new GrokSource(home).read(home, 0, 86_400_000);
    expect(result.status).toMatchObject({ status: 'partial', scannedFiles: 10_000 });
    expect(readdir).toHaveBeenCalledTimes(2);
  });
});
