/**
 * Week 2 Integration Tests - User Requirement Validation
 * Testing complete integration of DI Container, Event Bus, Command Manager, and Webview Manager
 * Validates user requirements from TASK_CMD_002: End-to-end component integration
 */

import 'reflect-metadata';
import * as vscode from 'vscode';
import { firstValueFrom, take, timeout } from 'rxjs';
import { DIContainer, TOKENS } from '../di/container';
import { EventBus } from '../messaging/event-bus';
import { CommandManager, CommandDefinition } from '../api-wrappers/command-manager';
import { WebviewManager, WebviewPanelConfig } from '../api-wrappers/webview-manager';

// Mock VS Code API
const mockDisposable = { dispose: jest.fn() };
const mockCommands = { registerCommand: jest.fn().mockReturnValue(mockDisposable) };
const mockWebview = {
  postMessage: jest.fn().mockResolvedValue(undefined),
  onDidReceiveMessage: jest.fn(),
  html: '',
  options: {},
};
const mockWebviewPanel = {
  webview: mockWebview,
  onDidChangeViewState: jest.fn(),
  onDidDispose: jest.fn(),
  reveal: jest.fn(),
  dispose: jest.fn(),
  visible: true,
};
const mockWindow = { createWebviewPanel: jest.fn().mockReturnValue(mockWebviewPanel) };
const mockUri = { joinPath: jest.fn().mockReturnValue({} as vscode.Uri) };

jest.mock('vscode', () => ({
  commands: mockCommands,
  window: mockWindow,
  Uri: mockUri,
  ViewColumn: { One: 1 },
  ExtensionContext: jest.fn(),
}));

// Mock shared library
jest.mock('@ptah-extension/shared', () => ({
  CorrelationId: {
    create: jest.fn(() => 'integration-test-correlation-id' as any),
  },
  isSystemMessage: jest.fn(),
  isRoutableMessage: jest.fn(),
  MessagePayloadMap: {},
  StrictMessageType: {},
}));

const { isSystemMessage, isRoutableMessage } = require('@ptah-extension/shared');

