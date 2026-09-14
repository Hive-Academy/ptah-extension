/**
 * The watch host entry, run for real: bundled with esbuild the way the app's
 * `build-workspace-watch-host` target bundles it (`@parcel/watcher` external)
 * and pointed at temp trees with the real native engine.
 *
 * Two layers:
 * 1. the host protocol over the `worker_threads` transport (batches,
 *    exclusion, nested `.git`, heartbeat, invalid input). ONE worker serves the
 *    whole block: `@parcel/watcher` is not context-aware, so its binding loads
 *    into a single thread per process — a second worker fails with "Module did
 *    not self-register" (measured while writing this spec);
 * 2. `ElectronWorkspaceWatcher` supervising that entry, through the shared
 *    `runWorkspaceWatcherContract` — including the overflow case, driven by
 *    killing the host out from under the adapter. The host here is a
 *    `child_process.fork` of the same bundle, because a restart needs a fresh
 *    binding load, which (above) only a fresh process gets. In the app the
 *    host is a `utilityProcess` — also its own process.
 *
 * The bundle is written under `node_modules/.cache` so the external
 * `@parcel/watcher` resolves from the repository's `node_modules`, as it
 * resolves beside `main.mjs` in a build.
 */
import { execFileSync, fork, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';

import {
  parseWorkspaceWatchHostOutbound,
  type IWorkspaceWatcher,
  type WorkspaceWatchBatchMessage,
  type WorkspaceWatchHostOutbound,
} from '@ptah-extension/platform-core';
import { runWorkspaceWatcherContract } from '@ptah-extension/platform-core/testing';

import {
  ElectronWorkspaceWatcher,
  type WorkspaceWatchHostProcess,
} from './electron-workspace-watcher';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const BUNDLE_DIR = path.join(
  REPO_ROOT,
  'node_modules',
  '.cache',
  'ptah-workspace-watch-host-spec',
);
const BUNDLE_PATH = path.join(
  BUNDLE_DIR,
  `workspace-watch-host-${process.pid}.cjs`,
);

function buildHostBundle(): void {
  fs.mkdirSync(BUNDLE_DIR, { recursive: true });
  execFileSync(
    process.execPath,
    [
      require.resolve('esbuild/bin/esbuild'),
      path.join(__dirname, 'workspace-watch-host.entry.ts'),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--target=node20',
      '--external:@parcel/watcher',
      `--tsconfig=${path.join(REPO_ROOT, 'tsconfig.base.json')}`,
      `--outfile=${BUNDLE_PATH}`,
      '--log-level=error',
    ],
    { stdio: 'pipe' },
  );
}

/** A forked Node child behind the adapter's host-process port. */
class ChildHostProcess implements WorkspaceWatchHostProcess {
  private readonly child: ChildProcess = fork(BUNDLE_PATH, [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });

  constructor() {
    // An IPC write racing a kill surfaces as 'error'; the exit follows it.
    this.child.on('error', () => undefined);
  }

  postMessage(message: unknown): void {
    if (this.child.connected) this.child.send(message as object);
  }

  on(event: 'message', listener: (message: unknown) => void): void;
  on(event: 'exit', listener: (code: number | null) => void): void;
  on(
    event: 'message' | 'exit',
    listener: ((message: unknown) => void) | ((code: number | null) => void),
  ): void {
    if (event === 'message') {
      this.child.on('message', listener as (message: unknown) => void);
    } else {
      this.child.on('exit', (code) =>
        (listener as (code: number | null) => void)(code),
      );
    }
  }

  kill(): void {
    this.child.kill();
  }
}

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
    fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-watch-host-')),
  );
  tempRoots.push(root);
  return root;
}

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const samePath = (a: string, b: string) => path.resolve(a) === path.resolve(b);

beforeAll(() => {
  buildHostBundle();
}, 120_000);

afterAll(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  fs.rmSync(BUNDLE_PATH, { force: true });
});

