import type {
  StateStorageArraySplitPlan,
  StateStorageNestedExtractionPlan,
} from '@ptah-extension/platform-core';
import { computeElectronStateArraySplit } from './electron-state-storage-array-split';
import type { JsonValue } from './electron-state-storage-worker-protocol';

const EXTRACTION: StateStorageNestedExtractionPlan = {
  sourceArrayPath: ['children'],
  itemIdPath: ['childId'],
  destinationKeyPrefix: 'bulk:',
  fields: [{ sourcePath: ['parts'] }, { sourcePath: ['events'] }],
  destinationFormat: {
    kind: 'tagged-sequence',
    fields: [
      { sourcePath: ['parts'], tag: 'part' },
      { sourcePath: ['events'], tag: 'event' },
    ],
  },
  onMissingId: 'drop-bulk',
  dropFields: [['text']],
  textFallback: {
    sourcePath: ['text'],
    itemTemplate: { tag: 'part', value: { kind: 'plain', body: '' } },
    contentPath: ['value', 'body'],
  },
  conflictPolicy: { kind: 'prefer-longer-arrays', fields: ['parts', 'events'] },
};

const PLAN: StateStorageArraySplitPlan = {
  kind: 'split-array-value',
  planVersion: 1,
  sourceKey: 'records',
  itemIdPath: ['id'],
  detailKeyPrefix: 'record:',
  indexKey: 'records',
  indexSchemaVersion: 4,
  summaryFields: [{ sourcePath: ['id'] }, { sourcePath: ['title'] }],
  nestedExtractions: [EXTRACTION],
};

function reader(
  values: Record<string, JsonValue>,
): (key: string) => Promise<JsonValue | undefined> {
  return async (key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined;
}

describe('computeElectronStateArraySplit', () => {
  it('drops text that duplicates existing output and counts it once per reference', async () => {
    const outcome = await computeElectronStateArraySplit(
      PLAN,
      reader({
        records: [
          {
            id: 'r1',
            title: 'One',
            children: [
              {
                childId: 'c1',
                text: 'tail',
                parts: ['p1'],
                events: ['e1', 'e2'],
              },
              { childId: 'c2', text: 'tail', parts: ['p2'] },
            ],
          },
        ],
      }),
    );

    expect(outcome.counts).toMatchObject({
      droppedStdoutCount: 2,
      stdoutFallbackCount: 0,
      droppedBulkWithoutIdCount: 0,
      skippedItemCount: 0,
      extractedValueCount: 2,
      itemCount: 1,
    });
    expect(outcome.changes.get('bulk:c1')).toEqual([
      { tag: 'part', value: 'p1' },
      { tag: 'event', value: 'e1' },
      { tag: 'event', value: 'e2' },
    ]);
    expect(outcome.changes.get('record:r1')).toEqual({
      id: 'r1',
      title: 'One',
      children: [{ childId: 'c1' }, { childId: 'c2' }],
    });
  });

  it('writes a single text item only when the destination would be empty', async () => {
    const outcome = await computeElectronStateArraySplit(
      PLAN,
      reader({
        records: [
          {
            id: 'r1',
            children: [{ childId: 'c1', text: 'only text', parts: [] }],
          },
        ],
      }),
    );

    expect(outcome.counts).toMatchObject({
      stdoutFallbackCount: 1,
      droppedStdoutCount: 0,
    });
    expect(outcome.changes.get('bulk:c1')).toEqual([
      { tag: 'part', value: { kind: 'plain', body: 'only text' } },
    ]);
  });

  it('does not fall back when an existing destination already has items', async () => {
    const outcome = await computeElectronStateArraySplit(
      PLAN,
      reader({
        'bulk:c1': [{ tag: 'part', value: 'stored' }],
        records: [{ id: 'r1', children: [{ childId: 'c1', text: 'tail' }] }],
      }),
    );

    expect(outcome.counts).toMatchObject({
      stdoutFallbackCount: 0,
      droppedStdoutCount: 1,
    });
    expect(outcome.changes.get('bulk:c1')).toEqual([
      { tag: 'part', value: 'stored' },
    ]);
  });

  it('converts an object-shaped destination through the same merge', async () => {
    const outcome = await computeElectronStateArraySplit(
      PLAN,
      reader({
        'bulk:c1': { parts: ['a', 'b'], events: [] },
        records: [
          {
            id: 'r1',
            children: [{ childId: 'c1', parts: ['z'], events: ['e'] }],
          },
        ],
      }),
    );

    expect(outcome.changes.get('bulk:c1')).toEqual([
      { tag: 'part', value: 'a' },
      { tag: 'part', value: 'b' },
      { tag: 'event', value: 'e' },
    ]);
  });

  it('drops bulk on a reference without an id and counts only that counter, once', async () => {
    const outcome = await computeElectronStateArraySplit(
      PLAN,
      reader({
        records: [
          {
            id: 'r1',
            children: [
              { text: 'orphan', parts: ['p'], events: ['e'] },
              { childId: '  ', parts: ['p'] },
              { childId: '', label: 'no bulk at all' },
            ],
          },
        ],
      }),
    );

    expect(outcome.counts).toMatchObject({
      droppedBulkWithoutIdCount: 2,
      droppedStdoutCount: 0,
      stdoutFallbackCount: 0,
      extractedValueCount: 0,
    });
    expect(outcome.changes.get('record:r1')).toEqual({
      id: 'r1',
      children: [
        {},
        { childId: '  ' },
        { childId: '', label: 'no bulk at all' },
      ],
    });
  });

  it('skips and counts a source item without a usable id instead of failing', async () => {
    const outcome = await computeElectronStateArraySplit(
      PLAN,
      reader({
        records: [
          { title: 'no id', children: [{ childId: 'c9', text: 'x' }] },
          { id: 'r2', title: 'Two' },
        ],
      }),
    );

    expect(outcome.counts).toMatchObject({ skippedItemCount: 1, itemCount: 2 });
    expect(outcome.changes.has('bulk:c9')).toBe(false);
    expect(outcome.changes.get('records')).toEqual({
      schemaVersion: 4,
      items: [{ id: 'r2', title: 'Two' }],
    });
  });

  it('returns early for an already-split index and for an absent source', async () => {
    const done = await computeElectronStateArraySplit(
      PLAN,
      reader({
        records: { schemaVersion: 4, items: [{ id: 'a' }, { id: 'b' }] },
      }),
    );
    const absent = await computeElectronStateArraySplit(PLAN, reader({}));

    expect(done.changes.size).toBe(0);
    expect(done.counts.itemCount).toBe(2);
    expect(absent.changes.size).toBe(0);
    expect(absent.counts.itemCount).toBe(0);
  });

  it('refuses a source that is neither an array nor a matching index', async () => {
    await expect(
      computeElectronStateArraySplit(
        PLAN,
        reader({ records: { schemaVersion: 1, items: [] } }),
      ),
    ).rejects.toThrow('Split source is not an array');
  });

  it('leaves the source value unmutated', async () => {
    const records = [
      { id: 'r1', children: [{ childId: 'c1', text: 't', parts: ['p'] }] },
    ];
    const snapshot = structuredClone(records);

    await computeElectronStateArraySplit(PLAN, reader({ records }));

    expect(records).toEqual(snapshot);
  });
});
