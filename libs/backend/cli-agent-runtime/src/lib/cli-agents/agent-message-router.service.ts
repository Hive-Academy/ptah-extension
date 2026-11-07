/**
 * Agent Message Router
 *
 * Decides HOW one message reaches a spawned agent, executes that choice, and
 * reports which mechanism actually fired. Extracted from
 * {@link AgentProcessManager} under the facade rule (TASK_2026_402, R-8):
 * `AgentProcessManager.sendToAgent` keeps its name and signature and delegates
 * here. The lifecycle methods stay in the manager.
 *
 * Two rules hold this file together:
 *
 * - **Nothing here branches on a CLI name.** The mechanism comes from the
 *   handle's own declarations, falling back to the adapter's `capabilities()`.
 *   A seventh adapter is routed correctly the day it declares its capabilities,
 *   without an edit here.
 * - **Nothing returns a success the caller would act on when nothing was
 *   delivered.** A refusal is `mode: 'unsupported'` carrying the reason; the
 *   three unroutable record states are thrown as {@link AgentMessageError} by
 *   the facade before routing starts.
 */
import { inject, injectable } from 'tsyringe';
import { randomUUID } from 'node:crypto';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import type {
  AgentMessageOutcome,
  AgentProcessInfo,
} from '@ptah-extension/shared';
import { CliDetectionService } from './cli-detection.service';
import type {
  AgentMessagingCapabilities,
  SdkHandle,
} from './cli-adapters/cli-adapter.interface';
import { legacyMessagingCapabilities } from './cli-adapters/cli-adapter.interface';
import {
  AGENT_MESSAGE_DISPATCH_JOURNAL,
  AgentMessageDispatchWithdrawnError,
  type AgentMessageDispatchJournal,
} from './messaging/agent-message-dispatch-journal.port';
import { classifyContinuationFailure } from './messaging/continuation-failure.classifier';

/**
 * How many messages may wait for an agent's current turn to finish.
 *
 * This live queue is in-memory and per agent; it holds only the delivery
 * mechanics. The record of truth is the durable inbox (the envelope store):
 * every message is persisted there before it is routed, and an entry queued
 * with a caller-supplied id is journalled as `dispatching` before it reaches
 * the adapter. After a restart the coordinator reclassifies what this queue
 * held. Over the cap the caller is REFUSED (`mode: 'unsupported'`) rather than
 * having its message silently dropped; the coordinator holds it and re-offers
 * it after the next settle.
 */
export const MAX_PENDING_MESSAGES = 8;

/** Record states that no messaging mechanism can serve. */
export type AgentMessageErrorCode = 'not_found' | 'restored' | 'not_running';

export class AgentMessageError extends Error {
  constructor(
    readonly code: AgentMessageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AgentMessageError';
  }
}

export class AgentInterruptedDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentInterruptedDeliveryError';
  }
}

/**
 * The slice of a tracked agent the router reads and writes.
 *
 * Declared here rather than imported so the router has no dependency on the
 * manager module — `AgentProcessManager`'s `TrackedAgent` satisfies it
 * structurally, and the import runs one way only.
 */
export interface MessageRoutableAgent {
  info: AgentProcessInfo;
  sdkHandle?: SdkHandle;
  subprocessReleased: boolean;
  restored?: true;
  /**
   * Settles when the turn currently in flight has torn down. Written by the
   * manager from `SdkHandle.done` and re-written from each continued turn's
   * `done`. `interrupt-resume` awaits it — without it the router races
   * `continueConversation`'s `busy` check.
   */
  currentTurnDone?: Promise<number>;
  /** Messages waiting for the current turn to end. Capped at {@link MAX_PENDING_MESSAGES}. */
  pendingMessages: PendingAgentMessage[];
}

export interface PendingAgentMessage {
  readonly messageId: string;
  readonly cliSessionId: string;
  readonly text: string;
  /**
   * True when the caller supplied `messageId` (an envelope id), so the flush
   * journals it before dispatch. A router-generated id has no envelope.
   */
  readonly journaled?: boolean;
}

export type AgentMessageStatus =
  | { status: 'pending' | 'delivered' }
  | { status: 'failed'; reason: string }
  | { status: 'unknown' };

const MAX_TERMINAL_MESSAGES = 64;
/** Outcome of the dispatch journal write for one queued entry. */
type JournalResult = 'ok' | 'refused' | 'withdrawn';

