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
  SessionActivityPayload,
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
  SessionStartCallbackRegistry,
  SessionStartPayload,
  SessionIdResolvedCallbackRegistry,
  SessionIdResolvedPayload,
} from '@ptah-extension/agent-sdk';
import { CuratorRateLimitService } from '@ptah-extension/agent-sdk';
import { MemoryTriggerService } from './memory-trigger.service';
import type { MemoryCuratorService } from '../memory-curator.service';
import type {
  ObservationQueueInsert,
  ObservationQueueRow,
  ObservationQueueStore,
} from '../observation-queue.store';

/**
 * Pin the fake clock to a top-of-hour instant. CuratorRateLimitService buckets
 * by the wall-clock-aligned hour (`Math.floor(now / HOUR_MS) * HOUR_MS`), so a
 * bare `jest.useFakeTimers()` — which seeds from real time — makes any
 * `advanceTimersByTime(...)` straddle an hour boundary whenever CI happens to
 * run within a few seconds of the top of an hour, silently resetting the bucket
 * and double-firing curate. Seeding at :00:00 gives a full hour of headroom.
 */
const FAKE_CLOCK_EPOCH = Date.UTC(2026, 0, 1, 0, 0, 0);

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
      outcome: 'ran',
      extracted: 0,
      merged: 0,
      created: 0,
      skipped: 0,
    }),
    pushEvent: jest.fn(),
    recentEvents: jest.fn(() => []),
    lastRunInfo: jest.fn(() => ({ at: null, stats: null })),
    rekeySession: jest.fn(),
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
    flush: jest.fn(),
    enqueue: jest.fn((insert: ObservationQueueInsert) => {
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
    backfillSessionId: jest.fn((fromId: string, toId: string) => {
      const rows = rowsBySession.get(fromId);
      if (!rows) return 0;
      rowsBySession.delete(fromId);
      const target = rowsBySession.get(toId) ?? [];
      for (const r of rows) {
        (r as unknown as { sessionId: string }).sessionId = toId;
        target.push(r);
      }
      rowsBySession.set(toId, target);
      return rows.length;
    }),
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
  sessionStart: SetRegistryHarness<
    SessionStartPayload,
    SessionStartCallbackRegistry
  >;
  sessionIdResolved: SetRegistryHarness<
    SessionIdResolvedPayload,
    SessionIdResolvedCallbackRegistry
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
  const sessionStart = makeSetRegistry<SessionStartPayload>();
  const sessionIdResolved = makeSetRegistry<SessionIdResolvedPayload>();
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
    sessionStart.registry as unknown as SessionStartCallbackRegistry,
    transcriptReader,
    sessionIdResolved.registry as unknown as SessionIdResolvedCallbackRegistry,
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
    sessionStart: sessionStart as unknown as SetRegistryHarness<
      SessionStartPayload,
      SessionStartCallbackRegistry
    >,
    sessionIdResolved: sessionIdResolved as unknown as SetRegistryHarness<
      SessionIdResolvedPayload,
      SessionIdResolvedCallbackRegistry
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
    jest.useFakeTimers({ now: FAKE_CLOCK_EPOCH });
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);
  });

  /**
   * TASK_2026_295 — `sessions` holds ONE idle timer per session id, so two
   * sessions both reporting `''` used to share a single slot: the second
   * `onActivity` cleared the first's timer and only one of the two was ever
   * curated. An empty id is not a session, so no timer is armed for it at all.
   */
  it('arms no idle timer for activity with an empty sessionId', async () => {
    const { service, activity, stop, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 100,
        'memory.triggers.turnThreshold': 0,
      }),
    });
    service.start();
    stop.fire(stopPayload());
    activity.registry.notifyAll({
      sessionId: '',
      workspaceRoot: '/ws/A',
      role: 'user',
      timestamp: 1,
    });
    activity.registry.notifyAll({
      sessionId: '',
      workspaceRoot: '/ws/B',
      role: 'user',
      timestamp: 2,
    });
    jest.advanceTimersByTime(150);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    // Before the fix exactly ONE curate fired here — for /ws/B, the session
    // that happened to arrive second. /ws/A was lost with no error.
    expect(curator.curate).not.toHaveBeenCalled();
  });

  /**
   * TASK_2026_296 (R12) — DELIBERATE BEHAVIOUR CHANGE, pinned so it is not
   * silent. Every blank guard in this service used to be `!x || x.length === 0`,
   * which does NOT trim: a session reporting `'   '` was a *valid* id, armed a
   * timer under a whitespace key and was curated. The guards now route through
   * the shared `blankToUndefined`, whose policy is trim-and-treat-whitespace-
   * only-as-absent, so a whitespace-only id is refused exactly like `''` — and
   * two sessions reporting `'   '` can no longer collide on one timer slot the
   * way two reporting `''` did.
   */
  it('arms no idle timer for a whitespace-only sessionId (trim policy)', async () => {
    const { service, activity, stop, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 100,
        'memory.triggers.turnThreshold': 0,
      }),
    });
    service.start();
    stop.fire(stopPayload());
    activity.registry.notifyAll({
      sessionId: '   ',
      workspaceRoot: '/ws/A',
      role: 'user',
      timestamp: 1,
    });
    activity.registry.notifyAll({
      sessionId: '\t\n',
      workspaceRoot: '/ws/B',
      role: 'user',
      timestamp: 2,
    });
    jest.advanceTimersByTime(150);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
  });

  /**
   * Paired isolation for the trim policy above: narrowing the accepted set must
   * not narrow it onto real ids. A non-blank session id still arms the timer and
   * still curates.
   */
  it('still arms the idle timer for a real sessionId after the trim tightening', async () => {
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
      timestamp: 1,
    });
    jest.advanceTimersByTime(150);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', workspaceRoot: '/ws' }),
    );
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    stop.fire(stopPayload({ timestamp: 0 }));
    stop.fire(stopPayload({ timestamp: 1 }));
    for (let i = 0; i < 8; i++) await Promise.resolve();
    jest.advanceTimersByTime(5001);
    stop.fire(stopPayload({ timestamp: 2 }));
    stop.fire(stopPayload({ timestamp: 3 }));
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'idle-trigger' }),
    );
    jest.advanceTimersByTime(5001);
    stop.fire(stopPayload({ timestamp: 2 }));
    stop.fire(stopPayload({ timestamp: 3 }));
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'turn-complete-trigger' }),
    );
  });

  it('coalesces overlapping triggers within 5s into a single curate', async () => {
    const { service, stop, sessionEndHook, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 1,
      }),
    });
    service.start();
    stop.fire(stopPayload({ timestamp: 1 }));
    sessionEndHook.fire({
      sessionId: 's1',
      workspaceRoot: '/ws',
      reason: 'clear',
      timestamp: 2,
    });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);
  });

  it('coalesce window allows a new curate after the 5s cooldown elapses', async () => {
    const { service, stop, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 1,
      }),
    });
    service.start();
    stop.fire(stopPayload({ timestamp: 1 }));
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);
    stop.fire(stopPayload({ timestamp: 2 }));
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(5001);
    stop.fire(stopPayload({ timestamp: 3 }));
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(2);
  });
});

