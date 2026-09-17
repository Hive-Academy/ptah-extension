/**
 * Addressing another session by name (TASK_2026_402, Task 10.3).
 *
 * Resolves a chosen peer against the live list, then composes the relay
 * request into the SENDING session — the only route Task 10.1 found that
 * works. See `peer-message.composer.ts` for why the model is in the loop and
 * `rpc-peer-session.types.ts` for why the outcome says `accepted`.
 *
 * ## What this class will never say
 *
 * There is no success path here that claims the peer received anything.
 * `accepted` is scoped to "handed to the transport", the caveat says so in
 * words on every response including refusals, and the composed prompt repeats
 * the rule to the model that will write the user-facing answer. Three layers,
 * because the failure being guarded against is a confident report, not a
 * crash.
 *
 * `AgentReportRouter.deliver()` may use the stronger word; it injects a turn
 * into a session this process owns. Nothing in this file does.
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SessionId } from '@ptah-extension/shared';
import type {
  IAgentAdapter,
  PeerSessionRow,
  PeerSessionSendRefusalReason,
  PeerSessionSendResult,
  PeerSessionTargetRef,
} from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import { PeerSessionDirectory } from './peer-session-directory.service';
import {
  PEER_SEND_ACCEPTANCE_CAVEAT,
  composePeerMessageRequest,
} from './peer-message.composer';

/**
 * Body cap, in characters. The Claude channel's own size check is
 * `1048576`, read off the CLI binary and already pinned by
 * `MAX_AGENT_REPORT_LENGTH` in `cli-agent-runtime`. Repeated here rather than
 * imported because `agent-sdk` must not depend on `cli-agent-runtime`, and the
 * number is the vendor's, not either lib's.
 */
export const MAX_PEER_MESSAGE_LENGTH = 1_048_576;

export interface PeerSessionSendInput {
  readonly sessionId: string;
  readonly fromSessionId: string;
  readonly message: string;
  /** Host's current workspace root. Only affects the list's row flags. */
  readonly currentWorkspace?: string;
}

@injectable()
export class PeerSessionMessenger {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_PEER_SESSION_DIRECTORY)
    private readonly directory: PeerSessionDirectory,
    /**
     * Optional because a host may register `agent-sdk` without a chat runtime.
     * Absence is reported as `chat-runtime-unavailable` — never swallowed, and
     * never reported as an accepted send with nowhere to compose it.
     */
    @inject(TOKENS.AGENT_ADAPTER, { isOptional: true })
    private readonly agentAdapter: IAgentAdapter | null = null,
  ) {}

  async send(input: PeerSessionSendInput): Promise<PeerSessionSendResult> {
    const { sessionId, fromSessionId, message } = input;

    if (sessionId === fromSessionId) {
      return refuse('self-addressed', {
        detail: 'a session cannot address itself',
      });
    }

    const listing = await this.directory.list({
      ...(input.currentWorkspace !== undefined
        ? { currentWorkspace: input.currentWorkspace }
        : {}),
    });
    const row = listing.sessions.find(
      (candidate) => candidate.sessionId === sessionId,
    );

    if (!row) {
      return refuse('unknown-session', {
        detail:
          'no session registry record carries that id — it may have exited ' +
          'since the list was taken',
      });
    }

    const target = toTargetRef(row);

    if (row.reachability !== 'reachable') {
      return refuse('session-unreachable', {
        target,
        detail: `the session is listed as unreachable (${
          row.unreachableReason ?? 'no reason recorded'
        })`,
      });
    }

    if (!this.agentAdapter) {
      return refuse('chat-runtime-unavailable', {
        target,
        detail:
          'no agent adapter is registered in this host, so there is no ' +
          'session to compose the relay request into',
      });
    }

    const originSessionId = SessionId.safeParse(fromSessionId.trim());
    if (!originSessionId || !this.agentAdapter.isSessionActive(originSessionId)) {
      return refuse('origin-session-not-active', {
        target,
        detail:
          'the sending session is not live in this host, and the relay is ' +
          'performed by that session',
      });
    }

    try {
      await this.agentAdapter.sendMessageToSession(
        originSessionId,
        composePeerMessageRequest(target, message),
      );
    } catch (error: unknown) {
      return refuse('dispatch-failed', {
        target,
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    this.logger.info(
      '[PeerSessionMessenger] relay request accepted by the sending session',
      {
        targetSessionId: target.sessionId,
        fromSessionId: originSessionId,
        length: message.length,
        // Named in the log too, so a reader of the log cannot mistake this
        // line for a delivery record.
        observed: 'acceptance-only',
      },
    );

    return {
      outcome: 'accepted',
      route: 'model-mediated-cli-tool',
      costsATurn: true,
      modelMayDecline: true,
      acceptanceCaveat: PEER_SEND_ACCEPTANCE_CAVEAT,
      target,
    };
  }
}

function toTargetRef(row: PeerSessionRow): PeerSessionTargetRef {
  return {
    sessionId: row.sessionId,
    name: row.name,
    workspace: row.workspace,
  };
}

function refuse(
  reason: PeerSessionSendRefusalReason,
  extra: { readonly target?: PeerSessionTargetRef; readonly detail?: string },
): PeerSessionSendResult {
  return {
    outcome: 'refused',
    route: 'model-mediated-cli-tool',
    costsATurn: true,
    modelMayDecline: true,
    acceptanceCaveat: PEER_SEND_ACCEPTANCE_CAVEAT,
    reason,
    ...(extra.target ? { target: extra.target } : {}),
    ...(extra.detail ? { detail: extra.detail } : {}),
  };
}
