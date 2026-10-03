/**
 * Every database here is a fixture created under the OS temp directory with
 * the two `opencode.db` tables M reads (columns as in OpenCode 2.x).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';

import { localDate } from './lane-metrics';
import {
  opencodeLaneMetrics,
  readOpencodeConfig,
  readOpencodeDb,
  serverToolCalls,
  SNAPSHOT_DIR_PREFIX,
  stripJsonc,
} from './opencode-db.reader';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm-opencode-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const CREATED = Date.UTC(2026, 9, 3, 12, 0, 0);

function createFixtureDb(): string {
  const file = path.join(tmp, 'opencode.db');
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE session_v2 (id TEXT PRIMARY KEY, time_created INTEGER NOT NULL);
    CREATE TABLE session_message (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL,
      seq INTEGER NOT NULL, data TEXT NOT NULL);
  `);
  const insertSession = db.prepare('INSERT INTO session_v2 VALUES (?, ?)');
  const insertMessage = db.prepare(
    'INSERT INTO session_message VALUES (?, ?, ?, ?, ?)',
  );
  insertSession.run('lane', CREATED);
  insertSession.run('chat', CREATED - 3 * 86_400_000);

  const step = (input: number, read: number, tools: unknown[] = []) =>
    JSON.stringify({
      model: { id: 'kimi-k3', providerID: 'opencode-go', variant: 'high' },
      content: tools,
      tokens: { input, output: 5, reasoning: 1, cache: { read, write: 2 } },
    });
  const rows: [string, string, string, number, string][] = [
    [
      'm1',
      'lane',
      'user',
      1,
      JSON.stringify({ text: 'task\n\n## Before you exit\nx' }),
    ],
    [
      'm2',
      'lane',
      'assistant',
      2,
      step(100, 0, [
        {
          type: 'tool',
          name: 'github_search',
          state: { content: [{ type: 'text', text: 'a'.repeat(40) }] },
        },
        {
          type: 'tool',
          name: 'read',
          state: { content: [{ type: 'text', text: 'b'.repeat(90) }] },
        },
      ]),
    ],
    ['m3', 'lane', 'assistant', 3, step(10, 300)],
    ['m4', 'lane', 'compaction', 4, JSON.stringify({ status: 'done' })],
    ['m5', 'lane', 'assistant', 5, '{not json'],
    ['c1', 'chat', 'user', 1, JSON.stringify({ text: 'hello' })],
    ['c2', 'chat', 'assistant', 2, step(50, 0)],
  ];
  for (const row of rows) insertMessage.run(...row);
  db.close();
  return file;
}

describe('readOpencodeDb', () => {
  it('reduces each session to lane metrics through a temp copy', () => {
    const dbPath = createFixtureDb();
    const before = fs.readFileSync(dbPath);

    const report = readOpencodeDb(dbPath);
    expect(report.sessions.map((s) => s.id)).toEqual(['chat', 'lane']);

    const lane = report.sessions.find((s) => s.id === 'lane');
    if (lane === undefined) throw new Error('lane session not read');
    const metrics = opencodeLaneMetrics(lane);
    expect(metrics).toMatchObject({
      vendor: 'opencode',
      isPtahLane: true,
      model: 'opencode-go/kimi-k3',
      effort: 'high',
      requests: 2,
      firstInput: 102, // input + cache.read + cache.write
      peakInput: 312,
      totalInput: 414,
      cached: 300,
      output: 10,
      compactions: 1,
      largestToolOutput: { tool: 'read', chars: 90 },
    });
    expect(lane.badRows).toBe(1);
    expect(report.skipped).toHaveLength(1); // the unparseable row

    const chat = report.sessions.find((s) => s.id === 'chat');
    expect(chat?.hasLaneMarker).toBe(false);

    // The user's database file is byte-identical after the read.
    expect(fs.readFileSync(dbPath).equals(before)).toBe(true);
  });

  it('filters by creation time and by local date', () => {
    const dbPath = createFixtureDb();
    expect(
      readOpencodeDb(dbPath, { createdSinceMs: CREATED - 1 }).sessions.map(
        (s) => s.id,
      ),
    ).toEqual(['lane']);
    expect(
      readOpencodeDb(dbPath, { date: localDate(CREATED) }).sessions.map(
        (s) => s.id,
      ),
    ).toEqual(['lane']);
  });

  it('reports an absent store and an unreadable schema as skipped sources', () => {
    const absent = readOpencodeDb(path.join(tmp, 'none.db'));
    expect(absent.sessions).toEqual([]);
    expect(absent.skipped[0]?.reason).toBe('absent');

    const empty = path.join(tmp, 'empty.db');
    new DatabaseSync(empty).close();
    const report = readOpencodeDb(empty);
    expect(report.sessions).toEqual([]);
    expect(report.skipped[0]?.reason).toMatch(/^unreadable/);
  });
});

describe('readOpencodeDb temp copy', () => {
  const snapshotDirs = (): string[] =>
    fs
      .readdirSync(os.tmpdir())
      .filter((n) => n.startsWith(SNAPSHOT_DIR_PREFIX));

  afterEach(() => jest.restoreAllMocks());

  it('leaves no temp directory behind after a normal read', () => {
    const dbPath = createFixtureDb();
    const before = snapshotDirs();
    expect(readOpencodeDb(dbPath).sessions).toHaveLength(2);
    expect(snapshotDirs()).toEqual(before);
  });

  it('removes the temp directory and keeps the report when close() throws', () => {
    const dbPath = createFixtureDb();
    const before = snapshotDirs();
    const realClose = DatabaseSync.prototype.close;
    jest.spyOn(DatabaseSync.prototype, 'close').mockImplementation(function (
      this: DatabaseSync,
    ) {
      // Release the handle first (Windows cannot delete an open file),
      // then fail the way a broken close would.
      realClose.call(this);
      throw new Error('close failed');
    });

    const report = readOpencodeDb(dbPath);

    expect(report.sessions).toHaveLength(2);
    expect(report.skipped.map((s) => s.reason)).toContain(
      'temp copy close failed (Error)',
    );
    expect(snapshotDirs()).toEqual(before);
  });
});

describe('readOpencodeConfig', () => {
  it('lists servers and plugins by name only', () => {
    fs.writeFileSync(
      path.join(tmp, 'opencode.jsonc'),
      `{
        // comment
        "mcp": {
          "github": { "type": "remote", "url": "https://x.example/mcp", "headers": { "Authorization": "secret" } },
          "local-db": { "type": "local", "command": ["db"], "enabled": false, },
        },
        /* block */
        "plugin": ["opencode-foo@1.0.0", ["opencode-bar", { "k": 1 }]],
      }`,
    );
    fs.mkdirSync(path.join(tmp, 'plugin'));
    fs.writeFileSync(path.join(tmp, 'plugin', 'notify.ts'), '');
    fs.writeFileSync(path.join(tmp, 'plugin', 'README.md'), '');

    const report = readOpencodeConfig(tmp);
    expect(report.files).toEqual(['opencode.jsonc']);
    expect(report.servers).toEqual([
      { name: 'github', type: 'remote', enabled: true, file: 'opencode.jsonc' },
      {
        name: 'local-db',
        type: 'local',
        enabled: false,
        file: 'opencode.jsonc',
      },
    ]);
    expect(report.plugins.map((p) => p.name)).toEqual([
      'opencode-foo@1.0.0',
      'opencode-bar',
      'notify.ts',
    ]);
    expect(JSON.stringify(report)).not.toContain('secret');
    expect(JSON.stringify(report)).not.toContain('x.example');
  });

  it('skips an absent directory and an unparseable file', () => {
    expect(readOpencodeConfig(path.join(tmp, 'none')).skipped[0]?.reason).toBe(
      'absent',
    );
    fs.writeFileSync(path.join(tmp, 'opencode.json'), '{ broken');
    const report = readOpencodeConfig(tmp);
    expect(report.files).toEqual([]);
    expect(report.skipped[0]?.reason).toMatch(/^unparseable/);
  });
});

describe('serverToolCalls', () => {
  it('counts tool calls by the <server>_ prefix', () => {
    const dbPath = createFixtureDb();
    const sessions = readOpencodeDb(dbPath).sessions;
    expect(
      serverToolCalls(
        [
          { name: 'github', type: 'remote', enabled: true, file: 'f' },
          { name: 'local.db', type: 'local', enabled: true, file: 'f' },
        ],
        sessions,
      ),
    ).toEqual({ github: 1, 'local.db': 0 });
  });
});

describe('stripJsonc', () => {
  it('keeps // inside strings and drops trailing commas', () => {
    expect(
      JSON.parse(stripJsonc('{"u":"http://a//b", /* c */ "a":[1,2,],}')),
    ).toEqual({ u: 'http://a//b', a: [1, 2] });
  });
});
