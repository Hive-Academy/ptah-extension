/**
 * CommandManager unit tests.
 *
 * Exercises the real CommandManager surface: registration, execution wrapping,
 * metric tracking, and disposal. The class has a single injected dependency
 * (vscode.ExtensionContext), so only the `vscode` module needs to be mocked.
 */

import 'reflect-metadata';
import * as vscode from 'vscode';

import { CommandManager, type CommandDefinition } from './command-manager';

// -------------------------------------------------------------------------
// Module-level vscode mock
// -------------------------------------------------------------------------
jest.mock('vscode', () => ({
  commands: {
    registerCommand: jest.fn(),
  },
  Uri: {
    file: jest.fn(),
    parse: jest.fn(),
    joinPath: jest.fn(),
  },
}));

const vscodeModule = jest.requireMock<{
  commands: { registerCommand: jest.Mock };
}>('vscode');

// -------------------------------------------------------------------------
// Test helpers
// -------------------------------------------------------------------------
function createDisposable(): jest.Mocked<vscode.Disposable> {
  return { dispose: jest.fn() };
}

function createMockContext(): jest.Mocked<
  Pick<vscode.ExtensionContext, 'subscriptions'>
> {
  return {
    subscriptions: [],
  } as unknown as jest.Mocked<Pick<vscode.ExtensionContext, 'subscriptions'>>;
}

/** Shape of per-command metrics returned by CommandManager. */
interface CommandMetrics {
  executionCount: number;
  totalDuration: number;
  lastExecuted: number;
  errorCount: number;
}

function getSingleMetrics(
  manager: CommandManager,
  commandId: string,
): CommandMetrics {
  const raw = manager.getCommandMetrics(commandId);
  if (raw === null) {
    throw new Error(`expected metrics for command ${commandId}`);
  }
  return raw as CommandMetrics;
}

