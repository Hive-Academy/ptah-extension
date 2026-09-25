/**
 * SurfaceRpcHandlers — `surface.submit` through `surface:action`
 * (TASK_2026_538, Req 6.4, 6.5, 10; Batch 10 deviation 4).
 *
 * One dispatch per accepted submit, counted by the `sendMessageToSession` spy
 * behind the real `SurfaceSubmitTurnService`; `pending` while the dispatch is
 * unresolved; duplicates, concurrent and later, never redispatch; and a submit
 * whose surface is deleted or recreated before settlement keeps its terminal
 * outcome with no revision. Wiring: `test-utils/surface-rpc-harness.ts`.
 */

import 'reflect-metadata';

// The vscode-lm-tools barrel reaches workspace-intelligence, whose tree-sitter
// module cannot load under CJS Jest; see `test-utils/heavy-module-mocks.ts`.
jest.mock('@ptah-extension/workspace-intelligence', () =>
  require('../../test-utils/heavy-module-mocks').workspaceIntelligenceMock(),
);

import {
  SURFACE_RPC_TABLE,
  SURFACE_RPC_TAB as TAB,
  deferred,
  flush,
  setupSurfaceRpc as setup,
  surfaceRpcEnvelope,
} from '../../test-utils/surface-rpc-harness';
import { SURFACE_SUBMIT_NO_RUNTIME_DETAIL } from './surface-rpc.handlers';

