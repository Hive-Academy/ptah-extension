import { createHash, randomUUID } from 'node:crypto';
import {
  StateStorageRecoveryRequiredError,
  type StateStorageArraySplitPlan,
  type StateStorageFieldProjection,
  type StateStorageJsonPath,
  type StateStorageMigrationReceipt,
} from '@ptah-extension/platform-core';
import { ElectronStateCommitStore } from './electron-state-storage-commit-store';
import type { ElectronStateFaultInjector } from './electron-state-storage-commit-store';
import type { ElectronStateManifest } from './electron-state-storage-manifest';
import {
  assertElectronStateWorkerPayloadWithinBudget,
  generateSnapshotOperations,
  isElectronStateWorkerRecoveryReason,
  setSnapshotPath,
  type ElectronStateWorkerRequest,
  type ElectronStateWorkerResponse,
  type JsonValue,
  type SnapshotOperation,
} from './electron-state-storage-worker-protocol';

interface SequenceStringAssembly {
  readonly bytes: Uint8Array;
  readonly totalBytes: number;
  receivedBytes: number;
}

interface SequenceWrite {
  readonly key: string;
  readonly items: JsonValue[];
  readonly stringSlices: Map<string, SequenceStringAssembly>;
}

interface ScalarWrite {
  readonly key: string;
  readonly root: Record<string, JsonValue>;
  readonly strings: Map<string, { bytes: Uint8Array; receivedBytes: number }>;
}

interface SnapshotCursor {
  readonly iterator: Iterator<SnapshotOperation>;
  pending: SnapshotOperation | null;
}

function sha256Json(value: JsonValue): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function getAtPath(value: unknown, jsonPath: StateStorageJsonPath): unknown {
  let current = value;
  for (const segment of jsonPath) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

function deleteAtPath(value: unknown, jsonPath: StateStorageJsonPath): void {
  if (jsonPath.length === 0) return;
  const parent = getAtPath(value, jsonPath.slice(0, -1));
  const final = jsonPath[jsonPath.length - 1];
  if (parent !== null && typeof parent === 'object') {
    if (Array.isArray(parent) && typeof final === 'number') {
      parent[final] = undefined as unknown as JsonValue;
    } else {
      delete (parent as Record<string | number, unknown>)[final];
    }
  }
}

function setAtPath(
  root: JsonValue,
  jsonPath: StateStorageJsonPath,
  value: JsonValue,
): void {
  if (jsonPath.length === 0) throw new Error('Cannot replace a sequence root');
  const parent = getAtPath(root, jsonPath.slice(0, -1));
  if (parent === null || typeof parent !== 'object') {
    throw new Error('String slice path does not exist');
  }
  const final = jsonPath[jsonPath.length - 1];
  (parent as Record<string | number, JsonValue>)[final] = value;
}

function projectionName(field: StateStorageFieldProjection): string {
  if (field.targetField) return field.targetField;
  const final = field.sourcePath[field.sourcePath.length - 1];
  if (typeof final !== 'string') {
    throw new Error('A numeric projection path requires targetField');
  }
  return final;
}

function project(
  source: unknown,
  fields: readonly StateStorageFieldProjection[],
): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};
  for (const field of fields) {
    const value = getAtPath(source, field.sourcePath);
    if (value !== undefined) {
      result[projectionName(field)] = structuredClone(value) as JsonValue;
    }
  }
  return result;
}

function usableId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const id = String(value).trim();
  return id.length > 0 ? id : null;
}

function toTaggedSequence(
  source: unknown,
  format: NonNullable<
    NonNullable<StateStorageArraySplitPlan['nestedExtractions']>[number]['destinationFormat']
  >,
): JsonValue[] {
  const result: JsonValue[] = [];
  for (const field of format.fields) {
    const values = getAtPath(source, field.sourcePath);
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      result.push({ tag: field.tag, value: structuredClone(value) as JsonValue });
    }
  }
  return result;
}

