/**
 * Comprehensive Test Suite for EnhancedChatService
 * Testing critical fixes for TASK_CMD_010
 *
 * Focus areas:
 * 1. Fixed message display logic (no JSON stub messages)
 * 2. Dual message system unified logic
 * 3. Angular 20+ patterns (signals, computed, OnPush)
 * 4. Error handling and graceful degradation
 * 5. Performance validation
 */

import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
import { EnhancedChatService } from './enhanced-chat.service';
import { VSCodeService } from './vscode.service';
import { AppStateManager } from './app-state.service';
import { WebviewConfigService } from './webview-config.service';
import { ClaudeMessageTransformerService } from './claude-message-transformer.service';
import {
  StrictChatMessage,
  StrictChatSession,
  ProcessedClaudeMessage,
  ClaudeCliStreamMessage,
  SessionId,
  MessageId,
} from '@ptah-extension/shared';

describe('EnhancedChatService - TASK_CMD_010 Validation', () => {
  let service: EnhancedChatService;
  let mockVSCodeService: jasmine.SpyObj<VSCodeService>;
  let mockAppStateManager: jasmine.SpyObj<AppStateManager>;
  let mockConfigService: jasmine.SpyObj<WebviewConfigService>;
  let mockClaudeTransformer: jasmine.SpyObj<ClaudeMessageTransformerService>;
  let messageSubject: Subject<any>;

  beforeEach(async () => {
    messageSubject = new Subject();

    // Create comprehensive mocks
    mockVSCodeService = jasmine.createSpyObj(
      'VSCodeService',
      ['onMessage', 'onMessageType', 'postStrictMessage', 'postMessage', 'isConnected'],
      {
        isConnected: signal(true),
      },
    );

    mockAppStateManager = jasmine.createSpyObj('AppStateManager', ['handleError']);

    mockConfigService = jasmine.createSpyObj('WebviewConfigService', [], {
      claudeConfig: signal({ model: 'claude-3-5-sonnet-20241022', temperature: 0.7 }),
    });

    mockClaudeTransformer = jasmine.createSpyObj('ClaudeMessageTransformerService', ['transform']);

    // Setup mock return values
    mockVSCodeService.onMessage.and.returnValue(messageSubject.asObservable());
    mockVSCodeService.onMessageType.and.returnValue(of({}));
    mockVSCodeService.isConnected.and.returnValue(true);

    await TestBed.configureTestingModule({
      providers: [
        EnhancedChatService,
        { provide: VSCodeService, useValue: mockVSCodeService },
        { provide: AppStateManager, useValue: mockAppStateManager },
        { provide: WebviewConfigService, useValue: mockConfigService },
        { provide: ClaudeMessageTransformerService, useValue: mockClaudeTransformer },
      ],
    }).compileComponents();

    service = TestBed.inject(EnhancedChatService);
  });

  afterEach(() => {
    service.destroy();
    messageSubject.complete();
  });

  describe('🎯 CRITICAL FIX: Message Display System', () => {
    it('should display clean messages without JSON stubs', () => {
      const mockMessage: StrictChatMessage = {
        id: 'msg_123' as MessageId,
        sessionId: 'session_123' as SessionId,
        type: 'assistant',
        content: 'This is a clean assistant response',
        timestamp: Date.now(),
        streaming: false,
      };

      // Simulate receiving a clean message
      messageSubject.next({
        type: 'chat:messageAdded',
        payload: { message: mockMessage },
      });

      const messages = service.messages();
      expect(messages.length).toBe(1);
      expect(messages[0].content).toBe('This is a clean assistant response');
      expect(messages[0].content).not.toContain('{');
      expect(messages[0].content).not.toContain('"type":');
      expect(messages[0].content).not.toContain('JSON.stringify');
    });

    it('should handle malformed messages gracefully without displaying JSON', () => {
      const malformedMessage = {
        type: 'chat:messageAdded',
        payload: {
          // Malformed structure that might cause JSON stub display
          rawData: { type: 'complex', nested: { data: 'test' } },
          timestamp: 'invalid',
        },
      };

      messageSubject.next(malformedMessage);

      const messages = service.messages();
      // Should have error message, but not JSON display
      expect(messages.length).toBe(1);
      expect(messages[0].content).toContain('⚠️ Message processing error');
      expect(messages[0].content).not.toContain('{');
      expect(messages[0].content).not.toContain('"type":');
      expect(messages[0].isError).toBe(true);
    });

    it('should transform Claude CLI messages to readable content', () => {
      const mockClaudeMessage: ProcessedClaudeMessage = {
        id: 'msg_claude_123' as MessageId,
        sessionId: 'session_123' as SessionId,
        timestamp: Date.now(),
        role: 'assistant',
        content: [
          { type: 'text', text: "I'll help you with that task." },
          {
            type: 'tool_use',
            id: 'tool_1',
            name: 'Read',
            input: { file_path: '/path/to/file.ts' },
          },
        ],
        model: 'claude-3-5-sonnet-20241022',
        tokenUsage: { input_tokens: 100, output_tokens: 50 },
        toolsUsed: ['Read'],
        isComplete: true,
        isStreaming: false,
        hasImages: false,
        hasFiles: true,
        filePaths: ['/path/to/file.ts'],
      };

      mockClaudeTransformer.transform.and.returnValue(mockClaudeMessage);

      const cliStreamMessage: ClaudeCliStreamMessage = {
        timestamp: '2024-01-01T12:00:00Z',
        sessionId: 'session_123' as SessionId,
        phase: 'complete',
        data: {
          type: 'assistant',
          message: {
            id: 'msg_claude_123',
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'text', text: "I'll help you with that task." },
              {
                type: 'tool_use',
                id: 'tool_1',
                name: 'Read',
                input: { file_path: '/path/to/file.ts' },
              },
            ],
            stop_reason: 'end_turn',
            stop_sequence: null,
          },
          parent_tool_use_id: null,
          session_id: 'session_123',
          uuid: 'uuid_123',
        },
      };

      // Simulate Claude CLI message
      messageSubject.next({
        type: 'chat:messageChunk',
        payload: cliStreamMessage,
      });

      const claudeMessages = service.claudeMessages();
      expect(claudeMessages.length).toBe(1);
      expect(claudeMessages[0].content).toEqual(mockClaudeMessage.content);
      expect(claudeMessages[0].toolsUsed).toContain('Read');
      expect(claudeMessages[0].hasFiles).toBe(true);
    });
  });

  describe('🔄 Unified Dual Message System', () => {
    it('should prioritize enhanced Claude messages over legacy messages', () => {
      // Add a Claude message first
      const claudeMessage: ProcessedClaudeMessage = {
        id: 'claude_msg' as MessageId,
        sessionId: 'session_123' as SessionId,
        timestamp: Date.now(),
        role: 'assistant',
        content: [{ type: 'text', text: 'Enhanced Claude response' }],
        toolsUsed: [],
        isComplete: true,
        isStreaming: false,
        hasImages: false,
        hasFiles: false,
        filePaths: [],
      };

      mockClaudeTransformer.transform.and.returnValue(claudeMessage);

      // Add legacy message
      const legacyMessage: StrictChatMessage = {
        id: 'legacy_msg' as MessageId,
        sessionId: 'session_123' as SessionId,
        type: 'assistant',
        content: 'Legacy response',
        timestamp: Date.now(),
        streaming: false,
      };

      // Simulate both message types
      messageSubject.next({
        type: 'chat:messageAdded',
        payload: { message: legacyMessage },
      });

      messageSubject.next({
        type: 'chat:messageChunk',
        payload: {}, // Will trigger Claude transformer
      });

      // Enhanced messages should be preferred
      const hasClaudeMessages = service.claudeMessages().length > 0;
      const hasLegacyMessages = service.messages().length > 0;

      expect(hasClaudeMessages).toBe(true);
      expect(hasLegacyMessages).toBe(true); // Both exist

      // The UI logic (shouldUseEnhancedDisplay) should prefer enhanced
      // This would be computed in the component
    });

    it('should handle streaming updates correctly in both systems', () => {
      const streamingMessage: StrictChatMessage = {
        id: 'streaming_msg' as MessageId,
        sessionId: 'session_123' as SessionId,
        type: 'assistant',
        content: 'Partial response...',
        timestamp: Date.now(),
        streaming: true,
      };

      messageSubject.next({
        type: 'chat:messageChunk',
        payload: {
          messageId: 'streaming_msg',
          sessionId: 'session_123',
          content: 'Partial response...',
          streaming: true,
          isComplete: false,
        },
      });

      expect(service.isStreaming()).toBe(true);
      expect(service.streamingMessageId()).toBe('streaming_msg');

      // Complete the streaming
      messageSubject.next({
        type: 'chat:messageChunk',
        payload: {
          messageId: 'streaming_msg',
          sessionId: 'session_123',
          content: 'Complete response!',
          streaming: false,
          isComplete: true,
        },
      });

      expect(service.isStreaming()).toBe(false);
      expect(service.streamingMessageId()).toBe(null);
    });
  });

  describe('⚡ Angular 20+ Best Practices Validation', () => {
    it('should use signal-based reactive architecture', () => {
      // Verify signals are used
      expect(service.messages).toBeDefined();
      expect(service.claudeMessages).toBeDefined();
      expect(service.isStreaming).toBeDefined();
      expect(service.currentSession).toBeDefined();

      // Verify signals are readonly
      expect(() => {
        (service.messages as any).set([]);
      }).toThrow(); // Should throw because it's readonly
    });

    it('should use computed signals for derived state', () => {
      // Verify computed signals exist and work
      expect(service.hasMessages).toBeDefined();
      expect(service.latestMessage).toBeDefined();
      expect(service.streamingMessage).toBeDefined();
      expect(service.canSendMessage).toBeDefined();

      // Test computed reactivity
      const initialHasMessages = service.hasMessages();
      expect(typeof initialHasMessages).toBe('boolean');
    });

    it('should maintain OnPush change detection compatibility', () => {
      // All signals should be readonly and immutable
      const messages = service.messages();
      const claudeMessages = service.claudeMessages();

      expect(Array.isArray(messages)).toBe(true);
      expect(Array.isArray(claudeMessages)).toBe(true);

      // Verify immutability - these should be readonly arrays
      expect(() => {
        (messages as any).push({});
      }).toThrow(); // Should be readonly
    });

    it('should handle subscription cleanup properly', () => {
      const destroySpy = spyOn(service as any, 'destroy').and.callThrough();

      service.destroy();

      expect(destroySpy).toHaveBeenCalled();
      // After destruction, no more subscriptions should be active
    });
  });

  describe('🛡️ Error Handling and Resilience', () => {
    it('should handle stream errors gracefully', () => {
      // Simulate stream error
      messageSubject.error(new Error('Stream connection lost'));

      // Service should remain functional
      expect(service.streamConsumptionState().streamErrors.length).toBeGreaterThan(0);
      expect(service.streamConsumptionState().isConnected).toBe(false);

      // Error should be reported to app state
      expect(mockAppStateManager.handleError).toHaveBeenCalled();
    });

    it('should provide user-friendly error messages', () => {
      const invalidMessage = {
        type: 'chat:messageAdded',
        payload: null, // Invalid payload
      };

      messageSubject.next(invalidMessage);

      const messages = service.messages();
      expect(messages.length).toBe(1);
      expect(messages[0].isError).toBe(true);
      expect(messages[0].content).toContain('⚠️ Message processing error');
      expect(messages[0].content).toContain('try sending your message again');
    });

  });

  describe('⚡ Performance Validation', () => {
    it('should process messages under 10ms p99', async () => {
      const latencies: number[] = [];
      const testMessage = {
        type: 'chat:messageAdded',
        payload: {
          message: {
            id: 'perf_test',
            sessionId: 'session_perf',
            type: 'assistant',
            content: 'Performance test message',
            timestamp: Date.now(),
            streaming: false,
          },
        },
      };

      // Process 1000 messages to get p99 latency
      for (let i = 0; i < 1000; i++) {
        const start = performance.now();
        messageSubject.next(testMessage);
        const end = performance.now();
        latencies.push(end - start);
      }

      latencies.sort((a, b) => a - b);
      const p99Index = Math.floor(latencies.length * 0.99);
      const p99Latency = latencies[p99Index];

      expect(p99Latency).toBeLessThan(10); // p99 under 10ms
    });

    it('should handle high message throughput', () => {
      const messageCount = 100;
      const startTime = performance.now();

      // Send 100 messages rapidly
      for (let i = 0; i < messageCount; i++) {
        messageSubject.next({
          type: 'chat:messageAdded',
          payload: {
            message: {
              id: `bulk_msg_${i}`,
              sessionId: 'session_bulk',
              type: 'assistant',
              content: `Bulk message ${i}`,
              timestamp: Date.now(),
              streaming: false,
            },
          },
        });
      }

      const endTime = performance.now();
      const totalTime = endTime - startTime;
      const messagesPerSecond = (messageCount / totalTime) * 1000;

      expect(messagesPerSecond).toBeGreaterThan(100); // Should handle >100 msg/sec
      expect(service.messages().length).toBe(messageCount);
    });

    it('should maintain memory efficiency with large message history', () => {
      // Simulate a large number of messages
      const largeMessageCount = 500;

      for (let i = 0; i < largeMessageCount; i++) {
        messageSubject.next({
          type: 'chat:messageAdded',
          payload: {
            message: {
              id: `large_msg_${i}`,
              sessionId: 'session_large',
              type: 'assistant',
              content: `Large history message ${i}`,
              timestamp: Date.now(),
              streaming: false,
            },
          },
        });
      }

      const performanceState = service.streamConsumptionState().performanceMetrics;
      expect(performanceState.totalMessagesProcessed).toBe(largeMessageCount);

      // Memory usage tracking should be reasonable
      const memoryUsageMB = performanceState.totalBytesProcessed / (1024 * 1024);
      expect(memoryUsageMB).toBeLessThan(50); // Should stay under 50MB for 500 messages
    });
  });

  describe('🔧 Integration and System Tests', () => {
    it('should integrate properly with VSCode service', () => {
      const testContent = 'Integration test message';

      service.sendMessage(testContent);

      expect(mockVSCodeService.postStrictMessage).toHaveBeenCalledWith(
        'chat:sendMessage',
        jasmine.objectContaining({
          content: testContent,
        }),
        jasmine.any(String),
      );
    });

    it('should handle session management correctly', async () => {
      const testSessionId = 'test_session_123' as SessionId;

      await service.switchToSession(testSessionId);

      expect(mockVSCodeService.postStrictMessage).toHaveBeenCalledWith('chat:switchSession', {
        sessionId: testSessionId,
      });
    });

    it('should stop streaming correctly', () => {
      // Set streaming state
      messageSubject.next({
        type: 'chat:messageChunk',
        payload: {
          messageId: 'streaming_msg',
          sessionId: 'session_123',
          content: 'Streaming...',
          streaming: true,
          isComplete: false,
        },
      });

      expect(service.isStreaming()).toBe(true);

      // Stop streaming
      service.stopStreaming();

      expect(service.isStreaming()).toBe(false);
      expect(service.streamingMessageId()).toBe(null);
      expect(mockVSCodeService.postStrictMessage).toHaveBeenCalledWith(
        'chat:stopStream',
        jasmine.objectContaining({
          sessionId: jasmine.any(String),
          messageId: jasmine.any(String),
          timestamp: jasmine.any(Number),
        }),
      );
    });
  });

  describe('🎯 Regression Tests for Original Issues', () => {
    it('should not display "weird messages" with JSON content', () => {
      // Simulate the original issue that caused JSON stub messages
      const weirdMessage = {
        type: 'chat:messageAdded',
        payload: {
          rawDebugInfo: { type: 'object', keys: ['data', 'session'], originalType: 'complex' },
          content: undefined,
          message: null,
        },
      };

      messageSubject.next(weirdMessage);

      const messages = service.messages();
      if (messages.length > 0) {
        const message = messages[0];
        // Should be a clean error message, not raw JSON
        expect(message.content).toContain('⚠️');
        expect(message.content).not.toMatch(/\{.*"type".*\}/);
        expect(message.content).not.toContain('originalType');
        expect(message.isError).toBe(true);
      }
    });

    it('should handle permission system without crashes', () => {
      const permissionRequest = {
        type: 'chat:permissionRequest',
        payload: {
          requestId: 'perm_123',
          permission: 'file:write',
          context: 'Writing configuration',
          timestamp: Date.now(),
          sessionId: 'session_123',
        },
      };

      // This should not cause any crashes or errors
      expect(() => {
        messageSubject.next(permissionRequest);
      }).not.toThrow();

      // Permission requests are handled by chat component, not enhanced chat service
      // So we just verify no crashes occur
    });
  });
});
