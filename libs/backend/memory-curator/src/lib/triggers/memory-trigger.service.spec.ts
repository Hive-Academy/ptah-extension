import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import type {
  JsonlReaderService,
  SessionActivityCallback,
  SessionActivityRegistry,
  SessionEndCallback,
  SessionEndCallbackRegistry,
} from '@ptah-extension/agent-sdk';
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

function makeWorkspace(
  overrides: Partial<Record<string, unknown>> = {},
): IWorkspaceProvider {
  const cfg: Record<string, unknown> = {
    'memory.triggers.idleMs': 600000,
    'memory.triggers.turnThreshold': 20,
    'memory.triggers.bootScan': false,
    'memory.triggers.preCompact': true,
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
}): {
  service: MemoryTriggerService;
  activity: ActivityHarness;
  sessionEnd: SessionEndHarness;
  curator: MemoryCuratorService;
  workspace: IWorkspaceProvider;
} {
  const activity = makeActivityRegistry();
  const sessionEnd = makeSessionEndRegistry();
  const curator = opts?.curator ?? makeCurator();
  const workspace = opts?.workspace ?? makeWorkspace();
  const service = new MemoryTriggerService(
    makeLogger(),
    curator,
    activity.registry,
    sessionEnd.endRegistry,
    workspace,
    makeFs(),
    makeSqlite(),
    makeJsonl(),
  );
  return { service, activity, sessionEnd, curator, workspace };
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
