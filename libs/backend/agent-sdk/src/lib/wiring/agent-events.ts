/**
 * Agent watcher + monitor + Copilot permission wiring (TASK_2025_291 Wave C4b).
 *
 * Shared across VS Code, Electron, TUI. Lazily resolves DI services so the
 * helper can run before some app-side services are registered; when a required
 * service is missing the helper logs a warning and returns — production parity
 * with the previous per-app try/catch shape.
 *
 * Options let the caller opt out of platform-specific broadcasts:
 *   - `wizardBroadcast` (VS Code only): also forward agent-start to the setup
 *     wizard stream so wizard sessions can correlate Task tools.
 *   - `copilotPermission` (VS Code + Electron): forward Copilot SDK permission
 *     requests to the webview. TUI has no Copilot UI.
 *   - `persistCliSession` (VS Code + Electron): persist CLI session references
 *     on spawn/exit for session resume. TUI does not persist.
 */

import type { DependencyContainer } from 'tsyringe';
import type {
  Logger,
  AgentSummaryChunk,
  AgentStartEvent,
} from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  MESSAGE_TYPES,
  retryWithBackoff,
  type AgentProcessInfo,
  type AgentOutputDelta,
  type AgentPermissionRequest,
  type AnalysisStreamPayload,
  type CliOutputSegment,
  type CliSessionReference,
  type FlatStreamEventUnion,
} from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import type { AgentProcessManager } from '../cli-agents';
import type { CopilotPermissionBridge } from '../cli-agents';

