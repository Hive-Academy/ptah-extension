import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import {
  StateStorageCursorStaleError,
  StateStorageRecoveryRequiredError,
  StateStorageValueTooLargeError,
  type StateStorageArraySplitPlan,
  type StateStorageGetOptions,
  type StateStorageMigrationReceipt,
  type StateStorageRecoveryReason,
  type StateStorageSequencePage,
  type StateStorageSequenceReadOptions,
  type StateStorageSequenceWriteChunk,
  type StateStorageValueProjection,
} from '@ptah-extension/platform-core';
import {
  ELECTRON_STATE_SEQUENCE_ITEM_ROOT,
  ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
  ElectronStateWorkerProtocolError,
  assertElectronStateWorkerPayloadWithinBudget,
  assertJsonCompatibleValue,
  canSendDirectUpdate,
  generateSnapshotOperations,
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

type FailureResponse = Extract<
  ElectronStateWorkerResponse,
  { type: 'failure' }
>;

class ElectronStateWorkerCrashedError extends Error {
  override readonly name = 'ElectronStateWorkerCrashedError';
}

type HostWorkerRequest = ElectronStateWorkerRequest extends infer Request
  ? Request extends { operationId: number }
    ? Omit<Request, 'operationId'>
    : never
  : never;

const MAX_OPERATIONS_PER_PAGE = 512;
const UNCERTAIN_COMMIT_CODES: ReadonlySet<string> = new Set([
  'commit-failed',
  'commit-uncertain',
  'io-failed',
]);
const UNCERTAIN_DURABLE_STATE_REASON: StateStorageRecoveryReason =
  'current-pointer-invalid';

function assembleOperations(
  target: Record<string, JsonValue>,
  strings: Map<string, StringAssembly>,
  operations: readonly SnapshotOperation[],
): void {
  for (const operation of operations) {
    const pathKey = JSON.stringify(operation.path);
    switch (operation.kind) {
      case 'object':
        setSnapshotPath(target, operation.path, {});
        break;
      case 'array':
        setSnapshotPath(target, operation.path, []);
        break;
      case 'value':
        setSnapshotPath(target, operation.path, operation.value);
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
            target,
            operation.path,
            new TextDecoder('utf-8', { fatal: true }).decode(assembly.bytes),
          );
          strings.delete(pathKey);
        }
        break;
      }
    }
  }
}

function measure(input: unknown): number {
  return assertElectronStateWorkerPayloadWithinBudget(
    input,
    Number.MAX_SAFE_INTEGER,
  );
}

function measureWithinBudget(input: unknown): number | null {
  try {
    return assertElectronStateWorkerPayloadWithinBudget(input);
  } catch (error: unknown) {
    if (
      error instanceof ElectronStateWorkerProtocolError &&
      error.code === 'PAYLOAD_TOO_LARGE'
    ) {
      return null;
    }
    throw error;
  }
}

