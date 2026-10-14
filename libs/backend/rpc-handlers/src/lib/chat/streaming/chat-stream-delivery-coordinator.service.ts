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
import {
  LiveMessageProjection,
  isSeedContent,
  STREAM_LIVE_SEED_MAX_BYTES,
} from './live-message-projection';
import { serializedBytes, StreamDeltaCoalescer } from './stream-delta-coalescer';

/** Bound both event count and memory retained for a hidden tab. */
export const STREAM_HIDDEN_TAIL_MAX_EVENTS = 256;
export const STREAM_HIDDEN_TAIL_MAX_BYTES = 512 * 1024;

interface DeferredTerminal {
  readonly type: string;
  readonly payload: unknown;
}

interface TabDeliveryState {
  lastSequence: number;
  sessionId?: string;
  tail: StreamDeltaCoalescer;
  resyncRequired: boolean;
  terminal?: DeferredTerminal;
  projection: LiveMessageProjection;
  pendingAnchors: Map<string, FlatStreamEventUnion>;
}

export interface ChatStreamDeliveryCoordinatorOptions {
  readonly maxTailEvents?: number;
  readonly maxTailBytes?: number;
  readonly maxLiveSeedBytes?: number;
}

export interface ChatStreamDeliveryMetrics {
  readonly receivedEvents: number;
  readonly transportEnvelopes: number;
  readonly suppressedHiddenEvents: number;
  readonly snapshotEvents: number;
  readonly snapshotBytes: number;
  readonly snapshotOverflowResyncs: number;
  readonly coalescedHiddenDeltas: number;
  readonly liveSeedEvents: number;
  readonly liveSeedTruncations: number;
  readonly deferredAnchorsInjected: number;
  readonly requestedResyncs: number;
}

@injectable()
export class ChatStreamDeliveryCoordinator {
  private readonly states = new Map<string, TabDeliveryState>();
  private readonly visibleTabIds = new Set<string>();
  private readonly pendingUnknownResyncTabIds = new Set<string>();
  private requestedVisibleTabIds = new Set<string>();
  private readonly buffer: StreamBatchBuffer;
  private viewportNegotiated = false;
  private sequence = 0;
  private viewportGeneration = 0;
  private maxTailEvents: number;
  private maxTailBytes: number;
  private maxLiveSeedBytes = STREAM_LIVE_SEED_MAX_BYTES;
  private readonly metrics = {
    receivedEvents: 0,
    transportEnvelopes: 0,
    suppressedHiddenEvents: 0,
    snapshotEvents: 0,
    snapshotBytes: 0,
    snapshotOverflowResyncs: 0,
    coalescedHiddenDeltas: 0,
    liveSeedEvents: 0,
    liveSeedTruncations: 0,
    deferredAnchorsInjected: 0,
    requestedResyncs: 0,
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
    this.maxLiveSeedBytes = options.maxLiveSeedBytes ?? STREAM_LIVE_SEED_MAX_BYTES;
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
    state.lastSequence = ++this.sequence;
    if (sessionId) state.sessionId = sessionId;
    if (!surfaceMode) {
      if (state.projection.observe(event, state.lastSequence)) {
        this.metrics.liveSeedTruncations++;
        this.logger.warn('Live chat stream seed truncated');
      }
      for (const messageId of state.projection.takeDroppedMessageIds()) {
        state.pendingAnchors.delete(messageId);
      }
    }
    const pending = surfaceMode ? undefined : state.pendingAnchors.get(event.messageId);
    if (pending) {
      if (isSeedContent(event)) {
        state.pendingAnchors.delete(event.messageId);
        this.metrics.deferredAnchorsInjected++;
        this.route(tabId, state, pending, sessionId);
      } else if (
        event.eventType === 'message_start' ||
        (event.eventType === 'message_complete' && event.source === 'stream')
      ) {
        state.pendingAnchors.delete(event.messageId);
      }
    }
    return this.route(tabId, state, event, sessionId, surfaceMode);
  }

  private route(
    tabId: string,
    state: TabDeliveryState,
    event: FlatStreamEventUnion,
    sessionId?: string,
    surfaceMode?: boolean,
  ): void | Promise<void> {
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
    const generation = ++this.viewportGeneration;
    const nextVisible = new Set(viewport.visibleTabIds);
    if (viewport.focusedTabId) nextVisible.add(viewport.focusedTabId);
    const requestedResync = new Set(viewport.resyncTabIds ?? []);
    for (const tabId of this.pendingUnknownResyncTabIds) {
      if (!nextVisible.has(tabId) && !requestedResync.has(tabId)) {
        this.pendingUnknownResyncTabIds.delete(tabId);
      }
    }
    this.viewportNegotiated = true;
    this.requestedVisibleTabIds = nextVisible;
    for (const tabId of this.visibleTabIds) {
      if (!nextVisible.has(tabId)) this.visibleTabIds.delete(tabId);
    }
    for (const tabId of requestedResync) {
      if (!this.states.has(tabId) && !nextVisible.has(tabId)) {
        this.pendingUnknownResyncTabIds.add(tabId);
        this.metrics.requestedResyncs++;
        continue;
      }
      const state = this.getState(tabId);
      state.resyncRequired = true;
      state.tail.clear();
      this.metrics.requestedResyncs++;
      if (nextVisible.has(tabId)) this.visibleTabIds.delete(tabId);
    }
    const revealed = [...nextVisible].filter((tabId) => !this.visibleTabIds.has(tabId));

    for (const tabId of revealed) {
      await this.reveal(tabId, generation);
    }
  }

