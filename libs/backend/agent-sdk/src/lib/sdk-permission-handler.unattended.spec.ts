/**
 * SdkPermissionHandler — unattended session policy (TASK_2026_584).
 *
 * A session registered in `UnattendedSessionPolicyRegistry` (an agent child
 * nobody is watching) gets the policy table and never an unbounded wait. An
 * unregistered session keeps the existing behaviour, pinned here alongside
 * the untouched `sdk-permission-handler.spec.ts`.
 */
import 'reflect-metadata';
import * as path from 'path';
import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

import { SdkPermissionHandler } from './sdk-permission-handler';
import {
  UnattendedSessionPolicyRegistry,
  type UnattendedSessionPolicy,
} from './permission/unattended-session-policy.registry';
import { SDK_TOKENS } from './di/tokens';
import type {
  CanUseTool,
  PermissionResult,
} from './types/sdk-types/claude-sdk.types';

const CHILD_TAB = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_TAB = '11111111-2222-4333-8444-555555555555';
const WRITABLE_ROOT = path.resolve('/root/.claude-worktrees/child');

interface SentMessage {
  type: string;
  payload: Record<string, unknown>;
}

type SessionIdParam = Parameters<SdkPermissionHandler['createCallback']>[0];
type TabIdParam = Parameters<SdkPermissionHandler['createCallback']>[2];
type CallbackOptions = Parameters<CanUseTool>[2];

function makePolicy(
  overrides: Partial<UnattendedSessionPolicy> = {},
): UnattendedSessionPolicy {
  return {
    bashAllowlist: ['git status', 'npm test'],
    writableRoot: WRITABLE_ROOT,
    denyWindowMs: 30_000,
    ownerLabel: 'the parent tab',
    ...overrides,
  };
}

function makeHarness(options: { delivered?: boolean } = {}) {
  const logger: MockLogger = createMockLogger();
  const sent: SentMessage[] = [];
  const webviewManager = {
    sendMessage: jest.fn(
      async (
        _viewType: string,
        type: string,
        payload: Record<string, unknown>,
      ) => {
        sent.push({ type, payload });
        return options.delivered ?? true;
      },
    ),
  };
  const subagentRegistry = {
    getToolCallIdByAgentId: jest.fn().mockReturnValue(null),
    get: jest.fn().mockReturnValue(undefined),
  };
  const registry = new UnattendedSessionPolicyRegistry();
  const handler = new SdkPermissionHandler(
    logger as unknown as Logger,
    subagentRegistry as unknown as ConstructorParameters<
      typeof SdkPermissionHandler
    >[1],
    webviewManager as unknown as ConstructorParameters<
      typeof SdkPermissionHandler
    >[2],
    registry,
  );

  const callbackFor = (tabId: string): CanUseTool =>
    handler.createCallback(
      tabId as SessionIdParam,
      undefined,
      tabId as TabIdParam,
      () => 'ask',
      tabId,
    );

  const permissionRequests = () =>
    sent.filter((m) => m.type === MESSAGE_TYPES.PERMISSION_REQUEST);

  return {
    handler,
    registry,
    sent,
    webviewManager,
    callbackFor,
    permissionRequests,
  };
}

