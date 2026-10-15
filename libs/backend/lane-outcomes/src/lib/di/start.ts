import type { DependencyContainer } from 'tsyringe';
import {
  SDK_TOKENS,
  type SubagentBudgetStopCallbackRegistry,
  type SubagentStopCallbackRegistry,
} from '@ptah-extension/agent-sdk';
import { LaneOutcomeRecorder } from '../lane-outcome-recorder.service';
import type { LaneOutcomeLogger } from '../lane-outcome-logger';
import { OutcomeWritePipeline } from '../write/outcome-write-pipeline';
import { LANE_OUTCOME_PIPELINE, registerLaneOutcomeServices } from './register';
import { LANE_OUTCOME_TOKENS } from './tokens';

/** Registers missing services, attaches SDK callbacks, and returns an awaited disposer. */
export function startLaneOutcomes(
  container: DependencyContainer,
  logger: LaneOutcomeLogger,
): () => Promise<void> {
  if (!container.isRegistered(LANE_OUTCOME_TOKENS.RECORDER))
    registerLaneOutcomeServices(container, logger);
  const recorder = container.resolve<LaneOutcomeRecorder>(
    LANE_OUTCOME_TOKENS.RECORDER,
  );
  const pipeline = container.resolve<OutcomeWritePipeline>(
    LANE_OUTCOME_PIPELINE,
  );
  const unsubs: Array<() => void> = [];
  if (container.isRegistered(SDK_TOKENS.SDK_SUBAGENT_STOP_CALLBACK_REGISTRY)) {
    const registry = container.resolve<SubagentStopCallbackRegistry>(
      SDK_TOKENS.SDK_SUBAGENT_STOP_CALLBACK_REGISTRY,
    );
    unsubs.push(
      registry.register((payload) => recorder.recordSubagentStop(payload)),
    );
  }
  if (
    container.isRegistered(
      SDK_TOKENS.SDK_SUBAGENT_BUDGET_STOP_CALLBACK_REGISTRY,
    )
  ) {
    const registry = container.resolve<SubagentBudgetStopCallbackRegistry>(
      SDK_TOKENS.SDK_SUBAGENT_BUDGET_STOP_CALLBACK_REGISTRY,
    );
    unsubs.push(
      registry.register((payload) =>
        recorder.markSubagentBudgetStop(payload.agentId),
      ),
    );
  }
  return async () => {
    for (const unsubscribe of unsubs) unsubscribe();
    await pipeline.dispose();
  };
}