describe('MemoryTriggerService — user-cue trigger', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: FAKE_CLOCK_EPOCH });
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();

    cfg['memory.triggers.userPromptSubmit.cueList'] = ['remember'];
    userPromptSubmit.fire(
      userPromptPayload({ prompt: 'remember this critical detail please' }),
    );
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);
  });
});

describe('MemoryTriggerService — commit-detect trigger', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: FAKE_CLOCK_EPOCH });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('Bash git commit with exitCode 0 + success fires curate + commit-detect event', async () => {
    const { service, postToolUse, curator } = buildService();
    service.start();
    postToolUse.fire(postToolUsePayload());
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
  });

  it('non-Bash tool is ignored entirely', async () => {
    const { service, postToolUse, curator } = buildService();
    service.start();
    postToolUse.fire(
      postToolUsePayload({ toolName: 'Edit', toolInput: { command: 'x' } }),
    );
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    jest.advanceTimersByTime(5001);
    postToolUse.fire(postToolUsePayload());
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
      for (let j = 0; j < 8; j++) await Promise.resolve();
      jest.advanceTimersByTime(5001);
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
  });

  it('Bash non-commit command (e.g. git status) is ignored', async () => {
    const { service, postToolUse, curator } = buildService();
    service.start();
    postToolUse.fire(
      postToolUsePayload({ toolInput: { command: 'git status' } }),
    );
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
    expect(curator.pushEvent).not.toHaveBeenCalled();
  });

  it('empty sessionId in payload short-circuits before rate-limit acquire', async () => {
    const rateLimiter = new CuratorRateLimitService(makeLogger());
    const acquireSpy = jest.spyOn(rateLimiter, 'tryAcquire');
    const { service, postToolUse, curator } = buildService({ rateLimiter });
    service.start();
    postToolUse.fire(postToolUsePayload({ sessionId: '' }));
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
    expect(curator.pushEvent).not.toHaveBeenCalled();
    expect(acquireSpy).not.toHaveBeenCalled();
  });
});

