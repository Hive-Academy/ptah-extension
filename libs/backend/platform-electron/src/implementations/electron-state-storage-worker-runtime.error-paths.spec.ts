/**
 * `ElectronStateWorkerRuntime` — the refusal and merge paths.
 *
 * The runtime is the half of the state store that runs inside the worker
 * thread, and every one of its error branches is a durable-state verdict: a
 * malformed page, a slice out of order, a half-staged write, a split whose
 * source cannot be addressed. The existing suites drive the happy path through
 * the host; these drive the runtime DIRECTLY, which is the only way to reach a
 * refusal without corrupting a fixture on disk (TASK_2026_411 — this file was
 * the worst-covered in the project at 59.8 % branches).
 *
 * The merge cases matter for the same reason: `mergeExtraction` and
 * `mergeTaggedSequence` decide what survives when a split runs a SECOND time
 * over a key it already extracted, which is exactly what a re-migration is.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { StateStorageArraySplitPlan } from '@ptah-extension/platform-core';
import type {
  ElectronStateDurableStep,
  ElectronStateFaultInjector,
} from './electron-state-storage-commit-store';
import { ElectronStateWorkerRuntime } from './electron-state-storage-worker-runtime';
import type {
  ElectronStateWorkerRequest,
  ElectronStateWorkerResponse,
  JsonValue,
} from './electron-state-storage-worker-protocol';

const tmpDirs: string[] = [];
let lastV2Root = '';

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

/**
 * A request minus its `operationId`, distributed over the union.
 *
 * A bare `Omit<Union, 'operationId'>` collapses to the keys EVERY member shares
 * — which is none of the interesting ones — so `legacyFilePath`, `key` and the
 * rest stop existing. This is the same conditional the worker host uses for its
 * own `HostWorkerRequest`.
 */
type RequestWithoutId = ElectronStateWorkerRequest extends infer Request
  ? Request extends { operationId: number }
    ? Omit<Request, 'operationId'>
    : never
  : never;

/** A runtime driver that keeps `operationId` strictly increasing for us. */
class Driver {
  private operationId = 0;

  constructor(readonly runtime: ElectronStateWorkerRuntime) {}

  send(request: RequestWithoutId): Promise<ElectronStateWorkerResponse> {
    return this.runtime.handle({
      ...request,
      operationId: ++this.operationId,
    } as ElectronStateWorkerRequest);
  }

  /** Replay the id just used — the out-of-order case a crashed host produces. */
  replayLastId(
    request: RequestWithoutId,
  ): Promise<ElectronStateWorkerResponse> {
    return this.runtime.handle({
      ...request,
      operationId: this.operationId,
    } as ElectronStateWorkerRequest);
  }
}

async function started(
  migrations: readonly StateStorageArraySplitPlan[] = [],
  legacy: Record<string, JsonValue> = {},
  runtime = new ElectronStateWorkerRuntime(),
): Promise<Driver> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-runtime-'));
  tmpDirs.push(dir);
  const legacyFilePath = path.join(dir, 'workspace-state.json');
  await fs.writeFile(legacyFilePath, JSON.stringify(legacy), 'utf8');
  lastV2Root = path.join(dir, 'workspace-state.v2');
  const driver = new Driver(runtime);
  const ready = await driver.send({
    type: 'initialize',
    legacyFilePath,
    v2RootPath: path.join(dir, 'workspace-state.v2'),
    migrations: [...migrations],
  });
  expect(ready.type).toBe('ready');
  return driver;
}

function failureCode(response: ElectronStateWorkerResponse): string {
  expect(response.type).toBe('failure');
  return response.type === 'failure' ? response.code : response.type;
}

