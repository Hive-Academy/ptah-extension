import { createHash } from 'node:crypto';
import {
  StateStorageRecoveryRequiredError,
  jsonUtf8Bytes,
  omitJsonPaths,
  shrinkJsonStringLeaves,
  type StateStorageArraySplitPlan,
  type StateStorageMigrationReceipt,
  type StateStorageValueProjection,
} from '@ptah-extension/platform-core';
import {
  computeElectronStateArraySplit,
  type ElectronStateArraySplitOutcome,
  type ElectronStateSplitValueReader,
} from './electron-state-storage-array-split';
import {
  ElectronStateCommitError,
  ElectronStateCommitStore,
  type ElectronStateCommitChanges,
  type ElectronStateFaultInjector,
} from './electron-state-storage-commit-store';
import type { ElectronStateManifest } from './electron-state-storage-manifest';
import {
  DEFAULT_ELECTRON_STATE_VALUE_CACHE_BYTES,
  ElectronStateValueStore,
} from './electron-state-storage-value-store';
import {
  ELECTRON_STATE_PROJECTED_VALUE_MAX_JSON_BYTES,
  ELECTRON_STATE_SEQUENCE_ITEM_ROOT,
  ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
  ElectronStateWorkerOperationError,
  assertElectronStateWorkerPayloadWithinBudget,
  electronStateWorkerPayloadFits,
  estimateElectronStateJsonBytes,
  generateSnapshotOperations,
  isElectronStateWorkerRecoveryReason,
  setSnapshotPath,
  type ElectronStateWorkerRecoveryReason,
  type ElectronStateWorkerRequest,
  type ElectronStateWorkerResponse,
  type JsonValue,
  type SnapshotOperation,
} from './electron-state-storage-worker-protocol';

type RequestOf<Type extends ElectronStateWorkerRequest['type']> = Extract<
  ElectronStateWorkerRequest,
  { type: Type }
>;

type OperationPageType = 'snapshot-page' | 'value-paged' | 'scalar-page';

interface ItemAssembly {
  readonly index: number;
  readonly snapshot: SnapshotAssembly;
}

interface SequenceWrite {
  readonly key: string;
  readonly items: JsonValue[];
  assembly: ItemAssembly | null;
}

interface Retirement {
  readonly reason?: ElectronStateWorkerRecoveryReason;
}

export interface ElectronStateWorkerRuntimeOptions {
  readonly valueCacheMaxBytes?: number;
}

const MAX_OPERATIONS_PER_PAGE = 512;
const CURSOR_OFFSET_PLACEHOLDER = Number.MAX_SAFE_INTEGER;
const SCALAR_CURSOR_PATTERN = /^g(\d+)\.p(none|[a-f0-9]{16})\.(\d+)$/;
const GENERATION_CURSOR_PATTERN = /^g(\d+)\.(\d+)$/;

class SnapshotAssembly {
  private readonly root: Record<string, JsonValue> = {};
  private readonly strings = new Map<
    string,
    { bytes: Uint8Array; receivedBytes: number }
  >();

  constructor(readonly rootKey: string) {}

  apply(operations: readonly SnapshotOperation[]): void {
    for (const operation of operations) {
      if (operation.path[0] !== this.rootKey) {
        throw new Error('Operation path does not match the write root');
      }
      const pathKey = JSON.stringify(operation.path);
      switch (operation.kind) {
        case 'object':
          setSnapshotPath(this.root, operation.path, {});
          break;
        case 'array':
          setSnapshotPath(this.root, operation.path, []);
          break;
        case 'value':
          setSnapshotPath(this.root, operation.path, operation.value);
          break;
        case 'string-start':
          this.strings.set(pathKey, {
            bytes: new Uint8Array(operation.totalBytes),
            receivedBytes: 0,
          });
          break;
        case 'string-slice': {
          const assembly = this.strings.get(pathKey);
          if (!assembly || assembly.receivedBytes !== operation.byteOffset) {
            throw new Error('String slices are out of order');
          }
          assembly.bytes.set(operation.bytes, operation.byteOffset);
          assembly.receivedBytes += operation.bytes.byteLength;
          if (assembly.receivedBytes === assembly.bytes.byteLength) {
            setSnapshotPath(
              this.root,
              operation.path,
              Buffer.from(assembly.bytes).toString('utf8'),
            );
            this.strings.delete(pathKey);
          }
          break;
        }
      }
    }
  }