/**
 * The one manager operation the router invokes. Keeps the dependency an
 * interface rather than the manager class, so the router stays unit-testable
 * with a fake and the module graph stays acyclic.
 */
export interface ContinuationDispatcher {
  continueConversation(agentId: string, message: string, messageId?: string): Promise<void>;
}

/** Microtask ticks drained while waiting for an aborted turn's exit handling. */
const TURN_SETTLE_TICKS = 20;

@injectable()
export class AgentMessageRouter {
  private readonly terminal = new Map<string, AgentMessageStatus>();
  private readonly flushing = new Set<string>();
  private readonly inFlight = new Map<string, string>();
  private readonly interrupting = new Set<string>();
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CLI_DETECTION_SERVICE)
    private readonly cliDetection: CliDetectionService,
    @inject(AGENT_MESSAGE_DISPATCH_JOURNAL, { isOptional: true })
    private readonly journal: AgentMessageDispatchJournal | null = null,
  ) {}

  /**
   * Deliver `message` to a live agent by the best mechanism it supports.
   *
   * The caller has already rejected the unroutable record states, so every
   * path here either delivers or returns `unsupported` with a reason.
   */
  async route(
    agentId: string,
    tracked: MessageRoutableAgent,
    message: string,
    dispatcher: ContinuationDispatcher,
    delivery: 'queue' | 'now' | 'steer' = 'queue',
    messageId?: string,
    allowPartialTurnLoss = false,
  ): Promise<AgentMessageOutcome> {
    const outcome = await this.select(agentId, tracked, message, dispatcher, delivery, messageId, allowPartialTurnLoss);
    this.logger.info('[AgentMessageRouter] Message routed', {
      agentId,
      cli: tracked.info.cli,
      mode: outcome.mode,
      pending: tracked.pendingMessages.length,
    });
    return outcome;
  }

  private async select(
    agentId: string,
    tracked: MessageRoutableAgent,
    message: string,
    dispatcher: ContinuationDispatcher,
    delivery: 'queue' | 'now' | 'steer',
    messageId?: string,
    allowPartialTurnLoss = false,
  ): Promise<AgentMessageOutcome> {
    const handle = tracked.sdkHandle;
    const caps = this.resolveCapabilities(tracked);
    const turnInFlight = tracked.info.status === 'running';

    if (delivery === 'steer') {
      if (!turnInFlight || !caps.steer || !handle?.steer)
        return { mode: 'unsupported', reasonCode: 'steer-unavailable', detail: 'Explicit steer is unavailable for this active turn.' };
      try {
        await handle.steer(message);
      } catch {
        return { mode: 'unsupported', reasonCode: 'steer-rejected', detail: 'The live handle rejected the steer request.' };
      }
      return {
        mode: 'steer',
        detail:
          `Injected into the turn already running on ${tracked.info.cli}; ` +
          `the agent absorbs it without losing its current work.`,
      };
    }

    if (delivery === 'now') {
      if (turnInFlight && caps.steer && handle?.steer) {
        try {
          await handle.steer(message);
          return { mode: 'steer', detail: 'Injected into the active turn.' };
        } catch (error: unknown) {
          return { mode: 'unsupported', reasonCode: 'steer-rejected', detail: `Steer rejected: ${describeError(error)}` };
        }
      }
      if (turnInFlight && caps.interrupt && caps.continuation && handle?.interrupt) {
        if (!allowPartialTurnLoss)
          return { mode: 'unsupported', reasonCode: 'confirmation-required', detail: 'Confirm partial turn work loss before interrupting.' };
        return this.interruptAndResume(agentId, tracked, message, dispatcher);
      }
      return { mode: 'unsupported', reasonCode: 'immediate-unavailable', detail: 'No immediate delivery mechanism is available.' };
    }

    if (caps.continuation) {
      return turnInFlight
        ? this.park(tracked, message, messageId)
        : this.startNewTurn(agentId, tracked, message, dispatcher);
    }

    return {
      mode: 'unsupported',
      reasonCode: 'continuation-unavailable',
      detail:
        `${tracked.info.cli} offers no mechanism for delivering a message to ` +
        `an agent it has already started: it supports neither mid-turn ` +
        `steering, nor interrupting a turn, nor continuing the conversation. ` +
        `Nothing was delivered. The agent will finish on its original prompt; ` +
        `spawn a new agent if the new instruction cannot wait.`,
    };
  }

  /**
   * Abort the running turn, wait for it to tear down, then re-submit.
   *
   * The wait is the whole point: `continueConversation` refuses a `running`
   * agent as `busy`, and the record only leaves `running` inside the exit
   * handling that the turn's `done` promise triggers.
   */
  private async interruptAndResume(
    agentId: string,
    tracked: MessageRoutableAgent,
    message: string,
    dispatcher: ContinuationDispatcher,
  ): Promise<AgentMessageOutcome> {
    this.interrupting.add(agentId);
    try {
      await tracked.sdkHandle?.interrupt?.();
    } catch (error: unknown) {
      this.interrupting.delete(agentId);
      return {
        mode: 'unsupported',
        reasonCode: 'interrupt-failed',
        detail:
          `Interrupting the current ${tracked.info.cli} turn failed: ` +
          `${describeError(error)}. Nothing was delivered and the turn was ` +
          `left running.`,
      };
    }

    let resubmitted = false;
    try {
      await this.awaitTurnSettled(tracked);
      await dispatcher.continueConversation(agentId, message);
      resubmitted = true;
    } catch (error: unknown) {
      throw new AgentInterruptedDeliveryError(
        `The ${tracked.info.cli} turn was interrupted but the message could not be re-submitted: ${describeError(error)}.`,
      );
    } finally {
      this.interrupting.delete(agentId);
      if (!resubmitted) await this.flushPending(agentId, tracked, dispatcher);
    }

    return {
      mode: 'interrupt-resume',
      detail:
        `The turn in flight was aborted and the message re-submitted on the ` +
        `same session. The aborted turn's partial work is DISCARDED — only ` +
        `what it had already written to disk survives.`,
    };
  }

  /** Hold the message until the current turn ends, or refuse if the queue is full. */
  private park(
    tracked: MessageRoutableAgent,
    message: string,
    receiptId?: string,
  ): AgentMessageOutcome {
    if (tracked.pendingMessages.length >= MAX_PENDING_MESSAGES) {
      return {
        mode: 'unsupported',
        reasonCode: 'queue-full',
        detail:
          `${tracked.pendingMessages.length} messages are already waiting for ` +
          `this agent's current turn to finish, which is the limit of ` +
          `${MAX_PENDING_MESSAGES}. This message was NOT queued and nothing ` +
          `was delivered. Wait for the queue to drain, or stop the agent and ` +
          `spawn a new one with the combined instruction.`,
      };
    }

    const cliSessionId = tracked.info.cliSessionId;
    if (!cliSessionId) return { mode: 'unsupported', reasonCode: 'no-session', detail: 'The agent session is unavailable; nothing was queued.' };
    const messageId = receiptId ?? randomUUID();
    tracked.pendingMessages.push({
      messageId, cliSessionId, text: message,
      ...(receiptId !== undefined ? { journaled: true } : {}),
    });
    return {
      mode: 'queue-next-turn',
      messageId,
      detail:
        `Message ${messageId} is pending at position ${tracked.pendingMessages.length}. Check its status for delivery.`,
    };
  }

  /** The agent finished its turn but is still alive — start a new one now. */
  private async startNewTurn(
    agentId: string,
    tracked: MessageRoutableAgent,
    message: string,
    dispatcher: ContinuationDispatcher,
  ): Promise<AgentMessageOutcome> {
    try {
      await dispatcher.continueConversation(agentId, message);
    } catch (error: unknown) {
      return {
        mode: 'unsupported',
        reasonCode: 'start-turn-failed',
        detail: `Starting a new turn failed: ${describeError(error)}. Nothing was delivered.`,
      };
    }

    return {
      mode: 'start-turn',
      detail:
        `The agent had already finished its turn and is still alive, so this ` +
        `message starts a NEW turn on the same conversation rather than ` +
        `joining one in progress.`,
    };
  }

  /**
   * Deliver ONE queued message, if any, now that the agent's turn has settled.
   *
   * Called from the manager's single settle point. One at a time on purpose:
   * the next turn's own settle drains the next entry, so a queue never turns
   * into a burst of overlapping continuations.
   */
  async flushPending(
    agentId: string,
    tracked: MessageRoutableAgent,
    dispatcher: ContinuationDispatcher,
  ): Promise<void> {
    if (tracked.pendingMessages.length === 0 || this.flushing.has(agentId) || this.interrupting.has(agentId)) return;

    if (tracked.subprocessReleased) {
      const dropped = tracked.pendingMessages.length;
      this.failPending(agentId, tracked, 'subprocess_released');
      this.logger.error(
        '[AgentMessageRouter] Queued messages dropped — subprocess released',
        {
          agentId,
          cli: tracked.info.cli,
          dropped,
          cliSessionId: tracked.info.cliSessionId,
        },
      );
      return;
    }

    const next = tracked.pendingMessages.shift();
    if (next === undefined) return;

    if (!tracked.info.cliSessionId || tracked.info.cliSessionId !== next.cliSessionId) {
      this.setTerminal(agentId, next.messageId, { status: 'failed', reason: 'session_changed' });
      for (let index = tracked.pendingMessages.length - 1; index >= 0; index -= 1) {
        const entry = tracked.pendingMessages[index];
        if (entry.cliSessionId !== next.cliSessionId) continue;
        this.setTerminal(agentId, entry.messageId, { status: 'failed', reason: 'session_changed' });
        tracked.pendingMessages.splice(index, 1);
      }
      return;
    }

    this.flushing.add(agentId);
    this.inFlight.set(agentId, next.messageId);
    // A previous flush may have reported this entry `storage-unavailable` and
    // put it back; this attempt starts from a clean status.
    this.terminal.delete(`${agentId}:${next.messageId}`);
    let journal: JournalResult = 'refused';
    let rejected = false;
    try {
      journal = await this.journalDispatch(agentId, tracked, next);
      if (journal === 'ok' && this.terminal.get(`${agentId}:${next.messageId}`)?.status !== 'failed') {
        await dispatcher.continueConversation(agentId, next.text, next.messageId);
        if (this.terminal.get(`${agentId}:${next.messageId}`)?.status !== 'failed')
          this.setTerminal(agentId, next.messageId, { status: 'delivered' });
        this.logger.info('[AgentMessageRouter] Delivered queued message', {
          agentId,
          cli: tracked.info.cli,
          remaining: tracked.pendingMessages.length,
        });
      }
    } catch (error: unknown) {
      const reason = classifyContinuationFailure(error);
      // Only this entry failed; the reconciler decides between a backoff retry
      // and a permanent hold with the body kept. A transient refusal (busy) is
      // followed by a settle, which offers the next entry; a permanent one
      // started no turn, so the next entry is offered below.
      rejected = reason === 'continuation_rejected';
      this.setTerminal(agentId, next.messageId, { status: 'failed', reason });
      this.logger.error(
        '[AgentMessageRouter] Queued message could not be delivered',
        {
          agentId,
          cli: tracked.info.cli,
          error: error instanceof Error ? error.name : 'unknown',
          reason,
          remaining: tracked.pendingMessages.length,
        },
      );
    } finally {
      this.inFlight.delete(agentId);
      this.flushing.delete(agentId);
    }
    // A withdrawn or permanently rejected entry ran nothing, so no settle will
    // follow: offer the next one now.
    if (journal === 'withdrawn' || rejected) await this.flushPending(agentId, tracked, dispatcher);
  }

  /**
   * Durably journal `dispatching` before an envelope-backed entry reaches the
   * adapter. Without a journal, or for a router-generated id, there is nothing
   * to journal. When the write is refused the store is failing: the entry goes
   * back to the head of the queue, is reported `storage-unavailable`, and this
   * flush stops — nothing is dispatched and the other entries stay queued.
   * A withdrawn entry (cancelled or re-routed after this flush took it) is
   * dropped: its envelope already records the decision.
   */
  private async journalDispatch(
    agentId: string,
    tracked: MessageRoutableAgent,
    entry: PendingAgentMessage,
  ): Promise<JournalResult> {
    if (!this.journal || !entry.journaled) return 'ok';
    try {
      await this.journal.markDispatching(entry.messageId);
      return 'ok';
    } catch (error: unknown) {
      if (error instanceof AgentMessageDispatchWithdrawnError) {
        this.logger.info('[AgentMessageRouter] Queued message withdrawn before dispatch', {
          agentId, state: error.state,
        });
        return 'withdrawn';
      }
      // A teardown during the write already reported the entry; re-queuing it
      // would hand a stopped agent work it can never receive.
      if (this.terminal.get(`${agentId}:${entry.messageId}`)?.status !== 'failed') {
        tracked.pendingMessages.unshift(entry);
        this.setTerminal(agentId, entry.messageId, { status: 'failed', reason: 'storage-unavailable' });
      }
      this.logger.error(
        '[AgentMessageRouter] Dispatch journal write failed; queued message not dispatched',
        error instanceof Error ? error : new Error(String(error)),
      );
      return 'refused';
    }
  }

  /** Forget anything still queued for a record that can no longer receive it. */
  discardPending(agentId: string, tracked: MessageRoutableAgent): number {
    const activeId = this.inFlight.get(agentId);
    if (activeId) this.setTerminal(agentId, activeId, { status: 'failed', reason: 'agent_stopped' });
    if (tracked.pendingMessages.length === 0) return 0;
    const dropped = tracked.pendingMessages.length;
    this.failPending(agentId, tracked, 'agent_stopped');
    this.logger.warn(
      '[AgentMessageRouter] Discarded queued messages for a torn-down agent',
      { agentId, cli: tracked.info.cli, dropped },
    );
    return dropped;
  }

  messageStatus(agentId: string, tracked: MessageRoutableAgent | undefined, messageId: string): AgentMessageStatus {
    if (this.terminal.has(`${agentId}:${messageId}`)) return this.terminal.get(`${agentId}:${messageId}`)!;
    if (this.inFlight.get(agentId) === messageId) return { status: 'pending' };
    if (tracked?.pendingMessages.some((entry) => entry.messageId === messageId)) return { status: 'pending' };
    return { status: 'unknown' };
  }

  /** Release per-agent routing state when the manager expires its record. */
  forgetAgent(agentId: string): void {
    for (const key of this.terminal.keys())
      if (key.startsWith(`${agentId}:`)) this.terminal.delete(key);
    this.inFlight.delete(agentId);
    this.flushing.delete(agentId);
    this.interrupting.delete(agentId);
  }

  private failPending(agentId: string, tracked: MessageRoutableAgent, reason: string): void {
    for (const entry of tracked.pendingMessages)
      this.setTerminal(agentId, entry.messageId, { status: 'failed', reason });
    tracked.pendingMessages.length = 0;
  }

  private setTerminal(agentId: string, messageId: string, status: AgentMessageStatus): void {
    this.terminal.set(`${agentId}:${messageId}`, status);
    if (this.terminal.size > MAX_TERMINAL_MESSAGES) this.terminal.delete(this.terminal.keys().next().value!);
  }

  /**
   * The capability declaration that governs this agent.
   *
   * The HANDLE wins when present — it knows what its own live run can do — and
   * the adapter's declaration is the fallback for a record whose handle is
   * gone. No CLI name is read on either path.
   */
  private resolveCapabilities(
    tracked: MessageRoutableAgent,
  ): AgentMessagingCapabilities {
    const handle = tracked.sdkHandle;
    if (handle) {
      return {
        steer: typeof handle.steer === 'function',
        interrupt:
          handle.supportsInterrupt?.() === true &&
          typeof handle.interrupt === 'function',
        continuation:
          handle.supportsContinuation?.() === true &&
          typeof handle.continue === 'function' &&
          !tracked.subprocessReleased,
      };
    }

    const adapterCaps = this.cliDetection
      .getAdapter(tracked.info.cli)
      ?.capabilities();
    return (
      adapterCaps ? legacyMessagingCapabilities(adapterCaps) : { steer: false, interrupt: false, continuation: false }
    );
  }

  /**
   * Wait for the aborted turn's exit handling to have run.
   *
   * `currentTurnDone` settles when the turn's own `done` promise does, but the
   * manager's exit handler is a SEPARATE continuation on that same promise.
   * Draining a bounded number of microtask ticks lets that handler move the
   * record out of `running` before the resume is attempted; the loop exits on
   * the first tick where it has.
   */
  private async awaitTurnSettled(tracked: MessageRoutableAgent): Promise<void> {
    if (tracked.currentTurnDone) {
      await tracked.currentTurnDone;
    }
    for (
      let tick = 0;
      tick < TURN_SETTLE_TICKS && tracked.info.status === 'running';
      tick++
    ) {
      await Promise.resolve();
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? 'operation failed' : 'unknown failure';
}
