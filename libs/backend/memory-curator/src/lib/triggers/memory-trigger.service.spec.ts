import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import type { ITranscriptReader } from '@ptah-extension/memory-contracts';
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
  UserPromptSubmitPayload,
  StopCallbackRegistry,
  StopPayload,
  ToolFailureCallbackRegistry,
  ToolFailurePayload,
  SessionEndHookCallbackRegistry,
  SessionEndHookPayload,
  PreToolUseCallbackRegistry,
  PreToolUsePayload,
  SessionStartCallbackRegistry,
  SessionStartPayload,
} from '@ptah-extension/agent-sdk';
import { CuratorRateLimitService } from '@ptah-extension/agent-sdk';
import { MemoryTriggerService } from './memory-trigger.service';
import type { MemoryCuratorService } from '../memory-curator.service';
import type {
  ObservationQueueInsert,
  ObservationQueueRow,
  ObservationQueueStore,
} from '../observation-queue.store';

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

interface ActivityHarness {
  fire: (cb: SessionActivityCallback) => void;
  registry: SessionActivityRegistry;
}

function makeActivityRegistry(): ActivityHarness {
  let active: SessionActivityCallback | null = null;
  return {
    fire: (cb) => {
      active = cb;
    },
    registry: {
      register: jest.fn((cb: SessionActivityCallback) => {
        active = cb;
        return () => {
          active = null;
        };
      }),
      notifyAll: jest.fn((payload) => {
        active?.(payload);
      }),
    } as unknown as SessionActivityRegistry,
  };
}

interface SessionEndHarness {
  endRegistry: SessionEndCallbackRegistry;
  endActive: { current: SessionEndCallback | null };
}

function makeSessionEndRegistry(): SessionEndHarness {
  const endActive: { current: SessionEndCallback | null } = { current: null };
  return {
    endActive,
    endRegistry: {
      register: jest.fn((cb: SessionEndCallback) => {
        endActive.current = cb;
        return () => {
          endActive.current = null;
        };
      }),
    } as unknown as SessionEndCallbackRegistry,
  };
}

interface UserPromptSubmitHarness {
  registry: UserPromptSubmitCallbackRegistry;
  fire: (payload: UserPromptSubmitPayload) => void;
}

function makeUserPromptSubmitRegistry(): UserPromptSubmitHarness {
  const subscribers = new Set<UserPromptSubmitCallback>();
  return {
    fire: (payload) => {
      for (const cb of subscribers) cb(payload);
    },
    registry: {
      register: jest.fn((cb: UserPromptSubmitCallback) => {
        subscribers.add(cb);
        return () => {
          subscribers.delete(cb);
        };
      }),
      notifyAll: jest.fn((payload: UserPromptSubmitPayload) => {
        for (const cb of subscribers) cb(payload);
      }),
      get size() {
        return subscribers.size;
      },
    } as unknown as UserPromptSubmitCallbackRegistry,
  };
}

interface PostToolUseHarness {
  registry: PostToolUseCallbackRegistry;
  fire: (payload: PostToolUsePayload) => void;
}

function makePostToolUseRegistry(): PostToolUseHarness {
  const subscribers = new Set<PostToolUseCallback>();
  return {
    fire: (payload) => {
      for (const cb of subscribers) cb(payload);
    },
    registry: {
      register: jest.fn((cb: PostToolUseCallback) => {
        subscribers.add(cb);
        return () => {
          subscribers.delete(cb);
        };
      }),
      notifyAll: jest.fn((payload: PostToolUsePayload) => {
        for (const cb of subscribers) cb(payload);
      }),
      get size() {
        return subscribers.size;
      },
    } as unknown as PostToolUseCallbackRegistry,
  };
}

interface SetRegistryHarness<TPayload, TRegistry> {
  registry: TRegistry;
  fire: (payload: TPayload) => void;
}

function makeSetRegistry<TPayload>(): SetRegistryHarness<
  TPayload,
  { register: unknown; notifyAll: unknown; size: number }
> {
  const subscribers = new Set<(payload: TPayload) => void>();
  return {
    fire: (payload) => {
      for (const cb of subscribers) cb(payload);
    },
    registry: {
      register: jest.fn((cb: (payload: TPayload) => void) => {
        subscribers.add(cb);
        return () => {
          subscribers.delete(cb);
        };
      }),
      notifyAll: jest.fn((payload: TPayload) => {
        for (const cb of subscribers) cb(payload);
      }),
      get size() {
        return subscribers.size;
      },
    } as unknown as { register: unknown; notifyAll: unknown; size: number },
  };
}