  finish(): JsonValue {
    if (this.strings.size > 0) throw new Error('Write has incomplete strings');
    if (!(this.rootKey in this.root)) {
      throw new Error('Write root value was not set');
    }
    return this.root[this.rootKey];
  }
}

function projectionHash(projection?: StateStorageValueProjection): string {
  if (!projection) return 'none';
  return createHash('sha256')
    .update(JSON.stringify(projection.omit))
    .digest('hex')
    .slice(0, 16);
}

function parseCursorNumber(text: string): number | null {
  const value = Number.parseInt(text, 10);
  return Number.isSafeInteger(value) ? value : null;
}

function isFileSystemError(error: unknown): boolean {
  return (
    error instanceof Error &&
    typeof (error as NodeJS.ErrnoException).syscall === 'string'
  );
}

function cursorStale(): ElectronStateWorkerOperationError {
  return new ElectronStateWorkerOperationError('cursor-stale');
}

function measure(input: unknown): number {
  return assertElectronStateWorkerPayloadWithinBudget(
    input,
    Number.MAX_SAFE_INTEGER,
  );
}

class OperationPacker {
  private readonly operations: SnapshotOperation[] = [];
  private usedBytes: number;
  private seen = 0;
  private full = false;

  constructor(
    type: OperationPageType,
    operationId: number,
    cursorPrefix: string,
    private readonly offset: number,
    private readonly maxBytes: number,
  ) {
    this.usedBytes = measure({
      type,
      operationId,
      operations: [],
      nextCursor: `${cursorPrefix}${CURSOR_OFFSET_PLACEHOLDER}`,
      done: false,
      approximateBytes: maxBytes,
    });
  }

  isFull(): boolean {
    return this.full;
  }

  offer(operation: SnapshotOperation): boolean {
    this.seen++;
    if (this.seen <= this.offset) return true;
    const operationBytes = measure(operation);
    if (
      this.operations.length >= MAX_OPERATIONS_PER_PAGE ||
      this.usedBytes + operationBytes > this.maxBytes
    ) {
      if (this.operations.length === 0) {
        throw new ElectronStateWorkerOperationError('response-too-large');
      }
      this.full = true;
      return false;
    }
    this.operations.push(operation);
    this.usedBytes += operationBytes;
    return true;
  }

  response(
    type: OperationPageType,
    operationId: number,
    cursorPrefix: string,
  ): ElectronStateWorkerResponse {
    if (!this.full && this.offset > this.seen) throw cursorStale();
    return {
      type,
      operationId,
      operations: this.operations,
      nextCursor: this.full
        ? `${cursorPrefix}${this.offset + this.operations.length}`
        : null,
      done: !this.full,
      approximateBytes: this.maxBytes,
    };
  }
}

export class ElectronStateWorkerRuntime {
  private store: ElectronStateCommitStore | null = null;
  private manifest: ElectronStateManifest | null = null;
  private values: ElectronStateValueStore | null = null;
  private retirement: Retirement | null = null;
  private lastOperationId = 0;
  private readonly sequenceWrites = new Map<string, SequenceWrite>();
  private readonly scalarWrites = new Map<string, SnapshotAssembly>();
  private readonly valueCacheMaxBytes: number;

  constructor(
    private readonly faultInjector?: ElectronStateFaultInjector,
    options: ElectronStateWorkerRuntimeOptions = {},
  ) {
    this.valueCacheMaxBytes =
      options.valueCacheMaxBytes ?? DEFAULT_ELECTRON_STATE_VALUE_CACHE_BYTES;
  }

