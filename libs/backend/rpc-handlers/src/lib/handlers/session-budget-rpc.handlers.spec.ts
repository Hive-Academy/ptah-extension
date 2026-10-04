/**
 * SessionBudgetRpcHandlers specs (TASK_2026_597 N7, Task 57.2).
 *
 * Built in a tsyringe child container, the way the RPC surface resolves it
 * (`requires: []` → constructed on every host):
 *  - with a fake budget service: each banner action is validated and
 *    forwarded to `act` unchanged, and its result is the RPC result;
 *  - an invalid session id or action never reaches the service;
 *  - without `SDK_TOKENS.SDK_SESSION_BUDGET`: construction succeeds and the
 *    method answers `{ success: false, error: 'unavailable' }`.
 */
import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type {
  SessionBudgetAction,
  SessionBudgetActionResult,
  SessionBudgetState,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import { SessionBudgetRpcHandlers } from './session-budget-rpc.handlers';
import { SESSION_BUDGET_ACTIONS } from './session-budget-rpc.schema';

const METHOD = 'session:budgetAction';
const SESSION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';

const STATE: SessionBudgetState = {
  sessionId: SESSION_ID,
  stage: 'limit',
  unit: 'tokens',
  measure: 'tokens',
  used: 50_000_000,
  limit: 50_000_000,
  percent: 100,
  lowerBound: false,
  revision: 7,
  compactions: 0,
  extensions: 0,
  blocked: true,
};

interface Fakes {
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  budget: {
    act: jest.Mock<
      Promise<SessionBudgetActionResult>,
      [string, SessionBudgetAction]
    >;
  };
}

function createFakes(): Fakes {
  return {
    logger: createMockLogger(),
    rpcHandler: createMockRpcHandler(),
    budget: {
      act: jest
        .fn<Promise<SessionBudgetActionResult>, [string, SessionBudgetAction]>()
        .mockResolvedValue({ success: true, state: STATE }),
    },
  };
}

/** `withService: false` is a host that never registers the budget token. */
function build(fakes: Fakes, opts: { withService: boolean }): void {
  const child = container.createChildContainer();
  child.registerInstance(TOKENS.LOGGER, fakes.logger);
  child.registerInstance(TOKENS.RPC_HANDLER, fakes.rpcHandler);
  if (opts.withService) {
    child.registerInstance(SDK_TOKENS.SDK_SESSION_BUDGET, fakes.budget);
  }
  child.register(SessionBudgetRpcHandlers, {
    useClass: SessionBudgetRpcHandlers,
  });
  child.resolve(SessionBudgetRpcHandlers).register();
}

async function call(
  fakes: Fakes,
  params: unknown,
): Promise<SessionBudgetActionResult> {
  const response = await fakes.rpcHandler.handleMessage({
    method: METHOD,
    params: params as Record<string, unknown>,
    correlationId: 'corr-budget',
  });
  if (!response.success) {
    throw new Error(`RPC ${METHOD} failed: ${response.error}`);
  }
  return response.data as SessionBudgetActionResult;
}

describe('SessionBudgetRpcHandlers', () => {
  it('owns exactly session:budgetAction', () => {
    expect([...SessionBudgetRpcHandlers.METHODS]).toEqual([METHOD]);
  });

  it('validates the five banner actions', () => {
    expect([...SESSION_BUDGET_ACTIONS]).toEqual([
      'dismiss',
      'extend',
      'restore-window',
      'write-handoff',
      'preview-handoff',
    ]);
  });

  describe('with the budget service', () => {
    it('registers the method', () => {
      const fakes = createFakes();
      build(fakes, { withService: true });
      const registered = fakes.rpcHandler.registerMethod.mock.calls.map(
        (c: unknown[]) => c[0],
      );
      expect(registered).toEqual([METHOD]);
    });

    it.each(SESSION_BUDGET_ACTIONS.map((action) => [action]))(
      '%s is forwarded to act and its result returned as-is',
      async (action) => {
        const fakes = createFakes();
        const result: SessionBudgetActionResult = {
          success: true,
          state: { ...STATE, extensions: action === 'extend' ? 1 : 0 },
        };
        fakes.budget.act.mockResolvedValueOnce(result);
        build(fakes, { withService: true });

        await expect(
          call(fakes, { sessionId: SESSION_ID, action }),
        ).resolves.toEqual(result);
        expect(fakes.budget.act).toHaveBeenCalledTimes(1);
        expect(fakes.budget.act).toHaveBeenCalledWith(SESSION_ID, action);
      },
    );

    it('returns the handoff content, path and seed for write-handoff', async () => {
      const fakes = createFakes();
      const result: SessionBudgetActionResult = {
        success: true,
        state: STATE,
        handoff: {
          content: '# Handoff',
          path: '/home/u/.ptah/handoffs/x.md',
          seed: 'Continue from the handoff',
        },
      };
      fakes.budget.act.mockResolvedValueOnce(result);
      build(fakes, { withService: true });

      await expect(
        call(fakes, { sessionId: SESSION_ID, action: 'write-handoff' }),
      ).resolves.toEqual(result);
    });

    it('passes a service failure result through unchanged', async () => {
      const fakes = createFakes();
      const failure: SessionBudgetActionResult = {
        success: false,
        state: STATE,
        error: 'The restore-window action failed',
      };
      fakes.budget.act.mockResolvedValueOnce(failure);
      build(fakes, { withService: true });

      await expect(
        call(fakes, { sessionId: SESSION_ID, action: 'restore-window' }),
      ).resolves.toEqual(failure);
    });

    it.each([
      ['a non-UUID id', { sessionId: 'not-a-uuid', action: 'dismiss' }],
      [
        'a path-like id',
        { sessionId: '../../etc/passwd', action: 'write-handoff' },
      ],
      ['a missing id', { action: 'dismiss' }],
      ['a numeric id', { sessionId: 42, action: 'dismiss' }],
    ])('rejects %s without calling the service', async (_label, params) => {
      const fakes = createFakes();
      build(fakes, { withService: true });

      const result = await call(fakes, params);
      expect(result.success).toBe(false);
      expect(result.error).toEqual(expect.any(String));
      expect(result.error).not.toBe('unavailable');
      expect(fakes.budget.act).not.toHaveBeenCalled();
    });

    it.each([
      ['an unknown action', { sessionId: SESSION_ID, action: 'reset' }],
      ['a missing action', { sessionId: SESSION_ID }],
      [
        'an action of the wrong case',
        { sessionId: SESSION_ID, action: 'Extend' },
      ],
    ])('rejects %s without calling the service', async (_label, params) => {
      const fakes = createFakes();
      build(fakes, { withService: true });

      const result = await call(fakes, params);
      expect(result.success).toBe(false);
      expect(fakes.budget.act).not.toHaveBeenCalled();
    });

    it('rejects missing params', async () => {
      const fakes = createFakes();
      build(fakes, { withService: true });

      const result = await call(fakes, undefined);
      expect(result.success).toBe(false);
      expect(fakes.budget.act).not.toHaveBeenCalled();
    });
  });

  describe('without the budget service', () => {
    it('constructs in a child container and still registers the method', () => {
      const fakes = createFakes();
      expect(() => build(fakes, { withService: false })).not.toThrow();
      const registered = fakes.rpcHandler.registerMethod.mock.calls.map(
        (c: unknown[]) => c[0],
      );
      expect(registered).toEqual([METHOD]);
    });

    it.each(SESSION_BUDGET_ACTIONS.map((action) => [action]))(
      '%s answers unavailable',
      async (action) => {
        const fakes = createFakes();
        build(fakes, { withService: false });

        await expect(
          call(fakes, { sessionId: SESSION_ID, action }),
        ).resolves.toEqual({ success: false, error: 'unavailable' });
      },
    );

    it('still rejects invalid params before reporting unavailable', async () => {
      const fakes = createFakes();
      build(fakes, { withService: false });

      const result = await call(fakes, { sessionId: 'nope', action: 'x' });
      expect(result.success).toBe(false);
      expect(result.error).not.toBe('unavailable');
    });
  });
});
