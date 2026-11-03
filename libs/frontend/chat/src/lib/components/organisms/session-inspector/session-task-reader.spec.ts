import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  AppStateManager,
  ClaudeRpcService,
  FILE_LINK_OPENER,
  LoggingService,
  RpcResult,
  VSCodeService,
  rpcCall,
} from '@ptah-extension/core';
import { TasksChangedFeed } from '@ptah-extension/tasks-ui/presentation';
import type {
  ChatSessionSummary,
  SessionGetOrganizationResult,
  SessionOrganizationSummary,
  SessionTaskLinkSummary,
  TaskSpecDetail,
} from '@ptah-extension/shared';
import { ChatStore } from '../../../services/chat.store';
import { SessionOrganizationCache } from '../../../services/session-organization/session-organization-cache.store';
import { SessionTaskReader } from './session-task-reader';

jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual('@ptah-extension/core');
  return { ...actual, rpcCall: jest.fn() };
});

function taskFor(folderName: string): TaskSpecDetail {
  return { folderName, artifacts: ['task.md'] } as TaskSpecDetail;
}

function organization(
  overrides: Partial<SessionOrganizationSummary> = {},
): SessionOrganizationSummary {
  return {
    priority: 'normal',
    status: 'active',
    pinned: false,
    worktreePath: null,
    branch: null,
    parentSessionId: null,
    forkOfSessionId: null,
    startedBy: 'user',
    tasks: [],
    prLinks: [],
    childCount: 0,
    updatedAt: null,
    todos: null,
    ...overrides,
  };
}

type OrganizationRead = RpcResult<SessionGetOrganizationResult>;

function okRead(summary: SessionOrganizationSummary): OrganizationRead {
  return new RpcResult<SessionGetOrganizationResult>(true, {
    ok: true,
    organization: summary,
  });
}

function notFoundRead(): OrganizationRead {
  return new RpcResult<SessionGetOrganizationResult>(true, {
    ok: false,
    reason: 'session-not-found',
    message: 'not found',
  });
}