function makeWorkspace(
  overrides: Partial<Record<string, unknown>> = {},
): IWorkspaceProvider {
  const cfg: Record<string, unknown> = {
    'memory.triggers.idleMs': 600000,
    'memory.triggers.turnThreshold': 20,
    'memory.triggers.bootScan': false,
    'memory.triggers.preCompact': true,
    'memory.triggers.userPromptSubmit.enabled': true,
    'memory.triggers.userPromptSubmit.cueList': [
      'remember (this|that)',
      'save to memory',
    ],
    'memory.triggers.userPromptSubmit.minPromptLength': 20,
    'memory.triggers.postToolUse.enabled': true,
    'memory.triggers.maxCuratesPerHour': 12,
    'memory.triggers.maxObservationsPerCurate': 500,
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

function makeFs(): IFileSystemProvider {
  return {} as unknown as IFileSystemProvider;
}

function makeSqlite(): SqliteConnectionService {
  return {
    db: {
      prepare: jest.fn(() => ({
        get: jest.fn(),
        run: jest.fn(),
      })),
    },
  } as unknown as SqliteConnectionService;
}

function makeJsonl(): JsonlReaderService {
  return {
    findSessionsDirectory: jest.fn().mockResolvedValue(null),
  } as unknown as JsonlReaderService;
}

interface FakeQueueStore {
  store: ObservationQueueStore;
  inserts: ObservationQueueInsert[];
  rowsBySession: Map<string, ObservationQueueRow[]>;
  markProcessed: jest.Mock;
  nextId: { value: number };
}

function makeObservationQueue(): FakeQueueStore {
  const inserts: ObservationQueueInsert[] = [];
  const rowsBySession = new Map<string, ObservationQueueRow[]>();
  const nextId = { value: 1 };
  const markProcessed = jest.fn((ids: readonly number[]) => {
    for (const [, rows] of rowsBySession) {
      for (const r of rows) {
        if (ids.includes(r.id)) {
          (r as unknown as { processedAt: number }).processedAt = Date.now();
        }
      }
    }
  });
  const store = {
    insert: jest.fn((insert: ObservationQueueInsert) => {
      inserts.push(insert);
      const row: ObservationQueueRow = {
        id: nextId.value++,
        sessionId: insert.sessionId,
        workspaceRoot: insert.workspaceRoot,
        kind: insert.kind,
        toolName: insert.toolName ?? null,
        toolInputJson: insert.toolInputJson ?? null,
        toolResponseText: insert.toolResponseText ?? null,
        assistantMessage: insert.assistantMessage ?? null,
        userPrompt: insert.userPrompt ?? null,
        filePath: insert.filePath ?? null,
        promptNumber: insert.promptNumber ?? null,
        capturedAt: Date.now(),
        processedAt: null,
      };
      const arr = rowsBySession.get(insert.sessionId) ?? [];
      arr.push(row);
      rowsBySession.set(insert.sessionId, arr);
    }),
    drainForSession: jest.fn((sessionId: string, limit = 500) => {
      const arr = rowsBySession.get(sessionId) ?? [];
      return arr.filter((r) => r.processedAt === null).slice(0, limit);
    }),
    markProcessed,
    purgeOlderThan: jest.fn(() => 0),
    countUnprocessed: jest.fn(() => 0),
  } as unknown as ObservationQueueStore;
  return { store, inserts, rowsBySession, markProcessed, nextId };
}

function makeTranscriptReader(text = ''): ITranscriptReader {
  return {
    read: jest.fn().mockResolvedValue(text),
  } as unknown as ITranscriptReader;
}

function buildService(opts?: {
  workspace?: IWorkspaceProvider;
  curator?: MemoryCuratorService;
  rateLimiter?: CuratorRateLimitService;
  transcriptText?: string;
  observationQueue?: FakeQueueStore;
}): {
  service: MemoryTriggerService;
  activity: ActivityHarness;
  sessionEnd: SessionEndHarness;
  userPromptSubmit: UserPromptSubmitHarness;
  postToolUse: PostToolUseHarness;
  stop: SetRegistryHarness<StopPayload, StopCallbackRegistry>;
  toolFailure: SetRegistryHarness<
    ToolFailurePayload,
    ToolFailureCallbackRegistry
  >;
  sessionEndHook: SetRegistryHarness<
    SessionEndHookPayload,
    SessionEndHookCallbackRegistry
  >;
  preToolUse: SetRegistryHarness<PreToolUsePayload, PreToolUseCallbackRegistry>;
  sessionStart: SetRegistryHarness<
    SessionStartPayload,
    SessionStartCallbackRegistry
  >;
  curator: MemoryCuratorService;
  workspace: IWorkspaceProvider;
  rateLimiter: CuratorRateLimitService;
  queue: FakeQueueStore;
  transcriptReader: ITranscriptReader;
} {
  const activity = makeActivityRegistry();
  const sessionEnd = makeSessionEndRegistry();
  const userPromptSubmit = makeUserPromptSubmitRegistry();
  const postToolUse = makePostToolUseRegistry();
  const stop = makeSetRegistry<StopPayload>();
  const toolFailure = makeSetRegistry<ToolFailurePayload>();
  const sessionEndHook = makeSetRegistry<SessionEndHookPayload>();
  const preToolUse = makeSetRegistry<PreToolUsePayload>();
  const sessionStart = makeSetRegistry<SessionStartPayload>();
  const curator = opts?.curator ?? makeCurator();
  const workspace = opts?.workspace ?? makeWorkspace();
  const rateLimiter =
    opts?.rateLimiter ?? new CuratorRateLimitService(makeLogger());
  const queue = opts?.observationQueue ?? makeObservationQueue();
  const transcriptReader = makeTranscriptReader(opts?.transcriptText ?? '');
  const service = new MemoryTriggerService(
    makeLogger(),
    curator,
    activity.registry,
    sessionEnd.endRegistry,
    workspace,
    makeFs(),
    makeSqlite(),
    makeJsonl(),
    userPromptSubmit.registry,
    postToolUse.registry,
    stop.registry as unknown as StopCallbackRegistry,
    toolFailure.registry as unknown as ToolFailureCallbackRegistry,
    sessionEndHook.registry as unknown as SessionEndHookCallbackRegistry,
    rateLimiter,
    queue.store,
    preToolUse.registry as unknown as PreToolUseCallbackRegistry,
    sessionStart.registry as unknown as SessionStartCallbackRegistry,
    transcriptReader,
  );
  return {
    service,
    activity,
    sessionEnd,
    userPromptSubmit,
    postToolUse,
    stop: stop as unknown as SetRegistryHarness<
      StopPayload,
      StopCallbackRegistry
    >,
    toolFailure: toolFailure as unknown as SetRegistryHarness<
      ToolFailurePayload,
      ToolFailureCallbackRegistry
    >,
    sessionEndHook: sessionEndHook as unknown as SetRegistryHarness<
      SessionEndHookPayload,
      SessionEndHookCallbackRegistry
    >,
    preToolUse: preToolUse as unknown as SetRegistryHarness<
      PreToolUsePayload,
      PreToolUseCallbackRegistry
    >,
    sessionStart: sessionStart as unknown as SetRegistryHarness<
      SessionStartPayload,
      SessionStartCallbackRegistry
    >,
    curator,
    workspace,
    rateLimiter,
    queue,
    transcriptReader,
  };
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

function userPromptPayload(
  overrides?: Partial<UserPromptSubmitPayload>,
): UserPromptSubmitPayload {
  return {
    prompt: 'please remember this important fact about the codebase',
    sessionId: 's1',
    workspaceRoot: '/ws',
    timestamp: 1000,
    ...overrides,
  };
}

function postToolUsePayload(
  overrides?: Partial<PostToolUsePayload>,
): PostToolUsePayload {
  return {
    toolName: 'Bash',
    toolInput: { command: 'git commit -m "feat: hello"' },
    toolOutput: '',
    exitCode: 0,
    success: true,
    sessionId: 's1',
    workspaceRoot: '/ws',
    timestamp: 2000,
    ...overrides,
  };
}

describe('MemoryTriggerService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('start() is idempotent', () => {
    const { service, activity } = buildService();
    service.start();
    service.start();
    expect(activity.registry.register).toHaveBeenCalledTimes(1);
  });

  it('idle timer fires curate after idleMs (with buffered episode)', async () => {
    const { service, activity, stop, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 100,
        'memory.triggers.turnThreshold': 0,
      }),
    });
    service.start();
    stop.fire(stopPayload());
    activity.registry.notifyAll({
      sessionId: 's1',
      workspaceRoot: '/ws',
      role: 'user',
      timestamp: Date.now(),
    });
    jest.advanceTimersByTime(150);
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        workspaceRoot: '/ws',
        transcript: expect.stringContaining('Did some work this turn.'),
      }),
    );
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'idle-trigger', sessionId: 's1' }),
    );
  });

  it('idle with empty episode buffer does not curate', async () => {
    const { service, activity, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 100,
        'memory.triggers.turnThreshold': 0,
      }),
    });
    service.start();
    activity.registry.notifyAll({
      sessionId: 's1',
      workspaceRoot: '/ws',
      role: 'user',
      timestamp: Date.now(),
    });
    jest.advanceTimersByTime(150);
    await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
  });

  it('idle timer resets on new activity', async () => {
    const { service, activity, stop, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 200,
        'memory.triggers.turnThreshold': 0,
      }),
    });
    service.start();
    stop.fire(stopPayload());
    activity.registry.notifyAll({
      sessionId: 's1',
      workspaceRoot: '/ws',
      role: 'user',
      timestamp: 1,
    });
    jest.advanceTimersByTime(100);
    activity.registry.notifyAll({
      sessionId: 's1',
      workspaceRoot: '/ws',
      role: 'assistant',
      timestamp: 2,
    });
    jest.advanceTimersByTime(100);
    expect(curator.curate).not.toHaveBeenCalled();
    jest.advanceTimersByTime(120);
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);
  });

  it('turn-complete fires at exactly N Stop hooks', async () => {
    const { service, stop, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 3,
      }),
    });
    service.start();
    stop.fire(stopPayload({ timestamp: 1 }));
    stop.fire(stopPayload({ timestamp: 2 }));
    expect(curator.curate).not.toHaveBeenCalled();
    stop.fire(stopPayload({ timestamp: 3 }));
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'turn-complete-trigger' }),
    );
  });

  it('turn counter resets after firing', async () => {
    const { service, stop, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 2,
      }),
    });
    service.start();
    for (let i = 0; i < 4; i++) {
      stop.fire(stopPayload({ timestamp: i }));
    }
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(2);
  });

  it('Stop with in-flight background work does not fire turn-complete', async () => {
    const { service, stop, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 1,
      }),
    });
    service.start();
    stop.fire(stopPayload({ hasBackgroundWork: true }));
    await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
  });

  it('stop() clears all timers', () => {
    const { service, activity } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 100,
        'memory.triggers.turnThreshold': 0,
      }),
    });
    service.start();
    activity.registry.notifyAll({
      sessionId: 's1',
      workspaceRoot: '/ws',
      role: 'user',
      timestamp: 1,
    });
    service.stop();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('session-end clears pending idle timer', () => {
    const { service, activity, sessionEnd, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 100,
        'memory.triggers.turnThreshold': 0,
      }),
    });
    service.start();
    activity.registry.notifyAll({
      sessionId: 's1',
      workspaceRoot: '/ws',
      role: 'user',
      timestamp: 1,
    });
    expect(jest.getTimerCount()).toBe(1);
    sessionEnd.endActive.current?.({ sessionId: 's1', workspaceRoot: '/ws' });
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(200);
    expect(curator.curate).not.toHaveBeenCalled();
  });

  it('settings race: re-reads idleMs on every event', async () => {
    const cfg: Record<string, unknown> = {
      'memory.triggers.idleMs': 100,
      'memory.triggers.turnThreshold': 0,
      'memory.triggers.bootScan': false,
    };
    const workspace = {
      getWorkspaceRoot: jest.fn(() => '/ws'),
      getWorkspaceFolders: jest.fn(() => ['/ws']),
      getConfiguration: jest.fn(
        (_section: string, key: string, def: unknown) => cfg[key] ?? def,
      ),
      setConfiguration: jest.fn().mockResolvedValue(undefined),
      onDidChangeConfiguration: jest.fn(),
      onDidChangeWorkspaceFolders: jest.fn(),
    } as unknown as IWorkspaceProvider;

    const { service, activity, stop, curator } = buildService({ workspace });
    service.start();
    stop.fire(stopPayload());
    activity.registry.notifyAll({
      sessionId: 's1',
      workspaceRoot: '/ws',
      role: 'user',
      timestamp: 1,
    });
    cfg['memory.triggers.idleMs'] = 500;
    activity.registry.notifyAll({
      sessionId: 's1',
      workspaceRoot: '/ws',
      role: 'user',
      timestamp: 2,
    });
    jest.advanceTimersByTime(150);
    expect(curator.curate).not.toHaveBeenCalled();
    jest.advanceTimersByTime(400);
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);
  });

  it('events recorded for idle-trigger and turn-complete-trigger fires', async () => {
    const { service, activity, stop, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 100,
        'memory.triggers.turnThreshold': 2,
      }),
    });
    service.start();
    stop.fire(stopPayload({ timestamp: 1 }));
    activity.registry.notifyAll({
      sessionId: 's1',
      workspaceRoot: '/ws',
      role: 'user',
      timestamp: 1,
    });
    jest.advanceTimersByTime(150);
    await Promise.resolve();
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'idle-trigger' }),
    );
    stop.fire(stopPayload({ timestamp: 2 }));
    stop.fire(stopPayload({ timestamp: 3 }));
    await Promise.resolve();
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'turn-complete-trigger' }),
    );
  });
});

