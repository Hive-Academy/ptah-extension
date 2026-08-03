/**
 * terminal-rpc.handlers.spec.ts
 *
 * CHARACTERIZATION tests for TerminalRpcHandlers — the RPC methods backing
 * PTY session lifecycle:
 *
 *   terminal:create — spawn a new PTY session
 *   terminal:kill   — kill an existing PTY session
 *
 * These tests exist to PIN current behavior across the P3 handler-unification
 * move (TASK_2026_171), not to validate "correct" behavior. Two odd bits are
 * deliberately pinned as-is:
 *
 *   - terminal:create falls back to `homedir()` (a top-level import from
 *     `node:os`) when neither an explicit `cwd` param nor a workspace root is
 *     available (terminal-rpc.handlers.ts). This was a lazy inline
 *     `require('os').homedir()` while the class lived in apps/ptah-electron;
 *     the swap to a top-level import is behaviourally identical and this case
 *     is what verifies that (TASK_2026_171 risk R6).
 *   - terminal:create RE-THROWS on ptyManager.create() failure (it does NOT
 *     swallow), the opposite of layout:persist/layout:restore and of
 *     update:check-now, which both swallow and return a `success: false`
 *     payload instead. Because the test harness routes through
 *     `createMockRpcHandler().handleMessage()` (which itself catches thrown
 *     errors, mirroring production `RpcHandler`), this surfaces as
 *     `raw.success === false` / `raw.error === <message>` rather than an
 *     unhandled rejection from `handleMessage` itself.
 *
 * Strategy: construct TerminalRpcHandlers directly (no DI container) using
 * `createMockRpcHandler()` / `createMockWorkspaceProvider()`, plus a
 * hand-rolled IPtyHost stub, mirroring layout-rpc.handlers.spec.ts in this
 * directory.
 */

import 'reflect-metadata';
import { homedir } from 'node:os';

