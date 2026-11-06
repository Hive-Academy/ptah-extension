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
  QueuedFollowUpSnapshot,
  QueuedFollowUpStateChange,
  SteerQueuedFollowUpResult,
} from '@ptah-extension/shared';

import { SdkError, SessionAdmissionRefusedError } from '../../errors';
import type {
  SDKMessageOrigin,
  SDKUserMessage,
} from '../../types/sdk-types/claude-sdk.types';
import type { SdkMessageFactory } from '../sdk-message-factory';
import type {
  SessionRecord,
  SessionRegistry,
} from './session-registry.service';

export class SessionStreamPump {
  private readonly acceptedLaneDeliveries = new Map<string, string>();
  private readonly receipts = new WeakMap<SessionRecord, Map<string, { fingerprint: string; state: 'queued' | 'delivered' | 'withdrawn' | 'failed' }>>();
  private readonly followUpListeners = new Set<
    (change: QueuedFollowUpStateChange) => void
  >();
  constructor(
    private readonly logger: Logger,
    private readonly registry: SessionRegistry,
    private readonly messageFactory: SdkMessageFactory,
  ) {
    registry.onRecordRemoved((record) => {
      for (const turn of record.messageQueue) {
        if (turn.followUp && turn.sessionId) {
          this.emit({
            sessionId: turn.sessionId,
            clientMessageId: turn.followUp.clientMessageId,
            state: 'failed',
            reason: 'Session ended',
          });
        }
      }
      record.messageQueue.length = 0;
    });
  }

  onQueuedFollowUpState(
    listener: (change: QueuedFollowUpStateChange) => void,
  ): () => void {
    this.followUpListeners.add(listener);
    return () => this.followUpListeners.delete(listener);
  }

  listQueuedFollowUps(sessionId: SessionId): readonly QueuedFollowUpSnapshot[] {
    return (
      this.registry
        .find(sessionId as string)
        ?.messageQueue.flatMap((turn) =>
          turn.followUp ? [turn.followUp] : [],
        ) ?? []
    );
  }

  withdrawQueuedFollowUp(
    sessionId: SessionId,
    clientMessageId: string,
  ): boolean {
    const record = this.registry.find(sessionId as string);
    if (!record) return false;
    const index = record.messageQueue.findIndex(
      (turn) =>
        turn.followUp?.clientMessageId === clientMessageId &&
        turn.recordToken === record.token,
    );
    if (index < 0) return false;
    const [turn] = record.messageQueue.splice(index, 1);
    this.emit({
      sessionId: turn.sessionId ?? sessionId,
      clientMessageId,
      state: 'withdrawn',
    });
    return true;
  }

  async steerQueuedFollowUp(
    sessionId: SessionId,
    clientMessageId: string,
    interrupt: () => Promise<boolean>,
  ): Promise<SteerQueuedFollowUpResult> {
    const record = this.registry.find(sessionId as string);
    if (!record || record.abortController.signal.aborted)
      return { ok: false, code: 'SESSION_ENDED' };
    const index = record.messageQueue.findIndex(
      (turn) => turn.followUp?.clientMessageId === clientMessageId &&
        turn.recordToken === record.token,
    );
    if (index < 0) return { ok: false, code: 'NOT_QUEUED' };
    if (record.promotingFollowUpId) return { ok: false, code: 'TURN_CHANGED' };
    const [turn] = record.messageQueue.splice(index, 1);
    record.messageQueue.unshift(turn);
    if (!record.turnInFlight) {
      record.resolveNext?.();
      record.resolveNext = null;
      return { ok: true, mode: 'admitted' };
    }
    record.promotingFollowUpId = clientMessageId;
    try {
      const interrupted = await interrupt();
      if (!interrupted) {
        const currentIndex = record.messageQueue.indexOf(turn);
        if (currentIndex >= 0) {
          record.messageQueue.splice(currentIndex, 1);
          record.messageQueue.splice(index, 0, turn);
        }
        return { ok: false, code: 'INTERRUPT_FAILED' };
      }
      return { ok: true, mode: 'interrupt' };
    } finally {
      record.promotingFollowUpId = null;
    }
  }

