/**
 * TasksRpcHandlers — unit specs.
 *
 * Coverage:
 *   METHODS invariant       — exactly the 7 tasks:* names
 *   register()              — wires all 7 methods
 *   tasks:list              — Zod rejection (bad status) → INVALID_PARAMS
 *   tasks:list              — no workspace open → WORKSPACE_NOT_OPEN
 *   tasks:list              — normalizes workspaceRoot before delegating
 *   tasks:board             — groups into six always-present columns
 *   tasks:create            — folder collision surfaces structured error
 *   tasks:list              — sanitizes unexpected errors (no path leakage)
 *   constructor             — broadcasts tasks:changed on index events
 *
 * Source-under-test:
 *   libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts
 */
import 'reflect-metadata';

import type {
  Logger,
  RpcHandler,
  WebviewManager,
} from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  createMockWorkspaceProvider,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import {
  normalizeWorkspaceRoot,
  type TaskIndexService,
  type TaskWriterService,
  type RegistryGeneratorService,
  type TaskIndexChangeEvent,
} from '@ptah-extension/task-specs';
import type { TaskSpecSummary } from '@ptah-extension/shared';

import { TasksRpcHandlers } from './tasks-rpc.handlers';

interface FakeIndex {
  onDidChangeIndex: jest.Mock;
  ensureStarted: jest.Mock;
  list: jest.Mock;
  getDetail: jest.Mock;
  reindex: jest.Mock;
  fire: (event: TaskIndexChangeEvent) => void;
}

function createFakeIndex(): FakeIndex {
  let listener: ((e: TaskIndexChangeEvent) => void) | undefined;
  return {
    onDidChangeIndex: jest.fn((l: (e: TaskIndexChangeEvent) => void) => {
      listener = l;
      return { dispose: jest.fn() };
    }),
    ensureStarted: jest.fn().mockResolvedValue(undefined),
    list: jest
      .fn()
      .mockResolvedValue({ tasks: [], excludedCount: 0, specsDirExists: true }),
    getDetail: jest.fn().mockResolvedValue(null),
    reindex: jest
      .fn()
      .mockResolvedValue({ indexedCount: 0, excludedCount: 0, durationMs: 1 }),
    fire: (event) => listener?.(event),
  };
}

interface MockWebviewManager {
  broadcastMessage: jest.Mock;
}

interface Suite {
  handlers: TasksRpcHandlers;
  rpc: MockRpcHandler;
  workspace: MockWorkspaceProvider;
  index: FakeIndex;
  writer: { create: jest.Mock; updateStatus: jest.Mock };
  registry: { generate: jest.Mock };
  webviewManager: MockWebviewManager;
  logger: MockLogger;
}

function buildSuite(wsRoot: string | null = 'D:\\workspace'): Suite {
  const logger = createMockLogger();
  const rpc = createMockRpcHandler();
  const workspace = createMockWorkspaceProvider(
    wsRoot ? { folders: [wsRoot] } : { folders: [] },
  );
  if (!wsRoot) workspace.getWorkspaceRoot.mockReturnValue(undefined);
  else workspace.getWorkspaceRoot.mockReturnValue(wsRoot);

  const index = createFakeIndex();
  const writer = {
    create: jest.fn().mockResolvedValue({
      success: true,
      task: { id: 'TASK_2026_200' } as TaskSpecSummary,
    }),
    updateStatus: jest.fn().mockResolvedValue({
      success: true,
      task: { id: 'TASK_2026_200' } as TaskSpecSummary,
    }),
  };
  const registry = {
    generate: jest.fn().mockResolvedValue({
      registryPath: '.ptah/specs/registry.md',
      includedCount: 3,
      excludedCount: 85,
      changed: true,
    }),
  };
  const webviewManager: MockWebviewManager = {
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
  };

  const handlers = new TasksRpcHandlers(
    logger as unknown as Logger,
    rpc as unknown as RpcHandler,
    webviewManager as unknown as WebviewManager,
    workspace as unknown as IWorkspaceProvider,
    index as unknown as TaskIndexService,
    writer as unknown as TaskWriterService,
    registry as unknown as RegistryGeneratorService,
  );
  handlers.register();

  return {
    handlers,
    rpc,
    workspace,
    index,
    writer,
    registry,
    webviewManager,
    logger,
  };
}

function getHandler(
  rpc: MockRpcHandler,
  method: string,
): (params: unknown) => Promise<unknown> {
  const calls = (rpc.registerMethod as jest.Mock).mock.calls as Array<
    [string, (p: unknown) => Promise<unknown>]
  >;
  const match = calls.find(([name]) => name === method);
  if (!match) throw new Error(`Method '${method}' was not registered`);
  return match[1];
}