describe('SurfaceRpcHandlers: submit starts one turn (Req 10, 6.4, 6.5)', () => {
  it('dispatches once, reads pending while unresolved, then applied; duplicates never redispatch', async () => {
    const t = setup();
    const revision = t.create();
    const gate = deferred();
    t.sendMessageToSession.mockImplementationOnce(async () => gate.promise);
    const params = { ...t.base(revision), actionId: 'send' };
    const operation = { routingId: TAB, operationId: params.operationId };

    const first = t.ok('surface:action', params);
    await flush();
    expect(t.sendMessageToSession).toHaveBeenCalledTimes(1);
    expect(await t.ok('surface:operation', operation)).toEqual({
      status: 'pending',
    });
    expect(await t.ok('surface:action', params)).toEqual({
      status: 'pending',
      operationId: params.operationId,
    });

    gate.resolve();
    const settled = await first;
    expect(settled).toEqual({
      status: 'applied',
      operationId: params.operationId,
      surfaceState: { kind: 'updated', revision: revision + 1 },
    });
    expect(await t.ok('surface:action', params)).toEqual(settled);
    expect(await t.ok('surface:operation', operation)).toEqual({
      status: 'applied',
      revision: revision + 1,
    });
    expect(t.sendMessageToSession).toHaveBeenCalledTimes(1);
    expect(t.sendMessageToSession.mock.calls[0]?.[0]).toBe(TAB);
    expect(t.sendMessageToSession.mock.calls[0]?.[2]).toEqual({
      admission: 'require-idle',
    });
    expect(t.view()?.lastSubmit?.operationId).toBe(params.operationId);
    // Form values are never cleared by a submit.
    const content = t.view()?.content;
    expect(
      content?.contract === 'dashboard-spec/2' && content.dataModel,
    ).toEqual({ form: { name: 'Ada' }, other: { note: 'hidden-note' } });
  });

  it('puts only the invoked scope in the turn and in lastSubmit (Req 10.6)', async () => {
    const t = setup();
    const revision = t.create();
    const result = await t.ok('surface:action', {
      ...t.base(revision),
      actionId: 'send-other',
    });
    expect(result['status']).toBe('applied');
    const content = String(t.sendMessageToSession.mock.calls[0]?.[1]);
    expect(content).toContain('hidden-note');
    expect(content).not.toContain('Ada');
    const lastSubmit = t.view()?.lastSubmit;
    expect(lastSubmit?.scopeComponentId).toBe('other');
    expect(lastSubmit?.values.map((entry) => entry.path)).toEqual([
      'other.note',
    ]);
  });

  it('rejects an invalid submit naming each failing path, with values kept (Req 10.2)', async () => {
    const t = setup();
    const created = t.create();
    await t.ok('surface:change', {
      ...t.base(created),
      componentId: 'name',
      value: '',
    });
    const revision = created + 1;
    const before = t.view();
    const result = await t.ok('surface:action', {
      ...t.base(revision),
      actionId: 'send',
    });
    expect(result).toMatchObject({
      status: 'rejected',
      reason: 'submit-invalid',
    });
    expect(result['issues']).toEqual([
      expect.objectContaining({ componentId: 'name', path: 'form.name' }),
    ]);
    expect(t.view()).toEqual(before);
    expect(t.sendMessageToSession).not.toHaveBeenCalled();
  });

  it('rejects a stale submit with the current revision and no turn', async () => {
    const t = setup();
    const revision = t.create();
    await t.ok('surface:change', {
      ...t.base(revision),
      componentId: 'agree',
      value: true,
    });
    expect(
      await t.ok('surface:action', { ...t.base(revision), actionId: 'send' }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'stale-revision',
      currentRevision: revision + 1,
    });
    expect(t.sendMessageToSession).not.toHaveBeenCalled();
  });

  it('rejects busy with no turn and keeps the values (Req 10.4)', async () => {
    const t = setup();
    const revision = t.create();
    t.record.turnInFlight = true;
    const params = { ...t.base(revision), actionId: 'send' };
    expect(await t.ok('surface:action', params)).toMatchObject({
      status: 'rejected',
      reason: 'busy',
    });
    expect(
      await t.ok('surface:operation', {
        routingId: TAB,
        operationId: params.operationId,
      }),
    ).toMatchObject({ status: 'rejected', reason: 'busy' });
    expect(t.sendMessageToSession).not.toHaveBeenCalled();
    expect(t.view()?.lastSubmit).toBeNull();
  });

  it('settles indeterminate on an untyped runtime failure and never resends', async () => {
    const t = setup();
    const revision = t.create();
    t.sendMessageToSession.mockRejectedValueOnce(new Error('pipe closed'));
    const params = { ...t.base(revision), actionId: 'send' };
    const result = await t.ok('surface:action', params);
    expect(result).toMatchObject({
      status: 'indeterminate',
      surfaceState: { kind: 'updated', revision: revision + 1 },
    });
    expect(JSON.stringify(result)).not.toContain('pipe closed');
    expect(await t.ok('surface:action', params)).toEqual(result);
    expect(t.sendMessageToSession).toHaveBeenCalledTimes(1);
  });

  it('settles rejected session-unavailable when the host has no chat runtime', async () => {
    const t = setup({ withSubmitTurn: false });
    const revision = t.create();
    const params = { ...t.base(revision), actionId: 'send' };
    expect(await t.ok('surface:action', params)).toEqual({
      status: 'rejected',
      operationId: params.operationId,
      reason: 'session-unavailable',
      detail: SURFACE_SUBMIT_NO_RUNTIME_DETAIL,
    });
    expect(
      await t.ok('surface:operation', {
        routingId: TAB,
        operationId: params.operationId,
      }),
    ).toMatchObject({ status: 'rejected', reason: 'session-unavailable' });
  });
});

