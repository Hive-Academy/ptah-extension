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
  SubagentStopCallback,
  SubagentStopCallbackRegistry,
  SubagentStopPayload,
} from '@ptah-extension/agent-sdk';
import { CuratorRateLimitService } from '@ptah-extension/agent-sdk';
import { SkillTriggerService } from './skill-trigger.service';
import type { SkillSynthesisService } from '../skill-synthesis.service';

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

interface ActivityHarness {
  registry: SessionActivityRegistry;
}

function makeActivityRegistry(): ActivityHarness {
  let active: SessionActivityCallback | null = null;
  return {
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

interface SubagentStopHarness {
  registry: SubagentStopCallbackRegistry;
  fire: (payload: SubagentStopPayload) => void;
}

function makeSubagentStopRegistry(): SubagentStopHarness {
  const subscribers = new Set<SubagentStopCallback>();
  return {
    fire: (payload) => {
      for (const cb of subscribers) cb(payload);
    },
    registry: {
      register: jest.fn((cb: SubagentStopCallback) => {
        subscribers.add(cb);
        return () => {
          subscribers.delete(cb);
        };
      }),
      notifyAll: jest.fn((payload: SubagentStopPayload) => {
        for (const cb of subscribers) cb(payload);
      }),
      get size() {
        return subscribers.size;
      },
    } as unknown as SubagentStopCallbackRegistry,
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
    'skillSynthesis.triggers.sessionEnd': true,
    'skillSynthesis.triggers.idleMs': 600000,
    'skillSynthesis.triggers.bootScan': false,
    'skillSynthesis.triggers.subagentStop.enabled': true,
    'skillSynthesis.triggers.postToolUse.enabled': true,
    'skillSynthesis.triggers.postToolUse.minEditCount': 3,
    'skillSynthesis.triggers.maxAnalyzesPerHour': 6,
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

function makeSynthesis(): SkillSynthesisService {
  return {
    analyzeSession: jest.fn().mockResolvedValue(null),
    pushEvent: jest.fn(),
    recentEvents: jest.fn(() => []),
    getEligibilityHistogram: jest.fn(() => ({
      tooFewTurns: 0,
      lowFidelity: 0,
      insufficientAbstraction: 0,
      accepted: 0,
    })),
    lastRunSummary: jest.fn(() => ({
      lastAnalyzeRunAt: null,
      lastCuratorPassAt: null,
    })),
  } as unknown as SkillSynthesisService;
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
  synthesis?: SkillSynthesisService;
  rateLimiter?: CuratorRateLimitService;
}): {
  service: SkillTriggerService;
  activity: ActivityHarness;
  sessionEnd: SessionEndHarness;
  subagentStop: SubagentStopHarness;
  postToolUse: PostToolUseHarness;
  synthesis: SkillSynthesisService;
  workspace: IWorkspaceProvider;
  rateLimiter: CuratorRateLimitService;
} {
  const activity = makeActivityRegistry();
  const sessionEnd = makeSessionEndRegistry();
  const subagentStop = makeSubagentStopRegistry();
  const postToolUse = makePostToolUseRegistry();
  const synthesis = opts?.synthesis ?? makeSynthesis();
  const workspace = opts?.workspace ?? makeWorkspace();
  const rateLimiter =
    opts?.rateLimiter ?? new CuratorRateLimitService(makeLogger());
  const service = new SkillTriggerService(
    makeLogger(),
    synthesis,
    activity.registry,
    sessionEnd.endRegistry,
    workspace,
    makeFs(),
    makeSqlite(),
    makeJsonl(),
    subagentStop.registry,
    postToolUse.registry,
    rateLimiter,
  );
  return {
    service,
    activity,
    sessionEnd,
    subagentStop,
    postToolUse,
    synthesis,
    workspace,
    rateLimiter,
  };
}

function subagentStopPayload(
  overrides?: Partial<SubagentStopPayload>,
): SubagentStopPayload {
  return {
    subagentSessionId: 'sub-aaaa-bbbb-cccc-dddd',
    parentSessionId: 'parent-1',
    workspaceRoot: '/ws',
    agentId: 'agent-1',
    agentType: 'general',
    transcriptPath: '/tmp/agents/sub-aaaa-bbbb-cccc-dddd.jsonl',
    timestamp: 1000,
    ...overrides,
  };
}

function postToolUsePayload(
  overrides?: Partial<PostToolUsePayload>,
): PostToolUsePayload {
  return {
    toolName: 'Edit',
    toolInput: { command: 'noop' },
    toolOutput: '',
    exitCode: 0,
    success: true,
    sessionId: 's1',
    workspaceRoot: '/ws',
    timestamp: 1000,
    ...overrides,
  };
}

describe('SkillTriggerService', () => {
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

  it('idle timer fires analyzeSession after idleMs', async () => {
    const { service, activity, synthesis } = buildService({
      workspace: makeWorkspace({
        'skillSynthesis.triggers.idleMs': 100,
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
    expect(synthesis.analyzeSession).toHaveBeenCalledWith('s1', '/ws', {
      force: false,
    });
    expect(synthesis.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'idle-trigger', sessionId: 's1' }),
    );
  });

  it('idle timer resets on new activity', async () => {
    const { service, activity, synthesis } = buildService({
      workspace: makeWorkspace({
        'skillSynthesis.triggers.idleMs': 200,
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
    expect(synthesis.analyzeSession).not.toHaveBeenCalled();
    jest.advanceTimersByTime(120);
    await Promise.resolve();
    expect(synthesis.analyzeSession).toHaveBeenCalledTimes(1);
  });

  it('stop() clears all timers', () => {
    const { service, activity } = buildService({
      workspace: makeWorkspace({
        'skillSynthesis.triggers.idleMs': 100,
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

  it('session-end clears pending idle timer (R2)', () => {
    const { service, activity, sessionEnd, synthesis } = buildService({
      workspace: makeWorkspace({
        'skillSynthesis.triggers.idleMs': 100,
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
    expect(synthesis.analyzeSession).not.toHaveBeenCalled();
  });

  it('settings race: re-reads idleMs on every event (R7)', async () => {
    const cfg: Record<string, unknown> = {
      'skillSynthesis.triggers.idleMs': 100,
      'skillSynthesis.triggers.bootScan': false,
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

    const { service, activity, synthesis } = buildService({ workspace });
    service.start();
    activity.registry.notifyAll({
      sessionId: 's1',
      workspaceRoot: '/ws',
      role: 'user',
      timestamp: 1,
    });
    cfg['skillSynthesis.triggers.idleMs'] = 500;
    activity.registry.notifyAll({
      sessionId: 's1',
      workspaceRoot: '/ws',
      role: 'user',
      timestamp: 2,
    });
    jest.advanceTimersByTime(150);
    expect(synthesis.analyzeSession).not.toHaveBeenCalled();
    jest.advanceTimersByTime(400);
    await Promise.resolve();
    expect(synthesis.analyzeSession).toHaveBeenCalledTimes(1);
  });

  it('records error event when analyzeSession throws', async () => {
    const synthesis = makeSynthesis();
    (synthesis.analyzeSession as jest.Mock).mockRejectedValueOnce(
      new Error('boom'),
    );
    const { service, activity } = buildService({
      synthesis,
      workspace: makeWorkspace({
        'skillSynthesis.triggers.idleMs': 100,
      }),
    });
    service.start();
    activity.registry.notifyAll({
      sessionId: 's1',
      workspaceRoot: '/ws',
      role: 'user',
      timestamp: 1,
    });
    jest.advanceTimersByTime(150);
    await Promise.resolve();
    await Promise.resolve();
    expect(synthesis.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', sessionId: 's1' }),
    );
  });

  it('idleMs <= 0 disables idle trigger', () => {
    const { service, activity, synthesis } = buildService({
      workspace: makeWorkspace({
        'skillSynthesis.triggers.idleMs': 0,
      }),
    });
    service.start();
    activity.registry.notifyAll({
      sessionId: 's1',
      workspaceRoot: '/ws',
      role: 'user',
      timestamp: 1,
    });
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(1000);
    expect(synthesis.analyzeSession).not.toHaveBeenCalled();
  });
});

describe('SkillTriggerService — subagent-stop trigger', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('fires analyze with subagent sessionId and emits subagent-stop event', async () => {
    const { service, subagentStop, synthesis } = buildService();
    service.start();
    subagentStop.fire(subagentStopPayload());
    await Promise.resolve();
    expect(synthesis.analyzeSession).toHaveBeenCalledWith(
      'sub-aaaa-bbbb-cccc-dddd',
      '/ws',
      { force: false },
    );
    expect(synthesis.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'subagent-stop',
        sessionId: 'sub-aaaa-bbbb-cccc-dddd',
      }),
    );
  });

  it('rate-limited path emits rate-limited and skips analyze', async () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());
    const { service, subagentStop, synthesis } = buildService({
      workspace: makeWorkspace({
        'skillSynthesis.triggers.maxAnalyzesPerHour': 1,
      }),
      rateLimiter,
    });
    service.start();
    subagentStop.fire(subagentStopPayload({ subagentSessionId: 'a' }));
    subagentStop.fire(subagentStopPayload({ subagentSessionId: 'b' }));
    await Promise.resolve();
    expect(synthesis.analyzeSession).toHaveBeenCalledTimes(1);
    expect(synthesis.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'rate-limited',
        stats: expect.objectContaining({ source: 'subagent-stop', limit: 1 }),
      }),
    );
  });

  it('empty subagentSessionId in payload short-circuits before rate-limit acquire', async () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());
    const acquireSpy = jest.spyOn(rateLimiter, 'tryAcquire');
    const { service, subagentStop, synthesis } = buildService({ rateLimiter });
    service.start();
    subagentStop.fire(subagentStopPayload({ subagentSessionId: '' }));
    await Promise.resolve();
    expect(synthesis.analyzeSession).not.toHaveBeenCalled();
    expect(synthesis.pushEvent).not.toHaveBeenCalled();
    expect(acquireSpy).not.toHaveBeenCalled();
  });

  it('subagentStop enabled=false short-circuits handler', async () => {
    const { service, subagentStop, synthesis } = buildService({
      workspace: makeWorkspace({
        'skillSynthesis.triggers.subagentStop.enabled': false,
      }),
    });
    service.start();
    subagentStop.fire(subagentStopPayload());
    await Promise.resolve();
    expect(synthesis.analyzeSession).not.toHaveBeenCalled();
    expect(synthesis.pushEvent).not.toHaveBeenCalled();
  });
});

describe('SkillTriggerService — edit-then-test FSM', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('3 Edit events + 1 Bash npm test (exit 0) fires analyze + edit-then-test event', async () => {
    const { service, postToolUse, synthesis } = buildService();
    service.start();
    for (let i = 0; i < 3; i++) {
      postToolUse.fire(
        postToolUsePayload({ toolName: 'Edit', timestamp: 1000 + i }),
      );
    }
    postToolUse.fire(
      postToolUsePayload({
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
        timestamp: 2000,
      }),
    );
    await Promise.resolve();
    expect(synthesis.analyzeSession).toHaveBeenCalledWith('s1', '/ws', {
      force: false,
    });
    expect(synthesis.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'edit-then-test',
        sessionId: 's1',
        stats: { editCount: 3 },
      }),
    );
  });

  it('only 2 Edits + npm test does NOT fire (below minEditCount)', async () => {
    const { service, postToolUse, synthesis } = buildService();
    service.start();
    postToolUse.fire(postToolUsePayload({ toolName: 'Edit', timestamp: 1000 }));
    postToolUse.fire(
      postToolUsePayload({ toolName: 'Write', timestamp: 1001 }),
    );
    postToolUse.fire(
      postToolUsePayload({
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
        timestamp: 2000,
      }),
    );
    await Promise.resolve();
    expect(synthesis.analyzeSession).not.toHaveBeenCalled();
  });

  it('3 Edits + Bash git status does NOT fire (not a test command)', async () => {
    const { service, postToolUse, synthesis } = buildService();
    service.start();
    for (let i = 0; i < 3; i++) {
      postToolUse.fire(
        postToolUsePayload({ toolName: 'Edit', timestamp: 1000 + i }),
      );
    }
    postToolUse.fire(
      postToolUsePayload({
        toolName: 'Bash',
        toolInput: { command: 'git status' },
        timestamp: 2000,
      }),
    );
    await Promise.resolve();
    expect(synthesis.analyzeSession).not.toHaveBeenCalled();
  });

  it('11 minutes between edits and test causes window to expire (no fire)', async () => {
    const { service, postToolUse, synthesis } = buildService();
    service.start();
    for (let i = 0; i < 3; i++) {
      postToolUse.fire(
        postToolUsePayload({ toolName: 'Edit', timestamp: 1000 + i }),
      );
    }
    postToolUse.fire(
      postToolUsePayload({
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
        timestamp: 1000 + 11 * 60 * 1000,
      }),
    );
    await Promise.resolve();
    expect(synthesis.analyzeSession).not.toHaveBeenCalled();
  });

  it('SessionEnd between Edits and test clears state — no fire (R3)', async () => {
    const { service, postToolUse, sessionEnd, synthesis } = buildService();
    service.start();
    for (let i = 0; i < 3; i++) {
      postToolUse.fire(
        postToolUsePayload({ toolName: 'Edit', timestamp: 1000 + i }),
      );
    }
    sessionEnd.endActive.current?.({ sessionId: 's1', workspaceRoot: '/ws' });
    postToolUse.fire(
      postToolUsePayload({
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
        timestamp: 2000,
      }),
    );
    await Promise.resolve();
    expect(synthesis.analyzeSession).not.toHaveBeenCalled();
  });

  it('rate-limited path emits rate-limited and clears edit state', async () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());
    const { service, postToolUse, synthesis } = buildService({
      workspace: makeWorkspace({
        'skillSynthesis.triggers.maxAnalyzesPerHour': 0,
      }),
      rateLimiter,
    });
    rateLimiter.tryAcquire('skill.analyze', 1);
    const {
      service: s2,
      postToolUse: p2,
      synthesis: syn2,
    } = buildService({
      workspace: makeWorkspace({
        'skillSynthesis.triggers.maxAnalyzesPerHour': 1,
      }),
      rateLimiter,
    });
    s2.start();
    for (let i = 0; i < 3; i++) {
      p2.fire(postToolUsePayload({ toolName: 'Edit', timestamp: 1000 + i }));
    }
    p2.fire(
      postToolUsePayload({
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
        timestamp: 2000,
      }),
    );
    await Promise.resolve();
    expect(syn2.analyzeSession).not.toHaveBeenCalled();
    expect(syn2.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'rate-limited',
        stats: expect.objectContaining({ source: 'edit-then-test' }),
      }),
    );
    expect(service).toBeDefined();
    expect(postToolUse).toBeDefined();
    expect(synthesis).toBeDefined();
  });

  it('maxAnalyzesPerHour=0 short-circuits to allow-all', async () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());
    const { service, postToolUse, synthesis } = buildService({
      workspace: makeWorkspace({
        'skillSynthesis.triggers.maxAnalyzesPerHour': 0,
      }),
      rateLimiter,
    });
    service.start();
    for (let cycle = 0; cycle < 5; cycle++) {
      for (let i = 0; i < 3; i++) {
        postToolUse.fire(
          postToolUsePayload({
            toolName: 'Edit',
            timestamp: cycle * 10000 + i,
          }),
        );
      }
      postToolUse.fire(
        postToolUsePayload({
          toolName: 'Bash',
          toolInput: { command: 'npm test' },
          timestamp: cycle * 10000 + 100,
        }),
      );
    }
    await Promise.resolve();
    expect(synthesis.analyzeSession).toHaveBeenCalledTimes(5);
  });

  it('postToolUse enabled=false short-circuits handler', async () => {
    const { service, postToolUse, synthesis } = buildService({
      workspace: makeWorkspace({
        'skillSynthesis.triggers.postToolUse.enabled': false,
      }),
    });
    service.start();
    for (let i = 0; i < 3; i++) {
      postToolUse.fire(
        postToolUsePayload({ toolName: 'Edit', timestamp: 1000 + i }),
      );
    }
    postToolUse.fire(
      postToolUsePayload({
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
        timestamp: 2000,
      }),
    );
    await Promise.resolve();
    expect(synthesis.analyzeSession).not.toHaveBeenCalled();
  });

  it('empty sessionId in payload short-circuits before any FSM mutation', async () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());
    const acquireSpy = jest.spyOn(rateLimiter, 'tryAcquire');
    const { service, postToolUse, synthesis } = buildService({ rateLimiter });
    service.start();
    for (let i = 0; i < 3; i++) {
      postToolUse.fire(
        postToolUsePayload({
          toolName: 'Edit',
          sessionId: '',
          timestamp: 1000 + i,
        }),
      );
    }
    postToolUse.fire(
      postToolUsePayload({
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
        sessionId: '',
        timestamp: 2000,
      }),
    );
    await Promise.resolve();
    expect(synthesis.analyzeSession).not.toHaveBeenCalled();
    expect(synthesis.pushEvent).not.toHaveBeenCalled();
    expect(acquireSpy).not.toHaveBeenCalled();
  });

  it('Bash test with non-zero exit does not fire', async () => {
    const { service, postToolUse, synthesis } = buildService();
    service.start();
    for (let i = 0; i < 3; i++) {
      postToolUse.fire(
        postToolUsePayload({ toolName: 'Edit', timestamp: 1000 + i }),
      );
    }
    postToolUse.fire(
      postToolUsePayload({
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
        exitCode: 1,
        success: false,
        timestamp: 2000,
      }),
    );
    await Promise.resolve();
    expect(synthesis.analyzeSession).not.toHaveBeenCalled();
  });
});

