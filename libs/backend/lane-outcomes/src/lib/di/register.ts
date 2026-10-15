import { instanceCachingFactory, type DependencyContainer } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  type IStateStorage,
} from '@ptah-extension/platform-core';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import type { LaneFailureClassifier } from '@ptah-extension/shared';
import { LaneOutcomeRecorder } from '../lane-outcome-recorder.service';
import { LaneOutcomeReader } from '../lane-outcome-reader.service';
import type { LaneOutcomeLogger } from '../lane-outcome-logger';
import type { SkillTelemetrySeam } from '../skill-telemetry-seam.port';
import { KeyValueLaneOutcomeStore } from '../store/key-value-lane-outcome.store';
import type { LaneOutcomeStore } from '../store/lane-outcome.store';
import { SqliteLaneOutcomeStore } from '../store/sqlite-lane-outcome.store';
import { OutcomeWritePipeline } from '../write/outcome-write-pipeline';
import { LANE_OUTCOME_TOKENS } from './tokens';

/** Pipeline token provided by this library's registration. */
export const LANE_OUTCOME_PIPELINE = Symbol.for('PtahLaneOutcomePipeline');

/** Registers the store, pipeline, recorder, reader, and logger for a host container. */
export function registerLaneOutcomeServices(
  container: DependencyContainer,
  logger: LaneOutcomeLogger,
): void {
  container.registerInstance(LANE_OUTCOME_TOKENS.LOGGER, logger);
  container.register<LaneOutcomeStore>(LANE_OUTCOME_TOKENS.STORE, {
    useFactory: instanceCachingFactory((c) =>
      c.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
        ? new SqliteLaneOutcomeStore(
            c.resolve<SqliteConnectionService>(
              PERSISTENCE_TOKENS.SQLITE_CONNECTION,
            ),
            logger,
          )
        : new KeyValueLaneOutcomeStore(
            c.resolve<IStateStorage>(PLATFORM_TOKENS.STATE_STORAGE),
            logger,
          ),
    ),
  });
  container.register<OutcomeWritePipeline>(LANE_OUTCOME_PIPELINE, {
    useFactory: instanceCachingFactory((c) => {
      const store = c.resolve<LaneOutcomeStore>(LANE_OUTCOME_TOKENS.STORE);
      const storage = c.isRegistered(PLATFORM_TOKENS.STATE_STORAGE)
        ? c.resolve<IStateStorage>(PLATFORM_TOKENS.STATE_STORAGE)
        : undefined;
      const connection = c.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
        ? c.resolve<SqliteConnectionService>(
            PERSISTENCE_TOKENS.SQLITE_CONNECTION,
          )
        : undefined;
      return new OutcomeWritePipeline(
        store,
        logger,
        storage,
        connection
          ? {
              isOpen: () => connection.isOpen,
              onDidOpen: (callback) => connection.onDidOpen(callback),
            }
          : undefined,
        (row) =>
          c
            .resolve<LaneOutcomeRecorder>(LANE_OUTCOME_TOKENS.RECORDER)
            .onLaneRecordInserted(row),
      );
    }),
  });
  container.register<LaneOutcomeRecorder>(LANE_OUTCOME_TOKENS.RECORDER, {
    useFactory: instanceCachingFactory(
      (c) =>
        new LaneOutcomeRecorder(
          c.resolve<OutcomeWritePipeline>(LANE_OUTCOME_PIPELINE),
          c.resolve<LaneOutcomeStore>(LANE_OUTCOME_TOKENS.STORE),
          logger,
          c.isRegistered(LANE_OUTCOME_TOKENS.FAILURE_CLASSIFIER)
            ? c.resolve<LaneFailureClassifier>(
                LANE_OUTCOME_TOKENS.FAILURE_CLASSIFIER,
              )
            : undefined,
        ),
    ),
  });
  container.register<LaneOutcomeReader>(LANE_OUTCOME_TOKENS.READER, {
    useFactory: instanceCachingFactory(
      (c) =>
        new LaneOutcomeReader(
          c.resolve<LaneOutcomeStore>(LANE_OUTCOME_TOKENS.STORE),
          logger,
          c.isRegistered(LANE_OUTCOME_TOKENS.SKILL_TELEMETRY_SEAM)
            ? c.resolve<SkillTelemetrySeam>(
                LANE_OUTCOME_TOKENS.SKILL_TELEMETRY_SEAM,
              )
            : undefined,
        ),
    ),
  });
}
