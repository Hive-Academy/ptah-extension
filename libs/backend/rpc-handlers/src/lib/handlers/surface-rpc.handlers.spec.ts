/**
 * SurfaceRpcHandlers — the renderer trust boundary for surface state
 * (TASK_2026_538, Req 6, 7.4, 9; R12): strict params, not-found, change,
 * select, action resolution and read. Submit specs are in
 * `surface-rpc.handlers.submit.spec.ts`; the wiring is in
 * `test-utils/surface-rpc-harness.ts`.
 */

import 'reflect-metadata';

// The vscode-lm-tools barrel reaches workspace-intelligence, whose tree-sitter
// module cannot load under CJS Jest; see `test-utils/heavy-module-mocks.ts`.
jest.mock('@ptah-extension/workspace-intelligence', () =>
  require('../../test-utils/heavy-module-mocks').workspaceIntelligenceMock(),
);

import {
  SURFACE_RPC_TAB as TAB,
  UNSUPPORTED_SURFACE_ACTIONS,
  flush,
  setupSurfaceRpc as setup,
  surfaceOpId as opId,
} from '../../test-utils/surface-rpc-harness';
import {
  SURFACE_ACTION_SELECT_DETAIL,
  SURFACE_STATE_UNAVAILABLE_MESSAGE,
  SurfaceRpcHandlers,
} from './surface-rpc.handlers';

function baseFor(revision: number) {
  return {
    routingId: TAB,
    surfaceId: 'profile',
    revision,
    operationId: opId(),
  };
}

describe('SurfaceRpcHandlers: registration and boundary (Req 9.1, 9.2, 6.2)', () => {
  it('registers exactly the five surface methods', async () => {
    expect(SurfaceRpcHandlers.METHODS).toEqual([
      'surface:read',
      'surface:change',
      'surface:select',
      'surface:action',
      'surface:operation',
    ]);
    const t = setup();
    for (const method of SurfaceRpcHandlers.METHODS) {
      const response = await t.call(method, {});
      expect(response.errorCode).toBe('INVALID_PARAMS');
    }
  });

  const invalid: ReadonlyArray<
    [string, string, (revision: number) => unknown]
  > = [
    [
      'an unknown key',
      'surface:change',
      (r) => ({ ...baseFor(r), componentId: 'name', value: 'x', extra: 1 }),
    ],
    [
      'a wrong type',
      'surface:change',
      (r) => ({
        ...baseFor(r),
        componentId: 'name',
        value: 'x',
        revision: '2',
      }),
    ],
    [
      'an oversize id',
      'surface:change',
      (r) => ({ ...baseFor(r), componentId: 'n'.repeat(129), value: 'x' }),
    ],
    [
      'a request over maxRpcRequestBytes',
      'surface:change',
      (r) => ({
        ...baseFor(r),
        componentId: 'name',
        value: 'x'.repeat(17_000),
      }),
    ],
    [
      'a missing operation id',
      'surface:action',
      (r) => ({
        routingId: TAB,
        surfaceId: 'profile',
        revision: r,
        actionId: 'send',
      }),
    ],
    [
      'a missing revision',
      'surface:select',
      () => ({
        routingId: TAB,
        surfaceId: 'profile',
        operationId: opId(),
        selection: null,
      }),
    ],
    [
      'a forged action parameter',
      'surface:action',
      (r) => ({ ...baseFor(r), actionId: 'send', params: { to: 'x' } }),
    ],
    [
      'a malformed operation id',
      'surface:change',
      (r) => ({
        ...baseFor(r),
        operationId: 'not-an-op',
        componentId: 'name',
        value: 'x',
      }),
    ],
  ];

  it.each(invalid)(
    'rejects %s as INVALID_PARAMS and changes nothing',
    async (_label, method, params) => {
      const t = setup();
      const revision = t.create();
      await flush();
      const before = t.view();
      const pushed = t.pushes.length;
      const response = await t.call(method, params(revision));
      await flush();
      expect(response.success).toBe(false);
      expect(response.errorCode).toBe('INVALID_PARAMS');
      expect(t.view()).toEqual(before);
      expect(t.pushes.length).toBe(pushed);
      expect(t.sendMessageToSession).not.toHaveBeenCalled();
    },
  );

  it('names the byte budget for an oversized request', async () => {
    const t = setup();
    const revision = t.create();
    const response = await t.call('surface:change', {
      ...t.base(revision),
      componentId: 'name',
      value: 'x'.repeat(17_000),
    });
    expect(response.error).toMatch(/maxRpcRequestBytes limit of 16384/);
  });

  it('rejects a non-serializable request as INVALID_PARAMS', async () => {
    const t = setup();
    const cyclic: Record<string, unknown> = { routingId: TAB };
    cyclic['self'] = cyclic;
    const response = await t.call('surface:read', cyclic);
    expect(response.errorCode).toBe('INVALID_PARAMS');
  });

  it('answers with an error when the host has no surface state (Req 7.4)', async () => {
    const t = setup({ withState: false });
    const response = await t.call('surface:read', { routingId: TAB });
    expect(response.success).toBe(false);
    expect(response.error).toBe(SURFACE_STATE_UNAVAILABLE_MESSAGE);
    const action = await t.call('surface:action', {
      ...t.base(1),
      actionId: 'send',
    });
    expect(action.error).toBe(SURFACE_STATE_UNAVAILABLE_MESSAGE);
  });
});

