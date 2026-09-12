/**
 * session-history-reader.service — unit specs.
 *
 * Covers `SessionHistoryReaderService`, the public facade over the
 * JSONL reader + replay pipeline. The interesting behaviour here is NOT
 * the replay itself (exhaustively covered by `session-replay.service.spec.ts`
 * and `jsonl-reader.service.spec.ts`), but the facade's contract:
 *
 *   - `sessionId` must match `/^[a-zA-Z0-9_-]+$/` — anything else (including
 *     path-traversal attempts like "../../etc/passwd") returns an empty
 *     payload rather than touching the filesystem.
 *   - Missing sessions directory → empty events, null stats, warn log.
 *   - Missing session file → empty events, null stats, warn log.
 *   - Happy path → delegates to the injected children and returns the replay
 *     service's event stream alongside aggregated stats.
 *   - Aggregation honours the `compact_boundary` — usage in pre-compact
 *     messages is NOT counted in `tokens.input/output`.
 *   - `readHistoryAsMessages` returns only user/assistant messages, skips
 *     task-notification content, and starts after the last compact_boundary.
 *
 * Every collaborator is a typed stub — no real fs access, no live replay.
 */

import 'reflect-metadata';
import { Readable } from 'node:stream';

jest.mock('fs/promises', () => ({ stat: jest.fn() }));
jest.mock('node:fs', () => ({ createReadStream: jest.fn() }));

