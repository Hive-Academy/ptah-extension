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
import {
  NEUTRAL_PEER_LABEL,
  SdkMessageTransformer,
} from './sdk-message-transformer';
import { LiveUsageTracker } from './helpers/live-usage-tracker';
import { SessionTurnStateRegistry } from './helpers/session-turn-state.registry';
import { CompactionBoundaryGenerationRegistry } from './helpers/compaction-boundary-generation-registry';

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
      new CompactionBoundaryGenerationRegistry(),
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
      // The origin is logged so "was this a peer turn we dropped?" is
      // answerable from the log alone.
      { originKind: undefined },
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

  it('keeps dropping a replay whose origin is human — the drop is load-bearing', () => {
    // `--replay-user-messages` is on and the frontend adds the user bubble
    // optimistically, so un-dropping this double-renders every typed prompt.
    const { transformer } = build();

    const events = transformer.transform({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      session_id: SESSION_ID,
      isReplay: true,
      origin: { kind: 'human' },
    } as never);

    expect(events).toEqual([]);
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

/**
 * Inbound peer messages (TASK_2026_402).
 *
 * A turn injected by ANOTHER session arrives on this stream as a user turn —
 * usually a replay, which the branch above drops unconditionally. The origin
 * check therefore sits ahead of BOTH user paths. What it must not do is
 * un-drop the ordinary replays: those are the user's own typed prompts coming
 * back, already rendered optimistically by the frontend.
 */
describe('SdkMessageTransformer — inbound peer messages', () => {
  function peerReplay(origin: unknown): unknown {
    return {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'status please' }],
      },
      session_id: SESSION_ID,
      uuid: 'f1e2d3c4-0000-4000-8000-000000000001',
      parent_tool_use_id: null,
      isReplay: true,
      origin,
    };
  }

  it('renders a replay with a peer origin as the full event triple', () => {
    const { transformer, logger } = build();

    const events = transformer.transform(
      peerReplay({ kind: 'peer', from: '12345', name: 'reviewer' }) as never,
    );

    expect(events.map((e) => e.eventType)).toEqual([
      'message_start',
      'text_delta',
      'message_complete',
    ]);
    expect(events[0]).toMatchObject({
      role: 'user',
      inboundPeer: { label: 'reviewer' },
    });
    expect(logger.debug).toHaveBeenCalledWith(
      '[SdkMessageTransformer] Rendering inbound peer message',
      { label: 'reviewer', isReplay: true },
    );
  });

  it('renders the neutral label when the peer reports no name', () => {
    const { transformer } = build();

    const events = transformer.transform(
      peerReplay({ kind: 'peer', from: '12345' }) as never,
    );

    expect(events[0]).toMatchObject({
      inboundPeer: { label: NEUTRAL_PEER_LABEL },
    });
  });

  it('never uses the sender-authored `from` as the label', () => {
    const { transformer } = build();

    const events = transformer.transform(
      peerReplay({ kind: 'peer', from: 'admin-session' }) as never,
    );

    expect(JSON.stringify(events)).not.toContain('admin-session');
  });

  it('labels a LIVE user message carrying a peer origin', () => {
    const { transformer } = build();

    const events = transformer.transform({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'ping' }] },
      session_id: SESSION_ID,
      uuid: 'f1e2d3c4-0000-4000-8000-000000000002',
      parent_tool_use_id: null,
      origin: { kind: 'peer', from: '999', name: 'planner' },
    } as never);

    expect(events[0]).toMatchObject({ inboundPeer: { label: 'planner' } });
  });

  it('returns [] for a replay with NO origin — the drop is not blanket-removed', () => {
    const { transformer } = build();

    expect(transformer.transform(peerReplay(undefined) as never)).toEqual([]);
  });

  it.each([['channel'], ['coordinator'], ['task-notification']])(
    'returns [] for a replay whose origin kind is %s',
    (kind) => {
      const { transformer } = build();

      expect(
        transformer.transform(peerReplay({ kind, server: 'x' }) as never),
      ).toEqual([]);
    },
  );

  it('leaves an ordinary live user turn unlabelled', () => {
    const { transformer } = build();

    const events = transformer.transform({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'ping' }] },
      session_id: SESSION_ID,
      uuid: 'f1e2d3c4-0000-4000-8000-000000000003',
      parent_tool_use_id: null,
    } as never);

    expect(events[0]).not.toHaveProperty('inboundPeer');
  });
});
