/**
 * `runWorkspaceWatcherContract` — behavioural contract for `IWorkspaceWatcher`
 * (TASK_2026_437 C7).
 *
 * Every adapter (Electron utilityProcess host, CLI worker host, VS Code) runs
 * the same suite so the INV-1 guarantees — batched, pre-filtered,
 * overflow-signalling, silent after dispose — hold on every host. The suite
 * drives changes through the adapter's own `writeFile` / `deleteFile`, so a
 * real-filesystem adapter points them at a temp directory while the VS Code
 * adapter feeds its `FileSystemWatcher` double. Assertions target delivered
 * batches only, never engine call counts, and use real time: adapters run
 * real processes and timers.
 */

import type {
  IWorkspaceWatcher,
  WorkspaceChangeBatch,
  WorkspaceWatchOptions,
} from '../../interfaces/workspace-watcher.interface';

export interface WorkspaceWatcherContractSetup {
  /** A fresh watcher per test. */
  createWatcher(): Promise<IWorkspaceWatcher> | IWorkspaceWatcher;
  /** A fresh, empty, absolute root per test. */
  createRoot(): Promise<string> | string;
  /** Creates or overwrites a file (parent directories included) so the adapter observes it. */
  writeFile(absolutePath: string, content: string): Promise<void> | void;
  /** Deletes a file so the adapter observes it. */
  deleteFile(absolutePath: string): Promise<void> | void;
  /**
   * Makes the adapter lose events for `root` (native error, host kill,
   * watcher error). Omit when the adapter has no injection point; the overflow
   * case is then skipped.
   */
  triggerOverflow?(
    watcher: IWorkspaceWatcher,
    root: string,
  ): Promise<void> | void;
  /** Awaited after `watch` so an engine that subscribes asynchronously is live. Default 0. */
  subscribeSettleMs?: number;
  /** Longest wait for an expected batch. Default 5 000 ms. */
  eventTimeoutMs?: number;
  /** How long "nothing arrives" is observed. Default 750 ms (three batch intervals). */
  quietObservationMs?: number;
  /**
   * Early arrival tolerated on a gap between two received batches. The
   * guarantee holds at emission; a transport (IPC to a host process) can
   * delay one batch more than the next. Default 15 ms.
   */
  cadenceToleranceMs?: number;
}

/** The INV-1 floor every adapter inherits from `WorkspaceChangeCoalescer`. */
const BATCH_INTERVAL_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Forward-slashed and trailing-separator-free, case-folded for a Windows or UNC path. */
function comparable(p: string): string {
  const forward = p.replace(/\\/g, '/').replace(/(?<=.)\/+$/, '');
  return /^(?:[A-Za-z]:\/|\/\/)/.test(forward)
    ? forward.toLowerCase()
    : forward;
}

function join(root: string, relative: string): string {
  const separator = root.includes('\\') ? '\\' : '/';
  const base = root.replace(/(?<=.)[\\/]+$/, '');
  return [base, ...relative.split('/')].join(separator);
}

/** Records every batch of one subscription, with its arrival time. */
class BatchRecorder {
  readonly batches: Array<{ at: number; batch: WorkspaceChangeBatch }> = [];

  readonly listener = (batch: WorkspaceChangeBatch): void => {
    this.batches.push({ at: Date.now(), batch });
  };

  hasPath(absolutePath: string): boolean {
    const wanted = comparable(absolutePath);
    return this.batches.some(({ batch }) =>
      batch.changes.some((change) => comparable(change.path) === wanted),
    );
  }

  kindsOf(absolutePath: string): string[] {
    const wanted = comparable(absolutePath);
    return this.batches.flatMap(({ batch }) =>
      batch.changes
        .filter((change) => comparable(change.path) === wanted)
        .map((change) => change.kind),
    );
  }

  rawPaths(): string[] {
    return this.batches.flatMap(({ batch }) =>
      batch.changes.map((change) => change.path),
    );
  }

