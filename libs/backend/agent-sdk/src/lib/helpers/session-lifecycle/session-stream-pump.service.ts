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
 * ONE MESSAGE PER TURN (TASK_2026_294). The iterator claims `turnInFlight`
 * before every yield and refuses to yield again until `markTurnEnded` clears it
 * on the turn's `result`. Handing a prompt to the SDK mid-turn does NOT steer
 * the agent: the SDK enqueues it, removes it, records it as a `queued_command`
 * transcript attachment, and never turns it into a user message. Ptah owns the
 * queue precisely so that cannot happen — do not "simplify" the gate away.
 *
 * Extracted from `SessionLifecycleManager` (originally lines
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
import type {
  AIMessageOptions,
  SessionId,
  InlineImageAttachment,
} from '@ptah-extension/shared';

import { SdkError, SessionAdmissionRefusedError } from '../../errors';
import type {
  SDKMessageOrigin,
  SDKUserMessage,
} from '../../types/sdk-types/claude-sdk.types';
import type { SdkMessageFactory } from '../sdk-message-factory';
import type {
  QueuedSessionInput,
  SessionHandoverCoordinator,
} from '../session-handoff/session-handover-coordinator.service';
import type {
  SessionRecord,
  SessionRegistry,
} from './session-registry.service';

export class SessionStreamPump {
  constructor(
    private readonly logger: Logger,
    private readonly registry: SessionRegistry,
    private readonly messageFactory: SdkMessageFactory,
    private readonly handoverCoordinator: SessionHandoverCoordinator | null = null,
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
    const messageFactory = this.messageFactory;
    const handoverCoordinator = this.handoverCoordinator;

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
          while (session.messageQueue.length > 0 && !session.turnInFlight) {
            const input = session.messageQueue.shift();
            if (input) {
              // A handover can arm after this iterator wakes but before it
              // claims a turn. Re-admit at the dequeue boundary so no source
              // input crosses the closed gate.
              if (
                input.admission !== 'owned-compact' &&
                input.admission !== 'owned-handoff' &&
                handoverCoordinator?.admitOrHold(
                  sessionId as string,
                  input,
                ).held
              ) {
                continue;
              }
              const message = await messageFactory.createUserMessage({
                content: input.content,
                sessionId,
                files: input.files ? [...input.files] : undefined,
                images: input.images ? [...input.images] : undefined,
                origin: input.origin,
              });
              // Claim the turn BEFORE yielding: this both ends the drain loop
              // after one message and blocks any message that arrives while
              // the SDK is generating (TASK_2026_294).
              registry.markTurnStarted(session);
              logger.debug(
                `[SessionLifecycle] Yielding message (${session.messageQueue.length} held)`,
              );
              yield message;
            }
            if (abortController.signal.aborted) return;
          }
          const waitResult = await new Promise<'message' | 'aborted'>(
            (resolve) => {
              const abortHandler = () => resolve('aborted');
              abortController.signal.addEventListener('abort', abortHandler);

              const currentSession = registry.find(sessionId as string);
              if (!currentSession) {
                resolve('aborted');
                return;
              }
              // `!turnInFlight` is load-bearing, not a micro-optimisation:
              // without it a message held during a turn keeps this fast path
              // resolving immediately and the outer loop hot-spins, because
              // the drain loop above refuses to consume it.
              if (
                currentSession.messageQueue.length > 0 &&
                !currentSession.turnInFlight
              ) {
                abortController.signal.removeEventListener(
                  'abort',
                  abortHandler,
                );
                resolve('message');
                return;
              }
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
   * @param options - Provenance of the turn. Absent means an interactive human
   *   turn; `SdkMessageFactory` defaults it to `{ kind: 'human' }`. A caller
   *   injecting a turn on someone else's behalf (a peer session, a channel, a
   *   coordinator) must pass an explicit origin, because that origin is the
   *   only thing that stops the message rendering as the user's own words.
   *   `admission: 'require-idle'` admits the message only onto a live, idle
   *   record and otherwise throws `SessionAdmissionRefusedError` without
   *   queueing anything; absent, a message sent mid-turn is held as today.
   */
  async sendMessage(
    sessionId: SessionId,
    content: string,
    files?: string[],
    images?: InlineImageAttachment[],
    options?: {
      origin?: SDKMessageOrigin;
      admission?: AIMessageOptions['admission'];
    },
  ): Promise<void> {
    const requireIdle = options?.admission === 'require-idle';
    const session = this.registry.find(sessionId as string);
    if (!session) {
      if (requireIdle) {
        throw new SessionAdmissionRefusedError(
          'session-ended',
          sessionId as string,
        );
      }
      throw new SdkError(`Session not found: ${sessionId}`);
    }
    const input: QueuedSessionInput = {
      content,
      ...(files ? { files } : {}),
      ...(images ? { images } : {}),
      ...(options?.origin ? { origin: options.origin } : {}),
      ...(requireIdle ? { admission: 'require-idle' as const } : {}),
    };
    if (this.handoverCoordinator?.admitOrHold(sessionId as string, input).held) {
      return;
    }
    if (requireIdle) {
      // Fail fast before building the message. Not sufficient on its own: the
      // await below yields, so the same check runs again before the push.
      this.assertAdmissible(sessionId, session);
    } else {
      this.registry.markActive(sessionId as string);
    }

    this.logger.info(`[SessionLifecycle] Sending message to ${sessionId}`, {
      contentLength: content.length,
      fileCount: files?.length || 0,
      imageCount: images?.length || 0,
      originKind: options?.origin?.kind,
    });

    if (requireIdle) {
      // The first admission check can race with any asynchronous caller.
      // Repeat it at the actual enqueue boundary.
      this.assertAdmissible(sessionId, session);
      this.registry.markActive(sessionId as string);
    }
    session.messageQueue.push(input);
    if (session.resolveNext) {
      session.resolveNext();
      session.resolveNext = null;
    }

    this.logger.info(
      session.turnInFlight
        ? `[SessionLifecycle] Message held for ${sessionId} — turn in flight, will send at turn end`
        : `[SessionLifecycle] Message queued for ${sessionId}`,
    );
  }

  /** Queue the coordinator-owned `/compact` after it has closed admission. */
  async enqueueOwnedCompact(sessionId: SessionId): Promise<void> {
    const session = this.registry.find(sessionId as string);
    if (!session || session.abortController.signal.aborted) {
      throw new SdkError(`Session not found: ${sessionId}`);
    }
    if (session.turnInFlight || session.messageQueue.length > 0) {
      throw new SessionAdmissionRefusedError('busy', sessionId as string);
    }
    this.registry.markActive(sessionId as string);
    session.messageQueue.push({ content: '/compact', admission: 'owned-compact' });
    if (session.resolveNext) {
      session.resolveNext();
      session.resolveNext = null;
    }
  }

  /** Queue a coordinator-owned handoff request after admission has closed. */
  async enqueueOwnedHandoff(sessionId: SessionId, prompt: string): Promise<void> {
    const session = this.registry.find(sessionId as string);
    if (!session || session.abortController.signal.aborted) {
      throw new SdkError(`Session not found: ${sessionId}`);
    }
    if (session.turnInFlight || session.messageQueue.length > 0) {
      throw new SessionAdmissionRefusedError('busy', sessionId as string);
    }
    this.registry.markActive(sessionId as string);
    session.messageQueue.push({ content: prompt, admission: 'owned-handoff' });
    if (session.resolveNext) {
      session.resolveNext();
      session.resolveNext = null;
    }
  }

  /**
   * Append the coordinator-detached FIFO as one queue ownership transfer.
   * This deliberately bypasses normal handover admission: the inputs were
   * admitted and held by the source coordinator before this successor existed.
   */
  async enqueueTransferInputs(
    sessionId: SessionId,
    inputs: readonly QueuedSessionInput[],
  ): Promise<void> {
    const session = this.registry.find(sessionId as string);
    if (!session || session.abortController.signal.aborted) {
      throw new SdkError(`Session not found: ${sessionId}`);
    }
    if (session.turnInFlight || session.messageQueue.length > 0) {
      throw new SessionAdmissionRefusedError('busy', sessionId as string);
    }
    session.messageQueue.push(...inputs);
    this.registry.markActive(sessionId as string);
    if (session.resolveNext) {
      session.resolveNext();
      session.resolveNext = null;
    }
  }

  /**
   * Throw `SessionAdmissionRefusedError` unless `session` is still the live
   * registered record for `sessionId` and is idle. `session-ended` covers a
   * removed or displaced record and an aborted one; `busy` covers a turn in
   * flight or a message already queued.
   */
  private assertAdmissible(sessionId: SessionId, session: SessionRecord): void {
    if (
      this.registry.find(sessionId as string) !== session ||
      session.abortController.signal.aborted
    ) {
      this.logger.info(
        `[SessionLifecycle] Admission refused for ${sessionId}: session ended`,
      );
      throw new SessionAdmissionRefusedError(
        'session-ended',
        sessionId as string,
      );
    }
    if (session.turnInFlight || session.messageQueue.length > 0) {
      this.logger.info(
        `[SessionLifecycle] Admission refused for ${sessionId}: busy`,
      );
      throw new SessionAdmissionRefusedError('busy', sessionId as string);
    }
  }
}
