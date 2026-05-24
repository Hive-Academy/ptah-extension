/**
 * Unit tests for `SessionSubmitService` — Phase 3 of TASK_2026_128.
 *
 * Coverage:
 *   1. `dispatch` rejects malformed args with `mcp_invalid_tool_args`.
 *   2. `dispatch` invokes `transport.call('chat:start', ...)` with the
 *      Team-Leader prompt + a generated tabId + cwd fallback.
 *   3. `dispatch` includes the optional `profile` preset in `chat:start`
 *      options when provided.
 *   4. Forwarded `chat:chunk` events surface as `notifications/message`,
 *      and `notifications/progress` when a progressToken is present.
 *   5. `chat:complete` resolves the MCP result with aggregated `text_delta`
 *      content + structured `{ tabId, sessionId }`.
 *   6. `chat:error` resolves the MCP result with `isError: true` and the
 *      backend error message.
 *   7. `cancel({ requestId })` aborts the in-flight call AND triggers
 *      `transport.call('chat:abort', ...)`.
 *   8. Inbound `chat:start` failure (ack.success === false) settles the
 *      MCP result with `isError: true` / `mcp_tool_failed`.
 *
 * Architecture note: this service is the SOLE CLI-side site of
 * `transport.call('chat:start', ...)` for the `session_submit` MCP tool.
 * The hexagonal contract requires the chat:start invocation to live here
 * (in `apps/ptah-cli/`), NOT in `libs/backend/vscode-lm-tools/`. The lib's
 * `ISessionSubmitHandler` port lets the lib advertise the tool without
 * importing CLI internals.
 */

import { EventEmitter } from 'node:events';

import {
  SESSION_SUBMIT_DEFAULT_TIMEOUT_MS,
  SessionSubmitService,
  buildSessionSubmitPrompt,
  type McpNotifier,
} from './session-submit.service.js';
import type { Logger } from '@ptah-extension/vscode-core';
import type { MCPRequest } from '@ptah-extension/vscode-lm-tools';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import type { CliWebviewManagerAdapter } from '../../transport/cli-webview-manager-adapter.js';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

interface Harness {
  transport: jest.Mocked<Pick<CliMessageTransport, 'call'>>;
  pushAdapter: EventEmitter;
  notifier: jest.Mocked<McpNotifier>;
  service: SessionSubmitService;
}

interface FakeTimer {
  fire: () => void;
  cleared: boolean;
}

interface HarnessOverrides {
  ackSuccess?: boolean;
  ackError?: string;
  /** Pass 0 to disable the timeout (default for legacy tests). */
  timeoutMs?: number;
  /** When true, expose a controllable fake timer instead of real setTimeout. */
  fakeTimer?: boolean;
}

interface HarnessWithTimer extends Harness {
  fireTimer: () => void;
  isTimerCleared: () => boolean;
}

function makeHarness(overrides: HarnessOverrides = {}): HarnessWithTimer {
  const transport = {
    call: jest.fn().mockResolvedValue({
      success: overrides.ackSuccess ?? true,
      ...(overrides.ackError ? { error: overrides.ackError } : {}),
    }),
  } as unknown as jest.Mocked<Pick<CliMessageTransport, 'call'>>;
  const pushAdapter = new EventEmitter();
  pushAdapter.setMaxListeners(50);
  const notifier = { notify: jest.fn().mockResolvedValue(undefined) };
  let timer: FakeTimer | undefined;
  const setTimeoutImpl = overrides.fakeTimer
    ? (handler: () => void): ReturnType<typeof setTimeout> => {
        const fake: FakeTimer = { fire: handler, cleared: false };
        timer = fake;
        return fake as unknown as ReturnType<typeof setTimeout>;
      }
    : undefined;
  const clearTimeoutImpl = overrides.fakeTimer
    ? (handle: ReturnType<typeof setTimeout>): void => {
        const fake = handle as unknown as FakeTimer;
        fake.cleared = true;
      }
    : undefined;
  const service = new SessionSubmitService({
    transport: transport as unknown as CliMessageTransport,
    pushAdapter: pushAdapter as unknown as CliWebviewManagerAdapter,
    notifier,
    logger: makeLogger(),
    cwd: 'D:/test-workspace',
    randomId: (() => {
      let n = 0;
      return (): string => `tab-${++n}`;
    })(),
    timeoutMs: overrides.timeoutMs ?? 0,
    setTimeoutImpl,
    clearTimeoutImpl,
  });
  return {
    transport,
    pushAdapter,
    notifier,
    service,
    fireTimer: (): void => {
      if (timer === undefined) {
        throw new Error('fake timer was never armed');
      }
      timer.fire();
    },
    isTimerCleared: (): boolean => timer?.cleared ?? false,
  };
}