describe('MemoryTriggerService — user-cue trigger', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('cue match in prompt of length >= minPromptLength fires curate and pushes user-cue-trigger event', async () => {
    const { service, userPromptSubmit, curator } = buildService();
    service.start();
    userPromptSubmit.fire(
      userPromptPayload({
        prompt: 'please remember this important fact about the project layout',
      }),
    );
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        workspaceRoot: '/ws',
        transcript: expect.stringContaining(
          'please remember this important fact about the project layout',
        ),
      }),
    );
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'user-cue-trigger',
        sessionId: 's1',
        stats: expect.objectContaining({ cue: expect.any(String) }),
      }),
    );
  });

  it('prompt shorter than minPromptLength is skipped even with cue match', async () => {
    const { service, userPromptSubmit, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.userPromptSubmit.minPromptLength': 100,
      }),
    });
    service.start();
    userPromptSubmit.fire(userPromptPayload({ prompt: 'remember this' }));
    await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
    expect(curator.pushEvent).not.toHaveBeenCalled();
  });

  it('rate-limit exhausted pushes rate-limited event and skips curate', async () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());
    const { service, userPromptSubmit, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.maxCuratesPerHour': 2,
      }),
      rateLimiter,
    });
    service.start();
    userPromptSubmit.fire(userPromptPayload());
    userPromptSubmit.fire(userPromptPayload());
    userPromptSubmit.fire(userPromptPayload());
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(2);
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'rate-limited',
        stats: expect.objectContaining({
          source: 'user-cue',
          limit: 2,
        }),
      }),
    );
  });

  it('empty sessionId in payload short-circuits before rate-limit acquire', async () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());
    const acquireSpy = jest.spyOn(rateLimiter, 'tryAcquire');
    const { service, userPromptSubmit, curator } = buildService({
      rateLimiter,
    });
    service.start();
    userPromptSubmit.fire(userPromptPayload({ sessionId: '' }));
    await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
    expect(curator.pushEvent).not.toHaveBeenCalled();
    expect(acquireSpy).not.toHaveBeenCalled();
  });

  it('userPromptSubmit enabled=false short-circuits handler', async () => {
    const { service, userPromptSubmit, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.userPromptSubmit.enabled': false,
      }),
    });
    service.start();
    userPromptSubmit.fire(userPromptPayload());
    await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
    expect(curator.pushEvent).not.toHaveBeenCalled();
  });

  it('settings race: flipping cueList while running uses new compiled cues on next event', async () => {
    const cfg: Record<string, unknown> = {
      'memory.triggers.idleMs': 0,
      'memory.triggers.turnThreshold': 0,
      'memory.triggers.userPromptSubmit.enabled': true,
      'memory.triggers.userPromptSubmit.cueList': ['no-match'],
      'memory.triggers.userPromptSubmit.minPromptLength': 5,
      'memory.triggers.postToolUse.enabled': true,
      'memory.triggers.maxCuratesPerHour': 100,
    };
    const workspace = {
      getWorkspaceRoot: jest.fn(() => '/ws'),
      getWorkspaceFolders: jest.fn(() => ['/ws']),
      getConfiguration: jest.fn(
        (_section: string, key: string, def: unknown) => cfg[key] ?? def,
      ),
      setConfiguration: jest.fn().mockResolvedValue(undefined),
      onDidChangeConfiguration: jest.fn(),
      onDidChangeWorkspaceFolders: jest.fn(),
    } as unknown as IWorkspaceProvider;

    const { service, userPromptSubmit, curator } = buildService({ workspace });
    service.start();
    userPromptSubmit.fire(
      userPromptPayload({ prompt: 'remember this critical detail please' }),
    );
    await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();

    cfg['memory.triggers.userPromptSubmit.cueList'] = ['remember'];
    userPromptSubmit.fire(
      userPromptPayload({ prompt: 'remember this critical detail please' }),
    );
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);
  });
});

