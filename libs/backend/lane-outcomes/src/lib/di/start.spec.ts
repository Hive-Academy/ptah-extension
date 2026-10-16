import { container as rootContainer } from 'tsyringe';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { LaneOutcomeLogger } from '../lane-outcome-logger';
import { LANE_OUTCOME_PIPELINE } from './register';
import { startAndRegisterLaneOutcomes } from './start';
import { LANE_OUTCOME_TOKENS } from './tokens';

describe('startAndRegisterLaneOutcomes', () => {
  it('cleans up a partial callback start and registers a drain', async () => {
    const unsubscribe = jest.fn();
    const disposePipeline = jest.fn(async () => undefined);
    const warn = jest.fn();
    const logger: LaneOutcomeLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn,
      error: jest.fn(),
    };
    const container = rootContainer.createChildContainer();
    container.register(LANE_OUTCOME_TOKENS.RECORDER, { useValue: {} });
    container.register(LANE_OUTCOME_PIPELINE, {
      useValue: { dispose: disposePipeline },
    });
    container.register(SDK_TOKENS.SDK_SUBAGENT_STOP_CALLBACK_REGISTRY, {
      useValue: { register: () => unsubscribe },
    });
    container.register(SDK_TOKENS.SDK_SUBAGENT_BUDGET_STOP_CALLBACK_REGISTRY, {
      useValue: {
        register: () => {
          throw new Error('second registration failed');
        },
      },
    });

    startAndRegisterLaneOutcomes(container, logger);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('callback registration failed'),
      expect.objectContaining({ error: expect.any(Error) }),
    );
    expect(container.isRegistered(LANE_OUTCOME_TOKENS.DISPOSER)).toBe(true);
    const disposer = container.resolve<() => Promise<void>>(
      LANE_OUTCOME_TOKENS.DISPOSER,
    );
    await disposer();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(disposePipeline).toHaveBeenCalledTimes(1);
  });
});