  async handle(
    request: ElectronStateWorkerRequest,
  ): Promise<ElectronStateWorkerResponse> {
    if (request.operationId <= this.lastOperationId) {
      return {
        type: 'failure',
        operationId: request.operationId,
        code: 'operation-out-of-order',
      };
    }
    this.lastOperationId = request.operationId;
    try {
      if (request.type === 'initialize') return await this.initialize(request);
      if (!this.store || !this.manifest || !this.values) {
        return {
          type: 'failure',
          operationId: request.operationId,
          code: 'not-ready',
        };
      }
      if (this.retirement) throw this.retirementError();
      return await this.dispatch(request);
    } catch (error: unknown) {
      return this.failureFor(request.operationId, error);
    }
  }

  valueCacheStats(): ReturnType<ElectronStateValueStore['stats']> | null {
    return this.values?.stats() ?? null;
  }

  private async dispatch(
    request: Exclude<ElectronStateWorkerRequest, { type: 'initialize' }>,
  ): Promise<ElectronStateWorkerResponse> {
    const operationId = request.operationId;
    switch (request.type) {
      case 'get':
        return await this.readScalar(request);
      case 'read-scalar-page':
        return await this.readScalarPage(request);
      case 'update':
        await this.commitChanges(new Map([[request.key, request.value]]));
        return { type: 'success', operationId };
      case 'delete':
        await this.commitChanges(new Map([[request.key, undefined]]));
        return { type: 'success', operationId };
      case 'read-snapshot-page':
        return await this.readSnapshotPage(request);
      case 'read-json-sequence':
        return await this.readSequencePage(request);
      case 'begin-json-sequence-write':
        this.sequenceWrites.set(request.sequenceId, {
          key: request.key,
          items: [],
          assembly: null,
        });
        return { type: 'success', operationId };
      case 'append-json-sequence-items': {
        const write = this.requireSequenceWrite(request.sequenceId);
        this.finishItem(write);
        write.items.push(...request.items);
        return { type: 'success', operationId };
      }
      case 'append-json-sequence-item-ops': {
        const write = this.requireSequenceWrite(request.sequenceId);
        if (write.assembly && write.assembly.index !== request.itemIndex) {
          this.finishItem(write);
        }
        if (!write.assembly) {
          if (request.itemIndex !== write.items.length) {
            throw new Error('Sequence item operations are out of order');
          }
          write.assembly = {
            index: request.itemIndex,
            snapshot: new SnapshotAssembly(ELECTRON_STATE_SEQUENCE_ITEM_ROOT),
          };
        }
        write.assembly.snapshot.apply(request.operations);
        return { type: 'success', operationId };
      }
      case 'commit-json-sequence-write': {
        const write = this.requireSequenceWrite(request.sequenceId);
        this.finishItem(write);
        this.sequenceWrites.delete(request.sequenceId);
        await this.commitChanges(new Map([[write.key, write.items]]));
        return { type: 'success', operationId };
      }
      case 'abort-json-sequence-write':
        this.sequenceWrites.delete(request.sequenceId);
        return { type: 'success', operationId };
      case 'begin-scalar-write':
        this.scalarWrites.set(
          request.writeId,
          new SnapshotAssembly(request.key),
        );
        return { type: 'success', operationId };
      case 'append-scalar-write-page':
        this.requireScalarWrite(request.writeId).apply(request.operations);
        return { type: 'success', operationId };
      case 'commit-scalar-write': {
        const assembly = this.requireScalarWrite(request.writeId);
        const value = assembly.finish();
        this.scalarWrites.delete(request.writeId);
        await this.commitChanges(new Map([[assembly.rootKey, value]]));
        return { type: 'success', operationId };
      }
      case 'abort-scalar-write':
        this.scalarWrites.delete(request.writeId);
        return { type: 'success', operationId };
      case 'split-array-value':
        return {
          type: 'migration-receipt',
          operationId,
          receipt: await this.runSplit(request.plan, 'mutation'),
        };
    }
  }

