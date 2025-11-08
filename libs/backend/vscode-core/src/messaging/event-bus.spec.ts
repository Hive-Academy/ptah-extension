/**
 * EventBus Tests - User Requirement Validation
 * Testing Week 2 implementation: RxJS Event Bus Implementation
 * Validates user requirements from TASK_CMD_002
 */

import 'reflect-metadata';
import { firstValueFrom, take, timeout } from 'rxjs';
import { EventBus, TypedEvent, RequestEvent, ResponseEvent } from './event-bus';
// CorrelationId type used for request tracking

describe('EventBus - User Requirement: RxJS Event Bus System', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  afterEach(() => {
    eventBus.dispose();
  });

  describe('User Scenario: Type-Safe Message Publishing', () => {
    it('should publish messages with existing MessagePayloadMap types', () => {
      // GIVEN: User wants to send a chat message
      const chatPayload = {
        content: 'Hello world',
        files: ['test.ts'],
        correlationId: 'test-correlation' as any,
      };

      // WHEN: Publishing a chat message
      expect(() => {
        eventBus.publish('chat:sendMessage', chatPayload, 'extension');
      }).not.toThrow();

      // THEN: Message should be published successfully
      // (No exceptions thrown means success)
    });

    it('should auto-generate correlation IDs and timestamps', async () => {
      // GIVEN: Message payload without metadata
      const payload = { content: 'test message' };
      let capturedEvent: TypedEvent<'chat:sendMessage'> | null = null;

      // Set up subscription before publishing
      const subscription = eventBus
        .subscribe('chat:sendMessage')
        .pipe(take(1))
        .subscribe((event) => {
          capturedEvent = event;
        });

      // WHEN: Publishing message
      eventBus.publish('chat:sendMessage', payload);

      // Wait for event propagation
      await new Promise((resolve) => setTimeout(resolve, 0));

      // THEN: Event should have generated metadata
      expect(capturedEvent).toBeDefined();
      expect(capturedEvent!.correlationId).toBeDefined();
      expect(capturedEvent!.timestamp).toBeGreaterThan(0);
      expect(capturedEvent!.source).toBe('extension');
      expect(capturedEvent!.type).toBe('chat:sendMessage');
      expect(capturedEvent!.payload).toBe(payload);

      subscription.unsubscribe();
    });

    it('should support different event sources', async () => {
      // GIVEN: Events from different sources
      let extensionEvent: TypedEvent<'analytics:trackEvent'> | null = null;
      let webviewEvent: TypedEvent<'analytics:trackEvent'> | null = null;

      const subscription = eventBus
        .subscribeToAll()
        .pipe(take(2))
        .subscribe((event) => {
          if (
            event.source === 'extension' &&
            event.type === 'analytics:trackEvent'
          ) {
            extensionEvent = event as TypedEvent<'analytics:trackEvent'>;
          }
          if (
            event.source === 'webview' &&
            event.type === 'analytics:trackEvent'
          ) {
            webviewEvent = event as TypedEvent<'analytics:trackEvent'>;
          }
        });

      // WHEN: Publishing from different sources
      eventBus.publish(
        'analytics:trackEvent',
        { event: 'test', properties: {} },
        'extension'
      );
      eventBus.publish(
        'analytics:trackEvent',
        { event: 'test2', properties: {} },
        'webview'
      );

      await new Promise((resolve) => setTimeout(resolve, 0));

      // THEN: Events should have correct source attribution
      expect(extensionEvent).toBeDefined();
      expect(webviewEvent).toBeDefined();
      expect(extensionEvent!.source).toBe('extension');
      expect(webviewEvent!.source).toBe('webview');

      subscription.unsubscribe();
    });
  });

  describe('User Scenario: Type-Safe Message Subscription', () => {
    it('should provide RxJS observables for Angular compatibility', async () => {
      // GIVEN: Angular component needs reactive message streams
      const testPayload = {
        event: 'user-action',
        properties: { action: 'click' },
      };

      // WHEN: Subscribing to messages
      const messagePromise = firstValueFrom(
        eventBus.subscribe('analytics:trackEvent').pipe(take(1))
      );

      eventBus.publish('analytics:trackEvent', testPayload);

      // THEN: Should receive typed events via RxJS observable
      const receivedEvent = await messagePromise;
      expect(receivedEvent.type).toBe('analytics:trackEvent');
      expect(receivedEvent.payload).toEqual(testPayload);
    });

    it('should support wildcard subscriptions for monitoring', async () => {
      // GIVEN: Monitoring system needs all events
      const receivedEvents: TypedEvent[] = [];

      const subscription = eventBus
        .subscribeToAll()
        .pipe(take(3))
        .subscribe((event) => {
          receivedEvents.push(event);
        });

      // WHEN: Publishing different message types
      eventBus.publish('chat:sendMessage', { content: 'test' });
      eventBus.publish('analytics:trackEvent', {
        event: 'test',
        properties: {},
      });
      eventBus.publish('error', { message: 'test error' });

      await new Promise((resolve) => setTimeout(resolve, 0));

      // THEN: All events should be captured
      expect(receivedEvents).toHaveLength(3);
      expect(receivedEvents.map((e) => e.type)).toEqual([
        'chat:sendMessage',
        'analytics:trackEvent',
        'error',
      ]);

      subscription.unsubscribe();
    });

    it('should maintain type safety in subscriptions', async () => {
      // GIVEN: Type-safe subscription setup
      const chatSubscription = eventBus.subscribe('chat:sendMessage');
      const analyticsSubscription = eventBus.subscribe('analytics:trackEvent');

      let chatEvent: TypedEvent<'chat:sendMessage'> | null = null;
      let analyticsEvent: TypedEvent<'analytics:trackEvent'> | null = null;

      chatSubscription.pipe(take(1)).subscribe((event) => {
        chatEvent = event;
        // TypeScript should enforce correct payload type here
        expect(typeof event.payload.content).toBe('string');
      });

      analyticsSubscription.pipe(take(1)).subscribe((event) => {
        analyticsEvent = event;
        // TypeScript should enforce correct payload type here
        expect(typeof event.payload.event).toBe('string');
      });

      // WHEN: Publishing different message types
      eventBus.publish('chat:sendMessage', { content: 'test message' });
      eventBus.publish('analytics:trackEvent', {
        event: 'test',
        properties: {},
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      // THEN: Events should be received with correct types
      expect(chatEvent).toBeDefined();
      expect(analyticsEvent).toBeDefined();
      expect(chatEvent!.type).toBe('chat:sendMessage');
      expect(analyticsEvent!.type).toBe('analytics:trackEvent');
    });
  });

  describe('User Scenario: Request-Response Patterns', () => {
    it('should support async request-response communication', async () => {
      // GIVEN: Service needs request-response pattern
      const requestPayload = { templateId: 'test-command', parameters: {} };
      const responseData = { success: true, result: 'command executed' };

      // Set up responder
      eventBus
        .subscribe('commands:executeCommand')
        .pipe(take(1))
        .subscribe((request: RequestEvent<'commands:executeCommand'>) => {
          // Simulate async processing
          setTimeout(() => {
            eventBus.respond(request, responseData);
          }, 10);
        });

      // WHEN: Making a request
      const response = await eventBus.request(
        'commands:executeCommand',
        requestPayload,
        1000
      );

      // THEN: Should receive response data
      expect(response).toEqual(responseData);
    });

    it('should handle request timeouts', async () => {
      // GIVEN: Request with timeout but no responder
      const requestPayload = { templateId: 'timeout-test', parameters: {} };

      // WHEN: Making request that will timeout
      // THEN: Should throw timeout error
      await expect(
        eventBus.request('commands:executeCommand', requestPayload, 100)
      ).rejects.toThrow(/timeout/i);
    });

    it('should handle request errors', async () => {
      // GIVEN: Service that responds with error
      const requestPayload = { templateId: 'error-test', parameters: {} };

      eventBus
        .subscribe('commands:executeCommand')
        .pipe(take(1))
        .subscribe((request: RequestEvent<'commands:executeCommand'>) => {
          eventBus.respond(request, undefined, {
            code: 'COMMAND_FAILED',
            message: 'Test error',
            context: { reason: 'mock test' },
          });
        });

      // WHEN: Making request that will error
      // THEN: Should throw error with message
      await expect(
        eventBus.request('commands:executeCommand', requestPayload, 1000)
      ).rejects.toThrow('Test error');
    });

    it('should track request correlation IDs', async () => {
      // GIVEN: Request-response setup with correlation tracking
      let capturedRequest: RequestEvent<'commands:executeCommand'> | null =
        null;

      eventBus
        .subscribe('commands:executeCommand')
        .pipe(take(1))
        .subscribe((request) => {
          capturedRequest = request as RequestEvent<'commands:executeCommand'>;
          eventBus.respond(request, 'success');
        });

      // WHEN: Making a request
      await eventBus.request('commands:executeCommand', {
        templateId: 'test',
        parameters: {},
      });

      // THEN: Correlation ID should be present and consistent
      expect(capturedRequest).toBeDefined();
      expect(capturedRequest!.correlationId).toBeDefined();
      expect(typeof capturedRequest!.correlationId).toBe('string');
    });
  });

  describe('User Scenario: Event Bus Monitoring', () => {
    it('should provide metrics for monitoring', () => {
      // GIVEN: Event bus with some activity
      const subscription1 = eventBus
        .subscribe('chat:sendMessage')
        .subscribe(() => undefined);
      const subscription2 = eventBus
        .subscribe('analytics:trackEvent')
        .subscribe(() => undefined);
      eventBus.publish('chat:sendMessage', { content: 'test' });

      // WHEN: Getting metrics
      const metrics = eventBus.getMetrics();

      // THEN: Should provide useful monitoring data
      expect(metrics.activeRequests).toBe(0); // No active requests
      expect(metrics.eventListeners).toBeGreaterThan(0);
      expect(metrics.eventNames).toContain('chat:sendMessage');
      expect(typeof metrics.oldestRequest).toBe('number');

      // Cleanup
      subscription1.unsubscribe();
      subscription2.unsubscribe();
    });

    it('should track active requests in metrics', async () => {
      // GIVEN: Set up responder first
      eventBus
        .subscribe('commands:executeCommand')
        .pipe(take(1))
        .subscribe((request) => {
          // Respond after a short delay to allow metrics check
          setTimeout(() => {
            eventBus.respond(
              request as RequestEvent<'commands:executeCommand'>,
              'cleanup'
            );
          }, 50);
        });

      // WHEN: Making a request and checking metrics immediately
      const requestPromise = eventBus.request(
        'commands:executeCommand',
        { templateId: 'test', parameters: {} },
        1000
      );

      // Check metrics while request is active (before response)
      await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay to ensure request is registered
      const metricsWithActive = eventBus.getMetrics();

      // Wait for request to complete
      await requestPromise;

      // THEN: Should show active request count during request
      expect(metricsWithActive.activeRequests).toBe(1);

      // After cleanup
      const metricsAfterCleanup = eventBus.getMetrics();
      expect(metricsAfterCleanup.activeRequests).toBe(0);
    }, 10000);
  });

  describe('User Error Scenarios', () => {
    it('should handle disposal cleanup properly', () => {
      // GIVEN: Event bus with subscriptions and active requests
      eventBus.subscribe('chat:sendMessage');
      // Create a request to test disposal cleanup
      eventBus
        .request(
          'commands:executeCommand',
          { templateId: 'test', parameters: {} },
          1000
        )
        .catch(() => undefined); // Ignore timeout error

      const initialMetrics = eventBus.getMetrics();
      expect(initialMetrics.eventListeners).toBeGreaterThan(0);

      // WHEN: Disposing event bus
      eventBus.dispose();

      // THEN: Should clean up all resources
      const finalMetrics = eventBus.getMetrics();
      expect(finalMetrics.activeRequests).toBe(0);
      expect(finalMetrics.eventListeners).toBe(0);
    });

    it('should handle rapid request cancellation', async () => {
      // GIVEN: Multiple rapid requests
      const requests = Array.from(
        { length: 5 },
        (_, i) =>
          eventBus
            .request(
              'commands:executeCommand',
              { templateId: `test-${i}`, parameters: {} },
              100
            )
            .catch(() => undefined) // Ignore timeout errors
      );

      // WHEN: Disposing before requests complete
      setTimeout(() => eventBus.dispose(), 50);

      // THEN: Should handle cleanup without errors
      await Promise.all(requests);
      expect(eventBus.getMetrics().activeRequests).toBe(0);
    });
  });

  describe('User Requirement: Angular Integration', () => {
    it('should work with Angular reactive patterns', async () => {
      // GIVEN: Angular component using reactive patterns
      const messages$ = eventBus.subscribe('chat:sendMessage');
      const errors$ = eventBus.subscribe('error');

      let messageCount = 0;
      let errorCount = 0;

      // Simulate Angular component subscriptions
      const messageSubscription = messages$.subscribe(() => messageCount++);
      const errorSubscription = errors$.subscribe(() => errorCount++);

      // WHEN: Publishing various events
      eventBus.publish('chat:sendMessage', { content: 'message 1' });
      eventBus.publish('chat:sendMessage', { content: 'message 2' });
      eventBus.publish('error', { message: 'test error' });
      eventBus.publish('analytics:trackEvent', {
        event: 'other',
        properties: {},
      }); // Should not affect counters

      await new Promise((resolve) => setTimeout(resolve, 0));

      // THEN: Component should receive only relevant events
      expect(messageCount).toBe(2);
      expect(errorCount).toBe(1);

      // Cleanup
      messageSubscription.unsubscribe();
      errorSubscription.unsubscribe();
    });

    it('should support RxJS operators for complex scenarios', async () => {
      // GIVEN: Complex Angular scenario with operators
      const chatMessages$ = eventBus.subscribe('chat:sendMessage');

      // WHEN: Using RxJS operators for filtering and transformation
      const longMessages$ = chatMessages$.pipe(take(3), timeout(1000));

      const receivedMessages: string[] = [];
      const subscription = longMessages$.subscribe((event) => {
        receivedMessages.push(event.payload.content);
      });

      // Publish test messages
      eventBus.publish('chat:sendMessage', { content: 'short' });
      eventBus.publish('chat:sendMessage', { content: 'medium message' });
      eventBus.publish('chat:sendMessage', {
        content: 'this is a very long message',
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      // THEN: Should work with RxJS operators
      expect(receivedMessages).toHaveLength(3);

      subscription.unsubscribe();
    });
  });
});
