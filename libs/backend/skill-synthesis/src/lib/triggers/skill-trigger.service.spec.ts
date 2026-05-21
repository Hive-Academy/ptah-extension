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

function makeWorkspace(
  overrides: Partial<Record<string, unknown>> = {},
): IWorkspaceProvider {
  const cfg: Record<string, unknown> = {
    'skillSynthesis.triggers.sessionEnd': true,
    'skillSynthesis.triggers.idleMs': 600000,
    'skillSynthesis.triggers.bootScan': false,
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
}): {
  service: SkillTriggerService;
  activity: ActivityHarness;
  sessionEnd: SessionEndHarness;
  synthesis: SkillSynthesisService;
  workspace: IWorkspaceProvider;
} {
  const activity = makeActivityRegistry();
  const sessionEnd = makeSessionEndRegistry();
  const synthesis = opts?.synthesis ?? makeSynthesis();
  const workspace = opts?.workspace ?? makeWorkspace();
  const service = new SkillTriggerService(
    makeLogger(),
    synthesis,
    activity.registry,
    sessionEnd.endRegistry,
    workspace,
    makeFs(),
    makeSqlite(),
    makeJsonl(),
  );
  return { service, activity, sessionEnd, synthesis, workspace };
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
    expect(synthesis.analyzeSession).toHaveBeenCalledWith('s1', '/ws');
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
