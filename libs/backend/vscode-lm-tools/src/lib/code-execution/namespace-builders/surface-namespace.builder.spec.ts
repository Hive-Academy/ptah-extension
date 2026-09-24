import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SurfaceComponent, SurfaceEnvelope } from '@ptah-extension/shared';
import { SURFACE_LIMITS } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { SurfaceStateService } from '../../surface';
import { HELP_DOCS } from './system-namespace.builders';
import type { DashboardSurfaceHost } from './dashboard-namespace.builder';
import { buildSurfaceNamespace } from './surface-namespace.builder';

const CALLER = { sessionId: 'tab-a', toolCallId: 'call-1' };
const ANONYMOUS = { toolCallId: 'anonymous' };
function snapshot(surfaceId = 'profile'): SurfaceEnvelope {
  return {
    schemaVersion: 'dashboard-spec/2',
    catalogVersion: 'dashboard-catalog/2',
    surfaceId,
    title: { text: 'Profile' },
    components: [{ kind: 'text', id: 'name', label: 'Name', path: 'name' }],
    dataModel: { name: 'Ada' },
  };
}
const create = () => ({ operation: 'create', surface: snapshot() });
const patch = (baseRevision = 1) => ({
  operation: 'patch',
  surfaceId: 'profile',
  baseRevision,
  ops: [{ op: 'set-data', path: 'name', value: 'Grace' }],
});

function setup(
  options: {
    noHost?: boolean;
    noViews?: boolean;
    missingService?: boolean;
    throwingLogger?: boolean;
  } = {},
) {
  const write = jest.fn(() => {
    if (options.throwingLogger) throw new Error('log unavailable');
  });
  const logger = { info: write, warn: write, debug: write };
  const sendMessage = jest.fn(async (_view: string) => true);
  const host: DashboardSurfaceHost = {
    getActiveWebviews: jest.fn(() =>
      options.noViews ? [] : ['main', 'panel'],
    ),
    sendMessage,
  };
  const service = new SurfaceStateService(logger as unknown as Logger, {
    getHost: () => (options.noHost ? undefined : host),
  });
  const namespace = buildSurfaceNamespace({
    service: options.missingService ? undefined : service,
    logger,
  });
  return { namespace, service, host, sendMessage };
}

