/**
 * Unit tests for `ptah prompts` command.
 *
 * Coverage:
 *   - status:     dispatches enhancedPrompts:getStatus; emits prompts.status
 *   - enable:     enhancedPrompts:setEnabled { enabled: true } → prompts.enabled
 *   - disable:    enhancedPrompts:setEnabled { enabled: false } → prompts.disabled
 *   - regenerate: emits prompts.regenerate.start before RPC and
 *                 prompts.regenerate.complete after enhancedPrompts:regenerate
 *   - show <name>: dispatches enhancedPrompts:getPromptContent; emits prompts.content
 *   - download:   dispatches enhancedPrompts:download; emits prompts.download.complete
 *   - error path: getStatus returning { error } surfaces as task.error
 *   - unknown sub-command → exit 2
 */

import { execute } from './prompts.js';
import type { PromptsExecuteHooks, PromptsOptions } from './prompts.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';

const baseGlobals: GlobalOptions = {
  json: true,
  human: false,
  cwd: 'D:/test-workspace',
  quiet: false,
  verbose: false,
  noColor: true,
  autoApprove: false,
  reveal: false,
};

interface FormatterTrace {
  notifications: Array<{ method: string; params?: unknown }>;
  formatter: Formatter;
}

function makeFormatter(): FormatterTrace {
  const notifications: FormatterTrace['notifications'] = [];
  const formatter: Formatter = {
    writeNotification: jest.fn(async (method: string, params?: unknown) => {
      notifications.push({ method, params });
    }),
    writeRequest: jest.fn(async () => undefined),
    writeResponse: jest.fn(async () => undefined),
    writeError: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
  return { notifications, formatter };
}

function makeStderr(): { stderr: { write: jest.Mock }; buffer: string } {
  const trace = {
    buffer: '',
    stderr: {
      write: jest.fn((chunk: string) => {
        trace.buffer += chunk;
        return true;
      }),
    },
  };
  return trace;
}

interface MockEngine {
  withEngine: PromptsExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<
    string,
    | { success: true; data?: unknown }
    | { success: false; error: string; errorCode?: string }
  >;
}

function makeEngine(): MockEngine {
  const rpcCalls: MockEngine['rpcCalls'] = [];
  const scripted: MockEngine['scripted'] = new Map();
  const transport = {
    call: jest.fn(async (method: string, params: unknown) => {
      rpcCalls.push({ method, params });
      const scriptedResp = scripted.get(method);
      if (scriptedResp) return scriptedResp;
      return { success: true, data: { __default: method } };
    }),
  } as unknown as CliMessageTransport;

  const container = {
    resolve: jest.fn(() => {
      throw new Error(
        'container.resolve hit — prompts cmd should not reach DI',
      );
    }),
  };

  const withEngine = (async (
    _globals: unknown,
    _opts: unknown,
    fn: (ctx: {
      container: typeof container;
      transport: CliMessageTransport;
      pushAdapter: { removeAllListeners(): void };
    }) => Promise<unknown>,
  ): Promise<unknown> => {
    return fn({
      container,
      transport,
      pushAdapter: { removeAllListeners: jest.fn() },
    });
  }) as unknown as PromptsExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted };
}

function buildHooks(): {
  formatterTrace: FormatterTrace;
  stderrTrace: ReturnType<typeof makeStderr>;
  engine: MockEngine;
  hooks: PromptsExecuteHooks;
} {
  const formatterTrace = makeFormatter();
  const stderrTrace = makeStderr();
  const engine = makeEngine();
  const hooks: PromptsExecuteHooks = {
    formatter: formatterTrace.formatter,
    stderr: stderrTrace.stderr,
    withEngine: engine.withEngine,
  };
  return { formatterTrace, stderrTrace, engine, hooks };
}

