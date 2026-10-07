/**
 * The product side of the retention suites (`retention.suite.ts`): the
 * {@link RetentionPort} over the booted bench host container.
 *
 * - Retention: a suite-local `MemoryRetentionService`, constructed
 *   positionally from the host's own singletons (stores, page reclaimer,
 *   lifecycle service, limits, settings) with NO background-work governor —
 *   the parameter is optional in the product (`memory-retention.service.ts`
 *   constructor) and a governor would defer batches on real time, which the
 *   simulated clock cannot reproduce. It is constructed when the port is
 *   built, before the suite installs its simulated clock, so the product's
 *   boot-deferral gate measures from real time.
 * - Curation: the liveness harness's suite-local `MemoryTriggerService` +
 *   `MemoryCuratorService` (`hostLivenessParts`), whose scripted curator
 *   returns the replay double's own `'stalled'` outcome for a marked session.
 *   No model is called.
 * - Reads: `MemoryStore`, `ObservationQueueStore`, read-only SQL on the bench
 *   DB (`memories`, `observation_queue`), `SqlitePageReclaimer.readPageStats`
 *   and `MemoryPromptInjector.buildSessionStartBlock`.
 *
 * Host-only: value-imports the memory-curator barrel
 * (`../../host-only-imports.spec.ts`).
 */

import {
  MEMORY_TOKENS,
  MemoryRetentionService,
  readMemoryLifecycleSettings,
  type MemoryLifecycleService,
  type MemoryRetentionLimits,
  type MemoryStore,
  type ObservationQueueStore,
} from '@ptah-extension/memory-curator';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
  type SqlitePageReclaimer,
} from '@ptah-extension/persistence-sqlite';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { z } from 'zod';

import type { BenchHostContainer } from '../../../transport/bench-host-boot';
import type { MemorySkillsHostSuiteContext } from '../../host/memory-skills-host';
import { hostLivenessParts, invokeObservationPass } from './liveness-harness';
import type {
  RetentionPort,
  RetentionRunSummary,
  StoredMemoryState,
} from './retention-support';

type RetentionArgs = ConstructorParameters<typeof MemoryRetentionService>;

/** `TOKENS.LOGGER` of vscode-core (`vscode-core/src/di/tokens.ts:34`), interned. */
const LOGGER_TOKEN = Symbol.for('Logger');
/** `SdkMemoryPromptInjector` (`agent-sdk/src/lib/di/tokens.ts:118`), interned. */
const PROMPT_INJECTOR_TOKEN = Symbol.for('SdkMemoryPromptInjector');

interface PromptInjectorSlice {
  buildSessionStartBlock(workspaceRoot?: string): Promise<string>;
}

const memoryStatesSchema = z.array(
  z.strictObject({
    id: z.string().min(1),
    tier: z.enum(['core', 'recall', 'archival']),
  }),
);
const countSchema = z.strictObject({ n: z.number().int().nonnegative() });

function resolveRequired<T>(container: BenchHostContainer, token: symbol): T {
  if (!container.isRegistered(token, true)) {
    throw new Error(
      `the bench host container has no ${token.description ?? String(token)}`,
    );
  }
  return container.resolve<T>(token);
}

