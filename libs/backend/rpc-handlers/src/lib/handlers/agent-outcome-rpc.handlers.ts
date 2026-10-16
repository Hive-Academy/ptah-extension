/**
 * Agents-tab outcome signals (TASK_2026_646 B7).
 *
 * `agent:outcomeSignals` validates `{ slugs }` and asks the lane-outcomes
 * reader once for the whole list. It resolves the token at call time.
 * No reader yields an empty, non-persistent result. Reader failures are
 * logged and mapped to a fixed, coded RPC error.
 */

import { inject, injectable, type DependencyContainer } from 'tsyringe';
import { TOKENS, RpcUserError } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  LANE_OUTCOME_TOKENS,
  type LaneOutcomeQueries,
} from '@ptah-extension/lane-outcomes';
import type {
  AgentOutcomeSignalsParams,
  AgentOutcomeSignalsResult,
  RpcMethodName,
} from '@ptah-extension/shared';
import {
  AgentOutcomeSignalsParamsSchema,
  agentOutcomeIssueText,
} from './agent-outcome.schema';

const METHOD = 'agent:outcomeSignals';

/** Part B window. Echoed on every result, including the empty one. */
const WINDOW_DAYS = 30;

/**
 * The slice of {@link LaneOutcomeQueries} this method calls. Resolved by
 * token; the class is not a constructor dependency.
 */
type OutcomeSignalReader = Pick<
  LaneOutcomeQueries,
  'agentSignals' | 'isPersistent'
>;

@injectable()
export class AgentOutcomeRpcHandlers {
  static readonly METHODS = [
    METHOD,
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.DI_CONTAINER)
    private readonly runtimeContainer: DependencyContainer,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<
      AgentOutcomeSignalsParams,
      AgentOutcomeSignalsResult
    >(METHOD, async (params: unknown) => this.outcomeSignals(params));
  }

  private async outcomeSignals(
    params: unknown,
  ): Promise<AgentOutcomeSignalsResult> {
    const parsed = AgentOutcomeSignalsParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw new RpcUserError(
        `${METHOD}: invalid params — ${agentOutcomeIssueText(parsed.error)}`,
        'INVALID_PARAMS',
      );
    }

    // `true` walks parent containers. Batch 30 registers the reader there.
    if (!this.runtimeContainer.isRegistered(LANE_OUTCOME_TOKENS.READER, true)) {
      return { signals: {}, windowDays: WINDOW_DAYS, persistent: false };
    }

    try {
      const reader = this.runtimeContainer.resolve<OutcomeSignalReader>(
        LANE_OUTCOME_TOKENS.READER,
      );
      const signals = await reader.agentSignals(parsed.data.slugs, WINDOW_DAYS);
      return {
        signals,
        windowDays: WINDOW_DAYS,
        persistent: reader.isPersistent(),
      };
    } catch (error: unknown) {
      this.logger.error(
        'RPC: agent:outcomeSignals failed',
        error instanceof Error
          ? error
          : new Error('Unknown outcome read failure'),
      );
      throw new RpcUserError(
        'Outcome signals are unavailable.',
        'PERSISTENCE_UNAVAILABLE',
      );
    }
  }
}
