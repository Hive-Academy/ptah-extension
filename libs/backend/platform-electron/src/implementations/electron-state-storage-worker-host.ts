import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import {
  StateStorageRecoveryRequiredError,
  type StateStorageArraySplitPlan,
  type StateStorageMigrationReceipt,
  type StateStorageSequencePage,
  type StateStorageSequenceWriteChunk,
} from '@ptah-extension/platform-core';
import {
  ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
  ElectronStateWorkerProtocolError,
  MAX_PROTOCOL_DEPTH,
  assertElectronStateWorkerPayloadWithinBudget,
  assertJsonCompatibleValue,
  canSendDirectUpdate,
  generateSnapshotOperations,
  generateUtf8StringSlices,
  isPlainObject,
  parseElectronStateWorkerRequest,
  parseElectronStateWorkerResponse,
  setSnapshotPath,
  type ElectronStateWorkerRequest,
  type ElectronStateWorkerResponse,
  type JsonValue,
  type SnapshotOperation,
} from './electron-state-storage-worker-protocol';

export interface ElectronStateWorkerLike {
  postMessage(value: unknown, transferList?: readonly ArrayBuffer[]): void;
  on(event: 'message', listener: (value: unknown) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  unref?(): void;
  terminate(): Promise<number>;
}

export type ElectronStateWorkerFactory = (
  workerPath: string,
) => ElectronStateWorkerLike;

export interface ElectronStateWorkerHostOptions {
  readonly workerPath: string;
  readonly legacyFilePath: string;
  readonly v2RootPath: string;
  readonly migrations?: readonly StateStorageArraySplitPlan[];
  readonly cacheExcludeKeyPrefixes?: readonly string[];
  readonly workerFactory?: ElectronStateWorkerFactory;
  readonly maxRestartAttempts?: number;
  /**
   * Upper bound on the one-shot `initialize` handshake, which includes the
   * v1 -> v2 migration the worker performs before it answers `ready`.
   * Deliberately generous: this is a liveness backstop against a reply that
   * never arrives, NOT a performance budget.
   */
  readonly handshakeTimeoutMs?: number;
}

/**
 * 120 s. Long enough that a large but healthy profile migration finishes well
 * inside it, short enough that a lost reply surfaces as an error screen rather
 * than an app parked forever on the preparing shell.
 */
export const DEFAULT_STATE_WORKER_HANDSHAKE_TIMEOUT_MS = 120_000;

interface PendingRequest {
  readonly resolve: (response: ElectronStateWorkerResponse) => void;
  readonly reject: (error: Error) => void;
}

interface StringAssembly {
  readonly bytes: Uint8Array;
  receivedBytes: number;
}

interface ExtractedLargeString {
  readonly path: (string | number)[];
  readonly value: string;
  readonly totalBytes: number;
}

class ElectronStateWorkerCrashedError extends Error {
  override readonly name = 'ElectronStateWorkerCrashedError';
}

type HostWorkerRequest = ElectronStateWorkerRequest extends infer Request
  ? Request extends { operationId: number }
    ? Omit<Request, 'operationId'>
    : never
  : never;

const LARGE_STRING_BYTES = 32 * 1024;

export function extractLargeStrings(
  value: unknown,
  jsonPath: (string | number)[] = [],
): {
  value: JsonValue;
  strings: ExtractedLargeString[];
} {
  const activePath = new Set<object>();
  const strings: ExtractedLargeString[] = [];
  const visit = (
    current: unknown,
    currentPath: (string | number)[],
    depth: number,
  ): JsonValue => {
    if (depth > MAX_PROTOCOL_DEPTH) {
      throw new ElectronStateWorkerProtocolError(
        'MAX_DEPTH_EXCEEDED',
        `Worker message exceeds nesting depth ${MAX_PROTOCOL_DEPTH}`,
      );
    }
    if (current === null || typeof current === 'boolean') {
      return current as JsonValue;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        throw new ElectronStateWorkerProtocolError(
          'UNSUPPORTED_VALUE',
          'Worker message contains a non-finite number',
        );
      }
      return current;
    }
    if (typeof current === 'string') {
      const totalBytes = Buffer.byteLength(current, 'utf8');
      if (totalBytes > LARGE_STRING_BYTES) {
        strings.push({ path: currentPath, value: current, totalBytes });
        return '';
      }
      return current;
    }
    if (typeof current === 'object') {
      if (activePath.has(current)) {
        throw new ElectronStateWorkerProtocolError(
          'UNSUPPORTED_VALUE',
          'Worker message contains a cyclic value',
        );
      }
      activePath.add(current);
      try {
        if (Array.isArray(current)) {
          return current.map((item, index) =>
            visit(item, [...currentPath, index], depth + 1),
          );
        }
        if (!isPlainObject(current)) {
          throw new ElectronStateWorkerProtocolError(
            'UNSUPPORTED_VALUE',
            'Worker message contains a non-plain object',
          );
        }
        const result: Record<string, JsonValue> = {};
        for (const [key, nested] of Object.entries(current)) {
          result[key] = visit(nested, [...currentPath, key], depth + 1);
        }
        return result;
      } finally {
        activePath.delete(current);
      }
    }
    throw new ElectronStateWorkerProtocolError(
      'UNSUPPORTED_VALUE',
      'Worker message contains a non-cloneable JSON value',
    );
  };
  return { value: visit(value, jsonPath, 0), strings };
}

