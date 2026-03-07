/**
 * User Message Stream Factory - Creates async iterables for SDK message consumption
 *
 * Extracted from SdkAgentAdapter to separate streaming concerns.
 * Creates AsyncIterable streams that yield user messages from the session's
 * message queue, enabling the SDK's streaming input mode.
 *
 * Single Responsibility: Create user message streams for SDK consumption
 *
 * @see TASK_2025_102 - Extracted to reduce SdkAgentAdapter complexity
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SessionId } from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import { SessionLifecycleManager } from './session-lifecycle-manager';
import { SDKUserMessage } from '../types/sdk-types/claude-sdk.types';

/**
 * Creates user message streams for SDK consumption
 *
 * The SDK's query() function accepts an AsyncIterable<SDKUserMessage> as the prompt.
 * This factory creates streams that:
 * - Drain messages from the session's messageQueue
 * - Wait for new messages when queue is empty
 * - Respond to abort signals for clean shutdown
 * - Support indefinite session lifetimes (no timeout)
 */
@injectable()
export class UserMessageStreamFactory {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
    private readonly sessionLifecycle: SessionLifecycleManager
  ) {}

  /**
   * Create a user message stream for SDK consumption
   *
   * @param sessionId - The session to create stream for
   * @param abortController - Controller to signal stream termination
   * @returns AsyncIterable that yields SDKUserMessage objects
   *
   * @example
   * ```typescript
   * const stream = factory.create(sessionId, abortController);
   * const sdkQuery = query({ prompt: stream, options: {...} });
   * ```
   */
  create(
    sessionId: SessionId,
    abortController: AbortController
  ): AsyncIterable<string | SDKUserMessage> {
    const sessionLifecycle = this.sessionLifecycle;
    const logger = this.logger;

    return {
      async *[Symbol.asyncIterator]() {
        while (!abortController.signal.aborted) {
          const session = sessionLifecycle.getActiveSession(sessionId);
          if (!session) {
            logger.warn(
              `[UserMessageStreamFactory] Session ${sessionId} not found - ending stream`
            );
            return;
          }

          // Drain all queued messages
          while (session.messageQueue.length > 0) {
            const message = session.messageQueue.shift();
            if (message) {
              logger.debug(
                `[UserMessageStreamFactory] Yielding message (${session.messageQueue.length} remaining)`
              );
              yield message;
            }
            if (abortController.signal.aborted) return;
          }

          // Wait for next message (no timeout - sessions run indefinitely per SDK best practices)
          const waitResult = await new Promise<'message' | 'aborted'>(
            (resolve) => {
              const abortHandler = () => resolve('aborted');
              abortController.signal.addEventListener('abort', abortHandler);

              const currentSession =
                sessionLifecycle.getActiveSession(sessionId);
              if (!currentSession) {
                resolve('aborted');
                return;
              }

              // Check queue again before waiting
              if (currentSession.messageQueue.length > 0) {
                abortController.signal.removeEventListener(
                  'abort',
                  abortHandler
                );
                resolve('message');
                return;
              }

              // Set wake callback - called when new message arrives
              currentSession.resolveNext = () => {
                abortController.signal.removeEventListener(
                  'abort',
                  abortHandler
                );
                resolve('message');
              };

              logger.debug(
                `[UserMessageStreamFactory] Waiting for message (${sessionId})...`
              );
            }
          );

          if (waitResult === 'aborted') {
            logger.debug(
              `[UserMessageStreamFactory] Stream ended: ${waitResult}`
            );
            return;
          }
        }
      },
    };
  }
}