function makeRequest(
  overrides: Partial<MCPRequest> & { progressToken?: string | number } = {},
): MCPRequest {
  const { progressToken, ...rest } = overrides;
  const params: Record<string, unknown> = {
    name: 'session_submit',
    arguments: { task: 'do the thing' },
  };
  if (progressToken !== undefined) {
    params['_meta'] = { progressToken };
  }
  return {
    jsonrpc: '2.0',
    id: 'req-1',
    method: 'tools/call',
    params,
    ...rest,
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

describe('SessionSubmitService', () => {
  describe('input validation', () => {
    it('rejects empty task with mcp_invalid_tool_args', async () => {
      const h = makeHarness();
      const resp = await h.service.dispatch(makeRequest(), { task: '' });
      const result = resp.result as {
        isError: boolean;
        structuredContent: { ptah_code: string };
      };
      expect(result.isError).toBe(true);
      expect(result.structuredContent.ptah_code).toBe('mcp_invalid_tool_args');
      expect(h.transport.call).not.toHaveBeenCalled();
    });

    it('rejects unknown profile value with mcp_invalid_tool_args', async () => {
      const h = makeHarness();
      const resp = await h.service.dispatch(makeRequest(), {
        task: 'do it',
        profile: 'weird',
      });
      const result = resp.result as {
        isError: boolean;
        structuredContent: { ptah_code: string };
      };
      expect(result.isError).toBe(true);
      expect(result.structuredContent.ptah_code).toBe('mcp_invalid_tool_args');
    });
  });

  describe('chat:start invocation', () => {
    it('invokes transport.call("chat:start") with Team Leader prompt + tabId', async () => {
      const h = makeHarness();
      const promise = h.service.dispatch(makeRequest(), {
        task: 'plan things',
      });
      await flush();
      expect(h.transport.call).toHaveBeenCalledWith(
        'chat:start',
        expect.objectContaining({
          tabId: 'tab-1',
          workspacePath: 'D:/test-workspace',
        }),
      );
      const call = h.transport.call.mock.calls[0][1] as { prompt: string };
      expect(call.prompt).toContain('## Task description');
      expect(call.prompt).toContain('## Implementation plan');
      expect(call.prompt).toContain('plan things');
      expect(call.prompt).toContain(
        'coordinating execution of a pre-planned task',
      );
      expect(call.prompt).toContain('MCP host');
      // Resolve so the promise settles.
      h.pushAdapter.emit('chat:complete', { tabId: 'tab-1' });
      await promise;
    });

    it('honors args.cwd over the default workspace path', async () => {
      const h = makeHarness();
      const promise = h.service.dispatch(makeRequest(), {
        task: 'plan things',
        cwd: 'D:/custom-cwd',
      });
      await flush();
      expect(h.transport.call).toHaveBeenCalledWith(
        'chat:start',
        expect.objectContaining({ workspacePath: 'D:/custom-cwd' }),
      );
      h.pushAdapter.emit('chat:complete', { tabId: 'tab-1' });
      await promise;
    });

    it('forwards profile preset when provided', async () => {
      const h = makeHarness();
      const promise = h.service.dispatch(makeRequest(), {
        task: 'plan things',
        profile: 'enhanced',
      });
      await flush();
      const call = h.transport.call.mock.calls[0][1] as {
        options?: { preset?: string };
      };
      expect(call.options?.preset).toBe('enhanced');
      h.pushAdapter.emit('chat:complete', { tabId: 'tab-1' });
      await promise;
    });

    it('builds Team Leader prompt with sub-agent directive when allowSubagents is true', () => {
      const prompt = buildSessionSubmitPrompt('do something', true);
      expect(prompt).toContain('Use the Task tool to fan out');
    });

    it('builds Team Leader prompt forbidding sub-agents when allowSubagents is false', () => {
      const prompt = buildSessionSubmitPrompt('do something', false);
      expect(prompt).toContain('Do NOT spawn sub-agents');
    });
  });

  describe('event forwarding', () => {
    it('forwards matching chat:chunk events as notifications/message', async () => {
      const h = makeHarness();
      const promise = h.service.dispatch(makeRequest(), { task: 'go' });
      await flush();
      h.pushAdapter.emit('chat:chunk', {
        tabId: 'tab-1',
        event: { eventType: 'agent.thought', delta: 'thinking...' },
      });
      await flush();
      expect(h.notifier.notify).toHaveBeenCalledWith(
        'notifications/message',
        expect.objectContaining({
          level: 'info',
          data: expect.objectContaining({
            kind: 'agent.thought',
            tabId: 'tab-1',
          }),
        }),
      );
      h.pushAdapter.emit('chat:complete', { tabId: 'tab-1' });
      await promise;
    });

    it('ignores chat:chunk events for other tabIds', async () => {
      const h = makeHarness();
      const promise = h.service.dispatch(makeRequest(), { task: 'go' });
      await flush();
      h.pushAdapter.emit('chat:chunk', {
        tabId: 'other-tab',
        event: { eventType: 'agent.thought', delta: 'thinking...' },
      });
      await flush();
      expect(h.notifier.notify).not.toHaveBeenCalledWith(
        'notifications/message',
        expect.anything(),
      );
      h.pushAdapter.emit('chat:complete', { tabId: 'tab-1' });
      await promise;
    });

    it('emits notifications/progress when progressToken provided', async () => {
      const h = makeHarness();
      const promise = h.service.dispatch(
        makeRequest({ progressToken: 'pt-1' }),
        { task: 'go' },
      );
      await flush();
      h.pushAdapter.emit('chat:chunk', {
        tabId: 'tab-1',
        event: { eventType: 'text_delta', delta: 'hello ' },
      });
      await flush();
      expect(h.notifier.notify).toHaveBeenCalledWith(
        'notifications/progress',
        expect.objectContaining({ progressToken: 'pt-1' }),
      );
      h.pushAdapter.emit('chat:complete', { tabId: 'tab-1' });
      await promise;
    });

    it('does not emit notifications/progress when progressToken missing', async () => {
      const h = makeHarness();
      const promise = h.service.dispatch(makeRequest(), { task: 'go' });
      await flush();
      h.pushAdapter.emit('chat:chunk', {
        tabId: 'tab-1',
        event: { eventType: 'text_delta', delta: 'hello' },
      });
      await flush();
      const progressCalls = h.notifier.notify.mock.calls.filter(
        ([m]) => m === 'notifications/progress',
      );
      expect(progressCalls).toHaveLength(0);
      h.pushAdapter.emit('chat:complete', { tabId: 'tab-1' });
      await promise;
    });
  });

  describe('settlement', () => {
    it('resolves with aggregated text on chat:complete', async () => {
      const h = makeHarness();
      const promise = h.service.dispatch(makeRequest(), { task: 'go' });
      await flush();
      h.pushAdapter.emit('chat:chunk', {
        tabId: 'tab-1',
        event: { eventType: 'message_start', sessionId: 'sess-real' },
      });
      h.pushAdapter.emit('chat:chunk', {
        tabId: 'tab-1',
        event: { eventType: 'text_delta', delta: 'hello ' },
      });
      h.pushAdapter.emit('chat:chunk', {
        tabId: 'tab-1',
        event: { eventType: 'text_delta', delta: 'world' },
      });
      h.pushAdapter.emit('chat:complete', { tabId: 'tab-1' });
      const resp = await promise;
      const result = resp.result as {
        isError?: boolean;
        content: { text: string }[];
        structuredContent: { tabId: string; sessionId: string };
      };
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe('hello world');
      expect(result.structuredContent.tabId).toBe('tab-1');
      expect(result.structuredContent.sessionId).toBe('sess-real');
    });

    it('settles with isError:true on chat:error', async () => {
      const h = makeHarness();
      const promise = h.service.dispatch(makeRequest(), { task: 'go' });
      await flush();
      h.pushAdapter.emit('chat:error', {
        tabId: 'tab-1',
        error: 'sdk crashed',
      });
      const resp = await promise;
      const result = resp.result as {
        isError: boolean;
        structuredContent: { ptah_code: string };
        content: { text: string }[];
      };
      expect(result.isError).toBe(true);
      expect(result.structuredContent.ptah_code).toBe('mcp_tool_failed');
      expect(result.content[0].text).toContain('sdk crashed');
    });

    it('settles with mcp_tool_failed when chat:start ack fails', async () => {
      const h = makeHarness({ ackSuccess: false, ackError: 'auth required' });
      const resp = await h.service.dispatch(makeRequest(), { task: 'go' });
      const result = resp.result as {
        isError: boolean;
        structuredContent: { ptah_code: string };
        content: { text: string }[];
      };
      expect(result.isError).toBe(true);
      expect(result.structuredContent.ptah_code).toBe('mcp_tool_failed');
      expect(result.content[0].text).toContain('auth required');
    });

    it('detaches push adapter listeners after settlement', async () => {
      const h = makeHarness();
      const before = h.pushAdapter.listenerCount('chat:chunk');
      const promise = h.service.dispatch(makeRequest(), { task: 'go' });
      await flush();
      expect(h.pushAdapter.listenerCount('chat:chunk')).toBe(before + 1);
      h.pushAdapter.emit('chat:complete', { tabId: 'tab-1' });
      await promise;
      expect(h.pushAdapter.listenerCount('chat:chunk')).toBe(before);
    });
  });

  describe('cost notification surface (Phase 4)', () => {
    const ORIGINAL_ENV = process.env['PTAH_MCP_HOST_SESSION_ID'];

    afterEach(() => {
      if (ORIGINAL_ENV === undefined) {
        delete process.env['PTAH_MCP_HOST_SESSION_ID'];
      } else {
        process.env['PTAH_MCP_HOST_SESSION_ID'] = ORIGINAL_ENV;
      }
    });

    it('forwards session:cost events with mcpHostSessionId envelope', async () => {
      process.env['PTAH_MCP_HOST_SESSION_ID'] = 'mcp-host-1';
      const h = makeHarness();
      const promise = h.service.dispatch(makeRequest(), { task: 'go' });
      await flush();
      h.pushAdapter.emit('session:cost', {
        session_id: 'tab-1',
        turn_id: 'turn-1',
        delta_usd: 0.0125,
        total_usd: 0.0125,
      });
      await flush();
      const costCall = h.notifier.notify.mock.calls.find(
        ([m, params]) =>
          m === 'notifications/message' &&
          (params as { data: { kind: string } }).data.kind === 'session.cost',
      );
      expect(costCall).toBeDefined();
      const data = (
        costCall as unknown as [string, { data: Record<string, unknown> }]
      )[1].data;
      expect(data['kind']).toBe('session.cost');
      expect(data['mcpHostSessionId']).toBe('mcp-host-1');
      expect(data['deltaUsd']).toBe(0.0125);
      expect(data['totalUsd']).toBe(0.0125);
      expect(data['turnId']).toBe('turn-1');
      h.pushAdapter.emit('chat:complete', { tabId: 'tab-1' });
      await promise;
    });

    it('emits mcp.session.summary on chat:complete with aggregated cost', async () => {
      process.env['PTAH_MCP_HOST_SESSION_ID'] = 'mcp-host-2';
      const h = makeHarness();
      const promise = h.service.dispatch(makeRequest(), { task: 'go' });
      await flush();
      h.pushAdapter.emit('session:cost', {
        session_id: 'tab-1',
        total_usd: 0.05,
      });
      h.pushAdapter.emit('session:tokens', {
        session_id: 'tab-1',
        total_input_tokens: 100,
        total_output_tokens: 250,
      });
      h.pushAdapter.emit('chat:chunk', {
        tabId: 'tab-1',
        event: { eventType: 'agent.tool_use', toolName: 'Read' },
      });
      h.pushAdapter.emit('chat:chunk', {
        tabId: 'tab-1',
        event: { eventType: 'agent.tool_use', toolName: 'Edit' },
      });
      h.pushAdapter.emit('chat:complete', { tabId: 'tab-1' });
      await promise;
      const summaryCall = h.notifier.notify.mock.calls.find(
        ([m, params]) =>
          m === 'notifications/message' &&
          (params as { data: { kind: string } }).data.kind ===
            'mcp.session.summary',
      );
      expect(summaryCall).toBeDefined();
      const data = (
        summaryCall as unknown as [string, { data: Record<string, unknown> }]
      )[1].data;
      expect(data['totalUsd']).toBe(0.05);
      expect(data['inputTokens']).toBe(100);
      expect(data['outputTokens']).toBe(250);
      expect(data['totalTokens']).toBe(350);
      expect(data['toolCallCount']).toBe(2);
      expect(data['mcpHostSessionId']).toBe('mcp-host-2');
    });

    it('ignores session:cost for unrelated sessions', async () => {
      const h = makeHarness();
      const promise = h.service.dispatch(makeRequest(), { task: 'go' });
      await flush();
      h.pushAdapter.emit('session:cost', {
        session_id: 'some-other-session',
        total_usd: 99,
      });
      await flush();
      const costCalls = h.notifier.notify.mock.calls.filter(
        ([m, params]) =>
          m === 'notifications/message' &&
          (params as { data: { kind: string } }).data.kind === 'session.cost',
      );
      expect(costCalls).toHaveLength(0);
      h.pushAdapter.emit('chat:complete', { tabId: 'tab-1' });
      await promise;
    });

    it('emits mcp.session.summary with null mcpHostSessionId when env unset', async () => {
      delete process.env['PTAH_MCP_HOST_SESSION_ID'];
      const h = makeHarness();
      const promise = h.service.dispatch(makeRequest(), { task: 'go' });
      await flush();
      h.pushAdapter.emit('chat:complete', { tabId: 'tab-1' });
      await promise;
      const summaryCall = h.notifier.notify.mock.calls.find(
        ([m, params]) =>
          m === 'notifications/message' &&
          (params as { data: { kind: string } }).data.kind ===
            'mcp.session.summary',
      );
      expect(summaryCall).toBeDefined();
      const data = (
        summaryCall as unknown as [string, { data: Record<string, unknown> }]
      )[1].data;
      expect(data['mcpHostSessionId']).toBeNull();
    });

    it('detaches session:cost and session:tokens listeners on settlement', async () => {
      const h = makeHarness();
      const baseCost = h.pushAdapter.listenerCount('session:cost');
      const baseTokens = h.pushAdapter.listenerCount('session:tokens');
      const promise = h.service.dispatch(makeRequest(), { task: 'go' });
      await flush();
      expect(h.pushAdapter.listenerCount('session:cost')).toBe(baseCost + 1);
      expect(h.pushAdapter.listenerCount('session:tokens')).toBe(
        baseTokens + 1,
      );
      h.pushAdapter.emit('chat:complete', { tabId: 'tab-1' });
      await promise;
      expect(h.pushAdapter.listenerCount('session:cost')).toBe(baseCost);
      expect(h.pushAdapter.listenerCount('session:tokens')).toBe(baseTokens);
    });
  });

  describe('cancellation', () => {
    it('aborts the in-flight call and issues chat:abort', async () => {
      const h = makeHarness();
      const promise = h.service.dispatch(makeRequest(), { task: 'go' });
      await flush();
      await h.service.cancel({ requestId: 'req-1' });
      const resp = await promise;
      expect(h.transport.call).toHaveBeenCalledWith(
        'chat:abort',
        expect.objectContaining({ sessionId: 'tab-1' }),
      );
      const result = resp.result as {
        isError: boolean;
        structuredContent: { ptah_code: string; cancelled?: boolean };
      };
      expect(result.isError).toBe(true);
      expect(result.structuredContent.ptah_code).toBe('mcp_tool_cancelled');
      expect(result.structuredContent.cancelled).toBe(true);
    });

    it('is a no-op for unknown requestIds', async () => {
      const h = makeHarness();
      await expect(
        h.service.cancel({ requestId: 'never-seen' }),
      ).resolves.toBeUndefined();
      expect(h.transport.call).not.toHaveBeenCalled();
    });
  });

  describe('per-call timeout', () => {
    it('exports a sensible default timeout (15 minutes)', () => {
      expect(SESSION_SUBMIT_DEFAULT_TIMEOUT_MS).toBe(15 * 60 * 1000);
    });

    it('settles with session_submit_timeout when timer fires before chat:complete', async () => {
      const h = makeHarness({ timeoutMs: 60_000, fakeTimer: true });
      const promise = h.service.dispatch(makeRequest(), { task: 'go' });
      await flush();
      // chat:start succeeded but no chat:complete arrives — fire the timer.
      h.fireTimer();
      const resp = await promise;
      const result = resp.result as {
        isError: boolean;
        structuredContent: { ptah_code: string; timeoutMs: number };
        content: { text: string }[];
      };
      expect(result.isError).toBe(true);
      expect(result.structuredContent.ptah_code).toBe('session_submit_timeout');
      expect(result.structuredContent.timeoutMs).toBe(60_000);
      expect(result.content[0].text).toContain('timed out');
    });

    it('triggers chat:abort when the timer fires', async () => {
      const h = makeHarness({ timeoutMs: 60_000, fakeTimer: true });
      const promise = h.service.dispatch(makeRequest(), { task: 'go' });
      await flush();
      h.fireTimer();
      await promise;
      expect(h.transport.call).toHaveBeenCalledWith(
        'chat:abort',
        expect.objectContaining({ sessionId: 'tab-1' }),
      );
    });

    it('clears the timer on normal chat:complete settlement', async () => {
      const h = makeHarness({ timeoutMs: 60_000, fakeTimer: true });
      const promise = h.service.dispatch(makeRequest(), { task: 'go' });
      await flush();
      h.pushAdapter.emit('chat:complete', { tabId: 'tab-1' });
      await promise;
      expect(h.isTimerCleared()).toBe(true);
    });

    it('detaches all push adapter listeners after timeout', async () => {
      const h = makeHarness({ timeoutMs: 60_000, fakeTimer: true });
      const baseChunk = h.pushAdapter.listenerCount('chat:chunk');
      const baseComplete = h.pushAdapter.listenerCount('chat:complete');
      const baseError = h.pushAdapter.listenerCount('chat:error');
      const baseCost = h.pushAdapter.listenerCount('session:cost');
      const baseTokens = h.pushAdapter.listenerCount('session:tokens');
      const promise = h.service.dispatch(makeRequest(), { task: 'go' });
      await flush();
      h.fireTimer();
      await promise;
      expect(h.pushAdapter.listenerCount('chat:chunk')).toBe(baseChunk);
      expect(h.pushAdapter.listenerCount('chat:complete')).toBe(baseComplete);
      expect(h.pushAdapter.listenerCount('chat:error')).toBe(baseError);
      expect(h.pushAdapter.listenerCount('session:cost')).toBe(baseCost);
      expect(h.pushAdapter.listenerCount('session:tokens')).toBe(baseTokens);
      expect(h.service.inFlightCount()).toBe(0);
    });

    it('does not arm the timer when timeoutMs is 0', async () => {
      const h = makeHarness({ timeoutMs: 0, fakeTimer: true });
      const promise = h.service.dispatch(makeRequest(), { task: 'go' });
      await flush();
      expect(() => h.fireTimer()).toThrow('fake timer was never armed');
      h.pushAdapter.emit('chat:complete', { tabId: 'tab-1' });
      await promise;
    });
  });

  describe('disposeAll', () => {
    it('settles every outstanding call with mcp_tool_failed/disposed', async () => {
      const h = makeHarness({ timeoutMs: 0 });
      const promise = h.service.dispatch(makeRequest(), { task: 'go' });
      await flush();
      expect(h.service.inFlightCount()).toBe(1);
      h.service.disposeAll();
      const resp = await promise;
      const result = resp.result as {
        isError: boolean;
        structuredContent: { ptah_code: string; disposed?: boolean };
        content: { text: string }[];
      };
      expect(result.isError).toBe(true);
      expect(result.structuredContent.ptah_code).toBe('mcp_tool_failed');
      expect(result.structuredContent.disposed).toBe(true);
      expect(result.content[0].text).toContain('shutting down');
      expect(h.service.inFlightCount()).toBe(0);
    });

    it('detaches all push adapter listeners after disposeAll', async () => {
      const h = makeHarness({ timeoutMs: 0 });
      const baseChunk = h.pushAdapter.listenerCount('chat:chunk');
      const baseComplete = h.pushAdapter.listenerCount('chat:complete');
      const promise = h.service.dispatch(makeRequest(), { task: 'go' });
      await flush();
      h.service.disposeAll();
      await promise;
      expect(h.pushAdapter.listenerCount('chat:chunk')).toBe(baseChunk);
      expect(h.pushAdapter.listenerCount('chat:complete')).toBe(baseComplete);
    });

    it('is a no-op when nothing is in flight', () => {
      const h = makeHarness({ timeoutMs: 0 });
      expect(() => h.service.disposeAll()).not.toThrow();
      expect(h.service.inFlightCount()).toBe(0);
    });

    it('handles multiple concurrent in-flight calls', async () => {
      const h = makeHarness({ timeoutMs: 0 });
      const promise1 = h.service.dispatch(makeRequest({ id: 'r-1' }), {
        task: 'one',
      });
      const promise2 = h.service.dispatch(makeRequest({ id: 'r-2' }), {
        task: 'two',
      });
      await flush();
      expect(h.service.inFlightCount()).toBe(2);
      h.service.disposeAll();
      const [r1, r2] = await Promise.all([promise1, promise2]);
      expect((r1.result as { isError: boolean }).isError).toBe(true);
      expect((r2.result as { isError: boolean }).isError).toBe(true);
      expect(h.service.inFlightCount()).toBe(0);
    });
  });
});
