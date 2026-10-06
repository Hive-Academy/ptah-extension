import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  CuratorExtraction,
  ExtractedMemoryDraft,
  ICuratorLLM,
  ResolvedMemoryDraft,
} from '@ptah-extension/memory-contracts';

import {
  CassetteEntry,
  CassetteMissError,
  CassetteStore,
} from './cassette-store';
import {
  CuratorFaultMode,
  RecordedCuratorLlm,
  curatorExtractKey,
  curatorResolveKey,
} from './recorded-curator-llm';

const TRANSCRIPT = 'user: we ship on Fridays';
const DRAFT: ExtractedMemoryDraft = {
  kind: 'fact',
  subject: 'release day',
  content: 'The team ships on Fridays',
  salienceHint: 1,
};
const EXTRACTION: CuratorExtraction = {
  status: 'extracted',
  drafts: [DRAFT],
};
const RESOLVED: ResolvedMemoryDraft = { ...DRAFT, mergeTargetId: null };

function fakeInner(): ICuratorLLM & {
  extract: jest.Mock;
  resolve: jest.Mock;
} {
  return {
    extract: jest.fn(async () => EXTRACTION),
    resolve: jest.fn(async () => [RESOLVED]),
  };
}

/** The error a promise rejected with; fails the test when it resolved. */
async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the promise to reject');
}

