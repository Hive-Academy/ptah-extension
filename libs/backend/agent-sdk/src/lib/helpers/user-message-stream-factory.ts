/**
 * User Message Stream Factory
 *
 * Creates AsyncIterable streams for SDK user messages.
 * Encapsulates the complex async iterator logic with proper abort handling.
 */

import { injectable, inject } from 'tsyringe';
import { SessionId } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '../di/tokens';
import {
  SessionLifecycleManager,
  type SDKUserMessage,
} from './session-lifecycle-manager';

/**
 * Default timeout for waiting on messages (5 minutes)
 */
const MESSAGE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * UserMessageStreamFactory - Creates async iterables for SDK communication
 *
 * This factory creates the user message streams that the SDK consumes.
 * It handles:
 * - Message queue draining
 * - Abort signal handling
 * - Timeout management
 * - Wake callback coordination
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
   */
  create(
    sessionId: SessionId,
    abortController: AbortController
  ): AsyncIterable<SDKUserMessage> {
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

          // Wait for next message
          const waitResult = await new Promise<
            'message' | 'aborted' | 'timeout'
          >((resolve) => {
            const abortHandler = () => resolve('aborted');
            abortController.signal.addEventListener('abort', abortHandler);

            const currentSession = sessionLifecycle.getActiveSession(sessionId);
            if (!currentSession) {
              resolve('aborted');
              return;
            }

            // Check queue again before waiting
            if (currentSession.messageQueue.length > 0) {
              abortController.signal.removeEventListener('abort', abortHandler);
              resolve('message');
              return;
            }

            // Set timeout
            const timeoutId = setTimeout(() => {
              logger.warn(
                `[UserMessageStreamFactory] Session ${sessionId} timeout`
              );
              abortController.signal.removeEventListener('abort', abortHandler);
              resolve('timeout');
            }, MESSAGE_TIMEOUT_MS);

            // Set wake callback
            currentSession.resolveNext = () => {
              clearTimeout(timeoutId);
              abortController.signal.removeEventListener('abort', abortHandler);
              resolve('message');
            };

            logger.debug(
              `[UserMessageStreamFactory] Waiting for message (${sessionId})...`
            );
          });

          if (waitResult === 'aborted' || waitResult === 'timeout') {
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
