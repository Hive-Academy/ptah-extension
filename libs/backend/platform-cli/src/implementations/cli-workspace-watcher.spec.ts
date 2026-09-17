/**
 * `CliWorkspaceWatcher` (TASK_2026_437 C9). Supervision itself is
 * `WorkspaceWatchSupervisor`, specified in platform-core; this spec covers what
 * the CLI facade adds, against real processes:
 *
 * 1. the host path both `main.mjs` and `tui.mjs` resolve (D7);
 * 2. a missing bundle degrades the watcher without spawning anything;
 * 3. the shared `runWorkspaceWatcherContract` over the REAL entry, bundled the
 *    way the CLI build bundles it (ESM, `createRequire` banner,
 *    `@parcel/watcher` external) and started by the production fork shim —
 *    including the overflow case, driven by killing the host.
 *
 * 4. the host's stderr stays a bounded tail and reaches the failure diagnostic.
 *
 * The real bundle comes from `workspace-watch-host.bundle.harness.ts`.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type {
  WorkspaceChangeBatch,
  WorkspaceWatchHostProcess,
  WorkspaceWatchOptions,
  WorkspaceWatcherDegradation,
  WorkspaceWatcherDiagnostic,
} from '@ptah-extension/platform-core';
import { runWorkspaceWatcherContract } from '@ptah-extension/platform-core/testing';

import {
  buildCliWatchHostBundle,
  type CliWatchHostBundle,
} from '../workspace-watch/workspace-watch-host.bundle.harness';
import {
  CLI_WATCH_HOST_STDERR_TAIL_CHARS,
  CLI_WORKSPACE_WATCH_HOST_BUNDLE,
  CliWorkspaceWatchHostForker,
  CliWorkspaceWatchHostProcess,
  CliWorkspaceWatcher,
  resolveCliWorkspaceWatchHostPath,
} from './cli-workspace-watcher';

/** The live core module, shared with the adapter's own `fork` import. */
const nodeChildProcess =
  jest.requireActual<typeof import('node:child_process')>('node:child_process');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  predicate: () => boolean,
  what: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(25);
  }
}

const tempRoots: string[] = [];
function makeTempRoot(): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-cli-watch-')),
  );
  tempRoots.push(root);
  return root;
}

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function watchOptions(): WorkspaceWatchOptions {
  return {
    excludeGlobs: [],
    excludeDirNames: [],
    excludeSegmentRules: [],
    nestedRepoDetection: false,
  };
}

