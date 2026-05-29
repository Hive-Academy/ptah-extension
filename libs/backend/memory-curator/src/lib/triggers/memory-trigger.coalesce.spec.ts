import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import type {
  JsonlReaderService,
  PostToolUseCallback,
  PostToolUseCallbackRegistry,
  PostToolUsePayload,
  SessionActivityCallback,
  SessionActivityRegistry,
  SessionEndCallback,
  SessionEndCallbackRegistry,
  UserPromptSubmitCallback,
  UserPromptSubmitCallbackRegistry,
  StopCallback,
  StopCallbackRegistry,
  StopPayload,
  ToolFailureCallbackRegistry,
  ToolFailurePayload,
  SessionEndHookCallbackRegistry,
  SessionEndHookPayload,
} from '@ptah-extension/agent-sdk';
import { CuratorRateLimitService } from '@ptah-extension/agent-sdk';
import { MemoryTriggerService } from './memory-trigger.service';
import type { MemoryCuratorService } from '../memory-curator.service';

function makeLogger(): {
  logger: Logger;
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
} {
  const debug = jest.fn();
  const info = jest.fn();
  const warn = jest.fn();
  const error = jest.fn();
  return {
    logger: { debug, info, warn, error } as unknown as Logger,
    debug,
    info,
    warn,
    error,
  };
}

interface StopHarness {
  registry: StopCallbackRegistry;
  fire: (payload: StopPayload) => void;
}

function makeStopRegistry(): StopHarness {
  const subscribers = new Set<StopCallback>();
  return {
    fire: (p) => {
      for (const cb of subscribers) cb(p);
    },
    registry: {
      register: jest.fn((cb: StopCallback) => {
        subscribers.add(cb);
        return () => {
          subscribers.delete(cb);
        };
      }),
    } as unknown as StopCallbackRegistry,
  };
}

interface SessionEndHookHarness {
  registry: SessionEndHookCallbackRegistry;
  fire: (payload: SessionEndHookPayload) => void;
}

function makeSessionEndHookRegistry(): SessionEndHookHarness {
  const subscribers = new Set<(p: SessionEndHookPayload) => void>();
  return {
    fire: (p) => {
      for (const cb of subscribers) cb(p);
    },
    registry: {
      register: jest.fn((cb: (p: SessionEndHookPayload) => void) => {
        subscribers.add(cb);
        return () => {
          subscribers.delete(cb);
        };
      }),
    } as unknown as SessionEndHookCallbackRegistry,
  };
}

function makeWorkspace(
  overrides: Partial<Record<string, unknown>> = {},
): IWorkspaceProvider {
  const cfg: Record<string, unknown> = {
    'memory.triggers.idleMs': 0,
    'memory.triggers.turnThreshold': 1,
    'memory.triggers.bootScan': false,
    'memory.triggers.preCompact': true,
    'memory.triggers.userPromptSubmit.enabled': false,
    'memory.triggers.postToolUse.enabled': false,
    'memory.triggers.turnComplete.enabled': true,
    'memory.triggers.episode.enabled': true,
    'memory.triggers.sessionEnd.enabled': true,
    'memory.triggers.maxCuratesPerHour': 100,
    ...overrides,
  };
  return {
    getWorkspaceRoot: jest.fn(() => '/ws'),
    getWorkspaceFolders: jest.fn(() => ['/ws']),
    getConfiguration: jest.fn(
      (_section: string, key: string, def: unknown) => cfg[key] ?? def,
    ),
    setConfiguration: jest.fn().mockResolvedValue(undefined),
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
  } as unknown as IWorkspaceProvider;
}

function makeCurator(): MemoryCuratorService {
  return {
    curate: jest.fn().mockResolvedValue({
      extracted: 0,
      merged: 0,
      created: 0,
      skipped: 0,
    }),
    pushEvent: jest.fn(),
    recentEvents: jest.fn(() => []),
    lastRunInfo: jest.fn(() => ({ at: null, stats: null })),
  } as unknown as MemoryCuratorService;
}

function makeNoopActivity(): SessionActivityRegistry {
  return {
    register: jest.fn((_cb: SessionActivityCallback) => () => undefined),
    notifyAll: jest.fn(),
  } as unknown as SessionActivityRegistry;
}

function makeNoopSessionEnd(): SessionEndCallbackRegistry {
  return {
    register: jest.fn((_cb: SessionEndCallback) => () => undefined),
  } as unknown as SessionEndCallbackRegistry;
}

function makeNoopUserPromptSubmit(): UserPromptSubmitCallbackRegistry {
  return {
    register: jest.fn((_cb: UserPromptSubmitCallback) => () => undefined),
    notifyAll: jest.fn(),
    get size() {
      return 0;
    },
  } as unknown as UserPromptSubmitCallbackRegistry;
}

