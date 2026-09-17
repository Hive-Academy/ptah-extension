import 'reflect-metadata';

import type { AuthEnv, FlatStreamEventUnion } from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';

import type { IModelResolver } from './auth-env.port';
import {
  MESSAGE_ID_NOT_FOUND_PHRASE,
  SessionHistoryReaderService,
} from './session-history-reader.service';
import type { IPricingProvider } from './pricing.port';
import { CompactionBoundaryGenerationRegistry } from './helpers/compaction-boundary-generation-registry';
import { HistoryEventFactory } from './helpers/history/history-event-factory';
import type { JsonlReaderService } from './helpers/history/jsonl-reader.service';
import type { SessionReplayService } from './helpers/history/session-replay.service';
import type { SessionHistoryMessage } from './helpers/history/history.types';
import { LiveUsageTracker } from './helpers/live-usage-tracker';

const SESSION_ID = 'valid-session';
const WORKSPACE = '/workspace';
const SESSIONS_DIR = '/sessions';
const OPTIMISTIC_ID = 'msg_1780940558448_oekdvwh';

function userMessage(uuid: string, text: string): SessionHistoryMessage {
  return {
    type: 'user',
    uuid,
    message: { role: 'user', content: [{ type: 'text', text }] },
    timestamp: '2026-01-01T00:00:00Z',
  } as SessionHistoryMessage;
}

function makeHarness(messages: SessionHistoryMessage[] = []) {
  const events = [
    {
      eventType: 'message_start',
      messageId: 'root-message',
      role: 'user',
    },
  ] as FlatStreamEventUnion[];
  const jsonlReader = {
    findSessionsDirectory: jest.fn().mockResolvedValue(SESSIONS_DIR),
    readJsonlMessages: jest.fn().mockResolvedValue(messages),
    loadAgentSessions: jest.fn().mockResolvedValue([]),
  };
  const replayService = {
    replayToStreamEvents: jest.fn().mockReturnValue(events),
  };
  const modelResolver = {
    resolveForPricing: jest.fn((model: string) => model),
    resolveForCost: jest.fn(),
    isSubscriptionCovered: jest.fn(() => false),
  };
  const pricingProvider = {
    getPricing: jest.fn().mockResolvedValue(null),
    ensureHydrated: jest.fn().mockResolvedValue(true),
  };
  const usageTracker = new LiveUsageTracker();
  const compactionRegistry = new CompactionBoundaryGenerationRegistry();
  const service = new SessionHistoryReaderService(
    createMockLogger() as unknown as Logger,
    jsonlReader as unknown as JsonlReaderService,
    replayService as unknown as SessionReplayService,
    new HistoryEventFactory(),
    modelResolver as unknown as IModelResolver,
    {} as AuthEnv,
    pricingProvider as unknown as IPricingProvider,
    usageTracker,
    compactionRegistry,
  );
  return {
    service,
    events,
    jsonlReader,
    replayService,
    modelResolver,
    pricingProvider,
    usageTracker,
    compactionRegistry,
  };
}

describe('SessionHistoryReaderService event-only read', () => {
  it('projects the same events as the resume read without resume side effects', async () => {
    const harness = makeHarness([
      userMessage('11111111-1111-4111-8111-111111111111', 'hello'),
    ]);
    const history = await harness.service.readSessionHistory(
      SESSION_ID,
      WORKSPACE,
    );

    jest.clearAllMocks();
    const seedSpy = jest.spyOn(harness.usageTracker, 'seedResumedSession');
    const captureSpy = jest.spyOn(
      harness.compactionRegistry,
      'capturePendingExpectation',
    );
    const observeSpy = jest.spyOn(
      harness.compactionRegistry,
      'observeBoundaryCount',
    );
    const consumeSpy = jest.spyOn(
      harness.compactionRegistry,
      'consumeExpectation',
    );

    await expect(
      harness.service.readSessionEvents(SESSION_ID, WORKSPACE),
    ).resolves.toEqual(history.events);
    expect(harness.replayService.replayToStreamEvents).toHaveBeenCalledTimes(1);
    expect(captureSpy).not.toHaveBeenCalled();
    expect(observeSpy).not.toHaveBeenCalled();
    expect(consumeSpy).not.toHaveBeenCalled();
    expect(harness.pricingProvider.ensureHydrated).not.toHaveBeenCalled();
    expect(harness.pricingProvider.getPricing).not.toHaveBeenCalled();
    expect(harness.modelResolver.resolveForCost).not.toHaveBeenCalled();
    expect(seedSpy).not.toHaveBeenCalled();
  });

  it('returns an empty list when the sessions directory or file is absent', async () => {
    const missingDirectory = makeHarness();
    missingDirectory.jsonlReader.findSessionsDirectory.mockResolvedValue(null);
    await expect(
      missingDirectory.service.readSessionEvents(SESSION_ID, WORKSPACE),
    ).resolves.toEqual([]);

    const missingFile = makeHarness();
    missingFile.jsonlReader.readJsonlMessages.mockRejectedValue(
      Object.assign(new Error('session file missing'), { code: 'ENOENT' }),
    );
    await expect(
      missingFile.service.readSessionEvents(SESSION_ID, WORKSPACE),
    ).resolves.toEqual([]);
  });

  it('propagates non-missing transcript read failures', async () => {
    const harness = makeHarness();
    const accessError = Object.assign(new Error('access denied'), {
      code: 'EACCES',
    });
    harness.jsonlReader.readJsonlMessages.mockRejectedValue(accessError);

    await expect(
      harness.service.readSessionEvents(SESSION_ID, WORKSPACE),
    ).rejects.toBe(accessError);
  });

  it('rejects an invalid session id before reading the filesystem', async () => {
    const harness = makeHarness();
    await expect(
      harness.service.readSessionEvents('../escape', WORKSPACE),
    ).rejects.toMatchObject({ name: 'SdkError' });
    expect(harness.jsonlReader.findSessionsDirectory).not.toHaveBeenCalled();
  });

  it('resolves duplicate prompts from the end and preserves legacy occurrence', async () => {
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ];
    const harness = makeHarness(ids.map((id) => userMessage(id, 'repeat')));

    await expect(
      harness.service.resolveNativeMessageId(
        SESSION_ID,
        WORKSPACE,
        OPTIMISTIC_ID,
        { text: 'repeat', occurrenceFromEnd: 0 },
      ),
    ).resolves.toBe(ids[2]);
    await expect(
      harness.service.resolveNativeMessageId(
        SESSION_ID,
        WORKSPACE,
        OPTIMISTIC_ID,
        { text: 'repeat', occurrenceFromEnd: 1 },
      ),
    ).resolves.toBe(ids[1]);
    await expect(
      harness.service.resolveNativeMessageId(
        SESSION_ID,
        WORKSPACE,
        OPTIMISTIC_ID,
        { text: 'repeat', occurrenceFromEnd: ids.length },
      ),
    ).rejects.toThrow(MESSAGE_ID_NOT_FOUND_PHRASE);
    await expect(
      harness.service.resolveNativeMessageId(
        SESSION_ID,
        WORKSPACE,
        OPTIMISTIC_ID,
        { text: 'repeat', occurrence: 0 },
      ),
    ).resolves.toBe(ids[0]);
    await expect(
      harness.service.resolveNativeMessageId(
        SESSION_ID,
        WORKSPACE,
        OPTIMISTIC_ID,
        { text: 'repeat', occurrence: 1 },
      ),
    ).resolves.toBe(ids[1]);
  });
});
