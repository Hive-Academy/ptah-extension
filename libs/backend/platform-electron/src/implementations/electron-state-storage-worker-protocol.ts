import { z } from 'zod';
import type {
  StateStorageArraySplitPlan,
  StateStorageMigrationReceipt,
} from '@ptah-extension/platform-core';

export const ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES = 256 * 1024;
export const MAX_PROTOCOL_DEPTH = 64;
const MAX_PROTOCOL_NODES = ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES / 4;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const electronStateJsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(electronStateJsonValueSchema),
    z.record(z.string(), electronStateJsonValueSchema),
  ]),
);
export const electronStateJsonRecordSchema = z.record(
  z.string(),
  electronStateJsonValueSchema,
);

const positiveSafeIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const nonNegativeSafeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const stateKeySchema = z.string().min(1).max(4096);
const jsonPathSegmentSchema = z.union([
  z.string().min(1).max(4096),
  nonNegativeSafeIntegerSchema,
]);
const jsonPathSchema = z.array(jsonPathSegmentSchema).max(MAX_PROTOCOL_DEPTH);
const snapshotPathSchema = z
  .array(jsonPathSegmentSchema)
  .min(1)
  .max(MAX_PROTOCOL_DEPTH);

export const snapshotOperationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.enum(['object', 'array']),
      path: snapshotPathSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('value'),
      path: snapshotPathSchema,
      value: z.union([z.null(), z.boolean(), z.number().finite(), z.string()]),
    })
    .strict(),
  z
    .object({
      kind: z.literal('string-start'),
      path: snapshotPathSchema,
      totalBytes: positiveSafeIntegerSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('string-slice'),
      path: snapshotPathSchema,
      byteOffset: nonNegativeSafeIntegerSchema,
      totalBytes: positiveSafeIntegerSchema,
      bytes: z
        .instanceof(Uint8Array)
        .refine(
          (value) =>
            value.byteLength <= ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
          'byte slice exceeds worker message budget',
        ),
    })
    .strict()
    .superRefine((operation, context) => {
      if (
        operation.byteOffset + operation.bytes.byteLength >
        operation.totalBytes
      ) {
        context.addIssue({
          code: 'custom',
          path: ['bytes'],
          message: 'snapshot string slice exceeds its declared length',
        });
      }
    }),
]);

export type SnapshotOperation = z.infer<typeof snapshotOperationSchema>;

const fieldProjectionSchema = z
  .object({
    sourcePath: jsonPathSchema,
    targetField: z.string().min(1).max(4096).optional(),
  })
  .strict();

const extractionConflictPolicySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('replace') }).strict(),
  z
    .object({
      kind: z.literal('prefer-longer-arrays'),
      fields: z.array(z.string().min(1).max(4096)).min(1).max(256),
    })
    .strict(),
]);

const nestedExtractionPlanSchema = z
  .object({
    sourceArrayPath: jsonPathSchema,
    itemIdPath: jsonPathSchema,
    destinationKeyPrefix: stateKeySchema,
    fields: z.array(fieldProjectionSchema).min(1).max(256),
    destinationFormat: z
      .object({
        kind: z.literal('tagged-sequence'),
        fields: z
          .array(
            z
              .object({
                sourcePath: jsonPathSchema,
                tag: z.string().min(1).max(4096),
              })
              .strict(),
          )
          .min(1)
          .max(256),
      })
      .strict()
      .optional(),
    onMissingId: z.literal('retain-source'),
    conflictPolicy: extractionConflictPolicySchema,
  })
  .strict();

export const stateStorageArraySplitPlanSchema: z.ZodType<StateStorageArraySplitPlan> =
  z
    .object({
      kind: z.literal('split-array-value'),
      planVersion: z.literal(1),
      sourceKey: stateKeySchema,
      itemIdPath: jsonPathSchema,
      detailKeyPrefix: stateKeySchema,
      indexKey: stateKeySchema,
      indexSchemaVersion: positiveSafeIntegerSchema,
      summaryFields: z.array(fieldProjectionSchema).min(1).max(256),
      nestedExtractions: z.array(nestedExtractionPlanSchema).max(64).optional(),
    })
    .strict();

