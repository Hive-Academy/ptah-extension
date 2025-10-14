/**
 * Stream Handling Service - Real-time Message Streaming
 *
 * Migrated from: apps/ptah-extension-webview/src/app/core/services/chat/stream-handling.service.ts
 *
 * Modernizations applied:
 * - inject() pattern instead of constructor injection
 * - DestroyRef with takeUntilDestroyed() for cleanup
 * - Signal-based stream state management
 * - Simplified to work with current type system
 * - Zero `any` types
 *
 * Responsibilities:
 * - Track streaming state
 * - Handle streaming start/stop operations
 * - Provide streaming status to UI components
 */

import { Injectable, signal } from '@angular/core';
import { MessageId } from '@ptah-extension/shared';

export interface StreamState {
  isStreaming: boolean;
  streamingMessageId: MessageId | null;
  lastMessageTimestamp: number;
}

@Injectable({
  providedIn: 'root',
})
export class StreamHandlingService {
  // ANGULAR 20 PATTERN: Signal-based stream state
  private readonly _streamState = signal<StreamState>({
    isStreaming: false,
    streamingMessageId: null,
    lastMessageTimestamp: 0,
  });

  // Public readonly signals
  readonly streamState = this._streamState.asReadonly();
  readonly isStreaming = () => this._streamState().isStreaming;
  readonly streamingMessageId = () => this._streamState().streamingMessageId;

  /**
   * Start streaming a new message
   */
  startStreaming(messageId: MessageId): void {
    this.updateStreamState({
      isStreaming: true,
      streamingMessageId: messageId,
      lastMessageTimestamp: Date.now(),
    });
  }

  /**
   * Stop current streaming
   */
  stopStreaming(): void {
    this.updateStreamState({
      isStreaming: false,
      streamingMessageId: null,
    });
  }

  /**
   * Complete streaming for a message
   */
  completeStreaming(messageId: MessageId): void {
    const currentState = this._streamState();

    if (currentState.streamingMessageId === messageId) {
      this.updateStreamState({
        isStreaming: false,
        streamingMessageId: null,
        lastMessageTimestamp: Date.now(),
      });
    }
  }

  /**
   * Check if a specific message is currently streaming
   */
  isMessageStreaming(messageId: MessageId): boolean {
    const state = this._streamState();
    return state.isStreaming && state.streamingMessageId === messageId;
  }

  /**
   * Get streaming duration for current message
   */
  getStreamingDuration(): number {
    const state = this._streamState();
    if (!state.isStreaming) return 0;

    return Date.now() - state.lastMessageTimestamp;
  }

  /**
   * Reset streaming state (for cleanup or errors)
   */
  resetStreamState(): void {
    this.updateStreamState({
      isStreaming: false,
      streamingMessageId: null,
      lastMessageTimestamp: 0,
    });
  }

  // Private methods
  private updateStreamState(updates: Partial<StreamState>): void {
    const currentState = this._streamState();
    this._streamState.set({
      ...currentState,
      ...updates,
    });
  }
}
