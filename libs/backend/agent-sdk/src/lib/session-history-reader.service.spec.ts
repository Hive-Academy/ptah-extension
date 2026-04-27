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
import { SessionHistoryReaderService } from './session-history-reader.service';
import type { JsonlReaderService } from './helpers/history/jsonl-reader.service';
import type { SessionReplayService } from './helpers/history/session-replay.service';
import { HistoryEventFactory } from './helpers/history/history-event-factory';
import type { SessionHistoryMessage } from './helpers/history/history.types';
import type { ModelResolver } from './auth/model-resolver';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
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
  modelResolver: jest.Mocked<Pick<ModelResolver, 'resolveForPricing'>>;
  logger: MockLogger;
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
    },
    logger: createMockLogger(),
  };
}

function makeService(stubs: Stubs): SessionHistoryReaderService {
  const factory = new HistoryEventFactory(); // real — no deps
  return new SessionHistoryReaderService(
    asLogger(stubs.logger),
    stubs.jsonlReader as unknown as JsonlReaderService,
    stubs.replayService as unknown as SessionReplayService,
    factory,
    stubs.modelResolver as unknown as ModelResolver,
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

      expect(result).toEqual({ events: [], stats: null });
      // Traversal rejected pre-filesystem — reader must never be called.
      expect(stubs.jsonlReader.findSessionsDirectory).not.toHaveBeenCalled();
      // The facade catches the SdkError internally and logs via `error`.
      expect(stubs.logger.error).toHaveBeenCalled();
    });

    it('rejects an empty sessionId', async () => {
      const stubs = makeStubs();
      const service = makeService(stubs);
      const result = await service.readSessionHistory('', '/workspace');
      expect(result).toEqual({ events: [], stats: null });
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

      expect(result).toEqual({ events: [], stats: null });
      expect(stubs.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Sessions directory not found'),
      );
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

      expect(result).toEqual({ events: [], stats: null });
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
  });
});