function tokenCountOf(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** The real port over the bench host. Build it before the simulated clock. */
export function hostRetentionPort(
  context: MemorySkillsHostSuiteContext,
): RetentionPort {
  const container = context.container;
  const store = resolveRequired<MemoryStore>(
    container,
    MEMORY_TOKENS.MEMORY_STORE,
  );
  const observations = resolveRequired<ObservationQueueStore>(
    container,
    MEMORY_TOKENS.OBSERVATION_QUEUE_STORE,
  );
  const sqlite = resolveRequired<SqliteConnectionService>(
    container,
    PERSISTENCE_TOKENS.SQLITE_CONNECTION,
  );
  const reclaimer = resolveRequired<SqlitePageReclaimer>(
    container,
    PERSISTENCE_TOKENS.SQLITE_PAGE_RECLAIMER,
  );
  const workspace = resolveRequired<IWorkspaceProvider>(
    container,
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
  );
  const limits = resolveRequired<MemoryRetentionLimits>(
    container,
    MEMORY_TOKENS.MEMORY_RETENTION_LIMITS,
  );
  const injector = resolveRequired<PromptInjectorSlice>(
    container,
    PROMPT_INJECTOR_TOKEN,
  );
  const retention = new MemoryRetentionService(
    resolveRequired<RetentionArgs[0]>(container, LOGGER_TOKEN),
    workspace,
    sqlite,
    reclaimer,
    resolveRequired<RetentionArgs[4]>(
      container,
      MEMORY_TOKENS.OBSERVATION_RETENTION_STORE,
    ),
    limits,
    resolveRequired<MemoryLifecycleService>(
      container,
      MEMORY_TOKENS.MEMORY_LIFECYCLE_SERVICE,
    ),
    null,
  );
  const parts = hostLivenessParts(context);

  return {
    lifecycleSettings: () => {
      const settings = readMemoryLifecycleSettings(workspace);
      return {
        archiveAfterDays: settings.archiveAfterDays,
        deleteAfterDays: settings.deleteAfterDays,
        maxPerWorkspace: settings.maxPerWorkspace,
        capEvictionGraceMs: limits.capEvictionGraceMs,
      };
    },
    insertMemory: (insert) =>
      store.insertMemoryWithChunks(
        {
          workspaceRoot: insert.workspaceRoot,
          tier: 'recall',
          kind: insert.kind,
          subject: insert.subject,
          content: insert.content,
          salience: insert.salience,
        },
        [
          {
            ord: 0,
            text: insert.content,
            tokenCount: tokenCountOf(insert.content),
          },
        ],
      ),
    recordUse: (memoryIds) => store.recordUse(memoryIds),
    memoryStates: (workspaceRoot): StoredMemoryState[] =>
      memoryStatesSchema
        .parse(
          sqlite.db
            .prepare(
              'SELECT id, tier FROM memories WHERE workspace_root IS ? AND quarantined_at IS NULL',
            )
            .all(workspaceRoot),
        )
        .map((row) => ({ memoryId: row.id, tier: row.tier })),
    runRetention: async (nowMs): Promise<RetentionRunSummary> => {
      const report = await retention.run({
        signal: new AbortController().signal,
        isOnBattery: () => false,
        msSinceForegroundActivity: () => Number.POSITIVE_INFINITY,
        now: () => nowMs,
      });
      if (report.status === 'skipped') {
        return {
          status: 'skipped',
          reason: report.reason,
          archived: 0,
          deleted: 0,
          evicted: 0,
          stuckQuarantined: 0,
          processedPurged: 0,
          lifecycleNote: null,
        };
      }
      return {
        status: report.status,
        reason: report.reason,
        archived: report.memoriesArchived,
        deleted: report.memoriesDeleted,
        evicted: report.memoriesEvicted,
        stuckQuarantined: report.stuckQuarantined,
        processedPurged: report.processedPurged,
        lifecycleNote: report.lifecycleNote,
      };
    },
    dbBytes: () => {
      const stats = reclaimer.readPageStats();
      return stats.pageCount * stats.pageSize;
    },
    observationWorkspaceRoot: parts.workspaceRoot,
    enqueueObservations: (sessionId, rows) => {
      for (const row of rows) {
        observations.enqueue(
          row.kind === 'user-prompt'
            ? {
                sessionId,
                workspaceRoot: parts.workspaceRoot,
                kind: 'user-prompt',
                userPrompt: row.text,
              }
            : {
                sessionId,
                workspaceRoot: parts.workspaceRoot,
                kind: 'tool-use',
                toolName: 'Read',
                toolResponseText: row.text,
              },
        );
      }
      observations.flush();
    },
    curate: async (sessionId, marker, stalled) => {
      if (stalled) parts.model.setFault(marker, 'stalled');
      try {
        return (await invokeObservationPass(parts, sessionId)).outcome;
      } finally {
        parts.model.clearFaults();
      }
    },
    unprocessed: (sessionId) => observations.countUnprocessed(sessionId),
    observationRows: (sessionId) =>
      countSchema.parse(
        sqlite.db
          .prepare(
            'SELECT COUNT(*) AS n FROM observation_queue WHERE session_id = ?',
          )
          .get(sessionId),
      ).n,
    buildSessionStartBlock: (workspaceRoot) =>
      injector.buildSessionStartBlock(workspaceRoot),
  };
}
