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

function makeHarness(
  overrides: { ackSuccess?: boolean; ackError?: string } = {},
): Harness {
  const transport = {
    call: jest.fn().mockResolvedValue({
      success: overrides.ackSuccess ?? true,
      ...(overrides.ackError ? { error: overrides.ackError } : {}),
    }),
  } as unknown as jest.Mocked<Pick<CliMessageTransport, 'call'>>;
  const pushAdapter = new EventEmitter();
  pushAdapter.setMaxListeners(50);
  const notifier = { notify: jest.fn().mockResolvedValue(undefined) };
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
  });
  return { transport, pushAdapter, notifier, service };
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
});
