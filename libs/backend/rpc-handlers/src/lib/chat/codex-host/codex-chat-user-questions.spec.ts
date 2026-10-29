import 'reflect-metadata';
import { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import {
  MESSAGE_TYPES,
  SessionId,
  type AskUserQuestionRequest,
  type AskUserQuestionResponse,
} from '@ptah-extension/shared';
import type { CodexApprovalRequest, CodexJsonValue } from '@ptah-extension/codex-runtime';
import {
  AskUserQuestionService,
  ASK_USER_QUESTION_IDLE_TIMEOUT_MS,
  PendingResponseRegistry,
  type SdkPermissionHandler,
} from '@ptah-extension/agent-sdk';
import { createCodexChatUserQuestions } from './codex-chat-user-questions';

const SESSION = SessionId.from('11111111-1111-4111-8111-111111111111');
const TAB = SessionId.from('22222222-2222-4222-8222-222222222222');

function request(questions: CodexJsonValue[]): CodexApprovalRequest {
  return {
    kind: 'userInput', contextId: 'context', processGeneration: 1,
    threadId: SESSION, turnId: 'turn', requestId: 7,
    normalizedHome: '/home', workspaceId: '/workspace', providerId: 'codex',
    message: 'Question', details: { questions },
  };
}

function harness(delivered = true) {
  const mockLogger = createMockLogger();
  const logger: Logger = Object.assign(Object.create(Logger.prototype), mockLogger);
  const sent: Array<{ type: string; payload: unknown }> = [];
  const registry = new PendingResponseRegistry<AskUserQuestionResponse, AskUserQuestionRequest>(logger);
  const service = new AskUserQuestionService({
    sendMessage: async (_view, type, payload) => {
      sent.push({ type, payload });
      return delivered;
    },
  }, logger, registry);
  const cleanupPendingPermissions = jest.fn();
  const handler: Pick<SdkPermissionHandler, 'createCallback' | 'cleanupPendingPermissions'> = {
    createCallback: (sessionId, _agent, tabId) =>
      async (_tool, input, options) =>
        service.handleAskUserQuestion(input, options.toolUseID, sessionId, options.signal, tabId),
    cleanupPendingPermissions,
  };
  const ask = createCodexChatUserQuestions({
    permissionHandler: handler, tabId: () => TAB, logger,
  });
  const prompt = () => sent.find(({ type }) => type === MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST)?.payload as AskUserQuestionRequest | undefined;
  return { ask, service, registry, sent, prompt, logger: mockLogger, cleanupPendingPermissions };
}

describe('Codex chat user questions', () => {
  const choice = { label: 'Yes', description: 'Proceed' };

  it('maps options, routing and answers through the shared question service', async () => {
    const h = harness();
    const pending = h.ask(request([{ id: 'first', header: 'Confirm', question: 'Proceed?', options: [choice], isOther: true }]), new AbortController().signal);
    await Promise.resolve();
    const prompt = h.prompt();
    expect(prompt).toMatchObject({ toolName: 'AskUserQuestion', sessionId: SESSION, tabId: TAB,
      questions: [{ header: 'Confirm', question: 'Proceed?', options: [choice], multiSelect: false }] });
    expect(h.service.listPendingBySession(SESSION)).toEqual([prompt]);
    h.service.handleQuestionResponse({ id: prompt?.id ?? '', answers: { 'Proceed?': 'Yes' } });
    await expect(pending).resolves.toEqual({ first: { answers: ['Yes'] } });
    expect(h.registry.size).toBe(0);
    expect(h.cleanupPendingPermissions).not.toHaveBeenCalled();
  });

  it('disambiguates repeated text before mapping answers to distinct ids', async () => {
    const h = harness();
    const pending = h.ask(request([
      { id: 'one', header: 'One', question: 'Same?', options: [choice] },
      { id: 'two', header: 'Two', question: 'Same?', options: [choice] },
    ]), new AbortController().signal);
    await Promise.resolve();
    const prompt = h.prompt();
    expect(prompt?.questions.map(({ question }) => question)).toEqual(['Same?', 'Same? (2)']);
    h.service.handleQuestionResponse({ id: prompt?.id ?? '', answers: { 'Same?': 'Yes', 'Same? (2)': 'No' } });
    await expect(pending).resolves.toEqual({ one: { answers: ['Yes'] }, two: { answers: ['No'] } });
  });

  it('keeps secret questions out of auto-pick options and logs', async () => {
    const h = harness();
    const pending = h.ask(request([{ id: 'secret', header: 'Secret', question: 'Token?',
      options: [{ label: 'sensitive-option', description: 'Sensitive' }], isSecret: true }]), new AbortController().signal);
    await Promise.resolve();
    const prompt = h.prompt();
    expect(prompt?.questions[0].options).toEqual([]);
    h.service.handleQuestionResponse({ id: prompt?.id ?? '', answers: { 'Token?': 'secret-value' } });
    await expect(pending).resolves.toEqual({ secret: { answers: ['secret-value'] } });
    expect(JSON.stringify(h.logger.info.mock.calls)).not.toContain('secret-value');
    expect(JSON.stringify(h.logger.warn.mock.calls)).not.toContain('secret-value');
  });

  it('clears a pending question when the bridge aborts', async () => {
    const h = harness();
    const controller = new AbortController();
    const pending = h.ask(request([{ id: 'one', header: 'One', question: 'Stop?', options: [choice] }]), controller.signal);
    await Promise.resolve();
    expect(h.registry.size).toBe(1);
    controller.abort();
    await expect(pending).resolves.toEqual({});
    expect(h.registry.size).toBe(0);
    expect(h.cleanupPendingPermissions).toHaveBeenCalledTimes(1);
    expect(h.cleanupPendingPermissions).toHaveBeenCalledWith(SESSION);
  });

  it('uses the shared auto-pick when the webview cannot receive the question', async () => {
    const h = harness(false);
    await expect(h.ask(request([{ id: 'one', header: 'One', question: 'Proceed?', options: [choice] }]), new AbortController().signal))
      .resolves.toEqual({ one: { answers: ['Yes'] } });
    expect(h.registry.size).toBe(0);
  });

  it('uses the shared idle auto-pick', async () => {
    jest.useFakeTimers();
    try {
      const h = harness();
      const pending = h.ask(request([{ id: 'one', header: 'One', question: 'Proceed?', options: [choice] }]), new AbortController().signal);
      await Promise.resolve();
      jest.advanceTimersByTime(ASK_USER_QUESTION_IDLE_TIMEOUT_MS);
      await expect(pending).resolves.toEqual({ one: { answers: ['Yes'] } });
      expect(h.sent.some(({ type }) => type === MESSAGE_TYPES.ASK_USER_QUESTION_AUTO_RESOLVED)).toBe(true);
      expect(h.registry.size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not dismiss the card for an invalid request', async () => {
    const h = harness();
    const controller = new AbortController();
    controller.abort();
    const invalid = request([{ id: 'one', header: 'One', question: 'Proceed?', options: [choice] }]);
    await expect(h.ask({ ...invalid, details: { questions: [{ id: '' }] } }, controller.signal))
      .resolves.toEqual({});
    expect(h.cleanupPendingPermissions).not.toHaveBeenCalled();
  });

  it('logs a throwing cleanup and still resolves', async () => {
    const h = harness();
    h.cleanupPendingPermissions.mockImplementation(() => {
      throw new Error('cleanup failed');
    });
    const controller = new AbortController();
    const pending = h.ask(request([{ id: 'one', header: 'One', question: 'Stop?', options: [choice] }]), controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(pending).resolves.toEqual({});
    expect(h.cleanupPendingPermissions).toHaveBeenCalledTimes(1);
    expect(h.logger.warn).toHaveBeenCalledWith(
      'Codex user question cleanup failed',
      expect.objectContaining({ requestId: 7, error: 'cleanup failed' }),
    );
  });
});