describe('CommandManager', () => {
  let context: ReturnType<typeof createMockContext>;
  let registerCommandMock: jest.Mock;
  let disposables: jest.Mocked<vscode.Disposable>[];
  let manager: CommandManager;

  beforeEach(() => {
    jest.clearAllMocks();
    disposables = [];
    registerCommandMock = vscodeModule.commands.registerCommand as jest.Mock;
    registerCommandMock.mockImplementation(() => {
      const disposable = createDisposable();
      disposables.push(disposable);
      return disposable;
    });
    context = createMockContext();
    manager = new CommandManager(context as unknown as vscode.ExtensionContext);
  });

  afterEach(() => {
    manager.dispose();
  });

  // ---------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------
  describe('construction', () => {
    it('starts with no registered commands or metrics', () => {
      expect(manager.getRegisteredCommands()).toEqual([]);
      expect(manager.getCommandMetrics()).toEqual({});
    });
  });

  // ---------------------------------------------------------------------
  // registerCommand
  // ---------------------------------------------------------------------
  describe('registerCommand', () => {
    it('delegates to vscode.commands.registerCommand and tracks registration', () => {
      const handler = jest.fn();
      const definition: CommandDefinition = {
        id: 'ptah.test.basic',
        title: 'Basic',
        handler,
      };

      manager.registerCommand(definition);

      expect(registerCommandMock).toHaveBeenCalledWith(
        'ptah.test.basic',
        expect.any(Function),
      );
      expect(manager.isCommandRegistered('ptah.test.basic')).toBe(true);
      expect(manager.getRegisteredCommands()).toEqual(['ptah.test.basic']);
    });

    it('pushes the vscode disposable onto context.subscriptions', () => {
      manager.registerCommand({
        id: 'ptah.test.subscription',
        title: 'Subscription',
        handler: jest.fn(),
      });

      expect(context.subscriptions).toHaveLength(1);
      expect(context.subscriptions[0]).toBe(disposables[0]);
    });

    it('initialises zeroed metrics for the new command', () => {
      manager.registerCommand({
        id: 'ptah.test.metrics.init',
        title: 'Metrics Init',
        handler: jest.fn(),
      });

      const metrics = getSingleMetrics(manager, 'ptah.test.metrics.init');
      expect(metrics).toEqual({
        executionCount: 0,
        totalDuration: 0,
        lastExecuted: 0,
        errorCount: 0,
      });
    });

    it('throws if the same id is registered twice', () => {
      const definition: CommandDefinition = {
        id: 'ptah.test.duplicate',
        title: 'Duplicate',
        handler: jest.fn(),
      };

      manager.registerCommand(definition);

      expect(() => manager.registerCommand(definition)).toThrow(
        'Command ptah.test.duplicate is already registered',
      );
      // The duplicate attempt must not call vscode again.
      expect(registerCommandMock).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------
  // registerCommands (bulk)
  // ---------------------------------------------------------------------
  describe('registerCommands', () => {
    it('registers every command in the given array', () => {
      const commands: CommandDefinition[] = [
        { id: 'ptah.bulk.1', title: '1', handler: jest.fn() },
        { id: 'ptah.bulk.2', title: '2', handler: jest.fn() },
        { id: 'ptah.bulk.3', title: '3', handler: jest.fn() },
      ];

      manager.registerCommands(commands);

      expect(registerCommandMock).toHaveBeenCalledTimes(3);
      expect(manager.getRegisteredCommands()).toEqual([
        'ptah.bulk.1',
        'ptah.bulk.2',
        'ptah.bulk.3',
      ]);
    });
  });

  // ---------------------------------------------------------------------
  // Wrapped handler behaviour
  // ---------------------------------------------------------------------
  describe('wrapped handler', () => {
    it('invokes the user handler with the forwarded arguments', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      manager.registerCommand({
        id: 'ptah.exec.args',
        title: 'Exec Args',
        handler,
      });

      const wrapped = registerCommandMock.mock.calls[0][1] as (
        ...args: unknown[]
      ) => Promise<void>;
      await wrapped('first', 42, { foo: 'bar' });

      expect(handler).toHaveBeenCalledWith('first', 42, { foo: 'bar' });
    });

    it('tracks successful executions in metrics', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      manager.registerCommand({
        id: 'ptah.exec.metrics',
        title: 'Exec Metrics',
        handler,
      });

      const wrapped = registerCommandMock.mock.calls[0][1] as (
        ...args: unknown[]
      ) => Promise<void>;
      await wrapped();
      await wrapped();

      const metrics = getSingleMetrics(manager, 'ptah.exec.metrics');
      expect(metrics.executionCount).toBe(2);
      expect(metrics.errorCount).toBe(0);
      expect(metrics.lastExecuted).toBeGreaterThan(0);
      expect(typeof metrics.totalDuration).toBe('number');
    });

    it('re-throws handler errors and increments error metrics', async () => {
      const failure = new Error('boom');
      const handler = jest.fn().mockRejectedValue(failure);
      manager.registerCommand({
        id: 'ptah.exec.error',
        title: 'Exec Error',
        handler,
      });

      const wrapped = registerCommandMock.mock.calls[0][1] as (
        ...args: unknown[]
      ) => Promise<void>;

      await expect(wrapped()).rejects.toBe(failure);

      const metrics = getSingleMetrics(manager, 'ptah.exec.error');
      expect(metrics.executionCount).toBe(1);
      expect(metrics.errorCount).toBe(1);
    });

    it('supports synchronous handlers (returning void directly)', async () => {
      const handler = jest.fn<void, []>(() => undefined);
      manager.registerCommand({
        id: 'ptah.exec.sync',
        title: 'Sync',
        handler,
      });

      const wrapped = registerCommandMock.mock.calls[0][1] as (
        ...args: unknown[]
      ) => Promise<void>;
      await wrapped();

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------
  // unregisterCommand
  // ---------------------------------------------------------------------
  describe('unregisterCommand', () => {
    it('disposes the vscode registration and drops tracking', () => {
      manager.registerCommand({
        id: 'ptah.unregister.ok',
        title: 'Unregister',
        handler: jest.fn(),
      });

      const disposable = disposables[0];
      const result = manager.unregisterCommand('ptah.unregister.ok');

      expect(result).toBe(true);
      expect(disposable.dispose).toHaveBeenCalledTimes(1);
      expect(manager.isCommandRegistered('ptah.unregister.ok')).toBe(false);
      expect(manager.getCommandMetrics('ptah.unregister.ok')).toBeNull();
    });

    it('returns false for an unknown command id', () => {
      expect(manager.unregisterCommand('ptah.unknown')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // Metrics accessors
  // ---------------------------------------------------------------------
  describe('getCommandMetrics', () => {
    it('returns null for an unknown command when an id is supplied', () => {
      expect(manager.getCommandMetrics('ptah.missing')).toBeNull();
    });

    it('returns an object keyed by command id when no id is supplied', () => {
      manager.registerCommand({
        id: 'ptah.metrics.all.1',
        title: 'All 1',
        handler: jest.fn(),
      });
      manager.registerCommand({
        id: 'ptah.metrics.all.2',
        title: 'All 2',
        handler: jest.fn(),
      });

      const all = manager.getCommandMetrics() as Record<string, CommandMetrics>;
      expect(Object.keys(all)).toEqual(
        expect.arrayContaining(['ptah.metrics.all.1', 'ptah.metrics.all.2']),
      );
    });
  });

  // ---------------------------------------------------------------------
  // Disposal
  // ---------------------------------------------------------------------
  describe('dispose', () => {
    it('disposes every registered command and clears metrics', () => {
      manager.registerCommand({
        id: 'ptah.dispose.1',
        title: 'Dispose 1',
        handler: jest.fn(),
      });
      manager.registerCommand({
        id: 'ptah.dispose.2',
        title: 'Dispose 2',
        handler: jest.fn(),
      });

      const [d1, d2] = disposables;

      manager.dispose();

      expect(d1.dispose).toHaveBeenCalledTimes(1);
      expect(d2.dispose).toHaveBeenCalledTimes(1);
      expect(manager.getRegisteredCommands()).toEqual([]);
      expect(manager.getCommandMetrics()).toEqual({});
    });

    it('is safe to call twice', () => {
      manager.registerCommand({
        id: 'ptah.dispose.idempotent',
        title: 'Idempotent',
        handler: jest.fn(),
      });

      expect(() => {
        manager.dispose();
        manager.dispose();
      }).not.toThrow();
    });
  });
});