  private emit(change: QueuedFollowUpStateChange): void {
    const record = this.registry.find(change.sessionId as string);
    const receipt = record && this.receipts.get(record)?.get(change.clientMessageId);
    if (receipt && change.state !== 'steered') receipt.state = change.state;
    for (const listener of this.followUpListeners) {
      try {
        listener(change);
      } catch (error: unknown) {
        this.logger.warn(
          '[SessionLifecycle] Follow-up listener failed',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  }

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
    const emit = (change: QueuedFollowUpStateChange) => this.emit(change);
    const ownerToken = registry.find(sessionId as string)?.token;

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
          if (
            session.abortController.signal.aborted ||
            session.token !== ownerToken
          )
            return;
          while (session.messageQueue.length > 0 && !session.turnInFlight) {
            const turn = session.messageQueue.shift();
            if (turn) {
              if (turn.recordToken && turn.recordToken !== session.token) {
                if (turn.followUp && turn.sessionId)
                  emit({
                    sessionId: turn.sessionId,
                    clientMessageId: turn.followUp.clientMessageId,
                    state: 'failed',
                    reason: 'Session ended',
                  });
                continue;
              }
              // Claim the turn BEFORE yielding: this both ends the drain loop
              // after one message and blocks any message that arrives while
              // the SDK is generating (TASK_2026_294).
              registry.markTurnStarted(session);
              session.yieldSequence = (session.yieldSequence ?? 0) + 1;
              if (
                session.interruptAwaitingResultYieldSequence !== null &&
                session.yieldSequence >
                  session.interruptAwaitingResultYieldSequence + 1
              ) {
                session.interruptAwaitingResultYieldSequence = null;
                session.interruptedTurnUserMessageUuid = null;
              }
              // Keep an owed interrupt result until result metadata identifies
              // either that result or the new turn's result.
              session.resultYieldSequence = null;
              if (session.currentTurnClientMessageId !== null) {
                (session.displacedRetirements ??= []).push(
                  session.currentTurnClientMessageId,
                );
                session.retirementWake?.();
              }
              if (session.awaitingEcho !== null) {
                logger.debug('[SessionLifecycle] Replacing unechoed turn', {
                  unechoedTurnDropped: true,
                });
              }
              session.awaitingEcho = turn;
              session.currentTurnClientMessageId = turn.clientMessageId ?? null;
              session.currentTurnUserMessageUuid = turn.message.uuid;
              if (turn.followUp && turn.sessionId)
                emit({
                  sessionId: turn.sessionId,
                  clientMessageId: turn.followUp.clientMessageId,
                  state: 'delivered',
                });
              logger.debug(
                `[SessionLifecycle] Yielding message (${session.messageQueue.length} held)`,
              );
              yield turn.message;
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
   *   `background: true` marks an automatic send on the session's own behalf
   *   (idle `/compact`): it does not make this session the active one, so a
   *   background tab cannot take over active-session lookups.
   */
  async sendMessage(
    sessionId: SessionId,
    content: string,
    files?: string[],
    images?: InlineImageAttachment[],
    options?: {
      origin?: SDKMessageOrigin;
      admission?: AIMessageOptions['admission'];
      clientMessageId?: string;
      queueIntent?: AIMessageOptions['queueIntent'];
      beforeEnqueue?: () => void;
      background?: boolean;
    },
  ): Promise<void> {
    const requireIdle = options?.admission === 'require-idle';
    if (options?.queueIntent && !options.clientMessageId)
      throw new SdkError('Queued follow-up requires clientMessageId');
    const markActive = (): void => {
      if (!options?.background) this.registry.markActive(sessionId as string);
    };
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
    if (requireIdle) {
      // Fail fast before building the message. Not sufficient on its own: the
      // await below yields, so the same check runs again before the push.
      this.assertAdmissible(sessionId, session);
    } else {
      markActive();
    }
    const fingerprint = JSON.stringify([content, files ?? [], images ?? []]);
    const laneDeliveryId = options?.clientMessageId?.startsWith('lane-delivery:')
      ? options.clientMessageId : undefined;
    if (laneDeliveryId) {
      const accepted = this.acceptedLaneDeliveries.get(laneDeliveryId);
      if (accepted !== undefined) {
        if (accepted !== fingerprint) throw new SdkError('Lane delivery ID reused with different content');
        return;
      }
    }
    const receipts = this.receipts.get(session) ?? new Map<string, { fingerprint: string; state: 'queued' | 'delivered' | 'withdrawn' | 'failed' }>();
    this.receipts.set(session, receipts);
    if (options?.queueIntent) {
      const existing = receipts.get(options.clientMessageId!);
      if (existing) {
        if (existing.fingerprint !== fingerprint || existing.state === 'withdrawn' || existing.state === 'failed')
          throw new SdkError('FOLLOW_UP_ID_CONFLICT: clientMessageId was reused');
        return;
      }
      receipts.set(options.clientMessageId!, { fingerprint, state: 'queued' });
    }

    this.logger.info(`[SessionLifecycle] Sending message to ${sessionId}`, {
      contentLength: content.length,
      fileCount: files?.length || 0,
      imageCount: images?.length || 0,
      originKind: options?.origin?.kind,
    });

    let sdkUserMessage: SDKUserMessage;
    try {
      sdkUserMessage = await this.messageFactory.createUserMessage({
        content,
        sessionId,
        files,
        images,
        origin: options?.origin,
      });
    } catch (error: unknown) {
      if (options?.queueIntent) receipts.get(options.clientMessageId!)!.state = 'failed';
      throw error;
    }
    if (
      options?.queueIntent &&
      (this.registry.find(sessionId as string) !== session ||
        session.abortController.signal.aborted)
    ) {
      receipts.get(options.clientMessageId!)!.state = 'failed';
      throw new SdkError('Session ended before follow-up admission');
    }
    if (requireIdle) {
      // Synchronous from here to the push: no competing send, teardown or
      // turn start can interleave between this check and the enqueue.
      this.assertAdmissible(sessionId, session);
      options?.beforeEnqueue?.();
      markActive();
    }
    const followUp: QueuedFollowUpSnapshot | undefined = options?.queueIntent
      ? {
          clientMessageId: options.clientMessageId!,
          content,
          files: files ? [...files] : undefined,
          images: images ? images.map((image) => ({ ...image })) : undefined,
        }
      : undefined;
    session.messageQueue.push({
      message: sdkUserMessage,
      clientMessageId: options?.clientMessageId,
      followUp,
      sessionId: followUp ? sessionId : undefined,
      recordToken: followUp ? session.token : undefined,
    });
    if (laneDeliveryId) {
      this.acceptedLaneDeliveries.set(laneDeliveryId, fingerprint);
      if (this.acceptedLaneDeliveries.size > 1024) {
        const oldest = this.acceptedLaneDeliveries.keys().next().value;
        if (oldest !== undefined) this.acceptedLaneDeliveries.delete(oldest);
      }
    }
    if (followUp)
      this.emit({
        sessionId,
        clientMessageId: followUp.clientMessageId,
        state: 'queued',
      });
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