/** Let the queued cache read, its awaited RPC result and the code after run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
}

describe('SessionTaskReader workspace identity', () => {
  it('drops an old root response and opens only the new root task folder', async () => {
    const workspace = signal('C:/first');
    const link = {
      taskId: 'TASK_1',
      role: 'primary',
      source: 'user',
      createdAt: 1,
      missing: false,
    };
    const sessions = signal([
      { id: 'session-1', organization: { tasks: [link] } },
    ]);
    const open = jest.fn().mockResolvedValue(undefined);
    const reads: Array<(result: Awaited<ReturnType<typeof rpcCall>>) => void> = [];
    const rpc = jest.mocked(rpcCall);
    rpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          reads.push(resolve);
        }),
    );
    TestBed.configureTestingModule({
      providers: [
        SessionTaskReader,
        { provide: ChatStore, useValue: { organizationAvailable: () => true, sessions } },
        { provide: ClaudeRpcService, useValue: { call: jest.fn() } },
        { provide: LoggingService, useValue: { warn: jest.fn(), error: jest.fn() } },
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: () => ({
              tab: { claudeSessionId: 'session-1' },
              workspacePath: workspace(),
            }),
          },
        },
        { provide: AppStateManager, useValue: { workspaceInfo: () => null } },
        { provide: VSCodeService, useValue: {} },
        { provide: TasksChangedFeed, useValue: { changes: () => null } },
        { provide: FILE_LINK_OPENER, useValue: { open } },
      ],
    });
    const reader = TestBed.inject(SessionTaskReader);
    reader.bind(signal('tab-1'));
    TestBed.tick();
    expect(reads).toHaveLength(1);

    reads[0]({
      success: true,
      data: { task: taskFor('old-folder') },
    });
    await Promise.resolve();
    expect(reader.state()?.data?.task?.folderName).toBe('old-folder');
    reader.retry();
    expect(reads).toHaveLength(2);

    workspace.set('C:/second');
    expect(reader.state()?.status).toBe('loading');
    await reader.openDocument('task.md');
    expect(open).not.toHaveBeenCalled();
    TestBed.tick();
    reads[1]({
      success: true,
      data: { task: taskFor('old-folder') },
    });
    await Promise.resolve();
    TestBed.tick();
    expect(reader.state()?.data?.task).toBeNull();
    expect(reads).toHaveLength(3);

    reads[2]({
      success: true,
      data: { task: taskFor('new-folder') },
    });
    await Promise.resolve();
    expect(reader.state()?.data?.task?.folderName).toBe('new-folder');
    await reader.openDocument('task.md');
    expect(open).toHaveBeenCalledWith({
      path: 'C:/second/.ptah/specs/new-folder/task.md',
      origin: undefined,
    });
  });
});

describe('SessionTaskReader organization cache', () => {
  const TASK_A: SessionTaskLinkSummary = {
    taskId: 'TASK_A',
    role: 'primary',
    source: 'user',
    createdAt: 1,
    missing: false,
  };
  const TASK_B: SessionTaskLinkSummary = {
    taskId: 'TASK_B',
    role: 'primary',
    source: 'user',
    createdAt: 2,
    missing: false,
  };

  let sessions: WritableSignal<readonly ChatSessionSummary[]>;
  let cacheReads: jest.Mock;
  let cache: SessionOrganizationCache;
  let reader: SessionTaskReader;

  beforeEach(() => {
    sessions = signal<readonly ChatSessionSummary[]>([]);
    cacheReads = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        SessionTaskReader,
        {
          provide: ChatStore,
          useValue: { sessions, organizationAvailable: signal(true) },
        },
        { provide: ClaudeRpcService, useValue: { call: cacheReads } },
        { provide: LoggingService, useValue: { warn: jest.fn(), error: jest.fn() } },
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: () => ({
              tab: { claudeSessionId: 'session-1' },
              workspacePath: 'C:/ws',
            }),
          },
        },
        { provide: AppStateManager, useValue: { workspaceInfo: () => null } },
        { provide: VSCodeService, useValue: {} },
        { provide: TasksChangedFeed, useValue: { changes: () => null } },
        { provide: FILE_LINK_OPENER, useValue: { open: jest.fn() } },
      ],
    });
    jest
      .mocked(rpcCall)
      .mockImplementation(() => new Promise(() => undefined));
    cache = TestBed.inject(SessionOrganizationCache);
    reader = TestBed.inject(SessionTaskReader);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('shows the section for a tab whose session row is not in the loaded list', async () => {
    cacheReads.mockResolvedValue(okRead(organization({ tasks: [TASK_A] })));
    reader.bind(signal('tab-1'));
    TestBed.tick();
    await settle();

    expect(cacheReads).toHaveBeenCalledWith('session:getOrganization', {
      sessionId: 'session-1',
    });
    expect(reader.link()?.lead.taskId).toBe('TASK_A');
    expect(reader.state()).not.toBeNull();
    expect(reader.state()?.data?.lead.taskId).toBe('TASK_A');
  });

  it('updates the link when a session:organizationChanged push re-reads the cache', async () => {
    cacheReads.mockResolvedValueOnce(okRead(organization({ tasks: [TASK_A] })));
    reader.bind(signal('tab-1'));
    TestBed.tick();
    await settle();
    expect(reader.link()?.lead.taskId).toBe('TASK_A');

    cacheReads.mockResolvedValueOnce(okRead(organization({ tasks: [TASK_B] })));
    cache.onOrganizationChanged(['session-1']);
    await settle();

    expect(cacheReads).toHaveBeenCalledTimes(2);
    expect(reader.link()?.lead.taskId).toBe('TASK_B');
    expect(reader.state()?.data?.lead.taskId).toBe('TASK_B');
  });

  it('keeps the section hidden when the session has no linked tasks', async () => {
    cacheReads.mockResolvedValueOnce(okRead(organization({ tasks: [] })));
    reader.bind(signal('tab-1'));
    TestBed.tick();
    await settle();

    expect(reader.link()).toBeNull();
    expect(reader.state()).toBeNull();
  });

  it('keeps the section hidden when the session organization is unknown', async () => {
    cacheReads.mockResolvedValueOnce(notFoundRead());
    reader.bind(signal('tab-1'));
    TestBed.tick();
    await settle();

    expect(reader.link()).toBeNull();
    expect(reader.state()).toBeNull();
  });
});