describe('TasksRpcHandlers.METHODS', () => {
  it('owns exactly the 7 tasks:* methods', () => {
    expect([...TasksRpcHandlers.METHODS]).toEqual([
      'tasks:list',
      'tasks:get',
      'tasks:create',
      'tasks:updateStatus',
      'tasks:generateRegistry',
      'tasks:board',
      'tasks:reindex',
    ]);
  });
});

describe('TasksRpcHandlers.register', () => {
  it('wires all 7 methods into the RpcHandler', () => {
    const { rpc } = buildSuite();
    for (const method of TasksRpcHandlers.METHODS) {
      expect(() => getHandler(rpc, method)).not.toThrow();
    }
  });
});

describe('tasks:list', () => {
  it('rejects an invalid status filter with INVALID_PARAMS', async () => {
    const { rpc } = buildSuite();
    const handler = getHandler(rpc, 'tasks:list');
    await expect(handler({ status: ['not-a-status'] })).rejects.toMatchObject({
      errorCode: 'INVALID_PARAMS',
    });
  });

  it('throws WORKSPACE_NOT_OPEN when no workspace is open', async () => {
    const { rpc } = buildSuite(null);
    const handler = getHandler(rpc, 'tasks:list');
    await expect(handler({})).rejects.toMatchObject({
      errorCode: 'WORKSPACE_NOT_OPEN',
    });
  });

  it('normalizes the workspace root before warming + delegating', async () => {
    const { rpc, index } = buildSuite();
    const handler = getHandler(rpc, 'tasks:list');
    await handler({ workspaceRoot: 'D:\\Workspace\\' });
    const expected = normalizeWorkspaceRoot('D:\\Workspace\\');
    expect(index.ensureStarted).toHaveBeenCalledWith(expected);
    expect(index.list).toHaveBeenCalledWith(
      expected,
      expect.objectContaining({}),
    );
  });

  it('sanitizes unexpected failures (no absolute-path leakage, R4.4)', async () => {
    const { rpc, index } = buildSuite();
    index.list.mockRejectedValue(
      new Error('ENOENT: no such file, open D:\\workspace\\.ptah\\specs'),
    );
    const handler = getHandler(rpc, 'tasks:list');
    const error = await handler({}).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('Failed to list tasks.');
    expect(error?.message).not.toMatch(/ENOENT|\.ptah|D:\\/);
  });
});

describe('tasks:board', () => {
  it('groups tasks into six always-present columns', async () => {
    const { rpc, index } = buildSuite();
    index.list.mockResolvedValueOnce({
      tasks: [
        { status: 'backlog' } as TaskSpecSummary,
        { status: 'done' } as TaskSpecSummary,
        { status: 'done' } as TaskSpecSummary,
      ],
      excludedCount: 2,
      specsDirExists: true,
    });
    const handler = getHandler(rpc, 'tasks:board');
    const result = (await handler({})) as {
      columns: Record<string, unknown[]>;
      excludedCount: number;
    };
    expect(Object.keys(result.columns).sort()).toEqual(
      [
        'backlog',
        'blocked',
        'cancelled',
        'done',
        'in_progress',
        'in_review',
      ].sort(),
    );
    expect(result.columns['done']).toHaveLength(2);
    expect(result.columns['backlog']).toHaveLength(1);
    expect(result.columns['in_review']).toHaveLength(0);
    expect(result.excludedCount).toBe(2);
  });
});

describe('tasks:create', () => {
  it('surfaces a folder collision as a structured error', async () => {
    const { rpc, writer } = buildSuite();
    writer.create.mockResolvedValueOnce({
      success: false,
      error: { code: 'TASK_FOLDER_EXISTS', message: 'Task folder exists.' },
    });
    const handler = getHandler(rpc, 'tasks:create');
    const result = (await handler({ title: 'X', type: 'FEATURE' })) as {
      success: boolean;
      error?: { code: string };
    };
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('TASK_FOLDER_EXISTS');
  });

  it('rejects a missing title with INVALID_PARAMS', async () => {
    const { rpc } = buildSuite();
    const handler = getHandler(rpc, 'tasks:create');
    await expect(handler({ type: 'FEATURE' })).rejects.toMatchObject({
      errorCode: 'INVALID_PARAMS',
    });
  });
});

describe('tasks:changed broadcast', () => {
  it('rebroadcasts index changes as tasks:changed', () => {
    const { index, webviewManager } = buildSuite();
    index.fire({
      workspaceRoot: 'd:\\workspace',
      reason: 'write',
      folderNames: ['TASK_2026_200'],
    });
    expect(webviewManager.broadcastMessage).toHaveBeenCalledWith(
      'tasks:changed',
      {
        workspaceRoot: 'd:\\workspace',
        reason: 'write',
        folderNames: ['TASK_2026_200'],
      },
    );
  });
});