  private failureFor(
    operationId: number,
    error: unknown,
  ): ElectronStateWorkerResponse {
    if (error instanceof ElectronStateWorkerOperationError) {
      return {
        type: 'failure',
        operationId,
        code: error.code,
        ...(error.code === 'commit-failed'
          ? { landed: error.details.landed ?? false }
          : {}),
        ...(error.code === 'value-too-large'
          ? { valueBytes: error.details.valueBytes ?? 0 }
          : {}),
      };
    }
    const wireReason =
      error instanceof StateStorageRecoveryRequiredError &&
      isElectronStateWorkerRecoveryReason(error.reason)
        ? error.reason
        : undefined;
    if (wireReason) {
      return {
        type: 'failure',
        operationId,
        code: 'recovery-required',
        recoveryReason: wireReason,
      };
    }
    return {
      type: 'failure',
      operationId,
      code: isFileSystemError(error) ? 'io-failed' : 'internal-error',
    };
  }

  private async initialize(
    request: RequestOf<'initialize'>,
  ): Promise<ElectronStateWorkerResponse> {
    const store = new ElectronStateCommitStore(
      request.legacyFilePath,
      request.v2RootPath,
      this.faultInjector,
    );
    this.store = store;
    this.values = new ElectronStateValueStore(
      (blob) => store.readValue(blob),
      this.valueCacheMaxBytes,
    );
    const loaded = await store.initialize();
    const receipts =
      loaded.kind === 'legacy'
        ? await this.initializeFromLegacy(
            store,
            loaded.legacyValues,
            loaded.sourceSha256,
            request.migrations,
          )
        : await this.initializeFromCurrent(loaded.manifest, request.migrations);
    const manifest = this.requireManifest();
    return {
      type: 'ready',
      operationId: request.operationId,
      generation: manifest.generation,
      mutationEpoch: manifest.mutationEpoch,
      migrationReceipts: receipts,
    };
  }

  private async initializeFromLegacy(
    store: ElectronStateCommitStore,
    legacyValues: Record<string, JsonValue>,
    sourceSha256: string,
    migrations: readonly StateStorageArraySplitPlan[],
  ): Promise<StateStorageMigrationReceipt[]> {
    const values = new Map(Object.entries(legacyValues));
    const counts: ElectronStateArraySplitOutcome['counts'][] = [];
    for (const plan of migrations) {
      const outcome = await this.computeMigration(plan, async (key) =>
        values.get(key),
      );
      for (const [key, value] of outcome.changes) values.set(key, value);
      counts.push(outcome.counts);
    }
    const manifest = await store.commitInitial(values, sourceSha256);
    this.adopt(manifest);
    return counts.map((entry) => ({
      ...entry,
      committedGeneration: manifest.generation,
      commitId: manifest.commitId,
    }));
  }

  private async initializeFromCurrent(
    manifest: ElectronStateManifest,
    migrations: readonly StateStorageArraySplitPlan[],
  ): Promise<StateStorageMigrationReceipt[]> {
    this.adopt(manifest);
    const receipts: StateStorageMigrationReceipt[] = [];
    for (const plan of migrations) {
      try {
        receipts.push(await this.runSplit(plan, 'migration'));
      } catch (error: unknown) {
        if (
          error instanceof StateStorageRecoveryRequiredError ||
          error instanceof ElectronStateWorkerOperationError
        ) {
          throw error;
        }
        throw new StateStorageRecoveryRequiredError('migration-failed');
      }
    }
    return receipts;
  }

  private async computeMigration(
    plan: StateStorageArraySplitPlan,
    read: ElectronStateSplitValueReader,
  ): Promise<ElectronStateArraySplitOutcome> {
    try {
      return await computeElectronStateArraySplit(plan, read);
    } catch (error: unknown) {
      if (error instanceof StateStorageRecoveryRequiredError) throw error;
      throw new StateStorageRecoveryRequiredError('migration-failed');
    }
  }