describe('workspace-watch-host.entry — worker_threads transport', () => {
  let worker: Worker;
  const messages: WorkspaceWatchHostOutbound[] = [];
  const invalid: unknown[] = [];
  const workerErrors: unknown[] = [];

  const batchesFor = (id: number) =>
    messages.filter(
      (m): m is WorkspaceWatchBatchMessage => m.type === 'batch' && m.id === id,
    );
  const hasChange = (id: number, file: string, kind?: string) =>
    batchesFor(id).some((b) =>
      b.changes.some(
        (c) =>
          samePath(c.path, file) && (kind === undefined || c.kind === kind),
      ),
    );

  const subscribe = async (
    id: number,
    root: string,
    overrides: Record<string, unknown> = {},
  ) => {
    worker.postMessage({
      type: 'subscribe',
      id,
      root,
      options: {
        excludeGlobs: [],
        excludeDirNames: [],
        excludeSegmentRules: [],
        nestedRepoDetection: false,
        ...overrides,
      },
    });
    // The native subscription is asynchronous and has no ack by design.
    await sleep(750);
  };

  beforeAll(async () => {
    worker = new Worker(BUNDLE_PATH);
    worker.on('error', (error) => workerErrors.push(error));
    worker.on('message', (raw: unknown) => {
      const parsed = parseWorkspaceWatchHostOutbound(raw);
      if (parsed) messages.push(parsed);
      else invalid.push(raw);
    });
    await waitFor(
      () => messages.some((m) => m.type === 'heartbeat'),
      'the first heartbeat',
    );
  }, 30_000);

  afterAll(async () => {
    await worker.terminate();
  });

  afterEach(() => {
    expect(invalid).toEqual([]);
    expect(workerErrors).toEqual([]);
    expect(messages.filter((m) => m.type === 'fatal')).toEqual([]);
  });

  it('starts with a valid heartbeat and reports invalid input', async () => {
    expect(messages[0]).toEqual({
      type: 'heartbeat',
      seq: 0,
      subscriptions: 0,
      eventsPerSec: 0,
    });
    worker.postMessage({ type: 'subscribe' });
    await waitFor(
      () =>
        messages.some(
          (m) => m.type === 'error' && m.code === 'invalid-message',
        ),
      'the invalid-message error',
    );
  }, 20_000);

  it('delivers create and delete batches from a temp tree, and never an excluded path', async () => {
    const root = makeTempRoot();
    await subscribe(1, root, { excludeDirNames: ['node_modules'] });

    const kept = path.join(root, 'src', 'kept.ts');
    writeFile(path.join(root, 'node_modules', 'dep', 'index.js'), 'x');
    writeFile(kept, 'x');
    await waitFor(() => hasChange(1, kept), 'the kept file');

    fs.rmSync(kept);
    await waitFor(() => hasChange(1, kept, 'delete'), 'the deletion');
    await sleep(500);
    const paths = batchesFor(1).flatMap((b) => b.changes.map((c) => c.path));
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
    worker.postMessage({ type: 'unsubscribe', id: 1 });
  }, 30_000);

  it('detects a nested .git, reports it, and excludes everything under it', async () => {
    const root = makeTempRoot();
    await subscribe(2, root, { nestedRepoDetection: true });

    writeFile(path.join(root, 'nested', '.git'), 'gitdir: elsewhere');
    await waitFor(
      () =>
        messages.some(
          (m) =>
            m.type === 'notice' &&
            m.code === 'nested-root-detected' &&
            samePath(m.detail ?? '', path.join(root, 'nested')),
        ),
      'the nested-root notice',
    );

    const hidden = path.join(root, 'nested', 'src', 'hidden.ts');
    const sync = path.join(root, 'sync.ts');
    writeFile(hidden, 'x');
    writeFile(sync, 'x');
    await waitFor(() => hasChange(2, sync), 'the sync file');
    await sleep(500);
    expect(hasChange(2, hidden)).toBe(false);
    worker.postMessage({ type: 'unsubscribe', id: 2 });
  }, 30_000);

  it('reports live subscriptions and event rate on the heartbeat', async () => {
    const root = makeTempRoot();
    await subscribe(3, root);
    for (let i = 0; i < 5; i++) writeFile(path.join(root, `f${i}.txt`), 'x');
    await waitFor(
      () =>
        messages.some(
          (m) =>
            m.type === 'heartbeat' &&
            m.subscriptions >= 1 &&
            m.eventsPerSec > 0,
        ),
      'a heartbeat counting the events',
    );
    worker.postMessage({ type: 'unsubscribe', id: 3 });
  }, 30_000);
});

describe('ElectronWorkspaceWatcher supervising the real host', () => {
  const watchers: ElectronWorkspaceWatcher[] = [];
  const hostsByWatcher = new Map<IWorkspaceWatcher, ChildHostProcess[]>();

  runWorkspaceWatcherContract(
    'ElectronWorkspaceWatcher (forked host, @parcel/watcher)',
    {
      createWatcher: () => {
        const hosts: ChildHostProcess[] = [];
        const watcher = new ElectronWorkspaceWatcher({
          host: {
            fork: () => {
              const host = new ChildHostProcess();
              hosts.push(host);
              return host;
            },
          },
        });
        watchers.push(watcher);
        hostsByWatcher.set(watcher, hosts);
        return watcher;
      },
      createRoot: makeTempRoot,
      writeFile,
      deleteFile: (file) => fs.rmSync(file),
      triggerOverflow: async (watcher) => {
        const hosts = hostsByWatcher.get(watcher) ?? [];
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
      hostsByWatcher.clear();
    },
  );
});