describe('ptah prompts status', () => {
  it('dispatches enhancedPrompts:getStatus and emits prompts.status', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('enhancedPrompts:getStatus', {
      success: true,
      data: {
        enabled: true,
        hasGeneratedPrompt: true,
        generatedAt: '2026-01-01T00:00:00Z',
        detectedStack: { primaryFramework: 'react' },
        cacheValid: true,
      },
    });
    const exit = await execute(
      { subcommand: 'status' } satisfies PromptsOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'enhancedPrompts:getStatus',
      params: { workspacePath: 'D:/test-workspace' },
    });
    expect(formatterTrace.notifications[0]?.method).toBe('prompts.status');
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      workspacePath: 'D:/test-workspace',
      enabled: true,
      hasGeneratedPrompt: true,
      cacheValid: true,
    });
  });

  it('surfaces a status-level error as task.error and exits 5', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('enhancedPrompts:getStatus', {
      success: true,
      data: { error: 'no workspace open' },
    });
    const exit = await execute(
      { subcommand: 'status' } satisfies PromptsOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
    expect(last?.params).toMatchObject({ message: 'no workspace open' });
  });
});

describe('ptah prompts enable / disable', () => {
  it('enable dispatches setEnabled { enabled:true } and emits prompts.enabled', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('enhancedPrompts:setEnabled', {
      success: true,
      data: { success: true, enabled: true },
    });
    const exit = await execute(
      { subcommand: 'enable' } satisfies PromptsOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]).toEqual({
      method: 'enhancedPrompts:setEnabled',
      params: { workspacePath: 'D:/test-workspace', enabled: true },
    });
    expect(formatterTrace.notifications[0]?.method).toBe('prompts.enabled');
  });

  it('disable dispatches setEnabled { enabled:false } and emits prompts.disabled', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('enhancedPrompts:setEnabled', {
      success: true,
      data: { success: true, enabled: false },
    });
    const exit = await execute(
      { subcommand: 'disable' } satisfies PromptsOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(engine.rpcCalls[0]?.params).toMatchObject({ enabled: false });
    expect(formatterTrace.notifications[0]?.method).toBe('prompts.disabled');
  });
});

describe('ptah prompts regenerate', () => {
  it('emits start before the RPC and complete after', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('enhancedPrompts:regenerate', {
      success: true,
      data: { success: true, status: 'regenerated' },
    });
    const exit = await execute(
      { subcommand: 'regenerate', force: true } satisfies PromptsOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    const methods = formatterTrace.notifications.map((n) => n.method);
    expect(methods).toEqual([
      'prompts.regenerate.start',
      'prompts.regenerate.complete',
    ]);
    const regenCall = engine.rpcCalls.find(
      (c) => c.method === 'enhancedPrompts:regenerate',
    );
    expect(regenCall?.params).toMatchObject({
      workspacePath: 'D:/test-workspace',
      force: true,
    });
  });

  it('exits 5 (InternalFailure) when regenerate fails', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('enhancedPrompts:regenerate', {
      success: true,
      data: { success: false, error: 'license_required' },
    });
    const exit = await execute(
      { subcommand: 'regenerate' } satisfies PromptsOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });
});

describe('ptah prompts show', () => {
  it('dispatches getPromptContent and emits prompts.content', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('enhancedPrompts:getPromptContent', {
      success: true,
      data: { content: '# Combined prompt' },
    });
    const exit = await execute(
      { subcommand: 'show', name: 'main' } satisfies PromptsOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(formatterTrace.notifications[0]?.method).toBe('prompts.content');
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      name: 'main',
      content: '# Combined prompt',
    });
  });
});

describe('ptah prompts download', () => {
  it('dispatches enhancedPrompts:download and emits prompts.download.complete', async () => {
    const { formatterTrace, engine, hooks } = buildHooks();
    engine.scripted.set('enhancedPrompts:download', {
      success: true,
      data: { success: true, filePath: 'D:/test/prompts.md' },
    });
    const exit = await execute(
      { subcommand: 'download' } satisfies PromptsOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.Success);
    expect(formatterTrace.notifications[0]?.method).toBe(
      'prompts.download.complete',
    );
    expect(formatterTrace.notifications[0]?.params).toMatchObject({
      filePath: 'D:/test/prompts.md',
    });
  });
});

describe('ptah prompts unknown sub-command', () => {
  it('exits 2 (UsageError) on unknown sub-command', async () => {
    const { stderrTrace, hooks } = buildHooks();
    const exit = await execute(
      { subcommand: 'bogus' as unknown as 'status' } satisfies PromptsOptions,
      baseGlobals,
      hooks,
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/unknown sub-command/);
  });
});
