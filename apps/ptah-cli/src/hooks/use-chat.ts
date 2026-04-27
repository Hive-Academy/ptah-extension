/**
 * useChat -- Chat state management hook with streaming support.
 *
 * TASK_2025_263 Batch 3
 *
 * Manages the message list, streaming state, and communication with
 * the backend via CliMessageTransport (RPC) and CliWebviewManagerAdapter (push events).
 *
 * Subscribes to push events:
 *   - chat:chunk  -- Appends content to the current assistant message
 *   - chat:complete -- Finalizes the streaming message
 *   - chat:error -- Adds an error as a system message
 *
 * Uses a ref + debounced setState (100ms) for high-frequency chunk updates
 * to avoid excessive re-renders in the terminal.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { randomUUID } from 'crypto';

import { useCliContext } from '../context/CliContext.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
}

export interface UseChatResult {
  messages: ChatMessage[];
  isStreaming: boolean;
  startChat: (message: string, sessionId?: string) => Promise<void>;
  stopChat: () => Promise<void>;
  clearMessages: () => void;
  addSystemMessage: (text: string) => void;
}

/** Debounce interval for flushing accumulated chunk content to React state. */
const CHUNK_FLUSH_INTERVAL_MS = 100;

/** Streaming watchdog timeout -- auto-stops if no chunks arrive within this window. */
const STREAMING_TIMEOUT_MS = 60_000;

/**
 * Hook providing chat message state and streaming management.
 * Connects to backend RPC for starting/stopping chat, and listens
 * to push events for real-time streaming updates.
 */
