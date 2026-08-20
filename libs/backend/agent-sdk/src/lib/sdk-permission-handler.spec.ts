import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { PermissionRequestSchema } from '@ptah-extension/shared/schemas';

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

  // TASK_2026_295: `if (sessionId)` sent '' down the no-arg branch, so a caller
  // that lost its id nuked every pending permission in the process — an
  // unrelated live session received a systemAbort deny, which the model reads
  // as the user refusing the tool.
  it('cleanupPendingPermissions - an empty sessionId must NOT take the global branch', async () => {
    const { handler } = makeHandler();

    const OTHER_SESSION = 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa';
    const callback = handler.createCallback(asSessionId(OTHER_SESSION));
    const pending = callback(
      'Bash',
      { command: 'ls' },
      {
        signal: new AbortController().signal,
        toolUseID: 'tool-empty-cleanup',
      },
    );

    await flushMicrotasks();

    handler.cleanupPendingPermissions('');
    await flushMicrotasks();

    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await flushMicrotasks();
    expect(settled).toBe(false);

    // The unrelated request is still live and still resolvable on its own terms.
    handler.cleanupPendingPermissions(OTHER_SESSION);
    await expect(pending).resolves.toMatchObject({ behavior: 'deny' });
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

      const result = (await pending) as unknown as DenyResult;
      expect(result.behavior).toBe('deny');

      // A timeout is a system abort, not a refusal — nobody ever saw the
      // prompt. interrupt:true is what makes the CLI swap in its canned
      // "the user doesn't want to take this action" string, which is how this
      // path used to read to the model as a deliberate deny (TASK_2026_247).
      expect(result.interrupt).toBe(false);
      expect(result.message).toMatch(/NOT a user decision/i);
      expect(result.message).not.toMatch(/denied by user/i);

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

  // TASK_2026_295: a CLI-agent request has no UUID session or tab, but
  // sendPermissionRequest routes it to the agent monitor panel by agentId, the
  // panel renders it, and the answer returns via agent:permissionResponse →
  // handleResponse(requestId) — a round trip that involves no session or tab.
  // Classifying it unroutable gave the user a real, visible prompt that
  // auto-denied itself after 60s.
  it('a CLI-agent request is routable: it goes to the agent monitor panel, outlives the 60s unroutable window, and stays answerable', async () => {
    jest.useFakeTimers();
    try {
      const { handler, sent } = makeHandler();
      const callback = handler.createCallback(
        // No UUID session id and no tabId — the parentless ptah-cli spawn.
        undefined,
        () => 'agent-cli-7',
        undefined,
      );

      const ac = new AbortController();
      const pending = callback(
        'Bash',
        { command: 'ls' },
        { signal: ac.signal, toolUseID: 'tool-cli-agent' },
      );

      await flushMicrotasks();

      const monitorMessage = sent.find(
        (m) => m.type === MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST,
      );
      if (!monitorMessage) {
        throw new Error(
          'expected an AGENT_MONITOR_PERMISSION_REQUEST to be sent',
        );
      }
      const agentPayload = monitorMessage.payload as unknown as {
        requestId: string;
        agentId: string;
        timeoutAt: number;
      };
      expect(agentPayload.agentId).toBe('agent-cli-7');
      // Bounded, not infinite: `timeoutAt` is a real future instant, and the
      // ceiling is far beyond the 60s unroutable window this route used to be
      // wrongly charged.
      expect(agentPayload.timeoutAt).toBeGreaterThan(Date.now() + 60_000);
      expect(jest.getTimerCount()).toBe(1);

      // The Wave 1 invariant, unchanged: 60s must NOT auto-deny this prompt.
      // The user is looking at a real card and gets to answer it.
      await jest.advanceTimersByTimeAsync(120_000);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await flushMicrotasks();
      expect(settled).toBe(false);

      // And the user's eventual answer still resolves it, keyed on requestId
      // alone — the path agent:permissionResponse takes.
      handler.handleResponse(agentPayload.requestId, {
        id: agentPayload.requestId,
        decision: 'allow',
      });

      const result = (await pending) as unknown as { behavior: string };
      expect(result.behavior).toBe('allow');

      ac.abort();
    } finally {
      jest.useRealTimers();
    }
  });

  // TASK_2026_295 Wave 2: making the CLI-agent route "routable" also handed it
  // `timeoutAt = 0` and no timer, i.e. an unbounded wait. The only remaining net
  // was the `delivered === false` branch, which is a TRANSPORT check —
  // `postMessage` succeeding reports `delivered: true` even when
  // `AgentMonitorStore.onPermissionRequest` parks the prompt in
  // `_pendingPermissionBuffer` because the agent card has not spawned. That
  // buffer has no TTL and is drained only by the matching `onAgentSpawned`, so a
  // crash or webview reload between `setAgentId()` and that event left the SDK
  // stream stalled on a tool call forever. Bounded failure beats unbounded.
  it('a CLI-agent request whose card never appears is denied at the ceiling instead of waiting forever', async () => {
    jest.useFakeTimers();
    try {
      const { handler, logger } = makeHandler();
      const callback = handler.createCallback(
        undefined,
        () => 'agent-cli-orphan',
        undefined,
      );

      const ac = new AbortController();
      const pending = callback(
        'Bash',
        { command: 'ls' },
        { signal: ac.signal, toolUseID: 'tool-cli-orphan' },
      );

      await flushMicrotasks();

      // Nobody ever answers — the card was buffered and never drained.
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);

      const result = (await pending) as unknown as DenyResult;
      expect(result.behavior).toBe('deny');
      // A timeout is a system abort, not a refusal — same contract as the
      // unroutable window, so the model is not told the user objected.
      expect(result.interrupt).toBe(false);
      expect(result.message).toMatch(/NOT a user decision/i);

      const warnedTimeout = (logger.warn as jest.Mock).mock.calls.some((call) =>
        String(call[0]).toLowerCase().includes('timed out'),
      );
      expect(warnedTimeout).toBe(true);

      const internal = handler as unknown as {
        pendingRequests: Map<string, unknown>;
        pendingRequestContext: Map<string, unknown>;
      };
      expect(internal.pendingRequests.size).toBe(0);
      expect(internal.pendingRequestContext.size).toBe(0);

      ac.abort();
    } finally {
      jest.useRealTimers();
    }
  });

  it('emits prompt lifecycle events with the raw routing hint: requested (unroutable, 60s) then resolved timed-out (TASK_2026_271 #1)', async () => {
    jest.useFakeTimers();
    try {
      const { handler } = makeHandler();
      const seen: Array<Record<string, unknown>> = [];
      const unsubscribe = handler.onPromptLifecycle((e) => {
        seen.push(e as unknown as Record<string, unknown>);
      });
      const callback = handler.createCallback(
        undefined,
        undefined,
        undefined,
        undefined,
        'gw-conv-9',
      );

      const ac = new AbortController();
      const pending = callback(
        'Write',
        { file_path: '/tmp/a', content: 'x' },
        { signal: ac.signal, toolUseID: 'tool-lc' },
      );
      await flushMicrotasks();

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        phase: 'requested',
        routingHint: 'gw-conv-9',
        toolName: 'Write',
        routable: false,
        timeoutMs: 60_000,
      });

      await jest.advanceTimersByTimeAsync(60_000);
      await pending;

      expect(seen).toHaveLength(2);
      expect(seen[1]).toMatchObject({
        phase: 'resolved',
        routingHint: 'gw-conv-9',
        toolName: 'Write',
        outcome: 'timed-out',
      });
      expect(seen[1]['requestId']).toBe(seen[0]['requestId']);

      unsubscribe();
      ac.abort();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a routable prompt answered allow emits requested (routable, no timeout) then resolved allowed', async () => {
    const { handler, sent } = makeHandler();
    const seen: Array<Record<string, unknown>> = [];
    handler.onPromptLifecycle((e) => {
      seen.push(e as unknown as Record<string, unknown>);
    });
    const TAB_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const callback = handler.createCallback(
      asSessionId(TAB_ID),
      undefined,
      asTabId(TAB_ID),
      undefined,
      TAB_ID,
    );
    const ac = new AbortController();
    const pending = callback(
      'Bash',
      { command: 'ls' },
      { signal: ac.signal, toolUseID: 'tool-lc2' },
    );
    await flushMicrotasks();
    const requestId = (
      sent.find((m) => m.type === MESSAGE_TYPES.PERMISSION_REQUEST)!
        .payload as unknown as PermissionRequestPayload
    ).id;
    expect(seen[0]).toMatchObject({ phase: 'requested', routable: true });
    expect(seen[0]['timeoutMs']).toBeUndefined();

    handler.handleResponse(requestId, { id: requestId, decision: 'allow' });
    await pending;
    expect(seen[1]).toMatchObject({ phase: 'resolved', outcome: 'allowed' });
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

// ===========================================================================
// TASK_2026_247 — a system abort must not launder itself as a user denial.
//
// Both halves are asserted in contrast, because the whole defect is that the
// two were INDISTINGUISHABLE at the tool-result layer: a teardown-deny and a
// human deny produced byte-identical `{ behavior: 'deny', interrupt: true }`,
// so the CLI substituted its canned "The user doesn't want to take this action
// right now. STOP what you are doing..." string and the agent stopped working.
// Asserting only one side cannot tell them apart and would not catch that.
// ===========================================================================

interface DenyResult {
  behavior: string;
  message?: string;
  interrupt?: boolean;
}

describe('SdkPermissionHandler - system abort vs user deny mapping', () => {
  afterEach(() => {
    container.clearInstances();
    jest.clearAllMocks();
  });

  const TAB_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const SESSION_UUID = '11111111-2222-4333-8444-555555555555';

  function startRequest(handler: SdkPermissionHandler, sent: SentMessage[]) {
    const callback = handler.createCallback(
      asSessionId(SESSION_UUID),
      undefined,
      asTabId(TAB_ID),
    );
    return callback(
      'Bash',
      { command: 'ls' },
      {
        signal: new AbortController().signal,
        toolUseID: `tool-${sent.length}`,
      },
    );
  }

  function requestIdOf(sent: SentMessage[]): string {
    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.PERMISSION_REQUEST,
    );
    expect(broadcast).toBeDefined();
    return (broadcast!.payload as unknown as PermissionRequestPayload).id;
  }

  it('a system-aborted request yields interrupt:false and a message that says it was NOT a user decision', async () => {
    const { handler, sent } = makeHandler();
    const pending = startRequest(handler, sent);
    await flushMicrotasks();

    // Teardown path — nobody clicked anything.
    handler.cleanupPendingPermissions(TAB_ID);

    const result = (await pending) as unknown as DenyResult;

    expect(result.behavior).toBe('deny');

    // interrupt:true is what makes the CLI swap in its canned user-denial
    // string. A system abort MUST NOT take that path.
    expect(result.interrupt).toBe(false);

    // The message must state, in words that reach the model, that no human
    // decided this and that the operation is retryable.
    expect(result.message).toMatch(/NOT a user decision/i);
    expect(result.message).toMatch(/retried/i);

    // And it must not read as a refusal.
    expect(result.message).not.toMatch(/denied by user/i);
  });

  it('a genuine user deny still yields interrupt:true and the user’s own reason', async () => {
    const { handler, sent } = makeHandler();
    const pending = startRequest(handler, sent);
    await flushMicrotasks();

    const requestId = requestIdOf(sent);
    handler.handleResponse(requestId, {
      id: requestId,
      decision: 'deny',
      reason: 'I do not want you running shell commands here',
    });

    const result = (await pending) as unknown as DenyResult;

    expect(result.behavior).toBe('deny');
    // A real refusal keeps the hard-stop semantics — the agent SHOULD stop.
    expect(result.interrupt).toBe(true);
    expect(result.message).toBe(
      'I do not want you running shell commands here',
    );
    // It must NOT be relabelled as a system abort.
    expect(result.message).not.toMatch(/NOT a user decision/i);
  });

  it('the global (no-arg) cleanup also marks its denials as system aborts', async () => {
    const { handler, sent } = makeHandler();
    const pending = startRequest(handler, sent);
    await flushMicrotasks();

    handler.cleanupPendingPermissions();

    const result = (await pending) as unknown as DenyResult;
    expect(result.behavior).toBe('deny');
    expect(result.interrupt).toBe(false);
    expect(result.message).toMatch(/NOT a user decision/i);
  });
});
