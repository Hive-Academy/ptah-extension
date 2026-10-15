/**
 * Agents-tab outcome signals (TASK_2026_646 B7).
 *
 * `agent:outcomeSignals` validates `{ slugs }` and asks the lane-outcomes
 * reader once for the whole list. Hosts register `LANE_OUTCOME_TOKENS` in a
 * later batch, so this class must not `@inject` the reader (decision #73).
 * It resolves the token at call time. No reader → an empty, non-persistent
 * result. A reader rejection is logged by error name and rethrown.
 */

import { inject, injectable, type DependencyContainer } from 'tsyringe';
import { TOKENS, RpcUserError } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { LANE_OUTCOME_TOKENS } from '@ptah-extension/lane-outcomes';
import type {
  AgentOutcomeSignals,
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
interface OutcomeSignalReader {
  agentSignals(
    slugs: readonly string[],
    windowDays: number,
  ): Promise<Record<string, AgentOutcomeSignals>>;
  isPersistent(): boolean;
}

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
      // Ids only: a reader message can quote a path. The rejection is the
      // RPC error result; this log does not replace it.
      this.logger.error('RPC: agent:outcomeSignals failed', {
        code: error instanceof Error ? error.name : 'UNKNOWN',
      });
      throw error;
    }
  }
}
