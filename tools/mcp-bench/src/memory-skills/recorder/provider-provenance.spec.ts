import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  commitProvenanceSidecars,
  discardStagedCassettes,
  expectedRouteFor,
  provenanceMismatch,
  provenanceProblems,
  provenanceSidecarPath,
  readStagedCassetteEntries,
  writeProvenanceSidecar,
  type ModelDispatchProvenance,
} from './provider-provenance';

const curator = (provider: string, model: string): ModelDispatchProvenance => ({
  resolvedProviderId: provider,
  resolvedModelId: model,
  component: 'memory-curator',
  laneId: 'memory-curator',
});

describe('provenance checks', () => {
  const expected = {
    expectedProviderId: 'openai-codex',
    expectedModelId: 'gpt-5.6-terra',
  };

  it('accepts an exact provider and model', () => {
    expect(
      provenanceMismatch({
        cassetteKey: 'k',
        dispatch: curator('openai-codex', 'gpt-5.6-terra'),
        ...expected,
      }),
    ).toBeNull();
  });

  it('rejects an alias, an empty provider, and a missing dispatch', () => {
    expect(
      provenanceMismatch({
        cassetteKey: 'k',
        dispatch: curator('openai', 'gpt-5.6-terra'),
        ...expected,
      }),
    ).toMatch(/openai does not match openai-codex/);
    expect(
      provenanceMismatch({
        cassetteKey: 'k',
        dispatch: curator('openai-codex', 'gpt-5.6-terra-latest'),
        ...expected,
      }),
    ).toMatch(/gpt-5.6-terra-latest does not match gpt-5.6-terra/);
    expect(
      provenanceMismatch({
        cassetteKey: 'k',
        dispatch: curator('', 'gpt-5.6-terra'),
        ...expected,
      }),
    ).toMatch(/provider is empty/);
    expect(
      provenanceMismatch({
        cassetteKey: 'k',
        dispatch: undefined,
        ...expected,
      }),
    ).toMatch(/provenance missing/);
  });

  it('rejects a count mismatch and reads the expected route from settings', () => {
    expect(
      provenanceProblems({
        component: 'memory-curator',
        entries: [{ key: 'a' }, { key: 'b' }],
        dispatches: [curator('openai-codex', 'gpt-5.6-terra')],
        expectedFor: (dispatch) =>
          expectedRouteFor(
            dispatch,
            { 'memory.curatorProvider': 'openai-codex' },
            'gpt-5.6-terra',
          ),
      }),
    ).toEqual(['staged cassette has 2 entries but 1 provenance dispatches']);
    expect(
      expectedRouteFor(
        {
          resolvedProviderId: 'x',
          resolvedModelId: 'y',
          component: 'skill-lane',
          laneId: 'judge',
        },
        {
          'skillSynthesis.judge.provider': 'openai-codex',
          'skillSynthesis.judge.model': 'gpt-5.6-terra',
        },
        'none',
      ),
    ).toEqual({ providerId: 'openai-codex', modelId: 'gpt-5.6-terra' });
  });

  it('accepts one skill-lane retry and rejects a third dispatch', () => {
    const lane = (): ModelDispatchProvenance => ({
      resolvedProviderId: 'openai-codex',
      resolvedModelId: 'gpt-5.6-terra',
      component: 'skill-lane',
      laneId: 'judge',
    });
    const expectedFor = (
      dispatch: ModelDispatchProvenance,
    ): {
      providerId: string;
      modelId: string;
    } =>
      expectedRouteFor(
        dispatch,
        {
          'skillSynthesis.judge.provider': 'openai-codex',
          'skillSynthesis.judge.model': 'gpt-5.6-terra',
        },
        'gpt-5.6-terra',
      );
    expect(
      provenanceProblems({
        component: 'skill-lane',
        entries: [{ key: 'a' }],
        dispatches: [lane(), lane()],
        expectedFor,
      }),
    ).toEqual([]);
    expect(
      provenanceProblems({
        component: 'skill-lane',
        entries: [{ key: 'a' }],
        dispatches: [lane(), lane(), lane()],
        expectedFor,
      }),
    ).toEqual(['staged cassette has 1 entries but 3 provenance dispatches']);
    expect(
      provenanceProblems({
        component: 'memory-curator',
        entries: [{ key: 'a' }],
        dispatches: [
          curator('openai-codex', 'gpt-5.6-terra'),
          curator('openai-codex', 'gpt-5.6-terra'),
        ],
        expectedFor: (dispatch) =>
          expectedRouteFor(
            dispatch,
            { 'memory.curatorProvider': 'openai-codex' },
            'gpt-5.6-terra',
          ),
      }),
    ).toEqual(['staged cassette has 1 entries but 2 provenance dispatches']);
  });

  it('accepts zero dispatches when the cassette has zero entries', () => {
    expect(
      provenanceProblems({
        component: 'memory-curator',
        entries: [],
        dispatches: [],
        expectedFor: () => ({ providerId: 'unused', modelId: 'unused' }),
      }),
    ).toEqual([]);
    expect(
      provenanceProblems({
        component: 'skill-lane',
        entries: [],
        dispatches: [],
        expectedFor: () => ({ providerId: 'unused', modelId: 'unused' }),
      }),
    ).toEqual([]);
  });

  it('rejects an empty provider even when the count matches', () => {
    expect(
      provenanceProblems({
        component: 'memory-curator',
        entries: [{ key: 'a' }],
        dispatches: [curator('', 'gpt-5.6-terra')],
        expectedFor: () => ({
          providerId: 'openai-codex',
          modelId: 'gpt-5.6-terra',
        }),
      }),
    ).toEqual([
      'provenance provider is empty for cassette key a',
      'staged cassette has 1 entries but 0 matching provenance dispatches',
    ]);
  });
});

