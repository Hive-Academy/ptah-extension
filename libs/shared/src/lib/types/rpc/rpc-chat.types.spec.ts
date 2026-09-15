/**
 * `rpc-chat.types` — `chat:resume` reply shape pin (TASK_2026_437 C15, INV-9).
 *
 * A tile open used to receive the transcript twice: the replayable `events`
 * and a text-only `messages` projection of the same parse. The renderer
 * replays `events` only, so the duplicate is gone from the contract. ts-jest
 * type-checks this file, so re-adding the key fails the suite at compile time.
 */

import type { ChatResumeResult } from './rpc-chat.types';

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