describe('MemoryTriggerService — commit-detect trigger', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('Bash git commit with exitCode 0 + success fires curate + commit-detect event', async () => {
    const { service, postToolUse, curator } = buildService();
    service.start();
    postToolUse.fire(postToolUsePayload());
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        workspaceRoot: '/ws',
        transcript: expect.stringContaining('commits=1'),
        salienceBoost: 0.1,
      }),
    );
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'commit-detect', sessionId: 's1' }),
    );
  });

  it('Bash git commit with non-zero exit does not fire', async () => {
    const { service, postToolUse, curator } = buildService();
    service.start();
    postToolUse.fire(postToolUsePayload({ exitCode: 1, success: false }));
    await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
  });

  it('non-Bash tool is ignored entirely', async () => {
    const { service, postToolUse, curator } = buildService();
    service.start();
    postToolUse.fire(
      postToolUsePayload({ toolName: 'Edit', toolInput: { command: 'x' } }),
    );
    await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
    expect(curator.pushEvent).not.toHaveBeenCalled();
  });

  it('rate-limited path pushes rate-limited and skips curate', async () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());
    const { service, postToolUse, curator } = buildService({
      workspace: makeWorkspace({ 'memory.triggers.maxCuratesPerHour': 1 }),
      rateLimiter,
    });
    service.start();
    postToolUse.fire(postToolUsePayload());
    postToolUse.fire(postToolUsePayload());
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'rate-limited',
        stats: expect.objectContaining({ source: 'commit-detect', limit: 1 }),
      }),
    );
  });

  it('maxCuratesPerHour=0 short-circuits to allow-all (no rate-limit)', async () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());
    const { service, postToolUse, curator } = buildService({
      workspace: makeWorkspace({ 'memory.triggers.maxCuratesPerHour': 0 }),
      rateLimiter,
    });
    service.start();
    for (let i = 0; i < 50; i++) {
      postToolUse.fire(postToolUsePayload({ timestamp: i }));
    }
    for (let i = 0; i < 400; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(50);
    expect(curator.pushEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'rate-limited' }),
    );
  });

  it('postToolUse enabled=false short-circuits handler', async () => {
    const { service, postToolUse, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.postToolUse.enabled': false,
      }),
    });
    service.start();
    postToolUse.fire(postToolUsePayload());
    await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
  });

  it('Bash non-commit command (e.g. git status) is ignored', async () => {
    const { service, postToolUse, curator } = buildService();
    service.start();
    postToolUse.fire(
      postToolUsePayload({ toolInput: { command: 'git status' } }),
    );
    await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
  });

  it('hyphenated git commit forms (e.g. git commit-hook) are ignored', async () => {
    const { service, postToolUse, curator } = buildService();
    service.start();
    postToolUse.fire(
      postToolUsePayload({
        toolInput: { command: 'git commit-hook --install' },
      }),
    );
    await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
    expect(curator.pushEvent).not.toHaveBeenCalled();
  });

  it('empty sessionId in payload short-circuits before rate-limit acquire', async () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());
    const acquireSpy = jest.spyOn(rateLimiter, 'tryAcquire');
    const { service, postToolUse, curator } = buildService({ rateLimiter });
    service.start();
    postToolUse.fire(postToolUsePayload({ sessionId: '' }));
    await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
    expect(curator.pushEvent).not.toHaveBeenCalled();
    expect(acquireSpy).not.toHaveBeenCalled();
  });
});

