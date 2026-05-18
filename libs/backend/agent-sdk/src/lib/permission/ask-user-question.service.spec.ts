import 'reflect-metadata';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import {
  AskUserQuestionService,
  type AskUserQuestionResponse,
  type WebviewManagerLike,
} from './ask-user-question.service';
import { PendingResponseRegistry } from './pending-response-registry';

interface SentMessage {
  viewType: string;
  type: string;
  payload: Record<string, unknown>;
}

interface AskUserQuestionPayload {
  id: string;
  toolName: 'AskUserQuestion';
  sessionId?: string;
  tabId?: string;
  questions: ReadonlyArray<{ header: string; options: { label: string }[] }>;
}

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

function makeService(): {
  service: AskUserQuestionService;
  logger: MockLogger;
  sent: SentMessage[];
  registry: PendingResponseRegistry<AskUserQuestionResponse>;
} {
  const logger = createMockLogger();
  const sent: SentMessage[] = [];

  const webviewManager = {
    sendMessage: jest.fn(
      async (
        viewType: string,
        type: string,
        payload: Record<string, unknown>,
      ) => {
        sent.push({ viewType, type, payload });
        return true;
      },
    ),
  };

  const registry = new PendingResponseRegistry<AskUserQuestionResponse>(
    asLogger(logger),
  );
  const service = new AskUserQuestionService(
    webviewManager as unknown as WebviewManagerLike,
    asLogger(logger),
    registry,
  );

  return { service, logger, sent, registry };
}

function makeAskInput() {
  return {
    questions: [
      {
        header: 'Pick a strategy',
        question: 'Pick a strategy?',
        options: [{ label: 'A' }, { label: 'B' }],
        multiSelect: false,
      },
    ],
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

type SessionIdArg = Parameters<
  AskUserQuestionService['handleAskUserQuestion']
>[2];
type TabIdArg = Parameters<AskUserQuestionService['handleAskUserQuestion']>[4];

function asSessionId(s: string): SessionIdArg {
  return s as SessionIdArg;
}
function asTabId(s: string): TabIdArg {
  return s as TabIdArg;
}

describe('AskUserQuestionService - tabId stamping', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('stamps tabId from session context when available (tabId ?? sessionId fallback)', async () => {
    const { service, sent } = makeService();

    const ROUTING_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const ac = new AbortController();
    const pending = service.handleAskUserQuestion(
      makeAskInput(),
      'tool-use-1',
      asSessionId(ROUTING_ID),
      ac.signal,
      undefined,
    );

    await flushMicrotasks();

    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST,
    );
    expect(broadcast).toBeDefined();
    const payload = broadcast!.payload as unknown as AskUserQuestionPayload;
    expect(payload.tabId).toBe(ROUTING_ID);
    expect(payload.sessionId).toBe(ROUTING_ID);

    ac.abort();
    await pending;
  });

  it('logs warning when tabId is unavailable (sub-agent / no-tab path)', async () => {
    const { service, logger, sent } = makeService();

    const ac = new AbortController();
    const pending = service.handleAskUserQuestion(
      makeAskInput(),
      'tool-use-2',
      undefined,
      ac.signal,
      undefined,
    );

    await flushMicrotasks();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('emitted without tabId'),
      expect.objectContaining({
        questionId: expect.any(String),
        sessionId: undefined,
      }),
    );

    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST,
    );
    expect(broadcast).toBeDefined();
    const payload = broadcast!.payload as unknown as AskUserQuestionPayload;
    expect(payload.tabId).toBeUndefined();

    ac.abort();
    await pending;
  });

  it('prefers explicit tabId argument over sessionId fallback', async () => {
    const { service, sent } = makeService();

    const REAL_SESSION_UUID = '11111111-2222-4333-8444-555555555555';
    const EXPLICIT_TAB_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

    const ac = new AbortController();
    const pending = service.handleAskUserQuestion(
      makeAskInput(),
      'tool-use-3',
      asSessionId(REAL_SESSION_UUID),
      ac.signal,
      asTabId(EXPLICIT_TAB_ID),
    );

    await flushMicrotasks();

    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST,
    );
    expect(broadcast).toBeDefined();
    const payload = broadcast!.payload as unknown as AskUserQuestionPayload;
    expect(payload.tabId).toBe(EXPLICIT_TAB_ID);
    expect(payload.sessionId).toBe(REAL_SESSION_UUID);

    ac.abort();
    await pending;
  });
});