import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import {
  createMockWorkspaceProvider,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import type {
  IPtyHost,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';

import { TerminalRpcHandlers } from './terminal-rpc.handlers';

interface MockPtyManager {
  create: jest.Mock;
  kill: jest.Mock;
}

function createMockPtyManager(): MockPtyManager {
  return {
    create: jest.fn(),
    kill: jest.fn(),
  };
}

describe('TerminalRpcHandlers', () => {
  let logger: MockLogger;
  let rpcHandler: MockRpcHandler;
  let workspace: MockWorkspaceProvider;
  let ptyManager: MockPtyManager;

  function buildHandlers(workspaceFolders: string[] = []) {
    logger = createMockLogger();
    rpcHandler = createMockRpcHandler();
    workspace = createMockWorkspaceProvider({ folders: workspaceFolders });
    ptyManager = createMockPtyManager();

    const handlers = new TerminalRpcHandlers(
      logger as unknown as Logger,
      rpcHandler as unknown as RpcHandler,
      workspace as unknown as IWorkspaceProvider,
      ptyManager as unknown as IPtyHost,
    );
    handlers.register();
    return { handlers, rpcHandler, workspace, ptyManager };
  }

  describe('terminal:create', () => {
    it('uses the workspace root as cwd when no explicit cwd param is given', async () => {
      const { rpcHandler, ptyManager } = buildHandlers(['/ws/root']);
      ptyManager.create.mockReturnValue({ id: 't1', pid: 111 });

      const raw = await rpcHandler.handleMessage({
        method: 'terminal:create',
        params: { shell: 'bash', name: 'main' },
        correlationId: 'c-create-wsroot',
      });

      expect(ptyManager.create).toHaveBeenCalledWith({
        cwd: '/ws/root',
        shell: 'bash',
        name: 'main',
      });
      expect(raw.success).toBe(true);
      expect(raw.data).toEqual({ id: 't1', pid: 111 });
    });

    it('prefers an explicit params.cwd over the workspace root', async () => {
      const { rpcHandler, ptyManager } = buildHandlers(['/ws/root']);
      ptyManager.create.mockReturnValue({ id: 't2', pid: 222 });

      await rpcHandler.handleMessage({
        method: 'terminal:create',
        params: { cwd: '/explicit', shell: 'bash' },
        correlationId: 'c-create-explicit-cwd',
      });

      expect(ptyManager.create).toHaveBeenCalledWith({
        cwd: '/explicit',
        shell: 'bash',
        name: undefined,
      });
    });

    it('CHARACTERIZATION: falls back to require("os").homedir() when there is no cwd param and no workspace root', async () => {
      const { rpcHandler, ptyManager } = buildHandlers([]);
      ptyManager.create.mockReturnValue({ id: 't3', pid: 333 });

      await rpcHandler.handleMessage({
        method: 'terminal:create',
        params: {},
        correlationId: 'c-create-homedir-fallback',
      });

      expect(ptyManager.create).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: homedir() }),
      );
    });

    it('CHARACTERIZATION: re-throws (does not swallow) when ptyManager.create throws an Error', async () => {
      const { rpcHandler, ptyManager } = buildHandlers(['/ws/root']);
      ptyManager.create.mockImplementation(() => {
        throw new Error('spawn failed');
      });

      const raw = await rpcHandler.handleMessage({
        method: 'terminal:create',
        params: {},
        correlationId: 'c-create-throws',
      });

      // The mock RpcHandler's handleMessage catches thrown errors the same
      // way production RpcHandler does, so the re-throw surfaces as a
      // failed response rather than an unhandled rejection.
      expect(raw.success).toBe(false);
      expect(raw.error).toBe('spawn failed');
      expect(logger.error).toHaveBeenCalledWith(
        '[TerminalRpc] Failed to create terminal',
        expect.objectContaining({ error: 'spawn failed' }),
      );
    });

    it('CHARACTERIZATION: stringifies a non-Error throw before re-throwing', async () => {
      const { rpcHandler, ptyManager } = buildHandlers(['/ws/root']);
      ptyManager.create.mockImplementation(() => {
        throw 'boom';
      });

      const raw = await rpcHandler.handleMessage({
        method: 'terminal:create',
        params: {},
        correlationId: 'c-create-throws-nonerror',
      });

      expect(raw.success).toBe(false);
      expect(raw.error).toBe('boom');
    });
  });

  describe('terminal:kill', () => {
    it('returns { success: false, error: "id is required" } without calling ptyManager.kill when id is missing', async () => {
      const { rpcHandler, ptyManager } = buildHandlers();

      const rawUndefined = await rpcHandler.handleMessage({
        method: 'terminal:kill',
        params: undefined,
        correlationId: 'c-kill-undefined',
      });
      const rawEmpty = await rpcHandler.handleMessage({
        method: 'terminal:kill',
        params: {},
        correlationId: 'c-kill-empty',
      });

      expect(ptyManager.kill).not.toHaveBeenCalled();
      expect(rawUndefined.data).toEqual({
        success: false,
        error: 'id is required',
      });
      expect(rawEmpty.data).toEqual({
        success: false,
        error: 'id is required',
      });
    });

    it('delegates directly to ptyManager.kill(id) and returns its result verbatim', async () => {
      const { rpcHandler, ptyManager } = buildHandlers();
      ptyManager.kill.mockReturnValue({ success: true });

      const raw = await rpcHandler.handleMessage({
        method: 'terminal:kill',
        params: { id: 'term-1' },
        correlationId: 'c-kill-happy',
      });

      expect(ptyManager.kill).toHaveBeenCalledWith('term-1');
      expect(raw.data).toEqual({ success: true });
    });
  });

  it('register() registers exactly terminal:create and terminal:kill', () => {
    const { rpcHandler } = buildHandlers();

    expect(rpcHandler.registerMethod).toHaveBeenCalledTimes(2);
    expect(rpcHandler.registerMethod).toHaveBeenCalledWith(
      'terminal:create',
      expect.any(Function),
    );
    expect(rpcHandler.registerMethod).toHaveBeenCalledWith(
      'terminal:kill',
      expect.any(Function),
    );
  });
});
