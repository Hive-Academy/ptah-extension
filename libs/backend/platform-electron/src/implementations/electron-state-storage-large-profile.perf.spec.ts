import 'reflect-metadata';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { monitorEventLoopDelay } from 'node:perf_hooks';

import {
  StateStorageRecoveryRequiredError,
  type StateStorageArraySplitPlan,
} from '@ptah-extension/platform-core';

import { ElectronStateStorage } from './electron-state-storage';
import type {
  ElectronStateWorkerFactory,
  ElectronStateWorkerLike,
} from './electron-state-storage-worker-host';

/**
 * ADVISORY perf/fixture spec for the v1 -> v2 state-storage migration —
 * opt-in, never a CI gate. TASK_2026_411's B3 gate named four things that a
 * unit-scale fixture cannot honestly prove: a 256 MB v1 profile actually
 * round-trips through the REAL migration recipe, an extraction failure mid
 * migration leaves the v1 source authoritative and the next attempt able to
 * retry, no main-thread operation touches a value bigger than the worker
 * protocol's 256 KiB budget, and a single post-migration write costs bytes
 * proportional to the ONE changed key rather than the whole store. B3's own
 * batch landed the array-split machinery and the ordinary unit specs
 * (`electron-state-storage-worker-host.spec.ts` and friends) already pin the
 * MECHANISM against an in-process fake worker; what was missing was doing it
 * once against the REAL, esbuild-compiled worker artifact and a profile sized
 * like the field report that motivated this task (174 CLI-agent output keys,
 * 214,837 stream events).
 *
 * This spec spawns the actual production worker thread built by
 * `nx build-state-storage-worker ptah-electron`
 * (`dist/apps/ptah-electron/state-storage-worker.mjs`). If that artifact is
 * missing, the suite fails loudly with the build command rather than passing
 * silently on a fake.
 *
 * The split plan below mirrors `SESSION_METADATA_MIGRATION` in
 * `libs/backend/agent-sdk/src/lib/session-metadata-store.ts` field-for-field.
 * It is NOT imported from there: `platform-electron` sits below `agent-sdk`
 * in the hexagonal layering (adapters must not depend on the domain libs that
 * consume them), so the plan is duplicated on purpose, the same way the
 * worker protocol is domain-agnostic by construction. Run with:
 *
 *   PTAH_PERF_SPECS=1 npx nx run-many -t test -p @ptah-extension/platform-electron
 *
 * on a quiet machine after touching the worker host, worker runtime, commit
 * store, or the migration recipe shape.
 */

const PERF_ENABLED = process.env['PTAH_PERF_SPECS'] === '1';
const perfDescribe = PERF_ENABLED ? describe : describe.skip;

jest.setTimeout(600_000);

const WORKER_ARTIFACT_PATH = path.resolve(
  __dirname,
  '../../../../../dist/apps/ptah-electron/state-storage-worker.mjs',
);

const STORAGE_KEY = 'ptah.sessionMetadata';
const SESSION_DETAIL_KEY_PREFIX = 'ptah.session:';
const AGENT_OUTPUT_KEY_PREFIX = 'ptah.agentOutput:';
const SESSION_INDEX_SCHEMA_VERSION = 1;

/** Mirrors `SESSION_METADATA_MIGRATION` — see the file doc comment above. */
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

interface FixtureSpec {
  readonly parentSessionCount: number;
  readonly agentOutputKeyCount: number;
  readonly stdoutReferenceCount: number;
  readonly stdoutBytes: number;
  readonly totalStreamEvents: number;
  readonly eventPayloadBytes: number;
}

const LARGE_FIXTURE: FixtureSpec = {
  parentSessionCount: 723,
  agentOutputKeyCount: 373,
  stdoutReferenceCount: 371,
  stdoutBytes: 102_400,
  totalStreamEvents: 214_837,
  eventPayloadBytes: 1_350,
};

interface BuiltFixture {
  readonly filePath: string;
  readonly byteLength: number;
  readonly totalStreamEvents: number;
  readonly agentIds: readonly string[];
  readonly parentSessionIds: readonly string[];
}

function makeEvent(index: number, padBytes: number): Record<string, unknown> {
  return {
    type: 'assistant-delta',
    seq: index,
    timestamp: Date.UTC(2026, 0, 1) + index,
    // Deterministic filler so the event has a stable, measurable size.
    payload: 'x'.repeat(padBytes),
  };
}

