/**
 * Slash command router (Wave C7e cleanup pass 2).
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
import {
  Logger,
  TOKENS,
  ConfigManager,
  LicenseService,
  isPremiumTier,
} from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  SlashCommandInterceptor,
  DEFAULT_FALLBACK_MODEL_ID,
} from '@ptah-extension/agent-sdk';
import type {
  IAgentAdapter,
  SessionId,
  AISessionConfig,
  ChatContinueParams,
  ChatContinueResult,
} from '@ptah-extension/shared';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

import { CHAT_TOKENS } from '../tokens';
import type { ChatPremiumContextService } from './chat-premium-context.service';
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
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
    @inject(TOKENS.AGENT_ADAPTER)
    private readonly sdkAdapter: IAgentAdapter,
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService,
    @inject(SDK_TOKENS.SDK_SLASH_COMMAND_INTERCEPTOR)
    private readonly slashCommandInterceptor: SlashCommandInterceptor,
    @inject(CHAT_TOKENS.PREMIUM_CONTEXT)
    private readonly premiumContext: ChatPremiumContextService,
    @inject(CHAT_TOKENS.STREAM_BROADCASTER)
    private readonly streamBroadcaster: ChatStreamBroadcaster,
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
   * @see TASK_2025_184
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
        // End the current session, frontend handles reset
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

      // Other native commands — not yet implemented
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

      // Resolve premium config for the new query
      const licenseStatus = await this.licenseService.verifyLicense();
      const isPremium = isPremiumTier(licenseStatus);
      const mcpServerRunning = this.premiumContext.isMcpServerRunning();
      const enhancedPromptsContent =
        await this.premiumContext.resolveEnhancedPromptsContent(
          workspacePath,
          isPremium,
        );
      const pluginPaths = this.premiumContext.resolvePluginPaths(isPremium);

      // TASK_2025_184: Use rawCommand with fallback — safe regardless of whether
      // SlashCommandResult uses discriminated union or optional rawCommand
      const command = interceptResult.rawCommand ?? prompt;

      // Execute the slash command as a new query with resume. Surface a
      // structured error back to the webview instead of failing mid-stream.
      try {
        const stream = await this.sdkAdapter.executeSlashCommand(
          sessionId,
          command,
          {
            sessionConfig: {
              model:
                params.model ||
                this.configManager.getWithDefault<string>(
                  'model.selected',
                  DEFAULT_FALLBACK_MODEL_ID,
                ),
              projectPath: workspacePath,
            } as AISessionConfig,
            isPremium,
            mcpServerRunning,
            enhancedPromptsContent,
            pluginPaths,
            tabId,
          },
        );

        // Reconnect streaming to the frontend
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
        };
        return result;
      }
    }

    return null;
  }
}