const migrationReceiptSchema: z.ZodType<StateStorageMigrationReceipt> = z
  .object({
    sourceKey: stateKeySchema,
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    itemCount: nonNegativeSafeIntegerSchema,
    extractedValueCount: nonNegativeSafeIntegerSchema,
    retainedSourceCount: nonNegativeSafeIntegerSchema,
    committedGeneration: positiveSafeIntegerSchema,
    commitId: z.uuid(),
  })
  .strict();

const operationIdSchema = positiveSafeIntegerSchema;
const sequenceIdSchema = z.string().uuid();

const initializeRequestSchema = z
  .object({
    type: z.literal('initialize'),
    operationId: operationIdSchema,
    legacyFilePath: z.string().min(1).max(32_768),
    v2RootPath: z.string().min(1).max(32_768),
    migrations: z.array(stateStorageArraySplitPlanSchema).max(64),
  })
  .strict();

const appendStringSliceRequestSchema = z
  .object({
    type: z.literal('append-json-string-slice'),
    operationId: operationIdSchema,
    sequenceId: sequenceIdSchema,
    itemIndex: nonNegativeSafeIntegerSchema,
    path: jsonPathSchema,
    byteOffset: nonNegativeSafeIntegerSchema,
    totalBytes: positiveSafeIntegerSchema,
    bytes: z
      .instanceof(Uint8Array)
      .refine(
        (value) => value.byteLength <= ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
        'byte slice exceeds worker message budget',
      ),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.byteOffset + request.bytes.byteLength > request.totalBytes) {
      context.addIssue({
        code: 'custom',
        path: ['bytes'],
        message: 'byte slice exceeds declared string length',
      });
    }
  });

const beginScalarWriteRequestSchema = z
  .object({
    type: z.literal('begin-scalar-write'),
    operationId: operationIdSchema,
    writeId: sequenceIdSchema,
    key: stateKeySchema,
  })
  .strict();

const appendScalarWritePageRequestSchema = z
  .object({
    type: z.literal('append-scalar-write-page'),
    operationId: operationIdSchema,
    writeId: sequenceIdSchema,
    operations: z.array(snapshotOperationSchema).min(1).max(512),
  })
  .strict();

const commitScalarWriteRequestSchema = z
  .object({
    type: z.literal('commit-scalar-write'),
    operationId: operationIdSchema,
    writeId: sequenceIdSchema,
  })
  .strict();

const abortScalarWriteRequestSchema = z
  .object({
    type: z.literal('abort-scalar-write'),
    operationId: operationIdSchema,
    writeId: sequenceIdSchema,
  })
  .strict();

export const electronStateWorkerRequestSchema = z.discriminatedUnion('type', [
  initializeRequestSchema,
  z
    .object({
      type: z.literal('get'),
      operationId: operationIdSchema,
      key: stateKeySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('update'),
      operationId: operationIdSchema,
      key: stateKeySchema,
      value: electronStateJsonValueSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('delete'),
      operationId: operationIdSchema,
      key: stateKeySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('read-json-sequence'),
      operationId: operationIdSchema,
      key: stateKeySchema,
      cursor: z.string().min(1).max(4096).optional(),
      maxBytes: positiveSafeIntegerSchema.max(
        ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
      ),
    })
    .strict(),
  z
    .object({
      type: z.literal('read-snapshot-page'),
      operationId: operationIdSchema,
      cursor: z.string().uuid().optional(),
      maxBytes: positiveSafeIntegerSchema.max(
        ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
      ),
      excludeKeyPrefixes: z.array(stateKeySchema).max(256).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('begin-json-sequence-write'),
      operationId: operationIdSchema,
      sequenceId: sequenceIdSchema,
      key: stateKeySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('append-json-sequence-items'),
      operationId: operationIdSchema,
      sequenceId: sequenceIdSchema,
      items: z.array(electronStateJsonValueSchema).min(1),
    })
    .strict(),
  appendStringSliceRequestSchema,
  z
    .object({
      type: z.enum(['commit-json-sequence-write', 'abort-json-sequence-write']),
      operationId: operationIdSchema,
      sequenceId: sequenceIdSchema,
    })
    .strict(),
  beginScalarWriteRequestSchema,
  appendScalarWritePageRequestSchema,
  commitScalarWriteRequestSchema,
  abortScalarWriteRequestSchema,
  z
    .object({
      type: z.literal('split-array-value'),
      operationId: operationIdSchema,
      plan: stateStorageArraySplitPlanSchema,
    })
    .strict(),
]);

