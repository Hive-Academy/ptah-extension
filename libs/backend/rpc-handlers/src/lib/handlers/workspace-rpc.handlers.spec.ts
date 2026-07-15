/**
 * WorkspaceRpcHandlers — `workspace:switch` session-import deferral specs.
 *
 * Locks the TASK_2026_154 behaviour: the switch RPC must respond WITHOUT
 * blocking on `SessionImporterService.scanAndImport`, and the deferred import
 * is throttled by a per-path recency guard + an in-flight guard so rapid
 * A↔B↔A switching does not rescan every time. Import failures must stay
 * non-fatal to the switch response.
 *
 * These assert observable outcomes (what the RPC returns, whether/when the
 * importer is invoked), not spy wiring.
 */

import 'reflect-metadata';

import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import type { WorkspaceContextManager } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type {
  IWorkspaceProvider,
  IWorkspaceLifecycleProvider,
  IUserInteraction,
} from '@ptah-extension/platform-core';
import type { SessionImporterService } from '@ptah-extension/agent-sdk';

import { WorkspaceRpcHandlers } from './workspace-rpc.handlers';

type Mocked<T> = jest.Mocked<T>;

interface SwitchResult {
  success: boolean;
  path?: string;
  name?: string;
  encodedPath?: string;
  error?: string;
}

type SwitchHandler = (
  params: { path: string; origin?: string } | undefined,
) => Promise<SwitchResult>;

interface Suite {
  handlers: WorkspaceRpcHandlers;
  rpc: MockRpcHandler;
  logger: ReturnType<typeof createMockLogger>;
  lifecycle: Mocked<IWorkspaceLifecycleProvider>;
  contextManager: Mocked<WorkspaceContextManager>;
  sessionImporter: Mocked<SessionImporterService>;
  switchHandler: SwitchHandler;
}

const WS_A = 'D:\\projects\\alpha';
const WS_B = 'D:\\projects\\beta';

/** Flush pending microtasks so a fire-and-forget `.then/.finally` chain runs. */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function buildSuite(): Suite {
  const logger = createMockLogger();
  const rpc = createMockRpcHandler();

  const workspaceProvider = {
    getWorkspaceFolders: jest.fn().mockReturnValue([]),
    getWorkspaceRoot: jest.fn().mockReturnValue(undefined),
  } as unknown as Mocked<IWorkspaceProvider>;

  const lifecycle = {
    setPendingOrigin: jest.fn(),
    setActiveFolder: jest.fn(),
    getActiveFolder: jest.fn().mockReturnValue(undefined),
    addFolder: jest.fn(),
    removeFolder: jest.fn(),
  } as unknown as Mocked<IWorkspaceLifecycleProvider>;

  const userInteraction = {} as unknown as Mocked<IUserInteraction>;

  const contextManager = {
    switchWorkspace: jest.fn().mockResolvedValue('encoded-path'),
    createWorkspace: jest.fn(),
    removeWorkspace: jest.fn(),
  } as unknown as Mocked<WorkspaceContextManager>;

  const sessionImporter = {
    scanAndImport: jest.fn().mockResolvedValue(0),
  } as unknown as Mocked<SessionImporterService>;

  const providerProxyPool = {
    disposeForScope: jest.fn().mockResolvedValue(undefined),
    disposeAll: jest.fn().mockResolvedValue(undefined),
  } as unknown as import('@ptah-extension/auth-providers').ProviderProxyPool;

  const handlers = new WorkspaceRpcHandlers(
    logger as unknown as Logger,
    rpc as unknown as RpcHandler,
    workspaceProvider,
    lifecycle,
    userInteraction,
    contextManager,
    sessionImporter,
    providerProxyPool,
  );
  handlers.register();

  const switchHandler = rpc.__handlers().get('workspace:switch') as unknown as
    | SwitchHandler
    | undefined;
  if (!switchHandler) {
    throw new Error('workspace:switch handler was not registered');
  }

  return {
    handlers,
    rpc,
    logger,
    lifecycle,
    contextManager,
    sessionImporter,
    switchHandler,
  };
}

