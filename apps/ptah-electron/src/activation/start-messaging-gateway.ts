import type { GatewayService } from '@ptah-extension/messaging-gateway';
import type { GatewayChatBridge } from '@ptah-extension/gateway-chat-bridge';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { BootCoordinator } from './boot-coordinator';

/**
 * Start the messaging gateway and the chat bridge, behind the persistence gate
 * (TASK_2026_347).
 *
 * ## Why this is not inline in `post-window.ts`
 *
 * Two reasons, and the second is the one that matters.
 *
 * 1. `post-window.ts` reads `import.meta.url`, and `tsconfig.spec.json`
 *    compiles with `module: commonjs`, so ts-jest cannot import it (`TS1343`).
 *    An ordering contract that cannot be asserted is a comment. This module
 *    imports no Electron API and no `import.meta`, so a spec can drive it.
 * 2. The start is now ASYNC in a way the caller must not await: it waits for
 *    SQLite. Keeping that wait inside `registerPostWindow` would either block
 *    the window (unacceptable) or hide a second fire-and-forget IIFE in a
 *    function that already has three.
 *
 * ## What was wrong before
 *
 * `registerPostWindow` runs BEFORE `coordinator.startPostWindow(...)`, so this
 * start used to race the heavy boot rather than follow it:
 *
 * - `GatewayService.start()`'s first statement is `gcOldVoiceFiles()`, which
 *   reaches `SqliteConnectionService.db` and threw
 *   `Persistence is offline: SQLite connection has not been initialized yet`
 *   on every launch (log.log:558).
 * - `GatewayChatBridge.start()` claims interrupted inbound turns — a WRITE to
 *   `gateway_messages` — and landed mid-migration (log.log:576-578, between
 *   `applying migrations` and `migrations applied`). It did not throw only
 *   because `openAndMigrate` assigns the handle before it runs the migrations,
 *   which is exactly why the gate keys on that call RESOLVING and never on
 *   `isOpen`.
 */
export interface StartMessagingGatewayOptions {
  gateway: GatewayService;
  /** `null` when the bridge could not be resolved; the gateway still starts. */
  bridge: GatewayChatBridge | null;
  coordinator: BootCoordinator;
  /** `webviewManager.broadcastMessage`, injected so this file stays DI-free. */
  broadcast: (type: string, payload: unknown) => Promise<void>;
}

export async function startMessagingGateway(
  options: StartMessagingGatewayOptions,
): Promise<void> {
  const { gateway, bridge, coordinator, broadcast } = options;

  const { sqliteOpen } = await coordinator.whenPersistenceSettled();

  if (coordinator.abortSignal.aborted) {
    console.log(
      '[Ptah Electron] Messaging gateway start skipped — shutdown started',
    );
    return;
  }

  if (!sqliteOpen) {
    // Deliberately still starts. The gateway's persistence use is voice-file GC
    // and inbound turn bookkeeping; a launch with no workspace root has no
    // database and must still be reachable from Telegram / Discord / Slack.
    console.warn(
      '[Ptah Electron] Messaging gateway starting without persistence (degraded)',
    );
  }

  try {
    await gateway.start();
    console.log('[Ptah Electron] Messaging gateway started');

    const status = gateway.status();
    void broadcast(MESSAGE_TYPES.GATEWAY_STATUS_CHANGED, {
      status: {
        enabled: status.enabled,
        adapters: status.adapters.map((a) => ({
          platform: a.platform,
          running: a.running,
          ...(a.lastError ? { lastError: a.lastError } : {}),
        })),
      },
      origin: null,
    });
  } catch (error: unknown) {
    console.warn(
      '[Ptah Electron] Messaging gateway start skipped (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
    return;
  }

  if (bridge) {
    try {
      bridge.start();
      console.log('[Ptah Electron] Gateway chat bridge started');
    } catch (error: unknown) {
      console.warn(
        '[Ptah Electron] Gateway chat bridge start skipped (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
