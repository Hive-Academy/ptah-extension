/**
 * SurfaceRpcHandlers — a submit whose send never answers (TASK_2026_538,
 * batch 11 review F1).
 *
 * At `SURFACE_SUBMIT_DISPATCH_DEADLINE_MS` the operation settles exactly once
 * as `indeterminate` (never an invented failure, never resent), the surface
 * ticket is released, and the next submit is not `busy`. A late resolution or
 * rejection of the stalled send settles nothing a second time and sends
 * nothing again. Wiring: `test-utils/surface-rpc-harness.ts`.
 */

import 'reflect-metadata';

// The vscode-lm-tools barrel reaches workspace-intelligence, whose tree-sitter
// module cannot load under CJS Jest; see `test-utils/heavy-module-mocks.ts`.
jest.mock('@ptah-extension/workspace-intelligence', () =>
  require('../../test-utils/heavy-module-mocks').workspaceIntelligenceMock(),
);

import {
  SURFACE_RPC_TAB as TAB,
  deferred,
  flush,
  setupSurfaceRpc as setup,
} from '../../test-utils/surface-rpc-harness';
import {
  SURFACE_SUBMIT_DEADLINE_DETAIL,
  SURFACE_SUBMIT_DISPATCH_DEADLINE_MS as DEADLINE,
} from '../chat/session/surface-submit-turn.service';

/** A submit whose send is stalled on `gate`, observed until the deadline. */
async function stalledSubmit() {
  const t = setup();
  const revision = t.create();
  const gate = deferred();
  t.sendMessageToSession.mockImplementationOnce(async () => gate.promise);
  const params = { ...t.base(revision), actionId: 'send' };
  const operation = { routingId: TAB, operationId: params.operationId };
  const first = t.ok('surface:action', params);
  await flush();
  return { t, revision, gate, params, operation, first };
}

describe('SurfaceRpcHandlers: a stalled submit settles at the deadline (review F1)', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate'] }));
  afterEach(() => jest.useRealTimers());

  it('settles indeterminate once, releases the ticket and does not block the next submit', async () => {
    const { t, revision, params, operation, first } = await stalledSubmit();
    expect(t.state.usage().ticketBytes).toBeGreaterThan(0);
    await jest.advanceTimersByTimeAsync(DEADLINE - 1);
    expect(await t.ok('surface:operation', operation)).toEqual({
      status: 'pending',
    });

    await jest.advanceTimersByTimeAsync(1);
    const settled = await first;
    expect(settled).toEqual({
      status: 'indeterminate',
      operationId: params.operationId,
      detail: SURFACE_SUBMIT_DEADLINE_DETAIL,
      surfaceState: { kind: 'updated', revision: revision + 1 },
    });
    expect(t.state.usage().ticketBytes).toBe(0);
    expect(await t.ok('surface:operation', operation)).toEqual({
      status: 'indeterminate',
      detail: SURFACE_SUBMIT_DEADLINE_DETAIL,
      revision: revision + 1,
    });
    expect(t.view()?.lastSubmit?.status).toBe('indeterminate');
    expect(await t.ok('surface:action', params)).toEqual(settled);
    expect(t.sendMessageToSession).toHaveBeenCalledTimes(1);

    const next = await t.ok('surface:action', {
      ...t.base(revision + 1),
      actionId: 'send',
    });
    expect(next).toMatchObject({ status: 'applied' });
    expect(t.sendMessageToSession).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['resolution', (gate: ReturnType<typeof deferred>) => gate.resolve()],
    [
      'rejection',
      (gate: ReturnType<typeof deferred>) => gate.reject(new Error('late')),
    ],
  ])(
    'ignores a late %s: no second settlement and no second send',
    async (_label, settleLate) => {
      const { t, revision, gate, params, operation, first } =
        await stalledSubmit();
      await jest.advanceTimersByTimeAsync(DEADLINE);
      const settled = await first;
      const status = await t.ok('surface:operation', operation);
      await flush();
      const pushed = t.pushes.length;

      settleLate(gate);
      await jest.advanceTimersByTimeAsync(0);
      await flush();

      expect(await t.ok('surface:operation', operation)).toEqual(status);
      expect(await t.ok('surface:action', params)).toEqual(settled);
      expect(t.view()?.revision).toBe(revision + 1);
      expect(t.pushes.length).toBe(pushed);
      expect(t.sendMessageToSession).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(settled)).not.toContain('late');
    },
  );

  it('settles indeterminate with no revision when the surface is deleted during the wait', async () => {
    const { t, revision, params, first } = await stalledSubmit();
    t.state.applyAgentUpdate(
      TAB,
      { operation: 'delete', surfaceId: 'profile', baseRevision: revision },
      'call-delete',
    );
    await jest.advanceTimersByTimeAsync(DEADLINE);
    const settled = await first;
    expect(settled).toEqual({
      status: 'indeterminate',
      operationId: params.operationId,
      detail: SURFACE_SUBMIT_DEADLINE_DETAIL,
      surfaceState: { kind: 'not-recorded' },
    });
    expect(t.state.usage().ticketBytes).toBe(0);
    expect(await t.ok('surface:action', params)).toEqual(settled);
    expect(t.sendMessageToSession).toHaveBeenCalledTimes(1);
  });
});