  private async runSplit(
    plan: StateStorageArraySplitPlan,
    commitKind: 'mutation' | 'migration',
  ): Promise<StateStorageMigrationReceipt> {
    const values = this.requireValues();
    const outcome =
      commitKind === 'migration'
        ? await this.computeMigration(plan, (key) => values.get(key))
        : await computeElectronStateArraySplit(plan, (key) => values.get(key));
    if (outcome.changes.size > 0) {
      await this.commitChanges(outcome.changes, commitKind);
    }
    const manifest = this.requireManifest();
    return {
      ...outcome.counts,
      committedGeneration: manifest.generation,
      commitId: manifest.commitId,
    };
  }

  private adopt(manifest: ElectronStateManifest): void {
    this.manifest = manifest;
    this.requireValues().setManifest(manifest);
  }

  private async commitChanges(
    changes: ElectronStateCommitChanges,
    commitKind: 'mutation' | 'migration' = 'mutation',
  ): Promise<void> {
    const store = this.requireStore();
    const values = this.requireValues();
    const previous = this.requireManifest();
    let manifest: ElectronStateManifest;
    try {
      manifest =
        commitKind === 'migration'
          ? await store.commitMigration(changes, previous)
          : await store.commitMutation(changes, previous);
    } catch (error: unknown) {
      values.evict(changes.keys());
      if (!(error instanceof ElectronStateCommitError)) throw error;
      throw await this.reconcile(store, previous, error);
    }
    this.adopt(manifest);
    for (const [key, value] of changes) {
      const blob = manifest.values[key];
      if (value !== undefined && blob) values.remember(key, blob, value);
    }
  }

  private async reconcile(
    store: ElectronStateCommitStore,
    previous: ElectronStateManifest,
    failure: ElectronStateCommitError,
  ): Promise<Error> {
    let pointer;
    try {
      pointer = await store.readPointer();
    } catch {
      return this.retire('current-pointer-invalid');
    }
    if (
      pointer.generation === previous.generation &&
      pointer.commitId === previous.commitId
    ) {
      return new ElectronStateWorkerOperationError('commit-failed', {
        landed: false,
      });
    }
    if (pointer.generation !== failure.generation) return this.retire();
    try {
      this.adopt(await store.loadPublishedManifest(pointer));
    } catch (error: unknown) {
      return this.retire(
        error instanceof StateStorageRecoveryRequiredError &&
          isElectronStateWorkerRecoveryReason(error.reason)
          ? error.reason
          : 'manifest-invalid',
      );
    }
    return new ElectronStateWorkerOperationError('commit-failed', {
      landed: true,
    });
  }

  private retire(reason?: ElectronStateWorkerRecoveryReason): Error {
    this.retirement = reason ? { reason } : {};
    this.sequenceWrites.clear();
    this.scalarWrites.clear();
    return this.retirementError();
  }

  private retirementError(): Error {
    const reason = this.retirement?.reason;
    return reason
      ? new StateStorageRecoveryRequiredError(reason)
      : new ElectronStateWorkerOperationError('commit-uncertain');
  }

  private projectValue(
    raw: JsonValue,
    projection?: StateStorageValueProjection,
  ): JsonValue {
    const projected = projection ? omitJsonPaths(raw, projection.omit) : raw;
    const valueBytes = jsonUtf8Bytes(projected);
    if (valueBytes > ELECTRON_STATE_PROJECTED_VALUE_MAX_JSON_BYTES) {
      throw new ElectronStateWorkerOperationError('value-too-large', {
        valueBytes,
      });
    }
    return projected;
  }

