import * as http from 'node:http';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ATTACH_MODE_NA_REASON,
  attachElectronHost,
  ELECTRON_URL_ENV,
  launchElectronHost,
  parseAttachUrl,
  suiteNaReason,
  type ElectronHost,
} from './electron-host';

// Every launch runs the guard's open-handle probe (about 1 s on win32).
jest.setTimeout(60_000);

/**
 * A stand-in for the built Electron main entry, run under node as the
 * "Electron binary": it takes the same argv (`main.mjs --user-data-dir=… <ws>`),
 * reads `ptah.mcpPort` from `<userData>/config.json` as the app does, and logs
 * the server's start line where the production app does (a log file), or on
 * stdout, or not at all.
 */
const FIXTURE_APP = String.raw`
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mode = process.env.FIXTURE_MODE || 'log-file';
if (mode === 'single-instance') process.exit(0);
const userData = process.argv.find((a) => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
const workspace = process.argv[process.argv.length - 1];
const config = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'));
const line = (port) => '[INFO] CodeExecutionMCP server started on http://localhost:' + port + '\n';
if (mode === 'desktop-port') {
  fs.mkdirSync(path.join(userData, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'logs', 'Ptah Electron-2026-10-06.log'), line(51820));
  setInterval(() => {}, 1000);
} else {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const msg = JSON.parse(body);
      let result;
      if (msg.method === 'tools/list') result = { tools: [{ name: 'fx_env' }] };
      else result = { content: [{ type: 'text', text: JSON.stringify({
        argv: process.argv.slice(2), home: os.homedir(), nodeEnv: process.env.NODE_ENV,
        dbPath: process.env.PTAH_DB_PATH, configuredPort: config.ptah.mcpPort, userData, workspace }) }] };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    });
  });
  server.listen(config.ptah.mcpPort, 'localhost', () => {
    fs.mkdirSync(path.dirname(process.env.PTAH_DB_PATH), { recursive: true });
    fs.writeFileSync(process.env.PTAH_DB_PATH, '');
    const port = server.address().port;
    if (mode === 'stdout') process.stdout.write('boot noise\n' + line(port));
    else setTimeout(() => {
      fs.mkdirSync(path.join(userData, 'logs'), { recursive: true });
      fs.appendFileSync(path.join(userData, 'logs', 'Ptah Electron-2026-10-06.log'), '[x] other\n' + line(port));
    }, 200);
  });
}
`;

describe('suiteNaReason', () => {
  it('refuses the state-writing suites in attach mode only', () => {
    expect(suiteNaReason('attach', 'memory')).toBe(ATTACH_MODE_NA_REASON);
    expect(suiteNaReason('attach', 'lifecycle')).toBe(ATTACH_MODE_NA_REASON);
    expect(suiteNaReason('attach', 'retrieval')).toBeNull();
    expect(suiteNaReason('launch', 'memory')).toBeNull();
    expect(suiteNaReason('launch', 'lifecycle')).toBeNull();
    expect(ATTACH_MODE_NA_REASON).toBe('attach mode never writes to a user DB');
  });
});

describe('parseAttachUrl', () => {
  it('accepts a loopback http URL with a port', () => {
    expect(parseAttachUrl('http://localhost:51820')).toBe(51820);
    expect(parseAttachUrl('http://127.0.0.1:6000/')).toBe(6000);
  });

  it.each([
    ['https://localhost:51820', /loopback http URL/],
    ['http://example.com:51820', /loopback http URL/],
    ['http://localhost', /carries no port/],
    ['not a url', /is not a URL/],
  ])('rejects %s', (raw, message) => {
    expect(() => parseAttachUrl(raw)).toThrow(message);
  });
});

describe('attachElectronHost', () => {
  let server: http.Server;
  let port: number;
  let listCalls: number;

  beforeEach(async () => {
    listCalls = 0;
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString('utf8')));
      req.on('end', () => {
        const msg = JSON.parse(body) as { id: number; method: string };
        if (msg.method === 'tools/list') listCalls += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [] } }),
        );
      });
    });
    await new Promise<void>((done) => server.listen(0, 'localhost', done));
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    delete process.env[ELECTRON_URL_ENV];
    await new Promise<void>((done) => server.close(() => done()));
  });

  it('targets PTAH_BENCH_ELECTRON_URL, applies no guard and refuses state-writing suites', async () => {
    process.env[ELECTRON_URL_ENV] = `http://localhost:${port}`;
    const host = await attachElectronHost({ workspaceRoot: 'D:\\corpus' });

    expect(host.mode).toBe('attach');
    expect(host.portSource).toBe('attach-url');
    expect(host.host).toBe('electron');
    expect(host.baseUrl).toBe(
      `http://localhost:${port}/workspace/${encodeURIComponent('D:\\corpus')}`,
    );
    expect(host.guardMode).toBe('not-applied');
    expect(host.pid).toBeNull();
    expect(host.coldStartMs).toBeNull();
    expect(host.suiteNaReason('memory')).toBe(ATTACH_MODE_NA_REASON);
    expect(host.suiteNaReason('lifecycle')).toBe(ATTACH_MODE_NA_REASON);
    expect(host.suiteNaReason('retrieval')).toBeNull();
    expect(listCalls).toBe(1);

    expect(await host.stop()).toEqual({ mode: 'attach' });
    // The user's app is left running.
    expect(server.listening).toBe(true);
  });

  it('requires the URL', async () => {
    await expect(attachElectronHost({ workspaceRoot: '/w' })).rejects.toThrow(
      ELECTRON_URL_ENV,
    );
  });

  it('fails when nothing answers there', async () => {
    const dead = port;
    await new Promise<void>((done) => server.close(() => done()));
    server = http.createServer();
    await new Promise<void>((done) => server.listen(0, 'localhost', done));

    await expect(
      attachElectronHost({
        workspaceRoot: '/w',
        url: `http://localhost:${dead}`,
      }),
    ).rejects.toThrow(/no Ptah MCP answers/);
  });
});

