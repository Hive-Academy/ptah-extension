import { DASHBOARD_LIMITS } from '@ptah-extension/shared/mcp-apps-contracts';
import { SURFACE_LIMITS } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type {
  SurfaceComponent,
  SurfaceContent,
  SurfaceEnvelope,
  SurfaceStateView,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import {
  makeDashboardSpec,
  makeDashboardSpecOfExactBytes,
  makeTable,
} from '@ptah-extension/shared/testing';
import {
  acceptSurfaceView,
  countJsonBytes,
  guardSurfacePush,
  guardSurfaceReadResult,
} from './apps-surface-intake';

const SECRET = 'secret-user-value-7f3a';

const table = (): SurfaceComponent => makeTable(3, 2) as SurfaceComponent;
const textInput: SurfaceComponent = {
  kind: 'text',
  id: 'name',
  label: 'Name',
  path: 'form.name',
};

function envelope(
  components: SurfaceComponent[] = [table(), textInput],
  dataModel: SurfaceEnvelope['dataModel'] = { form: { name: 'Ada' } },
): SurfaceEnvelope {
  return {
    schemaVersion: 'dashboard-spec/2',
    catalogVersion: 'dashboard-catalog/2',
    surfaceId: 'profile',
    title: { text: 'Profile' },
    components,
    dataModel,
  };
}

function v2Content(doc: SurfaceEnvelope = envelope()): SurfaceContent {
  const { dataModel, ...surface } = doc;
  return { contract: 'dashboard-spec/2', surface, dataModel: dataModel ?? {} };
}

function view(
  content: unknown,
  overrides: Partial<SurfaceStateView> = {},
): SurfaceStateView {
  return {
    surfaceId: 'profile',
    revision: 3,
    content: content as SurfaceContent,
    selection: null,
    lastSubmit: null,
    ...overrides,
  };
}

function snapshotPush(overrides: Record<string, unknown> = {}) {
  return {
    routingId: 'tab-1',
    surfaceId: 'profile',
    revision: 3,
    origin: 'agent',
    change: { kind: 'snapshot', state: view(v2Content()) },
    ...overrides,
  };
}

/** A v2 document whose measured JSON is EXACTLY `target` UTF-8 bytes. */
function envelopeOfBytes(target: number): SurfaceEnvelope {
  const slots = 150;
  const build = (titles: string[]) =>
    envelope(
      titles.map(
        (text, index) =>
          ({
            kind: 'stat',
            id: `s${index}`,
            value: 1,
            title: { text },
          }) as SurfaceComponent,
      ),
      {},
    );
  const base = countJsonBytes(build(Array.from({ length: slots }, () => '')));
  const extra = target - base;
  const each = Math.floor(extra / slots);
  const doc = build(
    Array.from({ length: slots }, (_unused, index) =>
      'x'.repeat(each + (index < extra % slots ? 1 : 0)),
    ),
  );
  expect(countJsonBytes(doc)).toBe(target);
  return doc;
}

describe('apps-surface-intake', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  function expectNoPayloadInWarnings(): void {
    for (const call of warn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SECRET);
    }
  }

  describe('guardSurfacePush', () => {
    it('accepts a snapshot, ops and deleted push', () => {
      expect(guardSurfacePush(snapshotPush())).not.toBeNull();
      expect(
        guardSurfacePush(
          snapshotPush({
            origin: 'ui',
            operationId: 'op-1',
            change: {
              kind: 'ops',
              fromRevision: 2,
              ops: [{ op: 'set-data', path: 'form.name', value: 'Bo' }],
            },
          }),
        ),
      ).not.toBeNull();
      expect(
        guardSurfacePush(
          snapshotPush({
            origin: 'host',
            change: { kind: 'deleted', reason: 'evicted' },
          }),
        ),
      ).not.toBeNull();
      expect(warn).not.toHaveBeenCalled();
    });

    it.each([
      ['a non-object payload', 'nope'],
      ['a null payload', null],
      ['an empty routing id', snapshotPush({ routingId: '' })],
      ['a non-string surface id', snapshotPush({ surfaceId: 7 })],
      [
        'a surface id over maxSurfaceIdLength',
        snapshotPush({
          surfaceId: 'a'.repeat(SURFACE_LIMITS.maxSurfaceIdLength + 1),
        }),
      ],
      ['a negative revision', snapshotPush({ revision: -1 })],
      ['a fractional revision', snapshotPush({ revision: 1.5 })],
      ['an unknown origin', snapshotPush({ origin: 'mallory' })],
      ['a non-string operation id', snapshotPush({ operationId: 5 })],
      ['an unknown change kind', snapshotPush({ change: { kind: 'merge' } })],
      [
        'a snapshot for another surface',
        snapshotPush({
          change: {
            kind: 'snapshot',
            state: view(v2Content(), { surfaceId: 'other' }),
          },
        }),
      ],
      [
        'a snapshot at another revision',
        snapshotPush({
          change: {
            kind: 'snapshot',
            state: view(v2Content(), { revision: 9 }),
          },
        }),
      ],
      [
        'a snapshot without content',
        snapshotPush({
          change: { kind: 'snapshot', state: view(SECRET) },
        }),
      ],
      [
        'ops with a non-integer fromRevision',
        snapshotPush({ change: { kind: 'ops', fromRevision: '2', ops: [] } }),
      ],
      [
        'ops that are not an array',
        snapshotPush({ change: { kind: 'ops', fromRevision: 2, ops: {} } }),
      ],
      [
        'more than maxPatchOps ops',
        snapshotPush({
          change: {
            kind: 'ops',
            fromRevision: 2,
            ops: Array.from({ length: SURFACE_LIMITS.maxPatchOps + 1 }, () => ({
              op: 'remove-data',
              path: 'a',
            })),
          },
        }),
      ],
      [
        'an op that is not an object',
        snapshotPush({
          change: { kind: 'ops', fromRevision: 2, ops: [SECRET] },
        }),
      ],
      [
        'an unknown delete reason',
        snapshotPush({ change: { kind: 'deleted', reason: SECRET } }),
      ],
    ])('rejects %s and warns without payload values', (_label, raw) => {
      expect(guardSurfacePush(raw)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expectNoPayloadInWarnings();
    });
  });

  describe('guardSurfaceReadResult', () => {
    it('accepts found and not-found', () => {
      expect(guardSurfaceReadResult({ status: 'not-found' })).toEqual({
        status: 'not-found',
      });
      const found = guardSurfaceReadResult({
        status: 'found',
        routingId: 'tab-1',
        surfaces: [view(v2Content())],
      });
      expect(found).toMatchObject({ status: 'found', routingId: 'tab-1' });
    });

    it('rejects the whole result when one view is unusable', () => {
      expect(
        guardSurfaceReadResult({
          status: 'found',
          routingId: 'tab-1',
          surfaces: [view(v2Content()), { surfaceId: SECRET }],
        }),
      ).toBeNull();
      expect(guardSurfaceReadResult({ status: 'maybe' })).toBeNull();
      expect(guardSurfaceReadResult(null)).toBeNull();
      expectNoPayloadInWarnings();
    });
  });

  describe('acceptSurfaceView, v2', () => {
    it('accepts a valid document', () => {
      const renderable = acceptSurfaceView(view(v2Content()));
      expect(renderable.status).toBe('accepted');
      if (renderable.status !== 'accepted') return;
      expect(renderable.content.contract).toBe('dashboard-spec/2');
      expect(renderable.content).toEqual(v2Content());
    });

    it('rejects an unknown schemaVersion', () => {
      const doc = { ...envelope(), schemaVersion: 'dashboard-spec/3' };
      const renderable = acceptSurfaceView(
        view(v2Content(doc as unknown as SurfaceEnvelope)),
      );
      expect(renderable).toMatchObject({ status: 'rejected' });
      if (renderable.status === 'rejected')
        expect(renderable.reason).toContain('schemaVersion');
    });

    it('accepts exactly maxSurfaceBytes and rejects one byte more', () => {
      const at = acceptSurfaceView(
        view(v2Content(envelopeOfBytes(SURFACE_LIMITS.maxSurfaceBytes))),
      );
      expect(at.status).toBe('accepted');
      const over = acceptSurfaceView(
        view(v2Content(envelopeOfBytes(SURFACE_LIMITS.maxSurfaceBytes + 1))),
      );
      expect(over).toMatchObject({ status: 'rejected' });
      if (over.status === 'rejected')
        expect(over.reason).toContain(
          `over the maxSurfaceBytes limit of ${SURFACE_LIMITS.maxSurfaceBytes}`,
        );
    });

    it.each([
      ['non-object content', SECRET],
      ['an unknown contract', { contract: 'dashboard-spec/9' }],
      ['a missing surface', { contract: 'dashboard-spec/2', dataModel: {} }],
      [
        'a component of an unknown kind',
        v2Content(
          envelope([
            { kind: 'iframe', id: 'x' } as unknown as SurfaceComponent,
          ]),
        ),
      ],
      [
        'a data model that does not fit its input',
        v2Content(envelope([textInput], { form: { name: 42 } })),
      ],
    ])('rejects malformed content: %s', (_label, content) => {
      expect(acceptSurfaceView(view(content)).status).toBe('rejected');
      expectNoPayloadInWarnings();
    });

    it('never throws on a throwing getter', () => {
      const hostile = {
        contract: 'dashboard-spec/2',
        get surface(): never {
          throw new Error(SECRET);
        },
      };
      expect(acceptSurfaceView(view(hostile))).toEqual({
        status: 'rejected',
        reason: 'surface content could not be validated.',
      });
      expectNoPayloadInWarnings();
    });
  });

  describe('acceptSurfaceView, v1', () => {
    it('accepts a valid spec', () => {
      const spec = makeDashboardSpec();
      const renderable = acceptSurfaceView(
        view({ contract: 'dashboard-spec/1', spec }),
      );
      expect(renderable).toEqual({
        status: 'accepted',
        content: { contract: 'dashboard-spec/1', spec },
        selection: null,
        lastSubmit: null,
      });
    });

    it('rejects an unknown catalogVersion', () => {
      const spec = {
        ...makeDashboardSpec(),
        catalogVersion: 'dashboard-catalog/9',
      };
      expect(
        acceptSurfaceView(view({ contract: 'dashboard-spec/1', spec })).status,
      ).toBe('rejected');
    });

    it('accepts exactly maxSpecBytes and rejects one byte more', () => {
      const at = makeDashboardSpecOfExactBytes(DASHBOARD_LIMITS.maxSpecBytes);
      expect(
        acceptSurfaceView(view({ contract: 'dashboard-spec/1', spec: at }))
          .status,
      ).toBe('accepted');
      const over = makeDashboardSpecOfExactBytes(
        DASHBOARD_LIMITS.maxSpecBytes + 1,
      );
      const renderable = acceptSurfaceView(
        view({ contract: 'dashboard-spec/1', spec: over }),
      );
      expect(renderable).toMatchObject({ status: 'rejected' });
      if (renderable.status === 'rejected')
        expect(renderable.reason).toContain(
          `${DASHBOARD_LIMITS.maxSpecBytes + 1} UTF-8 bytes`,
        );
    });

    it('rejects a malformed spec', () => {
      expect(
        acceptSurfaceView(
          view({ contract: 'dashboard-spec/1', spec: { title: SECRET } }),
        ).status,
      ).toBe('rejected');
      expectNoPayloadInWarnings();
    });
  });

  describe('selection', () => {
    const tableId = makeTable(3, 2).id;

    it('keeps a selection that resolves against the content', () => {
      const selection = {
        componentId: tableId,
        target: { kind: 'table-row' as const, rowIndex: 2 },
      };
      const renderable = acceptSurfaceView(view(v2Content(), { selection }));
      expect(renderable).toMatchObject({ status: 'accepted', selection });
    });

    it('clears an out-of-range selection without rejecting the surface', () => {
      const renderable = acceptSurfaceView(
        view(v2Content(), {
          selection: {
            componentId: tableId,
            target: { kind: 'table-row', rowIndex: 3 },
          },
        }),
      );
      expect(renderable).toMatchObject({ status: 'accepted', selection: null });
      expectNoPayloadInWarnings();
    });

    it('clears a malformed selection without rejecting the surface', () => {
      const renderable = acceptSurfaceView(
        view(v2Content(), {
          selection: {
            componentId: SECRET,
          } as unknown as SurfaceStateView['selection'],
        }),
      );
      expect(renderable).toMatchObject({ status: 'accepted', selection: null });
      expectNoPayloadInWarnings();
    });
  });
});