  private async readScalar(
    request: RequestOf<'get'>,
  ): Promise<ElectronStateWorkerResponse> {
    const values = this.requireValues();
    const blob = values.blobFor(request.key);
    const raw = blob ? await values.get(request.key) : undefined;
    if (!blob || raw === undefined) {
      return { type: 'value', operationId: request.operationId, found: false };
    }
    const projected = this.projectValue(raw, request.projection);
    const direct: ElectronStateWorkerResponse = {
      type: 'value',
      operationId: request.operationId,
      found: true,
      value: projected,
    };
    if (electronStateWorkerPayloadFits(direct)) return direct;
    return this.scalarPageResponse(
      'value-paged',
      request.operationId,
      request.key,
      blob.generation,
      projected,
      request.projection,
      0,
      ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
    );
  }

  private async readScalarPage(
    request: RequestOf<'read-scalar-page'>,
  ): Promise<ElectronStateWorkerResponse> {
    const match = SCALAR_CURSOR_PATTERN.exec(request.cursor);
    const generation = match ? parseCursorNumber(match[1]) : null;
    const offset = match ? parseCursorNumber(match[3]) : null;
    if (
      !match ||
      generation === null ||
      offset === null ||
      match[2] !== projectionHash(request.projection)
    ) {
      throw cursorStale();
    }
    const values = this.requireValues();
    const blob = values.blobFor(request.key);
    if (!blob || blob.generation !== generation) throw cursorStale();
    const raw = await values.get(request.key);
    if (raw === undefined) throw cursorStale();
    return this.scalarPageResponse(
      'scalar-page',
      request.operationId,
      request.key,
      generation,
      this.projectValue(raw, request.projection),
      request.projection,
      offset,
      request.maxBytes,
    );
  }

  private scalarPageResponse(
    type: 'value-paged' | 'scalar-page',
    operationId: number,
    key: string,
    generation: number,
    projected: JsonValue,
    projection: StateStorageValueProjection | undefined,
    offset: number,
    maxBytes: number,
  ): ElectronStateWorkerResponse {
    const prefix = `g${generation}.p${projectionHash(projection)}.`;
    const packer = new OperationPacker(
      type,
      operationId,
      prefix,
      offset,
      maxBytes,
    );
    for (const operation of generateSnapshotOperations({ [key]: projected })) {
      if (!packer.offer(operation)) break;
    }
    return packer.response(type, operationId, prefix);
  }

  private async readSnapshotPage(
    request: RequestOf<'read-snapshot-page'>,
  ): Promise<ElectronStateWorkerResponse> {
    const manifest = this.requireManifest();
    const values = this.requireValues();
    let offset = 0;
    if (request.cursor) {
      const match = GENERATION_CURSOR_PATTERN.exec(request.cursor);
      const generation = match ? parseCursorNumber(match[1]) : null;
      const parsedOffset = match ? parseCursorNumber(match[2]) : null;
      if (generation !== manifest.generation || parsedOffset === null) {
        throw cursorStale();
      }
      offset = parsedOffset;
    }
    const include = request.includeKeys ? new Set(request.includeKeys) : null;
    const prefix = `g${manifest.generation}.`;
    const packer = new OperationPacker(
      'snapshot-page',
      request.operationId,
      prefix,
      offset,
      request.maxBytes,
    );
    for (const key of values.keys()) {
      if (packer.isFull()) break;
      if (include && !include.has(key)) continue;
      if (request.excludeKeyPrefixes?.some((entry) => key.startsWith(entry))) {
        continue;
      }
      const value = await values.get(key);
      if (value === undefined) continue;
      for (const operation of generateSnapshotOperations({ [key]: value })) {
        if (!packer.offer(operation)) break;
      }
    }
    return packer.response('snapshot-page', request.operationId, prefix);
  }

