import { EventEmitter } from 'node:events';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  NX_ENTRY_CANDIDATES,
  RUN_CHECK_TOOL_NAME,
  buildRunCheckTool,
  formatRunCheckSummary,
  runCheck,
  type CheckProcess,
  type RunCheckDependencies,
  type SpawnCheckProcess,
} from './run-check.tool';
import {
  RunCheckArgsSchema,
  WAIT_SUMMARY_MAX_CHARS,
} from './wait-tools-args.schema';

/** A child process whose output and exit the test drives. */
class FakeProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid: number | undefined;
  /** `null`: a launch that failed before the OS assigned a pid. */
  constructor(pid: number | null = 4242) {
    super();
    this.pid = pid ?? undefined;
  }
  finish(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit('close', code, signal));
  }
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ptah-run-check-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function installNx(script: string, candidate = 0): string {
  const entry = join(root, ...NX_ENTRY_CANDIDATES[candidate]);
  mkdirSync(join(entry, '..'), { recursive: true });
  writeFileSync(entry, script);
  return entry;
}

/** Resolve once the tool has launched its process and armed its listeners. */
async function untilSpawned(spawnProcess: jest.Mock): Promise<void> {
  // The tool checks for Nx and opens its log (real disk I/O) before it
  // launches; poll on setImmediate, which the timeout test leaves unfaked.
  const deadline = Date.now() + 5_000;
  while (spawnProcess.mock.calls.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setImmediate(r));
  }
  expect(spawnProcess).toHaveBeenCalled();
  await new Promise((r) => setImmediate(r));
}

function args(input: Record<string, unknown>) {
  return RunCheckArgsSchema.parse(input);
}

function fakeDeps(
  child: FakeProcess,
  overrides: Partial<RunCheckDependencies> = {},
): RunCheckDependencies & { spawnProcess: jest.Mock } {
  const spawnProcess = jest.fn(() => child as unknown as CheckProcess);
  return {
    workspaceRoot: root,
    spawnProcess: spawnProcess as unknown as SpawnCheckProcess,
    killTree: jest.fn(async () => undefined),
    ...overrides,
  } as RunCheckDependencies & { spawnProcess: jest.Mock };
}

describe('buildRunCheckTool', () => {
  it('advertises the name, the targets and the 900 s ceiling', () => {
    const tool = buildRunCheckTool();
    expect(tool.name).toBe(RUN_CHECK_TOOL_NAME);
    expect(tool.inputSchema.required).toEqual(['project', 'targets']);
    expect(tool.inputSchema.properties['timeoutSec']).toMatchObject({
      maximum: 900,
    });
    expect(tool.inputSchema.properties['targets']).toMatchObject({
      items: { enum: ['test', 'lint', 'typecheck', 'build'] },
    });
  });
});

