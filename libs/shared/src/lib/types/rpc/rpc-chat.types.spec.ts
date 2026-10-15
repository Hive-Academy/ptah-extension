/**
 * `rpc-chat.types` — `chat:resume` reply shape pin (TASK_2026_437 C15, INV-9).
 *
 * A tile open used to receive the transcript twice: the replayable `events`
 * and a text-only `messages` projection of the same parse. The renderer
 * replays `events` only, so the duplicate is gone from the contract. ts-jest
 * type-checks this file, so re-adding the key fails the suite at compile time.
 */

import type {
  ChatContinueParams,
  ChatResumeParams,
  ChatResumeResult,
  ChatSetStreamViewportParams,
  ChatSetStreamViewportResult,
} from './rpc-chat.types';
import type { SessionRewindParams } from './rpc-session.types';
import type { SessionId } from '../branded.types';

describe('optional persona RPC fields', () => {
  it('accepts a per-tab persona and leaves it absent by default', () => {
    const sessionId = '11111111-1111-4111-8111-111111111111' as SessionId;
    const continuing: ChatContinueParams = { sessionId, tabId: 'tab', prompt: 'hello' };
    const resuming: ChatResumeParams = { sessionId, tabId: 'tab' };
    const rewinding: SessionRewindParams = { sessionId, userMessageId: 'message' };
    expect(continuing).not.toHaveProperty('systemPrompt');
    expect(resuming).not.toHaveProperty('systemPrompt');
    expect(rewinding).not.toHaveProperty('systemPrompt');
    continuing.systemPrompt = 'persona';
    resuming.systemPrompt = 'persona';
    rewinding.systemPrompt = 'persona';
    expect([continuing.systemPrompt, resuming.systemPrompt, rewinding.systemPrompt]).toEqual([
      'persona', 'persona', 'persona',
    ]);
  });
});

type ChatResumeResultKeys = keyof ChatResumeResult;
type HasNoMessagesKey = 'messages' extends ChatResumeResultKeys ? false : true;
type HasEventsKey = 'events' extends ChatResumeResultKeys ? true : false;

describe('ChatResumeResult', () => {
  it('carries the replayable events and no duplicate messages transcript', () => {
    const hasNoMessagesKey: HasNoMessagesKey = true;
    const hasEventsKey: HasEventsKey = true;

    const reply: ChatResumeResult = { success: true, events: [] };

    expect(hasNoMessagesKey).toBe(true);
    expect(hasEventsKey).toBe(true);
    expect(reply).not.toHaveProperty('messages');
  });
});

describe('ChatSetStreamViewport contract', () => {
  it('pins the additive v2 negotiation literals', () => {
    const params: ChatSetStreamViewportParams = {
      protocolVersion: 2,
      focusedTabId: 'tab-1',
      visibleTabIds: ['tab-1'],
    };
    const result: ChatSetStreamViewportResult = {
      acceptedProtocolVersion: 2,
    };

    expect(params.protocolVersion).toBe(2);
    expect(result.acceptedProtocolVersion).toBe(2);
  });
});
