import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import type { StateStorageArraySplitPlan } from '@ptah-extension/platform-core';
import { ElectronStateStorage } from '@ptah-extension/platform-electron';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const WORKER_ARTIFACT_PATH = path.join(
  REPO_ROOT,
  'dist',
  'apps',
  'ptah-electron',
  'state-storage-worker.mjs',
);

const STORAGE_KEY = 'ptah.sessionMetadata';
const SESSION_DETAIL_KEY_PREFIX = 'ptah.session:';
const AGENT_OUTPUT_KEY_PREFIX = 'ptah.agentOutput:';
const SESSION_INDEX_SCHEMA_VERSION = 1;
const FAT_SESSION_ID = 'fat-session';
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

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ptah-electron-state-bundle-'));
}
async function buildOversizedDetailV1Fixture(dir: string): Promise<string> {
  const sessions: Record<string, unknown>[] = [];
  for (let i = 0; i < 4; i++) {
    sessions.push({
      sessionId: `session-${i}`,
      name: `Session ${i}`,
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
    cliSessions: [
      {
        agentId: 'agent-fat',
        stdout: 'x'.repeat(300_000),
        segments: [],
        streamEvents: [],
      },
    ],
    isChildSession: false,
  });

  const filePath = path.join(dir, 'state.json');
  await fs.writeFile(
    filePath,
    JSON.stringify({ [STORAGE_KEY]: sessions }),
    'utf8',
  );
  return filePath;
}

async function assertWorkerArtifactBuilt(): Promise<void> {
  if (existsSync(WORKER_ARTIFACT_PATH)) return;
  throw new Error(
    `State storage worker artifact missing at ${WORKER_ARTIFACT_PATH}. ` +
      'Run `nx build-state-storage-worker ptah-electron` first.',
  );
}

describe('ElectronStateStorage — real worker bundle, oversized detail (regression, TASK_2026_430)', () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop();
      if (dir)
        await fs
          .rm(dir, { recursive: true, force: true })
          .catch(() => undefined);
    }
  });
  it('reads the small index and the oversized detail through the real worker bundle with no crash', async () => {
    await assertWorkerArtifactBuilt();

    const dir = await makeTempDir();
    tmpDirs.push(dir);
    await buildOversizedDetailV1Fixture(dir);

    const provider = new ElectronStateStorage(dir, 'state.json', {
      workerPath: WORKER_ARTIFACT_PATH,
      migrations: [SESSION_METADATA_MIGRATION_MIRROR],
      cacheExcludeKeyPrefixes: [
        SESSION_DETAIL_KEY_PREFIX,
        AGENT_OUTPUT_KEY_PREFIX,
      ],
    });

    await provider.whenReady();
    expect(provider.getReadinessState().status).toBe('ready');

    const index = await provider.getAsync<{
      items: readonly { sessionId: string }[];
    }>(STORAGE_KEY);
    expect(index?.items.length).toBe(5);

    const detail = await provider.getAsync<{
      cliSessions?: readonly Record<string, unknown>[];
    }>(`${SESSION_DETAIL_KEY_PREFIX}${FAT_SESSION_ID}`);
    expect(detail?.cliSessions?.length).toBe(1);

    await provider.dispose();
  }, 30_000);
});
