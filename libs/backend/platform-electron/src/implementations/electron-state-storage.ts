import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  StateStorageNotReadyError,
  StateStorageRecoveryRequiredError,
  omitJsonPaths,
  type IAsyncStateStorage,
  type IStateStorageMaintenance,
  type IStateStorageReadiness,
  type StateStorageArraySplitPlan,
  type StateStorageGetOptions,
  type StateStorageMigrationReceipt,
  type StateStorageReadinessState,
  type StateStorageSequencePage,
  type StateStorageSequenceReadOptions,
  type StateStorageSequenceWriteChunk,
} from '@ptah-extension/platform-core';
import {
  ElectronStateStorageWorkerHost,
  type ElectronStateWorkerFactory,
} from './electron-state-storage-worker-host';
import {
  assertJsonCompatibleValue,
  type JsonValue,
} from './electron-state-storage-worker-protocol';

export interface ElectronStateStorageWorkerOptions {
  readonly workerPath: string;
  readonly v2RootPath?: string;
  readonly migrations?: readonly StateStorageArraySplitPlan[];
  /** Key prefixes that remain worker-owned and are never startup-hydrated. */
  readonly cacheExcludeKeyPrefixes?: readonly string[];
  readonly workerFactory?: ElectronStateWorkerFactory;
  readonly maxRestartAttempts?: number;
  /** Upper bound on the worker's first-ready handshake. See the worker host. */
  readonly handshakeTimeoutMs?: number;
  readonly onMigrationReceipt?: (receipt: StateStorageMigrationReceipt) => void;
}

/**
 * The global store keeps its intentionally small synchronous v1 behavior.
 * Workspace stores opt into worker mode, where construction performs no file
 * read/parse and every durable write is a v2 generation commit.
 */
