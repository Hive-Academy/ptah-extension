import type { Logger } from '@ptah-extension/vscode-core';
import {
  isAskUserQuestionToolInput,
  MESSAGE_TYPES,
  SessionId,
  TabId,
  type QuestionItem,
} from '@ptah-extension/shared';
import type { PermissionResult } from '../types/sdk-types/claude-sdk.types';
import { generateRequestId } from './permission-description';
import { PendingResponseRegistry } from './pending-response-registry';

export interface AskUserQuestionResponse {
  id: string;
  answers: Record<string, string>;
}

export interface AskUserQuestionRequest {
  id: string;
  toolName: 'AskUserQuestion';
  questions: QuestionItem[];
  toolUseId?: string;
  timestamp: number;
  timeoutAt: number;
  sessionId?: string;
  tabId?: string;
}

export interface WebviewManagerLike {
  sendMessage<T = unknown>(
    viewType: string,
    type: string,
    payload: T,
  ): Promise<boolean>;
}

export const ASK_USER_QUESTION_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export class AskUserQuestionService {
  constructor(
    private readonly webviewManager: WebviewManagerLike,
    private readonly logger: Logger,
    private readonly registry: PendingResponseRegistry<AskUserQuestionResponse>,
  ) {}

  async handleAskUserQuestion(
    input: Record<string, unknown>,
    toolUseId: string,
    sessionId?: SessionId,
    signal?: AbortSignal,
    tabId?: TabId,
  ): Promise<PermissionResult> {
    if (!isAskUserQuestionToolInput(input)) {
      this.logger.warn('[SdkPermissionHandler] Invalid AskUserQuestion input', {
        input,
      });
      return {
        behavior: 'deny' as const,
        message: 'Invalid AskUserQuestion input format',
      };
    }

    const requestId = generateRequestId();
    const now = Date.now();

    const resolvedTabId = tabId ?? sessionId;

    const request: AskUserQuestionRequest = {
      id: requestId,
      toolName: 'AskUserQuestion',
      questions: input.questions,
      toolUseId,
      timestamp: now,
      timeoutAt: 0,
      sessionId,
      tabId: resolvedTabId,
    };

    if (!request.tabId) {
      this.logger.warn(
        '[SdkPermissionHandler] AskUserQuestion emitted without tabId — frontend will fall back to all tabs bound to session',
        { questionId: request.id, sessionId: request.sessionId },
      );
    }

    this.logger.info('[SdkPermissionHandler] Sending AskUserQuestion request', {
      requestId,
      questionCount: input.questions.length,
      toolUseId,
    });

    this.webviewManager
      .sendMessage(
        'ptah.main',
        MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST,
        request,
      )
      .then(() => {
        this.logger.info(
          `[SdkPermissionHandler] AskUserQuestion request sent to webview`,
          { requestId },
        );
      })
      .catch((error) => {
        this.logger.error(
          `[SdkPermissionHandler] Failed to send AskUserQuestion request`,
          { error },
        );
        this.registry.resolve(request.id, null);
      });

    const response = await this.awaitQuestionResponse(
      requestId,
      signal,
      sessionId,
      input.questions,
      resolvedTabId,
      tabId,
    );

    if (!response) {
      this.logger.warn('[SdkPermissionHandler] AskUserQuestion aborted', {
        requestId,
      });
      return {
        behavior: 'deny' as const,
        message: 'Question request was aborted',
      };
    }

    this.logger.info('[SdkPermissionHandler] AskUserQuestion answered', {
      requestId,
      answerCount: Object.keys(response.answers).length,
    });

    return {
      behavior: 'allow' as const,
      updatedInput: {
        ...input,
        answers: response.answers,
      },
    };
  }

  awaitQuestionResponse(
    requestId: string,
    signal?: AbortSignal,
    sessionId?: SessionId,
    questions?: QuestionItem[],
    resolvedTabId?: string,
    tabId?: TabId,
  ): Promise<AskUserQuestionResponse | null> {
    return new Promise<AskUserQuestionResponse | null>((resolve) => {
      if (signal?.aborted) {
        this.registry.clear(requestId);
        resolve(null);
        return;
      }

      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      if (
        ASK_USER_QUESTION_IDLE_TIMEOUT_MS > 0 &&
        questions &&
        questions.length > 0
      ) {
        idleTimer = setTimeout(() => {
          const pending = this.registry.getPending(requestId);
          if (!pending) return;
          const answers: Record<string, string> = {};
          for (const q of questions) {
            const recommended = q.options?.[0]?.label;
            if (recommended) answers[q.question] = recommended;
          }
          this.logger.warn(
            '[SdkPermissionHandler] AskUserQuestion idle-timeout reached — auto-picking recommended options',
            {
              requestId,
              timeoutMs: ASK_USER_QUESTION_IDLE_TIMEOUT_MS,
              answers,
            },
          );
          this.registry.clear(requestId);
          signal?.removeEventListener('abort', onAbort);
          this.webviewManager
            .sendMessage(
              'ptah.main',
              MESSAGE_TYPES.ASK_USER_QUESTION_AUTO_RESOLVED,
              { id: requestId, answers, sessionId, tabId: resolvedTabId },
            )
            .catch((error) => {
              this.logger.error(
                '[SdkPermissionHandler] Failed to broadcast AskUserQuestion auto-resolution',
                { error },
              );
            });
          resolve({ id: requestId, answers });
        }, ASK_USER_QUESTION_IDLE_TIMEOUT_MS);
      }

      const onAbort = () => {
        this.registry.clear(requestId);
        resolve(null);
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      this.registry.register(requestId, {
        resolve: (response) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(response);
        },
        sessionId,
        tabId,
        idleTimer,
      });
    });
  }

  handleQuestionResponse(response: AskUserQuestionResponse): void {
    const resolved = this.registry.resolve(response.id, response);
    if (!resolved) {
      this.logger.warn(
        `[SdkPermissionHandler] Received question response for unknown request: ${response.id}`,
      );
      return;
    }
    this.logger.debug(
      `[SdkPermissionHandler] Handled question response for request ${response.id}`,
    );
  }

  cleanupBySession(sessionOrTabId: string): void {
    this.registry.cleanupBySession(sessionOrTabId, null);
  }

  disposeAll(): void {
    this.registry.disposeAll(null);
  }

  get pendingCount(): number {
    return this.registry.size;
  }
}
