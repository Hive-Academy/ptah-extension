import {
  appendFile,
  mkdir,
  mkdtemp,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CallRecorder, classifyToolResult } from './call-recorder';
import {
  assertRealStateUnchanged,
  launchBenchHost,
  RealStateChangedError,
  snapshotRealState,
  type LaunchedHost,
} from './host-launcher';
import { McpHttpClient } from './mcp-client';

/**
 * A stand-in for the built bench host: same wire contract (ready line on
 * stdout, JSON-RPC over HTTP POST, stop on stdin EOF), with fixture tools
 * whose answers exercise the recorder's classification.
 */
const FIXTURE_HOST = String.raw`
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const mode = process.env.FIXTURE_MODE || 'normal';
const workspace = process.argv[process.argv.indexOf('--workspace') + 1];
const counts = {};
const text = (t, isError) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });
function answer(name) {
  counts[name] = (counts[name] || 0) + 1;
  switch (name) {
    case 'fx_env':
      return text(JSON.stringify({ home: os.homedir(), env: {
        HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
        PTAH_CONFIG_PATH: process.env.PTAH_CONFIG_PATH, PTAH_DB_PATH: process.env.PTAH_DB_PATH } }));
    case 'fx_building_then_ok':
      return counts[name] === 1 ? text(JSON.stringify({ status: 'building', retryAfterMs: 5 })) : text('{"hits":[]}');
    case 'fx_always_building':
      return text(JSON.stringify({ status: 'building', retryAfterMs: 60000, message: 'x' }));
    case 'fx_spool_in_workspace': {
      const dir = path.join(workspace, '.ptah', 'tmp', 'mcp-out');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'call-1-2-abcd.txt');
      fs.writeFileSync(file, 'full');
      return text('{"hits":[1,2\n\n[reduced: none — partial, cut mid-line — showing 10 of 900 tokens — full output: ' + file + ']');
    }
    case 'fx_spool_elsewhere':
      return text('{"hits":[]}\n\n[reduced: json — showing 10 of 20 tokens — full output: ' + path.join(os.tmpdir(), 'elsewhere.txt') + ']');
    case 'fx_unknown_coverage':
      return text('{"coverage":{"clean":false,"reasons":["census?"],"census":"unknown"},"hits":[]}');
    case 'fx_tool_error':
      return text('boom', true);
    default:
      return null;
  }
}
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const msg = JSON.parse(body);
    let reply;
    if (msg.method === 'tools/list') reply = { jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'fx_env' }] } };
    else if (msg.method === 'tools/call') {
      const result = answer(msg.params.name);
      reply = result ? { jsonrpc: '2.0', id: msg.id, result } : { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'unknown tool' } };
    } else reply = { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'no' } };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply));
  });
});
server.listen(0, 'localhost', () => {
  const home = mode === 'lie-home' ? process.env.FIXTURE_FAKE_HOME : os.homedir();
  process.stdout.write('some log line that is not the wire\n');
  process.stdout.write(JSON.stringify({ benchHost: 'ready', port: server.address().port, workspaceRoot: workspace,
    homedir: home, userDataPath: process.env.PTAH_CONFIG_PATH, dbPath: process.env.PTAH_DB_PATH }) + '\n');
  if (mode !== 'hang') {
    process.stdin.on('end', () => {
      fs.mkdirSync(path.dirname(process.env.PTAH_DB_PATH), { recursive: true });
      fs.writeFileSync(process.env.PTAH_DB_PATH, '');
      server.close(() => process.exit(0));
    });
  }
  process.stdin.resume();
});
`;

