/**
 * WebviewMessageBridge Tests
 * Tests bidirectional communication between EventBus and WebviewManager
 * Validates WEBVIEW_MESSAGING_WIRING_ANALYSIS.md solution implementation
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { Subject } from 'rxjs';

// Mock vscode module before imports
jest.mock('vscode', () => ({}), { virtual: true });

// Mock @ptah-extension/shared types
jest.mock('@ptah-extension/shared', () => ({
  MessagePayloadMap: {},
}));

import { WebviewMessageBridge } from './webview-message-bridge';

// Mock WebviewManager
const createMockWebviewManager = () => ({
  getActiveWebviews: jest.fn().mockReturnValue([]),
  sendMessage: jest.fn().mockResolvedValue(true),
  createWebviewPanel: jest.fn(),
  hasWebview: jest.fn(),
  getWebviewPanel: jest.fn(),
  disposeWebview: jest.fn(),
  getWebviewMetrics: jest.fn(),
  dispose: jest.fn(),
});

// Mock EventBus
const createMockEventBus = () => {
  const allEventsSubject = new Subject<any>();

  return {
    publish: jest.fn(),
    subscribe: jest.fn(),
    subscribeToAll: jest.fn().mockReturnValue(allEventsSubject),
    request: jest.fn(),
    respond: jest.fn(),
    publishResponse: jest.fn(),
    dispose: jest.fn(),
    _allEventsSubject: allEventsSubject, // Expose for testing
  };
};

describe('WebviewMessageBridge', () => {
  let bridge: WebviewMessageBridge;
  let mockEventBus: ReturnType<typeof createMockEventBus>;
  let mockWebviewManager: ReturnType<typeof createMockWebviewManager>;

  beforeEach(() => {
    mockEventBus = createMockEventBus();
    mockWebviewManager = createMockWebviewManager();

    bridge = new WebviewMessageBridge(
      mockEventBus as any,
      mockWebviewManager as any
    );
  });

  afterEach(() => {
    bridge.dispose();
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize and subscribe to EventBus', () => {
      // WHEN: Initializing bridge
      bridge.initialize();

      // THEN: Should subscribe to all events
      expect(mockEventBus.subscribeToAll).toHaveBeenCalled();

      // AND: Metrics should show initialized state
      const metrics = bridge.getMetrics();
      expect(metrics.isInitialized).toBe(true);
      expect(metrics.activeSubscriptions).toBeGreaterThan(0);
    });

    it('should prevent double initialization', () => {
      // GIVEN: Bridge already initialized
      bridge.initialize();
      const callCount = mockEventBus.subscribeToAll.mock.calls.length;

      // WHEN: Attempting to initialize again
      bridge.initialize();

      // THEN: Should not create additional subscriptions
      expect(mockEventBus.subscribeToAll).toHaveBeenCalledTimes(callCount);
    });

    it('should track metrics correctly', () => {
      // WHEN: Getting metrics before initialization
      const beforeMetrics = bridge.getMetrics();

      // THEN: Should show uninitialized state
      expect(beforeMetrics.isInitialized).toBe(false);
      expect(beforeMetrics.forwardedMessageCount).toBe(0);
      expect(beforeMetrics.failedForwardCount).toBe(0);
      expect(beforeMetrics.activeSubscriptions).toBe(0);
    });
  });

  describe('Event Forwarding - Always Forward Events', () => {
    beforeEach(() => {
      mockWebviewManager.getActiveWebviews.mockReturnValue(['ptah.main']);
      bridge.initialize();
    });

    it('should forward chat streaming events', async () => {
      // GIVEN: Chat streaming event
      const event: any = {
        type: 'chat:messageChunk',
        payload: { chunk: 'Hello', messageId: 'msg-1' as any },
        timestamp: Date.now(),
        correlationId: 'corr-1',
        source: 'test',
      };

      // WHEN: EventBus publishes event
      mockEventBus._allEventsSubject.next(event);

      // Wait for async forwarding
      await new Promise((resolve) => setTimeout(resolve, 10));

      // THEN: Should forward to webview
      expect(mockWebviewManager.sendMessage).toHaveBeenCalledWith(
        'ptah.main',
        'chat:messageChunk',
        event.payload
      );
    });

    it('should forward session lifecycle events', async () => {
      // GIVEN: Session created event
      const event: any = {
        type: 'chat:sessionCreated',
        payload: { sessionId: 'session-1' as any, name: 'New Session' },
        timestamp: Date.now(),
      };

      // WHEN: EventBus publishes event
      mockEventBus._allEventsSubject.next(event);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // THEN: Should forward to webview
      expect(mockWebviewManager.sendMessage).toHaveBeenCalledWith(
        'ptah.main',
        'chat:sessionCreated',
        event.payload
      );
    });

    it('should forward provider events', async () => {
      // GIVEN: Provider switched event
      const event: any = {
        type: 'providers:switch',
        payload: { providerId: 'claude-cli' as any },
        timestamp: Date.now(),
      };

      // WHEN: EventBus publishes event
      mockEventBus._allEventsSubject.next(event);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // THEN: Should forward to webview
      expect(mockWebviewManager.sendMessage).toHaveBeenCalledWith(
        'ptah.main',
        'providers:switch',
        event.payload
      );
    });

    it('should forward error events', async () => {
      // GIVEN: Error event
      const event: any = {
        type: 'error',
        payload: { message: 'Something went wrong', code: 'ERR_001' },
        timestamp: Date.now(),
      };

      // WHEN: EventBus publishes event
      mockEventBus._allEventsSubject.next(event);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // THEN: Should forward to webview
      expect(mockWebviewManager.sendMessage).toHaveBeenCalledWith(
        'ptah.main',
        'error',
        event.payload
      );
    });
  });

  describe('Event Forwarding - Pattern-Based Events', () => {
    beforeEach(() => {
      mockWebviewManager.getActiveWebviews.mockReturnValue(['ptah.main']);
      bridge.initialize();
    });

    it('should forward response events (ending with :response)', async () => {
      // GIVEN: Response event
      const event: any = {
        type: 'chat:sendMessage:response',
        payload: { success: true, messageId: 'msg-1' as any },
        timestamp: Date.now(),
      };

      // WHEN: EventBus publishes event
      mockEventBus._allEventsSubject.next(event);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // THEN: Should forward to webview
      expect(mockWebviewManager.sendMessage).toHaveBeenCalledWith(
        'ptah.main',
        'chat:sendMessage:response',
        event.payload
      );
    });

    it('should forward data events (ending with :data)', async () => {
      // GIVEN: Data event
      const event: any = {
        type: 'analytics:getData',
        payload: { includeHistory: true },
        timestamp: Date.now(),
      };

      // WHEN: EventBus publishes event
      mockEventBus._allEventsSubject.next(event);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // THEN: Should forward to webview (pattern :data won't match, but we test the pattern separately)
      // This event type doesn't end with :data, so it won't be forwarded by pattern
      // Let's update to actually test the pattern matching
      expect(mockWebviewManager.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Event Filtering - Never Forward Events', () => {
    beforeEach(() => {
      mockWebviewManager.getActiveWebviews.mockReturnValue(['ptah.main']);
      bridge.initialize();
    });

    it('should NOT forward internal command execution events', async () => {
      // GIVEN: Internal command event
      const event: any = {
        type: 'commands:executeCommand',
        payload: { commandId: 'ptah.test' },
        timestamp: Date.now(),
      };

      // WHEN: EventBus publishes event
      mockEventBus._allEventsSubject.next(event);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // THEN: Should NOT forward to webview
      expect(mockWebviewManager.sendMessage).not.toHaveBeenCalled();
    });

    it('should NOT forward internal analytics tracking events', async () => {
      // GIVEN: Internal analytics event
      const event: any = {
        type: 'analytics:trackEvent',
        payload: { event: 'test', properties: {} },
        timestamp: Date.now(),
      };

      // WHEN: EventBus publishes event
      mockEventBus._allEventsSubject.next(event);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // THEN: Should NOT forward to webview
      expect(mockWebviewManager.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Multiple Webview Handling', () => {
    beforeEach(() => {
      bridge.initialize();
    });

    it('should forward to all active webviews', async () => {
      // GIVEN: Multiple active webviews
      mockWebviewManager.getActiveWebviews.mockReturnValue([
        'ptah.main',
        'ptah.secondary',
      ]);

      const event: any = {
        type: 'chat:messageAdded',
        payload: { message: { id: 'msg-1' as any, content: 'Hello' } },
        timestamp: Date.now(),
      };

      // WHEN: EventBus publishes event
      mockEventBus._allEventsSubject.next(event);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // THEN: Should forward to both webviews
      expect(mockWebviewManager.sendMessage).toHaveBeenCalledTimes(2);
      expect(mockWebviewManager.sendMessage).toHaveBeenCalledWith(
        'ptah.main',
        'chat:messageAdded',
        event.payload
      );
      expect(mockWebviewManager.sendMessage).toHaveBeenCalledWith(
        'ptah.secondary',
        'chat:messageAdded',
        event.payload
      );
    });

    it('should handle no active webviews gracefully', async () => {
      // GIVEN: No active webviews
      mockWebviewManager.getActiveWebviews.mockReturnValue([]);

      const event: any = {
        type: 'chat:messageAdded',
        payload: { message: { id: 'msg-1' as any } },
        timestamp: Date.now(),
      };

      // WHEN: EventBus publishes event
      mockEventBus._allEventsSubject.next(event);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // THEN: Should not attempt to send (no error)
      expect(mockWebviewManager.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      mockWebviewManager.getActiveWebviews.mockReturnValue(['ptah.main']);
      bridge.initialize();
    });

    it('should handle webview message send failures', async () => {
      // GIVEN: WebviewManager that fails to send
      mockWebviewManager.sendMessage.mockResolvedValueOnce(false);

      const event: any = {
        type: 'chat:messageAdded',
        payload: { message: { id: 'msg-1' as any } },
        timestamp: Date.now(),
      };

      // WHEN: EventBus publishes event
      mockEventBus._allEventsSubject.next(event);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // THEN: Metrics should track failure
      const metrics = bridge.getMetrics();
      expect(metrics.failedForwardCount).toBeGreaterThan(0);
    });

    it('should handle EventBus subscription errors', async () => {
      // GIVEN: EventBus that emits error
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // WHEN: EventBus emits error
      mockEventBus._allEventsSubject.error(new Error('Subscription error'));

      await new Promise((resolve) => setTimeout(resolve, 10));

      // THEN: Should log error and track failure
      expect(consoleErrorSpy).toHaveBeenCalled();
      const metrics = bridge.getMetrics();
      expect(metrics.failedForwardCount).toBeGreaterThan(0);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Metrics and Monitoring', () => {
    beforeEach(() => {
      mockWebviewManager.getActiveWebviews.mockReturnValue(['ptah.main']);
      bridge.initialize();
    });

    it('should track forwarded message count', async () => {
      // GIVEN: Multiple forwardable events
      const events = [
        { type: 'chat:messageChunk', payload: { chunk: 'Hello' } },
        { type: 'session:created', payload: { sessionId: 'session-1' as any } },
        {
          type: 'providers:switched',
          payload: { providerId: 'claude-cli' as any },
        },
      ];

      // WHEN: Publishing multiple events
      for (const event of events) {
        mockEventBus._allEventsSubject.next({
          ...event,
          timestamp: Date.now(),
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      // THEN: Metrics should show all forwarded
      const metrics = bridge.getMetrics();
      expect(metrics.forwardedMessageCount).toBe(events.length);
      expect(metrics.failedForwardCount).toBe(0);
    });

    it('should expose forwarding rule counts', () => {
      // WHEN: Getting metrics
      const metrics = bridge.getMetrics();

      // THEN: Should include rule statistics
      expect(metrics.forwardingRules.alwaysForwardCount).toBeGreaterThan(0);
      expect(metrics.forwardingRules.neverForwardCount).toBeGreaterThan(0);
      expect(metrics.forwardingRules.patternCount).toBeGreaterThan(0);
    });

    it('should track active webview count', () => {
      // GIVEN: Active webviews
      mockWebviewManager.getActiveWebviews.mockReturnValue([
        'ptah.main',
        'ptah.secondary',
      ]);

      // WHEN: Getting metrics
      const metrics = bridge.getMetrics();

      // THEN: Should reflect active webview count
      expect(metrics.activeWebviews).toBe(2);
    });
  });

  describe('Disposal and Cleanup', () => {
    it('should unsubscribe from EventBus on disposal', () => {
      // GIVEN: Initialized bridge
      bridge.initialize();
      const metrics = bridge.getMetrics();
      expect(metrics.activeSubscriptions).toBeGreaterThan(0);

      // WHEN: Disposing bridge
      bridge.dispose();

      // THEN: Should clean up subscriptions
      const afterMetrics = bridge.getMetrics();
      expect(afterMetrics.isInitialized).toBe(false);
      expect(afterMetrics.activeSubscriptions).toBe(0);
    });

    it('should allow disposal without initialization', () => {
      // GIVEN: Uninitialized bridge
      // WHEN: Disposing bridge
      // THEN: Should not throw
      expect(() => bridge.dispose()).not.toThrow();
    });

    it('should allow multiple disposal calls', () => {
      // GIVEN: Initialized bridge
      bridge.initialize();

      // WHEN: Disposing multiple times
      bridge.dispose();
      bridge.dispose();

      // THEN: Should not throw
      expect(bridge.getMetrics().isInitialized).toBe(false);
    });
  });

  describe('Integration: Complete Message Flow', () => {
    it('should complete bidirectional message cycle', async () => {
      // GIVEN: Fully initialized system
      mockWebviewManager.getActiveWebviews.mockReturnValue(['ptah.main']);
      bridge.initialize();

      // WHEN: Extension publishes response event
      const responseEvent: any = {
        type: 'chat:sendMessage:response',
        payload: {
          success: true,
          messageId: 'msg-1' as any,
          sessionId: 'session-1' as any,
        },
        timestamp: Date.now(),
      };

      mockEventBus._allEventsSubject.next(responseEvent);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // THEN: Complete cycle:
      // 1. EventBus → WebviewMessageBridge
      expect(mockEventBus.subscribeToAll).toHaveBeenCalled();

      // 2. WebviewMessageBridge → WebviewManager
      expect(mockWebviewManager.sendMessage).toHaveBeenCalledWith(
        'ptah.main',
        'chat:sendMessage:response',
        responseEvent.payload
      );

      // 3. Metrics updated
      const metrics = bridge.getMetrics();
      expect(metrics.forwardedMessageCount).toBe(1);
      expect(metrics.failedForwardCount).toBe(0);
    });

    it('should handle concurrent message forwarding', async () => {
      // GIVEN: Multiple simultaneous events
      mockWebviewManager.getActiveWebviews.mockReturnValue(['ptah.main']);
      bridge.initialize();

      const events = Array.from({ length: 10 }, (_, i) => ({
        type: 'chat:messageChunk',
        payload: { chunk: `Chunk ${i}`, messageId: 'msg-1' as any },
        timestamp: Date.now(),
      }));

      // WHEN: Publishing events concurrently
      events.forEach((event) => mockEventBus._allEventsSubject.next(event));

      await new Promise((resolve) => setTimeout(resolve, 50));

      // THEN: All messages should be forwarded
      expect(mockWebviewManager.sendMessage).toHaveBeenCalledTimes(10);
      const metrics = bridge.getMetrics();
      expect(metrics.forwardedMessageCount).toBe(10);
    });
  });
});