function mergeTaggedSequence(
  existing: JsonValue | undefined,
  incomingSource: unknown,
  plan: NonNullable<StateStorageArraySplitPlan['nestedExtractions']>[number],
): JsonValue[] {
  const format = plan.destinationFormat;
  if (!format) throw new Error('Tagged sequence format is missing');
  const incoming = toTaggedSequence(incomingSource, format);
  if (plan.conflictPolicy.kind === 'replace' || existing === undefined) {
    return incoming;
  }
  const existingItems: JsonValue[] = Array.isArray(existing)
    ? existing
    : existing !== null && typeof existing === 'object'
      ? format.fields.flatMap((field) => {
          const values = getAtPath(existing, field.sourcePath);
          return Array.isArray(values)
            ? values.map((value) => ({
                tag: field.tag,
                value: structuredClone(value) as JsonValue,
              }))
            : [];
        })
      : [];
  const result: JsonValue[] = [];
  for (const field of format.fields) {
    const oldItems = existingItems.filter(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        item['tag'] === field.tag,
    );
    const newItems = incoming.filter(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        item['tag'] === field.tag,
    );
    result.push(...(oldItems.length > newItems.length ? oldItems : newItems));
  }
  return result;
}

function mergeExtraction(
  existing: JsonValue | undefined,
  incomingSource: unknown,
  plan: NonNullable<StateStorageArraySplitPlan['nestedExtractions']>[number],
): JsonValue {
  if (plan.destinationFormat?.kind === 'tagged-sequence') {
    return mergeTaggedSequence(existing, incomingSource, plan);
  }
  const incoming = project(incomingSource, plan.fields);
  if (
    plan.conflictPolicy.kind === 'replace' ||
    existing === undefined ||
    existing === null ||
    typeof existing !== 'object' ||
    Array.isArray(existing)
  ) {
    return incoming;
  }
  const merged = { ...(existing as Record<string, JsonValue>), ...incoming };
  for (const field of plan.conflictPolicy.fields) {
    const oldValue = (existing as Record<string, JsonValue>)[field];
    const newValue = incoming[field];
    if (
      Array.isArray(oldValue) &&
      Array.isArray(newValue) &&
      oldValue.length > newValue.length
    ) {
      merged[field] = oldValue;
    }
  }
  return merged;
}

export class ElectronStateWorkerRuntime {
  private store: ElectronStateCommitStore | null = null;
  private values: Record<string, JsonValue> = {};
  private manifest: ElectronStateManifest | null = null;
  private lastOperationId = 0;
  private readonly snapshotCursors = new Map<string, SnapshotCursor>();
  private readonly sequenceWrites = new Map<string, SequenceWrite>();
  private readonly scalarWrites = new Map<string, ScalarWrite>();
  private applyingInitializationMigrations = false;