export class ElectronStateStorage
  implements
    IAsyncStateStorage,
    IStateStorageReadiness,
    IStateStorageMaintenance
{
  private data: Record<string, JsonValue> = {};
  private readonly filePath: string;
  private writePromise: Promise<void> = Promise.resolve();
  private commitGeneration = 0;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWriteTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly changedKeys = new Set<string>();
  private pendingWrite: Promise<void> | null = null;
  private resolvePendingWrite: (() => void) | null = null;
  private rejectPendingWrite: ((error: Error) => void) | null = null;
  private readonly workerHost: ElectronStateStorageWorkerHost | null;
  private readinessState: StateStorageReadinessState;
  private readonly readyPromise: Promise<void>;

  constructor(
    storageDirPath: string,
    filename: string,
    workerOptions?: ElectronStateStorageWorkerOptions,
    private readonly logger?: Logger,
    private readonly writeFile: (filePath: string, contents: string) => Promise<void> =
      (filePath, contents) => fsPromises.writeFile(filePath, contents, 'utf8'),
  ) {
    this.filePath = path.join(storageDirPath, filename);
    if (!workerOptions) {
      this.workerHost = null;
      this.loadSync();
      this.readinessState = { status: 'ready' };
      this.readyPromise = Promise.resolve();
      return;
    }

    this.readinessState = { status: 'not-ready' };
    this.workerHost = new ElectronStateStorageWorkerHost({
      workerPath: workerOptions.workerPath,
      legacyFilePath: this.filePath,
      v2RootPath:
        workerOptions.v2RootPath ??
        path.join(
          storageDirPath,
          `${path.basename(filename, path.extname(filename))}.v2`,
        ),
      migrations: workerOptions.migrations,
      cacheExcludeKeyPrefixes: workerOptions.cacheExcludeKeyPrefixes,
      workerFactory: workerOptions.workerFactory,
      maxRestartAttempts: workerOptions.maxRestartAttempts,
      handshakeTimeoutMs: workerOptions.handshakeTimeoutMs,
    });
    const workerHost = this.workerHost;
    this.readyPromise = workerHost.start().then(
      (data) => {
        this.data = data;
        this.readinessState = { status: 'ready' };
        this.reportMigrationReceipts(
          workerHost,
          workerOptions.onMigrationReceipt,
        );
      },
      (error: unknown) => {
        if (error instanceof StateStorageRecoveryRequiredError) {
          this.readinessState = {
            status: 'recovery-required',
            reason: error.reason,
          };
        }
        throw error;
      },
    );
    // degradation-audit: reported - this subscription exists ONLY to stop an
    // unhandled-rejection warning on a promise nobody has awaited yet. The
    // rejection itself is kept: `readinessState` records it above and every
    // `whenReady()` / `assertReady()` caller still receives the same error.
    void this.readyPromise.catch(() => undefined);
  }

  get<T>(key: string, defaultValue?: T): T | undefined {
    this.assertReady();
    const value = this.data[key];
    return value !== undefined ? (value as T) : defaultValue;
  }

  async getAsync<T>(
    key: string,
    defaultValue?: T,
    options?: StateStorageGetOptions,
  ): Promise<T | undefined> {
    await this.whenReady();
    if (this.workerHost) {
      const value = await this.workerHost.get(key, options);
      return value !== undefined ? (value as T) : defaultValue;
    }
    const value = this.get<T>(key);
    if (value === undefined) return defaultValue;
    return options?.projection
      ? omitJsonPaths(value, options.projection.omit)
      : value;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.assertReady();
    if (this.workerHost) {
      const workerHost = this.workerHost;
      if (value !== undefined) {
        assertJsonCompatibleValue(value);
      }
      try {
        if (Array.isArray(value)) {
          await workerHost.replaceJsonSequence(
            key,
            (async function* () {
              for (const item of value) {
                yield {
                  items: [item],
                } as StateStorageSequenceWriteChunk<unknown>;
              }
            })(),
          );
          workerHost.setCacheValue(key, value as JsonValue);
          return;
        }
        await workerHost.update(key, value as JsonValue | undefined);
      } finally {
        this.data = workerHost.getCache();
      }
      return;
    }

    if (value === undefined) delete this.data[key];
    else this.data[key] = value as JsonValue;
    this.changedKeys.add(key);
    if (!this.pendingWrite) {
      this.pendingWrite = new Promise<void>((resolve, reject) => {
        this.resolvePendingWrite = resolve;
        this.rejectPendingWrite = reject;
      });
    }
    if (this.writeTimer !== null) clearTimeout(this.writeTimer);
    if (this.maxWriteTimer === null) {
      this.maxWriteTimer = setTimeout(() => {
        this.maxWriteTimer = null;
        void this.flush().catch((error: unknown) => {
          // degradation-audit: reported - update callers receive the rejection.
          this.logger?.error('[platform-electron] global state write failed', error instanceof Error ? error : new Error(String(error)));
        });
      }, 1_000);
    }
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      void this.flush().catch(() => {
        // degradation-audit: reported - flush() already rejected every
        // caller awaiting this write with the failure.
      });
    }, 300);
    await this.pendingWrite;
  }

  updateSync(key: string, value: unknown): void {
    if (this.workerHost) {
      throw new Error(
        'updateSync is unavailable for worker-backed workspace storage',
      );
    }
    if (value === undefined) delete this.data[key];
    else this.data[key] = value as JsonValue;
    if (this.writeTimer !== null) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (this.maxWriteTimer !== null) {
      clearTimeout(this.maxWriteTimer);
      this.maxWriteTimer = null;
    }
    const resolve = this.resolvePendingWrite;
    const reject = this.rejectPendingWrite;
    const changedCount = this.changedKeys.size + (this.changedKeys.has(key) ? 0 : 1);
    this.pendingWrite = null;
    this.resolvePendingWrite = null;
    this.rejectPendingWrite = null;
    this.changedKeys.clear();
    try {
      this.persistSync(changedCount);
      resolve?.();
    } catch (error: unknown) {
      reject?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  keys(): readonly string[] {
    this.assertReady();
    return Object.keys(this.data);
  }

  getReadinessState(): StateStorageReadinessState {
    const reason = this.workerHost?.getRecoveryReason();
    return reason
      ? { status: 'recovery-required', reason }
      : this.readinessState;
  }

  async whenReady(): Promise<void> {
    await this.readyPromise;
  }

  async *readJsonSequence<T>(
    key: string,
    options?: StateStorageSequenceReadOptions,
  ): AsyncIterable<StateStorageSequencePage<T>> {
    await this.whenReady();
    if (this.workerHost) {
      yield* this.workerHost.readJsonSequence<T>(key, options);
      return;
    }
    const value = this.data[key];
    if (value !== undefined && !Array.isArray(value)) {
      throw new Error(`State value "${key}" is not a JSON sequence`);
    }
    const items = (value ?? []) as T[];
    yield {
      items,
      nextCursor: null,
      done: true,
      approximateBytes: Buffer.byteLength(JSON.stringify(items)),
    };
  }

  async replaceJsonSequence<T>(
    key: string,
    chunks: AsyncIterable<StateStorageSequenceWriteChunk<T>>,
  ): Promise<void> {
    await this.whenReady();
    if (this.workerHost) {
      const workerHost = this.workerHost;
      try {
        await workerHost.replaceJsonSequence(key, chunks);
      } finally {
        this.data = workerHost.getCache();
      }
      return;
    }
    const items: T[] = [];
    for await (const chunk of chunks) items.push(...chunk.items);
    await this.update(key, items);
  }

  async splitArrayValue(
    plan: StateStorageArraySplitPlan,
  ): Promise<StateStorageMigrationReceipt> {
    await this.whenReady();
    if (!this.workerHost) {
      throw new Error('Array splitting requires worker-backed state storage');
    }
    const workerHost = this.workerHost;
    try {
      return await workerHost.splitArrayValue(plan);
    } finally {
      this.data = workerHost.getCache();
    }
  }

  async dispose(): Promise<void> {
    await this.flush();
    await this.workerHost?.dispose();
  }

  /** Commit the latest global snapshot, including changes made during a write. */
  async flush(): Promise<void> {
    if (this.workerHost) return;
    if (this.maxWriteTimer !== null) {
      clearTimeout(this.maxWriteTimer);
      this.maxWriteTimer = null;
    }
    if (this.writeTimer !== null) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (this.changedKeys.size === 0) {
      await this.writePromise.catch(() => {
        // degradation-audit: reported - the failed write rejected its update callers.
      });
      return;
    }
    const pending = this.pendingWrite;
    const resolve = this.resolvePendingWrite;
    const reject = this.rejectPendingWrite;
    this.pendingWrite = null;
    this.resolvePendingWrite = null;
    this.rejectPendingWrite = null;
    const changedCount = this.changedKeys.size;
    this.changedKeys.clear();
    this.writePromise = this.writePromise
      .catch(() => {
        // degradation-audit: reported - the previous write's failure was
        // delivered to its own callers; this write must still run after it.
      })
      .then(() => this.persist(changedCount));
    try {
      await this.writePromise;
      resolve?.();
    } catch (error: unknown) {
      reject?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    await pending;
    if (this.changedKeys.size > 0) await this.flush();
  }

  private assertReady(): void {
    const readiness = this.getReadinessState();
    if (readiness.status === 'ready') return;
    if (readiness.status === 'recovery-required') {
      throw new StateStorageRecoveryRequiredError(readiness.reason);
    }
    throw new StateStorageNotReadyError();
  }

  private reportMigrationReceipts(
    workerHost: ElectronStateStorageWorkerHost,
    onMigrationReceipt: ElectronStateStorageWorkerOptions['onMigrationReceipt'],
  ): void {
    if (!onMigrationReceipt) return;
    for (const receipt of workerHost.getMigrationReceipts()) {
      try {
        onMigrationReceipt(receipt);
      } catch {
        // degradation-audit: optional-capability - the receipt callback is an
        // observability hook. The migration already committed and readiness is
        // already published, so a throwing reporter must not fail the store.
      }
    }
  }

  private loadSync(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      this.data =
        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, JsonValue>)
          : {};
    } catch {
      this.data = {};
    }
  }

  private async persist(changedCount: number): Promise<void> {
    const generation = this.commitGeneration;
    const started = performance.now();
    const serialized = JSON.stringify(this.data);
    const bytes = Buffer.byteLength(serialized);
    const dir = path.dirname(this.filePath);
    await fsPromises.mkdir(dir, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await this.writeFile(tmpPath, serialized);
    if (generation !== this.commitGeneration) {
      await fsPromises.rm(tmpPath, { force: true });
      return;
    }
    // The final commit is synchronous so updateSync cannot interleave with it.
    fs.renameSync(tmpPath, this.filePath);
    this.commitGeneration++;
    const ms = performance.now() - started;
    if (ms > 50) this.logger?.warn('[platform-electron] slow global state write', {
      keysChanged: changedCount, bytes, ms,
    });
  }

  private persistSync(changedCount: number): void {
    const started = performance.now();
    const serialized = JSON.stringify(this.data);
    const bytes = Buffer.byteLength(serialized);
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.filePath}.sync-tmp`;
    fs.writeFileSync(tmpPath, serialized, 'utf8');
    fs.renameSync(tmpPath, this.filePath);
    this.commitGeneration++;
    const ms = performance.now() - started;
    if (ms > 50) {
      this.logger?.warn('[platform-electron] slow global state write', {
        keysChanged: changedCount,
        bytes,
        ms,
      });
    }
  }
}
