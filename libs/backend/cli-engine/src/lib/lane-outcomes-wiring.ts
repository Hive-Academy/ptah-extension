import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { LANE_ROUTING_TOKENS } from '@ptah-extension/lane-routing';
import {
  LANE_OUTCOME_TOKENS,
  registerLaneOutcomeServices,
  startLaneOutcomes,
} from '@ptah-extension/lane-outcomes';

export const LANE_OUTCOMES_DISPOSER = Symbol.for('PtahLaneOutcomesDisposer');

export function wireLaneOutcomes(
  container: DependencyContainer,
  logger: Logger,
): void {
  registerLaneOutcomeServices(container, logger);
  container.register(LANE_ROUTING_TOKENS.LANE_OUTCOME_READER, {
    useToken: LANE_OUTCOME_TOKENS.READER,
  });
  container.register(LANE_OUTCOME_TOKENS.FAILURE_CLASSIFIER, {
    useToken: LANE_ROUTING_TOKENS.FAILURE_CLASSIFIER,
  });
}

export function startCliLaneOutcomes(
  container: DependencyContainer,
  logger: Logger,
): void {
  try {
    const disposeLaneOutcomes = startLaneOutcomes(container, logger);
    container.register(LANE_OUTCOMES_DISPOSER, {
      useValue: disposeLaneOutcomes,
    });
  } catch (error: unknown) {
    logger.warn('[CLI DI] Lane outcomes start failed (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