/** Minimal shape of the webview manager used by the wiring. */
interface WebviewManagerLike {
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

/** Minimal shape of the agent session watcher used by the wiring. */
interface AgentSessionWatcherLike {
  on(
    event: 'summary-chunk',
    callback: (chunk: AgentSummaryChunk) => void,
  ): void;
  on(event: 'agent-start', callback: (event: AgentStartEvent) => void): void;
}

/** Minimal shape of the subagent registry used by `wireSdkCallbacks`. */
interface SubagentRegistryLike {
  resolveParentSessionId(tabId: string, realSessionId: string): void;
}

/** Minimal shape of SDK session metadata store used for persistence. */
interface SdkSessionMetadataStoreLike {
  addCliSession(sessionId: string, ref: CliSessionReference): Promise<void>;
}

/** Minimal shape of the CLI detection service (for Copilot permission bridge). */
interface CliDetectionServiceLike {
  getAdapter(cli: string):
    | {
        permissionBridge?: CopilotPermissionBridge;
      }
    | undefined;
}

export type AgentEventPlatform = 'vscode' | 'electron' | 'cli';

export interface WireAgentEventListenersOptions {
  /**
   * Also broadcast agent-start events to the setup wizard analysis stream.
   * VS Code only — the wizard's ExecutionTreeBuilder uses it to match Task
   * tools to agent_start events during project analysis.
   */
  readonly wizardBroadcast?: boolean;
  /**
   * Forward Copilot SDK permission-request events to the webview.
   * VS Code + Electron only.
   */
  readonly copilotPermission?: boolean;
  /**
   * Persist CLI session references to the parent session's metadata on
   * spawn/exit. VS Code + Electron only. TUI skips persistence.
   */
  readonly persistCliSession?: boolean;
  /**
   * Optional lookup for the resolved SDK UUID of a given `ptahCliId`.
   * VS Code passes `chatHandlers.getPtahCliSdkSessionId.bind(chatHandlers)`
   * so persisted references can cross-reference parent session IDs after
   * SessionImporterService restart. Electron currently also wires this.
   */
  readonly getSdkSessionId?: (ptahCliId: string) => string | undefined;
}

export interface WireAgentEventListenersContext {
  readonly logger: Logger;
  readonly platform: AgentEventPlatform;
  readonly options?: WireAgentEventListenersOptions;
}

/**
 * Wire agent-session-watcher + agent-process-manager + Copilot permission
 * events to the webview. Safe to call once per app at bootstrap.
 */
export function wireAgentEventListeners(
  container: DependencyContainer,
  ctx: WireAgentEventListenersContext,
): void {
  const { logger, platform, options = {} } = ctx;
  const tag = `[${platform} RPC]`;

  if (!container.isRegistered(TOKENS.AGENT_SESSION_WATCHER_SERVICE)) {
    logger.warn(
      `${tag} AgentSessionWatcherService not registered — watcher listeners skipped`,
    );
    return;
  }
  if (!container.isRegistered(TOKENS.AGENT_PROCESS_MANAGER)) {
    logger.warn(
      `${tag} AgentProcessManager not registered — monitor listeners skipped`,
    );
    return;
  }
  if (!container.isRegistered(TOKENS.WEBVIEW_MANAGER)) {
    logger.warn(
      `${tag} WebviewManager not registered — agent event wiring skipped`,
    );
    return;
  }

  try {
    const agentWatcher = container.resolve<AgentSessionWatcherLike>(
      TOKENS.AGENT_SESSION_WATCHER_SERVICE,
    );
    const agentProcessManager = container.resolve<AgentProcessManager>(
      TOKENS.AGENT_PROCESS_MANAGER,
    );
    const webviewManager = container.resolve<WebviewManagerLike>(
      TOKENS.WEBVIEW_MANAGER,
    );

    wireSummaryChunkListener(agentWatcher, webviewManager, logger, tag);
    wireAgentStartListener(
      agentWatcher,
      webviewManager,
      logger,
      tag,
      options.wizardBroadcast === true,
    );
    wireAgentMonitorListeners(
      agentProcessManager,
      webviewManager,
      container,
      logger,
      tag,
      options.persistCliSession === true,
      options.getSdkSessionId,
    );

    if (options.copilotPermission === true) {
      wireCopilotPermissionForwarding(container, webviewManager, logger, tag);
    }

    logger.info(`${tag} Agent event listeners wired`);
  } catch (error) {
    logger.warn(
      `${tag} Failed to wire agent event listeners (non-fatal)`,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

function wireSummaryChunkListener(
  agentWatcher: AgentSessionWatcherLike,
  webviewManager: WebviewManagerLike,
  logger: Logger,
  tag: string,
): void {
  agentWatcher.on('summary-chunk', (chunk: AgentSummaryChunk) => {
    webviewManager
      .broadcastMessage(MESSAGE_TYPES.AGENT_SUMMARY_CHUNK, chunk)
      .catch((error) => {
        logger.error(
          `${tag} Failed to send agent summary chunk to webview`,
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  });
}

function wireAgentStartListener(
  agentWatcher: AgentSessionWatcherLike,
  webviewManager: WebviewManagerLike,
  logger: Logger,
  tag: string,
  wizardBroadcast: boolean,
): void {
  agentWatcher.on('agent-start', (agentStartEvent: AgentStartEvent) => {
    const streamingEvent = {
      id: `agent-start-${agentStartEvent.toolUseId}`,
      eventType: 'agent_start' as const,
      sessionId: agentStartEvent.sessionId,
      messageId: '',
      toolCallId: agentStartEvent.toolUseId,
      parentToolUseId: agentStartEvent.toolUseId,
      agentType: agentStartEvent.agentType,
      agentDescription: agentStartEvent.agentDescription,
      timestamp: agentStartEvent.timestamp,
      source: 'hook' as const,
      agentId: agentStartEvent.agentId,
    };

    webviewManager
      .broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, {
        sessionId: agentStartEvent.sessionId,
        event: streamingEvent,
      })
      .catch((error) => {
        logger.error(
          `${tag} Failed to send agent-start event to webview`,
          error instanceof Error ? error : new Error(String(error)),
        );
      });

    if (wizardBroadcast) {
      const wizardStreamPayload: AnalysisStreamPayload = {
        kind: 'status',
        content: `Agent started: ${agentStartEvent.agentType ?? 'unknown'}`,
        timestamp: agentStartEvent.timestamp,
        flatEvent: streamingEvent as FlatStreamEventUnion,
      };
      webviewManager
        .broadcastMessage(
          MESSAGE_TYPES.SETUP_WIZARD_ANALYSIS_STREAM,
          wizardStreamPayload,
        )
        .catch((error) => {
          logger.debug(
            `${tag} Failed to send agent-start to wizard pipeline (wizard may not be active)`,
            { error: error instanceof Error ? error.message : String(error) },
          );
        });
    }
  });
}

function wireAgentMonitorListeners(
  agentProcessManager: AgentProcessManager,
  webviewManager: WebviewManagerLike,
  container: DependencyContainer,
  logger: Logger,
  tag: string,
  persistCliSession: boolean,
  getSdkSessionId: ((ptahCliId: string) => string | undefined) | undefined,
): void {
  agentProcessManager.events.on('agent:spawned', (info: AgentProcessInfo) => {
    webviewManager
      .broadcastMessage(MESSAGE_TYPES.AGENT_MONITOR_SPAWNED, info)
      .catch((error) => {
        logger.error(
          `${tag} Failed to send agent-monitor:spawned to webview`,
          error instanceof Error ? error : new Error(String(error)),
        );
      });

    if (persistCliSession && info.parentSessionId && info.cliSessionId) {
      persistCliSessionReference(container, logger, tag, info, getSdkSessionId);
    }
  });

  agentProcessManager.events.on('agent:output', (delta: AgentOutputDelta) => {
    webviewManager
      .broadcastMessage(MESSAGE_TYPES.AGENT_MONITOR_OUTPUT, delta)
      .catch((error) => {
        logger.error(
          `${tag} Failed to send agent-monitor:output to webview`,
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  });

  agentProcessManager.events.on('agent:exited', (info: AgentProcessInfo) => {
    webviewManager
      .broadcastMessage(MESSAGE_TYPES.AGENT_MONITOR_EXITED, info)
      .catch((error) => {
        logger.error(
          `${tag} Failed to send agent-monitor:exited to webview`,
          error instanceof Error ? error : new Error(String(error)),
        );
      });

    if (persistCliSession && info.parentSessionId) {
      persistCliSessionReference(container, logger, tag, info, getSdkSessionId);
    }
  });
}

function wireCopilotPermissionForwarding(
  container: DependencyContainer,
  webviewManager: WebviewManagerLike,
  logger: Logger,
  tag: string,
): void {
  try {
    if (!container.isRegistered(TOKENS.CLI_DETECTION_SERVICE)) {
      logger.info(
        `${tag} CliDetectionService not registered — Copilot permission forwarding skipped`,
      );
      return;
    }
    const cliDetection = container.resolve<CliDetectionServiceLike>(
      TOKENS.CLI_DETECTION_SERVICE,
    );
    const copilotAdapter = cliDetection.getAdapter('copilot');
    if (copilotAdapter && copilotAdapter.permissionBridge) {
      const bridge = copilotAdapter.permissionBridge;
      bridge.events.on(
        'permission-request',
        (request: AgentPermissionRequest) => {
          webviewManager
            .broadcastMessage(
              MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST,
              request,
            )
            .catch((error) => {
              logger.error(
                `${tag} Failed to send agent permission request to webview`,
                error instanceof Error ? error : new Error(String(error)),
              );
            });
        },
      );
      logger.info(`${tag} Copilot SDK permission forwarding registered`);
    }
  } catch (error) {
    logger.info(
      `${tag} Copilot SDK permission forwarding not available (non-fatal)`,
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
}

/**
 * Persist a CLI session reference to the parent session's metadata store.
 * Fire-and-forget with retry — errors are logged, never thrown.
 *
 * Exported so `sdk-callbacks.ts` can re-persist exited agents once their
 * parent session IDs resolve from tab ID to real SDK UUID.
 */
export function persistCliSessionReference(
  container: DependencyContainer,
  logger: Logger,
  tag: string,
  info: AgentProcessInfo,
  getSdkSessionId: ((ptahCliId: string) => string | undefined) | undefined,
): void {
  const { parentSessionId } = info;
  if (!parentSessionId) return;

  // PtahCli agents have no native CLI session — fall back to agentId as the key.
  const effectiveCliSessionId = info.cliSessionId || info.agentId;

  try {
    if (!container.isRegistered(SDK_TOKENS.SDK_SESSION_METADATA_STORE)) {
      logger.warn(
        `${tag} SessionMetadataStore not registered — CLI session persist skipped`,
      );
      return;
    }
    const metadataStore = container.resolve<SdkSessionMetadataStoreLike>(
      SDK_TOKENS.SDK_SESSION_METADATA_STORE,
    );

    let persistedOutput:
      | {
          stdout?: string;
          segments?: readonly CliOutputSegment[];
          streamEvents?: readonly FlatStreamEventUnion[];
        }
      | undefined;

    if (container.isRegistered(TOKENS.AGENT_PROCESS_MANAGER)) {
      const agentProcessManager = container.resolve<AgentProcessManager>(
        TOKENS.AGENT_PROCESS_MANAGER,
      );
      persistedOutput = agentProcessManager.readOutputForPersistence(
        info.agentId,
      ) as typeof persistedOutput;
    }

    if (!persistedOutput && info.status !== 'running') {
      logger.warn(
        `${tag} Agent ${info.agentId} output unavailable for persistence (already cleaned up?)`,
        { cli: info.cli, status: info.status },
      );
    }

    const sdkSessionId =
      info.ptahCliId && getSdkSessionId
        ? getSdkSessionId(info.ptahCliId)
        : undefined;

    const ref: CliSessionReference = {
      cliSessionId: effectiveCliSessionId,
      cli: info.cli,
      agentId: info.agentId,
      task: info.task,
      startedAt: info.startedAt,
      status: info.status,
      ...(persistedOutput?.stdout ? { stdout: persistedOutput.stdout } : {}),
      ...(persistedOutput?.segments?.length
        ? { segments: persistedOutput.segments }
        : {}),
      ...(persistedOutput?.streamEvents?.length
        ? { streamEvents: persistedOutput.streamEvents }
        : {}),
      ...(info.ptahCliId ? { ptahCliId: info.ptahCliId } : {}),
      ...(sdkSessionId ? { sdkSessionId } : {}),
    };

    retryWithBackoff(() => metadataStore.addCliSession(parentSessionId, ref), {
      retries: 3,
      initialDelay: 1000,
      shouldRetry: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return !msg.includes('Parent session not found');
      },
    })
      .then(() => {
        logger.info(
          `${tag} CLI session reference persisted: ${effectiveCliSessionId} -> parent ${parentSessionId}`,
        );
      })
      .catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('Parent session not found')) {
          logger.debug(
            `${tag} CLI session persist deferred (parent not yet resolved): ${parentSessionId}`,
          );
        } else {
          logger.error(
            `${tag} Failed to persist CLI session reference after retries`,
            error instanceof Error ? error : new Error(msg),
          );
        }
      });
  } catch (error) {
    logger.warn(
      `${tag} Could not persist CLI session reference`,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

/** Re-export subagent shape for the SDK callback helper. */
export type { SubagentRegistryLike, WebviewManagerLike };