describe('Week 2 Integration Tests - User Requirement: Seamless Component Integration', () => {
  let mockContext: vscode.ExtensionContext;
  let eventBus: EventBus;
  let commandManager: CommandManager;
  let webviewManager: WebviewManager;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Clear DI container
    DIContainer.clear();

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

    // Set up complete DI container with all services
    DIContainer.setup(mockContext);

    // Resolve all services from DI container
    eventBus = DIContainer.resolve<EventBus>(TOKENS.EVENT_BUS);
    commandManager = DIContainer.resolve<CommandManager>(TOKENS.COMMAND_REGISTRY);
    webviewManager = DIContainer.resolve<WebviewManager>(TOKENS.WEBVIEW_PROVIDER);

    // Reset shared library mocks
    isSystemMessage.mockReset();
    isRoutableMessage.mockReset();
  });

  afterEach(() => {
    eventBus?.dispose();
    commandManager?.dispose();
    webviewManager?.dispose();
    DIContainer.clear();
  });

  describe('User Scenario: Complete Extension Initialization', () => {
    it('should initialize all components through DI container', () => {
      // GIVEN: Extension is starting up
      // WHEN: DI container is set up (done in beforeEach)
      // THEN: All core services should be available

      // Verify DI container has all required services
      expect(DIContainer.isRegistered(TOKENS.EXTENSION_CONTEXT)).toBe(true);
      expect(DIContainer.isRegistered(TOKENS.EVENT_BUS)).toBe(true);
      expect(DIContainer.isRegistered(TOKENS.COMMAND_REGISTRY)).toBe(true);
      expect(DIContainer.isRegistered(TOKENS.WEBVIEW_PROVIDER)).toBe(true);

      // Verify services are properly instantiated
      expect(eventBus).toBeDefined();
      expect(commandManager).toBeDefined();
      expect(webviewManager).toBeDefined();

      // Verify services are singletons (same instances)
      const eventBus2 = DIContainer.resolve<EventBus>(TOKENS.EVENT_BUS);
      expect(eventBus2).toBe(eventBus);
    });

    it('should have event bus integrated with command manager', async () => {
      // GIVEN: Command that publishes events
      const commandDefinition: CommandDefinition = {
        id: 'ptah.integration.test',
        title: 'Integration Test Command',
        handler: jest.fn().mockResolvedValue(undefined),
      };

      // WHEN: Registering and executing command
      commandManager.registerCommand(commandDefinition);
      
      // Set up event listener before execution
      const eventPromise = firstValueFrom(
        eventBus.subscribe('commands:executeCommand').pipe(take(1), timeout(1000))
      );

      // Execute the command
      const vsCodeHandler = mockCommands.registerCommand.mock.calls[0][1];
      await vsCodeHandler('test-arg');

      // THEN: Event should be published through event bus
      const receivedEvent = await eventPromise;
      expect(receivedEvent.type).toBe('commands:executeCommand');
      expect(receivedEvent.payload.templateId).toBe('ptah.integration.test');
      expect(receivedEvent.payload.parameters).toEqual({ arg0: 'test-arg' });
    });

    it('should have event bus integrated with webview manager', async () => {
      // GIVEN: Webview that routes messages through event bus
      const config: WebviewPanelConfig = {
        viewType: 'ptah.integration.webview',
        title: 'Integration Test Webview',
      };

      // WHEN: Creating webview and handling message
      webviewManager.createWebviewPanel(config);

      // Set up message routing mocks
      isSystemMessage.mockReturnValue(false);
      isRoutableMessage.mockReturnValue(true);

      // Set up event listener
      const eventPromise = firstValueFrom(
        eventBus.subscribe('chat:sendMessage').pipe(take(1), timeout(1000))
      );

      // Simulate message from webview
      const messageHandler = mockWebview.onDidReceiveMessage.mock.calls[0][0];
      const testMessage = {
        type: 'chat:sendMessage',
        payload: { content: 'Integration test message', files: [] }
      };

      messageHandler(testMessage);

      // THEN: Message should be routed through event bus
      const receivedEvent = await eventPromise;
      expect(receivedEvent.type).toBe('chat:sendMessage');
      expect(receivedEvent.payload.content).toBe('Integration test message');
    });
  });

  describe('User Scenario: Cross-Component Communication', () => {
    it('should enable command to webview communication through event bus', async () => {
      // GIVEN: Command that needs to send data to webview
      const commandDefinition: CommandDefinition = {
        id: 'ptah.send.to.webview',
        title: 'Send to Webview',
        handler: async () => {
          // Simulate command publishing data for webview
          eventBus.publish('chat:messageChunk', {
            sessionId: 'test-session' as any,
            messageId: 'test-message' as any,
            content: 'Data from command',
            isComplete: false,
            streaming: true
          });
        }
      };

      const webviewConfig: WebviewPanelConfig = {
        viewType: 'ptah.receiver',
        title: 'Receiver Webview',
      };

      // WHEN: Setting up communication chain
      commandManager.registerCommand(commandDefinition);
      webviewManager.createWebviewPanel(webviewConfig);

      // Set up event listener that forwards to webview
      const messageSubscription = eventBus.subscribe('chat:messageChunk').subscribe(event => {
        webviewManager.sendMessage('ptah.receiver', 'chat:messageChunk', event.payload);
      });

      // Execute command
      const vsCodeHandler = mockCommands.registerCommand.mock.calls[0][1];
      await vsCodeHandler();

      // Small delay for async propagation
      await new Promise(resolve => setTimeout(resolve, 0));

      // THEN: Message should reach webview
      expect(mockWebview.postMessage).toHaveBeenCalledWith({
        type: 'chat:messageChunk',
        payload: expect.objectContaining({
          content: 'Data from command',
          streaming: true
        })
      });

      messageSubscription.unsubscribe();
    });

    it('should enable webview to command communication through event bus', async () => {
      // GIVEN: Command that responds to webview messages
      let commandExecuted = false;
      const commandDefinition: CommandDefinition = {
        id: 'ptah.respond.to.webview',
        title: 'Respond to Webview',
        handler: async () => {
          commandExecuted = true;
        }
      };

      const webviewConfig: WebviewPanelConfig = {
        viewType: 'ptah.sender',
        title: 'Sender Webview',
      };

      // WHEN: Setting up bidirectional communication
      commandManager.registerCommand(commandDefinition);
      webviewManager.createWebviewPanel(webviewConfig);

      // Set up event listener that triggers command
      const eventSubscription = eventBus.subscribe('commands:executeCommand').subscribe(event => {
        if (event.payload.templateId === 'ptah.respond.to.webview') {
          // Find and execute the command
          const vsCodeHandler = mockCommands.registerCommand.mock.calls
            .find(call => call[0] === 'ptah.respond.to.webview')?.[1];
          if (vsCodeHandler) {
            vsCodeHandler();
          }
        }
      });

      // Simulate webview requesting command execution
      isSystemMessage.mockReturnValue(false);
      isRoutableMessage.mockReturnValue(true);

      const messageHandler = mockWebview.onDidReceiveMessage.mock.calls[0][0];
      messageHandler({
        type: 'commands:executeCommand',
        payload: {
          templateId: 'ptah.respond.to.webview',
          parameters: {}
        }
      });

      // Small delay for async propagation
      await new Promise(resolve => setTimeout(resolve, 0));

      // THEN: Command should be executed
      expect(commandExecuted).toBe(true);

      eventSubscription.unsubscribe();
    });

    it('should handle request-response patterns across components', async () => {
      // GIVEN: Component that needs request-response communication
      const webviewConfig: WebviewPanelConfig = {
        viewType: 'ptah.requester',
        title: 'Requester',
      };

      webviewManager.createWebviewPanel(webviewConfig);

      // Set up responder
      const responseSubscription = eventBus.subscribe('context:getFiles').subscribe(async request => {
        // Simulate async processing
        setTimeout(() => {
          if ('correlationId' in request) {
            eventBus.respond(request as any, {
              files: ['file1.ts', 'file2.ts'],
              totalCount: 2
            });
          }
        }, 10);
      });

      // WHEN: Making request through event bus
      const response = await eventBus.request('context:getFiles', {}, 1000);

      // THEN: Should receive response
      expect(response).toEqual({
        files: ['file1.ts', 'file2.ts'],
        totalCount: 2
      });

      responseSubscription.unsubscribe();
    });
  });

  describe('User Scenario: Error Handling Across Components', () => {
    it('should propagate errors through event bus', async () => {
      // GIVEN: Command that throws error
      const errorMessage = 'Integration test error';
      const commandDefinition: CommandDefinition = {
        id: 'ptah.error.test',
        title: 'Error Test',
        handler: jest.fn().mockRejectedValue(new Error(errorMessage))
      };

      commandManager.registerCommand(commandDefinition);

      // Set up error listener
      const errorPromise = firstValueFrom(
        eventBus.subscribe('error').pipe(take(1), timeout(1000))
      );

      // WHEN: Executing command that fails
      const vsCodeHandler = mockCommands.registerCommand.mock.calls[0][1];
      try {
        await vsCodeHandler();
      } catch {
        // Error expected
      }

      // THEN: Error should be published through event bus
      const errorEvent = await errorPromise;
      expect(errorEvent.type).toBe('error');
      expect(errorEvent.payload.message).toContain(errorMessage);
      expect(errorEvent.payload.source).toBe('CommandManager');
    });

    it('should handle webview message routing errors', async () => {
      // GIVEN: Webview with invalid message handling
      const webviewConfig: WebviewPanelConfig = {
        viewType: 'ptah.error.webview',
        title: 'Error Webview',
      };

      webviewManager.createWebviewPanel(webviewConfig);

      // Set up error listener
      const errorPromise = firstValueFrom(
        eventBus.subscribe('error').pipe(take(1), timeout(1000))
      );

      // WHEN: Sending invalid message
      isSystemMessage.mockReturnValue(false);
      isRoutableMessage.mockReturnValue(false); // Invalid message

      const messageHandler = mockWebview.onDidReceiveMessage.mock.calls[0][0];
      messageHandler({
        type: 'invalid:message:type',
        payload: { data: 'test' }
      });

      // THEN: Error should be published
      const errorEvent = await errorPromise;
      expect(errorEvent.type).toBe('error');
      expect(errorEvent.payload.code).toBe('INVALID_WEBVIEW_MESSAGE');
      expect(errorEvent.payload.source).toBe('WebviewManager');
    });
  });

  describe('User Scenario: Component Lifecycle Management', () => {
    it('should handle coordinated cleanup of all components', async () => {
      // GIVEN: Multiple active components with cross-references
      const commandDefinition: CommandDefinition = {
        id: 'ptah.cleanup.test',
        title: 'Cleanup Test',
        handler: jest.fn()
      };

      const webviewConfig: WebviewPanelConfig = {
        viewType: 'ptah.cleanup.webview',
        title: 'Cleanup Webview',
      };

      commandManager.registerCommand(commandDefinition);
      webviewManager.createWebviewPanel(webviewConfig);

      // Set up cross-component subscriptions
      const eventSubscription = eventBus.subscribe('chat:sendMessage').subscribe(() => {});

      // Verify everything is set up
      expect(commandManager.getRegisteredCommands()).toContain('ptah.cleanup.test');
      expect(webviewManager.hasWebview('ptah.cleanup.webview')).toBe(true);
      expect(eventBus.getMetrics().eventListeners).toBeGreaterThan(0);

      // WHEN: Disposing all components
      commandManager.dispose();
      webviewManager.dispose();
      eventSubscription.unsubscribe();
      eventBus.dispose();

      // THEN: All resources should be cleaned up
      expect(commandManager.getRegisteredCommands()).toHaveLength(0);
      expect(webviewManager.getActiveWebviews()).toHaveLength(0);
      expect(eventBus.getMetrics().eventListeners).toBe(0);
      expect(eventBus.getMetrics().activeRequests).toBe(0);
    });

    it('should maintain service singleton behavior throughout lifecycle', () => {
      // GIVEN: Multiple service resolutions
      const eventBus1 = DIContainer.resolve<EventBus>(TOKENS.EVENT_BUS);
      const eventBus2 = DIContainer.resolve<EventBus>(TOKENS.EVENT_BUS);
      const commandManager1 = DIContainer.resolve<CommandManager>(TOKENS.COMMAND_REGISTRY);
      const commandManager2 = DIContainer.resolve<CommandManager>(TOKENS.COMMAND_REGISTRY);

      // WHEN: Resolving services multiple times
      // THEN: Should return same instances (singleton behavior)
      expect(eventBus1).toBe(eventBus2);
      expect(eventBus1).toBe(eventBus); // From beforeEach
      expect(commandManager1).toBe(commandManager2);
      expect(commandManager1).toBe(commandManager); // From beforeEach
    });
  });

  describe('User Scenario: Performance and Metrics', () => {
    it('should provide comprehensive metrics across all components', async () => {
      // GIVEN: Components with activity
      const commandDefinition: CommandDefinition = {
        id: 'ptah.metrics.test',
        title: 'Metrics Test',
        handler: jest.fn().mockResolvedValue(undefined)
      };

      const webviewConfig: WebviewPanelConfig = {
        viewType: 'ptah.metrics.webview',
        title: 'Metrics Webview',
      };

      commandManager.registerCommand(commandDefinition);
      webviewManager.createWebviewPanel(webviewConfig);

      // Generate some activity
      const vsCodeHandler = mockCommands.registerCommand.mock.calls[0][1];
      await vsCodeHandler();
      await vsCodeHandler();

      // WHEN: Collecting metrics from all components
      const eventBusMetrics = eventBus.getMetrics();
      const commandMetrics = commandManager.getCommandMetrics();
      const webviewMetrics = webviewManager.getWebviewMetrics();

      // THEN: Should provide comprehensive monitoring data
      expect(eventBusMetrics.eventListeners).toBeGreaterThan(0);
      expect(eventBusMetrics.eventNames.length).toBeGreaterThan(0);

      expect(commandMetrics).toHaveProperty('ptah.metrics.test');
      if (typeof commandMetrics === 'object' && commandMetrics !== null) {
        expect((commandMetrics as any)['ptah.metrics.test'].executionCount).toBe(2);
      }

      expect(webviewMetrics).toHaveProperty('ptah.metrics.webview');
      if (typeof webviewMetrics === 'object' && webviewMetrics !== null) {
        expect((webviewMetrics as any)['ptah.metrics.webview'].createdAt).toBeGreaterThan(0);
      }
    });

    it('should handle high-frequency event publishing efficiently', async () => {
      // GIVEN: High-frequency event scenario
      const eventCount = 100;
      let receivedCount = 0;

      const subscription = eventBus.subscribe('analytics:trackEvent').subscribe(() => {
        receivedCount++;
      });

      // WHEN: Publishing many events rapidly
      const startTime = Date.now();
      
      for (let i = 0; i < eventCount; i++) {
        eventBus.publish('analytics:trackEvent', {
          event: `test-event-${i}`,
          properties: { iteration: i }
        });
      }

      // Wait for all events to propagate
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const duration = Date.now() - startTime;

      // THEN: Should handle efficiently
      expect(receivedCount).toBe(eventCount);
      expect(duration).toBeLessThan(1000); // Should complete within 1 second

      subscription.unsubscribe();
    });
  });

  describe('User Requirement: Type Safety Integration', () => {
    it('should maintain type safety across all component interactions', async () => {
      // GIVEN: Type-safe component setup
      const commandDefinition: CommandDefinition<string> = {
        id: 'ptah.typesafe.integration',
        title: 'Type Safe Integration',
        handler: async (filePath: string) => {
          // Publish type-safe event
          eventBus.publish('context:includeFile', { filePath });
        }
      };

      const webviewConfig: WebviewPanelConfig = {
        viewType: 'ptah.typesafe.webview',
        title: 'Type Safe Webview',
      };

      // WHEN: Setting up type-safe communication
      commandManager.registerCommand(commandDefinition);
      webviewManager.createWebviewPanel(webviewConfig);

      // Set up type-safe event handling
      const eventPromise = firstValueFrom(
        eventBus.subscribe('context:includeFile').pipe(take(1), timeout(1000))
      );

      // Execute with type-safe parameter
      const vsCodeHandler = mockCommands.registerCommand.mock.calls[0][1];
      await vsCodeHandler('/path/to/file.ts');

      // THEN: Type safety should be maintained throughout
      const receivedEvent = await eventPromise;
      expect(receivedEvent.payload.filePath).toBe('/path/to/file.ts');

      // Send type-safe message to webview
      await webviewManager.sendMessage('ptah.typesafe.webview', 'context:includeFile', {
        filePath: '/another/file.ts'
      });

      expect(mockWebview.postMessage).toHaveBeenCalledWith({
        type: 'context:includeFile',
        payload: { filePath: '/another/file.ts' }
      });
    });
  });
});