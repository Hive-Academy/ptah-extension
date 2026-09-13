import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  StateStorageArraySplitPlan,
  StateStorageMigrationReceipt,
} from '@ptah-extension/platform-core';
import { ElectronStateStorage } from './electron-state-storage';
import type {
  ElectronStateWorkerFactory,
  ElectronStateWorkerLike,
} from './electron-state-storage-worker-host';
import { createElectronStateWorkerMessageLoop } from './electron-state-storage-worker-loop';
import { ElectronStateWorkerRuntime } from './electron-state-storage-worker-runtime';

const STORAGE_KEY = 'ptah.sessionMetadata';
const SESSION_DETAIL_KEY_PREFIX = 'ptah.session:';
const AGENT_OUTPUT_KEY_PREFIX = 'ptah.agentOutput:';
const SESSION_INDEX_SCHEMA_VERSION = 1;

const DETAIL_PROJECTION = {
  omit: [
    ['cliSessions', '*', 'stdout'],
    ['cliSessions', '*', 'segments'],
    ['cliSessions', '*', 'streamEvents'],
  ],
};

const SESSION_METADATA_MIGRATION_MIRROR: StateStorageArraySplitPlan = {
  kind: 'split-array-value',
  planVersion: 1,
  sourceKey: STORAGE_KEY,
  itemIdPath: ['sessionId'],
  detailKeyPrefix: SESSION_DETAIL_KEY_PREFIX,
  indexKey: STORAGE_KEY,
  indexSchemaVersion: SESSION_INDEX_SCHEMA_VERSION,
  summaryFields: [
    { sourcePath: ['sessionId'] },
    { sourcePath: ['name'] },
    { sourcePath: ['workspaceId'] },
    { sourcePath: ['createdAt'] },
    { sourcePath: ['lastActiveAt'] },
    { sourcePath: ['totalCost'] },
    { sourcePath: ['totalTokens'] },
    { sourcePath: ['isChildSession'] },
  ],
  nestedExtractions: [
    {
      sourceArrayPath: ['cliSessions'],
      itemIdPath: ['agentId'],
      destinationKeyPrefix: AGENT_OUTPUT_KEY_PREFIX,
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
  ],
};

const SESSION_COUNT = 1000;
const FAT_SESSION_ID = 'fat-session-0000';
const BIG_ITEM_AGENT_ID = 'agent-with-1mb-event';
const NO_DEST_AGENT_ID = 'agent-stdout-no-dest';
const NO_DEST_STDOUT = 'y'.repeat(500);

interface Fixture {
  readonly dir: string;
  readonly filePath: string;
}

interface TaggedItem {
  readonly tag: string;
  readonly value: { readonly type?: string; readonly content?: string };
}

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ptah-state-oversized-'));
}

function makeFatSessionCliSessions(): Record<string, unknown>[] {
  const refs: Record<string, unknown>[] = [];
  for (let i = 0; i < 28; i++) {
    refs.push({
      agentId: `agent-${String(i).padStart(2, '0')}`,
      stdout: 'x'.repeat(102_400),
      segments: [{ kind: 'text', text: `segment-${i}` }],
      streamEvents: [{ type: 'assistant-delta', seq: i }],
    });
  }
  refs.push({
    agentId: BIG_ITEM_AGENT_ID,
    stdout: '',
    segments: [],
    streamEvents: [
      { type: 'assistant-delta', seq: 0, command: 'c'.repeat(1_100_000) },
    ],
  });
  refs.push({ agentId: NO_DEST_AGENT_ID, stdout: NO_DEST_STDOUT });
  refs.push({ stdout: 'z'.repeat(200) });
  return refs;
}

async function buildOversizedV1Fixture(): Promise<Fixture> {
  const dir = await makeTempDir();
  const sessions: Record<string, unknown>[] = [];
  for (let i = 0; i < SESSION_COUNT - 1; i++) {
    const padded = String(i).padStart(4, '0');
    sessions.push({
      sessionId: `session-${padded}`,
      name: `Session number ${padded}`,
      workspaceId: 'workspace-alpha',
      createdAt: Date.UTC(2026, 0, 1) + i,
      lastActiveAt: Date.UTC(2026, 0, 1) + i,
      totalCost: 0.01 * i,
      totalTokens: { input: 100 * i, output: 50 * i },
      cliSessions: [],
      isChildSession: false,
    });
  }
  sessions.push({
    sessionId: FAT_SESSION_ID,
    name: 'Fat session',
    workspaceId: 'workspace-alpha',
    createdAt: Date.UTC(2026, 0, 2),
    lastActiveAt: Date.UTC(2026, 0, 2),
    totalCost: 1.23,
    totalTokens: { input: 1000, output: 2000 },
    cliSessions: makeFatSessionCliSessions(),
    isChildSession: false,
  });
  sessions.push({
    name: 'Session with no id',
    workspaceId: 'workspace-alpha',
    cliSessions: [{ agentId: 'agent-of-idless-session', stdout: 'lost' }],
  });

  const body = JSON.stringify({
    [STORAGE_KEY]: sessions,
    [`${AGENT_OUTPUT_KEY_PREFIX}legacy-agent`]: {
      segments: [{ kind: 'text', text: 'legacy object-shaped output' }],
      streamEvents: [],
    },
  });
  const filePath = path.join(dir, 'state.json');
  await fs.writeFile(filePath, body, 'utf8');
  return { dir, filePath };
}