describe('MemoryTriggerService — lifecycle and rate-limit windows', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('start attaches user-prompt-submit and post-tool-use disposers; stop detaches', () => {
    const { service, userPromptSubmit, postToolUse } = buildService();
    expect(userPromptSubmit.registry.size).toBe(0);
    expect(postToolUse.registry.size).toBe(0);
    service.start();
    expect(userPromptSubmit.registry.size).toBe(1);
    expect(postToolUse.registry.size).toBe(1);
    service.stop();
    expect(userPromptSubmit.registry.size).toBe(0);
    expect(postToolUse.registry.size).toBe(0);
  });

  it('rate-limit hour rollover allows fires again after window resets', async () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());
    const { service, postToolUse, curator } = buildService({
      workspace: makeWorkspace({ 'memory.triggers.maxCuratesPerHour': 1 }),
      rateLimiter,
    });
    service.start();
    const t0 = Date.UTC(2026, 4, 21, 10, 0, 0);
    jest.setSystemTime(new Date(t0));
    postToolUse.fire(postToolUsePayload({ timestamp: t0 }));
    postToolUse.fire(postToolUsePayload({ timestamp: t0 + 100 }));
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);
    jest.setSystemTime(new Date(t0 + 3_600_001));
    postToolUse.fire(postToolUsePayload({ timestamp: t0 + 3_600_001 }));
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(2);
  });
});

