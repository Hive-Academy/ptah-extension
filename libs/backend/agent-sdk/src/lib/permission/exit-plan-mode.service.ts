import type { Logger } from '@ptah-extension/vscode-core';
import {
  isExitPlanModeToolInput,
  MESSAGE_TYPES,
  SessionId,
  TabId,
} from '@ptah-extension/shared';
import type { PermissionResult } from '../types/sdk-types/claude-sdk.types';
import type { WebviewManagerLike } from './ask-user-question.service';

export interface ExitPlanResponse {
  approved: boolean;
}

export type RequestUserPermissionFn = (
  toolName: string,
  input: Record<string, unknown>,
  toolUseId?: string,
  sessionId?: SessionId,
  agentID?: string,
  signal?: AbortSignal,
  cliAgentResolver?: () => string | undefined,
  tabId?: TabId,
) => Promise<PermissionResult>;

export class ExitPlanModeService {
  constructor(
    private readonly webviewManager: WebviewManagerLike,
    private readonly logger: Logger,
    private readonly requestUserPermission: RequestUserPermissionFn,
  ) {}

  async handleExitPlanMode(
    input: Record<string, unknown>,
    toolUseId: string,
    sessionId?: SessionId,
    signal?: AbortSignal,
    tabId?: TabId,
  ): Promise<PermissionResult> {
    if (!isExitPlanModeToolInput(input)) {
      this.logger.warn(
        '[SdkPermissionHandler] Invalid ExitPlanMode input — missing plan field',
        { input },
      );
      return {
        behavior: 'deny' as const,
        message: 'Invalid ExitPlanMode input format — plan field is required',
      };
    }

    this.logger.info(
      '[SdkPermissionHandler] Requesting user approval for ExitPlanMode (plan review)',
      {
        toolUseId,
        planLength: input.plan.length,
      },
    );

    const result = await this.requestUserPermission(
      'ExitPlanMode',
      input,
      toolUseId,
      sessionId,
      undefined,
      signal,
      undefined,
      tabId,
    );

    if (result.behavior === 'allow') {
      this.logger.info(
        '[SdkPermissionHandler] ExitPlanMode approved — SDK will clear context and begin execution',
      );
      this.webviewManager
        .sendMessage('ptah.main', MESSAGE_TYPES.PLAN_MODE_CHANGED, {
          active: false,
        })
        .catch((error) => {
          this.logger.error(
            `[SdkPermissionHandler] Failed to send plan mode exited event`,
            { error },
          );
        });
    } else {
      this.logger.info(
        '[SdkPermissionHandler] ExitPlanMode denied — agent stays in plan mode',
      );
    }

    return result;
  }
}
