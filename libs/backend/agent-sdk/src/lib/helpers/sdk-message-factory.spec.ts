/**
 * Unit specs for `SdkMessageFactory.createUserMessage` — origin stamping.
 *
 * The factory is the single choke point for every interactive user turn, so it
 * MUST stamp `origin: { kind: 'human' }` by default. Headless/gateway/peer/
 * coordinator callers may override the origin; that override must be respected
 * verbatim on the produced SDK message.
 */

import 'reflect-metadata';

import { SdkMessageFactory } from './sdk-message-factory';
import type { SessionId } from '@ptah-extension/shared';
import type { SDKMessageOrigin } from '../types/sdk-types/claude-sdk.types';

function makeFactory(): SdkMessageFactory {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const attachmentProcessor = {
    processAttachments: jest.fn().mockResolvedValue([]),
  };
  const ctor = SdkMessageFactory as unknown as new (
    ...args: unknown[]
  ) => SdkMessageFactory;
  return new ctor(logger, attachmentProcessor);
}

const SESSION_ID = 'sess-1' as unknown as SessionId;

describe('SdkMessageFactory.createUserMessage — origin stamping', () => {
  it("defaults origin to { kind: 'human' } for an interactive user turn", async () => {
    const factory = makeFactory();
    const msg = await factory.createUserMessage({
      content: 'hello',
      sessionId: SESSION_ID,
    });
    expect(msg.origin).toEqual({ kind: 'human' });
  });

  it('stamps human origin even when attachments are present', async () => {
    const factory = makeFactory();
    const msg = await factory.createUserMessage({
      content: 'analyze',
      sessionId: SESSION_ID,
      images: [],
    });
    expect(msg.origin).toEqual({ kind: 'human' });
  });

  it('respects a caller-supplied channel origin (gateway path)', async () => {
    const factory = makeFactory();
    const origin: SDKMessageOrigin = { kind: 'channel', server: 'telegram' };
    const msg = await factory.createUserMessage({
      content: 'from a chat gateway',
      sessionId: SESSION_ID,
      origin,
    });
    expect(msg.origin).toEqual(origin);
  });

  it('respects a caller-supplied peer origin (A2A path)', async () => {
    const factory = makeFactory();
    const origin: SDKMessageOrigin = { kind: 'peer', from: 'agent-42' };
    const msg = await factory.createUserMessage({
      content: 'from a peer agent',
      sessionId: SESSION_ID,
      origin,
    });
    expect(msg.origin).toEqual(origin);
  });
});