export function useChat(): UseChatResult {
  const { transport, pushAdapter } = useCliContext();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  // Ref to accumulate chunk content between flushes.
  // This avoids a setState call for every single chunk (which can be 10-50/sec).
  const pendingContentRef = useRef<string>('');
  const assistantMessageIdRef = useRef<string | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Synchronous guard to prevent double-submit race conditions.
  const chatInFlightRef = useRef(false);

  // Streaming watchdog: auto-stops if no chunks arrive within the timeout window.
  const streamingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  /**
   * Flush accumulated chunk content into React state.
   * Called on a 100ms debounce timer so the terminal redraws at a reasonable rate.
   */
  const flushPendingContent = useCallback(() => {
    const messageId = assistantMessageIdRef.current;
    const pending = pendingContentRef.current;

    if (!messageId || pending.length === 0) return;

    // Reset pending content before setState to avoid races
    pendingContentRef.current = '';

    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === messageId);
      if (idx === -1) return prev;

      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        content: updated[idx].content + pending,
      };
      return updated;
    });
  }, []);

  /**
   * Schedule a flush if one isn't already pending.
   */
  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flushPendingContent();
    }, CHUNK_FLUSH_INTERVAL_MS);
  }, [flushPendingContent]);

  const resetStreamingTimeout = useCallback(() => {
    if (streamingTimeoutRef.current) {
      clearTimeout(streamingTimeoutRef.current);
    }
    streamingTimeoutRef.current = setTimeout(() => {
      const messageId = assistantMessageIdRef.current;
      if (messageId) {
        flushPendingContent();
        setMessages((prev) => [
          ...prev.map((m) =>
            m.id === messageId ? { ...m, isStreaming: false } : m,
          ),
          {
            id: randomUUID(),
            role: 'system' as const,
            content: 'Streaming timed out — no response from backend.',
            timestamp: new Date().toISOString(),
          },
        ]);
      }
      setIsStreaming(false);
      assistantMessageIdRef.current = null;
      chatInFlightRef.current = false;
      streamingTimeoutRef.current = null;
    }, STREAMING_TIMEOUT_MS);
  }, [flushPendingContent]);

  /**
   * Send a user message and start streaming the assistant response.
   */
  const startChat = useCallback(
    async (message: string, sessionId?: string): Promise<void> => {
      if (chatInFlightRef.current) return;
      chatInFlightRef.current = true;

      // Add user message to the list
      const userMessage: ChatMessage = {
        id: randomUUID(),
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
      };

      // Create a placeholder assistant message for streaming
      const assistantId = randomUUID();
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        isStreaming: true,
      };

      assistantMessageIdRef.current = assistantId;
      pendingContentRef.current = '';

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setIsStreaming(true);

      // Fire the RPC call to start the chat
      try {
        const response = await transport.call('chat:start', {
          message,
          sessionId,
        });
        if (!response.success) {
          const errorText = response.error ?? 'Failed to start chat';
          setMessages((prev) => [
            ...prev.filter((m) => m.id !== assistantId),
            {
              id: randomUUID(),
              role: 'system' as const,
              content: errorText,
              timestamp: new Date().toISOString(),
            },
          ]);
          setIsStreaming(false);
          assistantMessageIdRef.current = null;
          chatInFlightRef.current = false;
          return;
        }
        resetStreamingTimeout();
      } catch (err: unknown) {
        const errorText = err instanceof Error ? err.message : String(err);

        // Remove empty assistant placeholder and add error as system message
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== assistantId),
          {
            id: randomUUID(),
            role: 'system',
            content: `Failed to start chat: ${errorText}`,
            timestamp: new Date().toISOString(),
          },
        ]);
        setIsStreaming(false);
        assistantMessageIdRef.current = null;
        chatInFlightRef.current = false;
      }
    },
    [transport, resetStreamingTimeout],
  );

  /**
   * Stop the current streaming session.
   */
  const stopChat = useCallback(async (): Promise<void> => {
    try {
      await transport.call('chat:stop', {});
    } catch {
      // Best effort -- the backend may already have stopped
    }

    // Clear streaming watchdog
    if (streamingTimeoutRef.current) {
      clearTimeout(streamingTimeoutRef.current);
      streamingTimeoutRef.current = null;
    }

    // Flush any remaining content
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    flushPendingContent();

    // Finalize the assistant message
    const messageId = assistantMessageIdRef.current;
    if (messageId) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, isStreaming: false } : m,
        ),
      );
    }

    setIsStreaming(false);
    assistantMessageIdRef.current = null;
    chatInFlightRef.current = false;
  }, [transport, flushPendingContent]);

  // Subscribe to push events for streaming updates
  useEffect(() => {
    /**
     * Handle incoming chat chunks.
     * Accumulates content in the ref and schedules debounced flushes.
     */
    const handleChunk = (payload: unknown): void => {
      const data = payload as { content?: string; text?: string };
      const chunkText = data.content ?? data.text ?? '';

      if (chunkText.length === 0) return;

      pendingContentRef.current += chunkText;
      scheduleFlush();
      resetStreamingTimeout();
    };

    /**
     * Handle chat completion.
     * Flushes any remaining content and marks streaming as done.
     */
    const handleComplete = (_payload: unknown): void => {
      if (streamingTimeoutRef.current) {
        clearTimeout(streamingTimeoutRef.current);
        streamingTimeoutRef.current = null;
      }

      // Flush remaining content immediately
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      flushPendingContent();

      // Finalize the assistant message
      const messageId = assistantMessageIdRef.current;
      if (messageId) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, isStreaming: false } : m,
          ),
        );
      }

      setIsStreaming(false);
      assistantMessageIdRef.current = null;
      chatInFlightRef.current = false;
    };

    /**
     * Handle chat errors.
     * Adds the error as a system message and stops streaming.
     */
    const handleError = (payload: unknown): void => {
      const data = payload as { message?: string; error?: string };
      const errorText = data.message ?? data.error ?? 'Unknown streaming error';

      if (streamingTimeoutRef.current) {
        clearTimeout(streamingTimeoutRef.current);
        streamingTimeoutRef.current = null;
      }

      // Flush any partial content first
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      flushPendingContent();

      // Finalize the assistant message (if it has content)
      const messageId = assistantMessageIdRef.current;
      if (messageId) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, isStreaming: false } : m,
          ),
        );
      }

      // Add error as system message
      setMessages((prev) => [
        ...prev,
        {
          id: randomUUID(),
          role: 'system',
          content: errorText,
          timestamp: new Date().toISOString(),
        },
      ]);

      setIsStreaming(false);
      assistantMessageIdRef.current = null;
      chatInFlightRef.current = false;
    };

    pushAdapter.on('chat:chunk', handleChunk);
    pushAdapter.on('chat:complete', handleComplete);
    pushAdapter.on('chat:error', handleError);

    return () => {
      pushAdapter.off('chat:chunk', handleChunk);
      pushAdapter.off('chat:complete', handleComplete);
      pushAdapter.off('chat:error', handleError);

      // Clean up any pending flush timer
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }

      // Clean up streaming watchdog
      if (streamingTimeoutRef.current) {
        clearTimeout(streamingTimeoutRef.current);
        streamingTimeoutRef.current = null;
      }
    };
  }, [pushAdapter, scheduleFlush, flushPendingContent, resetStreamingTimeout]);

  /**
   * Clear all messages from the chat history.
   * Used by the /clear command.
   */
  const clearMessages = useCallback((): void => {
    setMessages([]);
  }, []);

  /**
   * Append a system message to the chat history.
   * Used by commands that return informational text (e.g., /help, /cost, /status).
   */
  const addSystemMessage = useCallback((text: string): void => {
    setMessages((prev) => [
      ...prev,
      {
        id: randomUUID(),
        role: 'system',
        content: text,
        timestamp: new Date().toISOString(),
      },
    ]);
  }, []);

  return {
    messages,
    isStreaming,
    startChat,
    stopChat,
    clearMessages,
    addSystemMessage,
  };
}