function makeNoopPostToolUse(): PostToolUseCallbackRegistry {
  return {
    register: jest.fn((_cb: PostToolUseCallback) => () => undefined),
    notifyAll: jest.fn(),
    get size() {
      return 0;
    },
  } as unknown as PostToolUseCallbackRegistry;
}

function makeNoopToolFailure(): ToolFailureCallbackRegistry {
  return {
    register: jest.fn(() => () => undefined),
  } as unknown as ToolFailureCallbackRegistry;
}

function makeFs(): IFileSystemProvider {
  return {} as unknown as IFileSystemProvider;
}

function makeSqlite(): SqliteConnectionService {
  return {
    db: {
      prepare: jest.fn(() => ({ get: jest.fn(), run: jest.fn() })),
    },
  } as unknown as SqliteConnectionService;
}

function makeJsonl(): JsonlReaderService {
  return {
    findSessionsDirectory: jest.fn().mockResolvedValue(null),
  } as unknown as JsonlReaderService;
}

function stopPayload(overrides?: Partial<StopPayload>): StopPayload {
  return {
    sessionId: 's1',
    workspaceRoot: '/ws',
    lastAssistantMessage: 'Did some work this turn.',
    effortLevel: null,
    hasBackgroundWork: false,
    timestamp: 1000,
    ...overrides,
  };
}

interface Built {
  service: MemoryTriggerService;
  stop: StopHarness;
  sessionEndHook: SessionEndHookHarness;
  curator: MemoryCuratorService;
  debug: jest.Mock;
}

function buildService(opts?: {
  workspace?: IWorkspaceProvider;
  curator?: MemoryCuratorService;
}): Built {
  const { logger, debug } = makeLogger();
  const stop = makeStopRegistry();
  const sessionEndHook = makeSessionEndHookRegistry();
  const curator = opts?.curator ?? makeCurator();
  const workspace = opts?.workspace ?? makeWorkspace();
  const rateLimiter = new CuratorRateLimitService(logger);
  const service = new MemoryTriggerService(
    logger,
    curator,
    makeNoopActivity(),
    makeNoopSessionEnd(),
    workspace,
    makeFs(),
    makeSqlite(),
    makeJsonl(),
    makeNoopUserPromptSubmit(),
    makeNoopPostToolUse(),
    stop.registry,
    makeNoopToolFailure(),
    sessionEndHook.registry,
    rateLimiter,
  );
  return { service, stop, sessionEndHook, curator, debug };
}

describe('MemoryTriggerService — coalescing / in-flight (Batch D)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('(a) two stop triggers within 5s yield exactly one curate', async () => {
    const { service, stop, curator } = buildService();
    service.start();

    stop.fire(stopPayload({ timestamp: 1 }));
    await Promise.resolve();
    stop.fire(stopPayload({ timestamp: 2 }));
    await Promise.resolve();

    expect(curator.curate).toHaveBeenCalledTimes(1);
  });

  it('(b) a sessionEndHook trigger AFTER a stop within window is dropped: first wins', async () => {
    const { service, stop, sessionEndHook, curator } = buildService();
    service.start();

    stop.fire(stopPayload({ timestamp: 1 }));
    await Promise.resolve();
    sessionEndHook.fire({
      sessionId: 's1',
      workspaceRoot: '/ws',
      reason: 'clear',
      timestamp: 2,
    });
    await Promise.resolve();

    expect(curator.curate).toHaveBeenCalledTimes(1);
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'turn-complete-trigger' }),
    );
  });

  it('(c) maxCuratesPerHour still enforced (drops with rate-limited event)', async () => {
    const { service, stop, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.maxCuratesPerHour': 1,
      }),
    });
    service.start();

    stop.fire(stopPayload({ timestamp: 1 }));
    await Promise.resolve();
    jest.advanceTimersByTime(10_000);
    stop.fire(stopPayload({ timestamp: 2 }));
    await Promise.resolve();

    expect(curator.curate).toHaveBeenCalledTimes(1);
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'rate-limited' }),
    );
  });

  it('(d) in-flight curate drops subsequent triggers with debug log', async () => {
    let resolveCurate: () => void = () => undefined;
    const curator = makeCurator();
    (curator.curate as jest.Mock).mockReturnValueOnce(
      new Promise<void>((res) => {
        resolveCurate = () => res();
      }),
    );

    const { service, stop, debug } = buildService({ curator });
    service.start();

    stop.fire(stopPayload({ timestamp: 1 }));
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);

    stop.fire(stopPayload({ timestamp: 2 }));
    await Promise.resolve();
    stop.fire(stopPayload({ timestamp: 3 }));
    await Promise.resolve();

    expect(curator.curate).toHaveBeenCalledTimes(1);

    const debugCalls = debug.mock.calls.map((c) => String(c[0]));
    expect(
      debugCalls.some((m) =>
        m.includes('curate trigger coalesced (in-flight or recent)'),
      ),
    ).toBe(true);

    resolveCurate();
    await Promise.resolve();
  });
});