  constructor(private readonly faultInjector?: ElectronStateFaultInjector) {}

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
      if (!this.store || !this.manifest) {
        return {
          type: 'failure',
          operationId: request.operationId,
          code: 'not-ready',
        };
      }
      switch (request.type) {
        case 'get':
          return request.key in this.values
            ? {
                type: 'value',
                operationId: request.operationId,
                found: true,
                value: this.values[request.key],
              }
            : { type: 'value', operationId: request.operationId, found: false };
        case 'update':
          await this.commitMutation({ [request.key]: request.value });
          return { type: 'success', operationId: request.operationId };
        case 'delete':
          await this.commitMutation({ [request.key]: undefined });
          return { type: 'success', operationId: request.operationId };
        case 'read-snapshot-page':
          return this.readSnapshotPage(request);
        case 'read-json-sequence':
          return this.readSequencePage(request);
        case 'begin-json-sequence-write':
          this.sequenceWrites.set(request.sequenceId, {
            key: request.key,
            items: [],
            stringSlices: new Map(),
          });
          return { type: 'success', operationId: request.operationId };
        case 'append-json-sequence-items': {
          const write = this.requireSequenceWrite(request.sequenceId);
          write.items.push(...request.items);
          return { type: 'success', operationId: request.operationId };
        }
        case 'append-json-string-slice': {
          const write = this.requireSequenceWrite(request.sequenceId);
          const sliceKey = `${request.itemIndex}:${JSON.stringify(request.path)}`;
          let assembly = write.stringSlices.get(sliceKey);
          if (!assembly) {
            if (request.byteOffset !== 0) {
              throw new Error('String slices are out of order');
            }
            assembly = {
              bytes: new Uint8Array(request.totalBytes),
              totalBytes: request.totalBytes,
              receivedBytes: 0,
            };
            write.stringSlices.set(sliceKey, assembly);
          }
          if (
            assembly.totalBytes !== request.totalBytes ||
            assembly.receivedBytes !== request.byteOffset ||
            request.byteOffset + request.bytes.byteLength > assembly.totalBytes
          ) {
            throw new Error('String slices are out of order');
          }
          assembly.bytes.set(request.bytes, request.byteOffset);
          assembly.receivedBytes += request.bytes.byteLength;
          if (assembly.receivedBytes === assembly.totalBytes) {
            if (request.itemIndex >= write.items.length) {
              throw new Error('String slice item is missing');
            }
            const text = new TextDecoder('utf-8', { fatal: true }).decode(
              assembly.bytes,
            );
            if (request.path.length === 0) {
              write.items[request.itemIndex] = text;
            } else {
              const item = write.items[request.itemIndex];
              if (item === undefined) {
                throw new Error('String slice item is missing');
              }
              setAtPath(item, request.path, text);
            }
            write.stringSlices.delete(sliceKey);
          }
          return { type: 'success', operationId: request.operationId };
        }
        case 'commit-json-sequence-write': {
          const write = this.requireSequenceWrite(request.sequenceId);
          if (write.stringSlices.size > 0)
            throw new Error('String slices are incomplete');
          await this.commitMutation({ [write.key]: write.items });
          this.sequenceWrites.delete(request.sequenceId);
          return { type: 'success', operationId: request.operationId };
        }
        case 'abort-json-sequence-write':
          this.sequenceWrites.delete(request.sequenceId);
          return { type: 'success', operationId: request.operationId };
        case 'begin-scalar-write':
          this.scalarWrites.set(request.writeId, {
            key: request.key,
            root: {},
            strings: new Map(),
          });
          return { type: 'success', operationId: request.operationId };
        case 'append-scalar-write-page': {
          const write = this.requireScalarWrite(request.writeId);
          for (const operation of request.operations) {
            if (operation.path[0] !== write.key) {
              throw new Error('Operation path does not match scalar write key');
            }
            const pathKey = JSON.stringify(operation.path);
            switch (operation.kind) {
              case 'object':
                setSnapshotPath(write.root, operation.path, {});
                break;
              case 'array':
                setSnapshotPath(write.root, operation.path, []);
                break;
              case 'value':
                setSnapshotPath(write.root, operation.path, operation.value);
                break;
              case 'string-start':
                write.strings.set(pathKey, {
                  bytes: new Uint8Array(operation.totalBytes),
                  receivedBytes: 0,
                });
                break;
              case 'string-slice': {
                const assembly = write.strings.get(pathKey);
                if (
                  !assembly ||
                  assembly.receivedBytes !== operation.byteOffset
                ) {
                  throw new Error('String slices are out of order');
                }
                assembly.bytes.set(operation.bytes, operation.byteOffset);
                assembly.receivedBytes += operation.bytes.byteLength;
                if (assembly.receivedBytes === assembly.bytes.byteLength) {
                  setSnapshotPath(
                    write.root,
                    operation.path,
                    Buffer.from(assembly.bytes).toString('utf8'),
                  );
                  write.strings.delete(pathKey);
                }
                break;
              }
            }
          }
          return { type: 'success', operationId: request.operationId };
        }
        case 'commit-scalar-write': {
          const write = this.requireScalarWrite(request.writeId);
          if (write.strings.size > 0) {
            throw new Error('Scalar write has incomplete strings');
          }
          if (!(write.key in write.root)) {
            throw new Error('Scalar write root value was not set');
          }
          await this.commitMutation({ [write.key]: write.root[write.key] });
          this.scalarWrites.delete(request.writeId);
          return { type: 'success', operationId: request.operationId };
        }
        case 'abort-scalar-write':
          this.scalarWrites.delete(request.writeId);
          return { type: 'success', operationId: request.operationId };
        case 'split-array-value': {
          const receipt = await this.splitArrayValue(request.plan);
          return {
            type: 'migration-receipt',
            operationId: request.operationId,
            receipt,
          };
        }
      }
    } catch (error: unknown) {
      // Only a reason the PROTOCOL can carry may be reported as
      // `recovery-required`. Every reason a worker can actually reach is a
      // verdict about durable state and passes this guard; a host-only reason
      // such as `worker-unresponsive` cannot be reached here and would be
      // rejected by the response schema, so it degrades to a plain `io-failed`
      // rather than being forwarded as an unparseable reply — which, on this
      // code path, would itself be a lost reply.
      const wireReason =
        error instanceof StateStorageRecoveryRequiredError &&
        isElectronStateWorkerRecoveryReason(error.reason)
          ? error.reason
          : undefined;
      return {
        type: 'failure',
        operationId: request.operationId,
        code: wireReason ? 'recovery-required' : 'io-failed',
        ...(wireReason ? { recoveryReason: wireReason } : {}),
      };
    }
  }

  private async initialize(
    request: Extract<ElectronStateWorkerRequest, { type: 'initialize' }>,
  ): Promise<ElectronStateWorkerResponse> {
    this.store = new ElectronStateCommitStore(
      request.legacyFilePath,
      request.v2RootPath,
      this.faultInjector,
    );
    const loaded = await this.store.initialize();
    this.values = loaded.values;
    this.manifest = loaded.manifest;
    this.applyingInitializationMigrations = true;
    try {
      for (const plan of request.migrations) {
        try {
          await this.splitArrayValue(plan);
        } catch (error: unknown) {
          if (error instanceof StateStorageRecoveryRequiredError) throw error;
          throw new StateStorageRecoveryRequiredError('migration-failed');
        }
      }
    } finally {
      this.applyingInitializationMigrations = false;
    }
    return {
      type: 'ready',
      operationId: request.operationId,
      generation: this.manifest.generation,
      mutationEpoch: this.manifest.mutationEpoch,
    };
  }

  private async commitMutation(
    changes: Record<string, JsonValue | undefined>,
  ): Promise<void> {
    if (!this.store || !this.manifest) throw new Error('Worker is not ready');
    const next = { ...this.values };
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    const manifest = this.applyingInitializationMigrations
      ? await this.store.commitMigration(
          next,
          new Set(Object.keys(changes)),
          this.manifest,
        )
      : await this.store.commitMutation(
          next,
          new Set(Object.keys(changes)),
          this.manifest,
        );
    this.values = next;
    this.manifest = manifest;
  }

  private readSnapshotPage(
    request: Extract<
      ElectronStateWorkerRequest,
      { type: 'read-snapshot-page' }
    >,
  ): ElectronStateWorkerResponse {
    const cursorId = request.cursor ?? randomUUID();
    let cursor = request.cursor
      ? this.snapshotCursors.get(request.cursor)
      : undefined;
    if (!cursor) {
      if (request.cursor) throw new Error('Unknown snapshot cursor');
      const visibleValues = request.excludeKeyPrefixes?.length
        ? Object.fromEntries(
            Object.entries(this.values).filter(
              ([key]) =>
                !request.excludeKeyPrefixes?.some((prefix) =>
                  key.startsWith(prefix),
                ),
            ),
          )
        : this.values;
      cursor = {
        iterator: generateSnapshotOperations(visibleValues),
        pending: null,
      };
      this.snapshotCursors.set(cursorId, cursor);
    }
    const operations: SnapshotOperation[] = [];
    let done = false;
    while (operations.length < 512) {
      const operation = cursor.pending ?? cursor.iterator.next().value;
      cursor.pending = null;
      if (!operation) {
        done = true;
        break;
      }
      const candidate = {
        type: 'snapshot-page' as const,
        operationId: request.operationId,
        operations: [...operations, operation],
        nextCursor: cursorId,
        done: false,
        approximateBytes: request.maxBytes,
      };
      try {
        assertElectronStateWorkerPayloadWithinBudget(
          candidate,
          request.maxBytes,
        );
        operations.push(operation);
      } catch {
        if (operations.length === 0)
          throw new Error('Snapshot operation exceeds budget');
        cursor.pending = operation;
        break;
      }
    }
    if (done) this.snapshotCursors.delete(cursorId);
    const response: ElectronStateWorkerResponse = {
      type: 'snapshot-page',
      operationId: request.operationId,
      operations,
      nextCursor: done ? null : cursorId,
      done,
      approximateBytes: request.maxBytes,
    };
    assertElectronStateWorkerPayloadWithinBudget(response, request.maxBytes);
    return response;
  }

  private readSequencePage(
    request: Extract<
      ElectronStateWorkerRequest,
      { type: 'read-json-sequence' }
    >,
  ): ElectronStateWorkerResponse {
    const value = this.values[request.key];
    if (value !== undefined && !Array.isArray(value)) {
      throw new Error('State value is not a JSON sequence');
    }
    const sequence = value ?? [];
    const start = request.cursor ? Number.parseInt(request.cursor, 10) : 0;
    if (!Number.isSafeInteger(start) || start < 0 || start > sequence.length) {
      throw new Error('Invalid sequence cursor');
    }
    const items: JsonValue[] = [];
    let index = start;
    while (index < sequence.length) {
      const candidateItems = [...items, sequence[index]];
      const candidate = {
        type: 'json-sequence-page' as const,
        operationId: request.operationId,
        items: candidateItems,
        nextCursor: String(index + 1),
        done: false,
        approximateBytes: request.maxBytes,
      };
      try {
        assertElectronStateWorkerPayloadWithinBudget(
          candidate,
          request.maxBytes,
        );
        items.push(sequence[index]);
        index++;
      } catch {
        if (items.length === 0)
          throw new Error('Sequence item exceeds page budget');
        break;
      }
    }
    const done = index >= sequence.length;
    return {
      type: 'json-sequence-page',
      operationId: request.operationId,
      items,
      nextCursor: done ? null : String(index),
      done,
      approximateBytes: request.maxBytes,
    };
  }

  private requireSequenceWrite(sequenceId: string): SequenceWrite {
    const write = this.sequenceWrites.get(sequenceId);
    if (!write) throw new Error('Unknown sequence write');
    return write;
  }

  private requireScalarWrite(writeId: string): ScalarWrite {
    const write = this.scalarWrites.get(writeId);
    if (!write) throw new Error('Unknown scalar write');
    return write;
  }

  private async splitArrayValue(
    plan: StateStorageArraySplitPlan,
  ): Promise<StateStorageMigrationReceipt> {
    const source = this.values[plan.sourceKey];
    if (source === undefined) {
      return {
        sourceKey: plan.sourceKey,
        sourceSha256: sha256Json(null),
        itemCount: 0,
        extractedValueCount: 0,
        retainedSourceCount: 0,
        committedGeneration: this.manifest?.generation ?? 1,
        commitId: this.manifest?.commitId ?? randomUUID(),
      };
    }
    if (!Array.isArray(source)) {
      if (
        source !== null &&
        typeof source === 'object' &&
        !Array.isArray(source) &&
        source['schemaVersion'] === plan.indexSchemaVersion
      ) {
        return {
          sourceKey: plan.sourceKey,
          sourceSha256: sha256Json(source),
          itemCount: Array.isArray(source['items'])
            ? source['items'].length
            : 0,
          extractedValueCount: 0,
          retainedSourceCount: 0,
          committedGeneration: this.manifest?.generation ?? 1,
          commitId: this.manifest?.commitId ?? randomUUID(),
        };
      }
      throw new Error('Split source is not an array');
    }
    const changes: Record<string, JsonValue> = {};
    const indexItems: JsonValue[] = [];
    let extractedValueCount = 0;
    let retainedSourceCount = 0;

    for (const sourceItem of source) {
      const id = usableId(getAtPath(sourceItem, plan.itemIdPath));
      if (!id) {
        throw new Error('Split source item has no usable id');
      }
      const detail = structuredClone(sourceItem) as JsonValue;
      for (const extraction of plan.nestedExtractions ?? []) {
        const nested = getAtPath(detail, extraction.sourceArrayPath);
        if (!Array.isArray(nested)) continue;
        for (const nestedItem of nested) {
          const nestedId = usableId(
            getAtPath(nestedItem, extraction.itemIdPath),
          );
          if (!nestedId) {
            retainedSourceCount++;
            continue;
          }
          const destinationKey = `${extraction.destinationKeyPrefix}${nestedId}`;
          const existing =
            changes[destinationKey] ?? this.values[destinationKey];
          changes[destinationKey] = mergeExtraction(
            existing,
            nestedItem,
            extraction,
          );
          for (const field of extraction.fields)
            deleteAtPath(nestedItem, field.sourcePath);
          extractedValueCount++;
        }
      }
      changes[`${plan.detailKeyPrefix}${id}`] = detail;
      indexItems.push(project(sourceItem, plan.summaryFields));
    }
    changes[plan.indexKey] = {
      schemaVersion: plan.indexSchemaVersion,
      items: indexItems,
    };
    await this.commitMutation(changes);
    if (!this.manifest) throw new Error('Migration commit missing');
    return {
      sourceKey: plan.sourceKey,
      sourceSha256: sha256Json(source),
      itemCount: source.length,
      extractedValueCount,
      retainedSourceCount,
      committedGeneration: this.manifest.generation,
      commitId: this.manifest.commitId,
    };
  }
}