describe('MemoryTriggerService — lifecycle and rate-limit windows', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: FAKE_CLOCK_EPOCH });
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);
    jest.setSystemTime(new Date(t0 + 3_600_001));
    postToolUse.fire(postToolUsePayload({ timestamp: t0 + 3_600_001 }));
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(2);
  });
});

describe('MemoryTriggerService — episode / failure / session-end', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: FAKE_CLOCK_EPOCH });
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'tool-failure',
        stats: expect.objectContaining({ tool: 'Bash' }),
      }),
    );
  });

  it('tool-failure event carries a single-line truncated error snippet', async () => {
    const { service, toolFailure, curator } = buildService();
    service.start();
    const rawError = `TypeError: x is undefined\n    at foo (bar.ts:1)\n${'y'.repeat(300)}`;
    toolFailure.fire({
      toolName: 'Bash',
      toolInput: { command: 'npm test' },
      error: rawError,
      isInterrupt: false,
      sessionId: 's1',
      workspaceRoot: '/ws',
      timestamp: 10,
    });
    for (let i = 0; i < 8; i++) await Promise.resolve();

    const call = (curator.pushEvent as jest.Mock).mock.calls.find(
      ([e]: [{ kind: string }]) => e.kind === 'tool-failure',
    );
    expect(call).toBeDefined();
    const snippet = call[0].stats.error as string;
    expect(snippet).toContain('TypeError: x is undefined');
    expect(snippet).not.toContain('\n');
    expect(snippet.length).toBeLessThanOrEqual(141);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('recovery-only episode (turnCount === 0) does NOT fire episode-trigger', async () => {
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.pushEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'episode-trigger' }),
    );
  });

  it('real episode (turnCount > 0 && critical) fires episode-trigger with salience boost', async () => {
    const { service, stop, toolFailure, postToolUse, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 0,
      }),
    });
    service.start();
    stop.fire(stopPayload());
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'session-end-trigger' }),
    );
    expect(curator.curate).toHaveBeenCalledTimes(1);
  });

  it('in-process session-end registry flushes the buffered episode when the SDK hook cannot deliver', async () => {
    const { service, stop, sessionEnd, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 0,
      }),
    });
    service.start();
    stop.fire(stopPayload());
    sessionEnd.endActive.current?.({ sessionId: 's1', workspaceRoot: '/ws' });
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();
  });
});

describe('MemoryTriggerService — buffer preservation under rate-limit', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: FAKE_CLOCK_EPOCH });
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date(t0 + 5001));
    postToolUse.fire(postToolUsePayload({ timestamp: t0 + 5001 }));
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date(t0 + 5001));
    stop.fire(stopPayload({ timestamp: t0 + 5001 }));
    sessionEndHook.fire({
      sessionId: 's1',
      workspaceRoot: '/ws',
      reason: 'clear',
      timestamp: t0 + 5100,
    });
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date(t0 + 5001));
    stop.fire(stopPayload({ timestamp: t0 + 5001 }));
    postToolUse.fire(postToolUsePayload({ timestamp: t0 + 5100 }));
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    jest.useFakeTimers({ now: FAKE_CLOCK_EPOCH });
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).not.toHaveBeenCalled();

    sessionEndHook.fire({
      sessionId: 's1',
      workspaceRoot: '/ws',
      reason: 'clear',
      timestamp: 2,
    });
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    jest.useFakeTimers({ now: FAKE_CLOCK_EPOCH });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('user-cue forwards the prompt as transcript WITHOUT a salienceBoost field', async () => {
    const { service, userPromptSubmit, curator } = buildService();
    service.start();
    userPromptSubmit.fire(userPromptPayload());
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledWith(
      expect.objectContaining({ salienceBoost: 0.1 }),
    );
  });

  it('episode boundary threads the critical-learning salienceBoost into curate()', async () => {
    const { service, stop, toolFailure, postToolUse, curator } = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': 0,
        'memory.triggers.turnThreshold': 0,
      }),
    });
    service.start();
    stop.fire(stopPayload());
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(curator.curate).toHaveBeenCalledWith(
      expect.objectContaining({ salienceBoost: 0.2 }),
    );
  });
});

