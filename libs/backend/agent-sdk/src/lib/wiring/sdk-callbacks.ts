/**
 * SDK adapter callback wiring (TASK_2025_291 Wave C4b).
 *
 * Centralizes `setResultStatsCallback`, `setSessionIdResolvedCallback`,
 * `setCompactionStartCallback` and (optionally) the two worktree callbacks
 * so VS Code / Electron / TUI no longer re-implement the same 150 lines.
 *
 * Platform-specific worktree path resolution (cross-spawn on VS Code,
 * GitInfoService on Electron) stays at the call site — callers pass a
 * `resolveWorktreePath` async callback when `options.worktree === true`.
 */

import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  MESSAGE_TYPES,
  retryWithBackoff,
  type AgentProcessInfo,
  type IAgentAdapter,
  type ResultStatsPayload,
} from '@ptah-extension/shared';
import type { AgentProcessManager } from '../cli-agents';
import {
  persistCliSessionReference,
  type SubagentRegistryLike,
  type WebviewManagerLike,
} from './agent-events';

export type SdkCallbackPlatform = 'vscode' | 'electron' | 'cli';

export interface WorktreeCreatedData {
  readonly sessionId: string;
  readonly name: string;
  readonly cwd: string;
  readonly timestamp: number;
}

export interface WireSdkCallbacksOptions {
  /**
   * Wire worktree created/removed callbacks. VS Code + Electron pass `true`;
   * TUI passes `false` because it has no worktree UI. When true, the caller
   * must supply `resolveWorktreePath` to resolve branch → filesystem path
   * (VS Code uses dynamic `cross-spawn`; Electron uses `GitInfoService`).
   */
  readonly worktree?: boolean;
  /**
   * Platform-specific worktree path resolver. Invoked when the SDK reports a
   * newly created worktree so the webview can receive the actual path.
   * Returning `undefined` is acceptable — the broadcast still fires with a
   * missing path and the frontend falls back.
   */
  readonly resolveWorktreePath?: (
    data: WorktreeCreatedData,
  ) => Promise<string | undefined>;
  /**
   * Optional lookup for the resolved SDK UUID of a given `ptahCliId`. Used
   * when re-persisting exited agents as their parentSessionId resolves from
   * tab ID to real SDK UUID.
   */
  readonly getSdkSessionId?: (ptahCliId: string) => string | undefined;
}

export interface WireSdkCallbacksContext {
  readonly logger: Logger;
  readonly platform: SdkCallbackPlatform;
  readonly options?: WireSdkCallbacksOptions;
}

/**
 * Wire SDK adapter event-sink callbacks. Lazily resolves `AGENT_ADAPTER`
 * and `WEBVIEW_MANAGER`; logs and returns when either is absent.
 */
