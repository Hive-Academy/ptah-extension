/**
 * ResultMessageTransformer — the turn boundary ON the stream (TASK_2026_360).
 *
 * One `turn_state` per result, derived from the Stop / StopFailure snapshots
 * the hooks left on the registry. Uses the real registry: the reducer is
 * pure, and the table below is what the frontend applier depends on.
 */
import 'reflect-metadata';
import { isTurnStateEvent } from '@ptah-extension/shared';
import type { SdkBackgroundTaskSummary } from '@ptah-extension/shared';
import { ResultMessageTransformer } from './result-message.transformer';
import { SessionTurnStateRegistry } from '../helpers/session-turn-state.registry';
import type { TransformerHelpers } from './transformer-helpers';
import type { SDKResultMessage } from '../types/sdk-types/claude-sdk.types';

const SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TASK: SdkBackgroundTaskSummary = {
  id: 'task-1',
  type: 'subagent',
  status: 'running',
  description: 'background work',
};
const CRON = {
  id: 'cron-1',
  schedule: '*/5 * * * *',
  recurring: true,
  prompt: 'wake',
};

function makeHelpers(registry: SessionTurnStateRegistry): TransformerHelpers {
  return {
    logger: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    subagentRegistry: {},
    modelResolver: {},
    sessionLifecycle: {},
    usageTracker: {},
    turnState: registry,
  } as unknown as TransformerHelpers;
}

const RESULT = { type: 'result', subtype: 'success' } as SDKResultMessage;

describe('ResultMessageTransformer', () => {
  let registry: SessionTurnStateRegistry;
  let helpers: TransformerHelpers;
  const transformer = new ResultMessageTransformer();

  beforeEach(() => {
    registry = new SessionTurnStateRegistry();
    helpers = makeHelpers(registry);
  });

  it('emits nothing when the session id is unknown (not routable)', () => {
    expect(transformer.transform(RESULT, helpers)).toEqual([]);
    expect(registry.get(SESSION)).toBeUndefined();
  });

  it('emits exactly one turn_state per result', () => {
    registry.markGenerating(SESSION);
    const events = transformer.transform(RESULT, helpers, SESSION as never);
    expect(events).toHaveLength(1);
    expect(isTurnStateEvent(events[0])).toBe(true);
    expect(events[0]).toMatchObject({
      sessionId: SESSION,
      messageId: `turn-state-${SESSION}`,
    });
  });

  it('settles completed from the result message without a Stop snapshot', () => {
    registry.markGenerating(SESSION);
    const [event] = transformer.transform(
      { ...RESULT, terminal_reason: 'completed' } satisfies SDKResultMessage,
      helpers,
      SESSION as never,
    );
    expect(registry.get(SESSION)).toMatchObject({
      phase: 'idle',
      terminalReason: 'completed',
    });
    expect(event).toMatchObject({ terminalReason: 'completed' });
  });

  it('uses the result reason over the Stop snapshot and carries its recap', () => {
    registry.recordStop(SESSION, {
      backgroundTasks: [],
      sessionCrons: [],
      terminalReason: 'aborted_streaming',
      lastAssistantMessage: 'Implemented the fix.',
    });
    const [event] = transformer.transform(
      { ...RESULT, terminal_reason: 'completed' } satisfies SDKResultMessage,
      helpers,
      SESSION as never,
    );
    expect(event).toMatchObject({
      terminalReason: 'completed',
      lastAssistantMessage: 'Implemented the fix.',
    });
  });

  it('settles an error result with its authoritative reason and failure recap', () => {
    registry.recordFailure(SESSION, {
      error: 'rate_limit',
      terminalReason: 'model_error',
      lastAssistantMessage: 'Partial response.',
    });
    const result: SDKResultMessage = {
      ...RESULT,
      subtype: 'error_during_execution',
      errors: ['Rate limited'],
      terminal_reason: 'api_error',
    };
    const [event] = transformer.transform(result, helpers, SESSION as never);
    expect(event).toMatchObject({
      phase: 'failed',
      terminalReason: 'api_error',
      lastAssistantMessage: 'Partial response.',
    });
  });

  it.each([
    ['idle', [], []],
    ['awaiting-background', [TASK], []],
    ['awaiting-background', [TASK], [CRON]],
    ['sleeping', [], [CRON]],
  ] as const)(
    'settles to %s from the Stop snapshot',
    (phase, backgroundTasks, sessionCrons) => {
      registry.markGenerating(SESSION);
      registry.recordStop(SESSION, {
        backgroundTasks,
        sessionCrons,
        terminalReason: 'completed',
      });
      const [event] = transformer.transform(RESULT, helpers, SESSION as never);
      expect(event).toMatchObject({
        eventType: 'turn_state',
        phase,
        backgroundTasks,
        sessionCrons,
        terminalReason: 'completed',
      });
    },
  );

  it('settles to failed when a StopFailure was recorded, whatever Stop said', () => {
    registry.markGenerating(SESSION);
    registry.recordStop(SESSION, {
      backgroundTasks: [TASK],
      sessionCrons: [CRON],
      terminalReason: 'completed',
    });
    registry.recordFailure(SESSION, {
      error: 'rate_limit',
      terminalReason: 'model_error',
    });
    const [event] = transformer.transform(RESULT, helpers, SESSION as never);
    expect(event).toMatchObject({
      phase: 'failed',
      error: 'rate_limit',
      terminalReason: 'model_error',
    });
  });

  it('settles to idle when no Stop hook fired for the turn', () => {
    registry.markGenerating(SESSION);
    const [event] = transformer.transform(RESULT, helpers, SESSION as never);
    expect(event).toMatchObject({
      phase: 'idle',
      terminalReason: null,
      lastAssistantMessage: null,
    });
    expect(registry.get(SESSION)?.terminalReason).toBeNull();
  });

  it('bumps the revision past the generating state', () => {
    const generating = registry.markGenerating(SESSION);
    const [event] = transformer.transform(RESULT, helpers, SESSION as never);
    expect((event as { revision: number }).revision).toBe(
      (generating?.revision ?? 0) + 1,
    );
  });
});
