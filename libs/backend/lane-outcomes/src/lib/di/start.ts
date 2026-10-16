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

/**
 * Longest a host's shutdown waits for the lane-outcomes drain. The drain runs
 * after the agents are reaped (their exits stage outcome writes) and before
 * persistence closes, so every host's quit path waits on it; a stuck write
 * must not hold the quit. Ops still queued when it expires are not lost: the
 * pipeline moves them to its KV journal and replays them on the next start.
 * Owned here, not by the hosts, so VS Code, Electron and the CLI share one
 * number and one timeout.
 */
export const LANE_OUTCOME_DRAIN_BUDGET_MS = 2000;

/**
 * What {@link startAndRegisterLaneOutcomes} registers under
 * `LANE_OUTCOME_TOKENS.DISPOSER`. A host's shutdown calls `dispose()` and
 * nothing else.
 */
export interface LaneOutcomesDisposer {
  /**
   * Unsubscribe the SDK callbacks, then drain pending writes. Settles within
   * {@link LANE_OUTCOME_DRAIN_BUDGET_MS} and never rejects: a timeout or a
   * failed drain is logged and shutdown continues.
   */
  dispose(): Promise<void>;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

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
  const unsubscribeAll = (): void => {
    for (const unsubscribe of unsubs.splice(0)) {
      try {
        unsubscribe();
      } catch (error: unknown) {
        logger.warn('Lane outcomes callback cleanup failed (non-fatal)', {
          error: asError(error),
        });
      }
    }
  };
  try {
    if (
      container.isRegistered(SDK_TOKENS.SDK_SUBAGENT_STOP_CALLBACK_REGISTRY)
    ) {
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
  } catch (error: unknown) {
    unsubscribeAll();
    logger.warn('Lane outcomes callback registration failed (non-fatal)', {
      error: asError(error),
    });
  }
  return async () => {
    unsubscribeAll();
    await pipeline.dispose();
  };
}

/** Runs `drain`; a rejection is logged, never rethrown. */
async function drainOrWarn(
  drain: () => Promise<void>,
  logger: LaneOutcomeLogger,
): Promise<void> {
  try {
    await drain();
  } catch (error: unknown) {
    logger.warn('Lane outcomes drain failed (non-fatal)', {
      error: asError(error),
    });
  }
}

/** `drain` held to {@link LANE_OUTCOME_DRAIN_BUDGET_MS}; see {@link LaneOutcomesDisposer}. */
function boundedDisposer(
  drain: () => Promise<void>,
  logger: LaneOutcomeLogger,
): LaneOutcomesDisposer {
  return {
    dispose: async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), LANE_OUTCOME_DRAIN_BUDGET_MS);
      });
      try {
        const finished = await Promise.race([
          drainOrWarn(drain, logger).then(() => true),
          expired,
        ]);
        if (!finished) {
          logger.warn(
            `Lane outcomes drain exceeded its ${LANE_OUTCOME_DRAIN_BUDGET_MS} ms shutdown budget; continuing`,
          );
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Start callbacks and register a bounded drain (a {@link LaneOutcomesDisposer})
 * even if initialization fails: a failed start registers a no-op drain, so a
 * host's shutdown never needs to know whether the start succeeded.
 */
export function startAndRegisterLaneOutcomes(
  container: DependencyContainer,
  logger: LaneOutcomeLogger,
): void {
  let drain: () => Promise<void> = async () => undefined;
  try {
    drain = startLaneOutcomes(container, logger);
  } catch (error: unknown) {
    logger.warn('Lane outcomes start failed (non-fatal)', {
      error: asError(error),
    });
  }
  const disposer: LaneOutcomesDisposer = boundedDisposer(drain, logger);
  container.register(LANE_OUTCOME_TOKENS.DISPOSER, { useValue: disposer });
}
