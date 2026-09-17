import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  StateStorageRecoveryRequiredError,
  type StateStorageArraySplitPlan,
} from '@ptah-extension/platform-core';
import {
  computeElectronStateArraySplit,
  type ElectronStateSplitCounts,
} from './electron-state-storage-array-split';
import {
  ElectronStateCommitError,
  ElectronStateCommitStore,
  type ElectronStateDurableStep,
  type ElectronStateFaultInjector,
} from './electron-state-storage-commit-store';
import { commitLegacyStateSplit } from './electron-state-storage-legacy-split';
import type { ElectronStateManifest } from './electron-state-storage-manifest';
import type {
  ElectronStateWorkerResponse,
  JsonValue,
} from './electron-state-storage-worker-protocol';
import { ElectronStateWorkerRuntime } from './electron-state-storage-worker-runtime';

interface CommittedStore {
  readonly root: string;
  readonly manifest: ElectronStateManifest;
  readonly counts: readonly ElectronStateSplitCounts[];
}

const OUTPUT_PLAN: StateStorageArraySplitPlan = {
  kind: 'split-array-value',
  planVersion: 1,
  sourceKey: 'records',
  itemIdPath: ['recordId'],
  detailKeyPrefix: 'record:',
  indexKey: 'records',
  indexSchemaVersion: 1,
  summaryFields: [
    { sourcePath: ['recordId'] },
    { sourcePath: ['name'] },
    { sourcePath: ['totals'] },
    { sourcePath: ['totals', 'input'], targetField: 'input' },
  ],
  nestedExtractions: [
    {
      sourceArrayPath: ['children'],
      itemIdPath: ['childId'],
      destinationKeyPrefix: 'output:',
      fields: [{ sourcePath: ['segments'] }, { sourcePath: ['streamEvents'] }],
      destinationFormat: {
        kind: 'tagged-sequence',
        fields: [
          { sourcePath: ['segments'], tag: 'segment' },
          { sourcePath: ['streamEvents'], tag: 'streamEvent' },
        ],
      },
      onMissingId: 'drop-bulk',
      dropFields: [['stdout']],
      textFallback: {
        sourcePath: ['stdout'],
        itemTemplate: { tag: 'segment', value: { type: 'text', content: '' } },
        contentPath: ['value', 'content'],
      },
      conflictPolicy: {
        kind: 'prefer-longer-arrays',
        fields: ['segments', 'streamEvents'],
      },
    },
    {
      sourceArrayPath: ['attachments'],
      itemIdPath: ['attachmentId'],
      destinationKeyPrefix: 'attachment:',
      fields: [{ sourcePath: ['body'] }, { sourcePath: ['meta'] }],
      onMissingId: 'drop-bulk',
      dropFields: [['raw']],
      conflictPolicy: { kind: 'prefer-longer-arrays', fields: ['body'] },
    },
  ],
};

const SECOND_PLAN: StateStorageArraySplitPlan = {
  kind: 'split-array-value',
  planVersion: 1,
  sourceKey: 'beta.list',
  itemIdPath: ['id'],
  detailKeyPrefix: 'beta:',
  indexKey: 'beta.list',
  indexSchemaVersion: 4,
  summaryFields: [{ sourcePath: ['id'] }],
  nestedExtractions: [
    {
      sourceArrayPath: ['parts'],
      itemIdPath: ['partId'],
      destinationKeyPrefix: 'betaPart:',
      fields: [{ sourcePath: ['text'] }],
      onMissingId: 'drop-bulk',
      dropFields: [],
      conflictPolicy: { kind: 'replace' },
    },
  ],
};

const BLOB_STEPS: readonly ElectronStateDurableStep[] = [
  'blob-written',
  'blob-flushed',
  'blob-renamed',
  'blob-verified',
];

const ONCE_STEPS: readonly ElectronStateDurableStep[] = [
  'manifest-written',
  'manifest-flushed',
  'manifest-renamed',
  'manifest-verified',
  'current-written',
  'current-flushed',
];

jest.setTimeout(120_000);

const tmpDirs: string[] = [];