describe('launchBenchHost', () => {
  let root: string;
  let realHome: string;
  let workspace: string;
  let hostScript: string;
  const launched: LaunchedHost[] = [];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mcp-bench-launcher-spec-'));
    realHome = join(root, 'real-home');
    workspace = join(root, 'workspace');
    hostScript = join(root, 'fixture-host.cjs');
    await mkdir(join(realHome, '.ptah', 'state'), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(realHome, '.ptah', 'state', 'ptah.sqlite'), 'real-db');
    await writeFile(hostScript, FIXTURE_HOST);
  });

  afterEach(async () => {
    delete process.env['FIXTURE_MODE'];
    delete process.env['FIXTURE_FAKE_HOME'];
    for (const host of launched.splice(0)) {
      await host.stop().catch(() => undefined);
    }
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  });

  const launch = async (stopTimeoutMs?: number): Promise<LaunchedHost> => {
    const host = await launchBenchHost({
      workspaceRoot: workspace,
      hostScript,
      realHome,
      bootTimeoutMs: 20_000,
      stopTimeoutMs,
    });
    launched.push(host);
    return host;
  };

  it('runs the host in a temp home it reports, never the real one', async () => {
    const host = await launch();

    expect(host.ready.homedir).toBe(host.tempHome);
    expect(host.tempHome.startsWith(tmpdir())).toBe(true);
    expect(host.coldStartMs).toBeGreaterThan(0);
    const outcome = await host.client.callTool('fx_env', {});
    if (outcome.kind !== 'result')
      throw new Error(`unexpected ${outcome.kind}`);
    const seen = JSON.parse(outcome.text) as {
      home: string;
      env: Record<string, string>;
    };
    expect(seen.home).toBe(host.tempHome);
    for (const value of Object.values(seen.env)) {
      expect(value.startsWith(host.tempHome)).toBe(true);
      expect(value.startsWith(realHome)).toBe(false);
    }

    const report = await host.stop();
    expect(report.killed).toBe(false);
    expect(report.exitCode).toBe(0);
    expect(report.isolatedDbCreated).toBe(true);
    await expect(stat(host.tempHome)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails the run when the real database changes during it', async () => {
    const host = await launch();
    await appendFile(
      join(realHome, '.ptah', 'state', 'ptah.sqlite'),
      'written',
    );

    const stopped = host.stop();
    await expect(stopped).rejects.toBeInstanceOf(RealStateChangedError);
    await expect(stopped).rejects.toMatchObject({
      changed: [join(realHome, '.ptah', 'state', 'ptah.sqlite')],
    });
  });

  it('fails the run when the real WAL appears during it', async () => {
    const host = await launch();
    await writeFile(join(realHome, '.ptah', 'state', 'ptah.sqlite-wal'), 'x');

    await expect(host.stop()).rejects.toBeInstanceOf(RealStateChangedError);
  });

  it('rejects a host that does not see the isolated home', async () => {
    process.env['FIXTURE_MODE'] = 'lie-home';
    process.env['FIXTURE_FAKE_HOME'] = realHome;

    await expect(launch()).rejects.toThrow(/isolation failed/);
  });

  it('kills the process tree when the host ignores stdin EOF', async () => {
    process.env['FIXTURE_MODE'] = 'hang';
    const host = await launch(500);

    const report = await host.stop();
    expect(report.killed).toBe(true);
    expect(report.isolatedDbCreated).toBe(false);
  });

  describe('CallRecorder over the fixture transport', () => {
    let host: LaunchedHost;
    let recorder: CallRecorder;
    const waits: number[] = [];

    beforeEach(async () => {
      host = await launch();
      waits.length = 0;
      recorder = new CallRecorder(host.client, {
        workspaceRoot: workspace,
        sleep: async (ms) => {
          waits.push(ms);
        },
      });
    });

    it('retries building after the hint, counting every attempt', async () => {
      const answer = await recorder.answer(
        'fx_building_then_ok',
        {},
        {
          maxRetries: 3,
          maxDelayMs: 1_000,
          defaultDelayMs: 100,
        },
      );

      expect(answer.attempts.map((call) => call.errorClass)).toEqual([
        'building',
        null,
      ]);
      expect(answer.final.errored).toBe(false);
      expect(waits).toEqual([5]);
      expect(recorder.summary()).toMatchObject({
        calls: 2,
        answers: 1,
        errored: 1,
      });
    });

    it('scores a building answer that outlasts the budget as an error, capping the wait', async () => {
      const answer = await recorder.answer(
        'fx_always_building',
        {},
        {
          maxRetries: 2,
          maxDelayMs: 50,
          defaultDelayMs: 10,
        },
      );

      expect(answer.attempts).toHaveLength(3);
      expect(answer.final.errorClass).toBe('building');
      expect(answer.final.errored).toBe(true);
      expect(waits).toEqual([50, 50]);
    });

    it('counts a spooled cut as truncated and checks the spool path', async () => {
      const inside = await recorder.answer('fx_spool_in_workspace', {});
      const outside = await recorder.answer('fx_spool_elsewhere', {});

      expect(inside.final.truncated).toBe(true);
      expect(inside.final.truncation).toMatchObject({
        cut: true,
        spoolUnderWorkspace: true,
      });
      expect(outside.final.truncated).toBe(true);
      expect(outside.final.truncation).toMatchObject({
        cut: false,
        spoolUnderWorkspace: false,
      });
      expect(recorder.summary().truncated).toBe(2);
    });

    it('classifies unknown coverage, tool errors and RPC errors as errors', async () => {
      await recorder.answer('fx_unknown_coverage', {});
      await recorder.answer('fx_tool_error', {});
      await recorder.answer('fx_missing', {});

      expect(recorder.calls.map((call) => call.errorClass)).toEqual([
        'unknown-coverage',
        'tool-error',
        'rpc-error',
      ]);
      expect(recorder.summary().errored).toBe(3);
    });

    it('records a refused connection as a transport error', async () => {
      const port = host.port;
      await host.stop();
      const dead = new McpHttpClient({ baseUrl: `http://localhost:${port}/` });
      const offline = new CallRecorder(dead, { workspaceRoot: workspace });

      const answer = await offline.answer('fx_env', {});
      dead.close();

      expect(answer.final.errorClass).toBe('transport');
      expect(answer.final.text).toMatch(/^ECONNREFUSED/);
    });
  });
});