describe('runCheck', () => {
  it('returns an error naming every path tried when Nx is missing, and spawns nothing', async () => {
    const child = new FakeProcess();
    const d = fakeDeps(child);
    const outcome = await runCheck(
      args({ project: 'app', targets: ['test'] }),
      d,
    );

    expect(outcome.isError).toBe(true);
    for (const parts of NX_ENTRY_CANDIDATES) {
      expect(outcome.text).toContain(join(root, ...parts));
    }
    expect(d.spawnProcess).not.toHaveBeenCalled();
    expect(outcome.structured).toMatchObject({
      cwd: root,
      verdict: 'not_run',
      exitCode: null,
    });
  });

  it('runs node with an argument array in the workspace root, never a shell string', async () => {
    const entry = installNx('', 1);
    const child = new FakeProcess();
    const d = fakeDeps(child);
    const pending = runCheck(
      args({ project: '@scope/lib', targets: ['lint', 'typecheck'] }),
      d,
    );
    await untilSpawned(d.spawnProcess);
    child.finish(0);
    const outcome = await pending;

    expect(d.spawnProcess).toHaveBeenCalledWith(
      'node',
      [
        entry,
        'run-many',
        '-t',
        'lint,typecheck',
        '-p',
        '@scope/lib',
        '--outputStyle=static',
      ],
      expect.objectContaining({ cwd: root }),
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toContain('PASSED (exit 0)');
    expect(outcome.text).toContain(`Ran in: ${root}`);
    expect(outcome.text).toContain('- lint: passed');
    expect(outcome.logPath).toMatch(/checks[\\/].+-_scope_lib\.log$/);
    expect(outcome.structured).toEqual({
      cwd: root,
      project: '@scope/lib',
      targets: ['lint', 'typecheck'],
      verdict: 'passed',
      exitCode: 0,
      logPath: outcome.logPath,
    });
  });

  it('reports per-target results and the last task lines of a failing run, and writes the full log', async () => {
    installNx('');
    const child = new FakeProcess();
    const d = fakeDeps(child);
    const pending = runCheck(
      args({ project: 'app', targets: ['lint', 'test', 'build'] }),
      d,
    );
    await untilSpawned(d.spawnProcess);
    child.stdout.write(
      '\u001b[1m NX   Running targets lint, test for project app:\u001b[22m\n',
    );
    child.stdout.write('> nx run app:lint\nall good\n');
    child.stdout.write('> nx run app:test\nFAIL src/a.spec.ts\n  expected 1 ');
    child.stdout.write('to be 2\n');
    child.stderr.write('Error: assertion failed\n');
    child.stdout.write(
      ' NX   Ran targets lint, test for project app (3s)\n\n' +
        '   ✖  1/2 failed\n\nFailed tasks:\n\n- app:test\n\nNx Cloud noise\n',
    );
    child.finish(1);
    const outcome = await pending;

    expect(outcome.isError).toBe(false);
    expect(outcome.text).toContain('FAILED (exit 1)');
    expect(outcome.text).toContain('- lint: passed');
    expect(outcome.text).toContain('- test: failed');
    expect(outcome.text).toContain('- build: not run');
    expect(outcome.text).toContain('Last output lines:');
    expect(outcome.text).toContain('expected 1 to be 2');
    expect(outcome.text).toContain('Error: assertion failed');
    expect(outcome.text).not.toContain('Nx Cloud noise');
    expect(outcome.text).not.toContain('\u001b');

    const log = readFileSync(outcome.logPath as string, 'utf8');
    expect(log).toContain('Nx Cloud noise');
    expect(log).toContain('[ptah_run_check] exit 1');
  });

  it('kills the process tree on timeout and says so', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      installNx('');
      const child = new FakeProcess(777);
      const killTree = jest.fn(async () => {
        child.finish(null, 'SIGTERM');
      });
      const d = fakeDeps(child, { killTree });
      const pending = runCheck(
        args({ project: 'app', targets: ['test'], timeoutSec: 5 }),
        d,
      );
      await untilSpawned(d.spawnProcess);
      child.stdout.write('> nx run app:test\nstill going\n');
      await jest.advanceTimersByTimeAsync(5_000);
      jest.useRealTimers();
      const outcome = await pending;

      expect(killTree).toHaveBeenCalledWith(777);
      expect(outcome.text).toContain(
        'TIMED OUT after 5s; the process tree was killed',
      );
      expect(outcome.text).toContain('- test: incomplete');
      expect(outcome.text).toContain('still going');
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports a launch failure as an error result', async () => {
    installNx('');
    const child = new FakeProcess(null);
    const d = fakeDeps(child, { nodeExecutable: 'no-such-node' });
    const pending = runCheck(args({ project: 'app', targets: ['test'] }), d);
    await untilSpawned(d.spawnProcess);
    child.emit('error', new Error('spawn no-such-node ENOENT'));
    const outcome = await pending;

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('could not start "no-such-node"');
    expect(outcome.text).toContain('ENOENT');
  });

  it('still runs and says why when the log cannot be written', async () => {
    installNx('');
    const blocker = join(root, 'not-a-dir');
    writeFileSync(blocker, 'file');
    const child = new FakeProcess();
    const d = fakeDeps(child, { logDirectory: join(blocker, 'checks') });
    const pending = runCheck(args({ project: 'app', targets: ['lint'] }), d);
    await untilSpawned(d.spawnProcess);
    child.finish(0);
    const outcome = await pending;

    expect(outcome.isError).toBe(false);
    expect(outcome.logPath).toBeUndefined();
    expect(outcome.text).toContain('Full log: not written (');
  });

  it('runs a real node process end to end and kills it on timeout', async () => {
    installNx(
      "process.stdout.write('> nx run app:test\\nargs=' + JSON.stringify(process.argv.slice(2)) + '\\n');" +
        'setInterval(() => {}, 1000);',
    );
    const outcome = await runCheck(
      args({ project: 'app', targets: ['test'], timeoutSec: 1 }),
      { workspaceRoot: root, nodeExecutable: process.execPath },
    );

    expect(outcome.isError).toBe(false);
    expect(outcome.text).toContain('TIMED OUT after 1s');
    const log = readFileSync(outcome.logPath as string, 'utf8');
    expect(log).toContain(
      'args=["run-many","-t","test","-p","app","--outputStyle=static"]',
    );
  }, 30_000);
});

describe('formatRunCheckSummary', () => {
  it(`keeps the reply within ${WAIT_SUMMARY_MAX_CHARS} chars and the newest lines`, () => {
    const lines = Array.from(
      { length: 400 },
      (_, i) => `line-${i} ${'z'.repeat(280)}`,
    );
    const text = formatRunCheckSummary({
      cwd: root,
      project: 'p'.repeat(120),
      targets: ['test', 'lint', 'typecheck', 'build'],
      timeoutSec: 900,
      code: 1,
      timedOut: false,
      durationMs: 123_456,
      results: new Map([['test', 'failed']]),
      lastLines: lines,
      logPath: join(root, 'x'.repeat(500)),
    });
    expect(text.length).toBeLessThanOrEqual(WAIT_SUMMARY_MAX_CHARS);
    expect(text).toContain('line-399');
    expect(text).toContain('- lint: unknown');
    expect(text).toContain('Full log:');
  });

  it('omits output lines on a passing run', () => {
    const text = formatRunCheckSummary({
      cwd: '/work/tree',
      project: 'app',
      targets: ['lint'],
      timeoutSec: 60,
      code: 0,
      timedOut: false,
      durationMs: 1_000,
      results: new Map([['lint', 'passed']]),
      lastLines: ['noise'],
      logPath: '/tmp/x.log',
    });
    expect(text).not.toContain('noise');
    expect(text).toContain('PASSED (exit 0), 1.0s.');
    expect(text).toContain('Ran in: /work/tree');
  });
});