describe('staged cassette sidecar', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ptah-620-provenance-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads entries, writes a sidecar, and discard deletes both', () => {
    const cassette = join(dir, 'curator.jsonl');
    const dispatch = curator('openai-codex', 'gpt-5.6-terra');
    writeFileSync(
      cassette,
      `${JSON.stringify({ key: 'k', method: 'extract', model: 'gpt-5.6-terra', promptSha: 'ab', response: {} })}\n`,
    );
    expect(readStagedCassetteEntries(cassette)).toEqual([{ key: 'k' }]);
    writeProvenanceSidecar(
      cassette,
      'memory-curator',
      [{ key: 'k' }],
      [dispatch],
    );
    const sidecar = JSON.parse(
      readFileSync(provenanceSidecarPath(cassette), 'utf8'),
    );
    expect(sidecar).toMatchObject({
      schemaId: '620.cassette-provenance.v1',
      component: 'memory-curator',
      entries: [
        {
          key: 'k',
          resolvedProviderId: 'openai-codex',
          resolvedModelId: 'gpt-5.6-terra',
        },
      ],
    });
    discardStagedCassettes([cassette]);
    expect(existsSync(cassette)).toBe(false);
    expect(existsSync(provenanceSidecarPath(cassette))).toBe(false);
  });

  it('leaves no cassette or sidecar when the second sidecar write throws', () => {
    const first = join(dir, 'curator.jsonl');
    const second = join(dir, 'lane.jsonl');
    writeFileSync(first, `${JSON.stringify({ key: 'a' })}\n`);
    writeFileSync(second, `${JSON.stringify({ key: 'b' })}\n`);
    const curatorDispatch = curator('openai-codex', 'gpt-5.6-terra');
    const laneDispatch: ModelDispatchProvenance = {
      resolvedProviderId: 'openai-codex',
      resolvedModelId: 'gpt-5.6-terra',
      component: 'skill-lane',
      laneId: 'judge',
    };
    let writes = 0;
    expect(() =>
      commitProvenanceSidecars(
        [
          {
            component: 'memory-curator',
            path: first,
            entries: [{ key: 'a' }],
            dispatches: [curatorDispatch],
          },
          {
            component: 'skill-lane',
            path: second,
            entries: [{ key: 'b' }],
            dispatches: [laneDispatch],
          },
        ],
        (path, component, entries, dispatches) => {
          writes += 1;
          if (writes === 2) throw new Error('sidecar write failed');
          writeProvenanceSidecar(path, component, entries, dispatches);
        },
      ),
    ).toThrow(/sidecar write failed/);
    expect(writes).toBe(2);
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(false);
    expect(existsSync(provenanceSidecarPath(first))).toBe(false);
    expect(existsSync(provenanceSidecarPath(second))).toBe(false);
  });
});