const safeFailureCodeSchema = z.enum([
  'not-ready',
  'invalid-request',
  'operation-out-of-order',
  'payload-too-large',
  'io-failed',
  'verification-failed',
  'recovery-required',
]);

export const electronStateWorkerResponseSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('ready'),
      operationId: operationIdSchema,
      generation: positiveSafeIntegerSchema,
      mutationEpoch: nonNegativeSafeIntegerSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('success'),
      operationId: operationIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('value'),
      operationId: operationIdSchema,
      found: z.boolean(),
      value: electronStateJsonValueSchema.optional(),
    })
    .strict()
    .superRefine((response, context) => {
      if (response.found !== (response.value !== undefined)) {
        context.addIssue({
          code: 'custom',
          path: ['value'],
          message: 'found must agree with value presence',
        });
      }
    }),
  z
    .object({
      type: z.literal('json-sequence-page'),
      operationId: operationIdSchema,
      items: z.array(electronStateJsonValueSchema),
      nextCursor: z.string().min(1).max(4096).nullable(),
      done: z.boolean(),
      approximateBytes: nonNegativeSafeIntegerSchema.max(
        ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
      ),
    })
    .strict()
    .superRefine((response, context) => {
      if (response.done !== (response.nextCursor === null)) {
        context.addIssue({
          code: 'custom',
          path: ['nextCursor'],
          message: 'done pages must have a null cursor and vice versa',
        });
      }
    }),
  z
    .object({
      type: z.literal('snapshot-page'),
      operationId: operationIdSchema,
      operations: z.array(snapshotOperationSchema),
      nextCursor: z.string().uuid().nullable(),
      done: z.boolean(),
      approximateBytes: nonNegativeSafeIntegerSchema.max(
        ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
      ),
    })
    .strict()
    .superRefine((response, context) => {
      if (response.done !== (response.nextCursor === null)) {
        context.addIssue({
          code: 'custom',
          path: ['nextCursor'],
          message: 'done snapshot pages must have a null cursor and vice versa',
        });
      }
    }),
  z
    .object({
      type: z.literal('migration-receipt'),
      operationId: operationIdSchema,
      receipt: migrationReceiptSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('failure'),
      operationId: operationIdSchema,
      code: safeFailureCodeSchema,
      recoveryReason: z
        .enum([
          'current-pointer-invalid',
          'manifest-invalid',
          'blob-missing',
          'blob-length-mismatch',
          'blob-hash-mismatch',
          'migration-failed',
        ])
        .optional(),
    })
    .strict()
    .superRefine((response, context) => {
      if (
        (response.code === 'recovery-required') !==
        (response.recoveryReason !== undefined)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['recoveryReason'],
          message:
            'recovery-required failures must include a recovery reason only',
        });
      }
    }),
]);

export type ElectronStateWorkerRequest = z.infer<
  typeof electronStateWorkerRequestSchema
>;
export type ElectronStateWorkerResponse = z.infer<
  typeof electronStateWorkerResponseSchema
>;

export type ElectronStateWorkerProtocolErrorCode =
  | 'INVALID_MESSAGE'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_VALUE'
  | 'MAX_DEPTH_EXCEEDED'
  | 'NON_MONOTONIC_OPERATION';

export class ElectronStateWorkerProtocolError extends Error {
  override readonly name = 'ElectronStateWorkerProtocolError';

  constructor(
    readonly code: ElectronStateWorkerProtocolErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null) {
    return true;
  }
  return (
    (prototype === Object.prototype ||
      Object.getPrototypeOf(prototype) === null) &&
    (prototype.constructor === undefined ||
      prototype.constructor.name === 'Object')
  );
}

