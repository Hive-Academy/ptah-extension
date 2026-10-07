/**
 * Batch 17 spec for `mem.liveness.fault` and `mem.liveness.rescan`. It drives
 * the REAL `MemoryTriggerService` (its private `invokeCurate` and
 * `runBootScan`, so the REAL `BootScanRunner` and watermark logic) and the
 * REAL `MemoryCuratorService`, both constructed positionally as the product's
 * own specs do, over in-memory stores, a fake SQLite watermark table and a
 * real temp sessions directory whose mtimes are set with `fs.utimes`.
 *
 * The expected results pin TODAY's behaviour: fault modes (a)-(d) and every
 * rescan invariant fail (forensics M2), the stalled control passes. When the
 * liveness fix lands these expectations flip, and so must known-failures.
 */
import 'reflect-metadata';
jest.mock('vscode', () => ({}), { virtual: true });

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  ICompactionCallbackRegistry,
  ITranscriptReader,
} from '@ptah-extension/memory-contracts';
import {
  MemoryCuratorService,
  MemoryTriggerService,
  type MemoryStore,
  type ObservationQueueInsert,
  type ObservationQueueStore,
} from '@ptah-extension/memory-curator';
import type { Logger } from '@ptah-extension/vscode-core';

import type { CaseRecord } from '../../runner/suite-result';
import {
  ScriptedLivenessCurator,
  recordCurateOutcomes,
  sessionsDirFor,
  triggerInternals,
  type CurateObservation,
  type LivenessParts,
} from './liveness-harness';
import {
  LIVENESS_MTIMES,
  runLivenessFaultSuite,
  runLivenessRescanSuite,
} from './liveness.suite';

const FIXTURES = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'memory-skills',
);

function logger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function registry(): never {
  return {
    register: jest.fn(() => () => undefined),
    notifyAll: jest.fn(),
    size: 0,
  } as never;
}

class InMemoryStore {
  readonly rows: {
    id: string;
    workspaceRoot: string | null;
    content: string;
    chunks: number;
  }[] = [];
  list() {
    return { memories: [], total: 0 };
  }
  findMergeCandidates() {
    return [];
  }
  getMergeTarget() {
    return null;
  }
  async insertMemoryWithChunks(
    insert: { workspaceRoot?: string | null; content: string },
    chunks: readonly unknown[],
  ) {
    this.rows.push({
      id: `m${this.rows.length + 1}`,
      workspaceRoot: insert.workspaceRoot ?? null,
      content: insert.content,
      chunks: chunks.length,
    });
  }
  async appendChunks() {
    return 'appended';
  }
}

/** The observation queue surface the trigger and the suite use. */
class InMemoryObservations {
  private readonly rows: {
    id: number;
    sessionId: string;
    insert: ObservationQueueInsert;
    processed: boolean;
  }[] = [];
  enqueue(insert: ObservationQueueInsert): void {
    this.rows.push({
      id: this.rows.length + 1,
      sessionId: insert.sessionId,
      insert,
      processed: false,
    });
  }
  flush(): void {
    /* writes are immediate */
  }
  drainForSession(sessionId: string) {
    return this.rows
      .filter((row) => row.sessionId === sessionId && !row.processed)
      .map((row) => ({
        id: row.id,
        kind: row.insert.kind,
        toolName: null,
        toolInputJson: null,
        toolResponseText: null,
        assistantMessage: null,
        userPrompt: row.insert.userPrompt ?? null,
        filePath: null,
      }));
  }
  markProcessed(ids: readonly number[]): void {
    for (const row of this.rows) if (ids.includes(row.id)) row.processed = true;
  }
  countUnprocessed(sessionId: string): number {
    return this.rows.filter(
      (row) => row.sessionId === sessionId && !row.processed,
    ).length;
  }
  backfillSessionId(): number {
    return 0;
  }
}

/** The boot-scan watermark table, as the product's own budget spec fakes it. */
function fakeSqlite(state: { value: number | null }) {
  return {
    isOpen: true,
    db: {
      prepare: (sql: string) =>
        sql.includes('SELECT last_scanned_session_mtime')
          ? {
              get: () =>
                state.value === null
                  ? undefined
                  : { last_scanned_session_mtime: state.value },
            }
          : {
              run: (...args: unknown[]) => {
                state.value = args[2] as number;
                return { changes: 1 };
              },
            },
    },
  };
}

/** `SdkTranscriptReaderAdapter.read` over the session JSONL: `ROLE: text` records. */
function sessionReader(sessionsDir: () => string): ITranscriptReader {
  return {
    read: async (sessionId: string) => {
      let text: string;
      try {
        text = readFileSync(join(sessionsDir(), `${sessionId}.jsonl`), 'utf8');
      } catch {
        return '';
      }
      return text
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const parsed = JSON.parse(line) as {
            message: { role: string; content: { text: string }[] };
          };
          return `${parsed.message.role.toUpperCase()}: ${parsed.message.content
            .map((block) => block.text)
            .join('\n')}`;
        })
        .join('\n\n');
    },
  } as ITranscriptReader;
}

