/**
 * Visibility-aware delivery boundary for chat stream events.
 *
 * A host remains legacy-visible until a v2 webview explicitly sends a viewport.
 * That keeps old webviews and CLI/TUI byte-compatible while allowing a modern
 * host to suppress hidden-tab traffic without adding a second event log.
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  MESSAGE_TYPES,
  type ChatSetStreamViewportParams,
  type ChatStreamSnapshotPayload,
  type FlatStreamEventUnion,
} from '@ptah-extension/shared';

import { StreamBatchBuffer } from './stream-batch-buffer';
import type { WebviewManager } from './chat-stream-broadcaster.service';

/** Bound both event count and memory retained for a hidden tab. */
export const STREAM_HIDDEN_TAIL_MAX_EVENTS = 256;
export const STREAM_HIDDEN_TAIL_MAX_BYTES = 512 * 1024;

interface RetainedEvent {
  readonly sequence: number;
  readonly event: FlatStreamEventUnion;
  readonly bytes: number;
}

interface DeferredTerminal {
  readonly type: string;
  readonly payload: unknown;
}

interface TabDeliveryState {
  sequence: number;
  sessionId?: string;
  tail: RetainedEvent[];
  tailBytes: number;
  resyncRequired: boolean;
  terminal?: DeferredTerminal;
}

export interface ChatStreamDeliveryCoordinatorOptions {
  readonly maxTailEvents?: number;
  readonly maxTailBytes?: number;
}

export interface ChatStreamDeliveryMetrics {
  readonly receivedEvents: number;
  readonly transportEnvelopes: number;
  readonly suppressedHiddenEvents: number;
  readonly snapshotEvents: number;
  readonly snapshotBytes: number;
  readonly snapshotOverflowResyncs: number;
}

