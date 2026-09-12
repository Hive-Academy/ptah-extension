import 'reflect-metadata';

import type { AuthEnv, FlatStreamEventUnion } from '@ptah-extension/shared';
import { findModelPricing } from '@ptah-extension/shared';
import type { Logger, SubagentRegistryService } from '@ptah-extension/vscode-core';

import type { IModelResolver } from '../auth-env.port';
import { CompactionBoundaryGenerationRegistry } from '../helpers/compaction-boundary-generation-registry';
import { LiveUsageTracker } from '../helpers/live-usage-tracker';
import type { SessionLifecycleManager } from '../helpers/session-lifecycle-manager';
import { SessionTurnStateRegistry } from '../helpers/session-turn-state.registry';
import { AgentCorrelationService } from '../helpers/history/agent-correlation.service';
import { HistoryEventFactory } from '../helpers/history/history-event-factory';
import type { SessionHistoryMessage } from '../helpers/history/history.types';
import { SessionReplayService } from '../helpers/history/session-replay.service';
import type { JsonlReaderService } from '../helpers/history/jsonl-reader.service';
import type { IPricingProvider } from '../pricing.port';
import { SdkMessageTransformer } from '../sdk-message-transformer';
import { SessionHistoryReaderService } from '../session-history-reader.service';

const SESSION_ID = 'artifact-parity-session';

function createLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function createLiveTransformer(): SdkMessageTransformer {
  const logger = createLogger();
  const subagentRegistry = {
    pruneSession: jest.fn(),
    markPendingBackground: jest.fn(),
    setTaskId: jest.fn(),
  } as unknown as SubagentRegistryService;
  const modelResolver = {
    resolveForPricing: jest.fn((model: string) => model),
    resolveForCost: jest.fn((model: string) => ({
      modelId: model,
      pricing: findModelPricing(model),
      subscriptionCovered: false,
    })),
    isSubscriptionCovered: jest.fn(() => false),
  } as unknown as IModelResolver;
  const lifecycle = {
    getActiveSessionIds: jest.fn(() => [SESSION_ID]),
  } as unknown as SessionLifecycleManager;

  return new SdkMessageTransformer(
    logger,
    { provider: 'anthropic' } as unknown as AuthEnv,
    subagentRegistry,
    modelResolver,
    lifecycle,
    new LiveUsageTracker(),
    new SessionTurnStateRegistry(),
    new CompactionBoundaryGenerationRegistry(),
  );
}

function createReplayService(): SessionReplayService {
  const logger = createLogger();
  return new SessionReplayService(
    logger,
    new AgentCorrelationService(logger),
    new HistoryEventFactory(),
    {
      resolveForPricing: (model: string) => model || 'unknown',
    } as unknown as IModelResolver,
  );
}

/**
 * The reader over a fixed transcript, wired to the REAL replay service — the
 * two outputs under comparison must come from one parse of one corpus.
 */
function createReader(
  records: SessionHistoryMessage[],
  replay: SessionReplayService,
): SessionHistoryReaderService {
  const jsonlReader = {
    findSessionsDirectory: jest.fn().mockResolvedValue('/sessions'),
    readJsonlMessages: jest.fn().mockResolvedValue(records),
    loadAgentSessions: jest.fn().mockResolvedValue([]),
  } as unknown as JsonlReaderService;
  const modelResolver = {
    resolveForPricing: (model: string) => model || 'unknown',
    resolveForCost: (model: string) => ({
      modelId: model || 'unknown',
      pricing: findModelPricing(model || 'unknown'),
      subscriptionCovered: false,
    }),
    isSubscriptionCovered: () => false,
  } as unknown as IModelResolver;
  const pricingProvider = {
    getPricing: jest.fn().mockResolvedValue(null),
    ensureHydrated: jest.fn().mockResolvedValue(true),
  } as unknown as IPricingProvider;

  return new SessionHistoryReaderService(
    createLogger(),
    jsonlReader,
    replay,
    new HistoryEventFactory(),
    modelResolver,
    {} as AuthEnv,
    pricingProvider,
    new LiveUsageTracker(),
    new CompactionBoundaryGenerationRegistry(),
  );
}

function visibleText(events: FlatStreamEventUnion[]): string[] {
  return events
    .filter(
      (event): event is Extract<FlatStreamEventUnion, { eventType: 'text_delta' }> =>
        event.eventType === 'text_delta',
    )
    .map((event) => event.delta);
}

function replayUser(content: unknown, extra: Record<string, unknown> = {}): SessionHistoryMessage {
  return {
    type: 'user',
    uuid: 'replay-user',
    timestamp: '2026-01-01T00:00:00.000Z',
    message: { role: 'user', content: content as string },
    ...extra,
  } as SessionHistoryMessage;
}

function replayAssistant(content: unknown): SessionHistoryMessage {
  return {
    type: 'assistant',
    uuid: 'replay-assistant',
    timestamp: '2026-01-01T00:00:01.000Z',
    message: { role: 'assistant', content: content as string },
  } as SessionHistoryMessage;
}

function liveUser(content: unknown, extra: Record<string, unknown> = {}): unknown {
  return {
    type: 'user',
    uuid: 'live-user',
    session_id: SESSION_ID,
    message: { role: 'user', content },
    ...extra,
  };
}

