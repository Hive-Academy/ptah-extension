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

interface SentMessage {
  viewType: string;
  type: string;
  payload: Record<string, unknown>;
}

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

interface PermissionRequestPayload {
  id: string;
  toolName: string;
  sessionId?: string;
  tabId?: string;
}

interface AskUserQuestionPayload {
  id: string;
  toolName: 'AskUserQuestion';
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
    webviewManager as unknown as ConstructorParameters<
      typeof SdkPermissionHandler
    >[2],
  );

  return { handler, logger, sent };
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

describe('webviewManager.sendMessage is invoked for facade request paths', () => {
  afterEach(() => {
    container.clearInstances();
    jest.clearAllMocks();
  });

  it('requestUserPermission path: invokes webviewManager.sendMessage with PERMISSION_REQUEST and a populated payload', async () => {
    const { handler, sent } = makeHandler();

    const SESSION_ID = '11111111-2222-4333-8444-555555555555';
    const TAB_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const callback = handler.createCallback(
      asSessionId(SESSION_ID),
      undefined,
      asTabId(TAB_ID),
    );

    const ac = new AbortController();
    const pending = callback(
      'Bash',
      { command: 'ls' },
      {
        signal: ac.signal,
        toolUseID: 'tool-request-path',
      },
    );

    await flushMicrotasks();

    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.PERMISSION_REQUEST,
    );
    expect(broadcast).toBeDefined();
    expect(broadcast!.viewType).toBe('ptah.main');
    const payload = broadcast!.payload as unknown as PermissionRequestPayload;
    expect(payload.toolName).toBe('Bash');
    expect(typeof payload.id).toBe('string');
    expect(payload.tabId).toBe(TAB_ID);
    expect(payload.sessionId).toBe(SESSION_ID);

    ac.abort();
    await pending;
  });

  it('sendCliAgentPermissionRequest path: invokes webviewManager.sendMessage with AGENT_MONITOR_PERMISSION_REQUEST when a cliAgentResolver returns an id', async () => {
    const { handler, sent } = makeHandler();

    const SESSION_ID = '11111111-2222-4333-8444-555555555555';
    const callback = handler.createCallback(
      asSessionId(SESSION_ID),
      () => 'agent-id-123',
    );

    const ac = new AbortController();
    const pending = callback(
      'Bash',
      { command: 'ls' },
      {
        signal: ac.signal,
        toolUseID: 'tool-cli-agent-path',
      },
    );

    await flushMicrotasks();

    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST,
    );
    expect(broadcast).toBeDefined();
    expect(broadcast!.viewType).toBe('ptah.main');
    const payload = broadcast!.payload as unknown as {
      requestId: string;
      agentId: string;
      toolName: string;
    };
    expect(payload.agentId).toBe('agent-id-123');
    expect(payload.toolName).toBe('Bash');
    expect(typeof payload.requestId).toBe('string');

    ac.abort();
    await pending;
  });

  it('AskUserQuestion delegation: facade routes AskUserQuestion through child service and broadcasts ASK_USER_QUESTION_REQUEST', async () => {
    const { handler, sent } = makeHandler();

    const SESSION_ID = '11111111-2222-4333-8444-555555555555';
    const callback = handler.createCallback(asSessionId(SESSION_ID));

    const ac = new AbortController();
    const pending = callback(
      'AskUserQuestion',
      {
        questions: [
          {
            question: 'Continue?',
            header: 'Confirm',
            options: [{ label: 'Yes' }, { label: 'No' }],
          },
        ],
      },
      {
        signal: ac.signal,
        toolUseID: 'tool-ask',
      },
    );

    await flushMicrotasks();

    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST,
    );
    expect(broadcast).toBeDefined();
    const payload = broadcast!.payload as unknown as AskUserQuestionPayload;
    expect(payload.toolName).toBe('AskUserQuestion');

    ac.abort();
    await pending;
  });

  it('ExitPlanMode delegation: facade routes ExitPlanMode through child service and emits PERMISSION_REQUEST with toolName ExitPlanMode', async () => {
    const { handler, sent } = makeHandler();

    const SESSION_ID = '11111111-2222-4333-8444-555555555555';
    const callback = handler.createCallback(asSessionId(SESSION_ID));

    const ac = new AbortController();
    const pending = callback(
      'ExitPlanMode',
      { plan: 'go' },
      {
        signal: ac.signal,
        toolUseID: 'tool-exit-plan',
      },
    );

    await flushMicrotasks();

    const broadcast = sent.find(
      (m) =>
        m.type === MESSAGE_TYPES.PERMISSION_REQUEST &&
        (m.payload as unknown as PermissionRequestPayload).toolName ===
          'ExitPlanMode',
    );
    expect(broadcast).toBeDefined();

    ac.abort();
    await pending;
  });
});

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

