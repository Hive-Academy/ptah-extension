import { randomUUID } from 'node:crypto';
import {
  UNROUTABLE_PERMISSION_TIMEOUT_MS,
  buildSystemAbortPermissionMessage,
  presentCodexApproval,
  type CodexChatAdapterPorts,
  type HostAttentionCoordinator,
  type PermissionPromptLifecycleEvent,
} from '@ptah-extension/agent-sdk';
import type { CodexApprovalRequest } from '@ptah-extension/codex-runtime';
import {
  MESSAGE_TYPES,
  TabId,
  attentionRequestKey,
  type PermissionRequest,
  type PermissionResponse,
  type SessionId,
} from '@ptah-extension/shared';

export interface CodexApprovalPresentationPorts {
  logger: CodexChatAdapterPorts['logger'];
  approvals: Pick<CodexChatAdapterPorts['approvals'], 'respond'>;
  tabId(sessionId: SessionId): string;
  broadcastMessage(type: string, payload: unknown): Promise<void>;
  promptLifecycle?: { publish(event: PermissionPromptLifecycleEvent): void };
  hostAttention?: Pick<HostAttentionCoordinator, 'resolve'>;
  setTimer(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
}

type PromptOutcome = 'allowed' | 'denied' | 'timed-out' | 'aborted';
interface PendingPrompt {
  sessionId: SessionId;
  request: CodexApprovalRequest;
  timestamp: number;
  correlationKey: string;
  promptTimer?: ReturnType<typeof setTimeout>;
  unroutable?: { routingHint: string; toolName: string; timeoutMs: number };
}

/** Correlates native requests with renderer cards and settles every terminal path. */
export function createCodexChatApprovalPresentation(
  ports: CodexApprovalPresentationPorts,
): Pick<CodexChatAdapterPorts, 'presentation'> & {
  handlePermissionResponse(response: PermissionResponse): boolean;
} {
  const pending = new Map<string, PendingPrompt>();
  const wireIds = new Map<string, string>();
  const failed = (reason: unknown) => {
    ports.logger.error(
      'Codex chat presentation failed.',
      reason instanceof Error ? reason : new Error(String(reason)),
    );
  };
  const send = (type: string, payload: unknown) => {
    void ports.broadcastMessage(type, payload).catch(failed);
  };
  const publishLifecycle = (event: PermissionPromptLifecycleEvent): void => {
    try {
      ports.promptLifecycle?.publish(event);
    } catch (error: unknown) {
      ports.logger.warn('Codex prompt lifecycle listener threw.', {
        code: 'prompt-lifecycle-listener-threw',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const publishResolved = (id: string, entry: PendingPrompt, outcome: PromptOutcome) => {
    if (!entry.unroutable) return;
    publishLifecycle({
      phase: 'resolved', requestId: id,
      routingHint: entry.unroutable.routingHint,
      toolName: entry.unroutable.toolName, outcome,
    });
  };
  // Remove state before native replies or lifecycle callbacks can reenter.
  const takePrompt = (id: string): PendingPrompt | undefined => {
    const entry = pending.get(id);
    if (!entry) return undefined;
    if (entry.promptTimer !== undefined) {
      ports.clearTimer(entry.promptTimer);
      entry.promptTimer = undefined;
    }
    pending.delete(id);
    wireIds.delete(entry.correlationKey);
    ports.hostAttention?.resolve(attentionRequestKey('permission', id), entry.timestamp);
    return entry;
  };
  const key = (sessionId: SessionId, request: CodexApprovalRequest) =>
    JSON.stringify([
      sessionId, request.contextId, request.processGeneration,
      request.threadId, request.turnId, request.requestId,
    ]);
  const respond = (
    entry: PendingPrompt,
    decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel',
    reason?: string,
    modifiedInput?: PermissionResponse['modifiedInput'],
    includeReplyFields = false,
  ) => {
    const { sessionId, request } = entry;
    return ports.approvals.respond(
      { sessionId, threadId: request.threadId, requestId: String(request.requestId) },
      { kind: 'codex', response: {
        sessionId, contextId: request.contextId,
        processGeneration: request.processGeneration,
        threadId: request.threadId, turnId: request.turnId,
        requestId: request.requestId, decision,
        ...(includeReplyFields
          ? { reason, modifiedInput }
          : reason === undefined ? {} : { reason }),
      } },
    );
  };
  const declineApproval = (entry: PendingPrompt, reason?: string) => {
    try {
      respond(entry, 'decline', reason);
    } catch {
      // degradation-audit: reported - coded warning omits request contents.
      ports.logger.warn('Codex approval delivery decline failed.', {
        code: 'approval-delivery-decline-failed',
      });
    }
  };
  return {
    presentation: {
      present(sessionId, request) {
        const correlationKey = key(sessionId, request);
        const previousId = wireIds.get(correlationKey);
        if (previousId) {
          const previous = takePrompt(previousId);
          if (previous) publishResolved(previousId, previous, 'aborted');
        }
        const id = randomUUID();
        const timestamp = Date.now();
        const tabId = ports.tabId(sessionId);
        const routable = TabId.safeParse(tabId) !== null;
        const presented = presentCodexApproval(request);
        const windowEnd = timestamp + UNROUTABLE_PERMISSION_TIMEOUT_MS;
        const boundedAt = request.expiresAt === undefined
          ? windowEnd : Math.min(request.expiresAt, windowEnd);
        const timeoutMs = Math.max(0, boundedAt - timestamp);
        const entry: PendingPrompt = {
          sessionId, request, timestamp, correlationKey,
          ...(routable ? {} : { unroutable: {
            routingHint: tabId, toolName: presented.toolName, timeoutMs,
          } }),
        };
        pending.set(id, entry);
        wireIds.set(correlationKey, id);
        const payload: PermissionRequest = routable
          ? {
              id, sessionId, ...(tabId === sessionId ? {} : { tabId }),
              ...presented, toolUseId: request.toolId, timestamp,
              timeoutAt: request.expiresAt ?? 0,
            }
          : {
              id, ...presented, toolUseId: request.toolId,
              timestamp, timeoutAt: boundedAt,
            };
        if (!routable) {
          publishLifecycle({
            phase: 'requested', requestId: id, routingHint: tabId,
            toolName: presented.toolName, description: presented.description,
            routable: false, timeoutMs,
          });
          if (!pending.has(id)) return;
          entry.promptTimer = ports.setTimer(() => {
            const current = takePrompt(id);
            if (!current?.unroutable) return;
            const reason = buildSystemAbortPermissionMessage(
              current.unroutable.toolName,
              `Permission request timed out after ${current.unroutable.timeoutMs}ms with no answer from the UI — denying to prevent a permanent hang.`,
            );
            declineApproval(current, reason);
            publishResolved(id, current, 'timed-out');
          }, timeoutMs);
        }
        // The manager's attention observer raises the host notice.
        void ports.broadcastMessage(MESSAGE_TYPES.PERMISSION_REQUEST, payload)
          .catch((error: unknown) => {
            failed(error);
            const current = pending.get(id);
            if (current?.request !== request) return;
            const taken = takePrompt(id);
            if (!taken) return;
            declineApproval(taken);
            publishResolved(id, taken, 'denied');
          });
      },
      dismiss(sessionId, request) {
        const id = wireIds.get(key(sessionId, request));
        if (!id) return;
        const entry = takePrompt(id);
        if (!entry) return;
        send(MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED, {
          id, sessionId, toolName: request.toolName ?? request.kind,
        });
        publishResolved(id, entry, 'aborted');
      },
      cancelPrompt(payload) {
        for (const [id, entry] of [...pending]) {
          if (entry.sessionId !== payload.sessionId ||
              String(entry.request.requestId) !== payload.requestId) continue;
          const taken = takePrompt(id);
          if (!taken) continue;
          send(MESSAGE_TYPES.PERMISSION_PROMPT_CANCELLED, {
            ...payload, requestId: id,
          });
          publishResolved(id, taken, 'aborted');
        }
      },
    },
    handlePermissionResponse(response) {
      const entry = pending.get(response.id);
      if (!entry) return false;
      const outcome: PromptOutcome =
        response.decision === 'allow' || response.decision === 'always_allow'
          ? 'allowed' : 'denied';
      const taken = takePrompt(response.id);
      if (!taken) return false;
      const { sessionId, request } = taken;
      const decision = {
        allow: 'accept', always_allow: 'acceptForSession',
        deny_with_message: 'decline', deny: 'cancel',
      } as const;
      // The sink may reenter dismiss; the wire id has already been removed.
      try {
        const accepted = respond(taken, decision[response.decision],
          response.reason, response.modifiedInput, true);
        if (accepted) {
          publishResolved(response.id, taken, outcome);
          return true;
        }
        ports.logger.warn('Codex approval response rejected.', {
          code: 'approval-response-rejected',
        });
      } catch {
        // degradation-audit: reported - coded warning omits sink error content.
        ports.logger.warn('Codex approval response failed.', {
          code: 'approval-response-failed',
        });
      }
      send(MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED, {
        id: response.id, sessionId,
        toolName: request.toolName ?? request.kind,
      });
      publishResolved(response.id, taken, 'aborted');
      return true;
    },
  };
}