/**
 * Conservative structured-clone measurement with bounded traversal.
 *
 * This deliberately does not stringify. Large strings are rejected from their
 * O(1) length before copying, and arrays/objects stop being traversed as soon as
 * the byte or node budget is exceeded.
 */
export function assertElectronStateWorkerPayloadWithinBudget(
  input: unknown,
  maxBytes = ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
): void {
  const seen = new WeakSet<object>();
  let measuredBytes = 0;
  let visitedNodes = 0;

  const addBytes = (bytes: number): void => {
    measuredBytes += bytes;
    if (measuredBytes > maxBytes) {
      throw new ElectronStateWorkerProtocolError(
        'PAYLOAD_TOO_LARGE',
        `Worker message exceeds ${maxBytes} bytes`,
      );
    }
  };

  const visit = (value: unknown, depth: number): void => {
    visitedNodes++;
    if (visitedNodes > MAX_PROTOCOL_NODES) {
      throw new ElectronStateWorkerProtocolError(
        'PAYLOAD_TOO_LARGE',
        'Worker message contains too many values',
      );
    }
    if (depth > MAX_PROTOCOL_DEPTH) {
      throw new ElectronStateWorkerProtocolError(
        'MAX_DEPTH_EXCEEDED',
        `Worker message exceeds nesting depth ${MAX_PROTOCOL_DEPTH}`,
      );
    }

    if (value === null) {
      addBytes(4);
      return;
    }
    switch (typeof value) {
      case 'string':
        addBytes(8 + value.length * 2);
        return;
      case 'number':
        if (!Number.isFinite(value)) {
          throw new ElectronStateWorkerProtocolError(
            'UNSUPPORTED_VALUE',
            'Worker message contains a non-finite number',
          );
        }
        addBytes(8);
        return;
      case 'boolean':
        addBytes(4);
        return;
      case 'object':
        break;
      default:
        throw new ElectronStateWorkerProtocolError(
          'UNSUPPORTED_VALUE',
          'Worker message contains a non-cloneable JSON value',
        );
    }

    if (seen.has(value)) {
      throw new ElectronStateWorkerProtocolError(
        'UNSUPPORTED_VALUE',
        'Worker message contains a cyclic value',
      );
    }
    seen.add(value);
    try {
      if (value instanceof Uint8Array) {
        addBytes(16 + value.byteLength);
        return;
      }
      if (Array.isArray(value)) {
        addBytes(16);
        for (const item of value) visit(item, depth + 1);
        return;
      }
      if (!isPlainObject(value)) {
        throw new ElectronStateWorkerProtocolError(
          'UNSUPPORTED_VALUE',
          'Worker message contains a non-plain object',
        );
      }
      addBytes(16);
      for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        addBytes(8 + key.length * 2);
        visit((value as Record<string, unknown>)[key], depth + 1);
      }
    } finally {
      seen.delete(value);
    }
  };

  visit(input, 0);
}

/**
 * Bounded preflight traversal that preserves valid JSON-compatible semantics
 * without whole-value JSON.stringify on the main thread.
 *
 * Rejects cyclic references, non-plain objects (such as Date, RegExp, Map, Set,
 * custom class instances), non-finite numbers, and unsupported types before any
 * transaction begins or mutation occurs. Allows null-prototype plain objects.
 */
export function assertJsonCompatibleValue(
  input: unknown,
  maxDepth = MAX_PROTOCOL_DEPTH,
): void {
  const activePath = new Set<object>();

  const visit = (value: unknown, depth: number): void => {
    if (depth > maxDepth) {
      throw new ElectronStateWorkerProtocolError(
        'MAX_DEPTH_EXCEEDED',
        `Worker message exceeds nesting depth ${maxDepth}`,
      );
    }
    if (value === null || typeof value === 'boolean') {
      return;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new ElectronStateWorkerProtocolError(
          'UNSUPPORTED_VALUE',
          'Worker message contains a non-finite number',
        );
      }
      return;
    }
    if (typeof value === 'string') {
      return;
    }
    if (typeof value === 'object') {
      if (activePath.has(value)) {
        throw new ElectronStateWorkerProtocolError(
          'UNSUPPORTED_VALUE',
          'Worker message contains a cyclic value',
        );
      }
      activePath.add(value);
      try {
        if (Array.isArray(value)) {
          for (const item of value) {
            visit(item, depth + 1);
          }
          return;
        }
        if (!isPlainObject(value)) {
          throw new ElectronStateWorkerProtocolError(
            'UNSUPPORTED_VALUE',
            'Worker message contains a non-plain object',
          );
        }
        for (const [key, nested] of Object.entries(value)) {
          visit(nested, depth + 1);
        }
        return;
      } finally {
        activePath.delete(value);
      }
    }
    throw new ElectronStateWorkerProtocolError(
      'UNSUPPORTED_VALUE',
      'Worker message contains a non-cloneable JSON value',
    );
  };

  visit(input, 0);
}