describe('MemoryTriggerService — episode / failure / session-end', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('tool failure is buffered and pushes a tool-failure event without curating', async () => {
    const { service, toolFailure, curator } = buildService();
    service.start();
    toolFailure.fire({
      toolName: 'Bash',
      toolInput: { command: 'npm test' },
      error: 'tests failed',
      isInterrupt: false,
      sessionId: 's1',
      workspaceRoot: '/ws',
      timestamp: 10,
    });
    await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'tool-failure',
        stats: expect.objectContaining({ tool: 'Bash' }),
      }),
    );
  });

  it('error→recovery fires episode-trigger with critical-learning salience boost', async () => {
    const { service, toolFailure, postToolUse, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 0,
      }),
    });
    service.start();
    toolFailure.fire({
      toolName: 'Bash',
      toolInput: { command: 'npm test' },
      error: 'TypeError: x is undefined',
      isInterrupt: false,
      sessionId: 's1',
      workspaceRoot: '/ws',
      timestamp: 10,
    });
    postToolUse.fire(
      postToolUsePayload({
        toolInput: { command: 'npm test' },
        exitCode: 0,
        success: true,
      }),
    );
    await Promise.resolve();
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'episode-trigger',
        stats: expect.objectContaining({ critical: true }),
      }),
    );
    expect(curator.curate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        transcript: expect.stringContaining('recovered=1'),
        salienceBoost: 0.2,
      }),
    );
  });

  it('interrupt failures are not buffered', async () => {
    const { service, toolFailure, curator } = buildService();
    service.start();
    toolFailure.fire({
      toolName: 'Bash',
      toolInput: {},
      error: 'aborted',
      isInterrupt: true,
      sessionId: 's1',
      workspaceRoot: '/ws',
      timestamp: 10,
    });
    await Promise.resolve();
    expect(curator.pushEvent).not.toHaveBeenCalled();
  });

  it('SessionEnd hook flushes the buffered episode', async () => {
    const { service, stop, sessionEndHook, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 0,
      }),
    });
    service.start();
    stop.fire(stopPayload());
    sessionEndHook.fire({
      sessionId: 's1',
      workspaceRoot: '/ws',
      reason: 'clear',
      timestamp: 20,
    });
    await Promise.resolve();
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'session-end-trigger' }),
    );
    expect(curator.curate).toHaveBeenCalledTimes(1);
  });

  it('SessionEnd hook with empty episode does not curate', async () => {
    const { service, sessionEndHook, curator } = buildService();
    service.start();
    sessionEndHook.fire({
      sessionId: 's1',
      workspaceRoot: '/ws',
      reason: 'logout',
      timestamp: 20,
    });
    await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
  });

  it('sessionEnd disabled resets the buffer without curating', async () => {
    const { service, stop, sessionEndHook, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 0,
        'memory.triggers.sessionEnd.enabled': false,
      }),
    });
    service.start();
    stop.fire(stopPayload());
    sessionEndHook.fire({
      sessionId: 's1',
      workspaceRoot: '/ws',
      reason: 'clear',
      timestamp: 20,
    });
    await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
  });
});

describe('MemoryTriggerService — buffer preservation under rate-limit', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('rate-limit denial on a commit boundary PRESERVES the buffer so the next boundary curates', async () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());
    const { service, postToolUse, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 0,
        'memory.triggers.maxCuratesPerHour': 1,
      }),
      rateLimiter,
    });
    service.start();

    const t0 = Date.UTC(2026, 4, 21, 10, 0, 0);
    jest.setSystemTime(new Date(t0));

    postToolUse.fire(postToolUsePayload({ timestamp: t0 }));
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);

    postToolUse.fire(postToolUsePayload({ timestamp: t0 + 100 }));
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'rate-limited',
        stats: expect.objectContaining({ source: 'commit-detect' }),
      }),
    );

    jest.setSystemTime(new Date(t0 + 3_600_001));
    postToolUse.fire(postToolUsePayload({ timestamp: t0 + 3_600_001 }));
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(2);
    expect(curator.curate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        transcript: expect.stringContaining('commits=2'),
      }),
    );
  });

  it('reviewer fix: session-end while rate-limited does NOT curate but RESETS the buffer (no stale curate next boundary)', async () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());
    const { service, stop, sessionEndHook, postToolUse, curator } =
      buildService({
        workspace: makeWorkspace({
          'memory.triggers.idleMs': 0,
          'memory.triggers.turnThreshold': 0,
          'memory.triggers.maxCuratesPerHour': 1,
        }),
        rateLimiter,
      });
    service.start();

    const t0 = Date.UTC(2026, 4, 21, 10, 0, 0);
    jest.setSystemTime(new Date(t0));

    postToolUse.fire(postToolUsePayload({ timestamp: t0 }));
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);

    stop.fire(stopPayload({ timestamp: t0 + 50 }));
    sessionEndHook.fire({
      sessionId: 's1',
      workspaceRoot: '/ws',
      reason: 'clear',
      timestamp: t0 + 100,
    });
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'rate-limited',
        stats: expect.objectContaining({ source: 'session-end' }),
      }),
    );

    jest.setSystemTime(new Date(t0 + 3_600_001));
    sessionEndHook.fire({
      sessionId: 's1',
      workspaceRoot: '/ws',
      reason: 'clear',
      timestamp: t0 + 3_600_001,
    });
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);
  });

  it('contrast: a non-session-end boundary preserves the buffer where session-end discards it', async () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());
    const { service, stop, postToolUse, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 0,
        'memory.triggers.maxCuratesPerHour': 1,
      }),
      rateLimiter,
    });
    service.start();

    const t0 = Date.UTC(2026, 4, 21, 10, 0, 0);
    jest.setSystemTime(new Date(t0));

    postToolUse.fire(postToolUsePayload({ timestamp: t0 }));
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);

    stop.fire(stopPayload({ timestamp: t0 + 50 }));
    postToolUse.fire(postToolUsePayload({ timestamp: t0 + 100 }));
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date(t0 + 3_600_001));
    postToolUse.fire(postToolUsePayload({ timestamp: t0 + 3_600_001 }));
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(2);
    expect(curator.curate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        transcript: expect.stringContaining('Did some work this turn.'),
      }),
    );
  });
});