afterEach(async () => {
  jest.restoreAllMocks();
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-legacy-split-'));
  tmpDirs.push(dir);
  return dir;
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = [
  'a',
  'Z',
  ' ',
  '"',
  '\\',
  '/',
  'é',
  '界',
  '😀',
  '\n',
  '\t',
  '}',
  ']',
];

function textFrom(random: () => number, length: number): string {
  let text = '';
  for (let index = 0; index < length; index++) {
    text += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return text;
}

function events(random: () => number, count: number): JsonValue[] {
  return Array.from({ length: count }, (_, seq) => ({
    type: 'delta',
    seq,
    payload: textFrom(random, 8 + Math.floor(random() * 24)),
  }));
}

function child(
  random: () => number,
  childId: string | null,
  shape: 'fat' | 'stdout-only' | 'segments-only' | 'empty',
): JsonValue {
  const reference: Record<string, JsonValue> = {
    cli: 'tool',
    task: textFrom(random, 12),
  };
  if (childId !== null) reference['childId'] = childId;
  if (shape === 'fat' || shape === 'stdout-only') {
    reference['stdout'] = textFrom(random, 40);
  }
  if (shape === 'fat' || shape === 'segments-only') {
    reference['segments'] = [{ type: 'text', content: textFrom(random, 16) }];
    reference['streamEvents'] = events(random, 1 + Math.floor(random() * 4));
  }
  return reference;
}

function buildLegacy(
  seed: number,
  bigString: boolean,
): Record<string, JsonValue> {
  const random = seeded(seed);
  const legacy: Record<string, JsonValue> = {};
  legacy['before:plain'] = {
    note: textFrom(random, 30),
    list: [1, 2.5, -0, 1e21],
  };
  legacy['output:pre-existing'] = {
    segments: [
      { type: 'text', content: 'old one' },
      { type: 'text', content: 'old two' },
    ],
    streamEvents: events(random, 6),
  };
  legacy['attachment:kept'] = { body: ['a', 'b', 'c'], meta: { size: 3 } };
  legacy['record:r-01'] = { stale: true };
  legacy['12'] = 'integer-like key';
  legacy['0'] = [textFrom(random, 5)];
  legacy['quote " key \\ back'] = 'value with "quotes" and \\ backslash \\"';
  legacy['astral 😀 界 key'] = textFrom(random, 64);
  if (bigString) {
    legacy['big'] = 'x界😀"\\'.repeat(Math.ceil((1.1 * 1024 * 1024) / 12));
  }
  const records: JsonValue[] = [];
  for (let index = 0; index < 14; index++) {
    const recordId = `r-${String(index).padStart(2, '0')}`;
    const children: JsonValue[] = [
      child(random, `c-${index}`, index % 4 === 0 ? 'stdout-only' : 'fat'),
    ];
    if (index % 3 === 1)
      children.push(child(random, `c-${index}-b`, 'segments-only'));
    if (index === 2 || index === 9)
      children.push(child(random, 'shared', 'fat'));
    if (index === 5) children.push(child(random, 'shared', 'stdout-only'));
    if (index === 3)
      children.push(child(random, 'pre-existing', 'stdout-only'));
    if (index === 4)
      children.push(child(random, 'post-existing', 'segments-only'));
    if (index === 6) children.push(child(random, null, 'fat'));
    if (index === 7) children.push(child(random, null, 'empty'));
    if (index === 8) children.push(child(random, '   ', 'stdout-only'));
    if (index === 10) children.push(child(random, 'empty-child', 'empty'));
    records.push({
      recordId,
      name: textFrom(random, 10),
      totals: { input: index * 100, output: index * 50 },
      children,
      attachments: [
        {
          attachmentId: index % 2 === 0 ? 'kept' : `att-${index}`,
          body: ['z'],
          meta: { index },
          raw: 'drop me',
        },
        { body: ['no id'], raw: 'no id raw' },
      ],
    });
  }
  records.push({
    name: 'missing id',
    children: [child(random, 'never', 'fat')],
  });
  records.push({ recordId: '  ', name: 'blank id' });
  records.push({
    recordId: 'r-03',
    name: 'duplicate id',
    children: [
      child(random, 'dup-child', 'fat'),
      child(random, 'shared', 'segments-only'),
    ],
  });
  records.push({ recordId: 7, name: 'numeric id', children: [] });
  records.push('not an object');
  legacy['records'] = records;
  legacy['output:post-existing'] = [
    { tag: 'segment', value: { type: 'text', content: 'post one' } },
    { tag: 'streamEvent', value: { seq: 0 } },
    { tag: 'streamEvent', value: { seq: 1 } },
  ];
  legacy['output:unreferenced'] = { segments: [], note: 'untouched' };
  legacy['record:orphan'] = { recordId: 'orphan' };
  legacy['after:plain'] = [null, true, false, { nested: [[], {}] }];
  return legacy;
}

function serialize(legacy: Record<string, JsonValue>, pretty: boolean): string {
  return pretty ? JSON.stringify(legacy, null, 2) : JSON.stringify(legacy);
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeLegacy(dir: string, text: string): Promise<string> {
  const legacyPath = path.join(dir, 'workspace-state.json');
  await fs.writeFile(legacyPath, text, 'utf8');
  return legacyPath;
}

async function oracleCommit(
  dir: string,
  legacyPath: string | null,
  migrations: readonly StateStorageArraySplitPlan[],
): Promise<CommittedStore> {
  const bytes =
    legacyPath === null
      ? Buffer.from('{}', 'utf8')
      : await fs.readFile(legacyPath);
  const values = new Map(
    Object.entries(
      JSON.parse(bytes.toString('utf8')) as Record<string, JsonValue>,
    ),
  );
  const counts: ElectronStateSplitCounts[] = [];
  for (const plan of migrations) {
    const outcome = await computeElectronStateArraySplit(plan, async (key) =>
      values.get(key),
    );
    for (const [key, value] of outcome.changes) values.set(key, value);
    counts.push(outcome.counts);
  }
  const root = path.join(dir, `oracle-${tmpDirs.length}-${Date.now()}.v2`);
  const store = new ElectronStateCommitStore(
    path.join(dir, 'unused.json'),
    root,
  );
  await store.initialize();
  const manifest = await store.commitInitialStream(
    sha256(bytes),
    async (sink) => {
      for (const [key, value] of values) await sink.put(key, value);
    },
  );
  return { root, manifest, counts };
}

async function streamCommit(
  legacyPath: string,
  root: string,
  migrations: readonly StateStorageArraySplitPlan[],
  faultInjector?: ElectronStateFaultInjector,
): Promise<CommittedStore> {
  const store = new ElectronStateCommitStore(legacyPath, root, faultInjector);
  const loaded = await store.initialize();
  expect(loaded).toEqual({ kind: 'legacy', legacyFilePath: legacyPath });
  const outcome = await commitLegacyStateSplit(store, legacyPath, migrations);
  return { root, manifest: outcome.manifest, counts: outcome.counts };
}

async function expectSameStore(
  stream: CommittedStore,
  oracle: CommittedStore,
): Promise<void> {
  const keys = Object.keys(oracle.manifest.values).sort();
  expect(Object.keys(stream.manifest.values).sort()).toEqual(keys);
  for (const key of keys) {
    const expected = oracle.manifest.values[key];
    const actual = stream.manifest.values[key];
    expect({
      key,
      byteLength: actual.byteLength,
      sha256: actual.sha256,
    }).toEqual({
      key,
      byteLength: expected.byteLength,
      sha256: expected.sha256,
    });
    const [actualBytes, expectedBytes] = await Promise.all([
      fs.readFile(path.join(stream.root, actual.relativePath)),
      fs.readFile(path.join(oracle.root, expected.relativePath)),
    ]);
    expect(Buffer.compare(actualBytes, expectedBytes)).toBe(0);
  }
  expect(stream.manifest.sourceV1Sha256).toBe(oracle.manifest.sourceV1Sha256);
  expect(stream.counts).toEqual(oracle.counts);
}

async function quarantineCount(dir: string): Promise<number> {
  return (await fs.readdir(dir)).filter((name) => name.includes('.quarantine.'))
    .length;
}

describe('commitLegacyStateSplit differential against the in-memory split', () => {
  it.each([
    ['pretty', 1, true],
    ['compact', 2, true],
    ['pretty', 3, false],
    ['compact', 4, false],
  ] as const)(
    'writes byte-identical blobs and receipts for a %s file (seed %i)',
    async (format, seed, bigString) => {
      const dir = await tempDir();
      const legacyPath = await writeLegacy(
        dir,
        serialize(buildLegacy(seed, bigString), format === 'pretty'),
      );

      const oracle = await oracleCommit(dir, legacyPath, [OUTPUT_PLAN]);
      const stream = await streamCommit(
        legacyPath,
        path.join(dir, 'workspace-state.v2'),
        [OUTPUT_PLAN],
      );

      await expectSameStore(stream, oracle);
      const [counts] = stream.counts;
      expect(counts.extractedValueCount).toBeGreaterThan(0);
      expect(counts.droppedStdoutCount).toBeGreaterThan(0);
      expect(counts.stdoutFallbackCount).toBeGreaterThan(0);
      expect(counts.droppedBulkWithoutIdCount).toBeGreaterThan(0);
      expect(counts.skippedItemCount).toBe(3);
      expect(Object.keys(stream.manifest.values)).toEqual(
        expect.arrayContaining([
          'output:pre-existing',
          'output:post-existing',
          'output:unreferenced',
          'output:shared',
          'record:orphan',
          'record:r-03',
          'record:7',
          'attachment:kept',
        ]),
      );
    },
  );

  it('matches an absent source key', async () => {
    const dir = await tempDir();
    const legacy = buildLegacy(5, false);
    delete legacy['records'];
    const legacyPath = await writeLegacy(dir, serialize(legacy, true));

    const stream = await streamCommit(
      legacyPath,
      path.join(dir, 'workspace-state.v2'),
      [OUTPUT_PLAN],
    );

    await expectSameStore(
      stream,
      await oracleCommit(dir, legacyPath, [OUTPUT_PLAN]),
    );
    expect(stream.counts[0]).toMatchObject({
      itemCount: 0,
      sourceSha256: sha256('null'),
    });
  });

  it('matches an index-shaped source and leaves it untouched', async () => {
    const dir = await tempDir();
    const legacy = buildLegacy(6, false);
    legacy['records'] = {
      schemaVersion: 1,
      items: [{ recordId: 'a' }, { recordId: 'b' }],
    };
    const legacyPath = await writeLegacy(dir, serialize(legacy, false));

    const stream = await streamCommit(
      legacyPath,
      path.join(dir, 'workspace-state.v2'),
      [OUTPUT_PLAN],
    );

    await expectSameStore(
      stream,
      await oracleCommit(dir, legacyPath, [OUTPUT_PLAN]),
    );
    expect(stream.counts[0]).toMatchObject({ itemCount: 2 });
  });

  it('matches two disjoint plans', async () => {
    const dir = await tempDir();
    const legacy = buildLegacy(7, false);
    legacy['beta.list'] = [
      { id: 'b1', parts: [{ partId: 'p1', text: 'one' }, { text: 'orphan' }] },
      {
        id: 'b2',
        parts: [
          { partId: 'p1', text: 'again' },
          { partId: 'p2', text: 'two' },
        ],
      },
      { id: 'b1', parts: [] },
    ];
    legacy['betaPart:p2'] = { text: 'older' };
    const legacyPath = await writeLegacy(dir, serialize(legacy, true));
    const migrations = [OUTPUT_PLAN, SECOND_PLAN];

    const stream = await streamCommit(
      legacyPath,
      path.join(dir, 'workspace-state.v2'),
      migrations,
    );

    await expectSameStore(
      stream,
      await oracleCommit(dir, legacyPath, migrations),
    );
    expect(stream.counts.map((entry) => entry.sourceKey)).toEqual([
      'records',
      'beta.list',
    ]);
  });

  it.each([
    ['present', true],
    ['missing', false],
  ])(
    'refuses a plan whose index key differs from its source key with v1 %s',
    async (_label, present) => {
      const dir = await tempDir();
      const legacyPath = path.join(dir, 'workspace-state.json');
      if (present) {
        await writeLegacy(dir, JSON.stringify({ 'beta.list': [{ id: 'b1' }] }));
      }
      const root = path.join(dir, 'workspace-state.v2');
      const store = new ElectronStateCommitStore(legacyPath, root);
      await store.initialize();
      const stream = jest.spyOn(store, 'commitInitialStream');

      const failure = await commitLegacyStateSplit(store, legacyPath, [
        { ...SECOND_PLAN, indexKey: 'beta.index' },
      ]).then(
        () => null,
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(StateStorageRecoveryRequiredError);
      expect((failure as StateStorageRecoveryRequiredError).reason).toBe(
        'migration-failed',
      );
      expect(stream).not.toHaveBeenCalled();
      await expect(fs.access(root)).rejects.toBeDefined();
    },
  );

  it('matches an empty source array and a missing v1 file', async () => {
    const dir = await tempDir();
    const legacyPath = await writeLegacy(dir, '{"records": []}');
    await expectSameStore(
      await streamCommit(legacyPath, path.join(dir, 'a.v2'), [OUTPUT_PLAN]),
      await oracleCommit(dir, legacyPath, [OUTPUT_PLAN]),
    );

    const missingPath = path.join(dir, 'missing.json');
    const missing = await streamCommit(missingPath, path.join(dir, 'b.v2'), [
      OUTPUT_PLAN,
    ]);
    await expectSameStore(
      missing,
      await oracleCommit(dir, null, [OUTPUT_PLAN]),
    );
    expect(missing.manifest.values).toEqual({});
    expect(missing.manifest.sourceV1Sha256).toBe(sha256('{}'));
  });
});

describe('commitLegacyStateSplit malformed v1 through the runtime', () => {
  const smallFixture = JSON.stringify({
    before: 'x',
    records: [{ recordId: 'a', children: [{ childId: 'c', stdout: 'o' }] }],
    after: [1, 2],
  });

  async function initialize(
    dir: string,
    legacyPath: string,
  ): Promise<ElectronStateWorkerResponse> {
    return await new ElectronStateWorkerRuntime().handle({
      type: 'initialize',
      operationId: 1,
      legacyFilePath: legacyPath,
      v2RootPath: path.join(dir, 'workspace-state.v2'),
      migrations: [OUTPUT_PLAN],
    });
  }

  async function expectRefused(
    text: string,
    incompleteV2: boolean,
  ): Promise<void> {
    const dir = await tempDir();
    const legacyPath = await writeLegacy(dir, text);
    const v2Root = path.join(dir, 'workspace-state.v2');
    if (incompleteV2) {
      await fs.mkdir(path.join(v2Root, 'values'), { recursive: true });
      await fs.writeFile(
        path.join(v2Root, 'values', 'stray.json'),
        '1',
        'utf8',
      );
    }
    const before = await fs.readFile(legacyPath);
    const stream = jest.spyOn(
      ElectronStateCommitStore.prototype,
      'commitInitialStream',
    );

    const response = await initialize(dir, legacyPath);

    expect(response).toEqual({
      type: 'failure',
      operationId: 1,
      code: 'recovery-required',
      recoveryReason: 'migration-failed',
    });
    expect(stream).not.toHaveBeenCalled();
    expect(Buffer.compare(before, await fs.readFile(legacyPath))).toBe(0);
    expect(await quarantineCount(dir)).toBe(0);
    if (incompleteV2) {
      await fs.access(path.join(v2Root, 'values', 'stray.json'));
    } else {
      await expect(fs.access(v2Root)).rejects.toBeDefined();
    }
    stream.mockRestore();
  }

  it('refuses a truncation at every byte of a small fixture', async () => {
    const end = smallFixture.lastIndexOf('}');
    for (let length = 0; length <= end; length++) {
      await expectRefused(smallFixture.slice(0, length), false);
    }
  });

  it.each([
    ['an unterminated string', '{"records": [], "a": "open}'],
    ['trailing garbage', '{"records": []} trailing'],
    ['an array top level', '[{"records": []}]'],
    ['a primitive top level', 'null'],
    ['a byte order mark', String.fromCharCode(0xfeff) + '{"records": []}'],
    ['an invalid number inside a span', '{"records": [], "a": 01}'],
    ['an invalid literal inside a span', '{"records": [], "a": nul}'],
    [
      'an invalid element inside the split array',
      '{"records": [{"recordId": "a"}, tru]}',
    ],
    ['a non-finite number', '{"records": [], "a": 1e999}'],
    ['a duplicate top-level key', '{"records": [], "a": 1, "a": 2}'],
    [
      'a source that is neither an array nor an index',
      '{"records": {"schemaVersion": 99}}',
    ],
  ])('refuses %s before any v2 write', async (_label, text) => {
    await expectRefused(text, false);
  });

  it('does not quarantine an existing incomplete v2 when v1 is malformed', async () => {
    await expectRefused('{"records": [', true);
  });

  it('boots an empty committed store when v1 is missing', async () => {
    const dir = await tempDir();
    const response = await initialize(dir, path.join(dir, 'missing.json'));

    expect(response).toMatchObject({
      type: 'ready',
      generation: 1,
      migrationReceipts: [
        { sourceKey: 'records', itemCount: 0, sourceSha256: sha256('null') },
      ],
    });
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(dir, 'workspace-state.v2', 'manifests', 'manifest.1.json'),
        'utf8',
      ),
    ) as ElectronStateManifest;
    expect(manifest.values).toEqual({});
    expect(manifest.sourceV1Sha256).toBe(sha256('{}'));
  });
});

describe('commitLegacyStateSplit crash and change safety', () => {
  function failOnOccurrence(
    target: ElectronStateDurableStep,
    occurrence: number,
  ): ElectronStateFaultInjector {
    let seen = 0;
    return {
      after(step) {
        if (step === target && ++seen === occurrence) {
          throw new Error(`injected:${step}#${occurrence}`);
        }
      },
    };
  }

  const crashText = serialize(buildLegacy(11, false), false);

  async function blobCount(): Promise<number> {
    const dir = await tempDir();
    const legacyPath = await writeLegacy(dir, crashText);
    const oracle = await oracleCommit(dir, legacyPath, [OUTPUT_PLAN]);
    return Object.keys(oracle.manifest.values).length;
  }

  it('recovers from a fault at every durable step on the first, a middle and the last blob', async () => {
    const blobs = await blobCount();
    const cases: [ElectronStateDurableStep, number][] = [
      ...BLOB_STEPS.flatMap((step) =>
        [1, Math.ceil(blobs / 2), blobs].map(
          (occurrence): [ElectronStateDurableStep, number] => [
            step,
            occurrence,
          ],
        ),
      ),
      ...ONCE_STEPS.map((step): [ElectronStateDurableStep, number] => [
        step,
        1,
      ]),
    ];
    for (const [step, occurrence] of cases) {
      const dir = await tempDir();
      const legacyPath = await writeLegacy(dir, crashText);
      const root = path.join(dir, 'workspace-state.v2');

      const failure = await streamCommit(
        legacyPath,
        root,
        [OUTPUT_PLAN],
        failOnOccurrence(step, occurrence),
      ).then(
        () => null,
        (error: unknown) => error,
      );

      expect({ step, occurrence, failure }).toEqual({
        step,
        occurrence,
        failure: expect.any(ElectronStateCommitError),
      });
      expect((failure as ElectronStateCommitError).phase).toBe(
        'pre-publication',
      );
      await expect(fs.access(path.join(root, 'CURRENT'))).rejects.toBeDefined();

      const recovered = await streamCommit(legacyPath, root, [OUTPUT_PLAN]);
      expect(await quarantineCount(dir)).toBe(1);
      await expectSameStore(
        recovered,
        await oracleCommit(dir, legacyPath, [OUTPUT_PLAN]),
      );
    }
  }, 300_000);

  it.each([
    [
      'mtime',
      async (legacyPath: string) => {
        const later = new Date(Date.now() + 120_000);
        await fs.utimes(legacyPath, later, later);
      },
    ],
    [
      'size',
      async (legacyPath: string) => {
        await fs.appendFile(legacyPath, ' ', 'utf8');
      },
    ],
  ])(
    'refuses to publish when the v1 %s changes between the passes',
    async (_label, change) => {
      const dir = await tempDir();
      const legacyPath = await writeLegacy(dir, crashText);
      const root = path.join(dir, 'workspace-state.v2');
      let changed = false;
      const injector: ElectronStateFaultInjector = {
        async after(step) {
          if (step === 'blob-written' && !changed) {
            changed = true;
            await change(legacyPath);
          }
        },
      };

      const failure = await streamCommit(
        legacyPath,
        root,
        [OUTPUT_PLAN],
        injector,
      ).then(
        () => null,
        (error: unknown) => error,
      );

      expect(changed).toBe(true);
      expect(failure).toBeInstanceOf(StateStorageRecoveryRequiredError);
      expect((failure as StateStorageRecoveryRequiredError).reason).toBe(
        'migration-failed',
      );
      await expect(fs.access(path.join(root, 'CURRENT'))).rejects.toBeDefined();
      expect(
        await new ElectronStateCommitStore(legacyPath, root).initialize(),
      ).toEqual({ kind: 'legacy', legacyFilePath: legacyPath });
    },
  );

  async function pinnedLegacy(dir: string): Promise<string> {
    const legacyPath = await writeLegacy(dir, crashText);
    const pinned = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
    await fs.utimes(legacyPath, pinned, pinned);
    return legacyPath;
  }

  async function expectRefusedAfterFirstBlob(
    dir: string,
    legacyPath: string,
    change: () => Promise<void>,
  ): Promise<void> {
    const root = path.join(dir, 'workspace-state.v2');
    let changed = false;
    const injector: ElectronStateFaultInjector = {
      async after(step) {
        if (step === 'blob-verified' && !changed) {
          changed = true;
          await change();
        }
      },
    };

    const failure = await streamCommit(
      legacyPath,
      root,
      [OUTPUT_PLAN],
      injector,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(changed).toBe(true);
    expect(failure).toBeInstanceOf(StateStorageRecoveryRequiredError);
    expect((failure as StateStorageRecoveryRequiredError).reason).toBe(
      'migration-failed',
    );
    await expect(fs.access(path.join(root, 'CURRENT'))).rejects.toBeDefined();
  }

  it('refuses a same-size, same-mtime rewrite of a span between the passes', async () => {
    const dir = await tempDir();
    const legacyPath = await pinnedLegacy(dir);
    const before = await fs.stat(legacyPath, { bigint: true });
    const target = Buffer.from('"recordId":"r-13"', 'utf8');
    const replacement = Buffer.from('"recordId":"r-99"', 'utf8');
    const offset = (await fs.readFile(legacyPath)).indexOf(target);
    expect(offset).toBeGreaterThan(0);

    await expectRefusedAfterFirstBlob(dir, legacyPath, async () => {
      const writer = await fs.open(legacyPath, 'r+');
      try {
        await writer.write(replacement, 0, replacement.length, offset);
      } finally {
        await writer.close();
      }
      await fs.utimes(legacyPath, before.atime, before.mtime);
      const after = await fs.stat(legacyPath, { bigint: true });
      expect({
        size: after.size,
        mtimeNs: after.mtimeNs,
        ino: after.ino,
      }).toEqual({
        size: before.size,
        mtimeNs: before.mtimeNs,
        ino: before.ino,
      });
    });
  });

  it('refuses a v1 path that names a different file after the passes', async () => {
    const dir = await tempDir();
    const legacyPath = await pinnedLegacy(dir);
    const nodeFs =
      jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
    const stat = nodeFs.stat;

    await expectRefusedAfterFirstBlob(dir, legacyPath, async () => {
      jest.spyOn(nodeFs, 'stat').mockImplementation((async (
        file: string,
        options?: { bigint?: boolean },
      ) => {
        const real = await stat(file, { bigint: true });
        if (!options?.bigint || file !== legacyPath) {
          return await stat(file, options);
        }
        return Object.assign(
          Object.create(Object.getPrototypeOf(real) as object) as object,
          real,
          { ino: real.ino + 1n },
        );
      }) as unknown as typeof nodeFs.stat);
    });
  });

  it('publishes nothing when a pass-2 span read fails', async () => {
    const dir = await tempDir();
    const legacyPath = await writeLegacy(dir, crashText);
    const root = path.join(dir, 'workspace-state.v2');
    const nodeFs =
      jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
    const open = nodeFs.open;
    let reads = 0;
    let armed = false;
    jest.spyOn(nodeFs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (flags !== 'r') return handle;
      const read = handle.read.bind(handle) as (...args: unknown[]) => unknown;
      (handle as unknown as { read: (...args: unknown[]) => unknown }).read = (
        ...args: unknown[]
      ) => {
        if (armed) {
          reads++;
          return Promise.reject(
            Object.assign(new Error('EIO: injected read failure'), {
              code: 'EIO',
              syscall: 'read',
            }),
          );
        }
        return read(...args);
      };
      return handle;
    });
    const injector: ElectronStateFaultInjector = {
      after(step) {
        if (step === 'blob-verified') armed = true;
      },
    };

    const failure = await streamCommit(
      legacyPath,
      root,
      [OUTPUT_PLAN],
      injector,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(reads).toBeGreaterThan(0);
    expect(failure).toBeInstanceOf(ElectronStateCommitError);
    expect((failure as ElectronStateCommitError).phase).toBe('pre-publication');
    await expect(fs.access(path.join(root, 'CURRENT'))).rejects.toBeDefined();
  });
});