describe('MemoryTriggerService — observation queue side effects', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: FAKE_CLOCK_EPOCH });
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

  it('PostToolUse Read inserts the same file-read observation row', () => {
    const { service, postToolUse, queue } = buildService();
    service.start();
    postToolUse.fire({
      toolName: 'Read',
      toolInput: { file_path: '/ws/src/index.ts' },
      toolOutput: 'file contents',
      exitCode: null,
      success: true,
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
    postToolUse.fire({
      toolName: 'Edit',
      toolInput: { file_path: '/ws/src/index.ts' },
      toolOutput: 'updated',
      exitCode: null,
      success: true,
      sessionId: 's1',
      workspaceRoot: '/ws',
      timestamp: 2,
    });
    expect(
      queue.inserts.filter((row) => row.kind === 'file-read'),
    ).toHaveLength(0);
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
    jest.useFakeTimers({ now: FAKE_CLOCK_EPOCH });
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    for (let i = 0; i < 8; i++) await Promise.resolve();
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(queue.markProcessed).not.toHaveBeenCalled();
    const unprocessed = (queue.rowsBySession.get('s1') ?? []).filter(
      (r) => r.processedAt === null,
    );
    expect(unprocessed.length).toBeGreaterThan(0);
  });

  /**
   * TASK_2026_306 Batch 10 — finding F1, the whole point of this batch.
   *
   * The provider quota gate (Batch 2) stops the curator before it dials a
   * rate-limited provider. Under the pre-fix code "stop" was `runQuery → ''` →
   * `extract() → []`, which is byte-identical to a pass that ran and found
   * nothing — and `invokeCurate` marked its drained rows processed on every
   * resolve without inspecting anything. `drainForSession` filters
   * `processed_at IS NULL`, so the discarded observations never came back.
   * Observed live: 15 drain-and-discard passes in a few hundred lines of one
   * cold start (`tmp/logs/coldstart-306.log:1232-1260`).
   *
   * ## Why these two cases and not one
   *
   * An assertion that the extraction is empty is worthless here — it holds
   * before AND after the fix. The discriminating question is whether the ROWS
   * SURVIVE, so the first case asserts `processedAt === null` and a successful
   * re-drain. The second case is its inverse and is equally load-bearing:
   * without it, "never mark anything processed" would satisfy the first, and
   * every session that genuinely had nothing to learn would be re-fed forever.
   * Either case alone can be passed by a wrong implementation. Together they
   * pin the branch.
   */
  describe('a stalled curation pass keeps its input (TASK_2026_306 F1)', () => {
    function makeStalledCurator(): MemoryCuratorService {
      return {
        curate: jest.fn().mockResolvedValue({
          outcome: 'stalled',
          extracted: 0,
          merged: 0,
          created: 0,
          skipped: 0,
        }),
        pushEvent: jest.fn(),
        recentEvents: jest.fn(() => []),
        lastRunInfo: jest.fn(() => ({ at: null, stats: null })),
        rekeySession: jest.fn(),
      } as unknown as MemoryCuratorService;
    }

    it('leaves the drained observations processed_at IS NULL and re-drains them on the next pass', async () => {
      const queue = makeObservationQueue();
      const { service, stop } = buildService({
        curator: makeStalledCurator(),
        workspace: makeWorkspace({
          'memory.triggers.idleMs': 0,
          'memory.triggers.turnThreshold': 1,
        }),
        observationQueue: queue,
      });
      service.start();
      stop.fire(stopPayload({ lastAssistantMessage: 'work worth keeping' }));
      for (let i = 0; i < 16; i++) await Promise.resolve();

      // The pass DID drain — this is not a "nothing happened" assertion.
      const drained = (queue.store.drainForSession as jest.Mock).mock.results[0]
        .value as ObservationQueueRow[];
      expect(drained.length).toBeGreaterThan(0);

      // …and then left every row exactly where it found it.
      expect(queue.markProcessed).not.toHaveBeenCalled();
      const rows = queue.rowsBySession.get('s1') ?? [];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.processedAt === null)).toBe(true);

      // The survival claim, stated as the next pass would ask it: a fresh
      // drain still returns them, so the episodes outlive the cooldown.
      const redrained = queue.store.drainForSession('s1', 500);
      expect(redrained.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    });

    it('a pass that RAN and found nothing still marks its rows processed', async () => {
      // The inverse guard. `makeCurator()` returns `outcome: 'ran'` with zero
      // counts — the "found nothing" case that used to be indistinguishable
      // from a stall. It must keep its pre-fix behaviour exactly.
      const queue = makeObservationQueue();
      const { service, stop } = buildService({
        workspace: makeWorkspace({
          'memory.triggers.idleMs': 0,
          'memory.triggers.turnThreshold': 1,
        }),
        observationQueue: queue,
      });
      service.start();
      stop.fire(stopPayload({ lastAssistantMessage: 'nothing memorable' }));
      for (let i = 0; i < 16; i++) await Promise.resolve();

      expect(queue.markProcessed).toHaveBeenCalledTimes(1);
      const rows = queue.rowsBySession.get('s1') ?? [];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.processedAt !== null)).toBe(true);
      expect(queue.store.drainForSession('s1', 500)).toEqual([]);
    });

    it('restores the episode buffer that tryEpisodeCurate cleared before the pass', async () => {
      // The second of the three pieces of state. `episodes.reset` fires before
      // the curate resolves and cannot be deferred without swallowing turns
      // that arrive mid-pass, so the stall path puts the buffer back. Proven
      // through the transcript of the NEXT curate: the restored turn is
      // counted again rather than lost.
      const curator = makeStalledCurator();
      const { service, stop } = buildService({
        curator,
        workspace: makeWorkspace({
          'memory.triggers.idleMs': 0,
          'memory.triggers.turnThreshold': 1,
        }),
      });
      service.start();
      stop.fire(stopPayload({ lastAssistantMessage: 'first turn' }));
      for (let i = 0; i < 16; i++) await Promise.resolve();
      expect(curator.curate).toHaveBeenCalledTimes(1);

      // A second turn lands after the stall. Its episode summary must include
      // the restored turn, not just the new one.
      jest.advanceTimersByTime(10_000);
      stop.fire(stopPayload({ lastAssistantMessage: 'second turn' }));
      for (let i = 0; i < 16; i++) await Promise.resolve();

      // `turns=2` is the discriminating token: the restored turn plus the new
      // one. Drop the reattach and this reads `turns=1`. (The assistant text
      // itself is NOT the discriminator — it rides the surviving
      // `observation_queue` rows and would appear either way.)
      expect(curator.curate).toHaveBeenCalledTimes(2);
      const second = (curator.curate as jest.Mock).mock.calls[1][0];
      expect(second.transcript).toEqual(expect.stringContaining('turns=2'));
    });
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(drainSpy).toHaveBeenCalledWith('s1', 7);
  });

  it('concurrent triggers for the same session are coalesced by HEAD shouldCoalesce path (second drain skipped within window)', async () => {
    const queue = makeObservationQueue();
    const drainSpy = queue.store.drainForSession as jest.Mock;
    const blockingCurator = {
      curate: jest.fn().mockResolvedValue({
        outcome: 'ran',
        extracted: 0,
        merged: 0,
        created: 0,
        skipped: 0,
      }),
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(drainSpy).toHaveBeenCalledTimes(1);
    expect(blockingCurator.curate).toHaveBeenCalledTimes(1);
  });
});

