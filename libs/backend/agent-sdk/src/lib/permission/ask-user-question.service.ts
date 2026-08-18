import type { Logger } from '@ptah-extension/vscode-core';
import {
  isAskUserQuestionToolInput,
  MESSAGE_TYPES,
  SessionId,
  TabId,
  type AskUserQuestionRequest,
  type QuestionItem,
} from '@ptah-extension/shared';
import type { PermissionResult } from '../types/sdk-types/claude-sdk.types';
import { generateRequestId } from './permission-description';
import { PendingResponseRegistry } from './pending-response-registry';

export interface AskUserQuestionResponse {
  id: string;
  answers: Record<string, string>;
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
    private readonly registry: PendingResponseRegistry<
      AskUserQuestionResponse,
      AskUserQuestionRequest
    >,
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
      .then((delivered) => {
        if (delivered) {
          this.logger.info(
            `[SdkPermissionHandler] AskUserQuestion request sent to webview`,
            { requestId },
          );
          return;
        }
        this.logger.warn(
          `[SdkPermissionHandler] AskUserQuestion NOT delivered — webview "ptah.main" not found. ` +
            `Auto-picking recommended options instead of hanging until the idle timeout.`,
          {
            requestId,
            sessionId: request.sessionId,
            tabId: request.tabId,
          },
        );
        this.autoPickRecommended(requestId, input.questions);
      })
      .catch((error) => {
        this.logger.error(
          `[SdkPermissionHandler] Failed to send AskUserQuestion request`,
          { error },
        );
        this.registry.resolve(request.id, null);
      });

    const response = await this.awaitQuestionResponse(
      request,
      signal,
      sessionId,
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

  /**
   * Park until the user answers `request` (or the call is aborted / idles out).
   *
   * Takes the whole request rather than its scattered fields so the pending
   * entry can carry it: `chat:pending-questions` replays exactly the object
   * that was broadcast, and a reloaded webview re-renders the same prompt.
   *
   * `sessionId` / `tabId` stay separate branded parameters — the registry
   * indexes on the branded ids, while the request carries their plain-string
   * wire form.
   */
  awaitQuestionResponse(
    request: AskUserQuestionRequest,
    signal?: AbortSignal,
    sessionId?: SessionId,
    tabId?: TabId,
  ): Promise<AskUserQuestionResponse | null> {
    const requestId = request.id;
    const questions = request.questions;
    const resolvedTabId = request.tabId;

    return new Promise<AskUserQuestionResponse | null>((resolve) => {
      if (signal?.aborted) {
        this.registry.clear(requestId);
        resolve(null);
        return;
      }

      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      if (ASK_USER_QUESTION_IDLE_TIMEOUT_MS > 0 && questions.length > 0) {
        idleTimer = setTimeout(() => {
          const pending = this.registry.getPending(requestId);
          if (!pending) return;
          const answers = this.recommendedAnswers(questions);
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
        request,
      });
    });
  }

  /**
   * First option of every question, keyed by question text. The SDK lists the
   * recommended option first, so this is the same answer set the idle timeout
   * picks.
   */
  private recommendedAnswers(
    questions: readonly QuestionItem[],
  ): Record<string, string> {
    const answers: Record<string, string> = {};
    for (const q of questions) {
      const recommended = q.options?.[0]?.label;
      if (recommended) answers[q.question] = recommended;
    }
    return answers;
  }

  /**
   * Non-delivery escape hatch, mirroring `SdkPermissionHandler`'s deny-on-
   * undelivered-prompt path. A question the webview never received can never
   * be answered, and `awaitQuestionResponse` runs with no deadline other than
   * the 5-minute idle timer — so resolve it now with the same answers that
   * timer would eventually pick. No-op when the request was already resolved.
   */
  private autoPickRecommended(
    requestId: string,
    questions: readonly QuestionItem[],
  ): void {
    if (!this.registry.getPending(requestId)) return;
    this.registry.resolve(requestId, {
      id: requestId,
      answers: this.recommendedAnswers(questions),
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

  /**
   * Questions this session (or tab) is still waiting on an answer for.
   *
   * A webview reload throws away the rendered prompt while the backend keeps
   * blocking on it, so the reloaded UI asks for the outstanding requests and
   * re-renders them. Empty array when nothing is pending.
   */
  listPendingBySession(sessionId: string): AskUserQuestionRequest[] {
    return this.registry.listBySession(sessionId);
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
