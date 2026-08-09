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

  // A shell that is allowlisted on the host running the suite, so the
  // "reaches ptyManager.create" assertions are OS-independent.
  const ALLOWED_SHELL = process.platform === 'win32' ? 'cmd.exe' : 'bash';

  describe('terminal:create', () => {
    it('uses the workspace root as cwd when no explicit cwd param is given', async () => {
      // Was pinned with `shell: 'bash'`; a raw `'bash'` now fails the win32
      // allowlist, so this assertion is decoupled from shell — it pins the
      // wsRoot-default cwd with the host default shell (absent). (TASK_2026_174)
      const { rpcHandler, ptyManager } = buildHandlers(['/ws/root']);
      ptyManager.create.mockReturnValue({ id: 't1', pid: 111 });

      const raw = await rpcHandler.handleMessage({
        method: 'terminal:create',
        params: { name: 'main' },
        correlationId: 'c-create-wsroot',
      });

      expect(ptyManager.create).toHaveBeenCalledWith({
        cwd: '/ws/root',
        shell: undefined,
        name: 'main',
        // The authorized-root set (workspace folders + home) is handed down the
        // port so the sink can re-validate cwd (TASK_2026_191 F4).
        authorizedRoots: ['/ws/root', homedir()],
      });
      expect(raw.success).toBe(true);
      expect(raw.data).toEqual({ id: 't1', pid: 111 });
    });

    it('prefers an explicit params.cwd contained in the workspace over the workspace root', async () => {
      const { rpcHandler, ptyManager } = buildHandlers(['/ws/root']);
      ptyManager.create.mockReturnValue({ id: 't2', pid: 222 });

      await rpcHandler.handleMessage({
        method: 'terminal:create',
        params: { cwd: '/ws/root/sub' },
        correlationId: 'c-create-explicit-cwd',
      });

      expect(ptyManager.create).toHaveBeenCalledWith({
        cwd: '/ws/root/sub',
        shell: undefined,
        name: undefined,
        authorizedRoots: ['/ws/root', homedir()],
      });
    });

    it('rejects a cwd outside the workspace root and home, without calling ptyManager.create', async () => {
      // Was pinned as "prefers /explicit"; /explicit is outside every workspace
      // root and outside home, so P2 containment now rejects it. (TASK_2026_174)
      const { rpcHandler, ptyManager } = buildHandlers(['/ws/root']);

      const raw = await rpcHandler.handleMessage({
        method: 'terminal:create',
        params: { cwd: '/explicit' },
        correlationId: 'c-create-cwd-outside',
      });

      expect(ptyManager.create).not.toHaveBeenCalled();
      expect(raw.success).toBe(false);
    });

    it('rejects a shell outside the allowlist, without calling ptyManager.create', async () => {
      const { rpcHandler, ptyManager } = buildHandlers(['/ws/root']);

      const raw = await rpcHandler.handleMessage({
        method: 'terminal:create',
        params: { shell: 'rm' },
        correlationId: 'c-create-shell-disallowed',
      });

      expect(ptyManager.create).not.toHaveBeenCalled();
      expect(raw.success).toBe(false);
    });

    it('rejects a shell that supplies a path separator, without calling ptyManager.create', async () => {
      const { rpcHandler, ptyManager } = buildHandlers(['/ws/root']);

      const raw = await rpcHandler.handleMessage({
        method: 'terminal:create',
        params: { shell: '/tmp/evil/bash' },
        correlationId: 'c-create-shell-path',
      });

      expect(ptyManager.create).not.toHaveBeenCalled();
      expect(raw.success).toBe(false);
    });

    it('passes an allowlisted shell through to ptyManager.create', async () => {
      const { rpcHandler, ptyManager } = buildHandlers(['/ws/root']);
      ptyManager.create.mockReturnValue({ id: 't4', pid: 444 });

      const raw = await rpcHandler.handleMessage({
        method: 'terminal:create',
        params: { shell: ALLOWED_SHELL },
        correlationId: 'c-create-shell-allowed',
      });

      expect(ptyManager.create).toHaveBeenCalledWith({
        cwd: '/ws/root',
        shell: ALLOWED_SHELL,
        name: undefined,
        authorizedRoots: ['/ws/root', homedir()],
      });
      expect(raw.success).toBe(true);
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

    it('re-throws a FIXED non-reflecting message (not the raw spawn error) when ptyManager.create throws an Error, but still logs the raw message host-side', async () => {
      // F3 (TASK_2026_174): the raw node-pty spawn failure (errno / offending
      // path) must NOT cross the RPC boundary — it would let the renderer probe
      // filesystem state. The handler re-throws a fixed string but keeps the
      // raw message in the host-side logger.error for diagnostics.
      const { rpcHandler, ptyManager } = buildHandlers(['/ws/root']);
      ptyManager.create.mockImplementation(() => {
        throw new Error('spawn failed: ENOENT /home/victim/secret-dir');
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
      // Fixed message reaches the renderer — no errno / path reflected.
      expect(raw.error).toBe('terminal:create: failed to spawn terminal');
      expect(raw.error).not.toContain('ENOENT');
      expect(raw.error).not.toContain('secret-dir');
      // The raw diagnostic is retained host-side.
      expect(logger.error).toHaveBeenCalledWith(
        '[TerminalRpc] Failed to create terminal',
        expect.objectContaining({
          error: 'spawn failed: ENOENT /home/victim/secret-dir',
        }),
      );
    });

    it('re-throws the same FIXED message on a non-Error throw, and logs the stringified raw value host-side', async () => {
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
      expect(raw.error).toBe('terminal:create: failed to spawn terminal');
      // Raw value still stringified into the host-side diagnostic.
      expect(logger.error).toHaveBeenCalledWith(
        '[TerminalRpc] Failed to create terminal',
        expect.objectContaining({ error: 'boom' }),
      );
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
