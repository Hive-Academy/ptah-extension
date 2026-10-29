import { computed, effect } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ChatStore } from '@ptah-extension/chat';
import { CommandCenterStore } from '../model/command-center.store';

export function isIdleWithoutPendingRequest(
  tabs: TabManagerService,
  chat: ChatStore,
  tabId: string | null,
  sessionId: string | null,
): boolean {
  const status = tabs.tabs().find((tab) => tab.id === tabId)?.status;
  if (status !== 'loaded' && status !== 'fresh' && status !== 'draft')
    return false;
  const belongs = (request: { tabId?: string; sessionId?: string }) =>
    request.tabId === tabId || (!!sessionId && request.sessionId === sessionId);
  return (
    !chat.questionRequests().some(belongs) &&
    !chat.permissionRequests().some(belongs)
  );
}

export class CommandCenterQuestionProvider {
  private readonly spokenRequestIds = new Set<string>();
  public readonly ordinaryQuestion = computed(() => {
    const tabId = this.store.markedTabId();
    const sessionId = this.store.sessionId();
    return this.chat.questionRequests().find(
      (request) =>
        (request.tabId === tabId || request.sessionId === sessionId) &&
        !!request.questions[0],
    ) ?? null;
  });
  public readonly ordinaryChoices = computed(() =>
    (this.ordinaryQuestion()?.questions[0]?.options ?? []).map((option) => option.label),
  );
  public readonly permissionRequest = computed(() => {
    const tabId = this.store.markedTabId();
    const sessionId = this.store.sessionId();
    return this.chat.permissionRequests().find((request) =>
      request.tabId
        ? request.tabId === tabId
        : !!sessionId && request.sessionId === sessionId,
    ) ?? null;
  });
  public readonly shownInput = computed(() => {
    const permission = this.permissionRequest();
    if (permission)
      return {
        id: permission.id,
        kind: 'approval' as const,
        title: `${permission.toolName} permission`,
        description: permission.description,
        prompt: `${permission.toolName} requests permission. Use the card to approve or deny.`,
      };
    const request = this.ordinaryQuestion();
    const question = request?.questions[0];
    return request && question
      ? {
          id: request.id,
          kind: 'question' as const,
          title: question.header,
          description: question.question,
          prompt: question.question,
        }
      : null;
  });

  public constructor(
    private readonly store: CommandCenterStore,
    private readonly chat: ChatStore,
    private readonly onPendingPrompt: (prompt: string) => void,
  ) {
    effect(() => {
      const shown = this.shownInput();
      this.store.setPendingInput(shown ? {
        id: shown.id,
        kind: shown.kind,
        title: shown.title,
        description: shown.description,
      } : null);
      if (shown && !this.spokenRequestIds.has(shown.id)) {
        this.spokenRequestIds.add(shown.id);
        this.onPendingPrompt(shown.prompt);
      }
    });
  }
}
