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

/**
 * How many messages may wait for an agent's current turn to finish.
 *
 * The queue is in-memory, per agent, and never persisted: a message that has
 * not been delivered when the host stops was not delivered, and pretending
 * otherwise across a restart is worse than losing it visibly. Over the cap the
 * caller is REFUSED (`mode: 'unsupported'`) rather than having its message
 * silently dropped.
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
  pendingMessages: string[];
}

/**
 * The one manager operation the router invokes. Keeps the dependency an
 * interface rather than the manager class, so the router stays unit-testable
 * with a fake and the module graph stays acyclic.
 */
export interface ContinuationDispatcher {
  continueConversation(agentId: string, message: string): Promise<void>;
}

/** Microtask ticks drained while waiting for an aborted turn's exit handling. */
const TURN_SETTLE_TICKS = 20;

@injectable()
export class AgentMessageRouter {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CLI_DETECTION_SERVICE)
    private readonly cliDetection: CliDetectionService,
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
  ): Promise<AgentMessageOutcome> {
    const outcome = await this.select(agentId, tracked, message, dispatcher);
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
  ): Promise<AgentMessageOutcome> {
    const handle = tracked.sdkHandle;
    const caps = this.resolveCapabilities(tracked);
    const turnInFlight = tracked.info.status === 'running';

    if (turnInFlight && caps.steer && handle?.steer) {
      handle.steer(message);
      return {
        mode: 'steer',
        detail:
          `Injected into the turn already running on ${tracked.info.cli}; ` +
          `the agent absorbs it without losing its current work.`,
      };
    }

    if (turnInFlight && caps.interrupt && handle?.interrupt) {
      return this.interruptAndResume(agentId, tracked, message, dispatcher);
    }

    if (caps.continuation) {
      return turnInFlight
        ? this.park(tracked, message)
        : this.startNewTurn(agentId, tracked, message, dispatcher);
    }

    return {
      mode: 'unsupported',
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
    try {
      await tracked.sdkHandle?.interrupt?.();
    } catch (error: unknown) {
      return {
        mode: 'unsupported',
        detail:
          `Interrupting the current ${tracked.info.cli} turn failed: ` +
          `${describeError(error)}. Nothing was delivered and the turn was ` +
          `left running.`,
      };
    }

    await this.awaitTurnSettled(tracked);

    try {
      await dispatcher.continueConversation(agentId, message);
    } catch (error: unknown) {
      return {
        mode: 'unsupported',
        detail:
          `The ${tracked.info.cli} turn was interrupted but the message could ` +
          `not be re-submitted: ${describeError(error)}. The interrupted ` +
          `turn's partial work is gone and the message was not delivered.`,
      };
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
  ): AgentMessageOutcome {
    if (tracked.pendingMessages.length >= MAX_PENDING_MESSAGES) {
      return {
        mode: 'unsupported',
        detail:
          `${tracked.pendingMessages.length} messages are already waiting for ` +
          `this agent's current turn to finish, which is the limit of ` +
          `${MAX_PENDING_MESSAGES}. This message was NOT queued and nothing ` +
          `was delivered. Wait for the queue to drain, or stop the agent and ` +
          `spawn a new one with the combined instruction.`,
      };
    }

    tracked.pendingMessages.push(message);
    return {
      mode: 'queue-next-turn',
      detail:
        `The agent is mid-turn and ${tracked.info.cli} cannot be interrupted ` +
        `or steered, so the message is queued at position ` +
        `${tracked.pendingMessages.length} and will be delivered as a new ` +
        `turn when the current one ends.`,
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
        detail: `Starting a new turn failed: ${describeError(error)}. Nothing was delivered.`,
      };
    }

    return {
      mode: 'queue-next-turn',
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
    if (tracked.pendingMessages.length === 0) return;

    if (tracked.subprocessReleased) {
      const dropped = tracked.pendingMessages.length;
      tracked.pendingMessages.length = 0;
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

    try {
      await dispatcher.continueConversation(agentId, next);
      this.logger.info('[AgentMessageRouter] Delivered queued message', {
        agentId,
        cli: tracked.info.cli,
        remaining: tracked.pendingMessages.length,
      });
    } catch (error: unknown) {
      // Losing it visibly beats re-queuing it forever against a handle that has
      // just refused: the next settle would retry the same failing delivery.
      this.logger.error(
        '[AgentMessageRouter] Queued message could not be delivered',
        {
          agentId,
          cli: tracked.info.cli,
          error: describeError(error),
          remaining: tracked.pendingMessages.length,
        },
      );
    }
  }

  /** Forget anything still queued for a record that can no longer receive it. */
  discardPending(agentId: string, tracked: MessageRoutableAgent): void {
    if (tracked.pendingMessages.length === 0) return;
    const dropped = tracked.pendingMessages.length;
    tracked.pendingMessages.length = 0;
    this.logger.warn(
      '[AgentMessageRouter] Discarded queued messages for a torn-down agent',
      { agentId, cli: tracked.info.cli, dropped },
    );
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
      adapterCaps ?? { steer: false, interrupt: false, continuation: false }
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
  return error instanceof Error ? error.message : String(error);
}
