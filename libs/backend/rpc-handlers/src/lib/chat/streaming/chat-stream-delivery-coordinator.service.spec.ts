import 'reflect-metadata';

import { MESSAGE_TYPES, type FlatStreamEventUnion } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';

import {
  ChatStreamDeliveryCoordinator,
  type ChatStreamDeliveryCoordinatorOptions,
} from './chat-stream-delivery-coordinator.service';
import type { WebviewManager } from './chat-stream-broadcaster.service';
import { LiveMessageProjection } from './live-message-projection';

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

function makeBlockedCoordinator() {
  const sent: Sent[] = [];
  let releaseGate: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  const webviewManager: WebviewManager = {
    sendMessage: jest.fn().mockResolvedValue(undefined),
    broadcastMessage: jest.fn(async (type: string, payload: unknown) => {
      sent.push({ type, payload });
      if (type === MESSAGE_TYPES.CHAT_CHUNK) await gate;
    }),
  };
  const coordinator = new ChatStreamDeliveryCoordinator(
    { warn: jest.fn() } as unknown as Logger, webviewManager,
  );
  return {
    coordinator,
    sent,
    release: () => {
      if (!releaseGate) throw new Error('Transport gate was not initialized');
      releaseGate();
    },
  };
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
      resyncRequired: true,
    });
    expect((sent[0].payload as { toSequence: number }).toSequence).toBeGreaterThan(2);
    expect((sent[0].payload as { fromSequence: number; toSequence: number }).fromSequence)
      .toBe((sent[0].payload as { toSequence: number }).toSequence);
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

  it('keeps snapshot sequences increasing after visible terminal deletes tab state', async () => {
    const { coordinator, sent } = makeCoordinator();
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [] });
    coordinator.publish(TAB_ID, SESSION_ID, event(1));
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });
    await coordinator.publishTerminal(TAB_ID, MESSAGE_TYPES.CHAT_COMPLETE, { tabId: TAB_ID });
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [] });
    coordinator.publish(TAB_ID, SESSION_ID, event(2));
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });
    const snapshots = sent.filter(({ type }) => type === MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT);
    expect((snapshots[1].payload as { toSequence: number }).toSequence).toBeGreaterThan(
      (snapshots[0].payload as { toSequence: number }).toSequence,
    );
  });

  it('seeds pre-hide content on overflow with complete block counts', async () => {
    const { coordinator, sent } = makeCoordinator({ maxTailEvents: 1 });
    const start = {
      id: 'start', eventType: 'message_start', timestamp: 1,
      messageId: 'message-1', role: 'assistant', source: 'stream',
    } as FlatStreamEventUnion;
    const streamText = (id: string): FlatStreamEventUnion => ({
      id, eventType: 'text_delta', timestamp: 2,
      messageId: 'message-1', blockIndex: 0, delta: id, source: 'stream',
    });
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });
    coordinator.publish(TAB_ID, SESSION_ID, {
      id: 'turn', eventType: 'turn_state', timestamp: 0,
      messageId: 'turn', phase: 'generating', revision: 1,
      backgroundTasks: [], sessionCrons: [], terminalReason: null,
    });
    coordinator.publish(TAB_ID, SESSION_ID, start);
    coordinator.publish(TAB_ID, SESSION_ID, streamText('before'));
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [] });
    coordinator.publish(TAB_ID, SESSION_ID, streamText('hidden'));
    coordinator.publish(TAB_ID, SESSION_ID, {
      id: 'result', eventType: 'tool_result', timestamp: 3,
      messageId: 'other', toolCallId: 'tool', output: 'x', isError: false,
    });
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });
    const snapshot = sent.find(({ type }) => type === MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT)?.payload;
    expect(snapshot).toMatchObject({
      resyncRequired: true,
      liveSeedBlocks: { 'message-1': 0 },
      liveSeed: [
        { eventType: 'turn_state' },
        { eventType: 'message_start' },
        { eventType: 'text_delta', delta: 'beforehidden' },
      ],
    });
  });

  it('injects a deferred anchor only before later content', async () => {
    const { coordinator, sent } = makeCoordinator();
    const start = {
      id: 'start', eventType: 'message_start', timestamp: 1,
      messageId: 'message-1', role: 'assistant', source: 'stream',
    } as FlatStreamEventUnion;
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [] });
    coordinator.publish(TAB_ID, SESSION_ID, start);
    await coordinator.updateViewport({
      protocolVersion: 2, visibleTabIds: [TAB_ID], resyncTabIds: [TAB_ID],
    });
    expect(sent[0].payload).toMatchObject({
      resyncRequired: true, liveSeedBlocks: { 'message-1': 0 },
    });
    expect(sent[0].payload).not.toHaveProperty('liveSeed');
    coordinator.publish(TAB_ID, SESSION_ID, {
      id: 'content', eventType: 'text_delta', timestamp: 2,
      messageId: 'message-1', blockIndex: 0, delta: 'x', source: 'stream',
    });
    await coordinator.flushBeforeTerminal(TAB_ID);
    const chunks = sent.filter(({ type }) => type === MESSAGE_TYPES.BATCH);
    expect(chunks).toHaveLength(1);
    expect((chunks[0].payload as { events: Array<{ payload: { event: FlatStreamEventUnion } }> }).events
      .map(({ payload }) => payload.event.eventType)).toEqual(['message_start', 'text_delta']);
  });

  it('requested resync includes visible chunks already delivered and orders later chunks', async () => {
    const { coordinator, sent } = makeCoordinator();
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });
    coordinator.publish(TAB_ID, SESSION_ID, {
      id: 'start', eventType: 'message_start', timestamp: 1,
      messageId: 'message-1', role: 'assistant', source: 'stream',
    });
    for (let index = 0; index < 2001; index++) {
      coordinator.publish(TAB_ID, SESSION_ID, {
        id: `delta-${index}`, eventType: 'text_delta', timestamp: index + 2,
        messageId: 'message-1', blockIndex: 0, delta: 'x', source: 'stream',
      });
    }
    await coordinator.updateViewport({
      protocolVersion: 2, visibleTabIds: [TAB_ID], resyncTabIds: [TAB_ID],
    });
    const snapshotIndex = sent.findIndex(({ type }) => type === MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT);
    expect(snapshotIndex).toBeGreaterThan(0);
    expect(sent[snapshotIndex].payload).toMatchObject({
      resyncRequired: true,
      liveSeedBlocks: { 'message-1': 0 },
      liveSeed: [
        { eventType: 'message_start' },
        { eventType: 'text_delta', id: 'delta-2000', delta: 'x'.repeat(2001) },
      ],
    });
    coordinator.publish(TAB_ID, SESSION_ID, event(3000));
    await coordinator.flushBeforeTerminal(TAB_ID);
    expect(sent[snapshotIndex + 1].type).toBe(MESSAGE_TYPES.CHAT_CHUNK);
  });

  it('defers a hidden requested resync and supports a tab with no prior state', async () => {
    const { coordinator, sent } = makeCoordinator();
    await coordinator.updateViewport({
      protocolVersion: 2, visibleTabIds: [], resyncTabIds: [TAB_ID],
    });
    expect(sent).toHaveLength(0);
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });
    expect(sent[0].payload).toMatchObject({ resyncRequired: true });
    expect(sent[0].payload).not.toHaveProperty('liveSeed');
  });

  it('includes events published during a pending reveal flush before the snapshot', async () => {
    const { coordinator, sent, release } = makeBlockedCoordinator();
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });
    coordinator.publish(TAB_ID, SESSION_ID, event(0));
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [] });
    coordinator.publish(TAB_ID, SESSION_ID, event(1));
    const revealing = coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });
    coordinator.publish(TAB_ID, SESSION_ID, event(2));
    expect(sent.map(({ type }) => type)).toEqual([MESSAGE_TYPES.CHAT_CHUNK]);
    release();
    await revealing;
    expect(sent[1].type).toBe(MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT);
    expect(sent[1].payload).toMatchObject({ events: [event(1), event(2)] });
  });

  it('does not reveal a tab after a newer viewport hides it', async () => {
    const { coordinator, sent, release } = makeBlockedCoordinator();
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });
    coordinator.publish(TAB_ID, SESSION_ID, event(0));
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [] });
    coordinator.publish(TAB_ID, SESSION_ID, event(1));
    const revealing = coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [] });
    release();
    await revealing;
    expect(sent.map(({ type }) => type)).toEqual([MESSAGE_TYPES.CHAT_CHUNK]);
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });
    expect(sent[1].payload).toMatchObject({ events: [event(1)] });
  });

  it('drops a deferred anchor at stream completion without injecting it', async () => {
    const { coordinator, sent } = makeCoordinator();
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [] });
    coordinator.publish(TAB_ID, SESSION_ID, {
      id: 'start', eventType: 'message_start', timestamp: 1,
      messageId: 'message-1', role: 'assistant', source: 'stream',
    });
    await coordinator.updateViewport({
      protocolVersion: 2, visibleTabIds: [TAB_ID], resyncTabIds: [TAB_ID],
    });
    coordinator.publish(TAB_ID, SESSION_ID, {
      id: 'done', eventType: 'message_complete', timestamp: 2,
      messageId: 'message-1', source: 'stream',
    });
    await coordinator.flushBeforeTerminal(TAB_ID);
    expect(sent.map(({ type }) => type)).toEqual([
      MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT, MESSAGE_TYPES.CHAT_CHUNK,
    ]);
    expect((sent[1].payload as { event: FlatStreamEventUnion }).event.eventType)
      .toBe('message_complete');
  });

  it('keeps surface events out of the live projection', async () => {
    const { coordinator, sent } = makeCoordinator();
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });
    coordinator.publish(TAB_ID, SESSION_ID, {
      id: 'start', eventType: 'message_start', timestamp: 1,
      messageId: 'message-1', role: 'assistant', source: 'stream',
    }, true);
    await coordinator.updateViewport({
      protocolVersion: 2, visibleTabIds: [TAB_ID], resyncTabIds: [TAB_ID],
    });
    const snapshot = sent.find(({ type }) => type === MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT)?.payload;
    expect(snapshot).not.toHaveProperty('liveSeed');
    expect(snapshot).not.toHaveProperty('liveSeedBlocks');
  });

  it('assigns a fresh sequence to repeated seeded resyncs without new events', async () => {
    const { coordinator, sent } = makeCoordinator();
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });
    coordinator.publish(TAB_ID, SESSION_ID, {
      id: 'start', eventType: 'message_start', timestamp: 1,
      messageId: 'message-1', role: 'assistant', source: 'stream',
    });
    coordinator.publish(TAB_ID, SESSION_ID, {
      id: 'live', eventType: 'text_delta', timestamp: 2,
      messageId: 'message-1', blockIndex: 0, delta: 'live', source: 'stream',
    });
    const request = () => coordinator.updateViewport({
      protocolVersion: 2, visibleTabIds: [TAB_ID], resyncTabIds: [TAB_ID],
    });
    await request();
    await request();
    const snapshots = sent.filter(({ type }) => type === MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT)
      .map(({ payload }) => payload as { fromSequence: number; toSequence: number; liveSeed: unknown[] });
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].toSequence).toBeGreaterThan(snapshots[0].toSequence);
    expect(snapshots[1].fromSequence).toBe(snapshots[1].toSequence);
    expect(snapshots[1].liveSeed).toEqual(snapshots[0].liveSeed);
  });

  it('assigns a fresh sequence to repeated empty visible resyncs', async () => {
    const { coordinator, sent } = makeCoordinator();
    for (let index = 0; index < 2; index++) {
      await coordinator.updateViewport({
        protocolVersion: 2, visibleTabIds: [TAB_ID], resyncTabIds: [TAB_ID],
      });
    }
    const snapshots = sent.map(({ payload }) => payload as { toSequence: number });
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].toSequence).toBeGreaterThan(snapshots[0].toSequence);
  });

  it('keeps hidden tail and terminal received during an awaited reveal send', async () => {
    const sent: Sent[] = [];
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const sending = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const coordinator = new ChatStreamDeliveryCoordinator(
      { warn: jest.fn() } as unknown as Logger,
      {
        sendMessage: jest.fn().mockResolvedValue(undefined),
        broadcastMessage: jest.fn(async (type: string, payload: unknown) => {
          sent.push({ type, payload });
          if (type === MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT && sent.length === 1) {
            started?.();
            await gate;
          }
        }),
      } as WebviewManager,
    );
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [] });
    coordinator.publish(TAB_ID, SESSION_ID, event(1));
    const revealing = coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });
    await sending;
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [] });
    coordinator.publish(TAB_ID, SESSION_ID, event(2));
    await coordinator.publishTerminal(TAB_ID, MESSAGE_TYPES.CHAT_ERROR, { tabId: TAB_ID });
    release?.();
    await revealing;
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });
    expect(sent.slice(1).map(({ type }) => type)).toEqual([
      MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT, MESSAGE_TYPES.CHAT_ERROR,
    ]);
    expect(sent[1].payload).toMatchObject({ events: [event(2)] });
  });

  it('keeps hidden state received during an awaited visible terminal send', async () => {
    const sent: Sent[] = [];
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const sending = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const coordinator = new ChatStreamDeliveryCoordinator(
      { warn: jest.fn() } as unknown as Logger,
      {
        sendMessage: jest.fn().mockResolvedValue(undefined),
        broadcastMessage: jest.fn(async (type: string, payload: unknown) => {
          sent.push({ type, payload });
          if (type === MESSAGE_TYPES.CHAT_COMPLETE) {
            started?.();
            await gate;
          }
        }),
      } as WebviewManager,
    );
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });
    coordinator.publish(TAB_ID, SESSION_ID, event(1));
    await coordinator.flushBeforeTerminal(TAB_ID);
    const terminal = coordinator.publishTerminal(TAB_ID, MESSAGE_TYPES.CHAT_COMPLETE, { tabId: TAB_ID });
    await sending;
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [] });
    coordinator.publish(TAB_ID, SESSION_ID, event(2));
    await coordinator.publishTerminal(TAB_ID, MESSAGE_TYPES.CHAT_ERROR, { tabId: TAB_ID });
    release?.();
    await terminal;
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });
    expect(sent.slice(2).map(({ type }) => type)).toEqual([
      MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT, MESSAGE_TYPES.CHAT_ERROR,
    ]);
    expect(sent[2].payload).toMatchObject({ events: [event(2)] });
  });

  it('does not scan every pending anchor on an unrelated publish', async () => {
    const { coordinator } = makeCoordinator();
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [] });
    coordinator.publish(TAB_ID, SESSION_ID, {
      id: 'start', eventType: 'message_start', timestamp: 1,
      messageId: 'message-1', role: 'assistant', source: 'stream',
    });
    await coordinator.updateViewport({
      protocolVersion: 2, visibleTabIds: [TAB_ID], resyncTabIds: [TAB_ID],
    });
    const prototype = LiveMessageProjection.prototype as unknown as Record<string, unknown>;
    const original = Object.getOwnPropertyDescriptor(prototype, 'hasMessage');
    Object.defineProperty(prototype, 'hasMessage', {
      configurable: true,
      value: () => { throw new Error('pending-anchor full scan'); },
    });
    try {
      expect(() => coordinator.publish(TAB_ID, SESSION_ID, event(2))).not.toThrow();
    } finally {
      if (original) Object.defineProperty(prototype, 'hasMessage', original);
      else Reflect.deleteProperty(prototype, 'hasMessage');
    }
  });

  it('keeps no tab state for an unknown hidden resync and honors its later publish', async () => {
    const { coordinator, sent } = makeCoordinator();
    await coordinator.updateViewport({
      protocolVersion: 2, visibleTabIds: [], resyncTabIds: [TAB_ID],
    });
    const states = (coordinator as unknown as { states: Map<string, unknown> }).states;
    expect(states.has(TAB_ID)).toBe(false);
    coordinator.publish(TAB_ID, SESSION_ID, event(1));
    await coordinator.updateViewport({ protocolVersion: 2, visibleTabIds: [TAB_ID] });
    expect(sent[0].payload).toMatchObject({ resyncRequired: true });
  });
});
