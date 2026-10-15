import 'reflect-metadata';

import { MESSAGE_TYPES, type FlatStreamEventUnion } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';

import { ChatStreamDeliveryCoordinator } from './chat-stream-delivery-coordinator.service';
import type { WebviewManager } from './chat-stream-broadcaster.service';

describe('workspace switch during a long assistant message', () => {
  it('preserves the in-flight message start and hidden text when the tail exceeds 256 events', async () => {
    const sent: Array<{ type: string; payload: unknown }> = [];
    const webviewManager: WebviewManager = {
      sendMessage: jest.fn().mockResolvedValue(undefined),
      broadcastMessage: jest.fn(async (type: string, payload: unknown) => {
        sent.push({ type, payload });
      }),
    };
    const coordinator = new ChatStreamDeliveryCoordinator(
      { warn: jest.fn() } as unknown as Logger,
      webviewManager,
    );
    const tabId = 'tab-A';
    const sessionId = 'session-A';
    const messageId = 'in-flight-assistant';
    const start = {
      id: 'start', eventType: 'message_start', timestamp: 1,
      sessionId, messageId, role: 'assistant', source: 'stream',
    } as FlatStreamEventUnion;

    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [] });
    coordinator.publish(tabId, sessionId, start);
    for (let index = 0; index < 256; index++) {
      coordinator.publish(tabId, sessionId, {
        id: `delta-${index}`, eventType: 'text_delta', timestamp: index + 2,
        sessionId, messageId, blockIndex: 0, delta: 'x', source: 'stream',
      } as FlatStreamEventUnion);
    }
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [tabId] });

    const snapshot = sent.find(({ type }) => type === MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT)?.payload as {
      events?: FlatStreamEventUnion[];
    } | undefined;
    expect(snapshot?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'message_start', messageId }),
      expect.objectContaining({ eventType: 'text_delta', messageId, id: 'delta-255' }),
    ]));
  });
});
