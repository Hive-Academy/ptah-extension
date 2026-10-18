/**
 * Decision-model catalog read (TASK_2026_684, Component 10, Requirement 4).
 *
 * `agent:listDecisionModels` validates `{ source }` and lists the models that
 * host reports as `decision`-capable, for the picker only (D3: no
 * auto-select, no default). The catalog never rejects by contract; if it
 * does, the method answers `filter: 'unavailable'` and logs the error name
 * only, never a message, URL or key.
 */

import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { TOKENS, RpcUserError } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  LANE_ROUTING_TOKENS,
  type DecisionModelCatalog,
} from '@ptah-extension/lane-routing';
import {
  DECISION_MODEL_CATALOG_SOURCES,
  loggableErrorName,
  type AgentListDecisionModelsParams,
  type AgentListDecisionModelsResult,
  type RpcMethodName,
} from '@ptah-extension/shared';

const METHOD = 'agent:listDecisionModels';

/**
 * Built from the shared source list, so it accepts exactly the
 * `DecisionModelCatalogSource` union. `.strict()` rejects a caller that adds
 * a field.
 */
export const AgentListDecisionModelsParamsSchema = z
  .object({ source: z.enum(DECISION_MODEL_CATALOG_SOURCES) })
  .strict();

/** The slice of the catalog this method calls. */
type DecisionModelLister = Pick<DecisionModelCatalog, 'list'>;

@injectable()
export class DecisionModelCatalogRpcHandlers {
  static readonly METHODS = [
    METHOD,
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(LANE_ROUTING_TOKENS.DECISION_MODEL_CATALOG)
    private readonly catalog: DecisionModelLister,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<
      AgentListDecisionModelsParams,
      AgentListDecisionModelsResult
    >(METHOD, async (params: unknown) => this.listDecisionModels(params));
  }

  private async listDecisionModels(
    params: unknown,
  ): Promise<AgentListDecisionModelsResult> {
    const parsed = AgentListDecisionModelsParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw new RpcUserError(
        `${METHOD}: invalid params — source must be one of ${DECISION_MODEL_CATALOG_SOURCES.join(', ')}.`,
        'INVALID_PARAMS',
      );
    }

    try {
      const result = await this.catalog.list(parsed.data.source);
      return {
        models: [...result.models],
        filter: result.filter,
        undetermined: result.undetermined,
      };
    } catch (error: unknown) {
      // degradation-audit: optional-capability — the catalog never rejects by
      // contract; a rejection still answers the picker as `unavailable` and
      // is logged by its error name so the failure stays visible.
      this.logger.warn(`[decisionModelCatalog] ${METHOD} failed`, {
        source: parsed.data.source,
        errorName: loggableErrorName(error),
      });
      return { models: [], filter: 'unavailable', undetermined: 0 };
    }
  }
}