describe('MemoryTriggerService — turn recording independent of firing', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('Stop with hasBackgroundWork=true never fires turn-complete but still records the turn for a later flush', async () => {
    const { service, stop, sessionEndHook, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 1,
      }),
    });
    service.start();
    stop.fire(stopPayload({ hasBackgroundWork: true, timestamp: 1 }));
    await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();

    sessionEndHook.fire({
      sessionId: 's1',
      workspaceRoot: '/ws',
      reason: 'clear',
      timestamp: 2,
    });
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);
    expect(curator.curate).toHaveBeenCalledWith(
      expect.objectContaining({
        transcript: expect.stringContaining('Did some work this turn.'),
      }),
    );
  });

  it('error→recovery records recovery bookkeeping even when episode.enabled=false (later boundary sees critical learning)', async () => {
    const { service, toolFailure, postToolUse, sessionEndHook, curator } =
      buildService({
        workspace: makeWorkspace({
          'memory.triggers.idleMs': 0,
          'memory.triggers.turnThreshold': 0,
          'memory.triggers.episode.enabled': false,
        }),
      });
    service.start();
    toolFailure.fire({
      toolName: 'Bash',
      toolInput: { command: 'npm test' },
      error: 'TypeError',
      isInterrupt: false,
      sessionId: 's1',
      workspaceRoot: '/ws',
      timestamp: 10,
    });
    postToolUse.fire(
      postToolUsePayload({
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
        exitCode: 0,
        success: true,
        timestamp: 20,
      }),
    );
    await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
    expect(curator.pushEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'episode-trigger' }),
    );

    sessionEndHook.fire({
      sessionId: 's1',
      workspaceRoot: '/ws',
      reason: 'clear',
      timestamp: 30,
    });
    await Promise.resolve();
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'session-end-trigger',
        stats: expect.objectContaining({ critical: true }),
      }),
    );
    expect(curator.curate).toHaveBeenCalledWith(
      expect.objectContaining({
        transcript: expect.stringContaining('recovered=1'),
        salienceBoost: 0.2,
      }),
    );
  });
});

describe('MemoryTriggerService — salience boost threading', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('user-cue forwards the prompt as transcript WITHOUT a salienceBoost field', async () => {
    const { service, userPromptSubmit, curator } = buildService();
    service.start();
    userPromptSubmit.fire(userPromptPayload());
    await Promise.resolve();
    const call = (curator.curate as jest.Mock).mock.calls[0][0];
    expect(call.salienceBoost).toBeUndefined();
    expect(call.transcript).toEqual(
      expect.stringContaining(
        'please remember this important fact about the codebase',
      ),
    );
  });

  it('commit boundary threads a salienceBoost into curate()', async () => {
    const { service, postToolUse, curator } = buildService();
    service.start();
    postToolUse.fire(postToolUsePayload());
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledWith(
      expect.objectContaining({ salienceBoost: 0.1 }),
    );
  });

  it('episode boundary threads the critical-learning salienceBoost into curate()', async () => {
    const { service, toolFailure, postToolUse, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 0,
      }),
    });
    service.start();
    toolFailure.fire({
      toolName: 'Bash',
      toolInput: { command: 'npm test' },
      error: 'TypeError',
      isInterrupt: false,
      sessionId: 's1',
      workspaceRoot: '/ws',
      timestamp: 10,
    });
    postToolUse.fire(
      postToolUsePayload({
        toolInput: { command: 'npm test' },
        exitCode: 0,
        success: true,
      }),
    );
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledWith(
      expect.objectContaining({ salienceBoost: 0.2 }),
    );
  });
});

describe('MemoryTriggerService — observation queue side effects', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('onUserPromptSubmit inserts a user-prompt row BEFORE the cue-match early-return (prompt always captured)', () => {
    const { service, userPromptSubmit, queue } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.userPromptSubmit.cueList': ['will-not-match'],
      }),
    });
    service.start();
    userPromptSubmit.fire(
      userPromptPayload({ prompt: 'a non-matching prompt about the project' }),
    );
    expect(queue.inserts).toContainEqual(
      expect.objectContaining({
        kind: 'user-prompt',
        userPrompt: 'a non-matching prompt about the project',
        sessionId: 's1',
      }),
    );
  });

  it('onUserPromptSubmit inserts a row even when the enabled gate is false', () => {
    const { service, userPromptSubmit, queue } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.userPromptSubmit.enabled': false,
      }),
    });
    service.start();
    userPromptSubmit.fire(userPromptPayload());
    expect(queue.inserts).toContainEqual(
      expect.objectContaining({ kind: 'user-prompt' }),
    );
  });

  it('onPostToolUse inserts a tool-use row BEFORE the commit-detect / episode branches', () => {
    const { service, postToolUse, queue } = buildService();
    service.start();
    postToolUse.fire(
      postToolUsePayload({
        toolName: 'Edit',
        toolInput: { file_path: '/ws/x.ts' },
        toolOutput: 'ok',
      }),
    );
    expect(queue.inserts).toContainEqual(
      expect.objectContaining({
        kind: 'tool-use',
        toolName: 'Edit',
        toolResponseText: 'ok',
      }),
    );
  });

  it('onStop inserts an assistant-turn row capturing the assistant message', () => {
    const { service, stop, queue } = buildService();
    service.start();
    stop.fire(stopPayload({ lastAssistantMessage: 'turn body content' }));
    expect(queue.inserts).toContainEqual(
      expect.objectContaining({
        kind: 'assistant-turn',
        assistantMessage: 'turn body content',
      }),
    );
  });

  it('onToolFailure inserts a tool-failure row', () => {
    const { service, toolFailure, queue } = buildService();
    service.start();
    toolFailure.fire({
      toolName: 'Bash',
      toolInput: { command: 'npm test' },
      error: 'TypeError: x is undefined',
      isInterrupt: false,
      sessionId: 's1',
      workspaceRoot: '/ws',
      timestamp: 10,
    });
    expect(queue.inserts).toContainEqual(
      expect.objectContaining({
        kind: 'tool-failure',
        toolName: 'Bash',
        toolResponseText: 'TypeError: x is undefined',
      }),
    );
  });

  it('onPreToolUseRead inserts a file-read row only when toolName is Read', () => {
    const { service, preToolUse, queue } = buildService();
    service.start();
    preToolUse.fire({
      toolName: 'Read',
      toolInput: { file_path: '/ws/src/index.ts' },
      sessionId: 's1',
      workspaceRoot: '/ws',
      timestamp: 1,
    });
    expect(queue.inserts).toContainEqual(
      expect.objectContaining({
        kind: 'file-read',
        filePath: '/ws/src/index.ts',
      }),
    );
    queue.inserts.length = 0;
    preToolUse.fire({
      toolName: 'Edit',
      toolInput: { file_path: '/ws/src/index.ts' },
      sessionId: 's1',
      workspaceRoot: '/ws',
      timestamp: 2,
    });
    expect(queue.inserts).toHaveLength(0);
  });

  it('commit-detect path inserts a commit row in addition to the tool-use row', () => {
    const { service, postToolUse, queue } = buildService();
    service.start();
    postToolUse.fire(postToolUsePayload());
    const kinds = queue.inserts.map((i) => i.kind);
    expect(kinds).toContain('tool-use');
    expect(kinds).toContain('commit');
  });
});