afterAll(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('resolveCliWorkspaceWatchHostPath', () => {
  it('puts the host beside the running bundle, the same file for main.mjs and tui.mjs', () => {
    const dist = path.join(path.sep, 'pkg', 'dist', 'apps', 'ptah-cli');
    const expected = path.join(dist, 'workspace-watch-host.mjs');
    expect(CLI_WORKSPACE_WATCH_HOST_BUNDLE).toBe('workspace-watch-host.mjs');
    // Both bundles evaluate `__dirname` to the directory they sit in.
    expect(
      resolveCliWorkspaceWatchHostPath(
        path.dirname(path.join(dist, 'main.mjs')),
      ),
    ).toBe(expected);
    expect(
      resolveCliWorkspaceWatchHostPath(
        path.dirname(path.join(dist, 'tui.mjs')),
      ),
    ).toBe(expected);
  });
});

describe('CliWorkspaceWatcher without a host bundle', () => {
  afterEach(() => jest.restoreAllMocks());

  it('degrades on failed forks without spawning a process, and still delivers overflow', async () => {
    const forkSpy = jest.spyOn(nodeChildProcess, 'fork');
    const degradations: WorkspaceWatcherDegradation[] = [];
    const batches: WorkspaceChangeBatch[] = [];
    const watcher = new CliWorkspaceWatcher({
      hostPath: path.join(makeTempRoot(), CLI_WORKSPACE_WATCH_HOST_BUNDLE),
      supervision: { restartDelayMs: 5 },
      onDegraded: (degradation) => degradations.push(degradation),
    });

    watcher.watch(makeTempRoot(), watchOptions(), (batch) =>
      batches.push(batch),
    );
    await waitFor(() => watcher.isDegraded, 'the degraded watcher');
    await waitFor(() => batches.some((b) => b.overflow), 'an overflow batch');

    expect(forkSpy).not.toHaveBeenCalled();
    expect(degradations).toEqual([
      expect.objectContaining({ reason: 'fork-failed', failuresInWindow: 6 }),
    ]);
    watcher.dispose();
  });

  it('constructing and disposing forks nothing', () => {
    const forkSpy = jest.spyOn(nodeChildProcess, 'fork');
    const watcher = new CliWorkspaceWatcher({
      hostPath: path.join(
        os.tmpdir(),
        'absent',
        CLI_WORKSPACE_WATCH_HOST_BUNDLE,
      ),
    });
    watcher.dispose();
    watcher.dispose();
    expect(forkSpy).not.toHaveBeenCalled();
  });
});

describe('CliWorkspaceWatchHostProcess stderr', () => {
  /** A stand-in host that floods stderr, then dies before it posts anything. */
  function writeCrashingHost(dir: string): string {
    const script = path.join(dir, 'crashing-host.cjs');
    fs.writeFileSync(
      script,
      [
        "process.stderr.write('x'.repeat(200000));",
        "process.stderr.write('\\nnative binding crashed: MARKER\\n', () => process.exit(3));",
      ].join('\n'),
    );
    return script;
  }

  it('keeps only a bounded tail of a large stderr and reports exit after it', async () => {
    const script = writeCrashingHost(makeTempRoot());
    const host = new CliWorkspaceWatchHostProcess(script);
    const exits: Array<number | null> = [];
    host.on('exit', (code) => exits.push(code));

    await waitFor(() => exits.length > 0, 'the host exit');

    expect(exits).toEqual([3]);
    const tail = host.readStderrTail();
    expect(tail.length).toBeLessThanOrEqual(CLI_WATCH_HOST_STDERR_TAIL_CHARS);
    expect(tail.trim().endsWith('native binding crashed: MARKER')).toBe(true);
  });

  it('puts the tail on the failure diagnostic, never logs stderr on its own', async () => {
    const diagnostics: WorkspaceWatcherDiagnostic[] = [];
    const watcher = new CliWorkspaceWatcher({
      hostPath: writeCrashingHost(makeTempRoot()),
      supervision: { restartBudget: 0 },
      onDiagnostic: (d) => diagnostics.push(d),
    });
    watcher.watch(makeTempRoot(), watchOptions(), () => undefined);

    await waitFor(() => watcher.isDegraded, 'the degraded watcher');
    watcher.dispose();

    const mentioning = diagnostics.filter((d) =>
      JSON.stringify(d).includes('MARKER'),
    );
    expect(mentioning).toHaveLength(1);
    expect(mentioning[0].message).toBe('[WorkspaceWatcher] host degraded');
    expect(String(mentioning[0].detail?.['detail']).length).toBeLessThan(1_200);
  });
});

describe('CliWorkspaceWatcher supervising the real forked host', () => {
  const watchers: CliWorkspaceWatcher[] = [];
  const hosts: WorkspaceWatchHostProcess[] = [];
  let bundle: CliWatchHostBundle | undefined;

  beforeAll(() => {
    bundle = buildCliWatchHostBundle('watcher-spec');
    const fork = CliWorkspaceWatchHostForker.prototype.fork;
    jest
      .spyOn(CliWorkspaceWatchHostForker.prototype, 'fork')
      .mockImplementation(function (this: CliWorkspaceWatchHostForker) {
        const host = fork.call(this);
        hosts.push(host);
        return host;
      });
  }, 120_000);

  afterAll(() => {
    jest.restoreAllMocks();
    bundle?.dispose();
  });

  runWorkspaceWatcherContract(
    'CliWorkspaceWatcher (child_process.fork host, @parcel/watcher)',
    {
      createWatcher: () => {
        const watcher = new CliWorkspaceWatcher({
          hostPath: bundle?.bundlePath ?? '',
        });
        watchers.push(watcher);
        return watcher;
      },
      createRoot: makeTempRoot,
      writeFile,
      deleteFile: (file) => fs.rmSync(file),
      triggerOverflow: async () => {
        const before = hosts.length;
        hosts[before - 1]?.kill();
        // Wait for the supervised restart and its native re-subscribe, so the
        // contract's post-overflow write lands on a live subscription.
        await waitFor(() => hosts.length > before, 'the restarted host');
        await sleep(1_500);
      },
      subscribeSettleMs: 1_500,
      cadenceToleranceMs: 30,
    },
    () => {
      for (const watcher of watchers.splice(0)) watcher.dispose();
      hosts.splice(0);
    },
  );
});
