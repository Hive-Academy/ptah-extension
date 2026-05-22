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
  UserPromptSubmitPayload,
} from '@ptah-extension/agent-sdk';
import { CuratorRateLimitService } from '@ptah-extension/agent-sdk';
import { MemoryTriggerService } from './memory-trigger.service';
import type { MemoryCuratorService } from '../memory-curator.service';

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

function buildService(opts?: {
  workspace?: IWorkspaceProvider;
  curator?: MemoryCuratorService;
  rateLimiter?: CuratorRateLimitService;
}): {
  service: MemoryTriggerService;
  activity: ActivityHarness;
  sessionEnd: SessionEndHarness;
  userPromptSubmit: UserPromptSubmitHarness;
  postToolUse: PostToolUseHarness;
  curator: MemoryCuratorService;
  workspace: IWorkspaceProvider;
  rateLimiter: CuratorRateLimitService;
} {
  const activity = makeActivityRegistry();
  const sessionEnd = makeSessionEndRegistry();
  const userPromptSubmit = makeUserPromptSubmitRegistry();
  const postToolUse = makePostToolUseRegistry();
  const curator = opts?.curator ?? makeCurator();
  const workspace = opts?.workspace ?? makeWorkspace();
  const rateLimiter =
    opts?.rateLimiter ?? new CuratorRateLimitService(makeLogger());
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
    rateLimiter,
  );
  return {
    service,
    activity,
    sessionEnd,
    userPromptSubmit,
    postToolUse,
    curator,
    workspace,
    rateLimiter,
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

  it('idle timer fires curate after idleMs', async () => {
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
    expect(curator.curate).toHaveBeenCalledWith({
      sessionId: 's1',
      workspaceRoot: '/ws',
      transcript: undefined,
    });
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'idle-trigger', sessionId: 's1' }),
    );
  });

  it('idle timer resets on new activity', async () => {
    const { service, activity, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 200,
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

  it('turn threshold fires at exactly N user-role activities', async () => {
    const { service, activity, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 3,
      }),
    });
    service.start();
    for (let i = 0; i < 2; i++) {
      activity.registry.notifyAll({
        sessionId: 's1',
        workspaceRoot: '/ws',
        role: 'user',
        timestamp: i,
      });
    }
    expect(curator.curate).not.toHaveBeenCalled();
    activity.registry.notifyAll({
      sessionId: 's1',
      workspaceRoot: '/ws',
      role: 'assistant',
      timestamp: 99,
    });
    expect(curator.curate).not.toHaveBeenCalled();
    activity.registry.notifyAll({
      sessionId: 's1',
      workspaceRoot: '/ws',
      role: 'user',
      timestamp: 3,
    });
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'turn-trigger' }),
    );
  });

  it('turn counter resets after firing', async () => {
    const { service, activity, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 2,
      }),
    });
    service.start();
    for (let i = 0; i < 4; i++) {
      activity.registry.notifyAll({
        sessionId: 's1',
        workspaceRoot: '/ws',
        role: 'user',
        timestamp: i,
      });
    }
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(2);
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

    const { service, activity, curator } = buildService({ workspace });
    service.start();
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

  it('events recorded for every trigger fire', async () => {
    const { service, activity, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 100,
        'memory.triggers.turnThreshold': 2,
      }),
    });
    service.start();
    activity.registry.notifyAll({
      sessionId: 's1',
      workspaceRoot: '/ws',
      role: 'user',
      timestamp: 1,
    });
    activity.registry.notifyAll({
      sessionId: 's1',
      workspaceRoot: '/ws',
      role: 'user',
      timestamp: 2,
    });
    await Promise.resolve();
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'turn-trigger' }),
    );
    jest.advanceTimersByTime(150);
    await Promise.resolve();
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'idle-trigger' }),
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
    expect(curator.curate).toHaveBeenCalledWith({
      sessionId: 's1',
      workspaceRoot: '/ws',
      transcript:
        'please remember this important fact about the project layout',
    });
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
    await Promise.resolve();
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
    expect(curator.curate).toHaveBeenCalledWith({
      sessionId: 's1',
      workspaceRoot: '/ws',
      transcript: undefined,
    });
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
    await Promise.resolve();
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
    await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(2);
  });
});