describe('MemoryTriggerService — invokeCurate transcript composition + queue lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('invokeCurate composes JSONL excerpt + structured observation log + episode summary', async () => {
    const queue = makeObservationQueue();
    queue.rowsBySession.set('s1', [
      {
        id: 1,
        sessionId: 's1',
        workspaceRoot: '/ws',
        kind: 'user-prompt',
        toolName: null,
        toolInputJson: null,
        toolResponseText: null,
        assistantMessage: null,
        userPrompt: 'queued user prompt content',
        filePath: null,
        promptNumber: null,
        capturedAt: 100,
        processedAt: null,
      },
    ]);
    const { service, stop, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 1,
      }),
      transcriptText: '{"role":"user","content":"recorded jsonl line"}',
      observationQueue: queue,
    });
    service.start();
    stop.fire(stopPayload({ lastAssistantMessage: 'assistant body' }));
    await Promise.resolve();
    const lastCall = (curator.curate as jest.Mock).mock.calls.at(-1)[0];
    expect(lastCall.transcript).toEqual(
      expect.stringContaining('# Session JSONL excerpt'),
    );
    expect(lastCall.transcript).toEqual(
      expect.stringContaining('recorded jsonl line'),
    );
    expect(lastCall.transcript).toEqual(
      expect.stringContaining('# Structured observations from hooks'),
    );
    expect(lastCall.transcript).toEqual(
      expect.stringContaining('queued user prompt content'),
    );
    expect(lastCall.transcript).toEqual(
      expect.stringContaining('assistant body'),
    );
    expect(lastCall.transcript).toEqual(
      expect.stringContaining('# Episode summary'),
    );
    expect(lastCall.transcript).toEqual(expect.stringContaining('turns=1'));
  });

  it('markProcessed is called with drained ids ONLY after curator.curate resolves', async () => {
    const { service, stop, queue } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 1,
      }),
    });
    service.start();
    stop.fire(stopPayload({ lastAssistantMessage: 'a' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.markProcessed).toHaveBeenCalledTimes(1);
    const ids = (queue.markProcessed as jest.Mock).mock.calls[0][0];
    expect(Array.isArray(ids)).toBe(true);
    expect(ids.length).toBeGreaterThanOrEqual(1);
  });

  it('on curator failure, observation rows STAY unprocessed for retry on next trigger', async () => {
    const failingCurator = {
      curate: jest.fn().mockRejectedValue(new Error('curate boom')),
      pushEvent: jest.fn(),
      recentEvents: jest.fn(() => []),
      lastRunInfo: jest.fn(() => ({ at: null, stats: null })),
    } as unknown as MemoryCuratorService;
    const { service, stop, queue } = buildService({
      curator: failingCurator,
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 1,
      }),
    });
    service.start();
    stop.fire(stopPayload({ lastAssistantMessage: 'first attempt' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.markProcessed).not.toHaveBeenCalled();
    const unprocessed = (queue.rowsBySession.get('s1') ?? []).filter(
      (r) => r.processedAt === null,
    );
    expect(unprocessed.length).toBeGreaterThan(0);
  });

  it('drain limit is honoured: large queue is capped by memory.triggers.maxObservationsPerCurate', async () => {
    const queue = makeObservationQueue();
    const drainSpy = queue.store.drainForSession as jest.Mock;
    const { service, stop } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 1,
        'memory.triggers.maxObservationsPerCurate': 7,
      }),
      observationQueue: queue,
    });
    service.start();
    stop.fire(stopPayload());
    await Promise.resolve();
    expect(drainSpy).toHaveBeenCalledWith('s1', 7);
  });

  it('concurrent invokeCurate for the same (workspace, session) serializes: second drain waits for first curate to settle', async () => {
    const queue = makeObservationQueue();
    const drainSpy = queue.store.drainForSession as jest.Mock;
    const gateResolvers: Array<() => void> = [];
    const blockingCurator = {
      curate: jest.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            gateResolvers.push(() => resolve());
          }),
      ),
      pushEvent: jest.fn(),
      recentEvents: jest.fn(() => []),
      lastRunInfo: jest.fn(() => ({ at: null, stats: null })),
    } as unknown as MemoryCuratorService;
    const { service, stop } = buildService({
      curator: blockingCurator,
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 1,
      }),
      observationQueue: queue,
    });
    service.start();
    stop.fire(stopPayload({ timestamp: 1 }));
    stop.fire(stopPayload({ timestamp: 2 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(drainSpy).toHaveBeenCalledTimes(1);
    expect(blockingCurator.curate).toHaveBeenCalledTimes(1);
    gateResolvers[0]?.();
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(drainSpy).toHaveBeenCalledTimes(2);
    expect(blockingCurator.curate).toHaveBeenCalledTimes(2);
    gateResolvers[1]?.();
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
});