describe('ptah.surface update and state', () => {
  it('creates, patches, replaces and deletes with text and host revisions', async () => {
    const { namespace, service, sendMessage } = setup();
    await expect(namespace.update(create(), CALLER)).resolves.toMatchObject({
      status: 'accepted',
      surfaceId: 'profile',
      revision: 1,
      text: expect.stringContaining('Name: Ada'),
      delivery: { status: 'delivered', surfaces: 2 },
    });
    await expect(namespace.update(patch(), CALLER)).resolves.toMatchObject({
      status: 'accepted',
      revision: 2,
      text: expect.stringContaining('Name: Grace'),
    });
    await expect(
      namespace.update(
        { operation: 'replace', baseRevision: 2, surface: snapshot() },
        CALLER,
      ),
    ).resolves.toMatchObject({
      status: 'accepted',
      revision: 3,
      text: expect.stringContaining('Name: Ada'),
    });
    await expect(
      namespace.update(
        { operation: 'delete', surfaceId: 'profile', baseRevision: 3 },
        CALLER,
      ),
    ).resolves.toMatchObject({
      status: 'accepted',
      revision: 4,
      text: 'Deleted surface profile at revision 4.',
    });
    expect(service.read('tab-a', 'profile')).toEqual({ status: 'not-found' });
    expect(sendMessage).toHaveBeenCalledTimes(8);
  });

  it('returns complete state, the index and the structure through the scoped reader', async () => {
    const { namespace } = setup();
    await namespace.update(create(), CALLER);
    await namespace.update(patch(), CALLER);
    const state = await namespace.getState({ surfaceId: 'profile' }, CALLER);
    expect(state).toMatchObject({
      status: 'found',
      truncated: false,
      omittedSurfaceIds: [],
    });
    if (state.status !== 'found') throw new Error('expected state');
    expect(state.text).toContain('Grace');
    expect(state.text).toContain('formValues');
    expect(state.text).toContain('selection');
    expect(state.text).toContain('lastSubmit');
    const structure = await namespace.getState(
      { surfaceId: 'profile', view: 'structure' },
      CALLER,
    );
    expect(structure).toMatchObject({
      status: 'found',
      text: expect.stringContaining('components'),
    });
    await expect(namespace.getState({}, CALLER)).resolves.toMatchObject({
      status: 'found',
      text: expect.stringContaining('profile'),
    });
  });

  it.each([{ noHost: true }, { noViews: true }])(
    'keeps state for a headless host: %j',
    async (options) => {
      const { namespace, service } = setup(options);
      await expect(namespace.update(create(), CALLER)).resolves.toMatchObject({
        status: 'accepted',
        delivery: { status: 'no-surface' },
        text: expect.stringContaining('Ada'),
      });
      expect(service.read('tab-a')).toMatchObject({ status: 'found' });
    },
  );

  it('rejects duplicate creation and stale patches without pushing again', async () => {
    const { namespace, sendMessage } = setup();
    await namespace.update(create(), CALLER);
    await expect(namespace.update(create(), CALLER)).resolves.toMatchObject({
      status: 'rejected',
      reason: expect.stringContaining('already-exists'),
    });
    await expect(namespace.update(patch(2), CALLER)).resolves.toMatchObject({
      status: 'rejected',
      reason: expect.stringContaining('stale-revision'),
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('returns the same not-found result for foreign and missing ids for each tool', async () => {
    const { namespace, service, sendMessage } = setup();
    await namespace.update(create(), CALLER);
    const other = { ...CALLER, sessionId: 'tab-b' };
    const before = service.read('tab-a');
    for (const operation of ['replace', 'patch', 'delete'] as const) {
      const input =
        operation === 'replace'
          ? { operation, surface: snapshot(), baseRevision: 1 }
          : operation === 'patch'
            ? patch()
            : { operation, surfaceId: 'profile', baseRevision: 1 };
      const foreign = await namespace.update(input, other);
      const absent = await namespace.update(input, {
        ...CALLER,
        sessionId: 'empty-tab',
      });
      expect(foreign).toEqual(absent);
      expect(foreign).toMatchObject({
        status: 'rejected',
        reason: expect.stringContaining('not-found'),
      });
    }
    for (const view of ['state', 'structure'] as const) {
      const foreign = await namespace.getState(
        { surfaceId: 'profile', view },
        other,
      );
      expect(foreign).toEqual(
        await namespace.getState(
          { surfaceId: 'profile', view },
          { ...CALLER, sessionId: 'empty-tab' },
        ),
      );
      expect(foreign).toMatchObject({ status: 'not-found' });
    }
    expect(service.read('tab-a')).toEqual(before);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    // Creating the same id is allowed in another scope, and touches only it.
    await namespace.update(
      {
        operation: 'create',
        surface: { ...snapshot(), dataModel: { name: 'Other' } },
      },
      other,
    );
    expect(service.read('tab-a')).toEqual(before);
    await expect(namespace.getState({}, other)).resolves.toMatchObject({
      status: 'found',
      text: expect.stringContaining('Other'),
    });
  });

  it.each(['sessionId', 'routingId'])(
    'rejects a forged %s in tool arguments',
    async (key) => {
      const { namespace, sendMessage } = setup();
      await expect(
        namespace.update({ ...create(), [key]: 'tab-b' }, CALLER),
      ).resolves.toMatchObject({ status: 'rejected' });
      await expect(
        namespace.getState({ [key]: 'tab-b' }, CALLER),
      ).resolves.toMatchObject({ status: 'rejected' });
      expect(sendMessage).not.toHaveBeenCalled();
    },
  );

  it('rejects invalid/deep/oversized input before the store or delivery is touched', async () => {
    const { namespace, service, sendMessage } = setup();
    await namespace.update(create(), CALLER);
    const before = service.read('tab-a');
    sendMessage.mockClear();
    let nested: SurfaceComponent = snapshot().components[0];
    for (let depth = 0; depth < 25; depth++)
      nested = { kind: 'stack', id: `nested-${depth}`, children: [nested] };
    const cyclic: Record<string, unknown> = { operation: 'create' };
    cyclic['surface'] = cyclic;
    for (const input of [
      { ...create(), surface: { ...snapshot(), components: [nested] } },
      {
        ...create(),
        surface: {
          ...snapshot(),
          dataModel: { name: 'x'.repeat(SURFACE_LIMITS.maxUpdateRequestBytes) },
        },
      },
      { ...create(), surface: { ...snapshot(), schemaVersion: 'unknown' } },
      cyclic,
      {
        ...patch(),
        ops: [{ op: 'set-data', path: '__proto__.polluted', value: true }],
      },
    ]) {
      await expect(namespace.update(input, CALLER)).resolves.toMatchObject({
        status: 'rejected',
        reason: expect.any(String),
      });
    }
    expect(service.read('tab-a')).toEqual(before);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each(['create', 'replace'])(
    'renders an anonymous %s without storage or delivery',
    async (operation) => {
      const { namespace, service, sendMessage } = setup();
      const apply = jest.spyOn(service, 'applyAgentUpdate');
      const input =
        operation === 'create'
          ? create()
          : { operation, baseRevision: 7, surface: snapshot() };
      const result = await namespace.update(input, ANONYMOUS);
      expect(result).toMatchObject({
        status: 'render-only',
        text: expect.stringContaining('no interactive surface is attached'),
      });
      if (result.status !== 'render-only') throw new Error('expected text');
      expect(result.text).toContain('Name: Ada');
      expect(apply).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
    },
  );

  it('handles anonymous patches, deletes and reads explicitly', async () => {
    const { namespace, service } = setup();
    const read = jest.spyOn(service, 'describeForAgent');
    for (const input of [
      patch(),
      { operation: 'delete', surfaceId: 'profile', baseRevision: 1 },
    ])
      await expect(namespace.update(input, ANONYMOUS)).resolves.toEqual({
        status: 'unavailable',
        reason: 'surface state unavailable for this caller',
      });
    await expect(namespace.getState({}, ANONYMOUS)).resolves.toEqual({
      status: 'not-found',
      text: 'no surface state for this caller',
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects invalid input first for anonymous callers and missing services', async () => {
    const { namespace } = setup({ missingService: true });
    for (const caller of [CALLER, ANONYMOUS]) {
      await expect(
        namespace.update({ operation: 'create' }, caller),
      ).resolves.toMatchObject({
        status: 'rejected',
        reason: expect.stringContaining('surface'),
      });
      await expect(
        namespace.getState({ view: 'structure' }, caller),
      ).resolves.toMatchObject({
        status: 'rejected',
        reason: expect.stringContaining('surfaceId'),
      });
    }
    await expect(namespace.update(create(), CALLER)).resolves.toEqual({
      status: 'unavailable',
      reason: 'surface state unavailable on this host',
    });
    await expect(namespace.getState({}, CALLER)).resolves.toEqual({
      status: 'unavailable',
      reason: 'surface state unavailable on this host',
    });
    await expect(namespace.update(create(), ANONYMOUS)).resolves.toMatchObject({
      status: 'render-only',
    });
  });

  it('contains a throwing read-input getter', async () => {
    const { namespace } = setup();
    await expect(
      namespace.getState(
        {
          get surfaceId() {
            throw new Error('unreadable');
          },
        },
        CALLER,
      ),
    ).resolves.toMatchObject({ status: 'rejected' });
  });

  it('does not allow a throwing logger to affect acceptance, rejection or delivery failure', async () => {
    const { namespace, sendMessage } = setup({ throwingLogger: true });
    await expect(namespace.update(create(), CALLER)).resolves.toMatchObject({
      status: 'accepted',
    });
    await expect(namespace.update({}, CALLER)).resolves.toMatchObject({
      status: 'rejected',
    });
    sendMessage.mockResolvedValue(false);
    await expect(namespace.update(patch(), CALLER)).resolves.toMatchObject({
      status: 'delivery-failed',
      revision: 2,
    });
  });

  it.each(['false', 'throw', 'reject', 'partial', 'disposed'] as const)(
    'reports %s delivery and rejects a retry as stale',
    async (mode) => {
      const { namespace, service, host, sendMessage } = setup();
      await namespace.update(create(), CALLER);
      sendMessage.mockClear();
      let disposed = false;
      if (mode === 'disposed')
        host.getActiveWebviews = () => {
          disposed = true;
          return ['main', 'panel'];
        };
      sendMessage.mockImplementation((view) => {
        if (mode === 'throw') throw new Error('post threw');
        if (mode === 'reject')
          return Promise.reject(new Error('post rejected'));
        return Promise.resolve(
          mode === 'partial'
            ? view === 'main'
            : mode === 'disposed'
              ? !disposed
              : false,
        );
      });
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);
      try {
        const result = await namespace.update(patch(), CALLER);
        expect(result).toMatchObject({
          status: 'delivery-failed',
          revision: 2,
          surfaceId: 'profile',
          text: expect.stringContaining('Name: Grace'),
          reason: expect.stringContaining(
            'do not resend; the same patch would be stale',
          ),
          delivery: {
            status: 'failed',
            delivered: mode === 'partial' ? 1 : 0,
            surfaces: 2,
          },
        });
        expect(service.read('tab-a')).toMatchObject({
          status: 'found',
          surfaces: [{ revision: 2 }],
        });
        await expect(namespace.update(patch(), CALLER)).resolves.toMatchObject({
          status: 'rejected',
          reason: expect.stringContaining('stale-revision'),
        });
        expect(sendMessage).toHaveBeenCalledTimes(2);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    },
  );

  it.each([
    ['create', 'the surface was already created'],
    ['replace', 'the same replacement would be stale'],
    ['delete', 'the surface was already deleted'],
  ] as const)(
    'explains a failed %s delivery using that operation',
    async (operation, guidance) => {
      const { namespace, service, sendMessage } = setup();
      if (operation !== 'create') await namespace.update(create(), CALLER);
      sendMessage.mockResolvedValue(false);
      const input =
        operation === 'create'
          ? create()
          : operation === 'replace'
            ? { operation, baseRevision: 1, surface: snapshot() }
            : { operation, surfaceId: 'profile', baseRevision: 1 };
      const result = await namespace.update(input, CALLER);
      expect(result).toMatchObject({
        status: 'delivery-failed',
        revision: operation === 'create' ? 1 : 2,
        reason: expect.stringContaining(`do not resend; ${guidance}`),
      });
      if (result.status !== 'delivery-failed')
        throw new Error('expected failed delivery');
      expect(result.reason).not.toContain('same patch');
      expect(service.read('tab-a').status).toBe(
        operation === 'delete' ? 'not-found' : 'found',
      );
    },
  );

  it('documents surface operations, scoped reads, delivery and the shared push', () => {
    expect(HELP_DOCS['overview']).toContain('ptah.surface');
    for (const phrase of [
      'update',
      'getState',
      'baseRevision',
      'do not resend',
      'no interactive surface is attached',
    ])
      expect(HELP_DOCS['surface']).toContain(phrase);
    expect(HELP_DOCS['dashboard']).toContain('surface:updated');
  });
});
