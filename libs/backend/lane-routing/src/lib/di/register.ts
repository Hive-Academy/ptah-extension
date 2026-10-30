/**
 * Lane-routing composition (part A §2, SC-9, D11).
 *
 * Hosts pass the logger they already own. `DecisionModelConfig` is a plain
 * class, so it is built here with `useFactory` (precedent
 * `auth-providers/src/lib/di/register.ts`). Optional ports are resolved
 * only when the host has registered them. `FAILURE_CLASSIFIER` is built
 * here and reads `STRUCTURED_DECISION` only when that token is registered.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import { instanceCachingFactory, type DependencyContainer } from 'tsyringe';

import {
  PLATFORM_TOKENS,
  type IFileSystemProvider,
  type ISecretStorage,
  type IStateStorage,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { LaneOutcomeReader } from '@ptah-extension/shared';

import { DecisionModelCatalog } from '../decision-model/decision-model.catalog';
import { DecisionModelConfig } from '../decision-model/decision-model.config';
import type { StructuredDecisionCompleter } from '../decision-model/structured-decision.port';
import { DecisionModelFailureClassifier } from '../failure-class/decision-model-failure-classifier';
import type { LaneModelListing } from '../lane-model-listing.port';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import { CapabilityMatrixStore } from '../matrix/capability-matrix.store';
import { RotationStore } from '../ranking/rotation.store';
import { RouteDecideService } from '../route-decide.service';
import { DecisionModelTaskKindClassifier } from '../task-kind/decision-model-task-kind-classifier';
import { LANE_ROUTING_TOKENS } from './tokens';

/**
 * `platform-core` joins `homedir()` with `.ptah` privately and exports no
 * helper (batch 16, PA-2). This factory uses the same path. The matrix
 * store does not expand `~`.
 */
function ptahHomeDir(): string {
  return join(homedir(), '.ptah');
}

function optional<T>(
  container: DependencyContainer,
  token: symbol,
): T | undefined {
  if (!container.isRegistered(token, true)) return undefined;
  return container.resolve<T>(token);
}

export function registerLaneRoutingServices(
  container: DependencyContainer,
  logger: LaneRoutingLogger,
): void {
  container.registerInstance(LANE_ROUTING_TOKENS.LOGGER, logger);

  container.register(LANE_ROUTING_TOKENS.ROTATION_STORE, {
    useFactory: instanceCachingFactory(
      (c) =>
        new RotationStore(
          c.resolve<IStateStorage>(PLATFORM_TOKENS.STATE_STORAGE),
          c.resolve<LaneRoutingLogger>(LANE_ROUTING_TOKENS.LOGGER),
        ),
    ),
  });

  container.register(LANE_ROUTING_TOKENS.CAPABILITY_MATRIX_STORE, {
    useFactory: instanceCachingFactory((c) => {
      const outcomeReader = optional<LaneOutcomeReader>(
        c,
        LANE_ROUTING_TOKENS.LANE_OUTCOME_READER,
      );
      return new CapabilityMatrixStore({
        fileSystem: c.resolve<IFileSystemProvider>(
          PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER,
        ),
        ptahHomeDir: ptahHomeDir(),
        ...(outcomeReader !== undefined ? { outcomeReader } : {}),
        logger: c.resolve<LaneRoutingLogger>(LANE_ROUTING_TOKENS.LOGGER),
      });
    }),
  });

  container.register(LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG, {
    useFactory: instanceCachingFactory((c) => {
      const structured = optional<StructuredDecisionCompleter>(
        c,
        LANE_ROUTING_TOKENS.STRUCTURED_DECISION,
      );
      return new DecisionModelConfig(
        c.resolve<IWorkspaceProvider>(PLATFORM_TOKENS.WORKSPACE_PROVIDER),
        c.resolve<ISecretStorage>(PLATFORM_TOKENS.SECRET_STORAGE),
        c.resolve<IStateStorage>(PLATFORM_TOKENS.STATE_STORAGE),
        c.resolve<LaneRoutingLogger>(LANE_ROUTING_TOKENS.LOGGER),
        structured,
      );
    }),
  });

  // The catalog reads the base URL on each `list` call; building it makes no
  // network request.
  container.register(LANE_ROUTING_TOKENS.DECISION_MODEL_CATALOG, {
    useFactory: instanceCachingFactory(
      (c) =>
        new DecisionModelCatalog(
          c.resolve<DecisionModelConfig>(
            LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG,
          ),
          c.resolve<LaneRoutingLogger>(LANE_ROUTING_TOKENS.LOGGER),
        ),
    ),
  });

  container.register(LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE, {
    useFactory: instanceCachingFactory((c) => {
      const listing = optional<LaneModelListing>(
        c,
        LANE_ROUTING_TOKENS.LANE_MODEL_LISTING,
      );
      const structured = optional<StructuredDecisionCompleter>(
        c,
        LANE_ROUTING_TOKENS.STRUCTURED_DECISION,
      );
      return new RouteDecideService({
        config: c.resolve<DecisionModelConfig>(
          LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG,
        ),
        matrix: c.resolve<CapabilityMatrixStore>(
          LANE_ROUTING_TOKENS.CAPABILITY_MATRIX_STORE,
        ),
        rotation: c.resolve<RotationStore>(LANE_ROUTING_TOKENS.ROTATION_STORE),
        logger: c.resolve<LaneRoutingLogger>(LANE_ROUTING_TOKENS.LOGGER),
        ...(listing !== undefined ? { listing } : {}),
        ...(structured !== undefined ? { structured } : {}),
      });
    }),
  });

  container.register(LANE_ROUTING_TOKENS.FAILURE_CLASSIFIER, {
    useFactory: instanceCachingFactory((c) => {
      const structured = optional<StructuredDecisionCompleter>(
        c,
        LANE_ROUTING_TOKENS.STRUCTURED_DECISION,
      );
      return new DecisionModelFailureClassifier({
        config: c.resolve<DecisionModelConfig>(
          LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG,
        ),
        logger: c.resolve<LaneRoutingLogger>(LANE_ROUTING_TOKENS.LOGGER),
        ...(structured !== undefined ? { structured } : {}),
      });
    }),
  });

  container.register(LANE_ROUTING_TOKENS.TASK_KIND_CLASSIFIER, {
    useFactory: instanceCachingFactory((c) => {
      const structured = optional<StructuredDecisionCompleter>(
        c,
        LANE_ROUTING_TOKENS.STRUCTURED_DECISION,
      );
      return new DecisionModelTaskKindClassifier({
        config: c.resolve<DecisionModelConfig>(
          LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG,
        ),
        logger: c.resolve<LaneRoutingLogger>(LANE_ROUTING_TOKENS.LOGGER),
        ...(structured !== undefined ? { structured } : {}),
      });
    }),
  });
}
