import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  LaneRunRequest,
  LaneRunResult,
} from '@ptah-extension/skill-synthesis';

import {
  CassetteEntry,
  CassetteMissError,
  CassetteRecordRefusalError,
  CassetteStore,
} from './cassette-store';
import {
  LaneRunnerDouble,
  RecordedLaneRunner,
  laneRunKey,
} from './recorded-lane-runner';

const OK: LaneRunResult = {
  status: 'ok',
  run: {
    // The double passes the result through, so the spec pins only the shape
    // it reads back; the full `ResolvedSkillLane` is irrelevant here.
    lane: { id: 'judge' },
    text: 'judged',
    json: { verdict: 'accept' },
    structuredOutputHonoured: true,
    usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.1 },
    truncated: false,
    degradedReason: null,
    executions: 1,
    passesAllowed: 1,
  },
} as unknown as LaneRunResult;

const FAILED: LaneRunResult = {
  status: 'failed',
  failure: { kind: 'network', message: 'unreachable' },
} as unknown as LaneRunResult;

/** The error a promise rejected with; fails the test when it resolved. */
async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the promise to reject');
}

function request(overrides: Partial<LaneRunRequest> = {}): LaneRunRequest {
  return {
    laneId: 'judge' as LaneRunRequest['laneId'],
    prompt: 'judge this candidate',
    outputSchema: { verdict: 'accept | reject' },
    ...overrides,
  };
}

describe('RecordedLaneRunner', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-bench-cassette-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function cassette(name: string): string {
    return join(dir, `${name}.jsonl`);
  }

  function readEntries(path: string): CassetteEntry[] {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as CassetteEntry);
  }

  function recordInto(
    path: string,
    inner: LaneRunnerDouble,
    pause?: () => void | Promise<void>,
    recordFailures?: boolean,
  ): RecordedLaneRunner {
    return new RecordedLaneRunner({
      store: new CassetteStore({ path, mode: 'record' }),
      model: 'test-model',
      inner,
      pause,
      recordFailures,
    });
  }

  function replayFrom(
    path: string,
    pause?: () => void | Promise<void>,
  ): RecordedLaneRunner {
    return new RecordedLaneRunner({
      store: new CassetteStore({ path, mode: 'replay' }),
      model: 'test-model',
      pause,
    });
  }

  it('round-trips a run from record to replay', async () => {
    const path = cassette('round-trip');
    const run = jest.fn(
      async (_req: LaneRunRequest): Promise<LaneRunResult> => OK,
    );
    const recorder = recordInto(path, { run });

    await expect(recorder.run(request())).resolves.toEqual(OK);
    expect(run).toHaveBeenCalledTimes(1);

    await expect(replayFrom(path).run(request())).resolves.toEqual(OK);
  });

  it('writes {key, method, model, promptSha, response, usage} entries', async () => {
    const path = cassette('entry-shape');
    const req = request();
    const run = jest.fn(
      async (_req: LaneRunRequest): Promise<LaneRunResult> => OK,
    );
    await recordInto(path, { run }).run(req);

    const [entry] = readEntries(path);
    expect(entry.key).toBe(laneRunKey(req));
    expect(entry.method).toBe('run');
    expect(entry.model).toBe('test-model');
    expect(entry.promptSha).toBe(
      createHash('sha256').update(req.prompt, 'utf8').digest('hex'),
    );
    expect(entry.response).toEqual(OK);
    expect(entry.usage).toEqual({ input: 10, output: 5, costUsd: 0.1 });
  });

  it('refuses to record a non-ok result without recordFailures', async () => {
    const path = cassette('failed-refused');
    const run = jest.fn(
      async (_req: LaneRunRequest): Promise<LaneRunResult> => FAILED,
    );
    const recorder = recordInto(path, { run });

    const refusal = recorder.run(request());
    await expect(refusal).rejects.toBeInstanceOf(CassetteRecordRefusalError);
    const error = (await rejectionOf(refusal)) as CassetteRecordRefusalError;
    expect(error.name).toBe('CassetteRecordRefusalError');
    expect(error.method).toBe('run');
    expect(error.message).toMatch(/lane result status 'failed'/);
    expect(error.message).toMatch(/recordFailures/);

    // Nothing was persisted: replay of the same key still misses.
    const miss = replayFrom(path).run(request());
    await expect(miss).rejects.toBeInstanceOf(CassetteMissError);
  });

  it('omits usage when the run failed', async () => {
    const path = cassette('failed-run');
    const run = jest.fn(
      async (_req: LaneRunRequest): Promise<LaneRunResult> => FAILED,
    );
    await recordInto(path, { run }, undefined, true).run(request());

    const [entry] = readEntries(path);
    expect(entry.usage).toBeUndefined();
    expect(entry.response).toEqual(FAILED);
  });

  it('throws CassetteMissError on an unrecorded key', async () => {
    const replayer = replayFrom(cassette('missing-file'));
    const req = request({ prompt: 'never recorded' });

    const miss = replayer.run(req);
    await expect(miss).rejects.toBeInstanceOf(CassetteMissError);
    const error = (await rejectionOf(miss)) as CassetteMissError;
    expect(error.name).toBe('CassetteMissError');
    expect(error.method).toBe('run');
    expect(error.key).toBe(laneRunKey(req));
  });

  it('excludes run-context and host state from the key', async () => {
    const path = cassette('run-context');
    const controller = new AbortController();
    const run = jest.fn(
      async (_req: LaneRunRequest): Promise<LaneRunResult> => OK,
    );
    await recordInto(path, { run }).run(
      request({
        queueItemId: 'row-1',
        attempt: 1,
        mcpServerRunning: true,
        mcpPort: 7799,
        signal: controller.signal,
      }),
    );

    // Same model-facing fields, different run context and host state.
    await expect(
      replayFrom(path).run(
        request({
          queueItemId: 'row-999',
          attempt: 3,
          mcpServerRunning: false,
          mcpPort: 1234,
        }),
      ),
    ).resolves.toEqual(OK);
  });

  it('awaits the pause hook once per call', async () => {
    const path = cassette('pause');
    const run = jest.fn(
      async (_req: LaneRunRequest): Promise<LaneRunResult> => OK,
    );
    const pauses = jest.fn(async () => undefined);
    const recorder = recordInto(path, { run }, pauses);
    await recorder.run(request());
    await recorder.run(request({ prompt: 'second' }));

    const replayPauses = jest.fn(async () => undefined);
    const replayer = replayFrom(path, replayPauses);
    await replayer.run(request());
    expect(pauses).toHaveBeenCalledTimes(2);
    expect(replayPauses).toHaveBeenCalledTimes(1);
  });

  describe('construction guards', () => {
    it('requires the real runner in record mode', () => {
      expect(
        () =>
          new RecordedLaneRunner({
            store: new CassetteStore({
              path: cassette('guard-record'),
              mode: 'record',
            }),
            model: 'test-model',
          }),
      ).toThrow(/record mode requires `inner`/);
    });

    it('refuses the real runner in replay mode', () => {
      expect(
        () =>
          new RecordedLaneRunner({
            store: new CassetteStore({
              path: cassette('guard-replay'),
              mode: 'replay',
            }),
            model: 'test-model',
            inner: { run: async () => OK },
          }),
      ).toThrow(/replay mode refuses `inner`/);
    });
  });
});
