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

describe('SessionTaskReader async document and progress reads', () => {
  const link = (taskId: string): SessionTaskLinkSummary => ({
    taskId, role: 'primary', source: 'user', createdAt: 1, missing: false,
  });
  const task = (taskId: string): TaskSpecDetail => ({
    id: taskId, folderName: taskId, artifacts: ['context.md', 'batches.md'],
  } as TaskSpecDetail);
  type Pending = {
    method: string;
    resolve: (value: Awaited<ReturnType<typeof rpcCall>>) => void;
    reject: (reason: Error) => void;
  };
  let pending: Pending[];
  let reader: SessionTaskReader;
  let tabId: WritableSignal<string>;
  let changes: WritableSignal<{ seq: number; change: { workspaceRoot: string; folderNames: string[] } } | null>;
  let logger: { error: jest.Mock };

  const take = (method: string): Pending => {
    const index = pending.findIndex(call => call.method === method);
    expect(index).toBeGreaterThanOrEqual(0);
    return pending.splice(index, 1)[0];
  };
  const ok = (data: object): Awaited<ReturnType<typeof rpcCall>> => ({ success: true, data });
  const finishTask = async (taskId: string): Promise<void> => {
    take('tasks:get').resolve(ok({ task: task(taskId) }));
    await settle();
  };
  const markdown = (taskId: string, file: string, content: string): Awaited<ReturnType<typeof rpcCall>> =>
    ok({ taskId, file, state: 'ready', content });

  beforeEach(() => {
    pending = [];
    tabId = signal('tab-a');
    changes = signal<{ seq: number; change: { workspaceRoot: string; folderNames: string[] } } | null>(null);
    logger = { error: jest.fn() };
    const sessions = signal([
      { id: 'session-a', organization: { tasks: [link('TASK_A')] } },
      { id: 'session-b', organization: { tasks: [link('TASK_B')] } },
    ]);
    jest.mocked(rpcCall).mockImplementation((_vscode, method) => new Promise((resolve, reject) => {
      pending.push({ method, resolve, reject });
    }));
    TestBed.configureTestingModule({ providers: [
      SessionTaskReader,
      { provide: ChatStore, useValue: { organizationAvailable: () => true, sessions } },
      { provide: LoggingService, useValue: logger },
      { provide: TabManagerService, useValue: { findTabByIdAcrossWorkspaces: (id: string) => ({
        tab: { claudeSessionId: id === 'tab-a' ? 'session-a' : 'session-b' }, workspacePath: 'C:/ws',
      }) } },
      { provide: AppStateManager, useValue: { workspaceInfo: () => null } },
      { provide: VSCodeService, useValue: {} },
      { provide: TasksChangedFeed, useValue: { changes } },
      { provide: FILE_LINK_OPENER, useValue: { open: jest.fn() } },
    ] });
    reader = TestBed.inject(SessionTaskReader);
    reader.bind(tabId);
    TestBed.tick();
  });
  afterEach(() => TestBed.resetTestingModule());

  it('drops a late preview rejection after a tab and lead switch', async () => {
    await finishTask('TASK_A');
    const oldPreview = reader.previewDocument('context.md');
    const oldRead = take('tasks:getArtifact');
    tabId.set('tab-b');
    TestBed.tick();
    expect(reader.preview()).toBeNull();
    oldRead.reject(new Error('old task failed'));
    await oldPreview;
    expect(reader.preview()).toBeNull();
    await finishTask('TASK_B');
    const nextPreview = reader.previewDocument('context.md');
    take('tasks:getArtifact').resolve(ok({ file: 'context.md', content: 'New task' }));
    await nextPreview;
    expect(reader.preview()?.content).toBe('New task');
    expect(logger.error).not.toHaveBeenCalledWith('SessionTaskReader', 'Could not preview task document', expect.anything());
  });

  it('keeps the newest progress when reads finish in reverse order', async () => {
    await finishTask('TASK_A');
    const older = take('tasks:readFolderMarkdown');
    reader.retry();
    await finishTask('TASK_A');
    const newer = take('tasks:readFolderMarkdown');
    newer.resolve(markdown('TASK_A', 'batches.md', '- [x] New\n- [ ] Next'));
    await settle();
    older.resolve(markdown('TASK_A', 'batches.md', '- [ ] Old'));
    await settle();
    expect(reader.progress()).toMatchObject({ done: 1, total: 2 });
  });

  it('invalidates changed task content under the same filenames', async () => {
    await finishTask('TASK_A');
    take('tasks:readFolderMarkdown').resolve(markdown('TASK_A', 'batches.md', '- [ ] First'));
    await settle();
    const firstPreview = reader.previewDocument('context.md');
    take('tasks:getArtifact').resolve(ok({ file: 'context.md', content: 'Before change' }));
    await firstPreview;
    changes.set({ seq: 1, change: { workspaceRoot: 'C:/ws', folderNames: ['TASK_A'] } });
    TestBed.tick();
    const nextPreview = take('tasks:getArtifact');
    nextPreview.resolve(ok({ file: 'context.md', content: 'After change' }));
    await settle();
    expect(reader.preview()?.content).toBe('After change');
    await new Promise(resolve => setTimeout(resolve, 350));
    await settle();
    await finishTask('TASK_A');
    take('tasks:readFolderMarkdown').resolve(markdown('TASK_A', 'batches.md', '- [x] Changed'));
    await settle();
    expect(reader.progress()).toMatchObject({ done: 1, total: 1 });
  });

  it('logs progress and preview RPC rejections while retaining the previous progress', async () => {
    await finishTask('TASK_A');
    take('tasks:readFolderMarkdown').resolve(markdown('TASK_A', 'batches.md', '- [x] Done'));
    await settle();
    changes.set({ seq: 1, change: { workspaceRoot: 'C:/ws', folderNames: ['TASK_A'] } });
    TestBed.tick();
    await new Promise(resolve => setTimeout(resolve, 350));
    await settle();
    await finishTask('TASK_A');
    take('tasks:readFolderMarkdown').reject(new Error('progress offline'));
    await settle();
    expect(reader.progress()).toMatchObject({ done: 1, total: 1 });
    expect(logger.error).toHaveBeenCalledWith('SessionTaskReader', 'Could not load task progress', expect.objectContaining({ message: 'progress offline' }));
    const preview = reader.previewDocument('context.md');
    take('tasks:getArtifact').reject(new Error('preview offline'));
    await preview;
    expect(reader.preview()?.status).toBe('error');
    expect(logger.error).toHaveBeenCalledWith('SessionTaskReader', 'Could not preview task document', expect.objectContaining({ message: 'preview offline' }));
  });
});
