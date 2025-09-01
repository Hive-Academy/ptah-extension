/**
 * CommandManager Tests - User Requirement Validation
 * Testing Week 2 implementation: VS Code Command Manager with Event Integration
 * Validates user requirements from TASK_CMD_002
 */

import 'reflect-metadata';
import * as vscode from 'vscode';
import { CommandManager, CommandDefinition } from './command-manager';
// EventBus and TOKENS used for dependency injection in tests

// Mock VS Code API with proper disposable patterns

jest.mock('vscode', () => ({
  commands: {
    registerCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  },
  ExtensionContext: jest.fn(),
  window: {
    createWebviewPanel: jest.fn(),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn()
  },
  ViewColumn: { One: 1, Two: 2, Three: 3 },
  Uri: {
    file: jest.fn(),
    parse: jest.fn(),
    joinPath: jest.fn()
  }
}));

// Access the mocked commands after the mock is set up
const mockCommands = require('vscode').commands;

// Mock EventBus
const mockEventBus = {
  publish: jest.fn(),
  subscribe: jest.fn(),
  dispose: jest.fn(),
};

describe('CommandManager - User Requirement: VS Code Command Abstraction', () => {
  let commandManager: CommandManager;
  let mockContext: vscode.ExtensionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockContext = {
      subscriptions: [],
      workspaceState: { get: jest.fn(), update: jest.fn(), keys: jest.fn().mockReturnValue([]) },
      globalState: { get: jest.fn(), update: jest.fn(), setKeysForSync: jest.fn(), keys: jest.fn().mockReturnValue([]) },
      secrets: { get: jest.fn(), store: jest.fn(), delete: jest.fn(), onDidChange: jest.fn() },
      extensionUri: { scheme: 'file', authority: '', path: '/test', query: '', fragment: '', fsPath: '/test', with: jest.fn(), toString: jest.fn(), toJSON: jest.fn() },
      extensionPath: '/test/extension/path',
      environmentVariableCollection: { persistent: false, replace: jest.fn(), append: jest.fn(), prepend: jest.fn(), get: jest.fn(), forEach: jest.fn(), delete: jest.fn(), clear: jest.fn() },
      storagePath: '/test/storage/path',
      globalStoragePath: '/test/global/storage/path',
      logPath: '/test/log/path',
      extensionMode: 1,
      logUri: { scheme: 'file', authority: '', path: '/test/log', query: '', fragment: '', fsPath: '/test/log', with: jest.fn(), toString: jest.fn(), toJSON: jest.fn() },
      storageUri: { scheme: 'file', authority: '', path: '/test/storage', query: '', fragment: '', fsPath: '/test/storage', with: jest.fn(), toString: jest.fn(), toJSON: jest.fn() },
      globalStorageUri: { scheme: 'file', authority: '', path: '/test/global', query: '', fragment: '', fsPath: '/test/global', with: jest.fn(), toString: jest.fn(), toJSON: jest.fn() },
      asAbsolutePath: jest.fn(),
      extension: { id: 'test.extension', extensionUri: { scheme: 'file', path: '/test', fsPath: '/test' } as any, extensionPath: '/test', isActive: true, packageJSON: {}, exports: undefined, activate: jest.fn(), extensionKind: 1 },
      languageModelAccessInformation: { onDidChange: jest.fn(), canSendRequest: jest.fn().mockReturnValue(true) }
    } as any;
    
    commandManager = new CommandManager(mockContext, mockEventBus as any);
  });

  afterEach(() => {
    commandManager.dispose();
  });

  describe('User Scenario: Command Registration', () => {
    it('should register commands with VS Code API and track them', () => {
      // GIVEN: User wants to register a command
      const commandDefinition: CommandDefinition = {
        id: 'ptah.test.command',
        title: 'Test Command',
        category: 'Ptah',
        handler: jest.fn(),
      };

      // WHEN: Registering the command
      commandManager.registerCommand(commandDefinition);

      // THEN: Command should be registered with VS Code and tracked
      expect(mockCommands.registerCommand).toHaveBeenCalledWith(
        'ptah.test.command',
        expect.any(Function)
      );
      expect(commandManager.isCommandRegistered('ptah.test.command')).toBe(true);
      expect(mockContext.subscriptions).toContainEqual(expect.objectContaining({ dispose: expect.any(Function) }));
    });

    it('should prevent duplicate command registration', () => {
      // GIVEN: Command is already registered
      const commandDefinition: CommandDefinition = {
        id: 'ptah.duplicate.test',
        title: 'Duplicate Test',
        handler: jest.fn(),
      };

      commandManager.registerCommand(commandDefinition);

      // WHEN: Attempting to register same command again
      // THEN: Should throw error
      expect(() => {
        commandManager.registerCommand(commandDefinition);
      }).toThrow('Command ptah.duplicate.test is already registered');
    });

    it('should support bulk command registration', () => {
      // GIVEN: Multiple commands to register
      const commands: CommandDefinition[] = [
        { id: 'ptah.command1', title: 'Command 1', handler: jest.fn() },
        { id: 'ptah.command2', title: 'Command 2', handler: jest.fn() },
        { id: 'ptah.command3', title: 'Command 3', handler: jest.fn() },
      ];

      // WHEN: Registering multiple commands
      commandManager.registerCommands(commands);

      // THEN: All commands should be registered
      expect(mockCommands.registerCommand).toHaveBeenCalledTimes(3);
      expect(commandManager.getRegisteredCommands()).toEqual([
        'ptah.command1',
        'ptah.command2',
        'ptah.command3'
      ]);
    });
  });

  describe('User Scenario: Command Execution with Event Integration', () => {
    it('should execute command handlers and publish events', async () => {
      // GIVEN: Command with handler
      const mockHandler = jest.fn().mockResolvedValue(undefined);
      const commandDefinition: CommandDefinition = {
        id: 'ptah.test.execution',
        title: 'Test Execution',
        handler: mockHandler,
      };

      commandManager.registerCommand(commandDefinition);

      // Get the registered VS Code command handler
      const vsCodeHandler = mockCommands.registerCommand.mock.calls[0][1];

      // WHEN: Executing the command with arguments
      const testArgs = ['arg1', 'arg2'];
      await vsCodeHandler(...testArgs);

      // THEN: Handler should be called and events published
      expect(mockHandler).toHaveBeenCalledWith('arg1', 'arg2');
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'commands:executeCommand',
        {
          templateId: 'ptah.test.execution',
          parameters: { arg0: 'arg1', arg1: 'arg2' }
        }
      );
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        expect.objectContaining({
          event: 'command:executed',
          properties: expect.objectContaining({
            commandId: 'ptah.test.execution',
            duration: expect.any(Number),
          })
        })
      );
    });

    it('should handle command execution errors and publish error events', async () => {
      // GIVEN: Command that throws error
      const errorMessage = 'Command execution failed';
      const mockHandler = jest.fn().mockRejectedValue(new Error(errorMessage));
      const commandDefinition: CommandDefinition = {
        id: 'ptah.error.test',
        title: 'Error Test',
        handler: mockHandler,
      };

      commandManager.registerCommand(commandDefinition);
      const vsCodeHandler = mockCommands.registerCommand.mock.calls[0][1];

      // WHEN: Executing command that fails
      // THEN: Should throw error and publish error event
      await expect(vsCodeHandler()).rejects.toThrow(errorMessage);

      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          code: 'COMMAND_EXECUTION_ERROR',
          message: expect.stringContaining('ptah.error.test'),
          source: 'CommandManager',
          data: expect.objectContaining({
            commandId: 'ptah.error.test'
          })
        })
      );
    });

    it('should track command execution metrics', async () => {
      // GIVEN: Command for metrics testing
      const mockHandler = jest.fn().mockResolvedValue(undefined);
      const commandDefinition: CommandDefinition = {
        id: 'ptah.metrics.test',
        title: 'Metrics Test',
        handler: mockHandler,
      };

      commandManager.registerCommand(commandDefinition);
      const vsCodeHandler = mockCommands.registerCommand.mock.calls[0][1];

      // WHEN: Executing command multiple times
      await vsCodeHandler();
      await vsCodeHandler();

      // Simulate one error
      mockHandler.mockRejectedValueOnce(new Error('Test error'));
      try {
        await vsCodeHandler();
      } catch {
        // Ignore error for metrics test
      }

      // THEN: Metrics should be tracked correctly
      const metrics = commandManager.getCommandMetrics('ptah.metrics.test');
      expect(metrics).toBeDefined();
      expect(metrics!.executionCount).toBe(3);
      expect(metrics!.errorCount).toBe(1);
      expect(metrics!.lastExecuted).toBeGreaterThan(0);
      expect(typeof metrics!.totalDuration).toBe('number');
    });
  });

  describe('User Scenario: Command Management', () => {
    beforeEach(() => {
      // Register some test commands
      commandManager.registerCommand({
        id: 'ptah.test1', title: 'Test 1', handler: jest.fn()
      });
      commandManager.registerCommand({
        id: 'ptah.test2', title: 'Test 2', handler: jest.fn()
      });
    });

    it('should list all registered commands', () => {
      // WHEN: Getting registered commands
      const commands = commandManager.getRegisteredCommands();

      // THEN: Should return all registered command IDs
      expect(commands).toEqual(['ptah.test1', 'ptah.test2']);
    });

    it('should unregister commands properly', () => {
      // GIVEN: Registered command
      expect(commandManager.isCommandRegistered('ptah.test1')).toBe(true);

      // WHEN: Unregistering command
      const result = commandManager.unregisterCommand('ptah.test1');

      // THEN: Command should be unregistered
      expect(result).toBe(true);
      expect(commandManager.isCommandRegistered('ptah.test1')).toBe(false);
      expect(mockContext.subscriptions[0].dispose).toHaveBeenCalled();
    });

    it('should handle unregistering non-existent commands', () => {
      // WHEN: Attempting to unregister non-existent command
      const result = commandManager.unregisterCommand('ptah.nonexistent');

      // THEN: Should return false and not throw
      expect(result).toBe(false);
    });

    it('should get metrics for all commands', () => {
      // WHEN: Getting all command metrics
      const allMetrics = commandManager.getCommandMetrics();

      // THEN: Should return metrics for all registered commands
      expect(allMetrics).toBeTruthy();
      expect(Object.keys(allMetrics || {})).toContain('ptah.test1');
      expect(Object.keys(allMetrics || {})).toContain('ptah.test2');
      if (typeof allMetrics === 'object' && allMetrics !== null) {
        expect((allMetrics as any)['ptah.test1']).toMatchObject({
          executionCount: 0,
          totalDuration: 0,
          errorCount: 0,
          lastExecuted: 0,
        });
      }
    });

    it('should return null for metrics of unregistered command', () => {
      // WHEN: Getting metrics for non-existent command
      const metrics = commandManager.getCommandMetrics('ptah.nonexistent');

      // THEN: Should return null
      expect(metrics).toBeNull();
    });
  });

  describe('User Scenario: Extension Lifecycle', () => {
    it('should dispose all commands during cleanup', () => {
      // GIVEN: Multiple registered commands
      commandManager.registerCommand({
        id: 'ptah.dispose1', title: 'Dispose Test 1', handler: jest.fn()
      });
      commandManager.registerCommand({
        id: 'ptah.dispose2', title: 'Dispose Test 2', handler: jest.fn()
      });

      expect(commandManager.getRegisteredCommands()).toHaveLength(2);

      // WHEN: Disposing command manager
      commandManager.dispose();

      // THEN: All commands should be disposed
      // Note: Each registered command creates a disposable, so we check if dispose was called
      expect(commandManager.getRegisteredCommands()).toHaveLength(0);
      expect(commandManager.getCommandMetrics()).toEqual({});
    });
  });

  describe('User Error Scenarios', () => {
    it('should handle handler argument conversion errors', async () => {
      // GIVEN: Command with complex arguments
      const mockHandler = jest.fn();
      const commandDefinition: CommandDefinition = {
        id: 'ptah.args.test',
        title: 'Args Test',
        handler: mockHandler,
      };

      commandManager.registerCommand(commandDefinition);
      const vsCodeHandler = mockCommands.registerCommand.mock.calls[0][1];

      // WHEN: Executing with various argument types
      const complexArgs = [
        'string',
        42,
        { complex: 'object' },
        ['array', 'items'],
        null,
        undefined
      ];

      await vsCodeHandler(...complexArgs);

      // THEN: Should handle all argument types
      expect(mockHandler).toHaveBeenCalledWith(...complexArgs);
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'commands:executeCommand',
        {
          templateId: 'ptah.args.test',
          parameters: {
            arg0: 'string',
            arg1: 42,
            arg2: { complex: 'object' },
            arg3: ['array', 'items'],
            arg4: null,
            arg5: undefined
          }
        }
      );
    });

    it('should handle non-Error exceptions in command handlers', async () => {
      // GIVEN: Command that throws non-Error object
      const mockHandler = jest.fn().mockRejectedValue('String error');
      const commandDefinition: CommandDefinition = {
        id: 'ptah.non.error.test',
        title: 'Non-Error Test',
        handler: mockHandler,
      };

      commandManager.registerCommand(commandDefinition);
      const vsCodeHandler = mockCommands.registerCommand.mock.calls[0][1];

      // WHEN: Executing command that throws non-Error
      // THEN: Should handle gracefully
      await expect(vsCodeHandler()).rejects.toBe('String error');

      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          message: expect.stringContaining('String error')
        })
      );
    });
  });

  describe('User Requirement: Type Safety', () => {
    it('should provide type-safe command definitions', () => {
      // GIVEN: Type-safe command definition
      const typedHandler = (...args: any[]) => {
        // Handler implementation that accepts any arguments
        const [filePath, options] = args;
        if (filePath) expect(typeof filePath).toBe('string');
        if (options && typeof options === 'object') {
          expect(typeof options.recursive).toBe('boolean');
        }
      };

      const commandDefinition: CommandDefinition = {
        id: 'ptah.typed.test',
        title: 'Typed Test',
        handler: typedHandler,
        category: 'Ptah Test'
      };

      // WHEN: Registering typed command
      expect(() => {
        commandManager.registerCommand(commandDefinition);
      }).not.toThrow();

      // THEN: Type safety should be maintained (compile-time verification)
      expect(commandManager.isCommandRegistered('ptah.typed.test')).toBe(true);
    });

    it('should support optional command properties', () => {
      // GIVEN: Command with optional properties
      const minimalCommand: CommandDefinition = {
        id: 'ptah.minimal',
        title: 'Minimal Command',
        handler: jest.fn(),
        // Optional properties not provided
      };

      const fullCommand: CommandDefinition = {
        id: 'ptah.full',
        title: 'Full Command',
        category: 'Test',
        when: 'editorHasSelection',
        handler: jest.fn(),
      };

      // WHEN: Registering both types
      expect(() => {
        commandManager.registerCommand(minimalCommand);
        commandManager.registerCommand(fullCommand);
      }).not.toThrow();

      // THEN: Both should be registered successfully
      expect(commandManager.isCommandRegistered('ptah.minimal')).toBe(true);
      expect(commandManager.isCommandRegistered('ptah.full')).toBe(true);
    });
  });
});