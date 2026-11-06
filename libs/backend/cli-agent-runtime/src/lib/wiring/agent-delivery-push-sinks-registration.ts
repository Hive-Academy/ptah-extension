/**
 * Push sinks for lane delivery receipts and parent-delivery envelopes.
 *
 * Lives in a `*-registration.ts` file so di-lint sees the registration of
 * the tokens that `AgentDeliveryReceiptStore` and `ParentDeliveryDrainer`
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
import type { ParentDeliveryEnvelope } from '../cli-agents/parent-delivery/parent-envelope-store.service';

/** Host that broadcasts the pushes (matches `AgentEventPlatform`). */
type PushSinkPlatform = 'vscode' | 'electron' | 'cli';

/** Minimal shape of the webview manager used by the sinks. */
interface WebviewManagerLike {
  broadcastMessage(type: string, payload: unknown): Promise<void>;
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
    container.registerInstance(CLI_AGENT_RUNTIME_TOKENS.AGENT_DELIVERY_RECEIPT_EVENT_SINK, {
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
    });
  }
  if (!container.isRegistered(CLI_AGENT_RUNTIME_TOKENS.PARENT_DELIVERY_EVENT_SINK, true)) {
    container.registerInstance(CLI_AGENT_RUNTIME_TOKENS.PARENT_DELIVERY_EVENT_SINK, {
      emit: (envelope: ParentDeliveryEnvelope) => {
        const payload = AgentMonitorParentDeliveryPayloadSchema.safeParse({
          agentId: envelope.agentId, kind: envelope.kind, state: envelope.state,
          deliveryId: envelope.id,
          createdAt: envelope.createdAt,
          verdict: envelope.verdict,
          stopReason: envelope.stopReason,
          preview: envelope.kind === 'report'
            ? envelope.body.replace(/^<agent-report[^>]*>\s*/, '').replace(/\s*<\/agent-report>\s*$/, '')
              .replace(/\s+/g, ' ').trim().slice(0, 160)
            : undefined,
        });
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