function sliceBuffers(operations: readonly SnapshotOperation[]): ArrayBuffer[] {
  return operations.flatMap((operation) =>
    operation.kind === 'string-slice'
      ? [operation.bytes.buffer as ArrayBuffer]
      : [],
  );
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
  private migrationReceipts: readonly StateStorageMigrationReceipt[] = [];
  private recoveryReason: StateStorageRecoveryReason | null = null;
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

  getMigrationReceipts(): readonly StateStorageMigrationReceipt[] {
    return this.migrationReceipts;
  }

  getRecoveryReason(): StateStorageRecoveryReason | null {
    return this.recoveryReason;
  }

  async get(
    key: string,
    options?: StateStorageGetOptions,
  ): Promise<JsonValue | undefined> {
    return await this.withRestart(async () => {
      await this.ensureInitialized();
      if (!options?.projection && this.shouldCacheKey(key)) {
        return this.cache[key];
      }
      return await this.readScalar(key, options?.projection, false);
    });
  }

  async update(key: string, value: JsonValue | undefined): Promise<void> {
    if (value !== undefined) {
      assertJsonCompatibleValue(value);
    }
    await this.withRestart(async () => {
      await this.ensureInitialized();
      if (value === undefined) {
        await this.requireCommitted(await this.send({ type: 'delete', key }), [
          key,
        ]);
        return;
      }
      if (canSendDirectUpdate(key, value)) {
        await this.requireCommitted(
          await this.send({ type: 'update', key, value }),
          [key],
        );
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

  private async readScalar(
    key: string,
    projection: StateStorageValueProjection | undefined,
    restarted: boolean,
  ): Promise<JsonValue | undefined> {
    const projectionField = projection
      ? { projection: { omit: projection.omit.map((entry) => [...entry]) } }
      : {};
    const first = await this.send({ type: 'get', key, ...projectionField });
    if (first.type === 'value') return first.found ? first.value : undefined;
    if (first.type !== 'value-paged') this.throwFailure(first, key);
    const root: Record<string, JsonValue> = {};
    const strings = new Map<string, StringAssembly>();
    assembleOperations(root, strings, first.operations);
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await this.send({
        type: 'read-scalar-page',
        key,
        cursor,
        maxBytes: ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
        ...projectionField,
      });
      if (
        !restarted &&
        page.type === 'failure' &&
        page.code === 'cursor-stale'
      ) {
        return await this.readScalar(key, projection, true);
      }
      if (page.type !== 'scalar-page') this.throwFailure(page, key);
      assembleOperations(root, strings, page.operations);
      cursor = page.nextCursor;
    }
    if (strings.size > 0) {
      throw new Error('Scalar value ended with incomplete strings');
    }
    return root[key];
  }

  private async writeLargeScalar(key: string, value: JsonValue): Promise<void> {
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
      await this.sendOperationPages(
        generateSnapshotOperations({ [key]: value }),
        (operations) => ({
          type: 'append-scalar-write-page',
          writeId,
          operations,
        }),
      );
      await this.requireCommitted(
        await this.send({
          type: 'commit-scalar-write',
          writeId,
        }),
        [key],
      );
    } catch (error: unknown) {
      // degradation-audit: optional-capability - the abort is best-effort
      // cleanup of a half-staged write; the REAL failure is rethrown on the
      // next line and nothing about it is lost. A worker that cannot even be
      // told to abort has already crashed, and `onWorkerFailure` rejects every
      // pending operation on that path.
      await this.send({
        type: 'abort-scalar-write',
        writeId,
      }).catch(() => undefined);
      throw error;
    }
  }

  private async sendOperationPages(
    operations: Iterable<SnapshotOperation>,
    buildRequest: (operations: SnapshotOperation[]) => HostWorkerRequest,
  ): Promise<void> {
    const baseBytes = measure({
      ...buildRequest([]),
      operationId: Number.MAX_SAFE_INTEGER,
    });
    let page: SnapshotOperation[] = [];
    let usedBytes = baseBytes;
    for (const operation of operations) {
      const operationBytes = measure(operation);
      if (
        page.length > 0 &&
        (page.length >= MAX_OPERATIONS_PER_PAGE ||
          usedBytes + operationBytes > ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES)
      ) {
        this.requireSuccess(
          await this.send(buildRequest(page), sliceBuffers(page)),
        );
        page = [];
        usedBytes = baseBytes;
      }
      page.push(operation);
      usedBytes += operationBytes;
    }
    if (page.length > 0) {
      this.requireSuccess(
        await this.send(buildRequest(page), sliceBuffers(page)),
      );
    }
  }

  async splitArrayValue(
    plan: StateStorageArraySplitPlan,
  ): Promise<StateStorageMigrationReceipt> {
    const receipt = await this.withRestart(async () => {
      await this.ensureInitialized();
      const response = await this.send({ type: 'split-array-value', plan });
      if (response.type !== 'migration-receipt') {
        if (this.isUncertainCommit(response)) {
          await this.refreshAfterUncertainCommit(null);
        }
        this.throwFailure(response);
      }
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
    options: StateStorageSequenceReadOptions = {},
  ): AsyncIterable<StateStorageSequencePage<T>> {
    const maxBytes = Math.min(
      options.maxBytes ?? ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
      ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
    );
    let cursor = options.cursor;
    do {
      const page = await this.withRestart(async () => {
        await this.ensureInitialized();
        const response = await this.send({
          type: 'read-json-sequence',
          key,
          ...(cursor ? { cursor } : {}),
          maxBytes,
          ...(options.maxJsonBytes !== undefined
            ? { maxJsonBytes: options.maxJsonBytes }
            : {}),
          ...(options.jsonEnvelopeBytes !== undefined
            ? { jsonEnvelopeBytes: options.jsonEnvelopeBytes }
            : {}),
          ...(options.maxItemBytes !== undefined
            ? { maxItemBytes: options.maxItemBytes }
            : {}),
        });
        if (response.type !== 'json-sequence-page') {
          this.throwFailure(response, key);
        }
        return response;
      });
      yield {
        items: page.items as unknown as T[],
        nextCursor: page.nextCursor,
        done: page.done,
        approximateBytes: page.approximateBytes,
        ...(page.truncatedItems ? { truncatedItems: page.truncatedItems } : {}),
      };
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
    this.assertUsable();
    await this.ensureInitialized();
    const sequenceId = randomUUID();
    this.requireSuccess(
      await this.send({ type: 'begin-json-sequence-write', sequenceId, key }),
    );
    const cachedItems: JsonValue[] | null = this.shouldCacheKey(key)
      ? []
      : null;
    const batchBaseBytes = measure({
      type: 'append-json-sequence-items',
      operationId: Number.MAX_SAFE_INTEGER,
      sequenceId,
      items: [],
    });
    let itemIndex = 0;
    try {
      for await (const chunk of chunks) {
        let batch: JsonValue[] = [];
        let batchBytes = batchBaseBytes;
        const flush = async (): Promise<void> => {
          if (batch.length === 0) return;
          this.requireSuccess(
            await this.send({
              type: 'append-json-sequence-items',
              sequenceId,
              items: batch,
            }),
          );
          batch = [];
          batchBytes = batchBaseBytes;
        };
        for (const rawItem of chunk.items) {
          const item = rawItem as JsonValue;
          const itemBytes = measureWithinBudget(item);
          if (
            itemBytes !== null &&
            batchBaseBytes + itemBytes <=
              ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES
          ) {
            if (
              batchBytes + itemBytes >
              ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES
            ) {
              await flush();
            }
            batch.push(item);
            batchBytes += itemBytes;
          } else {
            await flush();
            const currentIndex = itemIndex;
            await this.sendOperationPages(
              generateSnapshotOperations({
                [ELECTRON_STATE_SEQUENCE_ITEM_ROOT]: item,
              }),
              (operations) => ({
                type: 'append-json-sequence-item-ops',
                sequenceId,
                itemIndex: currentIndex,
                operations,
              }),
            );
          }
          cachedItems?.push(item);
          itemIndex++;
        }
        await flush();
      }
      await this.requireCommitted(
        await this.send({ type: 'commit-json-sequence-write', sequenceId }),
        [key],
      );
      if (cachedItems) this.cache[key] = cachedItems;
      else delete this.cache[key];
    } catch (error: unknown) {
      // degradation-audit: optional-capability - same contract as the scalar
      // abort above: best-effort cleanup of a half-staged sequence, with the
      // real failure rethrown on the next line.
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
      this.migrationReceipts = response.migrationReceipts;
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

  private async readSnapshot(
    includeKeys?: readonly string[],
  ): Promise<Record<string, JsonValue>> {
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
              excludeKeyPrefixes: [...this.options.cacheExcludeKeyPrefixes],
            }
          : {}),
        ...(includeKeys ? { includeKeys: [...includeKeys] } : {}),
      });
      if (response.type !== 'snapshot-page') this.throwFailure(response);
      assembleOperations(next, strings, response.operations);
      cursor = response.nextCursor ?? undefined;
    } while (cursor);
    if (strings.size > 0) {
      throw new Error('Snapshot ended with incomplete strings');
    }
    return next;
  }

  private async refreshSnapshot(): Promise<void> {
    this.cache = await this.readSnapshot();
  }

  private isUncertainCommit(response: ElectronStateWorkerResponse): boolean {
    return (
      response.type === 'failure' && UNCERTAIN_COMMIT_CODES.has(response.code)
    );
  }

  private async requireCommitted(
    response: ElectronStateWorkerResponse,
    touchedKeys: readonly string[],
  ): Promise<void> {
    if (response.type === 'success') return;
    if (this.isUncertainCommit(response)) {
      await this.refreshAfterUncertainCommit(touchedKeys);
    }
    this.throwFailure(response);
  }

  private async refreshAfterUncertainCommit(
    touchedKeys: readonly string[] | null,
  ): Promise<void> {
    try {
      if (touchedKeys === null) {
        this.cache = {};
        await this.refreshSnapshot();
        return;
      }
      for (const key of touchedKeys) delete this.cache[key];
      const cacheable = touchedKeys.filter((key) => this.shouldCacheKey(key));
      if (cacheable.length === 0) return;
      const refreshed = await this.readSnapshot(cacheable);
      for (const key of cacheable) {
        if (Object.prototype.hasOwnProperty.call(refreshed, key)) {
          this.cache[key] = refreshed[key];
        }
      }
    } catch (error: unknown) {
      this.markRecoveryRequired(
        error instanceof StateStorageRecoveryRequiredError
          ? error.reason
          : UNCERTAIN_DURABLE_STATE_REASON,
      );
    }
  }

  private markRecoveryRequired(reason: StateStorageRecoveryReason): void {
    this.recoveryReason ??= reason;
  }

  private assertUsable(): void {
    if (this.recoveryReason) {
      throw new StateStorageRecoveryRequiredError(this.recoveryReason);
    }
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
      // degradation-audit: reported - the error is not swallowed, it is
      // ROUTED: `onWorkerFailure` wraps it in ElectronStateWorkerCrashedError
      // and rejects every pending operation with it, so each caller sees the
      // failure. The bare `return` only ends this message callback, which has
      // no caller to return a value to.
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
    // degradation-audit: optional-capability - every waiter has already been
    // rejected with the crash error on the line above. Terminating the corpse
    // is housekeeping; a failure to reap it changes nothing a caller observes.
    void failedWorker.terminate().catch(() => undefined);
  }

  private requireSuccess(response: ElectronStateWorkerResponse): void {
    if (response.type !== 'success') this.throwFailure(response);
  }

  private throwFailure(response: ElectronStateWorkerResponse, key = ''): never {
    if (response.type === 'failure') this.throwTypedFailure(response, key);
    throw new Error(`State storage worker operation failed: ${response.type}`);
  }

  private throwTypedFailure(response: FailureResponse, key: string): void {
    if (response.code === 'recovery-required' && response.recoveryReason) {
      this.markRecoveryRequired(response.recoveryReason);
      throw new StateStorageRecoveryRequiredError(response.recoveryReason);
    }
    if (response.code === 'commit-uncertain') {
      this.markRecoveryRequired(UNCERTAIN_DURABLE_STATE_REASON);
      throw new StateStorageRecoveryRequiredError(
        UNCERTAIN_DURABLE_STATE_REASON,
      );
    }
    if (response.code === 'value-too-large') {
      throw new StateStorageValueTooLargeError(key, response.valueBytes ?? 0);
    }
    if (response.code === 'cursor-stale') {
      throw new StateStorageCursorStaleError(key);
    }
    throw new Error(`State storage worker operation failed: ${response.code}`);
  }

  private async withRestart<T>(operation: () => Promise<T>): Promise<T> {
    const guarded = async (): Promise<T> => {
      this.assertUsable();
      return await operation();
    };
    let attempt = 0;
    while (true) {
      try {
        const scheduled = this.requestChain.then(guarded, guarded);
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
