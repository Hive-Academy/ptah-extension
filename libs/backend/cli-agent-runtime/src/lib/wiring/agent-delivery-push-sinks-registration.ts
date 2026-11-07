/**
 * Push sinks for lane delivery receipts and parent-delivery envelopes.
 *
 * Lives in a `*-registration.ts` file so di-lint sees the registration of
 * the tokens that `AgentMessageEnvelopeStore` and `ParentDeliveryDrainer`
 * inject. Behaviour is unchanged: a sink that is already registered wins.
 */

import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  MESSAGE_TYPES,
  type AgentDeliveryReceipt,
  AgentMonitorMessageReceiptPayloadSchema,
  AgentMonitorParentDeliveryPayloadSchema,
} from '@ptah-extension/shared';
import { CLI_AGENT_RUNTIME_TOKENS } from '../di/tokens';
import type { AgentDeliveryReceiptEventSink } from '../cli-agents/messaging/agent-delivery-receipt-event-sink';
import type { ParentDeliveryEvent } from '../cli-agents/parent-delivery/parent-delivery-drainer.service';

/** Host that broadcasts the pushes (matches `AgentEventPlatform`). */
type PushSinkPlatform = 'vscode' | 'electron' | 'cli';

/** Minimal shape of the webview manager used by the sinks. */
interface WebviewManagerLike {
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

/** Report bodies are wrapped in `<agent-report>`; the preview is the trimmed first 160 chars. */
function reportPreview(body: string): string {
  return body.replace(/^<agent-report[^>]*>\s*/, '').replace(/\s*<\/agent-report>\s*$/, '')
    .replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** Maps a stored envelope or a view-only delivery to the monitor push payload. */
export function toParentDeliveryPayload(event: ParentDeliveryEvent): Record<string, unknown> {
  const isView = 'deliveryId' in event;
  const preview = isView ? event.preview
    : event.preview ?? (event.kind === 'report' && event.body ? reportPreview(event.body) : undefined);
  return {
    agentId: event.agentId,
    kind: event.kind,
    state: event.state,
    deliveryId: isView ? event.deliveryId : event.id,
    parentSessionId: event.parentSessionId,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    attempts: event.attempts,
    lastError: event.lastError,
    nextRetryAt: event.nextRetryAt,
    waitingReason: event.waitingReason,
    everDispatched: event.everDispatched,
    removed: event.removed,
    preview: preview || undefined,
    verdict: event.verdict,
    stopReason: event.stopReason,
  };
}

/** Install push sinks before any service resolving the receipt store or drainer. */
export function registerAgentDeliveryPushSinks(
  container: DependencyContainer,
  logger: Logger,
  platform: PushSinkPlatform,
): void {
  if (!container.isRegistered(TOKENS.WEBVIEW_MANAGER)) return;
  const tag = `[${platform} RPC]`;
  if (!container.isRegistered(CLI_AGENT_RUNTIME_TOKENS.AGENT_DELIVERY_RECEIPT_EVENT_SINK, true)) {
    const receiptSink: AgentDeliveryReceiptEventSink = {
      changed: (receipt: AgentDeliveryReceipt) => {
        const payload = AgentMonitorMessageReceiptPayloadSchema.safeParse({ receipt });
        if (!payload.success) {
          logger.warn(`${tag} Invalid message receipt push payload`);
          return;
        }
        const webview = container.resolve<WebviewManagerLike>(TOKENS.WEBVIEW_MANAGER);
        void webview.broadcastMessage(MESSAGE_TYPES.AGENT_MONITOR_MESSAGE_RECEIPT, payload.data)
          .catch((error: unknown) => logger.warn(`${tag} Failed to push message receipt`,
            error instanceof Error ? error : new Error(String(error))));
      },
    };
    container.registerInstance(CLI_AGENT_RUNTIME_TOKENS.AGENT_DELIVERY_RECEIPT_EVENT_SINK, receiptSink);
  }
  if (!container.isRegistered(CLI_AGENT_RUNTIME_TOKENS.PARENT_DELIVERY_EVENT_SINK, true)) {
    container.registerInstance(CLI_AGENT_RUNTIME_TOKENS.PARENT_DELIVERY_EVENT_SINK, {
      emit: (event: ParentDeliveryEvent) => {
        const payload = AgentMonitorParentDeliveryPayloadSchema.safeParse(
          toParentDeliveryPayload(event),
        );
        if (!payload.success) {
          logger.warn(`${tag} Invalid parent delivery push payload`);
          return;
        }
        const webview = container.resolve<WebviewManagerLike>(TOKENS.WEBVIEW_MANAGER);
        void webview.broadcastMessage(MESSAGE_TYPES.AGENT_MONITOR_PARENT_DELIVERY, payload.data)
          .catch((error: unknown) => logger.warn(`${tag} Failed to push parent delivery`,
          error instanceof Error ? error : new Error(String(error))));
      },
    });
  }
}