describe('SurfaceRpcHandlers: a submit outlives its surface (Batch 10 deviation 4)', () => {
  async function pendingSubmit() {
    const t = setup();
    const revision = t.create();
    const gate = deferred();
    t.sendMessageToSession.mockImplementationOnce(async () => gate.promise);
    const params = { ...t.base(revision), actionId: 'send' };
    const first = t.ok('surface:action', params);
    await flush();
    const deleted = t.state.applyAgentUpdate(
      TAB,
      { operation: 'delete', surfaceId: 'profile', baseRevision: revision },
      'call-delete',
    );
    expect(deleted.status).toBe('applied');
    return { t, revision, gate, params, first };
  }

  it('keeps the terminal outcome with no revision when the surface is deleted before settlement', async () => {
    const { t, gate, params, first } = await pendingSubmit();
    gate.resolve();
    const settled = await first;
    expect(settled).toEqual({
      status: 'applied',
      operationId: params.operationId,
      surfaceState: { kind: 'not-recorded' },
    });
    expect(settled).not.toHaveProperty('revision');
    // The replay reaches a surface that no longer exists: the ledger answers.
    expect(await t.ok('surface:action', params)).toEqual(settled);
    expect(
      await t.ok('surface:operation', {
        routingId: TAB,
        operationId: params.operationId,
      }),
    ).toEqual({ status: 'applied' });
    expect(t.sendMessageToSession).toHaveBeenCalledTimes(1);
    expect(t.view()).toBeUndefined();
  });

  it('keeps an indeterminate outcome with no revision when the surface is deleted', async () => {
    const { t, gate, params, first } = await pendingSubmit();
    gate.reject(new Error('stream torn down'));
    const settled = await first;
    expect(settled).toMatchObject({
      status: 'indeterminate',
      operationId: params.operationId,
      surfaceState: { kind: 'not-recorded' },
    });
    expect(await t.ok('surface:action', params)).toEqual(settled);
    expect(t.sendMessageToSession).toHaveBeenCalledTimes(1);
  });

  it('keeps the terminal outcome with no revision when the surface is recreated before settlement', async () => {
    const { t, revision, gate, params, first } = await pendingSubmit();
    const recreated = t.create();
    expect(recreated).toBeGreaterThan(revision + 1);
    gate.resolve();
    const settled = await first;
    expect(settled).toEqual({
      status: 'applied',
      operationId: params.operationId,
      surfaceState: { kind: 'not-recorded' },
    });
    expect(t.view()?.lastSubmit).toBeNull();
    expect(t.view()?.revision).toBe(recreated);
    // The new incarnation declares the same action: the ledger still answers.
    expect(await t.ok('surface:action', params)).toEqual(settled);
    // The new incarnation without the action: still the recorded outcome.
    t.state.applyAgentUpdate(
      TAB,
      {
        operation: 'replace',
        baseRevision: recreated,
        surface: surfaceRpcEnvelope([SURFACE_RPC_TABLE]),
      },
      'call-replace',
    );
    expect(await t.ok('surface:action', params)).toEqual(settled);
    expect(t.sendMessageToSession).toHaveBeenCalledTimes(1);
  });

  it('keeps the terminal outcome with no revision when the surface is evicted before settlement', async () => {
    const t = setup();
    const revision = t.create();
    const gate = deferred();
    t.sendMessageToSession.mockImplementationOnce(async () => gate.promise);
    const params = { ...t.base(revision), actionId: 'send' };
    const first = t.ok('surface:action', params);
    await flush();
    // SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId is 8: eight newer
    // surfaces evict `profile`, the least recently used one.
    for (let index = 0; index < 8; index++)
      t.state.applyAgentUpdate(
        TAB,
        {
          operation: 'create',
          surface: {
            ...surfaceRpcEnvelope([SURFACE_RPC_TABLE]),
            surfaceId: `other-${index}`,
          },
        },
        `call-other-${index}`,
      );
    expect(t.view()).toBeUndefined();
    await flush();
    expect(t.pushes).toContainEqual(
      expect.objectContaining({
        surfaceId: 'profile',
        change: { kind: 'deleted', reason: 'evicted' },
      }),
    );
    gate.resolve();
    const settled = await first;
    expect(settled).toEqual({
      status: 'applied',
      operationId: params.operationId,
      surfaceState: { kind: 'not-recorded' },
    });
    expect(await t.ok('surface:action', params)).toEqual(settled);
    expect(t.state.usage().ticketBytes).toBe(0);
    expect(t.sendMessageToSession).toHaveBeenCalledTimes(1);
  });
});
