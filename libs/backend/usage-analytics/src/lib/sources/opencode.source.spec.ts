import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { OpenCodeSource } from './opencode.source';

interface TestDatabase { exec(sql: string): void; prepare(sql: string): { run(...args: (string | number | null)[]): void }; close(): void }
type TestDatabaseCtor = new (file: string) => TestDatabase;

describe('OpenCodeSource', () => {
  let dataHome: string;
  beforeEach(async () => { dataHome = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-opencode-')); });
  afterEach(async () => { await fs.rm(dataHome, { recursive: true, force: true }); });

  it('reports missing database', async () => {
    expect((await new OpenCodeSource(dataHome).read('', 0, 100)).status.status).toBe('unavailable');
  });

  it('keeps assistant messages when the session table has no title', async () => {
    const dir = path.join(dataHome, 'opencode');
    await fs.mkdir(dir);
    const Driver = require('better-sqlite3') as TestDatabaseCtor;
    const db = new Driver(path.join(dir, 'opencode.db'));
    db.exec('CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT); CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)');
    db.prepare('INSERT INTO session VALUES (?, ?)').run('s', '/work');
    db.prepare('INSERT INTO session VALUES (?, ?)').run('unknown', null);
    const insert = db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)');
    const at = Date.parse('2026-10-20T00:00:00Z');
    const data = (time: number, cost: number) => JSON.stringify({ role: 'assistant', time: { created: time }, tokens: { input: 12, output: 3, cache: { read: 8, write: 2 } }, cost, modelID: 'm', providerID: 'openai' });
    insert.run('a', 's', at, data(at, 0.2));
    insert.run('b', 's', at + 86_400_000, data(at + 86_400_000, 0));
    insert.run('uncertain', 'unknown', at, data(at, 0.3));
    insert.run('bad', 's', at, '{bad');
    db.close();
    const result = await new OpenCodeSource(dataHome).read('/work', at, at + 86_400_000);
    expect(result.contributions).toHaveLength(1);
    expect(result.contributions[0]).toMatchObject({ sessionId: 's', sessionTitle: 'Session s', providerId: 'opencode', modelId: 'openai/m', reportedCostUsd: 0.2, inputUncachedTokens: 12, cacheReadTokens: 8 });
    expect(result.status.malformedRecords).toBe(1);
    expect(result.status.status).toBe('partial');
    expect((await new OpenCodeSource(dataHome).read('/other', at, at + 86_400_000)).contributions).toHaveLength(0);
  });

  it('uses the session title when the column exists', async () => {
    const dir = path.join(dataHome, 'opencode');
    await fs.mkdir(dir);
    const Driver = require('better-sqlite3') as TestDatabaseCtor;
    const db = new Driver(path.join(dir, 'opencode.db'));
    db.exec('CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT); CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)');
    db.prepare('INSERT INTO session VALUES (?, ?, ?)').run('s', '/work', 'Important task');
    const at = Date.parse('2026-10-20T00:00:00Z');
    db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run('a', 's', at, JSON.stringify({ role: 'assistant', time: { created: at }, tokens: { input: 1, output: 1 } }));
    db.close();
    const result = await new OpenCodeSource(dataHome).read('/work', at, at + 1);
    expect(result.contributions).toHaveLength(1);
    expect(result.contributions[0]).toMatchObject({ sessionId: 's', sessionTitle: 'Important task' });
  });
});