export function parseElectronStateWorkerRequest(
  input: unknown,
): ElectronStateWorkerRequest {
  assertElectronStateWorkerPayloadWithinBudget(input);
  const result = electronStateWorkerRequestSchema.safeParse(input);
  if (!result.success) {
    throw new ElectronStateWorkerProtocolError(
      'INVALID_MESSAGE',
      'Invalid Electron state worker request',
    );
  }
  return result.data;
}

export function parseElectronStateWorkerResponse(
  input: unknown,
): ElectronStateWorkerResponse {
  assertElectronStateWorkerPayloadWithinBudget(input);
  const result = electronStateWorkerResponseSchema.safeParse(input);
  if (!result.success) {
    throw new ElectronStateWorkerProtocolError(
      'INVALID_MESSAGE',
      'Invalid Electron state worker response',
    );
  }
  return result.data;
}

export function assertMonotonicWorkerOperationId(
  previousOperationId: number,
  nextOperationId: number,
): void {
  if (
    !Number.isSafeInteger(previousOperationId) ||
    previousOperationId < 0 ||
    !Number.isSafeInteger(nextOperationId) ||
    nextOperationId <= previousOperationId
  ) {
    throw new ElectronStateWorkerProtocolError(
      'NON_MONOTONIC_OPERATION',
      'Worker operation ids must increase monotonically',
    );
  }
}

export function setSnapshotPath(
  root: Record<string, JsonValue>,
  jsonPath: readonly (string | number)[],
  value: JsonValue,
): void {
  const first = jsonPath[0];
  if (typeof first !== 'string')
    throw new Error('Snapshot root key is invalid');
  if (jsonPath.length === 1) {
    root[first] = value;
    return;
  }
  let current: JsonValue | undefined = root[first];
  for (let index = 1; index < jsonPath.length - 1; index++) {
    const segment = jsonPath[index];
    if (current === null || typeof current !== 'object') {
      throw new Error('Snapshot operation parent is missing');
    }
    current = (current as Record<string | number, JsonValue>)[segment];
  }
  if (current === null || typeof current !== 'object') {
    throw new Error('Snapshot operation parent is missing');
  }
  const final = jsonPath[jsonPath.length - 1];
  (current as Record<string | number, JsonValue>)[final] = value;
}

export const SNAPSHOT_STRING_SLICE_BYTES = 32 * 1024;
const UTF8_ENCODER = new TextEncoder();

/**
 * Calculates UTF-8 byte length without allocating an encoded copy of the
 * string. This is safe on the Electron main thread even for a large value.
 */
export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * Encodes a string into bounded transferable slices. Chunks end on Unicode
 * code-point boundaries so a surrogate pair is never split across messages.
 */
