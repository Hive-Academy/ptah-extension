import 'reflect-metadata';
import { SessionId } from '@ptah-extension/shared';
import {
  CodexChatSessionControls,
  type TrackedSession,
} from './codex-chat-session-controls';
import type { CodexChatDriverGate } from './codex-chat-adapter';

describe('Codex native driver lease', () => {
  it('releases exactly once when a published session is closed repeatedly', async () => {
    const id = SessionId.from('11111111-1111-4111-8111-111111111111');
    const release = jest.fn();
    const gate: CodexChatDriverGate = {
      admit: jest.fn(async () => ({ release })),
    };
    const lease = await gate.admit(id, { consumer: 'chat', kind: 'start' });
    const contextClose = jest.fn(async () => undefined);
    const scopeDispose = jest.fn(async () => undefined);
    const session = {
      id,
      lease,
      context: { close: contextClose },
      scope: { dispose: scopeDispose },
      sink: { dispose: jest.fn(), endTurn: jest.fn() },
      abort: new AbortController(),
    } as unknown as TrackedSession;
    const sessions = new Map([[id, session]]);
    const controls = new CodexChatSessionControls({
      sessions,
      opening: new Map(),
      ports: { sessions: { opened: jest.fn(), closed: jest.fn() } },
      safe: async (_operation: string, action: () => Promise<unknown>) =>
        action(),
    } as unknown as ConstructorParameters<typeof CodexChatSessionControls>[0]);
    await controls.close(session);
    await controls.close(session);
    expect(contextClose).toHaveBeenCalledTimes(1);
    expect(scopeDispose).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
