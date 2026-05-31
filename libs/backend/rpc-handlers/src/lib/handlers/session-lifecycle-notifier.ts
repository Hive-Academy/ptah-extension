/**
 * SessionLifecycleNotifier.
 *
 * Bridges {@link SdkAdapterEvents} session-lifecycle events to the webview as
 * `MESSAGE_TYPES.SESSION_COMPACTION_COMPLETE`, `MESSAGE_TYPES.SESSION_TURN_ENDED`,
 * `MESSAGE_TYPES.SESSION_TURN_FAILED`, and `MESSAGE_TYPES.SESSION_SUBAGENT_ENDED`
 * push notifications. Subscribes to the bus in its constructor and broadcasts
 * the validated payload through the platform {@link WebviewBroadcaster}.
 *
 * Single fan-out site for SDK hook events (PostCompact, Stop, StopFailure,
 * SubagentStop) into the webview wire.
 */

import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  SdkAdapterEvents,
  type SdkAdapterCompactionCompleteEvent,
  type SdkAdapterSubagentEndedEvent,
  type SdkAdapterTurnEndedEvent,
  type SdkAdapterTurnFailedEvent,
} from '@ptah-extension/agent-sdk';
import {
  MESSAGE_TYPES,
  SdkCompactionCompletePayloadSchema,
  SdkSubagentEndedPayloadSchema,
  SdkTurnEndedPayloadSchema,
  SdkTurnFailedPayloadSchema,
  type SdkCompactionCompletePayload,
  type SdkSubagentEndedPayload,
  type SdkTurnEndedPayload,
  type SdkTurnFailedPayload,
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
    this.subscriptions.push(
      this.sdkAdapterEvents.onTurnEnded((event) => this.handleTurnEnded(event)),
    );
    this.subscriptions.push(
      this.sdkAdapterEvents.onTurnFailed((event) =>
        this.handleTurnFailed(event),
      ),
    );
    this.subscriptions.push(
      this.sdkAdapterEvents.onSubagentEnded((event) =>
        this.handleSubagentEnded(event),
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
        `[SessionLifecycleNotifier] dropping malformed compactionComplete payload (sessionId=${String(
          event?.sessionId,
        )}, trigger=${String(event?.trigger)})`,
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

  private handleTurnEnded(event: SdkAdapterTurnEndedEvent): void {
    const parsed = SdkTurnEndedPayloadSchema.safeParse(event);
    if (!parsed.success) {
      const hasBackgroundTasks = Array.isArray(event?.backgroundTasks)
        ? event.backgroundTasks.length > 0
        : false;
      this.logger.warn(
        `[SessionLifecycleNotifier] dropping malformed turnEnded payload (sessionId=${String(
          event?.sessionId,
        )}, hasBackgroundTasks=${String(
          hasBackgroundTasks,
        )}, terminalReason=${String(event?.terminalReason)})`,
        new Error(parsed.error.message),
      );
      return;
    }
    const payload: SdkTurnEndedPayload = parsed.data;
    this.webviewManager
      .broadcastMessage(MESSAGE_TYPES.SESSION_TURN_ENDED, payload)
      .catch((err: unknown) => {
        this.logger.warn(
          '[SessionLifecycleNotifier] webview broadcast failed',
          err instanceof Error ? err : new Error(String(err)),
        );
      });
  }

  private handleTurnFailed(event: SdkAdapterTurnFailedEvent): void {
    const parsed = SdkTurnFailedPayloadSchema.safeParse(event);
    if (!parsed.success) {
      const hasErrorDetails = typeof event?.errorDetails === 'string';
      this.logger.warn(
        `[SessionLifecycleNotifier] dropping malformed turnFailed payload (sessionId=${String(
          event?.sessionId,
        )}, error=${String(
          event?.error,
        )}, hasErrorDetails=${String(hasErrorDetails)})`,
        new Error(parsed.error.message),
      );
      return;
    }
    const payload: SdkTurnFailedPayload = parsed.data;
    this.webviewManager
      .broadcastMessage(MESSAGE_TYPES.SESSION_TURN_FAILED, payload)
      .catch((err: unknown) => {
        this.logger.warn(
          '[SessionLifecycleNotifier] webview broadcast failed',
          err instanceof Error ? err : new Error(String(err)),
        );
      });
  }

  private handleSubagentEnded(event: SdkAdapterSubagentEndedEvent): void {
    const parsed = SdkSubagentEndedPayloadSchema.safeParse(event);
    if (!parsed.success) {
      const hasBackgroundTasks = Array.isArray(event?.backgroundTasks)
        ? event.backgroundTasks.length > 0
        : false;
      this.logger.warn(
        `[SessionLifecycleNotifier] dropping malformed subagentEnded payload (sessionId=${String(
          event?.sessionId,
        )}, agentId=${String(event?.agentId)}, agentType=${String(
          event?.agentType,
        )}, hasBackgroundTasks=${String(hasBackgroundTasks)})`,
        new Error(parsed.error.message),
      );
      return;
    }
    const payload: SdkSubagentEndedPayload = parsed.data;
    this.webviewManager
      .broadcastMessage(MESSAGE_TYPES.SESSION_SUBAGENT_ENDED, payload)
      .catch((err: unknown) => {
        this.logger.warn(
          '[SessionLifecycleNotifier] webview broadcast failed',
          err instanceof Error ? err : new Error(String(err)),
        );
      });
  }
}
