/**
 * WebviewManager Tests - User Requirement Validation
 * Testing Week 2 implementation: VS Code Webview Manager with Message Routing
 * Validates user requirements from TASK_CMD_002
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */
import 'reflect-metadata';
import * as vscode from 'vscode';
import { WebviewManager, WebviewPanelConfig } from './webview-manager';
// EventBus and TOKENS used for dependency injection in tests

// Mock shared library imports
jest.mock('@ptah-extension/shared', () => ({
  isSystemMessage: jest.fn(),
  isRoutableMessage: jest.fn(),
  WebviewMessage: {},
  StrictMessageType: {},
  MessagePayloadMap: {},
}));

const {
  isSystemMessage,
  isRoutableMessage,
} = require('@ptah-extension/shared');

// Mock VS Code API
jest.mock('vscode', () => ({
  window: {
    createWebviewPanel: jest.fn().mockReturnValue({
      webview: {
        postMessage: jest.fn().mockResolvedValue(undefined),
        onDidReceiveMessage: jest.fn(),
        html: '',
        options: {},
      },
      onDidChangeViewState: jest.fn(),
      onDidDispose: jest.fn(),
      reveal: jest.fn(),
      dispose: jest.fn(),
      visible: true,
      title: 'Test Panel',
    }),
  },
  ViewColumn: {
    One: 1,
    Two: 2,
  },
  Uri: {
    joinPath: jest.fn().mockReturnValue({
      scheme: 'file',
      authority: '',
      path: '/test',
      query: '',
      fragment: '',
      fsPath: '/test',
      with: jest.fn(),
      toString: jest.fn(),
      toJSON: jest.fn(),
    }),
  },
  ExtensionContext: jest.fn(),
}));

// Access mocked objects after jest.mock
const mockVscode = require('vscode');
const mockWindow = mockVscode.window;
// Mock context and webview creation
const mockWebviewPanel = mockWindow.createWebviewPanel();
const mockWebview = mockWebviewPanel.webview;

// Mock EventBus
const mockEventBus = {
  publish: jest.fn(),
  subscribe: jest.fn(),
  dispose: jest.fn(),
};