export class ElectronStateStorageWorkerHost {
  private readonly workerFactory: ElectronStateWorkerFactory;
  private readonly maxRestartAttempts: number;
  private readonly handshakeTimeoutMs: number;
  private worker: ElectronStateWorkerLike | null = null;
  private operationId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private requestChain: Promise<unknown> = Promise.resolve();
  private cache: Record<string, JsonValue> = {};
  private disposed = false;

  constructor(private readonly options: ElectronStateWorkerHostOptions) {
    this.workerFactory =
      options.workerFactory ??
      ((workerPath) => new Worker(workerPath) as ElectronStateWorkerLike);
    this.maxRestartAttempts = options.maxRestartAttempts ?? 1;
    this.handshakeTimeoutMs =
      options.handshakeTimeoutMs ?? DEFAULT_STATE_WORKER_HANDSHAKE_TIMEOUT_MS;
  }

  async start(): Promise<Record<string, JsonValue>> {
    return await this.withRestart(async () => {
      await this.ensureInitialized();
      return this.cache;
    });
  }

  getCache(): Record<string, JsonValue> {
    return this.cache;
  }

  async get(key: string): Promise<JsonValue | undefined> {
    return await this.withRestart(async () => {
      await this.ensureInitialized();
      const response = await this.send({ type: 'get', key });
      if (response.type !== 'value') this.throwFailure(response);
      return response.found ? response.value : undefined;
    });
  }

  async update(key: string, value: JsonValue | undefined): Promise<void> {
    if (value !== undefined) {
      assertJsonCompatibleValue(value);
    }
    await this.withRestart(async () => {
      await this.ensureInitialized();
      if (value === undefined) {
        const response = await this.send({ type: 'delete', key });
        this.requireSuccess(response);
        return;
      }
      if (canSendDirectUpdate(key, value)) {
        const response = await this.send({ type: 'update', key, value });
        this.requireSuccess(response);
        return;
      }
      await this.writeLargeScalar(key, value);
    });
    if (this.shouldCacheKey(key)) {
      if (value === undefined) delete this.cache[key];
      else this.cache[key] = value;
    } else {
      delete this.cache[key];
    }
  }

  setCacheValue(key: string, value: JsonValue): void {
    if (this.shouldCacheKey(key)) this.cache[key] = value;
  }

  private shouldCacheKey(key: string): boolean {
    return !(this.options.cacheExcludeKeyPrefixes ?? []).some((prefix) =>
      key.startsWith(prefix),
    );
  }

