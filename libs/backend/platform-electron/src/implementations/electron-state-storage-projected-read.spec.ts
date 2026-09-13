import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  StateStorageCursorStaleError,
  StateStorageValueTooLargeError,
  jsonUtf8Bytes,
  omitJsonPaths,
} from '@ptah-extension/platform-core';
import { ElectronStateStorage } from './electron-state-storage';
import { ElectronStateCommitStore } from './electron-state-storage-commit-store';
import type {
  ElectronStateWorkerFactory,
  ElectronStateWorkerLike,
} from './electron-state-storage-worker-host';
import { createElectronStateWorkerMessageLoop } from './electron-state-storage-worker-loop';
import {
  ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
  assertElectronStateWorkerPayloadWithinBudget,
} from './electron-state-storage-worker-protocol';
import {
  ElectronStateWorkerRuntime,
  type ElectronStateWorkerRuntimeOptions,
} from './electron-state-storage-worker-runtime';

const DETAIL_PREFIX = 'ptah.session:';
const OUTPUT_PREFIX = 'ptah.agentOutput:';
const DETAIL_KEY = `${DETAIL_PREFIX}dev`;
const DETAIL_PROJECTION = {
  omit: [
    ['cliSessions', '*', 'stdout'],
    ['cliSessions', '*', 'segments'],
    ['cliSessions', '*', 'streamEvents'],
  ],
};

interface ReceivedMessage {
  readonly type: string;
  readonly estimatorBytes: number;
  readonly value: Record<string, unknown>;
}

interface Harness {
  readonly received: ReceivedMessage[];
  readonly factory: ElectronStateWorkerFactory;
}

function harness(
  options: ElectronStateWorkerRuntimeOptions = {},
  rewriteRequest?: (
    request: Record<string, unknown>,
  ) => Record<string, unknown>,
): Harness {
  const received: ReceivedMessage[] = [];
  const factory: ElectronStateWorkerFactory = () => {
    const messageListeners: Array<(value: unknown) => void> = [];
    const listener = createElectronStateWorkerMessageLoop(
      new ElectronStateWorkerRuntime(undefined, options),
      {
        postMessage(value: unknown) {
          const cloned = structuredClone(value) as Record<string, unknown>;
          received.push({
            type: String(cloned['type']),
            estimatorBytes: assertElectronStateWorkerPayloadWithinBudget(
              cloned,
              Number.MAX_SAFE_INTEGER,
            ),
            value: cloned,
          });
          for (const messageListener of messageListeners) {
            messageListener(cloned);
          }
        },
        terminate: () => undefined,
      },
    );
    const worker: ElectronStateWorkerLike = {
      postMessage(input: unknown) {
        const request = structuredClone(input) as Record<string, unknown>;
        listener(rewriteRequest ? rewriteRequest(request) : request);
      },
      on(event: string, handler: (arg: never) => void) {
        if (event === 'message') {
          messageListeners.push(handler as (value: unknown) => void);
        }
        return worker;
      },
      unref: () => undefined,
      terminate: async () => 0,
    } as ElectronStateWorkerLike;
    return worker;
  };
  return { received, factory };
}

function fatDevDetail(): Record<string, unknown> {
  return {
    sessionId: 'dev',
    name: 'Dev-shaped v2 detail',
    cliSessions: Array.from({ length: 28 }, (_, index) => ({
      agentId: `agent-${index}`,
      description: `d${index}`.repeat(4_000),
      stdout: 'x'.repeat(102_400),
      segments: [{ kind: 'text', text: `segment-${index}` }],
      streamEvents: [{ type: 'assistant-delta', seq: index }],
    })),
  };
}

const tmpDirs: string[] = [];

