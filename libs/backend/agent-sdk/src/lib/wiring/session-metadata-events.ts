/**
 * Session metadata event wiring (S4).
 *
 * Subscribes to {@link SessionMetadataStore.onMetadataChanged} and forwards
 * each event to all open webviews via `WebviewManager.broadcastMessage`.
 *
 * Mirrors the lazy-resolve + non-fatal-warn shape of `wireSdkCallbacks` /
 * `wireAgentEventListeners` so VS Code, Electron, and TUI hosts share the
 * same wiring entry-point. TUI does not host a webview but can still wire
 * this safely — the call no-ops when `WEBVIEW_MANAGER` is not registered.
 *
 * Returns a disposer the caller may invoke during deactivation. Hosts that
 * never tear down (extension lifecycle === process lifecycle) can ignore it.
 */

import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  MESSAGE_TYPES,
  type SessionMetadataChangedNotification,
} from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import type { SessionMetadataStore } from '../session-metadata-store';

/** Minimal webview-manager shape needed for the broadcast. */
interface WebviewManagerLike {
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

export type SessionMetadataEventPlatform = 'vscode' | 'electron' | 'cli';

export interface WireSessionMetadataEventsContext {
  readonly logger: Logger;
  readonly platform: SessionMetadataEventPlatform;
}

/** No-op disposer used when wiring bails out (missing DI services). */
const NOOP_DISPOSER = (): void => {
  /* nothing to dispose */
};

/**
 * Wire `session:metadataChanged` push notifications.
 *
 * Lazily resolves `SessionMetadataStore` and `WebviewManager`. When either
 * is missing, logs a warning and returns a no-op disposer — matches the
 * fail-soft contract of the sibling wiring helpers.
 */
export function wireSessionMetadataEvents(
  container: DependencyContainer,
  ctx: WireSessionMetadataEventsContext,
): () => void {
  const { logger, platform } = ctx;
  const tag = `[${platform} RPC]`;

  if (!container.isRegistered(SDK_TOKENS.SDK_SESSION_METADATA_STORE)) {
    logger.warn(
      `${tag} SessionMetadataStore not registered — metadata events skipped`,
    );
    return NOOP_DISPOSER;
  }
  if (!container.isRegistered(TOKENS.WEBVIEW_MANAGER)) {
    logger.warn(
      `${tag} WebviewManager not registered — metadata events skipped`,
    );
    return NOOP_DISPOSER;
  }

  try {
    const metadataStore = container.resolve<SessionMetadataStore>(
      SDK_TOKENS.SDK_SESSION_METADATA_STORE,
    );
    const webviewManager = container.resolve<WebviewManagerLike>(
      TOKENS.WEBVIEW_MANAGER,
    );

    const unsubscribe = metadataStore.onMetadataChanged(
      (payload: SessionMetadataChangedNotification) => {
        webviewManager
          .broadcastMessage(MESSAGE_TYPES.SESSION_METADATA_CHANGED, payload)
          .catch((error) => {
            logger.error(
              `${tag} Failed to send session:metadataChanged (kind=${payload.kind})`,
              error instanceof Error ? error : new Error(String(error)),
            );
          });
      },
    );

    logger.info(`${tag} Session metadata change events wired`);
    return unsubscribe;
  } catch (error) {
    logger.warn(
      `${tag} Failed to wire session metadata events (non-fatal)`,
      error instanceof Error ? error : new Error(String(error)),
    );
    return NOOP_DISPOSER;
  }
}