describe('SkillTriggerService — lifecycle and rate-limit windows', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('start attaches subagent-stop and post-tool-use disposers; stop detaches', () => {
    const { service, subagentStop, postToolUse } = buildService();
    expect(subagentStop.registry.size).toBe(0);
    expect(postToolUse.registry.size).toBe(0);
    service.start();
    expect(subagentStop.registry.size).toBe(1);
    expect(postToolUse.registry.size).toBe(1);
    service.stop();
    expect(subagentStop.registry.size).toBe(0);
    expect(postToolUse.registry.size).toBe(0);
  });

  it('rate-limit hour rollover allows fires again after window resets', async () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());
    const { service, subagentStop, synthesis } = buildService({
      workspace: makeWorkspace({
        'skillSynthesis.triggers.maxAnalyzesPerHour': 1,
      }),
      rateLimiter,
    });
    service.start();
    const t0 = Date.UTC(2026, 4, 21, 10, 0, 0);
    jest.setSystemTime(new Date(t0));
    subagentStop.fire(
      subagentStopPayload({ subagentSessionId: 'a', timestamp: t0 }),
    );
    subagentStop.fire(
      subagentStopPayload({ subagentSessionId: 'b', timestamp: t0 + 100 }),
    );
    await Promise.resolve();
    expect(synthesis.analyzeSession).toHaveBeenCalledTimes(1);
    jest.setSystemTime(new Date(t0 + 3_600_001));
    subagentStop.fire(
      subagentStopPayload({
        subagentSessionId: 'c',
        timestamp: t0 + 3_600_001,
      }),
    );
    await Promise.resolve();
    expect(synthesis.analyzeSession).toHaveBeenCalledTimes(2);
  });
});
