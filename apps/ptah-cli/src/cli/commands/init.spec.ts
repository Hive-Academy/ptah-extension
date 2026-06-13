import * as clack from '@clack/prompts';

import { execute } from './init.js';
import type { InitExecuteHooks } from './init.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '@ptah-extension/cli-engine';

jest.mock('@clack/prompts', () => ({
  intro: jest.fn(),
  outro: jest.fn(),
  note: jest.fn(),
  cancel: jest.fn(),
  text: jest.fn(),
  password: jest.fn(),
  select: jest.fn(),
  confirm: jest.fn(),
  spinner: jest.fn(),
  isCancel: jest.fn(() => false),
  log: {
    info: jest.fn(),
    success: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    message: jest.fn(),
  },
}));

const CANCEL_SYMBOL = Symbol('clack:cancel');

const machineGlobals: GlobalOptions = {
  json: true,
  human: false,
  cwd: process.cwd(),
  quiet: false,
  verbose: false,
  noColor: true,
  autoApprove: false,
  reveal: false,
};

const interactiveGlobals: GlobalOptions = {
  ...machineGlobals,
  json: false,
  human: true,
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

interface MockEngine {
  withEngine: InitExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<
    string,
    { success: true; data?: unknown } | { success: false; error?: string }
  >;
}

function makeEngine(): MockEngine {
  const rpcCalls: MockEngine['rpcCalls'] = [];
  const scripted: MockEngine['scripted'] = new Map();

  const transport = {
    call: jest.fn(async (method: string, params: unknown) => {
      rpcCalls.push({ method, params });
      const r = scripted.get(method);
      if (r) return r;
      return { success: true, data: null };
    }),
  } as unknown as CliMessageTransport;

  const withEngine = (async (
    _globals: unknown,
    _opts: unknown,
    fn: (ctx: {
      container: { resolve: jest.Mock };
      transport: CliMessageTransport;
      pushAdapter: { removeAllListeners(): void };
    }) => Promise<unknown>,
  ): Promise<unknown> => {
    return fn({
      container: { resolve: jest.fn() },
      transport,
      pushAdapter: { removeAllListeners: jest.fn() },
    });
  }) as unknown as InitExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted };
}

function scriptFreshInstall(engine: MockEngine): void {
  engine.scripted.set('license:getStatus', {
    success: true,
    data: { tier: 'free', valid: true, daysRemaining: null },
  });
  engine.scripted.set('auth:getAuthStatus', {
    success: true,
    data: { authMethod: null, anthropicProviderId: null },
  });
  engine.scripted.set('llm:getDefaultProvider', {
    success: true,
    data: { provider: null },
  });
  engine.scripted.set('llm:getProviderStatus', {
    success: true,
    data: {
      providers: [
        {
          name: 'anthropic',
          displayName: 'Anthropic',
          authType: 'apiKey',
          isLocal: false,
          hasApiKey: false,
          isDefault: false,
          baseUrl: null,
        },
        {
          name: 'ollama',
          displayName: 'Ollama',
          authType: 'none',
          isLocal: true,
          hasApiKey: false,
          isDefault: false,
          baseUrl: 'http://localhost:11434',
        },
      ],
    },
  });
  engine.scripted.set('auth:getHealth', {
    success: true,
    data: { copilotAuthenticated: false, codexAuthenticated: false },
  });
}

function makeSpinner() {
  return {
    start: jest.fn(),
    stop: jest.fn(),
    cancel: jest.fn(),
    error: jest.fn(),
    message: jest.fn(),
    clear: jest.fn(),
    isCancelled: false,
  };
}

beforeEach(() => {
  for (const fn of [
    clack.confirm,
    clack.select,
    clack.password,
    clack.text,
    clack.isCancel,
    clack.intro,
    clack.outro,
    clack.note,
    clack.cancel,
    clack.spinner,
    clack.log.info,
    clack.log.success,
    clack.log.warn,
    clack.log.error,
    clack.log.message,
  ]) {
    (fn as unknown as jest.Mock).mockReset();
  }
  (clack.isCancel as unknown as jest.Mock).mockImplementation(() => false);
  (clack.spinner as unknown as jest.Mock).mockReturnValue(makeSpinner());
});