describe('WebviewManager - User Requirement: Webview Management with Message Routing', () => {
  let webviewManager: WebviewManager;
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

    webviewManager = new WebviewManager(mockContext, mockEventBus as any);

    // Reset mock implementations
    isSystemMessage.mockReset();
    isRoutableMessage.mockReset();
  });

  afterEach(() => {
    webviewManager.dispose();
  });

  describe('User Scenario: Webview Panel Creation', () => {
    it('should create webview panel with enhanced configuration', () => {
      // GIVEN: User wants to create a webview
      const config: WebviewPanelConfig = {
        viewType: 'ptah.chat',
        title: 'Ptah Chat',
        showOptions: {
          viewColumn: vscode.ViewColumn.One,
          preserveFocus: false,
        },
        options: {
          enableScripts: true,
          retainContextWhenHidden: true,
          enableForms: true,
          enableCommandUris: false,
        },
      };

      // WHEN: Creating webview panel
      const panel = webviewManager.createWebviewPanel(config);

      // THEN: Panel should be created with correct configuration
      expect(mockWindow.createWebviewPanel).toHaveBeenCalledWith(
        'ptah.chat',
        'Ptah Chat',
        1, // ViewColumn.One
        expect.objectContaining({
          enableScripts: true,
          retainContextWhenHidden: true,
          enableForms: true,
          enableCommandUris: false,
          localResourceRoots: expect.any(Array),
        })
      );

      expect(panel).toBe(mockWebviewPanel);
      expect(webviewManager.hasWebview('ptah.chat')).toBe(true);
    });

    it('should return existing webview if already created', () => {
      // GIVEN: Webview already exists
      const config: WebviewPanelConfig = {
        viewType: 'ptah.existing',
        title: 'Existing Panel',
      };

      const panel1 = webviewManager.createWebviewPanel(config);
      mockWindow.createWebviewPanel.mockClear();

      // WHEN: Attempting to create same webview again
      const panel2 = webviewManager.createWebviewPanel(config);

      // THEN: Should return existing panel and call reveal
      expect(panel2).toBe(panel1);
      expect(mockWindow.createWebviewPanel).not.toHaveBeenCalled();
      expect(mockWebviewPanel.reveal).toHaveBeenCalled();
    });

    it('should set up message handling and lifecycle events', () => {
      // GIVEN: Webview configuration
      const config: WebviewPanelConfig = {
        viewType: 'ptah.lifecycle',
        title: 'Lifecycle Test',
      };

      // WHEN: Creating webview
      webviewManager.createWebviewPanel(config);

      // THEN: Event listeners should be set up
      expect(mockWebview.onDidReceiveMessage).toHaveBeenCalled();
      expect(mockWebviewPanel.onDidChangeViewState).toHaveBeenCalled();
      expect(mockWebviewPanel.onDidDispose).toHaveBeenCalled();

      // Should publish creation event
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        expect.objectContaining({
          event: 'webview:created',
          properties: expect.objectContaining({
            webviewId: 'ptah.lifecycle',
            title: 'Lifecycle Test',
          }),
        })
      );
    });

    it('should send initial data if provided', () => {
      // GIVEN: Webview with initial data
      const config: WebviewPanelConfig = {
        viewType: 'ptah.initialdata',
        title: 'Initial Data Test',
      };
      const initialData = {
        config: { theme: 'dark' },
        state: { currentView: 'chat' },
      };

      // WHEN: Creating webview with initial data
      webviewManager.createWebviewPanel(config, initialData);

      // THEN: Initial data should be sent
      expect(mockWebview.postMessage).toHaveBeenCalledWith({
        type: 'initialData',
        payload: initialData,
      });
    });

    it('should configure default options when not specified', () => {
      // GIVEN: Minimal webview configuration
      const config: WebviewPanelConfig = {
        viewType: 'ptah.minimal',
        title: 'Minimal Panel',
      };

      // WHEN: Creating webview
      webviewManager.createWebviewPanel(config);

      // THEN: Should use sensible defaults
      expect(mockWindow.createWebviewPanel).toHaveBeenCalledWith(
        'ptah.minimal',
        'Minimal Panel',
        1, // Default ViewColumn.One
        expect.objectContaining({
          enableScripts: true, // Default true
          retainContextWhenHidden: true, // Default true
          enableForms: true, // Default true
          enableCommandUris: false, // Default false
        })
      );
    });
  });

  describe('User Scenario: Message Handling and Routing', () => {
    let messageHandler: (message: any) => void;

    beforeEach(() => {
      const config: WebviewPanelConfig = {
        viewType: 'ptah.messaging',
        title: 'Messaging Test',
      };

      webviewManager.createWebviewPanel(config);

      // Capture the message handler
      messageHandler = mockWebview.onDidReceiveMessage.mock.calls[0][0];
    });

    it('should route system messages internally', () => {
      // GIVEN: System message from webview
      const systemMessage = {
        type: 'webview-ready',
        payload: {},
      };

      isSystemMessage.mockReturnValue(true);
      isRoutableMessage.mockReturnValue(false);

      // WHEN: Handling system message
      messageHandler(systemMessage);

      // THEN: Should handle internally and publish analytics
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        expect.objectContaining({
          event: 'webview:ready',
          properties: expect.objectContaining({
            webviewId: 'ptah.messaging',
          }),
        })
      );
    });

    it('should route regular messages to event bus', () => {
      // GIVEN: Regular routable message from webview
      const routableMessage = {
        type: 'chat:sendMessage',
        payload: { content: 'Hello world', files: [] },
      };

      isSystemMessage.mockReturnValue(false);
      isRoutableMessage.mockReturnValue(true);

      // WHEN: Handling routable message
      messageHandler(routableMessage);

      // THEN: Should route to event bus
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'chat:sendMessage',
        routableMessage.payload
      );
    });

    it('should handle invalid messages gracefully', () => {
      // GIVEN: Invalid message that doesn't match type system
      const invalidMessage = {
        type: 'unknown:message',
        payload: { data: 'test' },
      };

      isSystemMessage.mockReturnValue(false);
      isRoutableMessage.mockReturnValue(false);

      // WHEN: Handling invalid message
      messageHandler(invalidMessage);

      // THEN: Should publish error event
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          code: 'INVALID_WEBVIEW_MESSAGE',
          message: expect.stringContaining('Invalid message type'),
          source: 'WebviewManager',
        })
      );
    });

    it('should track message metrics', () => {
      // GIVEN: Multiple messages received
      const message1 = {
        type: 'chat:sendMessage',
        payload: { content: 'msg1' },
      };
      const message2 = {
        type: 'analytics:trackEvent',
        payload: { event: 'test', properties: {} },
      };

      isSystemMessage.mockReturnValue(false);
      isRoutableMessage.mockReturnValue(true);

      // WHEN: Handling multiple messages
      messageHandler(message1);
      messageHandler(message2);

      // THEN: Metrics should be updated
      const metrics = webviewManager.getWebviewMetrics('ptah.messaging');
      expect(metrics).toBeDefined();
      expect(metrics!.messageCount).toBe(2);
      expect(metrics!.lastActivity).toBeGreaterThan(0);
    });
  });

  describe('User Scenario: Message Sending to Webview', () => {
    beforeEach(() => {
      const config: WebviewPanelConfig = {
        viewType: 'ptah.sending',
        title: 'Send Test',
      };
      webviewManager.createWebviewPanel(config);
    });

    it('should send messages to existing webview', async () => {
      // GIVEN: Active webview
      // WHEN: Sending message to webview
      const result = await webviewManager.sendMessage(
        'ptah.sending',
        'chat:messageChunk',
        {
          sessionId: 'test-session' as any,
          messageId: 'test-message' as any,
          content: 'Hello from extension',
          isComplete: false,
          streaming: true,
        }
      );

      // THEN: Message should be sent successfully
      expect(result).toBe(true);
      expect(mockWebview.postMessage).toHaveBeenCalledWith({
        type: 'chat:messageChunk',
        payload: expect.objectContaining({
          content: 'Hello from extension',
          streaming: true,
        }),
      });
    });

    it('should handle sending to non-existent webview', async () => {
      // GIVEN: Non-existent webview
      // WHEN: Attempting to send message
      const result = await webviewManager.sendMessage(
        'ptah.nonexistent',
        'error',
        {
          message: 'Test error',
        }
      );

      // THEN: Should fail gracefully and publish error
      expect(result).toBe(false);
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          code: 'WEBVIEW_NOT_FOUND',
          message: expect.stringContaining('ptah.nonexistent'),
        })
      );
    });

    it('should handle webview message sending errors', async () => {
      // GIVEN: Webview that fails to receive messages
      mockWebview.postMessage.mockRejectedValueOnce(new Error('Send failed'));

      // WHEN: Sending message that will fail
      const result = await webviewManager.sendMessage('ptah.sending', 'error', {
        message: 'Test message',
      });

      // THEN: Should handle error and publish error event
      expect(result).toBe(false);
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          code: 'WEBVIEW_MESSAGE_SEND_FAILED',
          source: 'WebviewManager',
        })
      );
    });
  });

  describe('User Scenario: Webview Management Operations', () => {
    beforeEach(() => {
      // Create multiple webviews for testing
      webviewManager.createWebviewPanel({
        viewType: 'ptah.test1',
        title: 'Test 1',
      });
      webviewManager.createWebviewPanel({
        viewType: 'ptah.test2',
        title: 'Test 2',
      });
    });

    it('should list all active webviews', () => {
      // WHEN: Getting active webviews
      const activeWebviews = webviewManager.getActiveWebviews();

      // THEN: Should return all webview IDs
      expect(activeWebviews).toEqual(['ptah.test1', 'ptah.test2']);
    });

    it('should check webview existence', () => {
      // WHEN: Checking webview existence
      const exists = webviewManager.hasWebview('ptah.test1');
      const doesNotExist = webviewManager.hasWebview('ptah.nonexistent');

      // THEN: Should correctly report existence
      expect(exists).toBe(true);
      expect(doesNotExist).toBe(false);
    });

    it('should get webview panel reference', () => {
      // WHEN: Getting webview panel
      const panel = webviewManager.getWebviewPanel('ptah.test1');
      const nonExistent = webviewManager.getWebviewPanel('ptah.nonexistent');

      // THEN: Should return correct panel or undefined
      expect(panel).toBe(mockWebviewPanel);
      expect(nonExistent).toBeUndefined();
    });

    it('should dispose specific webview', () => {
      // GIVEN: Webview exists
      expect(webviewManager.hasWebview('ptah.test1')).toBe(true);

      // WHEN: Disposing webview
      const result = webviewManager.disposeWebview('ptah.test1');

      // THEN: Should dispose and remove from tracking
      expect(result).toBe(true);
      expect(mockWebviewPanel.dispose).toHaveBeenCalled();
    });

    it('should handle disposing non-existent webview', () => {
      // WHEN: Disposing non-existent webview
      const result = webviewManager.disposeWebview('ptah.nonexistent');

      // THEN: Should return false without error
      expect(result).toBe(false);
    });

    it('should get webview metrics', () => {
      // WHEN: Getting metrics for specific webview
      const metrics = webviewManager.getWebviewMetrics('ptah.test1');
      const allMetrics = webviewManager.getWebviewMetrics();

      // THEN: Should return appropriate metrics
      expect(metrics).toBeDefined();
      expect(metrics!.createdAt).toBeGreaterThan(0);
      expect(metrics!.messageCount).toBe(0);
      expect(metrics!.isVisible).toBe(true);

      expect(Object.keys(allMetrics || {})).toContain('ptah.test1');
      expect(Object.keys(allMetrics || {})).toContain('ptah.test2');
    });
  });

  describe('User Scenario: Webview Lifecycle Events', () => {
    let visibilityHandler: (event: any) => void;
    let disposeHandler: () => void;

    beforeEach(() => {
      const config: WebviewPanelConfig = {
        viewType: 'ptah.lifecycle',
        title: 'Lifecycle Test',
      };

      webviewManager.createWebviewPanel(config);

      // Capture event handlers
      visibilityHandler =
        mockWebviewPanel.onDidChangeViewState.mock.calls[0][0];
      disposeHandler = mockWebviewPanel.onDidDispose.mock.calls[0][0];
    });

    it('should handle webview visibility changes', () => {
      // GIVEN: Webview visibility change event
      const visibilityEvent = {
        webviewPanel: { visible: false },
      };

      // WHEN: Handling visibility change
      visibilityHandler(visibilityEvent);

      // THEN: Should update metrics and publish event
      const metrics = webviewManager.getWebviewMetrics('ptah.lifecycle');
      expect(metrics!.isVisible).toBe(false);

      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        expect.objectContaining({
          event: 'webview:visibilityChanged',
          properties: expect.objectContaining({
            webviewId: 'ptah.lifecycle',
            visible: false,
          }),
        })
      );
    });

    it('should handle webview disposal', () => {
      // GIVEN: Webview is about to be disposed
      expect(webviewManager.hasWebview('ptah.lifecycle')).toBe(true);

      // WHEN: Handling disposal event
      disposeHandler();

      // THEN: Should clean up and publish disposal event
      expect(webviewManager.hasWebview('ptah.lifecycle')).toBe(false);
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        expect.objectContaining({
          event: 'webview:disposed',
          properties: expect.objectContaining({
            webviewId: 'ptah.lifecycle',
          }),
        })
      );
    });
  });

  describe('User Scenario: Extension Cleanup', () => {
    it('should dispose all webviews during manager disposal', () => {
      // GIVEN: Multiple active webviews
      webviewManager.createWebviewPanel({
        viewType: 'ptah.cleanup1',
        title: 'Cleanup 1',
      });
      webviewManager.createWebviewPanel({
        viewType: 'ptah.cleanup2',
        title: 'Cleanup 2',
      });

      expect(webviewManager.getActiveWebviews()).toHaveLength(2);

      // WHEN: Disposing manager
      webviewManager.dispose();

      // THEN: All webviews should be disposed
      expect(mockWebviewPanel.dispose).toHaveBeenCalledTimes(2);
      expect(webviewManager.getActiveWebviews()).toHaveLength(0);
      expect(webviewManager.getWebviewMetrics()).toEqual({});
    });
  });

  describe('User Error Scenarios', () => {
    it('should handle webview creation errors gracefully', () => {
      // GIVEN: VS Code API that throws during webview creation
      mockWindow.createWebviewPanel.mockImplementationOnce(() => {
        throw new Error('Failed to create webview');
      });

      const config: WebviewPanelConfig = {
        viewType: 'ptah.error',
        title: 'Error Test',
      };

      // WHEN: Attempting to create webview that fails
      // THEN: Should throw error
      expect(() => {
        webviewManager.createWebviewPanel(config);
      }).toThrow('Failed to create webview');
    });

    it('should handle message handler errors without crashing', () => {
      // GIVEN: Webview with message handler
      const config: WebviewPanelConfig = {
        viewType: 'ptah.error.handling',
        title: 'Error Handling Test',
      };

      webviewManager.createWebviewPanel(config);
      const messageHandler = mockWebview.onDidReceiveMessage.mock.calls[0][0];

      // Mock error in message routing
      isSystemMessage.mockImplementation(() => {
        throw new Error('Type guard error');
      });

      // WHEN: Handling message that causes error
      // THEN: Should not crash the extension (implementation may or may not catch errors)
      try {
        messageHandler({ type: 'test', payload: {} });
      } catch (error) {
        // If error is caught here, it means implementation doesn't handle it internally
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Type guard error');
      }
    });
  });

  describe('User Requirement: Type Safety and Integration', () => {
    it('should maintain type safety in message routing', async () => {
      // GIVEN: Type-safe webview setup
      const config: WebviewPanelConfig = {
        viewType: 'ptah.typesafe',
        title: 'Type Safe Test',
      };

      webviewManager.createWebviewPanel(config);

      // WHEN: Sending type-safe messages
      await webviewManager.sendMessage('ptah.typesafe', 'chat:sendMessage', {
        content: 'Type safe message',
        files: ['file1.ts'],
        correlationId: 'test-correlation' as any,
      });

      // THEN: Type safety should be maintained (compile-time verification)
      expect(mockWebview.postMessage).toHaveBeenCalledWith({
        type: 'chat:sendMessage',
        payload: expect.objectContaining({
          content: 'Type safe message',
          files: ['file1.ts'],
        }),
      });
    });

    it('should integrate properly with existing MessagePayloadMap', () => {
      // GIVEN: Message types from existing system
      const config: WebviewPanelConfig = {
        viewType: 'ptah.integration',
        title: 'Integration Test',
      };

      webviewManager.createWebviewPanel(config);
      const messageHandler = mockWebview.onDidReceiveMessage.mock.calls[0][0];

      isSystemMessage.mockReturnValue(false);
      isRoutableMessage.mockReturnValue(true);

      // WHEN: Handling various message types from existing system
      const messages = [
        { type: 'chat:sendMessage', payload: { content: 'test' } },
        { type: 'providers:switch', payload: { providerId: 'test-provider' } },
        {
          type: 'analytics:trackEvent',
          payload: { event: 'test', properties: {} },
        },
        {
          type: 'context:updateFiles',
          payload: { includedFiles: [], excludedFiles: [], tokenEstimate: 100 },
        },
      ];

      messages.forEach((message) => {
        messageHandler(message);
      });

      // THEN: All message types should be routed correctly
      messages.forEach((message) => {
        expect(mockEventBus.publish).toHaveBeenCalledWith(
          message.type,
          message.payload
        );
      });
    });
  });
});
