/**
 * SessionStreamPump — async-iterator pump for the SDK message-queue handoff.
 *
 * Owns:
 *   - `createUserMessageStream(sessionId, abortController)` — the async-iterator
 *     that drains queued messages and parks awaiting new ones, with abort
 *     short-circuiting at three points (top of loop, post-drain, post-wait).
 *   - `createIdlePromptStream(abortController)` — the resume-mode prompt stream
 *     that yields nothing and unblocks only on abort.
 *   - `sendMessage(sessionId, content, files?, images?)` — pumps a new
 *     SDKUserMessage onto the registry-owned queue and wakes the iterator's
 *     parked `resolveNext` callback.
 *
 * Wave C7i extracts this from `SessionLifecycleManager` (originally lines
 * 632–706, 972–1008, 1063–1088). The async-iterator body is preserved
 * byte-identically — every `addEventListener('abort', ...)`, every
 * `removeEventListener`, every `resolve('message'|'aborted')` call sits at
 * the same control-flow position. The drain-then-wait race-free pattern is
 * the load-bearing invariant the spec asserts on (lines 719–744).
 *
 * Plain class — NOT @injectable, NOT registered with tsyringe. Constructed
 * eagerly by the facade.
 */

import type { Logger } from '@ptah-extension/vscode-core';
import type { SessionId, InlineImageAttachment } from '@ptah-extension/shared';

import { SdkError } from '../../errors';
import type { SDKUserMessage } from '../../types/sdk-types/claude-sdk.types';
import type { SdkMessageFactory } from '../sdk-message-factory';
import type { SessionRegistry } from './session-registry.service';

export class SessionStreamPump {
  constructor(
    private readonly logger: Logger,
    private readonly registry: SessionRegistry,
    private readonly messageFactory: SdkMessageFactory,
  ) {}

  /**
   * Create a user message stream for SDK consumption
   * Creates an async iterable that yields user messages from the session queue
   *
   * @param sessionId - The session to create stream for
   * @param abortController - Controller to signal stream termination
   * @returns AsyncIterable that yields SDKUserMessage objects
   */
  createUserMessageStream(
    sessionId: SessionId,
    abortController: AbortController,
  ): AsyncIterable<SDKUserMessage> {
    const registry = this.registry;
    const logger = this.logger;

    return {
      async *[Symbol.asyncIterator]() {
        while (!abortController.signal.aborted) {
          const session = registry.find(sessionId as string);
          if (!session) {
            logger.warn(
              `[SessionLifecycle] Session ${sessionId} not found - ending stream`,
            );
            return;
          }

          // Drain all queued messages
          while (session.messageQueue.length > 0) {
            const message = session.messageQueue.shift();
            if (message) {
              logger.debug(
                `[SessionLifecycle] Yielding message (${session.messageQueue.length} remaining)`,
              );
              yield message;
            }
            if (abortController.signal.aborted) return;
          }

          // Wait for next message (no timeout - sessions run indefinitely)
          const waitResult = await new Promise<'message' | 'aborted'>(
            (resolve) => {
              const abortHandler = () => resolve('aborted');
              abortController.signal.addEventListener('abort', abortHandler);

              const currentSession = registry.find(sessionId as string);
              if (!currentSession) {
                resolve('aborted');
                return;
              }

              // Check queue again before waiting
              if (currentSession.messageQueue.length > 0) {
                abortController.signal.removeEventListener(
                  'abort',
                  abortHandler,
                );
                resolve('message');
                return;
              }

              // Set wake callback - called when new message arrives
              currentSession.resolveNext = () => {
                abortController.signal.removeEventListener(
                  'abort',
                  abortHandler,
                );
                resolve('message');
              };

              logger.debug(
                `[SessionLifecycle] Waiting for message (${sessionId})...`,
              );
            },
          );

          if (waitResult === 'aborted') {
            logger.debug(`[SessionLifecycle] Stream ended: ${waitResult}`);
            return;
          }
        }
      },
    };
  }

  /**
   * Create an idle prompt stream for resume sessions.
   *
   * This iterable waits indefinitely without yielding any messages.
   * Used as the SDK prompt during resume so that actual user messages
   * are delivered via streamInput() instead. This avoids the SDK resume
   * code path validating message.type on iterable items.
   *
   * Completes when the abort controller signals session end.
   */
  createIdlePromptStream(
    abortController: AbortController,
  ): AsyncIterable<SDKUserMessage> {
    return {
      [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
        let done = false;
        return {
          next(): Promise<IteratorResult<SDKUserMessage>> {
            if (done || abortController.signal.aborted) {
              return Promise.resolve({ done: true, value: undefined });
            }
            return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
              abortController.signal.addEventListener(
                'abort',
                () => {
                  done = true;
                  resolve({ done: true, value: undefined });
                },
                { once: true },
              );
            });
          },
        };
      },
    };
  }

  /**
   * Send a message to an active session
   * Extracted from SdkAgentAdapter to consolidate session operations
   *
   * @param sessionId - Session to send message to
   * @param content - Message content
   * @param files - Optional file attachments
   * @param images - Optional inline images (pasted/dropped)
   */
  async sendMessage(
    sessionId: SessionId,
    content: string,
    files?: string[],
    images?: InlineImageAttachment[],
  ): Promise<void> {
    const session = this.registry.find(sessionId as string);
    if (!session) {
      throw new SdkError(`Session not found: ${sessionId}`);
    }

    // Mark this session as the most recently active so MCP tool calls
    // (e.g., ptah_agent_spawn) attribute agents to the correct session.
    this.registry.markActive(sessionId as string);

    this.logger.info(`[SessionLifecycle] Sending message to ${sessionId}`, {
      contentLength: content.length,
      fileCount: files?.length || 0,
      imageCount: images?.length || 0,
    });

    const sdkUserMessage = await this.messageFactory.createUserMessage({
      content,
      sessionId,
      files,
      images,
    });
    session.messageQueue.push(sdkUserMessage);

    // Wake iterator
    if (session.resolveNext) {
      session.resolveNext();
      session.resolveNext = null;
    }

    this.logger.info(`[SessionLifecycle] Message queued for ${sessionId}`);
  }
}