/**
 * TASK_2026_296 item 6, Part B — the rekey signal.
 *
 * Before the SDK's system `init` message lands there is no canonical UUID, so a
 * residual hook path (payload without `session_id`, falling back to the
 * tabId-bearing closure) arms state under the **tabId**. `SessionEnd` always
 * canonicalises to `realSessionId ?? tabId` (`session-control.service.ts:126`)
 * and therefore arrives under the UUID — so the tabId-keyed idle timer is never
 * cleared and fires against a session the drain cannot read.
 *
 * Both ids are real UUID v4 strings throughout. A tabId IS a UUID v4
 * (`TabId.create()`), so using `tab_N` would make these pass for the wrong
 * reason: it would imply a shape a consumer could detect, and no such shape
 * exists.
 */
describe('MemoryTriggerService — rekeySession (TASK_2026_296)', () => {
  const TAB_ID = '4a4a0d5e-6a1c-4d2f-9d3b-3e6f1c5a7b21';
  const REAL_ID = 'b7c2f9a1-0e44-4a6b-8c1d-2f5e9a3b6d70';

  beforeEach(() => {
    jest.useFakeTimers({ now: FAKE_CLOCK_EPOCH });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function armed(idleMs = 100_000) {
    const h = buildService({
      workspace: makeWorkspace({
        'memory.triggers.idleMs': idleMs,
        'memory.triggers.turnThreshold': 0,
      }),
    });
    h.service.start();
    return h;
  }

  function arm(
    h: ReturnType<typeof armed>,
    sessionId: string,
    workspaceRoot = '/ws',
  ): void {
    h.stop.fire(stopPayload({ sessionId, workspaceRoot }));
    h.activity.registry.notifyAll({
      sessionId,
      workspaceRoot,
      role: 'user',
      timestamp: Date.now(),
    });
  }

  it('subscribes on start() and disposes on stop()', () => {
    const h = buildService();
    h.service.start();
    expect(h.sessionIdResolved.registry.register).toHaveBeenCalledTimes(1);
    expect(h.sessionIdResolved.registry.size).toBe(1);
    h.service.stop();
    expect(h.sessionIdResolved.registry.size).toBe(0);
  });

  // The literal context.md acceptance criterion (plan §6e spec 2).
  it('a SessionEnd under the UUID clears state registered under the tabId, timer included', async () => {
    const h = armed();
    arm(h, TAB_ID);

    h.sessionIdResolved.fire({
      tabId: TAB_ID,
      realSessionId: REAL_ID,
      timestamp: Date.now(),
    });

    // Teardown arrives under the canonical id, exactly as
    // `session-control.service.ts:126` would report it.
    h.sessionEnd.endActive.current?.({
      sessionId: REAL_ID,
      workspaceRoot: '/ws',
    });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    (h.curator.curate as jest.Mock).mockClear();
    (h.curator.pushEvent as jest.Mock).mockClear();

    // The migrated timer is gone: advancing well past the idle window fires
    // nothing. Before the rekey this is where the orphan curate happened.
    jest.advanceTimersByTime(500_000);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(h.curator.pushEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'idle-trigger' }),
    );

    // And nothing survives under EITHER key — a second SessionEnd under the
    // tabId finds nothing left to flush.
    h.sessionEnd.endActive.current?.({
      sessionId: TAB_ID,
      workspaceRoot: '/ws',
    });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(h.curator.curate).not.toHaveBeenCalled();
  });

  it('re-arms the idle timer under the new id with the REMAINING delay', async () => {
    const h = armed(100_000);
    arm(h, TAB_ID);

    // Two thirds of the window elapse before the id resolves.
    jest.advanceTimersByTime(66_000);
    h.sessionIdResolved.fire({
      tabId: TAB_ID,
      realSessionId: REAL_ID,
      timestamp: Date.now(),
    });

    // A timer re-armed with the FULL window would still be pending here.
    jest.advanceTimersByTime(35_000);
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(h.curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'idle-trigger', sessionId: REAL_ID }),
    );
    // The episode buffer moved with it, so the curate is the real one.
    expect(h.curator.curate).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: REAL_ID }),
    );
  });

  // R4 — never clobber.
  it('keeps the destination entry and discards the tabId one when toId already exists', async () => {
    const h = armed(100_000);
    // The canonical entry is armed FIRST and is the live one.
    arm(h, REAL_ID, '/ws-real');
    jest.advanceTimersByTime(40_000);
    // The residual path then arms a second entry under the tabId.
    arm(h, TAB_ID, '/ws-tab');

    h.sessionIdResolved.fire({
      tabId: TAB_ID,
      realSessionId: REAL_ID,
      timestamp: Date.now(),
    });

    // The destination's own timer is untouched: it still has 60s of its
    // original 100s window left, and it fires with ITS workspace root, not the
    // tabId entry's.
    jest.advanceTimersByTime(59_000);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(h.curator.pushEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'idle-trigger' }),
    );

    jest.advanceTimersByTime(2_000);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(h.curator.curate).toHaveBeenCalledTimes(1);
    expect(h.curator.curate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: REAL_ID,
        workspaceRoot: '/ws-real',
      }),
    );

    // The discarded entry's timer was cleared, not merely orphaned: nothing
    // further fires however far the clock runs.
    jest.advanceTimersByTime(500_000);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(h.curator.curate).toHaveBeenCalledTimes(1);
  });

  it('re-points the observation queue rows and delegates the curator in-flight key', () => {
    const h = armed();
    arm(h, TAB_ID);

    h.sessionIdResolved.fire({
      tabId: TAB_ID,
      realSessionId: REAL_ID,
      timestamp: Date.now(),
    });

    expect(h.queue.store.backfillSessionId).toHaveBeenCalledWith(
      TAB_ID,
      REAL_ID,
    );
    expect(h.curator.rekeySession).toHaveBeenCalledWith(TAB_ID, REAL_ID);
  });

  // Paired-isolation siblings.
  it('does nothing when the payload carries no tabId, or when the ids are blank or equal', () => {
    const h = armed();
    arm(h, TAB_ID);

    h.sessionIdResolved.fire({
      tabId: undefined,
      realSessionId: REAL_ID,
      timestamp: Date.now(),
    });
    h.sessionIdResolved.fire({
      tabId: '   ',
      realSessionId: REAL_ID,
      timestamp: Date.now(),
    });
    h.sessionIdResolved.fire({
      tabId: TAB_ID,
      realSessionId: '  ',
      timestamp: Date.now(),
    });
    h.sessionIdResolved.fire({
      tabId: TAB_ID,
      realSessionId: TAB_ID,
      timestamp: Date.now(),
    });

    expect(h.queue.store.backfillSessionId).not.toHaveBeenCalled();
    expect(h.curator.rekeySession).not.toHaveBeenCalled();
  });

  it('a session whose id never resolves is still torn down under its tabId', async () => {
    // The Wave 1 paired-isolation rule: the legitimate no-resolve path must
    // still arm and clear on the SAME key.
    const h = armed();
    arm(h, TAB_ID);

    h.sessionEnd.endActive.current?.({
      sessionId: TAB_ID,
      workspaceRoot: '/ws',
    });
    for (let i = 0; i < 8; i++) await Promise.resolve();

    // SessionEnd curates the buffered episode under the tabId...
    expect(h.curator.curate).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: TAB_ID }),
    );
    // ...and clears the timer, so the idle trigger never fires afterwards.
    (h.curator.curate as jest.Mock).mockClear();
    jest.advanceTimersByTime(500_000);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(h.curator.curate).not.toHaveBeenCalled();
  });
});