async function invoke(
  callback: CanUseTool,
  toolName: string,
  input: Record<string, unknown>,
  signal: AbortSignal = new AbortController().signal,
): Promise<PermissionResult> {
  const result = await callback(toolName, input, {
    signal,
    toolUseID: `tool-${toolName}`,
    requestId: `tool-${toolName}`,
  } as unknown as CallbackOptions);
  if (result === null) {
    throw new Error(`canUseTool returned null for ${toolName}`);
  }
  return result;
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

function denyMessage(result: PermissionResult): string {
  expect(result.behavior).toBe('deny');
  return (result as { message: string }).message;
}

describe('SdkPermissionHandler — unattended session policy', () => {
  afterEach(() => {
    jest.useRealTimers();
    container.clearInstances();
  });

  describe('allowed without a prompt', () => {
    it.each([
      ['a safe tool', 'Read', { file_path: '/anywhere/x.ts' }],
      ['another safe tool', 'Grep', { pattern: 'x' }],
      ['ExitPlanMode', 'ExitPlanMode', { plan: 'p' }],
      ['Task', 'Task', { prompt: 'p' }],
      ['a Ptah MCP tool', 'mcp__ptah__ptah_agent_report', {}],
      [
        'Write inside the writable root',
        'Write',
        { file_path: path.join(WRITABLE_ROOT, 'src', 'a.ts'), content: 'x' },
      ],
      [
        'Edit with a relative path inside the root',
        'Edit',
        { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' },
      ],
      [
        'NotebookEdit inside the root',
        'NotebookEdit',
        { notebook_path: path.join(WRITABLE_ROOT, 'n.ipynb') },
      ],
      [
        'an allowlisted Bash command',
        'Bash',
        { command: 'git status --short' },
      ],
    ])('%s', async (_label, toolName, input) => {
      const h = makeHarness();
      h.registry.register(CHILD_TAB, makePolicy());

      const result = await invoke(h.callbackFor(CHILD_TAB), toolName, input);

      expect(result).toEqual({ behavior: 'allow', updatedInput: input });
      expect(h.permissionRequests()).toHaveLength(0);
    });
  });

  describe('denied at once', () => {
    it('EnterPlanMode: plan mode unavailable, no plan-mode event sent', async () => {
      const h = makeHarness();
      h.registry.register(CHILD_TAB, makePolicy());

      const result = await invoke(
        h.callbackFor(CHILD_TAB),
        'EnterPlanMode',
        {},
      );

      expect(denyMessage(result)).toMatch(/Plan mode is unavailable/);
      expect(denyMessage(result)).toContain(WRITABLE_ROOT);
      expect(result).toMatchObject({ interrupt: false });
      expect(h.sent).toHaveLength(0);
    });

    it('AskUserQuestion: decide, then tell the parent', async () => {
      const h = makeHarness();
      h.registry.register(CHILD_TAB, makePolicy());

      const result = await invoke(h.callbackFor(CHILD_TAB), 'AskUserQuestion', {
        questions: [],
      });

      expect(denyMessage(result)).toContain('ptah_agent_report');
      expect(result).toMatchObject({ interrupt: false });
      expect(h.sent).toHaveLength(0);
    });

    it('an out-of-policy call with deny window 0 is denied without a prompt', async () => {
      const h = makeHarness();
      h.registry.register(CHILD_TAB, makePolicy({ denyWindowMs: 0 }));

      const result = await invoke(h.callbackFor(CHILD_TAB), 'Bash', {
        command: 'rm -rf build',
      });

      expect(denyMessage(result)).toContain('"git status", "npm test"');
      expect(h.permissionRequests()).toHaveLength(0);
    });
  });

  describe('bounded prompt in the child tab', () => {
    it.each([
      [
        'Write outside the root',
        'Write',
        { file_path: path.resolve('/etc/passwd'), content: 'x' },
      ],
      [
        'Edit escaping with ..',
        'Edit',
        { file_path: '../other/a.ts', old_string: 'a', new_string: 'b' },
      ],
      ['Write without a path', 'Write', { content: 'x' }],
      ['a chained Bash command', 'Bash', { command: 'git status; rm -rf /' }],
      ['a Bash command not on the list', 'Bash', { command: 'curl evil' }],
      ['a foreign MCP tool', 'mcp__github__create_issue', {}],
      ['WebFetch', 'WebFetch', { url: 'https://example.com' }],
      ['WebSearch', 'WebSearch', { query: 'x' }],
      ['an unknown tool', 'SomethingNew', {}],
    ])(
      '%s: denied at denyWindowMs with the policy text',
      async (_l, toolName, input) => {
        jest.useFakeTimers();
        jest.setSystemTime(1_000_000);
        const h = makeHarness();
        h.registry.register(CHILD_TAB, makePolicy({ denyWindowMs: 30_000 }));

        const pending = invoke(h.callbackFor(CHILD_TAB), toolName, input);
        await flushMicrotasks();

        const requests = h.permissionRequests();
        expect(requests).toHaveLength(1);
        expect(requests[0].payload).toMatchObject({
          toolName,
          tabId: CHILD_TAB,
          sessionId: CHILD_TAB,
          timeoutAt: 1_000_000 + 30_000,
        });

        let settled = false;
        void pending.then(() => {
          settled = true;
        });
        jest.advanceTimersByTime(29_999);
        await flushMicrotasks();
        expect(settled).toBe(false);

        jest.advanceTimersByTime(1);
        const result = await pending;
        const message = denyMessage(result);
        expect(message).toContain('unattended agent session');
        expect(message).toContain('"git status", "npm test"');
        expect(message).toContain('ptah_agent_report');
        expect(message).toMatch(/timed out/);
        expect(result).toMatchObject({ interrupt: false });
      },
    );

    it('a human allow inside the window allows the call', async () => {
      const h = makeHarness();
      h.registry.register(CHILD_TAB, makePolicy());

      const input = { command: 'curl https://example.com' };
      const pending = invoke(h.callbackFor(CHILD_TAB), 'Bash', input);
      await flushMicrotasks();
      const id = h.permissionRequests()[0].payload['id'] as string;

      h.handler.handleResponse(id, { id, decision: 'allow' });

      await expect(pending).resolves.toEqual({
        behavior: 'allow',
        updatedInput: input,
      });
    });

    it('a human deny keeps the turn alive and points at the parent', async () => {
      const h = makeHarness();
      h.registry.register(CHILD_TAB, makePolicy());

      const pending = invoke(h.callbackFor(CHILD_TAB), 'WebFetch', {
        url: 'https://example.com',
      });
      await flushMicrotasks();
      const id = h.permissionRequests()[0].payload['id'] as string;
      h.handler.handleResponse(id, { id, decision: 'deny', reason: 'no' });

      const result = await pending;
      expect(denyMessage(result)).toContain('ptah_agent_report');
      expect(result).toMatchObject({ interrupt: false });
    });

    it('no webview: denied immediately, before the window', async () => {
      jest.useFakeTimers();
      const h = makeHarness({ delivered: false });
      h.registry.register(CHILD_TAB, makePolicy({ denyWindowMs: 600_000 }));

      const pending = invoke(h.callbackFor(CHILD_TAB), 'Bash', {
        command: 'curl evil',
      });
      await flushMicrotasks();

      const result = await pending;
      expect(denyMessage(result)).toMatch(/could not be delivered/);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('an abort keeps the existing aborted result', async () => {
      const h = makeHarness();
      h.registry.register(CHILD_TAB, makePolicy());
      const ac = new AbortController();

      const pending = invoke(
        h.callbackFor(CHILD_TAB),
        'Bash',
        { command: 'curl evil' },
        ac.signal,
      );
      await flushMicrotasks();
      ac.abort();

      await expect(pending).resolves.toMatchObject({
        behavior: 'deny',
        message: 'Permission request was aborted',
        interrupt: true,
      });
    });
  });

  describe('"Always Allow" rules', () => {
    it('are not consulted for a policy session', async () => {
      const h = makeHarness();
      // A normal session creates an "Always Allow" rule for Bash.
      const normal = invoke(h.callbackFor(OTHER_TAB), 'Bash', {
        command: 'ls',
      });
      await flushMicrotasks();
      const normalId = h.permissionRequests()[0].payload['id'] as string;
      h.handler.handleResponse(normalId, {
        id: normalId,
        decision: 'always_allow',
      });
      await normal;
      expect(h.handler.getPermissionRules()).toHaveLength(1);

      h.registry.register(CHILD_TAB, makePolicy({ denyWindowMs: 0 }));
      const result = await invoke(h.callbackFor(CHILD_TAB), 'Bash', {
        command: 'curl evil',
      });

      expect(result.behavior).toBe('deny');
    });

    it('do not auto-resolve a pending policy prompt as a sibling', async () => {
      const h = makeHarness();
      h.registry.register(CHILD_TAB, makePolicy());

      let childSettled = false;
      const child = invoke(h.callbackFor(CHILD_TAB), 'Bash', {
        command: 'curl evil',
      }).then((r) => {
        childSettled = true;
        return r;
      });
      await flushMicrotasks();
      const normal = invoke(h.callbackFor(OTHER_TAB), 'Bash', {
        command: 'ls',
      });
      await flushMicrotasks();

      const [childReq, normalReq] = h.permissionRequests();
      const normalId = normalReq.payload['id'] as string;
      h.handler.handleResponse(normalId, {
        id: normalId,
        decision: 'always_allow',
      });
      await normal;
      await flushMicrotasks();

      expect(childSettled).toBe(false);
      const childId = childReq.payload['id'] as string;
      h.handler.handleResponse(childId, { id: childId, decision: 'deny' });
      await expect(child).resolves.toMatchObject({ behavior: 'deny' });
    });
  });

  describe('unregistered sessions are unchanged', () => {
    it('a Bash call waits on an unbounded webview prompt (timeoutAt 0)', async () => {
      const h = makeHarness();
      h.registry.register(CHILD_TAB, makePolicy());
      const ac = new AbortController();

      const pending = invoke(
        h.callbackFor(OTHER_TAB),
        'Bash',
        { command: 'git status' },
        ac.signal,
      );
      await flushMicrotasks();

      expect(h.permissionRequests()[0].payload).toMatchObject({
        tabId: OTHER_TAB,
        timeoutAt: 0,
      });
      ac.abort();
      await pending;
    });

    it('EnterPlanMode is allowed and announced as before', async () => {
      const h = makeHarness();

      const result = await invoke(
        h.callbackFor(OTHER_TAB),
        'EnterPlanMode',
        {},
      );
      await flushMicrotasks();

      expect(result.behavior).toBe('allow');
      expect(h.sent.map((m) => m.type)).toContain(
        MESSAGE_TYPES.PLAN_MODE_CHANGED,
      );
    });

    it('a released policy no longer applies on the next call', async () => {
      const h = makeHarness();
      const release = h.registry.register(
        CHILD_TAB,
        makePolicy({ denyWindowMs: 0 }),
      );
      release();

      const result = await invoke(
        h.callbackFor(CHILD_TAB),
        'EnterPlanMode',
        {},
      );
      expect(result.behavior).toBe('allow');
    });
  });

  describe('container wiring (A7)', () => {
    function registerHandlerDeps(child: typeof container): void {
      child.registerInstance(TOKENS.LOGGER, createMockLogger());
      child.registerInstance(TOKENS.SUBAGENT_REGISTRY_SERVICE, {
        getToolCallIdByAgentId: jest.fn().mockReturnValue(null),
        get: jest.fn(),
      });
      child.registerInstance(TOKENS.WEBVIEW_MANAGER, {
        sendMessage: jest.fn().mockResolvedValue(true),
      });
    }

    it('a handler resolved from the container uses the registered registry', async () => {
      const child = container.createChildContainer();
      registerHandlerDeps(child);
      child.registerSingleton(
        SDK_TOKENS.SDK_UNATTENDED_SESSION_POLICY_REGISTRY,
        UnattendedSessionPolicyRegistry,
      );
      child.registerSingleton(
        SDK_TOKENS.SDK_PERMISSION_HANDLER,
        SdkPermissionHandler,
      );

      const handler = child.resolve<SdkPermissionHandler>(
        SDK_TOKENS.SDK_PERMISSION_HANDLER,
      );
      child
        .resolve<UnattendedSessionPolicyRegistry>(
          SDK_TOKENS.SDK_UNATTENDED_SESSION_POLICY_REGISTRY,
        )
        .register(CHILD_TAB, makePolicy());

      const result = await invoke(
        handler.createCallback(
          CHILD_TAB as SessionIdParam,
          undefined,
          CHILD_TAB as TabIdParam,
          () => 'ask',
          CHILD_TAB,
        ),
        'EnterPlanMode',
        {},
      );
      expect(result.behavior).toBe('deny');
    });

    it('a handler resolves without the registry registered', () => {
      const child = container.createChildContainer();
      registerHandlerDeps(child);
      child.registerSingleton(
        SDK_TOKENS.SDK_PERMISSION_HANDLER,
        SdkPermissionHandler,
      );

      expect(() =>
        child.resolve(SDK_TOKENS.SDK_PERMISSION_HANDLER),
      ).not.toThrow();
    });
  });
});
