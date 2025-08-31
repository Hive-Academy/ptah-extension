import { Injectable, signal, inject } from '@angular/core';
import { Observable, Subject, filter, map, catchError, EMPTY, takeUntil } from 'rxjs';
import {
  StrictMessage,
  MessagePayloadMap,
  MessageId,
  ChatMessageChunkPayload,
  ClaudeCliStreamMessage,
  ProcessedClaudeMessage,
} from '@ptah-extension/shared';
import { VSCodeService } from '../vscode.service';
import { MessageProcessingService } from './message-processing.service';

export interface StreamState {
  isStreaming: boolean;
  isConnected: boolean;
  streamingMessageId: MessageId | null;
  lastMessageTimestamp: number;
}

/**
 * Stream Handling Service - Real-time Message Streaming
 *
 * Responsibilities:
 * - Manage streaming connections to backend
 * - Handle message chunks and streaming assembly
 * - Track streaming state and connection status
 * - Process real-time message updates
 * - Handle streaming start/stop operations
 *
 * Extracted from EnhancedChatService for single responsibility
 */
@Injectable({
  providedIn: 'root',
})
export class StreamHandlingService {
  private readonly vscode = inject(VSCodeService);
  private readonly messageProcessor = inject(MessageProcessingService);
  private readonly destroy$ = new Subject<void>();

  // Streaming state
  private readonly _streamState = signal<StreamState>({
    isStreaming: false,
    isConnected: false,
    streamingMessageId: null,
    lastMessageTimestamp: 0,
  });

  // Public readonly signals
  readonly streamState = this._streamState.asReadonly();
  readonly isStreaming = () => this._streamState().isStreaming;
  readonly isConnected = () => this._streamState().isConnected;
  readonly streamingMessageId = () => this._streamState().streamingMessageId;

  // Stream observables
  readonly messageStream$: Observable<ProcessedClaudeMessage>;
  readonly chunkStream$: Observable<ChatMessageChunkPayload>;

  constructor() {
    // Set up message streaming pipeline
    this.messageStream$ = this.createMessageStream();
    this.chunkStream$ = this.createChunkStream();

    this.initializeStreamHandling();
  }

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
    const currentState = this._streamState();

    // Send stop message to backend if streaming
    if (currentState.isStreaming && currentState.streamingMessageId) {
      this.vscode.postMessage({
        type: 'chat:stopStreaming',
        data: { messageId: currentState.streamingMessageId },
      });
    }

    this.updateStreamState({
      isStreaming: false,
      streamingMessageId: null,
    });
  }

  /**
   * Update connection status
   */
  updateConnectionStatus(isConnected: boolean): void {
    this.updateStreamState({ isConnected });
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
      isConnected: false,
      streamingMessageId: null,
      lastMessageTimestamp: 0,
    });
  }

  /**
   * Cleanup when service is destroyed
   */
  destroy(): void {
    this.stopStreaming();
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Private methods
  private createMessageStream(): Observable<ProcessedClaudeMessage> {
    return this.vscode.onMessage().pipe(
      filter((msg: StrictMessage) => this.isChatMessage(msg)),
      map((msg: StrictMessage) => {
        // Extract Claude message from the payload
        const claudeMessage = this.extractClaudeMessage(msg);
        if (!claudeMessage) {
          throw new Error('Failed to extract Claude message from payload');
        }

        // Transform to ProcessedClaudeMessage
        const sessionId = this.extractSessionId(msg);
        return this.messageProcessor.transformClaudeMessage(claudeMessage, sessionId);
      }),
      filter((message): message is ProcessedClaudeMessage => message !== null),
      catchError((error: unknown) => {
        console.error('StreamHandlingService: Message stream error:', error);
        return EMPTY;
      }),
      takeUntil(this.destroy$),
    );
  }

  private createChunkStream(): Observable<ChatMessageChunkPayload> {
    return this.vscode.onMessage().pipe(
      filter((msg: StrictMessage) => this.isChunkMessage(msg)),
      map((msg: StrictMessage) => msg.data as ChatMessageChunkPayload),
      catchError((error: unknown) => {
        console.error('StreamHandlingService: Chunk stream error:', error);
        return EMPTY;
      }),
      takeUntil(this.destroy$),
    );
  }

  private initializeStreamHandling(): void {
    // Handle streaming status updates
    this.vscode
      .onMessageType('chat:streamingStarted')
      .pipe(takeUntil(this.destroy$))
      .subscribe((msg) => {
        const messageId = msg.data?.messageId as MessageId;
        if (messageId) {
          this.startStreaming(messageId);
        }
      });

    this.vscode
      .onMessageType('chat:streamingCompleted')
      .pipe(takeUntil(this.destroy$))
      .subscribe((msg) => {
        const messageId = msg.data?.messageId as MessageId;
        if (messageId) {
          this.completeStreaming(messageId);
        }
      });

    // Handle connection status
    this.vscode
      .onMessageType('connection:status')
      .pipe(takeUntil(this.destroy$))
      .subscribe((msg) => {
        const isConnected = msg.data?.isConnected === true;
        this.updateConnectionStatus(isConnected);
      });

    // Handle streaming errors
    this.vscode
      .onMessageType('chat:streamError')
      .pipe(takeUntil(this.destroy$))
      .subscribe((msg) => {
        console.error('StreamHandlingService: Streaming error:', msg.data);
        this.resetStreamState();
      });
  }

  private updateStreamState(updates: Partial<StreamState>): void {
    const currentState = this._streamState();
    this._streamState.set({
      ...currentState,
      ...updates,
    });
  }

  private isChatMessage(msg: StrictMessage): boolean {
    return msg.type === 'chat:message' || msg.type === 'claude:message';
  }

  private isChunkMessage(msg: StrictMessage): boolean {
    return msg.type === 'chat:messageChunk';
  }

  private extractClaudeMessage(msg: StrictMessage): ClaudeCliStreamMessage | null {
    try {
      // Handle different message payload structures
      if (msg.type === 'claude:message') {
        return msg.data as ClaudeCliStreamMessage;
      }

      if (msg.type === 'chat:message') {
        // Extract Claude message from chat message payload
        const chatData = msg.data as MessagePayloadMap['chat:message'];
        return chatData.claudeMessage || null;
      }

      return null;
    } catch (error) {
      console.error('StreamHandlingService: Failed to extract Claude message:', error);
      return null;
    }
  }

  private extractSessionId(msg: StrictMessage): string {
    try {
      // Try to extract session ID from message payload
      const data = msg.data as any;
      return data.sessionId || data.session?.id || 'default-session';
    } catch (error) {
      console.warn('StreamHandlingService: Failed to extract session ID, using default');
      return 'default-session';
    }
  }
}