  private async readSequencePage(
    request: RequestOf<'read-json-sequence'>,
  ): Promise<ElectronStateWorkerResponse> {
    const values = this.requireValues();
    const blob = values.blobFor(request.key);
    let start = 0;
    if (request.cursor) {
      const match = GENERATION_CURSOR_PATTERN.exec(request.cursor);
      const generation = match ? parseCursorNumber(match[1]) : null;
      const index = match ? parseCursorNumber(match[2]) : null;
      if (!blob || generation !== blob.generation || index === null) {
        throw cursorStale();
      }
      start = index;
    }
    const value = blob ? await values.get(request.key) : undefined;
    if (value !== undefined && !Array.isArray(value)) {
      throw new ElectronStateWorkerOperationError('not-a-sequence');
    }
    const sequence = value ?? [];
    if (start > sequence.length) throw cursorStale();
    const cursorPrefix = `g${blob?.generation ?? 0}.`;
    const maxJsonBytes = request.maxJsonBytes ?? Number.POSITIVE_INFINITY;
    const maxItemBytes = request.maxItemBytes ?? Number.POSITIVE_INFINITY;
    const baseEstimator = measure({
      type: 'json-sequence-page',
      operationId: request.operationId,
      items: [],
      nextCursor: `${cursorPrefix}${CURSOR_OFFSET_PLACEHOLDER}`,
      done: false,
      approximateBytes: request.maxBytes,
      truncatedItems: [
        {
          index: CURSOR_OFFSET_PLACEHOLDER,
          originalJsonBytes: CURSOR_OFFSET_PLACEHOLDER,
        },
      ],
    });
    const items: JsonValue[] = [];
    let truncatedItem: { index: number; originalJsonBytes: number } | null =
      null;
    let estimatorBytes = baseEstimator;
    let jsonBytes = request.jsonEnvelopeBytes ?? 2;
    let index = start;
    while (index < sequence.length) {
      const item = sequence[index];
      const itemEstimator = estimateElectronStateJsonBytes(item);
      const itemJson = jsonUtf8Bytes(item);
      const separator = items.length > 0 ? 1 : 0;
      if (
        estimatorBytes + itemEstimator <= request.maxBytes &&
        jsonBytes + separator + itemJson <= maxJsonBytes &&
        itemJson <= maxItemBytes
      ) {
        items.push(item);
        estimatorBytes += itemEstimator;
        jsonBytes += separator + itemJson;
        index++;
        continue;
      }
      if (items.length > 0) break;
      const shrunk = shrinkJsonStringLeaves(item, {
        maxEstimatorBytes: request.maxBytes - baseEstimator,
        maxJsonBytes: Math.min(maxJsonBytes - jsonBytes, maxItemBytes),
        estimate: (candidate) =>
          estimateElectronStateJsonBytes(candidate as JsonValue),
      });
      if (shrunk === null) {
        throw new ElectronStateWorkerOperationError('value-too-large', {
          valueBytes: itemJson,
        });
      }
      items.push(shrunk);
      truncatedItem = { index: 0, originalJsonBytes: itemJson };
      index++;
      break;
    }
    const done = index >= sequence.length;
    return {
      type: 'json-sequence-page',
      operationId: request.operationId,
      items,
      nextCursor: done ? null : `${cursorPrefix}${index}`,
      done,
      approximateBytes: request.maxBytes,
      ...(truncatedItem ? { truncatedItems: [truncatedItem] } : {}),
    };
  }

  private finishItem(write: SequenceWrite): void {
    if (!write.assembly) return;
    write.items.push(write.assembly.snapshot.finish());
    write.assembly = null;
  }

  private requireSequenceWrite(sequenceId: string): SequenceWrite {
    const write = this.sequenceWrites.get(sequenceId);
    if (!write) throw new Error('Unknown sequence write');
    return write;
  }

  private requireScalarWrite(writeId: string): SnapshotAssembly {
    const write = this.scalarWrites.get(writeId);
    if (!write) throw new Error('Unknown scalar write');
    return write;
  }

  private requireStore(): ElectronStateCommitStore {
    if (!this.store) throw new Error('Worker is not ready');
    return this.store;
  }

  private requireManifest(): ElectronStateManifest {
    if (!this.manifest) throw new Error('Worker is not ready');
    return this.manifest;
  }

  private requireValues(): ElectronStateValueStore {
    if (!this.values) throw new Error('Worker is not ready');
    return this.values;
  }
}
