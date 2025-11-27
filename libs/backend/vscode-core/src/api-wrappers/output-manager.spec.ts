/**
 * OutputManager Tests - User Requirement Validation
 * Testing Week 3 implementation: VS Code Output Manager with Event Integration
 * Validates user requirements from TASK_CMD_003
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import 'reflect-metadata';
import * as vscode from 'vscode';
import {
  OutputManager,
  OutputChannelConfig,
  WriteOptions,
} from './output-manager';

// Mock VS Code API with proper disposable patterns
const mockOutputChannel = {
  name: '',
  appendLine: jest.fn(),
  clear: jest.fn(),
  show: jest.fn(),
  hide: jest.fn(),
  dispose: jest.fn(),
};

jest.mock('vscode', () => ({
  window: {
    createOutputChannel: jest
      .fn()
      .mockImplementation((name: string, languageId?: string) => ({
        ...mockOutputChannel,
        name,
      })),
  },
  ExtensionContext: jest.fn(),
  Uri: {
    file: jest.fn(),
    parse: jest.fn(),
    joinPath: jest.fn(),
  },
}));

// Access the mocked window after the mock is set up
const mockWindow = require('vscode').window;

// Mock EventBus
const mockEventBus = {
  publish: jest.fn(),
  subscribe: jest.fn(),
  dispose: jest.fn(),
};

describe('OutputManager - User Requirement: VS Code Output Channel Abstraction', () => {
  let outputManager: OutputManager;
  let mockContext: vscode.ExtensionContext;

  beforeEach(() => {
    jest.clearAllMocks();

    mockContext = {
      subscriptions: [],
      workspaceState: {
        get: jest.fn(),
        update: jest.fn(),
        keys: jest.fn().mockReturnValue([]),
      },
      globalState: {
        get: jest.fn(),
        update: jest.fn(),
        setKeysForSync: jest.fn(),
        keys: jest.fn().mockReturnValue([]),
      },
      secrets: {
        get: jest.fn(),
        store: jest.fn(),
        delete: jest.fn(),
        onDidChange: jest.fn(),
      },
      extensionUri: {
        scheme: 'file',
        authority: '',
        path: '/test',
        query: '',
        fragment: '',
        fsPath: '/test',
        with: jest.fn(),
        toString: jest.fn(),
        toJSON: jest.fn(),
      },
      extensionPath: '/test/extension/path',
      environmentVariableCollection: {
        persistent: false,
        replace: jest.fn(),
        append: jest.fn(),
        prepend: jest.fn(),
        get: jest.fn(),
        forEach: jest.fn(),
        delete: jest.fn(),
        clear: jest.fn(),
      },
      storagePath: '/test/storage/path',
      globalStoragePath: '/test/global/storage/path',
      logPath: '/test/log/path',
      extensionMode: 1,
      logUri: {
        scheme: 'file',
        authority: '',
        path: '/test/log',
        query: '',
        fragment: '',
        fsPath: '/test/log',
        with: jest.fn(),
        toString: jest.fn(),
        toJSON: jest.fn(),
      },
      storageUri: {
        scheme: 'file',
        authority: '',
        path: '/test/storage',
        query: '',
        fragment: '',
        fsPath: '/test/storage',
        with: jest.fn(),
        toString: jest.fn(),
        toJSON: jest.fn(),
      },
      globalStorageUri: {
        scheme: 'file',
        authority: '',
        path: '/test/global',
        query: '',
        fragment: '',
        fsPath: '/test/global',
        with: jest.fn(),
        toString: jest.fn(),
        toJSON: jest.fn(),
      },
      asAbsolutePath: jest.fn(),
      extension: {
        id: 'test.extension',
        extensionUri: { scheme: 'file', path: '/test', fsPath: '/test' } as any,
        extensionPath: '/test',
        isActive: true,
        packageJSON: {},
        exports: undefined,
        activate: jest.fn(),
        extensionKind: 1,
      },
      languageModelAccessInformation: {
        onDidChange: jest.fn(),
        canSendRequest: jest.fn().mockReturnValue(true),
      },
    } as any;

    outputManager = new OutputManager(mockContext, mockEventBus as any);
  });

  afterEach(() => {
    outputManager.dispose();
  });

  describe('User Scenario: Output Channel Creation', () => {
    it('should create output channels with VS Code API and track them', () => {
      // GIVEN: User wants to create an output channel
      const channelConfig: OutputChannelConfig = {
        name: 'Ptah Test',
        languageId: 'plaintext',
        preserveOnReveal: true,
      };

      // WHEN: Creating the output channel
      const channel = outputManager.createOutputChannel(channelConfig);

      // THEN: Channel should be created with VS Code and tracked
      expect(mockWindow.createOutputChannel).toHaveBeenCalledWith(
        'Ptah Test',
        'plaintext'
      );
      expect(channel).toBeDefined();
      expect(outputManager.hasChannel('Ptah Test')).toBe(true);
      expect(mockContext.subscriptions).toContain(channel);

      // AND: Analytics event should be published
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'output:channelCreated',
          properties: {
            channelName: 'Ptah Test',
            languageId: 'plaintext',
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should return existing channel if already created', () => {
      // GIVEN: Channel already exists
      const config: OutputChannelConfig = { name: 'Ptah Existing' };
      const firstChannel = outputManager.createOutputChannel(config);

      // WHEN: Creating channel with same name
      const secondChannel = outputManager.createOutputChannel(config);

      // THEN: Should return same channel instance
      expect(firstChannel).toBe(secondChannel);
      expect(mockWindow.createOutputChannel).toHaveBeenCalledTimes(1);
    });

    it('should create channel without language ID when not provided', () => {
      // GIVEN: Channel config without language ID
      const config: OutputChannelConfig = { name: 'Ptah No Lang' };

      // WHEN: Creating the channel
      outputManager.createOutputChannel(config);

      // THEN: Should create channel without language ID
      expect(mockWindow.createOutputChannel).toHaveBeenCalledWith(
        'Ptah No Lang'
      );
    });

    it('should handle channel creation errors', () => {
      // GIVEN: VS Code API throws error
      const config: OutputChannelConfig = { name: 'Ptah Error' };
      mockWindow.createOutputChannel.mockImplementationOnce(() => {
        throw new Error('VS Code error');
      });

      // WHEN: Creating channel that fails
      // THEN: Should throw error and publish error event
      expect(() => outputManager.createOutputChannel(config)).toThrow(
        'VS Code error'
      );

      expect(mockEventBus.publish).toHaveBeenCalledWith('error', {
        code: 'OUTPUT_CHANNEL_CREATE_FAILED',
        message:
          'Failed to create output channel Ptah Error: Error: VS Code error',
        source: 'OutputManager',
        data: { config },
        timestamp: expect.any(Number),
      });
    });
  });

  describe('User Scenario: Writing Messages with Event Integration', () => {
    beforeEach(() => {
      // Setup channel for writing tests
      outputManager.createOutputChannel({ name: 'Ptah Write Test' });
      jest.clearAllMocks(); // Clear creation events
    });

    it('should write messages with default formatting and track metrics', () => {
      // GIVEN: Channel exists
      const message = 'Test message';

      // WHEN: Writing message
      outputManager.write('Ptah Write Test', message);

      // THEN: Message should be written and tracked
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith('Test message');

      // AND: Analytics event should be published
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'output:messageWritten',
          properties: {
            channelName: 'Ptah Write Test',
            level: 'info',
            messageLength: 12,
            hasTimestamp: false,
            hasPrefix: false,
            timestamp: expect.any(Number),
          },
        }
      );

      // AND: Metrics should be updated
      const metrics = outputManager.getChannelMetrics('Ptah Write Test');
      expect(metrics).toEqual({
        messageCount: 1,
        totalWrites: 1,
        lastWrite: expect.any(Number),
        createdAt: expect.any(Number),
        errorCount: 0,
        levelCounts: {
          debug: 0,
          info: 1,
          warn: 0,
          error: 0,
        },
      });
    });

    it('should write messages with custom formatting options', () => {
      // GIVEN: Message with formatting options
      const message = 'Formatted message';
      const options: WriteOptions = {
        level: 'warn',
        timestamp: true,
        prefix: 'PREFIX',
      };

      // WHEN: Writing message with options
      outputManager.write('Ptah Write Test', message, options);

      // THEN: Message should be formatted correctly
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringMatching(
          /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[PREFIX\] Formatted message$/
        )
      );

      // AND: Analytics should track the options
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'output:messageWritten',
          properties: {
            channelName: 'Ptah Write Test',
            level: 'warn',
            messageLength: 17,
            hasTimestamp: true,
            hasPrefix: true,
            timestamp: expect.any(Number),
          },
        }
      );

      // AND: Level metrics should be updated
      const metrics = outputManager.getChannelMetrics('Ptah Write Test');
      if (
        metrics &&
        typeof metrics === 'object' &&
        'levelCounts' in metrics &&
        'warn' in metrics.levelCounts
      ) {
        expect(metrics.levelCounts.warn).toBe(1);
      }
    });

    it('should write multiple lines in bulk', () => {
      // GIVEN: Multiple messages
      const messages = ['Line 1', 'Line 2', 'Line 3'];

      // WHEN: Writing multiple lines
      outputManager.writeLines('Ptah Write Test', messages);

      // THEN: All messages should be written
      expect(mockOutputChannel.appendLine).toHaveBeenCalledTimes(3);
      expect(mockOutputChannel.appendLine).toHaveBeenNthCalledWith(1, 'Line 1');
      expect(mockOutputChannel.appendLine).toHaveBeenNthCalledWith(2, 'Line 2');
      expect(mockOutputChannel.appendLine).toHaveBeenNthCalledWith(3, 'Line 3');

      // AND: Metrics should reflect all writes
      const metrics = outputManager.getChannelMetrics('Ptah Write Test');
      expect(metrics?.messageCount).toBe(3);
      expect(metrics?.totalWrites).toBe(3);
    });

    it('should handle write errors and track them', () => {
      // GIVEN: Channel write operation fails
      mockOutputChannel.appendLine.mockImplementationOnce(() => {
        throw new Error('Write failed');
      });

      // WHEN: Writing message that fails
      // THEN: Should throw error and publish error event
      expect(() => outputManager.write('Ptah Write Test', 'message')).toThrow(
        'Write failed'
      );

      expect(mockEventBus.publish).toHaveBeenCalledWith('error', {
        code: 'OUTPUT_WRITE_FAILED',
        message:
          'Failed to write to output channel Ptah Write Test: Error: Write failed',
        source: 'OutputManager',
        data: {
          channelName: 'Ptah Write Test',
          message: 'message',
          options: {},
        },
        timestamp: expect.any(Number),
      });

      // AND: Error metrics should be updated
      const metrics = outputManager.getChannelMetrics('Ptah Write Test');
      expect(metrics?.errorCount).toBe(1);
    });

    it('should handle writes to non-existent channels', () => {
      // WHEN: Writing to channel that doesn't exist
      outputManager.write('Non Existent', 'message');

      // THEN: Should publish error event and not write
      expect(mockOutputChannel.appendLine).not.toHaveBeenCalled();
      expect(mockEventBus.publish).toHaveBeenCalledWith('error', {
        code: 'OUTPUT_CHANNEL_NOT_FOUND',
        message: 'Output channel Non Existent not found',
        source: 'OutputManager',
        data: {
          channelName: 'Non Existent',
          message: 'message',
          options: {},
        },
        timestamp: expect.any(Number),
      });
    });
  });

  describe('User Scenario: Channel Management Operations', () => {
    beforeEach(() => {
      outputManager.createOutputChannel({ name: 'Ptah Management' });
      jest.clearAllMocks();
    });

    it('should clear channels and publish events', () => {
      // WHEN: Clearing channel
      const result = outputManager.clear('Ptah Management');

      // THEN: Channel should be cleared and event published
      expect(result).toBe(true);
      expect(mockOutputChannel.clear).toHaveBeenCalled();
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'output:channelCleared',
          properties: {
            channelName: 'Ptah Management',
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should show channels with focus options', () => {
      // WHEN: Showing channel with preserve focus
      const result = outputManager.show('Ptah Management', true);

      // THEN: Channel should be shown and event published
      expect(result).toBe(true);
      expect(mockOutputChannel.show).toHaveBeenCalledWith(true);
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'output:channelShown',
          properties: {
            channelName: 'Ptah Management',
            preserveFocus: true,
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should hide channels', () => {
      // WHEN: Hiding channel
      const result = outputManager.hide('Ptah Management');

      // THEN: Channel should be hidden and event published
      expect(result).toBe(true);
      expect(mockOutputChannel.hide).toHaveBeenCalled();
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'output:channelHidden',
          properties: {
            channelName: 'Ptah Management',
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should dispose individual channels', () => {
      // WHEN: Disposing channel
      const result = outputManager.disposeChannel('Ptah Management');

      // THEN: Channel should be disposed and removed from tracking
      expect(result).toBe(true);
      expect(mockOutputChannel.dispose).toHaveBeenCalled();
      expect(outputManager.hasChannel('Ptah Management')).toBe(false);
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'output:channelDisposed',
          properties: {
            channelName: 'Ptah Management',
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should return false for operations on non-existent channels', () => {
      expect(outputManager.clear('Non Existent')).toBe(false);
      expect(outputManager.show('Non Existent')).toBe(false);
      expect(outputManager.hide('Non Existent')).toBe(false);
      expect(outputManager.disposeChannel('Non Existent')).toBe(false);
    });
  });

  describe('User Scenario: Channel Information and Debugging', () => {
    beforeEach(() => {
      outputManager.createOutputChannel({ name: 'Ptah Info' });
      outputManager.createOutputChannel({ name: 'Ptah Debug' });
      jest.clearAllMocks();
    });

    it('should provide channel access and validation', () => {
      // THEN: Should provide access to channels
      expect(outputManager.getChannel('Ptah Info')).toBeDefined();
      expect(outputManager.getChannel('Non Existent')).toBeUndefined();
      expect(outputManager.hasChannel('Ptah Info')).toBe(true);
      expect(outputManager.hasChannel('Non Existent')).toBe(false);
    });

    it('should list all channel names', () => {
      // THEN: Should return all registered channel names
      const channelNames = outputManager.getChannelNames();
      expect(channelNames).toContain('Ptah Info');
      expect(channelNames).toContain('Ptah Debug');
      expect(channelNames).toHaveLength(2);
    });

    it('should provide metrics for specific channels', () => {
      // GIVEN: Channel with some activity
      outputManager.write('Ptah Info', 'test', { level: 'error' });

      // THEN: Should provide specific channel metrics
      const metrics = outputManager.getChannelMetrics('Ptah Info');
      expect(metrics).toEqual({
        messageCount: 1,
        totalWrites: 1,
        lastWrite: expect.any(Number),
        createdAt: expect.any(Number),
        errorCount: 0,
        levelCounts: {
          debug: 0,
          info: 0,
          warn: 0,
          error: 1,
        },
      });
    });

    it('should provide metrics for all channels', () => {
      // GIVEN: Activity on multiple channels
      outputManager.write('Ptah Info', 'test1');
      outputManager.write('Ptah Debug', 'test2');

      // THEN: Should provide all channel metrics
      const allMetrics = outputManager.getChannelMetrics();
      expect(allMetrics).toHaveProperty('Ptah Info');
      expect(allMetrics).toHaveProperty('Ptah Debug');
      if (allMetrics) {
        expect(Object.keys(allMetrics)).toHaveLength(2);
      }
    });

    it('should return null for metrics of non-existent channels', () => {
      expect(outputManager.getChannelMetrics('Non Existent')).toBeNull();
    });
  });

  describe('User Scenario: Manager Lifecycle and Error Handling', () => {
    it('should dispose all channels during manager disposal', () => {
      // GIVEN: Multiple channels
      outputManager.createOutputChannel({ name: 'Channel 1' });
      outputManager.createOutputChannel({ name: 'Channel 2' });

      // WHEN: Disposing manager
      outputManager.dispose();

      // THEN: All channels should be disposed
      expect(mockOutputChannel.dispose).toHaveBeenCalledTimes(2);
      expect(outputManager.getChannelNames()).toHaveLength(0);
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'output:managerDisposed',
          properties: {
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should handle disposal errors gracefully', () => {
      // GIVEN: Channel and disposal error
      outputManager.createOutputChannel({ name: 'Error Channel' });
      mockOutputChannel.dispose.mockImplementationOnce(() => {
        throw new Error('Disposal error');
      });

      // WHEN: Disposing manager
      outputManager.dispose();

      // THEN: Should publish error event
      expect(mockEventBus.publish).toHaveBeenCalledWith('error', {
        code: 'OUTPUT_MANAGER_DISPOSE_FAILED',
        message: 'Failed to dispose OutputManager: Error: Disposal error',
        source: 'OutputManager',
        timestamp: expect.any(Number),
      });
    });

    it('should handle various operation errors gracefully', () => {
      // GIVEN: Channel and various operation errors
      outputManager.createOutputChannel({ name: 'Error Test' });

      // Test clear error
      mockOutputChannel.clear.mockImplementationOnce(() => {
        throw new Error('Clear error');
      });
      expect(outputManager.clear('Error Test')).toBe(false);

      // Test show error
      mockOutputChannel.show.mockImplementationOnce(() => {
        throw new Error('Show error');
      });
      expect(outputManager.show('Error Test')).toBe(false);

      // Test hide error
      mockOutputChannel.hide.mockImplementationOnce(() => {
        throw new Error('Hide error');
      });
      expect(outputManager.hide('Error Test')).toBe(false);

      // Verify error events were published for each operation
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          code: 'OUTPUT_CLEAR_FAILED',
          source: 'OutputManager',
        })
      );
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          code: 'OUTPUT_SHOW_FAILED',
          source: 'OutputManager',
        })
      );
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          code: 'OUTPUT_HIDE_FAILED',
          source: 'OutputManager',
        })
      );
    });
  });
});