describe('ptah init — machine mode', () => {
  it('emits init.plan and never calls a clack prompt when --json is set', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    scriptFreshInstall(engine);

    const exit = await execute({}, machineGlobals, {
      formatter: formatterTrace.formatter,
      withEngine: engine.withEngine,
    });

    expect(exit).toBe(ExitCode.Success);
    const plan = formatterTrace.notifications.find(
      (n) => n.method === 'init.plan',
    );
    expect(plan).toBeDefined();
    const params = plan?.params as {
      ready: boolean;
      steps: Array<{ id: string; command: string; satisfied: boolean }>;
    };
    expect(params.ready).toBe(false);
    expect(params.steps.map((s) => s.id)).toEqual(
      expect.arrayContaining(['license', 'provider.default', 'verify']),
    );

    expect(clack.intro).not.toHaveBeenCalled();
    expect(clack.confirm).not.toHaveBeenCalled();
    expect(clack.select).not.toHaveBeenCalled();
    expect(clack.password).not.toHaveBeenCalled();
    expect(clack.text).not.toHaveBeenCalled();
    expect(clack.outro).not.toHaveBeenCalled();
  });

  it('treats a non-TTY interactive request as machine mode', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    scriptFreshInstall(engine);

    const exit = await execute({}, interactiveGlobals, {
      formatter: formatterTrace.formatter,
      withEngine: engine.withEngine,
      isInteractive: () => false,
    });

    expect(exit).toBe(ExitCode.Success);
    expect(
      formatterTrace.notifications.some((n) => n.method === 'init.plan'),
    ).toBe(true);
    expect(clack.intro).not.toHaveBeenCalled();
  });
});

describe('ptah init — interactive api-key flow', () => {
  it('calls the correct RPC methods in order for a verified api-key provider', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    scriptFreshInstall(engine);
    engine.scripted.set('llm:setApiKey', {
      success: true,
      data: { success: true, verified: true },
    });
    engine.scripted.set('llm:setDefaultProvider', {
      success: true,
      data: { success: true },
    });

    (clack.confirm as unknown as jest.Mock)
      .mockResolvedValueOnce(false) // license? no
      .mockResolvedValueOnce(false) // map tiers? no
      .mockResolvedValueOnce(false); // smoke turn? no (only if ready)
    (clack.select as unknown as jest.Mock).mockResolvedValueOnce('anthropic');
    (clack.password as unknown as jest.Mock).mockResolvedValueOnce(
      'sk-ant-good',
    );

    const exit = await execute({}, interactiveGlobals, {
      formatter: formatterTrace.formatter,
      withEngine: engine.withEngine,
      isInteractive: () => true,
      runSmokeTurn: jest.fn(async () => ExitCode.Success),
    });

    expect(exit).toBe(ExitCode.Success);

    const methods = engine.rpcCalls.map((c) => c.method);
    const setKeyIdx = methods.indexOf('llm:setApiKey');
    const setDefaultIdx = methods.indexOf('llm:setDefaultProvider');
    expect(setKeyIdx).toBeGreaterThanOrEqual(0);
    expect(setDefaultIdx).toBeGreaterThan(setKeyIdx);

    const setKeyCall = engine.rpcCalls[setKeyIdx];
    expect(setKeyCall.params).toEqual({
      provider: 'anthropic',
      apiKey: 'sk-ant-good',
    });
    const setDefaultCall = engine.rpcCalls[setDefaultIdx];
    expect(setDefaultCall.params).toEqual({ provider: 'anthropic' });

    expect(clack.intro).toHaveBeenCalled();
    expect(clack.outro).toHaveBeenCalled();
  });

  it('surfaces a rejected api key and does NOT set the default provider', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    scriptFreshInstall(engine);
    engine.scripted.set('llm:setApiKey', {
      success: true,
      data: { success: false, verified: false, error: 'invalid format' },
    });

    (clack.confirm as unknown as jest.Mock)
      .mockResolvedValueOnce(false) // license? no
      .mockResolvedValueOnce(false) // retry with different key? no
      .mockResolvedValueOnce(false); // smoke turn (won't be reached if not ready)
    (clack.select as unknown as jest.Mock).mockResolvedValueOnce('anthropic');
    (clack.password as unknown as jest.Mock).mockResolvedValueOnce('bad-key');

    const exit = await execute({}, interactiveGlobals, {
      formatter: formatterTrace.formatter,
      withEngine: engine.withEngine,
      isInteractive: () => true,
      runSmokeTurn: jest.fn(async () => ExitCode.Success),
    });

    expect(exit).toBe(ExitCode.Success);
    const methods = engine.rpcCalls.map((c) => c.method);
    expect(methods).toContain('llm:setApiKey');
    expect(methods).not.toContain('llm:setDefaultProvider');
    expect(clack.log.error).toHaveBeenCalled();
  });
});

describe('ptah init — cancellation', () => {
  it('aborts with exit 130 when a prompt is cancelled', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    scriptFreshInstall(engine);

    (clack.confirm as unknown as jest.Mock).mockResolvedValueOnce(
      CANCEL_SYMBOL,
    );
    (clack.isCancel as unknown as jest.Mock).mockImplementation(
      (v: unknown) => v === CANCEL_SYMBOL,
    );

    const exit = await execute({}, interactiveGlobals, {
      formatter: formatterTrace.formatter,
      withEngine: engine.withEngine,
      isInteractive: () => true,
    });

    expect(exit).toBe(130);
    expect(clack.cancel).toHaveBeenCalledWith('Setup aborted');
    expect(clack.outro).not.toHaveBeenCalled();
  });
});