describe('classifyToolResult', () => {
  it('passes a clean result', () => {
    expect(
      classifyToolResult('{"coverage":{"clean":true},"hits":[]}', false, '/w'),
    ).toEqual({
      errorClass: null,
      retryAfterMs: null,
      truncation: null,
    });
  });

  it('reads an unavailable index', () => {
    expect(
      classifyToolResult('index unavailable: no SQLite layer', false, '/w')
        .errorClass,
    ).toBe('unavailable');
  });

  it('keeps the building status of a budget-cut body', () => {
    const cut =
      '{"status":"building","retryAfterMs":2000,"message":"The wor\n\n[reduced: none — partial, cut mid-line — showing 9 of 99 tokens — full output could not be saved: EACCES]';
    expect(classifyToolResult(cut, false, '/w')).toMatchObject({
      errorClass: 'building',
      retryAfterMs: 2000,
      truncation: {
        cut: true,
        spoolPath: null,
        spoolLocator: 'EACCES',
        spoolUnderWorkspace: null,
      },
    });
  });

  it('treats a spool under the system temp directory as outside the workspace', () => {
    const text =
      'x\n\n[reduced: log — showing 1 of 2 tokens — full output: .ptah/tmp/mcp-out/a.txt under the system temp directory]';
    expect(classifyToolResult(text, false, '/w').truncation).toMatchObject({
      spoolPath: null,
      spoolUnderWorkspace: false,
    });
  });
});

describe('assertRealStateUnchanged', () => {
  it('trips on an mtime-only change', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mcp-bench-guard-spec-'));
    try {
      const db = join(home, '.ptah', 'state', 'ptah.sqlite');
      await mkdir(join(home, '.ptah', 'state'), { recursive: true });
      await writeFile(db, 'same');
      await utimes(db, new Date(1_000_000), new Date(1_000_000));
      const before = await snapshotRealState(home);
      await utimes(db, new Date(2_000_000), new Date(2_000_000));
      const after = await snapshotRealState(home);

      expect(before.files[0].sha256).toBe(after.files[0].sha256);
      expect(() => assertRealStateUnchanged(before, after)).toThrow(
        RealStateChangedError,
      );
      expect(() => assertRealStateUnchanged(before, before)).not.toThrow();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