/** Writes the v1 legacy JSON file directly (no ElectronStateStorage involved). */
async function buildLargeV1Fixture(
  dir: string,
  spec: FixtureSpec,
): Promise<BuiltFixture> {
  const parentSessionIds = Array.from(
    { length: spec.parentSessionCount },
    (_, i) => `parent-${String(i).padStart(4, '0')}`,
  );
  const agentIds = Array.from(
    { length: spec.agentOutputKeyCount },
    (_, i) => `agent-${String(i).padStart(4, '0')}`,
  );

  const perAgentEventCount = Math.floor(
    spec.totalStreamEvents / spec.agentOutputKeyCount,
  );
  const remainder = spec.totalStreamEvents % spec.agentOutputKeyCount;

  const sessions = parentSessionIds.map((sessionId, i) => {
    const cliSessions: Record<string, unknown>[] = [];
    if (i < agentIds.length) {
      const agentId = agentIds[i];
      const count = perAgentEventCount + (i < remainder ? 1 : 0);
      cliSessions.push({
        agentId,
        ...(i < spec.stdoutReferenceCount
          ? { stdout: 'o'.repeat(spec.stdoutBytes) }
          : {}),
        segments: [{ type: 'text', content: `segment for ${agentId}` }],
        streamEvents: Array.from({ length: count }, (_, j) =>
          makeEvent(j, spec.eventPayloadBytes),
        ),
      });
    }
    return {
      sessionId,
      name: `Session ${i}`,
      workspaceId: 'ws-perf',
      createdAt: Date.UTC(2026, 0, 1) + i,
      lastActiveAt: Date.UTC(2026, 0, 1) + i,
      totalCost: 0.01 * i,
      totalTokens: { input: 100 * i, output: 50 * i },
      cliSessions,
      isChildSession: false,
    };
  });

  const body = JSON.stringify({ [STORAGE_KEY]: sessions });
  const filePath = path.join(dir, 'state.json');
  await fs.writeFile(filePath, body, 'utf8');
  const stat = await fs.stat(filePath);
  return {
    filePath,
    byteLength: stat.size,
    totalStreamEvents: spec.totalStreamEvents,
    agentIds,
    parentSessionIds,
  };
}

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

interface WorkerHeapProbe {
  peakUsedHeapBytes: number | null;
}

function instrumentedWorkerFactory(
  onMessage: (direction: 'to-worker' | 'from-worker', bytes: number) => void,
  heapProbe?: WorkerHeapProbe,
): ElectronStateWorkerFactory {
  return (workerPath: string): ElectronStateWorkerLike => {
    const worker = new Worker(workerPath);
    const heapWorker = worker as Worker & {
      getHeapStatistics?: () => Promise<{ used_heap_size: number }>;
    };
    if (heapProbe && typeof heapWorker.getHeapStatistics === 'function') {
      const sample = (): void => {
        void heapWorker
          .getHeapStatistics?.()
          .then((stats) => {
            heapProbe.peakUsedHeapBytes = Math.max(
              heapProbe.peakUsedHeapBytes ?? 0,
              stats.used_heap_size,
            );
          })
          .catch(() => undefined);
      };
      const timer = setInterval(sample, 250);
      timer.unref();
      worker.once('exit', () => clearInterval(timer));
    }
    const messageListeners: ((value: unknown) => void)[] = [];
    worker.on('message', (value: unknown) => {
      onMessage('from-worker', Buffer.byteLength(JSON.stringify(value)));
      for (const listener of messageListeners) listener(value);
    });

    const wrapped: ElectronStateWorkerLike = {
      postMessage: (value: unknown, transferList?: readonly ArrayBuffer[]) => {
        onMessage('to-worker', Buffer.byteLength(JSON.stringify(value)));
        worker.postMessage(value, transferList as ArrayBuffer[] | undefined);
      },
      on: ((
        event: 'message' | 'error' | 'exit',
        listener: (value: unknown) => void,
      ) => {
        if (event === 'message') {
          messageListeners.push(listener);
        } else if (event === 'error') {
          worker.on('error', listener as (error: Error) => void);
        } else {
          worker.on('exit', listener as (code: number) => void);
        }
        return wrapped;
      }) as ElectronStateWorkerLike['on'],
      unref: () => worker.unref(),
      terminate: () => worker.terminate(),
    };
    return wrapped;
  };
}