function createExtractedLoopWorkerFactory(): ElectronStateWorkerFactory {
  return () => {
    const messageListeners: Array<(value: unknown) => void> = [];
    const errorListeners: Array<(error: Error) => void> = [];
    const listener = createElectronStateWorkerMessageLoop(
      new ElectronStateWorkerRuntime(),
      {
        postMessage(value: unknown) {
          const cloned = structuredClone(value);
          for (const messageListener of messageListeners) {
            messageListener(cloned);
          }
        },
      },
    );

    const worker: ElectronStateWorkerLike = {
      postMessage(input: unknown) {
        listener(structuredClone(input));
      },
      on(event: string, handler: (arg: never) => void) {
        if (event === 'message') {
          messageListeners.push(handler as (value: unknown) => void);
        } else if (event === 'error') {
          errorListeners.push(handler as (error: Error) => void);
        }
        return worker;
      },
      unref: () => undefined,
      terminate: async () => 0,
    } as ElectronStateWorkerLike;
    return worker;
  };
}

async function readAll(
  provider: ElectronStateStorage,
  key: string,
): Promise<{ items: TaggedItem[]; truncated: number }> {
  const items: TaggedItem[] = [];
  let truncated = 0;
  for await (const page of provider.readJsonSequence<TaggedItem>(key)) {
    items.push(...page.items);
    truncated += page.truncatedItems?.length ?? 0;
  }
  return { items, truncated };
}

describe('ElectronStateStorage — v1 -> v2 split exceeds the worker message budget (regression, TASK_2026_430)', () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop();
      if (dir) await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('reads and writes the oversized profile through existing entry points with no crash', async () => {
    const fixture = await buildOversizedV1Fixture();
    tmpDirs.push(fixture.dir);
    const receipts: StateStorageMigrationReceipt[] = [];

    const provider = new ElectronStateStorage(fixture.dir, 'state.json', {
      workerPath: '/unused.mjs',
      workerFactory: createExtractedLoopWorkerFactory(),
      migrations: [SESSION_METADATA_MIGRATION_MIRROR],
      cacheExcludeKeyPrefixes: [
        SESSION_DETAIL_KEY_PREFIX,
        AGENT_OUTPUT_KEY_PREFIX,
      ],
      onMigrationReceipt: (receipt) => receipts.push(receipt),
    });

    await provider.whenReady();
    expect(provider.getReadinessState().status).toBe('ready');

    const index = await provider.getAsync<{
      items: readonly { sessionId: string }[];
    }>(STORAGE_KEY);
    expect(index?.items.length).toBe(SESSION_COUNT);

    const detail = await provider.getAsync<{
      cliSessions?: readonly Record<string, unknown>[];
    }>(`${SESSION_DETAIL_KEY_PREFIX}${FAT_SESSION_ID}`);
    for (const ref of detail?.cliSessions ?? []) {
      expect(ref).not.toHaveProperty('segments');
      expect(ref).not.toHaveProperty('streamEvents');
    }

    const pages: unknown[] = [];
    for await (const page of provider.readJsonSequence(
      `${AGENT_OUTPUT_KEY_PREFIX}${BIG_ITEM_AGENT_ID}`,
    )) {
      pages.push(page);
    }
    expect(pages.length).toBeGreaterThan(0);

    const structuralItem: Record<string, string> = {};
    for (let i = 0; i < 14; i++) {
      structuralItem[`field${i}`] = 'w'.repeat(20 * 1024);
    }
    await provider.replaceJsonSequence(
      'ptah.oversizedStructuralWrite',
      (async function* () {
        yield { items: [structuralItem] };
      })(),
    );

    const projected = await provider.getAsync<{
      cliSessions?: readonly Record<string, unknown>[];
    }>(`${SESSION_DETAIL_KEY_PREFIX}${FAT_SESSION_ID}`, undefined, {
      projection: DETAIL_PROJECTION,
    });
    expect(projected?.cliSessions).toHaveLength(31);
    for (const ref of projected?.cliSessions ?? []) {
      expect(ref).not.toHaveProperty('stdout');
      expect(ref).not.toHaveProperty('segments');
      expect(ref).not.toHaveProperty('streamEvents');
    }

    const bigOutput = await readAll(
      provider,
      `${AGENT_OUTPUT_KEY_PREFIX}${BIG_ITEM_AGENT_ID}`,
    );
    expect(bigOutput.items).toHaveLength(1);
    expect(bigOutput.truncated).toBe(1);

    const fallback = await readAll(
      provider,
      `${AGENT_OUTPUT_KEY_PREFIX}${NO_DEST_AGENT_ID}`,
    );
    expect(fallback.items).toEqual([
      { tag: 'segment', value: { type: 'text', content: NO_DEST_STDOUT } },
    ]);
    for (let i = 0; i < 28; i++) {
      const output = await readAll(
        provider,
        `${AGENT_OUTPUT_KEY_PREFIX}agent-${String(i).padStart(2, '0')}`,
      );
      expect(output.items).toHaveLength(2);
      expect(output.items.some((item) => item.value.type === 'text')).toBe(
        false,
      );
    }

    const written = await readAll(provider, 'ptah.oversizedStructuralWrite');
    expect(written.items).toHaveLength(1);
    expect(written.truncated).toBe(1);

    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      droppedStdoutCount: 28,
      stdoutFallbackCount: 1,
      droppedBulkWithoutIdCount: 1,
      skippedItemCount: 1,
    });

    await provider.dispose();

    const restarted = new ElectronStateStorage(fixture.dir, 'state.json', {
      workerPath: '/unused.mjs',
      workerFactory: createExtractedLoopWorkerFactory(),
      migrations: [SESSION_METADATA_MIGRATION_MIRROR],
      cacheExcludeKeyPrefixes: [
        SESSION_DETAIL_KEY_PREFIX,
        AGENT_OUTPUT_KEY_PREFIX,
      ],
    });
    await restarted.whenReady();
    expect(restarted.get('ptah.oversizedStructuralWrite')).toEqual([
      structuralItem,
    ]);
    await restarted.dispose();
  }, 120_000);
});