  async waitFor(
    predicate: () => boolean,
    timeoutMs: number,
    what: string,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out after ${timeoutMs} ms waiting for ${what}; received ${JSON.stringify(
            this.batches.map((b) => b.batch),
          )}`,
        );
      }
      await sleep(20);
    }
  }
}

/**
 * @param name     Adapter label for the `describe` block.
 * @param setup    Watcher/root factories, change drivers and timing knobs.
 * @param teardown Called after every test, after all subscriptions are
 *                 disposed — a trailing parameter like every sibling runner.
 */
export function runWorkspaceWatcherContract(
  name: string,
  setup: WorkspaceWatcherContractSetup,
  teardown?: () => Promise<void> | void,
): void {
  const eventTimeoutMs = setup.eventTimeoutMs ?? 5_000;
  const quietMs = setup.quietObservationMs ?? 750;
  const cadenceToleranceMs = setup.cadenceToleranceMs ?? 15;
  const testTimeoutMs = eventTimeoutMs * 3 + quietMs * 2 + 5_000;

  describe(`IWorkspaceWatcher contract — ${name}`, () => {
    let watcher: IWorkspaceWatcher;
    let root: string;
    const disposables: Array<{ dispose(): void }> = [];

    const options = (
      overrides: Partial<WorkspaceWatchOptions> = {},
    ): WorkspaceWatchOptions => ({
      excludeGlobs: [],
      excludeDirNames: [],
      excludeSegmentRules: [],
      nestedRepoDetection: false,
      ...overrides,
    });

    const subscribe = async (
      recorder: BatchRecorder,
      overrides: Partial<WorkspaceWatchOptions> = {},
    ) => {
      const subscription = watcher.watch(
        root,
        options(overrides),
        recorder.listener,
      );
      disposables.push(subscription);
      if (setup.subscribeSettleMs) await sleep(setup.subscribeSettleMs);
      return subscription;
    };

    beforeEach(async () => {
      watcher = await setup.createWatcher();
      root = await setup.createRoot();
    });

    afterEach(async () => {
      for (const disposable of disposables.splice(0)) disposable.dispose();
      await teardown?.();
    });

    it(
      'watch returns an IDisposable and never calls the listener synchronously',
      () => {
        let calls = 0;
        const subscription = watcher.watch(root, options(), () => {
          calls++;
        });
        disposables.push(subscription);
        expect(typeof subscription.dispose).toBe('function');
        expect(calls).toBe(0);
      },
      testTimeoutMs,
    );

    it(
      'delivers a created file and then its deletion, stamped with the subscribed root',
      async () => {
        const recorder = new BatchRecorder();
        await subscribe(recorder);
        const file = join(root, 'src/created.txt');

        await setup.writeFile(file, 'one');
        await recorder.waitFor(
          () => recorder.hasPath(file),
          eventTimeoutMs,
          'the created file',
        );
        expect(['create', 'update']).toContain(recorder.kindsOf(file)[0]);

        await setup.deleteFile(file);
        await recorder.waitFor(
          () => recorder.kindsOf(file).includes('delete'),
          eventTimeoutMs,
          'the deletion',
        );

        for (const { batch } of recorder.batches) {
          expect(batch.root).toBe(root);
          expect(batch.overflow).toBe(false);
        }
      },
      testTimeoutMs,
    );

    it(
      'never delivers paths excluded by segment rules or globs',
      async () => {
        const recorder = new BatchRecorder();
        await subscribe(recorder, {
          excludeDirNames: ['node_modules'],
          excludeSegmentRules: [['.claude', 'worktrees']],
          excludeGlobs: ['**/excluded-glob/**'],
        });

        const excluded = [
          join(root, '.claude/worktrees/agent-1/file.txt'),
          join(root, '.Claude/WorkTrees/agent-2/file.txt'),
          join(root, 'pkg/node_modules/dep/index.js'),
          join(root, 'excluded-glob/deep/file.txt'),
        ];
        const kept = join(root, '.claude/commands/kept.md');
        // Directory names are case-sensitive: a differently cased name stays watched.
        const keptCaseVariant = join(root, 'other/Node_Modules/kept.js');
        for (const file of excluded) await setup.writeFile(file, 'x');
        await setup.writeFile(kept, 'x');
        await setup.writeFile(keptCaseVariant, 'x');

        await recorder.waitFor(
          () => recorder.hasPath(kept) && recorder.hasPath(keptCaseVariant),
          eventTimeoutMs,
          'the included siblings',
        );
        await sleep(quietMs);

        // Raw spelling (not `comparable`, which folds a Windows path's case).
        for (const path of recorder.rawPaths()) {
          const forward = path.replace(/\\/g, '/');
          expect(forward).not.toMatch(/\/\.claude\/worktrees(\/|$)/i);
          expect(forward).not.toMatch(/\/node_modules(\/|$)/);
          expect(forward).not.toMatch(/\/excluded-glob(\/|$)/);
        }
      },
      testTimeoutMs,
    );

    it(
      'nestedRepoDetection excludes everything under a directory once its .git entry is seen',
      async () => {
        const recorder = new BatchRecorder();
        await subscribe(recorder, { nestedRepoDetection: true });

        await setup.writeFile(join(root, 'nested/.git'), 'gitdir: elsewhere');
        const firstSync = join(root, 'sync-1.txt');
        await setup.writeFile(firstSync, 'x');
        await recorder.waitFor(
          () => recorder.hasPath(firstSync),
          eventTimeoutMs,
          'the first sync file',
        );

        const hidden = join(root, 'nested/src/hidden.txt');
        const secondSync = join(root, 'sync-2.txt');
        await setup.writeFile(hidden, 'x');
        await setup.writeFile(secondSync, 'x');
        await recorder.waitFor(
          () => recorder.hasPath(secondSync),
          eventTimeoutMs,
          'the second sync file',
        );
        await sleep(quietMs);

        expect(recorder.hasPath(hidden)).toBe(false);
      },
      testTimeoutMs,
    );

    it(
      'seeded nestedRepoRoots are excluded from the first event',
      async () => {
        const recorder = new BatchRecorder();
        await subscribe(recorder, {
          nestedRepoRoots: [join(root, 'worktree-a')],
        });
        const hidden = join(root, 'worktree-a/file.txt');
        const kept = join(root, 'worktree-ab/file.txt');
        await setup.writeFile(hidden, 'x');
        await setup.writeFile(kept, 'x');
        await recorder.waitFor(
          () => recorder.hasPath(kept),
          eventTimeoutMs,
          'the sibling with a shared name prefix',
        );
        await sleep(quietMs);
        expect(recorder.hasPath(hidden)).toBe(false);
      },
      testTimeoutMs,
    );

    it(
      'batches are spaced by at least minBatchIntervalMs, capped at maxPathsPerBatch, and consistent',
      async () => {
        const recorder = new BatchRecorder();
        const cap = 5;
        await subscribe(recorder, { maxPathsPerBatch: cap });

        const files = Array.from({ length: 30 }, (_, i) =>
          join(root, `burst/file-${i}.txt`),
        );
        for (const file of files) await setup.writeFile(file, 'x');
        await recorder.waitFor(
          () => recorder.batches.length > 0,
          eventTimeoutMs,
          'the first burst batch',
        );
        await sleep(quietMs + BATCH_INTERVAL_MS);

        const { batches } = recorder;
        for (let i = 1; i < batches.length; i++) {
          expect(batches[i].at - batches[i - 1].at).toBeGreaterThanOrEqual(
            BATCH_INTERVAL_MS - cadenceToleranceMs,
          );
        }
        for (const { batch } of batches) {
          expect(batch.changes.length).toBeLessThanOrEqual(cap);
          expect(batch.droppedCount).toBeGreaterThanOrEqual(0);
          if (batch.overflow) {
            expect(batch.changes).toHaveLength(0);
            expect(batch.truncated).toBe(false);
          } else {
            expect(batch.truncated).toBe(batch.droppedCount > 0);
          }
        }
      },
      testTimeoutMs,
    );

    it(
      'dispose stops delivery for that subscription only, and is idempotent',
      async () => {
        const disposed = new BatchRecorder();
        const live = new BatchRecorder();
        const first = await subscribe(disposed);
        await subscribe(live);

        const warmup = join(root, 'warmup.txt');
        await setup.writeFile(warmup, 'x');
        await live.waitFor(
          () => live.hasPath(warmup),
          eventTimeoutMs,
          'warmup',
        );
        await disposed.waitFor(
          () => disposed.hasPath(warmup),
          eventTimeoutMs,
          'warmup on the subscription about to be disposed',
        );
        await sleep(BATCH_INTERVAL_MS);

        first.dispose();
        first.dispose();
        const countAtDispose = disposed.batches.length;

        const after = join(root, 'after-dispose.txt');
        await setup.writeFile(after, 'x');
        await live.waitFor(
          () => live.hasPath(after),
          eventTimeoutMs,
          'the post-dispose file on the live subscription',
        );
        await sleep(quietMs);

        expect(disposed.batches).toHaveLength(countAtDispose);
      },
      testTimeoutMs,
    );

    // Skipped, visibly, when the adapter declares no failure injection point.
    const triggerOverflow = setup.triggerOverflow;
    (triggerOverflow ? it : it.skip)(
      'an adapter failure surfaces as an overflow batch with no paths, and delivery resumes',
      async () => {
        const recorder = new BatchRecorder();
        await subscribe(recorder);

        await triggerOverflow?.(watcher, root);
        await recorder.waitFor(
          () => recorder.batches.some(({ batch }) => batch.overflow),
          eventTimeoutMs,
          'an overflow batch',
        );
        for (const { batch } of recorder.batches) {
          if (batch.overflow) expect(batch.changes).toHaveLength(0);
        }

        const resumed = join(root, 'after-overflow.txt');
        await setup.writeFile(resumed, 'x');
        await recorder.waitFor(
          () => recorder.hasPath(resumed),
          eventTimeoutMs,
          'a change after the overflow',
        );
      },
      testTimeoutMs,
    );
  });
}
