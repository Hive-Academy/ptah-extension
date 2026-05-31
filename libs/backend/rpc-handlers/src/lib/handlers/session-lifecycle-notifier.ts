/**
 * SessionLifecycleNotifier.
 *
 * Bridges {@link SdkAdapterEvents} session-lifecycle events to the webview as
 * `MESSAGE_TYPES.SESSION_COMPACTION_COMPLETE` push notifications. Subscribes
 * to the bus in its constructor and broadcasts the validated payload through
 * the platform {@link WebviewBroadcaster}.
 *
 * Phase 1 wires the PostCompact path. Phases 2 and 3 will extend this class
 * with Stop/StopFailure/SubagentStop forwarding on the same bus, so the
 * notifier remains the single fan-out site for SDK hook events into the
 * webview wire.
 */

import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  SdkAdapterEvents,
  type SdkAdapterCompactionCompleteEvent,
} from '@ptah-extension/agent-sdk';
import {
  MESSAGE_TYPES,
  SdkCompactionCompletePayloadSchema,
  type SdkCompactionCompletePayload,
} from '@ptah-extension/shared';

/**
 * Minimal interface for the webview broadcaster used by the notifier. Matches
 * the same structural shape consumed by {@link HarnessStreamBroadcaster} and
 * {@link GatewayRpcHandlers}.
 */
export interface WebviewBroadcaster {
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

@injectable()
export class SessionLifecycleNotifier {
  private readonly subscriptions: Array<() => void> = [];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_ADAPTER_EVENTS)
    private readonly sdkAdapterEvents: SdkAdapterEvents,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewBroadcaster,
  ) {
    this.subscriptions.push(
      this.sdkAdapterEvents.onCompactionComplete((event) =>
        this.handleCompactionComplete(event),
      ),
    );
  }

  /** Detach all bus subscriptions. Idempotent. */
  dispose(): void {
    while (this.subscriptions.length > 0) {
      const off = this.subscriptions.pop();
      if (off) {
        off();
      }
    }
  }

  private handleCompactionComplete(
    event: SdkAdapterCompactionCompleteEvent,
  ): void {
    const parsed = SdkCompactionCompletePayloadSchema.safeParse(event);
    if (!parsed.success) {
      this.logger.warn(
        '[SessionLifecycleNotifier] dropping malformed compactionComplete payload',
        new Error(parsed.error.message),
      );
      return;
    }
    const payload: SdkCompactionCompletePayload = parsed.data;
    this.webviewManager
      .broadcastMessage(MESSAGE_TYPES.SESSION_COMPACTION_COMPLETE, payload)
      .catch((err: unknown) => {
        this.logger.warn(
          '[SessionLifecycleNotifier] webview broadcast failed',
          err instanceof Error ? err : new Error(String(err)),
        );
      });
  }
}