async function seededStore(
  seed: Record<string, unknown>,
  current: Harness,
): Promise<{ dir: string; storage: ElectronStateStorage }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-projected-read-'));
  tmpDirs.push(dir);
  const writer = new ElectronStateStorage(dir, 'state.json', {
    workerPath: '/unused.mjs',
    workerFactory: harness().factory,
    cacheExcludeKeyPrefixes: [DETAIL_PREFIX, OUTPUT_PREFIX],
  });
  await writer.whenReady();
  for (const [key, value] of Object.entries(seed)) {
    await writer.update(key, value);
  }
  await writer.dispose();
  const storage = new ElectronStateStorage(dir, 'state.json', {
    workerPath: '/unused.mjs',
    workerFactory: current.factory,
    cacheExcludeKeyPrefixes: [DETAIL_PREFIX, OUTPUT_PREFIX],
  });
  await storage.whenReady();
  current.received.length = 0;
  return { dir, storage };
}

afterEach(async () => {
  jest.restoreAllMocks();
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('ElectronStateStorage — projected scalar continuation (test 1a, R3-1)', () => {
  it('assembles a multi-page projected read that equals the projection of the raw value', async () => {
    const raw = fatDevDetail();
    expect(jsonUtf8Bytes(raw)).toBeGreaterThan(1024 * 1024);
    const current = harness();
    const { storage } = await seededStore({ [DETAIL_KEY]: raw }, current);

    const projected = await storage.getAsync(DETAIL_KEY, undefined, {
      projection: DETAIL_PROJECTION,
    });

    expect(projected).toEqual(omitJsonPaths(raw, DETAIL_PROJECTION.omit));
    expect(JSON.stringify(projected)).not.toMatch(
      /"(stdout|segments|streamEvents)"/,
    );
    expect(current.received.map((message) => message.type)).toContain(
      'value-paged',
    );
    expect(current.received.map((message) => message.type)).toContain(
      'scalar-page',
    );
    for (const message of current.received) {
      expect(message.estimatorBytes).toBeLessThanOrEqual(
        ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
      );
    }
    await storage.dispose();
  }, 60_000);

  it('gives an identical result when the value is evicted between continuations', async () => {
    const raw = fatDevDetail();
    const evicting = harness({ valueCacheMaxBytes: 1 });
    const { storage } = await seededStore({ [DETAIL_KEY]: raw }, evicting);
    const reads = jest.spyOn(ElectronStateCommitStore.prototype, 'readValue');

    const projected = await storage.getAsync(DETAIL_KEY, undefined, {
      projection: DETAIL_PROJECTION,
    });

    expect(projected).toEqual(omitJsonPaths(raw, DETAIL_PROJECTION.omit));
    const pageCount = evicting.received.filter(
      (message) =>
        message.type === 'value-paged' || message.type === 'scalar-page',
    ).length;
    expect(pageCount).toBeGreaterThan(1);
    expect(reads.mock.calls.length).toBe(pageCount);
    await storage.dispose();
  }, 60_000);

  it.each([
    [
      'a changed projection',
      (request: Record<string, unknown>) => ({
        ...request,
        projection: { omit: [['cliSessions', '*', 'description']] },
      }),
    ],
    [
      'a missing projection',
      (request: Record<string, unknown>) => {
        const withoutProjection = { ...request };
        delete withoutProjection['projection'];
        return withoutProjection;
      },
    ],
  ])(
    'rejects a continuation that carries %s as cursor-stale after one restart',
    async (_label, rewrite) => {
      const tampering = harness({}, (request) =>
        request['type'] === 'read-scalar-page' ? rewrite(request) : request,
      );
      const { storage } = await seededStore(
        { [DETAIL_KEY]: fatDevDetail() },
        tampering,
      );

      await expect(
        storage.getAsync(DETAIL_KEY, undefined, {
          projection: DETAIL_PROJECTION,
        }),
      ).rejects.toBeInstanceOf(StateStorageCursorStaleError);
      const failures = tampering.received.filter(
        (message) =>
          message.type === 'failure' &&
          message.value['code'] === 'cursor-stale',
      );
      expect(failures).toHaveLength(2);
      await storage.dispose();
    },
    60_000,
  );
});

describe('ElectronStateStorage — main-thread ceiling (test 6, N10)', () => {
  it('refuses 1.5 MiB of non-output metadata without delivering any content bytes', async () => {
    const detail = {
      sessionId: 'heavy',
      notes: 'm'.repeat(1_536_000),
      cliSessions: [],
    };
    const current = harness();
    const { storage } = await seededStore(
      { [`${DETAIL_PREFIX}heavy`]: detail },
      current,
    );

    const failure = await storage
      .getAsync(`${DETAIL_PREFIX}heavy`, undefined, {
        projection: DETAIL_PROJECTION,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(StateStorageValueTooLargeError);
    expect(failure).toMatchObject({ key: `${DETAIL_PREFIX}heavy` });
    expect(current.received).toHaveLength(1);
    expect(current.received[0].value).toEqual({
      type: 'failure',
      operationId: expect.any(Number),
      code: 'value-too-large',
      valueBytes: jsonUtf8Bytes(detail),
    });
    await storage.dispose();
  }, 60_000);

  it('delivers the largest lean detail under the ceiling with no field omitted', async () => {
    const detail = {
      sessionId: 'largest',
      cliSessions: Array.from({ length: 40 }, (_, index) => ({
        agentId: `agent-${index}`,
        summary: 'é'.repeat(5_000),
        prompt: 's'.repeat(10_000),
      })),
    };
    expect(jsonUtf8Bytes(detail)).toBeLessThan(1024 * 1024);
    const current = harness();
    const { storage } = await seededStore(
      { [`${DETAIL_PREFIX}largest`]: detail },
      current,
    );

    const read = await storage.getAsync(`${DETAIL_PREFIX}largest`, undefined, {
      projection: DETAIL_PROJECTION,
    });

    expect(read).toEqual(detail);
    expect(jsonUtf8Bytes(read)).toBeLessThanOrEqual(1024 * 1024);
    for (const message of current.received) {
      expect(message.estimatorBytes).toBeLessThanOrEqual(
        ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
      );
    }
    await storage.dispose();
  }, 60_000);
});

describe('ElectronStateStorage — dual budget sequence pages (test 7)', () => {
  it('keeps every page inside both the estimator and the JSON budget', async () => {
    const control = String.fromCharCode(1).repeat(700);
    const multibyte = String.fromCharCode(0xe9).repeat(1_200);
    const astral = String.fromCodePoint(0x1f600).repeat(600);
    const items = [
      { tag: 'segment', value: { type: 'text', content: control } },
      { tag: 'segment', value: { type: 'text', content: multibyte } },
      { tag: 'segment', value: { type: 'text', content: astral } },
      ...Array.from({ length: 30 }, (_, index) => ({
        tag: 'streamEvent',
        value: {
          seq: index,
          text: `${control.slice(0, 20)}${astral.slice(0, 20)}`,
        },
      })),
      {
        tag: 'segment',
        value: { type: 'text', content: 'suffix'.repeat(400) },
      },
    ];
    const current = harness();
    const { storage } = await seededStore(
      { [`${OUTPUT_PREFIX}dual`]: items },
      current,
    );
    const maxBytes = 4_096;
    const maxJsonBytes = 1_600;
    const jsonEnvelopeBytes = 120;

    const collected: unknown[] = [];
    let truncated = 0;
    for await (const page of storage.readJsonSequence(`${OUTPUT_PREFIX}dual`, {
      maxBytes,
      maxJsonBytes,
      jsonEnvelopeBytes,
      maxItemBytes: maxJsonBytes,
    })) {
      expect(page.items.length).toBeGreaterThan(0);
      expect(
        jsonEnvelopeBytes + jsonUtf8Bytes(page.items) - 2,
      ).toBeLessThanOrEqual(maxJsonBytes);
      truncated += page.truncatedItems?.length ?? 0;
      for (const entry of page.truncatedItems ?? []) {
        expect(JSON.stringify(page.items[entry.index])).toContain('[truncated');
      }
      collected.push(...page.items);
    }

    for (const message of current.received) {
      expect(message.estimatorBytes).toBeLessThanOrEqual(maxBytes);
    }
    expect(collected).toHaveLength(items.length);
    expect(truncated).toBe(4);
    for (const item of collected) {
      expect(JSON.stringify(item)).not.toMatch(
        /\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i,
      );
    }
    await storage.dispose();
  }, 60_000);
});
