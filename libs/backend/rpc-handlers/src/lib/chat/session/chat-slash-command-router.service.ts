/**
 * Slash command router.
 *
 * Owns the chat:continue follow-up slash-command interception path
 * extracted from `ChatSessionService.handleFollowUpSlashCommand`. The
 * session service calls `routeFollowUpSlashCommand` and falls through to
 * regular LLM streaming when the result is null (passthrough).
 *
 * Every log message, MESSAGE_TYPES.CHAT_COMPLETE payload, and
 * `executeSlashCommand` argument shape is preserved byte-identically from
 * the pre-extraction version.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import type { ModelSettings } from '@ptah-extension/settings-core';
import {
  AuthRequiredError,
  SDK_TOKENS,
  SlashCommandInterceptor,
  type ManualCompactAdmission,
} from '@ptah-extension/agent-sdk';
import {
  AUTH_PROVIDERS_TOKENS,
  type WorkspaceProviderProfileResolver,
} from '@ptah-extension/auth-providers';
import type {
  IAgentAdapter,
  SessionId,
  AISessionConfig,
  ChatContinueParams,
  ChatContinueResult,
} from '@ptah-extension/shared';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

import { CHAT_TOKENS } from '../tokens';
import type { ChatSdkContextService } from './chat-sdk-context.service';
import type {
  ChatStreamBroadcaster,
  WebviewManager,
} from '../streaming/chat-stream-broadcaster.service';

@injectable()
export class ChatSlashCommandRouterService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(SETTINGS_TOKENS.MODEL_SETTINGS)
    private readonly modelSettings: ModelSettings,
    @inject(TOKENS.AGENT_ADAPTER)
    private readonly sdkAdapter: IAgentAdapter,
    @inject(SDK_TOKENS.SDK_SLASH_COMMAND_INTERCEPTOR)
    private readonly slashCommandInterceptor: SlashCommandInterceptor,
    @inject(CHAT_TOKENS.SDK_CONTEXT)
    private readonly sdkContext: ChatSdkContextService,
    @inject(CHAT_TOKENS.STREAM_BROADCASTER)
    private readonly streamBroadcaster: ChatStreamBroadcaster,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER)
    private readonly workspaceProviderProfileResolver: WorkspaceProviderProfileResolver,
    @inject(SDK_TOKENS.SDK_COMPACTION_COORDINATOR, { isOptional: true })
    private readonly manualCompactAdmission?: ManualCompactAdmission,
  ) {}

  /**
   * Route a follow-up slash command for an active chat session.
   *
   * Returns a structured `ChatContinueResult` if the command was intercepted
   * (native or SDK new-query), or `null` to indicate the caller should
   * proceed with normal LLM streaming.
   *
   * Extracted from `ChatSessionService.handleFollowUpSlashCommand` — every
   * log message and MESSAGE_TYPES.CHAT_COMPLETE payload is byte-identical.
   */
  async routeFollowUpSlashCommand(
    prompt: string,
    sessionId: SessionId,
    tabId: string,
    workspacePath: string | undefined,
    params: ChatContinueParams,
  ): Promise<ChatContinueResult | null> {
    const interceptResult = this.slashCommandInterceptor.intercept(prompt);

    if (interceptResult.action === 'passthrough') {
      return null; // Not a slash command, caller continues with normal flow
    }

    if (interceptResult.action === 'native') {
      this.logger.info('[RPC] chat:continue - native command intercepted', {
        command: interceptResult.commandName,
        sessionId,
      });

      if (interceptResult.commandName === 'clear') {
        await this.sdkAdapter.interruptSession(sessionId);

        await this.webviewManager.broadcastMessage(
          MESSAGE_TYPES.CHAT_COMPLETE,
          {
            tabId,
            sessionId,
            command: 'clear',
            message:
              'Conversation cleared. Start a new message to begin fresh.',
          },
        );
        return { success: true, sessionId };
      }
      this.logger.warn('[RPC] chat:continue - unrecognized native command', {
        command: interceptResult.commandName,
        sessionId,
      });
      return { success: true, sessionId };
    }

    if (interceptResult.action === 'new-query') {
      this.logger.info(
        '[RPC] chat:continue - SDK slash command intercepted, starting new query',
        {
          command: interceptResult.rawCommand,
          sessionId,
        },
      );
      if (
        interceptResult.commandName === 'compact' &&
        this.manualCompactAdmission
      ) {
        try {
          const decision =
            this.manualCompactAdmission.requestManualCompact(sessionId);
          if (decision.action !== 'send') {
            this.logger.info(
              '[RPC] chat:continue - manual compact admitted without send',
              {
                sessionId,
                decision: decision.action,
              },
            );
            return { success: true, sessionId };
          }
        } catch (error) {
          this.logger.warn(
            '[RPC] chat:continue - manual compact admission failed',
            {
              sessionId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }
      const mcpServerRunning = this.sdkContext.isMcpServerRunning();
      const enhancedPromptsContent =
        await this.sdkContext.resolveEnhancedPromptsContent(workspacePath);
      const command = interceptResult.rawCommand ?? prompt;
      const model =
        params.model || this.modelSettings.selectedModel.get() || 'default';
      let reservationId: string | undefined;
      try {
        // The relaunch is a new query: it gets the same per-workspace provider
        // snapshot as chat:start / resume, never whatever the shared auth env
        // was last configured for (AuthRequiredError on a mismatch).
        const providerProfile =
          await this.workspaceProviderProfileResolver.resolveProviderProfileForWorkspace(
            workspacePath ?? '',
            model,
          );
        if (
          interceptResult.commandName === 'compact' &&
          this.manualCompactAdmission
        ) {
          try {
            const admission =
              this.manualCompactAdmission.admitManualCompact(sessionId);
            if (admission.decision.action !== 'send') {
              this.logger.info(
                '[RPC] chat:continue - manual compact admitted without send',
                {
                  sessionId,
                  decision: admission.decision.action,
                },
              );
              return { success: true, sessionId };
            }
            reservationId = admission.reservationId;
          } catch (error) {
            this.logger.warn(
              '[RPC] chat:continue - manual compact admission failed',
              {
                sessionId,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        }
        const stream = await this.sdkAdapter.executeSlashCommand(
          sessionId,
          command,
          {
            sessionConfig: {
              model,
              projectPath: workspacePath,
              ...(params.mcpToolProfile
                ? { mcpToolProfile: params.mcpToolProfile }
                : {}),
              ...(params.ptahUiFence !== undefined
                ? { ptahUiFence: params.ptahUiFence }
                : {}),
              ...(params.systemPrompt
                ? { systemPrompt: params.systemPrompt }
                : {}),
            } as AISessionConfig,
            mcpServerRunning,
            enhancedPromptsContent,
            tabId,
            providerProfile,
          },
        );
        this.streamBroadcaster.streamEventsToWebview(sessionId, stream, tabId);

        return { success: true, sessionId };
      } catch (slashError) {
        const message =
          slashError instanceof Error ? slashError.message : String(slashError);
        this.logger.warn(
          '[RPC] chat:continue - executeSlashCommand rejected by runtime',
          { sessionId, command, error: message },
        );
        const result: ChatContinueResult = {
          success: false,
          sessionId,
          error: message,
          ...(slashError instanceof AuthRequiredError
            ? {
                errorCode: 'AUTH_REQUIRED' as const,
                ...(slashError.providerId
                  ? { providerId: slashError.providerId }
                  : {}),
              }
            : {}),
        };
        return result;
      } finally {
        if (reservationId !== undefined && this.manualCompactAdmission) {
          try {
            this.manualCompactAdmission.releaseManualReservation(
              sessionId,
              reservationId,
            );
          } catch (error) {
            this.logger.warn(
              '[RPC] chat:continue - manual compact release failed',
              {
                sessionId,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        }
      }
    }

    return null;
  }
}
