/**
 * The CLI watch host entry outlives nobody (TASK_2026_437 C9).
 *
 * A real parent Node process forks the real host bundle (built by
 * `workspace-watch-host.bundle.harness.ts`, as the CLI build bundles it) and
 * waits for its first heartbeat. Then the parent either ends normally — with
 * the child and its channel unref'd, the way `CliWorkspaceWatchHostProcess`
 * holds them — or is killed outright. Either way the IPC channel closes and the
 * host's `disconnect` handler must end it: the host pid has to be gone within
 * 10 s. No test here passes without observing that.
 *
 * A bundling error fails every test here (as in platform-electron's entry
 * spec); it is never a skip.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  buildCliWatchHostBundle,
  type CliWatchHostBundle,
} from './workspace-watch-host.bundle.harness';

let bundle: CliWatchHostBundle | undefined;

/** Host pids this spec started and has not yet observed gone. */
const liveHostPids = new Set<number>();

/**
 * The parent: fork the host and report its pid after the first heartbeat. In
 * 'exit' mode it lets go of the host, and so ends, on a line from the spec; in
 * 'linger' mode it stays alive until killed.
 */
const PARENT_SCRIPT = `
const { fork } = require('node:child_process');
const [bundlePath, mode] = process.argv.slice(2);
const child = fork(bundlePath, [], {
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  execArgv: [],
});
child.on('message', function onMessage(message) {
  if (!message || message.type !== 'heartbeat') return;
  child.off('message', onMessage);
  process.stdout.write(JSON.stringify({ hostPid: child.pid }) + '\\n');
});
if (mode === 'exit') {
  // Held open until the spec has seen the host alive, then lets go of everything.
  process.stdin.once('data', () => {
    child.unref();
    child.channel && child.channel.unref();
    process.stdin.destroy();
  });
} else {
  setInterval(() => undefined, 1000);
}
`;

const EXIT_DEADLINE_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    // EPERM means the pid exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function waitUntilGone(pid: number): Promise<number> {
  const startedAt = Date.now();
  while (isAlive(pid)) {
    if (Date.now() - startedAt > EXIT_DEADLINE_MS) {
      throw new Error(
        `host pid ${pid} still alive after ${EXIT_DEADLINE_MS} ms`,
      );
    }
    await sleep(50);
  }
  liveHostPids.delete(pid);
  return Date.now() - startedAt;
}

describe('workspace-watch-host.entry — the host exits with its parent', () => {
  let parentScript = '';
  const parents: ChildProcess[] = [];

  beforeAll(() => {
    // Throws on a bundling error, which fails every test below.
    bundle = buildCliWatchHostBundle('entry-spec');
    parentScript = path.join(bundle.dir, `parent-${process.pid}.cjs`);
    fs.writeFileSync(parentScript, PARENT_SCRIPT);
  }, 120_000);

  afterEach(() => {
    for (const parent of parents.splice(0)) {
      if (parent.exitCode === null && parent.signalCode === null) {
        parent.kill('SIGKILL');
      }
    }
    // Only a host this spec never saw exit: a pid it already watched die may
    // have been reused by an unrelated process.
    for (const pid of liveHostPids) {
      liveHostPids.delete(pid);
      if (isAlive(pid)) process.kill(pid);
    }
  });

  afterAll(() => {
    bundle?.dispose();
  });

  async function startParent(
    mode: 'exit' | 'linger',
  ): Promise<{ parent: ChildProcess; hostPid: number }> {
    const parent = spawn(
      process.execPath,
      [parentScript, bundle?.bundlePath ?? '', mode],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    parents.push(parent);
    let stdout = '';
    let stderr = '';
    parent.stdout?.setEncoding('utf8').on('data', (c: string) => (stdout += c));
    parent.stderr?.setEncoding('utf8').on('data', (c: string) => (stderr += c));

    const startedAt = Date.now();
    while (!stdout.includes('\n')) {
      if (parent.exitCode !== null || Date.now() - startedAt > 20_000) {
        throw new Error(
          `parent never reported a live host (exit ${String(parent.exitCode)}): ${stderr}`,
        );
      }
      await sleep(25);
    }
    const { hostPid } = JSON.parse(stdout.split('\n')[0]) as {
      hostPid: number;
    };
    liveHostPids.add(hostPid);
    expect(isAlive(hostPid)).toBe(true);
    return { parent, hostPid };
  }

  it('a parent that ends normally takes the host with it', async () => {
    const { parent, hostPid } = await startParent('exit');
    parent.stdin?.end('go\n');

    const exitCode = await new Promise<number | null>((resolve) => {
      if (parent.exitCode !== null) resolve(parent.exitCode);
      else parent.once('exit', (code) => resolve(code));
    });
    expect(exitCode).toBe(0);

    await expect(waitUntilGone(hostPid)).resolves.toBeLessThanOrEqual(
      EXIT_DEADLINE_MS,
    );
  }, 40_000);

  it('a parent that is killed takes the host with it', async () => {
    const { parent, hostPid } = await startParent('linger');

    parent.kill('SIGKILL');

    await expect(waitUntilGone(hostPid)).resolves.toBeLessThanOrEqual(
      EXIT_DEADLINE_MS,
    );
  }, 40_000);
});
