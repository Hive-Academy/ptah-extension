import { container } from 'tsyringe';

import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  createMockFileSystemProvider,
  createMockSecretStorage,
  createMockStateStorage,
  createMockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';

import { DecisionModelConfig } from '../decision-model/decision-model.config';
import type { StructuredDecisionCompleter } from '../decision-model/structured-decision.port';
import { DecisionModelFailureClassifier } from '../failure-class/decision-model-failure-classifier';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import { RouteDecideService } from '../route-decide.service';
import { registerLaneRoutingServices } from './register';
import { LANE_ROUTING_TOKENS } from './tokens';

function testLogger(): LaneRoutingLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function platformChild() {
  const child = container.createChildContainer();
  child.registerInstance(
    PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER,
    createMockFileSystemProvider(),
  );
  child.registerInstance(
    PLATFORM_TOKENS.STATE_STORAGE,
    createMockStateStorage(),
  );
  child.registerInstance(
    PLATFORM_TOKENS.SECRET_STORAGE,
    createMockSecretStorage(),
  );
  child.registerInstance(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    createMockWorkspaceProvider(),
  );
  return child;
}

describe('registerLaneRoutingServices', () => {
  it('reuses one config and one service and keeps the host logger', () => {
    const child = platformChild();
    const logger = testLogger();
    registerLaneRoutingServices(child, logger);

    const config = child.resolve(LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG);
    const service = child.resolve(LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE);

    expect(config).toBeInstanceOf(DecisionModelConfig);
    expect(config).toBe(
      child.resolve(LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG),
    );
    expect(service).toBeInstanceOf(RouteDecideService);
    expect(service).toBe(
      child.resolve(LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE),
    );
    expect(child.resolve(LANE_ROUTING_TOKENS.LOGGER)).toBe(logger);
    expect(child.isRegistered(LANE_ROUTING_TOKENS.ROTATION_STORE)).toBe(true);
    expect(
      child.isRegistered(LANE_ROUTING_TOKENS.CAPABILITY_MATRIX_STORE),
    ).toBe(true);
    const classifier = child.resolve(LANE_ROUTING_TOKENS.FAILURE_CLASSIFIER);
    expect(classifier).toBeInstanceOf(DecisionModelFailureClassifier);
    expect(classifier).toBe(
      child.resolve(LANE_ROUTING_TOKENS.FAILURE_CLASSIFIER),
    );
  });

  it('reports structured models unreachable when the port is not registered', async () => {
    const child = platformChild();
    registerLaneRoutingServices(child, testLogger());
    const config = child.resolve<DecisionModelConfig>(
      LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG,
    );

    await config.setSelection({
      kind: 'structured',
      providerId: 'anthropic',
      model: 'claude',
    });
    const status = await config.getStatus();

    expect(status.state).toBe('unreachable');
  });

  it('calls a structured port that was registered before the config is resolved', async () => {
    const child = platformChild();
    const isReady = jest.fn(async () => true);
    const completer: StructuredDecisionCompleter = {
      isReady,
      complete: async () => ({}),
    };
    child.registerInstance(LANE_ROUTING_TOKENS.STRUCTURED_DECISION, completer);
    registerLaneRoutingServices(child, testLogger());
    const config = child.resolve<DecisionModelConfig>(
      LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG,
    );

    await config.setSelection({
      kind: 'structured',
      providerId: 'anthropic',
      model: 'claude',
    });
    const status = await config.getStatus();

    expect(isReady).toHaveBeenCalledTimes(1);
    expect(isReady).toHaveBeenCalledWith('anthropic');
    expect(status.state).toBe('ready');
  });

  it('gives the failure classifier the structured port only when it is registered', async () => {
    const child = platformChild();
    const complete = jest.fn(async () => ({
      failureClass: 'crash',
      confidence: 0.9,
    }));
    const completer: StructuredDecisionCompleter = {
      isReady: async () => true,
      complete,
    };
    child.registerInstance(LANE_ROUTING_TOKENS.STRUCTURED_DECISION, completer);
    registerLaneRoutingServices(child, testLogger());
    const config = child.resolve<DecisionModelConfig>(
      LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG,
    );
    await config.setSelection({
      kind: 'structured',
      providerId: 'anthropic',
      model: 'claude',
    });
    const classifier = child.resolve<DecisionModelFailureClassifier>(
      LANE_ROUTING_TOKENS.FAILURE_CLASSIFIER,
    );

    await expect(
      classifier.classify({
        runId: 'lane-1:10',
        executorKind: 'cli',
        family: 'openai',
        status: 'failed',
        verdict: 'failed',
        failureKind: null,
        exitCode: 1,
        durationMs: 10,
      }),
    ).resolves.toBe('crash');

    expect(complete).toHaveBeenCalledTimes(1);
  });
});