describe('WorkspaceRpcHandlers — workspace:switch import deferral', () => {
  it('responds successfully WITHOUT awaiting scanAndImport', async () => {
    const s = buildSuite();
    // Import never resolves: if the switch awaited it, this would hang.
    s.sessionImporter.scanAndImport.mockReturnValue(
      new Promise<number>(() => {
        /* never resolves */
      }),
    );

    const result = await s.switchHandler({ path: WS_A });

    expect(result).toEqual({
      success: true,
      path: WS_A,
      name: 'alpha',
      encodedPath: 'encoded-path',
    });
    // The import was still kicked off (fire-and-forget).
    expect(s.sessionImporter.scanAndImport).toHaveBeenCalledWith(WS_A, 50);
    expect(s.lifecycle.setActiveFolder).toHaveBeenCalledWith(WS_A);
  });

  it('runs the deferred import fire-and-forget after responding', async () => {
    const s = buildSuite();
    s.sessionImporter.scanAndImport.mockResolvedValue(2);

    await s.switchHandler({ path: WS_A });
    await flushMicrotasks();

    expect(s.sessionImporter.scanAndImport).toHaveBeenCalledTimes(1);
  });

  it('recency guard skips a second import for the same path within the window', async () => {
    const s = buildSuite();
    s.sessionImporter.scanAndImport.mockResolvedValue(1);

    await s.switchHandler({ path: WS_A });
    await flushMicrotasks(); // first import completes → records timestamp

    await s.switchHandler({ path: WS_A });
    await flushMicrotasks();

    expect(s.sessionImporter.scanAndImport).toHaveBeenCalledTimes(1);
  });

  it('in-flight guard skips a concurrent import for the same path', async () => {
    const s = buildSuite();
    // Never resolves → stays in-flight across both switches.
    s.sessionImporter.scanAndImport.mockReturnValue(
      new Promise<number>(() => {
        /* pending */
      }),
    );

    await s.switchHandler({ path: WS_A });
    await s.switchHandler({ path: WS_A });

    expect(s.sessionImporter.scanAndImport).toHaveBeenCalledTimes(1);
  });

  it('failure-backoff guard skips a re-import for a recently-failed path', async () => {
    const s = buildSuite();
    // The import fails on every attempt (e.g. corrupt JSONL / permissions).
    s.sessionImporter.scanAndImport.mockRejectedValue(new Error('boom'));

    await s.switchHandler({ path: WS_A });
    await flushMicrotasks(); // first import fails → records failure timestamp

    await s.switchHandler({ path: WS_A });
    await flushMicrotasks();

    // The second switch to the just-failed path is NOT rescanned (backoff).
    expect(s.sessionImporter.scanAndImport).toHaveBeenCalledTimes(1);
  });

  it('imports distinct workspace paths independently', async () => {
    const s = buildSuite();
    s.sessionImporter.scanAndImport.mockResolvedValue(0);

    await s.switchHandler({ path: WS_A });
    await flushMicrotasks();
    await s.switchHandler({ path: WS_B });
    await flushMicrotasks();

    expect(s.sessionImporter.scanAndImport).toHaveBeenCalledTimes(2);
    expect(s.sessionImporter.scanAndImport).toHaveBeenCalledWith(WS_A, 50);
    expect(s.sessionImporter.scanAndImport).toHaveBeenCalledWith(WS_B, 50);
  });

  it('a failing deferred import does not fail the switch', async () => {
    const s = buildSuite();
    s.sessionImporter.scanAndImport.mockRejectedValue(new Error('boom'));

    const result = await s.switchHandler({ path: WS_A });
    await flushMicrotasks();

    expect(result.success).toBe(true);
    expect(s.logger.warn).toHaveBeenCalledWith(
      '[RPC] workspace:switch session import failed (non-fatal)',
      expect.objectContaining({ error: 'boom' }),
    );
  });

  it('does not import when the workspace context fails to switch', async () => {
    const s = buildSuite();
    s.contextManager.switchWorkspace.mockResolvedValue('');

    const result = await s.switchHandler({ path: WS_A });

    expect(result.success).toBe(false);
    expect(s.sessionImporter.scanAndImport).not.toHaveBeenCalled();
  });

  it('rejects a switch with no path', async () => {
    const s = buildSuite();

    const result = await s.switchHandler({ path: '' });

    expect(result).toEqual({ success: false, error: 'path is required' });
    expect(s.sessionImporter.scanAndImport).not.toHaveBeenCalled();
  });
});