describe('ElectronStateWorkerRuntime — refusals', () => {
  it('refuses a replayed operation id instead of acting on it twice', async () => {
    const driver = await started();
    await driver.send({ type: 'update', key: 'a', value: 1 });

    expect(
      failureCode(await driver.replayLastId({ type: 'get', key: 'a' })),
    ).toBe('operation-out-of-order');
  });

  it('reports not-ready for any request that precedes initialize', async () => {
    const driver = new Driver(new ElectronStateWorkerRuntime());

    expect(failureCode(await driver.send({ type: 'get', key: 'a' }))).toBe(
      'not-ready',
    );
  });

  it('answers get for a present and an absent key', async () => {
    const driver = await started();
    await driver.send({ type: 'update', key: 'present', value: { n: 1 } });

    const found = await driver.send({ type: 'get', key: 'present' });
    const missing = await driver.send({ type: 'get', key: 'absent' });

    expect(found).toMatchObject({
      type: 'value',
      found: true,
      value: { n: 1 },
    });
    expect(missing).toMatchObject({ type: 'value', found: false });
  });

  it('delete removes the key from subsequent reads', async () => {
    const driver = await started();
    await driver.send({ type: 'update', key: 'gone', value: 'x' });
    await driver.send({ type: 'delete', key: 'gone' });

    expect(await driver.send({ type: 'get', key: 'gone' })).toMatchObject({
      found: false,
    });
  });

  it('refuses to read a non-array value as a JSON sequence', async () => {
    const driver = await started();
    await driver.send({ type: 'update', key: 'scalar', value: 'not-a-list' });

    expect(
      failureCode(
        await driver.send({
          type: 'read-json-sequence',
          key: 'scalar',
          maxBytes: 64 * 1024,
        }),
      ),
    ).toBe('not-a-sequence');
  });

  it('refuses a sequence cursor that is not a valid offset', async () => {
    const driver = await started();
    await driver.send({ type: 'update', key: 'list', value: [1, 2, 3] });

    expect(
      failureCode(
        await driver.send({
          type: 'read-json-sequence',
          key: 'list',
          cursor: 'not-a-number',
          maxBytes: 64 * 1024,
        }),
      ),
    ).toBe('cursor-stale');
    expect(
      failureCode(
        await driver.send({
          type: 'read-json-sequence',
          key: 'list',
          cursor: 'g99.1',
          maxBytes: 64 * 1024,
        }),
      ),
    ).toBe('cursor-stale');
  });

  it('pages a sequence and reports the cursor and done flag', async () => {
    const driver = await started();
    await driver.send({ type: 'update', key: 'list', value: [1, 2, 3] });

    const page = await driver.send({
      type: 'read-json-sequence',
      key: 'list',
      maxBytes: 64 * 1024,
    });

    expect(page).toMatchObject({
      type: 'json-sequence-page',
      items: [1, 2, 3],
      nextCursor: null,
      done: true,
    });
  });

  it('refuses a sequence item that cannot shrink into its own page budget', async () => {
    const driver = await started();
    await driver.send({
      type: 'update',
      key: 'list',
      value: ['x'.repeat(400)],
    });

    const response = await driver.send({
      type: 'read-json-sequence',
      key: 'list',
      maxBytes: 64,
    });

    expect(failureCode(response)).toBe('value-too-large');
    expect(response).toMatchObject({ valueBytes: 402 });
  });

  it('shrinks a single oversized item and reports it in truncatedItems', async () => {
    const driver = await started();
    await driver.send({
      type: 'update',
      key: 'list',
      value: [{ tag: 'event', text: 'x'.repeat(5_000) }, 'next'],
    });

    const page = await driver.send({
      type: 'read-json-sequence',
      key: 'list',
      maxBytes: 4_096,
    });

    expect(page).toMatchObject({
      type: 'json-sequence-page',
      done: false,
      truncatedItems: [{ index: 0 }],
    });
    if (page.type !== 'json-sequence-page') return;
    expect(page.items).toHaveLength(1);
    expect(JSON.stringify(page.items[0])).toContain('[truncated');
    const rest = await driver.send({
      type: 'read-json-sequence',
      key: 'list',
      cursor: page.nextCursor ?? undefined,
      maxBytes: 4_096,
    });
    expect(rest).toMatchObject({ items: ['next'], done: true });
    expect(rest).not.toHaveProperty('truncatedItems');
  });

  it('answers cursor-stale when a sequence is rewritten between pages', async () => {
    const driver = await started();
    await driver.send({
      type: 'update',
      key: 'list',
      value: Array.from({ length: 50 }, (_, index) => `item-${index}`),
    });
    const first = await driver.send({
      type: 'read-json-sequence',
      key: 'list',
      maxBytes: 512,
    });
    expect(first).toMatchObject({ type: 'json-sequence-page', done: false });
    await driver.send({ type: 'update', key: 'list', value: ['rewritten'] });

    expect(
      failureCode(
        await driver.send({
          type: 'read-json-sequence',
          key: 'list',
          cursor:
            first.type === 'json-sequence-page'
              ? (first.nextCursor ?? undefined)
              : undefined,
          maxBytes: 512,
        }),
      ),
    ).toBe('cursor-stale');
  });

  it('refuses appends and commits against an unknown sequence write', async () => {
    const driver = await started();

    expect(
      failureCode(
        await driver.send({
          type: 'append-json-sequence-items',
          sequenceId: 'never-begun',
          items: [1],
        }),
      ),
    ).toBe('internal-error');
    expect(
      failureCode(
        await driver.send({
          type: 'commit-json-sequence-write',
          sequenceId: 'never-begun',
        }),
      ),
    ).toBe('internal-error');
  });

  it('refuses item operations that skip ahead of the next item index', async () => {
    const driver = await started();
    await driver.send({
      type: 'begin-json-sequence-write',
      sequenceId: 's1',
      key: 'list',
    });

    expect(
      failureCode(
        await driver.send({
          type: 'append-json-sequence-item-ops',
          sequenceId: 's1',
          itemIndex: 1,
          operations: [{ kind: 'value', path: ['item'], value: 1 }],
        }),
      ),
    ).toBe('internal-error');
  });

  it('assembles items from operation pages between whole items and commits them in order', async () => {
    const driver = await started();
    const bytes = new TextEncoder().encode('hello world');
    await driver.send({
      type: 'begin-json-sequence-write',
      sequenceId: 's1',
      key: 'list',
    });
    await driver.send({
      type: 'append-json-sequence-items',
      sequenceId: 's1',
      items: ['first'],
    });
    await driver.send({
      type: 'append-json-sequence-item-ops',
      sequenceId: 's1',
      itemIndex: 1,
      operations: [
        { kind: 'object', path: ['item'] },
        {
          kind: 'string-start',
          path: ['item', 'text'],
          totalBytes: bytes.byteLength,
        },
      ],
    });
    await driver.send({
      type: 'append-json-sequence-item-ops',
      sequenceId: 's1',
      itemIndex: 1,
      operations: [
        {
          kind: 'string-slice',
          path: ['item', 'text'],
          byteOffset: 0,
          totalBytes: bytes.byteLength,
          bytes,
        },
      ],
    });
    await driver.send({
      type: 'append-json-sequence-item-ops',
      sequenceId: 's1',
      itemIndex: 2,
      operations: [{ kind: 'value', path: ['item'], value: 3 }],
    });
    await driver.send({
      type: 'commit-json-sequence-write',
      sequenceId: 's1',
    });

    expect(await driver.send({ type: 'get', key: 'list' })).toMatchObject({
      value: ['first', { text: 'hello world' }, 3],
    });
  });

  it('refuses to commit a sequence whose item strings are still incomplete', async () => {
    const driver = await started();
    await driver.send({
      type: 'begin-json-sequence-write',
      sequenceId: 's1',
      key: 'list',
    });
    await driver.send({
      type: 'append-json-sequence-item-ops',
      sequenceId: 's1',
      itemIndex: 0,
      operations: [
        { kind: 'string-start', path: ['item'], totalBytes: 10 },
        {
          kind: 'string-slice',
          path: ['item'],
          byteOffset: 0,
          totalBytes: 10,
          bytes: new Uint8Array(4),
        },
      ],
    });

    expect(
      failureCode(
        await driver.send({
          type: 'commit-json-sequence-write',
          sequenceId: 's1',
        }),
      ),
    ).toBe('internal-error');
  });

  it('aborting a staged write discards it and succeeds', async () => {
    const driver = await started();
    await driver.send({
      type: 'begin-json-sequence-write',
      sequenceId: 's1',
      key: 'list',
    });
    await driver.send({
      type: 'begin-scalar-write',
      writeId: 'w1',
      key: 'blob',
    });

    expect(
      await driver.send({
        type: 'abort-json-sequence-write',
        sequenceId: 's1',
      }),
    ).toMatchObject({ type: 'success' });
    expect(
      await driver.send({ type: 'abort-scalar-write', writeId: 'w1' }),
    ).toMatchObject({ type: 'success' });
    // Both are gone: a later append must not find them.
    expect(
      failureCode(
        await driver.send({
          type: 'append-scalar-write-page',
          writeId: 'w1',
          operations: [{ kind: 'value', path: ['blob'], value: 1 }],
        }),
      ),
    ).toBe('internal-error');
  });

  it('refuses a scalar page whose path does not match the write key', async () => {
    const driver = await started();
    await driver.send({
      type: 'begin-scalar-write',
      writeId: 'w1',
      key: 'blob',
    });

    expect(
      failureCode(
        await driver.send({
          type: 'append-scalar-write-page',
          writeId: 'w1',
          operations: [{ kind: 'value', path: ['other'], value: 1 }],
        }),
      ),
    ).toBe('internal-error');
  });

  it('refuses to commit a scalar write whose root value was never set', async () => {
    const driver = await started();
    await driver.send({
      type: 'begin-scalar-write',
      writeId: 'w1',
      key: 'blob',
    });

    expect(
      failureCode(
        await driver.send({ type: 'commit-scalar-write', writeId: 'w1' }),
      ),
    ).toBe('internal-error');
  });

  it('commits a scalar write assembled from object and slice operations', async () => {
    const driver = await started();
    const bytes = new TextEncoder().encode('sliced');
    await driver.send({
      type: 'begin-scalar-write',
      writeId: 'w1',
      key: 'blob',
    });
    await driver.send({
      type: 'append-scalar-write-page',
      writeId: 'w1',
      operations: [
        { kind: 'object', path: ['blob'] },
        { kind: 'array', path: ['blob', 'list'] },
        { kind: 'value', path: ['blob', 'n'], value: 7 },
        {
          kind: 'string-start',
          path: ['blob', 'text'],
          totalBytes: bytes.byteLength,
        },
        {
          kind: 'string-slice',
          path: ['blob', 'text'],
          byteOffset: 0,
          totalBytes: bytes.byteLength,
          bytes,
        },
      ],
    });
    await driver.send({ type: 'commit-scalar-write', writeId: 'w1' });

    expect(await driver.send({ type: 'get', key: 'blob' })).toMatchObject({
      value: { list: [], n: 7, text: 'sliced' },
    });
  });

  it('refuses a scalar string slice arriving out of order', async () => {
    const driver = await started();
    await driver.send({
      type: 'begin-scalar-write',
      writeId: 'w1',
      key: 'blob',
    });

    expect(
      failureCode(
        await driver.send({
          type: 'append-scalar-write-page',
          writeId: 'w1',
          operations: [
            { kind: 'string-start', path: ['blob'], totalBytes: 8 },
            {
              kind: 'string-slice',
              path: ['blob'],
              byteOffset: 4,
              totalBytes: 8,
              bytes: new Uint8Array(4),
            },
          ],
        }),
      ),
    ).toBe('internal-error');
  });

  it('refuses an unknown snapshot cursor', async () => {
    const driver = await started();

    expect(
      failureCode(
        await driver.send({
          type: 'read-snapshot-page',
          cursor: 'no-such-cursor',
          maxBytes: 64 * 1024,
        }),
      ),
    ).toBe('cursor-stale');
  });

  it('omits excluded key prefixes from the snapshot it hydrates', async () => {
    const driver = await started();
    await driver.send({ type: 'update', key: 'keep', value: 1 });
    await driver.send({ type: 'update', key: 'bulk:one', value: 2 });

    const page = await driver.send({
      type: 'read-snapshot-page',
      maxBytes: 64 * 1024,
      excludeKeyPrefixes: ['bulk:'],
    });

    expect(page.type).toBe('snapshot-page');
    const paths =
      page.type === 'snapshot-page'
        ? page.operations.map((operation) => operation.path.join('.'))
        : [];
    expect(paths).toContain('keep');
    expect(paths).not.toContain('bulk:one');
  });
});