describe('SdkPermissionHandler - per-session level resolver', () => {
  afterEach(() => {
    container.clearInstances();
    jest.clearAllMocks();
  });

  it('auto-approves a dangerous tool when the session resolver returns yolo', async () => {
    const { handler, sent } = makeHandler();

    const callback = handler.createCallback(
      asSessionId('11111111-2222-4333-8444-555555555555'),
      undefined,
      undefined,
      () => 'yolo',
    );

    const result = await callback(
      'Bash',
      { command: 'rm -rf /' },
      { signal: new AbortController().signal, toolUseID: 'tool-yolo' },
    );

    expect(result).toMatchObject({ behavior: 'allow' });
    expect(
      sent.find((m) => m.type === MESSAGE_TYPES.PERMISSION_REQUEST),
    ).toBeUndefined();
  });

  it('isolates sessions: a yolo session auto-approves while an ask session still prompts', async () => {
    const { handler, sent } = makeHandler();

    // Same handler, two sessions with independent resolvers — the global
    // _permissionLevel field is untouched (defaults to 'ask').
    const yoloCallback = handler.createCallback(
      asSessionId('aaaaaaaa-1111-4111-8111-111111111111'),
      undefined,
      undefined,
      () => 'yolo',
    );
    const askCallback = handler.createCallback(
      asSessionId('bbbbbbbb-2222-4222-8222-222222222222'),
      undefined,
      undefined,
      () => 'ask',
    );

    const yoloResult = await yoloCallback(
      'Bash',
      { command: 'ls' },
      { signal: new AbortController().signal, toolUseID: 'tool-iso-yolo' },
    );
    expect(yoloResult).toMatchObject({ behavior: 'allow' });

    const ac = new AbortController();
    const askPending = askCallback(
      'Bash',
      { command: 'ls' },
      { signal: ac.signal, toolUseID: 'tool-iso-ask' },
    );
    await flushMicrotasks();

    // The ask session was NOT auto-approved by the other session's yolo — it
    // routed a permission prompt to the UI.
    expect(
      sent.filter((m) => m.type === MESSAGE_TYPES.PERMISSION_REQUEST),
    ).toHaveLength(1);

    ac.abort();
    await askPending;
  });

  it('AskUserQuestion bypasses yolo auto-approval: a yolo session still routes the question to the UI', async () => {
    const { handler, sent } = makeHandler();

    // YOLO auto-approves ordinary tools, but AskUserQuestion is an interactive
    // tool that MUST still reach the UI — the handler intercepts it BEFORE the
    // yolo auto-approve branch. Regression guard for the YOLO→'default'
    // permission-mode fix (which keeps canUseTool in the loop).
    const callback = handler.createCallback(
      asSessionId('dddddddd-4444-4444-8444-444444444444'),
      undefined,
      undefined,
      () => 'yolo',
    );

    const ac = new AbortController();
    const pending = callback(
      'AskUserQuestion',
      {
        questions: [
          {
            question: 'Continue?',
            header: 'Confirm',
            options: [{ label: 'Yes' }, { label: 'No' }],
          },
        ],
      },
      { signal: ac.signal, toolUseID: 'tool-yolo-ask' },
    );

    await flushMicrotasks();

    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST,
    );
    expect(broadcast).toBeDefined();
    expect(
      (broadcast!.payload as unknown as AskUserQuestionPayload).toolName,
    ).toBe('AskUserQuestion');
    // It was NOT silently auto-approved like an ordinary yolo tool call.
    expect(
      sent.find((m) => m.type === MESSAGE_TYPES.PERMISSION_REQUEST),
    ).toBeUndefined();

    ac.abort();
    await pending;
  });

  it('ExitPlanMode bypasses yolo auto-approval: a yolo session still routes the plan prompt to the UI', async () => {
    const { handler, sent } = makeHandler();

    const callback = handler.createCallback(
      asSessionId('eeeeeeee-5555-4555-8555-555555555555'),
      undefined,
      undefined,
      () => 'yolo',
    );

    const ac = new AbortController();
    const pending = callback(
      'ExitPlanMode',
      { plan: 'go' },
      { signal: ac.signal, toolUseID: 'tool-yolo-exit-plan' },
    );

    await flushMicrotasks();

    const broadcast = sent.find(
      (m) =>
        m.type === MESSAGE_TYPES.PERMISSION_REQUEST &&
        (m.payload as unknown as PermissionRequestPayload).toolName ===
          'ExitPlanMode',
    );
    expect(broadcast).toBeDefined();

    ac.abort();
    await pending;
  });

  it('falls back to the global level when no resolver is supplied (CLI path)', async () => {
    const { handler, sent } = makeHandler();
    handler.setPermissionLevel('yolo');

    const callback = handler.createCallback(
      asSessionId('cccccccc-3333-4333-8333-333333333333'),
    );

    const result = await callback(
      'Bash',
      { command: 'ls' },
      { signal: new AbortController().signal, toolUseID: 'tool-cli-global' },
    );

    expect(result).toMatchObject({ behavior: 'allow' });
    expect(
      sent.find((m) => m.type === MESSAGE_TYPES.PERMISSION_REQUEST),
    ).toBeUndefined();
  });
});