describe('SurfaceRpcHandlers: not-found never creates state (Req 6.3, 9.6)', () => {
  it('answers an unknown routing id or surface with not-found and no revision', async () => {
    const t = setup();
    t.create();
    expect(await t.ok('surface:read', { routingId: 'tab-other' })).toEqual({
      status: 'not-found',
    });
    const change = { ...t.base(1), routingId: 'tab-other' };
    expect(
      await t.ok('surface:change', {
        ...change,
        componentId: 'name',
        value: 'Grace',
      }),
    ).toEqual({ status: 'not-found', operationId: change.operationId });
    const action = await t.ok('surface:action', {
      ...t.base(1),
      surfaceId: 'missing',
      actionId: 'send',
    });
    expect(action['status']).toBe('not-found');
    expect(action).not.toHaveProperty('revision');
    expect(
      await t.ok('surface:operation', {
        routingId: 'tab-other',
        operationId: change.operationId,
      }),
    ).toEqual({ status: 'unknown' });
    expect(await t.ok('surface:read', { routingId: 'tab-other' })).toEqual({
      status: 'not-found',
    });
    expect(t.sendMessageToSession).not.toHaveBeenCalled();
  });
});

describe('SurfaceRpcHandlers: change and select (Req 6.7, 7.5, 9.4)', () => {
  it('commits a change, pushes it and never calls sendMessageToSession', async () => {
    const t = setup();
    const revision = t.create();
    const params = { ...t.base(revision), componentId: 'name', value: 'Grace' };
    expect(await t.ok('surface:change', params)).toEqual({
      status: 'applied',
      operationId: params.operationId,
      revision: revision + 1,
    });
    const content = t.view()?.content;
    expect(
      content?.contract === 'dashboard-spec/2' && content.dataModel,
    ).toEqual({ form: { name: 'Grace' }, other: { note: 'hidden-note' } });
    await flush();
    expect(t.pushes.at(-1)).toMatchObject({
      origin: 'ui',
      revision: revision + 1,
    });
    expect(
      await t.ok('surface:operation', {
        routingId: TAB,
        operationId: params.operationId,
      }),
    ).toEqual({ status: 'applied', revision: revision + 1 });
    expect(t.sendMessageToSession).not.toHaveBeenCalled();
  });

  it('rejects a forged value for a component that is not an input', async () => {
    const t = setup();
    const revision = t.create();
    const before = t.view();
    const result = await t.ok('surface:change', {
      ...t.base(revision),
      componentId: 'people',
      value: 'forged',
    });
    expect(result).toMatchObject({ status: 'rejected', reason: 'undeclared' });
    expect(t.view()).toEqual(before);
  });

  it('rejects a stale change with the current revision', async () => {
    const t = setup();
    const revision = t.create();
    await t.ok('surface:change', {
      ...t.base(revision),
      componentId: 'name',
      value: 'Grace',
    });
    const params = { ...t.base(revision), componentId: 'name', value: 'Bo' };
    expect(await t.ok('surface:change', params)).toMatchObject({
      status: 'rejected',
      reason: 'stale-revision',
      currentRevision: revision + 1,
    });
    expect(
      await t.ok('surface:operation', {
        routingId: TAB,
        operationId: params.operationId,
      }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'stale-revision',
      currentRevision: revision + 1,
    });
  });

  it('records a selection through surface:select, validated on the host copy', async () => {
    const t = setup();
    const revision = t.create();
    const selection = {
      componentId: 'people',
      target: { kind: 'table-row', rowIndex: 1 },
    };
    const result = await t.ok('surface:select', {
      ...t.base(revision),
      selection,
    });
    expect(result).toMatchObject({ status: 'applied', revision: revision + 1 });
    expect(t.view()?.selection).toEqual(selection);
    const outOfRange = await t.ok('surface:select', {
      ...t.base(revision + 1),
      selection: {
        componentId: 'people',
        target: { kind: 'table-row', rowIndex: 9 },
      },
    });
    expect(outOfRange['status']).toBe('rejected');
    expect(t.view()?.selection).toEqual(selection);
  });
});