function liveAssistant(content: unknown): unknown {
  return {
    type: 'assistant',
    uuid: 'live-assistant',
    session_id: SESSION_ID,
    message: { id: 'live-assistant', role: 'assistant', content },
  };
}

describe('artifact replay/live visible-text parity (TASK_2026_414)', () => {
  /**
   * The replay path previously emitted visible text for the command and skill
   * artifacts below while the live transformer rejected them with
   * isSkillOrMetaContent. This corpus pins their shared hidden status without
   * comparing protocol-only events, timestamps, or event ordering.
   */
  it.each([
    ['synthetic user payload', 'synthetic payload', { isSynthetic: true }, { isSynthetic: true }],
    ['sourceToolUseID payload', 'tool-owned payload', { sourceToolUseID: 'tool-1' }, { sourceToolUseID: 'tool-1' }],
    [
      'task notification',
      '<task-notification>done</task-notification>',
      { isSynthetic: true },
      {},
    ],
    ['interrupt sentinel', '<interrupt>interrupted</interrupt>', {}, {}],
    ['skill format marker', '<skill-format>true</skill-format>skill body', {}, {}],
    ['command message marker', '<command-message>orchestrate</command-message>', {}, {}],
    ['command name marker', '<command-name>/orchestrate</command-name>', {}, {}],
    ['skill base directory', 'Base directory for this skill: C:/skills', {}, {}],
    ['invoked skills summary', 'The following skills were invoked in this session: audit', {}, {}],
    ['plan file reference', 'A plan file exists from plan mode at: C:/plan.md', {}, {}],
    ['skill frontmatter', '---\nname: audit\ndescription: audit a project\n---', {}, {}],
    ['ordinary user content', 'Explain the current project.', {}, {}],
    ['No response requested probe', 'No response requested.', {}, {}],
  ])('%s has the same visible user text', (_name, content, liveExtra, replayExtra) => {
    const live = createLiveTransformer().transform(
      liveUser(content, liveExtra) as never,
      SESSION_ID as never,
    );
    const replay = createReplayService().replayToStreamEvents(
      SESSION_ID,
      [replayUser(content, replayExtra)],
      [],
    );

    expect(visibleText(replay)).toEqual(visibleText(live));
  });

  it('keeps tool-result-only user messages out of normalized visible text', () => {
    const toolResult = [
      { type: 'tool_result', tool_use_id: 'tool-1', content: 'tool output' },
    ];
    const live = createLiveTransformer().transform(
      liveUser(toolResult) as never,
      SESSION_ID as never,
    );
    const replay = createReplayService().replayToStreamEvents(
      SESSION_ID,
      [replayUser(toolResult)],
      [],
    );

    expect(visibleText(replay)).toEqual(visibleText(live));
  });

  it('keeps genuine assistant text visible in both representations', () => {
    const content = [{ type: 'text', text: 'Here is the answer.' }];
    const live = createLiveTransformer().transform(
      liveAssistant(content) as never,
      SESSION_ID as never,
    );
    const replay = createReplayService().replayToStreamEvents(
      SESSION_ID,
      [replayAssistant(content)],
      [],
    );

    expect(visibleText(replay)).toEqual(visibleText(live));
  });

  /**
   * `readSessionHistory` returns events and messages from ONE parse, and
   * `chat:resume` renders the messages. So the projection must hide exactly
   * what replay hides: the first fix suppressed `isSynthetic` only, leaving an
   * `isMeta` record visible in a resumed transcript that the event stream
   * omits (round-2 verification, Moderate-2). Both sides now ask the one
   * `isHiddenTranscriptRecord` predicate.
   */
  it('hides isMeta AND isSynthetic records from the projected messages and the replayed events alike', async () => {
    const records: SessionHistoryMessage[] = [
      replayUser('ordinary prompt', { uuid: 'u-ordinary' }),
      replayUser('meta bookkeeping turn', { uuid: 'u-meta', isMeta: true }),
      replayUser('synthetic cue', { uuid: 'u-synthetic', isSynthetic: true }),
      replayAssistant([{ type: 'text', text: 'ordinary answer' }]),
    ];

    const snapshot = await createReader(
      records,
      createReplayService(),
    ).readSessionHistory(SESSION_ID, '/workspace');
    const events = createReplayService().replayToStreamEvents(
      SESSION_ID,
      records,
      [],
    );

    const projected = snapshot.messages.map((message) => message.content);
    expect(projected).toEqual(['ordinary prompt', 'ordinary answer']);
    expect(visibleText(events)).toEqual(projected);
    expect(snapshot.messages.map((message) => message.id)).not.toContain(
      'u-meta',
    );
  });

  it('keeps local-command output visible where replay has an assistant-text representation', () => {
    const content = 'Command completed successfully.';
    const live = createLiveTransformer().transform(
      {
        type: 'system',
        subtype: 'local_command_output',
        session_id: SESSION_ID,
        content,
      } as never,
      SESSION_ID as never,
    );
    const replay = createReplayService().replayToStreamEvents(
      SESSION_ID,
      [replayAssistant([{ type: 'text', text: content }])],
      [],
    );

    expect(visibleText(replay)).toEqual(visibleText(live));
  });
});