describe('ElectronStateWorkerRuntime — split-array-value', () => {
  const basePlan: StateStorageArraySplitPlan = {
    kind: 'split-array-value',
    planVersion: 1,
    sourceKey: 'sessions',
    itemIdPath: ['id'],
    detailKeyPrefix: 'session:',
    indexKey: 'sessions.index',
    indexSchemaVersion: 3,
    summaryFields: [{ sourcePath: ['id'] }, { sourcePath: ['title'] }],
  };

  async function split(
    driver: Driver,
    plan: StateStorageArraySplitPlan = basePlan,
  ): Promise<ElectronStateWorkerResponse> {
    return await driver.send({ type: 'split-array-value', plan });
  }

  it('reports an empty receipt when the source key does not exist', async () => {
    const driver = await started();

    const response = await split(driver);

    expect(response).toMatchObject({
      type: 'migration-receipt',
      receipt: { sourceKey: 'sessions', itemCount: 0, extractedValueCount: 0 },
    });
  });

  it('splits an array into detail keys and a versioned index', async () => {
    const driver = await started();
    await driver.send({
      type: 'update',
      key: 'sessions',
      value: [
        { id: 'a', title: 'First', body: 'long-a' },
        { id: 'b', title: 'Second', body: 'long-b' },
      ],
    });

    const response = await split(driver);

    expect(response).toMatchObject({
      type: 'migration-receipt',
      receipt: { itemCount: 2 },
    });
    expect(await driver.send({ type: 'get', key: 'session:a' })).toMatchObject({
      value: { id: 'a', title: 'First', body: 'long-a' },
    });
    expect(
      await driver.send({ type: 'get', key: 'sessions.index' }),
    ).toMatchObject({
      value: {
        schemaVersion: 3,
        items: [
          { id: 'a', title: 'First' },
          { id: 'b', title: 'Second' },
        ],
      },
    });
  });

  it('treats an already-migrated index object as done rather than a failure', async () => {
    const driver = await started();
    await driver.send({
      type: 'update',
      key: 'sessions',
      value: { schemaVersion: 3, items: [{ id: 'a' }] },
    });

    expect(await split(driver)).toMatchObject({
      type: 'migration-receipt',
      receipt: { itemCount: 1, extractedValueCount: 0 },
    });
  });

  it('refuses a source that is neither an array nor a matching index', async () => {
    const driver = await started();
    await driver.send({
      type: 'update',
      key: 'sessions',
      value: { schemaVersion: 1, items: [] },
    });

    expect(failureCode(await split(driver))).toBe('internal-error');
  });

  it('skips and counts a source item with no usable id', async () => {
    const driver = await started();
    await driver.send({
      type: 'update',
      key: 'sessions',
      value: [
        { id: '   ', title: 'blank' },
        { id: 'b', title: 'kept' },
      ],
    });

    expect(await split(driver)).toMatchObject({
      type: 'migration-receipt',
      receipt: { itemCount: 2, skippedItemCount: 1 },
    });
    expect(
      await driver.send({ type: 'get', key: 'sessions.index' }),
    ).toMatchObject({ value: { items: [{ id: 'b', title: 'kept' }] } });
  });

  it('requires targetField when a summary path ends in an array index', async () => {
    const driver = await started();
    await driver.send({
      type: 'update',
      key: 'sessions',
      value: [{ id: 'a', tags: ['x'] }],
    });

    expect(
      failureCode(
        await split(driver, {
          ...basePlan,
          summaryFields: [{ sourcePath: ['tags', 0] }],
        }),
      ),
    ).toBe('internal-error');
  });

  it('drops bulk from an extraction item with no id and counts it once', async () => {
    const driver = await started();
    await driver.send({
      type: 'update',
      key: 'sessions',
      value: [{ id: 'a', messages: [{ text: 'orphan' }] }],
    });

    const response = await split(driver, {
      ...basePlan,
      nestedExtractions: [
        {
          sourceArrayPath: ['messages'],
          itemIdPath: ['msgId'],
          destinationKeyPrefix: 'message:',
          fields: [{ sourcePath: ['text'] }],
          onMissingId: 'drop-bulk',
          dropFields: [],
          conflictPolicy: { kind: 'replace' },
        },
      ],
    });

    expect(response).toMatchObject({
      type: 'migration-receipt',
      receipt: { droppedBulkWithoutIdCount: 1, extractedValueCount: 0 },
    });
    expect(await driver.send({ type: 'get', key: 'session:a' })).toMatchObject({
      value: { id: 'a', messages: [{}] },
    });
  });

  it('replace policy overwrites an extraction destination on a re-run', async () => {
    const driver = await started();
    const plan: StateStorageArraySplitPlan = {
      ...basePlan,
      nestedExtractions: [
        {
          sourceArrayPath: ['messages'],
          itemIdPath: ['msgId'],
          destinationKeyPrefix: 'message:',
          fields: [{ sourcePath: ['text'] }],
          onMissingId: 'drop-bulk',
          dropFields: [],
          conflictPolicy: { kind: 'replace' },
        },
      ],
    };
    await driver.send({
      type: 'update',
      key: 'message:m1',
      value: { text: 'stale' },
    });
    await driver.send({
      type: 'update',
      key: 'sessions',
      value: [{ id: 'a', messages: [{ msgId: 'm1', text: 'fresh' }] }],
    });

    await split(driver, plan);

    expect(await driver.send({ type: 'get', key: 'message:m1' })).toMatchObject(
      { value: { text: 'fresh' } },
    );
  });

  it('prefer-longer-arrays keeps the existing array when the incoming one is shorter', async () => {
    const driver = await started();
    const plan: StateStorageArraySplitPlan = {
      ...basePlan,
      nestedExtractions: [
        {
          sourceArrayPath: ['messages'],
          itemIdPath: ['msgId'],
          destinationKeyPrefix: 'message:',
          fields: [{ sourcePath: ['parts'] }, { sourcePath: ['author'] }],
          onMissingId: 'drop-bulk',
          dropFields: [],
          conflictPolicy: { kind: 'prefer-longer-arrays', fields: ['parts'] },
        },
      ],
    };
    await driver.send({
      type: 'update',
      key: 'message:m1',
      value: { parts: ['p1', 'p2', 'p3'], author: 'old' },
    });
    await driver.send({
      type: 'update',
      key: 'sessions',
      value: [
        {
          id: 'a',
          messages: [{ msgId: 'm1', parts: ['p1'], author: 'new' }],
        },
      ],
    });

    await split(driver, plan);

    // The longer array survives; every other field takes the incoming value.
    expect(await driver.send({ type: 'get', key: 'message:m1' })).toMatchObject(
      { value: { parts: ['p1', 'p2', 'p3'], author: 'new' } },
    );
  });

  it('merges a tagged sequence, keeping the longer run per tag', async () => {
    const driver = await started();
    const plan: StateStorageArraySplitPlan = {
      ...basePlan,
      nestedExtractions: [
        {
          sourceArrayPath: ['messages'],
          itemIdPath: ['msgId'],
          destinationKeyPrefix: 'message:',
          fields: [{ sourcePath: ['parts'] }],
          destinationFormat: {
            kind: 'tagged-sequence',
            fields: [{ sourcePath: ['parts'], tag: 'part' }],
          },
          onMissingId: 'drop-bulk',
          dropFields: [],
          conflictPolicy: { kind: 'prefer-longer-arrays', fields: ['parts'] },
        },
      ],
    };
    await driver.send({
      type: 'update',
      key: 'sessions',
      value: [{ id: 'a', messages: [{ msgId: 'm1', parts: ['one', 'two'] }] }],
    });

    await split(driver, plan);
    const afterFirst = await driver.send({ type: 'get', key: 'message:m1' });
    expect(afterFirst).toMatchObject({
      value: [
        { tag: 'part', value: 'one' },
        { tag: 'part', value: 'two' },
      ],
    });

    // Re-run with a SHORTER run: the stored array is the existing side and wins.
    await driver.send({
      type: 'update',
      key: 'sessions',
      value: [{ id: 'a', messages: [{ msgId: 'm1', parts: ['solo'] }] }],
    });
    await split(driver, plan);

    expect(await driver.send({ type: 'get', key: 'message:m1' })).toMatchObject(
      {
        value: [
          { tag: 'part', value: 'one' },
          { tag: 'part', value: 'two' },
        ],
      },
    );
  });

  it('merges a tagged sequence whose stored form is still an object', async () => {
    const driver = await started();
    const plan: StateStorageArraySplitPlan = {
      ...basePlan,
      nestedExtractions: [
        {
          sourceArrayPath: ['messages'],
          itemIdPath: ['msgId'],
          destinationKeyPrefix: 'message:',
          fields: [{ sourcePath: ['parts'] }],
          destinationFormat: {
            kind: 'tagged-sequence',
            fields: [{ sourcePath: ['parts'], tag: 'part' }],
          },
          onMissingId: 'drop-bulk',
          dropFields: [],
          conflictPolicy: { kind: 'prefer-longer-arrays', fields: ['parts'] },
        },
      ],
    };
    // The pre-split shape: an object carrying the arrays, not a tagged list.
    await driver.send({
      type: 'update',
      key: 'message:m1',
      value: { parts: ['a', 'b', 'c'] },
    });
    await driver.send({
      type: 'update',
      key: 'sessions',
      value: [{ id: 'a', messages: [{ msgId: 'm1', parts: ['z'] }] }],
    });

    await split(driver, plan);

    expect(await driver.send({ type: 'get', key: 'message:m1' })).toMatchObject(
      {
        value: [
          { tag: 'part', value: 'a' },
          { tag: 'part', value: 'b' },
          { tag: 'part', value: 'c' },
        ],
      },
    );
  });

  it('a migration that fails during initialize is reported as recovery-required', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-runtime-'));
    tmpDirs.push(dir);
    const legacyFilePath = path.join(dir, 'workspace-state.json');
    // A source that is neither an array nor a matching index: the split throws,
    // and initialize must convert that into a recovery verdict rather than a
    // bare io failure — the store is unusable until a human intervenes.
    await fs.writeFile(
      legacyFilePath,
      JSON.stringify({ sessions: { schemaVersion: 1 } }),
      'utf8',
    );
    const driver = new Driver(new ElectronStateWorkerRuntime());

    const response = await driver.send({
      type: 'initialize',
      legacyFilePath,
      v2RootPath: path.join(dir, 'workspace-state.v2'),
      migrations: [basePlan],
    });

    expect(response).toMatchObject({
      type: 'failure',
      code: 'recovery-required',
      recoveryReason: 'migration-failed',
    });
  });
});

