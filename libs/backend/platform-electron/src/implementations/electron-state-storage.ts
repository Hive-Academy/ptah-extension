import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import {
  StateStorageNotReadyError,
  StateStorageRecoveryRequiredError,
  type IAsyncStateStorage,
  type IStateStorageMaintenance,
  type IStateStorageReadiness,
  type StateStorageArraySplitPlan,
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
  private readonly workerHost: ElectronStateStorageWorkerHost | null;
  private readinessState: StateStorageReadinessState;
  private readonly readyPromise: Promise<void>;

  constructor(
    storageDirPath: string,
    filename: string,
    workerOptions?: ElectronStateStorageWorkerOptions,
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
    this.readyPromise = this.workerHost.start().then(
      (data) => {
        this.data = data;
        this.readinessState = { status: 'ready' };
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

  async getAsync<T>(key: string, defaultValue?: T): Promise<T | undefined> {
    await this.whenReady();
    if (this.workerHost) {
      const value = await this.workerHost.get(key);
      return value !== undefined ? (value as T) : defaultValue;
    }
    return this.get(key, defaultValue);
  }

  async update(key: string, value: unknown): Promise<void> {
    this.assertReady();
    if (this.workerHost) {
      if (value !== undefined) {
        assertJsonCompatibleValue(value);
      }
      if (Array.isArray(value)) {
        await this.workerHost.replaceJsonSequence(
          key,
          (async function* () {
            for (const item of value) {
              yield {
                items: [item],
              } as StateStorageSequenceWriteChunk<unknown>;
            }
          })(),
        );
        this.workerHost.setCacheValue(key, value as JsonValue);
        this.data = this.workerHost.getCache();
        return;
      }
      await this.workerHost.update(key, value as JsonValue | undefined);
      this.data = this.workerHost.getCache();
      return;
    }

    if (value === undefined) delete this.data[key];
    else this.data[key] = value as JsonValue;
    this.writePromise = this.writePromise.then(
      () => this.persist(),
      () => this.persist(),
    );
    await this.writePromise;
  }

  updateSync(key: string, value: unknown): void {
    if (this.workerHost) {
      throw new Error(
        'updateSync is unavailable for worker-backed workspace storage',
      );
    }
    if (value === undefined) delete this.data[key];
    else this.data[key] = value as JsonValue;
    this.persistSync();
    this.writePromise = Promise.resolve();
  }

  keys(): readonly string[] {
    this.assertReady();
    return Object.keys(this.data);
  }

  getReadinessState(): StateStorageReadinessState {
    return this.readinessState;
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
      yield* this.workerHost.readJsonSequence<T>(
        key,
        options?.maxBytes,
        options?.cursor,
      );
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
      await this.workerHost.replaceJsonSequence(key, chunks);
      this.data = this.workerHost.getCache();
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
    const receipt = await this.workerHost.splitArrayValue(plan);
    this.data = this.workerHost.getCache();
    return receipt;
  }

  async dispose(): Promise<void> {
    await this.workerHost?.dispose();
  }

  private assertReady(): void {
    if (this.readinessState.status === 'ready') return;
    if (this.readinessState.status === 'recovery-required') {
      throw new StateStorageRecoveryRequiredError(this.readinessState.reason);
    }
    throw new StateStorageNotReadyError();
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

  private async persist(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fsPromises.mkdir(dir, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await fsPromises.writeFile(
      tmpPath,
      JSON.stringify(this.data, null, 2),
      'utf8',
    );
    await fsPromises.rename(tmpPath, this.filePath);
  }

  private persistSync(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.filePath}.sync-tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.filePath);
  }
}