/**
 * TASK_2026_323 blocker B2 — the capture path is gated, cheap and bounded.
 *
 * The six enqueue sites fire on every tool call, assistant turn and prompt
 * submit of every open session. Nothing gated them: the per-trigger `*.enabled`
 * flags were all consulted AFTER the write, so a user who wanted no memory at
 * all still paid for a `JSON.stringify` and a SQLite round trip per tool call.
 */
describe('MemoryTriggerService — capture gating and caches (TASK_2026_323)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: FAKE_CLOCK_EPOCH });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const disabled = (): IWorkspaceProvider =>
    makeWorkspace({ 'memory.enabled': false });

  it('memory.enabled=false captures nothing from any hook', () => {
    const { service, stop, postToolUse, userPromptSubmit, queue } =
      buildService({ workspace: disabled() });
    service.start();

    stop.fire(stopPayload());
    postToolUse.fire(postToolUsePayload());
    userPromptSubmit.fire(userPromptPayload());
    postToolUse.fire({
      toolName: 'Read',
      toolInput: { file_path: '/a.ts' },
      toolOutput: 'file contents',
      exitCode: null,
      success: true,
      sessionId: 's1',
      workspaceRoot: '/ws',
      timestamp: 3000,
    });

    expect(queue.inserts).toHaveLength(0);
    expect(queue.store.enqueue).not.toHaveBeenCalled();
  });

  it('memory.enabled=false arms no idle timer and runs no curate', async () => {
    const { service, activity, curator } = buildService({
      workspace: disabled(),
    });
    service.start();

    activity.registry.notifyAll({
      sessionId: 's1',
      workspaceRoot: '/ws',
      timestamp: 1000,
    } as SessionActivityPayload);
    jest.advanceTimersByTime(1_000_000);
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(curator.curate).not.toHaveBeenCalled();
  });

  it('memory.enabled defaults to true — capture is unchanged when unset', () => {
    const { service, stop, queue } = buildService();
    service.start();
    stop.fire(stopPayload());
    expect(queue.inserts).toContainEqual(
      expect.objectContaining({ kind: 'assistant-turn' }),
    );
  });

  it('stop() flushes the pending batch rather than losing it', () => {
    const { service, queue } = buildService();
    service.start();
    service.stop();
    expect(queue.store.flush).toHaveBeenCalled();
  });

  /**
   * The cue cache keys on the JOINED cue list, not the array's identity.
   *
   * `getConfiguration` hands back a freshly parsed array on every miss — which
   * is what a settings-file read does — so an identity key never hit and every
   * prompt submit recompiled the whole cue list.
   */
  it('does not recompile the cue list when the config hands back a fresh array', () => {
    const cueList = ['remember (this|that)', 'save to memory'];
    const workspace = makeWorkspace();
    (workspace.getConfiguration as jest.Mock).mockImplementation(
      (_section: string, key: string, def: unknown) => {
        if (key === 'memory.triggers.userPromptSubmit.cueList') {
          // A NEW array each read — the real provider's behaviour.
          return [...cueList];
        }
        if (key === 'memory.triggers.userPromptSubmit.minPromptLength')
          return 20;
        if (key === 'memory.triggers.maxCuratesPerHour') return 0;
        return def;
      },
    );

    const { service, userPromptSubmit } = buildService({ workspace });
    service.start();

    const cache = () =>
      (service as unknown as { cueCache: { compiled: RegExp[] } | null })
        .cueCache;

    userPromptSubmit.fire(userPromptPayload());
    const first = cache()?.compiled;
    expect(first).toBeDefined();

    userPromptSubmit.fire(userPromptPayload());
    expect(cache()?.compiled).toBe(first);
  });

  it('recompiles when the cue list contents actually change', () => {
    const workspace = makeWorkspace();
    let cues = ['remember (this|that)'];
    (workspace.getConfiguration as jest.Mock).mockImplementation(
      (_section: string, key: string, def: unknown) => {
        if (key === 'memory.triggers.userPromptSubmit.cueList')
          return [...cues];
        if (key === 'memory.triggers.userPromptSubmit.minPromptLength')
          return 20;
        if (key === 'memory.triggers.maxCuratesPerHour') return 0;
        return def;
      },
    );

    const { service, userPromptSubmit } = buildService({ workspace });
    service.start();
    const cache = () =>
      (service as unknown as { cueCache: { compiled: RegExp[] } | null })
        .cueCache;

    userPromptSubmit.fire(userPromptPayload());
    const first = cache()?.compiled;

    cues = ['save to memory'];
    userPromptSubmit.fire(userPromptPayload());
    expect(cache()?.compiled).not.toBe(first);
  });

  /**
   * TASK_2026_323 blocker B4 — the curator reads only the TAIL of the
   * transcript. `composeTranscript` keeps 32 KB of formatted excerpt, so
   * parsing a 50 MB JSONL to throw away all but the end was pure main-thread
   * cost. The 512 KB window bounds RAW bytes, which carry uuids, timestamps and
   * usage the formatted excerpt never shows.
   */
  it('reads the transcript tail rather than the whole file', async () => {
    const { service, stop, transcriptReader } = buildService({
      workspace: makeWorkspace({ 'memory.triggers.turnThreshold': 1 }),
    });
    service.start();

    stop.fire(stopPayload());
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(transcriptReader.read).toHaveBeenCalledWith(
      's1',
      '/ws',
      expect.objectContaining({ tailBytes: expect.any(Number) }),
    );
    const [, , options] = (transcriptReader.read as jest.Mock).mock
      .calls[0] as [string, string, { tailBytes: number }];
    expect(options.tailBytes).toBeGreaterThanOrEqual(32 * 1024);
  });
});
