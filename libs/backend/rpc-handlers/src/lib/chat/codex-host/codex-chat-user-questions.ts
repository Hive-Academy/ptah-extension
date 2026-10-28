import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SdkPermissionHandler } from '@ptah-extension/agent-sdk';
import type { CodexApprovalRequest, CodexRuntimeRegistrationPorts } from '@ptah-extension/codex-runtime';
import { SessionId, TabId, type QuestionItem } from '@ptah-extension/shared';

const questionsSchema = z.object({
  questions: z.array(z.object({
    id: z.string().min(1),
    header: z.string(),
    question: z.string().min(1),
    isOther: z.boolean().optional(),
    isSecret: z.boolean().optional(),
    options: z.array(z.object({ label: z.string(), description: z.string() })).nullish(),
  })),
});
const responseSchema = z.object({ answers: z.record(z.string(), z.string()) });

export interface CodexChatUserQuestionsDeps {
  readonly permissionHandler: Pick<SdkPermissionHandler, 'createCallback'>;
  readonly tabId: (sessionId: SessionId) => string;
  readonly logger: Pick<Logger, 'warn'>;
}

/** Use the handler's existing AskUserQuestionService and pending registry. */
export function createCodexChatUserQuestions(
  deps: CodexChatUserQuestionsDeps,
): NonNullable<CodexRuntimeRegistrationPorts['requestUserInput']> {
  return async (request: CodexApprovalRequest, signal: AbortSignal) => {
    const parsed = questionsSchema.safeParse(request.details);
    const sessionId = SessionId.safeParse(request.threadId);
    if (request.kind !== 'userInput' || !parsed.success || !sessionId) {
      deps.logger.warn('Invalid Codex user question request', {
        requestId: request.requestId,
      });
      return {};
    }
    const tabId = TabId.safeParse(deps.tabId(sessionId)) ?? undefined;
    const used = new Set<string>();
    const mapping = parsed.data.questions.map((question) => {
      let text = question.question;
      for (let duplicate = 2; used.has(text); duplicate += 1)
        text = `${question.question} (${duplicate})`;
      used.add(text);
      const item: QuestionItem = {
        question: text,
        header: question.header,
        // Claude always offers a free-text Other choice. Secret answers have
        // no auto-picked option, so the shared service cannot log one on idle.
        options: question.isSecret ? [] : (question.options ?? []),
        multiSelect: false,
      };
      return { id: question.id, text, item };
    });
    const ask = deps.permissionHandler.createCallback(sessionId, undefined, tabId);
    const result = await ask(
      'AskUserQuestion',
      { questions: mapping.map(({ item }) => item) },
      {
        signal,
        toolUseID: String(request.requestId),
        requestId: String(request.requestId),
      },
    );
    if (signal.aborted || result === null || result.behavior !== 'allow')
      return {};
    const response = responseSchema.safeParse(result.updatedInput);
    if (!response.success) {
      deps.logger.warn('Invalid Codex user question response', {
        requestId: request.requestId,
      });
      return {};
    }
    return Object.fromEntries(mapping.flatMap(({ id, text }) => {
      const answer = response.data.answers[text];
      return answer === undefined ? [] : [[id, { answers: [answer] }]];
    }));
  };
}