describe('launchElectronHost', () => {
  let root: string;
  let realHome: string;
  let workspace: string;
  let appEntry: string;
  const launched: ElectronHost[] = [];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mcp-bench-electron-spec-'));
    realHome = join(root, 'real-home');
    workspace = join(root, 'workspace');
    appEntry = join(root, 'fixture-main.cjs');
    await mkdir(join(realHome, '.ptah', 'state'), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(join(realHome, '.ptah', 'state', 'ptah.sqlite'), 'real-db');
    await writeFile(appEntry, FIXTURE_APP);
  });

  afterEach(async () => {
    delete process.env['FIXTURE_MODE'];
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

  const launch = async (): Promise<ElectronHost> => {
    const host = await launchElectronHost({
      workspaceRoot: workspace,
      appEntry,
      electronBinary: process.execPath,
      realHome,
      bootTimeoutMs: 20_000,
      stopTimeoutMs: 2_000,
      guard: { ci: false, preSampleMs: 50 },
    });
    launched.push(host);
    return host;
  };

  const seen = async (
    host: ElectronHost,
  ): Promise<{
    argv: string[];
    home: string;
    nodeEnv: string;
    dbPath: string;
    configuredPort: number;
    userData: string;
    workspace: string;
  }> => {
    const outcome = await host.client.callTool('fx_env', {});
    if (outcome.kind !== 'result')
      throw new Error(`unexpected ${outcome.kind}`);
    return JSON.parse(outcome.text);
  };

  it('launches isolated on an OS-assigned port read from the log file', async () => {
    const host = await launch();
    const app = await seen(host);

    expect(host.mode).toBe('launch');
    expect(host.portSource).toBe('log-file');
    expect(host.guardMode).toBe('hash');
    expect(host.coldStartMs).toBeGreaterThan(0);
    expect([51820, 51821, 51822]).not.toContain(host.port);
    expect(app.configuredPort).toBe(0);
    expect(app.nodeEnv).toBe('production');
    expect(app.workspace).toBe(workspace);
    expect(app.argv).toEqual([`--user-data-dir=${app.userData}`, workspace]);
    expect(app.userData.startsWith(tmpdir())).toBe(true);
    expect(app.home.startsWith(tmpdir())).toBe(true);
    expect(app.userData.startsWith(app.home)).toBe(true);
    expect(app.dbPath.startsWith(app.home)).toBe(true);
    expect(app.home.startsWith(realHome)).toBe(false);
    expect(host.suiteNaReason('memory')).toBeNull();

    const report = await host.stop();
    if (report.mode !== 'launch') throw new Error('expected launch');
    expect(report.isolatedDbCreated).toBe(true);
    expect(report.guard.mode).toBe('hash');
    await expect(stat(app.home)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reads the start line from stdout when the app echoes to the console', async () => {
    process.env['FIXTURE_MODE'] = 'stdout';
    const host = await launch();

    expect(host.portSource).toBe('output');
    expect((await seen(host)).configuredPort).toBe(0);
    await host.stop();
  });

  it('refuses a launch the single-instance lock ended', async () => {
    process.env['FIXTURE_MODE'] = 'single-instance';

    await expect(launch()).rejects.toThrow(
      /exited \(code 0\) before its MCP came up.*single-instance lock/,
    );
  });

  it('refuses a launch that landed on the desktop MCP port', async () => {
    process.env['FIXTURE_MODE'] = 'desktop-port';

    await expect(launch()).rejects.toThrow(/bound the desktop MCP port 51820/);
  });

  it('names the build step when the app entry is missing', async () => {
    await expect(
      launchElectronHost({
        workspaceRoot: workspace,
        appEntry: join(root, 'absent.mjs'),
        electronBinary: process.execPath,
      }),
    ).rejects.toThrow(/nx build-dev ptah-electron/);
  });
});
