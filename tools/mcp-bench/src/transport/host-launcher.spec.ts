import {
  appendFile,
  mkdir,
  mkdtemp,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CallRecorder, classifyToolResult } from './call-recorder';
import { spawn, type ChildProcess } from 'node:child_process';

import { launchBenchHost, type LaunchedHost } from './host-launcher';
import { McpHttpClient } from './mcp-client';
import { platformHandleProbe, type HandleProbe } from './open-handle-probe';
import {
  assertRealStateUnchanged,
  BenchHeldRealStateError,
  ConcurrentWriterError,
  RealStateChangedError,
  snapshotRealState,
  type RealStateGuardOptions,
} from './real-state-guard';

// Every launch runs the guard's open-handle probe (about 1 s on win32).
jest.setTimeout(60_000);

/** process-watch needs a probe; on a platform without one those cases skip. */
const itWithProbe = platformHandleProbe() === null ? it.skip : it;

async function waitFor(
  condition: () => boolean,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((done) => setTimeout(done, 25));
  }
}

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
const heldReal = [];
server.listen(0, 'localhost', () => {
  // Isolation-breach fixtures: hold a file under the (fake) real ~/.ptah.
  if (mode === 'hold-real' || mode === 'hold-real-briefly') {
    const fd = fs.openSync(process.env.FIXTURE_REAL_FILE, 'r');
    heldReal.push(fd);
    if (mode === 'hold-real-briefly') {
      // Release when the spec says so, and confirm the release.
      const release = process.env.FIXTURE_RELEASE_FILE;
      const poll = setInterval(() => {
        if (!fs.existsSync(release)) return;
        clearInterval(poll);
        fs.closeSync(fd);
        fs.writeFileSync(release + '.done', '');
      }, 20);
    }
  }
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
    stopWriter();
    delete process.env['FIXTURE_MODE'];
    delete process.env['FIXTURE_FAKE_HOME'];
    delete process.env['FIXTURE_REAL_FILE'];
    delete process.env['FIXTURE_RELEASE_FILE'];
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

  const launch = async (
    stopTimeoutMs?: number,
    guard: Omit<RealStateGuardOptions, 'realHome'> = {},
  ): Promise<LaunchedHost> => {
    const host = await launchBenchHost({
      workspaceRoot: workspace,
      hostScript,
      realHome,
      bootTimeoutMs: 20_000,
      stopTimeoutMs,
      guard: { ci: false, preSampleMs: 50, ...guard },
    });
    launched.push(host);
    return host;
  };

  let walWriter: NodeJS.Timeout | null = null;
  let dbHolder: ChildProcess | null = null;
  function stopWriter(): void {
    if (walWriter !== null) clearInterval(walWriter);
    walWriter = null;
    dbHolder?.kill();
    dbHolder = null;
  }
  /** A concurrent writer of the fake real DB, like a running desktop Ptah. */
  const startWalWriter = (): void => {
    const wal = join(realHome, '.ptah', 'state', 'ptah.sqlite-wal');
    let frame = 0;
    walWriter = setInterval(() => {
      void appendFile(wal, `frame-${frame++}\n`);
    }, 20);
  };
  /** Another process holding the fake real DB open, and nothing else. */
  const startDbHolder = async (): Promise<number> => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        "require('fs').openSync(process.argv[1], 'r'); console.log('held'); setInterval(() => {}, 1000);",
        join(realHome, '.ptah', 'state', 'ptah.sqlite'),
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    dbHolder = child;
    await new Promise<void>((done) => child.stdout?.once('data', () => done()));
    return child.pid ?? -1;
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

  it('fails a hash-mode run when the real -shm changes during it', async () => {
    const shm = join(realHome, '.ptah', 'state', 'ptah.sqlite-shm');
    await writeFile(shm, 'shm-before');
    const host = await launch();
    expect(host.guardMode).toBe('hash');
    await appendFile(shm, '-changed');

    await expect(host.stop()).rejects.toMatchObject({
      name: 'RealStateChangedError',
      changed: [shm],
    });
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

  describe('guard mode', () => {
    const realFile = (): string => join(realHome, '.ptah', 'settings.json');

    it('uses hash when nothing else writes the real database', async () => {
      const host = await launch();

      expect(host.guardMode).toBe('hash');
      const report = await host.stop();
      expect(report.guard.mode).toBe('hash');
    });

    itWithProbe(
      'switches to process-watch when a writer touches the real -wal, and passes a clean bench',
      async () => {
        startWalWriter();
        const host = await launch(undefined, {
          preSampleMs: 300,
          sampleIntervalMs: 200,
        });

        expect(host.guardMode).toBe('process-watch');
        // The writer keeps writing; process-watch must not blame the bench.
        await new Promise((done) => setTimeout(done, 300));
        const report = await host.stop();
        if (report.guard.mode !== 'process-watch')
          throw new Error('expected process-watch');
        expect(report.guard.writerEvidence.join(' ')).toMatch(
          /ptah\.sqlite-wal changed during a 300 ms pre-sample/,
        );
        expect(report.guard.samples).toBeGreaterThanOrEqual(1);
        // The sample saw the fixture host and the files it holds (its script at least).
        expect(report.guard.maxTreeProcesses).toBeGreaterThanOrEqual(1);
        expect(report.guard.maxOpenPaths).toBeGreaterThanOrEqual(1);
      },
    );

    itWithProbe(
      'switches to process-watch when another process holds the real database',
      async () => {
        const holderPid = await startDbHolder();
        const host = await launch();

        expect(host.guardMode).toBe('process-watch');
        const report = await host.stop();
        if (report.guard.mode !== 'process-watch')
          throw new Error('expected process-watch');
        expect(report.guard.writerEvidence.join(' ')).toContain(
          `${holderPid} holds ${join(realHome, '.ptah', 'state', 'ptah.sqlite')}`,
        );
      },
    );

    itWithProbe(
      'fails process-watch when the bench host holds a path under the real ~/.ptah',
      async () => {
        await writeFile(realFile(), '{}');
        process.env['FIXTURE_MODE'] = 'hold-real';
        process.env['FIXTURE_REAL_FILE'] = realFile();
        startWalWriter();
        const host = await launch(undefined, { preSampleMs: 300 });

        expect(host.guardMode).toBe('process-watch');
        const stopped = host.stop();
        await expect(stopped).rejects.toBeInstanceOf(BenchHeldRealStateError);
        await expect(stopped).rejects.toMatchObject({
          held: [{ pid: host.pid, path: realFile() }],
        });
      },
    );

    itWithProbe(
      'catches a real-path handle the bench host released before the stop',
      async () => {
        await writeFile(realFile(), '{}');
        process.env['FIXTURE_MODE'] = 'hold-real-briefly';
        process.env['FIXTURE_REAL_FILE'] = realFile();
        const release = join(root, 'release');
        process.env['FIXTURE_RELEASE_FILE'] = release;
        // Count completed tree samples, so the release follows one of them.
        const real = platformHandleProbe();
        if (real === null) throw new Error('itWithProbe ran without a probe');
        let treeSamples = 0;
        const probe: HandleProbe = {
          platform: real.platform,
          holders: (paths) => real.holders(paths),
          treeOpenPaths: async (pid) => {
            const result = await real.treeOpenPaths(pid);
            treeSamples += 1;
            return result;
          },
        };
        startWalWriter();
        const host = await launch(undefined, {
          preSampleMs: 300,
          sampleIntervalMs: 100,
          probe,
        });

        await waitFor(() => treeSamples >= 1);
        await writeFile(release, '');
        await waitFor(() => existsSync(`${release}.done`));
        // Released: only a sample taken during the run can have seen it.
        await expect(host.stop()).rejects.toBeInstanceOf(
          BenchHeldRealStateError,
        );
      },
    );

    it('keeps hash under CI when there is no writer', async () => {
      const host = await launch(undefined, { ci: true });

      expect(host.guardMode).toBe('hash');
      await host.stop();
    });

    it('fails a CI run with a concurrent writer as an environment error', async () => {
      startWalWriter();

      await expect(
        launch(undefined, { ci: true, preSampleMs: 300 }),
      ).rejects.toBeInstanceOf(ConcurrentWriterError);
      await expect(
        launch(undefined, { ci: true, preSampleMs: 300 }),
      ).rejects.toThrow(/Environment error: .* in CI/);
    });

    it('fails a writer-detected run where open handles cannot be listed', async () => {
      startWalWriter();

      await expect(
        launch(undefined, { preSampleMs: 300, probe: null }),
      ).rejects.toThrow(/process-watch cannot run/);
    });
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