let root: string;
let home: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ms-b17-liveness-'));
  home = join(root, 'home');
  mkdirSync(join(home, 'memory-skills'), { recursive: true });
  copyFileSync(
    join(FIXTURES, 'distractors.v1.jsonl'),
    join(home, 'memory-skills', 'distractors.v1.jsonl'),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function buildParts(
  options: { watermark?: number | null; readerDir?: string } = {},
): LivenessParts & {
  store: InMemoryStore;
  watermark: { value: number | null };
} {
  const workspaceRoot = join(root, 'workspace');
  const sessionsDir = sessionsDirFor(home, workspaceRoot);
  const model = new ScriptedLivenessCurator();
  const store = new InMemoryStore();
  const reader = sessionReader(() => options.readerDir ?? sessionsDir);
  const curator = new MemoryCuratorService(
    logger(),
    {
      register: jest.fn(() => () => undefined),
    } as unknown as ICompactionCallbackRegistry,
    store as unknown as MemoryStore,
    reader,
    model,
  );
  const outcomes: CurateObservation[] = [];
  const observations = new InMemoryObservations();
  const watermark = { value: options.watermark ?? null };
  const trigger = new MemoryTriggerService(
    logger(),
    recordCurateOutcomes(curator, outcomes),
    registry(),
    registry(),
    {
      getWorkspaceRoot: () => workspaceRoot,
      getConfiguration: (_section: string, _key: string, fallback: unknown) =>
        fallback,
    } as never,
    {
      readFile: async () => {
        throw new Error('ENOENT');
      },
    } as never,
    fakeSqlite(watermark) as never,
    { findSessionsDirectory: async () => sessionsDir } as never,
    registry(),
    registry(),
    registry(),
    registry(),
    registry(),
    {
      tryAcquire: () => ({
        allowed: true,
        limit: 20,
        resetAt: 0,
        usedThisWindow: 0,
      }),
      refund: () => undefined,
    } as never,
    observations as unknown as ObservationQueueStore,
    registry(),
    reader,
    registry(),
  );
  return {
    trigger,
    curator,
    outcomes,
    observations,
    readWatermark: () => watermark.value,
    rows: () =>
      store.rows
        .filter((row) => row.workspaceRoot === workspaceRoot)
        .map((row) => ({ content: row.content, chunks: row.chunks })),
    sessionsDir,
    workspaceRoot,
    model,
    store,
    watermark,
  };
}

function byId(cases: readonly CaseRecord[]): Map<string, CaseRecord> {
  return new Map(cases.map((record) => [record.caseId, record]));
}

describe('mem.liveness.fault', () => {
  it('records fault modes (a)-(d) as failing today and the stalled control as passing', async () => {
    const parts = buildParts();
    const { result, cases } = await runLivenessFaultSuite({
      runDir: join(root, 'run'),
      home,
      options: {},
      parts,
    });
    const records = byId(cases);
    expect([...records.keys()]).toEqual([
      'fault/a-throw',
      'fault/b-zero-drafts',
      'fault/c-timeout',
      'fault/d-boot-scan',
      'control/stalled',
    ]);
    // (a) and (c): the failed call is reported 'ran' and consumes the input.
    expect(records.get('fault/a-throw')?.observed).toBe(
      "pass outcome 'ran'; 0 of 3 observations unprocessed",
    );
    expect(records.get('fault/c-timeout')?.observed).toBe(
      "pass outcome 'ran'; 0 of 3 observations unprocessed",
    );
    expect(records.get('fault/b-zero-drafts')?.outcome).toBe('fail');
    // (d): the watermark jumps over the failed middle session.
    expect(records.get('fault/d-boot-scan')?.observed).toContain(
      `watermark ${new Date(LIVENESS_MTIMES.fault + 120_000).toISOString()}`,
    );
    expect(records.get('fault/d-boot-scan')?.observed).toContain(
      'curate outcomes ran, ran, ran',
    );
    expect(parts.watermark.value).toBe(LIVENESS_MTIMES.fault + 120_000);
    expect(
      ['a-throw', 'b-zero-drafts', 'c-timeout', 'd-boot-scan'].map(
        (id) => records.get(`fault/${id}`)?.outcome,
      ),
    ).toEqual(['fail', 'fail', 'fail', 'fail']);
    expect(records.get('control/stalled')).toMatchObject({
      outcome: 'pass',
      observed: "pass outcome 'stalled'; 3 of 3 observations unprocessed",
    });

    const details = result.details as {
      ranPassesWithError: number;
      faults: { pass: boolean }[];
    };
    expect(details.ranPassesWithError).toBe(3);
    expect(details.faults).toHaveLength(4);
    expect(result.metrics['faults.passRate']).toBe(0 / 4);
    expect(result.verdict).toBe('fail');
    expect(result.modelCalls).toBe(0);
    expect(result.cost.calls).toBeGreaterThan(0);
    expect(result.baselines[0].id).toBe('recorded-at-freeze');
    // The suite removed its session files.
    expect(readdirSync(parts.sessionsDir)).toEqual([]);
  });

  it('reports the frozen baseline and its deltas when the plan supplies them', async () => {
    const { result } = await runLivenessFaultSuite({
      runDir: join(root, 'run'),
      home,
      options: {
        recordedAtFreeze: { 'faults.passRate': 0, ranPassesWithError: 3 },
      },
      parts: buildParts(),
    });
    expect(result.baselines[0].metrics).toEqual({
      'faults.passRate': 0,
      ranPassesWithError: 3,
    });
    expect(result.deltas['recorded-at-freeze']).toEqual({
      'faults.passRate': 0,
      ranPassesWithError: 0,
    });
  });

  it('refuses a boot-scan case the existing watermark already covers', async () => {
    await expect(
      runLivenessFaultSuite({
        runDir: join(root, 'run'),
        home,
        options: {},
        parts: buildParts({ watermark: LIVENESS_MTIMES.rescanSecond }),
      }),
    ).rejects.toThrow('already covers');
  });

  it('fails closed when the boot scan never reaches the curator', async () => {
    await expect(
      runLivenessFaultSuite({
        runDir: join(root, 'run'),
        home,
        options: {},
        parts: buildParts({ readerDir: join(root, 'nowhere') }),
      }),
    ).rejects.toThrow('never reached the curator');
  });
});

describe('mem.liveness.rescan', () => {
  it('re-extracts the same transcripts after a fixed fs.utimes bump (recorded failure)', async () => {
    const parts = buildParts();
    const { result, cases } = await runLivenessRescanSuite({
      runDir: join(root, 'run'),
      home,
      options: {},
      parts,
    });
    const details = result.details as {
      rescan: {
        newRows: number;
        extraModelCalls: number;
        duplicateGroupsDelta: number;
      };
    };
    // 3 sessions, one draft each: extract + resolve per session.
    expect(details.rescan).toEqual({
      newRows: 3,
      extraModelCalls: 6,
      duplicateGroupsDelta: 3,
    });
    expect(result.metrics['rescan.newChunks']).toBe(3);
    expect(result.metrics['rescan.sessionsRecurated']).toBe(3);
    expect(result.baselines.map((b) => b.id)).toEqual([
      'recorded-at-freeze',
      'transcript-hash-dedup',
    ]);
    expect(result.baselines[1].metrics['rescan.sessionsRecurated']).toBe(0);
    expect(cases.map((c) => c.outcome)).toEqual([
      'fail',
      'fail',
      'fail',
      'fail',
    ]);
    expect(result.verdict).toBe('fail');
    // The watermark followed the fixed second-scan mtimes.
    expect(parts.watermark.value).toBe(LIVENESS_MTIMES.rescanSecond + 120_000);
    expect(readdirSync(parts.sessionsDir)).toEqual([]);
  });

  it('sets fixed mtimes, so two runs produce identical case records', async () => {
    const first = await runLivenessRescanSuite({
      runDir: join(root, 'run-1'),
      home,
      options: {},
      parts: buildParts(),
    });
    const second = await runLivenessRescanSuite({
      runDir: join(root, 'run-2'),
      home,
      options: {},
      parts: buildParts(),
    });
    const strip = (records: readonly CaseRecord[]) =>
      records.map(({ latencyMs: _latency, ...rest }) => rest);
    expect(strip(second.cases)).toEqual(strip(first.cases));
  });

  it('is na: vacuous-first-scan when the first scan curates nothing', async () => {
    const { result, cases } = await runLivenessRescanSuite({
      runDir: join(root, 'run'),
      home,
      options: {},
      parts: buildParts({ readerDir: join(root, 'nowhere') }),
    });
    expect(result.verdict).toBe('na');
    expect(result.naReason).toBe('vacuous-first-scan');
    expect(cases.every((c) => c.error === 'vacuous-first-scan')).toBe(true);
    expect(cases.every((c) => c.outcome === 'fail')).toBe(true);
  });
});

describe('liveness helpers', () => {
  it('reproduces the double’s fault shapes and counts every call', async () => {
    const model = new ScriptedLivenessCurator();
    model.setFault('LV-x', 'timeout');
    await expect(model.extract('USER: LV-x here')).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    model.setFault('LV-x', 'throw');
    await expect(model.extract('USER: LV-x here')).rejects.toThrow(
      "injected fault 'throw'",
    );
    model.clearFaults();
    const ok = await model.extract('USER: LV-x and LV-y');
    expect(ok).toMatchObject({ status: 'extracted' });
    expect(ok.status === 'extracted' ? ok.drafts.length : -1).toBe(2);
    expect(model.calls()).toBe(3);
  });

  it('fails closed when the trigger no longer has the private methods', () => {
    expect(() => triggerInternals({} as MemoryTriggerService)).toThrow(
      'no longer has invokeCurate/runBootScan',
    );
  });

  it('escapes the workspace like JsonlReaderService', () => {
    expect(sessionsDirFor('/h', 'C:\\work\\repo')).toBe(
      join('/h', '.claude', 'projects', 'C--work-repo'),
    );
  });
});