/** Recursive byte total of every file under `dir`. */
async function directoryByteSize(dir: string): Promise<number> {
  let total = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await directoryByteSize(full);
    else if (entry.isFile()) total += (await fs.stat(full)).size;
  }
  return total;
}

async function assertWorkerArtifactBuilt(): Promise<void> {
  try {
    await fs.access(WORKER_ARTIFACT_PATH);
  } catch {
    throw new Error(
      `State storage worker artifact missing at ${WORKER_ARTIFACT_PATH}. ` +
        'Run `npx nx build-state-storage-worker ptah-electron` first.',
    );
  }
}

perfDescribe(
  'ElectronStateStorage large-profile migration (perf/fixture, PTAH_PERF_SPECS=1)',
  () => {
    const tmpDirs: string[] = [];

    afterEach(async () => {
      while (tmpDirs.length > 0) {
        const dir = tmpDirs.pop();
        if (!dir) continue;
        await fs
          .rm(dir, { recursive: true, force: true })
          .catch(() => undefined);
      }
    });

    it(
      'real-shape 328 MB v1 profile splits lean before its first commit ' +
        'inside the handshake budget (A1) and re-boots by hash verification (A2)',
      async () => {
        await assertWorkerArtifactBuilt();

        const dir = await makeTempDir('ptah-electron-state-perf-');
        tmpDirs.push(dir);
        const buildStartedAt = Date.now();
        const fixture = await buildLargeV1Fixture(dir, LARGE_FIXTURE);
        const buildElapsedMs = Date.now() - buildStartedAt;

        const fixtureMb = fixture.byteLength / (1024 * 1024);
        expect(fixtureMb).toBeGreaterThan(325);

        // --- Main-thread instrumentation -----------------------------------
        // `JSON.parse`/`JSON.stringify` calls issued by THIS process (the
        // stand-in for the Electron main thread) must never see a value
        // bigger than the worker protocol's 256 KiB message budget. The
        // legacy file's own ~256 MB JSON.parse/stringify happen inside the
        // worker (`ElectronStateCommitStore.loadLegacy` /
        // `ElectronStateWorkerRuntime`), never here.
        const budgetBytes = 256 * 1024;
        let maxHostParseChars = 0;
        let maxHostStringifyChars = 0;
        const originalParse = JSON.parse.bind(JSON);
        const originalStringify = JSON.stringify.bind(JSON);
        JSON.parse = ((text: string, reviver?: unknown) => {
          maxHostParseChars = Math.max(maxHostParseChars, text.length);
          return originalParse(text, reviver as never);
        }) as typeof JSON.parse;
        JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
          const result = (originalStringify as (...a: unknown[]) => string)(
            value,
            ...rest,
          );
          if (typeof result === 'string') {
            maxHostStringifyChars = Math.max(
              maxHostStringifyChars,
              result.length,
            );
          }
          return result;
        }) as typeof JSON.stringify;

        let maxToWorkerBytes = 0;
        let maxFromWorkerBytes = 0;
        const heapProbe: WorkerHeapProbe = { peakUsedHeapBytes: null };
        const workerFactory = instrumentedWorkerFactory((direction, bytes) => {
          if (direction === 'to-worker') {
            maxToWorkerBytes = Math.max(maxToWorkerBytes, bytes);
          } else {
            maxFromWorkerBytes = Math.max(maxFromWorkerBytes, bytes);
          }
        }, heapProbe);

        const histogram = monitorEventLoopDelay({ resolution: 10 });
        histogram.enable();

        let storage: ElectronStateStorage;
        const migrationStartedAt = Date.now();
        try {
          storage = new ElectronStateStorage(dir, 'state.json', {
            workerPath: WORKER_ARTIFACT_PATH,
            migrations: [SESSION_METADATA_MIGRATION_MIRROR],
            cacheExcludeKeyPrefixes: [
              SESSION_DETAIL_KEY_PREFIX,
              AGENT_OUTPUT_KEY_PREFIX,
            ],
            workerFactory,
          });
          await storage.whenReady();
        } finally {
          JSON.parse = originalParse;
          JSON.stringify = originalStringify;
        }
        const migrationElapsedMs = Date.now() - migrationStartedAt;
        histogram.disable();
        expect(migrationElapsedMs).toBeLessThan(120_000);

        // Mechanism: the host process never touched a value near the legacy
        // file's size, and every worker message stayed inside the protocol
        // budget.
        expect(maxHostParseChars).toBeLessThan(budgetBytes);
        expect(maxHostStringifyChars).toBeLessThan(budgetBytes);
        expect(maxToWorkerBytes).toBeLessThanOrEqual(budgetBytes);
        expect(maxFromWorkerBytes).toBeLessThanOrEqual(budgetBytes);

        // --- Round-trip exactness -------------------------------------------
        let observedEvents = 0;
        for (const agentId of fixture.agentIds) {
          const key = `${AGENT_OUTPUT_KEY_PREFIX}${agentId}`;
          for await (const page of storage.readJsonSequence<{
            tag: string;
          }>(key)) {
            observedEvents += page.items.filter(
              (item) => item.tag === 'streamEvent',
            ).length;
          }
        }
        expect(observedEvents).toBe(fixture.totalStreamEvents);

        const index = storage.get<{ items: readonly { sessionId: string }[] }>(
          STORAGE_KEY,
        );
        expect(index?.items.length).toBe(fixture.parentSessionIds.length);
        const firstManifest = JSON.parse(
          await fs.readFile(
            path.join(
              `${path.join(dir, 'state')}.v2`,
              'manifests',
              'manifest.1.json',
            ),
            'utf8',
          ),
        ) as { values: Record<string, unknown> };
        expect(Object.keys(firstManifest.values)).toContain(
          `${SESSION_DETAIL_KEY_PREFIX}${fixture.parentSessionIds[0]}`,
        );
        const sampleDetail = await storage.getAsync<{
          cliSessions: readonly Record<string, unknown>[];
        }>(`${SESSION_DETAIL_KEY_PREFIX}${fixture.parentSessionIds[0]}`);
        expect(sampleDetail?.cliSessions[0]).not.toHaveProperty('stdout');
        expect(sampleDetail?.cliSessions[0]).not.toHaveProperty('streamEvents');

        // --- Write amplification --------------------------------------------
        // One new session detail + one appended index row must not re-touch
        // the whole store's bytes.
        const v2Root = `${path.join(dir, 'state')}.v2`;
        const bytesBeforeWrite = await directoryByteSize(v2Root);
        const newSessionId = 'new-session-0001';
        await storage.update(`${SESSION_DETAIL_KEY_PREFIX}${newSessionId}`, {
          sessionId: newSessionId,
          name: 'New session',
        });
        const nextIndex = {
          schemaVersion: SESSION_INDEX_SCHEMA_VERSION,
          items: [
            ...(index?.items ?? []),
            { sessionId: newSessionId, name: 'New session' },
          ],
        };
        await storage.update(STORAGE_KEY, nextIndex);
        const bytesAfterWrite = await directoryByteSize(v2Root);
        const writeDeltaBytes = bytesAfterWrite - bytesBeforeWrite;

        // The whole profile is >150 MB; a two-key write must cost orders of
        // magnitude less than that, not scale with profile size.
        expect(writeDeltaBytes).toBeGreaterThan(0);
        expect(writeDeltaBytes).toBeLessThan(2 * 1024 * 1024);

        await storage.dispose();

        const v2Bytes = await directoryByteSize(v2Root);
        const verifyStartedAt = Date.now();
        const reopened = new ElectronStateStorage(dir, 'state.json', {
          workerPath: WORKER_ARTIFACT_PATH,
          migrations: [SESSION_METADATA_MIGRATION_MIRROR],
          cacheExcludeKeyPrefixes: [
            SESSION_DETAIL_KEY_PREFIX,
            AGENT_OUTPUT_KEY_PREFIX,
          ],
        });
        await reopened.whenReady();
        const verifyBootElapsedMs = Date.now() - verifyStartedAt;
        expect(
          reopened.get<{ items: readonly unknown[] }>(STORAGE_KEY)?.items
            .length,
        ).toBe(fixture.parentSessionIds.length + 1);
        await reopened.dispose();

        // Event-loop heartbeat is ADVISORY (shared reference host, see the
        // spawner perf spec's rationale) — recorded, not gated on an
        // absolute figure, except a very generous smoke ceiling that would
        // catch a genuine main-thread block of the whole migration.
        const loopMaxMs = histogram.max / 1e6;
        console.log(
          '[perf] real-shape v1 split fixture:',
          JSON.stringify({
            fixtureMb: Number(fixtureMb.toFixed(1)),
            buildElapsedMs,
            migrationElapsedMs,
            loopMaxMs: Number(loopMaxMs.toFixed(1)),
            loopMeanMs: Number((histogram.mean / 1e6).toFixed(2)),
            maxHostParseChars,
            maxHostStringifyChars,
            maxToWorkerBytes,
            maxFromWorkerBytes,
            writeDeltaBytes,
            observedEvents,
            workerPeakUsedHeapMb:
              heapProbe.peakUsedHeapBytes === null
                ? null
                : Number(
                    (heapProbe.peakUsedHeapBytes / (1024 * 1024)).toFixed(1),
                  ),
            v2StoreMb: Number((v2Bytes / (1024 * 1024)).toFixed(1)),
            verifyBootElapsedMs,
          }),
        );
        expect(loopMaxMs).toBeLessThan(5_000);
      },
    );

    it(
      'an id-less session is skipped, and a failing split commits nothing ' +
        'and leaves v1 authoritative for the retry',
      async () => {
        await assertWorkerArtifactBuilt();

        const dir = await makeTempDir('ptah-electron-state-perf-fail-');
        tmpDirs.push(dir);
        const filePath = path.join(dir, 'state.json');
        const v2Root = `${path.join(dir, 'state')}.v2`;

        await fs.writeFile(
          filePath,
          JSON.stringify({
            [STORAGE_KEY]: [
              { sessionId: 'ok-1', name: 'A', cliSessions: [] },
              { name: 'missing id', cliSessions: [] },
              { sessionId: 'ok-2', name: 'B', cliSessions: [] },
            ],
          }),
          'utf8',
        );
        const skipping = new ElectronStateStorage(dir, 'state.json', {
          workerPath: WORKER_ARTIFACT_PATH,
          migrations: [SESSION_METADATA_MIGRATION_MIRROR],
        });
        await skipping.whenReady();
        expect(
          skipping.get<{ items: readonly unknown[] }>(STORAGE_KEY)?.items
            .length,
        ).toBe(2);
        await skipping.dispose();
        await fs.rm(v2Root, { recursive: true, force: true });

        const brokenBody = JSON.stringify({
          [STORAGE_KEY]: { schemaVersion: 99, items: [] },
        });
        await fs.writeFile(filePath, brokenBody, 'utf8');
        const v1BytesBefore = await fs.readFile(filePath);

        const failing = new ElectronStateStorage(dir, 'state.json', {
          workerPath: WORKER_ARTIFACT_PATH,
          migrations: [SESSION_METADATA_MIGRATION_MIRROR],
        });
        await expect(failing.whenReady()).rejects.toBeInstanceOf(
          StateStorageRecoveryRequiredError,
        );
        expect(failing.getReadinessState()).toEqual({
          status: 'recovery-required',
          reason: 'migration-failed',
        });
        await failing.dispose();

        expect(Buffer.compare(v1BytesBefore, await fs.readFile(filePath))).toBe(
          0,
        );
        await expect(
          fs.access(path.join(v2Root, 'CURRENT')),
        ).rejects.toBeDefined();

        await fs.writeFile(
          filePath,
          JSON.stringify({
            [STORAGE_KEY]: [
              { sessionId: 'ok-1', name: 'A', cliSessions: [] },
              { sessionId: 'ok-2', name: 'B', cliSessions: [] },
              { sessionId: 'ok-3', name: 'C', cliSessions: [] },
            ],
          }),
          'utf8',
        );
        const retried = new ElectronStateStorage(dir, 'state.json', {
          workerPath: WORKER_ARTIFACT_PATH,
          migrations: [SESSION_METADATA_MIGRATION_MIRROR],
        });
        await retried.whenReady();
        expect(retried.getReadinessState().status).toBe('ready');
        const index = retried.get<{ items: readonly unknown[] }>(STORAGE_KEY);
        expect(index?.items.length).toBe(3);
        await retried.dispose();
      },
    );
  },
);
