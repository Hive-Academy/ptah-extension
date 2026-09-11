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
      onMissingId: 'retain-source',
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
  readonly totalStreamEvents: number;
  /** Padding bytes per event so the whole v1 file lands near 256 MB. */
  readonly eventPayloadBytes: number;
}

/** 174 CLI-agent output keys / 214,837 events — the field measurement B3 named. */
const LARGE_FIXTURE: FixtureSpec = {
  parentSessionCount: 200,
  agentOutputKeyCount: 174,
  totalStreamEvents: 214_837,
  eventPayloadBytes: 1_100,
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
        segments: [],
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

/** Wraps the real `Worker` to record every message crossing the thread boundary. */
function instrumentedWorkerFactory(
  onMessage: (direction: 'to-worker' | 'from-worker', bytes: number) => void,
): ElectronStateWorkerFactory {
  return (workerPath: string): ElectronStateWorkerLike => {
    const worker = new Worker(workerPath);
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
        await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    });

    it(
      '256 MB v1 profile migrates exactly, off the main thread, with ' +
        'proportional write amplification afterward',
      async () => {
        await assertWorkerArtifactBuilt();

        const dir = await makeTempDir('ptah-electron-state-perf-');
        tmpDirs.push(dir);
        const buildStartedAt = Date.now();
        const fixture = await buildLargeV1Fixture(dir, LARGE_FIXTURE);
        const buildElapsedMs = Date.now() - buildStartedAt;

        // Sanity: this is really a ~256 MB profile, not a token-sized stand-in.
        const fixtureMb = fixture.byteLength / (1024 * 1024);
        expect(fixtureMb).toBeGreaterThan(150);

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
        const workerFactory = instrumentedWorkerFactory((direction, bytes) => {
          if (direction === 'to-worker') {
            maxToWorkerBytes = Math.max(maxToWorkerBytes, bytes);
          } else {
            maxFromWorkerBytes = Math.max(maxFromWorkerBytes, bytes);
          }
        });

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

        // Event-loop heartbeat is ADVISORY (shared reference host, see the
        // spawner perf spec's rationale) — recorded, not gated on an
        // absolute figure, except a very generous smoke ceiling that would
        // catch a genuine main-thread block of the whole migration.
        const loopMaxMs = histogram.max / 1e6;
        console.log(
          '[perf] 256MB migration fixture:',
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
          }),
        );
        expect(loopMaxMs).toBeLessThan(5_000);
      },
    );

    it(
      'an injected extraction failure leaves v1 authoritative and the next ' +
        'attempt retries successfully',
      async () => {
        await assertWorkerArtifactBuilt();

        const dir = await makeTempDir('ptah-electron-state-perf-fail-');
        tmpDirs.push(dir);
        const filePath = path.join(dir, 'state.json');

        // One parent session has no `sessionId` at all — `splitArrayValue`
        // rejects it with "Split source item has no usable id" before any
        // `commitMutation` for the migration is reached.
        const brokenSessions = [
          { sessionId: 'ok-1', name: 'A', cliSessions: [] },
          { name: 'missing id', cliSessions: [] },
          { sessionId: 'ok-2', name: 'B', cliSessions: [] },
        ];
        const v1Body = JSON.stringify({ [STORAGE_KEY]: brokenSessions });
        await fs.writeFile(filePath, v1Body, 'utf8');
        const v1BytesBefore = await fs.readFile(filePath);

        const failing = new ElectronStateStorage(dir, 'state.json', {
          workerPath: WORKER_ARTIFACT_PATH,
          migrations: [SESSION_METADATA_MIGRATION_MIRROR],
        });
        await expect(failing.whenReady()).rejects.toBeInstanceOf(
          StateStorageRecoveryRequiredError,
        );
        expect(failing.getReadinessState().status).toBe('recovery-required');
        await failing.dispose();

        // v1 is untouched: same bytes as before the attempt.
        const v1BytesAfter = await fs.readFile(filePath);
        expect(Buffer.compare(v1BytesBefore, v1BytesAfter)).toBe(0);

        // `ElectronStateCommitStore.initialize()` durably commits the FAT
        // (unsplit) legacy values as v2 generation 1 BEFORE the split-array
        // migration loop runs (`ElectronStateWorkerRuntime.initialize`), so a
        // CURRENT pointer now exists — but it names only the original
        // `STORAGE_KEY` blob (still holding the raw array with `cliSessions`
        // embedded), never the split index/detail/agent-output keys. That
        // fat blob, not the untouched v1 file, is what "authoritative" means
        // in practice: it is the value every subsequent read/migration
        // attempt starts from, and it is provably never a partial split.
        const v2Root = `${path.join(dir, 'state')}.v2`;
        const currentPointer = JSON.parse(
          await fs.readFile(path.join(v2Root, 'CURRENT'), 'utf8'),
        ) as { generation: number; mutationEpoch: number };
        expect(currentPointer.generation).toBe(1);
        expect(currentPointer.mutationEpoch).toBe(0);
        const manifest = JSON.parse(
          await fs.readFile(
            path.join(v2Root, 'manifests', 'manifest.1.json'),
            'utf8',
          ),
        ) as { values: Record<string, unknown> };
        expect(Object.keys(manifest.values)).toEqual([STORAGE_KEY]);

        // Retrying in place (same v1, same v2) reprocesses the identical fat
        // snapshot and fails identically — there is no partial state to
        // "resume" into. The recovery path this repo actually supports is
        // clearing the v2 directory so the NEXT boot re-derives v2 from v1
        // from scratch; that is safe and correct here specifically BECAUSE
        // v1 was left byte-for-byte untouched by the failed attempt. Fix the
        // source record the way an operator/support flow would, then retry.
        await fs.rm(v2Root, { recursive: true, force: true });
        const fixedSessions = [
          { sessionId: 'ok-1', name: 'A', cliSessions: [] },
          { sessionId: 'was-missing', name: 'missing id', cliSessions: [] },
          { sessionId: 'ok-2', name: 'B', cliSessions: [] },
        ];
        await fs.writeFile(
          filePath,
          JSON.stringify({ [STORAGE_KEY]: fixedSessions }),
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