export function wireSdkCallbacks(
  container: DependencyContainer,
  ctx: WireSdkCallbacksContext,
): void {
  const { logger, platform, options = {} } = ctx;
  const tag = `[${platform} RPC]`;

  if (!container.isRegistered(TOKENS.AGENT_ADAPTER)) {
    logger.warn(`${tag} AGENT_ADAPTER not registered — SDK callbacks skipped`);
    return;
  }
  if (!container.isRegistered(TOKENS.WEBVIEW_MANAGER)) {
    logger.warn(`${tag} WebviewManager not registered — SDK callbacks skipped`);
    return;
  }

  try {
    const sdkAdapter = container.resolve<IAgentAdapter>(TOKENS.AGENT_ADAPTER);
    const webviewManager = container.resolve<WebviewManagerLike>(
      TOKENS.WEBVIEW_MANAGER,
    );

    wireResultStatsCallback(sdkAdapter, webviewManager, logger, tag);
    wireSessionIdResolvedCallback(
      sdkAdapter,
      webviewManager,
      container,
      logger,
      tag,
      options.getSdkSessionId,
    );
    wireCompactionStartCallback(sdkAdapter, webviewManager, logger, tag);

    if (options.worktree === true) {
      wireWorktreeCallbacks(
        sdkAdapter,
        webviewManager,
        logger,
        tag,
        options.resolveWorktreePath,
      );
    }

    logger.info(
      `${tag} SDK callbacks wired (stats, sessionId, compaction${
        options.worktree ? ', worktree' : ''
      })`,
    );
  } catch (error) {
    logger.warn(
      `${tag} Failed to setup SDK callbacks (non-fatal)`,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

function wireResultStatsCallback(
  sdkAdapter: IAgentAdapter,
  webviewManager: WebviewManagerLike,
  logger: Logger,
  tag: string,
): void {
  sdkAdapter.setResultStatsCallback(async (stats) => {
    logger.info(`${tag} Session stats received: ${stats.sessionId}`, {
      cost: stats.cost,
      tokens: stats.tokens,
      duration: stats.duration,
      modelUsage: stats.modelUsage,
    });
    await sendStatsWithRetry(webviewManager, stats, logger, tag);
  });
}

function wireSessionIdResolvedCallback(
  sdkAdapter: IAgentAdapter,
  webviewManager: WebviewManagerLike,
  container: DependencyContainer,
  logger: Logger,
  tag: string,
  getSdkSessionId: ((ptahCliId: string) => string | undefined) | undefined,
): void {
  sdkAdapter.setSessionIdResolvedCallback(
    (tabId: string | undefined, realSessionId: string) => {
      logger.info(
        `${tag} Session ID resolved: tabId=${tabId} -> real=${realSessionId}`,
      );

      if (tabId) {
        try {
          if (container.isRegistered(TOKENS.AGENT_PROCESS_MANAGER)) {
            const agentProcessManager = container.resolve<AgentProcessManager>(
              TOKENS.AGENT_PROCESS_MANAGER,
            );
            agentProcessManager.resolveParentSessionId(tabId, realSessionId);

            try {
              if (container.isRegistered(TOKENS.SUBAGENT_REGISTRY_SERVICE)) {
                const subagentRegistry =
                  container.resolve<SubagentRegistryLike>(
                    TOKENS.SUBAGENT_REGISTRY_SERVICE,
                  );
                subagentRegistry.resolveParentSessionId(tabId, realSessionId);
              }
            } catch {
              // SubagentRegistryService may not be registered yet
            }

            // Re-persist exited agents whose parentSessionId couldn't resolve
            // earlier (timing race: agent exited while tab ID was still in play).
            const allAgents =
              agentProcessManager.getStatus() as AgentProcessInfo[];
            const exitedWithParent = allAgents.filter(
              (a) =>
                a.parentSessionId === realSessionId && a.status !== 'running',
            );
            if (exitedWithParent.length > 0) {
              logger.info(
                `${tag} Re-persisting ${exitedWithParent.length} exited CLI agent(s) with resolved session ID ${realSessionId}`,
              );
            }
            for (const exitedInfo of exitedWithParent) {
              persistCliSessionReference(
                container,
                logger,
                tag,
                exitedInfo,
                getSdkSessionId,
              );
            }
          }
        } catch {
          // AgentProcessManager may not be registered yet
        }
      }

      webviewManager
        .broadcastMessage(MESSAGE_TYPES.SESSION_ID_RESOLVED, {
          tabId,
          realSessionId,
        })
        .catch((error) => {
          logger.error(
            `${tag} Failed to send session:id-resolved`,
            error instanceof Error ? error : new Error(String(error)),
          );
        });
    },
  );
}

function wireCompactionStartCallback(
  sdkAdapter: IAgentAdapter,
  webviewManager: WebviewManagerLike,
  logger: Logger,
  tag: string,
): void {
  sdkAdapter.setCompactionStartCallback((data) => {
    logger.info(
      `${tag} Compaction started: sessionId=${data.sessionId}, trigger=${data.trigger}`,
    );
    const compactionEvent = {
      id: `compaction_${data.sessionId}_${data.timestamp}`,
      eventType: 'compaction_start' as const,
      timestamp: data.timestamp,
      sessionId: data.sessionId,
      messageId: `compaction_msg_${data.timestamp}`,
      trigger: data.trigger,
      source: 'stream' as const,
    };
    webviewManager
      .broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, {
        sessionId: data.sessionId,
        event: compactionEvent,
      })
      .catch((error) => {
        logger.error(
          `${tag} Failed to send compaction event`,
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  });
}

function wireWorktreeCallbacks(
  sdkAdapter: IAgentAdapter,
  webviewManager: WebviewManagerLike,
  logger: Logger,
  tag: string,
  resolveWorktreePath:
    | ((data: WorktreeCreatedData) => Promise<string | undefined>)
    | undefined,
): void {
  sdkAdapter.setWorktreeCreatedCallback(async (data) => {
    logger.info(
      `${tag} Worktree created: name=${data.name}, sessionId=${data.sessionId}`,
    );

    let worktreePath: string | undefined;
    if (resolveWorktreePath) {
      try {
        worktreePath = await resolveWorktreePath(data);
      } catch (err) {
        logger.warn(
          `${tag} Failed to resolve worktree path for notification`,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }

    webviewManager
      .broadcastMessage('git:worktreeChanged', {
        action: 'created',
        name: data.name,
        path: worktreePath,
      })
      .catch((error) => {
        logger.error(
          `${tag} Failed to send git:worktreeChanged (created) to webview`,
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  });

  sdkAdapter.setWorktreeRemovedCallback((data) => {
    logger.info(
      `${tag} Worktree removed: path=${data.worktreePath}, sessionId=${data.sessionId}`,
    );
    webviewManager
      .broadcastMessage('git:worktreeChanged', {
        action: 'removed',
        path: data.worktreePath,
      })
      .catch((error) => {
        logger.error(
          `${tag} Failed to send git:worktreeChanged (removed) to webview`,
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  });
}

async function sendStatsWithRetry(
  webviewManager: WebviewManagerLike,
  stats: ResultStatsPayload,
  logger: Logger,
  tag: string,
): Promise<void> {
  try {
    await retryWithBackoff(
      () =>
        webviewManager.broadcastMessage(MESSAGE_TYPES.SESSION_STATS, {
          sessionId: stats.sessionId,
          cost: stats.cost,
          tokens: stats.tokens,
          duration: stats.duration,
          modelUsage: stats.modelUsage,
        }),
      {
        retries: 3,
        initialDelay: 1000,
        shouldRetry: (error: unknown): boolean => {
          const message =
            error instanceof Error ? error.message.toLowerCase() : '';
          return (
            message.includes('channel') ||
            message.includes('disposed') ||
            message.includes('closed') ||
            message.includes('timeout')
          );
        },
      },
    );
  } catch (error) {
    logger.error(
      `${tag} Failed to send session:stats after all retries`,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}
