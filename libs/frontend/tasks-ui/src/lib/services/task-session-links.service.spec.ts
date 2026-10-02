import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  type SessionListForTasksResult,
  type TaskLinkedSession,
} from '@ptah-extension/shared';
import { TaskSessionLinksService } from './task-session-links.service';

type Ws = { path: string; name: string; type: string };

const ok = <T>(data: T) => ({ success: true, isSuccess: () => true, data });
const err = (error: string) => ({
  success: false,
  isSuccess: () => false,
  error,
});

function session(
  overrides: Partial<TaskLinkedSession> = {},
): TaskLinkedSession {
  return {
    sessionId: 'sess-1',
    name: 'Board start',
    role: 'primary',
    source: 'board-start',
    livePhase: 'generating',
    prLinks: [],
    ...overrides,
  };
}

const available = (
  links: Record<string, TaskLinkedSession[]>,
): SessionListForTasksResult => ({ available: true, links });

describe('TaskSessionLinksService', () => {
  const wsA: Ws = { path: 'D:/ws-a', name: 'a', type: 'workspace' };
  const wsB: Ws = { path: 'D:/ws-b', name: 'b', type: 'workspace' };

  let rpcCall: jest.Mock;
  let workspaceInfo: ReturnType<typeof signal<Ws | null>>;
  let currentView: ReturnType<typeof signal<string>>;
  let service: TaskSessionLinksService;

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  function configure(): void {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
        {
          provide: AppStateManager,
          useValue: { workspaceInfo, currentView },
        },
      ],
    });
    service = TestBed.inject(TaskSessionLinksService);
    TestBed.tick();
  }

  const listCalls = () =>
    rpcCall.mock.calls.filter(([method]) => method === 'session:listForTasks');

  beforeEach(() => {
    TestBed.resetTestingModule();
    workspaceInfo = signal<Ws | null>(wsA);
    currentView = signal('chat');
    rpcCall = jest
      .fn()
      .mockResolvedValue(ok(available({ TASK_1: [session()] })));
  });

  afterEach(() => jest.restoreAllMocks());

  it('registers for the three pushes it reloads on', () => {
    configure();
    expect([...service.handledMessageTypes]).toEqual([
      MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED,
      MESSAGE_TYPES.SESSION_TURN_ENDED,
      MESSAGE_TYPES.SESSION_TURN_FAILED,
    ]);
  });

  it('fetches nothing until a consumer mounts', async () => {
    configure();
    await flush();
    expect(rpcCall).not.toHaveBeenCalled();
    expect(service.linksFor('TASK_1')).toEqual([]);
  });

  it('fetches once for the board when the first consumer mounts, never per card', async () => {
    configure();
    const releases = [service.retain(), service.retain(), service.retain()];
    await flush();

    expect(listCalls()).toEqual([
      ['session:listForTasks', { workspacePath: 'D:/ws-a' }],
    ]);
    expect(service.linksFor('TASK_1')).toEqual([session()]);
    expect(service.linksFor('TASK_2')).toEqual([]);
    releases.forEach((release) => release());
  });

  it('refetches on the next board load after every consumer left', async () => {
    configure();
    const release = service.retain();
    await flush();
    release();
    service.retain();
    await flush();
    expect(listCalls()).toHaveLength(2);
  });

  it.each([
    MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED,
    MESSAGE_TYPES.SESSION_TURN_ENDED,
    MESSAGE_TYPES.SESSION_TURN_FAILED,
  ])('reloads on %s while a board is mounted', async (type) => {
    configure();
    service.retain();
    await flush();

    rpcCall.mockResolvedValue(
      ok(available({ TASK_1: [session({ livePhase: 'idle' })] })),
    );
    service.handleMessage({ type, payload: { sessionId: 'sess-1' } });
    await flush();

    expect(listCalls()).toHaveLength(2);
    expect(service.linksFor('TASK_1')[0].livePhase).toBe('idle');
  });

  it('ignores pushes while no board is mounted', async () => {
    configure();
    service.handleMessage({
      type: MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED,
      payload: {},
    });
    await flush();
    expect(rpcCall).not.toHaveBeenCalled();
  });

  it('skips a turn push for a session no task links to', async () => {
    configure();
    service.retain();
    await flush();

    service.handleMessage({
      type: MESSAGE_TYPES.SESSION_TURN_ENDED,
      payload: { sessionId: 'unrelated' },
    });
    await flush();
    expect(listCalls()).toHaveLength(1);
  });

  it('coalesces pushes that land during a fetch into one more fetch', async () => {
    configure();
    let resolveFirst: (value: unknown) => void = () => undefined;
    rpcCall.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );
    service.retain();
    const push = {
      type: MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED,
      payload: {},
    };
    service.handleMessage(push);
    service.handleMessage(push);
    service.handleMessage(push);

    resolveFirst(ok(available({})));
    await flush();
    expect(listCalls()).toHaveLength(2);
  });

  it('gives an empty map when the host has no organization store (VS Code)', async () => {
    rpcCall.mockResolvedValue(ok({ available: false }));
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    configure();
    service.retain();
    await flush();

    expect(service.links().size).toBe(0);
    expect(service.linksFor('TASK_1')).toEqual([]);
    expect(error).not.toHaveBeenCalled();
  });

  it('empties the map and logs one error when the call fails', async () => {
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    configure();
    service.retain();
    await flush();
    expect(service.links().size).toBe(1);

    rpcCall.mockResolvedValue(err('boom'));
    service.handleMessage({
      type: MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED,
      payload: {},
    });
    await flush();

    expect(service.links().size).toBe(0);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('drops malformed entries instead of failing the board', async () => {
    rpcCall.mockResolvedValue(
      ok({
        available: true,
        links: {
          TASK_1: [
            session(),
            { sessionId: 7 },
            session({ livePhase: 'bogus' as never }),
          ],
          TASK_2: 'not an array',
          TASK_3: [session({ prLinks: [{ url: 42 }] as never })],
        },
      }),
    );
    configure();
    service.retain();
    await flush();

    expect(service.linksFor('TASK_1')).toEqual([session()]);
    expect(service.linksFor('TASK_2')).toEqual([]);
    expect(service.linksFor('TASK_3')[0].prLinks).toEqual([]);
  });

  it('does not fetch without an open workspace', async () => {
    workspaceInfo.set(null);
    configure();
    service.retain();
    await flush();
    expect(rpcCall).not.toHaveBeenCalled();
  });

  it('clears and refetches for the new workspace on a switch', async () => {
    configure();
    service.retain();
    await flush();
    expect(service.linksFor('TASK_1')).toHaveLength(1);

    rpcCall.mockResolvedValue(ok(available({})));
    workspaceInfo.set(wsB);
    TestBed.tick();
    await flush();

    expect(listCalls()[1]).toEqual([
      'session:listForTasks',
      { workspacePath: 'D:/ws-b' },
    ]);
    expect(service.linksFor('TASK_1')).toEqual([]);
  });

  it('discards an answer for a workspace that is no longer active', async () => {
    configure();
    let resolveA: (value: unknown) => void = () => undefined;
    rpcCall.mockImplementationOnce(
      () => new Promise((resolve) => (resolveA = resolve)),
    );
    service.retain();

    rpcCall.mockResolvedValue(ok(available({})));
    workspaceInfo.set(wsB);
    TestBed.tick();
    resolveA(ok(available({ TASK_1: [session()] })));
    await flush();

    expect(service.linksFor('TASK_1')).toEqual([]);
    expect(listCalls().at(-1)?.[1]).toEqual({ workspacePath: 'D:/ws-b' });
  });
  describe('Tasks surface visits', () => {
    it('fetches when the Tasks surface opens, before any card mounts', async () => {
      configure();
      currentView.set('tasks');
      TestBed.tick();
      await flush();
      expect(listCalls()).toHaveLength(1);
      expect(service.linksFor('TASK_1')).toEqual([session()]);
    });

    it('does not refetch when cards mount, unmount and remount in one visit', async () => {
      configure();
      currentView.set('tasks');
      TestBed.tick();
      const first = service.retain();
      await flush();
      first();
      service.retain();
      await flush();
      expect(listCalls()).toHaveLength(1);
    });

    it('issues one fetch when cards mount before the visit is observed', async () => {
      configure();
      service.retain();
      currentView.set('tasks');
      TestBed.tick();
      await flush();
      expect(listCalls()).toHaveLength(1);
    });

    it('fetches again on the next visit and keeps the last map meanwhile', async () => {
      configure();
      currentView.set('tasks');
      TestBed.tick();
      await flush();
      currentView.set('chat');
      TestBed.tick();
      expect(service.linksFor('TASK_1')).toHaveLength(1);

      currentView.set('tasks');
      TestBed.tick();
      await flush();
      expect(listCalls()).toHaveLength(2);
    });

    it('reloads on a push while the surface is open with no card mounted', async () => {
      configure();
      currentView.set('tasks');
      TestBed.tick();
      await flush();
      service.handleMessage({
        type: MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED,
        payload: {},
      });
      await flush();
      expect(listCalls()).toHaveLength(2);
    });
  });
});