  private async writeLargeScalar(
    key: string,
    value: JsonValue,
  ): Promise<void> {
    assertJsonCompatibleValue(value);
    const writeId = randomUUID();
    this.requireSuccess(
      await this.send({
        type: 'begin-scalar-write',
        writeId,
        key,
      }),
    );
    try {
      let page: SnapshotOperation[] = [];
      let pageEstimatedBytes = 0;
      let transferList: ArrayBuffer[] = [];

      for (const operation of generateSnapshotOperations({ [key]: value })) {
        const opBytes =
          operation.kind === 'string-slice'
            ? operation.bytes.byteLength + 128
            : operation.kind === 'value' && typeof operation.value === 'string'
              ? operation.value.length * 2 + 128
              : 128;

        if (
          page.length > 0 &&
          (page.length >= 256 || pageEstimatedBytes + opBytes > 64 * 1024)
        ) {
          this.requireSuccess(
            await this.send(
              {
                type: 'append-scalar-write-page',
                writeId,
                operations: page,
              },
              transferList,
            ),
          );
          page = [];
          pageEstimatedBytes = 0;
          transferList = [];
        }

        page.push(operation);
        pageEstimatedBytes += opBytes;
        if (operation.kind === 'string-slice') {
          transferList.push(operation.bytes.buffer);
        }
      }

      if (page.length > 0) {
        this.requireSuccess(
          await this.send(
            {
              type: 'append-scalar-write-page',
              writeId,
              operations: page,
            },
            transferList,
          ),
        );
      }

      this.requireSuccess(
        await this.send({
          type: 'commit-scalar-write',
          writeId,
        }),
      );
    } catch (error: unknown) {
      await this.send({
        type: 'abort-scalar-write',
        writeId,
      }).catch(() => undefined);
      throw error;
    }
  }

  async splitArrayValue(
    plan: StateStorageArraySplitPlan,
  ): Promise<StateStorageMigrationReceipt> {
    const receipt = await this.withRestart(async () => {
      await this.ensureInitialized();
      const response = await this.send({ type: 'split-array-value', plan });
      if (response.type !== 'migration-receipt') this.throwFailure(response);
      return response.receipt;
    });
    await this.withRestart(async () => {
      await this.ensureInitialized();
      await this.refreshSnapshot();
    });
    return receipt;
  }

