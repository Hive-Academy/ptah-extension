/**
 * sdk-permission-handler - unit specs.
 *
 * Tests lock in the use-case identity contracts for permission and question
 * routing:
 *
 *   UC1 - New session (tabId passed explicitly as third arg to createCallback).
 *          Wire prompt.tabId = explicit tabId, prompt.sessionId = routingId.
 *   UC2 - Resumed session (same contract; tabId is the frontend tab UUID,
 *          sessionId is the real SDK UUID).
 *   UC3 - CLI path (no tabId arg). Wire prompt.tabId = undefined so the
 *          frontend router falls through to agent-monitor routing.
 *
 * TASK_2026_120 Phase B additions:
 *   - createCallback type-safety: TabId/SessionId branded params enforce identity
 *   - cleanupPendingPermissions dual-match: keying by tabId OR sessionId
 *   - PermissionRequestSchema UUID validation for tabId and sessionId fields
 */

import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES, PermissionRequestSchema } from '@ptah-extension/shared';

import { SdkPermissionHandler } from './sdk-permission-handler';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface SentMessage {
  viewType: string;
  type: string;
  payload: Record<string, unknown>;
}

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

interface AskUserQuestionPayload {
  id: string;
  toolName: 'AskUserQuestion';
  sessionId?: string;
  tabId?: string;
  questions: ReadonlyArray<{ header: string; options: { label: string }[] }>;
}

interface PermissionRequestPayload {
  id: string;
  toolName: string;
  sessionId?: string;
  tabId?: string;
}

function makeHandler(): {
  handler: SdkPermissionHandler;
  logger: MockLogger;
  sent: SentMessage[];
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

  container.clearInstances();
  container.registerInstance(TOKENS.WEBVIEW_MANAGER, webviewManager);

  const subagentRegistry = {
    getToolCallIdByAgentId: jest.fn().mockReturnValue(null),
    get: jest.fn().mockReturnValue(undefined),
  };

  const handler = new SdkPermissionHandler(
    asLogger(logger),
    subagentRegistry as unknown as ConstructorParameters<
      typeof SdkPermissionHandler
    >[1],
  );

  return { handler, logger, sent };
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

type SessionIdParam = Parameters<SdkPermissionHandler['createCallback']>[0];
type TabIdParam = Parameters<SdkPermissionHandler['createCallback']>[2];

function asSessionId(s: string): SessionIdParam {
  return s as SessionIdParam;
}
function asTabId(s: string): TabIdParam {
  return s as TabIdParam;
}

// ---------------------------------------------------------------------------
// UC1 / UC2 / UC3 - createCallback use-case contract tests
// ---------------------------------------------------------------------------

describe('SdkPermissionHandler - createCallback use-case contracts', () => {
  afterEach(() => {
    container.clearInstances();
    jest.clearAllMocks();
  });

  it('createCallback - UC1 new session: prompt.tabId equals tabId arg, prompt.sessionId equals routingId', async () => {
    const { handler, sent } = makeHandler();

    const TAB_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const ROUTING_ID = TAB_ID;
    const callback = handler.createCallback(
      asSessionId(ROUTING_ID),
      undefined,
      asTabId(TAB_ID),
    );

    const ac = new AbortController();
    const pending = callback(
      'Bash',
      { command: 'ls' },
      {
        signal: ac.signal,
        toolUseID: 'tool-uc1',
      },
    );

    await flushMicrotasks();

    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.PERMISSION_REQUEST,
    );
    expect(broadcast).toBeDefined();
    const payload = broadcast!.payload as unknown as PermissionRequestPayload;
    expect(payload.tabId).toBe(TAB_ID);
    expect(payload.sessionId).toBe(ROUTING_ID);

    ac.abort();
    await pending;
  });

  it('createCallback - UC2 resumed session: prompt.tabId equals explicit tabId arg, prompt.sessionId equals real SDK UUID', async () => {
    const { handler, sent } = makeHandler();

    const REAL_SESSION_UUID = '11111111-2222-4333-8444-555555555555';
    const EXPLICIT_TAB_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const callback = handler.createCallback(
      asSessionId(REAL_SESSION_UUID),
      undefined,
      asTabId(EXPLICIT_TAB_ID),
    );

    const ac = new AbortController();
    const pending = callback(
      'Write',
      { file_path: '/tmp/x', content: 'y' },
      {
        signal: ac.signal,
        toolUseID: 'tool-uc2',
      },
    );

    await flushMicrotasks();

    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.PERMISSION_REQUEST,
    );
    expect(broadcast).toBeDefined();
    const payload = broadcast!.payload as unknown as PermissionRequestPayload;
    expect(payload.tabId).toBe(EXPLICIT_TAB_ID);
    expect(payload.sessionId).toBe(REAL_SESSION_UUID);

    ac.abort();
    await pending;
  });

  it('createCallback - UC3 CLI path (no tabId): prompt.tabId is undefined, prompt.sessionId equals real SDK UUID', async () => {
    const { handler, sent } = makeHandler();

    const REAL_SESSION_UUID = '11111111-2222-4333-8444-555555555555';
    const callback = handler.createCallback(asSessionId(REAL_SESSION_UUID));

    const ac = new AbortController();
    const pending = callback(
      'Bash',
      { command: 'echo' },
      {
        signal: ac.signal,
        toolUseID: 'tool-uc3',
      },
    );

    await flushMicrotasks();

    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.PERMISSION_REQUEST,
    );
    expect(broadcast).toBeDefined();
    const payload = broadcast!.payload as unknown as PermissionRequestPayload;
    expect(payload.tabId).toBeUndefined();
    expect(payload.sessionId).toBe(REAL_SESSION_UUID);

    ac.abort();
    await pending;
  });
});