@injectable()
export class ChatStreamDeliveryCoordinator {
  private readonly states = new Map<string, TabDeliveryState>();
  private readonly visibleTabIds = new Set<string>();
  private readonly buffer: StreamBatchBuffer;
  private viewportNegotiated = false;
  private maxTailEvents: number;
  private maxTailBytes: number;
  private readonly metrics = {
    receivedEvents: 0,
    transportEnvelopes: 0,
    suppressedHiddenEvents: 0,
    snapshotEvents: 0,
    snapshotBytes: 0,
    snapshotOverflowResyncs: 0,
  };

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
  ) {
    this.maxTailEvents = STREAM_HIDDEN_TAIL_MAX_EVENTS;
    this.maxTailBytes = STREAM_HIDDEN_TAIL_MAX_BYTES;
    this.buffer = new StreamBatchBuffer({
      sink: (type, payload) => this.deliver(type, payload),
      onError: (error: unknown) =>
        this.logger.warn('Failed to deliver a coordinated chat stream batch', {
          error: error instanceof Error ? error.message : String(error),
        }),
    });
  }

  /** Test-only configuration, kept out of the public runtime contract. */
  configureForTest(options: ChatStreamDeliveryCoordinatorOptions): void {
    this.maxTailEvents = options.maxTailEvents ?? STREAM_HIDDEN_TAIL_MAX_EVENTS;
    this.maxTailBytes = options.maxTailBytes ?? STREAM_HIDDEN_TAIL_MAX_BYTES;
  }

  publish(
    tabId: string,
    sessionId: string | undefined,
    event: FlatStreamEventUnion,
    surfaceMode?: boolean,
  ): void | Promise<void> {
    this.metrics.receivedEvents++;
    if (!this.viewportNegotiated) {
      return this.buffer.push({
        type: MESSAGE_TYPES.CHAT_CHUNK,
        payload: {
          tabId,
          sessionId,
          event,
          ...(surfaceMode ? { surfaceMode: true } : {}),
        },
      });
    }

    const state = this.getState(tabId, sessionId);
    state.sequence++;
    if (sessionId) state.sessionId = sessionId;
    if (this.visibleTabIds.has(tabId)) {
      return this.buffer.push({
        type: MESSAGE_TYPES.CHAT_CHUNK,
        payload: {
          tabId,
          sessionId,
          event,
          ...(surfaceMode ? { surfaceMode: true } : {}),
        },
      });
    }
    this.metrics.suppressedHiddenEvents++;
    this.retain(state, event);
  }

  /** Applies a distinct v2 viewport and emits one catch-up envelope per reveal. */
  async updateViewport(viewport: ChatSetStreamViewportParams): Promise<void> {
    const nextVisible = new Set(viewport.visibleTabIds);
    if (viewport.focusedTabId) nextVisible.add(viewport.focusedTabId);
    const revealed = [...nextVisible].filter(
      (tabId) => !this.visibleTabIds.has(tabId),
    );
    this.viewportNegotiated = true;
    this.visibleTabIds.clear();
    for (const tabId of nextVisible) this.visibleTabIds.add(tabId);

    for (const tabId of revealed) {
      await this.reveal(tabId);
    }
  }

  /** Ensures accepted chunks are handed to the transport before a terminal. */
  async flushBeforeTerminal(_tabId: string): Promise<void> {
    await this.buffer.flush();
  }

  /** Delivers terminal messages after their batch, or defers them while hidden. */
  async publishTerminal(
    tabId: string,
    type: string,
    payload: unknown,
  ): Promise<void> {
    if (this.viewportNegotiated && !this.visibleTabIds.has(tabId)) {
      this.getState(tabId).terminal = { type, payload };
      return;
    }
    await this.flushBeforeTerminal(tabId);
    await this.send(type, payload);
    this.states.delete(tabId);
  }

  /** Releases retained state when the owning host disposes a tab. */
  dispose(tabId: string): void {
    this.states.delete(tabId);
    this.visibleTabIds.delete(tabId);
  }

  /** Awaits currently accepted transport sends without disposing the shared buffer. */
  settle(): Promise<void> {
    return this.buffer.settle();
  }

  /** Ephemeral aggregate diagnostics only; no prompts, content, or ids. */
  getMetrics(): ChatStreamDeliveryMetrics {
    return { ...this.metrics };
  }

  private getState(tabId: string, sessionId?: string): TabDeliveryState {
    let state = this.states.get(tabId);
    if (!state) {
      state = {
        sequence: 0,
        ...(sessionId ? { sessionId } : {}),
        tail: [],
        tailBytes: 0,
        resyncRequired: false,
      };
      this.states.set(tabId, state);
    }
    return state;
  }

  private retain(state: TabDeliveryState, event: FlatStreamEventUnion): void {
    if (state.resyncRequired) return;
    const bytes = this.serializedBytes(event);
    if (
      state.tail.length + 1 > this.maxTailEvents ||
      state.tailBytes + bytes > this.maxTailBytes
    ) {
      state.tail = [];
      state.tailBytes = 0;
      state.resyncRequired = true;
      this.metrics.snapshotOverflowResyncs++;
      return;
    }
    state.tail.push({ sequence: state.sequence, event, bytes });
    state.tailBytes += bytes;
  }

  private async reveal(tabId: string): Promise<void> {
    const state = this.states.get(tabId);
    if (!state) return;

    await this.flushBeforeTerminal(tabId);
    const fromSequence = state.tail[0]?.sequence ?? state.sequence;
    const snapshot: ChatStreamSnapshotPayload = {
      protocolVersion: 2,
      tabId,
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
      fromSequence,
      toSequence: state.sequence,
      ...(state.resyncRequired
        ? { resyncRequired: true }
        : { events: state.tail.map(({ event }) => event) }),
    };
    this.metrics.snapshotEvents += state.tail.length;
    this.metrics.snapshotBytes += this.serializedBytes(snapshot);
    await this.send(MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT, snapshot);
    const terminal = state.terminal;
    if (terminal) {
      this.states.delete(tabId);
      await this.send(terminal.type, terminal.payload);
      return;
    }
    state.tail = [];
    state.tailBytes = 0;
    state.resyncRequired = false;
  }

  private async send(type: string, payload: unknown): Promise<void> {
    try {
      await this.deliver(type, payload);
    } catch (error: unknown) {
      this.logger.warn('Failed to deliver a coordinated chat stream message', {
        type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async deliver(type: string, payload: unknown): Promise<void> {
    this.metrics.transportEnvelopes++;
    await this.webviewManager.broadcastMessage(type, payload);
  }

  private serializedBytes(value: unknown): number {
    try {
      return Buffer.byteLength(JSON.stringify(value), 'utf8');
    } catch {
      return this.maxTailBytes + 1;
    }
  }
}