describe('RecordedCuratorLlm', () => {
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

  function recordInto(path: string, inner: ICuratorLLM): RecordedCuratorLlm {
    return new RecordedCuratorLlm({
      store: new CassetteStore({ path, mode: 'record' }),
      model: 'test-model',
      inner,
    });
  }

  function replayFrom(
    path: string,
    faults?: Record<string, CuratorFaultMode>,
  ): RecordedCuratorLlm {
    return new RecordedCuratorLlm({
      store: new CassetteStore({ path, mode: 'replay' }),
      model: 'test-model',
      faults,
    });
  }

  it('round-trips extract and resolve from record to replay', async () => {
    const path = cassette('round-trip');
    const inner = fakeInner();
    const recorder = recordInto(path, inner);

    await expect(recorder.extract(TRANSCRIPT)).resolves.toEqual(EXTRACTION);
    await expect(recorder.resolve([DRAFT], [])).resolves.toEqual([RESOLVED]);
    expect(inner.extract).toHaveBeenCalledTimes(1);
    expect(inner.resolve).toHaveBeenCalledTimes(1);

    const replayer = replayFrom(path);
    await expect(replayer.extract(TRANSCRIPT)).resolves.toEqual(EXTRACTION);
    await expect(replayer.resolve([DRAFT], [])).resolves.toEqual([RESOLVED]);
  });

  it('writes {key, method, model, promptSha, response} entries', async () => {
    const path = cassette('entry-shape');
    await recordInto(path, fakeInner()).extract(TRANSCRIPT);

    const [entry] = readEntries(path);
    expect(entry.key).toBe(curatorExtractKey(TRANSCRIPT));
    expect(entry.method).toBe('extract');
    expect(entry.model).toBe('test-model');
    expect(entry.promptSha).toBe(
      createHash('sha256').update(TRANSCRIPT, 'utf8').digest('hex'),
    );
    expect(entry.response).toEqual(EXTRACTION);
    expect(entry.usage).toBeUndefined();
  });

  it('throws CassetteMissError on an unrecorded key', async () => {
    const replayer = replayFrom(cassette('missing-file'));

    const miss = replayer.extract('user: never recorded this');
    await expect(miss).rejects.toBeInstanceOf(CassetteMissError);
    const error = (await rejectionOf(miss)) as CassetteMissError;
    expect(error.name).toBe('CassetteMissError');
    expect(error.method).toBe('extract');
    expect(error.key).toBe(curatorExtractKey('user: never recorded this'));
  });

  it('keys resolve on sorted candidates, so reordering replays (R9)', async () => {
    const path = cassette('candidate-order');
    const a = { id: 'a', subject: 'alpha', content: 'first' };
    const b = { id: 'b', subject: 'beta', content: 'second' };

    await recordInto(path, fakeInner()).resolve([DRAFT], [b, a]);
    const replayer = replayFrom(path);

    // Reordered candidates produce the same key and replay the same entry.
    await expect(replayer.resolve([DRAFT], [a, b])).resolves.toEqual([
      RESOLVED,
    ]);
    expect(curatorResolveKey([DRAFT], [b, a])).toBe(
      curatorResolveKey([DRAFT], [a, b]),
    );
  });

  it('counts calls across record and replay for the rescan invariant', async () => {
    const path = cassette('call-counts');
    const recorder = recordInto(path, fakeInner());
    await recorder.extract(TRANSCRIPT);
    await recorder.resolve([DRAFT], []);
    expect(recorder.callCounts()).toEqual({ extract: 1, resolve: 1 });

    const replayer = replayFrom(path);
    await replayer.extract(TRANSCRIPT);
    await replayer.resolve([DRAFT], []);
    expect(replayer.callCounts()).toEqual({ extract: 1, resolve: 1 });
  });

  describe('fault modes', () => {
    const key = curatorExtractKey(TRANSCRIPT);

    it('throws a non-network error', async () => {
      const replayer = replayFrom(cassette('fault-throw'), { [key]: 'throw' });
      await expect(replayer.extract(TRANSCRIPT)).rejects.toThrow(
        /injected fault 'throw'/,
      );
    });

    it('returns zero drafts', async () => {
      const replayer = replayFrom(cassette('fault-zero'), {
        [key]: 'zero-drafts',
        [curatorResolveKey([DRAFT], [])]: 'zero-drafts',
      });
      await expect(replayer.extract(TRANSCRIPT)).resolves.toEqual({
        status: 'extracted',
        drafts: [],
      });
      await expect(replayer.resolve([DRAFT], [])).resolves.toEqual([]);
    });

    it('times out', async () => {
      const replayer = replayFrom(cassette('fault-timeout'), {
        [key]: 'timeout',
      });
      const promise = replayer.extract(TRANSCRIPT);
      await expect(promise).rejects.toThrow(/timed out/);
      expect((await rejectionOf(promise)).name).toBe('TimeoutError');
    });

    it('answers a stalled extraction', async () => {
      const replayer = replayFrom(cassette('fault-stalled'), {
        [key]: 'stalled',
      });
      await expect(replayer.extract(TRANSCRIPT)).resolves.toEqual({
        status: 'stalled',
        reason: 'provider-unreachable',
        providerId: '',
      });
    });

    it('refuses the stalled fault on resolve, which has no stalled arm', async () => {
      const replayer = replayFrom(cassette('fault-stalled-resolve'), {
        [curatorResolveKey([DRAFT], [])]: 'stalled',
      });
      await expect(replayer.resolve([DRAFT], [])).rejects.toThrow(
        /not valid for resolve/,
      );
    });
  });

  describe('construction guards', () => {
    it('requires the real adapter in record mode', () => {
      expect(
        () =>
          new RecordedCuratorLlm({
            store: new CassetteStore({
              path: cassette('guard-record'),
              mode: 'record',
            }),
            model: 'test-model',
          }),
      ).toThrow(/record mode requires `inner`/);
    });

    it('refuses the real adapter in replay mode', () => {
      expect(
        () =>
          new RecordedCuratorLlm({
            store: new CassetteStore({
              path: cassette('guard-replay'),
              mode: 'replay',
            }),
            model: 'test-model',
            inner: fakeInner(),
          }),
      ).toThrow(/replay mode refuses `inner`/);
    });

    it('refuses fault modes in record mode', () => {
      expect(
        () =>
          new RecordedCuratorLlm({
            store: new CassetteStore({
              path: cassette('guard-faults'),
              mode: 'record',
            }),
            model: 'test-model',
            inner: fakeInner(),
            faults: { deadbeef: 'throw' },
          }),
      ).toThrow(/fault modes are replay-only/);
    });
  });
});
