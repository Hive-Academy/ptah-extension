import {
  SessionId,
  createExecutionChatMessage,
  type ExecutionChatMessage,
} from '@ptah-extension/shared';
import { insertInboundPeerMessage } from './inbound-peer-message';

const sessionId = SessionId.create();

function user(id: string, peer = false): ExecutionChatMessage {
  return createExecutionChatMessage({
    id,
    role: 'user',
    rawContent: id,
    sessionId,
    ...(peer ? { inboundPeer: { label: 'lane' } } : {}),
  });
}

function assistant(id: string): ExecutionChatMessage {
  return createExecutionChatMessage({
    id,
    role: 'assistant',
    rawContent: id,
    sessionId,
  });
}

describe('insertInboundPeerMessage', () => {
  it('places before the first live pending prompt when it precedes the hint', () => {
    const messages = [assistant('reply'), user('old'), user('live'), user('hint')];
    const result = insertInboundPeerMessage(
      messages,
      user('peer', true),
      new Set(['live']),
      'hint',
    );
    expect(result?.map((m) => m.id)).toEqual([
      'reply', 'old', 'peer', 'live', 'hint',
    ]);
  });

  it('places before the hinted persisted prompt after a renderer reload', () => {
    const messages = [assistant('reply'), user('old'), user('hint'), user('later')];
    const result = insertInboundPeerMessage(
      messages,
      user('peer', true),
      new Set(),
      'hint',
    );
    expect(result?.map((m) => m.id)).toEqual([
      'reply', 'old', 'peer', 'hint', 'later',
    ]);
  });

  it('uses the hint when it precedes a live pending prompt', () => {
    const messages = [user('hint'), user('live')];
    expect(
      insertInboundPeerMessage(messages, user('peer', true), new Set(['live']), 'hint')
        ?.map((m) => m.id),
    ).toEqual(['peer', 'hint', 'live']);
  });

  it('ignores a hint outside the user tail or pointing at a peer', () => {
    const messages = [user('old'), assistant('reply'), user('peer-old', true)];
    expect(
      insertInboundPeerMessage(messages, user('peer', true), new Set(), 'old')
        ?.map((m) => m.id),
    ).toEqual(['old', 'reply', 'peer-old', 'peer']);
    expect(
      insertInboundPeerMessage(messages, user('peer', true), new Set(), 'peer-old')
        ?.map((m) => m.id),
    ).toEqual(['old', 'reply', 'peer-old', 'peer']);
  });

  it('ignores unknown hints and deduplicates a repeated peer start', () => {
    const messages = [user('old')];
    expect(
      insertInboundPeerMessage(messages, user('peer', true), new Set(), 'missing')
        ?.map((m) => m.id),
    ).toEqual(['old', 'peer']);
    expect(
      insertInboundPeerMessage(messages, user('old', true), new Set(), 'missing'),
    ).toBeNull();
  });
});