function faultAt(
  target: ElectronStateDurableStep,
  sideEffect?: () => Promise<void>,
): ElectronStateFaultInjector & { arm(): void } {
  let armed = false;
  return {
    arm() {
      armed = true;
    },
    async after(step) {
      if (!armed || step !== target) return;
      armed = false;
      await sideEffect?.();
      throw new Error(`injected:${step}`);
    },
  };
}

async function currentGeneration(): Promise<number> {
  const pointer = JSON.parse(
    await fs.readFile(path.join(lastV2Root, 'CURRENT'), 'utf8'),
  ) as { generation: number };
  return pointer.generation;
}

describe('ElectronStateWorkerRuntime — commit reconcile or retire', () => {
  it('replies commit-failed landed:false when nothing was published and commits a fresh generation next', async () => {
    const fault = faultAt('manifest-verified');
    const driver = await started(
      [],
      { value: 'before' },
      new ElectronStateWorkerRuntime(fault),
    );
    fault.arm();

    expect(
      await driver.send({ type: 'update', key: 'value', value: 'lost' }),
    ).toMatchObject({ type: 'failure', code: 'commit-failed', landed: false });
    expect(await driver.send({ type: 'get', key: 'value' })).toMatchObject({
      value: 'before',
    });
    expect(
      await driver.send({ type: 'update', key: 'value', value: 'after' }),
    ).toMatchObject({ type: 'success' });
    expect(await currentGeneration()).toBe(3);
  });

  it.each(['current-renamed', 'current-verified'] as const)(
    'adopts a generation published before a fault at %s and keeps serving',
    async (step) => {
      const fault = faultAt(step);
      const driver = await started(
        [],
        { value: 'before' },
        new ElectronStateWorkerRuntime(fault),
      );
      fault.arm();

      expect(
        await driver.send({ type: 'update', key: 'value', value: 'landed' }),
      ).toMatchObject({ type: 'failure', code: 'commit-failed', landed: true });
      expect(await driver.send({ type: 'get', key: 'value' })).toMatchObject({
        value: 'landed',
      });
      expect(
        await driver.send({ type: 'update', key: 'other', value: 1 }),
      ).toMatchObject({ type: 'success' });
      expect(await currentGeneration()).toBe(3);
    },
  );

  it('retires with a recovery reason when CURRENT cannot be read after a failed commit', async () => {
    const fault = faultAt('current-renamed', async () => {
      await fs.writeFile(path.join(lastV2Root, 'CURRENT'), 'not json', 'utf8');
    });
    const driver = await started(
      [],
      { value: 'before' },
      new ElectronStateWorkerRuntime(fault),
    );
    fault.arm();

    const retired = {
      type: 'failure',
      code: 'recovery-required',
      recoveryReason: 'current-pointer-invalid',
    };
    expect(
      await driver.send({ type: 'update', key: 'value', value: 'x' }),
    ).toMatchObject(retired);
    expect(await driver.send({ type: 'get', key: 'value' })).toMatchObject(
      retired,
    );
  });

  it('retires as commit-uncertain when CURRENT names an unexpected generation', async () => {
    const fault = faultAt('current-renamed', async () => {
      const pointerPath = path.join(lastV2Root, 'CURRENT');
      const pointer = JSON.parse(await fs.readFile(pointerPath, 'utf8')) as {
        generation: number;
      };
      await fs.writeFile(
        pointerPath,
        JSON.stringify({ ...pointer, generation: 99 }),
        'utf8',
      );
    });
    const driver = await started(
      [],
      { value: 'before' },
      new ElectronStateWorkerRuntime(fault),
    );
    fault.arm();

    expect(
      await driver.send({ type: 'update', key: 'value', value: 'x' }),
    ).toMatchObject({ type: 'failure', code: 'commit-uncertain' });
    expect(
      await driver.send({
        type: 'read-json-sequence',
        key: 'value',
        maxBytes: 1024,
      }),
    ).toMatchObject({ type: 'failure', code: 'commit-uncertain' });
  });
});

