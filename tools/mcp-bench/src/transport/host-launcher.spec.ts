import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
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

import {
  classifyHostExit,
  HostLaunchError,
  launchBenchHost,
  type HostExitObservation,
  type LaunchedHost,
} from './host-launcher';
import { McpHttpClient } from './mcp-client';
import {
  parseWindowsTreeReply,
  platformHandleProbe,
  ProcFsHandleProbe,
  type HandleProbe,
  type ProcessEntry,
  type ProcFs,
} from './open-handle-probe';
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
if (mode === 'fatal') {
  // Optionally break isolation first, so the guard has something to report.
  if (process.env.FIXTURE_REAL_FILE) fs.appendFileSync(process.env.FIXTURE_REAL_FILE, 'x');
  process.stdout.write(JSON.stringify({ benchHost: 'fatal', error: 'fixture boot failure' }) + '\n');
  process.exit(1);
}
if (mode === 'exit-after-list') {
  // Ends on its own once the launcher's first tools/list was answered.
  server.on('request', (req, res) => res.on('finish', () => setTimeout(() => process.exit(0), 20)));
}
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
      if (mode === 'crash-on-eof') {
        // What the real host did on shutdown: the win32 fail-fast status; a
        // fatal signal stands in for it on POSIX.
        if (process.platform === 'win32') process.exit(3221226505);
        process.kill(process.pid, 'SIGABRT');
        return;
      }
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
    expect(report.exit).toEqual({ kind: 'clean', exitCode: 0, signal: null });
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
    expect(report.exit.kind).toBe('killed');
    expect(report.exit.detail).toMatch(/graceful stop timed out/);
    expect(report.isolatedDbCreated).toBe(false);
  });

  describe('exit classification', () => {
    it('reports a fail-fast exit after stdin EOF as crash-on-shutdown, without rejecting', async () => {
      process.env['FIXTURE_MODE'] = 'crash-on-eof';
      const host = await launch();

      const report = await host.stop();
      expect(report.exit.kind).toBe('crash-on-shutdown');
      if (process.platform === 'win32') {
        expect(report.exit.exitCode).toBe(3221226505);
        expect(report.exit.detail).toMatch(/0xC0000409 .*fail-fast/);
      } else {
        expect(report.exit.signal).toBe('SIGABRT');
        expect(report.exit.detail).toMatch(/fatal signal SIGABRT/);
      }
      expect(report.exit.detail).toMatch(/not a tool error/);
      expect(report.guard.mode).toBe('hash');
    });

    it('reports a host that ended before stop() as exited-early', async () => {
      process.env['FIXTURE_MODE'] = 'exit-after-list';
      const host = await launch();
      await waitFor(() => host.exitedEarly() !== undefined);

      const report = await host.stop();
      expect(report.exit).toMatchObject({
        kind: 'exited-early',
        exitCode: 0,
        detail: 'the host ended before stop() (exit code 0)',
      });
    });

    it('classifies a boot failure (fatal line, exit 1) as exited-early', async () => {
      process.env['FIXTURE_MODE'] = 'fatal';

      const failure = await launch().then(
        () => {
          throw new Error('expected the launch to fail');
        },
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(HostLaunchError);
      expect((failure as HostLaunchError).message).toBe(
        'bench host fatal: fixture boot failure',
      );
      expect((failure as HostLaunchError).exit).toMatchObject({
        kind: 'exited-early',
        exitCode: 1,
      });
    });

    it('lets a guard failure outrank the boot failure', async () => {
      process.env['FIXTURE_MODE'] = 'fatal';
      process.env['FIXTURE_REAL_FILE'] = join(
        realHome,
        '.ptah',
        'state',
        'ptah.sqlite',
      );

      await expect(launch()).rejects.toBeInstanceOf(RealStateChangedError);
    });
  });

  describe('spawn failures', () => {
    const tempHomes = async (): Promise<string[]> =>
      (await readdir(tmpdir())).filter((name) =>
        name.startsWith('ptah-mcp-bench-home-'),
      );

    it('rejects an unspawnable executable, naming it and the script, and cleans up', async () => {
      const before = await tempHomes();
      const nodePath = join(root, 'no-such-dir', 'node-missing.exe');

      const failure = await launchBenchHost({
        workspaceRoot: workspace,
        hostScript,
        nodePath,
        realHome,
        bootTimeoutMs: 20_000,
        guard: { ci: false, preSampleMs: 50 },
      }).then(
        () => {
          throw new Error('expected the launch to fail');
        },
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(HostLaunchError);
      expect((failure as Error).message).toContain(
        'could not spawn the bench host',
      );
      expect((failure as Error).message).toContain(nodePath);
      expect((failure as Error).message).toContain(hostScript);
      expect((failure as HostLaunchError).exit.kind).toBe('exited-early');
      expect((failure as HostLaunchError).exit.detail).toMatch(
        /could not be spawned/,
      );
      expect(await tempHomes()).toEqual(before);
    });

    it('reports a missing host script as an early exit', async () => {
      const failure = await launchBenchHost({
        workspaceRoot: workspace,
        hostScript: join(root, 'no-such-host.mjs'),
        realHome,
        bootTimeoutMs: 20_000,
        guard: { ci: false, preSampleMs: 50 },
      }).then(
        () => {
          throw new Error('expected the launch to fail');
        },
        (error: unknown) => error,
      );
      expect((failure as Error).message).toMatch(
        /bench host exited \(code 1\) before ready/,
      );
      expect((failure as HostLaunchError).exit).toMatchObject({
        kind: 'exited-early',
        exitCode: 1,
      });
    });
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

    describe('partial guard (handles the probe could not name)', () => {
      /** A synthetic probe: a concurrent writer (pid 424242), then scripted tree samples. */
      const scriptedProbe = (
        sample: (
          rootPid: number,
          index: number,
        ) => Awaited<ReturnType<HandleProbe['treeOpenPaths']>>,
      ): { probe: HandleProbe; samples: () => number } => {
        let count = 0;
        return {
          samples: () => count,
          probe: {
            platform: process.platform,
            holders: async (paths) => ({
              holders: new Map([[paths[0], [424242]]]),
              processes: [{ pid: 424242, ppid: 1, name: 'Ptah.exe' }],
            }),
            treeOpenPaths: async (rootPid) => sample(rootPid, count++),
          },
        };
      };
      const tree = (rootPid: number): ProcessEntry[] => [
        { pid: rootPid, ppid: process.pid, name: 'node.exe' },
      ];

      it('lists each unprobed pid and name (max handles across samples) and passes', async () => {
        const { probe, samples } = scriptedProbe((rootPid, index) => ({
          tree: tree(rootPid),
          open: [],
          unprobed:
            index === 0
              ? [
                  { pid: rootPid, handles: 2 },
                  { pid: 999_999, handles: 1 },
                ]
              : [{ pid: rootPid, handles: 5 }],
        }));
        const host = await launch(undefined, { probe, sampleIntervalMs: 50 });
        expect(host.guardMode).toBe('process-watch');
        await waitFor(() => samples() >= 1);

        const report = await host.stop();
        if (report.guard.mode !== 'process-watch')
          throw new Error('expected process-watch');
        expect(report.guard.partial).toBe(true);
        expect(report.guard.unprobedProcesses).toHaveLength(2);
        expect(report.guard.unprobedProcesses).toEqual(
          expect.arrayContaining([
            { pid: host.pid, name: 'node.exe', handles: 5 },
            { pid: 999_999, name: 'unknown', handles: 1 },
          ]),
        );
      });

      it('is not partial when every handle was named', async () => {
        const { probe } = scriptedProbe((rootPid) => ({
          tree: tree(rootPid),
          open: [],
          unprobed: [],
        }));
        const host = await launch(undefined, { probe });

        const report = await host.stop();
        if (report.guard.mode !== 'process-watch')
          throw new Error('expected process-watch');
        expect(report.guard).toMatchObject({
          partial: false,
          unprobedProcesses: [],
        });
      });

      it('still fails on a held real path, naming the unprobed processes', async () => {
        const { probe } = scriptedProbe((rootPid) => ({
          tree: tree(rootPid),
          open: [{ pid: rootPid, path: realFile() }],
          unprobed: [{ pid: rootPid, handles: 1 }],
        }));
        const host = await launch(undefined, { probe });

        await expect(host.stop()).rejects.toThrow(
          new RegExp(
            `unprobed \\(guard partial\\): node\\.exe ${host.pid} \\(1 handles\\)`,
          ),
        );
      });

      it('still fails closed on a sample that could not run, naming the unprobed processes', async () => {
        const { probe, samples } = scriptedProbe((rootPid, index) => {
          if (index > 0) throw new Error('probe exploded');
          return {
            tree: tree(rootPid),
            open: [],
            unprobed: [{ pid: rootPid, handles: 3 }],
          };
        });
        const host = await launch(undefined, { probe, sampleIntervalMs: 50 });
        await waitFor(() => samples() >= 1);

        await expect(host.stop()).rejects.toThrow(
          /process-watch sample failed: probe exploded; unprobed \(guard partial\): node\.exe \d+ \(3 handles\)/,
        );
      });
    });

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

describe('classifyHostExit', () => {
  const stopped: HostExitObservation = {
    exitCode: 0,
    signal: null,
    endedBeforeStop: false,
    forceKilled: false,
  };

  it('calls a zero exit after the stop clean', () => {
    expect(classifyHostExit(stopped)).toEqual({
      kind: 'clean',
      exitCode: 0,
      signal: null,
    });
  });

  it.each([
    [3221226505, /0xC0000409 \(3221226505\): fail-fast/],
    [3221225477, /0xC0000005 \(3221225477\): access violation/],
    [1, /^exit code 1 after the graceful stop began/],
    [2, /host forced its exit after its teardown hung/],
  ])(
    'calls exit code %d after the stop a crash-on-shutdown',
    (code, detail) => {
      const exit = classifyHostExit({ ...stopped, exitCode: code });
      expect(exit.kind).toBe('crash-on-shutdown');
      expect(exit.detail).toMatch(detail);
    },
  );

  it.each(['SIGSEGV', 'SIGABRT'])(
    'calls the fatal signal %s after the stop a crash-on-shutdown',
    (signal) => {
      expect(
        classifyHostExit({ ...stopped, exitCode: null, signal }),
      ).toMatchObject({
        kind: 'crash-on-shutdown',
        detail: expect.stringMatching(new RegExp(`^fatal signal ${signal}`)),
      });
    },
  );

  it('calls an end by the launcher’s own graceful signal clean', () => {
    expect(
      classifyHostExit({
        ...stopped,
        exitCode: null,
        signal: 'SIGTERM',
        gracefulSignal: 'SIGTERM',
      }).kind,
    ).toBe('clean');
  });

  it('calls a fired tree kill killed, with the caller’s reason when given', () => {
    expect(
      classifyHostExit({ ...stopped, exitCode: 1, forceKilled: true }),
    ).toMatchObject({
      kind: 'killed',
      detail: expect.stringMatching(/graceful stop timed out/),
    });
    expect(
      classifyHostExit({
        ...stopped,
        exitCode: 1,
        forceKilled: true,
        killReason: 'win32 taskkill',
      }).detail,
    ).toBe('win32 taskkill');
  });

  it('calls any end before the stop exited-early, a crash code included', () => {
    expect(
      classifyHostExit({
        ...stopped,
        exitCode: 3221226505,
        endedBeforeStop: true,
      }).kind,
    ).toBe('exited-early');
    expect(
      classifyHostExit({
        ...stopped,
        exitCode: null,
        spawnError: 'node: ENOENT',
      }),
    ).toEqual({
      kind: 'exited-early',
      exitCode: null,
      signal: null,
      detail: 'the host could not be spawned: node: ENOENT',
    });
  });
});

describe('open-handle probe: unprobed handles per pid', () => {
  it('parses the win32 reply, one-element arrays collapsed by ConvertTo-Json included', () => {
    const processes = [
      { pid: 10, ppid: 1, name: 'node.exe' },
      { pid: 11, ppid: 10, name: 'conhost.exe' },
      { pid: 20, ppid: 1, name: 'other.exe' },
    ];
    expect(
      parseWindowsTreeReply(
        10,
        JSON.stringify({
          processes,
          open: ['10\t\\\\?\\C:\\work\\a.txt', '11\t\\\\?\\C:\\work\\b.txt'],
          unprobed: ['10\t3', '11\t1', 'garbage', '12\t0'],
        }),
      ),
    ).toEqual({
      tree: processes.slice(0, 2),
      open: [
        { pid: 10, path: 'C:\\work\\a.txt' },
        { pid: 11, path: 'C:\\work\\b.txt' },
      ],
      unprobed: [
        { pid: 10, handles: 3 },
        { pid: 11, handles: 1 },
      ],
    });
    expect(
      parseWindowsTreeReply(
        10,
        JSON.stringify({ processes, open: [], unprobed: '11\t2' }),
      ).unprobed,
    ).toEqual([{ pid: 11, handles: 2 }]);
  });

  describe('linux /proc probe (fake /proc, runs on any OS)', () => {
    const errno = (code: string): NodeJS.ErrnoException =>
      Object.assign(new Error(code), { code });

    const fakeProc = (fdTables: Record<number, string[] | Error>): ProcFs => ({
      readdir: async (path) => {
        if (path === '/proc') return ['1', '100', '101', 'self'];
        const pid = Number(path.split('/')[2]);
        const table = fdTables[pid];
        if (table instanceof Error) throw table;
        return Object.keys(table ?? []);
      },
      readFile: async (path) => {
        const pid = Number(path.split('/')[2]);
        const parents: Record<number, number> = { 1: 0, 100: 1, 101: 100 };
        return `${pid} (proc ${pid}) S ${parents[pid]} 0 0`;
      },
      readlink: async (path) => {
        const [, , pidText, kind, fd] = path.split('/');
        const pid = Number(pidText);
        if (kind === 'cwd') return `/work/${pid}`;
        const table = fdTables[pid];
        const target = Array.isArray(table) ? table[Number(fd)] : undefined;
        if (target === 'EACCES') throw errno('EACCES');
        if (target === 'ENOENT' || target === undefined) throw errno('ENOENT');
        return target;
      },
    });

    it('counts an fd whose link cannot be read as unprobed for its pid', async () => {
      const probe = new ProcFsHandleProbe(
        fakeProc({
          100: ['/work/db.sqlite', 'EACCES', 'ENOENT', 'socket:[123]'],
          101: ['EACCES', 'EACCES'],
        }),
      );

      const result = await probe.treeOpenPaths(100);
      expect(result.tree.map((entry) => entry.pid)).toEqual([100, 101]);
      expect(result.open).toEqual([
        { pid: 100, path: '/work/100' },
        { pid: 100, path: '/work/db.sqlite' },
        { pid: 101, path: '/work/101' },
      ]);
      expect(result.unprobed).toEqual([
        { pid: 100, handles: 1 },
        { pid: 101, handles: 2 },
      ]);
    });

    it('counts an fd table that cannot be listed as unprobed, and one that vanished as nothing', async () => {
      const probe = new ProcFsHandleProbe(
        fakeProc({ 100: errno('EACCES'), 101: errno('ENOENT') }),
      );

      const result = await probe.treeOpenPaths(100);
      expect(result.unprobed).toEqual([{ pid: 100, handles: 1 }]);
    });
  });
});
