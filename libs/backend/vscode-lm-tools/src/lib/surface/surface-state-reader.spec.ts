import type {
  SurfaceComponent,
  SurfaceContent,
  SurfaceDataModel,
  SurfaceSubmitRecord,
} from '@ptah-extension/shared';
import { jsonUtf8Bytes } from '@ptah-extension/platform-core';
import {
  SURFACE_LIMITS,
  describeSurfaceSelection,
  validateSurfaceDocument,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import {
  SURFACE_READER_MIN_STATE_READ_BYTES,
  SurfaceStateReader,
  collectSurfaceFormValues,
  toSurfaceStateView,
} from './surface-state-reader';
import {
  SurfaceStateStore,
  createSurfaceRecord,
  type SurfaceRecord,
} from './surface-state.store';

const FORM: SurfaceComponent = {
  kind: 'card',
  id: 'form',
  title: { text: 'Profile' },
  actions: [{ id: 'send', action: 'surface.submit', label: { text: 'Send' } }],
  children: [
    {
      kind: 'text',
      id: 'name',
      label: 'Name',
      path: 'form.name',
      hints: { required: true },
    },
    { kind: 'text', id: 'name-again', label: 'Name again', path: 'form.name' },
    {
      kind: 'select',
      id: 'plan',
      label: 'Plan',
      path: 'form.plan',
      options: [
        { value: 'free', label: 'Free' },
        { value: 'pro', label: 'Pro' },
      ],
      hints: { required: true },
    },
    { kind: 'checkbox', id: 'agree', label: 'Agree', path: 'form.agree' },
  ],
};

const STAT: SurfaceComponent = {
  kind: 'stat',
  id: 'users',
  title: { text: 'Users' },
  value: 42,
};

function v2Content(
  surfaceId: string,
  dataModel: SurfaceDataModel = { form: { name: 'Ada' } },
  components: readonly SurfaceComponent[] = [FORM, STAT],
): SurfaceContent {
  return {
    contract: 'dashboard-spec/2',
    surface: {
      schemaVersion: 'dashboard-spec/2',
      catalogVersion: 'dashboard-catalog/2',
      surfaceId,
      title: { text: `Title of ${surfaceId}` },
      components,
    },
    dataModel,
  };
}

const V1_CONTENT: SurfaceContent = {
  contract: 'dashboard-spec/1',
  spec: {
    schemaVersion: 'dashboard-spec/1',
    catalogVersion: 'dashboard-catalog/1',
    specId: 'weekly',
    revision: 3,
    generatedAt: '2026-09-24T00:00:00Z',
    title: { text: 'Weekly' },
    components: [{ kind: 'stat', id: 'users', value: 7 }],
  },
};

const LAST_SUBMIT: SurfaceSubmitRecord = {
  operationId: 'op-1700000000000-abcdefgh',
  actionId: 'send',
  scopeComponentId: 'form',
  baseRevision: 4,
  status: 'applied',
  submittedAt: 1_700_000_000_000,
  values: [{ componentId: 'name', path: 'form.name', value: 'Ada' }],
};

function setup() {
  const store = new SurfaceStateStore();
  const reader = new SurfaceStateReader(store);
  return { store, reader };
}

function withState(
  surfaceId: string,
  revision: number,
  content: SurfaceContent = v2Content(surfaceId),
): SurfaceRecord {
  return {
    ...createSurfaceRecord(surfaceId, content, revision),
    selection: { componentId: 'users', target: { kind: 'stat' } },
    lastSubmit: LAST_SUBMIT,
  };
}

/** Padding split into values of at most 2,000 characters (maxStringLength). */
function padded(chars: number, fill = 'x'): SurfaceDataModel {
  const model: Record<string, string> = {};
  for (let index = 0; chars > 0; index++) {
    const take = Math.min(2_000, chars);
    model[`k${index}`] = fill.repeat(take);
    chars -= take;
  }
  return model;
}

/** The JSON payload that follows the one-line header. */
function payloadOf(text: string): Record<string, unknown> {
  return JSON.parse(text.slice(text.indexOf('\n') + 1)) as Record<
    string,
    unknown
  >;
}

describe('collectSurfaceFormValues', () => {
  it('keys values by unique path with every bound input and its submit issues', () => {
    expect(collectSurfaceFormValues(v2Content('p'))).toEqual({
      'form.name': {
        value: 'Ada',
        inputs: ['name', 'name-again'],
        submitIssues: [],
      },
      'form.plan': {
        value: null,
        inputs: ['plan'],
        submitIssues: ['plan: is required.'],
      },
      'form.agree': { value: false, inputs: ['agree'], submitIssues: [] },
    });
  });

  it('yields no form values for v1 content', () => {
    expect(collectSurfaceFormValues(V1_CONTENT)).toEqual({});
  });
});

describe('SurfaceStateReader.read (complete, for RPC)', () => {
  it('returns the complete view of a named surface', () => {
    const { store, reader } = setup();
    const stored = withState('profile', 5);
    store.commit('tab-1', stored);
    expect(reader.read('tab-1', 'profile')).toEqual({
      status: 'found',
      routingId: 'tab-1',
      surfaces: [
        {
          surfaceId: 'profile',
          revision: 5,
          content: stored.content,
          selection: stored.selection,
          lastSubmit: LAST_SUBMIT,
        },
      ],
    });
  });

  it('returns every surface of the routing id when no id is named', () => {
    const { store, reader } = setup();
    store.commit('tab-1', withState('b', 2));
    store.commit('tab-1', withState('a', 1, V1_CONTENT));
    const result = reader.read('tab-1');
    expect(result).toMatchObject({ status: 'found' });
    if (result.status !== 'found') return;
    expect(result.surfaces.map((view) => view.surfaceId)).toEqual(['a', 'b']);
    expect(result.surfaces[0]).toEqual(
      toSurfaceStateView(withState('a', 1, V1_CONTENT)),
    );
  });

  it('answers not-found for an absent id and for another routing id', () => {
    const { store, reader } = setup();
    store.commit('tab-1', withState('profile', 1));
    expect(reader.read('tab-1', 'missing')).toEqual({ status: 'not-found' });
    expect(reader.read('tab-2', 'profile')).toEqual({ status: 'not-found' });
    expect(reader.read('tab-2')).toEqual({
      status: 'found',
      routingId: 'tab-2',
      surfaces: [],
    });
  });
});

describe('SurfaceStateReader.describeForAgent', () => {
  it('returns one complete state: data model, form values, selection and last submit', () => {
    const { store, reader } = setup();
    const stored = withState('profile', 5);
    store.commit('tab-1', stored);
    const result = reader.describeForAgent('tab-1', { surfaceId: 'profile' });
    expect(result).toMatchObject({
      status: 'found',
      truncated: false,
      omittedSurfaceIds: [],
    });
    if (result.status !== 'found') return;
    expect(payloadOf(result.text)).toEqual({
      surfaceId: 'profile',
      revision: 5,
      contract: 'dashboard-spec/2',
      dataModel: { form: { name: 'Ada' } },
      formValues: collectSurfaceFormValues(stored.content),
      selection: {
        componentId: 'users',
        target: { kind: 'stat' },
        description: describeSurfaceSelection(stored.content, stored.selection),
      },
      lastSubmit: LAST_SUBMIT,
    });
    expect(result.text).not.toContain('Title of profile');
  });

  it('returns the component tree for view structure', () => {
    const { store, reader } = setup();
    const stored = withState('profile', 5);
    store.commit('tab-1', stored);
    store.commit('tab-1', withState('weekly', 6, V1_CONTENT));
    const v2 = reader.describeForAgent('tab-1', {
      surfaceId: 'profile',
      view: 'structure',
    });
    expect(v2.status).toBe('found');
    if (v2.status !== 'found') return;
    expect(payloadOf(v2.text)).toEqual({
      surfaceId: 'profile',
      revision: 5,
      contract: 'dashboard-spec/2',
      structure:
        stored.content.contract === 'dashboard-spec/2'
          ? stored.content.surface
          : null,
    });
    const v1 = reader.describeForAgent('tab-1', {
      surfaceId: 'weekly',
      view: 'structure',
    });
    expect(v1.status === 'found' && payloadOf(v1.text)['structure']).toEqual(
      V1_CONTENT.contract === 'dashboard-spec/1' ? V1_CONTENT.spec : null,
    );
  });

  it('rejects the structure view without a surface id', () => {
    const { reader } = setup();
    expect(
      reader.describeForAgent('tab-1', { view: 'structure' }),
    ).toMatchObject({
      status: 'rejected',
    });
  });

  it('answers not-found for another routing id and for an empty routing id', () => {
    const { store, reader } = setup();
    store.commit('tab-1', withState('profile', 1));
    expect(
      reader.describeForAgent('tab-2', { surfaceId: 'profile' }),
    ).toMatchObject({
      status: 'not-found',
    });
    expect(reader.describeForAgent('tab-2', {})).toMatchObject({
      status: 'not-found',
    });
  });

  it('lists every id and revision first, then whole states, then a marker naming the omitted ids', () => {
    const store = new SurfaceStateStore();
    for (const [index, id] of ['a', 'b', 'c'].entries())
      store.commit(
        'tab-1',
        withState(id, index + 1, v2Content(id, padded(15_000))),
      );
    // Room for the index, two ~15 KB states and the marker, but not three.
    const bound = SURFACE_READER_MIN_STATE_READ_BYTES;
    const reader = new SurfaceStateReader(store, { maxStateReadBytes: bound });
    const result = reader.describeForAgent('tab-1', {});
    expect(result).toMatchObject({
      status: 'found',
      truncated: true,
      omittedSurfaceIds: ['c'],
    });
    if (result.status !== 'found') return;
    const lines = result.text.split('\n');
    expect(lines.slice(0, 4)).toEqual([
      'Surfaces in this conversation (3):',
      '- "a" revision 1 (dashboard-spec/2)',
      '- "b" revision 2 (dashboard-spec/2)',
      '- "c" revision 3 (dashboard-spec/2)',
    ]);
    expect(JSON.parse(lines[4])).toMatchObject({ surfaceId: 'a', revision: 1 });
    expect(JSON.parse(lines[5])).toMatchObject({ surfaceId: 'b', revision: 2 });
    expect(lines[6]).toMatch(
      /^\[truncated: .*: "c"\. Read each one with its surfaceId\.\]$/,
    );
    expect(lines).toHaveLength(7);
    expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(bound);
  });

  // Review finding 3 (Batch 9, round 1): eight states whose complete text is
  // just under the bound must all be returned, with no marker. The reviewer's
  // scenario used the former 320 KiB default, kept here as an explicit bound
  // (stat-only states cannot approach the 548 KiB default).
  it('returns every complete state without a marker when all fit just under the bound', () => {
    const store = new SurfaceStateStore();
    const ids = ['0', '1', '2', '3', '4', '5', '6', '7'];
    // A fixed key set (k0..k19 plus e0..e3), so the text grows by exactly one
    // byte per extra ASCII character; every value stays within 2,000 chars.
    const commit = (id: string, extra: number): void => {
      const model: Record<string, SurfaceDataModel[string]> = {
        ...padded(40_000),
      };
      for (let index = 0; index < 4; index++) {
        const take = Math.max(0, Math.min(2_000, extra - index * 2_000));
        model[`e${index}`] = 'x'.repeat(take);
      }
      const content = v2Content(id, model, [STAT]);
      if (content.contract !== 'dashboard-spec/2') throw new Error('v2 only');
      // The fixture is admissible content, not merely store-acceptable.
      expect(
        validateSurfaceDocument(
          { ...content.surface, dataModel: content.dataModel },
          jsonUtf8Bytes,
        ).ok,
      ).toBe(true);
      store.commit('tab-1', createSurfaceRecord(id, content, 1));
    };
    for (const id of ids) commit(id, 0);
    const measure = new SurfaceStateReader(store, {
      maxStateReadBytes: 10 * 1024 * 1024,
    }).describeForAgent('tab-1', {});
    const measured =
      measure.status === 'found' ? Buffer.byteLength(measure.text) : 0;
    const bound = 320 * 1024;
    const extra = bound - 73 - measured;
    expect(extra).toBeGreaterThan(0);
    expect(extra).toBeLessThanOrEqual(8_000);
    // Grow the last surface so the complete text lands 73 bytes under the
    // bound: too little room for any truncation marker.
    commit('7', extra);
    const result = new SurfaceStateReader(store, {
      maxStateReadBytes: bound,
    }).describeForAgent('tab-1', {});
    expect(result).toMatchObject({
      status: 'found',
      truncated: false,
      omittedSurfaceIds: [],
    });
    if (result.status !== 'found') return;
    expect(Buffer.byteLength(result.text)).toBe(bound - 73);
    expect(result.text).not.toContain('[truncated');
    expect(result.text.split('\n')).toHaveLength(1 + ids.length + ids.length);
  });

  // Review finding 4 (Batch 9, round 1).
  it('rejects a read bound below the documented minimum at construction', () => {
    const store = new SurfaceStateStore();
    for (const bound of [
      100,
      SURFACE_READER_MIN_STATE_READ_BYTES - 1,
      1.5,
      Number.NaN,
    ])
      expect(
        () => new SurfaceStateReader(store, { maxStateReadBytes: bound }),
      ).toThrow(RangeError);
    expect(
      () =>
        new SurfaceStateReader(store, {
          maxStateReadBytes: SURFACE_READER_MIN_STATE_READ_BYTES,
        }),
    ).not.toThrow();
  });

  it('keeps every response variant within the default bound', () => {
    const store = new SurfaceStateStore();
    // 20,000 separators: a 60 KB model that escapes to 120 KB, so eight of
    // them overflow the default bound and the all-surfaces read truncates.
    const separator = String.fromCharCode(0x2028);
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
      store.commit(
        'tab-big',
        withState(id, 1, v2Content(id, padded(20_000, separator))),
      );
    store.commit('tab-1', withState('profile', 2));
    const reader = new SurfaceStateReader(store);
    const results = [
      reader.describeForAgent('tab-1', { surfaceId: 'profile' }),
      reader.describeForAgent('tab-1', {
        surfaceId: 'profile',
        view: 'structure',
      }),
      reader.describeForAgent('tab-1', {}),
      reader.describeForAgent('tab-big', {}),
      reader.describeForAgent('tab-1', { view: 'structure' }),
      reader.describeForAgent('tab-2', {}),
      reader.describeForAgent('tab-1', { surfaceId: 'v'.repeat(100_000) }),
    ];
    expect(results.map((result) => result.status)).toEqual([
      'found',
      'found',
      'found',
      'found',
      'rejected',
      'not-found',
      'not-found',
    ]);
    expect(results[3]).toMatchObject({ truncated: true });
    for (const result of results)
      expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(
        SURFACE_LIMITS.maxStateReadBytes,
      );
  });

  it('answers too-large when a store beyond the defaults makes the index and marker overflow', () => {
    const store = new SurfaceStateStore({
      limits: { maxSurfacesPerRoutingId: 200 },
    });
    for (let index = 0; index < 200; index++) {
      const id = `s${index}`.padEnd(SURFACE_LIMITS.maxSurfaceIdLength, 'x');
      store.commit(
        'tab-1',
        createSurfaceRecord(id, v2Content(id, {}, [STAT]), 1),
      );
    }
    const reader = new SurfaceStateReader(store, {
      maxStateReadBytes: SURFACE_READER_MIN_STATE_READ_BYTES,
    });
    const result = reader.describeForAgent('tab-1', {});
    expect(result.status).toBe('too-large');
    expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(
      SURFACE_READER_MIN_STATE_READ_BYTES,
    );
  });

  it('includes every state and no marker when all fit', () => {
    const { store, reader } = setup();
    store.commit('tab-1', withState('a', 1));
    store.commit('tab-1', withState('b', 2, V1_CONTENT));
    const result = reader.describeForAgent('tab-1', { view: 'state' });
    expect(result).toMatchObject({
      status: 'found',
      truncated: false,
      omittedSurfaceIds: [],
    });
    if (result.status !== 'found') return;
    const lines = result.text.split('\n');
    expect(lines).toHaveLength(5);
    expect(JSON.parse(lines[4])).toMatchObject({
      surfaceId: 'b',
      contract: 'dashboard-spec/1',
    });
    expect(result.text).not.toContain('[truncated');
  });

  it('keeps a worst-case single state within maxStateReadBytes', () => {
    const inputs: SurfaceComponent[] = [];
    const fields: Record<string, string> = {};
    for (let index = 0; index < SURFACE_LIMITS.maxInputs; index++) {
      inputs.push({
        kind: 'text',
        id: `field-${String(index).padStart(3, '0')}`.padEnd(
          SURFACE_LIMITS.maxComponentIdLength,
          'x',
        ),
        label: 'Field',
        path: `f.k${index}`,
        hints: { required: true, minLength: 1_000 },
      });
      fields[`k${index}`] = 'y'.repeat(600);
    }
    const content = v2Content('big', { f: fields }, [
      { kind: 'stack', id: 'root', children: inputs },
    ]);
    const { store, reader } = setup();
    store.commit('tab-1', {
      ...createSurfaceRecord('big', content, 1),
      lastSubmit: {
        ...LAST_SUBMIT,
        values: [
          {
            componentId: 'f',
            path: 'f.k0',
            value: 'z'.repeat(SURFACE_LIMITS.maxSubmitMessageBytes - 1_024),
          },
        ],
      },
    });
    const result = reader.describeForAgent('tab-1', { surfaceId: 'big' });
    expect(result.status).toBe('found');
    if (result.status !== 'found') return;
    expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(
      SURFACE_LIMITS.maxStateReadBytes,
    );
  });

  it('never returns part of a single state that exceeds the bound', () => {
    const store = new SurfaceStateStore();
    store.commit('tab-1', withState('a', 1, v2Content('a', padded(50_000))));
    const reader = new SurfaceStateReader(store, {
      maxStateReadBytes: SURFACE_READER_MIN_STATE_READ_BYTES,
    });
    const result = reader.describeForAgent('tab-1', { surfaceId: 'a' });
    expect(result).toMatchObject({ status: 'too-large' });
    expect(result.text).not.toContain('xxxx');
  });

  it('escapes U+2028 and U+2029 in agent text', () => {
    const { store, reader } = setup();
    store.commit(
      'tab-1',
      withState('a', 1, v2Content('a', { note: 'one\u2028two\u2029' })),
    );
    const result = reader.describeForAgent('tab-1', { surfaceId: 'a' });
    expect(result.text).toContain('one\\u2028two\\u2029');
    expect(/[\u2028\u2029]/.test(result.text)).toBe(false);
  });

  it('touches recency, so a read surface is not the next eviction', () => {
    const store = new SurfaceStateStore({
      limits: { maxSurfacesPerRoutingId: 2 },
    });
    const reader = new SurfaceStateReader(store);
    store.commit('tab-1', withState('a', 1));
    store.commit('tab-1', withState('b', 2));
    reader.describeForAgent('tab-1', { surfaceId: 'a' });
    const result = store.commit('tab-1', withState('c', 3));
    expect(result).toMatchObject({ ok: true, evicted: [{ surfaceId: 'b' }] });
    expect(reader.read('tab-1', 'b')).toEqual({ status: 'not-found' });
  });
});
