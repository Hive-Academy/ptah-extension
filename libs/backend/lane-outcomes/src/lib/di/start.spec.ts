import { container as rootContainer, type DependencyContainer } from 'tsyringe';
import {
  SDK_TOKENS,
  type SdkAdapterEvents,
  type SdkAdapterSubagentEndedEvent,
} from '@ptah-extension/agent-sdk';
import type { LaneOutcomeLogger } from '../lane-outcome-logger';
import { LANE_OUTCOME_PIPELINE } from './register';
import {
  LANE_OUTCOME_DRAIN_BUDGET_MS,
  startAndRegisterLaneOutcomes,
  type LaneOutcomesDisposer,
} from './start';
import { LANE_OUTCOME_TOKENS } from './tokens';

function quietLogger(): LaneOutcomeLogger & { warn: jest.Mock } {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

/** A child container whose pipeline `dispose` is `disposePipeline`. */
function containerWith(
  disposePipeline: () => Promise<void>,
  recorder: { recordSubagentEnded?: jest.Mock } = {},
): DependencyContainer {
  const container = rootContainer.createChildContainer();
  container.register(LANE_OUTCOME_TOKENS.RECORDER, { useValue: recorder });
  container.register(LANE_OUTCOME_PIPELINE, {
    useValue: { dispose: disposePipeline },
  });
  return container;
}

function registeredDisposer(
  container: DependencyContainer,
): LaneOutcomesDisposer {
  expect(container.isRegistered(LANE_OUTCOME_TOKENS.DISPOSER)).toBe(true);
  return container.resolve<LaneOutcomesDisposer>(LANE_OUTCOME_TOKENS.DISPOSER);
}

describe('startAndRegisterLaneOutcomes', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('subscribes to subagentEnded on request and releases the listener on dispose', async () => {
    const disposePipeline = jest.fn(async () => undefined);
    const recordSubagentEnded = jest.fn();
    const container = containerWith(disposePipeline, { recordSubagentEnded });
    let listener: Parameters<SdkAdapterEvents['onSubagentEnded']>[0] | undefined;
    const unsubscribe = jest.fn();
    const onSubagentEnded = jest.fn(
      (callback: Parameters<SdkAdapterEvents['onSubagentEnded']>[0]) => {
        listener = callback;
        return unsubscribe;
      },
    );
    container.register(SDK_TOKENS.SDK_ADAPTER_EVENTS, {
      useValue: { onSubagentEnded },
    });

    startAndRegisterLaneOutcomes(container, quietLogger(), {
      observeSubagentEnded: true,
    });
    expect(onSubagentEnded).toHaveBeenCalledTimes(1);
    const event: SdkAdapterSubagentEndedEvent = {
      sessionId: 'parent',
      cwd: 'workspace',
      agentId: 'agent',
      agentType: 'general-purpose',
      lastAssistantMessage: null,
      backgroundTasks: [],
      timestamp: 1,
    };
    listener?.(event);
    expect(recordSubagentEnded).toHaveBeenCalledWith(event);

    await registeredDisposer(container).dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(disposePipeline).toHaveBeenCalledTimes(1);
  });

  it('leaves subagentEnded unobserved by default', async () => {
    const container = containerWith(async () => undefined);
    const onSubagentEnded = jest.fn(() => jest.fn());
    container.register(SDK_TOKENS.SDK_ADAPTER_EVENTS, {
      useValue: { onSubagentEnded },
    });
    startAndRegisterLaneOutcomes(container, quietLogger());
    expect(onSubagentEnded).not.toHaveBeenCalled();
    await registeredDisposer(container).dispose();
  });

  it('cleans up a partial callback start and registers a drain', async () => {
    const unsubscribe = jest.fn();
    const disposePipeline = jest.fn(async () => undefined);
    const logger = quietLogger();
    const container = containerWith(disposePipeline);
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
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('callback registration failed'),
      expect.objectContaining({ error: expect.any(Error) }),
    );
    await registeredDisposer(container).dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(disposePipeline).toHaveBeenCalledTimes(1);
  });

  it('registers a no-op drain when the start itself throws', async () => {
    const logger = quietLogger();
    const container = rootContainer.createChildContainer();
    container.register(LANE_OUTCOME_TOKENS.RECORDER, {
      useFactory: () => {
        throw new Error('recorder unavailable');
      },
    });

    startAndRegisterLaneOutcomes(container, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('start failed'),
      expect.objectContaining({ error: expect.any(Error) }),
    );
    await expect(
      registeredDisposer(container).dispose(),
    ).resolves.toBeUndefined();
  });

  it('settles at the drain budget when the drain never finishes (P6 re-review style N1)', async () => {
    jest.useFakeTimers();
    const logger = quietLogger();
    const container = containerWith(() => new Promise<void>(() => undefined));
    startAndRegisterLaneOutcomes(container, logger);

    let settled = false;
    const disposing = registeredDisposer(container)
      .dispose()
      .then(() => {
        settled = true;
      });
    await jest.advanceTimersByTimeAsync(LANE_OUTCOME_DRAIN_BUDGET_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await disposing;

    expect(settled).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `exceeded its ${LANE_OUTCOME_DRAIN_BUDGET_MS} ms shutdown budget`,
      ),
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('logs a failed drain and resolves instead of rejecting', async () => {
    const logger = quietLogger();
    const container = containerWith(() =>
      Promise.reject(new Error('journal write failed')),
    );
    startAndRegisterLaneOutcomes(container, logger);

    await expect(
      registeredDisposer(container).dispose(),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('drain failed'),
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('still resolves when the drain fails and the logger throws too (P6 final review)', async () => {
    const logger = quietLogger();
    logger.warn.mockImplementation(() => {
      throw new Error('log sink closed');
    });
    const container = containerWith(() =>
      Promise.reject(new Error('journal write failed')),
    );
    startAndRegisterLaneOutcomes(container, logger);

    await expect(
      registeredDisposer(container).dispose(),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('still resolves at the budget when the timeout warning throws', async () => {
    jest.useFakeTimers();
    const logger = quietLogger();
    logger.warn.mockImplementation(() => {
      throw new Error('log sink closed');
    });
    const container = containerWith(() => new Promise<void>(() => undefined));
    startAndRegisterLaneOutcomes(container, logger);

    const disposing = registeredDisposer(container).dispose();
    await jest.advanceTimersByTimeAsync(LANE_OUTCOME_DRAIN_BUDGET_MS);

    await expect(disposing).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });
});
