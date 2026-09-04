/**
 * SdkMessageTransformer — replayed user messages (TASK_2026_350).
 *
 * `isUserMessage` excludes `isReplay:true` by construction
 * (`claude-sdk.types.ts:371`) and `isReplayMessage`, defined right beside it,
 * was referenced nowhere. Every replayed transcript turn therefore fell past
 * all twelve narrowing branches and hit the `Unknown message type` WARN — the
 * `<command-message>orchestrate</command-message>` line at log.log:2376 being
 * the visible instance of what a resumed session does to its whole history.
 *
 * The messages were dropped before this change and are dropped after it: Ptah
 * renders history from JSONL via `chat:resume`, so re-emitting a replayed turn
 * would double-render it. These specs pin the CLASSIFICATION — zero events AND
 * zero warns — so a future reader cannot mistake the silence for a gap.
 */

import 'reflect-metadata';

import type {
  Logger,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import type { AuthEnv } from '@ptah-extension/shared';
import { findModelPricing } from '@ptah-extension/shared';

import type { IModelResolver } from './auth-env.port';
import type { SessionLifecycleManager } from './helpers/session-lifecycle-manager';
import { SdkMessageTransformer } from './sdk-message-transformer';
import { LiveUsageTracker } from './helpers/live-usage-tracker';
import { SessionTurnStateRegistry } from './helpers/session-turn-state.registry';

const SESSION_ID = 'b5399ba8-e06d-417c-bac4-aba5add0555c';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function build(): {
  transformer: SdkMessageTransformer;
  logger: jest.Mocked<Logger>;
} {
  const logger = makeLogger();
  const subagentRegistry = {
    pruneSession: jest.fn(),
    markPendingBackground: jest.fn(),
    setTaskId: jest.fn(),
  } as unknown as SubagentRegistryService;
  const modelResolver = {
    resolveForPricing: jest.fn().mockImplementation((m: string) => m),
    isSubscriptionCovered: jest.fn().mockReturnValue(false),
    resolveForCost: jest.fn().mockImplementation((m: string) => ({
      modelId: m,
      pricing: findModelPricing(m),
      subscriptionCovered: false,
    })),
  } as unknown as IModelResolver;
  const lifecycle = {
    getActiveSessionIds: jest.fn().mockReturnValue([SESSION_ID]),
  } as unknown as SessionLifecycleManager;

  return {
    logger,
    transformer: new SdkMessageTransformer(
      logger,
      { provider: 'anthropic' } as unknown as AuthEnv,
      subagentRegistry,
      modelResolver,
      lifecycle,
      new LiveUsageTracker(),
      new SessionTurnStateRegistry(),
    ),
  };
}

describe('SdkMessageTransformer — replayed user messages (TASK_2026_350)', () => {
  /**
   * The exact payload from log.log:2376, minus nothing that the narrowing
   * reads. `content` is a bare string (not a block array), which is the shape
   * the CLI replays a slash-command expansion in.
   */
  const REPLAYED_SLASH_COMMAND = {
    type: 'user',
    message: {
      role: 'user',
      content:
        '<command-message>orchestrate</command-message>\n' +
        '<command-name>/orchestrate</command-name>\n' +
        '<command-args>asset-audit</command-args>',
    },
    session_id: SESSION_ID,
    parent_tool_use_id: null,
    uuid: 'b8f3139a-04c0-4a94-ae79-e3a2465a491a',
    timestamp: '2026-08-28T18:14:31.010Z',
    isReplay: true,
  } as unknown;

  it('emits no events and logs no warning for the replayed <command-message> turn', () => {
    const { transformer, logger } = build();

    const events = transformer.transform(REPLAYED_SLASH_COMMAND as never);

    expect(events).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      '[SdkMessageTransformer] Skipping replayed user message (history already rendered from JSONL)',
    );
  });

  it('skips a replayed ORDINARY user turn too — the defect was the isReplay flag, not the command content', () => {
    const { transformer, logger } = build();

    const events = transformer.transform({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'check the current project' }],
      },
      session_id: SESSION_ID,
      isReplay: true,
    } as never);

    expect(events).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('still transforms a NON-replayed user turn (the guard must not swallow live input)', () => {
    const { transformer, logger } = build();

    const events = transformer.transform({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'audit the sprite atlas' }],
      },
      session_id: SESSION_ID,
    } as never);

    expect(events.length).toBeGreaterThan(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('still warns for a genuinely unknown message type', () => {
    const { transformer, logger } = build();

    const events = transformer.transform({
      type: 'some_future_sdk_message',
      session_id: SESSION_ID,
    } as never);

    expect(events).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      '[SdkMessageTransformer] Unknown message type',
      expect.objectContaining({ type: 'some_future_sdk_message' }),
    );
  });
});