  async *readJsonSequence<T>(
    key: string,
    maxBytes = ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
    initialCursor?: string,
  ): AsyncIterable<StateStorageSequencePage<T>> {
    let cursor = initialCursor;
    do {
      const page = await this.withRestart(async () => {
        await this.ensureInitialized();
        const response = await this.send({
          type: 'read-json-sequence',
          key,
          ...(cursor ? { cursor } : {}),
          maxBytes,
        });
        if (response.type !== 'json-sequence-page') this.throwFailure(response);
        return response;
      });
      yield page as unknown as StateStorageSequencePage<T>;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  async replaceJsonSequence<T>(
    key: string,
    chunks: AsyncIterable<StateStorageSequenceWriteChunk<T>>,
  ): Promise<void> {
    const scheduled = this.requestChain.then(
      () => this.executeReplaceJsonSequence(key, chunks),
      () => this.executeReplaceJsonSequence(key, chunks),
    );
    this.requestChain = scheduled.then(
      () => undefined,
      () => undefined,
    );
    await scheduled;
  }

  private async executeReplaceJsonSequence<T>(
    key: string,
    chunks: AsyncIterable<StateStorageSequenceWriteChunk<T>>,
  ): Promise<void> {
    await this.ensureInitialized();
    const sequenceId = randomUUID();
    this.requireSuccess(
      await this.send({ type: 'begin-json-sequence-write', sequenceId, key }),
    );
    let itemIndex = 0;
    try {
      for await (const chunk of chunks) {
        for (const rawItem of chunk.items) {
          const item = rawItem as JsonValue;
          const prepared = extractLargeStrings(item);
          const currentItemIndex = itemIndex++;
          this.requireSuccess(
            await this.send({
              type: 'append-json-sequence-items',
              sequenceId,
              items: [prepared.value],
            }),
          );
          for (const entry of prepared.strings) {
            for (const slice of generateUtf8StringSlices(
              entry.value,
              LARGE_STRING_BYTES,
            )) {
              this.requireSuccess(
                await this.send(
                  {
                    type: 'append-json-string-slice',
                    sequenceId,
                    itemIndex: currentItemIndex,
                    path: entry.path,
                    byteOffset: slice.byteOffset,
                    totalBytes: entry.totalBytes,
                    bytes: slice.bytes,
                  },
                  [slice.bytes.buffer],
                ),
              );
            }
          }
        }
      }
      this.requireSuccess(
        await this.send({ type: 'commit-json-sequence-write', sequenceId }),
      );
      delete this.cache[key];
    } catch (error: unknown) {
      await this.send({
        type: 'abort-json-sequence-write',
        sequenceId,
      }).catch(() => undefined);
      throw error;
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const worker = this.worker;
    this.worker = null;
    const error = new Error('State storage worker host was disposed');
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    if (worker) await worker.terminate();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.worker) return;
    if (this.disposed) throw new Error('State storage worker host is disposed');
    const worker = this.workerFactory(this.options.workerPath);
    this.worker = worker;
    worker.unref?.();
    worker.on('message', (value) => this.onMessage(worker, value));
    worker.on('error', (error) => this.onWorkerFailure(worker, error));
    worker.on('exit', (code) => {
      if (!this.disposed) {
        this.onWorkerFailure(
          worker,
          new Error(`State storage worker exited with code ${code}`),
        );
      }
    });
    // Bounded: `initialize` plus the first snapshot read IS the boot's
    // "first ready" gate (`ElectronStateStorage.whenReady`), and every reply
    // that settles it comes from a thread we do not control. Unbounded, a
    // single lost reply parks the whole app with no log line and no error.
    await this.withHandshakeBudget(worker, async () => {
      const response = await this.send({
        type: 'initialize',
        legacyFilePath: this.options.legacyFilePath,
        v2RootPath: this.options.v2RootPath,
        migrations: [...(this.options.migrations ?? [])],
      });
      if (response.type !== 'ready') this.throwFailure(response);
      await this.refreshSnapshot();
    });
  }

  /**
   * Race `work` against the handshake budget.
   *
   * On expiry the worker is failed exactly as a crash would fail it (pending
   * requests rejected, handle terminated) and a TYPED
   * `StateStorageRecoveryRequiredError('worker-unresponsive')` is thrown.
   * That type is deliberate on both counts: it is not an
   * `ElectronStateWorkerCrashedError`, so `withRestart` does NOT retry a worker
   * that has already proven unresponsive, and it is the one error shape
   * `ElectronStateStorage` maps to `readinessState: 'recovery-required'` and
   * `main.ts` renders as a recovery screen. The app fails loudly instead of
   * sitting on the preparing shell.
   */
  private async withHandshakeBudget<T>(
    worker: ElectronStateWorkerLike,
    work: () => Promise<T>,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        this.onWorkerFailure(
          worker,
          new Error(
            `State storage worker did not become ready within ${this.handshakeTimeoutMs}ms`,
          ),
        );
        reject(new StateStorageRecoveryRequiredError('worker-unresponsive'));
      }, this.handshakeTimeoutMs);
      // A liveness backstop must never be the reason the process stays alive.
      timer.unref?.();
    });
    try {
      // `Promise.race` attaches handlers to BOTH, so the crash rejection that
      // `onWorkerFailure` induces above is observed and never surfaces as an
      // unhandled rejection.
      return await Promise.race([work(), expiry]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async refreshSnapshot(): Promise<void> {
    const next: Record<string, JsonValue> = {};
    const strings = new Map<string, StringAssembly>();
    let cursor: string | undefined;
    do {
      const response = await this.send({
        type: 'read-snapshot-page',
        ...(cursor ? { cursor } : {}),
        maxBytes: ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
        ...(this.options.cacheExcludeKeyPrefixes?.length
          ? {
              excludeKeyPrefixes: [
                ...this.options.cacheExcludeKeyPrefixes,
              ],
            }
          : {}),
      });
      if (response.type !== 'snapshot-page') this.throwFailure(response);
      for (const operation of response.operations) {
        const pathKey = JSON.stringify(operation.path);
        switch (operation.kind) {
          case 'object':
            setSnapshotPath(next, operation.path, {});
            break;
          case 'array':
            setSnapshotPath(next, operation.path, []);
            break;
          case 'value':
            setSnapshotPath(next, operation.path, operation.value);
            break;
          case 'string-start':
            strings.set(pathKey, {
              bytes: new Uint8Array(operation.totalBytes),
              receivedBytes: 0,
            });
            break;
          case 'string-slice': {
            const assembly = strings.get(pathKey);
            if (!assembly || assembly.receivedBytes !== operation.byteOffset) {
              throw new Error('Snapshot string slices are out of order');
            }
            assembly.bytes.set(operation.bytes, operation.byteOffset);
            assembly.receivedBytes += operation.bytes.byteLength;
            if (assembly.receivedBytes === assembly.bytes.byteLength) {
              setSnapshotPath(
                next,
                operation.path,
                new TextDecoder('utf-8', { fatal: true }).decode(assembly.bytes),
              );
              strings.delete(pathKey);
            }
            break;
          }
        }
      }
      cursor = response.nextCursor ?? undefined;
    } while (cursor);
    if (strings.size > 0)
      throw new Error('Snapshot ended with incomplete strings');
    this.cache = next;
  }

  private async send(
    request: HostWorkerRequest,
    transferList?: readonly ArrayBuffer[],
  ): Promise<ElectronStateWorkerResponse> {
    const worker = this.worker;
    if (!worker) throw new Error('State storage worker is not running');
    const operationId = ++this.operationId;
    const message = parseElectronStateWorkerRequest({
      ...request,
      operationId,
    });
    assertElectronStateWorkerPayloadWithinBudget(message);
    return await new Promise<ElectronStateWorkerResponse>((resolve, reject) => {
      this.pending.set(operationId, { resolve, reject });
      try {
        worker.postMessage(message, transferList);
      } catch (error: unknown) {
        this.pending.delete(operationId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private onMessage(source: ElectronStateWorkerLike, value: unknown): void {
    if (this.worker !== source) return;
    let response: ElectronStateWorkerResponse;
    try {
      response = parseElectronStateWorkerResponse(value);
    } catch (error: unknown) {
      this.onWorkerFailure(
        source,
        error instanceof Error ? error : new Error(String(error)),
      );
      return;
    }
    const pending = this.pending.get(response.operationId);
    if (!pending) {
      this.onWorkerFailure(
        source,
        new Error('Worker returned an unknown operation id'),
      );
      return;
    }
    this.pending.delete(response.operationId);
    pending.resolve(response);
  }

  private onWorkerFailure(
    failedWorker: ElectronStateWorkerLike,
    error: Error,
  ): void {
    if (this.worker !== failedWorker) return;
    this.worker = null;
    const crashError = new ElectronStateWorkerCrashedError(error.message);
    for (const pending of this.pending.values()) pending.reject(crashError);
    this.pending.clear();
    void failedWorker.terminate().catch(() => undefined);
  }

  private requireSuccess(response: ElectronStateWorkerResponse): void {
    if (response.type !== 'success') this.throwFailure(response);
  }

  private throwFailure(response: ElectronStateWorkerResponse): never {
    if (
      response.type === 'failure' &&
      response.code === 'recovery-required' &&
      response.recoveryReason
    ) {
      throw new StateStorageRecoveryRequiredError(response.recoveryReason);
    }
    const code = response.type === 'failure' ? response.code : response.type;
    throw new Error(`State storage worker operation failed: ${code}`);
  }

  private async withRestart<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        const scheduled = this.requestChain.then(operation, operation);
        this.requestChain = scheduled.then(
          () => undefined,
          () => undefined,
        );
        return await scheduled;
      } catch (error: unknown) {
        if (
          !(error instanceof ElectronStateWorkerCrashedError) ||
          attempt >= this.maxRestartAttempts ||
          this.disposed
        ) {
          throw error;
        }
        attempt++;
        this.worker = null;
      }
    }
  }
}