export function* generateUtf8StringSlices(
  value: string,
  sliceBytes = SNAPSHOT_STRING_SLICE_BYTES,
): Generator<{ byteOffset: number; bytes: Uint8Array<ArrayBuffer> }> {
  let codeUnitOffset = 0;
  let byteOffset = 0;
  while (codeUnitOffset < value.length) {
    let end = codeUnitOffset;
    let estimatedBytes = 0;
    while (end < value.length) {
      const codePoint = value.codePointAt(end);
      if (codePoint === undefined) break;
      const codeUnits = codePoint > 0xffff ? 2 : 1;
      const codePointBytes =
        codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
      if (estimatedBytes + codePointBytes > sliceBytes) break;
      estimatedBytes += codePointBytes;
      end += codeUnits;
    }
    if (end === codeUnitOffset) {
      throw new ElectronStateWorkerProtocolError(
        'PAYLOAD_TOO_LARGE',
        'String slice budget is too small for a UTF-8 code point',
      );
    }
    const bytes = new Uint8Array(sliceBytes);
    const encoded = UTF8_ENCODER.encodeInto(value.slice(codeUnitOffset, end), bytes);
    if (encoded.read !== end - codeUnitOffset || encoded.written === 0) {
      throw new ElectronStateWorkerProtocolError(
        'UNSUPPORTED_VALUE',
        'Unable to encode a UTF-8 string slice',
      );
    }
    const exactBytes = new Uint8Array(new ArrayBuffer(encoded.written));
    exactBytes.set(bytes.subarray(0, encoded.written));
    yield { byteOffset, bytes: exactBytes };
    byteOffset += exactBytes.byteLength;
    codeUnitOffset = end;
  }
}

export function* generateSnapshotOperations(
  values: Record<string, JsonValue>,
): Generator<SnapshotOperation> {
  const activePath = new Set<object>();

  function* walk(
    value: JsonValue,
    path: (string | number)[],
    depth: number,
  ): Generator<SnapshotOperation> {
    if (depth > MAX_PROTOCOL_DEPTH) {
      throw new ElectronStateWorkerProtocolError(
        'MAX_DEPTH_EXCEEDED',
        `Worker message exceeds nesting depth ${MAX_PROTOCOL_DEPTH}`,
      );
    }
    if (typeof value === 'string') {
      const totalBytes = utf8ByteLength(value);
      if (totalBytes <= SNAPSHOT_STRING_SLICE_BYTES) {
        yield { kind: 'value', path: [...path], value };
        return;
      }
      yield { kind: 'string-start', path: [...path], totalBytes };
      for (const slice of generateUtf8StringSlices(value)) {
        yield {
          kind: 'string-slice',
          path: [...path],
          byteOffset: slice.byteOffset,
          totalBytes,
          bytes: slice.bytes,
        };
      }
      return;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new ElectronStateWorkerProtocolError(
          'UNSUPPORTED_VALUE',
          'Worker message contains a non-finite number',
        );
      }
      yield { kind: 'value', path: [...path], value };
      return;
    }
    if (value === null || typeof value === 'boolean') {
      yield { kind: 'value', path: [...path], value };
      return;
    }
    if (typeof value === 'object') {
      if (activePath.has(value)) {
        throw new ElectronStateWorkerProtocolError(
          'UNSUPPORTED_VALUE',
          'Worker message contains a cyclic value',
        );
      }
      activePath.add(value);
      try {
        if (Array.isArray(value)) {
          yield { kind: 'array', path: [...path] };
          for (let index = 0; index < value.length; index++) {
            yield* walk(value[index], [...path, index], depth + 1);
          }
          return;
        }
        if (!isPlainObject(value)) {
          throw new ElectronStateWorkerProtocolError(
            'UNSUPPORTED_VALUE',
            'Worker message contains a non-plain object',
          );
        }
        yield { kind: 'object', path: [...path] };
        for (const [key, nested] of Object.entries(value)) {
          yield* walk(nested, [...path, key], depth + 1);
        }
        return;
      } finally {
        activePath.delete(value);
      }
    }
    throw new ElectronStateWorkerProtocolError(
      'UNSUPPORTED_VALUE',
      'Worker message contains a non-cloneable JSON value',
    );
  }

  for (const [key, value] of Object.entries(values)) {
    yield* walk(value, [key], 0);
  }
}

export function canSendDirectUpdate(key: string, value: JsonValue): boolean {
  if (typeof value === 'string' && value.length > 16 * 1024) {
    return false;
  }
  try {
    assertElectronStateWorkerPayloadWithinBudget(
      { type: 'update', operationId: 1, key, value },
      64 * 1024,
    );
    return true;
  } catch (error: unknown) {
    if (
      error instanceof ElectronStateWorkerProtocolError &&
      error.code === 'PAYLOAD_TOO_LARGE'
    ) {
      return false;
    }
    throw error;
  }
}

