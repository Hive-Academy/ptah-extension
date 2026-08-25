import 'reflect-metadata';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  MESSAGE_TYPES,
  type AskUserQuestionRequest,
} from '@ptah-extension/shared';
import {
  AskUserQuestionService,
  type AskUserQuestionResponse,
  type WebviewManagerLike,
} from './ask-user-question.service';
import { PendingResponseRegistry } from './pending-response-registry';

/** The two-parameter registry the service now requires. */
type QuestionRegistry = PendingResponseRegistry<
  AskUserQuestionResponse,
  AskUserQuestionRequest
>;

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

function makeService(delivered = true): {
  service: AskUserQuestionService;
  logger: MockLogger;
  sent: SentMessage[];
  registry: QuestionRegistry;
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
        return delivered;
      },
    ),
  };

  const registry: QuestionRegistry = new PendingResponseRegistry<
    AskUserQuestionResponse,
    AskUserQuestionRequest
  >(asLogger(logger));
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
      service as unknown as { registry: QuestionRegistry }
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

describe('AskUserQuestionService - listPendingBySession (reload recovery)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const SESSION_A = '11111111-2222-4333-8444-555555555555';
  const SESSION_B = '99999999-8888-4777-8666-555555555555';
  const TAB_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  it('returns an empty array when nothing is pending for the session', () => {
    const { service } = makeService();
    expect(service.listPendingBySession(SESSION_A)).toEqual([]);
  });

  it('returns the original request object so a reloaded webview can re-render it', async () => {
    const { service, sent } = makeService();

    const ac = new AbortController();
    const pending = service.handleAskUserQuestion(
      makeAskInput(),
      'tool-list-1',
      asSessionId(SESSION_A),
      ac.signal,
      undefined,
    );

    await flushMicrotasks();

    const listed = service.listPendingBySession(SESSION_A);
    expect(listed).toHaveLength(1);

    // Identical to what was broadcast — same id, same questions, same routing.
    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST,
    );
    expect(listed[0]).toEqual(broadcast!.payload);
    expect(listed[0]?.toolName).toBe('AskUserQuestion');
    expect(listed[0]?.questions).toHaveLength(1);

    ac.abort();
    await pending;
  });

  it('matches on the explicit tabId as well as the sessionId', async () => {
    const { service } = makeService();

    const ac = new AbortController();
    const pending = service.handleAskUserQuestion(
      makeAskInput(),
      'tool-list-2',
      asSessionId(SESSION_A),
      ac.signal,
      asTabId(TAB_A),
    );

    await flushMicrotasks();

    expect(service.listPendingBySession(TAB_A)).toHaveLength(1);
    expect(service.listPendingBySession(SESSION_A)).toHaveLength(1);

    ac.abort();
    await pending;
  });

  it('does not leak pending questions belonging to another session', async () => {
    const { service } = makeService();

    const ac = new AbortController();
    const pending = service.handleAskUserQuestion(
      makeAskInput(),
      'tool-list-3',
      asSessionId(SESSION_A),
      ac.signal,
      undefined,
    );

    await flushMicrotasks();

    expect(service.listPendingBySession(SESSION_B)).toEqual([]);

    ac.abort();
    await pending;
  });

  it('lists every outstanding request for the session', async () => {
    const { service } = makeService();

    const ac = new AbortController();
    const first = service.handleAskUserQuestion(
      makeAskInput(),
      'tool-list-4a',
      asSessionId(SESSION_A),
      ac.signal,
      undefined,
    );
    const second = service.handleAskUserQuestion(
      makeAskInput(),
      'tool-list-4b',
      asSessionId(SESSION_A),
      ac.signal,
      undefined,
    );

    await flushMicrotasks();

    const listed = service.listPendingBySession(SESSION_A);
    expect(listed).toHaveLength(2);
    expect(new Set(listed.map((q) => q.id)).size).toBe(2);

    ac.abort();
    await Promise.all([first, second]);
  });

  it('stops listing a request once it has been answered', async () => {
    const { service } = makeService();

    const ac = new AbortController();
    const pending = service.handleAskUserQuestion(
      makeAskInput(),
      'tool-list-5',
      asSessionId(SESSION_A),
      ac.signal,
      undefined,
    );

    await flushMicrotasks();

    const [outstanding] = service.listPendingBySession(SESSION_A);
    expect(outstanding).toBeDefined();

    service.handleQuestionResponse({
      id: outstanding!.id,
      answers: { 'Pick a strategy?': 'A' },
    });
    await pending;

    expect(service.listPendingBySession(SESSION_A)).toEqual([]);
  });

  it('stops listing after cleanupBySession tears the session down', async () => {
    const { service } = makeService();

    const ac = new AbortController();
    const pending = service.handleAskUserQuestion(
      makeAskInput(),
      'tool-list-6',
      asSessionId(SESSION_A),
      ac.signal,
      undefined,
    );

    await flushMicrotasks();
    expect(service.listPendingBySession(SESSION_A)).toHaveLength(1);

    service.cleanupBySession(SESSION_A);
    await pending;

    expect(service.listPendingBySession(SESSION_A)).toEqual([]);
  });
});

describe('AskUserQuestionService - undelivered request (TASK_2026_263)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('auto-picks the recommended options when the webview did not receive the request', async () => {
    const { service, logger, registry } = makeService(false);

    const ac = new AbortController();
    const result = await service.handleAskUserQuestion(
      {
        questions: [
          {
            question: 'Which stack?',
            header: 'Stack',
            options: [{ label: 'Nx + NestJS' }, { label: 'Plain Node' }],
            multiSelect: false,
          },
        ],
      },
      'tool-undelivered',
      asSessionId('11111111-2222-4333-8444-555555555555'),
      ac.signal,
      undefined,
    );

    const permResult = result as unknown as {
      behavior: string;
      updatedInput?: { answers?: Record<string, string> };
    };
    expect(permResult.behavior).toBe('allow');
    expect(permResult.updatedInput?.answers).toEqual({
      'Which stack?': 'Nx + NestJS',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('NOT delivered'),
      expect.objectContaining({ requestId: expect.any(String) }),
    );
    // Idle timer cleared with the registry entry — nothing left pending.
    expect(registry.size).toBe(0);
  });

  it('keeps waiting for the user when the request WAS delivered', async () => {
    const { service, registry } = makeService(true);

    const ac = new AbortController();
    const pending = service.handleAskUserQuestion(
      makeAskInput(),
      'tool-delivered',
      asSessionId('11111111-2222-4333-8444-555555555555'),
      ac.signal,
      undefined,
    );

    await flushMicrotasks();

    expect(registry.size).toBe(1);

    ac.abort();
    await pending;
  });
});