describe('SdkPermissionHandler - F2 unroutable deny-timeout (TASK_2026_155, Task 1.4)', () => {
  afterEach(() => {
    container.clearInstances();
    jest.clearAllMocks();
  });

  it('unroutable request (no UUID sessionId, gw-* tabId) with no response resolves deny after 60s, cleans up pendingRequests/pendingRequestContext, and logs a warn', async () => {
    jest.useFakeTimers();
    try {
      const { handler, sent, logger } = makeHandler();
      // sessionId is a gateway routing id, NOT a UUID -> unroutable (broadcast
      // fallback case per context.md F2). No tabId either.
      const callback = handler.createCallback(
        asSessionId('gw-conv-1'),
        undefined,
        undefined,
      );

      const ac = new AbortController();
      const pending = callback(
        'Bash',
        { command: 'ls' },
        { signal: ac.signal, toolUseID: 'tool-unroutable' },
      );

      await flushMicrotasks();
      const broadcast = sent.find(
        (m) => m.type === MESSAGE_TYPES.PERMISSION_REQUEST,
      );
      expect(broadcast).toBeDefined();
      const requestId = (
        broadcast!.payload as unknown as PermissionRequestPayload
      ).id;

      // The 60s unroutable deny timer must be armed (and only that one).
      expect(jest.getTimerCount()).toBe(1);

      await jest.advanceTimersByTimeAsync(60_000);

      const result = await pending;
      expect(result).toMatchObject({ behavior: 'deny' });

      const warnedTimeout = (logger.warn as jest.Mock).mock.calls.some((call) =>
        String(call[0]).toLowerCase().includes('timed out'),
      );
      expect(warnedTimeout).toBe(true);

      const internal = handler as unknown as {
        pendingRequests: Map<string, unknown>;
        pendingRequestContext: Map<string, unknown>;
      };
      expect(internal.pendingRequests.has(requestId)).toBe(false);
      expect(internal.pendingRequestContext.has(requestId)).toBe(false);
      expect(jest.getTimerCount()).toBe(0);

      ac.abort();
    } finally {
      jest.useRealTimers();
    }
  });

  it('routed request (valid UUID sessionId) is NEVER auto-denied — no timer armed, still pending past 60s+', async () => {
    jest.useFakeTimers();
    try {
      const { handler, sent } = makeHandler();
      const ROUTABLE_SESSION = '11111111-2222-4333-8444-555555555555';
      const callback = handler.createCallback(asSessionId(ROUTABLE_SESSION));

      const ac = new AbortController();
      const pending = callback(
        'Bash',
        { command: 'ls' },
        { signal: ac.signal, toolUseID: 'tool-routable' },
      );

      await flushMicrotasks();
      const broadcast = sent.find(
        (m) => m.type === MESSAGE_TYPES.PERMISSION_REQUEST,
      );
      expect(broadcast).toBeDefined();
      const requestId = (
        broadcast!.payload as unknown as PermissionRequestPayload
      ).id;

      // Routable requests arm NO timer at all (timeoutAt stays 0 / infinite
      // wait, exactly as before F2).
      expect(jest.getTimerCount()).toBe(0);

      await jest.advanceTimersByTimeAsync(120_000);

      const internal = handler as unknown as {
        pendingRequests: Map<string, unknown>;
      };
      expect(internal.pendingRequests.has(requestId)).toBe(true);

      // Cleanup so the promise settles and the test does not leak a pending
      // await; this is NOT part of the assertion — the request never denied
      // itself, we abort it ourselves.
      ac.abort();
      const result = await pending;
      expect(result).toMatchObject({ behavior: 'deny', interrupt: true });
    } finally {
      jest.useRealTimers();
    }
  });

  it('a real response arriving before the timeout clears the timer — no double-resolve, no leaked timer', async () => {
    jest.useFakeTimers();
    try {
      const { handler, sent } = makeHandler();
      const callback = handler.createCallback(
        asSessionId('gw-conv-9'),
        undefined,
        undefined,
      );

      const ac = new AbortController();
      const pending = callback(
        'Bash',
        { command: 'ls' },
        { signal: ac.signal, toolUseID: 'tool-early-response' },
      );

      await flushMicrotasks();
      const broadcast = sent.find(
        (m) => m.type === MESSAGE_TYPES.PERMISSION_REQUEST,
      );
      expect(broadcast).toBeDefined();
      const requestId = (
        broadcast!.payload as unknown as PermissionRequestPayload
      ).id;

      // The 60s unroutable deny timer is armed before the response arrives.
      expect(jest.getTimerCount()).toBe(1);

      handler.handleResponse(requestId, { id: requestId, decision: 'allow' });

      const result = await pending;
      expect(result).toMatchObject({ behavior: 'allow' });

      // clearTimer() ran as part of the resolve wrapper — no leaked timer.
      expect(jest.getTimerCount()).toBe(0);

      // Advancing past the original 60s window must not throw or re-resolve
      // (Promise settles once; a leaked timer would show up as a non-zero
      // getTimerCount() above, which is the load-bearing assertion here).
      await expect(
        jest.advanceTimersByTimeAsync(60_000),
      ).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});

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