describe('SurfaceRpcHandlers: actions resolved from the stored declaration (Req 6.7, 6.8)', () => {
  it.each(
    UNSUPPORTED_SURFACE_ACTIONS.map((action, index) => [
      action,
      `act-${index}`,
    ]),
  )(
    '%s is unsupported and recorded, with no side effect',
    async (action, actionId) => {
      const t = setup();
      const revision = t.create();
      await flush();
      const pushed = t.pushes.length;
      const params = { ...t.base(revision), actionId };
      const result = await t.ok('surface:action', params);
      expect(result).toEqual({
        status: 'unsupported',
        operationId: params.operationId,
        detail: expect.stringContaining(action),
      });
      expect(
        await t.ok('surface:operation', {
          routingId: TAB,
          operationId: params.operationId,
        }),
      ).toEqual({
        status: 'rejected',
        reason: 'unsupported',
        detail: result['detail'],
      });
      expect(await t.ok('surface:action', params)).toEqual(result);
      await flush();
      expect(t.pushes.length).toBe(pushed);
      expect(t.view()?.revision).toBe(revision);
      expect(t.sendMessageToSession).not.toHaveBeenCalled();
    },
  );

  it('points dashboard.select at surface:select', async () => {
    const t = setup();
    const revision = t.create();
    const result = await t.ok('surface:action', {
      ...t.base(revision),
      actionId: 'pick',
    });
    expect(result).toMatchObject({
      status: 'rejected',
      reason: 'undeclared',
      detail: SURFACE_ACTION_SELECT_DETAIL,
    });
    expect(t.view()?.selection).toBeNull();
  });

  it('rejects an undeclared action, or reports stale-revision when the UI is behind', async () => {
    const t = setup();
    const revision = t.create();
    const current = await t.ok('surface:action', {
      ...t.base(revision),
      actionId: 'launch-missiles',
    });
    expect(current).toMatchObject({ status: 'rejected', reason: 'undeclared' });
    await t.ok('surface:change', {
      ...t.base(revision),
      componentId: 'name',
      value: 'Grace',
    });
    const behind = await t.ok('surface:action', {
      ...t.base(revision),
      actionId: 'launch-missiles',
    });
    expect(behind).toMatchObject({
      status: 'rejected',
      reason: 'stale-revision',
      currentRevision: revision + 1,
    });
    expect(t.sendMessageToSession).not.toHaveBeenCalled();
  });

  it('answers a reused operation id with operation-conflict, whatever the action', async () => {
    const t = setup();
    const revision = t.create();
    const change = { ...t.base(revision), componentId: 'name', value: 'Grace' };
    await t.ok('surface:change', change);
    const reuse = await t.ok('surface:action', {
      ...t.base(revision + 1),
      operationId: change.operationId,
      actionId: 'act-0',
    });
    expect(reuse).toMatchObject({
      status: 'rejected',
      reason: 'operation-conflict',
    });
    expect(t.sendMessageToSession).not.toHaveBeenCalled();
  });
});

