import 'reflect-metadata';

import { MESSAGE_TYPES, type FlatStreamEventUnion } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';

import {
  ChatStreamDeliveryCoordinator,
  type ChatStreamDeliveryCoordinatorOptions,
} from './chat-stream-delivery-coordinator.service';
import type { WebviewManager } from './chat-stream-broadcaster.service';

interface Sent {
  readonly type: string;
  readonly payload: unknown;
}

const TAB_ID = 'tab-1';
const SESSION_ID = 'session-1';

const event = (index: number): FlatStreamEventUnion =>
  ({
    id: `event-${index}`,
    eventType: 'text_delta',
    sessionId: SESSION_ID,
    timestamp: index,
    messageId: 'message-1',
    delta: String(index),
    blockIndex: 0,
  });

function makeCoordinator(options?: ChatStreamDeliveryCoordinatorOptions) {
  const sent: Sent[] = [];
  const webviewManager: WebviewManager = {
    sendMessage: jest.fn().mockResolvedValue(undefined),
    broadcastMessage: jest.fn(async (type: string, payload: unknown) => {
      sent.push({ type, payload });
    }),
  };
  const logger = { warn: jest.fn() } as unknown as Logger;
  const coordinator = new ChatStreamDeliveryCoordinator(logger, webviewManager);
  coordinator.configureForTest(options ?? {});
  return { coordinator, sent };
}

describe('ChatStreamDeliveryCoordinator', () => {
  it('keeps v1 clients legacy-visible and preserves batch-before-terminal order', async () => {
    const { coordinator, sent } = makeCoordinator();

    coordinator.publish(TAB_ID, SESSION_ID, event(1));
    coordinator.publish(TAB_ID, SESSION_ID, event(2));
    await coordinator.publishTerminal(TAB_ID, MESSAGE_TYPES.CHAT_COMPLETE, {
      tabId: TAB_ID,
    });

    expect(sent.map(({ type }) => type)).toEqual([
      MESSAGE_TYPES.BATCH,
      MESSAGE_TYPES.CHAT_COMPLETE,
    ]);
  });

  it('does not send hidden chunks and reveals one ordered snapshot', async () => {
    const { coordinator, sent } = makeCoordinator();

    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [] });
    coordinator.publish(TAB_ID, SESSION_ID, event(1));
    coordinator.publish(TAB_ID, SESSION_ID, event(2));
    expect(sent).toHaveLength(0);

    await coordinator.updateViewport({
      protocolVersion: 2,
      focusedTabId: TAB_ID,
      visibleTabIds: [TAB_ID],
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe(MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT);
    expect(sent[0].payload).toMatchObject({
      protocolVersion: 2,
      tabId: TAB_ID,
      fromSequence: 1,
      toSequence: 2,
      events: [event(1), event(2)],
    });
  });

  it('drops an overflowing hidden tail and requests resync on reveal', async () => {
    const { coordinator, sent } = makeCoordinator({ maxTailEvents: 1 });

    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [] });
    coordinator.publish(TAB_ID, SESSION_ID, event(1));
    coordinator.publish(TAB_ID, SESSION_ID, event(2));
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });

    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toMatchObject({
      protocolVersion: 2,
      tabId: TAB_ID,
      fromSequence: 2,
      toSequence: 2,
      resyncRequired: true,
    });
    expect(sent[0].payload).not.toHaveProperty('events');
    expect(coordinator.getMetrics()).toMatchObject({
      suppressedHiddenEvents: 2,
      snapshotOverflowResyncs: 1,
    });
  });

  it('delivers a deferred hidden terminal after its reveal snapshot', async () => {
    const { coordinator, sent } = makeCoordinator();

    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [] });
    coordinator.publish(TAB_ID, SESSION_ID, event(1));
    await coordinator.publishTerminal(TAB_ID, MESSAGE_TYPES.CHAT_ERROR, {
      tabId: TAB_ID,
      error: 'failed',
    });
    expect(sent).toHaveLength(0);

    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });

    expect(sent.map(({ type }) => type)).toEqual([
      MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT,
      MESSAGE_TYPES.CHAT_ERROR,
    ]);
  });
});