import * as fs from 'fs/promises';
import { createReadStream } from 'node:fs';
import { SessionHistoryReaderService } from './session-history-reader.service';
import { JsonlReaderService } from './helpers/history/jsonl-reader.service';
import type { SessionReplayService } from './helpers/history/session-replay.service';
import { HistoryEventFactory } from './helpers/history/history-event-factory';
import type { SessionHistoryMessage } from './helpers/history/history.types';
import { LiveUsageTracker } from './helpers/live-usage-tracker';
import { CompactionBoundaryGenerationRegistry } from './helpers/compaction-boundary-generation-registry';
import type { IModelResolver } from './auth-env.port';
import type { IPricingProvider } from './pricing.port';
import type { AuthEnv, ModelPricing } from '@ptah-extension/shared';
import {
  findModelPricing,
  registerModelContextWindows,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

const mockedStat = fs.stat as jest.MockedFunction<typeof fs.stat>;
const mockedCreateReadStream = createReadStream as jest.MockedFunction<
  typeof createReadStream
>;

function transcriptStats(
  size: number,
  mtimeMs: number,
): Awaited<ReturnType<typeof fs.stat>> {
  return { size, mtimeMs } as Awaited<ReturnType<typeof fs.stat>>;
}

function transcriptStream(
  content: string,
): ReturnType<typeof createReadStream> {
  return Readable.from([Buffer.from(content, 'utf8')]) as ReturnType<
    typeof createReadStream
  >;
}

/**
 * Build a typed stub for each collaborator so tests never reach `as any`.
 * `jest.Mocked<T>` handles the method surfaces.
 */
interface Stubs {
  jsonlReader: jest.Mocked<
    Pick<
      JsonlReaderService,
      'findSessionsDirectory' | 'readJsonlMessages' | 'loadAgentSessions'
    >
  >;
  replayService: jest.Mocked<
    Pick<SessionReplayService, 'replayToStreamEvents'>
  >;
  modelResolver: jest.Mocked<
    Pick<
      IModelResolver,
      'resolveForPricing' | 'resolveForCost' | 'isSubscriptionCovered'
    >
  >;
  pricingProvider: jest.Mocked<IPricingProvider>;
  authEnv: AuthEnv;
  logger: MockLogger;
  /** Real, not stubbed — the seed and the read are the behaviour under test. */
  usageTracker: LiveUsageTracker;
  /** Real singleton; compaction-read behaviour is tested through it. */
  compactionBoundaryRegistry: CompactionBoundaryGenerationRegistry;
}

function makeStubs(): Stubs {
  return {
    jsonlReader: {
      findSessionsDirectory: jest.fn(),
      readJsonlMessages: jest.fn(),
      loadAgentSessions: jest.fn(),
    },
    replayService: {
      replayToStreamEvents: jest.fn().mockReturnValue([]),
    },
    modelResolver: {
      resolveForPricing: jest.fn((m: string) => m || 'unknown'),
      isSubscriptionCovered: jest.fn(() => false),
      resolveForCost: jest.fn((m: string) => ({
        modelId: m || 'unknown',
        pricing: findModelPricing(m || 'unknown'),
        subscriptionCovered: false,
      })),
    },
    pricingProvider: {
      getPricing: jest.fn().mockResolvedValue(null),
      ensureHydrated: jest.fn().mockResolvedValue(true),
    },
    authEnv: {} as AuthEnv,
    logger: createMockLogger(),
    usageTracker: new LiveUsageTracker(),
    compactionBoundaryRegistry: new CompactionBoundaryGenerationRegistry(),
  };
}

function makeService(stubs: Stubs): SessionHistoryReaderService {
  const factory = new HistoryEventFactory(); // real — no deps
  return new SessionHistoryReaderService(
    asLogger(stubs.logger),
    stubs.jsonlReader as unknown as JsonlReaderService,
    stubs.replayService as unknown as SessionReplayService,
    factory,
    stubs.modelResolver as unknown as IModelResolver,
    stubs.authEnv,
    stubs.pricingProvider,
    stubs.usageTracker,
    stubs.compactionBoundaryRegistry,
  );
}

describe('SessionHistoryReaderService', () => {
  describe('readSessionHistory', () => {
    // -----------------------------------------------------------------------
    // Path-traversal guard
    // -----------------------------------------------------------------------

    it('rejects invalid sessionIds without touching the filesystem', async () => {
      const stubs = makeStubs();
      const service = makeService(stubs);

      const result = await service.readSessionHistory(
        '../../etc/passwd',
        '/workspace',
      );

      expect(result).toEqual({ events: [], messages: [], stats: null });
      // Traversal rejected pre-filesystem — reader must never be called.
      expect(stubs.jsonlReader.findSessionsDirectory).not.toHaveBeenCalled();
      // The facade catches the SdkError internally and logs via `error`.
      expect(stubs.logger.error).toHaveBeenCalled();
    });

    it('rejects an empty sessionId', async () => {
      const stubs = makeStubs();
      const service = makeService(stubs);
      const result = await service.readSessionHistory('', '/workspace');
      expect(result).toEqual({ events: [], messages: [], stats: null });
    });

    // -----------------------------------------------------------------------
    // Missing sessions directory
    // -----------------------------------------------------------------------

    it('returns empty events + null stats when sessions directory is missing', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(null);

      const service = makeService(stubs);
      const result = await service.readSessionHistory(
        'valid-session-id',
        '/workspace',
      );

      expect(result).toEqual({ events: [], messages: [], stats: null });
      expect(stubs.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Sessions directory not found'),
      );
    });

    // A VERIFIED expectation survives a stale read for a bounded recovery
    // budget — the next reload of the same transcript must still be checked
    // against it (PR #493 review C). An UNVERIFIED one can never be satisfied,
    // so a stale read gives up on it immediately.
    it.each([
      ['verified', true, { kind: 'verified', expectedCount: 2 }],
      ['unverified', false, undefined],
    ])(
      'consumes a %s pending compaction expectation and returns stale when sessions directory is missing',
      async (_kind, hasBaseline, expectedAfterRead) => {
        const stubs = makeStubs();
        if (hasBaseline) {
          stubs.compactionBoundaryRegistry.observeBoundaryCount('valid-session-id', 1);
        }
        stubs.compactionBoundaryRegistry.recordExpectedBoundary('valid-session-id');
        stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(null);

        const service = makeService(stubs);
        const result = await service.readSessionHistory(
          'valid-session-id',
          '/workspace',
          { checkCompactionBoundary: true },
        );

        expect(result).toEqual({
          events: [],
          messages: [],
          stats: null,
          staleSnapshot: true,
        });
        expect(
          stubs.compactionBoundaryRegistry.capturePendingExpectation(
            'valid-session-id',
          ),
        ).toEqual(expectedAfterRead);
      },
    );

    it('leaves staleSnapshot absent when a compaction check has no expectation and sessions directory is missing', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(null);

      const service = makeService(stubs);
      const result = await service.readSessionHistory(
        'valid-session-id',
        '/workspace',
        { checkCompactionBoundary: true },
      );

      expect(result).toEqual({ events: [], messages: [], stats: null });
    });

    // -----------------------------------------------------------------------
    // Missing session file
    // -----------------------------------------------------------------------

    it('returns empty events + null stats when the session file is missing', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/sessions/dir',
      );
      stubs.jsonlReader.readJsonlMessages.mockRejectedValue(
        new Error('ENOENT: session file missing'),
      );

      const service = makeService(stubs);
      const result = await service.readSessionHistory(
        'valid-session',
        '/workspace',
      );

      expect(result).toEqual({ events: [], messages: [], stats: null });
      expect(stubs.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Session file not found'),
        expect.objectContaining({ sessionId: 'valid-session' }),
      );
      // Replay should not run if the file never loaded.
      expect(stubs.replayService.replayToStreamEvents).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Happy path — delegation + stats aggregation
    // -----------------------------------------------------------------------

    it('delegates to the replay service and aggregates usage stats', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/sessions/dir',
      );

      const mainMessages: SessionHistoryMessage[] = [
        {
          type: 'system',
          subtype: 'init',
          model: 'claude-sonnet-4-20250514',
          uuid: 'init',
        } as SessionHistoryMessage,
        {
          type: 'assistant',
          uuid: 'a1',
          message: {
            role: 'assistant',
            model: 'claude-sonnet-4-20250514',
            content: [{ type: 'text', text: 'reply' }],
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        } as SessionHistoryMessage,
      ];
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue(mainMessages);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);
      stubs.replayService.replayToStreamEvents.mockReturnValue([]);

      const service = makeService(stubs);
      const { events, stats } = await service.readSessionHistory(
        'valid-session',
        '/workspace',
      );

      expect(events).toEqual([]);
      expect(stats).not.toBeNull();
      expect(stats?.tokens.input).toBe(100);
      expect(stats?.tokens.output).toBe(50);
      expect(stats?.messageCount).toBe(1);
      expect(stats?.model).toBe('claude-sonnet-4-20250514');
      // Per-model breakdown always includes at least one entry when usage
      // was recorded.
      expect(stats?.modelUsageList?.length).toBeGreaterThanOrEqual(1);
      expect(stubs.replayService.replayToStreamEvents).toHaveBeenCalledWith(
        'valid-session',
        mainMessages,
        [],
      );
    });

    it('aggregates only post-compact_boundary usage (pre-compact tokens are dropped)', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/sessions/dir',
      );

      const messages: SessionHistoryMessage[] = [
        {
          type: 'system',
          subtype: 'init',
          model: 'claude-sonnet-4-20250514',
          uuid: 'init',
        } as SessionHistoryMessage,
        // Pre-compact usage — MUST be excluded from aggregation.
        {
          type: 'assistant',
          uuid: 'old',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'old' }],
            usage: {
              input_tokens: 9999,
              output_tokens: 9999,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
          usage: {
            input_tokens: 9999,
            output_tokens: 9999,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        } as SessionHistoryMessage,
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'boundary',
        } as SessionHistoryMessage,
        // Post-compact usage — counted.
        {
          type: 'assistant',
          uuid: 'new',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'new' }],
            usage: {
              input_tokens: 10,
              output_tokens: 20,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        } as SessionHistoryMessage,
      ];
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue(messages);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);
      stubs.replayService.replayToStreamEvents.mockReturnValue([]);

      const service = makeService(stubs);
      const { stats } = await service.readSessionHistory('valid', '/workspace');

      expect(stats).not.toBeNull();
      expect(stats?.tokens.input).toBe(10); // pre-compact 9999 dropped
      expect(stats?.tokens.output).toBe(20);
      // Model was detected from the pre-compact init (metadata, not usage).
      expect(stats?.model).toBe('claude-sonnet-4-20250514');
    });

    it('contextSnapshot and modelUsageList carry contextWindow for a registered unpriced model', async () => {
      const model = 'gpt-ctx-reader-registered-414';
      registerModelContextWindows([{ id: model, contextLength: 400_000 }]);
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/sessions/dir',
      );
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        { type: 'system', subtype: 'init', model, uuid: 'init' },
        {
          type: 'assistant',
          uuid: 'a1',
          message: {
            role: 'assistant',
            model,
            content: [{ type: 'text', text: 'reply' }],
          },
          usage: {
            input_tokens: 30_000,
            output_tokens: 500,
            cache_read_input_tokens: 10_000,
            cache_creation_input_tokens: 0,
          },
        },
      ] as SessionHistoryMessage[]);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);

      const service = makeService(stubs);
      const { stats } = await service.readSessionHistory(
        'valid-session',
        '/workspace',
      );

      expect(stats?.contextSnapshot).toEqual({
        model,
        contextTokens: 40_000,
        contextWindow: 400_000,
      });
      expect(stats?.modelUsageList?.[0]).toMatchObject({
        model,
        contextWindow: 400_000,
      });
    });

    it('omits contextWindow when the window is unknown', async () => {
      const model = 'mystery-ctx-reader-unknown-414';
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/sessions/dir',
      );
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        { type: 'system', subtype: 'init', model, uuid: 'init' },
        {
          type: 'assistant',
          uuid: 'a1',
          message: {
            role: 'assistant',
            model,
            content: [{ type: 'text', text: 'reply' }],
          },
          usage: {
            input_tokens: 100,
            output_tokens: 10,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      ] as SessionHistoryMessage[]);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);

      const service = makeService(stubs);
      const { stats } = await service.readSessionHistory(
        'valid-session',
        '/workspace',
      );

      expect(stats?.contextSnapshot).toEqual({ model, contextTokens: 100 });
      expect(stats?.modelUsageList?.[0]).not.toHaveProperty('contextWindow');
    });

    it('uses the globally latest main-session model for the context snapshot regardless of aggregate cost', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/sessions/dir',
      );
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        {
          type: 'system',
          subtype: 'init',
          model: 'gpt-4o',
          uuid: 'init',
        } as SessionHistoryMessage,
        {
          type: 'assistant',
          uuid: 'a1',
          message: {
            role: 'assistant',
            model: 'gpt-4o',
            content: [{ type: 'text', text: 'first' }],
          },
          usage: {
            input_tokens: 100_000,
            output_tokens: 50_000,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        } as SessionHistoryMessage,
        {
          type: 'assistant',
          uuid: 'a2',
          message: {
            role: 'assistant',
            model: 'gpt-4o-mini',
            content: [{ type: 'text', text: 'second' }],
          },
          usage: {
            input_tokens: 200,
            output_tokens: 400,
            cache_read_input_tokens: 10_000,
            cache_creation_input_tokens: 800,
          },
        } as SessionHistoryMessage,
      ]);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);

      const service = makeService(stubs);
      const { stats } = await service.readSessionHistory(
        'valid-session',
        '/workspace',
      );

      expect(stats?.tokens).toEqual({
        input: 100_200,
        output: 50_400,
        cacheRead: 10_000,
        cacheCreation: 800,
      });
      expect(stats?.modelUsageList?.[0]).toMatchObject({
        model: 'gpt-4o',
        inputTokens: 100_000,
        outputTokens: 50_000,
      });
      expect(stats).toMatchObject({
        contextSnapshot: {
          model: 'gpt-4o-mini',
          contextTokens: 11_000,
        },
      });
    });

    it('never lets agent usage select or overwrite the main-session context snapshot', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/sessions/dir',
      );
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        {
          type: 'system',
          subtype: 'init',
          model: 'gpt-4o-mini',
          uuid: 'init',
        } as SessionHistoryMessage,
        {
          type: 'assistant',
          uuid: 'root-turn',
          message: {
            role: 'assistant',
            model: 'gpt-4o-mini',
            content: [{ type: 'text', text: 'root reply' }],
          },
          usage: {
            input_tokens: 250,
            output_tokens: 100,
            cache_read_input_tokens: 500,
            cache_creation_input_tokens: 50,
          },
        } as SessionHistoryMessage,
      ]);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([
        {
          agentId: 'agent-a',
          filePath: '/sessions/dir/agent-a.jsonl',
          messages: [
            {
              type: 'assistant',
              uuid: 'agent-turn',
              message: {
                role: 'assistant',
                model: 'gpt-4o',
                content: [{ type: 'text', text: 'expensive agent reply' }],
              },
              usage: {
                input_tokens: 200_000,
                output_tokens: 100_000,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
              },
            } as SessionHistoryMessage,
          ],
        },
      ]);

      const service = makeService(stubs);
      const { stats } = await service.readSessionHistory(
        'valid-session',
        '/workspace',
      );

      expect(stats?.modelUsageList?.[0]).toMatchObject({
        model: 'gpt-4o',
        inputTokens: 200_000,
        outputTokens: 100_000,
      });
      expect(stats).toMatchObject({
        contextSnapshot: {
          model: 'gpt-4o-mini',
          contextTokens: 800,
        },
      });
    });

    it('uses the live input plus cache formula for the latest post-compaction context snapshot', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/sessions/dir',
      );
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        {
          type: 'system',
          subtype: 'init',
          model: 'claude-sonnet-4-20250514',
          uuid: 'init',
        } as SessionHistoryMessage,
        {
          type: 'assistant',
          uuid: 'pre-compact',
          message: {
            role: 'assistant',
            model: 'claude-sonnet-4-20250514',
            content: [{ type: 'text', text: 'old context' }],
          },
          usage: {
            input_tokens: 1_000,
            output_tokens: 500,
            cache_read_input_tokens: 800_000,
            cache_creation_input_tokens: 0,
          },
        } as SessionHistoryMessage,
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'boundary',
        } as SessionHistoryMessage,
        {
          type: 'assistant',
          uuid: 'post-compact-1',
          message: {
            role: 'assistant',
            model: 'claude-sonnet-4-20250514',
            content: [{ type: 'text', text: 'new context' }],
          },
          usage: {
            input_tokens: 60,
            output_tokens: 400,
            cache_read_input_tokens: 120_000,
            cache_creation_input_tokens: 2_000,
          },
        } as SessionHistoryMessage,
        {
          type: 'assistant',
          uuid: 'post-compact-2',
          message: {
            role: 'assistant',
            model: 'claude-sonnet-4-20250514',
            content: [{ type: 'text', text: 'latest context' }],
          },
          usage: {
            input_tokens: 16,
            output_tokens: 200,
            cache_read_input_tokens: 10_000,
            cache_creation_input_tokens: 800,
          },
        } as SessionHistoryMessage,
      ]);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);

      const service = makeService(stubs);
      const { stats } = await service.readSessionHistory(
        'valid-session',
        '/workspace',
      );

      expect(stats?.tokens).toEqual({
        input: 76,
        output: 600,
        cacheRead: 130_000,
        cacheCreation: 2_800,
      });
      expect(stats?.modelUsageList?.[0]).toMatchObject({
        model: 'claude-sonnet-4-20250514',
        inputTokens: 76,
        outputTokens: 600,
      });
      expect(stats).toMatchObject({
        contextSnapshot: {
          model: 'claude-sonnet-4-20250514',
          contextTokens: 10_816,
        },
      });
    });

    it('returns null stats when no message carries usage data', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/sessions/dir',
      );
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        {
          type: 'user',
          uuid: 'u1',
          message: { role: 'user', content: 'hi' },
        } as SessionHistoryMessage,
      ]);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);

      const service = makeService(stubs);
      const { stats } = await service.readSessionHistory('valid', '/workspace');
      expect(stats).toBeNull();
    });

    it('ordinary read records observed boundary count and has no staleSnapshot', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue('/sessions/dir');
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b1',
        } as SessionHistoryMessage,
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b2',
        } as SessionHistoryMessage,
      ]);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);
      stubs.replayService.replayToStreamEvents.mockReturnValue([]);

      const service = makeService(stubs);
      const result = await service.readSessionHistory('valid', '/workspace');

      expect(result.staleSnapshot).toBeUndefined();
      expect(stubs.compactionBoundaryRegistry.inspect('valid')).toEqual({
        baselineObserved: true,
        observedCount: 2,
        pendingExpectation: null,
      });
    });

    it('compaction-read without a pending expectation leaves staleSnapshot absent', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue('/sessions/dir');
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b1',
        } as SessionHistoryMessage,
      ]);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);
      stubs.replayService.replayToStreamEvents.mockReturnValue([]);

      const service = makeService(stubs);
      const result = await service.readSessionHistory('valid', '/workspace', {
        checkCompactionBoundary: true,
      });

      expect(result.staleSnapshot).toBeUndefined();
      expect(stubs.jsonlReader.readJsonlMessages).toHaveBeenCalledTimes(1);
    });

    it('compaction-read meets the expected count and clears staleSnapshot', async () => {
      const stubs = makeStubs();
      stubs.compactionBoundaryRegistry.observeBoundaryCount('valid', 1);
      stubs.compactionBoundaryRegistry.recordExpectedBoundary('valid');
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue('/sessions/dir');
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b1',
        } as SessionHistoryMessage,
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b2',
        } as SessionHistoryMessage,
      ]);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);
      stubs.replayService.replayToStreamEvents.mockReturnValue([]);

      const service = makeService(stubs);
      const result = await service.readSessionHistory('valid', '/workspace', {
        checkCompactionBoundary: true,
      });

      expect(result.staleSnapshot).toBeUndefined();
      expect(
        stubs.compactionBoundaryRegistry.capturePendingExpectation('valid'),
      ).toBeUndefined();
    });

    it('two distinct recorded boundaries: a transcript with only one new boundary stays stale', async () => {
      // PR #493 review B: both boundaries used to write expectedCount =
      // observedCount + 1, so a transcript holding just the first new
      // boundary wrongly verified the second expectation.
      const stubs = makeStubs();
      stubs.compactionBoundaryRegistry.observeBoundaryCount('valid', 1);
      stubs.compactionBoundaryRegistry.recordExpectedBoundary(
        'valid',
        'b-new-1',
      );
      stubs.compactionBoundaryRegistry.recordExpectedBoundary(
        'valid',
        'b-new-2',
      );
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue('/sessions/dir');
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b1',
        } as SessionHistoryMessage,
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b2',
        } as SessionHistoryMessage,
      ]);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);
      stubs.replayService.replayToStreamEvents.mockReturnValue([]);

      const service = makeService(stubs);
      const result = await service.readSessionHistory('valid', '/workspace', {
        checkCompactionBoundary: true,
      });

      // Expected 3, observed 2 — the transcript holds only one of the two
      // promised new boundaries, so the snapshot must read as stale.
      expect(result.staleSnapshot).toBe(true);
      // The expectation is RETAINED across the stale read (PR #493 review C):
      // clearing it here made the next read of the same incomplete transcript
      // return an incomplete snapshot with no `staleSnapshot` flag.
      expect(
        stubs.compactionBoundaryRegistry.capturePendingExpectation('valid'),
      ).toEqual({ kind: 'verified', expectedCount: 3 });
    });

    it('a second read of the still-incomplete transcript is still reported stale', async () => {
      // PR #493 review C: the reload that follows a stale snapshot must not
      // silently become a clean read just because the first one consumed the
      // expectation.
      const stubs = makeStubs();
      stubs.compactionBoundaryRegistry.observeBoundaryCount('valid', 1);
      stubs.compactionBoundaryRegistry.recordExpectedBoundary('valid', 'b-new');
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue('/sessions/dir');
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b1',
        } as SessionHistoryMessage,
      ]);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);
      stubs.replayService.replayToStreamEvents.mockReturnValue([]);

      const service = makeService(stubs);
      const first = await service.readSessionHistory('valid', '/workspace', {
        checkCompactionBoundary: true,
      });
      const second = await service.readSessionHistory('valid', '/workspace', {
        checkCompactionBoundary: true,
      });

      expect(first.staleSnapshot).toBe(true);
      expect(second.staleSnapshot).toBe(true);
    });

    it('Post-only reload: PreCompact expectation with the boundary not yet on disk returns staleSnapshot true and keeps it for the retry', async () => {
      const stubs = makeStubs();
      stubs.compactionBoundaryRegistry.observeBoundaryCount('valid', 1);
      stubs.compactionBoundaryRegistry.recordPreCompact('valid');
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue('/sessions/dir');
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b1',
        } as SessionHistoryMessage,
      ]);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);
      stubs.replayService.replayToStreamEvents.mockReturnValue([]);

      const service = makeService(stubs);
      const result = await service.readSessionHistory('valid', '/workspace', {
        checkCompactionBoundary: true,
      });

      expect(result.staleSnapshot).toBe(true);
      // Still verified for the renderer's single retry.
      expect(
        stubs.compactionBoundaryRegistry.capturePendingExpectation('valid'),
      ).toEqual({ kind: 'verified', expectedCount: 2 });
    });

    it('Post-only reload: the boundary persisted on a yield returns a verified snapshot, and the late live boundary adds nothing', async () => {
      const stubs = makeStubs();
      stubs.compactionBoundaryRegistry.observeBoundaryCount('valid', 1);
      stubs.compactionBoundaryRegistry.recordPreCompact('valid');
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue('/sessions/dir');
      const before = [
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b1',
        } as SessionHistoryMessage,
      ];
      const after = [
        before[0],
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b2',
        } as SessionHistoryMessage,
      ];
      stubs.jsonlReader.readJsonlMessages
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(after);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);
      stubs.replayService.replayToStreamEvents.mockReturnValue([]);

      const service = makeService(stubs);
      const result = await service.readSessionHistory('valid', '/workspace', {
        checkCompactionBoundary: true,
      });

      expect(result.staleSnapshot).toBeUndefined();
      expect(
        stubs.compactionBoundaryRegistry.capturePendingExpectation('valid'),
      ).toBeUndefined();
      stubs.compactionBoundaryRegistry.recordExpectedBoundary('valid', 'b2');
      expect(
        stubs.compactionBoundaryRegistry.capturePendingExpectation('valid'),
      ).toBeUndefined();
    });

    it('consumes with outcome satisfied / stale / none per path', async () => {
      const boundaryOnly = [
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b1',
        } as SessionHistoryMessage,
      ];

      // stale: sessions directory missing with an expectation pending
      const staleStubs = makeStubs();
      staleStubs.compactionBoundaryRegistry.observeBoundaryCount('valid', 0);
      staleStubs.compactionBoundaryRegistry.recordExpectedBoundary('valid');
      const staleSpy = jest.spyOn(
        staleStubs.compactionBoundaryRegistry,
        'consumeExpectation',
      );
      staleStubs.jsonlReader.findSessionsDirectory.mockResolvedValue(null);
      await makeService(staleStubs).readSessionHistory('valid', '/workspace', {
        checkCompactionBoundary: true,
      });
      expect(staleSpy).toHaveBeenCalledWith('valid', 'stale');

      // satisfied: the transcript holds the expected boundary
      const okStubs = makeStubs();
      okStubs.compactionBoundaryRegistry.observeBoundaryCount('valid', 0);
      okStubs.compactionBoundaryRegistry.recordExpectedBoundary('valid');
      const okSpy = jest.spyOn(
        okStubs.compactionBoundaryRegistry,
        'consumeExpectation',
      );
      okStubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/sessions/dir',
      );
      okStubs.jsonlReader.readJsonlMessages.mockResolvedValue(boundaryOnly);
      okStubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);
      okStubs.replayService.replayToStreamEvents.mockReturnValue([]);
      await makeService(okStubs).readSessionHistory('valid', '/workspace', {
        checkCompactionBoundary: true,
      });
      expect(okSpy).toHaveBeenCalledWith('valid', 'satisfied');

      // none: nothing was expected
      const noneStubs = makeStubs();
      const noneSpy = jest.spyOn(
        noneStubs.compactionBoundaryRegistry,
        'consumeExpectation',
      );
      noneStubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/sessions/dir',
      );
      noneStubs.jsonlReader.readJsonlMessages.mockResolvedValue(boundaryOnly);
      noneStubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);
      noneStubs.replayService.replayToStreamEvents.mockReturnValue([]);
      await makeService(noneStubs).readSessionHistory('valid', '/workspace', {
        checkCompactionBoundary: true,
      });
      expect(noneSpy).toHaveBeenCalledWith('valid', 'none');
    });

    it('two distinct recorded boundaries: a transcript with both new boundaries verifies', async () => {
      const stubs = makeStubs();
      stubs.compactionBoundaryRegistry.observeBoundaryCount('valid', 1);
      stubs.compactionBoundaryRegistry.recordExpectedBoundary(
        'valid',
        'b-new-1',
      );
      stubs.compactionBoundaryRegistry.recordExpectedBoundary(
        'valid',
        'b-new-2',
      );
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue('/sessions/dir');
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b1',
        } as SessionHistoryMessage,
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b2',
        } as SessionHistoryMessage,
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b3',
        } as SessionHistoryMessage,
      ]);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);
      stubs.replayService.replayToStreamEvents.mockReturnValue([]);

      const service = makeService(stubs);
      const result = await service.readSessionHistory('valid', '/workspace', {
        checkCompactionBoundary: true,
      });

      expect(result.staleSnapshot).toBeUndefined();
      expect(stubs.jsonlReader.readJsonlMessages).toHaveBeenCalledTimes(1);
      expect(
        stubs.compactionBoundaryRegistry.capturePendingExpectation('valid'),
      ).toBeUndefined();
    });

    it('compaction-read exhausts retries and returns staleSnapshot: true when expectation is unmet', async () => {
      const stubs = makeStubs();
      stubs.compactionBoundaryRegistry.observeBoundaryCount('valid', 1);
      stubs.compactionBoundaryRegistry.recordExpectedBoundary('valid');
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue('/sessions/dir');
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b1',
        } as SessionHistoryMessage,
      ]);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);
      stubs.replayService.replayToStreamEvents.mockReturnValue([]);

      const service = makeService(stubs);
      const result = await service.readSessionHistory('valid', '/workspace', {
        checkCompactionBoundary: true,
      });

      expect(result.staleSnapshot).toBe(true);
      // Retained for the next read, not cleared (PR #493 review C).
      expect(
        stubs.compactionBoundaryRegistry.capturePendingExpectation('valid'),
      ).toEqual({ kind: 'verified', expectedCount: 2 });
      expect(stubs.jsonlReader.readJsonlMessages).toHaveBeenCalledTimes(6);
    });

    it('treats a baseline-absent expectation as stale even when the transcript already has boundaries', async () => {
      const stubs = makeStubs();
      // Baseline is never observed before the expectation is recorded.
      stubs.compactionBoundaryRegistry.recordExpectedBoundary('valid');
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue('/sessions/dir');
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b1',
        } as SessionHistoryMessage,
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b2',
        } as SessionHistoryMessage,
      ]);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);
      stubs.replayService.replayToStreamEvents.mockReturnValue([]);

      const service = makeService(stubs);
      const result = await service.readSessionHistory('valid', '/workspace', {
        checkCompactionBoundary: true,
      });

      expect(result.staleSnapshot).toBe(true);
      expect(
        stubs.compactionBoundaryRegistry.capturePendingExpectation('valid'),
      ).toBeUndefined();
      expect(stubs.jsonlReader.readJsonlMessages).toHaveBeenCalledTimes(1);
    });

    it('retries through unchanged short parses until a later changed transcript contains the expected boundary', async () => {
      const stubs = makeStubs();
      stubs.compactionBoundaryRegistry.observeBoundaryCount('valid', 1);
      stubs.compactionBoundaryRegistry.recordExpectedBoundary('valid');
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue('/sessions/dir');
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);
      stubs.replayService.replayToStreamEvents.mockReturnValue([]);

      const unchanged = [
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b1',
        } as SessionHistoryMessage,
      ];
      const changed = [
        unchanged[0],
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'b2',
        } as SessionHistoryMessage,
      ];
      stubs.jsonlReader.readJsonlMessages
        .mockResolvedValueOnce(unchanged)
        .mockResolvedValueOnce(unchanged)
        .mockResolvedValueOnce(changed);

      const service = makeService(stubs);
      const result = await service.readSessionHistory('valid', '/workspace', {
        checkCompactionBoundary: true,
      });

      expect(result.staleSnapshot).toBeUndefined();
      expect(stubs.jsonlReader.readJsonlMessages).toHaveBeenCalledTimes(3);
      expect(
        stubs.compactionBoundaryRegistry.capturePendingExpectation('valid'),
      ).toBeUndefined();
    });

    it('retries through the real JSONL cache until a changed size/mtime exposes the expected boundary', async () => {
      const stubs = makeStubs();
      const registry = stubs.compactionBoundaryRegistry;
      registry.observeBoundaryCount('valid', 1);
      registry.recordExpectedBoundary('valid');

      const jsonlReader = new JsonlReaderService(asLogger(stubs.logger));
      jest
        .spyOn(jsonlReader, 'findSessionsDirectory')
        .mockResolvedValue('/sessions/dir');
      jest.spyOn(jsonlReader, 'loadAgentSessions').mockResolvedValue([]);
      const oldTranscript =
        '{"type":"system","subtype":"compact_boundary","uuid":"b1"}\n';
      const changedTranscript =
        oldTranscript +
        '{"type":"system","subtype":"compact_boundary","uuid":"b2"}\n';
      mockedStat
        .mockResolvedValueOnce(transcriptStats(oldTranscript.length, 1))
        .mockResolvedValueOnce(transcriptStats(oldTranscript.length, 1))
        .mockResolvedValueOnce(
          transcriptStats(changedTranscript.length, 2),
        );
      mockedCreateReadStream
        .mockReturnValueOnce(transcriptStream(oldTranscript))
        .mockReturnValueOnce(transcriptStream(changedTranscript));

      const factory = new HistoryEventFactory();
      const service = new SessionHistoryReaderService(
        asLogger(stubs.logger),
        jsonlReader,
        stubs.replayService as unknown as SessionReplayService,
        factory,
        stubs.modelResolver as unknown as IModelResolver,
        stubs.authEnv,
        stubs.pricingProvider,
        stubs.usageTracker,
        registry,
      );

      const result = await service.readSessionHistory('valid', '/workspace', {
        checkCompactionBoundary: true,
      });

      expect(result.staleSnapshot).toBeUndefined();
      expect(mockedStat).toHaveBeenCalledTimes(3);
      // The second observation reused the cached old parse; only the changed
      // validity token streamed and parsed again.
      expect(mockedCreateReadStream).toHaveBeenCalledTimes(2);
      expect(
        registry.capturePendingExpectation('valid'),
      ).toBeUndefined();
    });

    it('single parse supplies events and messages from the same boundary snapshot', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue('/sessions/dir');

      const mainMessages: SessionHistoryMessage[] = [
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'boundary',
        } as SessionHistoryMessage,
        {
          type: 'user',
          uuid: 'u1',
          timestamp: '2026-01-01T00:00:00.000Z',
          message: { role: 'user', content: 'hello' },
        } as SessionHistoryMessage,
        {
          type: 'assistant',
          uuid: 'a1',
          timestamp: '2026-01-01T00:00:01.000Z',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'hi' }],
          },
        } as SessionHistoryMessage,
      ];
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue(mainMessages);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);
      stubs.replayService.replayToStreamEvents.mockImplementation(
        (_sessionId, messages) =>
          messages.map((m) => ({
            id: m.uuid,
            eventType: 'message_start',
            role: m.message?.role,
          })) as never,
      );

      const service = makeService(stubs);
      const result = await service.readSessionHistory('valid', '/workspace');

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].id).toBe('u1');
      expect(result.messages[1].id).toBe('a1');
      expect(stubs.replayService.replayToStreamEvents).toHaveBeenCalledWith(
        'valid',
        mainMessages,
        [],
      );
    });
  });

  // -------------------------------------------------------------------------
  // readHistoryAsMessages
  // -------------------------------------------------------------------------

  describe('readHistoryAsMessages', () => {
    it('returns simple user/assistant messages and skips task-notification payloads', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/sessions/dir',
      );

      const messages: SessionHistoryMessage[] = [
        {
          type: 'user',
          uuid: 'u1',
          timestamp: '2026-01-01T00:00:00.000Z',
          message: { role: 'user', content: 'real user prompt' },
        } as SessionHistoryMessage,
        {
          type: 'assistant',
          uuid: 'a1',
          timestamp: '2026-01-01T00:00:01.000Z',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'real assistant reply' }],
          },
        } as SessionHistoryMessage,
        // task-notification user message — must be skipped.
        {
          type: 'user',
          uuid: 'u2',
          timestamp: '2026-01-01T00:00:02.000Z',
          message: {
            role: 'user',
            content: '<task-notification>done</task-notification>',
          },
        } as SessionHistoryMessage,
      ];
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue(messages);

      const service = makeService(stubs);
      const out = await service.readHistoryAsMessages('valid', '/workspace');

      expect(out.map((m) => m.id).sort()).toEqual(['a1', 'u1']);
      expect(out.find((m) => m.id === 'u1')?.role).toBe('user');
      expect(out.find((m) => m.id === 'a1')?.content).toBe(
        'real assistant reply',
      );
    });

    it('starts after the last compact_boundary', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/sessions/dir',
      );
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        {
          type: 'user',
          uuid: 'old',
          timestamp: '2026-01-01T00:00:00.000Z',
          message: { role: 'user', content: 'OLD pre-compact' },
        } as SessionHistoryMessage,
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'boundary',
        } as SessionHistoryMessage,
        {
          type: 'user',
          uuid: 'new',
          timestamp: '2026-01-01T00:01:00.000Z',
          message: { role: 'user', content: 'NEW post-compact' },
        } as SessionHistoryMessage,
      ]);

      const service = makeService(stubs);
      const out = await service.readHistoryAsMessages('valid', '/workspace');

      expect(out.map((m) => m.id)).toEqual(['new']);
      expect(out[0].content).toBe('NEW post-compact');
    });

    it('returns [] on sessionId validation failure', async () => {
      const stubs = makeStubs();
      const service = makeService(stubs);
      await expect(
        service.readHistoryAsMessages('../bad', '/workspace'),
      ).resolves.toEqual([]);
      expect(stubs.jsonlReader.findSessionsDirectory).not.toHaveBeenCalled();
    });

    it('returns [] when the sessions directory is missing', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(null);
      const service = makeService(stubs);
      await expect(
        service.readHistoryAsMessages('valid', '/workspace'),
      ).resolves.toEqual([]);
    });

    // TASK_2026_293 — a malformed id is a soft miss (every caller reads `[]`
    // as "no history"), so it must not be logged as a failed read of a real
    // session. An ERROR nobody treats as an error hides the next real one.
    it('warns rather than errors on a malformed sessionId, naming the value', async () => {
      const stubs = makeStubs();
      const service = makeService(stubs);

      await expect(
        service.readHistoryForCuration('', '/workspace'),
      ).resolves.toEqual([]);

      expect(stubs.logger.error).not.toHaveBeenCalled();
      expect(stubs.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid sessionId'),
        expect.objectContaining({ sessionId: '' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // resolveNativeMessageId — Fix NODE-NESTJS-3A/39
  // -------------------------------------------------------------------------

  describe('resolveNativeMessageId', () => {
    const LINE_UUID = '7bca7123-f9f4-4981-ad04-3b982ee225e1';
    const LINE_UUID_2 = '72a17af6-3e28-450a-90c3-f5082b343d6b';
    const ANTHROPIC_ID = 'msg_01AbCdEfGhIjKlMnOpQrStUvWxYz';
    const PTAH_ID = 'msg_1778055502540_cegogbr';

    it('returns a transcript line UUID unchanged without reading JSONL (fast path)', async () => {
      const stubs = makeStubs();
      const service = makeService(stubs);

      const result = await service.resolveNativeMessageId(
        'valid-session',
        '/workspace',
        LINE_UUID,
      );

      expect(result).toBe(LINE_UUID);
      // Fast path — no I/O
      expect(stubs.jsonlReader.findSessionsDirectory).not.toHaveBeenCalled();
      expect(stubs.jsonlReader.readJsonlMessages).not.toHaveBeenCalled();
    });

    it('maps an Anthropic message id (msg_01...) to its owning line UUID', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/home/user/.claude/projects/workspace',
      );
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        {
          type: 'assistant',
          uuid: LINE_UUID,
          timestamp: '2026-01-01T00:00:00Z',
          message: { role: 'assistant', id: ANTHROPIC_ID },
        } as SessionHistoryMessage,
      ]);

      const service = makeService(stubs);
      const result = await service.resolveNativeMessageId(
        'valid-session',
        '/workspace',
        ANTHROPIC_ID,
      );

      expect(result).toBe(LINE_UUID);
    });

    it('throws the unresolvable-anchor SdkError when a Ptah ID is at index 0 and no preceding line UUID exists', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/home/user/.claude/projects/workspace',
      );
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        {
          type: 'user',
          uuid: PTAH_ID,
          timestamp: '2026-01-01T00:00:00Z',
        } as SessionHistoryMessage,
      ]);

      const service = makeService(stubs);
      // No line UUID to anchor on and no text hint → the unified
      // "not found in session history" error, which carries the phrase the
      // fork/rewind callers treat as an expected (non-Sentry) user condition.
      await expect(
        service.resolveNativeMessageId('valid-session', '/workspace', PTAH_ID),
      ).rejects.toMatchObject({
        message: expect.stringContaining('not found in session history'),
      });
    });

    it('resolves a client-only optimistic id to the real line UUID via the prompt-text hint', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/home/user/.claude/projects/workspace',
      );
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        {
          type: 'user',
          uuid: LINE_UUID,
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'commit' }],
          },
          timestamp: '2026-01-01T00:00:00Z',
        } as SessionHistoryMessage,
        {
          type: 'user',
          uuid: LINE_UUID_2,
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'commit' }],
          },
          timestamp: '2026-01-01T00:00:02Z',
        } as SessionHistoryMessage,
      ]);

      const service = makeService(stubs);

      // The optimistic id is absent from the transcript; the hint recovers the
      // real UUID. occurrence:1 selects the SECOND identical "commit" prompt.
      const result = await service.resolveNativeMessageId(
        'valid-session',
        '/workspace',
        'msg_1780940558448_oekdvwh',
        { text: 'commit', occurrence: 1 },
      );
      expect(result).toBe(LINE_UUID_2);
    });

    it('walks backward and returns nearest preceding line UUID for a Ptah ID', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/home/user/.claude/projects/workspace',
      );
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        {
          type: 'user',
          uuid: LINE_UUID_2,
          timestamp: '2026-01-01T00:00:00Z',
        } as SessionHistoryMessage,
        {
          type: 'assistant',
          uuid: PTAH_ID,
          timestamp: '2026-01-01T00:00:01Z',
        } as SessionHistoryMessage,
      ]);

      const service = makeService(stubs);
      const result = await service.resolveNativeMessageId(
        'valid-session',
        '/workspace',
        PTAH_ID,
      );

      // PTAH_ID is at index 1; walking backward hits LINE_UUID_2 at index 0.
      expect(result).toBe(LINE_UUID_2);
    });

    it('throws SdkError when the ID is not found in JSONL at all', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/home/user/.claude/projects/workspace',
      );
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        {
          type: 'user',
          uuid: LINE_UUID,
          timestamp: '2026-01-01T00:00:00Z',
        } as SessionHistoryMessage,
      ]);

      const service = makeService(stubs);
      await expect(
        service.resolveNativeMessageId(
          'valid-session',
          '/workspace',
          'msg_9999999_unknown',
        ),
      ).rejects.toMatchObject({
        message: expect.stringContaining('not found in session history'),
      });
    });

    it('throws SdkError when the sessions directory is not found', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(null);

      const service = makeService(stubs);
      await expect(
        service.resolveNativeMessageId('valid-session', '/workspace', PTAH_ID),
      ).rejects.toMatchObject({
        message: expect.stringContaining('sessions directory not found'),
      });
    });

    it('throws SdkError when the session JSONL file cannot be read', async () => {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/home/user/.claude/projects/workspace',
      );
      stubs.jsonlReader.readJsonlMessages.mockRejectedValue(
        new Error('ENOENT: file not found'),
      );

      const service = makeService(stubs);
      await expect(
        service.resolveNativeMessageId('valid-session', '/workspace', PTAH_ID),
      ).rejects.toMatchObject({
        message: expect.stringContaining('session file not found'),
      });
    });
  });

  // -------------------------------------------------------------------------
  // hydrateMissingPricing (CP 1.5c) — historical JSONL cost backfill
  // -------------------------------------------------------------------------

  describe('hydrateMissingPricing (CP 1.5c)', () => {
    function buildAssistantMessage(
      uuid: string,
      model: string,
      input: number,
      output: number,
    ): SessionHistoryMessage {
      return {
        type: 'assistant',
        uuid,
        message: {
          role: 'assistant',
          model,
          content: [{ type: 'text', text: 'reply' }],
          usage: {
            input_tokens: input,
            output_tokens: output,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
        usage: {
          input_tokens: input,
          output_tokens: output,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      } as SessionHistoryMessage;
    }

    beforeEach(() => {
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('hydrates missing pricing for direct Anthropic when session JSONL has unknown model IDs', async () => {
      const unknownModel = 'claude-opus-4-91-hydrate-direct';
      const stubs = makeStubs();
      stubs.authEnv = { ANTHROPIC_BASE_URL: '' } as AuthEnv;
      const hydrated: ModelPricing = {
        inputCostPerToken: 10e-6,
        outputCostPerToken: 50e-6,
        provider: 'anthropic',
      };
      stubs.pricingProvider.getPricing = jest.fn(async (modelId: string) =>
        modelId === unknownModel ? hydrated : null,
      );
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/sessions/dir',
      );
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        buildAssistantMessage('a1', unknownModel, 1000, 500),
      ]);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);

      const service = makeService(stubs);
      const { stats } = await service.readSessionHistory(
        'valid-session',
        '/workspace',
      );

      expect(stubs.pricingProvider.getPricing).toHaveBeenCalledWith(
        unknownModel,
      );
      expect(stats).not.toBeNull();
      // 1000 * 10e-6 + 500 * 50e-6 = 0.01 + 0.025 = 0.035
      expect(stats?.totalCost).toBeCloseTo(0.035, 6);
    });

    it('skips backfill for third-party (OpenRouter) historical sessions', async () => {
      const unknownModel = 'claude-opus-4-92-skip-thirdparty';
      const stubs = makeStubs();
      stubs.authEnv = {
        ANTHROPIC_BASE_URL: 'https://openrouter.ai/api/v1',
      } as AuthEnv;
      stubs.pricingProvider.getPricing = jest.fn();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/sessions/dir',
      );
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        buildAssistantMessage('a1', unknownModel, 1000, 500),
      ]);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);

      const service = makeService(stubs);
      const { stats } = await service.readSessionHistory(
        'valid-session',
        '/workspace',
      );

      expect(stubs.pricingProvider.getPricing).not.toHaveBeenCalled();
      expect(stats).not.toBeNull();
      expect(stats?.totalCost).toBeNull();
    });

    it('does not call pricing provider for already-known models', async () => {
      const stubs = makeStubs();
      stubs.authEnv = { ANTHROPIC_BASE_URL: '' } as AuthEnv;
      stubs.pricingProvider.getPricing = jest.fn();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/sessions/dir',
      );
      // gpt-4o is a known entry in DEFAULT_MODEL_PRICING — no hydration needed.
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        buildAssistantMessage('a1', 'gpt-4o', 1000, 500),
      ]);
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);

      const service = makeService(stubs);
      const { stats } = await service.readSessionHistory(
        'valid-session',
        '/workspace',
      );

      expect(stubs.pricingProvider.getPricing).not.toHaveBeenCalled();
      expect(stats).not.toBeNull();
      // 1000 * 2.5e-6 + 500 * 10e-6 = 0.0025 + 0.005 = 0.0075
      expect(stats?.totalCost).toBeCloseTo(0.0075, 6);
    });
  });

  // -------------------------------------------------------------------------
  // Resume baseline for LiveUsageTracker (TASK_2026_374, defect 2)
  //
  // `CompactionHookHandler` samples `getCumulativeTokens` synchronously on the
  // SDK transport path. For a session resumed from JSONL the live map is empty,
  // so a manual `/compact` published `preTokens: 0`. Reading the history is the
  // one moment the number is already in hand.
  // -------------------------------------------------------------------------

  describe('resume baseline seeding', () => {
    function usageMessage(
      uuid: string,
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens: number;
        cache_creation_input_tokens: number;
      },
    ): SessionHistoryMessage {
      return {
        type: 'assistant',
        uuid,
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: uuid }],
          usage,
        },
        usage,
      } as SessionHistoryMessage;
    }

    function readyStubs(): Stubs {
      const stubs = makeStubs();
      stubs.jsonlReader.findSessionsDirectory.mockResolvedValue(
        '/sessions/dir',
      );
      stubs.jsonlReader.loadAgentSessions.mockResolvedValue([]);
      return stubs;
    }

    it('seeds the LAST usage frame, not the summed session total', async () => {
      const stubs = readyStubs();
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        usageMessage('a1', {
          input_tokens: 40,
          output_tokens: 10,
          cache_read_input_tokens: 90_000,
          cache_creation_input_tokens: 0,
        }),
        usageMessage('a2', {
          input_tokens: 60,
          output_tokens: 400,
          cache_read_input_tokens: 120_000,
          cache_creation_input_tokens: 2_000,
        }),
      ]);

      const service = makeService(stubs);
      await service.readSessionHistory('valid-session', '/workspace');

      // Last frame only: 60 + 400 + 120000 + 2000. The aggregate would be
      // 212 510 — a different measurement, and with prompt caching one that
      // grows without bound over a long session.
      expect(stubs.usageTracker.getCumulativeTokens('valid-session')).toBe(
        122_460,
      );
    });

    it('closes the preTokens=0 gap the PreCompact hook reported after a resume', async () => {
      const stubs = readyStubs();
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        usageMessage('a1', {
          input_tokens: 1_000,
          output_tokens: 500,
          cache_read_input_tokens: 180_000,
          cache_creation_input_tokens: 0,
        }),
      ]);

      // Before the read the tracker knows nothing — this is exactly the state
      // the hook sampled.
      expect(stubs.usageTracker.getCumulativeTokens('valid-session')).toBe(0);

      const service = makeService(stubs);
      await service.readSessionHistory('valid-session', '/workspace');

      expect(stubs.usageTracker.getCumulativeTokens('valid-session')).toBe(
        181_500,
      );
    });

    it('seeds nothing when the transcript ends at a compaction boundary', async () => {
      const stubs = readyStubs();
      stubs.jsonlReader.readJsonlMessages.mockResolvedValue([
        usageMessage('a1', {
          input_tokens: 1_000,
          output_tokens: 500,
          cache_read_input_tokens: 180_000,
          cache_creation_input_tokens: 0,
        }),
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: 'boundary',
        } as SessionHistoryMessage,
      ]);

      const service = makeService(stubs);
      await service.readSessionHistory('valid-session', '/workspace');

      // Pre-boundary frames describe a context that no longer exists. 0 is the
      // honest answer; a stale 181 500 would be a confident wrong one.
      expect(stubs.usageTracker.getCumulativeTokens('valid-session')).toBe(0);
    });

    it('does not seed when the session file is missing', async () => {
      const stubs = readyStubs();
      stubs.jsonlReader.readJsonlMessages.mockRejectedValue(
        new Error('ENOENT: session file missing'),
      );

      const service = makeService(stubs);
      await service.readSessionHistory('valid-session', '/workspace');

      expect(stubs.usageTracker.getCumulativeTokens('valid-session')).toBe(0);
    });
  });
});