// ---------------------------------------------------------------------------
// AskUserQuestion tabId stamping
// ---------------------------------------------------------------------------

describe('SdkPermissionHandler - AskUserQuestion tabId stamping', () => {
  afterEach(() => {
    container.clearInstances();
    jest.clearAllMocks();
  });

  it('askUserQuestion stamps tabId from session context when available (tabId ?? sessionId fallback in handleAskUserQuestion)', async () => {
    const { handler, sent } = makeHandler();

    const ROUTING_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const callback = handler.createCallback(asSessionId(ROUTING_ID));

    const ac = new AbortController();
    const pending = callback('AskUserQuestion', makeAskInput(), {
      signal: ac.signal,
      toolUseID: 'tool-use-1',
    });

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

  it('askUserQuestion logs warning when tabId is unavailable (sub-agent / no-tab path)', async () => {
    const { handler, logger, sent } = makeHandler();

    const callback = handler.createCallback(undefined, undefined, undefined);

    const ac = new AbortController();
    const pending = callback('AskUserQuestion', makeAskInput(), {
      signal: ac.signal,
      toolUseID: 'tool-use-2',
    });

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

  it('askUserQuestion prefers explicit tabId argument over sessionId fallback', async () => {
    const { handler, sent } = makeHandler();

    const REAL_SESSION_UUID = '11111111-2222-4333-8444-555555555555';
    const EXPLICIT_TAB_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const callback = handler.createCallback(
      asSessionId(REAL_SESSION_UUID),
      undefined,
      asTabId(EXPLICIT_TAB_ID),
    );

    const ac = new AbortController();
    const pending = callback('AskUserQuestion', makeAskInput(), {
      signal: ac.signal,
      toolUseID: 'tool-use-3',
    });

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

// ---------------------------------------------------------------------------
// PermissionRequest tabId stamping
// ---------------------------------------------------------------------------

describe('SdkPermissionHandler - PermissionRequest tabId stamping', () => {
  afterEach(() => {
    container.clearInstances();
    jest.clearAllMocks();
  });

  it('stamps tabId only when explicit tabId arg present (no sessionId fallback for permission route)', async () => {
    const { handler, sent } = makeHandler();

    const ROUTING_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const callback = handler.createCallback(asSessionId(ROUTING_ID));

    const ac = new AbortController();
    const pending = callback(
      'Bash',
      { command: 'ls' },
      {
        signal: ac.signal,
        toolUseID: 'tool-use-1',
      },
    );

    await flushMicrotasks();

    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.PERMISSION_REQUEST,
    );
    expect(broadcast).toBeDefined();
    const payload = broadcast!.payload as unknown as PermissionRequestPayload;
    expect(payload.tabId).toBeUndefined();
    expect(payload.sessionId).toBe(ROUTING_ID);

    ac.abort();
    await pending;
  });

  it('prefers explicit tabId argument over sessionId (resumed-session path)', async () => {
    const { handler, sent } = makeHandler();

    const REAL_SESSION_UUID = '11111111-2222-4333-8444-555555555555';
    const EXPLICIT_TAB_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const callback = handler.createCallback(
      asSessionId(REAL_SESSION_UUID),
      undefined,
      asTabId(EXPLICIT_TAB_ID),
    );

    const ac = new AbortController();
    const pending = callback(
      'Write',
      { file_path: '/tmp/x', content: 'y' },
      {
        signal: ac.signal,
        toolUseID: 'tool-use-2',
      },
    );

    await flushMicrotasks();

    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.PERMISSION_REQUEST,
    );
    expect(broadcast).toBeDefined();
    const payload = broadcast!.payload as unknown as PermissionRequestPayload;
    expect(payload.tabId).toBe(EXPLICIT_TAB_ID);
    expect(payload.sessionId).toBe(REAL_SESSION_UUID);

    ac.abort();
    await pending;
  });

  it('emits PermissionRequest with undefined tabId when no routing context available (sub-agent / CLI path)', async () => {
    const { handler, sent } = makeHandler();

    const callback = handler.createCallback(undefined, undefined, undefined);

    const ac = new AbortController();
    const pending = callback(
      'Bash',
      { command: 'echo' },
      {
        signal: ac.signal,
        toolUseID: 'tool-use-3',
      },
    );

    await flushMicrotasks();

    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.PERMISSION_REQUEST,
    );
    expect(broadcast).toBeDefined();
    const payload = broadcast!.payload as unknown as PermissionRequestPayload;
    expect(payload.tabId).toBeUndefined();
    expect(payload.sessionId).toBeUndefined();

    ac.abort();
    await pending;
  });
});

// ---------------------------------------------------------------------------
// cleanupPendingPermissions - dual-match on tabId OR sessionId
// ---------------------------------------------------------------------------

describe('SdkPermissionHandler - cleanupPendingPermissions keying', () => {
  afterEach(() => {
    container.clearInstances();
    jest.clearAllMocks();
  });

  it('cleanupPendingPermissions - keying by tabId cleans interactive-path requests', async () => {
    const { handler, sent } = makeHandler();

    const TAB_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const SESSION_UUID = '11111111-2222-4333-8444-555555555555';
    const callback = handler.createCallback(
      asSessionId(SESSION_UUID),
      undefined,
      asTabId(TAB_ID),
    );

    const pending = callback(
      'Bash',
      { command: 'ls' },
      {
        signal: new AbortController().signal,
        toolUseID: 'tool-cleanup-tab',
      },
    );

    await flushMicrotasks();
    expect(sent.some((m) => m.type === MESSAGE_TYPES.PERMISSION_REQUEST)).toBe(
      true,
    );

    handler.cleanupPendingPermissions(TAB_ID);

    const result = await pending;
    expect(result).toMatchObject({ behavior: 'deny' });
  });

  it('cleanupPendingPermissions - keying by sessionId cleans CLI-path requests', async () => {
    const { handler, sent } = makeHandler();

    const SESSION_UUID = '11111111-2222-4333-8444-555555555555';
    const callback = handler.createCallback(asSessionId(SESSION_UUID));

    const pending = callback(
      'Bash',
      { command: 'ls' },
      {
        signal: new AbortController().signal,
        toolUseID: 'tool-cleanup-session',
      },
    );

    await flushMicrotasks();
    expect(sent.some((m) => m.type === MESSAGE_TYPES.PERMISSION_REQUEST)).toBe(
      true,
    );

    handler.cleanupPendingPermissions(SESSION_UUID);

    const result = await pending;
    expect(result).toMatchObject({ behavior: 'deny' });
  });

  it('cleanupPendingPermissions - all-cleanup (no arg) clears both interactive and CLI requests', async () => {
    const { handler } = makeHandler();

    const TAB_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const SESSION_UUID = '11111111-2222-4333-8444-555555555555';
    const CLI_SESSION = 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa';

    const interactiveCallback = handler.createCallback(
      asSessionId(SESSION_UUID),
      undefined,
      asTabId(TAB_ID),
    );
    const interactivePending = interactiveCallback(
      'Bash',
      { command: 'ls' },
      {
        signal: new AbortController().signal,
        toolUseID: 'tool-all-interactive',
      },
    );

    const cliCallback = handler.createCallback(asSessionId(CLI_SESSION));
    const cliPending = cliCallback(
      'Write',
      { file_path: '/tmp/x', content: 'y' },
      {
        signal: new AbortController().signal,
        toolUseID: 'tool-all-cli',
      },
    );

    await flushMicrotasks();

    handler.cleanupPendingPermissions();

    const [interactiveResult, cliResult] = await Promise.all([
      interactivePending,
      cliPending,
    ]);

    expect(interactiveResult).toMatchObject({ behavior: 'deny' });
    expect(cliResult).toMatchObject({ behavior: 'deny' });
  });
});

// ---------------------------------------------------------------------------
// PermissionRequestSchema - UUID validation for tabId and sessionId
// ---------------------------------------------------------------------------

describe('PermissionRequestSchema - UUID validation', () => {
  const BASE_VALID = {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    toolName: 'Bash',
    toolInput: { command: 'ls' },
    timestamp: Date.now(),
    description: 'test',
    timeoutAt: 0,
  };

  it('PermissionRequestSchema rejects non-UUID tabId at parse time', () => {
    const result = PermissionRequestSchema.safeParse({
      ...BASE_VALID,
      tabId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('PermissionRequestSchema rejects non-UUID sessionId at parse time', () => {
    const result = PermissionRequestSchema.safeParse({
      ...BASE_VALID,
      sessionId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('PermissionRequestSchema accepts valid UUID tabId and sessionId', () => {
    const result = PermissionRequestSchema.safeParse({
      ...BASE_VALID,
      tabId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      sessionId: '11111111-2222-4333-8444-555555555555',
    });
    expect(result.success).toBe(true);
  });

  it('PermissionRequestSchema accepts missing optional tabId and sessionId', () => {
    const result = PermissionRequestSchema.safeParse(BASE_VALID);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fix 6: auto-timeout answers keyed by q.question, not q.header
// ---------------------------------------------------------------------------

describe('SdkPermissionHandler - AskUserQuestion idle-timeout answer keying (Fix 6)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    container.clearInstances();
    jest.clearAllMocks();
  });

  it('keys auto-timeout answers by q.question not q.header', async () => {
    const { handler } = makeHandler();

    const callback = handler.createCallback(
      asSessionId('aaaaaaaa-bbbb-4ccc-8ddd-sess55555555'),
    );

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

    const pending = callback(
      'AskUserQuestion',
      { questions },
      { signal: ac.signal, toolUseID: 'tool-fix6' },
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