describe('SurfaceRpcHandlers: refusals keep their operation identity (review F2)', () => {
  it('rejects an unsupported action id reused for a submit as operation-conflict, with no turn', async () => {
    const t = setup();
    const revision = t.create();
    const params = { ...t.base(revision), actionId: 'act-0' };
    expect((await t.ok('surface:action', params))['status']).toBe(
      'unsupported',
    );
    expect(
      await t.ok('surface:action', { ...params, actionId: 'send' }),
    ).toMatchObject({ status: 'rejected', reason: 'operation-conflict' });
    expect(t.sendMessageToSession).not.toHaveBeenCalled();
    expect(t.view()?.lastSubmit).toBeNull();
    expect((await t.ok('surface:action', params))['status']).toBe(
      'unsupported',
    );
  });

  it('replays an identical undeclared request unchanged after an unrelated change', async () => {
    const t = setup();
    const revision = t.create();
    const params = { ...t.base(revision), actionId: 'absent' };
    const first = await t.ok('surface:action', params);
    expect(first).toMatchObject({ status: 'rejected', reason: 'undeclared' });
    await t.ok('surface:change', {
      ...t.base(revision),
      componentId: 'name',
      value: 'Grace',
    });
    expect(await t.ok('surface:action', params)).toEqual(first);
    expect(
      await t.ok('surface:operation', {
        routingId: TAB,
        operationId: params.operationId,
      }),
    ).toMatchObject({ status: 'rejected', reason: 'undeclared' });
  });

  it('records a dashboard.select refusal the same way', async () => {
    const t = setup();
    const revision = t.create();
    const params = { ...t.base(revision), actionId: 'pick' };
    const first = await t.ok('surface:action', params);
    expect(await t.ok('surface:action', params)).toEqual(first);
    expect(
      await t.ok('surface:action', { ...params, actionId: 'act-1' }),
    ).toMatchObject({ status: 'rejected', reason: 'operation-conflict' });
  });
});

describe('SurfaceRpcHandlers: declared dashboard actions honour the revision (review F3)', () => {
  async function behind() {
    const t = setup();
    const revision = t.create();
    await t.ok('surface:change', {
      ...t.base(revision),
      componentId: 'name',
      value: 'Grace',
    });
    return { t, revision };
  }

  it('answers a stale unsupported action with stale-revision and currentRevision', async () => {
    const { t, revision } = await behind();
    const params = { ...t.base(revision), actionId: 'act-0' };
    const stale = await t.ok('surface:action', params);
    expect(stale).toMatchObject({
      status: 'rejected',
      reason: 'stale-revision',
      currentRevision: revision + 1,
    });
    expect(await t.ok('surface:action', params)).toEqual(stale);
    expect(
      await t.ok('surface:action', {
        ...t.base(revision + 1),
        actionId: 'act-0',
      }),
    ).toMatchObject({ status: 'unsupported' });
    expect(t.view()?.revision).toBe(revision + 1);
  });

  it('answers a stale dashboard.select with stale-revision and currentRevision', async () => {
    const { t, revision } = await behind();
    expect(
      await t.ok('surface:action', { ...t.base(revision), actionId: 'pick' }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'stale-revision',
      currentRevision: revision + 1,
    });
    expect(t.view()?.selection).toBeNull();
    expect(t.sendMessageToSession).not.toHaveBeenCalled();
  });
});

describe('SurfaceRpcHandlers: read (Req 9.5)', () => {
  it('returns the same revision and values as ptah_surface_get_state', async () => {
    const t = setup();
    const revision = t.create();
    await t.ok('surface:change', {
      ...t.base(revision),
      componentId: 'agree',
      value: true,
    });
    await t.ok('surface:action', { ...t.base(revision + 1), actionId: 'send' });
    const read = await t.ok('surface:read', {
      routingId: TAB,
      surfaceId: 'profile',
    });
    const agent = t.state.describeForAgent(TAB, { surfaceId: 'profile' });
    expect(agent.status).toBe('found');
    const agentState = JSON.parse(agent.text.split('\n')[1] ?? '{}') as Record<
      string,
      unknown
    >;
    const surfaces = read['surfaces'] as ReadonlyArray<{
      revision: number;
      content: { dataModel?: unknown };
      selection: unknown;
      lastSubmit: unknown;
    }>;
    expect(read['status']).toBe('found');
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]?.revision).toBe(agentState['revision']);
    expect(surfaces[0]?.content.dataModel).toEqual(agentState['dataModel']);
    expect(surfaces[0]?.selection).toEqual(agentState['selection']);
    expect(surfaces[0]?.lastSubmit).toEqual(agentState['lastSubmit']);
    expect(surfaces[0]?.lastSubmit).not.toBeNull();
  });

  it('reads every surface of a routing id when no surface is named', async () => {
    const t = setup();
    t.create();
    const read = await t.ok('surface:read', { routingId: TAB });
    expect(read).toMatchObject({ status: 'found', routingId: TAB });
    expect(read['surfaces']).toHaveLength(1);
  });
});