describe('ElectronStateWorkerRuntime — stateless projected reads', () => {
  const fatRecord = {
    title: 'record',
    children: Array.from({ length: 6 }, (_, index) => ({
      childId: `c${index}`,
      note: 'n'.repeat(30_000),
      raw: 'r'.repeat(60_000),
    })),
  };
  const projection = { omit: [['children', '*', 'raw']] };

  it('returns value-paged with a projection-bound cursor and never pages omitted fields', async () => {
    const driver = await started([], { record: fatRecord });

    const first = await driver.send({ type: 'get', key: 'record', projection });
    expect(first.type).toBe('value-paged');
    if (first.type !== 'value-paged') return;
    expect(first.nextCursor).toMatch(/^g1\.p[a-f0-9]{16}\.\d+$/);

    const operations = [...first.operations];
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await driver.send({
        type: 'read-scalar-page',
        key: 'record',
        cursor,
        maxBytes: 256 * 1024,
        projection,
      });
      expect(page.type).toBe('scalar-page');
      if (page.type !== 'scalar-page') return;
      operations.push(...page.operations);
      cursor = page.nextCursor;
    }
    expect(operations.some((operation) => operation.path.includes('raw'))).toBe(
      false,
    );
    expect(
      operations.some((operation) => operation.path.includes('note')),
    ).toBe(true);
  });

  it('answers cursor-stale for a changed or missing projection on continuation', async () => {
    const driver = await started([], { record: fatRecord });
    const first = await driver.send({ type: 'get', key: 'record', projection });
    if (first.type !== 'value-paged' || !first.nextCursor) {
      throw new Error('expected a paged projected read');
    }

    expect(
      failureCode(
        await driver.send({
          type: 'read-scalar-page',
          key: 'record',
          cursor: first.nextCursor,
          maxBytes: 256 * 1024,
          projection: { omit: [['children', '*', 'note']] },
        }),
      ),
    ).toBe('cursor-stale');
    expect(
      failureCode(
        await driver.send({
          type: 'read-scalar-page',
          key: 'record',
          cursor: first.nextCursor,
          maxBytes: 256 * 1024,
        }),
      ),
    ).toBe('cursor-stale');
  });

  it('refuses a projected value over the 1 MiB ceiling without sending content', async () => {
    const driver = await started([], {
      record: { children: [{ note: 'm'.repeat(1_100_000), raw: 'r' }] },
    });

    const response = await driver.send({
      type: 'get',
      key: 'record',
      projection,
    });

    expect(response).toEqual({
      type: 'failure',
      operationId: expect.any(Number),
      code: 'value-too-large',
      valueBytes: expect.any(Number),
    });
  });

  it('keeps no state for abandoned scalar, sequence and snapshot reads', async () => {
    const runtime = new ElectronStateWorkerRuntime(undefined, {
      valueCacheMaxBytes: 4 * 1024 * 1024,
    });
    const driver = await started(
      [],
      {
        record: fatRecord,
        list: Array.from({ length: 2_000 }, (_, index) => `entry-${index}`),
      },
      runtime,
    );
    const heapBefore = process.memoryUsage().heapUsed;

    for (let index = 0; index < 1_000; index++) {
      await driver.send({ type: 'get', key: 'record', projection });
      await driver.send({
        type: 'read-json-sequence',
        key: 'list',
        maxBytes: 1024,
      });
      await driver.send({ type: 'read-snapshot-page', maxBytes: 4 * 1024 });
    }

    const internals = runtime as unknown as Record<string, unknown>;
    const mapSizes = Object.values(internals)
      .filter((value): value is Map<unknown, unknown> => value instanceof Map)
      .map((map) => map.size);
    expect(mapSizes.length).toBeGreaterThan(0);
    expect(mapSizes.every((size) => size === 0)).toBe(true);
    const stats = runtime.valueCacheStats();
    expect(stats?.bytes).toBeLessThanOrEqual(stats?.maxBytes ?? 0);
    expect(process.memoryUsage().heapUsed - heapBefore).toBeLessThan(
      64 * 1024 * 1024,
    );
  }, 180_000);
});
