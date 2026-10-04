/**
 * Session budget RPC handlers (TASK_2026_597 N7, decision 13).
 *
 * `session:budgetAction` carries the budget banner's buttons to
 * `SessionBudgetService.act`: dismiss a stage, allow 20% more at the limit,
 * restore the auto-compact window, and write or preview the handoff whose
 * seed starts "Continue in new session".
 *
 * `requires: []` in the manifest: every host serves the method. The budget
 * service is injected optionally; a host that does not register
 * `SDK_TOKENS.SDK_SESSION_BUDGET` answers `{ success: false, error:
 * 'unavailable' }` instead of hiding the method.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { SessionBudgetService } from '@ptah-extension/agent-sdk';
import type {
  RpcMethodName,
  SessionBudgetActionResult,
} from '@ptah-extension/shared';
import { parseSessionBudgetActionParams } from './session-budget-rpc.schema';

/** The budget surface this handler needs. */
type SessionBudgetActions = Pick<SessionBudgetService, 'act'>;

/** Answer on a host without the budget service. */
const UNAVAILABLE: SessionBudgetActionResult = Object.freeze({
  success: false,
  error: 'unavailable',
});

/** Answer for params that fail validation. */
const INVALID_PARAMS: SessionBudgetActionResult = Object.freeze({
  success: false,
  error: 'sessionId must be a session UUID and action a budget action',
});

@injectable()
export class SessionBudgetRpcHandlers {
  /** RPC methods owned by this handler (manifest coverage invariant). */
  static readonly METHODS = [
    'session:budgetAction',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    /** Absent on a host that does not register the budget service. */
    @inject(SDK_TOKENS.SDK_SESSION_BUDGET, { isOptional: true })
    private readonly budget?: SessionBudgetActions,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<unknown, SessionBudgetActionResult>(
      'session:budgetAction',
      async (rawParams) => {
        const params = parseSessionBudgetActionParams(rawParams);
        if (!params) return INVALID_PARAMS;
        if (!this.budget) return UNAVAILABLE;
        // `act` never throws: an action failure comes back as
        // `{ success: false, error }` with the session's current state.
        return this.budget.act(params.sessionId, params.action);
      },
    );

    this.logger.debug('Session budget RPC handlers registered', {
      methods: [...SessionBudgetRpcHandlers.METHODS],
      available: this.budget !== undefined,
    });
  }
}