describe('AskUserQuestionService - webviewManager.sendMessage contract', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('invokes webviewManager.sendMessage with ASK_USER_QUESTION_REQUEST and a populated questions payload', async () => {
    const { service, sent } = makeService();

    const SESSION_ID = '11111111-2222-4333-8444-555555555555';
    const ac = new AbortController();
    const pending = service.handleAskUserQuestion(
      {
        questions: [
          {
            question: 'Continue?',
            header: 'Confirm',
            options: [
              { label: 'Yes', description: 'go' },
              { label: 'No', description: 'stop' },
            ],
          },
        ],
      },
      'tool-ask-user-question-path',
      asSessionId(SESSION_ID),
      ac.signal,
      undefined,
    );

    await flushMicrotasks();

    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST,
    );
    expect(broadcast).toBeDefined();
    expect(broadcast!.viewType).toBe('ptah.main');
    const payload = broadcast!.payload as unknown as AskUserQuestionPayload;
    expect(payload.toolName).toBe('AskUserQuestion');
    expect(payload.questions).toHaveLength(1);

    ac.abort();
    await pending;
  });
});

describe('AskUserQuestionService - idle-timeout answer keying (Fix 6)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('keys auto-timeout answers by q.question not q.header', async () => {
    const { service } = makeService();

    const questions = [
      {
        question: 'Which deployment strategy should I use?',
        header: 'Strategy',
        options: [{ label: 'Blue-Green' }, { label: 'Canary' }],
        multiSelect: false,
      },
      {
        question: 'Which database should I migrate first?',
        header: 'DB',
        options: [{ label: 'Postgres' }, { label: 'Redis' }],
        multiSelect: false,
      },
    ];

    const ac = new AbortController();
    const pending = service.handleAskUserQuestion(
      { questions },
      'tool-fix6',
      asSessionId('aaaaaaaa-bbbb-4ccc-8ddd-sess55555555'),
      ac.signal,
      undefined,
    );

    await flushMicrotasks();

    jest.runAllTimers();

    await Promise.resolve();
    await Promise.resolve();

    const result = await pending;

    expect(result).not.toBeNull();
    const permResult = result as unknown as {
      behavior: string;
      updatedInput?: { answers?: Record<string, string> };
    };
    expect(permResult.behavior).toBe('allow');
    const answers = permResult.updatedInput?.answers ?? {};

    expect(answers['Which deployment strategy should I use?']).toBe(
      'Blue-Green',
    );
    expect(answers['Which database should I migrate first?']).toBe('Postgres');

    expect(answers['Strategy']).toBeUndefined();
    expect(answers['DB']).toBeUndefined();
  });
});

describe('AskUserQuestionService - handleQuestionResponse', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('resolves the pending question with the provided answers', async () => {
    const { service } = makeService();

    const SESSION_ID = '11111111-2222-4333-8444-555555555555';
    const ac = new AbortController();
    const pending = service.handleAskUserQuestion(
      makeAskInput(),
      'tool-respond',
      asSessionId(SESSION_ID),
      ac.signal,
      undefined,
    );

    await flushMicrotasks();

    // Find the request id from the registry
    const ids: string[] = [];
    for (const [id] of (
      service as unknown as {
        registry: PendingResponseRegistry<AskUserQuestionResponse>;
      }
    ).registry.entries()) {
      ids.push(id);
    }
    expect(ids).toHaveLength(1);

    service.handleQuestionResponse({
      id: ids[0]!,
      answers: { 'Pick a strategy?': 'A' },
    });

    const result = await pending;
    const permResult = result as unknown as {
      behavior: string;
      updatedInput?: { answers?: Record<string, string> };
    };
    expect(permResult.behavior).toBe('allow');
    expect(permResult.updatedInput?.answers).toEqual({
      'Pick a strategy?': 'A',
    });
  });

  it('warns when receiving response for unknown id', () => {
    const { service, logger } = makeService();
    service.handleQuestionResponse({ id: 'unknown', answers: {} });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown request: unknown'),
    );
  });
});