  /** Ensures accepted chunks are handed to the transport before a terminal. */
  async flushBeforeTerminal(_tabId: string): Promise<void> {
    await this.buffer.flush();
    await this.buffer.settle();
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
    const generation = this.viewportGeneration;
    await this.flushBeforeTerminal(tabId);
    await this.send(type, payload);
    const state = this.states.get(tabId);
    if (
      state &&
      generation === this.viewportGeneration &&
      (!this.viewportNegotiated || this.visibleTabIds.has(tabId))
    ) {
      this.clearHidden(state);
      if (state.projection.isEmpty() && state.pendingAnchors.size === 0) {
        this.states.delete(tabId);
      }
    }
  }

  /** Releases retained state when the owning host disposes a tab. */
  dispose(tabId: string): void {
    this.states.delete(tabId);
    this.visibleTabIds.delete(tabId);
    this.pendingUnknownResyncTabIds.delete(tabId);
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
        lastSequence: this.sequence,
        ...(sessionId ? { sessionId } : {}),
        tail: new StreamDeltaCoalescer(),
        resyncRequired: this.pendingUnknownResyncTabIds.delete(tabId),
        projection: new LiveMessageProjection(this.maxLiveSeedBytes),
        pendingAnchors: new Map(),
      };
      this.states.set(tabId, state);
    }
    return state;
  }

  private retain(state: TabDeliveryState, event: FlatStreamEventUnion): void {
    if (state.resyncRequired) return;
    if (state.tail.append(event, state.lastSequence)) {
      this.metrics.coalescedHiddenDeltas++;
    }
    if (
      state.tail.events.length > this.maxTailEvents ||
      state.tail.bytes > this.maxTailBytes
    ) {
      state.tail.clear();
      state.resyncRequired = true;
      this.metrics.snapshotOverflowResyncs++;
    }
  }

  private async reveal(tabId: string, generation: number): Promise<void> {
    await this.flushBeforeTerminal(tabId);
    if (
      generation !== this.viewportGeneration ||
      !this.requestedVisibleTabIds.has(tabId)
    ) return;
    const state = this.states.get(tabId) ??
      (this.pendingUnknownResyncTabIds.has(tabId) ? this.getState(tabId) : undefined);
    if (!state) {
      this.visibleTabIds.add(tabId);
      return;
    }
    if (state.resyncRequired) state.lastSequence = ++this.sequence;
    const fromSequence = state.tail.events[0]?.sequence ?? state.lastSequence;
    const seed = state.resyncRequired ? state.projection.buildSeed() : undefined;
    const snapshot: ChatStreamSnapshotPayload = {
      protocolVersion: 2,
      tabId,
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
      fromSequence,
      toSequence: state.lastSequence,
      ...(state.resyncRequired
        ? {
            resyncRequired: true,
            ...(seed?.events.length ? { liveSeed: seed.events } : {}),
            ...(seed && Object.keys(seed.blockCounts).length
              ? { liveSeedBlocks: seed.blockCounts }
              : {}),
          }
        : { events: state.tail.events.map(({ event }) => event) }),
    };
    this.metrics.snapshotEvents += state.tail.events.length;
    this.metrics.liveSeedEvents += seed?.events.length ?? 0;
    this.metrics.snapshotBytes += serializedBytes(snapshot);
    for (const anchor of seed?.deferredAnchors ?? []) {
      state.pendingAnchors.set(anchor.event.messageId, anchor.event);
    }
    const terminal = state.terminal;
    this.clearHidden(state);
    this.visibleTabIds.add(tabId);
    await this.send(MESSAGE_TYPES.CHAT_STREAM_SNAPSHOT, snapshot);
    if (terminal) {
      await this.send(terminal.type, terminal.payload);
    }
    if (
      this.states.get(tabId) === state &&
      this.visibleTabIds.has(tabId) &&
      !state.terminal &&
      !state.resyncRequired &&
      state.tail.events.length === 0 &&
      state.projection.isEmpty() &&
      state.pendingAnchors.size === 0
    ) {
      this.states.delete(tabId);
    }
  }

  private clearHidden(state: TabDeliveryState): void {
    state.tail.clear();
    state.resyncRequired = false;
    state.terminal = undefined;
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

}
